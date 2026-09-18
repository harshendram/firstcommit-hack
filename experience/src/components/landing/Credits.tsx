/**
 * Attribution for third-party assets. First Commit's rules require crediting
 * non-original work, and both of these are non-original.
 */
export function Credits() {
  return (
    <div className="mx-auto max-w-[1180px] px-[clamp(20px,5vw,64px)] pb-10">
      <p className="eyebrow-sm max-w-[70ch] leading-[1.9] text-ink-faint">
        3D explore world ported from{" "}
        <a
          href="https://incridea.in"
          className="underline underline-offset-2"
          target="_blank"
          rel="noopener noreferrer"
        >
          Incridea
        </a>
        &apos;s explore_2025 (map, Ryoko character, portal, stones, loader).
        Watch model rendered with{" "}
        <a
          href="https://spline.design"
          className="underline underline-offset-2"
          target="_blank"
          rel="noopener noreferrer"
        >
          Spline
        </a>
        . AWS Architecture Icons used unmodified where shown.
      </p>
    </div>
  );
}
