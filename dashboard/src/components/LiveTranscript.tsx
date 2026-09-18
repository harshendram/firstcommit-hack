import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import type { ConversationTurn } from "../types";
import { cn } from "../lib/utils";

export function LiveTranscript({ turns }: { turns: ConversationTurn[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns.length]);

  return (
    <div className="flex h-full flex-col rounded-xl border border-ink-700/80 bg-ink-900/60 backdrop-blur">
      <div className="flex items-center justify-between border-b border-ink-700/80 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-wide text-ink-100 uppercase">
          Live Transcript
        </h2>
        <span className="font-mono text-[10px] text-ink-400">
          {turns.length} turns
        </span>
      </div>
      <div className="transcript-scroll flex-1 space-y-3 overflow-y-auto p-4">
        {turns.length === 0 && (
          <p className="text-sm text-ink-400 italic">
            Waiting for conversation…
          </p>
        )}
        <AnimatePresence initial={false}>
          {turns.map((t, i) => (
            <motion.div
              key={`${t.timestamp}-${i}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className={cn(
                "max-w-[92%] rounded-lg px-3 py-2 text-sm leading-relaxed",
                t.speaker === "ai"
                  ? "bg-accent-500/10 text-ink-50 ring-1 ring-accent-500/20"
                  : "ml-auto bg-ink-800 text-ink-100 ring-1 ring-ink-600/60"
              )}
            >
              <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold tracking-wider uppercase">
                <span
                  className={
                    t.speaker === "ai" ? "text-accent-400" : "text-ink-300"
                  }
                >
                  {t.speaker === "ai" ? "Rakshak" : "Patient"}
                </span>
                <span className="font-mono font-normal text-ink-500">
                  {new Date(t.timestamp).toLocaleTimeString()}
                </span>
              </div>
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
