import { randomUUID } from "node:crypto";

interface CallAudioEntry {
  buffer: Buffer;
  mimeType: string;
  expiresAt: number;
}

const TTL_MS = 15 * 60_000;
const store = new Map<string, CallAudioEntry>();

function sweep(): void {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (entry.expiresAt <= now) store.delete(id);
  }
}

/** Cache a Sarvam WAV so Twilio can `<Play>` it from our public tunnel. */
export function putCallAudio(
  buffer: Buffer,
  mimeType = "audio/wav"
): string {
  sweep();
  const id = randomUUID().replace(/-/g, "").slice(0, 12);
  store.set(id, {
    buffer,
    mimeType,
    expiresAt: Date.now() + TTL_MS,
  });
  return id;
}

export function getCallAudio(
  id: string
): { buffer: Buffer; mimeType: string } | null {
  const entry = store.get(id);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(id);
    return null;
  }
  return { buffer: entry.buffer, mimeType: entry.mimeType };
}
