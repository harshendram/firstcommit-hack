import json
import time

import pytest

from core.errors import Conflict, Forbidden
from escalation import service, steps, tokens
from policy import consent


def _alert(repo):
    alert = {"id": "al1", "created_at": "2026-09-18T03:30:00Z", "kind": "no_wake", "status": "investigating",
             "judgment": {"severity": "high", "reasons": ["No movement 40 minutes past her usual wake time"]}}
    repo.put_alert("amma", alert)
    return alert


async def _start(repo, sfn):
    esc = await service.start("amma", _alert(repo), "high")
    return esc["id"]


async def test_start_takes_lock_and_starts_workflow(seeded, repo, sfn, pushes):
    esc_id = await _start(repo, sfn)
    assert sfn.started[0]["name"] == esc_id
    assert repo.active_escalation_id("amma") == esc_id
    again = await service.start("amma", _alert(repo), "high")
    assert again["id"] == esc_id and len(sfn.started) == 1  # one open escalation per parent


async def test_ask_contact_then_accept_via_push_token(seeded, repo, sfn, pushes):
    esc_id = await _start(repo, sfn)
    state = await steps.init({"parent_id": "amma", "esc_id": esc_id})
    assert state["contacts"] == ["rahul", "priya"]
    await steps.ask_contact({**state, "token": "tok-rahul"})
    ask = pushes[-1]
    assert ask["audience"] == "rahul" and ask["type"] == "escalation_ask" and ask["reply_token"]

    claims = tokens.verify(ask["reply_token"])
    await service.reply("amma", esc_id, responder=claims["contact"], decision="accept", token_version=claims["token_version"])
    assert sfn.success == [("tok-rahul", json.dumps({"decision": "accept"}))]

    with pytest.raises(Conflict):  # double tap is single-use
        await service.reply("amma", esc_id, responder="rahul", decision="accept", token_version=claims["token_version"])

    await steps.accepted({**state, "index": 0})
    esc = repo.get_escalation("amma", esc_id)
    assert esc["status"] == "accepted" and esc["responder"] == "rahul"
    assert any(p["audience"] == "parent" and p["type"] == "escalation_update" for p in pushes)

    with pytest.raises(Forbidden):
        await service.reply("amma", esc_id, responder="priya", decision="arrived")
    await service.reply("amma", esc_id, responder="rahul", decision="arrived")
    assert repo.get_escalation("amma", esc_id)["status"] == "resolved"
    assert repo.active_escalation_id("amma") is None


async def test_decline_moves_to_next_and_wrong_person_cannot_answer(seeded, repo, sfn, pushes):
    esc_id = await _start(repo, sfn)
    state = await steps.init({"parent_id": "amma", "esc_id": esc_id})
    await steps.ask_contact({**state, "token": "tok-rahul"})
    with pytest.raises(Conflict):
        await service.reply("amma", esc_id, responder="priya", decision="accept")
    await service.reply("amma", esc_id, responder="rahul", decision="decline")
    nxt = await steps.next_contact({**state, "reply": {"decision": "decline"}})
    assert nxt["index"] == 1
    await steps.ask_contact({**state, "index": 1, "token": "tok-priya"})
    assert pushes[-1]["audience"] == "priya"


async def test_late_reply_after_timeout_is_conflict(seeded, repo, sfn, pushes):
    esc_id = await _start(repo, sfn)
    state = await steps.init({"parent_id": "amma", "esc_id": esc_id})
    await steps.ask_contact({**state, "token": "tok-rahul"})
    sfn.timed_out_tokens.add("tok-rahul")
    with pytest.raises(Conflict):
        await service.reply("amma", esc_id, responder="rahul", decision="accept")


