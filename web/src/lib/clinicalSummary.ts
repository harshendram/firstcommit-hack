import type {

  CheckIn,

  DoctorView,

  PatientMonitorCard,

  PatientProfile,

  RiskLevel,

} from "./careTypes";



export interface ClinicalBullet {

  kind: "progress" | "concern";

  text: string;

}



export interface AiRecoverySummary {

  patientName: string;

  dayLabel: string;

  procedure: string;

  progress: string[];

  concerns: string[];

  recommendation: string;

  confidence: number;

  risk: RiskLevel;

  why: string[];

}



export interface RecoveryScorecard {

  score: number;

  items: { label: string; ok: boolean }[];

}



export interface TimelineDay {

  id: string;

  dayIndex: number;

  label: string;

  risk: RiskLevel;

  notes: string;

  completedAt: string;

}



export type TrendMetric = "pain" | "fever" | "hr" | "walking" | "spo2";



export interface TrendPoint {

  id: string;

  label: string;

  value: number;

  risk: RiskLevel;

  /** True when this day has no reading (e.g. SpO₂ before watch live check-in). */
  missing?: boolean;

}



export interface TrendSeries {

  key: TrendMetric;

  title: string;

  unit: string;

  max: number;

  points: TrendPoint[];

}



export type PatientStatusKind = "stable" | "monitor" | "escalate";



export interface PatientStatusCard {

  kind: PatientStatusKind;

  label: string;

  tone: string;

  wash: string;

  because: string[];

  nextCheckIn: string;

  recommendation: string;

  risk: RiskLevel;

}



export interface DischargeContext {

  headline: string;

  lines: string[];

}



const STATUS_META: Record<

  PatientStatusKind,

  { label: string; tone: string; wash: string }

> = {

  stable: {

    label: "Stable",

    tone: "text-ok",

    wash: "bg-ok-wash ring-ok/25",

  },

  monitor: {

    label: "Monitor",

    tone: "text-warn",

    wash: "bg-warn-wash ring-warn/30",

  },

  escalate: {

    label: "Escalate",

    tone: "text-alert",

    wash: "bg-alert-wash ring-alert/30",

  },

};



function sortedHistory(history: CheckIn[]): CheckIn[] {

  return [...history].sort((a, b) =>

    a.completed_at.localeCompare(b.completed_at)

  );

}



function dayChipLabel(iso: string): string {

  try {

    return new Date(iso).toLocaleDateString([], {

      day: "2-digit",

      month: "short",

    });

  } catch {

    return "";

  }

}



