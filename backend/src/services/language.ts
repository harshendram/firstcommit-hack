/**
 * Language helpers for the live voice path.
 * Amazon Transcribe and Polly use BCP-47 tags like hi-IN / en-IN.
 */

const TTS_SUPPORTED = new Set([
  "hi-IN",
  "bn-IN",
  "kn-IN",
  "ml-IN",
  "mr-IN",
  "od-IN",
  "pa-IN",
  "ta-IN",
  "te-IN",
  "en-IN",
  "gu-IN",
]);

/** Common Hinglish / Hindi romanized tokens an elder might use after a fall. */
const HINGLISH_HINT =
  /\b(main|mein|mujhe|mujhe|nahi|nahin|nahiin|bahut|dard|utha|uth|paati|paati|pa\s*rahi|pa\s*raha|gir\s*gayi|gir\s*gaya|madad|kripya|please\s+help|thoda|zyada|sakti|sakta|hoon|hun|hai|kya|kaise|accha|theek|didi|beti)\b/i;

const DEVANAGARI = /[\u0900-\u097F]/;
const GUJARATI = /[\u0A80-\u0AFF]/;
const TAMIL = /[\u0B80-\u0BFF]/;
const TELUGU = /[\u0C00-\u0C7F]/;
const KANNADA = /[\u0C80-\u0CFF]/;
const MALAYALAM = /[\u0D00-\u0D7F]/;
const BENGALI = /[\u0980-\u09FF]/;
const LATIN = /[A-Za-z]/;

export function normalizeLanguageCode(
  raw: string | undefined | null,
  fallback = "en-IN"
): string {
  if (!raw?.trim()) return fallback;
  let code = raw.trim().replace(/_/g, "-");
  // Upstream tags arrive as "hi" / "en" / "hi_in" too
  if (!code.includes("-")) {
    const base = code.toLowerCase();
    const map: Record<string, string> = {
      hi: "hi-IN",
      en: "en-IN",
      bn: "bn-IN",
      gu: "gu-IN",
      kn: "kn-IN",
      ml: "ml-IN",
      mr: "mr-IN",
      od: "od-IN",
      or: "od-IN",
      pa: "pa-IN",
      ta: "ta-IN",
      te: "te-IN",
      unknown: fallback,
    };
    code = map[base] ?? fallback;
  }
  // Fix casing: hi-in → hi-IN
  const parts = code.split("-");
  if (parts.length >= 2) {
    code = `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`;
  }
  return TTS_SUPPORTED.has(code) ? code : fallback;
}

export function looksLikeCodeMix(text: string): boolean {
  const hasIndic =
    DEVANAGARI.test(text) ||
    GUJARATI.test(text) ||
    TAMIL.test(text) ||
    TELUGU.test(text) ||
    KANNADA.test(text) ||
    MALAYALAM.test(text) ||
    BENGALI.test(text);
  const hasLatin = LATIN.test(text);
  if (hasIndic && hasLatin) return true;
  // Romanized Hindi mixed with English words
  if (hasLatin && HINGLISH_HINT.test(text) && /\b(i|my|the|and|but|please|help|okay|ok|fell|pain|hip|chest)\b/i.test(text)) {
    return true;
  }
  return HINGLISH_HINT.test(text) && hasLatin;
}

/** Infer a BCP-47 tag from typed/spoken text when STT didn't give one. */
export function detectLanguageFromText(
  text: string,
  hinted?: string | null
): string {
  if (hinted?.trim()) return normalizeLanguageCode(hinted);
  if (DEVANAGARI.test(text)) return "hi-IN";
  if (GUJARATI.test(text)) return "gu-IN";
  if (TAMIL.test(text)) return "ta-IN";
  if (TELUGU.test(text)) return "te-IN";
  if (KANNADA.test(text)) return "kn-IN";
  if (MALAYALAM.test(text)) return "ml-IN";
  if (BENGALI.test(text)) return "bn-IN";
  if (looksLikeCodeMix(text)) return "hi-IN";
  return "en-IN";
}

/**
 * Polly language for TTS. Code-mix / Hinglish → hi-IN so Indic words
 * pronounce correctly; pure English stays en-IN.
 */
export function resolveTtsLanguage(
  turnLanguage: string,
  textForHeuristics?: string
): string {
  const normalized = normalizeLanguageCode(turnLanguage);
  if (textForHeuristics && looksLikeCodeMix(textForHeuristics)) {
    return "hi-IN";
  }
  if (textForHeuristics && DEVANAGARI.test(textForHeuristics)) {
    return "hi-IN";
  }
  return normalized;
}

/** Prompt fragment injected into the LLM turn so "say" matches the patient. */
export function languageInstructionForLlm(
  language: string,
  patientText: string
): string {
  const code = normalizeLanguageCode(language);
  const codeMix = looksLikeCodeMix(patientText);

  if (codeMix || (code.startsWith("hi") && LATIN.test(patientText) && !DEVANAGARI.test(patientText))) {
    return [
      `[LANGUAGE] The patient is speaking Hindi–English code-mix (Hinglish).`,
      `Your "say" field MUST match that — natural Hinglish or Hindi, not formal English-only.`,
      `Example tone: "Theek hai, main yahin hoon. Kya aap uth sakti hain?"`,
      `Do not translate their words into stiff English.`,
    ].join(" ");
  }

  if (code.startsWith("hi") || DEVANAGARI.test(patientText)) {
    return [
      `[LANGUAGE] The patient is speaking Hindi (hi-IN).`,
      `Your "say" field MUST be in Hindi (Devanagari preferred, or clear Hinglish).`,
      `Keep it one short warm sentence. Do not reply only in English.`,
    ].join(" ");
  }

  if (code !== "en-IN") {
    return [
      `[LANGUAGE] The patient is speaking ${code}.`,
      `Your "say" field MUST be in that language (or natural code-mix with it).`,
      `Do not force English unless they switched to English.`,
    ].join(" ");
  }

  return `[LANGUAGE] Patient language: English (en-IN). Reply in clear, simple English.`;
}

export function familyEnRouteFallback(language: string): string {
  const code = normalizeLanguageCode(language);
  if (code.startsWith("hi")) {
    return "Aapki beti aa rahi hain. Main yahin aapke saath hoon.";
  }
  return "Your daughter's on her way. I'm staying right here with you.";
}

export function arrivalFallback(language: string): string {
  const code = normalizeLanguageCode(language);
  if (code.startsWith("hi")) {
    return "Aapki beti aa gayi hain. Achha hua aap theek hain.";
  }
  return "Your daughter's here now. I'm glad you're okay.";
}

export function helpComingLine(language: string): string {
  const code = normalizeLanguageCode(language);
  if (code.startsWith("hi")) {
    return "Security ko bata diya hai aur aapki beti ko text message bhej diya hai — theek hai na? Main yahin aapke saath hoon.";
  }
  return "Security has been informed and a text message has gone to your daughter — is that okay? I'm staying right here with you.";
}
