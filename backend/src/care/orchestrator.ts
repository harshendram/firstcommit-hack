import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { completeRun, startRun, upsertUser, upsertUserFromAuth } from "../db/users.js";
import {
  appendUserCheckIn,
  getPatientProfile,
  isProfileReady,
  profileToCarePatient,
} from "../db/profiles.js";
import { dbConfigured } from "../db/pool.js";
import { schemaReady } from "../db/schema.js";
import {
  detectLanguageFromText,
  normalizeLanguageCode,
} from "../services/language.js";
import { createSarvamClient, type SarvamClient } from "../services/sarvam.js";
import {
  CareAgent,
  applyContextualAffirmation,
  applyExplicitDenials,
  applySymptomFloors,
  assessTopicCoverage,
  inferMedicationTaken,
  PAIN_AND_MEDS_FALLBACK_ASK,
  PAIN_FALLBACK_ASK,
  RED_FLAG_LANGUAGE,
  remainingRequiredTopics,
  sayCoversMedication,
  sayCoversPain,
} from "./agent.js";
import { buildMemoryAnchor, classifyRisk, computeBaseline } from "./baseline.js";
import {
  isMeaningfulSteps,
  isValidHr,
  isValidSpo2,
  resolveCheckInVitals,
} from "./demoVitals.js";
import { notifyDoctorReview, notifyDoctorUrgent } from "./notify.js";
import { CARE_PATIENT } from "./seed.js";
import { buildDoctorView, careStore } from "./store.js";
import {
  EMPTY_SYMPTOMS,
  type CareTurn,
  type CheckIn,
  type CheckInSession,
  type DoctorView,
  type PatientProfile,
  type RiskLevel,
} from "./types.js";

/** Patient hears an outcome, never a risk label. */
const PATIENT_OUTCOME: Record<RiskLevel, { en: string; hi: string }> = {
  green: {
    en: "Your recovery is on track for this stage. I'll check in with you again tomorrow.",
    hi: "Aapki recovery theek chal rahi hai. Main kal phir aapse baat karungi.",
  },
  amber: {
    en: "I've sent this to your surgical team so they can review it. Keep the leg elevated; I'll check in again tomorrow.",
    hi: "Maine yeh aapki surgical team ko bhej diya hai review ke liye. Pair upar rakhiye, main kal phir baat karungi.",
  },
  red: {
    en: "I'm alerting your surgical team right now. Please keep the dressing dry and keep your phone close.",
    hi: "Main abhi aapki surgical team ko bata rahi hoon. Patti sookhi rakhiye aur phone paas rakhein.",
  },
};

function outcomeLine(risk: RiskLevel, language: string): string {
  const code = normalizeLanguageCode(language);
  return code.startsWith("hi")
    ? PATIENT_OUTCOME[risk].hi
    : PATIENT_OUTCOME[risk].en;
}

export interface CareHooks {
  onSession: (session: CheckInSession) => void;
  onTurn: (turn: CareTurn) => void;
  onDoctorView: (view: DoctorView) => void;
  onTts: (payload: {
    audio_base64: string;
    mime_type: string;
    text: string;
  }) => void;
  onError: (message: string) => void;
}

/** Demo-tight ceiling: greet → one follow-up → close (~3 agent speaking turns). */
const MAX_PATIENT_TURNS = 3;
/** One combined follow-up (+ one spare for red-flag clarify). */
const CLARIFY_BUDGET = 2;
/** Feeling reply + pain/meds answer, then finalize. */
const MIN_PATIENT_TURNS = 2;

function emptySession(): CheckInSession {
  return {
    session_id: "",
    phase: "idle",
    started_at: null,
    language: config.demoLanguage,
    transcript: [],
    memory_callback: null,
    turns_used: 0,
    draft: null,
    result: null,
  };
}

