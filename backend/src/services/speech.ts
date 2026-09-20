/**
 * Voice I/O on AWS.
 *
 *   speech-to-text -> Amazon Transcribe Streaming, with automatic language
 *                     identification across en-IN and hi-IN so a Hinglish
 *                     speaker never has to pick a language first.
 *   text-to-speech -> Amazon Polly, voice Kajal, which speaks both Hindi and
 *                     Indian English on the generative engine.
 *
 * Both calls sit behind a circuit breaker: if Transcribe is unreachable the
 * check-in degrades to text chips instead of stalling the WebSocket turn.
 */

import {
  type AudioStream,
  type LanguageCode as TranscribeLanguage,
  StartStreamTranscriptionCommand,
} from "@aws-sdk/client-transcribe-streaming";
import {
  type Engine,
  type LanguageCode as PollyLanguage,
  SynthesizeSpeechCommand,
  type VoiceId,
} from "@aws-sdk/client-polly";
import { polly, transcribeStreaming } from "../aws/clients.js";
import { breaker } from "../aws/resilience.js";
import { config } from "../config.js";
import {
  detectLanguageFromText,
  normalizeLanguageCode,
  resolveTtsLanguage,
} from "./language.js";

export interface SttResult {
  text: string;
  language: string;
}

export interface TtsResult {
  audio_base64: string;
  mime_type: string;
  text: string;
}

export interface SpeechClient {
  transcribe(audio: Buffer, mimeType?: string): Promise<SttResult>;
  synthesize(text: string, language?: string): Promise<TtsResult>;
}

/** Transcribe identifies between these; the demo language is the tiebreaker. */
const LANGUAGE_OPTIONS: TranscribeLanguage[] = ["en-IN", "hi-IN"];
const CHUNK_BYTES = 8 * 1024;

interface Pcm {
  samples: Buffer;
  sampleRate: number;
}

/**
 * Read a PCM16 mono WAV into raw frames. The browser recorder
 * (`web/src/lib/recordWav.ts`) and the Wear OS `AudioBridge` both emit exactly
 * this, which is also exactly what Transcribe streaming accepts — so there is
 * no transcode step in the hot path.
 */
export function pcmFromWav(raw: Buffer): Pcm {
  if (raw.length < 44 || raw.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("Expected a PCM16 WAV clip (RIFF header missing)");
  }
  let offset = 12;
  let sampleRate = 16_000;
  let bitsPerSample = 16;
  let channels = 1;
  let samples: Buffer | null = null;

  while (offset + 8 <= raw.length) {
    const id = raw.toString("ascii", offset, offset + 4);
    const size = raw.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      channels = raw.readUInt16LE(body + 2);
      sampleRate = raw.readUInt32LE(body + 4);
      bitsPerSample = raw.readUInt16LE(body + 14);
    } else if (id === "data") {
      samples = raw.subarray(body, Math.min(body + size, raw.length));
      break;
    }
    offset = body + size + (size % 2);
  }

  if (!samples) throw new Error("WAV clip has no data chunk");
  if (bitsPerSample !== 16 || channels !== 1) {
    throw new Error(
      `Unsupported clip: ${channels}ch/${bitsPerSample}-bit (need mono PCM16)`
    );
  }
  return { samples, sampleRate };
}

async function* audioChunks(pcm: Buffer): AsyncGenerator<AudioStream> {
  for (let i = 0; i < pcm.length; i += CHUNK_BYTES) {
    yield { AudioEvent: { AudioChunk: pcm.subarray(i, i + CHUNK_BYTES) } };
  }
}

