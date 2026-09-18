import type { Metadata } from "next";
import "./world.css";

export const metadata: Metadata = {
  title: "Explore — Suraksha",
  description: "Walk the village. The museum is the stack, the cottage is the team, the portal comes home.",
};

export default function ExploreLayout({ children }: { children: React.ReactNode }) {
  return children;
}
