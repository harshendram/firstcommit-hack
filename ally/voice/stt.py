"""Speech-to-text. One configured provider per deployment — no silent fallback between providers.

sarvam (default): Saaras handles Hindi–English code-mix and other Indian languages well.
transcribe: Amazon Transcribe streaming (hi-IN / en-IN language identification).
"""

from __future__ import annotations

import httpx

from config import SARVAM_STT_MODE, SARVAM_STT_MODEL, STT_PROVIDER
from core.errors import AllyError, NotConfigured
from core.log import log
from core.secrets import secret
from voice.transcribe import Transcript, pcm_from_wav, transcribe_wav

SARVAM_URL = "https://api.sarvam.ai/speech-to-text"


class SttError(AllyError):
    status = 502
    code = "stt_unavailable"


async def transcribe(wav: bytes, preferred_language: str) -> Transcript:
    if STT_PROVIDER == "transcribe":
        return await transcribe_wav(wav, preferred_language)
    if STT_PROVIDER == "sarvam":
        return await _sarvam(wav, preferred_language)
    raise NotConfigured("Speech recognition is not configured.", detail=f"unknown STT provider {STT_PROVIDER!r}")


async def _sarvam(wav: bytes, preferred_language: str) -> Transcript:
    _, _, duration = pcm_from_wav(wav)  # validates format and clip length before we pay for a call
    key = secret("SARVAM_API_KEY")
    if not key:
        raise NotConfigured("Speech recognition is not configured.", detail="ALLY_SARVAM_API_KEY missing")
    data = {"model": SARVAM_STT_MODEL, "language_code": "unknown"}
    if SARVAM_STT_MODEL == "saaras:v3" and SARVAM_STT_MODE:
        data["mode"] = SARVAM_STT_MODE
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                SARVAM_URL,
                headers={"api-subscription-key": key},
                files={"file": ("clip.wav", wav, "audio/wav")},
                data=data,
            )
    except httpx.HTTPError as exc:
        log("stt_error", provider="sarvam", error=repr(exc))
        raise SttError("I couldn't hear that clearly. Please try again.", detail=repr(exc)) from exc
    if resp.status_code != 200:
        log("stt_error", provider="sarvam", status=resp.status_code, body=resp.text[:300])
        raise SttError("I couldn't hear that clearly. Please try again.", detail=f"sarvam {resp.status_code}")
    body = resp.json()
    language = str(body.get("language_code") or preferred_language)
    if language not in ("hi-IN", "en-IN"):
        # Ally replies in Hindi or English; other Indian languages are transcribed but answered in her language.
        language = preferred_language
    return Transcript(str(body.get("transcript") or "").strip(), language, duration)
