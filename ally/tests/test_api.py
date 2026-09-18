"""HTTP-level checks through FastAPI: identity, role checks, device key, reply tokens, serialization."""

import importlib

import pytest
from fastapi.testclient import TestClient

from agents import companion
from agents.schemas import CompanionReply


@pytest.fixture
def client(monkeypatch, seeded, pushes):
    monkeypatch.setenv("ALLY_DEV_TOOLS", "1")
    import config

    importlib.reload(config)
    import auth

    importlib.reload(auth)
    import app as app_module

    importlib.reload(app_module)

    async def fake_respond(parent_id, text, *, investigating, source):
        return CompanionReply(say="नमस्ते अम्मा।", language="hi-IN"), companion.RunEffects(), type("G", (), {"denied_tools": []})()

    monkeypatch.setattr(companion, "respond", fake_respond)
    return TestClient(app_module.app)


PARENT = {"x-dev-member": "parent"}
RAHUL = {"x-dev-member": "rahul"}


def test_health_and_auth_required(client):
    assert client.get("/health").json()["ok"] is True
    assert client.get("/ally/state").status_code == 401


def test_parent_turn_and_role_checks(client):
    res = client.post("/ally/parent/text", json={"text": "नमस्ते"}, headers=PARENT)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["say"] == "नमस्ते अम्मा।" and len(body["state"]["transcript"]) == 2
    assert client.post("/ally/parent/text", json={"text": "hi"}, headers=RAHUL).status_code == 403
    family_state = client.get("/ally/state", headers=RAHUL).json()
    assert family_state["transcript"] == [] and family_state["parent_name"] == "Amma"


def test_dashboard_is_family_only_and_audited_once_per_hour(client, repo):
    assert client.get("/ally/dashboard", headers=PARENT).status_code == 403
    for _ in range(3):
        res = client.get("/ally/dashboard", headers=RAHUL)
        assert res.status_code == 200, res.text
    views = [r for r in repo.list_audit("amma") if r["action"] == "view_dashboard"]
    assert len(views) == 1


def test_watch_requires_device_key(client):
    assert client.post("/ally/watch", json={"kind": "activity"}).status_code == 401
    assert client.post("/ally/watch", json={"kind": "activity"}, headers={"x-ally-device-key": "wrong"}).status_code == 401
    ok = client.post("/ally/watch", json={"kind": "activity", "steps": 40}, headers={"x-ally-device-key": "device-key"})
    assert ok.status_code == 200, ok.text


def test_family_note_reaches_parent_channel(client):
    assert client.post("/ally/family/note", json={"text": "Call you at 7"}, headers=RAHUL).status_code == 200
    msgs = client.get("/ally/proactive/pending", headers=PARENT).json()["messages"]
    assert msgs[0]["kind"] == "family_note" and msgs[0]["data"]["from_name"] == "Rahul"
    assert client.get("/ally/proactive/pending", headers=PARENT).json()["messages"] == []


def test_consent_rule_confirm_and_revoke_via_api(client):
    from policy import consent

    rule = consent.propose_rule("amma", audience="priya", topic="health", except_emergency=True, language="hi-IN", source="voice")
    state = client.get("/ally/state", headers=PARENT).json()
    assert state["pending_rule"]["id"] == rule["id"]
    assert client.post(f"/ally/parent/consent/{rule['id']}/confirm", json={"yes": True}, headers=PARENT).status_code == 200
    rules = client.get("/ally/parent/consent", headers=PARENT).json()["rules"]
    assert [r["status"] for r in rules] == ["active"]
    assert client.delete(f"/ally/parent/consent/{rule['id']}", headers=PARENT).status_code == 200


def test_bad_reply_token_rejected(client):
    res = client.post("/ally/escalations/reply", json={"reply_token": "abc.def", "decision": "accept"})
    assert res.status_code == 403
