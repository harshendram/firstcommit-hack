"""One way to call the model: `structured()` → a validated Pydantic object, or LLMError.

There is deliberately no fallback text. If Bedrock is unavailable the API returns an explicit
error and the UI shows it; nothing pretends to be the model.
"""

from __future__ import annotations

import time
from typing import Any, Sequence, TypeVar

from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from pydantic import BaseModel
from strands import Agent
from strands.models import BedrockModel
from strands.types.exceptions import StructuredOutputException

from config import AWS_REGION, BEDROCK_MAX_TOKENS, BEDROCK_MODEL_ID
from core.errors import LLMError
from core.log import log, metric

T = TypeVar("T", bound=BaseModel)

_BOTO_CONFIG = Config(retries={"mode": "adaptive", "max_attempts": 3}, read_timeout=25, connect_timeout=5)


def _model(temperature: float) -> BedrockModel:
    return BedrockModel(
        model_id=BEDROCK_MODEL_ID,
        region_name=AWS_REGION,
        temperature=temperature,
        max_tokens=BEDROCK_MAX_TOKENS,
        boto_client_config=_BOTO_CONFIG,
    )


def finish_instruction(model: type[BaseModel]) -> str:
    return f"\n\nWhen you are done, finish by calling the {model.__name__} tool exactly once."


async def structured(
    task: str,
    system: str,
    prompt: str,
    output: type[T],
    *,
    tools: Sequence[Any] = (),
    hooks: Sequence[Any] = (),
    invocation_state: dict[str, Any] | None = None,
    max_turns: int = 4,
    temperature: float = 0.2,
) -> T:
    """Run a fresh agent (agents are not safe to share across concurrent requests)."""
    agent = Agent(
        model=_model(temperature),
        system_prompt=system + finish_instruction(output),
        tools=list(tools),
        hooks=list(hooks),
        callback_handler=None,
    )
    started = time.perf_counter()
    try:
        result = await agent.invoke_async(
            prompt,
            structured_output_model=output,
            invocation_state=dict(invocation_state or {}),
            limits={"turns": max_turns},
        )
    except (StructuredOutputException, ClientError, BotoCoreError) as exc:
        _record(task, started, ok=False, error=exc)
        raise LLMError("Ally is having trouble thinking right now.", detail=f"{task}: {exc}") from exc
    except Exception as exc:  # the model layer can raise provider-specific errors; surface them all
        _record(task, started, ok=False, error=exc)
        raise LLMError("Ally is having trouble thinking right now.", detail=f"{task}: {exc!r}") from exc

    parsed = result.structured_output
    if parsed is None or not isinstance(parsed, output):
        _record(task, started, ok=False, error=f"no structured output (stop_reason={result.stop_reason})")
        raise LLMError("Ally is having trouble thinking right now.", detail=f"{task}: no structured output")
    _record(task, started, ok=True, usage=_usage(result))
    return parsed


def _usage(result: Any) -> dict[str, Any]:
    try:
        return dict(result.metrics.accumulated_usage)
    except Exception:
        return {}


def _record(task: str, started: float, *, ok: bool, error: Any = None, usage: dict[str, Any] | None = None) -> None:
    ms = round((time.perf_counter() - started) * 1000)
    metric("LLMLatency", ms, "Milliseconds", Task=task)
    if not ok:
        metric("LLMError", 1, "Count", Task=task)
        log("llm_error", task=task, model=BEDROCK_MODEL_ID, ms=ms, error=str(error))
    else:
        log("llm_ok", task=task, model=BEDROCK_MODEL_ID, ms=ms, usage=usage or {})
