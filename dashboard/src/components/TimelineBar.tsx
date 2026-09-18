import { formatElapsed } from "../lib/utils";
import type { TimelineEntry } from "../types";

export function TimelineBar({ entries }: { entries: TimelineEntry[] }) {
  return (
    <div className="rounded-xl border border-ink-700/80 bg-ink-900/60 px-4 py-3 backdrop-blur">
      <div className="mb-2 text-xs font-semibold tracking-wide text-ink-300 uppercase">
        Timeline
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-ink-500 italic">No events yet.</p>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-ink-200">
          {entries.map((e, i) => (
            <span key={`${e.at}-${i}`} className="inline-flex items-baseline gap-1.5">
              <span className="text-accent-400">{formatElapsed(e.elapsed_ms)}</span>
              <span className="text-ink-400">{e.label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
