from agents.family_qa import NOT_SURE, verify
from agents.schemas import DeviationJudgment, EvidenceAnswer
from core import clock
from policy.tiers import decide
from scoring import deviation


def test_utterance_gate_english_hindi_and_false_positives():
    assert deviation.utterance_gate("I feel a bit weak today").tripped
    assert deviation.utterance_gate("mujhe chakkar aa raha hai").tripped
    assert deviation.utterance_gate("मुझे चक्कर आ रहा है").tripped
    assert deviation.utterance_gate("थोड़ी कमजोरी लग रही है").tripped
    assert deviation.utterance_gate("I fell down in the bathroom").tripped
    assert not deviation.utterance_gate("I fell asleep watching TV").tripped
    assert not deviation.utterance_gate("Good morning Ally, chai ho gayi").tripped


def test_no_wake_gate_uses_baseline_and_grace():
    baseline = {"wake_window": ["06:30", "07:45"]}
    day = "2026-09-18"
    assert not deviation.no_wake_gate(baseline, day, clock.at_local(day, "07:50"), 15, woke=False).tripped
    tripped = deviation.no_wake_gate(baseline, day, clock.at_local(day, "08:05"), 15, woke=False)
    assert tripped.tripped and tripped.reasons[0]["detail"]["minutes_past"] == 20
    assert not deviation.no_wake_gate(baseline, day, clock.at_local(day, "09:00"), 15, woke=True).tripped


def judgment(severity, confidence):
    return DeviationJudgment(
        concerning=severity != "none", severity=severity, confidence=confidence, reasons=[], suggested_next="ask_parent"
    )


def test_tier_policy():
    assert not decide(judgment("low", 0.9), parent_name="Amma").escalate
    assert not decide(judgment("medium", 0.4), parent_name="Amma").escalate
    assert decide(judgment("medium", 0.7), parent_name="Amma").escalate
    unwell = decide(judgment("low", 0.3), parent_name="Amma", parent_reports_unwell=True)
    assert unwell.escalate and unwell.severity == "medium"
    silent = decide(None, parent_name="Amma", no_response=True)
    assert silent.escalate and silent.severity == "high"


def test_evidence_verifier():
    good = EvidenceAnswer(status="answered", answer="She woke at 6:50.", evidence_ids=["day:2026-09-18"])
    assert verify(good, {"day:2026-09-18"}, denied=False, name="Amma") == good

    invented = EvidenceAnswer(status="answered", answer="She took her tablet.", evidence_ids=["tablet:1"])
    assert verify(invented, {"day:2026-09-18"}, denied=False, name="Amma").answer == NOT_SURE

    uncited = EvidenceAnswer(status="answered", answer="She is fine.", evidence_ids=[])
    assert verify(uncited, set(), denied=False, name="Amma").status == "not_sure"

    private = EvidenceAnswer(status="answered", answer="Her health is good.", evidence_ids=[])
    assert verify(private, set(), denied=True, name="Amma").status == "not_permitted"
