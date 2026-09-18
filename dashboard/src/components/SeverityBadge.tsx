import { cn, severityBadgeClass, severityDotClass } from "../lib/utils";
import type { Severity } from "../types";

export function SeverityBadge({ severity }: { severity: Severity | null }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold tracking-wide uppercase",
        severityBadgeClass(severity)
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", severityDotClass(severity))} />
      {severity ?? "unknown"}
    </span>
  );
}
