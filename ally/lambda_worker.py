"""EventBridge Scheduler target: the one-minute sweep (reminders, wake window, investigation timeouts)."""

from __future__ import annotations

import asyncio
from typing import Any

from agents import orchestrator
from core.log import log


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    result = asyncio.run(orchestrator.sweep())
    log("sweep", **result)
    return result
