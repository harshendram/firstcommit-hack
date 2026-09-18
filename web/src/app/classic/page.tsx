import { redirect } from "next/navigation";

/** The written landing is `/` in this app. Keep /classic so old world links still work. */
export default function ClassicRedirect() {
  redirect("/");
}
