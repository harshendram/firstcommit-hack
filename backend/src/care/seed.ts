import type { CheckIn, PatientProfile } from "./types.js";

/** Day 0 = discharge. Today is day 4 — dressing change due tomorrow. */
export const DISCHARGE_DAYS_AGO = 4;

function isoDaysAgo(days: number, hour = 9): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 12, 0, 0);
  return d.toISOString();
}

function dateKey(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export const CARE_PATIENT: PatientProfile = {
  id: "lakshmi-rao",
  name: "Lakshmi Rao",
  age: 68,
  location: "Flat 3B, Brigade Residency, Bengaluru",
  procedure: "Left total knee replacement",
  discharged_on: dateKey(DISCHARGE_DAYS_AGO),
  conditions: ["Type 2 diabetes", "Hypertension"],
  // Human-pronounceable discharge instructions (no brand drug names).
  medications: [
    "antibiotic twice daily for 7 days",
    "pain medicine only if needed",
    "keep the wound clean and dry",
    "change the dressing after Day 5",
    "walk 15–20 minutes twice a day",
    "do not climb stairs without assistance",
    "contact doctor for fever, increasing redness, pus or severe swelling",
  ],
  preferred_language: "hi-IN",
};

interface SeedDay {
  daysAgo: number;
  pain: number;
  fever: number;
  wound: number;
  breathlessness: number;
  dizziness: number;
  activity: number;
  hr: number;
  meds: boolean;
  note: string;
}

/**
 * Early recovery, still on track. Demo wow comes from discharge instructions
 * (walks, antibiotic, dressing tomorrow, stairs) — not a late infection curve.
 */
const SEED_DAYS: SeedDay[] = [
  {
    daysAgo: 3,
    pain: 3,
    fever: 0,
    wound: 1,
    breathlessness: 0,
    dizziness: 1,
    activity: 22,
    hr: 84,
    meds: true,
    note: "Day 1 home. Sore but expected. Walked to the bathroom with support.",
  },
  {
    daysAgo: 2,
    pain: 2,
    fever: 0,
    wound: 1,
    breathlessness: 0,
    dizziness: 0,
    activity: 33,
    hr: 81,
    meds: true,
    note: "Day 2. Pain easing. Started short corridor walks twice.",
  },
  {
    daysAgo: 1,
    pain: 2,
    fever: 0,
    wound: 1,
    breathlessness: 0,
    dizziness: 0,
    activity: 41,
    hr: 80,
    meds: true,
    note: "Day 3. Recovery on track. Completed both walks. Sleeping better.",
  },
];

export function buildSeedHistory(): CheckIn[] {
  return SEED_DAYS.map((d) => {
    return {
      id: `seed-${d.daysAgo}`,
      date: dateKey(d.daysAgo),
      completed_at: isoDaysAgo(d.daysAgo),
      symptoms: {
        pain: d.pain,
        fever: d.fever,
        wound: d.wound,
        breathlessness: d.breathlessness,
        dizziness: d.dizziness,
      },
      medication_taken: d.meds,
      activity_index: d.activity,
      resting_hr: d.hr,
      risk: "green",
      risk_score: 0.2,
      recommendation: "Recovery on track. Continue monitoring.",
      action: "continue_monitoring",
      reasoning: [d.note],
      notes: d.note,
      transcript: [],
      simulated: true,
    } satisfies CheckIn;
  });
}
