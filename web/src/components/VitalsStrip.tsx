"use client";

import { formatSteps, type VitalsStripValues } from "@/lib/vitalsDisplay";
import { cn } from "@/lib/utils";

type Props = {
  vitals: VitalsStripValues;
  className?: string;
  /** Smaller variant for dense doctor panels. */
  compact?: boolean;
};

/**
 * Clear HR / SpO₂ / Steps strip — not a single gray "Watch vitals · …" line.
 */
export function VitalsStrip({ vitals, className, compact }: Props) {
  const cells: { label: string; value: string; unit: string }[] = [];
  if (vitals.resting_hr != null) {
    cells.push({ label: "Heart rate", value: String(vitals.resting_hr), unit: "bpm" });
  }
  if (vitals.spo2 != null) {
    cells.push({ label: "SpO₂", value: String(vitals.spo2), unit: "%" });
  }
  if (vitals.steps != null) {
    cells.push({ label: "Steps", value: formatSteps(vitals.steps), unit: "today" });
  }
  if (cells.length === 0) return null;

  return (
    <div
      className={cn(
        "panel-sunk",
        compact ? "px-3 py-2.5" : "px-3.5 py-3",
        className
      )}
    >
      <div className="eyebrow text-ink-faint">Watch vitals</div>
      <div
        className={cn(
          "mt-2 grid gap-3",
          cells.length === 1 && "grid-cols-1",
          cells.length === 2 && "grid-cols-2",
          cells.length >= 3 && "grid-cols-3"
        )}
      >
        {cells.map((c) => (
          <div key={c.label} className="min-w-0">
            <div className="text-[0.65rem] font-semibold uppercase tracking-wide text-ink-faint">
              {c.label}
            </div>
            <p
              className={cn(
                "mono m-0 mt-0.5 leading-none text-ink",
                compact ? "text-[1.05rem]" : "text-[1.2rem]"
              )}
            >
              {c.value}
              <span className="ml-1 text-[0.68rem] font-sans font-medium text-ink-faint">
                {c.unit}
              </span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
