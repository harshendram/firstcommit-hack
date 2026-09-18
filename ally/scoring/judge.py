"""LLM deviation judge — runs only behind the deterministic gate."""

from __future__ import annotations

import json
from typing import Any

from agents.schemas import DeviationJudgment
from llm.bedrock import structured
from scoring.deviation import GateResult

JUDGE_SYSTEM = """You judge whether an older parent's family should be involved today.
You see a deterministic signal summary, her usual routine, and possibly her own words.

Conservative policy:
- Ambiguous or mild signals mean suggested_next = ask_parent (Ally asks her first). Do not escalate.
- She says she is fine and nothing contradicts it: concerning=false, severity none/low.
- Falls, chest pain, breathing trouble, confusion, inability to get up, or no response after Ally
  asked her: suggested_next = notify_child or escalate, severity high or critical.
- The watch detecting a possible fall and no answer afterwards is critical: she may be unable to
  reach the tablet. Never downgrade that because the signal might be a false alarm.
- Being late or tired alone is at most low/medium.
- Never invent symptoms or facts that are not in the input. Reasons are short and factual.
- confidence reflects how clearly the evidence supports your severity."""


async def judge(
    *,
    parent_name: str,
    baseline: dict[str, Any],
    gate: GateResult,
    utterance: str = "",
    no_response: bool = False,
    after_fall: bool = False,
    recent_days: list[dict[str, Any]] | None = None,
) -> DeviationJudgment:
    facts = {
        "parent": parent_name,
        "usual_wake_window": baseline.get("wake_window"),
        "signals": gate.reasons,
        "her_words_today": utterance or None,
        "did_not_respond_after_ally_asked": no_response,
        "watch_detected_possible_fall": after_fall,
        "recent_days": [
            {k: d.get(k) for k in ("date", "wake_at", "mood", "unwell_reported")} for d in (recent_days or [])[-5:]
        ],
    }
    return await structured(
        "deviation_judge",
        JUDGE_SYSTEM,
        json.dumps(facts, ensure_ascii=False, default=str),
        DeviationJudgment,
        temperature=0.0,
        max_turns=2,
    )
