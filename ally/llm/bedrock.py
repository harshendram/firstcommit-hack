"""One way to call the model: `structured()` → a validated Pydantic object, or LLMError.

Three layers of resilience sit under that one call, cheapest first:

1. The model id is a cross-region inference profile, so Bedrock itself already spreads
   every request across the US regions.
2. botocore retries throttles and 5xx in adaptive mode, which adds client-side rate
   limiting rather than just backing off.
3. BEDROCK_FAILOVER_REGION retries the whole turn in a second region when the primary
   answers with something region-shaped.

There is deliberately no fallback *text*. If every layer fails the API returns an explicit
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

from config import AWS_REGION, BEDROCK_FAILOVER_REGION, BEDROCK_MAX_TOKENS, BEDROCK_MODEL_ID
from core.errors import LLMError
from core.log import log, metric

T = TypeVar("T", bound=BaseModel)

_BOTO_CONFIG = Config(retries={"mode": "adaptive", "max_attempts": 3}, read_timeout=25, connect_timeout=5)


# Errors that mean this region cannot serve us, as opposed to this request being bad.
# Only these are worth a second region; a ValidationException would fail there too.
_REGIONAL_FAILURES = (
    "ThrottlingException",
    "TooManyRequestsException",
    "ServiceQuotaExceededException",
    "ServiceUnavailableException",
    "InternalServerException",
    "ModelNotReadyException",
    "ModelTimeoutException",
    "RequestTimeout",
)


def _is_regional_failure(exc: Exception) -> bool:
    if isinstance(exc, ClientError):
        code = exc.response.get("Error", {}).get("Code", "")
        status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 0)
        return code in _REGIONAL_FAILURES or status == 429 or status >= 500
    # BotoCoreError covers connection resets and read timeouts, also worth a second region.
    return isinstance(exc, BotoCoreError)


def _model(temperature: float, region: str = AWS_REGION) -> BedrockModel:
    return BedrockModel(
        model_id=BEDROCK_MODEL_ID,
        region_name=region,
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

    async def run(region: str) -> Any:
        agent = Agent(
            model=_model(temperature, region),
            system_prompt=system + finish_instruction(output),
            tools=list(tools),
            hooks=list(hooks),
            callback_handler=None,
        )
        return await agent.invoke_async(
            prompt,
            structured_output_model=output,
            invocation_state=dict(invocation_state or {}),
            limits={"turns": max_turns},
        )

    started = time.perf_counter()
    region = AWS_REGION
    try:
        try:
            result = await run(AWS_REGION)
        except (ClientError, BotoCoreError) as exc:
            no_failover = not BEDROCK_FAILOVER_REGION or BEDROCK_FAILOVER_REGION == AWS_REGION
            if no_failover or not _is_regional_failure(exc):
                raise
            log("llm_failover", task=task, frm=AWS_REGION, to=BEDROCK_FAILOVER_REGION, error=str(exc))
            metric("LLMFailover", 1, "Count", Task=task)
            region = BEDROCK_FAILOVER_REGION
            result = await run(BEDROCK_FAILOVER_REGION)
    except (StructuredOutputException, ClientError, BotoCoreError) as exc:
        _record(task, started, ok=False, error=exc, region=region)
        raise LLMError("Ally is having trouble thinking right now.", detail=f"{task}: {exc}") from exc
    except Exception as exc:  # the model layer can raise provider-specific errors; surface them all
        _record(task, started, ok=False, error=exc, region=region)
        raise LLMError("Ally is having trouble thinking right now.", detail=f"{task}: {exc!r}") from exc

    parsed = result.structured_output
    if parsed is None or not isinstance(parsed, output):
        _record(
            task,
            started,
            ok=False,
            error=f"no structured output (stop_reason={result.stop_reason})",
            region=region,
        )
        raise LLMError("Ally is having trouble thinking right now.", detail=f"{task}: no structured output")
    _record(task, started, ok=True, usage=_usage(result), region=region)
    return parsed


def _usage(result: Any) -> dict[str, Any]:
    try:
        return dict(result.metrics.accumulated_usage)
    except Exception:
        return {}


def _record(
    task: str,
    started: float,
    *,
    ok: bool,
    error: Any = None,
    usage: dict[str, Any] | None = None,
    region: str = AWS_REGION,
) -> None:
    ms = round((time.perf_counter() - started) * 1000)
    metric("LLMLatency", ms, "Milliseconds", Task=task)
    if not ok:
        metric("LLMError", 1, "Count", Task=task)
        log("llm_error", task=task, model=BEDROCK_MODEL_ID, region=region, ms=ms, error=str(error))
    else:
        log("llm_ok", task=task, model=BEDROCK_MODEL_ID, region=region, ms=ms, usage=usage or {})
