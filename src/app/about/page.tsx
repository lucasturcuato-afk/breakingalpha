import { redirect } from "next/navigation";

// /about used to render the OLD landing design (landing-page.tsx) with stale
// copy, while "/" now serves the current landing via opening-screen.tsx. That
// left /about orphaned and inconsistent. This server redirect closes the path:
// any hit on /about (bookmark, old link, or direct URL) lands on the public
// landing at "/". /about stays allowlisted as a public path in src/proxy.ts so
// unauthenticated hits redirect to "/" instead of being bounced to /auth.
export default function AboutPage() {
  redirect("/");
}
