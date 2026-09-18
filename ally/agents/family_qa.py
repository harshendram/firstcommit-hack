"""Family asks, Ally answers only from records — or says it isn't sure / it's private.

The asking family member is the Cedar principal for every tool, so the parent's rules decide what
Ally may read on their behalf. A deterministic verifier rejects answers that cite records no tool
returned this turn.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from strands import ToolContext, tool

from agents.schemas import EvidenceAnswer
from core import clock
from llm.bedrock import structured
from policy.hook import ConsentGuard
from store.repo import get_repo


@dataclass
class Evidence:
    ids: set[str] = field(default_factory=set)


def _record(ctx: ToolContext, rows: list[dict[str, Any]]) -> str:
    ev: Evidence = ctx.invocation_state["evidence"]
    for row in rows:
        ev.ids.add(row["id"])
    return json.dumps(rows, ensure_ascii=False)


def _days(ctx: ToolContext, days: int) -> list[dict[str, Any]]:
    days = max(1, min(14, days))
    return get_repo().list_days(ctx.invocation_state["parent_id"], clock.days_ago(days - 1), clock.local_date())


@tool(context=True)
def read_day_log(tool_context: ToolContext, days: int = 3) -> str:
    """Her routine for recent days: wake time, check-in time, reminders done.

    Args:
        days: Number of recent days including today (1-14).
    """
    rows = [
        {"id": f"day:{d['date']}", "date": d["date"], **{k: d.get(k) for k in ("wake_at", "checkin_at", "reminders_done")}}
        for d in _days(tool_context, days)
    ]
    return _record(tool_context, rows)


@tool(context=True)
def read_mood_notes(tool_context: ToolContext, days: int = 3) -> str:
    """How she seemed in conversations with Ally on recent days (calm/low/distressed).

    Args:
        days: Number of recent days including today (1-14).
    """
    rows = [{"id": f"mood:{d['date']}", "date": d["date"], "mood": d.get("mood")} for d in _days(tool_context, days) if d.get("mood")]
    return _record(tool_context, rows)


@tool(context=True)
def read_health_notes(tool_context: ToolContext, days: int = 3) -> str:
    """Whether she said she felt unwell on recent days.

    Args:
        days: Number of recent days including today (1-14).
    """
    rows = [
        {"id": f"health:{d['date']}", "date": d["date"], "said_unwell": bool(d.get("unwell_reported"))}
        for d in _days(tool_context, days)
    ]
    return _record(tool_context, rows)


@tool(context=True)
def read_alerts(tool_context: ToolContext) -> str:
    """Recent times Ally checked on her or involved family, and how they ended."""
    alerts = get_repo().list_alerts(tool_context.invocation_state["parent_id"], limit=10)
    rows = [
        {
            "id": f"alert:{a['id']}",
            "at": a["created_at"],
            "kind": a.get("kind"),
            "status": a.get("status"),
            "severity": (a.get("judgment") or {}).get("severity"),
        }
        for a in alerts
    ]
    return _record(tool_context, rows)


@tool(context=True)
def read_conversation(tool_context: ToolContext) -> str:
    """Her conversations with Ally."""
    turns = get_repo().recent_turns(tool_context.invocation_state["parent_id"], limit=10)
    rows = [{"id": f"turn:{t['id']}", "speaker": t["speaker"], "text": t["text"]} for t in turns]
    return _record(tool_context, rows)


TOOLS = [read_day_log, read_mood_notes, read_health_notes, read_alerts, read_conversation]

SYSTEM = """You answer {asker}'s questions about their parent {name}, using only records returned by tools.

Rules:
- Call the tool(s) that could contain the answer before answering.
- Answer only from what the tools returned. Cite the ids of the records you used in evidence_ids.
- If the records don't answer the question, status = not_sure and say you don't have a record of that.
- If a tool says "Not permitted", status = not_permitted and say {name} keeps that private. Do not guess.
- One or two plain sentences. No speculation, no medical advice. Today is {today}."""

NOT_SURE = "I'm not sure — I don't have a record of that."


async def answer(parent_id: str, member: dict[str, Any], question: str) -> tuple[EvidenceAnswer, ConsentGuard]:
    profile = get_repo().get_profile(parent_id) or {}
    name = profile.get("name", "Amma")
    evidence = Evidence()
    principal_type = "Neighbour" if member.get("role") == "neighbour" else "Family"
    guard = ConsentGuard(parent_id, requested_by=f"{principal_type}::{member['id']}", context={"tier": 1})
    result = await structured(
        "family_qa",
        SYSTEM.format(asker=member["name"], name=name, today=clock.local_date()),
        question[:500],
        EvidenceAnswer,
        tools=TOOLS,
        hooks=[guard],
        invocation_state={"principal": (principal_type, member["id"]), "parent_id": parent_id, "evidence": evidence},
        max_turns=4,
        temperature=0.0,
    )
    return verify(result, evidence.ids, denied=bool(guard.denied_tools), name=name), guard


def verify(result: EvidenceAnswer, returned_ids: set[str], *, denied: bool, name: str) -> EvidenceAnswer:
    cited = [e for e in result.evidence_ids if e in returned_ids]
    if result.status == "answered" and cited and len(cited) == len(result.evidence_ids):
        return result
    if result.status == "not_permitted" or (denied and not cited):
        return EvidenceAnswer(status="not_permitted", answer=f"{name} keeps that private.", evidence_ids=[])
    return EvidenceAnswer(status="not_sure", answer=NOT_SURE, evidence_ids=[])
