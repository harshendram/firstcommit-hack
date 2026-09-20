/**
 * Reaching a human, on AWS.
 *
 *   SMS   → Amazon SNS `Publish` to an E.164 number, sent as Transactional so it
 *           is never dropped for cost reasons.
 *   Voice → Amazon Connect `StartOutboundVoiceContact`. The contact flow plays
 *           the Polly clip we staged in S3 and captures the "press 1"
 *           acknowledgement, posting it back through API Gateway.
 *   Ops   → an SNS topic every alert is mirrored to, so the on-call view and any
 *           future subscriber (email, Chatbot, Lambda) get the same event.
 *
 * Anything that fails after its retries is written to an SQS dead-letter queue
 * rather than dropped, so a missed escalation is visible instead of silent.
 */

import { PublishCommand } from "@aws-sdk/client-sns";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { StartOutboundVoiceContactCommand } from "@aws-sdk/client-connect";
import { connect, sns, sqs } from "../aws/clients.js";
import { breaker } from "../aws/resilience.js";
import { config } from "../config.js";
import { sessionStore } from "../state/sessionStore.js";
import type { EscalationHop, HandoffSummary } from "../types.js";
import { putCallAudio } from "./callAudioStore.js";
import { AwsSpeechClient, type SpeechClient } from "./speech.js";

export type NotifyChannel = "sms" | "voice" | "push";

export interface NotifyResult {
  ok: boolean;
  /** Connect contact id or SNS message id — the receipt you can trace in CloudWatch. */
  id?: string;
  channel: NotifyChannel;
  error?: string;
}

/** Lazy Polly client for outbound call audio (same Kajal voice as the watch). */
let callTts: SpeechClient | null | undefined;
function getCallTts(): SpeechClient | null {
  if (callTts !== undefined) return callTts;
  callTts = config.useOfflineSpeech ? null : new AwsSpeechClient();
  return callTts;
}

