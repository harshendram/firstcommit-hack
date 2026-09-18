"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

import { setIntroHidden } from "@/lib/wardstone";

/**
 * The opening beat, fired the moment the spawn drop touches down.
 *
 * Not a hotspot — decision D3 keeps `HotspotId` at exactly portal | docs | team,
 * so this is a sibling of `WorldModals`, not a member of it. It reuses the same
 * `.world-modal-*` shell so there is still only one modal design in the world.
 */
export function StoryIntro({
  open,
  onExplore,
  onShowFall,
}: {
  open: boolean;
  onExplore: () => void;
  onShowFall: () => void;
}) {
  const [hide, setHide] = useState(false);

  const close = (then: () => void) => {
    setIntroHidden(hide);
    then();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="world-modal-root"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.28 }}
        >
          <div className="world-modal-backdrop" aria-hidden />
          <motion.div
            className="world-modal world-modal-story"
            role="dialog"
            aria-modal="true"
            aria-label="Suraksha — Explore"
            initial={{ opacity: 0, y: 34, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="world-modal-sheen" aria-hidden />
            <span className="world-corner world-corner-tl" aria-hidden />
            <span className="world-corner world-corner-tr" aria-hidden />
            <span className="world-corner world-corner-bl" aria-hidden />
            <span className="world-corner world-corner-br" aria-hidden />

            <div className="world-modal-hero story">
              <span className="story-stone" aria-hidden>
                <span className="story-stone-core" />
              </span>
            </div>

            <p className="world-modal-eyebrow">Wardstone</p>
            <h2 className="world-modal-title">You hit the ground. No one turned.</h2>
            <div className="world-rule" aria-hidden>
              <span className="world-rule-mark">✧</span>
            </div>

            <p className="world-modal-copy">
              No lookout. No bell. In this village, a fall is private until
              someone walks past.
            </p>
            <p className="world-modal-copy">
              The stone on your wrist woke up. It did not shout for help. It
              waited for you to answer.
            </p>

            <p className="story-hint">
              When you&apos;re ready — walk. The stone will wait with you.
            </p>

            <div className="world-modal-actions">
              <button
                type="button"
                className="world-btn world-btn-primary"
                onClick={() => close(onShowFall)}
              >
                Show me the fall
              </button>
              <button
                type="button"
                className="world-btn world-btn-ghost"
                onClick={() => close(onExplore)}
              >
                Explore first
              </button>
            </div>

            <label className="story-optout">
              <input
                type="checkbox"
                checked={hide}
                onChange={(e) => setHide(e.target.checked)}
              />
              <span>Don&apos;t show this again</span>
            </label>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
