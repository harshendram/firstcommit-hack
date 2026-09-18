"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Reveal } from "@/components/Reveal";
import { Alert, Check, Clock, Fall, Home, People, Spark, Sunrise } from "@/components/ui/Icon";
import { AppHeader, AppShell, Banner, EmptyState, IconWell, PageHero, PillLink, SectionTitle } from "@/components/ui/Shell";
import { useSurakshaState } from "@/hooks/useSurakshaState";
import { api } from "@/lib/api";
import type { SurakshaAlertView, Escalation } from "@/lib/surakshaTypes";

interface Dashboard {
  alerts: SurakshaAlertView[];
  escalations: Escalation[];
}

/** Family timeline: every alert and coordination step, in order. Never conversation content. */
export default function TimelinePage() {
  return <AuthGate>{() => <Timeline />}</AuthGate>;
}

function Timeline() {
  const { state, connected, lastError } = useSurakshaState();
  const [dash, setDash] = useState<Dashboard | null>(null);
  const names = Object.fromEntries(state.family_roster.map((m) => [m.id, m.name]));

  const load = useCallback(async () => {
    setDash(await api<Dashboard>("/suraksha/dashboard").catch(() => null));
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => document.visibilityState === "visible" && void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const alerts = dash?.alerts ?? [];
  const escalations = dash?.escalations ?? [];

  return (
    <AppShell>
      <AppHeader
        label="Timeline · orchestrator"
        live={connected}
        actions={
          <PillLink href="/home" tone="accent">
            <Home size={13} />
            Family home
          </PillLink>
        }
      />

      {lastError && (
        <Banner tone="alert">
          <Alert size={17} />
          <span>{lastError}</span>
        </Banner>
      )}

      <Reveal>
        <PageHero
          tone="neutral"
          icon={<Spark size={15} />}
          compact
          eyebrow={`Tier ${state.tier} · ${state.tier_label.replace(/_/g, " ")}`}
          title={state.tier_narration}
          lede={`Mode ${String(state.mode)} · coordination ${state.escalation_state.replace(/_/g, " ")}`}
        />
      </Reveal>

      <div className="grid gap-4 lg:grid-cols-2">
        <Reveal delay={0.06}>
          <section className="panel h-full p-6">
            <SectionTitle eyebrow="Routine model + judge" title="Alerts" />
            <div className="mt-4">
              {alerts.length === 0 ? (
                <EmptyState icon={<Check size={22} />}>None — boring is good.</EmptyState>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                  {alerts.map((a) => (
                    <li key={a.id} className="list-row">
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2.5 text-[0.95rem] font-semibold text-ink">
                            <IconWell tone={a.status === "resolved" ? "ok" : "warn"}>
                              {a.kind === "no_wake" ? <Sunrise size={15} /> : a.kind === "fall" ? <Fall size={15} /> : a.kind === "no_response" ? <Clock size={15} /> : <Alert size={15} />}
                            </IconWell>
                            {a.kind.replace(/_/g, " ")}
                          </span>
                          <span className="chip">
                            tier {a.tier} · {a.status}
                          </span>
                        </div>
                        {a.judgment && (
                          <p className="m-0 mt-1 text-sm leading-relaxed text-ink-soft">
                            <span className="eyebrow-sm text-ink-faint">judge</span> {a.judgment.severity} ·{" "}
                            {Math.round(a.judgment.confidence * 100)}% — {a.judgment.reasons.join("; ")}
                          </p>
                        )}
                        <p className="tnum m-0 text-xs text-ink-faint">{new Date(a.created_at).toLocaleString()}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </Reveal>

        <Reveal delay={0.1}>
          <section className="panel h-full p-6">
            <SectionTitle eyebrow="Step Functions" title="Family coordination" />
            <div className="mt-4">
              {escalations.length === 0 ? (
                <EmptyState icon={<People size={22} />}>No coordination yet.</EmptyState>
              ) : (
                escalations.map((e) => (
                  <div key={e.id} className="list-row mb-3 flex-col items-stretch last:mb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[0.95rem] font-semibold capitalize text-ink">{e.status}</span>
                      <span className="chip">severity {e.severity}</span>
                    </div>
                    <ol className="m-0 mt-3 flex list-none flex-col p-0">
                      {e.timeline.map((ev, i) => (
                        <li key={i} className="relative flex gap-3 pb-3 last:pb-0">
                          {i < e.timeline.length - 1 && (
                            <span className="absolute left-[5px] top-4 bottom-0 w-px bg-line" aria-hidden />
                          )}
                          <span className="relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-ink" />
                          <span className="flex flex-1 flex-wrap items-baseline gap-x-2 text-sm">
                            <span className="text-ink">
                              {ev.event.replace(/_/g, " ")}
                              {ev.member ? ` · ${names[ev.member] ?? ev.member}` : ""}
                            </span>
                            <span className="tnum text-xs text-ink-faint">
                              {new Date(ev.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))
              )}
            </div>
          </section>
        </Reveal>
      </div>
    </AppShell>
  );
}
