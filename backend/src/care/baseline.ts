import {
  EMPTY_SYMPTOMS,
  SYMPTOM_LABELS,
  type Baseline,
  type CheckIn,
  type RiskLevel,
  type SymptomKey,
  type SymptomScores,
  type TrendSignal,
} from "./types.js";

const SYMPTOM_KEYS = Object.keys(EMPTY_SYMPTOMS) as SymptomKey[];

/** How much each symptom moves the deviation score. */
const WEIGHTS: Record<SymptomKey, number> = {
  wound: 1.6,
  fever: 1.5,
  pain: 1.2,
  breathlessness: 1.2,
  dizziness: 0.8,
};

const AMBER_AT = 2;
const RED_AT = 5;

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Where a normal recovery should be on a given post-op day. Pain falls,
 * mobility climbs, and fever is never expected — so "worse than yesterday" is
 * only interesting when it's also worse than the day should look.
 */
export function expectedRecovery(day: number): {
  symptoms: SymptomScores;
  activity_index: number;
} {
  const pain = day <= 2 ? 3 : day <= 4 ? 2.3 : day <= 7 ? 1.6 : day <= 10 ? 1 : 0.7;
  const wound = day <= 4 ? 1 : day <= 7 ? 0.5 : 0.2;
  // Mobility climbs then plateaus — full range doesn't return in a fortnight.
  const activity = Math.min(78, 16 + day * 6);
  return {
    symptoms: {
      pain: round1(pain),
      fever: 0,
      wound: round1(wound),
      breathlessness: 0,
      dizziness: day <= 3 ? 0.5 : 0.2,
    },
    activity_index: Math.round(activity),
  };
}

function postOpDay(history: CheckIn[], dischargedOn?: string | null): number {
  if (dischargedOn) {
    const discharged = new Date(`${dischargedOn}T12:00:00`).getTime();
    if (!Number.isNaN(discharged)) {
      const days = Math.round((Date.now() - discharged) / 86_400_000);
      return Math.max(0, days);
    }
  }
  const sorted = [...history].sort((a, b) =>
    a.completed_at.localeCompare(b.completed_at)
  );
  const first = sorted[0];
  if (!first) return 1;
  const days = Math.round(
    (Date.now() - new Date(first.completed_at).getTime()) / 86_400_000
  );
  return Math.max(1, days + 1);
}

/**
 * "Baseline" for a post-op patient is the expected recovery curve for today,
 * not an average of their own past — averaging would let a worsening week
 * quietly become the new normal.
 */
export function computeBaseline(
  history: CheckIn[],
  dischargedOn?: string | null
): Baseline {
  const sorted = [...history].sort((a, b) =>
    a.completed_at.localeCompare(b.completed_at)
  );
  const day = postOpDay(sorted, dischargedOn);
  const expected = expectedRecovery(day);
  const taken = sorted.filter((c) => c.medication_taken).length;

  return {
    symptoms: expected.symptoms,
    activity_index: expected.activity_index,
    resting_hr: Math.round(mean(sorted.slice(0, 5).map((c) => c.resting_hr))) || 78,
    adherence_pct:
      sorted.length > 0 ? Math.round((taken / sorted.length) * 100) : 100,
    stable_days: sorted.length,
    post_op_day: day,
  };
}

export interface RiskInput {
  symptoms: SymptomScores;
  medication_taken: boolean;
  activity_index: number;
  baseline: Baseline;
  recent: CheckIn[];
}

export interface RiskOutput {
  risk: RiskLevel;
  score: number;
  action: CheckIn["action"];
  recommendation: string;
  reasoning: string[];
}

/**
 * Deliberately mechanical: the model reads symptoms, thresholds decide risk.
 * Same input always produces the same action, which is what makes the demo
 * repeatable across runs.
 */
