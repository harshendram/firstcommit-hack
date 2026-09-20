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

/**
 * Delivery is "live" only when a channel can actually reach a person: a way to
 * send (Amazon SNS needs just a region; Amazon Connect needs an instance and a
 * contact flow) *and* somewhere to send to. Without a destination the chain
 * animates as simulated rather than logging a delivery error per hop, which is
 * what a fresh checkout should do.
 */
function hasDeliveryChannel(): boolean {
  const canSend =
    bool(process.env.AWS_SMS_ENABLED, true) ||
    Boolean(
      process.env.CONNECT_INSTANCE_ID?.trim() &&
        process.env.CONNECT_CONTACT_FLOW_ID?.trim()
    );
  const hasDestination = [
    process.env.CONTACT_NEIGHBOUR_PHONE,
    process.env.CONTACT_SECURITY_PHONE,
    process.env.CONTACT_FAMILY_PHONE,
    process.env.CONTACT_EMS_PHONE,
  ].some((phone) => Boolean(phone?.trim()));
  return canSend && hasDestination;
}

const escalationModeEnv = (process.env.ESCALATION_MODE ?? "").toLowerCase();
const escalationMode: "simulated" | "live" =
  escalationModeEnv === "simulated"
    ? "simulated"
    : escalationModeEnv === "live"
      ? "live"
      : hasDeliveryChannel()
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

const region = (
  process.env.AWS_REGION ??
  process.env.AWS_DEFAULT_REGION ??
  "us-east-1"
).trim();

export const config = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? "0.0.0.0",

  /** Everything the AWS SDK clients need, in one place. */
  aws: {
    region,
    /**
     * Point every SDK client at a local stack (LocalStack, `sam local`) during
     * development. Unset in every deployed environment, where the SDK resolves
     * the real regional endpoint by itself.
     */
    endpoint: (process.env.AWS_ENDPOINT_URL ?? "").trim(),
    /** Adaptive retry sits on top of this; see `aws/clients.ts`. */
    maxAttempts: Number(process.env.AWS_MAX_ATTEMPTS ?? 4),

    // --- Bedrock -----------------------------------------------------------
    /**
     * A cross-region inference profile (the "us." prefix) rather than a bare
     * model id, so Bedrock itself spreads load across the US regions.
     */
    bedrockModelId: process.env.BEDROCK_MODEL_ID ?? "us.amazon.nova-2-lite-v1:0",
    bedrockRegion: (process.env.BEDROCK_REGION ?? region).trim(),
    /** Whole-turn failover target when the primary throttles or 5xxs. */
    bedrockFailoverRegion: (process.env.BEDROCK_FAILOVER_REGION ?? "us-west-2").trim(),
    bedrockMaxTokens: Number(process.env.BEDROCK_MAX_TOKENS ?? 512),

    // --- Polly / Transcribe ------------------------------------------------
    /** Kajal covers Hindi and Indian English on one voice. */
    pollyVoice: process.env.POLLY_VOICE ?? "Kajal",
    /** generative | neural | standard — generative degrades to neural per region. */
    pollyEngine: process.env.POLLY_ENGINE ?? "generative",

    // --- Documents ---------------------------------------------------------
    comprehendMedicalEnabled: bool(process.env.COMPREHEND_MEDICAL_ENABLED, true),
    /** Needed only for PDFs over Textract's 5 MB synchronous limit. */
    documentBucket: (process.env.DOCUMENT_BUCKET ?? "").trim(),

    // --- Notifications -----------------------------------------------------
    smsEnabled: bool(process.env.AWS_SMS_ENABLED, true),
    /** Alphanumeric sender id, where the destination country supports one. */
    snsSenderId: (process.env.SNS_SENDER_ID ?? "").trim(),
    /** Every alert is mirrored here for the on-call subscribers. */
    opsTopicArn: (process.env.OPS_TOPIC_ARN ?? "").trim(),
    /** Undeliverable alerts land here instead of disappearing into a log. */
    notificationDlqUrl: (process.env.NOTIFICATION_DLQ_URL ?? "").trim(),
    /** Amazon Connect places the outbound emergency call. */
    connectInstanceId: (process.env.CONNECT_INSTANCE_ID ?? "").trim(),
    connectContactFlowId: (process.env.CONNECT_CONTACT_FLOW_ID ?? "").trim(),
    connectSourcePhone: (process.env.CONNECT_SOURCE_PHONE ?? "").trim(),
    /** Presigned staging for the Polly clip the contact flow plays. */
    callAudioBucket: (process.env.CALL_AUDIO_BUCKET ?? "").trim(),
  },

  demoLanguage: process.env.DEMO_LANGUAGE ?? "en-IN",
  escalationMode,
  escalationChannel: (process.env.ESCALATION_CHANNEL ?? "voice") as "sms" | "voice",
  escalationCallRoles: parseCallRoles(),
  escalationAckTimeoutMs: Number(process.env.ESCALATION_ACK_TIMEOUT_MS ?? 45_000),
  escalationHopDelayMs: Number(process.env.ESCALATION_HOP_DELAY_MS ?? 2_000),

  /** Public web origin for family PWA links in alerts */
  publicWebUrl: (process.env.PUBLIC_WEB_URL ?? "http://localhost:3000").replace(
    /\/$/,
    ""
  ),
  /**
   * Public https origin of this API. In the deployed stack this is the Amazon
   * API Gateway URL, which is where the Amazon Connect contact flow posts the
   * "press 1" acknowledgement. Only needed locally if you want that callback to
   * reach your laptop.
   */
  publicApiUrl: (process.env.PUBLIC_API_URL ?? "").replace(/\/$/, ""),

  contactPhones: {
    neighbour: process.env.CONTACT_NEIGHBOUR_PHONE ?? "",
    security: process.env.CONTACT_SECURITY_PHONE ?? "",
    family: process.env.CONTACT_FAMILY_PHONE ?? "",
    emergency_services: process.env.CONTACT_EMS_PHONE ?? "",
  } as Record<EscalationHop["contact_role"], string>,

  /**
   * Reasoning backend: bedrock (default) or offline.
   * `offline` is the deterministic client used by CI and no-network rehearsals.
   */
  llmProvider: (() => {
    const raw = (process.env.LLM_PROVIDER ?? "").toLowerCase();
    if (raw === "bedrock" || raw === "offline") return raw;
    return bool(process.env.OFFLINE_AI, false) ? "offline" : "bedrock";
  })() as "bedrock" | "offline",
  useOfflineAi: bool(process.env.OFFLINE_AI, false),
  /**
   * Silent STT/TTS only when explicitly requested. Keep speech live so the watch
   * can still talk when the reasoning layer is offline.
   */
  useOfflineSpeech: bool(process.env.OFFLINE_SPEECH, false),

  /**
   * Postgres connection URI. In the deployed stack this is Amazon Aurora
   * Serverless v2 (PostgreSQL), reached inside the VPC with the password held
   * in AWS Secrets Manager.
   */
  databaseUrl: (process.env.DATABASE_URL ?? "").trim(),
  /** Secrets Manager id holding the Aurora credentials, when DATABASE_URL is unset. */
  databaseSecretId: (process.env.DATABASE_SECRET_ID ?? "").trim(),
  /** JWT signing secret — Amazon Cognito issues the tokens in the deployed stack. */
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
