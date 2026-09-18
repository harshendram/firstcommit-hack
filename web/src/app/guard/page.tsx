"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Check, Lock, Phone, PhoneDown } from "@/components/ui/Icon";
import { AppShell, Banner } from "@/components/ui/Shell";
import { surakshaApiUrl } from "@/lib/surakshaTypes";
import { cn } from "@/lib/utils";

/**
 * The guard's handset.
 *
 * Ramesh has no app and no login. This is the phone at the gate: it sits dark and quiet, and when
 * Suraksha escalates a fall to him it rings like a call — because a notification he has to read is not
 * how you reach somebody who needs to start walking.
 *
 * The device key stays on the phone (?key=… once), exactly as the watch holds one.
 */

interface GuardCall {
  ringing: boolean;
  escalation_id?: string;
  reply_token?: string;
  caller?: string;
  subject?: string;
  guard_name?: string;
  address?: string;
  facts?: string[];
  say?: string;
  withheld?: string[];
  emergency_number?: string;
  tts?: { audio_base64: string; mime_type: string };
}

type Phase = "idle" | "ringing" | "connected" | "answered" | "declined";
/** One member per kind: a union discriminant cannot be narrowed if it is itself a union. */
type Outcome =
  | { kind: "going" }
  | { kind: "declined" }
  | { kind: "taken"; message: string }
  | { kind: "expired"; message: string }
  | { kind: "offline"; message: string };

