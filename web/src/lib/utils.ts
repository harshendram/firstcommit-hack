import type { SessionState, Severity } from "./types";

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

/** Humanise the backend's terse timeline labels for a product-grade UI. */
export function prettyTimelineLabel(label: string): string {
  const [head, ...rest] = label.split(":");
  const tail = rest.join(":").trim();
  switch (head) {
    case "trigger":
      return "Trigger fired";
    case "triage start":
      return "Triage started";
    case "assess":
      return `Assessed ${tail.split("—")[0]?.trim() ?? tail}`;
    case "handoff_generated":
      return "Handoff generated";
    case "escalated":
      return "Escalation started";
    case "awaiting handover":
      return "Awaiting handover";
    case "reassuring":
      return "Reassuring";
    case "resolved":
      return "Resolved";
    case "neighbour":
    case "security":
    case "family":
      return `${head[0]!.toUpperCase()}${head.slice(1)} ${tail}`;
    case "emergency_services":
      return `Emergency services ${tail}`;
    default:
      return label.replace(/_/g, " ");
  }
}

type Tone = {
  text: string;
  bg: string;
  ring: string;
  dot: string;
};

export const STATE_TONE: Record<SessionState, Tone> = {
  idle: {
    text: "text-ink-faint",
    bg: "bg-paper-sunk",
    ring: "ring-line",
    dot: "bg-ink-faint",
  },
  listening: {
    text: "text-ink",
    bg: "bg-paper-deep",
    ring: "ring-line",
    dot: "bg-ok",
  },
  triaging: {
    text: "text-ink",
    bg: "bg-paper-deep",
    ring: "ring-line",
    dot: "bg-ok",
  },
  reassuring: {
    text: "text-ok",
    bg: "bg-ok-wash",
    ring: "ring-ok/25",
    dot: "bg-ok",
  },
  handoff_generated: {
    text: "text-warn",
    bg: "bg-warn-wash",
    ring: "ring-warn/30",
    dot: "bg-warn",
  },
  escalating: {
    text: "text-alert",
    bg: "bg-alert-wash",
    ring: "ring-alert/25",
    dot: "bg-alert",
  },
  awaiting_handover: {
    text: "text-alert",
    bg: "bg-alert-wash",
    ring: "ring-alert/30",
    dot: "bg-alert",
  },
  resolved: {
    text: "text-ok",
    bg: "bg-ok-wash",
    ring: "ring-ok/25",
    dot: "bg-ok",
  },
};

export const SEVERITY_TONE: Record<Severity, Tone> = {
  low: {
    text: "text-ok",
    bg: "bg-ok-wash",
    ring: "ring-ok/25",
    dot: "bg-ok",
  },
  medium: {
    text: "text-warn",
    bg: "bg-warn-wash",
    ring: "ring-warn/30",
    dot: "bg-warn",
  },
  high: {
    text: "text-alert",
    bg: "bg-alert-wash",
    ring: "ring-alert/30",
    dot: "bg-alert",
  },
};

export const UNKNOWN_TONE: Tone = {
  text: "text-ink-faint",
  bg: "bg-paper-sunk",
  ring: "ring-line",
  dot: "bg-ink-faint",
};
