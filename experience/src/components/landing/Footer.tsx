import { Reveal } from "@/components/Reveal";
import { BrandMark } from "./BrandMark";
import { appHref } from "@/lib/config";

export function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-line bg-paper-deep px-5 pt-24 pb-10 md:px-10">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <div className="text-center">
            <span className="eyebrow text-alert">Ready when you are</span>
            <p className="display mx-auto mt-5 max-w-[22ch] text-[clamp(2rem,5vw,3.6rem)] text-ink">
              Most days, Suraksha says nothing at all. That&apos;s the point.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <a href={appHref("/parent")} className="btn btn-primary">
              Talk to Amma
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                  />
                </svg>
              </a>
              <a href={appHref("/home")} className="btn btn-ghost">
                Family home
              </a>
            </div>
          </div>
        </Reveal>

        <div className="mt-20 flex flex-col items-center justify-between gap-6 border-t border-line pt-8 sm:flex-row">
          <BrandMark />
          <div className="eyebrow-sm flex flex-wrap items-center gap-5 text-ink-faint">
            <span>Strands + Bedrock</span>
            <span>Wear OS</span>
            <span>Cedar · Step Functions · Polly</span>
            <span>Built for the demo floor</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
