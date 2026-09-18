import Link from "next/link";

export function BrandMark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`flex items-center gap-2.5 text-ink no-underline ${className ?? ""}`}
    >
      <ShieldGlyph />
      <span
        className="text-[1.3rem] font-extrabold tracking-[-0.02em]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Suraksha
      </span>
    </Link>
  );
}

export function ShieldGlyph({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      <path
        d="M14 2.5 24 6v7.6c0 5.6-4 10.2-10 11.9-6-1.7-10-6.3-10-11.9V6l10-3.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M9.2 14.1h2.3l1.4-3.2 2 6 1.5-2.8h2.4"
        stroke="var(--alert)"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
