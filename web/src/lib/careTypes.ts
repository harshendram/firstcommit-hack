export type RiskLevel = "green" | "amber" | "red";

export type SymptomKey =
  | "pain"
  | "fever"
  | "wound"
  | "breathlessness"
  | "dizziness";

export type SymptomScores = Record<SymptomKey, number>;

export interface CareTurn {
  speaker: "agent" | "patient";
  text: string;
  language: string;
  timestamp: string;
}

export interface CheckIn {
  id: string;
  date: string;
  completed_at: string;
  symptoms: SymptomScores;
  medication_taken: boolean;
  activity_index: number;
  resting_hr: number;
  /** Blood oxygen % when watch measured it; omit/null if unavailable. */
  spo2?: number | null;
  /** Raw daily steps when watch measured them. */
  steps?: number | null;
  risk: RiskLevel;
  risk_score: number;
  recommendation: string;
  action: "continue_monitoring" | "recommend_doctor_review" | "escalate";
  reasoning: string[];
  notes: string;
  transcript: CareTurn[];
  simulated: boolean;
}

export interface PatientProfile {
  id: string;
  name: string;
  age: number;
  location: string;
  procedure: string;
  discharged_on: string;
  conditions: string[];
  medications: string[];
  preferred_language: string;
  discharge_summary?: string;
  discharge_uploaded_at?: string;
}

export interface Baseline {
  symptoms: SymptomScores;
  activity_index: number;
  resting_hr: number;
  adherence_pct: number;
  stable_days: number;
  post_op_day: number;
}

export interface TrendSignal {
  label: string;
  direction: "up" | "down" | "flat";
  detail: string;
}

export interface DoctorView {
  patient: PatientProfile;
  baseline: Baseline;
  latest: CheckIn | null;
  trend: TrendSignal[];
  history: CheckIn[];
  adherence_pct: number;
  streak_days: number;
}

export interface PatientMonitorCard {
  id: string;
  name: string;
  age: number;
  procedure: string;
  demo: boolean;
  checkins_today: number;
  total_live_checkins: number;
  latest_risk: RiskLevel | null;
  latest_at: string | null;
  latest_notes: string | null;
}

export type CheckInPhase =
  | "idle"
  | "greeting"
  | "listening"
  | "clarifying"
  | "assessing"
  | "complete";

export interface CheckInSession {
  session_id: string;
  phase: CheckInPhase;
  started_at: string | null;
  language: string;
  transcript: CareTurn[];
  memory_callback: string | null;
  turns_used: number;
  draft: {
    symptoms: SymptomScores;
    medication_taken: boolean | null;
    notes: string;
  } | null;
  result: CheckIn | null;
}

export type CareServerMessage =
  | { type: "care_session"; session: CheckInSession }
  | { type: "care_turn"; turn: CareTurn }
  | { type: "care_doctor"; view: DoctorView }
  | { type: "care_roster"; patients: PatientMonitorCard[] }
  | {
      type: "care_tts";
      audio_base64?: string;
      audio_url?: string;
      mime_type: string;
      text: string;
    }
  | { type: "care_error"; message: string };

export type CareClientMessage =
  | { type: "hello"; role: "patient" | "doctor" | "watch" }
  | {
      type: "start_checkin";
      name?: string;
      email?: string;
      userId?: string;
      username?: string;
      demo?: boolean;
    }
  | { type: "patient_text"; text: string; language?: string }
  | { type: "patient_audio"; audio_base64: string; mime_type?: string }
  | {
      type: "watch_vitals";
      resting_hr?: number;
      spo2?: number;
      steps?: number;
      activity_index?: number;
    }
  | { type: "finish_checkin" }
  | { type: "reset" };

export const IDLE_CHECKIN: CheckInSession = {
  session_id: "",
  phase: "idle",
  started_at: null,
  language: "hi-IN",
  transcript: [],
  memory_callback: null,
  turns_used: 0,
  draft: null,
  result: null,
};

export const SYMPTOM_LABELS: Record<SymptomKey, string> = {
  pain: "Surgical site pain",
  fever: "Fever / chills",
  wound: "Wound redness or discharge",
  breathlessness: "Breathlessness",
  dizziness: "Dizziness",
};

export const RISK_COPY: Record<
  RiskLevel,
  { label: string; action: string; tone: string; wash: string; dot: string }
> = {
  green: {
    label: "Continue Monitoring",
    action: "continue_monitoring()",
    tone: "text-ok",
    wash: "bg-ok-wash ring-ok/25",
    dot: "bg-ok",
  },
  amber: {
    label: "Surgical Review Recommended",
    action: "recommend_doctor_review()",
    tone: "text-warn",
    wash: "bg-warn-wash ring-warn/30",
    dot: "bg-warn",
  },
  red: {
    label: "Immediate Escalation",
    action: "escalate()",
    tone: "text-alert",
    wash: "bg-alert-wash ring-alert/30",
    dot: "bg-alert",
  },
};
