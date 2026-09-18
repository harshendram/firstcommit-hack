import { SeverityBadge } from "@/components/Badges";
import { STATE_LABEL, type HandoffSummary, type SessionEvent } from "@/lib/types";
import { formatElapsed } from "@/lib/utils";

export function PatientStatus({ session }: { session: SessionEvent }) {
  const started = session.started_at
    ? new Date(session.started_at).getTime()
    : null;
  const lastEvent = session.timeline[session.timeline.length - 1];

  return (
    <section className="panel p-6">
      <h2 className="eyebrow m-0 mb-4 text-ink-faint">Patient status</h2>
      <dl className="m-0 grid gap-3.5">
        <Row label="Severity">
          <SeverityBadge severity={session.severity} size="sm" />
        </Row>
        <Row label="Phase">
          <span className="text-[0.94rem] font-semibold text-ink">
            {STATE_LABEL[session.state]}
          </span>
        </Row>
        <Row label="Trigger">
          <span className="text-[0.94rem] text-ink">
            {session.trigger_type
              ? session.trigger_type.replace(/_/g, " ")
              : "—"}
          </span>
        </Row>
        <Row label="Elapsed">
          <span className="tnum text-[0.94rem] text-ink">
            {started && lastEvent
              ? formatElapsed(lastEvent.elapsed_ms)
              : "0:00"}
          </span>
        </Row>
      </dl>
    </section>
  );
}

export function HandoffCard({ handoff }: { handoff: HandoffSummary | null }) {
  return (
    <section className="panel overflow-hidden">
      <header className="panel-head">
        <h2 className="eyebrow m-0 text-ink-faint">Emergency handoff</h2>
        {handoff && <SeverityBadge severity={handoff.severity} size="sm" />}
      </header>

      {!handoff ? (
        <div className="px-5 py-8 text-center">
          <p className="m-0 text-sm text-ink-faint">
            Generated automatically the moment severity reaches medium or high.
          </p>
        </div>
      ) : (
        <dl className="m-0 grid gap-0 divide-y divide-line">
          <Field label="Patient" value={`${handoff.patient_name}, ${handoff.age}`} strong />
          <Field label="Location" value={handoff.location} />
          <Field label="Condition" value={handoff.condition} strong />
          <Field label="Symptoms" value={handoff.symptoms} />
          <Field label="History" value={handoff.medical_history} />
          <Field label="Medications" value={handoff.medications} />
          <Field label="Recommended" value={handoff.recommended_action} />
        </dl>
      )}
    </section>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="eyebrow-sm text-ink-faint">{label}</dt>
      <dd className="m-0">{children}</dd>
    </div>
  );
}

function Field({
  label,
  value,
  strong,
}: {
  label: string;
  value: string | string[];
  strong?: boolean;
}) {
  const isList = Array.isArray(value);
  return (
    <div className="grid grid-cols-[104px_1fr] gap-3 px-5 py-3">
      <dt className="eyebrow-sm pt-0.5 text-ink-faint">{label}</dt>
      <dd className="m-0">
        {isList ? (
          value.length === 0 ? (
            <span className="text-[0.9rem] text-ink-faint">—</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {value.map((v) => (
                <span
                  key={v}
                  className="chip"
                >
                  {v}
                </span>
              ))}
            </div>
          )
        ) : (
          <span
            className={
              strong
                ? "text-[0.94rem] font-semibold text-ink"
                : "text-[0.9rem] text-ink-soft"
            }
          >
            {value}
          </span>
        )}
      </dd>
    </div>
  );
}
