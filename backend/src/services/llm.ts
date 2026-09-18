import { config } from "../config.js";
import {
  createGeminiClient,
  MockGeminiClient,
  type GeminiClient,
} from "./gemini.js";
import { LiveSarvamLlmClient } from "./sarvamLlm.js";

/** Pick the reasoning backend: Sarvam LLM (default), Gemini, or mock. */
export function createLlmClient(): GeminiClient {
  if (config.llmProvider === "mock") {
    console.log("[llm] Using MockGeminiClient (LLM_PROVIDER=mock)");
    return new MockGeminiClient();
  }
  if (config.llmProvider === "sarvam") {
    if (!config.sarvamApiKey) {
      throw new Error("SARVAM_API_KEY is required when LLM_PROVIDER=sarvam");
    }
    console.log(`[llm] SARVAM · model=${config.sarvamLlmModel}`);
    return new LiveSarvamLlmClient();
  }
  return createGeminiClient();
}
