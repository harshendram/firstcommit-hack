"""Ally runtime config. Every value is an env var so local, Lambda and tests share one code path."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ALLY_ROOT = Path(__file__).resolve().parent
load_dotenv(ALLY_ROOT / ".env")
load_dotenv(ALLY_ROOT.parent / ".env")


def _s(key: str, default: str = "") -> str:
    return (os.getenv(key) or default).strip()


def _i(key: str, default: int) -> int:
    raw = _s(key)
    return int(raw) if raw else default


def _b(key: str) -> bool:
    return _s(key).lower() in ("1", "true", "yes", "on")


PARENT_ID = _s("ALLY_PARENT_ID", "amma")
HOST = _s("ALLY_HOST", "0.0.0.0")
PORT = _i("ALLY_PORT", 8002)
TZ = _s("ALLY_TZ", "Asia/Kolkata")

AWS_REGION = _s("AWS_REGION", _s("AWS_DEFAULT_REGION", "us-east-1"))
# Nova 2 Lite has no in-region id: use a us./eu./jp. geo profile or global.
BEDROCK_MODEL_ID = _s("BEDROCK_MODEL_ID", "us.amazon.nova-2-lite-v1:0")
BEDROCK_MAX_TOKENS = _i("BEDROCK_MAX_TOKENS", 800)

TABLE_NAME = _s("ALLY_TABLE", "Ally")
STATE_MACHINE_ARN = _s("ALLY_STATE_MACHINE_ARN")
SECRET_NAME = _s("ALLY_SECRET_NAME")  # AWS Secrets Manager bundle; empty locally (env vars win)

COGNITO_USER_POOL_ID = _s("COGNITO_USER_POOL_ID")
COGNITO_CLIENT_ID = _s("COGNITO_CLIENT_ID")

POLLY_VOICE = _s("ALLY_POLLY_VOICE", "Kajal")
POLLY_ENGINE = _s("ALLY_POLLY_ENGINE", "generative")
# "identify" lets Transcribe pick en-IN/hi-IN per clip; "fixed" uses the parent's language.
TRANSCRIBE_MODE = _s("ALLY_TRANSCRIBE_MODE", "identify")

# Second region for the same Bedrock model. A turn that fails on a throttle or a
# 5xx in the primary region is retried here before Ally reports llm_unavailable.
BEDROCK_FAILOVER_REGION = _s("BEDROCK_FAILOVER_REGION", "us-west-2")

VAPID_SUBJECT = _s("ALLY_VAPID_SUBJECT", "mailto:team@ally.care")
PUBLIC_WEB_URL = _s("PUBLIC_WEB_URL", "http://localhost:3000")
CORS_ORIGINS = [
    o.strip()
    for o in _s("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if o.strip()
]

# Dev-only conveniences (reset endpoint, header-based identity). Never set on the deployed stack.
DEV_TOOLS = _b("ALLY_DEV_TOOLS")

ESCALATION_CONTACT_TIMEOUT = _i("ESCALATION_CONTACT_TIMEOUT", 180)
INVESTIGATION_WINDOW_MIN = _i("INVESTIGATION_WINDOW_MIN", 15)
# A possible fall is asked about first, but waits far less before involving family.
FALL_WINDOW_MIN = _i("FALL_WINDOW_MIN", 2)
WAKE_GRACE_MIN = _i("WAKE_GRACE_MIN", 15)
FAMILY_ASK_DAILY_LIMIT = _i("FAMILY_ASK_DAILY_LIMIT", 20)
MESSAGE_EXPIRY_MIN = _i("MESSAGE_EXPIRY_MIN", 120)


def on_lambda() -> bool:
    return bool(os.getenv("AWS_LAMBDA_FUNCTION_NAME"))
