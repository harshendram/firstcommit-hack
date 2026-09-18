"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

import { WatchCase } from "@/components/WatchCase";

/**
 * The watch as it sits on Amma's wrist on an ordinary day: a check-in she can
 * dismiss with one tap. The same case is used by the world's wardstone overlay
 * for the day that is not ordinary.
 */
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
    <WatchCase
      armed={armed}
      label="Wear OS Galaxy Watch — Suraksha check-in"
      onCrown={() => setArmed((v) => !v)}
      crownLabel={armed ? "End check-in" : "Start check-in"}
    >
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
    </WatchCase>
  );
}