export class AwsSpeechClient implements SpeechClient {
  async transcribe(audio: Buffer, mimeType = "audio/wav"): Promise<SttResult> {
    const started = Date.now();
    const clean = mimeType.split(";")[0].trim().toLowerCase();
    if (clean && !/wav|pcm/.test(clean)) {
      throw new Error(
        `Amazon Transcribe streaming needs PCM16 WAV; received ${clean}. ` +
          "Record with startWavRecorder() on the web client."
      );
    }

    const { samples, sampleRate } = pcmFromWav(audio);

    const response = await breaker("transcribe", {
      threshold: 4,
      cooldownMs: 20_000,
    }).run(() =>
      transcribeStreaming().send(
        new StartStreamTranscriptionCommand({
          IdentifyLanguage: true,
          LanguageOptions: LANGUAGE_OPTIONS.join(","),
          PreferredLanguage: normalizeLanguageCode(
            config.demoLanguage,
            "hi-IN"
          ) as TranscribeLanguage,
          MediaEncoding: "pcm",
          MediaSampleRateHertz: sampleRate,
          AudioStream: audioChunks(samples),
        })
      )
    );

    const parts: string[] = [];
    let identified = "";
    for await (const event of response.TranscriptResultStream ?? []) {
      for (const result of event.TranscriptEvent?.Transcript?.Results ?? []) {
        if (result.IsPartial) continue;
        const alt = result.Alternatives?.[0]?.Transcript?.trim();
        if (alt) parts.push(alt);
        if (result.LanguageCode) identified = result.LanguageCode;
      }
    }

    const text = parts.join(" ").trim();
    // Transcribe reports the language of the audio; the text itself is the better
    // signal for code-mix, where a Hinglish line is often tagged en-IN.
    const language = detectLanguageFromText(
      text,
      normalizeLanguageCode(identified, config.demoLanguage)
    );
    console.log(
      `[transcribe] ${Date.now() - started}ms lang=${language} identified=${identified || "n/a"} chars=${text.length}`
    );
    return { text, language };
  }

  async synthesize(text: string, language = config.demoLanguage): Promise<TtsResult> {
    const started = Date.now();
    const target = resolveTtsLanguage(language, text);
    const engines: Engine[] =
      config.aws.pollyEngine === "generative"
        ? ["generative", "neural"]
        : [config.aws.pollyEngine as Engine];

    let lastErr: unknown = null;
    for (const engine of engines) {
      try {
        const audio = await breaker("polly").run(() =>
          polly().send(
            new SynthesizeSpeechCommand({
              Text: text.slice(0, 1500),
              OutputFormat: "mp3",
              VoiceId: config.aws.pollyVoice as VoiceId,
              LanguageCode: target as PollyLanguage,
              Engine: engine,
            })
          )
        );
        const bytes = await audio.AudioStream?.transformToByteArray();
        if (!bytes?.length) throw new Error("Polly returned no audio");
        console.log(
          `[polly] ${Date.now() - started}ms lang=${target} voice=${config.aws.pollyVoice} engine=${engine}`
        );
        return {
          audio_base64: Buffer.from(bytes).toString("base64"),
          mime_type: "audio/mpeg",
          text,
        };
      } catch (err) {
        lastErr = err;
        // The generative engine is not in every region; neural always is. Log the
        // downgrade rather than hiding it.
        const name = (err as { name?: string }).name ?? "";
        if (engine === "generative" && /EngineNotSupported|ValidationException/.test(name)) {
          console.warn(`[polly] generative unavailable for ${target}; retrying on neural`);
          continue;
        }
        throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Polly synthesis failed");
  }
}

/** Offline stand-in for CI and rehearsals with no network. Never used unless asked for. */
export class OfflineSpeechClient implements SpeechClient {
  async transcribe(): Promise<SttResult> {
    return { text: "I fell and I can't get up", language: config.demoLanguage };
  }

  async synthesize(text: string, language = config.demoLanguage): Promise<TtsResult> {
    const silentWav = Buffer.from(
      "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
      "base64"
    );
    return {
      audio_base64: silentWav.toString("base64"),
      mime_type: "audio/wav",
      text: `[offline-tts/${language}] ${text}`,
    };
  }
}

export function createSpeechClient(): SpeechClient {
  if (config.useOfflineSpeech) {
    console.log("[speech] OfflineSpeechClient (OFFLINE_SPEECH=true)");
    return new OfflineSpeechClient();
  }
  console.log(
    `[speech] Amazon Transcribe (${LANGUAGE_OPTIONS.join("/")}) + Amazon Polly ${config.aws.pollyVoice}/${config.aws.pollyEngine}`
  );
  return new AwsSpeechClient();
}
