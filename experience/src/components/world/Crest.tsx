"use client";

/**
 * Heraldic beasts for the team avatars.
 *
 * Initials in a coloured disc read as a corporate org chart; the modal is
 * parchment and carved serif, so the three people get charges off a shield
 * instead. A stag, an owl and a fox — the village already has deer standing
 * in it, so the stag is not borrowed from somewhere else.
 *
 * Built from plain arcs and triangles rather than traced silhouettes: these
 * are drawn at ~50px, where a chunky shape reads and a detailed one turns to
 * mud. Cut-outs (eyes, muzzle) are painted in the disc's own colour, which is
 * simpler and crisper than masking.
 */

export type CrestKind = "stag" | "owl" | "fox";

const INK = "#f7ecd5";

export function Crest({
  kind,
  tint,
  className,
}: {
  kind: CrestKind;
  /** The disc behind it — used for the cut-out shapes. */
  tint: string;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      {kind === "owl" && <Owl tint={tint} />}
      {kind === "stag" && <Stag tint={tint} />}
      {kind === "fox" && <Fox tint={tint} />}
    </svg>
  );
}

function Owl({ tint }: { tint: string }) {
  return (
    <g>
      {/* ear tufts */}
      <path d="M6.4 6.2 7.5 2.9 10.2 5.1Z" fill={INK} />
      <path d="M17.6 6.2 16.5 2.9 13.8 5.1Z" fill={INK} />
      {/* body */}
      <path
        d="M12 4c3.6 0 6.1 2.7 6.1 6.5 0 5.3-2.6 8.6-6.1 8.6s-6.1-3.3-6.1-8.6C5.9 6.7 8.4 4 12 4Z"
        fill={INK}
      />
      {/* eyes, cut out of the body */}
      <circle cx="9.5" cy="9.7" r="2.15" fill={tint} />
      <circle cx="14.5" cy="9.7" r="2.15" fill={tint} />
      <circle cx="9.5" cy="9.7" r="0.85" fill={INK} />
      <circle cx="14.5" cy="9.7" r="0.85" fill={INK} />
      {/* beak */}
      <path d="M12 11.4 13.1 13.6 10.9 13.6Z" fill={tint} />
      {/* feet */}
      <path
        d="M10 19v1.7M14 19v1.7"
        stroke={INK}
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </g>
  );
}

function Stag({ tint }: { tint: string }) {
  return (
    <g stroke={INK} strokeWidth="1.25" strokeLinecap="round" fill="none">
      {/* antlers */}
      <path d="M9.6 8.4 6.9 5.2M8.4 6.9 7.7 4.3M6.9 5.2 4.5 4.7M6.9 5.2 6.4 2.8" />
      <path d="M14.4 8.4 17.1 5.2M15.6 6.9 16.3 4.3M17.1 5.2 19.5 4.7M17.1 5.2 17.6 2.8" />
      {/* ears */}
      <path
        d="M9.1 9.9C7.9 9.2 6.7 9.2 6 9.9c.6 1 1.8 1.4 3 1.1Z"
        fill={INK}
        strokeWidth="0.8"
      />
      <path
        d="M14.9 9.9c1.2-.7 2.4-.7 3.1 0-.6 1-1.8 1.4-3 1.1Z"
        fill={INK}
        strokeWidth="0.8"
      />
      {/* head */}
      <path
        d="M12 7.9c2 0 3.3 1.5 3.3 3.6 0 2.7-1.4 5.9-3.3 5.9s-3.3-3.2-3.3-5.9c0-2.1 1.3-3.6 3.3-3.6Z"
        fill={INK}
        stroke="none"
      />
      {/* eyes and muzzle, cut out */}
      <circle cx="10.5" cy="11.2" r="0.8" fill={tint} stroke="none" />
      <circle cx="13.5" cy="11.2" r="0.8" fill={tint} stroke="none" />
      <path
        d="M12 14.1c.9 0 1.5.5 1.5 1.2s-.7 1.5-1.5 1.5-1.5-.8-1.5-1.5.6-1.2 1.5-1.2Z"
        fill={tint}
        stroke="none"
      />
    </g>
  );
}

function Fox({ tint }: { tint: string }) {
  return (
    <g>
      {/* ears, with the inner ear cut out so they read as ears and not horns */}
      <path d="M8.5 8.8 6 3.5 11.1 6.2Z" fill={INK} />
      <path d="M15.5 8.8 18 3.5 12.9 6.2Z" fill={INK} />
      <path d="M8.8 8 7.5 5.2 10.2 6.6Z" fill={tint} />
      <path d="M15.2 8 16.5 5.2 13.8 6.6Z" fill={tint} />
      {/* head: broad across the brow, tapering to a snout — the fox shape */}
      <path
        d="M12 18.4c-2.9-1.9-4.7-4.4-4.7-6.9C7.3 8.9 9.4 7 12 7s4.7 1.9 4.7 4.5c0 2.5-1.8 5-4.7 6.9Z"
        fill={INK}
      />
      {/* eyes: angled, tips toward the snout */}
      <path d="M9.1 10.9 11.2 11.8 9.2 12.6Z" fill={tint} />
      <path d="M14.9 10.9 12.8 11.8 14.8 12.6Z" fill={tint} />
      {/* nose on the point of the snout */}
      <path d="M12 16.4 13 14.9 11 14.9Z" fill={tint} />
    </g>
  );
}
