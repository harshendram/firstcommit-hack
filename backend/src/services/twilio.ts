import twilio from "twilio";
import { config } from "../config.js";
import { putCallAudio } from "./callAudioStore.js";
import { LiveSarvamClient, type SarvamClient } from "./sarvam.js";
import { sessionStore } from "../state/sessionStore.js";
import type { EscalationHop, HandoffSummary } from "../types.js";

/** Lazy Sarvam TTS client for outbound call audio (same Bulbul voice as the watch). */
let callTts: SarvamClient | null | undefined;
function getCallTts(): SarvamClient | null {
  if (callTts !== undefined) return callTts;
  if (config.useMockSpeech || !config.sarvamApiKey) {
    callTts = null;
    return callTts;
  }
  callTts = new LiveSarvamClient();
  return callTts;
}

export type NotifyChannel = "whatsapp" | "sms" | "voice";

export interface NotifyResult {
  ok: boolean;
  sid?: string;
  channel: NotifyChannel;
  error?: string;
}

/** Strip formatting so "+1 269 586 9536" becomes "+12695869536". */
export function normalizeE164(raw: string): string {
  const trimmed = raw.trim().replace(/^whatsapp:/i, "");
  const cleaned = trimmed.replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

function toWhatsAppAddress(phone: string): string {
  return `whatsapp:${normalizeE164(phone)}`;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface AlertFacts {
  patient: string;
  age: number;
  location: string;
  condition: string;
  symptoms: string;
  action: string;
  severity: string;
  history: string;
  meds: string;
  familyUrl: string;
}

function alertFacts(handoff: HandoffSummary | null): AlertFacts {
  const sessionId = sessionStore.get().session_id || "live";
  return {
    patient: handoff?.patient_name ?? "Lakshmi Devi",
    age: handoff?.age ?? 72,
    location: handoff?.location ?? "unknown location",
    condition: handoff?.condition ?? "distress, details pending",
    symptoms: (handoff?.symptoms ?? []).join(", ") || "not reported",
    action: handoff?.recommended_action ?? "Check on the patient urgently",
    severity: (handoff?.severity ?? "high").toUpperCase(),
    history: (handoff?.medical_history ?? []).join(", ") || "n/a",
    meds: (handoff?.medications ?? []).join(", ") || "n/a",
    familyUrl: `${config.publicWebUrl}/family/${sessionId}`,
  };
}

export function buildAlertBody(
  hop: EscalationHop,
  handoff: HandoffSummary | null
): string {
  const f = alertFacts(handoff);
  return [
    "RAKSHAK EMERGENCY ALERT",
    "",
    `To: ${hop.contact_name} (${hop.contact_role})`,
    `Patient: ${f.patient}, ${f.age}`,
    `Location: ${f.location}`,
    `Severity: ${f.severity}`,
    `Condition: ${f.condition}`,
    `Symptoms: ${f.symptoms}`,
    `History: ${f.history}`,
    `Meds: ${f.meds}`,
    `Action: ${f.action}`,
    "",
    `Open family view: ${f.familyUrl}`,
    "",
    "Reply YES if you are on your way — or open the link and tap I'm On My Way.",
  ].join("\n");
}

/** Spoken script for the outbound emergency call — short, calm, no labels. */
export function buildVoiceScript(
  hop: EscalationHop,
  handoff: HandoffSummary | null
): string {
  const f = alertFacts(handoff);
  return [
    `This is an automated emergency call from Rakshak, an A I first responder.`,
    `${f.patient}, age ${f.age}, needs help right now.`,
    `The situation is ${f.condition}.`,
    `Reported symptoms are ${f.symptoms}.`,
    `The location is ${f.location}.`,
    `Recommended action: ${f.action}.`,
    `Rakshak is still on the line with ${f.patient} and will stay with them until someone arrives.`,
  ].join(" ");
}

function sayBlock(text: string): string {
  return `<Say voice="${escapeXml(config.twilioVoiceName)}" language="en-IN">${escapeXml(text)}</Say>`;
}

/** Prefer Sarvam `<Play>` when we have a public clip; Polly `<Say>` otherwise. */
function spokenBlock(text: string, playUrl?: string): string {
  if (playUrl) {
    return `<Play>${escapeXml(playUrl)}</Play>`;
  }
  return sayBlock(text);
}

/** Standalone doctor alert: no emergency-chain keypad acknowledgement. */
export function buildStandaloneVoiceTwiml(
  script: string,
  playUrl?: string
): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Response>`,
    spokenBlock(script, playUrl),
    `</Response>`,
  ].join("");
}

/** Short alert script for the outbound emergency call. */
export function buildShortVoiceScript(
  hop: EscalationHop,
  handoff: HandoffSummary | null
): string {
  void hop;
  const f = alertFacts(handoff);
  return [
    `Rakshak emergency alert.`,
    `${f.patient}, age ${f.age}, at ${f.location}.`,
    `${f.condition}.`,
    `Please go to them now.`,
  ].join(" ");
}

export function buildGatherVoiceScript(
  hop: EscalationHop,
  handoff: HandoffSummary | null
): string {
  return `${buildShortVoiceScript(hop, handoff)} Press 1 now to confirm you are on your way.`;
}

/**
 * Pre-render the call script with Sarvam Bulbul and return a public Play URL.
 * Falls back to null → Twilio Polly Say.
 */
export async function prepareCallPlayUrl(
  script: string
): Promise<string | undefined> {
  if (!config.publicApiUrl) return undefined;
  const tts = getCallTts();
  if (!tts) return undefined;

  try {
    const audio = await tts.synthesize(script, config.demoLanguage);
    const buffer = Buffer.from(audio.audio_base64, "base64");
    if (buffer.length < 100) {
      console.warn("[twilio] Sarvam call audio too small — using Polly Say");
      return undefined;
    }
    const id = putCallAudio(buffer, audio.mime_type || "audio/wav");
    const url = `${config.publicApiUrl}/api/twilio/voice/audio/${id}`;
    console.log(
      `[twilio] Sarvam Bulbul call audio ready (${buffer.length} bytes) → ${url}`
    );
    return url;
  } catch (err) {
    console.warn(
      "[twilio] Sarvam TTS for call failed — falling back to Polly Say:",
      err instanceof Error ? err.message : err
    );
    return undefined;
  }
}

/** TwiML played when the contact answers. Includes keypad ack when possible. */
export function buildVoiceTwiml(
  hop: EscalationHop,
  handoff: HandoffSummary | null,
  opts: { withGather: boolean; playUrl?: string }
): string {
  // Keep the spoken alert short — long scripts make people hang up / mash keys
  // before Gather starts listening.
  const shortScript = buildShortVoiceScript(hop, handoff);
  const gatherScript = buildGatherVoiceScript(hop, handoff);

  if (!opts.withGather) {
    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<Response>`,
      spokenBlock(shortScript, opts.playUrl),
      sayBlock(`This message will now repeat.`),
      spokenBlock(shortScript, opts.playUrl),
      `</Response>`,
    ].join("");
  }

  const action = `${config.publicApiUrl}/api/twilio/voice/ack`;
  // Nest speech INSIDE Gather so DTMF works while the alert is still playing.
  // Prefer Sarvam <Play> (same Bulbul voice as the watch); Polly <Say> fallback.
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Response>`,
    `<Gather numDigits="1" timeout="12" action="${escapeXml(action)}" method="POST">`,
    spokenBlock(gatherScript, opts.playUrl),
    // If Play already includes "press 1", skip duplicate Polly line when playUrl set
    opts.playUrl ? "" : sayBlock(`Press 1 now to confirm you are on your way.`),
    `</Gather>`,
    `<Gather numDigits="1" timeout="12" action="${escapeXml(action)}" method="POST">`,
    sayBlock(`I did not get that. Press 1 to confirm you are coming.`),
    `</Gather>`,
    sayBlock(`No confirmation received. Please go to the patient immediately. Goodbye.`),
    `</Response>`,
  ].join("");
}

export class TwilioNotifier {
  private client: ReturnType<typeof twilio> | null = null;

  constructor() {
    if (config.twilioAccountSid && config.twilioAuthToken) {
      this.client = twilio(config.twilioAccountSid, config.twilioAuthToken);
      console.log(
        `[twilio] LIVE · voiceFrom=${config.twilioVoiceFrom || "(unset)"} smsFrom=${config.twilioSmsFrom || "(unset)"} whatsappFrom=${config.twilioWhatsappFrom || "(unset)"}`
      );
      if (config.escalationChannel === "voice" && !config.publicApiUrl) {
        console.warn(
          "[twilio] PUBLIC_API_URL not set — calls will play the alert but cannot capture 'press 1'. Use the Family PWA button to acknowledge."
        );
      }
    } else {
      console.warn(
        "[twilio] missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN — live sends disabled"
      );
    }
  }

  get ready(): boolean {
    return Boolean(this.client);
  }

  /**
   * Send a direct WhatsApp message without falling back to SMS or entering the
   * emergency escalation/acknowledgement flow.
   */
  /**
   * Prefer WhatsApp; fall back to SMS when the sandbox sender isn't configured
   * (common in demos — bought numbers are voice/SMS, not WhatsApp by default).
   */
  async sendWhatsAppAlert(phone: string, body: string): Promise<NotifyResult> {
    if (!this.client) {
      return {
        ok: false,
        channel: "whatsapp",
        error: "Twilio client not configured",
      };
    }
    const to = normalizeE164(phone);
    if (!to) {
      return {
        ok: false,
        channel: "whatsapp",
        error: "No destination phone configured",
      };
    }

    if (config.twilioWhatsappFrom) {
      try {
        const msg = await this.client.messages.create({
          from: config.twilioWhatsappFrom,
          to: toWhatsAppAddress(to),
          body,
        });
        return { ok: true, sid: msg.sid, channel: "whatsapp" };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[twilio] WhatsApp failed, trying SMS:", message);
      }
    } else {
      console.warn("[twilio] TWILIO_WHATSAPP_FROM unset — sending SMS instead");
    }

    const smsFrom = config.twilioSmsFrom || config.twilioVoiceFrom;
    if (!smsFrom) {
      return {
        ok: false,
        channel: "sms",
        error: "No WhatsApp or SMS sender configured",
      };
    }

    try {
      const msg = await this.client.messages.create({
        from: normalizeE164(smsFrom),
        to,
        body,
      });
      return { ok: true, sid: msg.sid, channel: "sms" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[twilio] SMS alert failed:", message);
      return { ok: false, channel: "sms", error: message };
    }
  }

  /**
   * Place a one-way informational call. Sarvam Bulbul audio is used through
   * Twilio <Play> when available, with the existing Polly <Say> fallback.
   */
  async callWithScript(phone: string, script: string): Promise<NotifyResult> {
    if (!this.client) {
      return { ok: false, channel: "voice", error: "Twilio client not configured" };
    }
    if (!config.twilioVoiceFrom) {
      return { ok: false, channel: "voice", error: "TWILIO_VOICE_FROM not set" };
    }
    const to = normalizeE164(phone);
    if (!to) {
      return {
        ok: false,
        channel: "voice",
        error: "No destination phone configured",
      };
    }

    const playUrl = await prepareCallPlayUrl(script);
    try {
      const call = await this.client.calls.create({
        from: normalizeE164(config.twilioVoiceFrom),
        to,
        twiml: buildStandaloneVoiceTwiml(script, playUrl),
      });
      return { ok: true, sid: call.sid, channel: "voice" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[twilio] direct voice alert failed:", message);
      return { ok: false, channel: "voice", error: message };
    }
  }

  /**
   * Point the Twilio number's inbound-SMS webhook at our public tunnel, so a
   * YES reply acknowledges the hop without any console fiddling.
   */
  async syncInboundWebhook(publicOrigin: string): Promise<void> {
    if (!this.client || !config.twilioSyncWebhooks) return;

    const number = normalizeE164(config.twilioSmsFrom || config.twilioVoiceFrom);
    if (!number) return;

    const smsUrl = `${publicOrigin}/api/twilio/inbound`;
    try {
      const matches = await this.client.incomingPhoneNumbers.list({
        phoneNumber: number,
        limit: 20,
      });
      const target = matches[0];
      if (!target) {
        console.warn(
          `[twilio] ${number} not found on this account — set the inbound webhook manually to ${smsUrl}`
        );
        return;
      }
      await this.client.incomingPhoneNumbers(target.sid).update({
        smsUrl,
        smsMethod: "POST",
      });
      console.log(`[twilio] inbound SMS webhook → ${smsUrl}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[twilio] could not sync inbound webhook: ${message}`);
    }
  }

  /** Place a real phone call to a contact. */
  async callContact(
    hop: EscalationHop,
    handoff: HandoffSummary | null
  ): Promise<NotifyResult> {
    if (!this.client) {
      return { ok: false, channel: "voice", error: "Twilio client not configured" };
    }
    if (!config.twilioVoiceFrom) {
      return { ok: false, channel: "voice", error: "TWILIO_VOICE_FROM not set" };
    }
    const to = normalizeE164(hop.phone ?? "");
    if (!to) {
      return {
        ok: false,
        channel: "voice",
        error: `No phone configured for ${hop.contact_role}`,
      };
    }

    const withGather = Boolean(config.publicApiUrl);
    if (!withGather) {
      console.warn(
        "[twilio] placing call WITHOUT gather — PUBLIC_API_URL empty; press-1 disabled"
      );
    } else {
      console.log(`[twilio] placing call with gather → ${config.publicApiUrl}/api/twilio/voice/ack`);
    }

    // Pipe Sarvam Bulbul into the call when the tunnel is up; else Polly.
    const script = withGather
      ? buildGatherVoiceScript(hop, handoff)
      : buildShortVoiceScript(hop, handoff);
    const playUrl = await prepareCallPlayUrl(script);

    try {
      const call = await this.client.calls.create({
        from: normalizeE164(config.twilioVoiceFrom),
        to,
        twiml: buildVoiceTwiml(hop, handoff, { withGather, playUrl }),
      });
      return { ok: true, sid: call.sid, channel: "voice" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[twilio] call failed for ${hop.contact_role}:`, message);
      return { ok: false, channel: "voice", error: message };
    }
  }

  /** Send a WhatsApp or SMS alert to a contact. */
  async messageContact(
    hop: EscalationHop,
    handoff: HandoffSummary | null
  ): Promise<NotifyResult> {
    if (!this.client) {
      return { ok: false, channel: "sms", error: "Twilio client not configured" };
    }
    const phone = normalizeE164(hop.phone ?? "");
    if (!phone) {
      return {
        ok: false,
        channel: "sms",
        error: `No phone configured for ${hop.contact_role}`,
      };
    }

    const body = buildAlertBody(hop, handoff);
    const preferWhatsApp =
      config.escalationChannel === "whatsapp" && Boolean(config.twilioWhatsappFrom);

    if (preferWhatsApp) {
      try {
        const msg = await this.client.messages.create({
          from: config.twilioWhatsappFrom,
          to: toWhatsAppAddress(phone),
          body,
        });
        return { ok: true, sid: msg.sid, channel: "whatsapp" };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[twilio] WhatsApp failed for ${hop.contact_role}:`, message);
        if (!config.twilioSmsFrom) {
          return { ok: false, channel: "whatsapp", error: message };
        }
      }
    }

    const smsFrom = config.twilioSmsFrom || config.twilioVoiceFrom;
    if (!smsFrom) {
      return {
        ok: false,
        channel: "sms",
        error: "No SMS sender configured (TWILIO_SMS_FROM / TWILIO_VOICE_FROM)",
      };
    }

    try {
      const msg = await this.client.messages.create({
        from: normalizeE164(smsFrom),
        to: phone,
        body,
      });
      return { ok: true, sid: msg.sid, channel: "sms" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[twilio] SMS failed for ${hop.contact_role}:`, message);
      return { ok: false, channel: "sms", error: message };
    }
  }

  /**
   * Notify using the configured channel, with graceful degradation:
   * voice → SMS → WhatsApp, depending on what is configured.
   */
  async notifyContact(
    hop: EscalationHop,
    handoff: HandoffSummary | null
  ): Promise<NotifyResult> {
    if (config.escalationChannel === "voice") {
      const call = await this.callContact(hop, handoff);
      if (call.ok) return call;
      if (config.twilioSmsFrom || config.twilioWhatsappFrom) {
        console.warn("[twilio] voice failed — trying message channel");
        return this.messageContact(hop, handoff);
      }
      return call;
    }
    return this.messageContact(hop, handoff);
  }
}

export const twilioNotifier = new TwilioNotifier();
