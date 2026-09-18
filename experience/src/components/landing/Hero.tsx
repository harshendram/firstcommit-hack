"use client";

import { motion } from "framer-motion";
import { HeroCall } from "./HeroCall";
import { appHref } from "@/lib/config";

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.85, delay, ease: [0.22, 1, 0.36, 1] as const },
});

export function Hero() {
  return (
    <section className="hero-stage relative flex min-h-[100svh] flex-col justify-center overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="hero-grid absolute inset-0" />
        <div
          className="absolute -top-32 right-[-8%] h-[560px] w-[560px] rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(circle, oklch(0.56 0.18 28 / 0.09), transparent 70%)",
          }}
        />
        <div
          className="absolute bottom-[-10%] left-[-12%] h-[480px] w-[480px] rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(circle, oklch(0.72 0.08 85 / 0.22), transparent 70%)",
          }}
        />
      </div>

      <div className="hero-inner mx-auto w-full max-w-[1180px] px-[clamp(20px,5vw,64px)] pt-[clamp(80px,11vh,104px)] pb-[clamp(32px,6vh,56px)]">
        <div className="hero-copy">
          <motion.p className="hero-eyebrow" {...rise(0.04)}>
            Not surveillance · an ally for aging at home
          </motion.p>

          <motion.h1 className="hero-title" {...rise(0.1)}>
            <span className="hero-kicker">Suraksha</span>
            <span className="hero-impact">
              Helps families care
              <br />
              <em>without watching.</em>
            </span>
          </motion.h1>

          <motion.p className="hero-lede" {...rise(0.18)}>
            Suraksha learns what&apos;s normal for Amma — then checks in with her first.
            Family only hears when something is actually off, and only the person
            who can actually show up. Most days, Suraksha says nothing at all.
            That&apos;s the point.
          </motion.p>

          <motion.div className="hero-ctas" {...rise(0.22)}>
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
          </motion.div>

          <motion.div className="hero-tags" {...rise(0.26)}>
            {["Strands", "Bedrock", "Cedar", "Wear OS"].map((t) => (
              <span key={t} className="hero-tag">{t}</span>
            ))}
          </motion.div>

          <motion.dl className="hero-stats" {...rise(0.34)}>
            {[
              { n: "T1", l: "Check in with Amma" },
              { n: "T2", l: "Ask the right person" },
              { n: "T3", l: "Only if needed" },
            ].map((s) => (
              <div key={s.l} className="hero-stat">
                <dt className="display">{s.n}</dt>
                <dd>{s.l}</dd>
              </div>
            ))}
          </motion.dl>
        </div>

        <motion.div className="product-seal" {...rise(0.2)}>
          <HeroCall />
        </motion.div>
      </div>

      <button
        type="button"
        className="scroll-hint"
        onClick={() =>
          window.scrollTo({ top: window.innerHeight * 0.92, behavior: "smooth" })
        }
      >
        <span className="eyebrow-sm">Scroll the story</span>
        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
    </section>
  );
}
