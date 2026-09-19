"""Web Push (VAPID). Push wakes the device; the app still reads state from the API."""

from __future__ import annotations

import asyncio
import hashlib
import json
from typing import Any

from config import VAPID_SUBJECT
from core.log import log
from core.secrets import secret
from store.repo import get_repo

MAX_PAYLOAD_BYTES = 3500


def endpoint_hash(endpoint: str) -> str:
    return hashlib.sha256(endpoint.encode()).hexdigest()[:32]


def vapid_public_key() -> str:
    return secret("VAPID_PUBLIC_KEY")


def subscribe(parent_id: str, audience: str, subscription: dict[str, Any]) -> str:
    endpoint = str(subscription.get("endpoint") or "")
    keys = subscription.get("keys") or {}
    if not endpoint.startswith("https://") or not keys.get("p256dh") or not keys.get("auth"):
        raise ValueError("invalid push subscription")
    h = endpoint_hash(endpoint)
    get_repo().put_push_subscription(parent_id, audience, h, {"endpoint": endpoint, "keys": keys})
    return h


def unsubscribe(parent_id: str, audience: str, endpoint: str) -> None:
    get_repo().delete_push_subscription(parent_id, audience, endpoint_hash(endpoint))


def _send_one(sub: dict[str, Any], payload: str, private_key: str) -> int:
    from pywebpush import WebPushException, webpush

    try:
        webpush(
            subscription_info=sub,
            data=payload,
            vapid_private_key=private_key,
            vapid_claims={"sub": VAPID_SUBJECT},
            ttl=600,
        )
        return 201
    except WebPushException as exc:
        return exc.response.status_code if exc.response is not None else 0


async def send(parent_id: str, audience: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Send to every device registered for `audience` ("parent" or a member id)."""
    private_key = secret("VAPID_PRIVATE_KEY")
    if not private_key:
        log("push_not_configured", audience=audience, kind=payload.get("type"))
        return {"sent": 0, "failed": 0, "reason": "push_not_configured"}
    body = json.dumps(payload, ensure_ascii=False)
    if len(body.encode()) > MAX_PAYLOAD_BYTES:
        raise ValueError("push payload too large")
    repo = get_repo()
    subs = repo.list_push_subscriptions(parent_id, audience)
    sent = failed = 0
    for row in subs:
        status = await asyncio.to_thread(_send_one, row["subscription"], body, private_key)
        if status in (200, 201, 202):
            sent += 1
            continue
        failed += 1
        if status in (404, 410):
            repo.delete_push_subscription(parent_id, audience, row["hash"])
        log("push_failed", audience=audience, status=status)
    return {"sent": sent, "failed": failed, "devices": len(subs)}
