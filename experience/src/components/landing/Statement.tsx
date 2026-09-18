import { Reveal } from "@/components/Reveal";

/** Big editorial statement — housepot scene-statement pattern. */
export function Statement({
  eyebrow,
  lines,
  note,
}: {
  eyebrow?: string;
  lines: string[];
  note?: string;
}) {
  return (
    <section className="relative px-[clamp(20px,5vw,64px)] py-[clamp(96px,18vh,160px)]">
      <div className="mx-auto max-w-[52rem] text-center">
        <Reveal>
          {eyebrow && (
            <span className="eyebrow mb-7 block text-alert">{eyebrow}</span>
          )}
          <p className="display m-0 text-[clamp(2.2rem,5.4vw,4rem)] text-ink">
            {lines.map((line, i) => (
              <span key={line} className="block">
                {i === lines.length - 1 ? (
                  <em className="not-italic text-ink-faint">{line}</em>
                ) : (
                  line
                )}
              </span>
            ))}
          </p>
          {note && (
            <p className="mx-auto mt-9 max-w-[44ch] text-[1.05rem] font-normal leading-[1.6] text-ink-soft">
              {note}
            </p>
          )}
        </Reveal>
      </div>
    </section>
  );
}
