"""Speech-to-text: Amazon Transcribe streaming.

Amma speaks Hindi, Indian English, or a mix of the two in one sentence. Transcribe's
streaming language identification picks between hi-IN and en-IN per clip, with her
profile language as the tiebreaker, so she never has to choose a language first.

There is no second provider and no silent fallback: if Transcribe is unavailable the
API returns `stt_unavailable` and the tablet says so.
"""

from __future__ import annotations

from botocore.exceptions import BotoCoreError, ClientError

from core.errors import AllyError
from core.log import log
from voice.transcribe import Transcript, transcribe_wav


class SttError(AllyError):
    status = 502
    code = "stt_unavailable"


async def transcribe(wav: bytes, preferred_language: str) -> Transcript:
    try:
        return await transcribe_wav(wav, preferred_language)
    except (ClientError, BotoCoreError) as exc:
        log("stt_error", provider="transcribe", error=repr(exc))
        raise SttError("I couldn't hear that clearly. Please try again.", detail=repr(exc)) from exc
