export type RiskLevel = "green" | "amber" | "red";

export type SymptomKey =
  | "pain"
  | "fever"
  | "wound"
  | "breathlessness"
  | "dizziness";

/** 0 = none, 1 = mild, 2 = moderate, 3 = severe */
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
  /** Blood oxygen % from Galaxy Watch when measured; omit if unavailable. */
  spo2?: number | null;
  /** Raw daily steps from watch when measured. */
  steps?: number | null;
  risk: RiskLevel;
  risk_score: number;
  recommendation: string;
  action: "continue_monitoring" | "recommend_doctor_review" | "escalate";
  reasoning: string[];
  notes: string;
  transcript: CareTurn[];
  /** Seeded history is simulated; today's live check-in is not. */
  simulated: boolean;
}

export interface PatientProfile {
  id: string;
  name: string;
  age: number;
  location: string;
  /** What they were discharged after. */
  procedure: string;
  discharged_on: string;
  conditions: string[];
  medications: string[];
  preferred_language: string;
  /** Full discharge summary text from Sarvam digitisation (if uploaded). */
  discharge_summary?: string;
  discharge_uploaded_at?: string;
}

/**
 * Post-op recovery has an *expected* trajectory — pain should be falling by
 * day five. `symptoms` here is what today should look like, not a flat average,
 * so "worse than expected" is measurable rather than vague.
 */
export interface Baseline {
  symptoms: SymptomScores;
  activity_index: number;
  resting_hr: number;
  adherence_pct: number;
  stable_days: number;
  /** Days since discharge. */
  post_op_day: number;
}

export interface TrendSignal {
  label: string;
  direction: "up" | "down" | "flat";
  detail: string;
}

/** Read model the doctor dashboard renders. */
export interface DoctorView {
  patient: PatientProfile;
  baseline: Baseline;
  latest: CheckIn | null;
  trend: TrendSignal[];
  history: CheckIn[];
  adherence_pct: number;
  streak_days: number;
}

/** Compact row for the multi-patient monitoring roster. */
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
      /** Inline audio for browser clients on the LAN. */
      audio_base64?: string;
      /** Prefer this on Wear OS — avoids multi‑hundred‑KB WS frames. */
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
      /** true = Lakshmi demo seed; omit/false = logged-in user's profile */
      demo?: boolean;
    }
  | { type: "patient_text"; text: string; language?: string }
  | { type: "patient_audio"; audio_base64: string; mime_type?: string }
  | {
      type: "watch_vitals";
      resting_hr?: number;
      spo2?: number;
      steps?: number;
      /** Optional direct activity index; otherwise derived from steps. */
      activity_index?: number;
    }
  | { type: "finish_checkin" }
  | { type: "reset" };

export const EMPTY_SYMPTOMS: SymptomScores = {
  pain: 0,
  fever: 0,
  wound: 0,
  breathlessness: 0,
  dizziness: 0,
};

export const SYMPTOM_LABELS: Record<SymptomKey, string> = {
  pain: "Surgical site pain",
  fever: "Fever / chills",
  wound: "Wound redness or discharge",
  breathlessness: "Breathlessness",
  dizziness: "Dizziness",
};