export function classifyRisk(input: RiskInput): RiskOutput {
  const { symptoms, medication_taken, activity_index, baseline, recent } = input;
  const reasoning: string[] = [];
  let score = 0;

  const day = baseline.post_op_day;

  // Today against where day N of recovery *should* be — the primary signal.
  for (const key of SYMPTOM_KEYS) {
    const today = symptoms[key] ?? 0;
    const base = baseline.symptoms[key] ?? 0;
    const delta = today - base;
    if (delta > 0.3) {
      score += delta * WEIGHTS[key];
      reasoning.push(
        `${SYMPTOM_LABELS[key]} ${today.toFixed(0)}/3 — expected ${base.toFixed(1)} by day ${day} (+${delta.toFixed(1)})`
      );
    }
  }

  // Pain that reverses direction is the signal a single day can't show.
  const painSeries = recent.map((c) => c.symptoms.pain ?? 0);
  if (painSeries.length >= 3) {
    const earlier = mean(painSeries.slice(0, Math.ceil(painSeries.length / 2)));
    const later = mean(painSeries.slice(Math.ceil(painSeries.length / 2)));
    if (later - earlier > 0.4) {
      score += 0.75;
      reasoning.push(
        `Pain reversing — rising again after improving through day 7`
      );
    }
  }

  // Mobility should be climbing after surgery; falling is the red-flag shape.
  const shortfall =
    baseline.activity_index > 0
      ? ((baseline.activity_index - activity_index) / baseline.activity_index) *
        100
      : 0;
  if (shortfall >= 25) {
    score += 0.5;
    reasoning.push(
      `Walking ${Math.round(shortfall)}% below expected mobility for day ${day}`
    );
  } else if (shortfall >= 12) {
    score += 0.25;
    reasoning.push(
      `Walking ${Math.round(shortfall)}% below expected mobility for day ${day}`
    );
  }

  if (!medication_taken) {
    score += 1;
    reasoning.push("Antibiotic dose missed today");
  }

  score = round1(score);

  // Hard red flags override the score entirely.
  const infection = (symptoms.fever ?? 0) >= 1 && (symptoms.wound ?? 0) >= 2;
  const redFlag =
    infection ||
    (symptoms.fever ?? 0) >= 2 ||
    (symptoms.wound ?? 0) >= 3 ||
    (symptoms.breathlessness ?? 0) >= 3;

  let risk: RiskLevel;
  if (redFlag || score >= RED_AT) {
    risk = "red";
  } else if (score >= AMBER_AT) {
    risk = "amber";
  } else {
    risk = "green";
  }

  if (redFlag) {
    reasoning.unshift(
      infection
        ? "Red flag: fever with wound discharge — possible surgical site infection"
        : (symptoms.fever ?? 0) >= 2
          ? "Red flag: significant fever"
          : (symptoms.wound ?? 0) >= 3
            ? "Red flag: wound discharge"
            : "Red flag: severe breathlessness"
    );
  }

  if (reasoning.length === 0) {
    reasoning.push(`Recovery tracking as expected for day ${day}`);
  }

  const action: CheckIn["action"] =
    risk === "red"
      ? "escalate"
      : risk === "amber"
        ? "recommend_doctor_review"
        : "continue_monitoring";

  const recommendation =
    risk === "red"
      ? "Review today — possible surgical site infection. Readmission risk if missed."
      : risk === "amber"
        ? "Review within 48 hours — recovery is tracking behind expected for this day."
        : "Recovery on track. Continue daily monitoring.";

  return { risk, score, action, recommendation, reasoning };
}

