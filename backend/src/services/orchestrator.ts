import { config, DEMO_PATIENT } from "../config.js";
import { severityRequiresEscalation } from "../state/machine.js";
import { sessionStore } from "../state/sessionStore.js";
import type {
  ConversationTurn,
  EscalationHop,
  SessionEvent,
  Severity,
  TriggerType,
} from "../types.js";
import { escalationService } from "./escalation.js";
import { type CareLlmClient, type ToolCall } from "./careLlm.js";
import {
  arrivalFallback,
  detectLanguageFromText,
  familyEnRouteFallback,
  helpComingLine,
  languageInstructionForLlm,
  resolveTtsLanguage,
} from "./language.js";
import { createLlmClient } from "./llm.js";
import { createSpeechClient, type SpeechClient } from "./speech.js";

export type BroadcastFn = (session: SessionEvent, reason: string) => void;
export type TranscriptDeltaFn = (turn: ConversationTurn) => void;
export type TtsAudioFn = (payload: {
  audio_base64: string;
  mime_type: string;
  text: string;
}) => void;

/**
 * Orchestrator — spine of Rakshak.
 * Owns the conversation loop, tool-call → state-machine mapping,
 * Amazon Transcribe and Polly, and escalation.
 */
export class Orchestrator {
  private llm: CareLlmClient;
  private speech: SpeechClient;
  private busy = false;
  private pendingPatient: { text: string; language: string } | null = null;
  private checkInTimer: NodeJS.Timeout | null = null;
  /** True after we've already told the patient that help has been called. */
  private toldPatientHelpComing = false;
  /** Last patient speaking language — drives TTS + reassurance language. */
  private patientLanguage = config.demoLanguage;
  private broadcast: BroadcastFn = () => {};
  private onTranscriptDelta: TranscriptDeltaFn = () => {};
  private onTts: TtsAudioFn = () => {};

  constructor() {
    this.llm = createLlmClient();
    this.speech = createSpeechClient();
  }

  wire(opts: {
    broadcast: BroadcastFn;
    onTranscriptDelta: TranscriptDeltaFn;
    onTts: TtsAudioFn;
  }): void {
    this.broadcast = opts.broadcast;
    this.onTranscriptDelta = opts.onTranscriptDelta;
    this.onTts = opts.onTts;

    sessionStore.subscribe((session, reason) => {
      this.broadcast(session, reason);
    });
  }

  getSession(): SessionEvent {
    return sessionStore.get();
  }

  async handleTrigger(trigger: TriggerType): Promise<SessionEvent> {
    if (this.busy) {
      throw new Error("Rakshak is still speaking — wait a moment, then try again.");
    }
    this.busy = true;
    this.pendingPatient = null;
    this.toldPatientHelpComing = false;
    this.patientLanguage = config.demoLanguage;
    this.clearCheckIn();
    escalationService.stop();

    try {
      this.llm.reset();
      this.llm.startSession();
      sessionStore.startFromTrigger(trigger);

      await this.speakFromSystem(
        "greeting: The watch detected a possible fall. In ONE short sentence, ask whether the patient is alright and whether they can get up. Do NOT escalate yet — wait for their reply. Speak clear English for the greeting; switch language later if they reply in Hindi or code-mix."
      );

      const s = sessionStore.get();
      if (s.state === "listening") {
        sessionStore.transition("triaging", "triage start");
      }
      return sessionStore.get();
    } catch (err) {
      console.error("[orch] trigger failed:", err);
      this.llm.reset();
      sessionStore.reset();
      throw err instanceof Error
        ? err
        : new Error("Trigger failed — check AWS credentials and Bedrock model access, then try again.");
    } finally {
      this.busy = false;
      await this.flushPendingPatient();
    }
  }

