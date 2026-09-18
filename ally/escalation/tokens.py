"""Short-lived signed reply tokens carried in push notifications (the service worker has no JWT)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

from core.errors import Forbidden, NotConfigured
from core.secrets import secret

TOKEN_TTL_S = 30 * 60


def _key() -> bytes:
    value = secret("HMAC_SECRET")
    if not value:
        raise NotConfigured("Reply links are not configured.", detail="ALLY_HMAC_SECRET missing")
    return value.encode()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def sign(parent_id: str, esc_id: str, contact: str, token_version: int, ttl_s: int = TOKEN_TTL_S) -> str:
    body = {"p": parent_id, "e": esc_id, "c": contact, "v": token_version, "x": int(time.time()) + ttl_s}
    raw = json.dumps(body, separators=(",", ":")).encode()
    mac = hmac.new(_key(), raw, hashlib.sha256).digest()
    return f"{_b64(raw)}.{_b64(mac)}"


def verify(token: str) -> dict[str, Any]:
    try:
        raw_b64, mac_b64 = token.split(".", 1)
        raw = _unb64(raw_b64)
        expected = hmac.new(_key(), raw, hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _unb64(mac_b64)):
            raise ValueError("bad signature")
        body = json.loads(raw)
    except NotConfigured:
        raise
    except Exception as exc:
        raise Forbidden("This reply link is not valid.", detail=repr(exc)) from exc
    if int(body.get("x", 0)) < time.time():
        raise Forbidden("This reply link has expired. Open Ally to see the latest.")
    return {"parent_id": body["p"], "esc_id": body["e"], "contact": body["c"], "token_version": int(body["v"])}
