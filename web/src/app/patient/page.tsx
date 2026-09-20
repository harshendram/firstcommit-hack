"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { StateBadge } from "@/components/Badges";
import { Fall, Mic, Speaker, Watch } from "@/components/ui/Icon";
import { AppHeader, AppShell, Banner, PillLink, SectionTitle } from "@/components/ui/Shell";
import { useRakshakSocket } from "@/hooks/useRakshakSocket";
import { startWavRecorder, type WavRecorder } from "@/lib/recordWav";
import { cn } from "@/lib/utils";
import type { TriggerType } from "@/lib/types";

const TRIGGERS: {
  type: TriggerType;
  label: string;
  hint: string;
  Icon: typeof Watch;
}[] = [
  {
    type: "manual_tap",
    label: "Manual tap",
    hint: "Watch SOS button",
    Icon: Watch,
  },
  {
    type: "voice_distress",
    label: "Voice distress",
    hint: "Spoken cry for help",
    Icon: Mic,
  },
  {
    type: "simulated_fall",
    label: "Simulated fall",
    hint: "Fall detection fires",
    Icon: Fall,
  },
];

const SCENARIOS: { label: string; text: string; language: string }[] = [
  {
    label: "Mild dizziness",
    text: "I feel a little dizzy but I think I'm okay.",
    language: "en-IN",
  },
  {
    label: "Can't get up",
    text: "I fell and I can't get up. My hip hurts badly.",
    language: "en-IN",
  },
  {
    label: "Chest pain",
    text: "There's a tight pain in my chest and it's hard to breathe.",
    language: "en-IN",
  },
  {
    label: "Hindi · can't get up",
    text: "मैं गिर गई हूँ, उठ नहीं पा रही। कमर में बहुत दर्द है।",
    language: "hi-IN",
  },
  {
    label: "Code-mix · dizzy",
    text: "Main thoda dizzy feel kar rahi hoon, but I think I'm okay.",
    language: "hi-IN",
  },
  {
    label: "Code-mix · help",
    text: "Please help me, main uth nahi pa rahi, hip mein bahut dard hai.",
    language: "hi-IN",
  },
  {
    label: "Confused",
    text: "I don't know where I am... everything feels strange...",
    language: "en-IN",
  },
  {
    label: "Stay with me",
    text: "Please stay with me, don't go.",
    language: "en-IN",
  },
];

