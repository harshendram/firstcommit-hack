"use client";

import { AnimatePresence, motion } from "framer-motion";
import { type CSSProperties, useState } from "react";
import HTMLFlipBook from "react-pageflip";

import { BOOK_PAGES, type BookPage, type PlateStep } from "@/lib/museum";

/**
 * The tome on the table.
 *
 * Incridea's book was never a mesh — `book_file.txt` is their `BookModal`, a
 * `react-pageflip` DOM flip-book. This is the same idea with the architecture
 * on the pages instead of sponsors, on the same two textures.
 *
 * `IFlipSetting` has no optional members, so every setting is passed.
 */

/** One leaf. The book is twice this wide when it is open on both pages. */
const PAGE_W = 320;
const PAGE_H = 460;

/**
 * Below this, one leaf at a time; above it, a proper two-page spread.
 *
 * This is the setting that decides whether the tome reads as a book at all.
 * StPageFlip drops to portrait — a single leaf, no facing page, no gutter —
 * whenever the block it is handed cannot fit two pages side by side, and
 * `usePortrait: true` with a stage that shrink-wrapped one 300px page meant it
 * *always* did. The flip animation worked the whole time, which is why it read
 * as a styling problem: portrait flips correctly, it just flips one page.
 */
const SPREAD_MIN_WIDTH = 760;

const flipSettings = (portrait: boolean) =>
  ({
    width: PAGE_W,
    height: PAGE_H,
    size: "fixed",
    minWidth: 240,
    maxWidth: 380,
    minHeight: 350,
    maxHeight: 560,
    startPage: 0,
    drawShadow: true,
    flippingTime: 800,
    usePortrait: portrait,
    startZIndex: 0,
    autoSize: true,
    // Deeper than the old 0.3: in a spread this shading *is* the fold.
    maxShadowOpacity: 0.5,
    showCover: true,
    mobileScrollSupport: true,
    clickEventForward: true,
    useMouseEvents: true,
    swipeDistance: 8,
    showPageCorners: true,
    disableFlipByClick: false,
  }) as const;

export function BookModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // `open &&` unmounts the tome between readings, so Tome mounting IS the book
  // being opened — which is the only moment the orientation can be read.
  // react-pageflip builds StPageFlip once and never re-reads its settings.
  return (
    <AnimatePresence>{open && <Tome onClose={onClose} />}</AnimatePresence>
  );
}

