import { randomUUID } from "node:crypto";
import { DEMO_PATIENT } from "../config.js";
import type {
  ConversationTurn,
  EscalationHop,
  HandoffSummary,
  SessionEvent,
  SessionState,
  Severity,
  TimelineEntry,
  TriggerType,
} from "../types.js";
import { assertTransition } from "./machine.js";

type Listener = (session: SessionEvent, reason: string) => void;

function nowIso(): string {
  return new Date().toISOString();
}

function emptySession(): SessionEvent {
  return {
    session_id: randomUUID(),
    state: "idle",
    trigger_type: null,
    severity: null,
    transcript: [],
    handoff: null,
    escalation_chain: [],
    timeline: [],
    started_at: null,
    updated_at: nowIso(),
  };
}

export class SessionStore {
  private session: SessionEvent = emptySession();
  private listeners = new Set<Listener>();

  get(): SessionEvent {
    return structuredClone(this.session);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(reason: string): void {
    this.session.updated_at = nowIso();
    const snapshot = this.get();
    for (const listener of this.listeners) {
      listener(snapshot, reason);
    }
  }

  private addTimeline(label: string): void {
    const started = this.session.started_at
      ? new Date(this.session.started_at).getTime()
      : Date.now();
    const entry: TimelineEntry = {
      label,
      at: nowIso(),
      elapsed_ms: Date.now() - started,
    };
    this.session.timeline.push(entry);
  }

  reset(): SessionEvent {
    this.session = emptySession();
    this.emit("reset");
    return this.get();
  }

  transition(to: SessionState, timelineLabel?: string): SessionEvent {
    assertTransition(this.session.state, to);
    this.session.state = to;
    if (timelineLabel) this.addTimeline(timelineLabel);
    this.emit(`state:${to}`);
    return this.get();
  }

  startFromTrigger(trigger: TriggerType): SessionEvent {
    if (this.session.state !== "idle") {
      this.session = emptySession();
    }
    this.session.trigger_type = trigger;
    this.session.started_at = nowIso();
    this.session.state = "listening";
    this.addTimeline("trigger");
    this.emit("trigger");
    return this.get();
  }

  setSeverity(severity: Severity, reasoning?: string): SessionEvent {
    this.session.severity = severity;
    this.addTimeline(`assess:${severity}${reasoning ? ` — ${reasoning.slice(0, 60)}` : ""}`);
    this.emit("severity");
    return this.get();
  }

  appendTurn(turn: ConversationTurn): SessionEvent {
    this.session.transcript.push(turn);
    this.emit("transcript");
    return this.get();
  }

  setHandoff(handoff: HandoffSummary): SessionEvent {
    this.session.handoff = handoff;
    this.addTimeline("handoff_generated");
    this.emit("handoff");
    return this.get();
  }

  setEscalationChain(chain: EscalationHop[]): SessionEvent {
    this.session.escalation_chain = chain;
    this.emit("escalation_chain");
    return this.get();
  }

  updateEscalationHop(
    index: number,
    status: EscalationHop["status"],
    patch?: Partial<Pick<EscalationHop, "channel" | "phone">>
  ): SessionEvent {
    const hop = this.session.escalation_chain[index];
    if (!hop) return this.get();
    hop.status = status;
    if (status === "notified") hop.notified_at = nowIso();
    if (patch?.channel) hop.channel = patch.channel;
    if (patch?.phone) hop.phone = patch.phone;
    this.addTimeline(`${hop.contact_role}:${status}`);
    this.emit("escalation_hop");
    return this.get();
  }

  /** Hardcoded demo medical data merged into a handoff. */
  buildHandoff(partial: {
    patient_name?: string;
    age?: number;
    location?: string;
    condition: string;
    symptoms: string[];
    recommended_action: string;
    severity: Severity;
  }): HandoffSummary {
    return {
      patient_name: partial.patient_name?.trim() || DEMO_PATIENT.name,
      age: partial.age && partial.age > 0 ? partial.age : DEMO_PATIENT.age,
      location: partial.location?.trim() || DEMO_PATIENT.location,
      condition: partial.condition?.trim() || "distress — details pending",
      symptoms: partial.symptoms?.length ? partial.symptoms : ["not reported"],
      medical_history: [...DEMO_PATIENT.medical_history],
      medications: [...DEMO_PATIENT.medications],
      recommended_action:
        partial.recommended_action?.trim() ||
        "Check on the patient urgently",
      severity: partial.severity,
      generated_at: nowIso(),
    };
  }

  defaultEscalationChain(): EscalationHop[] {
    return DEMO_PATIENT.emergency_contacts.map((c) => ({
      contact_name: c.contact_name,
      contact_role: c.contact_role,
      phone: c.phone,
      status: "pending" as const,
    }));
  }
}

export const sessionStore = new SessionStore();
