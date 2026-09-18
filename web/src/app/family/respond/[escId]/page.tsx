"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { ShieldGlyph } from "@/components/landing/BrandMark";
import { Alert, ArrowRight, Check, Clock, Cross, Heart, Lock, People } from "@/components/ui/Icon";
import { AppHeader, AppShell, Banner, PillLink } from "@/components/ui/Shell";
import { ApiError, api } from "@/lib/api";
import type { SurakshaState, Escalation, HandoffNote } from "@/lib/surakshaTypes";
import type { Viewer } from "@/lib/amplify";
import { cn } from "@/lib/utils";

export default function RespondPage({ params }: { params: Promise<{ escId: string }> }) {
  const { escId } = use(params);
  return <AuthGate>{(viewer) => <Respond escId={escId} viewer={viewer} />}</AuthGate>;
}

function Respond({ escId, viewer }: { escId: string; viewer: Viewer }) {
  const [esc, setEsc] = useState<Escalation | null>(null);
  const [state, setState] = useState<SurakshaState | null>(null);
  const [note, setNote] = useState<HandoffNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    // The handoff is loaded beside the rest: if Amma's rules leave nothing to show, the page
    // still works and simply has no card.
    const [e, s, h] = await Promise.allSettled([
      api<Escalation>(`/suraksha/escalations/${escId}`),
      api<SurakshaState>("/suraksha/state"),
      api<HandoffNote>(`/suraksha/escalations/${escId}/handoff`),
    ]);
    if (e.status === "fulfilled") setEsc(e.value);
    if (s.status === "fulfilled") setState(s.value);
    setNote(h.status === "fulfilled" ? h.value : null);
    if (e.status === "rejected") {
      setError(e.reason instanceof ApiError ? e.reason.message : "Could not load.");
    } else {
      setError(null);
    }
  }, [escId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [load]);

  const reply = async (decision: "accept" | "decline" | "arrived") => {
    setBusy(true);
    setError(null);
    try {
      await api(`/suraksha/escalations/${escId}/reply`, { method: "POST", json: { decision } });
      navigator.vibrate?.([40, 30, 80]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send.");
    } finally {
      setBusy(false);
      void load();
    }
  };

  const name = state?.parent_name ?? "Amma";
  const askingMe = esc?.current_contact === viewer.memberId && esc?.status === "asking";
  const iAmGoing = esc?.responder === viewer.memberId && esc?.status === "accepted";
  const resolved = esc?.status === "resolved" || esc?.status === "stopped";
  const someoneElse = Boolean(esc?.responder && esc.responder !== viewer.memberId);

  const headline = resolved
    ? esc?.status === "stopped"
      ? `${name} says she's okay`
      : `You're with ${name} now`
    : askingMe
      ? `Can you check on ${name}?`
      : iAmGoing
        ? `${name} knows you're coming`
        : someoneElse
          ? "Someone is on the way"
          : state?.tier_narration ?? "Loading…";

  return (
    <div className={cn("min-h-dvh", resolved ? "bg-ok-wash" : askingMe ? "bg-warn-wash" : "bg-paper")}>
      <AppShell width="phone" flush>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-1 flex-col"
        >
          <AppHeader
            label="Suraksha · family"
            actions={
              <PillLink href="/home">
                Dashboard
                <ArrowRight size={13} />
              </PillLink>
            }
          />

          <p className={cn("eyebrow m-0 mt-2 flex items-center gap-2", resolved ? "text-ok" : askingMe ? "text-warn" : "text-alert")}>
            {resolved ? <Heart size={14} /> : askingMe ? <Alert size={14} /> : <ShieldGlyph size={14} />}
            {resolved ? "Closed" : askingMe ? "Needs you" : "In progress"}
          </p>
          <h1 className="display m-0 mt-3 text-[clamp(2.1rem,9vw,2.9rem)] leading-[1.03] text-ink">{headline}</h1>

          {state?.last_decision?.summary && (
            <p className="m-0 mt-4 text-[1.08rem] leading-relaxed text-ink-soft">{state.last_decision.summary}</p>
          )}

          {note && note.facts.length > 0 && !resolved && (
            <section className="panel mt-7 p-5">
              <div className="flex items-center gap-2 text-ink-faint">
                <Alert size={14} />
                <span className="eyebrow">Before you go in</span>
              </div>
              <p className="m-0 mt-3 text-[1.05rem] font-semibold leading-snug text-ink">{note.headline}</p>
              <p className="m-0 mt-2 text-[0.98rem] leading-relaxed text-ink-soft">{note.what_happened}</p>

              {note.checks.length > 0 && (
                <ul className="m-0 mt-4 flex list-none flex-col gap-2 p-0">
                  {note.checks.map((check) => (
                    <li key={check} className="flex items-start gap-2.5 text-[0.98rem] text-ink">
                      <span className="mt-0.5 text-alert">
                        <Check size={15} />
                      </span>
                      {check}
                    </li>
                  ))}
                </ul>
              )}

              <ul className="m-0 mt-4 flex list-none flex-col gap-1.5 border-t border-line/70 p-0 pt-4">
                {note.facts.map((fact) => (
                  <li key={fact} className="flex items-start gap-2.5 text-sm text-ink-soft">
                    <span className="mt-0.5 shrink-0 text-ink-faint">
                      <Clock size={13} />
                    </span>
                    {fact}
                  </li>
                ))}
              </ul>

              {note.withheld.map((line) => (
                <p key={line} className="m-0 mt-3 flex items-start gap-2 text-sm text-ink-faint">
                  <span className="mt-0.5 shrink-0">
                    <Lock size={13} />
                  </span>
                  {line}
                </p>
              ))}
            </section>
          )}

          {esc && esc.timeline.length > 0 && (
            <ol className="m-0 mt-7 flex list-none flex-col gap-2 border-t border-line/70 p-0 pt-5">
              {esc.timeline.slice(-4).map((ev, i) => (
                <li key={i} className="flex items-center gap-3 text-sm text-ink-soft">
                  <span className="tnum w-12 shrink-0 text-xs text-ink-faint">
                    {new Date(ev.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </span>
                  <People size={14} />
                  {ev.event.replace(/_/g, " ")}
                </li>
              ))}
            </ol>
          )}

          {error && (
            <div className="mt-5">
              <Banner tone="alert">
                <span>{error}</span>
              </Banner>
            </div>
          )}

          <div className="mt-auto flex flex-col gap-3 pt-10 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {askingMe && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void reply("accept")}
                  className="btn btn-primary btn-block btn-lg"
                >
                  <Check size={20} />I can go
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void reply("decline")}
                  className="btn btn-ghost btn-block btn-lg"
                >
                  <Cross size={20} />
                  Can&apos;t right now
                </button>
              </>
            )}
            {iAmGoing && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void reply("arrived")}
                className="btn btn-ok btn-block btn-lg"
              >
                <Heart size={20} />
                I&apos;ve arrived
              </button>
            )}
            <p className="m-0 text-center text-sm text-ink-faint">
              Urgent? Call <strong className="text-ink">112</strong>.
            </p>
            <Link href="/home" className="nav-link flex items-center justify-center gap-1.5">
              Open family dashboard
              <ArrowRight size={14} />
            </Link>
          </div>
        </motion.div>
      </AppShell>
    </div>
  );
}
