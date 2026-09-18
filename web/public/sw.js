/* Suraksha service worker: push wakes the device; the app reads real state from the API. Network-only. */

const API = new URL(self.location.href).searchParams.get("api") || "http://localhost:8002";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Suraksha", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const focused = windows.find((w) => w.focused);
      windows.forEach((w) => w.postMessage({ type: "ally-push", payload: data }));
      if (focused && data.type !== "escalation_ask") return; // the open app shows it in place
      const options = {
        body: data.body || "",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: data.esc_id ? `esc-${data.esc_id}` : data.msg_id,
        renotify: data.type === "escalation_ask",
        requireInteraction: data.type === "escalation_ask",
        data,
      };
      if (data.type === "escalation_ask" && data.reply_token) {
        options.actions = [
          { action: "accept", title: "I can go" },
          { action: "decline", title: "Can't right now" },
        ];
      }
      await self.registration.showNotification(data.title || "Suraksha", options);
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};
  event.notification.close();
  event.waitUntil(
    (async () => {
      if ((event.action === "accept" || event.action === "decline") && data.reply_token) {
        const res = await fetch(`${API}/suraksha/escalations/reply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reply_token: data.reply_token, decision: event.action }),
        }).catch(() => null);
        if (res && res.ok) {
          if (event.action === "decline") {
            await self.registration.showNotification("Suraksha", {
              body: "Okay — Suraksha will ask someone else.",
              icon: "/icons/icon-192.png",
              tag: `esc-${data.esc_id}`,
            });
            return;
          }
          // Accepted: they are on their way, so open what they need to know before they walk in.
        }
      }
      const url = data.esc_id ? `/family/respond/${data.esc_id}` : data.type && data.audience === "parent" ? "/parent" : "/home";
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((w) => new URL(w.url).pathname === url);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })(),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  // The page re-subscribes on next open (it needs the user's session to register the new endpoint).
  event.waitUntil(self.clients.matchAll({ type: "window" }).then((ws) => ws.forEach((w) => w.postMessage({ type: "ally-resubscribe" }))));
});