  async handlePatientText(
    text: string,
    language = config.demoLanguage
  ): Promise<SessionEvent> {
    const trimmed = text.trim();
    if (!trimmed) return sessionStore.get();

    const state = sessionStore.get().state;
    if (state === "idle" || state === "resolved") {
      throw new Error("Fire a trigger first.");
    }

    const resolvedLang = detectLanguageFromText(trimmed, language);
    this.patientLanguage = resolvedLang;

    if (this.busy) {
      this.pendingPatient = { text: trimmed, language: resolvedLang };
      console.warn("[orch] busy — queued patient text");
      return sessionStore.get();
    }

    this.busy = true;
    try {
      const patientTurn: ConversationTurn = {
        speaker: "patient",
        text: trimmed,
        timestamp: new Date().toISOString(),
        language: resolvedLang,
      };
      sessionStore.appendTurn(patientTurn);
      this.onTranscriptDelta(patientTurn);

      const llmInput = [
        languageInstructionForLlm(resolvedLang, trimmed),
        "",
        `Patient said: ${trimmed}`,
      ].join("\n");
      console.log(`[orch] patient lang=${resolvedLang}`);

      const result = await this.llm.sendPatientTurn(llmInput);
      await this.applyToolCalls(result.toolCalls);
      const forced = this.ensureEscalationIfNeeded(result.toolCalls, trimmed);

      if (result.text.trim()) {
        await this.emitAiTurn(result.text, resolvedLang);
        if (this.looksLikeHelpComingLine(result.text)) {
          this.toldPatientHelpComing = true;
        }
      }

      // After we escalate, Lakshmi MUST hear that help is coming — even if the
      // model only tool-called or the safety net forced the phone chain.
      if (forced || this.sessionNeedsHelpComingLine()) {
        await this.reassurePatientHelpIsComing();
      }

      this.maybeScheduleCheckIn();
      return sessionStore.get();
    } finally {
      this.busy = false;
      await this.flushPendingPatient();
    }
  }

  async handlePatientAudio(
    audioBase64: string,
    mimeType = "audio/wav"
  ): Promise<SessionEvent> {
    const started = Date.now();
    const buffer = Buffer.from(audioBase64, "base64");
    console.log(
      `[orch] patient audio received bytes=${buffer.length} mime=${mimeType}`
    );
    const stt = await this.speech.transcribe(buffer, mimeType);
    console.log(
      `[orch] STT completed in ${Date.now() - started}ms: ${JSON.stringify(stt.text)}`
    );
    if (!stt.text.trim()) {
      throw new Error("Didn't catch that — try again a little louder.");
    }
    const language = detectLanguageFromText(
      stt.text,
      stt.language || config.demoLanguage
    );
    return this.handlePatientText(stt.text, language);
  }

  async confirmArrival(): Promise<SessionEvent> {
    if (this.busy) {
      throw new Error("Rakshak is still speaking — wait a second, then confirm.");
    }

    const state = sessionStore.get().state;
    if (
      state !== "awaiting_handover" &&
      state !== "escalating" &&
      state !== "reassuring" &&
      state !== "handoff_generated"
    ) {
      throw new Error(`Cannot confirm arrival from state: ${state}`);
    }

    this.busy = true;
    this.clearCheckIn();
    escalationService.stop();

    try {
      // Normalize into a state that can resolve
      const current = sessionStore.get().state;
      if (current === "handoff_generated") {
        sessionStore.transition("escalating", "arrival shortcut");
      }
      if (sessionStore.get().state === "escalating") {
        sessionStore.transition("awaiting_handover", "arrival confirmed");
      }

      try {
        await this.speakFromSystem(
          "arrival: A human helper has arrived. Sign off warmly in one or two short sentences."
        );
      } catch (err) {
        console.error("[orch] arrival speech failed, using fallback:", err);
        await this.emitAiTurn(
          arrivalFallback(this.patientLanguage),
          this.patientLanguage
        );
      }

      if (sessionStore.get().state !== "resolved") {
        sessionStore.transition("resolved", "resolved");
      }
      return sessionStore.get();
    } finally {
      this.busy = false;
    }
  }