async def test_neighbour_is_cedar_gated(seeded, repo, sfn, pushes):
    esc_id = await _start(repo, sfn)
    base = {"parent_id": "amma", "esc_id": esc_id}
    await steps.ask_parent_neighbour({**base, "token": "tok-parent"})
    assert pushes[-1]["audience"] == "parent" and pushes[-1]["type"] == "neighbour_question"

    # high severity + timeout: not allowed without Amma's yes
    assert (await steps.contact_neighbour({**base, "reply": {"decision": "timeout"}}))["contacted"] is False
    # Amma says yes
    await steps.ask_parent_neighbour({**base, "token": "tok-parent-2"})
    await service.reply("amma", esc_id, responder="parent", decision="confirm")
    assert (await steps.contact_neighbour({**base, "reply": {"decision": "confirm"}}))["contacted"] is True
    assert pushes[-1]["audience"] == "sunita"
    decisions = [r for r in repo.list_audit("amma") if r["action"] == "contact_neighbour"]
    assert sorted(r["decision"] for r in decisions) == ["allow", "deny"]


async def test_notify_all_finish_and_failsafe_release_lock(seeded, repo, sfn, pushes):
    esc_id = await _start(repo, sfn)
    base = {"parent_id": "amma", "esc_id": esc_id}
    out = await steps.notify_all(base)
    assert out["notified"] == 2
    assert {p["audience"] for p in pushes if p["type"] == "escalation_update"} == {"rahul", "priya"}
    await steps.finish(base)
    assert repo.active_escalation_id("amma") is None

    esc2 = await service.start("amma", _alert(repo), "critical")
    await steps.failsafe({"parent_id": "amma", "esc_id": esc2["id"]})
    assert repo.get_escalation("amma", esc2["id"])["status"] == "failed"
    assert repo.active_escalation_id("amma") is None


async def test_stop_tells_contacted_members(seeded, repo, sfn, pushes):
    esc_id = await _start(repo, sfn)
    state = await steps.init({"parent_id": "amma", "esc_id": esc_id})
    await steps.ask_contact({**state, "token": "tok-rahul"})
    stopped = await service.stop("amma", "parent_okay:watch")
    assert stopped["status"] == "stopped" and sfn.stopped
    assert pushes[-1]["audience"] == "rahul" and pushes[-1]["type"] == "all_clear"
    assert repo.active_escalation_id("amma") is None


async def test_missing_workflow_still_notifies_family(seeded, repo, pushes, monkeypatch):
    from core.errors import NotConfigured

    monkeypatch.setattr(service, "STATE_MACHINE_ARN", "")
    with pytest.raises(NotConfigured):
        await service.start("amma", _alert(repo), "high")
    assert {p["audience"] for p in pushes} == {"rahul", "priya"}
    assert repo.active_escalation_id("amma") is None


def test_reply_token_tamper_and_expiry():
    token = tokens.sign("amma", "e1", "rahul", 1)
    assert tokens.verify(token)["contact"] == "rahul"
    raw, mac = token.split(".")
    with pytest.raises(Forbidden):
        tokens.verify(raw[:-2] + "xx." + mac)
    expired = tokens.sign("amma", "e1", "rahul", 1, ttl_s=-5)
    with pytest.raises(Forbidden):
        tokens.verify(expired)


async def test_denied_contact_resumes_workflow(seeded, repo, sfn, pushes, monkeypatch):
    esc_id = await _start(repo, sfn)
    state = await steps.init({"parent_id": "amma", "esc_id": esc_id})
    real = consent.authorize

    def deny_rahul(parent_id, **kw):
        if kw["principal"] == ("Family", "rahul"):
            kw["topic"] = "conversation"  # force a deny through the real engine
        return real(parent_id, **kw)

    monkeypatch.setattr(steps, "authorize", deny_rahul)
    out = await steps.ask_contact({**state, "token": "tok-rahul"})
    assert out["asked"] is False
    assert sfn.success[-1] == ("tok-rahul", json.dumps({"decision": "not_permitted"}))
    assert not any(p["type"] == "escalation_ask" for p in pushes)


async def test_stale_asks_are_retired_after_all_clear(seeded, repo, sfn, pushes):
    esc_id = await _start(repo, sfn)
    state = await steps.init({"parent_id": "amma", "esc_id": esc_id})
    await steps.ask_contact({**state, "token": "tok-rahul"})
    await service.stop("amma", "parent_okay:watch")
    asks = [m for m in repo._query_prefix("amma", "MSG#") if m["kind"] == "escalation_ask"]
    assert [m["status"] for m in asks] == ["superseded"]
    assert [m["kind"] for m in repo.claim_pending_messages("amma", "rahul")] == ["all_clear"]