export function buildAiRecoverySummary(

  view: DoctorView,

  focus?: CheckIn | null

): AiRecoverySummary | null {

  const history = sortedHistory(view.history);

  const latest = focus ?? history[history.length - 1] ?? null;

  if (!latest) return null;

  const prev =

    history.filter((c) => c.id !== latest.id).slice(-1)[0] ?? null;



  const progress: string[] = [];

  const concerns: string[] = [];



  const pain = latest.symptoms.pain ?? 0;

  const fever = latest.symptoms.fever ?? 0;

  const wound = latest.symptoms.wound ?? 0;

  const prevPain = prev?.symptoms.pain ?? null;



  if (prevPain != null && pain < prevPain) {

    progress.push(`Pain reduced from yesterday (${prevPain} → ${pain})`);

  } else if (prevPain != null && pain > prevPain) {

    concerns.push(`Pain increased from yesterday (${prevPain} → ${pain})`);

  } else if (pain <= 1) {

    progress.push("Pain is mild or improving");

  } else {

    concerns.push(`Pain still elevated (${pain}/3)`);

  }



  if (latest.medication_taken) {

    progress.push("Medication taken as advised");

  } else {

    concerns.push("Missed antibiotics / medication today");

  }



  if (latest.activity_index >= (prev?.activity_index ?? 40)) {

    progress.push(

      latest.activity_index >= 55

        ? `Walked / mobility looking good (${latest.activity_index})`

        : `Completed light activity (${latest.activity_index})`

    );

  } else {

    concerns.push("Mobility lower than recent days");

  }



  if (fever === 0) progress.push("No fever");

  else concerns.push(`Fever / chills reported (${fever}/3)`);



  if (wound === 0) progress.push("Wound looks fine");

  else if (wound === 1) concerns.push("Mild wound changes / swelling");

  else concerns.push(`Wound concern elevated (${wound}/3)`);



  if (
    latest.spo2 != null &&
    Number.isFinite(latest.spo2) &&
    latest.spo2 >= 70 &&
    latest.spo2 <= 100
  ) {

    if (latest.spo2 >= 95) {

      progress.push(`SpO₂ looking good (${latest.spo2}%)`);

    } else if (latest.spo2 >= 92) {

      concerns.push(`SpO₂ slightly low (${latest.spo2}%)`);

    } else {

      concerns.push(`SpO₂ low (${latest.spo2}%)`);

    }

  }



  const why = buildWhyRisk(latest, prev, view.baseline.activity_index);



  const confidence = Math.round(

    Math.min(

      97,

      Math.max(

        72,

        88 + (latest.simulated ? -4 : 5) - pain * 3 - fever * 4 - wound * 3

      )

    )

  );



  return {

    patientName: view.patient.name,

    dayLabel: `Day ${view.baseline.post_op_day}`,

    procedure: view.patient.procedure,

    progress: progress.slice(0, 4),

    concerns: concerns.slice(0, 3),

    recommendation: latest.recommendation,

    confidence,

    risk: latest.risk,

    why,

  };

}



export function buildWhyRisk(

  latest: CheckIn,

  prev: CheckIn | null,

  baselineActivity = 50

): string[] {

  const why: string[] = [];

  const pain = latest.symptoms.pain ?? 0;

  const fever = latest.symptoms.fever ?? 0;

  const wound = latest.symptoms.wound ?? 0;

  const prevPain = prev?.symptoms.pain ?? null;



  if (prevPain != null && pain > prevPain) {

    why.push(`Pain increased by ${pain - prevPain} point(s)`);

  }

  if (!latest.medication_taken) why.push("Missed antibiotics today");

  if (wound >= 1) {

    why.push(wound >= 2 ? "Wound redness / discharge" : "Mild swelling reported");

  }

  if (fever >= 1) why.push("Fever or chills reported");

  const mobilityBehind =
    baselineActivity > 0 &&
    latest.activity_index < baselineActivity * 0.85 &&
    latest.activity_index < 40;

  if (mobilityBehind) {

    why.push("Mobility behind expected recovery curve");

  }

  if (
    latest.spo2 != null &&
    Number.isFinite(latest.spo2) &&
    latest.spo2 >= 70 &&
    latest.spo2 <= 100 &&
    latest.spo2 < 94
  ) {

    why.push(`SpO₂ ${latest.spo2}% (below typical resting range)`);

  }

  for (const r of latest.reasoning.slice(0, 3)) {

    if (!r) continue;

    // Skip stale mobility shortfall lines when today's activity is fine.
    if (
      !mobilityBehind &&
      /below expected mobility|behind expected recovery/i.test(r)
    ) {

      continue;

    }

    if (!why.some((w) => w.toLowerCase().includes(r.slice(0, 18).toLowerCase()))) {

      why.push(r);

    }

  }

  if (why.length === 0) {

    why.push("Symptoms aligned with expected recovery for this stage");

  }

  return why.slice(0, 4);

}



export function buildRecoveryScore(latest: CheckIn | null): RecoveryScorecard | null {

  if (!latest) return null;

  const items = [

    { label: "Medication", ok: latest.medication_taken },

    { label: "Walking", ok: latest.activity_index >= 45 },

    { label: "Dressing / wound", ok: (latest.symptoms.wound ?? 0) <= 1 },

    { label: "No fever", ok: (latest.symptoms.fever ?? 0) === 0 },

    { label: "Pain controlled", ok: (latest.symptoms.pain ?? 0) <= 1 },

  ];

  const okCount = items.filter((i) => i.ok).length;

  const score = Math.round((okCount / items.length) * 100);

  return { score, items };

}



