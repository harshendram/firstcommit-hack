"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";

const Medieval = dynamic(
  () => import("@/components/world/Medieval").then((m) => m.Medieval),
  { ssr: false },
);

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (c.getContext("webgl2") ?? c.getContext("webgl")),
    );
  } catch {
    return false;
  }
}

export default function ExplorePage() {
  const [capable, setCapable] = useState<boolean | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setCapable(hasWebGL() && !reduced);
  }, []);

  if (capable === null) {
    return <div className="h-[100svh] w-full bg-black" />;
  }

  if (!capable) {
    return (
      <main className="grid h-[100svh] place-items-center bg-paper px-6 text-center">
        <div>
          <p className="eyebrow text-ink-faint">WebGL unavailable</p>
          <p className="mt-3 text-ink-soft">This browser can&apos;t run the 3D world.</p>
          <Link href="/" className="btn btn-primary mt-8 inline-block">
            Read the story instead
          </Link>
        </div>
      </main>
    );
  }

  return <Medieval />;
}