export default function PatientSimulatorPage() {
  const { session, connected, lastTts, setLastTts, send, lastError } =
    useRakshakSocket("patient");
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [thinking, setThinking] = useState(false);
  const recorderRef = useRef<WavRecorder | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const unlockRef = useRef(false);
  const pendingTtsRef = useRef<string | null>(null);

  const active = session.state !== "idle" && session.state !== "resolved";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session.transcript.length]);

  // Clear "thinking" when AI replies or session settles
  useEffect(() => {
    const last = session.transcript[session.transcript.length - 1];
    if (last?.speaker === "ai" || session.state === "idle") {
      setThinking(false);
    }
  }, [session.transcript, session.state]);

  const unlockAudio = useCallback(() => {
    if (unlockRef.current) return;
    const a = audioRef.current ?? new Audio();
    audioRef.current = a;
    a.src =
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
    void a.play().then(() => {
      unlockRef.current = true;
      a.pause();
    }).catch(() => {
      /* gesture may still unlock on next play */
      unlockRef.current = true;
    });
  }, []);

  const playTts = useCallback(async (src: string) => {
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audio.src = src;
    try {
      await audio.play();
      setAudioBlocked(false);
      pendingTtsRef.current = null;
      setLastTts(null);
    } catch {
      pendingTtsRef.current = src;
      setAudioBlocked(true);
    }
  }, [setLastTts]);

  useEffect(() => {
    if (!lastTts?.audio_base64) return;
    const src = `data:${lastTts.mime_type || "audio/wav"};base64,${lastTts.audio_base64}`;
    void playTts(src);
  }, [lastTts, playTts]);

  const submit = useCallback(
    (value: string, language = "en-IN") => {
      const trimmed = value.trim();
      if (!trimmed) return;
      unlockAudio();
      setThinking(true);
      send({ type: "patient_text", text: trimmed, language });
      setText("");
    },
    [send, unlockAudio]
  );

  const fireTrigger = (type: TriggerType) => {
    unlockAudio();
    setThinking(true);
    send({ type: "trigger", trigger_type: type });
  };

  // Amazon Transcribe streaming takes PCM16, so record WAV directly rather than
  // WebM/Opus — it saves a transcode and keeps latency down on the voice turn.
  const startRecording = async () => {
    setMicError(null);
    unlockAudio();
    try {
      recorderRef.current = await startWavRecorder();
      setRecording(true);
    } catch {
      setMicError("Microphone unavailable or permission denied.");
    }
  };

  const stopRecording = async () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setRecording(false);
    if (!recorder) return;
    const clip = await recorder.stop();
    setThinking(true);
    send({
      type: "patient_audio",
      audio_base64: clip.audio_base64,
      mime_type: clip.mime_type,
    });
  };

  return (
    <AppShell width="narrow">
      <AppHeader
        label="Patient device"
        live={connected}
        liveText={["Connected", "Reconnecting"]}
        actions={
          <>
            <StateBadge state={session.state} live />
            <PillLink href="/command">Timeline</PillLink>
          </>
        }
      />

      {(lastError || micError) && (
        <Banner tone="alert">{micError ?? lastError}</Banner>
      )}

      {audioBlocked && (
        <button
          type="button"
          onClick={() => {
            unlockAudio();
            if (pendingTtsRef.current) void playTts(pendingTtsRef.current);
            setAudioBlocked(false);
          }}
          className="btn btn-primary btn-block"
        >
          <Speaker size={16} />
          Tap to hear Suraksha
        </button>
      )}

      {thinking && active && (
        <p className="eyebrow-sm m-0 flex items-center gap-2 text-ink-faint">
          <span className="pulse-dot text-ok" />
          Suraksha is listening / thinking…
        </p>
      )}

      <section className="panel p-6">
        <SectionTitle eyebrow="Simulator" title="Fire a trigger" />
        <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
          {TRIGGERS.map((t) => (
            <motion.button
              key={t.type}
              type="button"
              disabled={!connected || thinking}
              whileTap={{ scale: 0.98 }}
              onClick={() => fireTrigger(t.type)}
              className="list-row flex-col items-start gap-2.5 border-alert/25 bg-alert-wash hover:border-alert/50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="icon-well bg-alert/12 text-alert">
                <t.Icon size={17} />
              </span>
              <span>
                <span className="block text-[0.94rem] font-semibold text-alert">
                  {t.label}
                </span>
                <span className="mt-0.5 block text-[0.8rem] text-ink-soft">
                  {t.hint}
                </span>
              </span>
            </motion.button>
          ))}
        </div>
      </section>

      <section className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="panel-head">
          <h2 className="eyebrow m-0 text-ink-soft">Speak as the patient</h2>
          <span className="chip">{session.transcript.length} turns</span>
        </header>

        <div className="thin-scroll flex max-h-72 min-h-[140px] flex-1 flex-col gap-2.5 overflow-y-auto p-5">
          {session.transcript.length === 0 && (
            <div className="flex flex-1 items-center justify-center">
              <p className="m-0 max-w-[34ch] text-center text-sm text-ink-faint">
                Fire a trigger above, then reply with a scenario chip, your
                keyboard, or the microphone.
              </p>
            </div>
          )}
          {session.transcript.map((turn, i) => (
            <div
              key={`${turn.timestamp}-${i}`}
              className={cn("bubble", turn.speaker === "ai" ? "bubble-ai" : "bubble-user")}
            >
              <span
                className={cn(
                  "eyebrow-sm mb-1 block",
                  turn.speaker === "ai" ? "text-ink" : "text-ink-faint"
                )}
              >
                {turn.speaker === "ai" ? "Suraksha" : "You"}
              </span>
              <p className="m-0 text-[0.92rem] leading-relaxed text-ink">
                {turn.text}
              </p>
            </div>
          ))}
          <div ref={endRef} />
        </div>

        <div className="border-t border-line bg-paper-deep p-4">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {SCENARIOS.map((s) => (
              <button
                key={s.label}
                type="button"
                disabled={!active}
                onClick={() => submit(s.text, s.language)}
                className="chip cursor-pointer hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit(text);
              }}
              disabled={!active}
              placeholder={
                active ? "Type as the patient…" : "Fire a trigger to begin"
              }
              className="field flex-1"
            />
            <button
              type="button"
              disabled={!active || !text.trim()}
              onClick={() => submit(text)}
              className="btn btn-primary"
            >
              Send
            </button>
            <button
              type="button"
              disabled={!active}
              onClick={recording ? stopRecording : startRecording}
              aria-label={recording ? "Stop recording" : "Start speaking"}
              title={recording ? "Stop recording" : "Speak your answer"}
              className={cn(
                "icon-well relative h-[46px] w-[46px] cursor-pointer transition disabled:cursor-not-allowed disabled:opacity-40",
                recording
                  ? "bg-alert text-white"
                  : "border border-line bg-card text-ink-soft hover:border-line-strong hover:text-ink"
              )}
            >
              {recording ? (
                <span className="h-3.5 w-3.5 rounded-[2px] bg-white" />
              ) : (
                <Mic size={18} />
              )}
            </button>
          </div>
        </div>
      </section>

      <button
        type="button"
        onClick={() => {
          setThinking(false);
          send({ type: "reset" });
        }}
        className="chip cursor-pointer self-start hover:text-ink"
      >
        Reset session
      </button>
    </AppShell>
  );
}
