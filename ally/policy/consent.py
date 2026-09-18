"""The single consent choke point. Every share/read/contact decision goes through `authorize()`,
and every decision (allow and deny) is written to the audit log the parent can read.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cedarpy

from core import clock
from core.ids import new_id, safe_entity_id
from core.log import log
from policy.templates import RuleTopic, describe, render_forbid
from store.repo import get_repo

BASE_POLICY_PATH = Path(__file__).resolve().parent / "base.cedar"
BASE_POLICIES = BASE_POLICY_PATH.read_text(encoding="utf-8")
_CACHE_TTL_S = 5.0
_cache: dict[str, tuple[float, str, dict[str, str]]] = {}

PRINCIPAL_TYPES = ("Parent", "Family", "Neighbour")
TOPICS = ("routine", "mood", "health", "location", "safety", "conversation", "self")


def _base_descriptions() -> dict[str, str]:
    out: dict[str, str] = {}
    pending: str | None = None
    for line in BASE_POLICIES.splitlines():
        m = re.match(r'@id\("([^"]+)"\)', line.strip())
        if m:
            pending = m.group(1)
            continue
        d = re.match(r'@desc\("([^"]+)"\)', line.strip())
        if d and pending:
            out[pending] = d.group(1)
    return out


BASE_DESCRIPTIONS = _base_descriptions()


@dataclass
class Decision:
    allowed: bool
    policy_ids: list[str]
    reason: str
    audit_sk: str | None = None
    audit_id: str | None = None
    errors: list[str] = field(default_factory=list)


def _policies_for(parent_id: str) -> tuple[str, dict[str, str]]:
    """Base + active parent rules, cached briefly (writes from other Lambdas show up within 5 s)."""
    hit = _cache.get(parent_id)
    if hit and time.monotonic() - hit[0] < _CACHE_TTL_S:
        return hit[1], hit[2]
    rules = get_repo().list_consents(parent_id)
    descriptions = dict(BASE_DESCRIPTIONS)
    parts = [BASE_POLICIES]
    for rule in rules:
        parts.append(rule["cedar"])
        descriptions[f"consent-{rule['id']}"] = rule.get("description", "")
    text = "\n".join(parts)
    _cache[parent_id] = (time.monotonic(), text, descriptions)
    return text, descriptions


def invalidate(parent_id: str) -> None:
    _cache.pop(parent_id, None)


def principal_ref(kind: str, entity_id: str) -> str:
    if kind not in PRINCIPAL_TYPES:
        raise ValueError(f"unknown principal type {kind!r}")
    return f'{kind}::"{safe_entity_id(entity_id)}"'


def authorize(
    parent_id: str,
    *,
    principal: tuple[str, str],
    action: str,
    topic: str,
    requested_by: str,
    context: dict[str, Any] | None = None,
    summary: str = "",
    tool_use_id: str | None = None,
    audit: bool = True,
    audit_dedupe_key: str | None = None,
) -> Decision:
    """Evaluate Cedar and write an audit row. Fail-closed: any evaluation error is a deny."""
    kind, entity = principal
    ctx = {
        "severity": "none",
        "tier": 1,
        "parent_confirmed": False,
        "escalation_timed_out": False,
        "hour_local": clock.now().hour,
        **(context or {}),
    }
    policy_ids: list[str] = []
    errors: list[str] = []
    try:
        if topic not in TOPICS:
            raise ValueError(f"unknown topic {topic!r}")
        if not re.match(r"^[a-z_]{1,40}$", action):
            raise ValueError(f"invalid action {action!r}")
        policies, descriptions = _policies_for(parent_id)
        result = cedarpy.is_authorized(
            {
                "principal": principal_ref(kind, entity),
                "action": f'Action::"{action}"',
                "resource": f'Topic::"{topic}"',
                "context": ctx,
            },
            policies,
            [],
        )
        annotations = result.diagnostics.id_annotations_by_reason
        policy_ids = [annotations.get(r, r) for r in result.diagnostics.reasons]
        errors = [str(e) for e in result.diagnostics.errors]
        allowed = result.allowed and not errors
        if allowed:
            reason = "; ".join(descriptions.get(p, p) for p in policy_ids)
        elif policy_ids:
            reason = "; ".join(descriptions.get(p, p) for p in policy_ids)
        elif errors:
            reason = "Consent check failed, so Ally did not share."
        else:
            reason = "No rule allows this, so Ally did not share."
    except Exception as exc:  # fail closed, but record why
        allowed = False
        errors = [repr(exc)]
        reason = "Consent check failed, so Ally did not share."

    if not audit or (audit_dedupe_key and not get_repo().claim_dedupe(parent_id, f"audit#{audit_dedupe_key}")):
        return Decision(allowed, policy_ids, reason, None, None, errors)
    at = clock.now()
    row = {
        "id": new_id(),
        "at": clock.iso(at),
        "principal_type": kind,
        "principal_id": entity,
        "action": action,
        "topic": topic,
        "decision": "allow" if allowed else "deny",
        "policy_ids": policy_ids,
        "reason": reason,
        "requested_by": requested_by,
        "summary": summary[:300],
        "context": {k: ctx[k] for k in ("severity", "tier", "parent_confirmed", "escalation_timed_out")},
        "tool_use_id": tool_use_id,
        "errors": errors,
    }
    sk = get_repo().put_audit(parent_id, row)
    log("consent_decision", parent_id=parent_id, **{k: row[k] for k in ("principal_id", "action", "topic", "decision")})
    return Decision(allowed, policy_ids, reason, sk, row["id"], errors)


# ---- parent-managed rules -----------------------------------------------------------------


def propose_rule(
    parent_id: str,
    *,
    audience: str,
    topic: RuleTopic,
    except_emergency: bool,
    language: str,
    source: str,
) -> dict[str, Any]:
    """Render + validate a forbid rule and store it as pending until the parent confirms."""
    repo = get_repo()
    if audience == "all_children":
        audience_name = "your children" if language != "hi-IN" else "आपके बच्चों"
    else:
        member = repo.get_member(parent_id, audience)
        if not member or member.get("role") != "child":
            raise ValueError(f"unknown family member {audience!r}")
        audience_name = member["name"]
    rule_id = new_id()[-10:]
    for old in repo.list_consents(parent_id, statuses=("pending_confirm",)):
        repo.update_consent(parent_id, old["id"], status="superseded")
    rule = {
        "id": rule_id,
        "audience": audience,
        "audience_name": audience_name,
        "topic": topic,
        "effect": "forbid",
        "except_emergency": except_emergency,
        "cedar": render_forbid(rule_id, audience, topic, except_emergency),
        "description": describe(audience_name, topic, except_emergency, "en-IN"),
        "description_hi": describe(audience_name, topic, except_emergency, "hi-IN"),
        "status": "pending_confirm",
        "source": source,
        "created_at": clock.iso(clock.now()),
    }
    repo.put_consent(parent_id, rule)
    return rule


def pending_rule(parent_id: str) -> dict[str, Any] | None:
    rows = get_repo().list_consents(parent_id, statuses=("pending_confirm",))
    return sorted(rows, key=lambda r: r["created_at"])[-1] if rows else None


def confirm_rule(parent_id: str, rule_id: str, yes: bool) -> dict[str, Any] | None:
    repo = get_repo()
    rule = repo.get_consent(parent_id, rule_id)
    if not rule or rule.get("status") != "pending_confirm":
        return None
    status = "active" if yes else "declined"
    repo.update_consent(parent_id, rule_id, status=status, decided_at=clock.iso(clock.now()))
    invalidate(parent_id)
    return {**rule, "status": status}


def revoke_rule(parent_id: str, rule_id: str) -> bool:
    repo = get_repo()
    rule = repo.get_consent(parent_id, rule_id)
    if not rule or rule.get("status") != "active":
        return False
    repo.update_consent(parent_id, rule_id, status="revoked", revoked_at=clock.iso(clock.now()))
    invalidate(parent_id)
    return True


def base_rules() -> list[dict[str, str]]:
    return [{"id": k, "description": v} for k, v in BASE_DESCRIPTIONS.items()]
