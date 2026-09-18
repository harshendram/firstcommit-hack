export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Map a global 0..1 progress onto a sub-range, clamped. Mirrors drei's useScroll().range(). */
export function range(t: number, from: number, to: number): number {
  if (to <= from) return 0;
  return Math.min(1, Math.max(0, (t - from) / (to - from)));
}

/** 0 → 1 → 0 across a sub-range, so a level fades in and back out. drei's curve(). */
export function curve(t: number, from: number, to: number): number {
  const r = range(t, from, to);
  return Math.sin(r * Math.PI);
}

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
