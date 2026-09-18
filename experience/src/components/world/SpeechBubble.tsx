"use client";

import { Html } from "@react-three/drei";
import { useEffect, useState } from "react";

import { BUBBLE, type BubbleKey } from "@/lib/wardstone";

/**
 * A comic balloon over the character's head — what Suraksha says out loud.
 *
 * Uses drei `Html` rather than the DOM HUD because it has to track a point in
 * the world; `UI-AND-HUD.md` allows exactly that exception. It is mounted
 * inside the player's RigidBody group, so it follows her for free with no
 * per-frame projection.
 *
 * Deliberately NOT in the parchment language: this is a device speaking, and
 * the ink-outline comic panel is what makes that read instantly.
 */
export function SpeechBubble({ line }: { line: BubbleKey | null }) {
  const copy = line ? BUBBLE[line] : null;
  const [typed, setTyped] = useState("");

  // Type the line in. Restarts whenever the line changes.
  useEffect(() => {
    if (!copy) return;
    const full = copy.hi || copy.en;
    setTyped("");
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setTyped(full.slice(0, i));
      if (i >= full.length) window.clearInterval(id);
    }, 28);
    return () => window.clearInterval(id);
  }, [copy]);

  if (!copy) return null;

  return (
    <Html
      position={[0, 0.72, 0]}
      center
      // Shrinks with distance so it never swallows the screen up close.
      distanceFactor={2.4}
      zIndexRange={[40, 0]}
      style={{ pointerEvents: "none", userSelect: "none" }}
    >
      <div className="toon-bubble">
        <p className="toon-bubble-line" lang={copy.hi ? "hi" : "en"}>
          {typed}
          <span className="toon-caret" aria-hidden />
        </p>
        {copy.hi && <p className="toon-bubble-sub">{copy.en}</p>}
        <span className="toon-bubble-tail" aria-hidden />
      </div>
    </Html>
  );
}
