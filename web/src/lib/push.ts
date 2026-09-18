"use client";

import { surakshaApiUrl } from "./surakshaTypes";
import { api } from "./api";

export type PushStatus = "unsupported" | "denied" | "prompt" | "enabled" | "not_configured";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register(`/sw.js?api=${encodeURIComponent(surakshaApiUrl())}`, { scope: "/" });
}

export async function pushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "enabled" : "prompt";
}

/** Must be called from a user tap (browsers require a gesture for the permission prompt). */
export async function enablePush(): Promise<PushStatus> {
  if (!pushSupported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "prompt";
  const { key } = await api<{ key: string }>("/suraksha/push/vapid-public-key");
  if (!key) return "not_configured";
  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    }));
  await api("/suraksha/push/subscribe", { method: "POST", json: { subscription: sub.toJSON() } });
  return "enabled";
}
