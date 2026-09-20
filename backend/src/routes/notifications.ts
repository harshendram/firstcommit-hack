import { Router } from "express";
import { config } from "../config.js";
import { getCallAudio } from "../services/callAudioStore.js";
import { escalationService } from "../services/escalation.js";
import { normalizeE164 } from "../services/notifications.js";
import { orchestrator } from "../services/orchestrator.js";
import { sessionStore } from "../state/sessionStore.js";
import type { EscalationHop } from "../types.js";

/**
 * Callbacks from the AWS notification path.
 *
 * Voice   Amazon Connect contact flow → "Invoke AWS Lambda function" → this API
 *         through API Gateway:
 *           POST /api/notifications/voice/ack      "press 1" acknowledgement
 *           POST /api/notifications/voice/status   contact state changes
 *
 * SMS     Two-way SMS lands on an Amazon SNS topic whose HTTPS subscription is:
 *           POST /api/notifications/sms/inbound
 *         SNS confirms the subscription on first use; that handshake is handled
 *         below so the endpoint is self-registering.
 *
 * Audio   GET /api/notifications/voice/audio/:id — only used when
 *         CALL_AUDIO_BUCKET is unset and clips stay in this process.
 */
export const notificationsRouter = Router();

/** Local staging fallback. With a bucket configured, Connect reads S3 directly. */
notificationsRouter.get("/voice/audio/:id", (req, res) => {
  const clip = getCallAudio(String(req.params.id ?? ""));
  if (!clip) {
    res.status(404).type("text/plain").send("audio expired or not found");
    return;
  }
  res.setHeader("Content-Type", clip.mimeType);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", String(clip.buffer.length));
  res.send(clip.buffer);
});

/** Resolve which role owns this acknowledgement (handles shared demo numbers). */
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
 * is a live call role, treat the acknowledgement as family — even before the
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
      console.error(`[notify] family ack via ${via} failed:`, err);
    }
  }
  return escalationService.acknowledgeByPhone(phoneRaw, via);
}

const AFFIRMATIVE = /\b(yes|y|ok|okay|on my way|coming|ack|acknowledged|omw|1)\b/i;

/**
 * "Press 1" from the Connect contact flow.
 *
 * Answer immediately: the contact flow holds the caller on the line while it
 * waits, so anything slow here is silence in the caller's ear. The orchestrator
 * work (which speaks to the patient) runs after the response is sent.
 */
notificationsRouter.post("/voice/ack", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  // Connect nests the flow's own values under Details.Parameters.
  const params = ((body.Details as Record<string, unknown> | undefined)?.Parameters ??
    body) as Record<string, unknown>;

  const to = String(params.destinationPhone ?? params.To ?? params.CustomerEndpoint ?? "");
  const digits = String(params.digits ?? params.Digits ?? "");
  const contactId = String(params.contactId ?? params.ContactId ?? "");

  console.log(
    `[connect] voice ack contact=${contactId} to=${to} digits=${JSON.stringify(digits)}`
  );

  const willAck = /1/.test(digits);
  res.json({
    acknowledged: String(willAck),
    // The contact flow speaks this back through its own Polly prompt.
    spoken: willAck
      ? "Thank you. Rakshak has told the patient you are on your way. Please go to them now."
      : "Sorry, we did not understand. Please go to the patient immediately.",
  });

  if (willAck) {
    void acknowledge(to, "keypad")
      .then((acked) => console.log(`[connect] keypad ack processed ok=${acked} to=${to}`))
      .catch((err) => console.error("[connect] keypad ack crashed:", err));
  }
});

/** Contact state changes, forwarded from Amazon Connect via EventBridge. */
notificationsRouter.post("/voice/status", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const detail = (body.detail ?? body) as Record<string, unknown>;
  console.log(
    `[connect] contact status id=${detail.contactId ?? "?"} ` +
      `state=${detail.eventType ?? detail.state ?? "?"} to=${detail.destinationPhoneNumber ?? "?"}`
  );
  res.sendStatus(204);
});

/**
 * Inbound SMS, delivered by Amazon SNS over HTTPS.
 *
 * SNS sends `SubscriptionConfirmation` first; fetching `SubscribeURL` completes
 * the handshake, which is why this endpoint does not need a console visit after
 * a redeploy.
 */
notificationsRouter.post("/sms/inbound", async (req, res) => {
  const raw = req.body;
  const envelope = (typeof raw === "string" ? safeParse(raw) : raw) as Record<string, unknown>;
  const type = String(envelope?.Type ?? req.get("x-amz-sns-message-type") ?? "");

  if (type === "SubscriptionConfirmation") {
    const subscribeUrl = String(envelope?.SubscribeURL ?? "");
    // Only ever call back to SNS itself.
    if (/^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//.test(subscribeUrl)) {
      try {
        await fetch(subscribeUrl, { signal: AbortSignal.timeout(10_000) });
        console.log("[sns] inbound SMS subscription confirmed");
      } catch (err) {
        console.error("[sns] subscription confirmation failed:", err);
      }
    } else {
      console.warn("[sns] refusing to confirm a non-SNS SubscribeURL");
    }
    res.sendStatus(200);
    return;
  }

  const message = safeParse(String(envelope?.Message ?? "")) as Record<string, unknown> | null;
  const from = String(message?.originationNumber ?? envelope?.originationNumber ?? "");
  const text = String(message?.messageBody ?? envelope?.messageBody ?? "");

  console.log(`[sns] inbound SMS from=${from} body=${JSON.stringify(text)}`);
  res.sendStatus(200);

  if (from && AFFIRMATIVE.test(text)) {
    void acknowledge(from, "reply")
      .then((acked) => console.log(`[sns] reply ack processed ok=${acked} from=${from}`))
      .catch((err) => console.error("[sns] reply ack crashed:", err));
  }
});

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