  /**
   * Family PWA "I'm on my way" — acknowledge the family hop and tell the patient.
   */
  async handleFamilyOnMyWay(
    contactRole: EscalationHop["contact_role"] = "family"
  ): Promise<SessionEvent> {
    const state = sessionStore.get().state;
    if (
      state !== "escalating" &&
      state !== "awaiting_handover" &&
      state !== "handoff_generated"
    ) {
      throw new Error(`Family cannot acknowledge from state: ${state}`);
    }

    const chain = sessionStore.get().escalation_chain;
    let index = chain.findIndex((h) => h.contact_role === contactRole);
    if (index < 0) {
      // Ensure a family hop exists so Command Center updates even if escalate
      // hasn't finished broadcasting yet
      const fallback = sessionStore.defaultEscalationChain();
      sessionStore.setEscalationChain(fallback);
      index = fallback.findIndex((h) => h.contact_role === contactRole);
    }
    if (index < 0) index = 0;

    const hop = sessionStore.get().escalation_chain[index];
    if (hop && hop.status !== "acknowledged") {
      if (hop.status === "pending") {
        sessionStore.updateEscalationHop(index, "notified");
      }
      sessionStore.updateEscalationHop(index, "acknowledged");
    }

    // Move into awaiting_handover if still escalating
    if (sessionStore.get().state === "escalating") {
      try {
        sessionStore.transition("awaiting_handover", "family en route");
      } catch {
        /* ignore */
      }
    }
    if (sessionStore.get().state === "handoff_generated") {
      try {
        sessionStore.transition("escalating", "family en route");
        sessionStore.transition("awaiting_handover", "family en route");
      } catch {
        /* ignore */
      }
    }

    const name = hop?.contact_name ?? "Your family";
    if (this.busy) {
      this.pendingPatient = null;
      console.warn("[orch] busy — family ack recorded, speech deferred");
      return sessionStore.get();
    }

    this.busy = true;
    try {
      try {
        await this.speakFromSystem(
          `family_en_route: ${name} has confirmed they are on their way to the patient. Tell the patient calmly in one short sentence in the patient's current language (${this.patientLanguage}) — e.g. Hindi/Hinglish if that is what they have been speaking. Do not ask a question.`
        );
      } catch (err) {
        console.error("[orch] family en-route speech failed, using fallback:", err);
        await this.emitAiTurn(
          familyEnRouteFallback(this.patientLanguage),
          this.patientLanguage
        );
      }
      this.maybeScheduleCheckIn();
      return sessionStore.get();
    } finally {
      this.busy = false;
      await this.flushPendingPatient();
    }
  }

  async handleFamilyArrived(): Promise<SessionEvent> {
    return this.confirmArrival();
  }

  reset(): SessionEvent {
    this.clearCheckIn();
    escalationService.stop();
    this.pendingPatient = null;
    this.toldPatientHelpComing = false;
    this.patientLanguage = config.demoLanguage;
    this.busy = false;
    this.llm.reset();
    return sessionStore.reset();
  }

  private async flushPendingPatient(): Promise<void> {
    const pending = this.pendingPatient;
    if (!pending || this.busy) return;
    this.pendingPatient = null;
    try {
      await this.handlePatientText(pending.text, pending.language);
    } catch (err) {
      console.error("[orch] queued patient turn failed:", err);
    }
  }

  private async speakFromSystem(note: string): Promise<void> {
    const result = await this.llm.sendSystemNote(note);
    // Never let greeting/check-in system notes dial the phone by accident
    const isPreTriage =
      note.startsWith("greeting:") || note.startsWith("followup:");
    const tools = isPreTriage
      ? result.toolCalls.filter((c) => c.name === "assess")
      : result.toolCalls;
    await this.applyToolCalls(tools);
    if (result.text.trim()) {
      await this.emitAiTurn(result.text, this.patientLanguage);
    }
  }

  private async emitAiTurn(text: string, language: string): Promise<void> {
    const ttsLang = resolveTtsLanguage(language, text);
    const turn: ConversationTurn = {
      speaker: "ai",
      text,
      timestamp: new Date().toISOString(),
      language: ttsLang,
    };
    sessionStore.appendTurn(turn);
    this.onTranscriptDelta(turn);

    try {
      const tts = await this.speech.synthesize(text, ttsLang);
      this.onTts(tts);
    } catch (err) {
      console.error("[orch] TTS failed:", err);
    }
  }

