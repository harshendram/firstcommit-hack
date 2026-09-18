/**
 * Env URLs are baked as localhost. When the page is opened from a phone or
 * another machine (e.g. http://192.168.4.52:41933), those loopback hosts are
 * the device itself — rewrite them to the page hostname so WS/API still hit
 * the laptop.
 */
export function rewriteLoopbackHost(url: string): string {
  if (typeof window === "undefined") return url;
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return url;
  return url.replace(
    /^(https?:\/\/|wss?:\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/i,
    (_, proto: string) => `${proto}${host}`
  );
}
