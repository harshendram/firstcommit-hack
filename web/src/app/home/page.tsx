"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Reveal } from "@/components/Reveal";
import {
  Alert,
  ArrowRight,
  Ask,
  Bell,
  Check,
  ChevronRight,
  Clock,
  Cross,
  Fall,
  Heart,
  Lock,
  Note,
  People,
  Spark,
  Sunrise,
  Timeline as TimelineIcon,
  Watch,
} from "@/components/ui/Icon";
import { AppHeader, AppShell, Banner, EmptyState, IconWell, PageHero, PillLink, SectionTitle, StatTile } from "@/components/ui/Shell";
import { useSurakshaState } from "@/hooks/useSurakshaState";
import { ApiError, api } from "@/lib/api";
import type { SurakshaAlertView, SurakshaState, Escalation } from "@/lib/surakshaTypes";
import type { Viewer } from "@/lib/amplify";
import { enablePush, pushStatus, type PushStatus } from "@/lib/push";
import { cn } from "@/lib/utils";

interface DashboardDay {
  date: string;
  wake_at?: string | null;
  checkin_at?: string | null;
  reminders_done: number;
  simulated: boolean;
  mood?: string | null;
  unwell_reported?: boolean | null;
}

interface Dashboard {
  days: DashboardDay[];
  alerts: SurakshaAlertView[];
  escalations: Escalation[];
  shared: { health: boolean; mood: boolean };
}

const ALERT_TITLES: Record<string, string> = {
  no_wake: "Not up at her usual time",
  no_response: "Didn't answer Suraksha",
  fall: "The watch thought she fell",
  parent_words: "Said she wasn't feeling well",
};

const alertTitle = (a: SurakshaAlertView) => ALERT_TITLES[a.kind] ?? a.kind.replace(/_/g, " ");

export default function HomePage() {
  return <AuthGate>{(viewer, signOut) => <FamilyHome viewer={viewer} signOut={signOut} />}</AuthGate>;
}