  private async applyToolCalls(calls: ToolCall[]): Promise<void> {
    let handoffSeverity: Severity | null = null;

    for (const call of calls) {
      switch (call.name) {
        case "assess": {
          sessionStore.setSeverity(call.args.severity, call.args.reasoning);
          const state = sessionStore.get().state;
          if (severityRequiresEscalation(call.args.severity)) {
            handoffSeverity = call.args.severity;
          } else if (
            call.args.severity === "low" &&
            (state === "triaging" || state === "listening")
          ) {
            try {
              sessionStore.transition("reassuring", "reassuring");
            } catch {
              /* already past */
            }
          }
          break;
        }
        case "generate_handoff": {
          const severity =
            handoffSeverity ??
            sessionStore.get().severity ??
            ("medium" as const);
          const handoff = sessionStore.buildHandoff({
            ...call.args,
            severity: severity === "low" ? "medium" : severity,
          });
          sessionStore.setHandoff(handoff);
          const st = sessionStore.get().state;
          if (st === "triaging" || st === "reassuring" || st === "listening") {
            try {
              sessionStore.transition("handoff_generated");
            } catch {
              /* ignore */
            }
          }
          break;
        }
        case "escalate": {
          this.beginEscalation(call.args.chain);
          break;
        }
        case "stay_and_reassure": {
          this.enterAwaitingHandover();
          break;
        }
      }
    }

    // Never leave the session stuck in escalating — stay-with-patient is mandatory
    if (sessionStore.get().state === "escalating") {
      this.enterAwaitingHandover();
    }
  }

  /**
   * Demo safety net: if the LLM assessed medium/high but skipped escalate,
   * force the phone chain. Returns true when it actually forced escalation.
   */
  private ensureEscalationIfNeeded(calls: ToolCall[], patientText: string): boolean {
    const severity = sessionStore.get().severity;
    if (!severity || !severityRequiresEscalation(severity)) return false;

    const hasEscalate = calls.some((c) => c.name === "escalate");
    if (hasEscalate) return false;

    const state = sessionStore.get().state;
    if (
      state !== "triaging" &&
      state !== "reassuring" &&
      state !== "listening" &&
      state !== "handoff_generated"
    ) {
      return false;
    }

    // Need a real patient utterance before we dial anyone
    const patientSpoke = sessionStore
      .get()
      .transcript.some((t) => t.speaker === "patient");
    if (!patientSpoke) return false;

    // Force only for clear high-urgency signals — a "medium" read on its own
    // (e.g. "just a bit of hip pain") stays a conversation, no phone call.
    const urgent =
      severity === "high" ||
      /can't get up|cannot get up|can't stand|cannot stand|chest pain|can't breathe|cannot breathe|confused|unconscious|bleeding|help me|उठ नहीं|नहीं पा रही|नहीं पा रहा|मदद|gir gayi|gir gaya|uth nahi|madad chahiye/i.test(
        patientText
      );
    if (!urgent) return false;

    console.warn(
      "[orch] LLM skipped escalate — forcing handoff + escalation for demo"
    );

    if (!sessionStore.get().handoff) {
      sessionStore.setHandoff(
        sessionStore.buildHandoff({
          patient_name: DEMO_PATIENT.name,
          age: DEMO_PATIENT.age,
          location: DEMO_PATIENT.location,
          condition: "Acute distress after patient report",
          symptoms: [patientText.slice(0, 80)],
          recommended_action: "Urgent family / EMS check-in; do not leave alone",
          severity,
        })
      );
    }

    try {
      const st = sessionStore.get().state;
      if (st === "triaging" || st === "reassuring" || st === "listening") {
        sessionStore.transition("handoff_generated");
      }
    } catch {
      /* ignore */
    }

