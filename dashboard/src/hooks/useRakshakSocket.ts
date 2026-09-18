import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientMessage,
  ClientRole,
  ServerMessage,
  SessionEvent,
} from "../types";
import { IDLE_SESSION } from "../types";

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  // In dev, Vite proxies /ws → backend
  return `${proto}//${window.location.host}/ws`;
}

export function useRakshakSocket(role: ClientRole) {
  const [session, setSession] = useState<SessionEvent>(IDLE_SESSION);
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastTts, setLastTts] = useState<{
    audio_base64: string;
    mime_type: string;
    text: string;
  } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number>(0);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    let closed = false;
    let reconnectTimer: number | undefined;
    let active: WebSocket | null = null;

    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(wsUrl());
      active = ws;
      wsRef.current = ws;

      ws.onopen = () => {
        if (ws !== active) return;
        setConnected(true);
        setLastError(null);
        retryRef.current = 0;
        ws.send(JSON.stringify({ type: "hello", role } satisfies ClientMessage));
      };

      ws.onmessage = (ev) => {
        if (ws !== active) return;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data as string) as ServerMessage;
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
              const exists = prev.transcript.some(
                (t) =>
                  t.timestamp === msg.turn.timestamp &&
                  t.text === msg.turn.text &&
                  t.speaker === msg.turn.speaker
              );
              if (exists) return prev;
              return {
                ...prev,
                transcript: [...prev.transcript, msg.turn],
              };
            });
            break;
          case "tts_audio":
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

      ws.onclose = () => {
        // Ignore stale sockets from React StrictMode remounts
        if (ws !== active) return;
        setConnected(false);
        if (wsRef.current === ws) wsRef.current = null;
        if (closed) return;
        const delay = Math.min(5000, 500 * 2 ** retryRef.current);
        retryRef.current += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        if (ws !== active) return;
        setLastError("WebSocket connection error");
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      const sock = active;
      active = null;
      if (wsRef.current === sock) wsRef.current = null;
      sock?.close();
    };
  }, [role]);

  return { session, connected, lastError, lastTts, send, setLastTts };
}
