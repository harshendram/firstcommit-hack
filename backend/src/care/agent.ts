import { ConverseCommand, type Message } from "@aws-sdk/client-bedrock-runtime";
import { bedrock, bedrockFailover } from "../aws/clients.js";
import { breaker, withFailover } from "../aws/resilience.js";
import { config } from "../config.js";
import { looksLikeCodeMix, normalizeLanguageCode } from "../services/language.js";
import { summariseHistoryForPrompt, type MemoryAnchor } from "./baseline.js";
import type { Baseline, CheckIn, PatientProfile, SymptomScores } from "./types.js";
import { EMPTY_SYMPTOMS } from "./types.js";


const PLACEHOLDERS = new Set([
  "(no content)",
  "no content",
  "null",
  "undefined",
  "none",
]);

function isDegenerate(text: string): boolean {
  return text.length === 0 || PLACEHOLDERS.has(text.trim().toLowerCase());
}

export interface AgentTurnResult {
  say: string;
  memoryCallback: string | null;
  symptoms: SymptomScores;
  medicationTaken: boolean | null;
  needsClarification: boolean;
  notes: string;
}

interface RawTurn {
  say?: unknown;
  memory_callback?: unknown;
  symptoms?: unknown;
  medication_taken?: unknown;
  needs_clarification?: unknown;
  notes?: unknown;
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

function extractJson(raw: string): RawTurn | null {
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1)) as RawTurn;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function cleanSpoken(raw: string): string {
  let text = raw
    .replace(/```(?:json)?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  text = text.replace(/^["'“”]+/, "").replace(/["'“”]+$/, "").trim();
  text = text.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  const sentences = text.match(/[^.!?]+[.!?]*/g);
  if (sentences && sentences.length > 2) {
    text = sentences.slice(0, 2).join(" ").trim();
  }
  return text;
}

function clampScore(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(3, Math.round(n)));
}

/**
 * Scores only ever climb within one check-in. The model sometimes returns a
 * clean zero row on a later turn, and a symptom the patient actually reported
 * must not disappear because of that.
 */
function parseSymptoms(value: unknown, previous: SymptomScores): SymptomScores {
  if (!value || typeof value !== "object") return { ...previous };
  const src = value as Record<string, unknown>;
  const merge = (key: keyof SymptomScores): number =>
    Math.max(previous[key], clampScore(src[key], previous[key]));
  return {
    pain: merge("pain"),
    fever: merge("fever"),
    wound: merge("wound"),
    breathlessness: merge("breathlessness"),
    dizziness: merge("dizziness"),
  };
}

/**
 * Deterministic floors where a model miss is unacceptable for the demo path.
 * Wound discharge and fever are the infection pair; a model that under-scores
 * either would send a patient heading for readmission home with a green.
 */
const SYMPTOM_FLOORS: { pattern: RegExp; key: keyof SymptomScores; score: number }[] =
  [
    {
      pattern:
        /(pus|pip|मवाद|riste|ris raha|discharge|oozing|bleeding|geela|गीला|damp dressing|patti geeli|smell|badbu|बदबू)/i,
      key: "wound",
      score: 3,
    },
    {
      pattern:
        /(ghav|zakhm|घाव|जख्म|wound|incision|tanke|टांके|stitches|dressing|patti|पट्टी)[^.!?]{0,28}(laal|red|सूज|sujan|garam|hot|warm|dard|pain)|(laal|red|सूजा|garam)[^.!?]{0,20}(ghav|zakhm|wound|tanke|dressing)/i,
      key: "wound",
      score: 2,
    },
    {
      pattern:
        /(tez bukhar|bukhar bahut|103|102|high fever|तेज़? बुखार|kaanp|shivering)/i,
      key: "fever",
      score: 2,
    },
    {
      // "thand lag" covers lagi / lag rahi / lagti — chills are a fever signal.
      pattern:
        /(bukhar|fever|बुखार|temperature|garam lag|feverish|halka bukhar|thand lag|thandi lag|ठंड लग|chills)/i,
      key: "fever",
      score: 1,
    },
    {
      pattern:
        /saans nahi aa rah|saans nahi le|dam ghut|can'?t breathe|cannot breathe|struggling to breathe/i,
      key: "breathlessness",
      score: 3,
    },
    {
      // Includes common STT garble: सकाल / sakal for साँस फूल
      pattern:
        /saans\s*phool|saas\s*phool|sakal\s*pa[dḍ]|साँस\s*फूल|सांस\s*फूल|सकाल\s*पड़|short of breath|breathless/i,
      key: "breathlessness",
      score: 2,
    },
    {
      // Pain that has turned around — the shape that matters post-op.
      pattern:
        /(dard|pain|दर्द)[^.!?]{0,24}(wapas|phir se|badh|zyada|worse|back|increase)|(wapas|phir se|zyada|badh gaya)[^.!?]{0,16}(dard|pain|दर्द)|kal se zyada|worse (than|today|ab)/i,
      key: "pain",
      score: 2,
    },
    {
      pattern: /(bahut dard|bardaasht nahi|unbearable|severe pain|बहुत दर्द)/i,
      key: "pain",
      score: 3,
    },
    {
      // Short yes after the memory follow-up about pain / mobility.
      pattern: /^(haan|haa|han|ji|ji haan|हाँ|हां|હા|yes|ha)[.!\s]*$/i,
      key: "pain",
      score: 2,
    },
  ];

const AFFIRM =
  /^(haan|haa|han|ji|ji haan|हाँ|हां|હા|yes|ha)\b|(bahut|बहुत)\s*(hai|है)|zyada\s*hai/i;

/**
 * Hindi puts negation after the noun ("koi laali nahi"), English before it
 * ("no redness"), so a bare keyword match is not enough — without this a
 * patient saying the wound is fine gets scored as if it were infected.
 */
const NEGATION =
  /\b(nahi+n?|nai|na)\b|नहीं|नही|\b(no|not|none|never|without)\b|bilkul theek|sab theek|koi (dikkat|problem|issue) nahi/i;

/** Split into clauses so "Nahi, dard hai" negates only the first clause. */
function clauseAround(text: string, index: number): string {
  let start = 0;
  let end = text.length;
  for (let i = index; i >= 0; i--) {
    if (/[,;।.!?]/.test(text[i])) {
      start = i + 1;
      break;
    }
  }
  for (let i = index; i < text.length; i++) {
    if (/[,;।.!?]/.test(text[i])) {
      end = i;
      break;
    }
  }
  return text.slice(start, end);
}

function isNegatedAround(text: string, index: number): boolean {
  return NEGATION.test(clauseAround(text, index));
}

/**
 * When the patient only says "haan / bahut hai", score the symptom the agent
 * just asked about — otherwise a clear "yes, the wound is red" lands green.
 */
export function applyContextualAffirmation(
  symptoms: SymptomScores,
  patientText: string,
  lastAgentText: string | null | undefined
): SymptomScores {
  const reply = patientText.trim();
  if (!lastAgentText || !AFFIRM.test(reply)) return symptoms;
  // "Nahi, bahut theek hai" opens with a denial — that is not an affirmation.
  if (NEGATION.test(reply.split(/[,;।.!?]/)[0] ?? "")) return symptoms;
  const q = lastAgentText.toLowerCase();
  const out = { ...symptoms };
  const bump = (key: keyof SymptomScores, score: number) => {
    if (out[key] < score) {
      out[key] = score;
      console.log(`[care-llm] contextual floor: ${key}=${score} (affirmed after probe)`);
    }
  };

  if (/ghav|zakhm|wound|tanke|dressing|patti|घाव|जख्म|टांके|पट्टी|laal|ris/.test(q))
    bump("wound", 2);
  else if (/bukhar|fever|बुखार|temperature|thand|chills|garam/.test(q))
    bump("fever", 1);
  else if (/saans|breath|साँस|सांस|phool/.test(q)) bump("breathlessness", 2);
  else if (/dard|pain|दर्द|ghutn|घुटन|knee|chalna|walk|कम|aisa feel/.test(q))
    bump("pain", 2);

  return out;
}

/** "ghav theek hai" denies the wound just as firmly as "koi laali nahi". */
const REASSURANCE = /theek hai|thik hai|thik ha|normal hai|sahi hai|ok hai|clear hai|fine/i;

const SYMPTOM_MENTION: Record<keyof SymptomScores, RegExp> = {
  wound:
    /ghav|zakhm|wound|incision|tanke|stitches|dressing|patti|laal|laali|red|ris|pus|discharge|घाव|जख्म|टांके|पट्टी/i,
  fever: /bukhar|fever|बुखार|temperature|thand|thandi|chills|garam|ठंड/i,
  pain: /dard|pain|दर्द/i,
  breathlessness: /saans|saas|breath|साँस|सांस|phool/i,
  dizziness: /chakkar|dizzy|चक्कर|light.?head/i,
};

/**
 * The model occasionally scores a symptom the patient explicitly denied, and
 * because scores only climb it then sticks for the rest of the check-in.
 * A clear denial with no affirming mention anywhere wins over the model.
 */
export function applyExplicitDenials(
  symptoms: SymptomScores,
  text: string
): SymptomScores {
  const out = { ...symptoms };
  for (const key of Object.keys(SYMPTOM_MENTION) as (keyof SymptomScores)[]) {
    const rx = new RegExp(SYMPTOM_MENTION[key].source, "gi");
    let mentioned = false;
    let affirmed = false;
    let match: RegExpExecArray | null;
    while ((match = rx.exec(text)) !== null) {
      mentioned = true;
      const clause = clauseAround(text, match.index);
      if (!NEGATION.test(clause) && !REASSURANCE.test(clause)) {
        affirmed = true;
        break;
      }
    }
    if (mentioned && !affirmed && out[key] > 0) {
      console.log(`[care-llm] denial override: ${key} ${out[key]} -> 0`);
      out[key] = 0;
    }
  }
  return out;
}

/** Exported so finalise can re-apply against the full patient transcript. */
export function applySymptomFloors(
  symptoms: SymptomScores,
  text: string
): SymptomScores {
  const out = { ...symptoms };
  for (const flag of SYMPTOM_FLOORS) {
    const match = flag.pattern.exec(text);
    if (!match) continue;
    if (isNegatedAround(text, match.index)) {
      console.log(`[care-llm] symptom floor skipped (negated): ${flag.key}`);
      continue;
    }
    if (out[flag.key] < flag.score) {
      out[flag.key] = flag.score;
      console.log(`[care-llm] symptom floor applied: ${flag.key}=${flag.score}`);
    }
  }
  return out;
}

/** True when spoken text negates an "improved" memory beat. */
function inventsBreathingRegression(say: string): boolean {
  return /breathing hasn'?t improved|breathing has not improved|breathing didn'?t improve|saans (theek )?nahi hui|hasn'?t improved like we discussed/i.test(
    say
  );
}

/**
 * Opening line the model cannot invert. Prefer the pre-built 2nd-person
 * Hinglish spokenOpening; fall back to a simple greeting + question.
 */
function deterministicOpening(
  name: string,
  spokenOpening?: string | null
): string {
  if (spokenOpening?.trim()) return spokenOpening.trim();
  const first = name.split(/\s+/)[0] || name;
  return `Namaste ${first}. Aaj ghutna kaisa lag raha hai — dard kam hai ya zyada?`;
}

/** Normalize for echo / overlap checks (strip punctuation, collapse space). */
function normalizeForEcho(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u0900-\u097F\u0A80-\u0AFF]/g, (ch) => ch) // keep Indic scripts
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the agent's "say" is mostly parroting the patient's last utterance
 * (or "Haan," + that utterance). Used to replace useless echo turns.
 */
export function isMostlyEcho(say: string, patientText: string): boolean {
  const s = normalizeForEcho(say);
  const p = normalizeForEcho(patientText);
  if (!s || !p) return false;
  if (s === p) return true;

  // "Haan, <patient words>" / "હા, <…>"
  const strippedAffirm = s.replace(
    /^(haan|haa|han|ji|ji haan|हाँ|हां|હા|yes|ha)\s+/i,
    ""
  );
  if (strippedAffirm && (strippedAffirm === p || p.includes(strippedAffirm) || strippedAffirm.includes(p))) {
    if (strippedAffirm.length >= Math.min(12, p.length)) return true;
  }

  // High token overlap — agent restated most of what the patient said.
  const pTokens = new Set(p.split(" ").filter((t) => t.length > 2));
  if (pTokens.size === 0) return false;
  const sTokens = s.split(" ").filter((t) => t.length > 2);
  if (sTokens.length === 0) return false;
  let hit = 0;
  for (const t of sTokens) {
    if (pTokens.has(t)) hit++;
  }
  const overlap = hit / sTokens.length;
  // Mostly a copy, and not a short generic ack like "Achha."
  return overlap >= 0.65 && sTokens.length >= 3 && !s.trim().endsWith("?");
}

/** Check-in register, not the emergency register the fall agent used. */
function careLanguageInstruction(language: string, patientText: string): string {
  const code = normalizeLanguageCode(language);
  if (looksLikeCodeMix(patientText) || code.startsWith("hi")) {
    return [
      "[LANGUAGE] She is speaking Hindi–English code-mix (Hinglish), with",
      'medicine names in English. Reply the same way — e.g. "Achha, aur ghav ke',
      'paas laali hai kya?" Do not answer in stiff English or formal Hindi.',
    ].join(" ");
  }
  if (code !== "en-IN") {
    return `[LANGUAGE] She is speaking ${code}. Reply in that language or natural code-mix with it.`;
  }
  return "[LANGUAGE] She is speaking English (en-IN). Reply in clear, simple English.";
}

function parseTriState(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const raw = String(value ?? "").toLowerCase().trim();
  if (["true", "yes", "taken", "1"].includes(raw)) return true;
  if (["false", "no", "missed", "0"].includes(raw)) return false;
  return null;
}

/** Agent (or patient) language that counts as covering medication. */
export const MEDICATION_TOPIC =
  /antibiotic|antibiotics|dawai|dawa|medicine|medication|tablet|goli|गोली|दवा|pain.?med|paracetamol|amox|dawaiya[nñ]?/i;

/** Pain / surgical-site discomfort (greeting or follow-up). */
export const PAIN_TOPIC =
  /dard|pain|दर्द|ghutn|घुटन|knee|aches?|soreness|takleef|तकलीफ/i;

/** Mobility / walking coverage (optional bonus — not required to finalize in demo). */
export const MOBILITY_TOPIC =
  /walk|walking|\bchal\b|chali|chala|chal\s*pa|ghum|ghoom|mobility|\bsteps\b|pair\s*chal|टहल|टहला|सीढ़|stairs|manzil|do\s*baar\s*walk|walk\s*kar/i;

const MED_TAKEN =
  /le\s*li|le\s*liya|le\s*liye|kha\s*li|kha\s*liya|taken|le\s*li\s*hai|pi\s*li/i;
const MED_MISSED =
  /nahi\s*li|nahi\s*liya|nahi\s*liye|missed|bhool|bhul|forgot|skip|nahin\s*li/i;

/**
 * Infer adherence only from what the patient said — never invent true/false.
 * Returns null when the utterance does not clearly address medication.
 */
export function inferMedicationTaken(
  patientText: string,
  lastAgentText?: string | null
): boolean | null {
  const text = patientText.trim();
  if (!text) return null;
  const agentAsked = Boolean(
    lastAgentText && MEDICATION_TOPIC.test(lastAgentText)
  );
  const patientMentionsMeds = MEDICATION_TOPIC.test(text);
  const clearTaken = MED_TAKEN.test(text);
  const clearMissed = MED_MISSED.test(text);

  // Volunteered / chip-style: "Haan, aaj ki antibiotic le li."
  if (patientMentionsMeds && clearMissed) return false;
  if (patientMentionsMeds && clearTaken) return true;

  // Short "haan" / "nahi" after an explicit meds probe.
  if (agentAsked) {
    if (clearMissed || /^(nahi+|nai|na|no)\b/i.test(text)) return false;
    if (AFFIRM.test(text) || clearTaken) return true;
  }

  return null;
}

export function sayCoversMedication(say: string): boolean {
  return MEDICATION_TOPIC.test(say);
}

export function sayCoversPain(say: string): boolean {
  return PAIN_TOPIC.test(say);
}

export function sayCoversMobility(say: string): boolean {
  return MOBILITY_TOPIC.test(say);
}

export interface TopicCoverage {
  feeling: boolean;
  medication: boolean;
  /** Pain asked by agent and answered, or patient volunteered pain language. */
  pain: boolean;
  /** Optional — walk is a bonus if volunteered, not a finalize gate in demo mode. */
  mobility: boolean;
}

/** Demo-tight topics that must be covered before wrap. */
export function assessTopicCoverage(
  transcript: Array<{ speaker: string; text: string }>,
  medicationTaken: boolean | null
): TopicCoverage {
  const patientTurns = transcript.filter((t) => t.speaker === "patient");
  // Opening always asks how they feel — one patient reply covers it.
  const feeling = patientTurns.length >= 1;

  let medication = medicationTaken !== null;
  let pain = false;
  let mobility = false;

  for (let i = 0; i < transcript.length; i++) {
    const turn = transcript[i];
    if (turn.speaker !== "patient") continue;

    let priorAgent: string | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (transcript[j].speaker === "agent") {
        priorAgent = transcript[j].text;
        break;
      }
    }
    if (inferMedicationTaken(turn.text, priorAgent) !== null) medication = true;
    if (
      PAIN_TOPIC.test(turn.text) ||
      (priorAgent && PAIN_TOPIC.test(priorAgent) && turn.text.trim().length > 0)
    ) {
      pain = true;
    }
    if (
      MOBILITY_TOPIC.test(turn.text) ||
      (priorAgent &&
        MOBILITY_TOPIC.test(priorAgent) &&
        turn.text.trim().length > 0)
    ) {
      mobility = true;
    }
  }

  return { feeling, medication, pain, mobility };
}

export function remainingRequiredTopics(coverage: TopicCoverage): string[] {
  const missing: string[] = [];
  if (!coverage.feeling) missing.push("how they feel today");
  if (!coverage.medication)
    missing.push("medication adherence (asked once and answered)");
  if (!coverage.pain) missing.push("pain (greeting follow-up or second ask)");
  return missing;
}

/**
 * Combined pain + meds probe for the demo's second agent turn.
 * Prefer this over a bare antibiotic re-ask.
 */
export const PAIN_AND_MEDS_FALLBACK_ASK =
  "Achha. Dard kaisa hai aaj, aur aaj ki medicine le li?";

/** Spoken fallback when only medication remains (pain already touched). */
export const MEDICATION_FALLBACK_ASK =
  "Achha. Aaj ki medicine time pe le li kya?";

/** Pain-only probe when meds are already answered. */
export const PAIN_FALLBACK_ASK = "Achha. Dard kaisa hai aaj — kam hai ya zyada?";

export const MOBILITY_FALLBACK_ASK =
  "Aur aaj walk kar paayi — discharge ke hisaab se do baar?";

/** Red-flag language that may justify one extra clarify turn. */
export const RED_FLAG_LANGUAGE =
  /bukhar|fever|बुखार|pus|pip|मवाद|ris\s*rah|discharge|oozing|saans\s*(nahi|phool)|breathless|chakkar|dizzy|चक्कर|bleeding|badbu|बदबू|unbearable|bardaasht\s*nahi|tez\s*dard|severe\s*pain/i;

function buildSystemPrompt(
  patient: PatientProfile,
  history: CheckIn[],
  baseline: Baseline
): string {
  return `You are Rakshak, a warm post-discharge care companion checking in on ${patient.name}, age ${patient.age}.
She is recovering at home after ${patient.procedure}, discharged on ${patient.discharged_on} — today is post-operative day ${baseline.post_op_day}.
This is a SHORT demo check-in (about 3 agent speaking turns: greet → one follow-up → close). Every "say" is ONE short sentence. Never a paragraph, never a list.

Patient:
- Other conditions: ${patient.conditions.join(", ")}
- Discharge medications: ${patient.medications.join(", ")}
${
  patient.discharge_summary
    ? `
DISCHARGE SUMMARY (from uploaded document — treat as ground truth for follow-ups):
${patient.discharge_summary}
`
    : ""
}

You have their recovery history. Use it — do not start from zero every day:
${summariseHistoryForPrompt(history, baseline)}

DEMO FLOW — keep it tight (do NOT drag to 5–6 turns):
1. Opening (already done): how they feel today vs recent days (pain may be in the greeting).
2. NEXT turn after their first reply: ask about PAIN and MEDICATIONS in ONE combined question
   (Hinglish), e.g. "Dard kaisa hai aaj, aur aaj ki medicine le li?"
3. After they answer that: wrap — set needs_clarification false. Do NOT ask another topic.
Walk / stairs are optional bonus if they volunteer — do NOT require a separate walk turn.

REQUIRED before wrap (only these):
1. Feeling answered (their reply to the greeting)
2. Medication asked ONCE and answered (medication_taken true or false)
3. Pain touched (in greeting and/or the combined second question)

medication_taken must stay null until they have clearly answered (spoken or chip).
Never invent true/false. If they already volunteered meds ("aaj ki antibiotic le li" /
"medicine le li"), set medication_taken and NEVER re-ask about antibiotics or meds.
If medication_taken is already true or false, do not mention medicine/antibiotic again.

Your job each turn:
1. Acknowledge briefly ("Achha", "Samajh gayi"), then ask ONE short question OR close.
2. When you use history, put a brief clinical English line in "memory_callback" (banner only).
   Spoken "say" must address the patient in 2nd person (aap/you).
3. Score what you actually heard. Never invent a symptom they did not mention.
4. Vague answers ("thoda ajeeb") → needs_clarification true and ONE specific follow-up.
   Short affirmations ("haan") after a clear probe count as answered for that probe.
5. Default path: after the pain+meds answer, set needs_clarification false (non-question close
   or empty wrap — the system will speak the outcome). Only keep clarifying for red-flag
   language (fever, wound discharge, severe pain, breathlessness) — at most one extra ask.

NEVER ECHO / PARROT:
- Do NOT repeat the patient's words back as the whole "say".
- Never re-ask a topic they already answered — especially medication / antibiotic.
- Never start with હા/Haan and then paste their prior utterance.

Scoring anchors — use these exactly, do not invent your own scale:
- pain: 1 = mild, settles with Paracetamol, 2 = back to where it was in the
  first week or disturbing sleep, 3 = severe or unbearable.
- fever: 1 = feels warm, chills at night, low-grade, 2 = a measured fever or
  shivering, 3 = high fever.
- wound: 1 = mild redness or tightness around the incision, 2 = clearly red,
  hot or swollen, 3 = any discharge, pus, bleeding or smell.
- breathlessness: 1 = only on exertion, 2 = while walking on flat ground,
  3 = at rest.
- dizziness: 1 = brief light-headedness, 2 = repeated, 3 = nearly fainted.
Only score above 0 for symptoms the patient actually described.

You do NOT decide risk, and you do NOT tell the patient to see a doctor.
The clinical system decides that after you finish. Never promise an outcome.

OUTPUT FORMAT — absolute. Reply with ONLY one JSON object, no markdown fences:
{"say":"<one short spoken sentence>",
 "memory_callback":"<what you referenced from their history, or empty>",
 "symptoms":{"pain":0,"fever":0,"wound":0,"breathlessness":0,"dizziness":0},
 "medication_taken":true|false|null,
 "needs_clarification":true|false,
 "notes":"<short clinical note, not spoken>"}

LANGUAGE: match the patient. They usually speak Hindi–English code-mix
(Hinglish) and say medicine names in English. Reply the same way — natural
Hinglish, not stiff English, not pure formal Hindi. Switch if they switch.`;
}

/**
 * Daily check-in conversation. Same single-JSON-per-turn contract as the
 * emergency agent — one Bedrock round trip per turn keeps watch latency low.
 */
export class CareAgent {
  private messages: ChatMessage[] = [];
  private symptoms: SymptomScores = { ...EMPTY_SYMPTOMS };
  private medicationTaken: boolean | null = null;
  /** Last patient utterance with enough content to detect paraphrased echoes. */
  private lastSubstantialPatient = "";

  start(patient: PatientProfile, history: CheckIn[], baseline: Baseline): void {
    this.messages = [
      { role: "system", content: buildSystemPrompt(patient, history, baseline) },
    ];
    this.symptoms = { ...EMPTY_SYMPTOMS };
    this.medicationTaken = null;
    this.lastSubstantialPatient = "";
  }

  reset(): void {
    this.messages = [];
    this.symptoms = { ...EMPTY_SYMPTOMS };
    this.medicationTaken = null;
    this.lastSubstantialPatient = "";
  }

  get draftSymptoms(): SymptomScores {
    return { ...this.symptoms };
  }

  get draftMedication(): boolean | null {
    return this.medicationTaken;
  }

  async openingTurn(
    patientName: string,
    anchor?: MemoryAnchor | null
  ): Promise<AgentTurnResult> {
    // Prefer the deterministic 2nd-person Hinglish opening so the model cannot
    // speak clinical third-person ("she told you", "2.3/3").
    if (anchor?.spokenOpening || anchor?.fallback) {
      const say = deterministicOpening(patientName, anchor.spokenOpening);
      this.messages.push({
        role: "user",
        content: [
          "[SYSTEM NOTE] Start today's check-in with this exact opening (already chosen):",
          say,
          anchor.forPrompt,
          "Do not score any symptom above 0 yet. Acknowledge in the next turns only.",
          "memory_callback for the banner is the clinical English clause — do not speak it.",
        ].join("\n"),
      });
      this.messages.push({
        role: "assistant",
        content: JSON.stringify({
          say,
          memory_callback: anchor.fallback,
          symptoms: this.symptoms,
          medication_taken: null,
          needs_clarification: true,
        }),
      });
      return {
        say,
        memoryCallback: anchor.fallback,
        symptoms: { ...this.symptoms },
        medicationTaken: null,
        needsClarification: true,
        notes: "",
      };
    }

    this.messages.push({
      role: "user",
      content:
        "[SYSTEM NOTE] Start today's check-in. Greet them by name (2nd person aap/you) and ask how they are feeling today compared with recent days. Keep it to two short sentences at most. Do not score any symptom above 0 yet. Never say she/her about the patient.",
    });
    return this.complete();
  }

  async patientTurn(text: string, language: string): Promise<AgentTurnResult> {
    // Deterministic med parse from this utterance before the model runs, so a
    // chip like "aaj ki antibiotic le li" is never left null / invented later.
    const lastAgentSay = [...this.messages]
      .reverse()
      .find((m) => m.role === "assistant")?.content;
    let priorAgentText: string | null = null;
    if (lastAgentSay) {
      try {
        priorAgentText = String(
          (JSON.parse(lastAgentSay) as RawTurn).say ?? ""
        );
      } catch {
        priorAgentText = null;
      }
    }
    const inferredMed = inferMedicationTaken(text, priorAgentText);
    if (inferredMed !== null) this.medicationTaken = inferredMed;

    const missing: string[] = [];
    if (this.medicationTaken === null) {
      missing.push(
        "medication + pain in ONE combined question (e.g. dard kaisa hai, aur aaj ki medicine le li?)"
      );
    }
    const coverageHint =
      missing.length > 0
        ? `[REQUIRED — DEMO] ${missing.join("; ")}. Ask once, keep needs_clarification true. Do NOT invent medication_taken. Do NOT ask walk separately.`
        : "[REQUIRED — DEMO] Medication answered. Do NOT re-ask antibiotic/medicine. If no red flags, set needs_clarification false (non-question close). Walk is optional if they already volunteered it.";

    this.messages.push({
      role: "user",
      content: [
        careLanguageInstruction(language, text),
        "",
        `Patient said: ${text}`,
        "",
        coverageHint,
        this.medicationTaken !== null
          ? `[MEDS ALREADY KNOWN] medication_taken=${this.medicationTaken}. Never ask about medicine/antibiotic again.`
          : "",
        "",
        "[ANTI-ECHO] Acknowledge briefly then ask ONE new clarifying question — or close if topics are done. Do not repeat their words.",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    const result = await this.complete();
    this.symptoms = applyExplicitDenials(
      applySymptomFloors(this.symptoms, text),
      text
    );

    const echoAgainst = [text, this.lastSubstantialPatient].filter(Boolean);
    let say = result.say;
    const echoed = echoAgainst.some((prior) => isMostlyEcho(say, prior));
    if (echoed || inventsBreathingRegression(say)) {
      console.log("[care-llm] echo/regression detected — replacing say");
      say =
        this.medicationTaken === null
          ? PAIN_AND_MEDS_FALLBACK_ASK
          : "Achha, samajh gayi.";
      // Patch the last assistant message so history stays consistent.
      const last = this.messages[this.messages.length - 1];
      if (last?.role === "assistant") {
        try {
          const parsed = JSON.parse(last.content) as RawTurn;
          parsed.say = say;
          parsed.needs_clarification = this.medicationTaken === null;
          last.content = JSON.stringify(parsed);
        } catch {
          /* leave as-is */
        }
      }
    }

    // Never let the model re-ask meds once we already know the answer.
    if (
      this.medicationTaken !== null &&
      sayCoversMedication(say) &&
      say.trim().endsWith("?")
    ) {
      console.log("[care-llm] suppressing medication re-ask (already known)");
      say = "Achha, samajh gayi.";
    }

    // Remember contentful patient lines for next-turn echo checks (e.g. after "હા").
    if (normalizeForEcho(text).split(" ").filter((t) => t.length > 2).length >= 2) {
      this.lastSubstantialPatient = text;
    }

    // Meds unknown → must keep clarifying. Meds known → only red-flag-style
    // probes the model still wants (never a medication re-ask).
    const needsClarification =
      this.medicationTaken === null ||
      (result.needsClarification &&
        say.trim().endsWith("?") &&
        !sayCoversMedication(say));

    return {
      ...result,
      say,
      medicationTaken: this.medicationTaken,
      symptoms: { ...this.symptoms },
      needsClarification,
    };
  }

  /** Closing line once the clinical system has decided. Kept separate so the
   *  agent never announces a risk level it did not compute. */
  async closingTurn(
    recommendationForPatient: string,
    language: string
  ): Promise<string> {
    this.messages.push({
      role: "user",
      content: [
        `[SYSTEM NOTE] The check-in is complete. Tell the patient this outcome in ONE short warm sentence, in their language: "${recommendationForPatient}"`,
        `Reply with the same JSON object format. Set needs_clarification to false. Do NOT ask a question.`,
        `Your "say" must convey the same meaning as the outcome above — do not say things look "steady" or "theek" if the outcome mentions the doctor.`,
        careLanguageInstruction(language, recommendationForPatient),
      ].join("\n"),
    });
    const result = await this.complete();
    // Never let the model invent a conflicting close — prefer the mechanical line.
    const say = result.say.trim();
    if (
      !say ||
      inventsBreathingRegression(say) ||
      (/\b(steady|theek|sab theek)\b/i.test(say) &&
        /doctor|call|bata rahi/i.test(recommendationForPatient))
    ) {
      return recommendationForPatient;
    }
    return say;
  }

  private async complete(): Promise<AgentTurnResult> {
    const raw = await this.request(this.messages);
    const parsed = extractJson(raw);

    let say = cleanSpoken(String(parsed?.say ?? (parsed ? "" : raw)));
    if (isDegenerate(say)) {
      say = "";
    }

    this.symptoms = parseSymptoms(parsed?.symptoms, this.symptoms);
    const med = parseTriState(parsed?.medication_taken);
    if (med !== null) this.medicationTaken = med;

    const memoryCallback = String(parsed?.memory_callback ?? "").trim() || null;
    const notes = String(parsed?.notes ?? "").trim();
    // Refuse to "complete" while medication adherence is still unknown.
    // Trailing "?" alone must not keep the chat open once meds are known —
    // the orchestrator owns red-flag clarifies and demo turn caps.
    const needsClarification =
      this.medicationTaken === null || parsed?.needs_clarification === true;

    this.messages.push({
      role: "assistant",
      content: JSON.stringify({
        say,
        memory_callback: memoryCallback ?? "",
        symptoms: this.symptoms,
        medication_taken: this.medicationTaken,
        needs_clarification: needsClarification,
      }),
    });
    this.trimHistory();

    return {
      say: say || "I'm here with you. How are you feeling today?",
      memoryCallback,
      symptoms: { ...this.symptoms },
      medicationTaken: this.medicationTaken,
      needsClarification,
      notes,
    };
  }

  private trimHistory(): void {
    const MAX = 16;
    if (this.messages.length <= MAX + 1) return;
    this.messages = [
      this.messages[0],
      ...this.messages.slice(this.messages.length - MAX),
    ];
  }

  /**
   * One Bedrock Converse round trip per turn.
   *
   * Converse keeps the system prompt out of the message list, so the rolling
   * window below never risks trimming away the patient's care context. A
   * region-shaped failure retries the whole turn in the failover region before
   * giving up; everything else (throttles, 5xx) is already handled by the SDK's
   * adaptive retry policy.
   */
  private async request(messages: ChatMessage[]): Promise<string> {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => ({ text: m.content }));
    const turns: Message[] = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: [{ text: m.content }],
      }));

    const send = (client: ReturnType<typeof bedrock>) =>
      client.send(
        new ConverseCommand({
          modelId: config.aws.bedrockModelId,
          system,
          messages: turns,
          inferenceConfig: { maxTokens: config.aws.bedrockMaxTokens, temperature: 0.3 },
        })
      );

    const started = Date.now();
    const { result, failedOver } = await breaker("bedrock.care", {
      threshold: 4,
      cooldownMs: 20_000,
    }).run(() =>
      withFailover(
        "bedrock.care",
        () => send(bedrock()),
        () => send(bedrockFailover())
      )
    );

    const content = (result.output?.message?.content ?? [])
      .map((b) => b.text ?? "")
      .join("")
      .trim();
    console.log(
      `[care-llm] bedrock ${config.aws.bedrockModelId} ${Date.now() - started}ms` +
        ` region=${failedOver ? config.aws.bedrockFailoverRegion : config.aws.bedrockRegion}` +
        ` chars=${content.length}`
    );
    return isDegenerate(content) ? "" : content;
  }
}
