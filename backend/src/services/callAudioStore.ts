/**
 * Staging area for outbound call audio.
 *
 * Amazon Connect has to fetch the Polly clip over HTTPS, so it goes to S3 and we
 * hand Connect a presigned URL. Objects are written under `calls/` where a
 * lifecycle rule (see `infra/`) expires them after a day; the presigned URL
 * itself dies in fifteen minutes, which is the window that actually matters.
 *
 * When no bucket is configured the clip is kept in memory and served from
 * `/api/notifications/voice/audio/:id` instead — that keeps `npm run dev` working
 * without any AWS state to create.
 */

import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from "../aws/clients.js";
import { config } from "../config.js";

interface CallAudioEntry {
  buffer: Buffer;
  mimeType: string;
  expiresAt: number;
}

const TTL_MS = 15 * 60_000;
const TTL_SECONDS = TTL_MS / 1000;
const local = new Map<string, CallAudioEntry>();

function sweep(): void {
  const now = Date.now();
  for (const [id, entry] of local) {
    if (entry.expiresAt <= now) local.delete(id);
  }
}

/**
 * Stage a clip and return the URL Connect should play.
 * S3 when a bucket is configured, this process otherwise.
 */
export async function putCallAudio(
  buffer: Buffer,
  mimeType = "audio/mpeg"
): Promise<string> {
  sweep();
  const id = randomUUID().replace(/-/g, "").slice(0, 12);

  if (config.aws.callAudioBucket) {
    const key = `calls/${new Date().toISOString().slice(0, 10)}/${id}.mp3`;
    await s3().send(
      new PutObjectCommand({
        Bucket: config.aws.callAudioBucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        // The bucket enforces SSE-S3 too; being explicit keeps the intent in the code.
        ServerSideEncryption: "AES256",
      })
    );
    return getSignedUrl(
      s3(),
      new GetObjectCommand({ Bucket: config.aws.callAudioBucket, Key: key }),
      { expiresIn: TTL_SECONDS }
    );
  }

  local.set(id, { buffer, mimeType, expiresAt: Date.now() + TTL_MS });
  const origin = config.publicApiUrl || `http://localhost:${config.port}`;
  return `${origin}/api/notifications/voice/audio/${id}`;
}

/** Only used by the local fallback route. */
export function getCallAudio(id: string): { buffer: Buffer; mimeType: string } | null {
  const entry = local.get(id);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    local.delete(id);
    return null;
  }
  return { buffer: entry.buffer, mimeType: entry.mimeType };
}
