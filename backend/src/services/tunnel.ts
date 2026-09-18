import ngrok from "@ngrok/ngrok";
import { config } from "../config.js";

/**
 * Opens an ngrok tunnel to this backend so Twilio can reach our webhooks —
 * needed for "press 1 to confirm" during a call and for YES replies over SMS.
 *
 * Uses the Node SDK rather than the ngrok CLI because Windows Application
 * Control blocks the standalone ngrok binary on some machines.
 *
 * Returns the public https origin, or null if no tunnel was opened.
 */
export async function startTunnel(): Promise<string | null> {
  if (config.publicApiUrl) {
    console.log(`[tunnel] using PUBLIC_API_URL=${config.publicApiUrl}`);
    return config.publicApiUrl;
  }

  if (!config.ngrokAuthtoken) {
    console.warn(
      "[tunnel] no NGROK_AUTHTOKEN — skipping tunnel. Voice calls will still play the alert, but 'press 1' and SMS replies won't reach the backend. Acknowledge from the Family PWA instead."
    );
    return null;
  }

  try {
    const listener = await ngrok.forward({
      addr: config.port,
      authtoken: config.ngrokAuthtoken,
    });
    const url = listener.url();
    if (!url) {
      console.error("[tunnel] ngrok returned no URL");
      return null;
    }
    const origin = url.replace(/\/$/, "");
    config.publicApiUrl = origin;
    console.log(`[tunnel] ngrok up · ${origin}`);
    return origin;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[tunnel] ngrok failed: ${message}`);
    return null;
  }
}