class CareOrchestrator {
  private session: CheckInSession = emptySession();
  private agent = new CareAgent();
  private sarvam: SarvamClient | null = null;
  private hooks: CareHooks | null = null;
  private busy = false;
  private clarifyCount = 0;
  /** Browser visitor identity for Supabase traction. */
  private visitor: { name: string; email: string } | null = null;
  private activeRunId: string | null = null;
  /** demo = Lakshmi seed; user = logged-in person's own profile. */
  private mode: "demo" | "user" = "demo";
  private activeUserId: string | null = null;
  private activePatient: PatientProfile = CARE_PATIENT;
  private activeHistory: CheckIn[] = [];
  /** Live Galaxy Watch samples for the in-flight check-in (cleared on reset/start). */
  private liveVitals: {
    resting_hr?: number;
    spo2?: number;
    steps?: number;
    activity_index?: number;
  } | null = null;

  wire(hooks: CareHooks): void {
    this.hooks = hooks;
    // Lakshmi store updates only push while we're on the demo patient.
    careStore.subscribe((view) => {
      if (this.mode === "demo") hooks.onDoctorView(view);
    });
  }

  getSession(): CheckInSession {
    return { ...this.session, transcript: [...this.session.transcript] };
  }

  /** Doctor dashboard follows the active check-in patient. */
  getDoctorView(): DoctorView {
    if (this.mode === "user") {
      return buildDoctorView(this.activePatient, this.activeHistory);
    }
    return careStore.getDoctorView();
  }

  getActivePatient(): PatientProfile {
    return this.activePatient;
  }

  private emitDoctorView(): void {
    this.hooks?.onDoctorView(this.getDoctorView());
  }

  getVisitor(): { name: string; email: string } | null {
    return this.visitor;
  }

  private speech(): SarvamClient {
    if (!this.sarvam) this.sarvam = createSarvamClient();
    return this.sarvam;
  }

  private emitSession(): void {
    this.hooks?.onSession(this.getSession());
  }

  private addTurn(
    speaker: CareTurn["speaker"],
    text: string,
    language: string
  ): CareTurn {
    const turn: CareTurn = {
      speaker,
      text,
      language,
      timestamp: new Date().toISOString(),
    };
    this.session.transcript.push(turn);
    this.hooks?.onTurn(turn);
    return turn;
  }

  private async speak(text: string, language: string): Promise<void> {
    this.addTurn("agent", text, language);
    this.emitSession();
    try {
      const tts = await this.speech().synthesize(text, language);
      this.hooks?.onTts(tts);
    } catch (err) {
      console.error("[care] TTS failed:", err);
      const raw = err instanceof Error ? err.message : String(err);
      const friendly =
        /aborted|timeout/i.test(raw)
          ? "Voice is slow right now — text still came through. Try again in a moment."
          : raw;
      this.hooks?.onError(friendly);
    }
  }

  reset(): void {
    this.session = emptySession();
    this.agent.reset();
    this.clarifyCount = 0;
    this.busy = false;
    this.visitor = null;
    this.activeRunId = null;
    this.liveVitals = null;
    this.mode = "demo";
    this.activeUserId = null;
    this.activePatient = careStore.getPatient();
    this.activeHistory = careStore.getHistory();
    this.emitSession();
    this.emitDoctorView();
  }

  /** Wipe today's live check-in and restore the seeded recovery history. */
  resetAll(): void {
    careStore.reseed();
    this.reset();
  }

