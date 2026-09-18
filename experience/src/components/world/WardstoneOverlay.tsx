"use client";

import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { WatchCase } from "@/components/WatchCase";
import { sfxAlert, sfxCalm, sfxModal, sfxUi } from "@/lib/sfx";
import {
  ASK_STEP,
  DEVICE_NAME,
  ESCALATION_STEPS,
  HONESTY_NOTE,
  IMPACT_STEP,
  OKAY_STEPS,
  ROMAN,
  setFallHold,
  setWristMood,
  TIMING,
  type BubbleKey,
  type RailStep,
} from "@/lib/wardstone";

/**
 * What the wardstone does after a fall — the real Suraksha pipeline, one step at a
 * time, with the actual call behind each beat shown next to it.
 *
 * The branch is the product: answer and it goes quiet, stay silent and it goes
 * looking for a person. Copy and severities come from `ally/`; only the clock is
 * compressed, and the panel says so.
 */

type Phase = "impact" | "asking" | "okay" | "escalating" | "settled";

export function WardstoneOverlay({
  open,
  runId,
  onClose,
  onOpenDocs,
  onSay,
}: {
  open: boolean;
  /** Bumped on every Stumble, so pressing it again mid-sequence replays. */
  runId: number;
  onClose: () => void;
  /** Hands the visitor to the museum's docs modal from the end card. */
  onOpenDocs: () => void;
  /** Drives the comic balloon above the character. */
  onSay: (line: BubbleKey | null) => void;
}) {
  const [phase, setPhase] = useState<Phase>("impact");
  const [rail, setRail] = useState<RailStep[]>([IMPACT_STEP]);
  const [idx, setIdx] = useState(0);
  const [left, setLeft] = useState<number>(TIMING.answerMs);
  const [answered, setAnswered] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);

  // Keep the newest step in view as the chain works through itself.
  useEffect(() => {
    const el = railRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [rail.length, phase]);

  // Fresh run every time the pill is pressed.
  useEffect(() => {
    if (!open) return;
    setPhase("impact");
    setRail([IMPACT_STEP]);
    setIdx(0);
    setLeft(TIMING.answerMs);
    setAnswered(false);
    setWristMood("alert");
    sfxModal();
  }, [open, runId]);

  useEffect(() => {
    if (!open) setWristMood("calm");
    // She stays on the ground for exactly as long as the panel is open.
    setFallHold(open);
    if (!open) onSay(null);
  }, [open, onSay]);

  // Watch face clock, same tick the written page's mockup uses.
  const [clock, setClock] = useState("--:--");
  useEffect(() => {
    if (!open) return;
    const tick = () => {
      const d = new Date();
      setClock(
        `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
      );
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [open]);

  // Keep the balloon in step with the face.
  useEffect(() => {
    if (!open) return;
    const line: BubbleKey =
      phase === "impact"
        ? "impact"
        : phase === "asking"
          ? "ask"
          : phase === "okay"
            ? "okay"
            : phase === "escalating"
              ? "escalating"
              : answered
                ? "resolvedOkay"
                : "resolvedHelp";
    onSay(line);
  }, [open, phase, answered, onSay]);

  // impact → the question
  useEffect(() => {
    if (!open || phase !== "impact") return;
    const t = setTimeout(() => {
      setRail((r) => [...r, ASK_STEP]);
      setPhase("asking");
      sfxAlert();
    }, TIMING.impactMs);
    return () => clearTimeout(t);
  }, [open, phase]);

  // the window she has to answer in
  useEffect(() => {
    if (!open || phase !== "asking") return;
    const started = performance.now();
    const id = window.setInterval(() => {
      const remaining = TIMING.answerMs - (performance.now() - started);
      if (remaining <= 0) {
        window.clearInterval(id);
        setLeft(0);
        setIdx(0);
        setPhase("escalating");
        sfxAlert();
      } else {
        setLeft(remaining);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [open, phase]);

  // both branches reveal their steps one at a time
  useEffect(() => {
    if (!open || (phase !== "okay" && phase !== "escalating")) return;
    const list = phase === "okay" ? OKAY_STEPS : ESCALATION_STEPS;
    if (idx >= list.length) {
      setPhase("settled");
      setWristMood(phase === "okay" ? "calm" : "resolved");
      sfxCalm();
      return;
    }
    const t = setTimeout(
      () => {
        setRail((r) => [...r, list[idx]!]);
        setIdx((i) => i + 1);
        sfxUi();
      },
      idx === 0 ? 400 : TIMING.stepMs,
    );
    return () => clearTimeout(t);
  }, [open, phase, idx]);

  const sayOkay = useCallback(() => {
    setAnswered(true);
    setIdx(0);
    setPhase("okay");
    setWristMood("calm");
    sfxUi();
  }, []);

  const staySilent = useCallback(() => {
    setLeft(0);
    setIdx(0);
    setPhase("escalating");
    sfxAlert();
  }, []);

  const escalated = phase === "escalating" || (phase === "settled" && !answered);
  const ring = Math.max(0, Math.min(1, left / TIMING.answerMs));

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="wardstone-root"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <button
            type="button"
            className="world-modal-backdrop"
            aria-label="Close"
            onClick={onClose}
          />

          <motion.div
            className="wardstone-panel"
            role="dialog"
            aria-modal="true"
            aria-label="The wardstone after a fall"
            initial={{ opacity: 0, y: 26, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.98 }}
            transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="world-corner world-corner-tl" aria-hidden />
            <span className="world-corner world-corner-tr" aria-hidden />
            <span className="world-corner world-corner-bl" aria-hidden />
            <span className="world-corner world-corner-br" aria-hidden />

            <button
              type="button"
              className="world-modal-x"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>

            <div className="wardstone-watch">
              <WatchCase
                armed={phase !== "okay" && phase !== "settled"}
                label={`${DEVICE_NAME} — the wardstone`}
              >
                <WatchScreen
                  phase={phase}
                  answered={answered}
                  ring={ring}
                  seconds={Math.ceil(left / 1000)}
                  clock={clock}
                  onOkay={sayOkay}
                  onSilent={staySilent}
                />
              </WatchCase>
              <p className="wardstone-honesty">{HONESTY_NOTE}</p>
            </div>

            <div className="wardstone-rail" ref={railRef}>
              <p className="world-modal-eyebrow">What is actually happening</p>
              <h2 className="wardstone-title">
                {phase === "impact" && "The wardstone felt it"}
                {phase === "asking" && "It asks her first"}
                {phase === "okay" && "She answered"}
                {phase === "escalating" && "No answer"}
                {phase === "settled" &&
                  (answered ? "Nobody was called" : "Someone is on the way")}
              </h2>
              <div className="world-rule" aria-hidden>
                <span className="world-rule-mark">✧</span>
              </div>

              <ol className="wardstone-steps">
                <AnimatePresence initial={false}>
                  {rail.map((step) => (
                    <motion.li
                      key={step.id}
                      className={`wardstone-step ${step.skipped ? "is-skipped" : ""}`}
                      initial={{ opacity: 0, x: 14 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <span className="wardstone-step-icon" aria-hidden>
                        {step.icon ? (
                          <Image
                            src={`/aws/${step.icon}`}
                            alt=""
                            width={22}
                            height={22}
                            unoptimized
                          />
                        ) : (
                          <span className="wardstone-step-dot" />
                        )}
                      </span>
                      <div className="wardstone-step-body">
                        {step.service && (
                          <span className="wardstone-step-service">{step.service}</span>
                        )}
                        <code className="wardstone-step-call">{step.call}</code>
                        <p className="wardstone-step-note">{step.note}</p>
                        <span className="wardstone-step-source">{step.source}</span>
                      </div>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ol>

              {phase === "settled" && (
                <motion.div
                  className="wardstone-end"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                >
                  {answered ? (
                    <>
                      <span className="wardstone-chip">tier 1 · ask_parent_first</span>
                      <p className="wardstone-end-line">
                        No one was called. Nothing was shared. The only trace is a
                        line in the log Amma can read herself.
                      </p>
                      <p className="wardstone-end-quote">
                        “Most days, Suraksha says nothing at all.”
                      </p>
                    </>
                  ) : (
                    <>
                      <span className="wardstone-chip is-alert">
                        tier 2 · coordinate_family · critical
                      </span>
                      <p className="wardstone-end-line">
                        One person, actually coming. Nobody else was told.
                      </p>
                    </>
                  )}
                  <p className="wardstone-end-kicker">
                    That&apos;s the product. The village is just a nicer way to
                    read the docs.
                  </p>
                  <div className="world-modal-actions">
                    <button
                      type="button"
                      className="world-btn world-btn-primary"
                      onClick={() => {
                        onClose();
                        onOpenDocs();
                      }}
                    >
                      See the stack
                    </button>
                    <Link href="/classic" className="world-btn world-btn-ghost">
                      Read the written story
                    </Link>
                  </div>
                </motion.div>
              )}

              {escalated && phase !== "settled" && (
                <p className="wardstone-waiting">Working through the care chain…</p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Which of the five beats the face is on, for the step readout and pips. */
const STEP_OF: Record<Phase, number> = {
  impact: 1,
  asking: 2,
  okay: 3,
  escalating: 3,
  settled: 5,
};
const STEP_COUNT = 5;

/**
 * The face shows where the sequence is, not what is being said — the dialogue
 * lives in the comic balloon over her head, which is what un-crowded this
 * 196px circle. The brand line on the face is the product name: Suraksha.
 */
function WatchScreen({
  phase,
  answered,
  ring,
  seconds,
  clock,
  onOkay,
  onSilent,
}: {
  phase: Phase;
  answered: boolean;
  ring: number;
  seconds: number;
  clock: string;
  onOkay: () => void;
  onSilent: () => void;
}) {
  const calm = phase === "okay" || (phase === "settled" && answered);
  const step = STEP_OF[phase];

  const headline =
    phase === "impact"
      ? "Felt that"
      : phase === "asking"
        ? "Are you alright?"
        : calm
          ? "Good."
          : phase === "settled"
            ? "Priya is coming"
            : "No answer";

  const sub =
    phase === "impact"
      ? "possible fall"
      : phase === "asking"
        ? `${seconds}s to answer`
        : calm
          ? "nothing sent"
          : phase === "settled"
            ? "family notified"
            : "finding someone";

  return (
    <>
      <div className="wf-top">
        <span className={`wf-brand ${calm ? "" : "is-warn"}`}>{DEVICE_NAME}</span>
        <span className="wf-step">
          Step {ROMAN[step - 1]} · {ROMAN[STEP_COUNT - 1]}
        </span>
        <div className="wf-pips" aria-hidden>
          {Array.from({ length: STEP_COUNT }, (_, i) => (
            <span
              key={i}
              className={`wf-pip ${i + 1 < step ? "is-done" : ""} ${i + 1 === step ? "is-now" : ""}`}
            />
          ))}
        </div>
      </div>

      <div className={`wf-mid ${calm ? "" : "is-warn"}`}>
        {/* The countdown ring is the only moving thing on the face. */}
        {phase === "asking" && (
          <svg className="wf-ring" viewBox="0 0 44 44" aria-hidden>
            <circle className="wf-ring-track" cx="22" cy="22" r="19" />
            <circle
              className="wf-ring-fill"
              cx="22"
              cy="22"
              r="19"
              style={{ strokeDashoffset: 119.4 * (1 - ring) }}
            />
          </svg>
        )}

        {calm && (
          <div className="wf-ok-mark" aria-hidden>
            ✓
          </div>
        )}

        <div className="wf-headline">{headline}</div>
        <div className="wf-sub">{sub}</div>

        {phase === "asking" && (
          <div className="wf-choices">
            <button type="button" className="btn-sos wf-choice-ok" onClick={onOkay}>
              I&apos;m okay
            </button>
            <button type="button" className="btn-reset" onClick={onSilent}>
              Say nothing
            </button>
          </div>
        )}
      </div>

      <div className="wf-bot">
        <span className={`wf-dot ${calm ? "" : "is-warn"}`} aria-hidden />
        <span className="tnum">{clock}</span>
      </div>
    </>
  );
}
