/**
 * Pitch-ready vitals when the Galaxy Watch is offline or returns zeros.
 * Day-5 knee patient who completed walks — not invented pathology.
 */
export const DEMO_CHECKIN_VITALS = {
  resting_hr: 76,
  spo2: 98,
  steps: 2840,
  /** Mobility index (0–100); set explicitly — steps/100 undersells a walked day. */
  activity_index: 52,
} as const;

const MIN_MEANINGFUL_STEPS = 200;
const MIN_MEANINGFUL_ACTIVITY = 15;

export function isMeaningfulSteps(steps: number | null | undefined): boolean {
  return (
    typeof steps === "number" &&
    Number.isFinite(steps) &&
    steps >= MIN_MEANINGFUL_STEPS
  );
}

export function isMeaningfulActivity(
  activity: number | null | undefined
): boolean {
  return (
    typeof activity === "number" &&
    Number.isFinite(activity) &&
    activity >= MIN_MEANINGFUL_ACTIVITY
  );
}

export function isValidHr(hr: number | null | undefined): boolean {
  return (
    typeof hr === "number" &&
    Number.isFinite(hr) &&
    hr >= 35 &&
    hr <= 220
  );
}

export function isValidSpo2(spo2: number | null | undefined): boolean {
  return (
    typeof spo2 === "number" &&
    Number.isFinite(spo2) &&
    spo2 >= 70 &&
    spo2 <= 100
  );
}

export interface ResolvedVitals {
  resting_hr: number;
  spo2?: number;
  steps?: number;
  activity_index: number;
}

/**
 * Prefer live watch samples; for demo, replace missing/zero vitals with
 * {@link DEMO_CHECKIN_VITALS} so the Epoch pitch never shows HR-ok / 0-steps.
 */
export function resolveCheckInVitals(input: {
  demo: boolean;
  live?: {
    resting_hr?: number;
    spo2?: number;
    steps?: number;
    activity_index?: number;
  } | null;
  last?: {
    resting_hr?: number;
    activity_index?: number;
    spo2?: number | null;
    steps?: number | null;
  } | null;
  baseline: { resting_hr: number; activity_index: number };
}): ResolvedVitals {
  const { demo, live, last, baseline } = input;
  const demoDefaults = DEMO_CHECKIN_VITALS;

  let resting_hr =
    (isValidHr(live?.resting_hr) ? live!.resting_hr! : undefined) ??
    (isValidHr(last?.resting_hr) ? last!.resting_hr! : undefined) ??
    baseline.resting_hr;

  let activity_index =
    (isMeaningfulActivity(live?.activity_index)
      ? live!.activity_index!
      : undefined) ??
    (isMeaningfulActivity(last?.activity_index)
      ? last!.activity_index!
      : undefined) ??
    baseline.activity_index;

  let spo2 = isValidSpo2(live?.spo2) ? live!.spo2! : undefined;
  let steps = isMeaningfulSteps(live?.steps) ? Math.round(live!.steps!) : undefined;

  // Watch sent steps=0 → activity_index was mapped to 0; drop that for mobility.
  if (live?.steps != null && !isMeaningfulSteps(live.steps)) {
    activity_index =
      (isMeaningfulActivity(last?.activity_index)
        ? last!.activity_index!
        : undefined) ?? baseline.activity_index;
  }

  if (demo) {
    if (!isValidHr(live?.resting_hr)) {
      resting_hr = demoDefaults.resting_hr;
    }
    if (spo2 == null) {
      spo2 = demoDefaults.spo2;
    }
    if (steps == null) {
      steps = demoDefaults.steps;
    }
    // steps/100 undersells a walked day-5 patient (2840 → 28 vs expected ~46).
    // Floor mobility for the demo path so Stable never contradicts "on track".
    const mobilityFloor = Math.max(
      demoDefaults.activity_index,
      baseline.activity_index,
      isMeaningfulActivity(last?.activity_index) ? last!.activity_index! : 0
    );
    if (activity_index < baseline.activity_index * 0.85) {
      activity_index = mobilityFloor;
    }
  }

  return {
    resting_hr: Math.round(resting_hr),
    activity_index: Math.min(100, Math.max(0, Math.round(activity_index))),
    ...(spo2 != null ? { spo2: Math.round(spo2) } : {}),
    ...(steps != null ? { steps: Math.round(steps) } : {}),
  };
}
