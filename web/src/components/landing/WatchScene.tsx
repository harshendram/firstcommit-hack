"use client";

import { Reveal } from "@/components/Reveal";
import { WatchMockup } from "./WatchMockup";

export function WatchScene() {
  return (
    <section className="relative overflow-hidden px-[clamp(20px,5vw,64px)] py-[clamp(80px,14vh,128px)]">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="dot-bg absolute inset-0 opacity-45" />
      </div>

      <div className="mx-auto grid max-w-6xl items-center gap-16 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
        <Reveal className="relative flex justify-center py-6">
          <div className="ws-glow" aria-hidden />
          <div className="ws-ring" aria-hidden />
          <WatchMockup />
        </Reveal>

        <div>
          <Reveal>
            <span className="eyebrow text-alert">On the wrist</span>
            <h2 className="display mt-5 text-[clamp(1.85rem,3.8vw,2.85rem)] text-ink">
              The watch notices. Amma stays in charge.
            </h2>
            <p className="mt-6 max-w-[44ch] text-[1rem] font-normal leading-[1.6] text-ink-soft">
              First movement of the day. A quiet I&apos;m okay tap. She can
              dismiss a nudge without talking. That agency is the product — not
              another camera in the hallway.
            </p>
          </Reveal>

          <Reveal delay={0.12}>
            <ul className="mt-10 grid list-none gap-3 p-0 sm:grid-cols-2">
              {[
                { t: "First movement", d: "Proxy for got out of bed" },
                { t: "I'm okay", d: "One tap, no conversation" },
                { t: "Steps & heart rate", d: "Quiet signals, not a feed" },
                { t: "Suraksha on the wrist", d: "Companion, not an alarm" },
              ].map((f) => (
                <li key={f.t} className="panel-sunk px-4 py-3.5">
                  <div className="text-[0.92rem] font-semibold text-ink">
                    {f.t}
                  </div>
                  <div className="mt-0.5 text-[0.83rem] text-ink-faint">
                    {f.d}
                  </div>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
