"""Amazon Transcribe streaming for 16 kHz PCM16 WAV clips from the browser recorder.

Hindi and Indian English are supported. In "identify" mode Transcribe chooses per clip between
en-IN and hi-IN (preferring the parent's language); in "fixed" mode it uses her language only.
"""

from __future__ import annotations

import asyncio
import io
import wave
from dataclasses import dataclass

from config import AWS_REGION, TRANSCRIBE_MODE
from core.errors import AllyError

MAX_CLIP_SECONDS = 12
LANGUAGE_OPTIONS = ["en-IN", "hi-IN"]


class BadAudio(AllyError):
    status = 400
    code = "bad_audio"


@dataclass
class Transcript:
    text: str
    language: str
    duration_sec: float


def pcm_from_wav(raw: bytes) -> tuple[bytes, int, float]:
    try:
        with wave.open(io.BytesIO(raw), "rb") as wav:
            rate, width, channels = wav.getframerate(), wav.getsampwidth(), wav.getnchannels()
            frames = wav.readframes(wav.getnframes())
    except (wave.Error, EOFError) as exc:
        raise BadAudio("That recording could not be read. Please try again.", detail=repr(exc)) from exc
    if width != 2 or channels != 1:
        raise BadAudio("Unsupported recording format.", detail=f"width={width} channels={channels}")
    duration = len(frames) / 2 / rate
    if duration > MAX_CLIP_SECONDS + 0.5:
        raise BadAudio("That recording was too long. Please keep it short.", detail=f"{duration:.1f}s")
    return frames, rate, duration


async def transcribe_wav(raw: bytes, preferred_language: str) -> Transcript:
    from amazon_transcribe.client import TranscribeStreamingClient
    from amazon_transcribe.handlers import TranscriptResultStreamHandler
    from amazon_transcribe.model import TranscriptEvent

    pcm, rate, duration = pcm_from_wav(raw)
    texts: list[str] = []
    detected: list[str] = []

    class Handler(TranscriptResultStreamHandler):
        async def handle_transcript_event(self, transcript_event: TranscriptEvent) -> None:
            for result in transcript_event.transcript.results:
                if result.is_partial or not result.alternatives:
                    continue
                texts.append(result.alternatives[0].transcript)
                if getattr(result, "language_code", None):
                    detected.append(result.language_code)

    client = TranscribeStreamingClient(region=AWS_REGION)
    if TRANSCRIBE_MODE == "identify":
        stream = await client.start_stream_transcription(
            language_code=None,
            identify_language=True,
            language_options=LANGUAGE_OPTIONS,
            preferred_language=preferred_language if preferred_language in LANGUAGE_OPTIONS else "hi-IN",
            media_sample_rate_hz=rate,
            media_encoding="pcm",
        )
    else:
        stream = await client.start_stream_transcription(
            language_code=preferred_language,
            media_sample_rate_hz=rate,
            media_encoding="pcm",
        )

    async def write() -> None:
        chunk = 8 * 1024
        for i in range(0, len(pcm), chunk):
            await stream.input_stream.send_audio_event(audio_chunk=pcm[i : i + chunk])
        await stream.input_stream.end_stream()

    await asyncio.gather(write(), Handler(stream.output_stream).handle_events())
    language = detected[-1] if detected else preferred_language
    return Transcript(" ".join(t.strip() for t in texts if t.strip()).strip(), language, duration)
