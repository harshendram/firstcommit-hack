import { Architecture } from "@/components/landing/Architecture";
import { Footer } from "@/components/landing/Footer";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Nav } from "@/components/landing/Nav";
import { Statement } from "@/components/landing/Statement";
import { WatchScene } from "@/components/landing/WatchScene";

export default function LandingPage() {
  return (
    <main className="relative">
      <Nav />
      <Hero />

      <Statement
        eyebrow="The gap"
        lines={[
          "Adult children worry.",
          "Parents hate being watched.",
          "Both are right.",
        ]}
        note="Cameras and panic alerts steal independence. Silence leaves families guessing. Suraksha sits in between: it learns Amma's normal, talks to her first, and only then coordinates the person who can actually show up."
      />

      <HowItWorks />
      <Architecture />
      <WatchScene />

      <Statement
        eyebrow="Why it matters"
        lines={["It remembers.", "It asks her first.", "It stays quiet."]}
      />

      <Footer />
    </main>
  );
}
