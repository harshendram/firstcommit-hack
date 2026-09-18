import { Reveal } from "@/components/Reveal";

const STEPS = [
  {
    n: "01",
    title: "Learn what's normal",
    body: "Wake window, first movement, how long a morning call usually lasts, how Amma actually sounds. Thirteen days of seeded history — labeled as simulated — lock the baseline.",
    tag: "Routine Model",
  },
  {
    n: "02",
    title: "Companion, not a monitor",
    body: "Good morning. Don't forget your tablets. Don't tell Priya about my BP. The Companion Agent is the only voice Amma hears. Family hears nothing.",
    tag: "Companion Agent · Tier 1",
  },
  {
    n: "03",
    title: "Notice a real deviation",
    body: "No movement past the usual wake window. A missed call. Flat, short answers. One strong signal — or two moderate ones together — is enough. Not a binary alarm.",
    tag: "Watch Signal + Routine Model",
  },
  {
    n: "04",
    title: "Ask Amma first",
    body: "“You're usually up by now — everything okay?” Investigation happens before anyone in the family is looped in. Dignity first.",
    tag: "Investigation Agent · Tier 1",
  },
  {
    n: "05",
    title: "Coordinate the right person",
    body: "Suraksha asks Rahul first and waits for a real reply. He can't step out, so Suraksha asks Priya. Each ask is a Step Functions callback with a timeout — a calm update, not a panic alert.",
    tag: "Family Coordination · Tier 2",
    accent: true,
  },
  {
    n: "06",
    title: "Escalate only if necessary",
    body: "A neighbour is contacted only if Amma says yes — enforced by a Cedar policy, not a prompt. Most days never get here. That's the product.",
    tag: "Tier 3 · confirmation",
  },
];

export function HowItWorks() {
  return (
    <section
      id="how"
      className="relative border-t border-line bg-paper-deep px-[clamp(20px,5vw,64px)] py-[clamp(64px,10vh,120px)]"
    >
      <div className="mx-auto max-w-[1180px]">
        <Reveal>
          <p className="eyebrow m-0 text-ink-faint">How it works</p>
          <h2 className="display mt-3 max-w-[22ch] text-[clamp(1.8rem,3.2vw,2.6rem)] text-ink">
            Understand. Detect. Ask her. Then family.
          </h2>
        </Reveal>

        <ol className="mt-12 m-0 grid list-none gap-6 p-0 md:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((step, i) => (
            <Reveal key={step.n} delay={0.06 * i}>
              <li
                className={
                  step.accent
                    ? "panel flex h-full flex-col gap-3 border-alert/20 bg-alert-wash p-6"
                    : "panel flex h-full flex-col gap-3 p-6"
                }
              >
                <span className="eyebrow text-ink-faint">{step.n}</span>
                <h3 className="m-0 text-[1.15rem] font-semibold text-ink">
                  {step.title}
                </h3>
                <p className="m-0 flex-1 text-[0.92rem] leading-relaxed text-ink-soft">
                  {step.body}
                </p>
                <span className="eyebrow-sm text-ink-faint">{step.tag}</span>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