  /**
   * Start a care check-in.
   * - demo:true (or no userId) → Lakshmi Rao seeded patient
   * - userId set, demo false → that user's own profile (form and/or PDF)
   */
  async startCheckIn(identity?: {
    name?: string;
    email?: string;
    userId?: string;
    username?: string;
    demo?: boolean;
  }): Promise<void> {
    if (this.busy) return;
    if (this.session.phase !== "idle" && this.session.phase !== "complete") {
      console.log(
        `[care] startCheckIn ignored — already in phase=${this.session.phase}`
      );
      return;
    }

    const userId = identity?.userId?.trim() ?? "";
    const demo = identity?.demo === true || !userId;
    const name = identity?.name?.trim() ?? "";
    const email = identity?.email?.trim() ?? "";
    const username = identity?.username?.trim() ?? "";

    this.mode = demo ? "demo" : "user";
    this.activeUserId = demo ? null : userId;
    this.liveVitals = null;

    if (!demo) {
      if (!dbConfigured() || !schemaReady()) {
        throw new Error(
          "Database unavailable — set DATABASE_URL to your Supabase Postgres URI"
        );
      }
      const stored = await getPatientProfile(userId);
      if (!isProfileReady(stored)) {
        throw new Error(
          "Complete your recovery profile first (form or discharge PDF)"
        );
      }
      this.activePatient = profileToCarePatient(stored!);
      this.activeHistory = [...(stored!.history ?? [])];
    } else {
      this.activePatient = careStore.getPatient();
      this.activeHistory = careStore.getPriorHistory();
    }

    this.emitDoctorView();

    const wantsTraction = Boolean((name && email) || (userId && name));
    if (wantsTraction) {
      if (!dbConfigured() || !schemaReady()) {
        throw new Error(
          "Database unavailable — set DATABASE_URL to your Supabase Postgres URI"
        );
      }
      let user: { id: string; name: string; email: string };
      if (userId) {
        user = await upsertUserFromAuth({
          id: userId,
          username: username || name,
          name,
          email: email || null,
        });
      } else {
        user = await upsertUser(name, email);
      }
      this.visitor = { name: user.name, email: user.email };
      this.activeRunId = await startRun(user.id, user.name, user.email);
    } else {
      this.visitor = null;
      this.activeRunId = null;
    }

    this.busy = true;
    try {
      const history = this.activeHistory;
      const patient = this.activePatient;
      const baseline = computeBaseline(history, patient.discharged_on);
      const firstName = patient.name.split(/\s+/)[0] || patient.name;

      this.session = {
        ...emptySession(),
        session_id: randomUUID(),
        phase: "greeting",
        started_at: new Date().toISOString(),
        language: patient.preferred_language,
      };
      this.clarifyCount = 0;
      this.agent.start(patient, history, baseline);
      this.emitSession();

      const anchor = buildMemoryAnchor(history, baseline, firstName);
      const opening = await this.agent.openingTurn(patient.name, anchor);
      this.session.memory_callback =
        anchor?.fallback ?? opening.memoryCallback ?? null;
      this.session.phase = "listening";
      await this.speak(opening.say, this.session.language);
      this.emitSession();
    } catch (err) {
      console.error("[care] startCheckIn failed:", err);
      this.hooks?.onError(
        err instanceof Error ? err.message : "Could not start the check-in"
      );
      this.session.phase = "listening";
      this.emitSession();
    } finally {
      this.busy = false;
    }
  }

  async handlePatientAudio(
    audioBase64: string,
    mimeType = "audio/wav"
  ): Promise<void> {
    let text = "";
    let language = this.session.language;
    try {
      const stt = await this.speech().transcribe(
        Buffer.from(audioBase64, "base64"),
        mimeType
      );
      text = stt.text.trim();
      language = stt.language;
    } catch (err) {
      console.error("[care] STT failed:", err);
      this.hooks?.onError(
        err instanceof Error ? err.message : "Could not hear that"
      );
      return;
    }
    if (!text) {
      this.hooks?.onError("I didn't catch that — could you say it again?");
      return;
    }
    await this.handlePatientText(text, language);
  }