export function buildRecoveryTimeline(

  history: CheckIn[],

  limit = 10

): TimelineDay[] {

  return sortedHistory(history)

    .slice(-limit)

    .map((c, i) => ({

      id: c.id,

      dayIndex: i + 1,

      label: dayChipLabel(c.completed_at),

      risk: c.risk,

      notes: c.notes,

      completedAt: c.completed_at,

    }));

}



export function buildTrendSeries(

  history: CheckIn[],

  limit = 10

): TrendSeries[] {

  const points = sortedHistory(history).slice(-limit);

  if (points.length === 0) return [];



  const labelFor = (c: CheckIn) => dayChipLabel(c.completed_at) || c.date;



  const map = (

    key: TrendMetric,

    title: string,

    unit: string,

    max: number,

    valueOf: (c: CheckIn) => number

  ): TrendSeries => ({

    key,

    title,

    unit,

    max,

    points: points.map((c) => ({

      id: c.id,

      label: labelFor(c),

      value: valueOf(c),

      risk: c.risk,

    })),

  });



  const maxWalk = Math.max(

    60,

    ...points.map((c) => c.activity_index),

    1

  );

  const maxHr = Math.max(100, ...points.map((c) => c.resting_hr || 0), 1);



  const series: TrendSeries[] = [

    map("pain", "Pain", "/3", 3, (c) => c.symptoms.pain ?? 0),

    map("fever", "Temperature", "score", 3, (c) => c.symptoms.fever ?? 0),

    map("hr", "Heart rate", "bpm", maxHr, (c) => c.resting_hr || 0),

    map("walking", "Walking", "min idx", maxWalk, (c) => c.activity_index),

  ];



  const spo2Points = points.filter(
    (c) =>
      c.spo2 != null &&
      Number.isFinite(c.spo2) &&
      (c.spo2 as number) >= 70 &&
      (c.spo2 as number) <= 100
  );

  if (spo2Points.length > 0) {
    const maxSpo2 = Math.max(100, ...spo2Points.map((c) => c.spo2 as number));
    series.push({
      key: "spo2",
      title: "SpO₂",
      unit: "%",
      max: maxSpo2,
      points: points.map((c) => {
        const valid =
          c.spo2 != null &&
          Number.isFinite(c.spo2) &&
          (c.spo2 as number) >= 70 &&
          (c.spo2 as number) <= 100;
        return {
          id: c.id,
          label: labelFor(c),
          value: valid ? (c.spo2 as number) : 0,
          risk: c.risk,
          missing: !valid,
        };
      }),
    });
  }



  return series;

}



function positiveStableBecause(checkIn: CheckIn): string[] {

  const lines: string[] = [];

  if (checkIn.medication_taken) lines.push("Medication taken as advised");

  if ((checkIn.symptoms.pain ?? 0) <= 1) {

    lines.push("Pain controlled for this recovery stage");

  } else if ((checkIn.symptoms.pain ?? 0) <= 2) {

    lines.push("Pain within expected range for this stage");

  }

  if ((checkIn.symptoms.wound ?? 0) <= 1) lines.push("Wound looking stable");

  if (checkIn.activity_index >= 40) {

    lines.push("Mobility on track for expected recovery");

  }

  if (
    checkIn.spo2 != null &&
    Number.isFinite(checkIn.spo2) &&
    checkIn.spo2 >= 95
  ) {

    lines.push(`SpO₂ steady at ${checkIn.spo2}%`);

  }

  if (lines.length === 0) {

    lines.push("Symptoms aligned with expected recovery for this stage");

  }

  return lines.slice(0, 3);

}



