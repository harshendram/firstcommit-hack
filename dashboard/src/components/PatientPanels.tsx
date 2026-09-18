import type { HandoffSummary, SessionState, Severity } from "../types";
import { SeverityBadge } from "./SeverityBadge";

export function PatientStatus({
  state,
  severity,
}: {
  state: SessionState;
  severity: Severity | null;
}) {
  return (
    <div className="rounded-xl border border-ink-700/80 bg-ink-900/60 p-4 backdrop-blur">
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-ink-100 uppercase">
        Patient Status
      </h2>
      <dl className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-ink-400">Severity</dt>
          <dd>
            <SeverityBadge severity={severity} />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-ink-400">Current phase</dt>
          <dd className="font-medium tracking-wide text-ink-50 uppercase">
            {state.replace(/_/g, " ")}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function HandoffCard({ handoff }: { handoff: HandoffSummary | null }) {
  return (
    <div className="rounded-xl border border-ink-700/80 bg-ink-900/60 p-4 backdrop-blur">
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-ink-100 uppercase">
        Emergency Handoff
      </h2>
      {!handoff ? (
        <p className="text-sm text-ink-400 italic">
          No handoff generated yet.
        </p>
      ) : (
        <div className="space-y-2 rounded-lg bg-ink-950/60 p-3 ring-1 ring-warn-500/30">
          <Row label="Patient" value={`${handoff.patient_name}, ${handoff.age}`} />
          <Row label="Location" value={handoff.location} />
          <Row label="Condition" value={handoff.condition} />
          <Row label="Symptoms" value={handoff.symptoms.join(", ") || "—"} />
          <Row
            label="History"
            value={handoff.medical_history.join(", ") || "—"}
          />
          <Row label="Meds" value={handoff.medications.join(", ") || "—"} />
          <Row label="Action" value={handoff.recommended_action} />
          <div className="pt-1">
            <SeverityBadge severity={handoff.severity} />
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2 text-sm">
      <span className="text-ink-400">{label}</span>
      <span className="text-ink-50">{value}</span>
    </div>
  );
}
