import { cn } from "../lib/utils";
import type { EscalationHop } from "../types";

const ROLE_LABEL: Record<EscalationHop["contact_role"], string> = {
  neighbour: "Neighbour",
  security: "Security",
  family: "Family",
  emergency_services: "EMS",
};

export function EscalationProgress({ chain }: { chain: EscalationHop[] }) {
  return (
    <div className="rounded-xl border border-ink-700/80 bg-ink-900/60 p-4 backdrop-blur">
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-ink-100 uppercase">
        Escalation Progress
      </h2>
      {chain.length === 0 ? (
        <p className="text-sm text-ink-400 italic">Escalation not started.</p>
      ) : (
        <ol className="flex flex-wrap items-center gap-2">
          {chain.map((hop, i) => (
            <li key={`${hop.contact_role}-${i}`} className="flex items-center gap-2">
              <div
                className={cn(
                  "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1",
                  hop.status === "acknowledged" &&
                    "bg-ok-500/15 text-ok-500 ring-ok-500/40",
                  hop.status === "notified" &&
                    "bg-warn-500/15 text-warn-500 ring-warn-500/40",
                  hop.status === "pending" &&
                    "bg-ink-800 text-ink-400 ring-ink-600",
                  hop.status === "timed_out" &&
                    "bg-alert-500/15 text-alert-400 ring-alert-500/40"
                )}
              >
                <StatusDot status={hop.status} />
                <span>
                  {ROLE_LABEL[hop.contact_role]}
                  <span className="ml-1 opacity-70">
                    {hop.status === "pending"
                      ? ""
                      : hop.status.replace("_", " ")}
                  </span>
                </span>
              </div>
              {i < chain.length - 1 && (
                <span className="text-ink-600">→</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: EscalationHop["status"] }) {
  return (
    <span
      className={cn(
        "h-2 w-2 rounded-full",
        status === "acknowledged" && "bg-ok-500",
        status === "notified" && "bg-warn-500 animate-pulse",
        status === "pending" && "bg-ink-500",
        status === "timed_out" && "bg-alert-500"
      )}
    />
  );
}
