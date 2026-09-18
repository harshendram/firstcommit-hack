import { randomUUID } from "node:crypto";

type Entry = { buf: Buffer; mime: string; expires: number };

const TTL_MS = 5 * 60_000;
const store = new Map<string, Entry>();

function sweep(): void {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (entry.expires <= now) store.delete(id);
  }
}

/** Cache a TTS clip for short-lived HTTP fetch (Wear OS avoids huge WS frames). */
export function putTts(audioBase64: string, mimeType: string): string {
  sweep();
  const id = randomUUID();
  store.set(id, {
    buf: Buffer.from(audioBase64, "base64"),
    mime: mimeType || "audio/wav",
    expires: Date.now() + TTL_MS,
  });
  return id;
}

export function getTts(
  id: string
): { buf: Buffer; mime: string } | null {
  const entry = store.get(id);
  if (!entry) return null;
  if (entry.expires <= Date.now()) {
    store.delete(id);
    return null;
  }
  return { buf: entry.buf, mime: entry.mime };
}
