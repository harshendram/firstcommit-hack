"""Autonomy tiers, decided in code. The judge informs; policy decides."""

from __future__ import annotations

from dataclasses import dataclass

from agents.schemas import DeviationJudgment

SEVERITY_RANK = {"none": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}

TIER_LABEL = {1: "ask_parent_first", 2: "coordinate_family", 3: "needs_confirmation"}


@dataclass(frozen=True)
class TierDecision:
    tier: int
    escalate: bool
    severity: str
    narration: str


def decide(
    judgment: DeviationJudgment | None,
    *,
    parent_name: str,
    parent_reports_unwell: bool = False,
    no_response: bool = False,
    after_fall: bool = False,
) -> TierDecision:
    severity = judgment.severity if judgment else "none"
    confident = bool(judgment and SEVERITY_RANK[judgment.severity] >= SEVERITY_RANK["medium"] and judgment.confidence >= 0.6)
    if after_fall and parent_reports_unwell:
        severity = "critical"
    if no_response or parent_reports_unwell or confident:
        if parent_reports_unwell and SEVERITY_RANK[severity] < SEVERITY_RANK["medium"]:
            severity = "medium"
        if no_response and SEVERITY_RANK[severity] < SEVERITY_RANK["high"]:
            severity = "high"
        if after_fall and no_response:
            # She may be on the floor and unable to answer: treat silence as critical.
            severity = "critical"
        return TierDecision(2, True, severity, f"I'm asking {parent_name}'s family to check in.")
    return TierDecision(1, False, severity, f"I'm checking in with {parent_name} myself first.")


def calm_narration(parent_name: str) -> str:
    return "Most days, Ally says nothing at all."
