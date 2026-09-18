"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

interface Beat {
  speaker: "ai" | "patient";
  text: string;
  after: number;
  risk?: "green" | "amber" | "red";
  phase?: string;
}

const SCRIPT: Beat[] = [
  {
    speaker: "ai",
    text: "Good morning. Don't forget your tablets after breakfast.",
    after: 2200,
    phase: "Companion",
  },
  {
    speaker: "patient",
    text: "I will. Tell Rahul I'll call him tonight.",
    after: 1600,
    phase: "Companion",
  },
  {
    speaker: "ai",
    text: "I'll let Rahul know. That's all from me.",
    after: 2000,
    phase: "Quiet",
    risk: "green",
  },
];

const RISK_STYLE = {
  green: { label: "Quiet", cls: "sev-low" },
  amber: { label: "Ask Amma", cls: "sev-med" },
  red: { label: "Call Rahul", cls: "sev-high" },
} as const;

export function HeroCall() {
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(true);
  const timerRef = useRef<number | undefined>(undefined);

  const visible = SCRIPT.slice(0, step);
  const current = visible[visible.length - 1];
  const risk = [...visible].reverse().find((b) => b.risk)?.risk;
  const phase = current?.phase ?? "Standing by";
  const sev = risk ? RISK_STYLE[risk] : null;

  useEffect(() => {
    if (!running) return;
    if (step >= SCRIPT.length) {
      timerRef.current = window.setTimeout(() => setStep(0), 3600);
      return () => window.clearTimeout(timerRef.current);
    }
    const wait = step === 0 ? 700 : (SCRIPT[step - 1]?.after ?? 1500);
    timerRef.current = window.setTimeout(() => setStep((s) => s + 1), wait);
    return () => window.clearTimeout(timerRef.current);
  }, [step, running]);

  const restart = useCallback(() => {
    window.clearTimeout(timerRef.current);
    setStep(0);
    setRunning(true);
  }, []);

  return (
    <div className="seal-card">
      <span className="seal-try">Live · hi-IN</span>

      <header className="seal-top">
        <div className="seal-brand">
          <span className="seal-mark" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 5.5A2 2 0 0 1 6 3.5h1.6a1 1 0 0 1 1 .78l.7 3.1a1 1 0 0 1-.5 1.1l-1.3.7a11 11 0 0 0 5.3 5.3l.7-1.3a1 1 0 0 1 1.1-.5l3.1.7a1 1 0 0 1 .78 1V16a2 2 0 0 1-2 2h-.2C10.1 18 4 11.9 4 5.7v-.2Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div>
            <span className="seal-word">Suraksha</span>
            <span className="seal-env">Day 14 · live</span>
          </div>
        </div>
        <span className="seal-status">
          <span className="seal-status-dot" aria-hidden />
          {phase}
        </span>
      </header>

      <div className="seal-stripe" aria-hidden />

      <div className="seal-meta">
        <div>
          <span className="k">Patient</span>
          <span className="v">Amma</span>
        </div>
        <div>
          <span className="k">Place</span>
          <span className="v">At home</span>
        </div>
        <div>
          <span className="k">Action</span>
          <span className={`v ${sev ? sev.cls : "sev-none"}`}>
            {sev ? (
              <>
                <i />
                {sev.label}
              </>
            ) : (
              "—"
            )}
          </span>
        </div>
      </div>

      <div className="seal-body">
        {visible.length === 0 && (
          <p className="seal-quiet">Most days, this stays empty.</p>
        )}
        <AnimatePresence initial={false}>
          {visible.map((beat, i) => (
            <motion.div
              key={`${i}-${beat.text.slice(0, 10)}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className={`seal-bubble is-${beat.speaker}`}
            >
              <span className="eyebrow-sm">
                {beat.speaker === "ai" ? "Suraksha" : "Amma"}
              </span>
              <p>{beat.text}</p>
            </motion.div>
          ))}
        </AnimatePresence>

        {step < SCRIPT.length && (
          <div className="seal-typing" aria-hidden>
            {[0, 1, 2].map((i) => (
              <motion.i
                key={i}
                animate={{ opacity: [0.25, 1, 0.25] }}
                transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
              />
            ))}
          </div>
        )}
      </div>

      <footer className="seal-footer">
        <div className="seal-hops">
          {["Quiet", "Ask Amma", "Family"].map((hop, i) => {
            const level = risk === "red" ? 2 : risk === "amber" ? 1 : risk === "green" ? 0 : -1;
            const on = i <= level;
            return (
              <span key={hop} className={on ? "is-on" : undefined}>
                {hop}
              </span>
            );
          })}
        </div>
        <button type="button" onClick={restart} className="seal-replay">
          Replay
        </button>
      </footer>
    </div>
  );
}
