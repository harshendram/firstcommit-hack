"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { EMPTY_SURAKSHA, type SurakshaLanguage, type SurakshaState } from "@/lib/surakshaTypes";

export interface SurakshaTts {
  audio_base64?: string;
  mime_type: string;
  text: string;
}

interface TurnResponse {
  say?: string | null;
  language?: SurakshaLanguage;
  stt_empty?: boolean;
  transcript_in?: string;
  state?: SurakshaState;
}

const POLL_MS = 3000;

/** Polling replacement for the old WebSocket hook. Same return shape; `send` is now async REST. */
export function useSurakshaState(options: { speak?: boolean } = {}) {
  const [state, setState] = useState<SurakshaState>(EMPTY_SURAKSHA);
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastSay, setLastSay] = useState<string | null>(null);
  const [lastTts, setLastTts] = useState<SurakshaTts | null>(null);
  const [lastSttEmpty, setLastSttEmpty] = useState(0);
  const [lastTranscriptIn, setLastTranscriptIn] = useState("");
  const [busy, setBusy] = useState(false);
  const speak = options.speak ?? false;
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      setState(await api<SurakshaState>("/suraksha/state"));
      setConnected(true);
      setLastError(null);
    } catch (err) {
      setConnected(false);
      setLastError(err instanceof ApiError ? err.message : "Can't reach Suraksha.");
    } finally {
      inflight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    const onSw = (event: MessageEvent) => {
      if (event.data?.type === "ally-push") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    navigator.serviceWorker?.addEventListener("message", onSw);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker?.removeEventListener("message", onSw);
    };
  }, [refresh]);

  const sayAloud = useCallback(
    async (text: string, language: SurakshaLanguage) => {
      if (!speak || !text) return;
      try {
        const tts = await api<SurakshaTts>("/suraksha/tts", { method: "POST", json: { text, language } });
        setLastTts(tts);
      } catch {
        /* the text is on screen; audio is a bonus */
      }
    },
    [speak],
  );

  const applyTurn = useCallback(
    async (res: TurnResponse) => {
      if (res.state) setState(res.state);
      if (res.stt_empty) setLastSttEmpty((n) => n + 1);
      if (res.transcript_in) setLastTranscriptIn(res.transcript_in);
      if (res.say) {
        setLastSay(res.say);
        await sayAloud(res.say, res.language ?? "hi-IN");
      }
    },
    [sayAloud],
  );

  const send = useCallback(
    async (msg: Record<string, unknown>) => {
      setBusy(true);
      setLastError(null);
      try {
        switch (msg.type) {
          case "parent_text":
            await applyTurn(await api<TurnResponse>("/suraksha/parent/text", { method: "POST", json: { text: msg.text } }));
            break;
          case "parent_audio":
            await applyTurn(
              await api<TurnResponse>("/suraksha/parent/audio", {
                method: "POST",
                json: { audio_base64: msg.audio_base64, mime_type: msg.mime_type },
              }),
            );
            break;
          case "start_companion":
            await applyTurn(await api<TurnResponse>("/suraksha/companion/start", { method: "POST" }));
            break;
          case "im_okay":
            await applyTurn(await api<TurnResponse>("/suraksha/im-okay", { method: "POST" }));
            break;
          case "family_on_my_way":
          case "family_arrived":
            await api(`/suraksha/escalations/${msg.escalation_id}/reply`, {
              method: "POST",
              json: { decision: msg.type === "family_on_my_way" ? "accept" : "arrived" },
            });
            await refresh();
            break;
          default:
            throw new Error(`unknown message ${String(msg.type)}`);
        }
      } catch (err) {
        if (err instanceof ApiError) {
          setLastError(err.message);
          if (err.say) setLastSay(err.say);
        } else {
          setLastError("Something went wrong.");
        }
      } finally {
        setBusy(false);
      }
    },
    [applyTurn, refresh],
  );

  return {
    state,
    connected,
    lastError,
    lastSay,
    lastTts,
    setLastTts,
    lastSttEmpty,
    lastTranscriptIn,
    busy,
    send,
    refresh,
  };
}
