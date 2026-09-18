"""Ally HTTP API (FastAPI). Runs under uvicorn locally and on Lambda via the Lambda Web Adapter."""

from __future__ import annotations

import base64
import sys
from pathlib import Path
from typing import Any, Literal

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi import Depends, FastAPI, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from agents import family_qa, orchestrator
from agents.schemas import HealthProbe
from auth import Identity, current_identity, require_family, require_parent, verify_device_key
from config import BEDROCK_MODEL_ID, CORS_ORIGINS, DEV_TOOLS, FAMILY_ASK_DAILY_LIMIT, HOST, PORT, STT_PROVIDER
from core import clock
from core.errors import AllyError, Conflict, Forbidden, LLMError
from core.log import log
from escalation import service as escalation
from escalation import tokens
from llm.bedrock import structured
from notify import push
from policy import consent
from proactive import channel, reminders
from store.repo import get_repo
from voice import speech, stt

app = FastAPI(title="Ally", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["authorization", "content-type", "x-dev-member"],
)

GENTLE_ERROR = {
    "hi-IN": "माफ़ कीजिए, मुझे अभी थोड़ी दिक्कत हो रही है। कृपया थोड़ी देर में फिर कोशिश करें।",
    "en-IN": "Sorry, I'm having a little trouble right now. Please try again in a moment.",
}


@app.exception_handler(AllyError)
async def ally_error_handler(request: Request, exc: AllyError) -> JSONResponse:
    log("request_error", path=request.url.path, code=exc.code, detail=exc.detail)
    body: dict[str, Any] = {"error": exc.code, "message": str(exc)}
    if isinstance(exc, LLMError):
        body["say"] = GENTLE_ERROR["hi-IN"]
        body["say_en"] = GENTLE_ERROR["en-IN"]
    return JSONResponse(status_code=exc.status, content=body)


# ---- models -----------------------------------------------------------------------------------


class WatchIn(BaseModel):
    kind: Literal["wake", "first_movement", "activity", "im_okay", "fall"] = "activity"
    steps: int | None = Field(default=None, ge=0)
    heart_rate: int | None = Field(default=None, ge=20, le=250)


class ParentTextIn(BaseModel):
    text: str = Field(default="", max_length=600)


class AudioIn(BaseModel):
    audio_base64: str = Field(max_length=800_000)
    mime_type: str = "audio/wav"


class TtsIn(BaseModel):
    text: str = Field(min_length=1, max_length=600)
    language: Literal["hi-IN", "en-IN"] = "hi-IN"


class EscalationReplyIn(BaseModel):
    decision: Literal["accept", "decline", "arrived"]


class TokenReplyIn(BaseModel):
    reply_token: str
    decision: Literal["accept", "decline"]


class NeighbourReplyIn(BaseModel):
    decision: Literal["confirm", "deny"]


class AskIn(BaseModel):
    question: str = Field(min_length=2, max_length=500)


class NoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=280)


class PushSubIn(BaseModel):
    subscription: dict[str, Any]


class ConfirmIn(BaseModel):
    yes: bool


# ---- health -----------------------------------------------------------------------------------


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "ally"}


@app.get("/health/deep")
async def health_deep() -> dict[str, Any]:
    probe = await structured(
        "health_probe", "You are a health check.", "Return ok=true and word='ready'.", HealthProbe, max_turns=2
    )
    return {"ok": probe.ok, "model": BEDROCK_MODEL_ID, "stt": STT_PROVIDER, "time": clock.iso(clock.now())}


# ---- shared state -----------------------------------------------------------------------------


@app.get("/ally/state")
def get_state(identity: Identity = Depends(current_identity)) -> dict[str, Any]:
    return orchestrator.snapshot(identity.parent_id, viewer="parent" if identity.is_parent else identity.member_id)


@app.get("/ally/proactive/pending")
def pending_messages(identity: Identity = Depends(current_identity)) -> dict[str, Any]:
    return {"messages": channel.claim(identity.parent_id, identity.audience)}