export function buildPatientStatus(checkIn: CheckIn | null): PatientStatusCard | null {

  if (!checkIn) return null;



  const kind: PatientStatusKind =

    checkIn.risk === "red" || checkIn.action === "escalate"

      ? "escalate"

      : checkIn.risk === "amber" || checkIn.action === "recommend_doctor_review"

        ? "monitor"

        : "stable";



  const meta = STATUS_META[kind];

  let because = buildWhyRisk(checkIn, null);



  // Stable / on-track must not show "100% below mobility" contradictions.
  if (kind === "stable") {

    const negative =
      /below expected|behind expected|missed antibiotic|fever or chills|wound redness|pain increased|spo₂ \d+%/i;

    because = because.filter((line) => !negative.test(line));

    if (because.length === 0) because = positiveStableBecause(checkIn);

  }



  return {

    kind,

    label: meta.label,

    tone: meta.tone,

    wash: meta.wash,

    because,

    nextCheckIn: nextCheckInLabel(),

    recommendation: checkIn.recommendation,

    risk: checkIn.risk,

  };

}



export function dischargeContext(

  patient: PatientProfile | null | undefined,

  memoryCallback?: string | null

): DischargeContext | null {

  if (!patient) return null;

  const lines: string[] = [];



  const walk = patient.medications.find((m) => /walk/i.test(m));

  const med = patient.medications.find((m) =>

    /antibiotic|medicine|medication|twice daily/i.test(m)

  );

  const dress = patient.medications.find((m) => /dressing|wound/i.test(m));



  if (walk) lines.push(walk);

  if (med) lines.push(med);

  if (dress) lines.push(dress);



  if (lines.length === 0 && patient.discharge_summary?.trim()) {

    const snippet = patient.discharge_summary

      .trim()

      .split(/[\n.]+/)

      .map((s) => s.trim())

      .find((s) => s.length > 12);

    if (snippet) lines.push(snippet.slice(0, 120));

  }



  if (lines.length === 0 && memoryCallback?.trim()) {

    lines.push(memoryCallback.trim().slice(0, 140));

  }



  if (lines.length === 0) return null;



  return {

    headline: walk

      ? `Discharge plan: ${walk}`

      : "Discharge plan on file",

    lines: lines.slice(0, 3),

  };

}



export function rosterCensus(roster: PatientMonitorCard[]) {

  const withRisk = roster.filter((p) => p.latest_risk && p.checkins_today > 0);

  const green = withRisk.filter((p) => p.latest_risk === "green").length;

  const amber = withRisk.filter((p) => p.latest_risk === "amber").length;

  const red = withRisk.filter((p) => p.latest_risk === "red").length;

  const awaiting = roster.filter((p) => p.checkins_today === 0).length;



  const priorityOrder: RiskLevel[] = ["red", "amber", "green"];

  const highest =

    [...withRisk].sort((a, b) => {

      const ra = priorityOrder.indexOf(a.latest_risk!);

      const rb = priorityOrder.indexOf(b.latest_risk!);

      if (ra !== rb) return ra - rb;

      return (b.latest_at ?? "").localeCompare(a.latest_at ?? "");

    })[0] ?? null;



  return { green, amber, red, awaiting, highest };

}



export function highestPriorityDetail(

  highest: PatientMonitorCard | null,

  view: DoctorView | null

): { pain: number; swelling: number; medsOk: boolean } | null {

  if (!highest || !view || view.patient.id !== highest.id) return null;

  const c = view.latest ?? sortedHistory(view.history).slice(-1)[0] ?? null;

  if (!c) return null;

  return {

    pain: c.symptoms.pain ?? 0,

    swelling: c.symptoms.wound ?? 0,

    medsOk: c.medication_taken,

  };

}



/** Demo SOS / fall signal from risk + notes (care channel has no separate fall event). */

