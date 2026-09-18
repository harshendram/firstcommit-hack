import { redirect } from "next/navigation";

/** Legacy link (/family/live) — the family experience now lives on /home. */
export default function LegacyFamilyRedirect() {
  redirect("/home");
}
