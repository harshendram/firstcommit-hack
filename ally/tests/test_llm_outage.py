"""A Bedrock outage must degrade loudly, never silently drop a real concern."""

import pytest

from agents import companion, orchestrator
from agents.schemas import CompanionReply
from core import clock
from core.errors import LLMError
from scoring import judge


@pytest.fixture
def judge_down(monkeypatch):
    async def boom(**_kwargs):
        raise LLMError("Ally is having trouble thinking right now.", detail="bedrock down")

    monkeypatch.setattr(judge, "judge", boom)


async def test_no_response_escalates_even_without_the_judge(seeded, repo, pushes, sfn, judge_down):
    clock.set_now(clock.at_local("2026-09-18", "08:05"))
    await orchestrator.sweep()
    inv = repo.open_investigation("amma")
    assert inv

    clock.set_now(clock.at_local("2026-09-18", "08:25"))
    result = await orchestrator.investigation_timeout("amma", inv)
    assert result["escalated"] is True  # family is still contacted
    alert = repo.get_alert("amma", inv["alert_id"])
    assert alert.get("judgment") is None and alert["tier"] == 2


async def test_parent_says_unwell_escalates_even_without_the_judge(seeded, repo, pushes, sfn, judge_down, monkeypatch):
    async def fake_respond(parent_id, text, *, investigating, source):
        reply = CompanionReply(say="मैं परिवार को बता रही हूँ।", language="hi-IN", parent_reports_unwell=True)
        return reply, companion.RunEffects(), type("G", (), {"denied_tools": []})()

    monkeypatch.setattr(companion, "respond", fake_respond)
    result = await orchestrator.on_parent_turn("amma", "मुझे चक्कर आ रहा है", source="voice")
    assert result["escalated"] is True


async def test_companion_outage_surfaces_as_error(seeded, repo, monkeypatch):
    async def boom(*_args, **_kwargs):
        raise LLMError("Ally is having trouble thinking right now.", detail="bedrock down")

    monkeypatch.setattr(companion, "respond", boom)
    with pytest.raises(LLMError):  # the API turns this into a visible 503, never a fake reply
        await orchestrator.on_parent_turn("amma", "नमस्ते", source="text")
