"use client";

import { AnimatePresence, motion } from "framer-motion";

import type { LoreStone } from "@/lib/museum";

/**
 * What a standing stone says when you touch it.
 *
 * Not a hotspot — decision D3 keeps `HotspotId` at portal | docs | team, so
 * this is a sibling of `WorldModals` like `StoryIntro`, and reuses the same
 * `.world-modal-*` shell and medieval frame.
 */
export function LoreModal({
  stone,
  onClose,
}: {
  stone: LoreStone | null;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {stone && (
        <motion.div
          key={stone.id}
          className="world-modal-root"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24 }}
        >
          <button
            type="button"
            className="world-modal-backdrop"
            aria-label="Close"
            onClick={onClose}
          />
          <motion.div
            className="world-modal world-modal-lore"
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, y: 30, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="world-modal-sheen" aria-hidden />
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

            <div className="world-modal-hero lore">
              <span className="lore-crystal" aria-hidden />
            </div>

            <p className="world-modal-eyebrow">{stone.kicker}</p>
            <h2 className="world-modal-title">{stone.title}</h2>
            <div className="world-rule" aria-hidden>
              <span className="world-rule-mark">✧</span>
            </div>

            <p className="world-modal-copy lore-lead">{stone.lead}</p>

            {stone.figures && (
              <table className="lore-figures">
                <tbody>
                  {stone.figures.map((f) => (
                    <tr key={f.label} className={`is-${f.source}`}>
                      <th scope="row">{f.label}</th>
                      <td>
                        {f.value}
                        <span className="lore-tag">
                          {f.source === "published"
                            ? "published"
                            : f.source === "assumption"
                              ? "our assumption"
                              : ""}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <ul className="lore-points">
              {stone.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>

            {stone.close && <p className="lore-close">{stone.close}</p>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
