from datetime import timedelta

import pytest

from agents import companion, orchestrator
from agents.schemas import CompanionReply, DeviationJudgment, MorningCheckin
from core import clock
from proactive import morning, reminders
from scoring import judge


@pytest.fixture
def llm(monkeypatch):
    """Fake the three model entry points; record what they were asked."""
    calls = {"companion": [], "judge": [], "morning": 0}
    replies: list[CompanionReply] = []
    judgments: list[DeviationJudgment] = []

    async def fake_respond(parent_id, text, *, investigating, source):
        calls["companion"].append({"text": text, "investigating": investigating})
        reply = replies.pop(0) if replies else CompanionReply(say="ठीक है।", language="hi-IN")
        return reply, companion.RunEffects(), type("G", (), {"denied_tools": []})()

    async def fake_judge(**kwargs):
        calls["judge"].append(kwargs)
        return judgments.pop(0)

    async def fake_structured(task, system, prompt, output, **kw):
        calls["morning"] += 1
        return MorningCheckin(text="सुप्रभात अम्मा। आज धूप अच्छी है। चाय पी लीजिए। यह चौथा वाक्य है।", language="hi-IN")

    monkeypatch.setattr(companion, "respond", fake_respond)
    monkeypatch.setattr(judge, "judge", fake_judge)
    monkeypatch.setattr(morning, "structured", fake_structured)
    return {"calls": calls, "replies": replies, "judgments": judgments}


def j(severity, confidence=0.8):
    return DeviationJudgment(concerning=True, severity=severity, confidence=confidence, reasons=["r"], suggested_next="notify_child")


async def test_first_wake_morning_checkin_once_and_after_wake_reminder(seeded, repo, pushes, llm):
    reminders.create("amma", reminders.ReminderSpec(text="BP tablet", kind="after_wake", offset_minutes=30), created_by="t")
    first = await orchestrator.on_watch("amma", "wake", steps=120, heart_rate=72)
    assert first["first_wake"] and first["after_wake_reminders"] == 1 and first["morning_message_id"]
    second = await orchestrator.on_watch("amma", "wake")
    assert second["first_wake"] is False
    assert llm["calls"]["morning"] == 1
    morning_push = next(p for p in pushes if p["type"] == "morning")
    assert morning_push["body"].count("।") == 3  # capped at three sentences
    clock.set_now(clock.now() + timedelta(minutes=31))
    out = await orchestrator.sweep()
    assert out["reminders"] == 1


async def test_no_wake_opens_one_investigation_then_timeout_escalates(seeded, repo, pushes, llm, sfn):
    clock.set_now(clock.at_local("2026-09-18", "08:05"))
    assert (await orchestrator.sweep())["wake_checks"] == 1
    assert (await orchestrator.sweep())["wake_checks"] == 0  # once per day
    assert pushes[-1]["type"] == "investigation" and pushes[-1]["audience"] == "parent"
    assert repo.open_investigation("amma")

    llm["judgments"].append(j("high"))
    clock.set_now(clock.now() + timedelta(minutes=16))
    out = await orchestrator.sweep()
    assert out["investigations"] == 1
    assert llm["calls"]["judge"][0]["no_response"] is True
    assert sfn.started and repo.active_escalation_id("amma")
    snap = orchestrator.snapshot("amma", viewer="rahul")
    assert snap["tier"] == 2 and snap["transcript"] == []


async def test_parent_says_okay_during_investigation_closes_it(seeded, repo, pushes, llm):
    clock.set_now(clock.at_local("2026-09-18", "08:05"))
    await orchestrator.sweep()
    llm["replies"].append(CompanionReply(say="अच्छा लगा सुनकर।", language="hi-IN", parent_says_okay=True))
    result = await orchestrator.on_parent_turn("amma", "मैं ठीक हूँ, बस देर से उठी", source="voice")
    assert result.get("resolved") and llm["calls"]["companion"][0]["investigating"] is True
    assert repo.open_investigation("amma") is None
    assert llm["calls"]["judge"] == []


async def test_parent_unwell_words_judge_and_escalate(seeded, repo, pushes, llm, sfn):
    llm["replies"].append(CompanionReply(say="मैं आपके परिवार को बता रही हूँ।", language="hi-IN", parent_reports_unwell=True))
    llm["judgments"].append(j("medium", 0.5))
    result = await orchestrator.on_parent_turn("amma", "मुझे चक्कर आ रहा है", source="voice")
    assert result["escalated"] is True
    assert llm["calls"]["judge"][0]["utterance"] == "मुझे चक्कर आ रहा है"
    day = repo.get_day("amma", clock.local_date())
    assert day["unwell_reported"] is True and day["checkin_at"]


async def test_ordinary_chat_does_not_call_judge(seeded, repo, pushes, llm):
    result = await orchestrator.on_parent_turn("amma", "आज चाय बहुत अच्छी बनी", source="text")
    assert result["escalated"] is False and llm["calls"]["judge"] == []
    turns = repo.recent_turns("amma")
    assert [t["speaker"] for t in turns] == ["parent", "ally"]


async def test_watch_im_okay_stops_escalation(seeded, repo, pushes, llm, sfn):
    llm["replies"].append(CompanionReply(say="…", language="hi-IN", parent_reports_unwell=True))
    llm["judgments"].append(j("high"))
    await orchestrator.on_parent_turn("amma", "I fell down", source="text")
    assert repo.active_escalation_id("amma")
    out = await orchestrator.on_watch("amma", "im_okay")
    assert out["escalation_stopped"] is True
    assert repo.active_escalation_id("amma") is None


async def test_family_snapshot_hides_transcript_parent_sees_it(seeded, repo, pushes, llm):
    await orchestrator.on_parent_turn("amma", "नमस्ते", source="text")
    assert orchestrator.snapshot("amma", viewer="rahul")["transcript"] == []
    assert len(orchestrator.snapshot("amma", viewer="parent")["transcript"]) == 2