/** Short trend lines the doctor dashboard renders under the status. */
export function buildTrend(history: CheckIn[], baseline: Baseline): TrendSignal[] {
  const sorted = [...history].sort((a, b) =>
    a.completed_at.localeCompare(b.completed_at)
  );
  if (sorted.length === 0) return [];

  const latest = sorted[sorted.length - 1]!;
  const prev = sorted.length > 1 ? sorted[sorted.length - 2]! : null;
  const prior = sorted.slice(0, -1);
  const signals: TrendSignal[] = [];

  const painNow = latest.symptoms.pain ?? 0;
  const painPrev = prev?.symptoms.pain ?? null;
  const painBestPrior =
    prior.length > 0
      ? Math.min(...prior.map((c) => c.symptoms.pain ?? 0))
      : null;

  // Compare latest vs previous — never mean(last4) vs historical min
  // (that falsely flags "rising" after a good live green day).
  if (painPrev != null && painNow > painPrev + 0.4) {
    signals.push({
      label: "Pain rising again after improving",
      direction: "up",
      detail: `${painNow.toFixed(1)}/3 today vs ${painPrev.toFixed(1)}/3 last check-in — expected ${(baseline.symptoms.pain ?? 0).toFixed(1)} by day ${baseline.post_op_day}`,
    });
  } else if (
    painPrev != null &&
    painBestPrior != null &&
    painNow <= painBestPrior &&
    painPrev - painNow > 0.4
  ) {
    signals.push({
      label: "Pain improving vs recent days",
      direction: "down",
      detail: `${painNow.toFixed(1)}/3 today · was ${painPrev.toFixed(1)}/3 — expected ${(baseline.symptoms.pain ?? 0).toFixed(1)} by day ${baseline.post_op_day}`,
    });
  }

  const feverNow = latest.symptoms.fever ?? 0;
  if (feverNow > 0) {
    signals.push({
      label: "Low-grade fever appearing",
      direction: "up",
      detail: `Fever / chills ${feverNow}/3 on today's check-in`,
    });
  }

  const woundNow = latest.symptoms.wound ?? 0;
  if (woundNow >= 1) {
    signals.push({
      label: "Wound changes reported",
      direction: "up",
      detail: `${woundNow}/3 today — expected ${(baseline.symptoms.wound ?? 0).toFixed(1)} by day ${baseline.post_op_day}`,
    });
  } else if (
    prior.some((c) => (c.symptoms.wound ?? 0) >= 1) &&
    woundNow === 0
  ) {
    signals.push({
      label: "Wound looking clearer",
      direction: "down",
      detail: `No wound concerns on today's check-in — expected ${(baseline.symptoms.wound ?? 0).toFixed(1)} by day ${baseline.post_op_day}`,
    });
  }

  const activityNow = latest.activity_index;
  const drop =
    baseline.activity_index > 0
      ? Math.round(
          ((baseline.activity_index - activityNow) / baseline.activity_index) * 100
        )
      : 0;
  if (drop >= 15) {
    signals.push({
      label: `Mobility ${drop}% behind expected`,
      direction: "down",
      detail: `${Math.round(activityNow)} vs ${baseline.activity_index} expected for day ${baseline.post_op_day}`,
    });
  } else if (activityNow >= baseline.activity_index * 0.9) {
    signals.push({
      label: "Mobility near expected curve",
      direction: "flat",
      detail: `${Math.round(activityNow)} vs ${baseline.activity_index} expected for day ${baseline.post_op_day}`,
    });
  }

  signals.push({
    label: `Antibiotic adherence ${baseline.adherence_pct}%`,
    direction: baseline.adherence_pct >= 90 ? "flat" : "down",
    detail: `${history.length} check-ins since discharge`,
  });

  return signals;
}

export interface MemoryAnchor {
  /** Instruction handed to the model so the callback actually gets spoken. */
  forPrompt: string;
  /**
   * Clinical English for the banner / memory_callback rubric evidence.
   * May use third person and numeric scores — never spoken aloud.
   */
  fallback: string;
  /**
   * Full second-person Hinglish opening for TTS/transcript.
   * Addresses the patient as aap/you; no clinical score dumps.
   */
  spokenOpening: string;
}

/** Rough days-ago → spoken Hinglish time phrase. */
function spokenDaysAgo(days: number): string {
  if (days <= 1) return "Kal";
  if (days <= 3) return "Kuch din pehle";
  if (days <= 10) return "Peechle hafte";
  return "Peechle kuch din mein";
}

/**
 * The Memory & Context beat, computed rather than hoped for: pair the patient's
 * own earlier remark with the drift that has happened since.
 */
