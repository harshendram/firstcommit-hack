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

export interface SarvamClient {
  transcribe(audio: Buffer, mimeType?: string): Promise<SttResult>;
  synthesize(text: string, language?: string): Promise<TtsResult>;
}

export class LiveSarvamClient implements SarvamClient {
  private baseUrl = "https://api.sarvam.ai";

  private headers(): HeadersInit {
    return {
      "api-subscription-key": config.sarvamApiKey,
    };
  }

  async transcribe(audio: Buffer, mimeType = "audio/wav"): Promise<SttResult> {
    const started = Date.now();
    // Chrome sends "audio/webm;codecs=opus" — Sarvam rejects codec params.
    const cleanMime = mimeType.split(";")[0].trim().toLowerCase() || "audio/wav";
    const ext =
      cleanMime.includes("webm")
        ? "webm"
        : cleanMime.includes("mpeg") || cleanMime.includes("mp3")
          ? "mp3"
          : cleanMime.includes("ogg") || cleanMime.includes("opus")
            ? "ogg"
            : "wav";
    const filename = `audio.${ext}`;
    const form = new FormData();
    const blob = new Blob([new Uint8Array(audio)], { type: cleanMime });
    form.append("file", blob, filename);
    form.append("model", config.sarvamSttModel);
    // Auto-detect language; codemix preserves Hindi–English mixing (Voice rubric).
    form.append("language_code", "unknown");
    form.append("mode", "codemix");

    const res = await fetch(`${this.baseUrl}/speech-to-text`, {
      method: "POST",
      headers: this.headers(),
      body: form,
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Sarvam STT failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as {
      transcript?: string;
      text?: string;
      language_code?: string;
    };

    const text = (data.transcript ?? data.text ?? "").trim();
    const language = detectLanguageFromText(
      text,
      normalizeLanguageCode(data.language_code, config.demoLanguage)
    );
    console.log(
      `[sarvam] STT ${Date.now() - started}ms lang=${language} mode=codemix`
    );
    return { text, language };
  }

  async synthesize(
    text: string,
    language = config.demoLanguage
  ): Promise<TtsResult> {
    const started = Date.now();
    const target = resolveTtsLanguage(language, text);
    const body = JSON.stringify({
      text,
      target_language_code: target,
      speaker: config.sarvamTtsSpeaker,
      model: config.sarvamTtsModel,
      pace: 1.0,
      speech_sample_rate: 24000,
      output_audio_codec: "wav",
    });

    let res: Response | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      res = await fetch(`${this.baseUrl}/text-to-speech`, {
        method: "POST",
        headers: {
          ...this.headers(),
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(25_000),
      });
      if (res.ok || ![502, 503, 504].includes(res.status) || attempt === 2) {
        break;
      }
      console.warn(`[sarvam] TTS ${res.status}; retrying once`);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    if (!res || !res.ok) {
      const errorBody = res ? await res.text() : "no response";
      throw new Error(
        `Sarvam TTS failed (${res?.status ?? "network"}): ${errorBody}`
      );
    }

    const data = (await res.json()) as {
      audios?: string[];
      request_id?: string;
    };

    const audio_base64 = data.audios?.[0] ?? "";
    if (!audio_base64) {
      throw new Error("Sarvam TTS returned no audio");
    }
    console.log(`[sarvam] TTS ${Date.now() - started}ms lang=${target}`);

    return {
      audio_base64,
      mime_type: "audio/wav",
      text,
    };
  }
}

/** Offline fallback only — never used unless USE_MOCK_SPEECH=true. */
export class MockSarvamClient implements SarvamClient {
  async transcribe(_audio: Buffer): Promise<SttResult> {
    return {
      text: "I fell and I can't get up",
      language: config.demoLanguage,
    };
  }

  async synthesize(text: string, language = config.demoLanguage): Promise<TtsResult> {
    const silentWav = Buffer.from(
      "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
      "base64"
    );
    return {
      audio_base64: silentWav.toString("base64"),
      mime_type: "audio/wav",
      text: `[mock-tts/${language}] ${text}`,
    };
  }
}

export function createSarvamClient(): SarvamClient {
  if (config.useMockSpeech) {
    console.log("[sarvam] Using MockSarvamClient (USE_MOCK_SPEECH=true)");
    return new MockSarvamClient();
  }
  if (!config.sarvamApiKey) {
    throw new Error(
      "SARVAM_API_KEY is required for live speech. Set the key in .env or USE_MOCK_SPEECH=true."
    );
  }
  console.log(
    `[sarvam] LIVE speech · stt=${config.sarvamSttModel} tts=${config.sarvamTtsModel} voice=${config.sarvamTtsSpeaker}`
  );
  return new LiveSarvamClient();
}
