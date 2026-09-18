import { redirect } from "next/navigation";

/** Convenience: /family → /family/live (binds to the current live session). */
export default function FamilyIndexPage() {
  redirect("/family/live");
}