function Tome({ onClose }: { onClose: () => void }) {
  const [portrait] = useState(
    () => typeof window !== "undefined" && window.innerWidth < SPREAD_MIN_WIDTH,
  );
  const settings = flipSettings(portrait);

  /**
   * Which half of the block the paper is actually occupying.
   *
   * A hard cover stands alone: the front one on the right of the spread, the
   * back one on the left. The block stays two pages wide either way, so the
   * slab behind it — shadow and cut edges — has to follow, or the book casts
   * a shadow over half a page of nothing.
   */
  const lastLeaf = BOOK_PAGES.length + 1;
  // Seeded from the setting, not hard-coded 0: the slab would otherwise sit on
  // the wrong half of the block if the book ever opened anywhere but the cover.
  const [leaf, setLeaf] = useState<number>(settings.startPage);

  /**
   * True from the moment a page leaves the block until it settles.
   *
   * While a page is in the air it spans both halves, so the slab goes full
   * width and its cut edges fade out. Without this the edge strip *travelled*:
   * the slab changed halves on `onFlip`, and a CSS transition slid a pale
   * vertical bar across the open book — the one thing in the whole tome that
   * looked like a web page rather than paper.
   */
  const [flipping, setFlipping] = useState(false);

  const half = portrait || flipping
    ? ""
    : leaf === 0
      ? "is-front"
      : leaf === lastLeaf
        ? "is-back"
        : "";

  return (
    <motion.div
      className="book-root"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.26 }}
    >
      <button
        type="button"
        className="world-modal-backdrop"
        aria-label="Close"
        onClick={onClose}
      />

      <motion.div
        className={`book-stage ${half} ${flipping ? "is-flipping" : ""}`}
        style={
          {
            "--book-w": `${portrait ? PAGE_W : PAGE_W * 2}px`,
            "--book-h": `${PAGE_H}px`,
          } as CSSProperties
        }
        initial={{ opacity: 0, scale: 0.94, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 12 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Shadow and cut edges live on their own slab behind the paper, not on
            the stage: the block stays two pages wide even when a lone cover is
            using half of it. */}
        <span className="book-slab" aria-hidden />

        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <HTMLFlipBook
          className="book-flip"
          style={{}}
          {...(settings as any)}
          onFlip={(e: { data: number }) => setLeaf(e.data)}
          // "read" is page-flip's resting state; anything else means paper is
          // moving (dragged corner, fold, flip).
          onChangeState={(e: { data: string }) => setFlipping(e.data !== "read")}
        >
          <div className="book-page is-cover" data-density="hard">
            <div className="book-cover-plate">
              <span className="book-cover-eyebrow">The Suraksha stack</span>
              <h2 className="book-cover-title">How the quiet morning works</h2>
              <span className="book-cover-foot">Turn the page ✧</span>
            </div>
          </div>

          {BOOK_PAGES.map((p) => (
            <div className="book-page" key={p.id}>
              <Page page={p} />
            </div>
          ))}

          <div className="book-page is-cover" data-density="hard">
            <div className="book-cover-plate">
              <span className="book-cover-eyebrow">The stone on the wrist</span>
              <h2 className="book-cover-title">Suraksha</h2>
              <span className="book-cover-foot">Care without watching</span>
            </div>
          </div>
        </HTMLFlipBook>

        <button
          type="button"
          className="book-close"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </motion.div>
    </motion.div>
  );
}

function Page({ page }: { page: BookPage }) {
  // The illuminated capital is the first letter of the lead, lifted out so it
  // can be set in the carved face while the rest of the paragraph stays in the
  // reading face.
  const [initial, ...restOfLead] = [...page.lead];

  return (
    <div className="book-leaf">
      <div className="book-head">
        {page.numeral && <span className="book-numeral">{page.numeral}</span>}
        <h3 className="book-title">{page.title}</h3>
      </div>
      <div className="book-rule" aria-hidden />

      <p className="book-lead">
        <span className="book-dropcap" aria-hidden>
          {initial}
        </span>
        <span className="sr-only">{initial}</span>
        {restOfLead.join("")}
      </p>

      {page.plate && <Plate steps={page.plate} />}

      {page.body && <p className="book-body">{page.body}</p>}

      {page.aside && (
        <p className="book-aside">
          <span className="book-aside-mark" aria-hidden>
            ❧
          </span>
          {page.aside}
        </p>
      )}
    </div>
  );
}

/**
 * The architecture plate: the real AWS marks from `public/aws`, stacked in the
 * order the morning runs through them.
 *
 * Plain `<img>` rather than `next/image`: these are fixed 26px marks inside a
 * flip-book that page-flip moves into its own DOM, so there is nothing for the
 * optimiser to do and one less thing between the file and the page. A step
 * with no mark (the watch, the gateway, a person) gets a carved initial in a
 * roundel instead, so the chain reads evenly.
 */
function Plate({ steps }: { steps: PlateStep[] }) {
  return (
    <div className="book-plate">
      {steps.map((step, i) => (
        <div className="book-plate-row" key={step.label}>
          <span className="book-plate-mark">
            {step.icon ? (
              <img src={`/aws/${step.icon}`} alt="" width={26} height={26} />
            ) : (
              <span className="book-plate-glyph" aria-hidden>
                {step.label[0]}
              </span>
            )}
          </span>
          <span className="book-plate-text">
            <span className="book-plate-label">{step.label}</span>
            {step.detail && (
              <span className="book-plate-detail">{step.detail}</span>
            )}
          </span>
          {i < steps.length - 1 && (
            <span className="book-plate-arrow" aria-hidden />
          )}
        </div>
      ))}
    </div>
  );
}
