"use client";

import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import type { HotspotId } from "@/lib/hotspots";
import { ALLY_SERVICES, TEAM, TEAM_NAME } from "@/lib/hotspots";
import { Crest } from "@/components/world/Crest";
import { APP_URL } from "@/lib/config";

export function WorldModals({
  active,
  onClose,
}: {
  active: HotspotId | null;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key={active}
          className="world-modal-root"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
        >
          <button
            type="button"
            className="world-modal-backdrop"
            aria-label="Close"
            onClick={onClose}
          />
          <motion.div
            className={`world-modal world-modal-${active}`}
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, y: 32, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
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

            {active === "portal" && <PortalBody onClose={onClose} />}
            {active === "docs" && <DocsBody />}
            {active === "team" && <TeamBody />}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PortalBody({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="world-modal-hero portal">
        <span className="world-modal-hero-mark">◈</span>
      </div>
      <p className="world-modal-eyebrow">Stone portal</p>
      <h2 className="world-modal-title">Leave the world?</h2>
      <div className="world-rule" aria-hidden>
        <span className="world-rule-mark">✧</span>
      </div>
      <p className="world-modal-copy">
        Step through for Suraksha&apos;s written story — how the quiet morning works,
        end to end. You can walk back in anytime.
      </p>
      <div className="world-modal-actions">
        <a href={APP_URL} className="world-btn world-btn-primary">
          Visit main website
        </a>
        <button type="button" className="world-btn world-btn-ghost" onClick={onClose}>
          Stay here
        </button>
      </div>
    </>
  );
}

function DocsBody() {
  return (
    <>
      <div className="world-modal-hero docs">
        <div className="world-modal-hero-icons">
          {ALLY_SERVICES.map((s) => (
            <span key={s.id} className="world-modal-hero-icon">
              <Image
                src={`/aws/${s.icon}`}
                alt=""
                width={26}
                height={26}
                unoptimized
              />
            </span>
          ))}
        </div>
      </div>
      <p className="world-modal-eyebrow">Documentation</p>
      <h2 className="world-modal-title">How Suraksha works</h2>
      <div className="world-rule" aria-hidden>
        <span className="world-rule-mark">✧</span>
      </div>
      <p className="world-modal-copy">
        The museum walls show Suraksha&apos;s AWS stack — the same services that keep
        a quiet morning quiet.
      </p>

      <div className="world-doc-services">
        {ALLY_SERVICES.map((s) => (
          <div key={s.id} className="world-doc-chip">
            <span className="world-doc-chip-icon">
              <Image
                src={`/aws/${s.icon}`}
                alt=""
                width={28}
                height={28}
                unoptimized
              />
            </span>
            <span>{s.service}</span>
          </div>
        ))}
      </div>

      <ul className="world-doc-list">
        {ALLY_SERVICES.map((s) => (
          <li key={s.id}>
            <strong>{s.title}</strong>
            <span>{s.body}</span>
          </li>
        ))}
      </ul>

      <div className="world-modal-actions">
        <Link href="/classic" className="world-btn world-btn-primary">
          Read full documentation
        </Link>
      </div>
    </>
  );
}

function TeamBody() {
  return (
    <>
      <div className="world-modal-hero team">
        <div className="world-team-crest">
          <span className="world-team-crest-mark" aria-hidden>
            ✦
          </span>
          <span className="world-team-crest-name">{TEAM_NAME}</span>
        </div>
      </div>
      <p className="world-modal-eyebrow">The cottage</p>
      <h2 className="world-modal-title">Team {TEAM_NAME}</h2>
      <div className="world-rule" aria-hidden>
        <span className="world-rule-mark">✧</span>
      </div>
      <p className="world-modal-copy">Three people, one village, one watch.</p>

      <div className="world-team-grid">
        {TEAM.map((t) => (
          <div key={t.name} className="world-team-card">
            <div
              className="world-team-avatar"
              style={{ background: t.color }}
              aria-hidden
            >
              <Crest kind={t.crest} tint={t.color} />
            </div>
            <div className="world-team-name">{t.name}</div>
          </div>
        ))}
      </div>

      <p className="world-team-footer">
        Built for Amma, 72 — and every parent who&apos;d rather be trusted than
        watched.
      </p>
    </>
  );
}
