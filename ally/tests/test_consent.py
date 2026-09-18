from types import SimpleNamespace

import pytest

from policy import consent
from policy.hook import ConsentGuard
from policy.templates import render_forbid


def decide(principal, action, topic, **ctx):
    return consent.authorize("amma", principal=principal, action=action, topic=topic, requested_by="test", context=ctx)


def test_base_policies(seeded):
    assert decide(("Family", "rahul"), "read_day_log", "health").allowed
    assert decide(("Family", "priya"), "notify_member", "safety").allowed
    assert not decide(("Family", "rahul"), "read_conversation", "conversation").allowed
    assert decide(("Parent", "amma"), "read_conversation", "conversation").allowed
    assert not decide(("Neighbour", "sunita"), "read_day_log", "routine").allowed


def test_neighbour_needs_consent_or_critical_timeout(seeded):
    assert not decide(("Neighbour", "sunita"), "contact_neighbour", "safety").allowed
    assert decide(("Neighbour", "sunita"), "contact_neighbour", "safety", parent_confirmed=True).allowed
    assert not decide(
        ("Neighbour", "sunita"), "contact_neighbour", "safety", escalation_timed_out=True, severity="high"
    ).allowed
    assert decide(
        ("Neighbour", "sunita"), "contact_neighbour", "safety", escalation_timed_out=True, severity="critical"
    ).allowed


def test_voice_rule_lifecycle_forbid_overrides_permit(seeded):
    rule = consent.propose_rule(
        "amma", audience="priya", topic="health", except_emergency=True, language="hi-IN", source="voice"
    )
    assert rule["status"] == "pending_confirm"
    assert decide(("Family", "priya"), "read_day_log", "health").allowed  # pending rules are not enforced
    consent.confirm_rule("amma", rule["id"], True)
    denied = decide(("Family", "priya"), "read_day_log", "health")
    assert not denied.allowed and denied.policy_ids == [f"consent-{rule['id']}"]
    assert decide(("Family", "rahul"), "read_day_log", "health").allowed  # only Priya
    assert decide(("Family", "priya"), "read_day_log", "health", severity="critical").allowed  # emergency
    assert decide(("Family", "priya"), "notify_member", "safety").allowed  # safety is never forbiddable
    assert consent.revoke_rule("amma", rule["id"])
    assert decide(("Family", "priya"), "read_day_log", "health").allowed


def test_declined_rule_is_not_enforced(seeded):
    rule = consent.propose_rule(
        "amma", audience="priya", topic="health", except_emergency=False, language="en-IN", source="voice"
    )
    consent.confirm_rule("amma", rule["id"], False)
    assert decide(("Family", "priya"), "read_day_log", "health").allowed


def test_safety_cannot_be_restricted_and_ids_are_sanitised():
    with pytest.raises(ValueError):
        render_forbid("r1", "priya", "safety", True)  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        render_forbid("r1", 'priya"); permit(principal, action, resource);//', "health", True)


def test_fail_closed_and_every_decision_audited(seeded, repo):
    assert not decide(("Family", "rahul"), "read_day_log", "not_a_topic").allowed
    decide(("Family", "rahul"), "read_day_log", "routine")
    rows = repo.list_audit("amma")
    assert {r["decision"] for r in rows} == {"allow", "deny"}
    assert len(rows) == 2


def test_audit_dedupe_and_silent_checks(seeded, repo):
    for _ in range(3):
        consent.authorize(
            "amma",
            principal=("Family", "rahul"),
            action="view_dashboard",
            topic="routine",
            requested_by="t",
            audit_dedupe_key="dash#rahul#h",
        )
    consent.authorize(
        "amma", principal=("Family", "rahul"), action="read_day_log", topic="mood", requested_by="t", audit=False
    )
    assert len(repo.list_audit("amma")) == 1


def _event(name, tool_input, principal):
    return SimpleNamespace(
        tool_use={"name": name, "toolUseId": f"tu-{name}", "input": tool_input},
        invocation_state={"principal": principal},
        cancel_tool=False,
    )


def test_hook_denies_blocked_tool_and_passes_structured_output(seeded, repo):
    guard = ConsentGuard("amma", requested_by="Family::rahul")
    blocked = _event("read_conversation", {}, ("Family", "rahul"))
    guard.before_tool(blocked)
    assert isinstance(blocked.cancel_tool, str) and blocked.cancel_tool.startswith("Not permitted")

    ok = _event("read_day_log", {"days": 2}, ("Family", "rahul"))
    guard.before_tool(ok)
    assert ok.cancel_tool is False

    schema = _event("EvidenceAnswer", {"status": "answered"}, ("Family", "rahul"))
    guard.before_tool(schema)
    assert schema.cancel_tool is False

    unknown = _event("delete_everything", {}, ("Family", "rahul"))
    guard.before_tool(unknown)
    assert unknown.cancel_tool

    assert guard.denied_tools == ["read_conversation", "delete_everything"]
    assert len(repo.list_audit("amma")) == 2  # the output tool and unknown tools create no consent rows

    guard.after_tool(SimpleNamespace(tool_use=ok.tool_use, cancel_message=None, exception=None))
    guard.after_tool(SimpleNamespace(tool_use=blocked.tool_use, cancel_message="Not permitted", exception=None))
    rows = repo.list_audit("amma")
    assert len(rows) == 2  # annotated in place, never duplicated
    assert [r.get("outcome") for r in rows if r["action"] == "read_day_log"] == ["done"]


def test_hook_recipient_principal_for_relay(seeded):
    rule = consent.propose_rule(
        "amma", audience="priya", topic="health", except_emergency=True, language="en-IN", source="voice"
    )
    consent.confirm_rule("amma", rule["id"], True)
    guard = ConsentGuard("amma", requested_by="Ally::companion")
    to_priya = _event("send_message_to_family", {"member_id": "priya", "topic": "health", "message": "BP"}, ("Parent", "amma"))
    guard.before_tool(to_priya)
    assert to_priya.cancel_tool
    to_rahul = _event("send_message_to_family", {"member_id": "rahul", "topic": "health", "message": "BP"}, ("Parent", "amma"))
    guard.before_tool(to_rahul)
    assert to_rahul.cancel_tool is False