function FamilyHome({ viewer, signOut }: { viewer: Viewer; signOut?: () => void }) {
  const { state, connected, lastError } = useSurakshaState();
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [dashError, setDashError] = useState<string | null>(null);
  const [openAlert, setOpenAlert] = useState<string | null>(null);
  const [push, setPush] = useState<PushStatus>("unsupported");

  const load = useCallback(async () => {
    try {
      setDash(await api<Dashboard>("/suraksha/dashboard"));
      setDashError(null);
    } catch (err) {
      setDashError(err instanceof ApiError ? err.message : "Could not load the dashboard.");
    }
  }, []);

  useEffect(() => {
    void load();
    void pushStatus().then(setPush);
    const timer = window.setInterval(() => document.visibilityState === "visible" && void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (viewer.isParent) {
    return (
      <AppShell width="phone" className="items-center justify-center text-center">
        <p className="m-0 text-ink-soft">This device is Amma&apos;s.</p>
        <Link href="/parent" className="btn btn-primary no-underline">
          Open Amma&apos;s Suraksha
          <ArrowRight size={16} />
        </Link>
      </AppShell>
    );
  }

  const today = dash?.days.at(-1);
  const activeEsc = dash?.escalations.find((e) =>
    ["running", "starting", "asking", "asking_parent", "accepted"].includes(e.status),
  );
  const quiet = state.escalation_state === "none" && !activeEsc;

  return (
    <AppShell>
      <AppHeader
        label={`Family · ${state.parent_name}`}
        live={connected}
        actions={
          <>
            {push !== "enabled" && push !== "unsupported" && (
              <PillLink tone="accent" onClick={() => void enablePush().then(setPush)}>
                <Bell size={13} />
                Turn on alerts
              </PillLink>
            )}
            <PillLink href="/command">
              <TimelineIcon size={13} />
              Timeline
            </PillLink>
            {signOut && <PillLink onClick={signOut}>Sign out</PillLink>}
          </>
        }
      />

      {(lastError || dashError) && (
        <Banner tone="alert">
          <Alert size={17} />
          <span>{dashError || lastError}</span>
        </Banner>
      )}

      <AnimatePresence>
        {activeEsc && <ActiveEscalation esc={activeEsc} state={state} viewer={viewer} onChange={load} />}
      </AnimatePresence>

      <Reveal>
        <section className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
          <PageHero
            tone={quiet ? "ok" : "warn"}
            icon={quiet ? <Heart size={15} /> : <Alert size={15} />}
            eyebrow={quiet ? "Nothing to do" : `Tier ${state.tier}`}
            title={quiet ? "Boring is good." : state.tier_narration}
            lede={
              quiet
                ? `${state.parent_name} is going about her day. Suraksha speaks up only when something is actually different.`
                : (state.last_decision?.summary ?? "Suraksha is checking on her now.")
            }
          >
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatTile
                label="Woke"
                value={state.today.wake_detected_at ?? "not yet"}
                hint={`usually ${state.baseline.wake_window[0]}–${state.baseline.wake_window[1]}`}
                tone={state.today.wake_detected_at ? "ok" : undefined}
              />
              <StatTile label="Talked to Suraksha" value={state.today.checkin_completed ? "yes" : "not yet"} />
              <StatTile label="Reminders done" value={String(today?.reminders_done ?? state.today.reminders_done ?? 0)} />
            </div>
          </PageHero>
          <AskAlly name={state.parent_name} />
        </section>
      </Reveal>

      <Reveal delay={0.06}>
        <section className="panel p-6">
          <SectionTitle
            eyebrow="Routine model"
            title="Wake time · last 14 days"
            aside={
              <span className="eyebrow-sm flex items-center gap-1.5 text-ink-faint">
                <span className="inline-block h-2.5 w-2.5 rounded-full border border-warn bg-warn-wash" />
                simulated baseline
              </span>
            }
          />
          <WakeChart days={dash?.days ?? []} window={state.baseline.wake_window} />
        </section>
      </Reveal>

      <div className="grid gap-4 lg:grid-cols-2">
        <Reveal delay={0.1}>
          <section className="panel h-full p-6">
            <SectionTitle eyebrow="History" title="When Suraksha checked in" />
            <div className="mt-4">
              {(dash?.alerts ?? []).length === 0 ? (
                <EmptyState icon={<Heart size={22} />}>Nothing yet. Most days, Suraksha says nothing at all.</EmptyState>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {(dash?.alerts ?? []).map((a) => (
                    <li key={a.id}>
                      <button type="button" onClick={() => setOpenAlert(a.id)} className="list-row group items-center justify-between">
                        <span className="flex items-center gap-3">
                          <IconWell tone={a.status === "resolved" ? "ok" : "warn"}>
                            {a.kind === "no_wake" ? <Sunrise size={17} /> : a.kind === "fall" ? <Fall size={17} /> : a.kind === "no_response" ? <Clock size={17} /> : <Alert size={17} />}
                          </IconWell>
                          <span>
                            <span className="block text-[0.98rem] font-semibold text-ink">{alertTitle(a)}</span>
                            <span className="tnum block text-xs text-ink-faint">
                              {new Date(a.created_at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}
                              {a.judgment ? ` · ${a.judgment.severity}` : ""}
                            </span>
                          </span>
                        </span>
                        <span className="eyebrow-sm flex items-center gap-1 text-ink-faint transition group-hover:text-ink">
                          why
                          <ChevronRight size={13} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </Reveal>

        <Reveal delay={0.14}>
          <div className="flex h-full flex-col gap-4">
            <SendNote name={state.parent_name} />
            <section className="panel flex-1 p-6">
              <SectionTitle eyebrow="Privacy" title="What you can see" />
              <ul className="m-0 mt-4 flex list-none flex-col gap-2.5 p-0 text-sm text-ink-soft">
                <SharedRow ok label="Her routine and safety" />
                <SharedRow ok={Boolean(dash?.shared.mood)} label="How she seems" />
                <SharedRow ok={Boolean(dash?.shared.health)} label="Health she mentions" />
                <SharedRow ok={false} label="Her conversations with Suraksha" />
              </ul>
              <p className="m-0 mt-4 border-t border-line pt-4 text-xs leading-relaxed text-ink-faint">
                {state.parent_name} sets these by voice and can change them any time. Suraksha is not an emergency service —
                if it&apos;s urgent, call <strong className="text-ink">112</strong>.
              </p>
            </section>
          </div>
        </Reveal>
      </div>

      <p className="eyebrow-sm flex items-center gap-2 text-ink-faint">
        <Watch size={13} />
        {state.honesty}
      </p>

      <AnimatePresence>{openAlert && <WhyDrawer alertId={openAlert} onClose={() => setOpenAlert(null)} />}</AnimatePresence>
    </AppShell>
  );
}

function SharedRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2.5">
      <IconWell tone={ok ? "ok" : "quiet"}>
        {ok ? <Check size={13} /> : <Lock size={13} />}
      </IconWell>
      <span className={ok ? "text-ink" : "text-ink-faint"}>{label}</span>
    </li>
  );
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function WakeChart({ days, window: win }: { days: DashboardDay[]; window: [string, string] }) {
  const lo = toMinutes(win[0]) - 75;
  const hi = toMinutes(win[1]) + 105;
  const W = 720;
  const H = 190;
  const x = (i: number) => 34 + (i * (W - 68)) / Math.max(1, days.length - 1);
  const y = (min: number) => H - 26 - ((Math.min(hi, Math.max(lo, min)) - lo) / (hi - lo)) * (H - 52);
  const points = days.map((d, i) => {
    const woke = d.wake_at ? new Date(d.wake_at) : null;
    return { d, i, minutes: woke ? woke.getHours() * 60 + woke.getMinutes() : null };
  });
  const line = points
    .filter((p) => p.minutes !== null)
    .map((p, n) => `${n === 0 ? "M" : "L"} ${x(p.i)} ${y(p.minutes as number)}`)
    .join(" ");

  if (days.length === 0) {
    return <p className="m-0 mt-4 text-sm text-ink-faint">No days recorded yet.</p>;
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-5 w-full" role="img" aria-label="Wake time over the last 14 days">
      <rect
        x="18"
        width={W - 36}
        y={y(toMinutes(win[1]))}
        height={Math.max(2, y(toMinutes(win[0])) - y(toMinutes(win[1])))}
        rx="8"
        fill="var(--ok-wash)"
      />
      <text x="26" y={y(toMinutes(win[1])) - 7} fontSize="10" letterSpacing="0.12em" fill="var(--ink-faint)">
        HER USUAL WINDOW · {win[0]}–{win[1]}
      </text>
      <path d={line} fill="none" stroke="var(--ink)" strokeWidth="1.6" strokeOpacity="0.45" strokeLinecap="round" />
      {points.map(({ d, i, minutes }) => (
        <g key={d.date}>
          {minutes !== null ? (
            <circle
              cx={x(i)}
              cy={y(minutes)}
              r={d.simulated ? 5 : 7}
              fill={d.simulated ? "var(--paper)" : "var(--ink)"}
              stroke={d.simulated ? "var(--warn)" : "var(--ink)"}
              strokeWidth="1.8"
            />
          ) : (
            <g>
              <line x1={x(i)} y1={H - 34} x2={x(i)} y2={H - 44} stroke="var(--alert)" strokeWidth="2" strokeLinecap="round" />
              <circle cx={x(i)} cy={H - 30} r="1.8" fill="var(--alert)" />
            </g>
          )}
          <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="9.5" fill="var(--ink-faint)">
            {d.date.slice(8)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function AskAlly({ name }: { name: string }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<{ status: string; answer: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      setAnswer(await api<{ status: string; answer: string }>("/suraksha/family/ask", { method: "POST", json: { question: q } }));
    } catch (err) {
      setAnswer({ status: "error", answer: err instanceof ApiError ? err.message : "Could not ask Suraksha." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel flex flex-col p-6">
      <SectionTitle eyebrow="Grounded" title="Ask Suraksha" />
      <p className="m-0 mt-2 text-sm leading-relaxed text-ink-soft">
        Answers come only from what Suraksha recorded — otherwise it says it isn&apos;t sure.
      </p>
      <form
        className="mt-4 flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <input
          className="field"
          placeholder={`Did ${name} wake up on time this week?`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Checking the record…" : "Ask"}
          {!busy && <Ask size={15} />}
        </button>
      </form>
      {answer && (
        <div
          className={cn(
            "mt-4 flex items-start gap-2.5 rounded-[12px] px-3.5 py-3 text-sm leading-relaxed",
            answer.status === "answered"
              ? "bg-calm-wash text-ink"
              : answer.status === "not_permitted"
                ? "bg-warn-wash text-ink"
                : "bg-paper-sunk text-ink-soft",
          )}
        >
          <span className="mt-0.5 text-ink-faint">
            {answer.status === "answered" ? <Spark size={15} /> : answer.status === "not_permitted" ? <Lock size={15} /> : <Ask size={15} />}
          </span>
          <span>{answer.answer}</span>
        </div>
      )}
    </div>
  );
}

function SendNote({ name }: { name: string }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <form
      className="panel flex flex-col p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        await api("/suraksha/family/note", { method: "POST", json: { text } }).catch(() => undefined);
        setText("");
        setSent(true);
      }}
    >
      <SectionTitle eyebrow="Say hello" title={`Send ${name} a note`} />
      <p className="m-0 mt-2 text-sm leading-relaxed text-ink-soft">Suraksha reads it to her in her own language.</p>
      <div className="mt-4 flex gap-2">
        <input
          className="field flex-1"
          placeholder="I'll call you at 7 tonight"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSent(false);
          }}
        />
        <button type="submit" className="btn btn-ghost shrink-0">
          {sent ? <Check size={15} /> : <Note size={15} />}
          {sent ? "Sent" : "Send"}
        </button>
      </div>
    </form>
  );
}

function ActiveEscalation({
  esc,
  state,
  viewer,
  onChange,
}: {
  esc: Escalation;
  state: SurakshaState;
  viewer: Viewer;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const names = Object.fromEntries(state.family_roster.map((m) => [m.id, m.name]));
  const reply = async (decision: "accept" | "decline" | "arrived") => {
    setBusy(true);
    try {
      await api(`/suraksha/escalations/${esc.id}/reply`, { method: "POST", json: { decision } });
      navigator.vibrate?.([40, 30, 80]);
      setMsg(null);
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not send.");
    } finally {
      setBusy(false);
      onChange();
    }
  };
  const askingMe = esc.current_contact === viewer.memberId;
  const iAmGoing = esc.responder === viewer.memberId && esc.status === "accepted";

  return (
    <motion.section
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="panel overflow-hidden border-warn/50"
    >
      <div className="bg-warn-wash px-6 py-5">
        <p className="eyebrow m-0 flex items-center gap-2 text-warn">
          <People size={15} />
          Suraksha is coordinating
        </p>
        <h2 className="display m-0 mt-2 text-[1.5rem] text-ink">{state.last_decision?.summary ?? state.tier_narration}</h2>
        {msg && <p className="m-0 mt-2 text-sm text-alert">{msg}</p>}
        {(askingMe || iAmGoing) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {askingMe && (
              <>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void reply("accept")}>
                  <Check size={15} />I can go
                </button>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void reply("decline")}>
                  <Cross size={15} />
                  Can&apos;t right now
                </button>
              </>
            )}
            {iAmGoing && (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void reply("arrived")}>
                <Heart size={15} />
                I&apos;ve arrived
              </button>
            )}
          </div>
        )}
      </div>
      <ol className="m-0 list-none border-t border-line p-0">
        {esc.timeline.map((ev, i) => (
          <li key={i} className="flex items-center gap-3 border-b border-line/60 px-6 py-2.5 text-sm last:border-b-0">
            <span className="tnum w-14 shrink-0 text-xs text-ink-faint">
              {new Date(ev.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </span>
            <span className="text-ink-soft">
              {ev.event.replace(/_/g, " ")}
              {ev.member ? ` · ${names[ev.member] ?? ev.member}` : ""}
            </span>
          </li>
        ))}
      </ol>
    </motion.section>
  );
}

interface AlertDetail {
  alert: SurakshaAlertView & { gate?: { code: string; level: string; detail?: unknown }[]; resolution?: string };
  baseline: SurakshaState["baseline"];
  escalation: Escalation | null;
  consent_decisions: { at: string; principal_id: string; action: string; topic: string; decision: string; reason: string }[];
  parent_words_note: string | null;
}

function WhyDrawer({ alertId, onClose }: { alertId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<AlertDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<AlertDetail>(`/suraksha/alerts/${alertId}`).then(setDetail, (err) => setError(err.message));
  }, [alertId]);
  const j = detail?.alert.judgment;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-40 flex justify-end bg-ink/25 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <motion.aside
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="thin-scroll h-full w-full max-w-lg overflow-auto border-l border-line bg-paper p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow m-0 text-alert">Why Suraksha checked in</p>
            {detail && <h2 className="display m-0 mt-2 text-[1.6rem] text-ink">{alertTitle(detail.alert)}</h2>}
          </div>
          <button type="button" className="icon-well border border-line bg-card text-ink-soft transition hover:bg-paper-sunk" onClick={onClose}>
            <Cross size={16} />
          </button>
        </div>

        {error && <p className="mt-4 text-sm text-alert">{error}</p>}
        {detail && (
          <div className="mt-7 flex flex-col gap-7">
            <Step n="01" title="What was different from her normal">
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
                {(detail.alert.gate ?? []).map((g, i) => (
                  <li key={i} className="rounded-[12px] bg-paper-sunk px-3.5 py-2.5">
                    <span className="text-ink">{g.code.replace(/_/g, " ")}</span>
                    <span className="eyebrow-sm ml-2 text-ink-faint">{g.level}</span>
                    {g.detail ? (
                      <span className="tnum mt-1 block text-xs text-ink-faint">{JSON.stringify(g.detail)}</span>
                    ) : null}
                  </li>
                ))}
                <li className="text-xs text-ink-faint">
                  Her usual wake window: {detail.baseline.wake_window[0]}–{detail.baseline.wake_window[1]}
                </li>
              </ul>
            </Step>

            <Step n="02" title="What the judge concluded">
              {j ? (
                <div className="rounded-[12px] bg-calm-wash px-4 py-3.5 text-sm">
                  <div className="flex items-center gap-4">
                    <Meter label="severity" value={j.severity} />
                    <Meter label="confidence" value={`${Math.round(j.confidence * 100)}%`} />
                  </div>
                  <ul className="m-0 mt-3 flex list-none flex-col gap-1 p-0 text-ink-soft">
                    {j.reasons.map((r, i) => (
                      <li key={i}>· {r}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="m-0 text-sm text-ink-soft">Suraksha asked her first — no judgement was needed yet.</p>
              )}
              {detail.parent_words_note && (
                <p className="m-0 mt-3 flex items-center gap-2 text-sm text-ink-faint">
                  <Lock size={15} />
                  {detail.parent_words_note}
                </p>
              )}
            </Step>

            <Step n="03" title="Who Suraksha contacted, and why it was allowed">
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
                {detail.consent_decisions.length === 0 && <li className="text-ink-faint">No one was contacted.</li>}
                {detail.consent_decisions.map((d, i) => (
                  <li
                    key={i}
                    className={cn(
                      "flex items-start gap-2.5 rounded-[12px] px-3.5 py-2.5",
                      d.decision === "allow" ? "bg-ok-wash" : "bg-alert-wash",
                    )}
                  >
                    <span className={d.decision === "allow" ? "mt-0.5 text-ok" : "mt-0.5 text-alert"}>
                      {d.decision === "allow" ? <Check size={15} /> : <Cross size={15} />}
                    </span>
                    <span>
                      <span className="block text-ink">
                        {d.principal_id} · {d.action.replace(/_/g, " ")} ({d.topic})
                      </span>
                      <span className="block text-xs text-ink-faint">{d.reason}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Step>

            {detail.alert.resolution && (
              <p className="m-0 flex items-center gap-2 border-t border-line pt-5 text-sm text-ok">
                <Heart size={15} />
                Resolved: {detail.alert.resolution.replace(/_/g, " ")}
              </p>
            )}
          </div>
        )}
      </motion.aside>
    </motion.div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="eyebrow m-0 flex items-center gap-2 text-ink-faint">
        <span className="tnum text-alert">{n}</span>
        {title}
      </p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Meter({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col">
      <span className="eyebrow-sm text-ink-faint">{label}</span>
      <span className="mt-0.5 text-[1.05rem] font-semibold capitalize text-ink">{value}</span>
    </span>
  );
}
