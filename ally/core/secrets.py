"""Secrets: environment variables locally, AWS Secrets Manager when deployed.

One JSON secret holds every value (cheaper and atomic to rotate):
    {"vapid_public_key": "...", "vapid_private_key": "...", "device_key": "...",
     "hmac_secret": "..."}
"""

from __future__ import annotations

import json
import os
import threading
from typing import Any

from config import AWS_REGION, SECRET_NAME

_lock = threading.Lock()
_bundle: dict[str, str] | None = None


def _load_bundle() -> dict[str, str]:
    global _bundle
    with _lock:
        if _bundle is not None:
            return _bundle
        if not SECRET_NAME:
            _bundle = {}
            return _bundle
        import boto3

        client = boto3.client("secretsmanager", region_name=AWS_REGION)
        raw = client.get_secret_value(SecretId=SECRET_NAME)["SecretString"]
        loaded: Any = json.loads(raw)
        _bundle = {str(k).lower(): str(v) for k, v in loaded.items()} if isinstance(loaded, dict) else {}
        return _bundle


def secret(name: str) -> str:
    """`name` like VAPID_PRIVATE_KEY → env ALLY_VAPID_PRIVATE_KEY / VAPID_PRIVATE_KEY, else the bundle."""
    env = os.getenv(f"ALLY_{name}") or os.getenv(name)
    if env:
        return env.strip()
    return _load_bundle().get(name.lower(), "")


def reset_cache() -> None:
    """After rotating secrets (tests, or a fresh Lambda container reading a new value)."""
    global _bundle
    with _lock:
        _bundle = None
