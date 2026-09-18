"""Step Functions task handlers for the FamilyEscalation workflow.

Every contact goes through Cedar first. Callback steps store the task token and return immediately;
the reply endpoint resumes the workflow with SendTaskSuccess.
"""

from __future__ import annotations

import json
from typing import Any

from core import clock
from core.log import log
from core.names import display
from escalation import tokens
from policy.consent import authorize
from proactive import channel
from store.repo import get_repo


def _ctx(esc: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {"severity": esc.get("severity", "high"), "tier": 2, **extra}


async def init(event: dict[str, Any]) -> dict[str, Any]:
    repo = get_repo()
    parent_id, esc_id = event["parent_id"], event["esc_id"]
    members = repo.list_members(parent_id)
    children = [m["id"] for m in members if m.get("role") == "child"]
    repo.append_escalation_event(parent_id, esc_id, {"event": "plan", "children": children})
    return {"parent_id": parent_id, "esc_id": esc_id, "contacts": children, "index": 0, "count": len(children)}


async def ask_contact(event: dict[str, Any]) -> dict[str, Any]:
    repo = get_repo()
    parent_id, esc_id, index = event["parent_id"], event["esc_id"], int(event["index"])
    member_id = event["contacts"][index]
    esc = repo.get_escalation(parent_id, esc_id) or {}
    member = repo.get_member(parent_id, member_id) or {"id": member_id, "name": member_id}
    profile = repo.get_profile(parent_id) or {}
    name = profile.get("name", "Amma")

    decision = authorize(
        parent_id,
        principal=("Family", member_id),
        action="notify_member",
        topic="safety",
        requested_by="Ally::coordinator",
        context=_ctx(esc),
        summary=f"Ask {member['name']} to check on {name}",
    )
    version = int(esc.get("token_version", 0)) + 1
    repo.update_escalation(
        parent_id,
        esc_id,
        status="asking",
        current_contact=member_id,
        task_token=event["token"],
        token_version=version,
        contacted=sorted({*esc.get("contacted", []), member_id}),
    )
    if not decision.allowed:
        # Resume straight away as a decline so the workflow moves on.
        from escalation.service import _sfn

        repo.update_escalation(parent_id, esc_id, task_token=None, token_version=version + 1)
        _sfn().send_task_success(taskToken=event["token"], output=json.dumps({"decision": "not_permitted"}))
        return {"asked": False}

    reply_token = tokens.sign(parent_id, esc_id, member_id, version)
    alert = repo.get_alert(parent_id, esc.get("alert_id", "")) or {}
    reasons = (alert.get("judgment") or {}).get("reasons") or []
    body = f"{name} may need you. " + (reasons[0] if reasons else "Ally couldn't confirm she's okay.") + " Can you check on her?"
    await channel.post(
        parent_id,
        audience=member_id,
        kind="escalation_ask",
        title=f"Can you check on {name}?",
        body=body,
        related_id=f"esc#{esc_id}#ask#{member_id}#{version}",
        data={"esc_id": esc_id},
        push_extra={"esc_id": esc_id, "reply_token": reply_token, "actions": ["accept", "decline"]},
    )
    repo.append_escalation_event(parent_id, esc_id, {"event": "asked", "member": member_id})
    return {"asked": True}


async def next_contact(event: dict[str, Any]) -> dict[str, Any]:
    repo = get_repo()
    parent_id, esc_id, index = event["parent_id"], event["esc_id"], int(event["index"])
    member_id = event["contacts"][index]
    outcome = (event.get("reply") or {}).get("decision", "timeout")
    repo.append_escalation_event(parent_id, esc_id, {"event": outcome, "member": member_id})
    esc = repo.get_escalation(parent_id, esc_id) or {}
    repo.update_escalation(
        parent_id, esc_id, task_token=None, current_contact=None, token_version=int(esc.get("token_version", 0)) + 1
    )
    return {"index": index + 1}


async def accepted(event: dict[str, Any]) -> dict[str, Any]:
    repo = get_repo()
    parent_id, esc_id, index = event["parent_id"], event["esc_id"], int(event["index"])
    member_id = event["contacts"][index]
    esc = repo.get_escalation(parent_id, esc_id) or {}
    member = repo.get_member(parent_id, member_id) or {"name": member_id}
    profile = repo.get_profile(parent_id) or {}
    hi = profile.get("language") == "hi-IN"
    repo.update_escalation(parent_id, esc_id, status="accepted", responder=member_id, current_contact=None)
    repo.append_escalation_event(parent_id, esc_id, {"event": "accepted", "member": member_id})
    await channel.post(
        parent_id,
        audience="parent",
        kind="escalation_update",
        body=(
            f"{display(member, 'hi-IN')} आपसे मिलने आ रहे हैं।" if hi else f"{member['name']} is on the way to see you."
        ),
        related_id=f"esc#{esc_id}#accepted",
    )
    repo.expire_pending_messages(parent_id, f"esc#{esc_id}#ask#")
    for other in esc.get("contacted", []):
        if other != member_id:
            await channel.post(
                parent_id,
                audience=other,
                kind="escalation_update",
                body=f"{member['name']} is going to check on {profile.get('name', 'Amma')}.",
                related_id=f"esc#{esc_id}#covered#{other}",
            )
    return {"accepted": True}


async def ask_parent_neighbour(event: dict[str, Any]) -> dict[str, Any]:
    repo = get_repo()
    parent_id, esc_id = event["parent_id"], event["esc_id"]
    neighbours = [m for m in repo.list_members(parent_id) if m.get("role") == "neighbour"]
    esc = repo.get_escalation(parent_id, esc_id) or {}
    version = int(esc.get("token_version", 0)) + 1
    if not neighbours:
        from escalation.service import _sfn

        repo.update_escalation(parent_id, esc_id, token_version=version)
        _sfn().send_task_success(taskToken=event["token"], output=json.dumps({"decision": "no_neighbour"}))
        return {"asked": False}
    neighbour = neighbours[0]
    profile = repo.get_profile(parent_id) or {}
    hi = profile.get("language") == "hi-IN"
    repo.update_escalation(
        parent_id,
        esc_id,
        status="asking_parent",
        current_contact="parent",
        neighbour_id=neighbour["id"],
        task_token=event["token"],
        token_version=version,
    )
    body = (
        f"आपके बच्चों से संपर्क नहीं हो पाया। क्या मैं {display(neighbour, 'hi-IN')} को आपके पास आने के लिए कहूँ?"
        if hi
        else f"I couldn't reach your children. Shall I ask {neighbour['name']} to come and see you?"
    )
    await channel.post(
        parent_id,
        audience="parent",
        kind="neighbour_question",
        body=body,
        related_id=f"esc#{esc_id}#neighbour_q",
        data={"esc_id": esc_id, "neighbour_id": neighbour["id"], "neighbour_name": neighbour["name"]},
    )
    repo.append_escalation_event(parent_id, esc_id, {"event": "asked_parent_about_neighbour"})
    return {"asked": True}


async def contact_neighbour(event: dict[str, Any]) -> dict[str, Any]:
    repo = get_repo()
    parent_id, esc_id = event["parent_id"], event["esc_id"]
    reply = (event.get("reply") or {}).get("decision", "timeout")
    esc = repo.get_escalation(parent_id, esc_id) or {}
    repo.update_escalation(parent_id, esc_id, task_token=None, current_contact=None)
    repo.append_escalation_event(parent_id, esc_id, {"event": f"parent_{reply}"})
    neighbour_id = esc.get("neighbour_id")
    if not neighbour_id or reply in ("deny", "no_neighbour"):
        return {"contacted": False}
    neighbour = repo.get_member(parent_id, neighbour_id) or {"name": neighbour_id}
    profile = repo.get_profile(parent_id) or {}
    decision = authorize(
        parent_id,
        principal=("Neighbour", neighbour_id),
        action="contact_neighbour",
        topic="safety",
        requested_by="Ally::coordinator",
        context=_ctx(esc, parent_confirmed=reply == "confirm", escalation_timed_out=reply == "timeout"),
        summary=f"Ask {neighbour['name']} to check on {profile.get('name', 'Amma')}",
    )
    if not decision.allowed:
        return {"contacted": False}
    await channel.post(
        parent_id,
        audience=neighbour_id,
        kind="escalation_ask",
        title=f"Could you check on {profile.get('name', 'Amma')}?",
        body=f"Her family couldn't be reached. Could you look in on {profile.get('name', 'Amma')}?",
        related_id=f"esc#{esc_id}#neighbour",
        data={"esc_id": esc_id},
    )
    repo.update_escalation(parent_id, esc_id, contacted=sorted({*esc.get("contacted", []), neighbour_id}))
    repo.append_escalation_event(parent_id, esc_id, {"event": "neighbour_contacted", "member": neighbour_id})
    return {"contacted": True}


async def notify_all(event: dict[str, Any]) -> dict[str, Any]:
    """Nobody confirmed (or something failed): every child gets a clear, calm message."""
    repo = get_repo()
    parent_id, esc_id = event["parent_id"], event["esc_id"]
    profile = repo.get_profile(parent_id) or {}
    name = profile.get("name", "Amma")
    esc = repo.get_escalation(parent_id, esc_id) or {}
    children = [m for m in repo.list_members(parent_id) if m.get("role") == "child"]
    for child in children:
        authorize(
            parent_id,
            principal=("Family", child["id"]),
            action="notify_member",
            topic="safety",
            requested_by="Ally::coordinator",
            context=_ctx(esc),
            summary=f"Tell {child['name']} no one has confirmed",
        )
        await channel.post(
            parent_id,
            audience=child["id"],
            kind="escalation_update",
            title=f"Please check on {name}",
            body=f"No one has confirmed they can check on {name}. Please call her or someone nearby. If it's urgent, call 112.",
            related_id=f"esc#{esc_id}#all#{child['id']}",
            data={"esc_id": esc_id},
        )
    repo.update_escalation(parent_id, esc_id, contacted=sorted({*esc.get("contacted", []), *(c["id"] for c in children)}))
    repo.append_escalation_event(parent_id, esc_id, {"event": "notified_all", "reason": event.get("reason", "no_response")})
    return {"notified": len(children)}


async def finish(event: dict[str, Any]) -> dict[str, Any]:
    repo = get_repo()
    parent_id, esc_id = event["parent_id"], event["esc_id"]
    esc = repo.get_escalation(parent_id, esc_id) or {}
    if esc.get("status") not in ("accepted", "resolved", "stopped"):
        repo.update_escalation(parent_id, esc_id, status="closed", closed_at=clock.iso(clock.now()), task_token=None)
        repo.release_escalation_lock(parent_id, esc_id)
    return {"done": True}


async def failsafe(event: dict[str, Any]) -> dict[str, Any]:
    log("escalation_failsafe", payload=event)
    await notify_all({**event, "reason": "workflow_error"})
    get_repo().update_escalation(event["parent_id"], event["esc_id"], status="failed")
    get_repo().release_escalation_lock(event["parent_id"], event["esc_id"])
    return {"failsafe": True}


STEPS = {
    "init": init,
    "ask_contact": ask_contact,
    "next_contact": next_contact,
    "accepted": accepted,
    "ask_parent_neighbour": ask_parent_neighbour,
    "contact_neighbour": contact_neighbour,
    "notify_all": notify_all,
    "finish": finish,
    "failsafe": failsafe,
}
