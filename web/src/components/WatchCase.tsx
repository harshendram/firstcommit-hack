"use client";

import type { ReactNode } from "react";

/**
 * The Galaxy Watch shell — bands, body, crown, bezel, glass. Screen content is
 * whatever you pass as children.
 *
 * Extracted from `landing/WatchMockup.tsx` so the written page and the world's
 * wardstone overlay render the same physical watch instead of two that drift.
 * Styles live in `globals.css` under `.watch*` / `.wf-*`.
 */

/** 60 bezel hash marks — Galaxy Watch Classic rotating bezel. */
function BezelMarks() {
  return (
    <svg className="watch-bezel-marks" viewBox="0 0 100 100" aria-hidden>
      {Array.from({ length: 60 }, (_, i) => {
        const major = i % 5 === 0;
        const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
        const r1 = major ? 46.2 : 47.1;
        const r2 = 49.2;
        return (
          <line
            key={i}
            x1={50 + Math.cos(a) * r1}
            y1={50 + Math.sin(a) * r1}
            x2={50 + Math.cos(a) * r2}
            y2={50 + Math.sin(a) * r2}
            stroke={major ? "oklch(0.82 0.01 95)" : "oklch(0.55 0.01 95 / 0.55)"}
            strokeWidth={major ? 1.1 : 0.55}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

function StrapBand({ end }: { end: "top" | "bot" }) {
  return (
    <div className={`watch-band watch-band-${end}`} aria-hidden>
      <div className="watch-band-face">
        {end === "bot" &&
          Array.from({ length: 5 }, (_, i) => (
            <span
              key={i}
              className="watch-band-hole"
              style={{ top: `${18 + i * 14}%` }}
            />
          ))}
      </div>
    </div>
  );
}

export function WatchCase({
  children,
  armed = false,
  label,
  className = "",
  onCrown,
  crownLabel,
}: {
  children: ReactNode;
  /** Lights the screen with the alert wash. */
  armed?: boolean;
  /** aria-label for the watch as a whole. */
  label?: string;
  className?: string;
  /** Omit to render the crown and side key as decoration only. */
  onCrown?: () => void;
  crownLabel?: string;
}) {
  return (
    <div className={`watch ${armed ? "is-armed" : ""} ${className}`.trim()} aria-label={label}>
      <StrapBand end="top" />
      <StrapBand end="bot" />

      <div className="watch-body">
        {onCrown ? (
          <>
            <button
              type="button"
              className="watch-crown"
              aria-label={crownLabel}
              onClick={onCrown}
            >
              <span className="watch-crown-knurl" aria-hidden />
            </button>
            <button
              type="button"
              className="watch-key"
              aria-label={crownLabel}
              onClick={onCrown}
            />
          </>
        ) : (
          <>
            <span className="watch-crown" aria-hidden>
              <span className="watch-crown-knurl" />
            </span>
            <span className="watch-key" aria-hidden />
          </>
        )}

        <div className="watch-case">
          <div className="watch-case-shine" aria-hidden />
          <div className="watch-bezel">
            <BezelMarks />
            <div className="watch-glass">
              <div className={`watch-screen ${armed ? "is-armed" : ""}`}>
                <div className="watch-glass-glare" aria-hidden />
                {children}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
