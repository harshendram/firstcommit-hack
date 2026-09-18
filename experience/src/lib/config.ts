/**
 * Main website link. Prefer same-origin /classic locally so the button never
 * hits a dead localhost:3000 when the web app isn't running.
 */
export const APP_URL =
  process.env.NEXT_PUBLIC_ALLY_APP_URL?.trim() || "/classic";

export const appHref = (path: string) => {
  const base = APP_URL.replace(/\/$/, "");
  if (base.startsWith("http")) return `${base}${path}`;
  if (path === "/" || path === "") return base || "/";
  return `${base}${path}`;
};