    this.beginEscalation();
    this.enterAwaitingHandover();
    return true;
  }

  private sessionNeedsHelpComingLine(): boolean {
    if (this.toldPatientHelpComing) return false;
    const st = sessionStore.get().state;
    return (
      st === "escalating" ||
      st === "awaiting_handover" ||
      st === "handoff_generated"
    );
  }

  private looksLikeHelpComingLine(text: string): boolean {
    return /daughter|family|security|text message|help is|on (her|their|the) way|called|let .+ know|coming|beti|aa rahi|bata diya|madad|theek hai/i.test(
      text
    );
  }

  /** Always tell Lakshmi on the watch that help is being called. */
  private async reassurePatientHelpIsComing(): Promise<void> {
    if (this.toldPatientHelpComing) return;
    this.toldPatientHelpComing = true;
    await this.emitAiTurn(
      helpComingLine(this.patientLanguage),
      this.patientLanguage
    );
  }

  private beginEscalation(chainArg?: EscalationHop[]): void {
    const st = sessionStore.get().state;
    // Do not re-dial or reset an in-flight chain when the agent re-emits escalate
    if (
      (st === "escalating" || st === "awaiting_handover") &&
      sessionStore
        .get()
        .escalation_chain.some(
          (h) =>
            h.status === "notified" ||
            h.status === "acknowledged" ||
            h.status === "timed_out"
        )
    ) {
      console.log("[orch] escalate already in flight — ignoring duplicate");
      return;
    }

    const chain =
      chainArg && chainArg.length > 0
        ? chainArg
        : sessionStore.defaultEscalationChain();

    if (
      st === "handoff_generated" ||
      st === "triaging" ||
      st === "reassuring" ||
      st === "listening"
    ) {
      if (st !== "handoff_generated" && !sessionStore.get().handoff) {
        const sev = sessionStore.get().severity ?? "medium";
        sessionStore.setHandoff(
          sessionStore.buildHandoff({
            condition: "distress — details pending",
            symptoms: [],
            recommended_action: "Family check-in urgently",
            severity: sev === "low" ? "medium" : sev,
          })
        );
        try {
          sessionStore.transition("handoff_generated");
        } catch {
          /* ignore */
        }
      }
      try {
        if (sessionStore.get().state !== "handoff_generated") {
          if (
            sessionStore.get().state === "triaging" ||
            sessionStore.get().state === "reassuring" ||
            sessionStore.get().state === "listening"
          ) {
            sessionStore.transition("handoff_generated");
          }
        }
        if (sessionStore.get().state === "handoff_generated") {
          sessionStore.transition("escalating", "escalated");
        }
      } catch (e) {
        console.error("[orch] escalate transition:", e);
      }
    }

    escalationService.start(chain, () => {
      /* sessionStore already emits */
    });
  }

  private enterAwaitingHandover(): void {
    const st = sessionStore.get().state;
    if (st === "escalating") {
      try {
        sessionStore.transition("awaiting_handover", "awaiting handover");
      } catch {
        /* ignore */
      }
    }
  }

  /** Periodic check-ins during awaiting_handover (stay with patient). */
  private maybeScheduleCheckIn(): void {
    this.clearCheckIn();
    const state = sessionStore.get().state;
    if (state !== "awaiting_handover" && state !== "escalating") return;

    this.checkInTimer = setTimeout(async () => {
      const s = sessionStore.get().state;
      if (s !== "awaiting_handover" && s !== "escalating") return;
      if (this.busy) {
        this.maybeScheduleCheckIn();
        return;
      }
      this.busy = true;
      try {
        await this.speakFromSystem(
          "check-in: Briefly check in with the patient. One short reassuring question."
        );
      } catch (err) {
        console.error("[orch] check-in failed:", err);
      } finally {
        this.busy = false;
        this.maybeScheduleCheckIn();
        await this.flushPendingPatient();
      }
    }, 25_000);
  }

  private clearCheckIn(): void {
    if (this.checkInTimer) {
      clearTimeout(this.checkInTimer);
      this.checkInTimer = null;
    }
  }
}

export const orchestrator = new Orchestrator();
