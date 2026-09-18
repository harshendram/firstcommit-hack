"""Morning check-in on the first wake of the day: at most three sentences, only real facts."""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any

from agents.schemas import MorningCheckin
from core import clock
from llm.bedrock import structured
from proactive import channel
from store.repo import get_repo

SYSTEM = """You are Ally, a warm companion for an older parent in India. Write her morning check-in.
Rules:
- At most three short sentences. Warm, calm, never clinical.
- Mention only the facts supplied (yesterday, today's reminders, notes from family). If there is
  little to say, just greet her kindly.
- Never mention monitoring, watches, sensors, data, dashboards or that anyone is watching.
- Write in her language: hi-IN means simple Hindi in Devanagari; en-IN means simple Indian English."""

_SENTENCE = re.compile(r"(?<=[.!?।])\s+")


def limit_sentences(text: str, n: int = 3) -> str:
    parts = [p.strip() for p in _SENTENCE.split(text.strip()) if p.strip()]
    return " ".join(parts[:n])


async def run(parent_id: str, wake: datetime) -> dict[str, Any] | None:
    repo = get_repo()
    today = clock.local_date(wake)
    # Called once per day by the first-wake handler; channel.post dedupes on related_id as well.
    profile = repo.get_profile(parent_id) or {}
    language = profile.get("language", "hi-IN")
    yesterday = repo.get_day(parent_id, clock.days_ago(1, wake))
    reminders = [
        r["text"]
        for r in repo.list_reminders(parent_id)
        if r.get("kind") == "after_wake" or (r.get("due_at") or "").startswith(today[:10]) or r.get("recurrence") == "daily"
    ]
    since = clock.iso(clock.at_local(clock.days_ago(1, wake), "00:00"))
    notes = [
        {"from": m.get("data", {}).get("from_name"), "note": m["body"]}
        for m in repo.messages_since(parent_id, since, kind="family_note")
    ]
    facts = {
        "name": profile.get("name_hi") if language == "hi-IN" and profile.get("name_hi") else profile.get("name", "Amma"),
        "language": language,
        "yesterday": {k: yesterday.get(k) for k in ("wake_at", "mood", "reminders_done") if yesterday.get(k)},
        "reminders_today": reminders[:4],
        "notes_from_family": notes[:3],
    }
    result = await structured(
        "morning_checkin",
        SYSTEM,
        json.dumps(facts, ensure_ascii=False),
        MorningCheckin,
        max_turns=2,
        temperature=0.4,
    )
    text = limit_sentences(result.text)
    return await channel.post(
        parent_id,
        audience="parent",
        kind="morning",
        body=text,
        related_id=f"morning#{today}",
        data={"language": result.language},
    )
