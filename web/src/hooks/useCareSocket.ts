"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { rewriteLoopbackHost } from "@/lib/localUrl";
import {
  IDLE_CHECKIN,
  type CareClientMessage,
  type CareServerMessage,
  type CheckInSession,
  type DoctorView,
  type PatientMonitorCard,
} from "@/lib/careTypes";

function resolveCareWsUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_CARE_WS_URL;
  if (fromEnv) return rewriteLoopbackHost(fromEnv);
  const base = process.env.NEXT_PUBLIC_WS_URL;
  if (base) return rewriteLoopbackHost(base.replace(/\/ws$/, "/care"));
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.hostname}:3001/care`;
}

export interface CareTts {
  audio_base64?: string;
  audio_url?: string;
  mime_type: string;
  text: string;
}

export function useCareSocket(role: "patient" | "doctor" | "watch") {
  const [session, setSession] = useState<CheckInSession>(IDLE_CHECKIN);
  const [doctorView, setDoctorView] = useState<DoctorView | null>(null);
  const [roster, setRoster] = useState<PatientMonitorCard[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastTts, setLastTts] = useState<CareTts | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);

  const send = useCallback((msg: CareClientMessage) => {
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
      const ws = new WebSocket(resolveCareWsUrl());
      active = ws;
      wsRef.current = ws;

      ws.onopen = () => {
        if (ws !== active) return;
        setConnected(true);
        setLastError(null);
        retryRef.current = 0;
        ws.send(JSON.stringify({ type: "hello", role } satisfies CareClientMessage));
      };

      ws.onmessage = (event) => {
        if (ws !== active) return;
        let msg: CareServerMessage;
        try {
          msg = JSON.parse(event.data as string) as CareServerMessage;
        } catch {
          return;
        }
        switch (msg.type) {
          case "care_session":
            setSession(msg.session);
            break;
          case "care_turn":
            setSession((prev) => {
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
          case "care_doctor":
            setDoctorView(msg.view);
            break;
          case "care_roster":
            setRoster(msg.patients);
            break;
          case "care_tts":
            if (!msg.audio_base64 && !msg.audio_url) break;
            setLastTts({
              audio_base64: msg.audio_base64,
              audio_url: msg.audio_url,
              mime_type: msg.mime_type,
              text: msg.text,
            });
            break;
          case "care_error":
            setLastError(msg.message);
            break;
        }
      };

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
        setLastError("Cannot reach the Rakshak agent");
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

  return {
    session,
    doctorView,
    setDoctorView,
    roster,
    connected,
    lastError,
    setLastError,
    lastTts,
    setLastTts,
    send,
  };
}