  async handlePatientText(text: string, languageHint?: string): Promise<void> {
    const clean = text.trim();
    if (!clean) return;

    // Check-in already finished — do not parrot or append more agent turns.
    if (this.session.phase === "complete") {
      console.log("[care] ignoring patient_text after complete");
      return;
    }

    if (this.session.phase === "idle") {
      await this.startCheckIn();
    }
    if (this.busy) {
      this.hooks?.onError("One moment — still listening to the last answer.");
      return;
    }
    this.busy = true;

    const language = detectLanguageFromText(clean, languageHint);
    this.session.language = language;
    this.addTurn("patient", clean, language);
    this.session.turns_used += 1;
    this.emitSession();

    try {
      const result = await this.agent.patientTurn(clean, language);
      // Keep the deterministic memory beat for the UI; never let a later turn
      // overwrite it with a contradictory paraphrase.
      if (!this.session.memory_callback && result.memoryCallback) {
        this.session.memory_callback = result.memoryCallback;
      }
      this.session.draft = {
        symptoms: result.symptoms,
        medication_taken: result.medicationTaken,
        notes: result.notes,
      };

      // Include this turn's agent reply when judging what is still missing so
      // we don't re-ask a topic the model just covered in `say`.
      const previewTranscript = [
        ...this.session.transcript,
        {
          speaker: "agent" as const,
          text: result.say,
          language: this.session.language,
          timestamp: new Date().toISOString(),
        },
      ];
      const coverage = assessTopicCoverage(
        previewTranscript,
        result.medicationTaken
      );
      // Medication is only "covered" once answered (true/false), not merely asked.
      const medsAnswered = result.medicationTaken !== null;
      const topicsIncomplete =
        !coverage.feeling || !medsAnswered || !coverage.pain;
      const missing = remainingRequiredTopics({
        ...coverage,
        medication: medsAnswered,
      });

      const redFlag =
        RED_FLAG_LANGUAGE.test(clean) ||
        result.symptoms.wound >= 2 ||
        result.symptoms.fever >= 2 ||
        result.symptoms.breathlessness >= 2 ||
        result.symptoms.pain >= 3;

      const budgetLeft =
        this.clarifyCount < CLARIFY_BUDGET &&
        this.session.turns_used < MAX_PATIENT_TURNS;

      // Demo path: keep going only while required topics remain, or one red-flag
      // spare after the short path. Do NOT force extra turns when topics are done
      // (that caused antibiotic re-ask loops). Target wrap after MIN_PATIENT_TURNS.
      const wantsMore = topicsIncomplete
        ? this.session.turns_used < MAX_PATIENT_TURNS
        : Boolean(
            redFlag &&
              result.needsClarification &&
              this.session.turns_used >= MIN_PATIENT_TURNS &&
              this.session.turns_used < MAX_PATIENT_TURNS
          );

      if (wantsMore && budgetLeft) {
        this.clarifyCount += 1;
        this.session.phase = "clarifying";

        let say = result.say;
        // Never re-ask medication once answered — that was the antibiotic loop bug.
        if (
          medsAnswered &&
          sayCoversMedication(say) &&
          say.trim().endsWith("?")
        ) {
          console.log("[care] suppressing medication re-ask (already answered)");
          if (!coverage.pain) {
            say = PAIN_FALLBACK_ASK;
          } else if (redFlag) {
            // Keep a non-med clarify if the model offered one; else soft ack and
            // let the next branch fall through only when topics are complete.
            say = sayCoversMedication(result.say)
              ? "Achha — ghav ke paas laali ya bukhar to nahi?"
              : result.say;
          } else {
            // Topics done and no red flag — don't speak another question.
            say = "";
          }
        } else if (!medsAnswered && !sayCoversMedication(say)) {
          // Combined pain + meds on the demo follow-up (even if greeting touched pain).
          console.log(
            `[care] forcing pain+meds probe (missing: ${missing.join(", ")})`
          );
          say = PAIN_AND_MEDS_FALLBACK_ASK;
        } else if (medsAnswered && !coverage.pain && !sayCoversPain(say)) {
          console.log("[care] forcing pain probe");
          say = PAIN_FALLBACK_ASK;
        } else if (!say.trim().endsWith("?") && topicsIncomplete) {
          if (!medsAnswered) {
            say = PAIN_AND_MEDS_FALLBACK_ASK;
          } else if (!coverage.pain) {
            say = PAIN_FALLBACK_ASK;
          }
        }

        if (say.trim()) {
          await this.speak(say, language);
          this.session.phase = "listening";
          this.emitSession();
          return;
        }
        // Empty say after suppress → fall through to finalise.
      }

      if (topicsIncomplete) {
        console.log(
          `[care] wrapping at turn cap with gaps: ${missing.join(", ") || "none"}`
        );
      }

      // About to assess — don't ask another question then immediately close.
      if (result.say.trim() && !result.say.trim().endsWith("?")) {
        await this.speak(result.say, language);
      }
      await this.finalise();
    } catch (err) {
      console.error("[care] patient turn failed:", err);
      this.hooks?.onError(
        err instanceof Error ? err.message : "The care agent stumbled"
      );
      this.session.phase = "listening";
      this.emitSession();
    } finally {
      this.busy = false;
    }
  }

