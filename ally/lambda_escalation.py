"""Step Functions task target. The state machine passes {"step": <name>, ...state}."""

from __future__ import annotations

import asyncio
from typing import Any

from core.log import log
from escalation.steps import STEPS


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    step = event.get("step")
    if step not in STEPS:
        raise ValueError(f"unknown escalation step {step!r}")
    result = asyncio.run(STEPS[step](event))
    log("escalation_step", step=step, esc_id=event.get("esc_id"), result=result)
    return result
