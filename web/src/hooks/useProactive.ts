"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ProactiveMessage } from "@/lib/surakshaTypes";

const POLL_MS = 5000;

/** Messages Suraksha starts (morning check-in, reminders, questions). Claimed once, kept until dismissed. */
export function useProactive(onArrive?: (msg: ProactiveMessage) => void) {
  const [messages, setMessages] = useState<ProactiveMessage[]>([]);
  const seen = useRef(new Set<string>());
  const inflight = useRef(false);
  const arrive = useRef(onArrive);
  arrive.current = onArrive;

  const poll = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const res = await api<{ messages: ProactiveMessage[] }>("/suraksha/proactive/pending");
      const fresh = res.messages.filter((m) => !seen.current.has(m.id));
      fresh.forEach((m) => seen.current.add(m.id));
      if (fresh.length) {
        setMessages((prev) => [...prev, ...fresh]);
        fresh.forEach((m) => arrive.current?.(m));
      }
    } catch {
      /* the state poll surfaces connectivity errors */
    } finally {
      inflight.current = false;
    }
  }, []);

  useEffect(() => {
    void poll();
    const timer = window.setInterval(() => document.visibilityState === "visible" && void poll(), POLL_MS);
    const onSw = (event: MessageEvent) => event.data?.type === "ally-push" && void poll();
    navigator.serviceWorker?.addEventListener("message", onSw);
    return () => {
      window.clearInterval(timer);
      navigator.serviceWorker?.removeEventListener("message", onSw);
    };
  }, [poll]);

  const dismiss = useCallback(async (id: string, ack = true) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    if (ack) await api(`/suraksha/proactive/${id}/ack`, { method: "POST" }).catch(() => undefined);
  }, []);

  return { messages, dismiss, poll };
}