  /** Force the assessment even if the agent wanted another question. */
  async finishNow(): Promise<void> {
    if (this.busy || this.session.phase === "idle") return;
    this.busy = true;
    try {
      await this.finalise();
    } finally {
      this.busy = false;
    }
  }

  /**
   * Attach Galaxy Watch spot vitals to the active check-in.
   * Preferred over carry-forward resting_hr / activity_index in finalise().
   * Zero / tiny step counts are stored but do NOT map onto activity_index
   * (that was zeroing mobility and contradicting a Stable outcome).
   */
  setLiveVitals(vitals: {
    resting_hr?: number;
    spo2?: number;
    steps?: number;
    activity_index?: number;
  }): void {
    if (this.session.phase === "idle" || this.session.phase === "complete") {
      console.log("[care] watch_vitals ignored — no active check-in");
      return;
    }

    const next: NonNullable<typeof this.liveVitals> = {
      ...(this.liveVitals ?? {}),
    };

    if (isValidHr(vitals.resting_hr)) {
      next.resting_hr = Math.round(vitals.resting_hr!);
    }

    if (isValidSpo2(vitals.spo2)) {
      next.spo2 = Math.round(vitals.spo2!);
    }

    if (
      typeof vitals.steps === "number" &&
      Number.isFinite(vitals.steps) &&
      vitals.steps >= 0
    ) {
      next.steps = Math.round(vitals.steps);
      // Only meaningful daily totals map onto the 0–100 mobility index.
      if (isMeaningfulSteps(vitals.steps)) {
        next.activity_index = Math.min(
          100,
          Math.max(0, Math.round(vitals.steps / 100))
        );
      }
    }

    if (
      typeof vitals.activity_index === "number" &&
      Number.isFinite(vitals.activity_index) &&
      vitals.activity_index >= 15
    ) {
      next.activity_index = Math.min(
        100,
        Math.max(0, Math.round(vitals.activity_index))
      );
    }

    this.liveVitals = next;
    console.log(
      `[care] watch_vitals hr=${next.resting_hr ?? "—"} spo2=${next.spo2 ?? "—"} steps=${next.steps ?? "—"} activity=${next.activity_index ?? "—"}`
    );
  }

