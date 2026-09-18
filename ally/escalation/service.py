"""Family escalation lifecycle around the Step Functions workflow.

start → (workflow asks children one by one, then the parent about the neighbour) → reply/stop.
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any, Literal

import boto3
from botocore.exceptions import ClientError

from config import AWS_REGION, STATE_MACHINE_ARN
from core import clock
from core.errors import Conflict, Forbidden, NotConfigured, NotFound
from core.ids import new_id
from core.log import log
from core.names import display
from proactive import channel
from store.repo import get_repo

Decision = Literal["accept", "decline", "arrived", "confirm", "deny"]


@lru_cache(maxsize=1)
def _sfn() -> Any:
    return boto3.client("stepfunctions", region_name=AWS_REGION)


async def start(parent_id: str, alert: dict[str, Any], severity: str) -> dict[str, Any]:
    repo = get_repo()
    esc_id = new_id()
    if not repo.acquire_escalation_lock(parent_id, esc_id):
        existing = repo.active_escalation_id(parent_id)
        log("escalation_already_active", parent_id=parent_id, esc_id=existing)
        return repo.get_escalation(parent_id, existing) or {"id": existing}
    esc = {
        "id": esc_id,
        "alert_id": alert["id"],
        "alert_created_at": alert["created_at"],
        "severity": severity,
        "status": "starting",
        "token_version": 0,
        "created_at": clock.iso(clock.now()),
        "timeline": [{"at": clock.iso(clock.now()), "event": "started", "severity": severity}],
        "contacted": [],
    }
    repo.put_escalation(parent_id, esc)
    repo.update_alert(parent_id, alert, status="escalating", escalation_id=esc_id, tier=2)
    if not STATE_MACHINE_ARN:
        # Never leave the family un-notified because the workflow is missing (e.g. local dev).
        log("escalation_workflow_missing", parent_id=parent_id, esc_id=esc_id)
        from escalation import steps

        await steps.notify_all({"parent_id": parent_id, "esc_id": esc_id, "reason": "workflow_unavailable"})
        await steps.finish({"parent_id": parent_id, "esc_id": esc_id})
        raise NotConfigured("Family workflow is not configured.", detail="ALLY_STATE_MACHINE_ARN missing")
    resp = _sfn().start_execution(
        stateMachineArn=STATE_MACHINE_ARN,
        name=esc_id,
        input=json.dumps({"parent_id": parent_id, "esc_id": esc_id}),
    )
    return repo.update_escalation(parent_id, esc_id, execution_arn=resp["executionArn"], status="running")


async def stop(parent_id: str, reason: str) -> dict[str, Any] | None:
    """Parent is okay: stop asking people, tell anyone already asked."""
    repo = get_repo()
    esc_id = repo.active_escalation_id(parent_id)
    if not esc_id:
        return None
    esc = repo.get_escalation(parent_id, esc_id) or {}
    if esc.get("execution_arn"):
        try:
            _sfn().stop_execution(executionArn=esc["execution_arn"], cause=reason[:200])
        except ClientError as err:
            if err.response.get("Error", {}).get("Code") != "ExecutionDoesNotExist":
                raise
    repo.append_escalation_event(parent_id, esc_id, {"event": "stopped", "reason": reason})
    repo.expire_pending_messages(parent_id, f"esc#{esc_id}#ask#")
    repo.update_escalation(parent_id, esc_id, status="stopped", task_token=None, current_contact=None)
    profile = repo.get_profile(parent_id) or {}
    for member_id in esc.get("contacted", []):
        await channel.post(
            parent_id,
            audience=member_id,
            kind="all_clear",
            body=f"{profile.get('name', 'Amma')} says she's okay. No need to go.",
            related_id=f"esc#{esc_id}#allclear#{member_id}",
        )
    repo.release_escalation_lock(parent_id, esc_id)
    return repo.get_escalation(parent_id, esc_id)


async def reply(
    parent_id: str,
    esc_id: str,
    *,
    responder: str,
    decision: Decision,
    token_version: int | None = None,
) -> dict[str, Any]:
    """A child (accept/decline/arrived) or the parent (confirm/deny neighbour) answers."""
    repo = get_repo()
    esc = repo.get_escalation(parent_id, esc_id)
    if not esc:
        raise NotFound("That request no longer exists.")

    if decision == "arrived":
        if esc.get("responder") != responder:
            raise Forbidden("Only the person who said they'd go can mark arrival.")
        return await _arrived(parent_id, esc)

    if esc.get("current_contact") != responder or esc.get("status") not in ("asking", "asking_parent"):
        raise Conflict("Ally has already asked someone else.")
    version = int(esc.get("token_version", 0)) if token_version is None else token_version
    before = repo.consume_escalation_token(parent_id, esc_id, version)
    if not before or not before.get("task_token"):
        raise Conflict("Ally has already asked someone else.")
    try:
        _sfn().send_task_success(taskToken=before["task_token"], output=json.dumps({"decision": decision}))
    except ClientError as err:
        code = err.response.get("Error", {}).get("Code")
        if code in ("TaskTimedOut", "InvalidToken", "TaskDoesNotExist"):
            raise Conflict("Ally has already asked someone else.") from err
        raise
    repo.append_escalation_event(parent_id, esc_id, {"event": "reply", "by": responder, "decision": decision})
    return repo.get_escalation(parent_id, esc_id) or esc


async def _arrived(parent_id: str, esc: dict[str, Any]) -> dict[str, Any]:
    repo = get_repo()
    esc_id = esc["id"]
    repo.append_escalation_event(parent_id, esc_id, {"event": "arrived", "by": esc.get("responder")})
    repo.update_escalation(parent_id, esc_id, status="resolved", resolved_at=clock.iso(clock.now()))
    alert = repo.get_alert(parent_id, esc["alert_id"])
    if alert:
        repo.update_alert(parent_id, alert, status="resolved", resolved_by=esc.get("responder"))
    member = repo.get_member(parent_id, esc.get("responder", "")) or {}
    profile = repo.get_profile(parent_id) or {}
    hi = profile.get("language") == "hi-IN"
    await channel.post(
        parent_id,
        audience="parent",
        kind="escalation_update",
        body=(
            f"{display(member, 'hi-IN', 'आपका परिवार')} आ गए हैं।" if hi else f"{member.get('name', 'Family')} is here now."
        ),
        related_id=f"esc#{esc_id}#arrived",
    )
    repo.release_escalation_lock(parent_id, esc_id)
    return repo.get_escalation(parent_id, esc_id) or esc


def view(parent_id: str, esc_id: str) -> dict[str, Any]:
    esc = get_repo().get_escalation(parent_id, esc_id, consistent=False)
    if not esc:
        raise NotFound("That request no longer exists.")
    return {k: v for k, v in esc.items() if k not in ("task_token",)}
