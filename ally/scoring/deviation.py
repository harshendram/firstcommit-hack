"""Cheap deterministic gate. It decides whether the LLM judge is worth calling — never escalates on its own."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from core import clock

# English + romanised Hindi (word boundaries work for Latin script).
CONCERNING = re.compile(
    r"\b("
    r"can'?t get up|don'?t feel like getting up|(i )?feel(ing)? (a bit |very |so )?weak|weakness|"
    r"dizzy|dizziness|chest pain|can'?t breathe|short of breath|help me|"
    r"fell (down|over|off)|i'?ve fallen|have fallen|hurt myself|"
    r"i'?m not okay|not feeling well|unwell|too tired to|"
    r"chakkar|kamzori|kamjori|dard|gir (gayi|gaya|padi|pada)|saans|tabiyat (theek|thik) nahi|bimaar"
    r")\b",
    re.I,
)
# Devanagari: \b is unreliable around vowel signs (matras), so match substrings.
CONCERNING_DEVANAGARI = re.compile(
    r"(चक्कर|कमज़ोरी|कमजोरी|दर्द|गिर गई|गिर गया|गिर पड़ी|साँस|सांस|तबीयत ठीक नहीं|बीमार|मदद करो)"
)


@dataclass
class GateResult:
    tripped: bool
    score: float
    reasons: list[dict[str, Any]] = field(default_factory=list)

    def codes(self) -> list[str]:
        return [r["code"] for r in self.reasons]


def wake_window_end(baseline: dict[str, Any], day: str) -> datetime:
    return clock.at_local(day, baseline["wake_window"][1])


def utterance_gate(text: str) -> GateResult:
    text = text or ""
    hits = sorted(
        {m.group(0).lower() for m in CONCERNING.finditer(text)} | {m.group(0) for m in CONCERNING_DEVANAGARI.finditer(text)}
    )
    if not hits:
        return GateResult(False, 0.0)
    return GateResult(True, 0.72, [{"code": "concerning_words", "level": "strong", "detail": hits}])


def no_wake_gate(baseline: dict[str, Any], day: str, now: datetime, grace_min: int, woke: bool) -> GateResult:
    if woke:
        return GateResult(False, 0.0)
    end = wake_window_end(baseline, day)
    minutes_late = (now - end).total_seconds() / 60
    if minutes_late < grace_min:
        return GateResult(False, 0.0)
    return GateResult(
        True,
        0.35,
        [
            {
                "code": "no_movement_past_wake_window",
                "level": "moderate",
                "detail": {"usual_window": baseline["wake_window"], "minutes_past": round(minutes_late)},
            }
        ],
    )


def vocal_gate(text: str, duration_sec: float | None, baseline: dict[str, Any]) -> GateResult:
    """Slower speech than her baseline is a weak signal; only meaningful with a real clip duration."""
    if not text or not duration_sec or duration_sec < 2:
        return GateResult(False, 0.0)
    wpm = len(text.split()) / (duration_sec / 60)
    usual = float((baseline.get("vocal_baseline") or {}).get("avg_words_per_min") or 110)
    if wpm >= usual * 0.6:
        return GateResult(False, 0.0)
    return GateResult(
        True, 0.28, [{"code": "slower_speech", "level": "moderate", "detail": {"wpm": round(wpm), "usual": usual}}]
    )


def combine(*gates: GateResult) -> GateResult:
    reasons = [r for g in gates for r in g.reasons]
    score = min(1.0, sum(g.score for g in gates))
    return GateResult(any(g.tripped for g in gates), round(score, 2), reasons)
