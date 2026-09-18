import { cn, stateBadgeClass } from "../lib/utils";
import type { SessionState } from "../types";

export function StateBadge({ state }: { state: SessionState }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold tracking-wide uppercase",
        stateBadgeClass(state)
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {state.replace(/_/g, " ")}
    </span>
  );
}