export function isFallOrSosActive(

  view: DoctorView | null,

  latest: CheckIn | null

): boolean {

  if (!view) return false;

  const text = [

    latest?.notes ?? "",

    ...(latest?.reasoning ?? []),

    ...(view.history.slice(-3).flatMap((c) => [c.notes, ...c.reasoning])),

  ]

    .join(" ")

    .toLowerCase();

  if (/\b(fall|fell|slipped|sos|cannot get up|can't get up)\b/.test(text)) {

    return true;

  }

  return latest?.risk === "red" && latest.action === "escalate";

}



export const EMERGENCY_WORKFLOW_STEPS = [

  { id: "checkin", label: "Check-in" },

  { id: "risk", label: "Red risk" },

  { id: "doctor", label: "Doctor" },

  { id: "family", label: "Family" },

  { id: "capacity", label: "Rebalance" },

] as const;



export function nextCheckInLabel(): string {

  const d = new Date();

  d.setDate(d.getDate() + 1);

  d.setHours(9, 0, 0, 0);

  return d.toLocaleString([], {

    weekday: "short",

    hour: "numeric",

    minute: "2-digit",

  });

}

/** Large status pill on the per-patient clinical header. */
export interface HeaderStatus {
  label: string;
  actionLine: string;
  risk: RiskLevel;
}

export function buildHeaderStatus(checkIn: CheckIn | null): HeaderStatus {
  if (!checkIn) {
    return {
      label: "Awaiting Check-in",
      actionLine: "No check-in recorded yet today.",
      risk: "green",
    };
  }
  if (checkIn.risk === "red" || checkIn.action === "escalate") {
    return {
      label: "Escalate",
      actionLine: "Call within 30 minutes.",
      risk: "red",
    };
  }
  if (
    checkIn.risk === "amber" ||
    checkIn.action === "recommend_doctor_review"
  ) {
    return {
      label: "Needs Review",
      actionLine: "Review today.",
      risk: "amber",
    };
  }
  return {
    label: "Recovering Normally",
    actionLine: "No action required.",
    risk: "green",
  };
}

export type MetricTone = "ok" | "warn" | "alert" | "neutral";

export interface MetricCard {
  key: "pain" | "activity" | "medication" | "wound" | "temperature";
  label: string;
  value: string;
  tag: string;
  tone: MetricTone;
  /** Arrow direction vs prior check-in; null when no history. */
  trend: "up" | "down" | "flat" | null;
  /** True when the arrow direction is clinically favourable. */
  trendGood: boolean | null;
}

function trendDir(
  curr: number,
  prev: number | null
): "up" | "down" | "flat" | null {
  if (prev == null) return null;
  if (curr > prev) return "up";
  if (curr < prev) return "down";
  return "flat";
}

export function buildMetricStrip(
  view: DoctorView,
  focus?: CheckIn | null
): MetricCard[] {
  const history = sortedHistory(view.history);
  const latest = focus ?? history[history.length - 1] ?? null;
  if (!latest) return [];

  const prev =
    history.filter((c) => c.id !== latest.id).slice(-1)[0] ?? null;

  const pain = latest.symptoms.pain ?? 0;
  const prevPain = prev?.symptoms.pain ?? null;
  const painTrend = trendDir(pain, prevPain);
  const painTone: MetricTone =
    pain >= 3 ? "alert" : pain >= 2 ? "warn" : "ok";
  const painTag =
    painTrend === "down"
      ? "Improving"
      : painTrend === "up"
        ? "Rising"
        : pain <= 1
          ? "Controlled"
          : "Watch";

  const activity = latest.activity_index;
  const prevActivity = prev?.activity_index ?? null;
  const actTrend = trendDir(activity, prevActivity);
  const actTone: MetricTone =
    activity >= 40 ? "ok" : activity >= 25 ? "warn" : "alert";
  const actTag =
    actTrend === "up"
      ? "Improving"
      : actTrend === "down"
        ? "Lower"
        : activity >= 40
          ? "On track"
          : "Low";

  const medsOk = latest.medication_taken;
  const wound = latest.symptoms.wound ?? 0;
  const fever = latest.symptoms.fever ?? 0;

  const woundTone: MetricTone =
    wound >= 2 ? "alert" : wound >= 1 ? "warn" : "ok";
  const woundValue =
    wound >= 2 ? "Concern" : wound === 1 ? "Mild changes" : "Healing";
  const woundTag =
    wound >= 2 ? "Review" : wound === 1 ? "Watch" : "Normal";

  const tempTone: MetricTone =
    fever >= 2 ? "alert" : fever >= 1 ? "warn" : "ok";
  const tempValue =
    fever >= 2 ? "Fever" : fever === 1 ? "Mild elevation" : "Normal";
  const tempTag = fever === 0 ? "Normal" : fever === 1 ? "Watch" : "Alert";

  return [
    {
      key: "pain",
      label: "Pain today",
      value: `${pain} / 3`,
      tag: painTag,
      tone: painTone,
      trend: painTrend,
      trendGood: painTrend == null ? null : painTrend === "down",
    },
    {
      key: "activity",
      label: "Activity",
      value: `${activity} min`,
      tag: actTag,
      tone: actTone,
      trend: actTrend,
      trendGood: actTrend == null ? null : actTrend === "up",
    },
    {
      key: "medication",
      label: "Medication",
      value: medsOk ? "Taken" : "Missed",
      tag: medsOk ? "On track" : "Missed",
      tone: medsOk ? "ok" : "alert",
      trend: null,
      trendGood: null,
    },
    {
      key: "wound",
      label: "Wound",
      value: woundValue,
      tag: woundTag,
      tone: woundTone,
      trend: trendDir(wound, prev?.symptoms.wound ?? null),
      trendGood:
        prev == null
          ? null
          : wound < (prev.symptoms.wound ?? 0)
            ? true
            : wound > (prev.symptoms.wound ?? 0)
              ? false
              : null,
    },
    {
      key: "temperature",
      label: "Temperature",
      value: tempValue,
      tag: tempTag,
      tone: tempTone,
      trend: trendDir(fever, prev?.symptoms.fever ?? null),
      trendGood:
        prev == null
          ? null
          : fever < (prev.symptoms.fever ?? 0)
            ? true
            : fever > (prev.symptoms.fever ?? 0)
              ? false
              : null,
    },
  ];
}

export interface TimelineEntry {
  id: string;
  dayLabel: string;
  dateLabel: string;
  risk: RiskLevel;
  statusLabel: string;
  summary: string;
  completedAt: string;
  isToday: boolean;
}

export function buildClinicalTimeline(
  view: DoctorView,
  limit = 5
): TimelineEntry[] {
  const todayKey = new Date().toISOString().slice(0, 10);
  return sortedHistory(view.history)
    .slice(-limit)
    .reverse()
    .map((c) => {
      const pain = c.symptoms.pain ?? 0;
      const status = buildHeaderStatus(c);
      const dayNum = Math.max(
        1,
        Math.round(
          (new Date(c.completed_at).getTime() -
            new Date(view.patient.discharged_on).getTime()) /
            86_400_000
        ) + 1
      );
      const isToday = c.date === todayKey;
      return {
        id: c.id,
        dayLabel: isToday ? `Day ${dayNum} (Today)` : `Day ${dayNum}`,
        dateLabel: isToday
          ? "Today"
          : dayChipLabel(c.completed_at) || c.date,
        risk: c.risk,
        statusLabel:
          status.label === "Recovering Normally" ? "Good" : status.label,
        summary: `Pain ${pain}/3 · Activity ${c.activity_index} min. ${
          c.notes || status.actionLine
        }`,
        completedAt: c.completed_at,
        isToday,
      };
    });
}

export function checkInSnippet(
  checkIn: CheckIn | null
): { patient?: string; agent?: string; at: string } | null {
  if (!checkIn) return null;
  const turns = checkIn.transcript ?? [];
  const patient = [...turns].reverse().find((t) => t.speaker === "patient");
  const agent = [...turns].reverse().find((t) => t.speaker === "agent");
  let at = "";
  try {
    at = new Date(checkIn.completed_at).toLocaleString([], {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    at = checkIn.date;
  }
  if (!patient && !agent) {
    return {
      patient: checkIn.notes || undefined,
      at,
    };
  }
  return {
    patient: patient?.text,
    agent: agent?.text,
    at,
  };
}


