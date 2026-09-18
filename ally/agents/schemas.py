"""Typed model outputs. Each class name is also the Strands structured-output tool name."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Language = Literal["hi-IN", "en-IN"]
Severity = Literal["none", "low", "medium", "high", "critical"]
Topic = Literal["routine", "mood", "health", "location"]


class CompanionReply(BaseModel):
    """What Ally says back to the parent, plus what it understood."""

    say: str = Field(description="What Ally says aloud. Warm, at most two short sentences.")
    language: Language = Field(description="Language of `say`; match the parent's language.")
    mood: Literal["calm", "low", "distressed", "unknown"] = "unknown"
    parent_reports_unwell: bool = Field(
        default=False, description="True only if the parent says they feel unwell, hurt, dizzy, fell, or similar."
    )
    parent_says_okay: bool = Field(
        default=False, description="True if the parent clearly says they are fine / okay right now."
    )
    confirms_pending_rule: Literal["yes", "no", "none"] = Field(
        default="none",
        description="If a privacy rule is waiting for confirmation: yes/no from the parent's words, else none.",
    )


class DeviationJudgment(BaseModel):
    """Conservative judgement of whether today's signals mean the family should be involved."""

    concerning: bool
    severity: Severity
    confidence: float = Field(ge=0, le=1)
    reasons: list[str] = Field(default_factory=list, max_length=3, description="Short factual reasons.")
    suggested_next: Literal["ask_parent", "notify_child", "escalate"]


class MorningCheckin(BaseModel):
    """A gentle morning greeting grounded only in supplied facts."""

    text: str = Field(description="At most three short sentences.")
    language: Language


class EvidenceAnswer(BaseModel):
    """Answer to a family member, grounded only in records returned by tools this turn."""

    status: Literal["answered", "not_sure", "not_permitted"]
    answer: str
    evidence_ids: list[str] = Field(default_factory=list, description="Ids of the records that support the answer.")


class HealthProbe(BaseModel):
    ok: bool
    word: str


SCHEMA_NAMES = frozenset(
    cls.__name__ for cls in (CompanionReply, DeviationJudgment, MorningCheckin, EvidenceAnswer, HealthProbe)
)
