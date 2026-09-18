"""Deterministic event engine. The model handles language and judgement; code decides what happens.

Events: parent turn, watch signal, "I'm okay", and the one-minute sweep (reminders, wake window,
investigation timeouts).
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from agents import companion
from agents.schemas import CompanionReply, DeviationJudgment
from config import FALL_WINDOW_MIN, INVESTIGATION_WINDOW_MIN, WAKE_GRACE_MIN
from core import clock
from core.errors import LLMError, NotConfigured
from core.ids import new_id
from core.names import display
from core.log import log
from escalation import service as escalation
from policy import consent
from policy.tiers import TIER_LABEL, decide
from proactive import channel, morning, reminders
from scoring import deviation, judge
from store.repo import get_repo

# ---- parent turns ---------------------------------------------------------------------------


async def on_parent_turn(
    parent_id: str,
    text: str,
    *,
    source: str,
    language: str | None = None,
    duration_sec: float | None = None,
) -> dict[str, Any]:
    repo = get_repo()
    profile = _profile(parent_id)
    today = clock.local_date()
    investigation = repo.open_investigation(parent_id)

    if text:
        repo.add_turn(parent_id, "parent", text, source=source, language=language)
        repo.set_day_if_absent(parent_id, today, "checkin_at", clock.iso(clock.now()))

    reply, effects, guard = await companion.respond(
        parent_id, text, investigating=bool(investigation), source=source
    )
    say = _compose_say(reply, effects, profile)
    rule = _resolve_pending_rule(parent_id, reply, effects)

    day_fields: dict[str, Any] = {}
    if reply.mood != "unknown":
        day_fields["mood"] = reply.mood
    if reply.parent_reports_unwell:
        day_fields["unwell_reported"] = True
    if day_fields:
        repo.update_day(parent_id, today, **day_fields)

    outcome: dict[str, Any] = {"escalated": False}
    if text:
        outcome = await _assess_parent_words(
            parent_id, profile, text, reply, investigation=investigation, duration_sec=duration_sec
        )
    repo.add_turn(parent_id, "ally", say, agent="companion", language=reply.language)
    return {
        "say": say,
        "language": reply.language,
        "mood": reply.mood,
        "pending_rule": rule,
        "reminders_created": [saved["id"] for _, saved in effects.reminders],
        "messages_sent": effects.messages_sent,
        "denied_tools": guard.denied_tools,
        **outcome,
    }


def _compose_say(reply: CompanionReply, effects: companion.RunEffects, profile: dict[str, Any]) -> str:
    """Tool effects use template confirmations so what Ally says always matches what was saved."""
    language = reply.language
    if effects.proposed_rule:
        desc = effects.proposed_rule["description_hi" if language == "hi-IN" else "description"]
        return f"{desc} ठीक है?" if language == "hi-IN" else f"{desc} Is that right?"
    if effects.reminders:
        return " ".join(reminders.confirmation(spec, language) for spec, _ in effects.reminders)
    return reply.say


def _resolve_pending_rule(
    parent_id: str, reply: CompanionReply, effects: companion.RunEffects
) -> dict[str, Any] | None:
    if effects.proposed_rule:
        return effects.proposed_rule
    pending = consent.pending_rule(parent_id)
    if pending and reply.confirms_pending_rule in ("yes", "no"):
        return consent.confirm_rule(parent_id, pending["id"], reply.confirms_pending_rule == "yes")
    return pending


async def _assess_parent_words(
    parent_id: str,
    profile: dict[str, Any],
    text: str,
    reply: CompanionReply,
    *,
    investigation: dict[str, Any] | None,
    duration_sec: float | None,
) -> dict[str, Any]:
    repo = get_repo()
    if reply.parent_says_okay and not reply.parent_reports_unwell:
        if investigation or repo.active_escalation_id(parent_id):
            await on_im_okay(parent_id, source="parent_words")
            return {"escalated": False, "resolved": True}
        return {"escalated": False}

    gate = deviation.combine(
        deviation.utterance_gate(text),
        deviation.vocal_gate(text, duration_sec, profile["baseline"]),
    )
    if not gate.tripped and not reply.parent_reports_unwell:
        if investigation:
            # She answered and nothing is wrong in her words: that's a real response.
            repo.close_investigation(parent_id, investigation["id"], "answered")
            _resolve_alert(parent_id, investigation.get("alert_id"), "parent_answered")
        return {"escalated": False}

    judgment = await _judge_or_none(
        parent_name=profile["name"],
        baseline=profile["baseline"],
        gate=gate,
        utterance=text,
        recent_days=_recent_days(parent_id),
    )
    tier = decide(
        judgment,
        parent_name=profile["name"],
        parent_reports_unwell=reply.parent_reports_unwell,
        after_fall=bool(investigation and investigation.get("reason") == "fall"),
    )
    alert = _alert_for(parent_id, investigation, kind="parent_words", gate=gate, judgment=judgment, tier=tier.tier)
    if investigation:
        repo.close_investigation(parent_id, investigation["id"], "concern_confirmed")
    if not tier.escalate:
        return {"escalated": False, "alert_id": alert["id"], "tier": tier.tier}
    return await _escalate(parent_id, alert, tier.severity)


# ---- watch & I'm okay ---------------------------------------------------------------------


async def on_watch(parent_id: str, kind: str, *, steps: int | None = None, heart_rate: int | None = None) -> dict[str, Any]:
    repo = get_repo()
    now = clock.now()
    signal = repo.add_signal(parent_id, kind, steps=steps, heart_rate=heart_rate)
    if kind == "im_okay":
        return {"signal": signal, **(await on_im_okay(parent_id, source="watch"))}
    if kind == "fall":
        return {"signal": signal, **(await on_possible_fall(parent_id, now))}
    if kind not in ("wake", "first_movement"):
        return {"signal": signal}

    today = clock.local_date(now)
    if not repo.set_day_if_absent(parent_id, today, "wake_at", clock.iso(now)):
        return {"signal": signal, "first_wake": False}

    scheduled = reminders.schedule_after_wake(parent_id, now)
    resolved = False
    if repo.open_investigation(parent_id) or repo.active_escalation_id(parent_id):
        await on_im_okay(parent_id, source="watch_wake")
        resolved = True
    result: dict[str, Any] = {"signal": signal, "first_wake": True, "after_wake_reminders": scheduled, "resolved": resolved}
    try:
        msg = await morning.run(parent_id, now)
        result["morning_message_id"] = msg["id"] if msg else None
    except Exception as exc:  # the wake is recorded either way; the failure is logged and returned
        log("morning_checkin_failed", parent_id=parent_id, error=repr(exc))
        result["morning_error"] = str(exc)
    return result


async def on_possible_fall(parent_id: str, now: Any) -> dict[str, Any]:
    """The watch thinks she fell. Ask her first — one short question — then escalate fast if she can't answer.

    A fall is never a silent alert and never an immediate blast to the family: she gets a moment to
    say she is fine, and the window is minutes rather than the quarter hour a late wake-up gets.
    """
    repo = get_repo()
    profile = _profile(parent_id)
    # The watch can fire twice on one tumble; one question per cooldown window.
    if not repo.claim_dedupe(parent_id, f"alert#fall#{clock.iso(now)[:15]}"):
        return {"fall": True, "skipped": "duplicate"}
    if repo.active_escalation_id(parent_id):
        return {"fall": True, "skipped": "already_escalating"}

    gate = deviation.GateResult(True, 0.8, [{"code": "watch_detected_possible_fall", "level": "strong"}])
    alert = _new_alert(parent_id, kind="fall", gate=gate, judgment=None, tier=1, status="investigating")
    inv = _open_investigation(parent_id, alert, now, minutes=FALL_WINDOW_MIN, reason="fall")
    hi = profile.get("language") == "hi-IN"
    body = (
        f"{display(profile, 'hi-IN')}, मुझे लगा कि आप गिर गई हैं। आप ठीक हैं?"
        if hi
        else f"{profile['name']}, it looked like you may have fallen. Are you alright?"
    )
    await channel.post(
        parent_id,
        audience="parent",
        kind="investigation",
        body=body,
        related_id=f"investigation#{inv['id']}",
        data={"reason": "fall"},
    )
    log("possible_fall", parent_id=parent_id, alert_id=alert["id"], window_min=FALL_WINDOW_MIN)
    return {"fall": True, "alert_id": alert["id"], "asked_parent": True}


def _open_investigation(
    parent_id: str, alert: dict[str, Any], now: Any, *, minutes: int, reason: str
) -> dict[str, Any]:
    inv = {
        "id": new_id(),
        "alert_id": alert["id"],
        "asked_at": clock.iso(now),
        "due_at": clock.iso(now + timedelta(minutes=minutes)),
        "status": "open",
        "reason": reason,
    }
    get_repo().put_investigation(parent_id, inv)
    return inv


async def on_im_okay(parent_id: str, *, source: str) -> dict[str, Any]:
    repo = get_repo()
    now = clock.now()
    repo.update_day(parent_id, clock.local_date(now), im_okay_at=clock.iso(now))
    investigation = repo.open_investigation(parent_id)
    if investigation:
        repo.close_investigation(parent_id, investigation["id"], "parent_okay")
        _resolve_alert(parent_id, investigation.get("alert_id"), f"parent_okay:{source}")
    stopped = await escalation.stop(parent_id, reason=f"parent_okay:{source}")
    if stopped:
        alert = repo.get_alert(parent_id, stopped.get("alert_id", ""))
        if alert:
            repo.update_alert(parent_id, alert, status="resolved", resolution=f"parent_okay:{source}")
    return {"okay": True, "investigation_closed": bool(investigation), "escalation_stopped": bool(stopped)}


# ---- sweep (EventBridge Scheduler, every minute) ---------------------------------------------


async def sweep() -> dict[str, Any]:
    now = clock.now()
    out: dict[str, Any] = {"reminders": await reminders.fire_due(now), "wake_checks": 0, "investigations": 0}
    repo = get_repo()
    for parent_id in _parent_ids():
        try:
            if await check_wake_window(parent_id, now):
                out["wake_checks"] += 1
        except Exception as exc:
            log("wake_check_failed", parent_id=parent_id, error=repr(exc))
    for inv in repo.due_investigations(now):
        try:
            await investigation_timeout(inv["parent_id"], inv)
            out["investigations"] += 1
        except Exception as exc:
            log("investigation_timeout_failed", parent_id=inv["parent_id"], error=repr(exc))
    return out


async def check_wake_window(parent_id: str, now: Any) -> bool:
    repo = get_repo()
    profile = _profile(parent_id)
    today = clock.local_date(now)
    day = repo.get_day(parent_id, today)
    gate = deviation.no_wake_gate(profile["baseline"], today, now, WAKE_GRACE_MIN, woke=bool(day.get("wake_at") or day.get("im_okay_at")))
    if not gate.tripped or not repo.claim_dedupe(parent_id, f"alert#no_wake#{today}"):
        return False
    alert = _new_alert(parent_id, kind="no_wake", gate=gate, judgment=None, tier=1, status="investigating")
    inv = _open_investigation(parent_id, alert, now, minutes=INVESTIGATION_WINDOW_MIN, reason="no_wake")
    hi = profile.get("language") == "hi-IN"
    body = (
        f"सुप्रभात {display(profile, 'hi-IN')}। आप आमतौर पर इस समय तक उठ जाती हैं — सब ठीक है?"
        if hi
        else f"Good morning {profile['name']}. You're usually up by now — is everything alright?"
    )
    await channel.post(parent_id, audience="parent", kind="investigation", body=body, related_id=f"investigation#{inv['id']}")
    log("investigation_opened", parent_id=parent_id, alert_id=alert["id"])
    return True


async def investigation_timeout(parent_id: str, inv: dict[str, Any]) -> dict[str, Any]:
    repo = get_repo()
    if not repo.close_investigation(parent_id, inv["id"], "no_response"):
        return {"skipped": "already_closed"}
    profile = _profile(parent_id)
    alert = repo.get_alert(parent_id, inv.get("alert_id", "")) or _new_alert(
        parent_id, kind="no_response", gate=None, judgment=None, tier=1, status="investigating"
    )
    after_fall = inv.get("reason") == "fall" or alert.get("kind") == "fall"
    gate = deviation.GateResult(
        True, 0.6, [*(alert.get("gate") or []), {"code": "no_response_after_check_in", "level": "strong"}]
    )
    judgment = await _judge_or_none(
        parent_name=profile["name"],
        baseline=profile["baseline"],
        gate=gate,
        no_response=True,
        after_fall=after_fall,
        recent_days=_recent_days(parent_id),
    )
    tier = decide(judgment, parent_name=profile["name"], no_response=True, after_fall=after_fall)
    alert = repo.update_alert(
        parent_id, alert, judgment=judgment.model_dump() if judgment else None, gate=gate.reasons, tier=tier.tier
    )
    return await _escalate(parent_id, alert, tier.severity)


# ---- helpers --------------------------------------------------------------------------------


async def _judge_or_none(**kwargs: Any) -> DeviationJudgment | None:
    """A model outage must never silence the family: policy then decides without a judgement."""
    try:
        return await judge.judge(**kwargs)
    except LLMError as exc:
        log("judge_unavailable", detail=exc.detail)
        return None


async def _escalate(parent_id: str, alert: dict[str, Any], severity: str) -> dict[str, Any]:
    try:
        esc = await escalation.start(parent_id, alert, severity)
    except NotConfigured as exc:
        log("escalation_not_configured", parent_id=parent_id, detail=exc.detail)
        return {"escalated": False, "alert_id": alert["id"], "tier": 2, "escalation_error": str(exc)}
    return {"escalated": True, "alert_id": alert["id"], "escalation_id": esc.get("id"), "tier": 2}


def _new_alert(
    parent_id: str,
    *,
    kind: str,
    gate: deviation.GateResult | None,
    judgment: DeviationJudgment | None,
    tier: int,
    status: str,
) -> dict[str, Any]:
    alert = {
        "id": new_id(),
        "created_at": clock.iso(clock.now()),
        "kind": kind,
        "status": status,
        "tier": tier,
        "gate": gate.reasons if gate else [],
        "gate_score": gate.score if gate else None,
        "judgment": judgment.model_dump() if judgment else None,
    }
    get_repo().put_alert(parent_id, alert)
    return alert


def _alert_for(
    parent_id: str,
    investigation: dict[str, Any] | None,
    *,
    kind: str,
    gate: deviation.GateResult,
    judgment: DeviationJudgment | None,
    tier: int,
) -> dict[str, Any]:
    repo = get_repo()
    if investigation and investigation.get("alert_id"):
        existing = repo.get_alert(parent_id, investigation["alert_id"])
        if existing:
            return repo.update_alert(
                parent_id,
                existing,
                gate=[*(existing.get("gate") or []), *gate.reasons],
                judgment=judgment.model_dump() if judgment else None,
                tier=tier,
                status="escalating" if tier >= 2 else "monitoring",
            )
    return _new_alert(parent_id, kind=kind, gate=gate, judgment=judgment, tier=tier, status="escalating" if tier >= 2 else "monitoring")


def _resolve_alert(parent_id: str, alert_id: str | None, resolution: str) -> None:
    if not alert_id:
        return
    repo = get_repo()
    alert = repo.get_alert(parent_id, alert_id)
    if alert and alert.get("status") not in ("resolved",):
        repo.update_alert(parent_id, alert, status="resolved", resolution=resolution)


def _recent_days(parent_id: str) -> list[dict[str, Any]]:
    return get_repo().list_days(parent_id, clock.days_ago(6), clock.days_ago(1))


def _profile(parent_id: str) -> dict[str, Any]:
    profile = get_repo().get_profile(parent_id)
    if not profile:
        raise NotConfigured("This parent has not been set up yet.", detail=f"no PROFILE for {parent_id}")
    return profile


def _parent_ids() -> list[str]:
    from config import PARENT_ID

    return [PARENT_ID]


# ---- read model -----------------------------------------------------------------------------


def snapshot(parent_id: str, *, viewer: str) -> dict[str, Any]:
    """Backward-compatible AllyState for the web app. Family viewers never get the transcript."""
    repo = get_repo()
    profile = _profile(parent_id)
    now = clock.now()
    today = clock.local_date(now)
    day = repo.get_day(parent_id, today)
    history = repo.list_days(parent_id, clock.days_ago(13), clock.days_ago(1))
    members = repo.list_members(parent_id)
    alert = repo.open_alert(parent_id) or next(iter(repo.list_alerts(parent_id, limit=1)), None)
    esc_id = repo.active_escalation_id(parent_id)
    esc = repo.get_escalation(parent_id, esc_id, consistent=False) if esc_id else None
    investigation = repo.open_investigation(parent_id)
    tier = 1
    narration = "Most days, Ally says nothing at all."
    escalation_state = "none"
    if investigation:
        escalation_state = "investigating"
        narration = f"I'm checking in with {profile['name']} myself first."
    if esc:
        tier = 2
        escalation_state = {
            "accepted": "en_route",
            "resolved": "resolved",
            "asking": "coordinating",
            "asking_parent": "awaiting_confirmation",
        }.get(esc.get("status", ""), "coordinating")
        narration = f"I'm asking {profile['name']}'s family to check in."
    gate_reasons = (alert or {}).get("gate") if alert and alert.get("status") != "resolved" else []
    responder = (esc or {}).get("responder")
    responder_name = next((m["name"] for m in members if m["id"] == responder), None)
    state: dict[str, Any] = {
        "parent_id": parent_id,
        "parent_name": profile["name"],
        "language": profile.get("language", "hi-IN"),
        "honesty": "Days before today are simulated history used to establish a baseline. Today is live.",
        "honesty_label": "simulated history",
        "history_simulated": True,
        "today_live": True,
        "baseline": profile["baseline"],
        "history": [
            {
                "day": i + 1,
                "date": d["date"],
                "wake_detected_at": clock.hhmm(clock.parse_iso(d["wake_at"])) if d.get("wake_at") else None,
                "checkin_at": clock.hhmm(clock.parse_iso(d["checkin_at"])) if d.get("checkin_at") else None,
                "deviation_score": d.get("score", 0),
                "notes": d.get("notes"),
                "simulated": bool(d.get("simulated")),
            }
            for i, d in enumerate(history)
        ],
        "family_roster": [
            {
                "id": m["id"],
                "name": m["name"],
                "relation": m.get("relation", ""),
                "role": m.get("role"),
                "availability": _availability(m["id"], esc),
            }
            for m in members
        ],
        "today": {
            "date": today,
            "wake_detected_at": clock.hhmm(clock.parse_iso(day["wake_at"])) if day.get("wake_at") else None,
            "im_okay_at": clock.hhmm(clock.parse_iso(day["im_okay_at"])) if day.get("im_okay_at") else None,
            "checkin_completed": bool(day.get("checkin_at")),
            "reminders_done": day.get("reminders_done", 0),
            "activity_log": [],
            "call_log": [],
            "deviation_score": (alert or {}).get("gate_score") or 0 if gate_reasons else 0,
            "deviation_reasons": [{"code": r["code"], "weight": 0, "level": r.get("level", "")} for r in gate_reasons or []],
            "simulated": False,
        },
        "escalation_state": escalation_state,
        "escalation_id": esc_id,
        "tier": tier,
        "tier_label": TIER_LABEL[tier],
        "tier_narration": narration,
        "mode": "coordination" if esc else ("investigation" if investigation else "companion"),
        "last_decision": {
            "responder": responder_name,
            "summary": _summary(esc, members, profile),
            "ack": (esc or {}).get("status"),
        }
        if esc
        else None,
        "open_alert": _alert_view(alert) if alert else None,
        "pending_rule": consent.pending_rule(parent_id) if viewer == "parent" else None,
        "transcript": [],
        "updated_at": clock.iso(now),
    }
    if viewer == "parent":
        state["transcript"] = [
            {"speaker": t["speaker"], "text": t["text"], "agent": t.get("agent"), "at": t["at"]}
            for t in repo.recent_turns(parent_id, limit=20)
        ]
    return state


def _availability(member_id: str, esc: dict[str, Any] | None) -> str:
    if not esc:
        return "unknown"
    if esc.get("responder") == member_id:
        return "arrived" if esc.get("status") == "resolved" else "en_route"
    if esc.get("current_contact") == member_id:
        return "asked"
    for event in reversed(esc.get("timeline", [])):
        if event.get("member") == member_id and event.get("event") in ("decline", "timeout", "not_permitted"):
            return "unavailable" if event["event"] == "decline" else "no_answer"
    return "unknown"


def _summary(esc: dict[str, Any] | None, members: list[dict[str, Any]], profile: dict[str, Any]) -> str:
    if not esc:
        return ""
    names = {m["id"]: m["name"] for m in members}
    status = esc.get("status")
    if status == "accepted":
        return f"{names.get(esc.get('responder'), 'Family')} is on the way to {profile['name']}."
    if status == "resolved":
        return f"{names.get(esc.get('responder'), 'Family')} is with {profile['name']} now."
    if status == "asking":
        return f"Ally is asking {names.get(esc.get('current_contact'), 'family')} to check on {profile['name']}."
    if status == "asking_parent":
        return f"No child could go; Ally is asking {profile['name']} about a neighbour."
    return f"Ally is coordinating family for {profile['name']}."


def _alert_view(alert: dict[str, Any]) -> dict[str, Any]:
    return {k: alert.get(k) for k in ("id", "created_at", "kind", "status", "tier", "judgment", "escalation_id")}
