"use client";

import { useEffect, useState } from "react";
import { BrandMark } from "./BrandMark";
import { cn } from "@/lib/utils";
import { appHref } from "@/lib/config";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 18);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-[background,border-color,backdrop-filter] duration-400",
        scrolled
          ? "border-b border-line bg-paper/80 backdrop-blur-xl"
          : "border-b border-transparent"
      )}
    >
      <div className="mx-auto flex max-w-[1180px] items-center justify-between px-[clamp(20px,5vw,64px)] py-[clamp(18px,2.8vh,28px)]">
        <BrandMark />
        <nav className="flex items-center gap-6 md:gap-8">
          <a href="#how" className="nav-link hidden md:inline">
            How it works
          </a>
          <a href="#stack" className="nav-link hidden md:inline">
            Stack
          </a>
          <a href={appHref("/parent")} className="nav-link hidden md:inline">
            Parent
          </a>
          <a href={appHref("/home")} className="nav-cta">
            Family home
          </a>
        </nav>
      </div>
    </header>
  );
}