export default function GuardHandsetPage() {
  const [key, setKey] = useState("");
  const [call, setCall] = useState<GuardCall | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [armed, setArmed] = useState(false);
  const ring = useRef<Ringer | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);

  const armAudio = useCallback(() => {
    try {
      if (!audioCtx.current) {
        const Ctx =
          window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtx.current = new Ctx();
      }
      void audioCtx.current.resume();
      blip(audioCtx.current);
      navigator.vibrate?.(40);
    } catch {
      /* silent ring; the screen and the buzz still work */
    }
    setArmed(true);
  }, []);

  useEffect(() => {
    const fromUrl = new URL(window.location.href).searchParams.get("key") ?? "";
    const saved = fromUrl || window.localStorage.getItem("suraksha.guardKey") || "";
    if (saved) window.localStorage.setItem("suraksha.guardKey", saved);
    setKey(saved);
  }, []);

  // The handset asks; nothing is pushed. No login, no notification permission — the two things that
  // break on a borrowed phone. Polling continues through the call so the reply token stays fresh.
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`${surakshaApiUrl()}/suraksha/guard/call`, { headers: { "x-suraksha-device-key": key } });
        if (!alive || !res.ok) return;
        const body = (await res.json()) as GuardCall;
        if (!alive) return;
        if (body.ringing) {
          setCall(body);
          setPhase((p) => (p === "idle" || p === "declined" ? "ringing" : p));
        } else {
          setPhase((p) => (p === "ringing" ? "idle" : p));
        }
      } catch {
        /* the handset just keeps asking */
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 2500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [key]);

  useEffect(() => {
    if (phase !== "ringing") {
      ring.current?.stop();
      ring.current = null;
      return;
    }
    ring.current = new Ringer(audioCtx.current);
    ring.current.start();
    const buzz = window.setInterval(() => navigator.vibrate?.([600, 400]), 1000);
    return () => {
      ring.current?.stop();
      ring.current = null;
      window.clearInterval(buzz);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "connected" && phase !== "answered") return;
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  /** Tell Suraksha, and say plainly what came back — silence here is how a stale call looks like success. */
  const reply = useCallback(
    async (decision: "accept" | "decline"): Promise<Outcome> => {
      if (!call?.reply_token) return { kind: "offline", message: "This call is no longer active." };
      try {
        const res = await fetch(`${surakshaApiUrl()}/suraksha/escalations/reply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reply_token: call.reply_token, decision }),
        });
        if (res.ok) return { kind: decision === "accept" ? "going" : "declined" };
        const body = await res.json().catch(() => ({}) as { message?: string });
        if (res.status === 409) return { kind: "taken", message: body.message ?? "Suraksha has already asked someone else." };
        if (res.status === 403) return { kind: "expired", message: body.message ?? "This call has expired." };
        return { kind: "offline", message: body.message ?? "Could not reach Suraksha." };
      } catch {
        return { kind: "offline", message: "Could not reach Suraksha. Check the connection." };
      }
    },
    [call],
  );

  const answer = async () => {
    setSeconds(0);
    setOutcome(null);
    setPhase("connected");
    navigator.vibrate?.(30);
    // Suraksha's voice is synthesised on pick-up, not on every poll — a poll that speaks costs ten
    // seconds and leaves the handset behind the escalation it is supposed to be answering.
    let clip = call?.tts;
    if (!clip) {
      try {
        const res = await fetch(`${surakshaApiUrl()}/suraksha/guard/call?speak=true`, {
          headers: { "x-suraksha-device-key": key },
        });
        if (res.ok) {
          const spoken = (await res.json()) as GuardCall;
          if (spoken.ringing) {
            setCall(spoken);
            clip = spoken.tts;
          }
        }
      } catch {
        /* he reads it instead */
      }
    }
    if (!clip?.audio_base64) {
      setPhase("answered");
      return;
    }
    try {
      const audio = new Audio(`data:${clip.mime_type ?? "audio/mpeg"};base64,${clip.audio_base64}`);
      audio.onended = () => setPhase("answered");
      await audio.play();
    } catch {
      setPhase("answered");
    }
  };

  const respond = async (decision: "accept" | "decline") => {
    setSending(true);
    const result = await reply(decision);
    setSending(false);
    setOutcome(result);
    if (result.kind === "declined") window.setTimeout(() => setPhase("idle"), 1800);
  };

  if (!key) {
    return (
      <KeyPrompt
        onSet={(k) => {
          armAudio();
          window.localStorage.setItem("suraksha.guardKey", k);
          setKey(k);
        }}
      />
    );
  }

  const live = phase === "connected" || phase === "answered";
  const settled = outcome?.kind === "going" || outcome?.kind === "declined";

  return (
    <div className="call-screen min-h-dvh">
      <AppShell width="phone" flush className="bg-transparent">
        {phase === "idle" || phase === "declined" ? (
          <Idle declined={phase === "declined"} armed={armed} onArm={armAudio} />
        ) : (
          <div className="flex flex-1 flex-col">
            <header className="flex flex-col items-center gap-2 pt-4 text-center">
              <p className="eyebrow m-0 text-white/45">{live ? formatClock(seconds) : "Incoming call"}</p>
              <h1 className="m-0 text-[clamp(1.9rem,8vw,2.4rem)] font-semibold leading-tight">
                {call?.caller ?? "Suraksha"}
              </h1>
              <p className="m-0 text-[1.02rem] text-white/70">
                {call?.subject ? `${call.subject} · emergency` : "emergency"}
              </p>
              {call?.address && <p className="m-0 text-sm text-white/55">{call.address}</p>}
            </header>

            <div className="flex justify-center py-8">
              <div className={cn("call-avatar relative", phase !== "ringing" && "is-quiet")}>
                {(call?.subject ?? "A").slice(0, 1)}
              </div>
            </div>

            {live && (
              <section className="call-card p-5 text-left">
                {phase === "connected" && (
                  <p className="m-0 mb-3 flex items-center gap-2 text-sm text-white/70">
                    <span className="pulse-dot text-emerald-300" />
                    Suraksha is speaking…
                  </p>
                )}
                <p className="m-0 text-[1.02rem] leading-relaxed">{call?.say}</p>

                {call?.facts && call.facts.length > 0 && (
                  <ul className="m-0 mt-4 flex list-none flex-col gap-1.5 border-t border-white/10 p-0 pt-4 text-sm text-white/65">
                    {call.facts.map((fact) => (
                      <li key={fact}>{fact}</li>
                    ))}
                  </ul>
                )}

                {call?.withheld?.map((line) => (
                  <p key={line} className="m-0 mt-3 flex items-start gap-2 text-xs text-white/40">
                    <Lock size={13} />
                    {line}
                  </p>
                ))}

                <p className="m-0 mt-4 text-sm text-white/50">
                  Emergency: <strong className="text-white">{call?.emergency_number ?? "112"}</strong>
                </p>
              </section>
            )}

            <div className="mt-auto flex flex-col gap-4 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {outcome?.kind === "going" && (
                <Banner tone="ok">
                  <span>You&apos;re going. {call?.subject ?? "She"} has been told.</span>
                </Banner>
              )}
              {outcome && outcome.kind !== "going" && outcome.kind !== "declined" && (
                <Banner tone="alert">
                  <span>{outcome.message}</span>
                </Banner>
              )}

              {!settled && (
                <div className="flex items-start justify-around">
                  {phase === "ringing" ? (
                    <>
                      <CallKey tone="end" label="Decline" onClick={() => void respond("decline")} disabled={sending} />
                      <CallKey tone="answer" label="Answer" onClick={() => void answer()} />
                    </>
                  ) : (
                    <>
                      <CallKey tone="end" label="Can't go" onClick={() => void respond("decline")} disabled={sending} />
                      <CallKey
                        tone="answer"
                        label={sending ? "Telling Suraksha…" : "I'm going"}
                        onClick={() => void respond("accept")}
                        disabled={sending}
                      />
                    </>
                  )}
                </div>
              )}

              {outcome?.kind === "going" && (
                <p className="m-0 flex items-center justify-center gap-2 text-sm text-white/60">
                  <Check size={16} />
                  Suraksha has stopped calling anyone else.
                </p>
              )}
            </div>
          </div>
        )}
      </AppShell>
    </div>
  );
}

function Idle({ declined, armed, onArm }: { declined: boolean; armed: boolean; onArm: () => void }) {
  // The whole screen is the button: a guard phone should not need aim.
  return (
    <button
      type="button"
      onClick={onArm}
      className="flex flex-1 cursor-pointer flex-col items-center justify-center gap-3 border-none bg-transparent text-center"
    >
      <span className={cn("h-16 w-16 rounded-full border", armed ? "border-emerald-400/60" : "border-white/15")} />
      <span className="text-lg text-white/75">{declined ? "Suraksha will ask someone else" : "Gate handset"}</span>
      {armed ? (
        <span className="flex items-center gap-2 text-sm text-emerald-300">
          <span className="pulse-dot" />
          Ready — this phone will ring
        </span>
      ) : (
        <span className="flex items-center gap-2 text-sm text-amber-300">
          <Alert size={15} />
          Tap anywhere once to let it ring
        </span>
      )}
      <span className="text-xs text-white/30">Quiet. It rings only if someone needs help.</span>
    </button>
  );
}

function KeyPrompt({ onSet }: { onSet: (key: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="call-screen min-h-dvh">
      <AppShell width="phone" flush className="bg-transparent">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <Phone size={28} />
          <h1 className="m-0 text-xl font-semibold">Gate handset</h1>
          <p className="m-0 max-w-xs text-sm text-white/50">
            Paste the device key once. It stays on this phone and never leaves it.
          </p>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full max-w-sm rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-white outline-none"
            placeholder="device key"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => value.trim() && onSet(value.trim())}
            className="call-key call-key-answer px-6 py-3 font-semibold"
            style={{ width: "auto", height: "auto", borderRadius: 14 }}
          >
            Use this phone
          </button>
        </div>
      </AppShell>
    </div>
  );
}

function CallKey({
  tone,
  label,
  onClick,
  disabled,
}: {
  tone: "answer" | "end";
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex w-28 flex-col items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={cn("call-key", tone === "answer" ? "call-key-answer" : "call-key-end")}
      >
        {tone === "answer" ? <Phone size={26} /> : <PhoneDown size={26} />}
      </button>
      <span className="text-center text-sm text-white/70">{label}</span>
    </div>
  );
}

function formatClock(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** A short blip, so the person holding the phone knows sound is allowed. */
function blip(ctx: AudioContext) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 660;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.3);
}

/** A ringtone made in the browser: two tones, on and off, so there is no audio file to ship. */
class Ringer {
  private timer: number | null = null;

  constructor(private ctx: AudioContext | null) {}

  start() {
    if (!this.ctx) return;
    void this.ctx.resume();
    const burst = () => {
      if (!this.ctx) return;
      [440, 480].forEach((freq) => {
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, this.ctx!.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.25, this.ctx!.currentTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx!.currentTime + 1.6);
        osc.connect(gain).connect(this.ctx!.destination);
        osc.start();
        osc.stop(this.ctx!.currentTime + 1.7);
      });
    };
    burst();
    this.timer = window.setInterval(burst, 3000);
  }

  stop() {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null; // the context is shared and stays alive for the next call
  }
}
