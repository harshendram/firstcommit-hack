"""Identity. On Lambda, API Gateway's JWT authorizer already verified the Cognito token and the
Lambda Web Adapter forwards the request context as the `x-amzn-request-context` header. Locally we
verify the Cognito JWT ourselves; with ALLY_DEV_TOOLS=1 a dev header identity is accepted.
"""

from __future__ import annotations

import hmac
import json
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from fastapi import Header, Request

from config import AWS_REGION, COGNITO_CLIENT_ID, COGNITO_USER_POOL_ID, DEV_TOOLS, PARENT_ID, on_lambda
from core.errors import AllyError, Forbidden
from core.secrets import secret


class Unauthorized(AllyError):
    status = 401
    code = "unauthorized"


@dataclass(frozen=True)
class Identity:
    sub: str
    parent_id: str
    member_id: str  # "parent" for the parent's own device
    groups: frozenset[str]

    @property
    def is_parent(self) -> bool:
        return "parent" in self.groups

    @property
    def audience(self) -> str:
        return "parent" if self.is_parent else self.member_id


def _parse_groups(raw: Any) -> frozenset[str]:
    if isinstance(raw, list):
        return frozenset(str(g) for g in raw)
    text = str(raw or "").strip().strip("[]")
    return frozenset(g.strip().strip('"') for g in text.replace(",", " ").split() if g.strip())


def _identity_from_claims(claims: dict[str, Any]) -> Identity:
    groups = _parse_groups(claims.get("cognito:groups"))
    parent_id = str(claims.get("custom:parent_id") or PARENT_ID)
    member_id = str(claims.get("custom:member_id") or ("parent" if "parent" in groups else ""))
    if not member_id or not groups & {"parent", "family"}:
        raise Forbidden("This account is not linked to a family yet.")
    return Identity(str(claims.get("sub")), parent_id, member_id, groups)


@lru_cache(maxsize=1)
def _jwks_client() -> Any:
    import jwt

    url = f"https://cognito-idp.{AWS_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}/.well-known/jwks.json"
    return jwt.PyJWKClient(url)


def _verify_locally(token: str) -> dict[str, Any]:
    import jwt

    if not COGNITO_USER_POOL_ID:
        raise Unauthorized("Please sign in.", detail="COGNITO_USER_POOL_ID not set")
    try:
        key = _jwks_client().get_signing_key_from_jwt(token).key
        return jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=COGNITO_CLIENT_ID,
            issuer=f"https://cognito-idp.{AWS_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}",
        )
    except Exception as exc:
        raise Unauthorized("Please sign in again.", detail=repr(exc)) from exc


def current_identity(
    request: Request,
    authorization: str | None = Header(default=None),
    x_dev_member: str | None = Header(default=None),
) -> Identity:
    if on_lambda():
        raw = request.headers.get("x-amzn-request-context")
        if not raw:
            raise Unauthorized("Please sign in.", detail="missing request context")
        claims = (((json.loads(raw).get("authorizer") or {}).get("jwt") or {}).get("claims")) or {}
        if not claims:
            raise Unauthorized("Please sign in.", detail="no jwt claims")
        return _identity_from_claims(claims)
    if DEV_TOOLS and x_dev_member:
        groups = frozenset({"parent"}) if x_dev_member == "parent" else frozenset({"family"})
        return Identity(f"dev-{x_dev_member}", PARENT_ID, x_dev_member, groups)
    if not authorization or not authorization.lower().startswith("bearer "):
        raise Unauthorized("Please sign in.")
    return _identity_from_claims(_verify_locally(authorization.split(" ", 1)[1]))


def require_parent(identity: Identity) -> Identity:
    if not identity.is_parent:
        raise Forbidden("Only Amma's own device can do this.")
    return identity


def require_family(identity: Identity) -> Identity:
    if identity.is_parent or "family" not in identity.groups:
        raise Forbidden("This is for family members.")
    return identity


def verify_device_key(provided: str | None) -> None:
    expected = secret("DEVICE_KEY")
    if not expected:
        raise Unauthorized("Device key not configured.", detail="ALLY_DEVICE_KEY missing")
    if not provided or not hmac.compare_digest(provided, expected):
        raise Unauthorized("Unknown device.")
