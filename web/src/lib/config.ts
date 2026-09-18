/**
 * Main website origin for in-world links.
 * Same-origin `/` now that the 3D world lives in this Next app at /explore.
 */
export const APP_URL =
  process.env.NEXT_PUBLIC_ALLY_APP_URL?.trim() || "/";

export const appHref = (path: string) => {
  const base = APP_URL.replace(/\/$/, "");
  if (base.startsWith("http")) return `${base}${path}`;
  if (path === "/" || path === "") return base || "/";
  return `${base}${path}`;
};
