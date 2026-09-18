import type { SVGProps } from "react";

/**
 * Suraksha's own icon set — drawn on the same 24px grid and 1.7 stroke as the shield logo,
 * so screens never fall back to emoji.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Glyph({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Morning check-in. */
export const Sunrise = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 3.5v3M5.2 6.7l2.1 2.1M18.8 6.7l-2.1 2.1M3 17h3M18 17h3" />
    <path d="M8 17a4 4 0 0 1 8 0" />
    <path d="M3.5 21h17" />
  </Glyph>
);

/** Reminder (a tablet/pill). */
export const Pill = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="2.8" y="8.6" width="18.4" height="6.8" rx="3.4" transform="rotate(-25 12 12)" />
    <path d="M9.1 14.9 14.9 9.1" />
  </Glyph>
);

/** Suraksha is checking in / a gentle question. */
export const Ask = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M20.5 12.2c0 4.1-3.8 7.4-8.5 7.4-1 0-2-.15-2.9-.42L4 20.5l1.4-3.6C4.2 15.6 3.5 14 3.5 12.2c0-4.1 3.8-7.4 8.5-7.4s8.5 3.3 8.5 7.4Z" />
    <path d="M9.9 10.1a2.2 2.2 0 0 1 4.2.7c0 1.5-2.1 1.8-2.1 3" />
    <path d="M12 16.1h.01" />
  </Glyph>
);

/** A note from family. */
export const Note = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M4.5 5.6h15v9.1l-4.2 4.3H4.5z" />
    <path d="M19.5 14.7h-4.2v4.3" />
    <path d="M8 9.4h8M8 12.4h5" />
  </Glyph>
);

/** Family coordination. */
export const People = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="9" cy="8.4" r="3.1" />
    <path d="M3.6 19.4a5.6 5.6 0 0 1 10.8 0" />
    <path d="M16 6.1a3 3 0 0 1 0 5.9M17.4 14.6a5.6 5.6 0 0 1 3 4.8" />
  </Glyph>
);

/** Watch signal. */
export const Watch = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="6.6" y="6.6" width="10.8" height="10.8" rx="3.2" />
    <path d="M9 6.4 9.4 3h5.2l.4 3.4M9 17.6l.4 3.4h5.2l.4-3.4" />
    <path d="M12 9.8v2.4l1.6 1" />
  </Glyph>
);

/** Microphone. */
export const Mic = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="9.2" y="2.8" width="5.6" height="10.4" rx="2.8" />
    <path d="M5.6 11.4a6.4 6.4 0 0 0 12.8 0" />
    <path d="M12 17.8V21" />
  </Glyph>
);

/** Play spoken audio. */
export const Speaker = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M4 9.4h3.3L12 5.4v13.2l-4.7-4H4z" />
    <path d="M15.6 9.6a3.4 3.4 0 0 1 0 4.8M18.2 7a7 7 0 0 1 0 10" />
  </Glyph>
);

export const Check = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M4.6 12.6 9.5 17.4 19.4 6.9" />
  </Glyph>
);

export const Cross = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" />
  </Glyph>
);

/** Private / blocked by a consent rule. */
export const Lock = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="4.6" y="10.4" width="14.8" height="9.6" rx="2.6" />
    <path d="M8.2 10.4V7.9a3.8 3.8 0 0 1 7.6 0v2.5" />
    <path d="M12 14v2.4" />
  </Glyph>
);

/** Something Suraksha noticed. */
export const Alert = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 4.2 21 19.2H3z" />
    <path d="M12 10v3.6M12 16.4h.01" />
  </Glyph>
);

export const Clock = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 7.4V12l3 1.8" />
  </Glyph>
);

export const ChevronRight = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M9.5 5.5 16 12l-6.5 6.5" />
  </Glyph>
);

export const ArrowRight = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M4.5 12h15M13.5 6l6 6-6 6" />
  </Glyph>
);

/** Amma's own view of what was shared. */
export const Eye = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M2.8 12S6.4 5.9 12 5.9 21.2 12 21.2 12 17.6 18.1 12 18.1 2.8 12 2.8 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </Glyph>
);

/** All clear / she's okay. */
export const Heart = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 20.3S3.8 15.6 3.8 9.9a4.4 4.4 0 0 1 8.2-2.3 4.4 4.4 0 0 1 8.2 2.3c0 5.7-8.2 10.4-8.2 10.4Z" />
  </Glyph>
);

export const Home = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M3.8 10.4 12 4l8.2 6.4v8.4a1.6 1.6 0 0 1-1.6 1.6H5.4a1.6 1.6 0 0 1-1.6-1.6z" />
    <path d="M9.4 20.4v-6.2h5.2v6.2" />
  </Glyph>
);

export const Timeline = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M6.5 3.8v16.4" />
    <circle cx="6.5" cy="8.2" r="2.1" />
    <circle cx="6.5" cy="16.2" r="2.1" />
    <path d="M11.4 8.2h8.1M11.4 16.2h5.4" />
  </Glyph>
);

export const Bell = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M6.4 10.2a5.6 5.6 0 0 1 11.2 0c0 4 1.6 5.4 1.6 5.4H4.8s1.6-1.4 1.6-5.4Z" />
    <path d="M10.2 19a2 2 0 0 0 3.6 0" />
  </Glyph>
);

export const Spark = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 3.4 13.9 9l5.6 1.9-5.6 1.9L12 18.4 10.1 12.8 4.5 10.9 10.1 9z" />
  </Glyph>
);

/** A possible fall detected by the watch. */
export const Fall = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="8.4" cy="4.9" r="2.1" />
    <path d="M10.2 9.1 6.1 12l1.9 4.6" />
    <path d="M10.2 9.1h4.3l2.6 3.2" />
    <path d="M4.2 19.4h15.6" />
    <path d="M8 16.6 5.2 19.4M14.6 12.3l3.1 3.1" />
  </Glyph>
);

/** A handset, for the gate phone. */
export const Phone = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M6.2 10.4a12.4 12.4 0 0 0 5.4 5.4l1.9-1.9c.3-.3.7-.4 1-.2 1 .4 2.2.6 3.3.6.5 0 .9.4.9.9v3a.9.9 0 0 1-.9.9C10.1 19.1 4.9 13.9 4.9 5.2c0-.5.4-.9.9-.9h3c.5 0 .9.4.9.9 0 1.2.2 2.3.6 3.3.1.3 0 .7-.2 1l-1.9 1.9z" />
  </Glyph>
);

/** The same handset, hung up. */
export const PhoneDown = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M3.5 13.2c4.7-4.3 12.3-4.3 17 0" />
    <path d="M7.4 11.1 6 13.8a1 1 0 0 1-1.3.5l-1.6-.7" />
    <path d="M16.6 11.1 18 13.8a1 1 0 0 0 1.3.5l1.6-.7" />
  </Glyph>
);

export const MESSAGE_ICONS = {
  morning: Sunrise,
  reminder: Pill,
  investigation: Ask,
  neighbour_question: People,
  family_note: Note,
  family_update: Note,
  escalation_ask: Alert,
  escalation_update: People,
  all_clear: Heart,
} as const;
