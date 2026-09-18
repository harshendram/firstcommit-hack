"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/landing/BrandMark";
import { cn } from "@/lib/utils";

/** Page frame shared by every app screen: warm paper, hairline dots, centred column. */
export function AppShell({
  children,
  width = "wide",
  className,
  flush,
}: {
  children: ReactNode;
  width?: "wide" | "narrow" | "phone";
  className?: string;
  flush?: boolean;
}) {
  const max = width === "phone" ? "max-w-md" : width === "narrow" ? "max-w-2xl" : "max-w-5xl";
  return (
    <div className={cn("relative min-h-dvh", flush ? "bg-transparent" : "bg-paper")}>
      {!flush && <div className="dot-bg pointer-events-none absolute inset-0 opacity-[0.55]" aria-hidden />}
      {!flush && (
        <>
          <div
            className="pointer-events-none absolute -top-24 right-[-12%] h-[420px] w-[420px] rounded-full blur-3xl"
            style={{ background: "radial-gradient(circle, oklch(0.56 0.18 28 / 0.07), transparent 70%)" }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute bottom-[-18%] left-[-14%] h-[380px] w-[380px] rounded-full blur-3xl"
            style={{ background: "radial-gradient(circle, oklch(0.72 0.08 85 / 0.18), transparent 70%)" }}
            aria-hidden
          />
        </>
      )}
      <div className={cn("relative mx-auto flex min-h-dvh flex-col gap-6 px-4 py-6 md:px-8 md:py-10", max, className)}>
        {children}
      </div>
    </div>
  );
}

/** Header with the shield mark, where you are, and whether the data is fresh. */
export function AppHeader({
  label,
  live,
  liveText,
  actions,
}: {
  label: string;
  live?: boolean;
  liveText?: [string, string];
  actions?: ReactNode;
}) {
  const [on, off] = liveText ?? ["Up to date", "Reconnecting…"];
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-5">
      <div className="flex items-center gap-4">
        <BrandMark />
        <span className="hidden h-7 w-px bg-line sm:block" />
        <div className="hidden sm:block">
          <div className="eyebrow-sm text-ink-faint">{label}</div>
          {live !== undefined && (
            <div className={cn("eyebrow-sm mt-1 flex items-center gap-1.5", live ? "text-ok" : "text-alert")}>
              <span className="pulse-dot" />
              {live ? on : off}
            </div>
          )}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Small pill link/button used in headers — quiet matches landing tags, accent matches the nav CTA. */
export function PillLink({
  href,
  onClick,
  children,
  tone = "quiet",
}: {
  href?: string;
  onClick?: () => void;
  children: ReactNode;
  tone?: "quiet" | "accent";
}) {
  const cls =
    tone === "accent"
      ? "nav-cta"
      : "nav-link inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-card px-3.5 py-2 no-underline hover:border-line-strong hover:text-ink";
  if (href) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} onClick={onClick}>
      {children}
    </button>
  );
}

export function SectionTitle({ eyebrow, title, aside }: { eyebrow?: string; title: string; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        {eyebrow && <p className="eyebrow m-0 text-ink-faint">{eyebrow}</p>}
        <h2 className="m-0 mt-1.5 text-[1.15rem] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
      </div>
      {aside}
    </div>
  );
}

const HERO_TONE = {
  neutral: { border: "", eye: "text-ink-faint" },
  ok: { border: "border-ok/25", eye: "text-ok" },
  warn: { border: "border-warn/45", eye: "text-warn" },
  alert: { border: "border-alert/30", eye: "text-alert" },
  calm: { border: "border-calm/25", eye: "text-calm" },
} as const;

/** Display-title card used at the top of family, timeline, and privacy. */
export function PageHero({
  eyebrow,
  title,
  lede,
  tone = "neutral",
  icon,
  children,
  compact,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  tone?: keyof typeof HERO_TONE;
  icon?: ReactNode;
  children?: ReactNode;
  compact?: boolean;
}) {
  const t = HERO_TONE[tone];
  return (
    <section className={cn("panel relative overflow-hidden p-6 md:p-7", t.border)}>
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-70" aria-hidden />
      <div className="relative">
        <p className={cn("eyebrow m-0 flex items-center gap-2", t.eye)}>
          {icon}
          {eyebrow}
        </p>
        <h1
          className={cn(
            "display m-0 mt-3 text-ink",
            compact ? "text-[clamp(1.5rem,3.2vw,2.1rem)]" : "text-[clamp(1.7rem,3.6vw,2.4rem)]",
          )}
        >
          {title}
        </h1>
        {lede && <p className="m-0 mt-3 max-w-[46ch] text-[0.98rem] leading-relaxed text-ink-soft">{lede}</p>}
        {children}
      </div>
    </section>
  );
}

export function Banner({ tone, children }: { tone: "alert" | "warn" | "ok" | "calm"; children: ReactNode }) {
  const cls = {
    alert: "border-alert/30 bg-alert-wash text-alert",
    warn: "border-warn/40 bg-warn-wash text-ink",
    ok: "border-ok/30 bg-ok-wash text-ink",
    calm: "border-calm/30 bg-calm-wash text-calm",
  }[tone];
  return (
    <div role="status" className={cn("flex items-start gap-2.5 rounded-[14px] border px-4 py-3 text-sm", cls)}>
      {children}
    </div>
  );
}

export function EmptyState({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-[14px] border border-dashed border-line px-4 py-8 text-center text-sm text-ink-faint">
      <span className="text-ink-faint/70">{icon}</span>
      {children}
    </div>
  );
}

/** Label + value tile, tabular figures so columns line up. */
export function StatTile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "ok" | "warn" }) {
  return (
    <div
      className={cn(
        "rounded-[12px] border px-3.5 py-3",
        tone === "warn" ? "border-warn/30 bg-warn-wash" : tone === "ok" ? "border-ok/25 bg-ok-wash" : "border-line bg-paper-deep",
      )}
    >
      <div className="eyebrow-sm text-ink-faint">{label}</div>
      <div className="tnum mt-1.5 text-[1.35rem] font-semibold leading-none text-ink">{value}</div>
      {hint && <div className="mt-1.5 text-[0.72rem] leading-snug text-ink-faint">{hint}</div>}
    </div>
  );
}

export function IconWell({
  children,
  tone = "quiet",
}: {
  children: ReactNode;
  tone?: "quiet" | "ok" | "warn" | "alert" | "calm";
}) {
  const cls = {
    quiet: "bg-paper-sunk text-ink-faint",
    ok: "bg-ok-wash text-ok",
    warn: "bg-warn-wash text-warn",
    alert: "bg-alert-wash text-alert",
    calm: "bg-calm-wash text-calm",
  }[tone];
  return <span className={cn("icon-well", cls)}>{children}</span>;
}