@app.post("/ally/proactive/{msg_id}/ack")
def ack_message(msg_id: str, identity: Identity = Depends(current_identity)) -> dict[str, Any]:
    msg = get_repo().get_message(identity.parent_id, msg_id)
    if not msg or msg.get("audience") != identity.audience:
        raise Forbidden("Not your message.")
    channel.acknowledge(identity.parent_id, msg_id)
    if msg.get("kind") == "reminder":
        reminders.mark_done(identity.parent_id, str((msg.get("data") or {}).get("reminder_id")))
    return {"ok": True}


# ---- push -------------------------------------------------------------------------------------


@app.get("/ally/push/vapid-public-key")
def vapid_key() -> dict[str, Any]:
    return {"key": push.vapid_public_key()}


@app.post("/ally/push/subscribe")
def push_subscribe(body: PushSubIn, identity: Identity = Depends(current_identity)) -> dict[str, Any]:
    return {"ok": True, "id": push.subscribe(identity.parent_id, identity.audience, body.subscription)}


@app.delete("/ally/push/subscribe")
def push_unsubscribe(body: PushSubIn, identity: Identity = Depends(current_identity)) -> dict[str, Any]:
    push.unsubscribe(identity.parent_id, identity.audience, str(body.subscription.get("endpoint") or ""))
    return {"ok": True}


# ---- parent -----------------------------------------------------------------------------------


@app.post("/ally/parent/text")
async def parent_text(body: ParentTextIn, identity: Identity = Depends(current_identity)) -> dict[str, Any]:
    require_parent(identity)
    result = await orchestrator.on_parent_turn(identity.parent_id, body.text.strip(), source="text")
    return {**result, "state": orchestrator.snapshot(identity.parent_id, viewer="parent")}


@app.post("/ally/parent/audio")
async def parent_audio(body: AudioIn, identity: Identity = Depends(current_identity)) -> dict[str, Any]:
    require_parent(identity)
    profile = get_repo().get_profile(identity.parent_id) or {}
    try:
        raw = base64.b64decode(body.audio_base64, validate=True)
    except ValueError as exc:
        raise Forbidden("That recording could not be read.", detail=repr(exc)) from exc
    transcript = await stt.transcribe(raw, profile.get("language", "hi-IN"))
    if not transcript.text:
        return {
            "stt_empty": True,
            "transcript_in": "",
            "say": None,
            "state": orchestrator.snapshot(identity.parent_id, viewer="parent"),
        }
    result = await orchestrator.on_parent_turn(
        identity.parent_id,
        transcript.text,
        source="voice",
        language=transcript.language,
        duration_sec=transcript.duration_sec,
    )
    return {
        **result,
        "stt_empty": False,
        "transcript_in": transcript.text,
        "state": orchestrator.snapshot(identity.parent_id, viewer="parent"),
    }


@app.post("/ally/companion/start")
async def companion_start(identity: Identity = Depends(current_identity)) -> dict[str, Any]:
    require_parent(identity)
    result = await orchestrator.on_parent_turn(identity.parent_id, "", source="open")
    return {**result, "state": orchestrator.snapshot(identity.parent_id, viewer="parent")}


@app.post("/ally/tts")
async def tts(body: TtsIn, identity: Identity = Depends(current_identity)) -> dict[str, Any]:
    require_parent(identity)
    return await speech.synthesize(body.text, body.language)


@app.post("/ally/im-okay")
async def im_okay(identity: Identity = Depends(current_identity)) -> dict[str, Any]:
    require_parent(identity)
    result = await orchestrator.on_im_okay(identity.parent_id, source="tablet")
    return {**result, "state": orchestrator.snapshot(identity.parent_id, viewer="parent")}


@app.get("/ally/parent/audit")
def parent_audit(identity: Identity = Depends(current_identity)) -> dict[str, Any]:
    require_parent(identity)
    repo = get_repo()
    names = {m["id"]: m["name"] for m in repo.list_members(identity.parent_id)}
    rows = repo.list_audit(identity.parent_id, limit=100)
    return {
        "entries": [
            {
                **{k: r.get(k) for k in ("id", "at", "decision", "action", "topic", "reason", "policy_ids", "requested_by", "summary", "outcome")},
                "who": names.get(r.get("principal_id"), r.get("principal_id")),
                "who_type": r.get("principal_type"),
            }
            for r in rows
            if r.get("principal_type") != "Parent"
        ]
    }


