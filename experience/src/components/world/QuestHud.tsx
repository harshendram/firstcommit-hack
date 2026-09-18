"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";

import { cameraYaw, playerPosition } from "@/components/world/characterController";
import { QUEST_STEPS, type QuestStep } from "@/lib/quest";

/**
 * The quest card and brass compass, top-left.
 *
 * The existing Sound / Main website / Stumble cluster is untouched: U2 in
 * UI-AND-HUD.md forbids splitting *those three*, not adding a separate element
 * in the opposite corner.
 *
 * The needle and distance are written straight to DOM refs inside a rAF loop.
 * Driving them through React state would re-render this card sixty times a
 * second for a number that changes by centimetres.
 */
export function QuestHud({ step, index }: { step: QuestStep | null; index: number }) {
  const needle = useRef<HTMLDivElement>(null);
  const distance = useRef<HTMLSpanElement>(null);
  const target = step?.at ?? null;

  useEffect(() => {
    if (!target) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dx = target[0] - playerPosition.x;
      const dz = target[1] - playerPosition.z;

      // atan2(x, z) on both sides, so they share a convention. CSS rotate is
      // clockwise, hence the negation: facing -z, a target due east gives
      // +90deg, and east is screen-right when facing -z.
      const bearing = Math.atan2(dx, dz);
      const rel = bearing - cameraYaw.value;
      if (needle.current) {
        needle.current.style.transform = `rotate(${-rel}rad)`;
      }
      if (distance.current) {
        distance.current.textContent = `${Math.round(Math.hypot(dx, dz))} m`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  const done = step === null;

  return (
    <div className="quest-hud">
      <AnimatePresence mode="wait">
        <motion.div
          key={step?.id ?? "done"}
          className="quest-card"
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="world-corner world-corner-tl" aria-hidden />
          <span className="world-corner world-corner-br" aria-hidden />

          <p className="quest-eyebrow">
            {done ? "The tour" : `Quest ${index + 1} of ${QUEST_STEPS.length}`}
          </p>
          <h3 className="quest-title">{done ? "You have seen it all" : step.title}</h3>
          <p className="quest-hint">
            {done
              ? "Wander as long as you like — every door still opens."
              : step.hint}
          </p>

          <div className="quest-pips" aria-hidden>
            {QUEST_STEPS.map((s, i) => (
              <span
                key={s.id}
                className={`quest-pip ${i < index || done ? "is-done" : ""} ${
                  !done && i === index ? "is-now" : ""
                }`}
              />
            ))}
          </div>
        </motion.div>
      </AnimatePresence>

      {!done && (
        <div className={`compass ${target ? "" : "is-idle"}`}>
          <div className="compass-face">
            <span className="compass-card compass-n">N</span>
            <span className="compass-card compass-e">E</span>
            <span className="compass-card compass-s">S</span>
            <span className="compass-card compass-w">W</span>
            {target ? (
              <div className="compass-needle" ref={needle}>
                <span className="compass-tip" />
              </div>
            ) : (
              <span className="compass-idle-mark" aria-hidden>
                ✦
              </span>
            )}
          </div>
          <span className="compass-distance tnum" ref={distance}>
            {target ? "" : "here"}
          </span>
        </div>
      )}
    </div>
  );
}
