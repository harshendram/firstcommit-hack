import { Reveal } from "@/components/Reveal";

const PHASES = [
  { id: "normal", label: "Normal day", tone: "ok" },
  { id: "dev", label: "Deviation", tone: "warn" },
  { id: "ask", label: "Ask Amma", tone: "calm" },
  { id: "coord", label: "Coordinate", tone: "warn" },
  { id: "close", label: "Close the loop", tone: "ok" },
] as const;

const TONE_CLS = {
  calm: "bg-calm-wash text-calm ring-calm/25",
  warn: "bg-warn-wash text-warn ring-warn/30",
  alert: "bg-alert-wash text-alert ring-alert/25",
  ok: "bg-ok-wash text-ok ring-ok/25",
} as const;

const LAYERS = [
  {
    name: "Orchestrator",
    detail: "Strands · Bedrock Nova 2 Lite · tier policy in code",
    role: "Owns deviation + who may speak",
  },
  {
    name: "Companion Agent",
    detail: "Hindi + English voice · Amazon Transcribe · Amazon Polly Kajal",
    role: "The only agent Amma perceives",
  },
  {
    name: "Routine Model Agent",
    detail: "DynamoDB · 13 simulated days + live today",
    role: "What's normal for this person",
  },
  {
    name: "Watch Signal Agent",
    detail: "Wear OS · first movement · I'm okay",
    role: "Quiet edge signals",
  },
  {
    name: "Investigation Agent",
    detail: "Warm check-in before family",
    role: "Tier 1 — ask her first",
  },
  {
    name: "Family Coordination Agent",
    detail: "Rahul → Priya → Sunita aunty · Step Functions + Web Push",
    role: "The right person, calmly",
  },
];

export function Architecture() {
  return (
    <section id="stack" className="relative px-[clamp(20px,5vw,64px)] py-[clamp(80px,14vh,128px)]">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-16 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
          <div>
            <Reveal>
              <span className="eyebrow text-alert">The spine</span>
              <h2 className="display mt-5 text-[clamp(1.85rem,3.8vw,2.85rem)] text-ink">
                One orchestrator. Five specialists. Nothing skips the tier.
              </h2>
              <p className="mt-6 max-w-[42ch] text-[1rem] font-normal leading-[1.6] text-ink-soft">
                Companion, Routine Model, Watch Signal, Investigation, and Family
                Coordination run on Strands and Bedrock. Every tool call passes a Cedar
                consent check Amma sets by voice, and every decision is logged for her to read.
                Family never gets a ping unless the orchestrator decides Tier 2.
              </p>
            </Reveal>

            <Reveal delay={0.12}>
              <div className="mt-10 flex flex-wrap items-center gap-2">
                {PHASES.map((s, i) => (
                  <span key={s.id} className="flex items-center gap-2">
                    <span
                      className={`eyebrow-sm rounded-full px-3 py-1.5 ring-1 ${TONE_CLS[s.tone]}`}
                    >
                      {s.label}
                    </span>
                    {i < PHASES.length - 1 && (
                      <span className="text-line-strong">→</span>
                    )}
                  </span>
                ))}
              </div>
            </Reveal>
          </div>

          <Reveal delay={0.08}>
            <ul className="m-0 grid list-none gap-px overflow-hidden rounded-[20px] border border-line bg-line p-0">
              {LAYERS.map((l) => (
                <li
                  key={l.name}
                  className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 bg-card px-7 py-5"
                >
                  <div>
                    <div className="text-[1rem] font-semibold text-ink">
                      {l.name}
                    </div>
                    <div className="eyebrow-sm mt-1.5 text-ink-faint">
                      {l.detail}
                    </div>
                  </div>
                  <div className="text-[0.875rem] text-ink-soft">{l.role}</div>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
