import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useRakshakSocket } from "../hooks/useRakshakSocket";
import { StateBadge } from "../components/StateBadge";
import type { TriggerType } from "../types";
import { cn } from "../lib/utils";

const TRIGGERS: { type: TriggerType; label: string; hint: string }[] = [
  { type: "manual_tap", label: "Manual tap", hint: "Watch SOS button" },
  { type: "voice_distress", label: "Voice distress", hint: "Spoken phrase" },
  { type: "simulated_fall", label: "Simulated fall", hint: "Fall detection" },
];

const SCENARIOS = [
  { label: "Mild dizziness", text: "I feel a little dizzy but I think I'm okay." },
  {
    label: "Can't get up",
    text: "I fell and I can't get up. My hip hurts badly.",
  },
  {
    label: "Chest pain",
    text: "There's a tight pain in my chest and it's hard to breathe.",
  },
  {
    label: "Confused",
    text: "I don't know where I am... everything feels strange...",
  },
];

export function PatientSimulator() {
  const { session, connected, lastTts, send, setLastTts, lastError } =
    useRakshakSocket("patient");
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Play TTS when received
  useEffect(() => {
    if (!lastTts?.audio_base64) return;
    const mime = lastTts.mime_type || "audio/wav";
    const src = `data:${mime};base64,${lastTts.audio_base64}`;
    const audio = new Audio(src);
    audioRef.current = audio;
    void audio.play().catch(() => {
      /* autoplay may be blocked — text still visible */
    });
    setLastTts(null);
  }, [lastTts, setLastTts]);

  const active = session.state !== "idle" && session.state !== "resolved";

  const submitText = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    send({ type: "patient_text", text: trimmed });
    setText("");
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : undefined,
      });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]!);
        }
        const audio_base64 = btoa(binary);
        send({
          type: "patient_audio",
          audio_base64,
          mime_type: blob.type || "audio/webm",
        });
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      alert("Microphone permission denied or unavailable.");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink-50">Patient Simulator</h1>
          <p className="text-xs text-ink-400">
            Demo trigger + conversation surface ·{" "}
            <span className={connected ? "text-ok-500" : "text-alert-400"}>
              {connected ? "connected" : "reconnecting…"}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StateBadge state={session.state} />
          <Link
            to="/"
            className="rounded-lg bg-ink-800 px-3 py-1.5 text-xs font-medium text-accent-400 ring-1 ring-ink-600"
          >
            ← Command Center
          </Link>
        </div>
      </header>

      {lastError && (
        <div className="rounded-lg bg-alert-500/10 px-3 py-2 text-sm text-alert-400 ring-1 ring-alert-500/30">
          {lastError}
        </div>
      )}

      {/* Triggers */}
      <section className="rounded-xl border border-ink-700/80 bg-ink-900/60 p-4">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-ink-200 uppercase">
          Trigger
        </h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {TRIGGERS.map((t) => (
            <button
              key={t.type}
              type="button"
              disabled={!connected}
              onClick={() => send({ type: "trigger", trigger_type: t.type })}
              className="rounded-xl bg-alert-500/15 px-3 py-4 text-left ring-1 ring-alert-500/40 transition hover:bg-alert-500/25 disabled:opacity-40"
            >
              <div className="font-semibold text-alert-400">{t.label}</div>
              <div className="mt-1 text-xs text-ink-400">{t.hint}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Conversation */}
      <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-ink-700/80 bg-ink-900/60 p-4">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-ink-200 uppercase">
          Conversation
        </h2>
        <div className="mb-3 max-h-56 flex-1 space-y-2 overflow-y-auto transcript-scroll">
          {session.transcript.length === 0 && (
            <p className="text-sm text-ink-500 italic">
              Fire a trigger, then speak or type as the patient.
            </p>
          )}
          {session.transcript.map((t, i) => (
            <div
              key={`${t.timestamp}-${i}`}
              className={cn(
                "rounded-lg px-3 py-2 text-sm",
                t.speaker === "ai"
                  ? "bg-accent-500/10 text-ink-50"
                  : "bg-ink-800 text-ink-100"
              )}
            >
              <span className="mr-2 text-[10px] font-bold tracking-wider uppercase opacity-60">
                {t.speaker === "ai" ? "AI" : "You"}
              </span>
              {t.text}
            </div>
          ))}
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          {SCENARIOS.map((s) => (
            <button
              key={s.label}
              type="button"
              disabled={!active}
              onClick={() => submitText(s.text)}
              className="rounded-full bg-ink-800 px-3 py-1 text-xs text-ink-200 ring-1 ring-ink-600 hover:bg-ink-700 disabled:opacity-40"
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
              if (e.key === "Enter") submitText(text);
            }}
            disabled={!active}
            placeholder={
              active
                ? "Type as the patient…"
                : "Trigger an emergency first"
            }
            className="flex-1 rounded-lg border border-ink-600 bg-ink-950 px-3 py-2 text-sm text-ink-50 outline-none focus:border-accent-500 disabled:opacity-40"
          />
          <button
            type="button"
            disabled={!active || !text.trim()}
            onClick={() => submitText(text)}
            className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-ink-950 disabled:opacity-40"
          >
            Send
          </button>
          <button
            type="button"
            disabled={!active}
            onClick={recording ? stopRecording : startRecording}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40",
              recording
                ? "bg-alert-500 text-white"
                : "bg-ink-800 text-ink-100 ring-1 ring-ink-600"
            )}
          >
            {recording ? "Stop" : "Mic"}
          </button>
        </div>
      </section>

      <button
        type="button"
        onClick={() => send({ type: "reset" })}
        className="self-start rounded-lg bg-ink-800 px-3 py-1.5 text-xs text-ink-300 ring-1 ring-ink-600"
      >
        Reset session
      </button>
    </div>
  );
}
