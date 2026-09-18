export type TriggerType = "manual_tap" | "voice_distress" | "simulated_fall";

export type SessionState =
  | "idle"
  | "listening"
  | "triaging"
  | "reassuring"
  | "handoff_generated"
  | "escalating"
  | "awaiting_handover"
  | "resolved";

export type Severity = "low" | "medium" | "high";

export interface ConversationTurn {
  speaker: "patient" | "ai";
  text: string;
  timestamp: string;
  language: string;
}

export interface HandoffSummary {
  patient_name: string;
  age: number;
  location: string;
  condition: string;
  symptoms: string[];
  medical_history: string[];
  medications: string[];
  recommended_action: string;
  severity: Severity;
  generated_at: string;
}

export interface EscalationHop {
  contact_name: string;
  contact_role: "neighbour" | "security" | "family" | "emergency_services";
  status: "pending" | "notified" | "acknowledged" | "timed_out";
  notified_at?: string;
  phone?: string;
  channel?: "whatsapp" | "sms" | "voice";
}

export interface TimelineEntry {
  label: string;
  at: string;
  elapsed_ms: number;
}

export interface SessionEvent {
  session_id: string;
  state: SessionState;
  trigger_type: TriggerType | null;
  severity: Severity | null;
  transcript: ConversationTurn[];
  handoff: HandoffSummary | null;
  escalation_chain: EscalationHop[];
  timeline: TimelineEntry[];
  started_at: string | null;
  updated_at: string;
}

export type ClientRole = "dashboard" | "patient" | "watch" | "family";

export type ClientMessage =
  | { type: "hello"; role: ClientRole }
  | { type: "trigger"; trigger_type: TriggerType }
  | { type: "patient_text"; text: string; language?: string }
  | { type: "patient_audio"; audio_base64: string; mime_type?: string }
  | { type: "confirm_arrival" }
  | { type: "family_on_my_way"; contact_role?: EscalationHop["contact_role"] }
  | { type: "family_arrived" }
  | { type: "reset" };

export type ServerMessage =
  | { type: "session"; session: SessionEvent }
  | { type: "transcript_delta"; turn: ConversationTurn; session_id: string }
  | {
      type: "tts_audio";
      audio_base64?: string;
      audio_url?: string;
      mime_type: string;
      text: string;
    }
  | { type: "error"; message: string }
  | { type: "pong" };

export const IDLE_SESSION: SessionEvent = {
  session_id: "",
  state: "idle",
  trigger_type: null,
  severity: null,
  transcript: [],
  handoff: null,
  escalation_chain: [],
  timeline: [],
  started_at: null,
  updated_at: new Date(0).toISOString(),
};

export const STATE_LABEL: Record<SessionState, string> = {
  idle: "Idle",
  listening: "Listening",
  triaging: "Triaging",
  reassuring: "Reassuring",
  handoff_generated: "Handoff ready",
  escalating: "Escalating",
  awaiting_handover: "Awaiting handover",
  resolved: "Resolved",
};

export const ROLE_LABEL: Record<EscalationHop["contact_role"], string> = {
  neighbour: "Neighbour",
  security: "Security",
  family: "Family",
  emergency_services: "Emergency services",
};
