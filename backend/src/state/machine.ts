import type { SessionState, Severity } from "../types.js";

/** Explicit legal transitions for the Rakshak session state machine. */
const TRANSITIONS: Record<SessionState, SessionState[]> = {
  idle: ["listening"],
  listening: ["triaging", "handoff_generated", "idle"],
  triaging: ["reassuring", "handoff_generated", "idle"],
  reassuring: ["triaging", "handoff_generated", "resolved", "idle"],
  handoff_generated: ["escalating", "resolved", "idle"],
  escalating: ["awaiting_handover", "resolved", "idle"],
  awaiting_handover: ["resolved", "escalating", "idle"],
  resolved: ["idle"],
};

export function canTransition(from: SessionState, to: SessionState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: SessionState, to: SessionState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal state transition: ${from} → ${to}`);
  }
}

export function severityRequiresEscalation(severity: Severity): boolean {
  return severity === "medium" || severity === "high";
}

export function stateLabel(state: SessionState): string {
  return state.toUpperCase().replace(/_/g, " ");
}
