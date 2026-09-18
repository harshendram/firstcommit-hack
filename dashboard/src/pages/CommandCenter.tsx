import { Link } from "react-router-dom";
import { useRakshakSocket } from "../hooks/useRakshakSocket";
import { EscalationProgress } from "../components/EscalationProgress";
import { LiveTranscript } from "../components/LiveTranscript";
import { HandoffCard, PatientStatus } from "../components/PatientPanels";
import { StateBadge } from "../components/StateBadge";
import { TimelineBar } from "../components/TimelineBar";

export function CommandCenter() {
  const { session, connected, send } = useRakshakSocket("dashboard");

  const canConfirm =
    session.state === "awaiting_handover" ||
    session.state === "escalating" ||
    session.state === "reassuring";

  return (
    <div className="flex h-full flex-col gap-3 p-4 md:p-5">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-alert-500/20 text-lg ring-1 ring-alert-500/40">
            🚨
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-ink-50 md:text-xl">
              RAKSHAK — AI First Responder
            </h1>
            <p className="text-xs text-ink-400">
              Command Center ·{" "}
              <span className={connected ? "text-ok-500" : "text-alert-400"}>
                {connected ? "live" : "reconnecting…"}
              </span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StateBadge state={session.state} />
          {canConfirm && (
            <button
              type="button"
              onClick={() => send({ type: "confirm_arrival" })}
              className="rounded-lg bg-ok-500 px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:brightness-110"
            >
              Confirm arrival
            </button>
          )}
          <button
            type="button"
            onClick={() => send({ type: "reset" })}
            className="rounded-lg bg-ink-800 px-3 py-1.5 text-xs font-medium text-ink-200 ring-1 ring-ink-600 hover:bg-ink-700"
          >
            Reset
          </button>
          <Link
            to="/patient"
            className="rounded-lg bg-ink-800 px-3 py-1.5 text-xs font-medium text-accent-400 ring-1 ring-ink-600 hover:bg-ink-700"
          >
            Patient sim →
          </Link>
        </div>
      </header>

      {/* Main grid */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
        <LiveTranscript turns={session.transcript} />
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <PatientStatus state={session.state} severity={session.severity} />
          <HandoffCard handoff={session.handoff} />
        </div>
      </div>

      <EscalationProgress chain={session.escalation_chain} />
      <TimelineBar entries={session.timeline} />
    </div>
  );
}
