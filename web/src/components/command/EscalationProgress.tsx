import { ROLE_LABEL, type EscalationHop } from "@/lib/types";
import { cn, formatClock } from "@/lib/utils";

const STATUS_STYLE: Record<
  EscalationHop["status"],
  { chip: string; dot: string; label: string }
> = {
  pending: {
    chip: "",
    dot: "bg-ink-faint",
    label: "Pending",
  },
  notified: {
    chip: "chip-warn",
    dot: "bg-warn",
    label: "Notified",
  },
  acknowledged: {
    chip: "chip-ok",
    dot: "bg-ok",
    label: "Acknowledged",
  },
  timed_out: {
    chip: "chip-alert",
    dot: "bg-alert",
    label: "Timed out",
  },
};

export function EscalationProgress({ chain }: { chain: EscalationHop[] }) {
  return (
    <section className="panel p-6">
      <h2 className="eyebrow m-0 mb-4 text-ink-faint">Escalation progress</h2>

      {chain.length === 0 ? (
        <p className="m-0 text-sm text-ink-faint">
          Contact chain starts automatically once the AI decides to escalate.
        </p>
      ) : (
        <ol className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {chain.map((hop, i) => {
            const style = STATUS_STYLE[hop.status];
            return (
              <li
                key={`${hop.contact_role}-${i}`}
                className="panel-sunk flex items-start justify-between gap-3 px-3.5 py-3"
              >
                <div className="min-w-0">
                  <div className="eyebrow-sm text-ink-faint">
                    {ROLE_LABEL[hop.contact_role]}
                  </div>
                  <div className="mt-1 truncate text-[0.9rem] font-medium text-ink">
                    {hop.contact_name}
                  </div>
                  {(hop.channel || hop.phone) && (
                    <div className="mt-1 truncate text-[0.72rem] text-ink-faint">
                      {hop.channel === "sms"
                        ? "SMS · Amazon SNS"
                        : hop.channel === "voice"
                          ? "Voice · Amazon Connect"
                          : hop.channel === "push"
                            ? "Web Push"
                            : "Phone"}
                      {hop.phone ? ` · ${hop.phone}` : ""}
                    </div>
                  )}
                  {hop.notified_at && (
                    <div className="tnum mt-1 text-[0.72rem] text-ink-faint">
                      {formatClock(hop.notified_at)}
                    </div>
                  )}
                </div>
                <span
                  className={cn("chip shrink-0", style.chip)}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      style.dot,
                      hop.status === "notified" && "animate-pulse"
                    )}
                  />
                  {style.label}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
