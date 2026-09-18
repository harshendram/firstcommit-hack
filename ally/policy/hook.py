"""ConsentGuard: Cedar checks every agent tool call before it runs.

Principal comes from invocation_state (who is asking / acting). Topic and recipient come from the
tool input. A deny cancels the tool with a plain-language reason the model relays.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from strands.hooks import AfterToolCallEvent, BeforeToolCallEvent, HookProvider, HookRegistry

from agents.schemas import SCHEMA_NAMES
from core.log import log
from policy.consent import authorize

PrincipalFn = Callable[[dict[str, Any], dict[str, Any]], tuple[str, str]]


def caller(state: dict[str, Any], _input: dict[str, Any]) -> tuple[str, str]:
    return tuple(state["principal"])  # type: ignore[return-value]


def recipient_member(_state: dict[str, Any], tool_input: dict[str, Any]) -> tuple[str, str]:
    return ("Family", str(tool_input.get("member_id") or ""))


@dataclass(frozen=True)
class ToolPolicy:
    action: str
    topic: Callable[[dict[str, Any]], str]
    principal: PrincipalFn = caller


def _const(topic: str) -> Callable[[dict[str, Any]], str]:
    return lambda _input: topic


def _input_topic(default: str) -> Callable[[dict[str, Any]], str]:
    return lambda tool_input: str(tool_input.get("topic") or default)


TOOL_POLICIES: dict[str, ToolPolicy] = {
    # Parent companion tools — principal is the parent herself.
    "create_reminder": ToolPolicy("create_reminder", _const("self")),
    "set_privacy_rule": ToolPolicy("set_consent_rule", _const("self")),
    "recall_recent_days": ToolPolicy("recall", _const("self")),
    # Sending something to a child — principal is the child who would receive it.
    "send_message_to_family": ToolPolicy("share_update", _input_topic("routine"), recipient_member),
    # Family Q&A tools — principal is the asking family member.
    "read_day_log": ToolPolicy("read_day_log", _const("routine")),
    "read_health_notes": ToolPolicy("read_day_log", _const("health")),
    "read_mood_notes": ToolPolicy("read_day_log", _const("mood")),
    "read_alerts": ToolPolicy("read_alerts", _const("safety")),
    "read_conversation": ToolPolicy("read_conversation", _const("conversation")),
}


class ConsentGuard(HookProvider):
    def __init__(self, parent_id: str, requested_by: str, context: dict[str, Any] | None = None) -> None:
        self.parent_id = parent_id
        self.requested_by = requested_by
        self.context = context or {}
        self.audit_by_tool_use: dict[str, str] = {}
        self.denied_tools: list[str] = []
        self.allowed_tool_use_ids: set[str] = set()

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(BeforeToolCallEvent, self.before_tool)
        registry.add_callback(AfterToolCallEvent, self.after_tool)

    def before_tool(self, event: BeforeToolCallEvent) -> None:
        name = event.tool_use["name"]
        if name in SCHEMA_NAMES:
            # Strands' structured-output tool is the response format, not an action.
            return
        tool_use_id = event.tool_use["toolUseId"]
        tool_input = event.tool_use.get("input") or {}
        policy = TOOL_POLICIES.get(name)
        if policy is None:
            log("consent_unknown_tool", tool=name)
            self.denied_tools.append(name)
            event.cancel_tool = "This action isn't allowed."
            return
        try:
            principal = policy.principal(event.invocation_state, tool_input)
            topic = policy.topic(tool_input)
        except Exception as exc:
            log("consent_bad_tool_input", tool=name, error=repr(exc))
            self.denied_tools.append(name)
            event.cancel_tool = "This action isn't allowed."
            return
        decision = authorize(
            self.parent_id,
            principal=principal,
            action=policy.action,
            topic=topic,
            requested_by=self.requested_by,
            context=self.context,
            summary=_summarise(name, tool_input),
            tool_use_id=tool_use_id,
        )
        if decision.audit_sk:
            self.audit_by_tool_use[tool_use_id] = decision.audit_sk
        if decision.allowed:
            self.allowed_tool_use_ids.add(tool_use_id)
        else:
            self.denied_tools.append(name)
            event.cancel_tool = f"Not permitted: {decision.reason}"

    def after_tool(self, event: AfterToolCallEvent) -> None:
        # Fires for cancelled calls too; we only annotate the existing audit row, never add one.
        tool_use_id = event.tool_use["toolUseId"]
        sk = self.audit_by_tool_use.get(tool_use_id)
        if not sk or event.cancel_message:
            return
        from store.repo import get_repo

        status = "error" if event.exception else "done"
        get_repo().update_audit(self.parent_id, sk, outcome=status)


def _summarise(name: str, tool_input: dict[str, Any]) -> str:
    parts = [f"{k}={v}" for k, v in tool_input.items() if k not in ("message",)]
    if "message" in tool_input:
        parts.append(f"message={str(tool_input['message'])[:120]}")
    return f"{name}({', '.join(parts)})"
