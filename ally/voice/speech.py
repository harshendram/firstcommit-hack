"""Amazon Polly. Kajal speaks both Hindi and Indian English."""

from __future__ import annotations

import asyncio
import base64
from functools import lru_cache
from typing import Any

import boto3
from botocore.exceptions import ClientError

from config import AWS_REGION, POLLY_ENGINE, POLLY_VOICE
from core.log import log


@lru_cache(maxsize=1)
def _polly() -> Any:
    return boto3.client("polly", region_name=AWS_REGION)


def _synthesize(text: str, language: str, engine: str) -> bytes:
    resp = _polly().synthesize_speech(
        Text=text[:1500],
        OutputFormat="mp3",
        VoiceId=POLLY_VOICE,
        LanguageCode=language,
        Engine=engine,
    )
    return resp["AudioStream"].read()


async def synthesize(text: str, language: str) -> dict[str, Any]:
    language = language if language in ("hi-IN", "en-IN") else "en-IN"
    try:
        audio = await asyncio.to_thread(_synthesize, text, language, POLLY_ENGINE)
        engine = POLLY_ENGINE
    except ClientError as err:
        code = err.response.get("Error", {}).get("Code")
        if POLLY_ENGINE == "neural" or code not in ("EngineNotSupportedException", "ValidationException"):
            raise
        # Generative Kajal is not in every region; neural is. Logged, not hidden.
        log("polly_engine_fallback", wanted=POLLY_ENGINE, used="neural", error=str(err))
        audio = await asyncio.to_thread(_synthesize, text, language, "neural")
        engine = "neural"
    return {
        "audio_base64": base64.b64encode(audio).decode(),
        "mime_type": "audio/mpeg",
        "text": text,
        "language": language,
        "provider": f"polly:{POLLY_VOICE}:{engine}",
    }
