"""Companion agent: the only voice the parent hears. Strands agent + tools, every tool Cedar-guarded."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Literal

from strands import ToolContext, tool

from agents.schemas import CompanionReply
from core import clock
from llm.bedrock import structured
from policy import consent
from policy.hook import ConsentGuard
from proactive import channel, reminders
from store.repo import get_repo


@dataclass
class RunEffects:
    """What the tools actually did this turn (the orchestrator uses these, not the model's claims)."""

    reminders: list[tuple[reminders.ReminderSpec, dict[str, Any]]] = field(default_factory=list)
    proposed_rule: dict[str, Any] | None = None
    messages_sent: list[dict[str, Any]] = field(default_factory=list)
    tool_errors: list[str] = field(default_factory=list)


def _effects(ctx: ToolContext) -> RunEffects:
    return ctx.invocation_state["effects"]


def _parent(ctx: ToolContext) -> str:
    return ctx.invocation_state["parent_id"]


@tool(context=True)
def create_reminder(
    text: str,
    kind: Literal["time", "after_wake"],
    tool_context: ToolContext,
    time_hhmm: str | None = None,
    date: Literal["today", "tomorrow"] | None = None,
    offset_minutes: int | None = None,
    recurrence: Literal["none", "daily"] = "none",
) -> str:
    """Create a reminder for the parent.

    Args:
        text: What to remind her about, as a short verb phrase, e.g. "take your BP tablet".
        kind: "time" for a clock time, "after_wake" for "after I wake up".
        time_hhmm: 24-hour local time like "21:00" (required for kind=time).
        date: "today" or "tomorrow" for one-off time reminders.
        offset_minutes: Minutes after waking (for kind=after_wake).
        recurrence: "daily" if she says every day, else "none".
    """
    try:
        spec = reminders.ReminderSpec(
            text=text, kind=kind, time_hhmm=time_hhmm, date=date, offset_minutes=offset_minutes, recurrence=recurrence
        )
        saved = reminders.create(_parent(tool_context), spec, created_by="parent_voice")
    except ValueError as exc:
        _effects(tool_context).tool_errors.append(f"create_reminder: {exc}")
        return f"Could not create the reminder: {exc}"
    _effects(tool_context).reminders.append((spec, saved))
    return "Reminder saved."


@tool(context=True)
def set_privacy_rule(
    audience: str,
    topic: Literal["routine", "mood", "health", "location", "all"],
    tool_context: ToolContext,
    except_emergency: bool = True,
) -> str:
    """Stop Ally from telling a family member about something. Use when she says things like
    "don't tell Priya about my health". The rule waits for her to confirm.

    Args:
        audience: A family member id from the roster, or "all_children".
        topic: What to keep private. Safety can never be restricted.
        except_emergency: True unless she clearly says "even in an emergency".
    """
    state = tool_context.invocation_state
    try:
        rule = consent.propose_rule(
            state["parent_id"],
            audience=audience,
            topic=topic,
            except_emergency=except_emergency,
            language=state["language"],
            source="voice",
        )
    except ValueError as exc:
        _effects(tool_context).tool_errors.append(f"set_privacy_rule: {exc}")
        return f"Could not set that rule: {exc}"
    _effects(tool_context).proposed_rule = rule
    return "Rule drafted; it needs her confirmation."


@tool(context=True)
async def send_message_to_family(
    member_id: str,
    message: str,
    tool_context: ToolContext,
    topic: Literal["routine", "mood", "health"] = "routine",
) -> str:
    """Pass a short message from the parent to one family member, e.g. "tell Rahul I'll call him tonight".

    Args:
        member_id: Family member id from the roster.
        message: The message in her words, briefly.
        topic: What the message is about.
    """
    parent_id = _parent(tool_context)
    profile = get_repo().get_profile(parent_id) or {}
    sent = await channel.post(
        parent_id,
        audience=member_id,
        kind="family_update",
        title=f"Message from {profile.get('name', 'Amma')}",
        body=message[:280],
        related_id=f"relay#{tool_context.tool_use['toolUseId']}",
        data={"from": "parent"},
    )
    _effects(tool_context).messages_sent.append({"member_id": member_id, "msg_id": sent["id"]})
    return "Message sent."


@tool(context=True)
def recall_recent_days(tool_context: ToolContext, days: int = 3) -> str:
    """Look up her last few days (wake time, reminders done, mood) when she asks about them.

    Args:
        days: How many recent days, 1 to 7.
    """
    parent_id = _parent(tool_context)
    days = max(1, min(7, days))
    rows = get_repo().list_days(parent_id, clock.days_ago(days), clock.local_date())
    return json.dumps(
        [{k: r.get(k) for k in ("date", "wake_at", "reminders_done", "mood")} for r in rows], ensure_ascii=False
    )


TOOLS = [create_reminder, set_privacy_rule, send_message_to_family, recall_recent_days]

SYSTEM = """You are Ally, a warm companion for {name}, an older parent in India. You are the only
voice she hears from Ally. You are not a monitor, a nurse or a doctor.

How you speak:
- {lang_rule}
- At most two short sentences. Kind, unhurried, never alarming, never clinical.
- Never mention sensors, watches, data, scores, dashboards, or that anyone is watching her.
- Never give medical diagnoses or change medicines. If she describes feeling unwell, be gentle and
  say you'll let her family know.

What you can do (tools):
- create_reminder when she asks to be reminded of something.
- set_privacy_rule when she wants something kept from a family member.
- send_message_to_family when she asks you to tell someone something.
- recall_recent_days when she asks about recent days.

Family roster (use these ids): {roster}
Current local time: {now}
{mode_note}{pending_note}"""


def _lang_rule(language: str) -> str:
    if language == "hi-IN":
        return "Reply in simple, warm Hindi (Devanagari script) unless she speaks English; set language accordingly."
    return "Reply in simple Indian English unless she speaks Hindi; set language accordingly."


async def respond(
    parent_id: str,
    text: str,
    *,
    investigating: bool,
    source: str,
) -> tuple[CompanionReply, RunEffects, ConsentGuard]:
    repo = get_repo()
    profile = repo.get_profile(parent_id) or {}
    language = profile.get("language", "hi-IN")
    members = repo.list_members(parent_id)
    roster = ", ".join(f"{m['id']} ({m['name']}, {m.get('relation', '')})" for m in members if m.get("role") == "child")
    pending = consent.pending_rule(parent_id)
    mode_note = (
        "Right now you are checking in because she isn't up at her usual time. Ask gently if she is alright.\n"
        if investigating
        else ""
    )
    pending_note = (
        f"A privacy rule is waiting for her yes/no: \"{pending['description']}\". If her words answer it, set confirms_pending_rule.\n"
        if pending
        else ""
    )
    system = SYSTEM.format(
        name=f"{profile.get('name', 'Amma')} ({profile['name_hi']} in Hindi)" if profile.get("name_hi") else profile.get("name", "Amma"),
        lang_rule=_lang_rule(language),
        roster=roster or "none",
        now=clock.now().strftime("%A %H:%M"),
        mode_note=mode_note,
        pending_note=pending_note,
    )
    history = repo.recent_turns(parent_id, limit=8)
    convo = "\n".join(f"{'Her' if t['speaker'] == 'parent' else 'Ally'}: {t['text']}" for t in history)
    prompt = f"Recent conversation:\n{convo or '(none)'}\n\nShe says now: {text or '(she opened Ally without speaking)'}"

    effects = RunEffects()
    guard = ConsentGuard(parent_id, requested_by="Ally::companion", context={"tier": 1})
    reply = await structured(
        "companion",
        system,
        prompt,
        CompanionReply,
        tools=TOOLS,
        hooks=[guard],
        invocation_state={
            "principal": ("Parent", parent_id),
            "parent_id": parent_id,
            "language": language,
            "effects": effects,
            "source": source,
        },
        max_turns=4,
        temperature=0.4,
    )
    return reply, effects, guard
