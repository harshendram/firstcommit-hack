import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { SessionState, Severity } from "../types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function stateBadgeClass(state: SessionState): string {
  switch (state) {
    case "idle":
      return "bg-ink-700 text-ink-200";
    case "listening":
    case "triaging":
      return "bg-accent-500/20 text-accent-400 ring-1 ring-accent-500/40";
    case "reassuring":
      return "bg-ok-500/20 text-ok-500 ring-1 ring-ok-500/40";
    case "handoff_generated":
    case "escalating":
      return "bg-warn-500/20 text-warn-500 ring-1 ring-warn-500/40";
    case "awaiting_handover":
      return "bg-alert-500/20 text-alert-400 ring-1 ring-alert-500/40";
    case "resolved":
      return "bg-ok-500/20 text-ok-500 ring-1 ring-ok-500/40";
    default:
      return "bg-ink-700 text-ink-200";
  }
}

export function severityBadgeClass(severity: Severity | null): string {
  switch (severity) {
    case "low":
      return "bg-ok-500/20 text-ok-500 ring-1 ring-ok-500/40";
    case "medium":
      return "bg-warn-500/20 text-warn-500 ring-1 ring-warn-500/40";
    case "high":
      return "bg-alert-500/20 text-alert-400 ring-1 ring-alert-500/50 animate-pulse";
    default:
      return "bg-ink-700 text-ink-300";
  }
}

export function severityDotClass(severity: Severity | null): string {
  switch (severity) {
    case "low":
      return "bg-ok-500";
    case "medium":
      return "bg-warn-500";
    case "high":
      return "bg-alert-500";
    default:
      return "bg-ink-500";
  }
}