  private async finalise(): Promise<void> {
    if (this.session.phase === "complete") return;
    this.session.phase = "assessing";
    this.emitSession();

    const history = this.activeHistory;
    const patient = this.activePatient;
    const baseline = computeBaseline(history, patient.discharged_on);
    const last = history[history.length - 1];

    const patientTurns = this.session.transcript
      .filter((t) => t.speaker === "patient")
      .map((t) => t.text);
    const patientSaid = patientTurns.join(" ");

    let symptoms = this.session.draft?.symptoms ?? { ...EMPTY_SYMPTOMS };
    // Belt-and-suspenders: phrase floors against each patient utterance and the
    // combined transcript (so "haan" on its own turn still scores).
    for (const turn of patientTurns) {
      symptoms = applySymptomFloors(symptoms, turn);
    }
    symptoms = applySymptomFloors(symptoms, patientSaid);

    // Pair each patient reply with the prior agent probe ("ghav ke paas laali?").
    const turns = this.session.transcript;
    for (let i = 0; i < turns.length; i++) {
      if (turns[i].speaker !== "patient") continue;
      let priorAgent: string | null = null;
      for (let j = i - 1; j >= 0; j--) {
        if (turns[j].speaker === "agent") {
          priorAgent = turns[j].text;
          break;
        }
      }
      symptoms = applyContextualAffirmation(symptoms, turns[i].text, priorAgent);
    }

    // Last word goes to what she actually denied, over anything inferred above.
    for (const turn of patientTurns) {
      symptoms = applyExplicitDenials(symptoms, turn);
    }

    let resolvedMed = this.session.draft?.medication_taken ?? null;
    for (let i = 0; i < turns.length; i++) {
      if (turns[i].speaker !== "patient") continue;
      let priorAgent: string | null = null;
      for (let j = i - 1; j >= 0; j--) {
        if (turns[j].speaker === "agent") {
          priorAgent = turns[j].text;
          break;
        }
      }
      const inferred = inferMedicationTaken(turns[i].text, priorAgent);
      if (inferred !== null) resolvedMed = inferred;
    }
    if (resolvedMed === null) {
      console.log(
        "[care] medication_taken still unset at finalise — defaulting true (unconfirmed; should be rare after topic gate)"
      );
    }
    const medicationTaken = resolvedMed ?? true;

    // Prefer live Galaxy Watch samples; demo fills missing/zero vitals so the
    // pitch never shows Stable + "0 steps / 100% below mobility".
    const resolved = resolveCheckInVitals({
      demo: this.mode === "demo",
      live: this.liveVitals,
      last,
      baseline,
    });
    const { activity_index, resting_hr, spo2, steps } = resolved;

    const verdict = classifyRisk({
      symptoms,
      medication_taken: medicationTaken,
      activity_index,
      baseline,
      recent: history.slice(-4),
    });

    const checkIn: CheckIn = {
      id: this.session.session_id || randomUUID(),
      date: new Date().toISOString().slice(0, 10),
      completed_at: new Date().toISOString(),
      symptoms,
      medication_taken: medicationTaken,
      activity_index,
      resting_hr,
      ...(spo2 != null ? { spo2 } : {}),
      ...(steps != null ? { steps } : {}),
      risk: verdict.risk,
      risk_score: verdict.score,
      recommendation: verdict.recommendation,
      action: verdict.action,
      reasoning: verdict.reasoning,
      notes: this.session.draft?.notes || "Live voice check-in",
      transcript: [...this.session.transcript],
      simulated: false,
    };

    this.liveVitals = null;

    // Write-back: demo → Lakshmi care.json; user → their own profile history.
    if (this.mode === "user" && this.activeUserId) {
      try {
        await appendUserCheckIn(this.activeUserId, checkIn);
      } catch (err) {
        console.error("[care] appendUserCheckIn failed:", err);
      }
      this.activeHistory = this.activeHistory.filter((c) => c.id !== checkIn.id);
      this.activeHistory.push(checkIn);
    } else {
      careStore.appendCheckIn(checkIn);
      this.activeHistory = careStore.getHistory();
      this.activePatient = careStore.getPatient();
    }
    this.session.result = checkIn;
    console.log(
      `[care] ${verdict.action}() risk=${verdict.risk} score=${verdict.score} mode=${this.mode}`
    );

    if (this.activeRunId) {
      try {
        await completeRun(this.activeRunId, verdict.risk, checkIn.id);
      } catch (err) {
        console.error("[care] completeRun failed:", err);
      } finally {
        this.activeRunId = null;
      }
    }

    if (verdict.action === "escalate") {
      void notifyDoctorUrgent(patient, checkIn);
    } else if (verdict.action === "recommend_doctor_review") {
      void notifyDoctorReview(patient, checkIn);
    }

    // Patient hears a fixed warm outcome — never invent, never ask a question.
    const closing = outcomeLine(verdict.risk, this.session.language);

    this.session.phase = "complete";
    await this.speak(closing, this.session.language);
    this.emitSession();
    this.emitDoctorView();
  }
}

export const careOrchestrator = new CareOrchestrator();
