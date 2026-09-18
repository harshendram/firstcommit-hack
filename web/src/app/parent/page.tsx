"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { ShieldGlyph } from "@/components/landing/BrandMark";
import { Check, Cross, Eye, Mic, Speaker, MESSAGE_ICONS } from "@/components/ui/Icon";
import { AppHeader, AppShell, Banner, PillLink } from "@/components/ui/Shell";
import { useSurakshaState } from "@/hooks/useSurakshaState";
import { useProactive } from "@/hooks/useProactive";
import { api } from "@/lib/api";
import type { SurakshaLanguage, ProactiveMessage } from "@/lib/surakshaTypes";
import { t } from "@/lib/i18n";
import { enablePush, pushStatus } from "@/lib/push";
import { startWavRecorder, type WavRecorder } from "@/lib/recordWav";
import { cn } from "@/lib/utils";

const MAX_CLIP_MS = 10_000;

export default function ParentPage() {
  return <AuthGate>{() => <Companion />}</AuthGate>;
}

function Companion() {
  const { state, connected, lastError, lastSay, lastTts, setLastTts, lastSttEmpty, busy, send, refresh } = useSurakshaState({
    speak: true,
  });
  const lang: SurakshaLanguage = state.language ?? "hi-IN";
  const [unlocked, setUnlocked] = useState(false);
  const [blockedAudio, setBlockedAudio] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recRef = useRef<WavRecorder | null>(null);
  const stopTimer = useRef<number | undefined>(undefined);
  const endRef = useRef<HTMLDivElement | null>(null);

  const play = useCallback((src: string) => {
    const el = audioRef.current ?? new Audio();
    audioRef.current = el;
    el.src = src;
    el.play().then(
      () => setBlockedAudio(null),
      () => setBlockedAudio(src),
    );
  }, []);

  const chime = useCallback(() => {
    try {
      const ctx = new AudioContext();
      [660, 880].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + i * 0.18 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.4);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.18);
        osc.stop(ctx.currentTime + i * 0.18 + 0.45);
      });
    } catch {
      /* no audio context */
    }
  }, []);

  const { messages, dismiss } = useProactive(
    useCallback(
      (msg: ProactiveMessage) => {
        chime();
        void refresh();
        const language = (msg.data?.language as SurakshaLanguage | undefined) ?? lang;
        void api<{ audio_base64: string; mime_type: string }>("/suraksha/tts", {
          method: "POST",
          json: { text: msg.body, language },
        })
          .then((tts) => play(`data:${tts.mime_type};base64,${tts.audio_base64}`))
          .catch(() => undefined);
      },
      [chime, lang, play, refresh],
    ),
  );

  useEffect(() => {
    if (!lastTts?.audio_base64) return;
    play(`data:${lastTts.mime_type};base64,${lastTts.audio_base64}`);
    setLastTts(null);
  }, [lastTts, play, setLastTts]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [state.transcript.length, lastSay, messages.length]);

  useEffect(() => {
    if (lastSttEmpty) setMicError(t("notHeard", lang));
  }, [lastSttEmpty, lang]);

  const unlock = async () => {
    setUnlocked(true);
    if ((await pushStatus()) === "prompt") await enablePush().catch(() => undefined);
  };

  const stopRecording = useCallback(async () => {
    window.clearTimeout(stopTimer.current);
    const rec = recRef.current;
    recRef.current = null;
    setRecording(false);
    if (!rec) return;
    try {
      const clip = await rec.stop();
      await send({ type: "parent_audio", audio_base64: clip.audio_base64, mime_type: clip.mime_type });
    } catch {
      setMicError(t("notHeard", lang));
    }
  }, [lang, send]);

  const toggleMic = async () => {
    setMicError(null);
    if (recording) return stopRecording();
    try {
      recRef.current = await startWavRecorder();
      setRecording(true);
      stopTimer.current = window.setTimeout(() => void stopRecording(), MAX_CLIP_MS);
    } catch {
      setMicError(t("micBlocked", lang));
    }
  };

  const pending = state.pending_rule;
  const answerRule = async (yes: boolean) => {
    if (!pending) return;
    await api(`/suraksha/parent/consent/${pending.id}/confirm`, { method: "POST", json: { yes } }).catch(() => undefined);
    await refresh();
  };

  const answerNeighbour = async (msg: ProactiveMessage, confirm: boolean) => {
    await api(`/suraksha/escalations/${msg.data?.esc_id}/neighbour`, {
      method: "POST",
      json: { decision: confirm ? "confirm" : "deny" },
    }).catch(() => undefined);
    await dismiss(msg.id);
    await refresh();
  };

  if (!unlocked) {
    return (
      <AppShell width="narrow" className="items-center justify-center text-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col items-center gap-7"
        >
          <span className="text-alert">
            <ShieldGlyph size={56} />
          </span>
          <div>
            <p className="eyebrow m-0 text-ink-faint">{t("goodMorning", lang)}</p>
            <h1 className="display m-0 mt-3 text-[clamp(2.4rem,9vw,3.4rem)] text-ink">{state.parent_name}</h1>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => void unlock()}
          >
            {t("startAlly", lang)}
          </button>
          <p className="m-0 max-w-[26ch] text-[1.02rem] leading-relaxed text-ink-soft">{t("startHint", lang)}</p>
        </motion.div>
      </AppShell>
    );
  }

  return (
    <AppShell width="narrow">
      <AppHeader
        label={`${state.parent_name} · Suraksha`}
        live={connected}
        liveText={["Suraksha is here", "Reconnecting…"]}
        actions={
          <PillLink href="/parent/privacy">
            <Eye size={13} />
            {t("privacy", lang)}
          </PillLink>
        }
      />

      {(lastError || micError) && (
        <Banner tone="alert">
          <span className="text-[1.02rem] leading-snug">{micError || lastError}</span>
        </Banner>
      )}

      {blockedAudio && (
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => play(blockedAudio)}
        >
          <Speaker size={18} />
          {t("tapToHear", lang)}
        </button>
      )}

      <AnimatePresence initial={false}>
        {messages.map((msg) => (
          <MessageCard
            key={msg.id}
            msg={msg}
            lang={lang}
            onDismiss={() => void dismiss(msg.id)}
            onOkay={async () => {
              await send({ type: "im_okay" });
              await dismiss(msg.id);
            }}
            onNeighbour={(yes) => void answerNeighbour(msg, yes)}
          />
        ))}

        {pending && (
          <motion.section
            key="pending-rule"
            layout
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="panel p-5"
          >
            <p className="eyebrow m-0 flex items-center gap-2 text-alert">
              <ShieldGlyph size={15} />
              {t("yourRules", lang)}
            </p>
            <p className="m-0 mt-3 text-[1.4rem] leading-snug text-ink">
              {lang === "hi-IN" ? pending.description_hi : pending.description}
            </p>
            <p className="m-0 mt-2 text-[1.05rem] text-ink-soft">{t("confirmRule", lang)}</p>
            <div className="mt-5 flex gap-3">
              <BigButton tone="primary" onClick={() => void answerRule(true)} icon={<Check size={20} />}>
                {t("yes", lang)}
              </BigButton>
              <BigButton tone="quiet" onClick={() => void answerRule(false)} icon={<Cross size={20} />}>
                {t("no", lang)}
              </BigButton>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <section className="panel flex min-h-[38vh] flex-1 flex-col gap-3 p-5">
        <div className="thin-scroll flex flex-1 flex-col gap-3 overflow-auto">
          {state.transcript.length === 0 && (
            <p className="m-0 my-auto text-center text-[1.05rem] text-ink-faint">
              {lang === "hi-IN" ? "जो मन में हो, कहिए।" : "Say whatever's on your mind."}
            </p>
          )}
          {state.transcript.map((turn, i) => (
            <motion.div
              key={`${turn.at}-${i}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className={cn(
                "bubble text-[1.28rem] leading-snug",
                turn.speaker === "ally" ? "bubble-ai" : "bubble-user",
              )}
            >
              {turn.text}
            </motion.div>
          ))}
          {busy && (
            <span className="flex items-center gap-2 self-start px-1 text-[1rem] text-ink-faint">
              <Dots /> {t("thinking", lang)}
            </span>
          )}
          <div ref={endRef} />
        </div>
      </section>

      <div className="flex flex-col gap-3 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => void toggleMic()}
          disabled={busy && !recording}
          className={cn(
            "btn btn-block btn-lg relative overflow-hidden",
            recording ? "btn-alert" : "btn-primary",
          )}
        >
          {recording && <span className="absolute inset-0 animate-pulse bg-white/10" aria-hidden />}
          <Mic size={26} />
          {recording ? t("listening", lang) : t("talk", lang)}
        </button>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            void send({ type: "parent_text", text: text.trim() });
            setText("");
          }}
        >
          <input
            className="field field-lg flex-1"
            placeholder={t("typeHere", lang)}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            type="submit"
            className="btn btn-ghost"
            disabled={busy}
          >
            {t("send", lang)}
          </button>
        </form>
      </div>
    </AppShell>
  );
}

function Dots() {
  return (
    <span className="flex gap-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-ink-faint"
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
        />
      ))}
    </span>
  );
}

function BigButton({
  children,
  onClick,
  tone,
  icon,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone: "primary" | "quiet";
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "btn flex-1",
        tone === "primary" ? "btn-primary" : "btn-ghost",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function MessageCard({
  msg,
  lang,
  onDismiss,
  onOkay,
  onNeighbour,
}: {
  msg: ProactiveMessage;
  lang: SurakshaLanguage;
  onDismiss: () => void;
  onOkay: () => void;
  onNeighbour: (yes: boolean) => void;
}) {
  const Icon = MESSAGE_ICONS[msg.kind] ?? MESSAGE_ICONS.family_update;
  const label =
    msg.kind === "morning"
      ? t("goodMorning", lang)
      : msg.kind === "reminder"
        ? t("reminder", lang)
        : msg.kind === "investigation"
          ? t("checkingIn", lang)
          : msg.kind === "neighbour_question"
            ? t("question", lang)
            : msg.kind === "family_note"
              ? t("noteFromFamily", lang)
              : t("update", lang);
  const asking = msg.kind === "investigation" || msg.kind === "neighbour_question";
  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={cn("panel p-5", asking ? "border-warn/45 bg-warn-wash" : "")}
      aria-live="polite"
    >
      <p className={cn("eyebrow m-0 flex items-center gap-2", asking ? "text-warn" : "text-ink-faint")}>
        <Icon size={15} />
        {label}
      </p>
      <p className="m-0 mt-3 text-[1.5rem] leading-snug text-ink">{msg.body}</p>
      <div className="mt-5 flex gap-3">
        {msg.kind === "investigation" && (
          <BigButton tone="primary" onClick={onOkay} icon={<Check size={20} />}>
            {t("imOkay", lang)}
          </BigButton>
        )}
        {msg.kind === "neighbour_question" ? (
          <>
            <BigButton tone="primary" onClick={() => onNeighbour(true)} icon={<Check size={20} />}>
              {t("yes", lang)}
            </BigButton>
            <BigButton tone="quiet" onClick={() => onNeighbour(false)} icon={<Cross size={20} />}>
              {t("no", lang)}
            </BigButton>
          </>
        ) : (
          <BigButton tone="quiet" onClick={onDismiss}>
            {msg.kind === "reminder" ? t("done", lang) : t("okay", lang)}
          </BigButton>
        )}
      </div>
    </motion.section>
  );
}
