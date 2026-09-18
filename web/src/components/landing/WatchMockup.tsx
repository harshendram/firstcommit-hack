"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

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

export function WatchMockup() {
  const [time, setTime] = useState({ h: "--", m: "--", s: "--" });
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setTime({
        h: String(d.getHours()).padStart(2, "0"),
        m: String(d.getMinutes()).padStart(2, "0"),
        s: String(d.getSeconds()).padStart(2, "0"),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className={`watch ${armed ? "is-armed" : ""}`}
      aria-label="Wear OS Galaxy Watch — Rakshak recovery check-in"
    >
      <StrapBand end="top" />
      <StrapBand end="bot" />

      <div className="watch-body">
        <button
          type="button"
          className="watch-crown"
          aria-label={armed ? "End check-in" : "Start check-in"}
          onClick={() => setArmed((v) => !v)}
        >
          <span className="watch-crown-knurl" aria-hidden />
        </button>
        <button
          type="button"
          className="watch-key"
          aria-label={armed ? "End check-in" : "Start check-in"}
          onClick={() => setArmed((v) => !v)}
        />

        <div className="watch-case">
          <div className="watch-case-shine" aria-hidden />
          <div className="watch-bezel">
            <BezelMarks />
            <div className="watch-glass">
              <div className={`watch-screen ${armed ? "is-armed" : ""}`}>
                <div className="watch-glass-glare" aria-hidden />

                <div className="wf-top">
                  <span className={`wf-brand ${armed ? "is-warn" : ""}`}>
                    {armed ? "LIVE" : "ALLY"}
                  </span>
                  <span className="wf-time tnum">
                    {time.h}
                    <span className="wf-colon">:</span>
                    {time.m}
                  </span>
                  <span className="wf-sec tnum">{time.s}</span>
                </div>

                <div className={`wf-mid ${armed ? "is-warn" : ""}`}>
                  {!armed ? (
                    <>
                      <span className="wf-buzz">TAP</span>
                      <motion.button
                        type="button"
                        className="btn-sos"
                        onClick={() => setArmed(true)}
                        animate={{
                          boxShadow: [
                            "0 0 0 0 oklch(0.56 0.2 27 / 0.45)",
                            "0 0 0 14px oklch(0.56 0.2 27 / 0)",
                          ],
                        }}
                        transition={{ duration: 2, repeat: Infinity }}
                      >
                        OK
                      </motion.button>
                      <span className="wf-stat-l">I&apos;m okay</span>
                    </>
                  ) : (
                    <>
                      <div className="wf-warn-icon" aria-hidden>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                          <path
                            d="M12 9v4m0 3h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                      <div className="wf-warn-title">Listening</div>
                      <div className="wf-warn-sub">Speak naturally</div>
                      <button
                        type="button"
                        className="btn-reset"
                        onClick={() => setArmed(false)}
                      >
                        Done
                      </button>
                    </>
                  )}
                </div>

                <div className="wf-bot">
                  <span className={`wf-dot ${armed ? "is-warn" : ""}`} aria-hidden />
                  <span>{armed ? "Good morning" : "Ready · I'm okay"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
