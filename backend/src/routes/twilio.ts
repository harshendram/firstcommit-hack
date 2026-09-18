import { Router } from "express";
import { config } from "../config.js";
import { getCallAudio } from "../services/callAudioStore.js";
import { escalationService } from "../services/escalation.js";
import { orchestrator } from "../services/orchestrator.js";
import { escapeXml, normalizeE164 } from "../services/twilio.js";
import { sessionStore } from "../state/sessionStore.js";
import type { EscalationHop } from "../types.js";

/**
 * Twilio webhooks.
 *
 * Inbound SMS/WhatsApp ("Message comes in"):
 *   https://YOUR_PUBLIC_HOST/api/twilio/inbound
 * Keypad acknowledgement during an outbound emergency call (set automatically
 * from the TwiML we generate when PUBLIC_API_URL is configured):
 *   https://YOUR_PUBLIC_HOST/api/twilio/voice/ack
 * Sarvam Bulbul WAV for outbound <Play>:
 *   https://YOUR_PUBLIC_HOST/api/twilio/voice/audio/:id
 */
export const twilioRouter = Router();

/**
 * Public audio clip for Twilio <Play>. Must be reachable via the ngrok tunnel.
 * No auth — IDs are short-lived random tokens.
 */
twilioRouter.get("/voice/audio/:id", (req, res) => {
  const id = String(req.params.id ?? "");
  const clip = getCallAudio(id);
  if (!clip) {
    res.status(404).type("text/plain").send("audio expired or not found");
    return;
  }
  res.setHeader("Content-Type", clip.mimeType);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", String(clip.buffer.length));
  res.send(clip.buffer);
});

/** Resolve which role owns this inbound ack (handles shared demo phone numbers). */
function roleForPhone(phoneRaw: string): EscalationHop["contact_role"] | null {
  const index = escalationService.resolveHopIndexForPhone(phoneRaw);
  if (index < 0) return null;
  return sessionStore.get().escalation_chain[index]?.contact_role ?? null;
}

/**
 * Acknowledge a contact. For family we route through the orchestrator so
 * Rakshak also tells the patient their daughter is coming.
 *
 * Demo shortcut: if the dialled number matches CONTACT_FAMILY_PHONE and family
 * is a live call role, always treat keypad/SMS as family — even before the
 * chain has a family hop row.
 */
async function acknowledge(phoneRaw: string, via: string): Promise<boolean> {
  const target = normalizeE164(phoneRaw);
  const familyPhone = normalizeE164(config.contactPhones.family || "");
  const looksLikeFamily =
    roleForPhone(phoneRaw) === "family" ||
    (Boolean(familyPhone) &&
      target === familyPhone &&
      config.escalationCallRoles.has("family"));

  if (looksLikeFamily) {
    try {
      await orchestrator.handleFamilyOnMyWay("family");
      return true;
    } catch (err) {
      console.error(`[twilio] family ack via ${via} failed:`, err);
    }
  }
  return escalationService.acknowledgeByPhone(phoneRaw, via);
}

twilioRouter.post("/inbound", async (req, res) => {
  const from = String(req.body?.From ?? "");
  const body = String(req.body?.Body ?? "");

  console.log(`[twilio] inbound From=${from} Body=${JSON.stringify(body)}`);

  const affirmative =
    /\b(yes|y|ok|okay|on my way|coming|ack|acknowledged|omw|1)\b/i.test(body);
  const acked = affirmative ? await acknowledge(from, "reply") : false;

  const message = acked
    ? "Rakshak received your confirmation. Thank you — stay safe."
    : "Rakshak here. Reply YES if you are on your way to help.";

  res.type("text/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(
      message
    )}</Message></Response>`
  );
});

twilioRouter.post("/voice/ack", async (req, res) => {
  // For an outbound call, `To` is the contact we dialled.
  const to = String(req.body?.To ?? req.body?.Called ?? "");
  const digits = String(req.body?.Digits ?? "");
  const callSid = String(req.body?.CallSid ?? "");

  console.log(
    `[twilio] voice ack CallSid=${callSid} To=${to} Digits=${JSON.stringify(digits)}`
  );

  // Answer Twilio immediately — if we wait on orchestrator/TTS, the call can
  // time out and the contact hears silence after pressing 1.
  const willAck = /1/.test(digits);
  const spoken = willAck
    ? "Thank you. Rakshak has told the patient you are on your way. Please go to them now. Goodbye."
    : "Sorry, we did not understand. Please go to the patient immediately. Goodbye.";

  res.type("text/xml").send(
    [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<Response>`,
      `<Say voice="Polly.Raveena" language="en-IN">${escapeXml(spoken)}</Say>`,
      `<Hangup/>`,
      `</Response>`,
    ].join("")
  );

  if (willAck) {
    void acknowledge(to, "keypad")
      .then((acked) => {
        console.log(`[twilio] keypad ack processed ok=${acked} To=${to}`);
      })
      .catch((err) => {
        console.error("[twilio] keypad ack crashed:", err);
      });
  }
});

/** Optional call status callback — logged for debugging a live demo. */
twilioRouter.post("/voice/status", (req, res) => {
  console.log(
    `[twilio] call status sid=${req.body?.CallSid} status=${req.body?.CallStatus} to=${req.body?.To}`
  );
  res.sendStatus(204);
});
