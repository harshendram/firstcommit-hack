"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import type { ConversationTurn } from "@/lib/types";
import { cn, formatClock } from "@/lib/utils";

export function LiveTranscript({
  turns,
  active,
}: {
  turns: ConversationTurn[];
  active: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length]);

  return (
    <section className="panel flex min-h-0 flex-col overflow-hidden">
      <header className="panel-head">
        <h2 className="eyebrow m-0 text-ink-soft">Live transcript</h2>
        <span className="chip">
          {turns.length} {turns.length === 1 ? "turn" : "turns"}
        </span>
      </header>

      <div className="thin-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
        {turns.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <span className="eyebrow-sm text-ink-faint">
              {active ? "Listening…" : "No active session"}
            </span>
            <p className="m-0 max-w-[30ch] text-sm text-ink-faint">
              The conversation appears here word by word as it happens.
            </p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {turns.map((turn, i) => (
            <motion.article
              key={`${turn.timestamp}-${i}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className={cn("bubble", turn.speaker === "ai" ? "bubble-ai" : "bubble-user")}
            >
              <div className="mb-1.5 flex items-center gap-2.5">
                <span
                  className={cn(
                    "eyebrow-sm",
                    turn.speaker === "ai" ? "text-ink-faint" : "text-ink-soft"
                  )}
                >
                  {turn.speaker === "ai" ? "Suraksha" : "Patient"}
                </span>
                <span className="eyebrow-sm tnum text-ink-faint">
                  {formatClock(turn.timestamp)}
                </span>
              </div>
              <p className="m-0 text-[0.94rem] leading-relaxed text-ink">
                {turn.text}
              </p>
            </motion.article>
          ))}
        </AnimatePresence>

        {active && turns.length > 0 && (
          <div className="flex items-center gap-1.5 pl-1">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-ink-faint"
                animate={{ opacity: [0.2, 0.9, 0.2] }}
                transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.18 }}
              />
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>
    </section>
  );
}
