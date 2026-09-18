"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { rewriteLoopbackHost } from "@/lib/localUrl";
import {
  IDLE_SESSION,
  type ClientMessage,
  type ClientRole,
  type ServerMessage,
  type SessionEvent,
} from "@/lib/types";

function resolveWsUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_WS_URL;
  if (fromEnv) return rewriteLoopbackHost(fromEnv);
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.hostname}:3001/ws`;
}

export interface TtsPayload {
  audio_base64: string;
  mime_type: string;
  text: string;
}

export function useRakshakSocket(role: ClientRole) {
  const [session, setSession] = useState<SessionEvent>(IDLE_SESSION);
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastTts, setLastTts] = useState<TtsPayload | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | undefined;
    let active: WebSocket | null = null;

    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(resolveWsUrl());
      active = ws;
      wsRef.current = ws;

      ws.onopen = () => {
        if (ws !== active) return;
        setConnected(true);
        setLastError(null);
        retryRef.current = 0;
        ws.send(JSON.stringify({ type: "hello", role } satisfies ClientMessage));
      };

      ws.onmessage = (event) => {
        if (ws !== active) return;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data as string) as ServerMessage;
        } catch {
          return;
        }
        switch (msg.type) {
          case "session":
            setSession(msg.session);
            break;
          case "transcript_delta":
            setSession((prev) => {
              if (prev.session_id && prev.session_id !== msg.session_id) {
                return prev;
              }
              const dupe = prev.transcript.some(
                (t) =>
                  t.timestamp === msg.turn.timestamp &&
                  t.text === msg.turn.text &&
                  t.speaker === msg.turn.speaker
              );
              if (dupe) return prev;
              return { ...prev, transcript: [...prev.transcript, msg.turn] };
            });
            break;
          case "tts_audio":
            if (!msg.audio_base64) break;
            setLastTts({
              audio_base64: msg.audio_base64,
              mime_type: msg.mime_type,
              text: msg.text,
            });
            break;
          case "error":
            setLastError(msg.message);
            break;
        }
      };

      // Ignore stale sockets from React StrictMode double-mounts
      ws.onclose = () => {
        if (ws !== active) return;
        setConnected(false);
        if (wsRef.current === ws) wsRef.current = null;
        if (disposed) return;
        const delay = Math.min(5000, 500 * 2 ** retryRef.current);
        retryRef.current += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        if (ws !== active) return;
        setLastError("Cannot reach the orchestrator");
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      const sock = active;
      active = null;
      if (wsRef.current === sock) wsRef.current = null;
      sock?.close();
    };
  }, [role]);

  return { session, connected, lastError, lastTts, setLastTts, send };
}