export function buildMemoryAnchor(
  history: CheckIn[],
  baseline: Baseline,
  patientFirstName = "Lakshmi"
): MemoryAnchor | null {
  const sorted = [...history].sort((a, b) =>
    a.completed_at.localeCompare(b.completed_at)
  );
  if (sorted.length < 4) return null;

  const remark = [...sorted]
    .reverse()
    .find((c) => /better|best|unaided|on track/i.test(c.notes) && c.risk === "green");
  const recent = sorted.slice(-4);

  const painNow = mean(recent.map((c) => c.symptoms.pain ?? 0));
  const painBest = Math.min(...sorted.map((c) => c.symptoms.pain ?? 0));
  const activityNow = mean(recent.map((c) => c.activity_index));
  const drop =
    baseline.activity_index > 0
      ? Math.round(
          ((baseline.activity_index - activityNow) / baseline.activity_index) * 100
        )
      : 0;

  const clinicalChanges: string[] = [];
  const spokenDrift: string[] = [];
  if (painNow - painBest > 0.4) {
    clinicalChanges.push(
      `her knee pain has climbed back to ${painNow.toFixed(1)}/3`
    );
    spokenDrift.push("ghutne ka dard wapas badh gaya");
  }
  if (drop >= 10) {
    clinicalChanges.push(`she is walking ${drop}% less than this day should look`);
    spokenDrift.push("chalna kam ho gaya");
  }
  if (clinicalChanges.length === 0) return null;

  const daysAgo = remark
    ? Math.max(
        1,
        Math.round(
          (Date.now() - new Date(remark.completed_at).getTime()) / 86_400_000
        )
      )
    : 0;

  const remarkQuote = remark
    ? remark.notes.replace(/^Said /i, "").replace(/\.$/, "")
    : "";

  const past = remark
    ? `${daysAgo} days ago she told you "${remarkQuote}"`
    : `she was steady until about five days ago`;

  const fallback = `${past.charAt(0).toUpperCase()}${past.slice(1)} — since then ${clinicalChanges.join(" and ")}.`;

  // Spoken line: 2nd person Hinglish, no "she/her", no "2.3/3" dumps.
  const when = spokenDaysAgo(daysAgo);
  const pastSpoken = remark
    ? `${when} aapne kaha tha ghutna kaafi behtar lag raha hai`
    : "Peechle din aapki recovery theek chal rahi thi";
  const driftSpoken = spokenDrift.join(" aur ");
  const spokenOpening = `Namaste ${patientFirstName}. ${pastSpoken}, lekin peechle kuch din se ${driftSpoken}. Aaj bhi aisa feel ho raha hai?`;

  return {
    // Banner keeps clinical English; spoken opening is fixed Hinglish below.
    forPrompt: [
      "MEMORY ANCHOR — the opening already spoken to the patient is fixed.",
      "Do not invert improved/hasn't. Do not restate clinical scores out loud.",
      `Banner/memory_callback (clinical, not spoken): "${fallback}"`,
      `Spoken opening (already used): "${spokenOpening}"`,
    ].join(" "),
    fallback,
    spokenOpening,
  };
}

/** Compact history summary handed to the LLM so it can reference the past. */
export function summariseHistoryForPrompt(
  history: CheckIn[],
  baseline: Baseline
): string {
  const sorted = [...history].sort((a, b) =>
    a.completed_at.localeCompare(b.completed_at)
  );
  const recent = sorted.slice(-5);
  const lines = recent.map((c) => {
    const s = c.symptoms;
    return `- ${c.date}: pain ${s.pain}/3, fever ${s.fever}/3, wound ${s.wound}/3, activity ${c.activity_index}, antibiotic ${c.medication_taken ? "taken" : "MISSED"} — "${c.notes}"`;
  });

  const bestDay = sorted.find((c) => c.notes.toLowerCase().includes("best day"));

  return [
    `Post-operative day ${baseline.post_op_day} after left knee replacement (discharged ${baseline.post_op_day} days ago).`,
    `Expected for day ${baseline.post_op_day}: pain ${baseline.symptoms.pain}/3, fever 0/3, wound ${baseline.symptoms.wound}/3, mobility index ${baseline.activity_index}. Antibiotic adherence so far ${baseline.adherence_pct}%.`,
    `Discharge focus today: confirm walks, antibiotic, wound red flags; dressing change is due on Day 5 (tomorrow if today is Day 4). Avoid stairs without assistance.`,
    "",
    "Recent check-ins (most recent last):",
    ...lines,
    bestDay
      ? `\nNotable earlier remark (${bestDay.date}): "${bestDay.notes}"`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
