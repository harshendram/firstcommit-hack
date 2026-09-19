"""FamilyEscalation state machine (Amazon States Language).

Ask each child in order (callback with task token, timeout → next) → ask the parent about the
neighbour → contact the neighbour only if Cedar allows → otherwise notify every child. Any error
goes to a failsafe that notifies every child and releases the lock.
"""

from __future__ import annotations

from typing import Any


def _invoke(fn_arn: str, payload: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {
        "Type": "Task",
        "Resource": "arn:aws:states:::lambda:invoke",
        "Parameters": {"FunctionName": fn_arn, "Payload": payload},
        "Catch": [{"ErrorEquals": ["States.ALL"], "ResultPath": "$.error", "Next": "Failsafe"}],
        **extra,
    }


def _callback(fn_arn: str, payload: dict[str, Any], timeout_s: int, on_timeout: str, nxt: str) -> dict[str, Any]:
    return {
        "Type": "Task",
        "Resource": "arn:aws:states:::lambda:invoke.waitForTaskToken",
        "Parameters": {"FunctionName": fn_arn, "Payload": {**payload, "token.$": "$$.Task.Token"}},
        "TimeoutSeconds": timeout_s,
        "ResultPath": "$.reply",
        "Catch": [
            {"ErrorEquals": ["States.Timeout"], "ResultPath": "$.timeout", "Next": on_timeout},
            {"ErrorEquals": ["States.ALL"], "ResultPath": "$.error", "Next": "Failsafe"},
        ],
        "Next": nxt,
    }


def definition(fn_arn: str, contact_timeout_s: int, parent_timeout_s: int) -> dict[str, Any]:
    ids = {"parent_id.$": "$.parent_id", "esc_id.$": "$.esc_id"}
    loop = {**ids, "contacts.$": "$.contacts", "index.$": "$.index", "count.$": "$.count"}
    return {
        "Comment": "Ally family escalation: ask children one by one, then the parent about a neighbour.",
        "StartAt": "Init",
        "States": {
            "Init": _invoke(
                fn_arn,
                {"step": "init", **ids},
                ResultSelector={
                    "parent_id.$": "$.Payload.parent_id",
                    "esc_id.$": "$.Payload.esc_id",
                    "contacts.$": "$.Payload.contacts",
                    "index.$": "$.Payload.index",
                    "count.$": "$.Payload.count",
                },
                ResultPath="$",
                Next="HasMoreChildren",
            ),
            "HasMoreChildren": {
                "Type": "Choice",
                "Choices": [{"Variable": "$.index", "NumericLessThanPath": "$.count", "Next": "AskChild"}],
                "Default": "AskParentAboutNeighbour",
            },
            "AskChild": _callback(fn_arn, {"step": "ask_contact", **loop}, contact_timeout_s, "ChildTimedOut", "ChildAnswered"),
            "ChildTimedOut": {"Type": "Pass", "Result": {"decision": "timeout"}, "ResultPath": "$.reply", "Next": "ChildAnswered"},
            "ChildAnswered": {
                "Type": "Choice",
                "Choices": [{"Variable": "$.reply.decision", "StringEquals": "accept", "Next": "ChildAccepted"}],
                "Default": "NextChild",
            },
            "NextChild": _invoke(
                fn_arn,
                {"step": "next_contact", **loop, "reply.$": "$.reply"},
                ResultSelector={"index.$": "$.Payload.index"},
                ResultPath="$.next",
                Next="AdvanceIndex",
            ),
            "AdvanceIndex": {
                "Type": "Pass",
                "Parameters": {**ids, "contacts.$": "$.contacts", "count.$": "$.count", "index.$": "$.next.index"},
                "Next": "HasMoreChildren",
            },
            "ChildAccepted": _invoke(fn_arn, {"step": "accepted", **loop}, ResultPath=None, Next="Done"),
            "AskParentAboutNeighbour": _callback(
                fn_arn, {"step": "ask_parent_neighbour", **ids}, parent_timeout_s, "ParentTimedOut", "ContactNeighbour"
            ),
            "ParentTimedOut": {"Type": "Pass", "Result": {"decision": "timeout"}, "ResultPath": "$.reply", "Next": "ContactNeighbour"},
            "ContactNeighbour": _invoke(
                fn_arn,
                {"step": "contact_neighbour", **ids, "reply.$": "$.reply"},
                ResultSelector={"contacted.$": "$.Payload.contacted"},
                ResultPath="$.neighbour",
                Next="NeighbourContacted",
            ),
            "NeighbourContacted": {
                "Type": "Choice",
                "Choices": [{"Variable": "$.neighbour.contacted", "BooleanEquals": True, "Next": "Finish"}],
                "Default": "NotifyAllChildren",
            },
            "NotifyAllChildren": _invoke(fn_arn, {"step": "notify_all", **ids}, ResultPath=None, Next="Finish"),
            "Finish": _invoke(fn_arn, {"step": "finish", **ids}, ResultPath=None, Next="Done"),
            "Done": {"Type": "Succeed"},
            "Failsafe": {
                "Type": "Task",
                "Resource": "arn:aws:states:::lambda:invoke",
                "Parameters": {"FunctionName": fn_arn, "Payload": {"step": "failsafe", **ids}},
                "Next": "Failed",
            },
            "Failed": {"Type": "Fail", "Error": "EscalationFailed"},
        },
    }