@app.get("/ally/parent/consent")
def parent_consent(identity: Identity = Depends(current_identity)) -> dict[str, Any]:
    require_parent(identity)
    repo = get_repo()
    return {
        "base": consent.base_rules(),
        "rules": repo.list_consents(identity.parent_id, statuses=("active", "pending_confirm")),
    }


@app.post("/ally/parent/consent/{rule_id}/confirm")
def confirm_consent(rule_id: str, body: ConfirmIn, identity: Identity = Depends(current_identity)) -> dict[str, Any]:
    require_parent(identity)
    rule = consent.confirm_rule(identity.parent_id, rule_id, body.yes)
    if not rule:
        raise Conflict("That rule is no longer waiting for confirmation.")
    return {"rule": {k: v for k, v in rule.items() if k != "cedar"}}


@app.delete("/ally/parent/consent/{rule_id}")
def revoke_consent(rule_id: str, identity: Identity = Depends(current_identity)) -> dict[str, Any]:
    require_parent(identity)
    if not consent.revoke_rule(identity.parent_id, rule_id):
        raise Conflict("That rule is not active.")
    return {"ok": True}


@app.post("/ally/escalations/{esc_id}/neighbour")
async def neighbour_reply(esc_id: str, body: NeighbourReplyIn, identity: Identity = Depends(current_identity)) -> dict[str, Any]:
    require_parent(identity)
    await escalation.reply(identity.parent_id, esc_id, responder="parent", decision=body.decision)
    return escalation.view(identity.parent_id, esc_id)


# ---- family -----------------------------------------------------------------------------------


@app.get("/ally/dashboard")
def dashboard(identity: Identity = Depends(current_identity)) -> dict[str, Any]:
    require_family(identity)
    repo = get_repo()
    pid = identity.parent_id
    decision = consent.authorize(
        pid,
        principal=("Neighbour" if _is_neighbour(identity) else "Family", identity.member_id),
        action="view_dashboard",
        topic="routine",
        requested_by=f"Family::{identity.member_id}",
        summary="Opened the family dashboard",
        audit_dedupe_key=f"dashboard#{identity.member_id}#{clock.now().strftime('%Y-%m-%dT%H')}",
    )
    if not decision.allowed:
        raise Forbidden("Amma hasn't shared her dashboard with you.")
    health_ok = _allowed_silently(pid, identity, "read_day_log", "health")
    mood_ok = _allowed_silently(pid, identity, "read_day_log", "mood")
    days = repo.list_days(pid, clock.days_ago(13), clock.local_date())
    return {
        "days": [
            {
                "date": d["date"],
                "wake_at": d.get("wake_at"),
                "checkin_at": d.get("checkin_at"),
                "reminders_done": d.get("reminders_done", 0),
                "simulated": bool(d.get("simulated")),
                "mood": d.get("mood") if mood_ok else None,
                "unwell_reported": d.get("unwell_reported") if health_ok else None,
            }
            for d in days
        ],
        "alerts": [orchestrator._alert_view(a) for a in repo.list_alerts(pid, limit=10)],
        "escalations": [escalation.view(pid, e["id"]) for e in repo.list_escalations(pid, limit=3)],
        "shared": {"health": health_ok, "mood": mood_ok},
    }


@app.get("/ally/alerts/{alert_id}")
def alert_detail(alert_id: str, identity: Identity = Depends(current_identity)) -> dict[str, Any]:
    require_family(identity)
    repo = get_repo()
    pid = identity.parent_id
    alert = repo.get_alert(pid, alert_id)
    if not alert:
        raise Forbidden("Alert not found.")
    profile = repo.get_profile(pid) or {}
    esc = repo.get_escalation(pid, alert["escalation_id"], consistent=False) if alert.get("escalation_id") else None
    audit = [
        {k: r.get(k) for k in ("at", "principal_id", "action", "topic", "decision", "reason")}
        for r in repo.list_audit(pid, limit=100)
        if r["at"] >= alert["created_at"] and r.get("requested_by") in ("Ally::coordinator",)
    ]
    words_ok = _allowed_silently(pid, identity, "read_conversation", "conversation")
    return {
        "alert": alert,
        "baseline": profile.get("baseline"),
        "escalation": {k: v for k, v in (esc or {}).items() if k != "task_token"} or None,
        "consent_decisions": list(reversed(audit)),
        "parent_words": None if not words_ok else [],
        "parent_words_note": None if words_ok else f"{profile.get('name', 'Amma')} keeps her conversations private.",
    }


