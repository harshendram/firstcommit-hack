import type { CheckIn, PatientProfile, SymptomScores } from "./types.js";
import { SYMPTOM_LABELS } from "./types.js";
import { config } from "../config.js";
import { twilioNotifier, type NotifyResult } from "../services/twilio.js";

/** Falls back to the demo contact so a single configured number works. */
function patientPhone(): string {
  return process.env.CONTACT_PATIENT_PHONE || config.contactPhones.family || "";
}

function firstName(patient: PatientProfile): string {
  return patient.name.split(" ")[0] || patient.name;
}

function postOpDay(patient: PatientProfile): number {
  const discharged = new Date(patient.discharged_on).getTime();
  if (Number.isNaN(discharged)) return 0;
  return Math.max(0, Math.round((Date.now() - discharged) / 86_400_000));
}

/** Plain spoken symptoms — never "2/3 vs baseline". */
function plainSymptoms(symptoms: SymptomScores): string {
  const hit = (Object.keys(SYMPTOM_LABELS) as (keyof SymptomScores)[])
    .filter((k) => (symptoms[k] ?? 0) >= 2)
    .map((k) => SYMPTOM_LABELS[k].toLowerCase());
  if (hit.length === 0) {
    const mild = (Object.keys(SYMPTOM_LABELS) as (keyof SymptomScores)[])
      .filter((k) => (symptoms[k] ?? 0) >= 1)
      .map((k) => SYMPTOM_LABELS[k].toLowerCase());
    return mild.slice(0, 2).join(" and ") || "a change from her usual";
  }
  if (hit.length === 1) return hit[0];
  if (hit.length === 2) return `${hit[0]} and ${hit[1]}`;
  return `${hit.slice(0, -1).join(", ")}, and ${hit[hit.length - 1]}`;
}

function settleResults(
  settled: PromiseSettledResult<NotifyResult>[],
  label: string
): boolean {
  const results: NotifyResult[] = settled.map((result, index) =>
    result.status === "fulfilled"
      ? result.value
      : {
          ok: false,
          channel: index === 0 ? "whatsapp" : "voice",
          error:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        }
  );
  for (const result of results) {
    console.log(
      result.ok
        ? `[care] ${label} ${result.channel} sent`
        : `[care] ${label} ${result.channel} failed: ${result.error}`
    );
  }
  return results.some((r) => r.ok);
}

/**
 * The daily nudge that makes care continuous rather than episodic. One-way:
 * it asks her to start the check-in, it does not try to hold the conversation.
 */
export async function remindPatientForCheckIn(
  patient: PatientProfile
): Promise<boolean> {
  const phone = patientPhone();
  if (!phone) {
    console.warn("[care] no patient phone configured — skipping reminder");
    return false;
  }

  const name = firstName(patient);
  const script = `Namaste ${name}. Main Rakshak. Aaj ka recovery check-in ready hai. Watch par Check in dabaiye, bas aadha minute.`;
  const body = `Namaste ${name} — Rakshak. Aaj ka recovery check-in ready hai. Watch / app par Check in dabaiye.`;

  const settled = await Promise.allSettled([
    twilioNotifier.sendWhatsAppAlert(phone, body),
    twilioNotifier.callWithScript(phone, script),
  ]);
  return settleResults(settled, "daily reminder");
}

/**
 * Amber: a single non-urgent WhatsApp to the doctor. No voice call — the point
 * is a reviewable note lands out-of-band, not that a phone rings for a drift.
 * Green still stays completely silent.
 */
export async function notifyDoctorReview(
  patient: PatientProfile,
  checkIn: CheckIn
): Promise<boolean> {
  if (checkIn.risk !== "amber" || checkIn.action !== "recommend_doctor_review") {
    return false;
  }

  const phone = config.contactPhones.family;
  if (!phone) {
    console.warn("[care] no doctor phone configured — skipping review note");
    return false;
  }

  const what = plainSymptoms(checkIn.symptoms);
  const body = [
    `Rakshak — please review when you can`,
    `${patient.name}, ${postOpDay(patient)} days after ${patient.procedure.toLowerCase()}, is reporting ${what}.`,
    `Recovery is tracking behind expected. Not urgent — full note is on the dashboard.`,
  ].join("\n");

  try {
    const result = await twilioNotifier.sendWhatsAppAlert(phone, body);
    console.log(
      result.ok
        ? `[care] doctor review ${result.channel} sent`
        : `[care] doctor review ${result.channel} failed: ${result.error}`
    );
    return result.ok;
  } catch (err) {
    console.error("[care] doctor review note error:", err);
    return false;
  }
}

/**
 * Only fires on red. Short human alert — no "risk score" or condition laundry list.
 */
export async function notifyDoctorUrgent(
  patient: PatientProfile,
  checkIn: CheckIn
): Promise<boolean> {
  if (checkIn.risk !== "red" || checkIn.action !== "escalate") {
    console.warn("[care] suppressed non-red doctor alert");
    return false;
  }

  const phone = config.contactPhones.family;
  if (!phone) {
    console.warn(
      "[care] CONTACT_FAMILY_PHONE not configured — skipping doctor alert"
    );
    return false;
  }

  const name = firstName(patient);
  const what = plainSymptoms(checkIn.symptoms);
  const day = postOpDay(patient);
  const body = [
    `Rakshak — needs you today`,
    `${patient.name}, day ${day} after ${patient.procedure.toLowerCase()}, needs attention.`,
    `She is reporting ${what}.`,
    `Possible surgical site infection. Please check the dashboard or call her.`,
  ].join("\n");

  // Spoken: calm, short, no jargon. Bulbul will read this as-is.
  const voiceScript = [
    `Hello. This is Rakshak.`,
    `${name} needs you today.`,
    `She is day ${day} after her knee surgery and she is having ${what}.`,
    `This could be a wound infection. Please open the dashboard or call her.`,
  ].join(" ");

  const settled = await Promise.allSettled([
    twilioNotifier.sendWhatsAppAlert(phone, body),
    twilioNotifier.callWithScript(phone, voiceScript),
  ]);

  return settleResults(settled, "urgent doctor");
}
