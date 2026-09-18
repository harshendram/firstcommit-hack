import { cn, SEVERITY_TONE, STATE_TONE, UNKNOWN_TONE } from "@/lib/utils";
import { STATE_LABEL, type SessionState, type Severity } from "@/lib/types";

export function StateBadge({
  state,
  live = false,
}: {
  state: SessionState;
  live?: boolean;
}) {
  const tone = STATE_TONE[state];
  return (
    <span
      className={cn(
        "chip",
        tone.bg,
        tone.text,
        tone.ring
      )}
    >
      {live && state !== "idle" && state !== "resolved" ? (
        <span className="pulse-dot" />
      ) : (
        <span className={cn("h-[7px] w-[7px] rounded-full", tone.dot)} />
      )}
      {STATE_LABEL[state]}
    </span>
  );
}

export function SeverityBadge({
  severity,
  size = "md",
}: {
  severity: Severity | null;
  size?: "sm" | "md";
}) {
  const tone = severity ? SEVERITY_TONE[severity] : UNKNOWN_TONE;
  return (
    <span
      className={cn(
        "chip",
        size === "sm" ? "px-2.5 py-1" : "px-3 py-1.5",
        tone.bg,
        tone.text,
        tone.ring
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", tone.dot)} />
      {severity ?? "Unknown"}
    </span>
  );
}