@app.post("/ally/family/ask")
async def family_ask(body: AskIn, identity: Identity = Depends(current_identity)) -> dict[str, Any]:
    require_family(identity)
    repo = get_repo()
    count = repo.increment_day(identity.parent_id, clock.local_date(), f"asks_{identity.member_id}", limit=FAMILY_ASK_DAILY_LIMIT)
    if count < 0:
        raise Conflict("You've reached today's question limit.")
    member = repo.get_member(identity.parent_id, identity.member_id)
    if not member:
        raise Forbidden("Unknown family member.")
    result, guard = await family_qa.answer(identity.parent_id, member, body.question)
    return {**result.model_dump(), "denied_tools": guard.denied_tools}


@app.post("/ally/family/note")
async def family_note(body: NoteIn, identity: Identity = Depends(current_identity)) -> dict[str, Any]:
    require_family(identity)
    repo = get_repo()
    member = repo.get_member(identity.parent_id, identity.member_id) or {"name": identity.member_id}
    decision = consent.authorize(
        identity.parent_id,
        principal=("Family", identity.member_id),
        action="send_note",
        topic="self",
        requested_by=f"Family::{identity.member_id}",
        summary=f"Note to parent: {body.text[:80]}",
    )
    if not decision.allowed:
        raise Forbidden("Notes aren't enabled for you.")
    msg = await channel.post(
        identity.parent_id,
        audience="parent",
        kind="family_note",
        title=f"A note from {member['name']}",
        body=body.text,
        related_id=f"note#{identity.member_id}#{clock.iso(clock.now())}",
        data={"from": identity.member_id, "from_name": member["name"]},
    )
    return {"ok": True, "id": msg["id"]}


@app.get("/ally/escalations/{esc_id}")
def get_escalation(esc_id: str, identity: Identity = Depends(current_identity)) -> dict[str, Any]:
    return escalation.view(identity.parent_id, esc_id)


@app.post("/ally/escalations/{esc_id}/reply")
async def escalation_reply(esc_id: str, body: EscalationReplyIn, identity: Identity = Depends(current_identity)) -> dict[str, Any]:
    require_family(identity)
    esc = await escalation.reply(identity.parent_id, esc_id, responder=identity.member_id, decision=body.decision)
    return {k: v for k, v in esc.items() if k != "task_token"}


@app.post("/ally/escalations/reply")
async def escalation_token_reply(body: TokenReplyIn) -> dict[str, Any]:
    """Called from the service worker's notification action (no JWT available there)."""
    claims = tokens.verify(body.reply_token)
    esc = await escalation.reply(
        claims["parent_id"],
        claims["esc_id"],
        responder=claims["contact"],
        decision=body.decision,
        token_version=claims["token_version"],
    )
    return {"ok": True, "status": esc.get("status")}


# ---- watch ------------------------------------------------------------------------------------


@app.post("/ally/watch")
async def watch(body: WatchIn, x_ally_device_key: str | None = Header(default=None)) -> dict[str, Any]:
    verify_device_key(x_ally_device_key)
    from config import PARENT_ID

    return await orchestrator.on_watch(PARENT_ID, body.kind, steps=body.steps, heart_rate=body.heart_rate)


# ---- dev only ---------------------------------------------------------------------------------

if DEV_TOOLS:

    @app.post("/ally/dev/sweep")
    async def dev_sweep() -> dict[str, Any]:
        return await orchestrator.sweep()


def _is_neighbour(identity: Identity) -> bool:
    member = get_repo().get_member(identity.parent_id, identity.member_id) or {}
    return member.get("role") == "neighbour"


def _allowed_silently(parent_id: str, identity: Identity, action: str, topic: str) -> bool:
    return consent.authorize(
        parent_id,
        principal=("Neighbour" if _is_neighbour(identity) else "Family", identity.member_id),
        action=action,
        topic=topic,
        requested_by=f"Family::{identity.member_id}",
        audit=False,
    ).allowed


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host=HOST, port=PORT, reload=True)