/** Strip formatting so "+1 269 586 9536" becomes "+12695869536". */
export function normalizeE164(raw: string): string {
  const cleaned = raw.trim().replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
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

/**
 * Spoken script for the outbound emergency call.
 *
 * Deliberately short: a long recital makes people hang up or mash keys before
 * the contact flow starts listening for the acknowledgement.
 */
export function buildShortVoiceScript(
  hop: EscalationHop,
  handoff: HandoffSummary | null
): string {
  void hop;
  const f = alertFacts(handoff);
  return [
    "Rakshak emergency alert.",
    `${f.patient}, age ${f.age}, at ${f.location}.`,
    `${f.condition}.`,
    "Please go to them now.",
  ].join(" ");
}

export function buildAckVoiceScript(
  hop: EscalationHop,
  handoff: HandoffSummary | null
): string {
  return `${buildShortVoiceScript(hop, handoff)} Press 1 now to confirm you are on your way.`;
}

/**
 * Render the call script with Polly and stage it in S3.
 *
 * The Connect contact flow reads `allyAudioUrl` from the contact attributes and
 * plays it; when staging fails the flow falls back to its own Polly prompt using
 * `allyScript`, so a contact is always reached either way.
 */
export async function prepareCallAudioUrl(script: string): Promise<string | undefined> {
  const tts = getCallTts();
  if (!tts) return undefined;
  try {
    const audio = await tts.synthesize(script, config.demoLanguage);
    const buffer = Buffer.from(audio.audio_base64, "base64");
    if (buffer.length < 100) {
      console.warn("[connect] Polly call audio too small — contact flow will speak the script");
      return undefined;
    }
    const url = await putCallAudio(buffer, audio.mime_type || "audio/mpeg");
    console.log(`[connect] Polly call audio staged (${buffer.length} bytes) → ${url}`);
    return url;
  } catch (err) {
    console.warn(
      "[connect] Polly staging failed — contact flow will speak the script:",
      err instanceof Error ? err.message : err
    );
    return undefined;
  }
}

/** Anything we could not deliver goes here rather than into a log line nobody reads. */
async function deadLetter(kind: string, detail: Record<string, unknown>): Promise<void> {
  if (!config.aws.notificationDlqUrl) return;
  try {
    await sqs().send(
      new SendMessageCommand({
        QueueUrl: config.aws.notificationDlqUrl,
        MessageBody: JSON.stringify({ kind, at: new Date().toISOString(), ...detail }),
      })
    );
  } catch (err) {
    console.error("[sqs] could not write to the notification DLQ:", err);
  }
}

export class AwsNotifier {
  constructor() {
    if (this.ready) {
      console.log(
        `[notify] SNS sms=${config.aws.snsSenderId || "(default sender)"} · ` +
          `Connect instance=${config.aws.connectInstanceId ? "set" : "(unset — voice disabled)"} · ` +
          `ops topic=${config.aws.opsTopicArn ? "set" : "(unset)"}`
      );
    } else {
      console.warn(
        "[notify] no reachable delivery channel (needs AWS_SMS_ENABLED or an Amazon Connect " +
          "instance, plus at least one CONTACT_*_PHONE) — escalation stays simulated"
      );
    }
  }

  /**
   * Can this notifier reach anybody? SMS needs only a region, voice additionally
   * needs a Connect instance — but either way there has to be a number to dial.
   */
  get ready(): boolean {
    const canSend = Boolean(config.aws.region) && (config.aws.smsEnabled || this.voiceReady);
    const hasDestination = Object.values(config.contactPhones).some(Boolean);
    return canSend && hasDestination;
  }

  get voiceReady(): boolean {
    return Boolean(config.aws.connectInstanceId && config.aws.connectContactFlowId);
  }

  /** Mirror every alert onto the ops topic. Never fails the caller. */
  private async mirrorToOps(subject: string, body: string): Promise<void> {
    if (!config.aws.opsTopicArn) return;
    try {
      await sns().send(
        new PublishCommand({
          TopicArn: config.aws.opsTopicArn,
          Subject: subject.slice(0, 99),
          Message: body,
        })
      );
    } catch (err) {
      console.warn("[sns] ops mirror failed:", err instanceof Error ? err.message : err);
    }
  }

  /** Send an SMS alert through Amazon SNS. */
  async sendSmsAlert(phone: string, body: string): Promise<NotifyResult> {
    if (!config.aws.smsEnabled) {
      return { ok: false, channel: "sms", error: "SMS delivery is disabled (AWS_SMS_ENABLED)" };
    }
    const to = normalizeE164(phone);
    if (!to) return { ok: false, channel: "sms", error: "No destination phone configured" };

    try {
      const res = await breaker("sns.sms").run(() =>
        sns().send(
          new PublishCommand({
            PhoneNumber: to,
            Message: body,
            MessageAttributes: {
              "AWS.SNS.SMS.SMSType": { DataType: "String", StringValue: "Transactional" },
              ...(config.aws.snsSenderId
                ? {
                    "AWS.SNS.SMS.SenderID": {
                      DataType: "String",
                      StringValue: config.aws.snsSenderId,
                    },
                  }
                : {}),
            },
          })
        )
      );
      void this.mirrorToOps("Rakshak SMS alert", body);
      return { ok: true, id: res.MessageId, channel: "sms" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[sns] SMS alert failed:", message);
      await deadLetter("sms", { to, body, error: message });
      return { ok: false, channel: "sms", error: message };
    }
  }

  /** Place a one-way informational call through Amazon Connect. */
  async callWithScript(phone: string, script: string): Promise<NotifyResult> {
    if (!this.voiceReady) {
      return {
        ok: false,
        channel: "voice",
        error: "Amazon Connect is not configured (CONNECT_INSTANCE_ID / CONNECT_CONTACT_FLOW_ID)",
      };
    }
    const to = normalizeE164(phone);
    if (!to) return { ok: false, channel: "voice", error: "No destination phone configured" };

    const audioUrl = await prepareCallAudioUrl(script);
    try {
      const res = await breaker("connect.voice").run(() =>
        connect().send(
          new StartOutboundVoiceContactCommand({
            InstanceId: config.aws.connectInstanceId,
            ContactFlowId: config.aws.connectContactFlowId,
            DestinationPhoneNumber: to,
            SourcePhoneNumber: config.aws.connectSourcePhone || undefined,
            Attributes: {
              allyScript: script.slice(0, 1000),
              ...(audioUrl ? { allyAudioUrl: audioUrl } : {}),
              allyAck: "false",
            },
          })
        )
      );
      void this.mirrorToOps("Rakshak voice alert", script);
      return { ok: true, id: res.ContactId, channel: "voice" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[connect] outbound voice failed:", message);
      await deadLetter("voice", { to, script, error: message });
      return { ok: false, channel: "voice", error: message };
    }
  }

  /** Place a real phone call to a contact in the escalation chain. */
  async callContact(
    hop: EscalationHop,
    handoff: HandoffSummary | null
  ): Promise<NotifyResult> {
    if (!this.voiceReady) {
      return { ok: false, channel: "voice", error: "Amazon Connect is not configured" };
    }
    const to = normalizeE164(hop.phone ?? "");
    if (!to) {
      return { ok: false, channel: "voice", error: `No phone configured for ${hop.contact_role}` };
    }

    // The contact flow captures "press 1" and posts it to /api/notifications/voice/ack.
    const script = buildAckVoiceScript(hop, handoff);
    const audioUrl = await prepareCallAudioUrl(script);

    try {
      const res = await breaker("connect.voice").run(() =>
        connect().send(
          new StartOutboundVoiceContactCommand({
            InstanceId: config.aws.connectInstanceId,
            ContactFlowId: config.aws.connectContactFlowId,
            DestinationPhoneNumber: to,
            SourcePhoneNumber: config.aws.connectSourcePhone || undefined,
            Attributes: {
              allyScript: script.slice(0, 1000),
              ...(audioUrl ? { allyAudioUrl: audioUrl } : {}),
              allyRole: hop.contact_role,
              allySessionId: sessionStore.get().session_id || "live",
              allyAck: "true",
            },
          })
        )
      );
      void this.mirrorToOps(`Rakshak call · ${hop.contact_role}`, script);
      return { ok: true, id: res.ContactId, channel: "voice" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[connect] call failed for ${hop.contact_role}:`, message);
      await deadLetter("voice", { to, role: hop.contact_role, error: message });
      return { ok: false, channel: "voice", error: message };
    }
  }

  /** Send an SMS alert to a contact in the escalation chain. */
  async messageContact(
    hop: EscalationHop,
    handoff: HandoffSummary | null
  ): Promise<NotifyResult> {
    const phone = normalizeE164(hop.phone ?? "");
    if (!phone) {
      return { ok: false, channel: "sms", error: `No phone configured for ${hop.contact_role}` };
    }
    return this.sendSmsAlert(phone, buildAlertBody(hop, handoff));
  }

  /**
   * Notify on the configured channel and degrade rather than give up:
   * voice → SMS. Each leg has its own breaker, so a sick Connect instance does
   * not stop the SMS from going out.
   */
  async notifyContact(
    hop: EscalationHop,
    handoff: HandoffSummary | null
  ): Promise<NotifyResult> {
    if (config.escalationChannel === "voice" && this.voiceReady) {
      const call = await this.callContact(hop, handoff);
      if (call.ok) return call;
      if (config.aws.smsEnabled) {
        console.warn("[notify] voice failed — falling back to SMS");
        return this.messageContact(hop, handoff);
      }
      return call;
    }
    return this.messageContact(hop, handoff);
  }
}

export const notifier = new AwsNotifier();
