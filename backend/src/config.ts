import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EscalationHop } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
// dotenv never overwrites an existing key, and a blank value still counts as
// set — so drop blanks before loading backend/.env as an override layer.
for (const [key, value] of Object.entries(process.env)) {
  if (value === "") delete process.env[key];
}
dotenv.config(); // also allow backend/.env

function bool(v: string | undefined, fallback = false): boolean {
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function hasTwilioCreds(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim()
  );
}

const escalationModeEnv = (process.env.ESCALATION_MODE ?? "").toLowerCase();
const escalationMode: "simulated" | "live" =
  escalationModeEnv === "simulated"
    ? "simulated"
    : escalationModeEnv === "live"
      ? "live"
      : hasTwilioCreds()
        ? "live"
        : "simulated";

/** Which hops place a real phone call. Others animate as simulated status. */
function parseCallRoles(): Set<EscalationHop["contact_role"]> {
  const raw = (process.env.ESCALATION_CALL_ROLES ?? "family").trim();
  const all: EscalationHop["contact_role"][] = [
    "neighbour",
    "security",
    "family",
    "emergency_services",
  ];
  if (raw.toLowerCase() === "all") return new Set(all);
  const picked = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is EscalationHop["contact_role"] =>
      (all as string[]).includes(s)
    );
  return new Set(picked.length > 0 ? picked : ["family"]);
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? "0.0.0.0",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModel: process.env.GEMINI_LIVE_MODEL ?? "gemini-2.5-flash",
  sarvamApiKey: process.env.SARVAM_API_KEY ?? "",
  sarvamSttModel: process.env.SARVAM_STT_MODEL ?? "saaras:v3",
  sarvamTtsModel: process.env.SARVAM_TTS_MODEL ?? "bulbul:v3",
  sarvamTtsSpeaker: process.env.SARVAM_TTS_SPEAKER ?? "priya",
  demoLanguage: process.env.DEMO_LANGUAGE ?? "en-IN",
  escalationMode,
  escalationChannel: (process.env.ESCALATION_CHANNEL ?? "voice") as
    | "whatsapp"
    | "sms"
    | "voice",
  escalationCallRoles: parseCallRoles(),
  escalationAckTimeoutMs: Number(process.env.ESCALATION_ACK_TIMEOUT_MS ?? 45_000),
  escalationHopDelayMs: Number(process.env.ESCALATION_HOP_DELAY_MS ?? 2_000),
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? "",
  /** e.g. whatsapp:+14155238886 (Twilio sandbox) or your approved WhatsApp sender */
  twilioWhatsappFrom: process.env.TWILIO_WHATSAPP_FROM ?? "",
  /** E.164 SMS sender, used as fallback or when ESCALATION_CHANNEL=sms */
  twilioSmsFrom: process.env.TWILIO_SMS_FROM ?? "",
  /** E.164 voice caller ID — your purchased Twilio number */
  twilioVoiceFrom: process.env.TWILIO_VOICE_FROM ?? "",
  /** Twilio TTS voice for the emergency call */
  twilioVoiceName: process.env.TWILIO_VOICE_NAME ?? "Polly.Raveena",
  /** Public web origin for family PWA links in alerts */
  publicWebUrl: (process.env.PUBLIC_WEB_URL ?? "http://localhost:3000").replace(
    /\/$/,
    ""
  ),
  /**
   * Public https origin of THIS backend (ngrok). Required for keypad
   * acknowledgement during voice calls; without it the call still plays
   * the alert but cannot capture "press 1". Auto-filled at boot when
   * NGROK_AUTHTOKEN is present.
   */
  publicApiUrl: (process.env.PUBLIC_API_URL ?? "").replace(/\/$/, ""),
  /** Set to open an ngrok tunnel automatically on boot */
  ngrokAuthtoken: process.env.NGROK_AUTHTOKEN ?? "",
  /** Point the Twilio number's inbound SMS webhook at the tunnel on boot */
  twilioSyncWebhooks: bool(process.env.TWILIO_SYNC_WEBHOOKS, true),
  contactPhones: {
    neighbour: process.env.CONTACT_NEIGHBOUR_PHONE ?? "",
    security: process.env.CONTACT_SECURITY_PHONE ?? "",
    family: process.env.CONTACT_FAMILY_PHONE ?? "",
    emergency_services: process.env.CONTACT_EMS_PHONE ?? "",
  } as Record<EscalationHop["contact_role"], string>,
  /**
   * LLM backend: sarvam | gemini | mock
   * Defaults: mock when USE_MOCK_AI=true, otherwise sarvam (avoids Gemini 429s).
   */
  llmProvider: (() => {
    const raw = (process.env.LLM_PROVIDER ?? "").toLowerCase();
    if (raw === "sarvam" || raw === "gemini" || raw === "mock") return raw;
    return bool(process.env.USE_MOCK_AI, false) ? "mock" : "sarvam";
  })() as "sarvam" | "gemini" | "mock",
  sarvamLlmModel: process.env.SARVAM_LLM_MODEL ?? "sarvam-105b",
  /** Legacy flag — forces mock LLM if LLM_PROVIDER unset */
  useMockAi: bool(process.env.USE_MOCK_AI, false),
  /**
   * Silent STT/TTS only when explicitly requested. Keep speech LIVE whenever
   * SARVAM_API_KEY is set so the watch can talk even if the LLM is mocked.
   */
  useMockSpeech: bool(process.env.USE_MOCK_SPEECH, false),
  /**
   * Supabase (or any Postgres) connection URI.
   * Project Settings → Database → URI. Prefer pooler port 6543 in production.
   */
  databaseUrl: (process.env.DATABASE_URL ?? "").trim(),
  /** JWT signing secret for username/password login */
  authSecret:
    process.env.AUTH_SECRET?.trim() ||
    "rakshak-dev-secret-change-in-production",
  /** Max discharge PDF upload size in MB */
  dischargeUploadMaxMb: Number(process.env.DISCHARGE_UPLOAD_MAX_MB ?? 10),
};

