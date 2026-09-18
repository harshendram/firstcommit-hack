import { Architecture } from "@/components/landing/Architecture";
import { Credits } from "@/components/landing/Credits";
import { Footer } from "@/components/landing/Footer";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Nav } from "@/components/landing/Nav";
import { Statement } from "@/components/landing/Statement";

export const metadata = { title: "Suraksha — Care without watching" };

/**
 * The written landing page. Reachable from the world's HUD, and where anyone
 * without WebGL lands — since the adventure is the front door, this is the
 * only thing standing between them and a blank screen.
 */
export default function ClassicPage() {
  return (
    <main className="relative">
      <Nav />
      <Hero />
      <Statement
        eyebrow="The gap"
        lines={["Adult children worry.", "Parents hate being watched.", "Both are right."]}
        note="Cameras and panic alerts steal independence. Silence leaves families guessing. Suraksha sits in between: it learns Amma's normal, talks to her first, and only then coordinates the person who can actually show up."
      />
      <HowItWorks />
      <div id="stack">
        <Architecture />
      </div>
      <Statement
        eyebrow="Why it matters"
        lines={["It remembers.", "It asks her first.", "It stays quiet."]}
      />
      <Footer />
      <Credits />
    </main>
  );
}
