/**
 * Smoke-test live Gemini + Sarvam (no mocks).
 * Usage: npx tsx scripts/live-smoke.ts
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, ".env") });

async function geminiSmoke() {
  const { GoogleGenAI } = await import("@google/genai");
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");
  const model = process.env.GEMINI_LIVE_MODEL ?? "gemini-2.5-flash";
  const ai = new GoogleGenAI({ apiKey: key });
  const t0 = Date.now();
  const res = await ai.models.generateContent({
    model,
    contents: "Reply with exactly: RAKSHAK_LIVE_OK",
  });
  const text = (res.text ?? "").trim();
  console.log(`[gemini] ${Date.now() - t0}ms · ${text.slice(0, 80)}`);
  if (!text) throw new Error("empty gemini response");
}

async function sarvamTtsSmoke() {
  const key = process.env.SARVAM_API_KEY;
  if (!key) throw new Error("SARVAM_API_KEY missing");
  const speaker = process.env.SARVAM_TTS_SPEAKER ?? "priya";
  const model = process.env.SARVAM_TTS_MODEL ?? "bulbul:v3";
  const lang = process.env.DEMO_LANGUAGE ?? "kn-IN";
  const t0 = Date.now();
  const res = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "api-subscription-key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: "ನಾನು ರಕ್ಷಕ್. ನಿಮ್ಮ ಜೊತೆ ಇದ್ದೇನೆ.",
      target_language_code: lang,
      speaker,
      model,
      pace: 1.0,
      speech_sample_rate: 24000,
      output_audio_codec: "wav",
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`TTS ${res.status}: ${body.slice(0, 300)}`);
  const data = JSON.parse(body) as { audios?: string[] };
  const len = data.audios?.[0]?.length ?? 0;
  console.log(`[sarvam-tts] ${Date.now() - t0}ms · audio_b64_len=${len} · voice=${speaker}`);
  if (!len) throw new Error("no audio returned");
}

async function main() {
  console.log("Live smoke · mock flag =", process.env.USE_MOCK_AI);
  await geminiSmoke();
  await sarvamTtsSmoke();
  console.log("OK — both live APIs responding");
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