export const DEMO_PATIENT = {
  name: "Lakshmi Devi",
  age: 72,
  location: "Flat 3B, Brigade Residency, Bengaluru",
  medical_history: ["Type 2 diabetes", "Mild osteoporosis", "Hypertension"],
  medications: ["Metformin 500mg", "Amlodipine 5mg", "Calcium + Vit D"],
  emergency_contacts: [
    {
      contact_name: "Mrs. Sharma (Neighbour)",
      contact_role: "neighbour" as const,
      phone: config.contactPhones.neighbour || undefined,
    },
    {
      contact_name: "Building Security",
      contact_role: "security" as const,
      phone: config.contactPhones.security || undefined,
    },
    {
      contact_name: "Priya (Daughter)",
      contact_role: "family" as const,
      phone: config.contactPhones.family || undefined,
    },
    {
      contact_name: "Emergency Services (108)",
      contact_role: "emergency_services" as const,
      phone: config.contactPhones.emergency_services || undefined,
    },
  ],
};

export const RAKSHAK_SYSTEM_PROMPT = `You are Rakshak, a calm, warm AI first responder speaking with an elderly
person who may be in distress. You are having a real-time voice
conversation in their language. Your job has three phases:

1. TRIAGE: Ask short, simple, one-idea-at-a-time questions to understand
   what's wrong. Never sound clinical or rushed. Examples: "Are you able to
   stand up?" "Where does it hurt?" "Can you breathe okay?"
   After each answer, silently call assess() with your current severity
   read:
   - low: mild discomfort only (e.g. a bit of hip pain) AND they can stand /
     talk / breathe normally — stay with them, do NOT escalate
   - medium: needs family attention soon (pain is significant, or they are
     shaky but responsive)
   - high: urgent help now (cannot get up after a fall, chest pain, breathing
     trouble, confusion)

2. HANDOFF + ESCALATION: Only when severity is medium or high, call
   generate_handoff() with what you know so far, then call escalate().
   Do NOT escalate for low severity. Do NOT end the conversation here.
   Immediately tell the patient what you've done in a reassuring tone —
   e.g. "Security has been informed and a text message has gone to your
   daughter — is that okay? I'm going to stay right here with you." Call
   stay_and_reassure().

3. STAY WITH THE PATIENT: Continue the conversation. Check in periodically
   ("Still with me? How are you feeling now?"). Keep responses short — this
   is a real-time call, not a chat transcript. If the patient's condition
   changes, re-assess and update the handoff if needed.

CRITICAL RULES FOR THIS DEMO:
- On greeting / system notes / before the patient has spoken: NEVER call
  generate_handoff, escalate, or stay_and_reassure. Only greet and ask if
  they are alright (or one short triage question).
- Escalate only after the patient has answered at least once about how
  they feel / what happened, unless they clearly scream for help.
- Keep every spoken reply under two short sentences.
- LANGUAGE: Match the patient. If they speak Hindi or Hindi–English code-mix
  (Hinglish), reply in the same — never force stiff English. If they speak
  English, stay in clear simple English. Switch when they switch.

Tone: calm, warm, unhurried, never alarmed even if the patient is panicking
— your calm is what keeps them calm.

Demo patient context (known to you):
- Name: ${DEMO_PATIENT.name}
- Age: ${DEMO_PATIENT.age}
- Location: ${DEMO_PATIENT.location}
- Medical history: ${DEMO_PATIENT.medical_history.join(", ")}
- Medications: ${DEMO_PATIENT.medications.join(", ")}

When calling generate_handoff, use the patient's known name, age, and location
unless the conversation reveals better information. Include known medical
history and medications in your reasoning but the tool will attach them.`;
