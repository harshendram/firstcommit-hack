"""Falls from the Wear OS detector: ask her first, then escalate fast if she cannot answer."""

from datetime import timedelta

import pytest

from agents import companion, orchestrator
from agents.schemas import CompanionReply, DeviationJudgment
from core import clock
from policy import consent
from policy.tiers import decide
from scoring import judge


@pytest.fixture
def judged(monkeypatch):
    seen: list[dict] = []

    async def fake_judge(**kwargs):
        seen.append(kwargs)
        return DeviationJudgment(
            concerning=True, severity="high", confidence=0.7, reasons=["no answer after a possible fall"], suggested_next="escalate"
        )

    monkeypatch.setattr(judge, "judge", fake_judge)
    return seen


async def test_fall_asks_her_first_and_does_not_escalate_yet(seeded, repo, pushes, sfn):
    out = await orchestrator.on_watch("amma", "fall")
    assert out["fall"] and out["asked_parent"]

    msg = pushes[-1]
    assert msg["audience"] == "parent" and msg["type"] == "investigation"
    assert "गिर" in msg["body"]  # asked in her language
    assert not sfn.started  # family is not contacted yet

    inv = repo.open_investigation("amma")
    assert inv["reason"] == "fall"
    # minutes, not the quarter hour a late wake-up gets
    assert clock.parse_iso(inv["due_at"]) - clock.now() <= timedelta(minutes=2)
    assert repo.list_alerts("amma")[0]["kind"] == "fall"


async def test_duplicate_fall_signals_ask_once(seeded, repo, pushes, sfn):
    await orchestrator.on_watch("amma", "fall")
    second = await orchestrator.on_watch("amma", "fall")
    assert second["skipped"] == "duplicate"
    assert len([p for p in pushes if p["type"] == "investigation"]) == 1


async def test_no_answer_after_a_fall_escalates_as_critical(seeded, repo, pushes, sfn, judged):
    await orchestrator.on_watch("amma", "fall")
    inv = repo.open_investigation("amma")
    clock.set_now(clock.now() + timedelta(minutes=3))

    result = await orchestrator.investigation_timeout("amma", inv)
    assert result["escalated"] is True
    assert judged[0]["after_fall"] is True
    esc = repo.list_escalations("amma")[0]
    assert esc["severity"] == "critical"  # the judge said high; policy floors a silent fall at critical


async def test_critical_fall_lets_ally_ask_the_neighbour_after_the_children_time_out(seeded, repo):
    """The base Cedar policy already allows this; a fall is what produces the critical severity."""
    allowed = consent.authorize(
        "amma",
        principal=("Neighbour", "sunita"),
        action="contact_neighbour",
        topic="safety",
        requested_by="Ally::coordinator",
        context={"severity": "critical", "escalation_timed_out": True},
    )
    assert allowed.allowed


async def test_she_says_she_is_fine_so_nobody_is_called(seeded, repo, pushes, sfn, monkeypatch):
    async def fake_respond(parent_id, text, *, investigating, source):
        reply = CompanionReply(say="अच्छा हुआ।", language="hi-IN", parent_says_okay=True)
        return reply, companion.RunEffects(), type("G", (), {"denied_tools": []})()

    monkeypatch.setattr(companion, "respond", fake_respond)
    await orchestrator.on_watch("amma", "fall")
    result = await orchestrator.on_parent_turn("amma", "मैं ठीक हूँ, बस थोड़ा फिसल गई", source="voice")

    assert result.get("resolved") and not sfn.started
    assert repo.open_investigation("amma") is None
    assert repo.list_alerts("amma")[0]["status"] == "resolved"


async def test_watch_im_okay_button_also_clears_a_fall(seeded, repo, pushes, sfn):
    await orchestrator.on_watch("amma", "fall")
    out = await orchestrator.on_watch("amma", "im_okay")
    assert out["investigation_closed"] is True
    assert repo.open_investigation("amma") is None


def test_tier_policy_for_falls():
    quiet = decide(None, parent_name="Amma", no_response=True, after_fall=True)
    assert quiet.escalate and quiet.severity == "critical"
    hurt = decide(
        DeviationJudgment(concerning=True, severity="low", confidence=0.3, reasons=[], suggested_next="ask_parent"),
        parent_name="Amma",
        parent_reports_unwell=True,
        after_fall=True,
    )
    assert hurt.escalate and hurt.severity == "critical"
