import type { CheckIn } from "./careTypes";

/** Demo / pitch defaults when a check-in lacks usable watch readings. */
export const DEMO_DISPLAY_VITALS = {
  resting_hr: 76,
  spo2: 98,
  steps: 2840,
} as const;

export function isValidHr(hr: number | null | undefined): boolean {
  return (
    typeof hr === "number" && Number.isFinite(hr) && hr >= 35 && hr <= 220
  );
}

export function isValidSpo2(spo2: number | null | undefined): boolean {
  return (
    typeof spo2 === "number" && Number.isFinite(spo2) && spo2 >= 70 && spo2 <= 100
  );
}

/** Hide zero / tiny step counts that read as "pathetic" on the pitch card. */
export function isMeaningfulSteps(steps: number | null | undefined): boolean {
  return (
    typeof steps === "number" && Number.isFinite(steps) && steps >= 200
  );
}

export interface VitalsStripValues {
  resting_hr?: number;
  spo2?: number;
  steps?: number;
}

export function vitalsFromCheckIn(checkIn: CheckIn | null | undefined): VitalsStripValues {
  if (!checkIn) return {};
  return {
    ...(isValidHr(checkIn.resting_hr)
      ? { resting_hr: Math.round(checkIn.resting_hr) }
      : {}),
    ...(isValidSpo2(checkIn.spo2)
      ? { spo2: Math.round(checkIn.spo2 as number) }
      : {}),
    ...(isMeaningfulSteps(checkIn.steps)
      ? { steps: Math.round(checkIn.steps as number) }
      : {}),
  };
}

export function hasVitalsStrip(v: VitalsStripValues): boolean {
  return v.resting_hr != null || v.spo2 != null || v.steps != null;
}

export function formatSteps(n: number): string {
  return n.toLocaleString("en-IN");
}
