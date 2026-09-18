import type { TimelineEntry } from "@/lib/types";
import { formatElapsed, prettyTimelineLabel } from "@/lib/utils";

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <section className="panel px-6 py-5">
      <h2 className="eyebrow m-0 mb-3 text-ink-faint">Timeline</h2>
      {entries.length === 0 ? (
        <p className="m-0 text-sm text-ink-faint">Nothing has happened yet.</p>
      ) : (
        <ol className="thin-scroll m-0 flex list-none items-center gap-0 overflow-x-auto p-0 pb-1">
          {entries.map((entry, i) => (
            <li
              key={`${entry.at}-${i}`}
              className="flex shrink-0 items-center gap-3"
            >
              <div className="flex flex-col gap-0.5">
                <span className="tnum text-[0.78rem] font-semibold text-alert">
                  {formatElapsed(entry.elapsed_ms)}
                </span>
                <span className="text-[0.8rem] whitespace-nowrap text-ink-soft">
                  {prettyTimelineLabel(entry.label)}
                </span>
              </div>
              {i < entries.length - 1 && (
                <span className="h-px w-8 shrink-0 bg-line" />
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
