import { redirect } from "next/navigation";

// /preview is not an advertised surface. It was reachable by backing out of the
// /auth flow, which handed out product access we are not giving during early
// access. This server redirect closes that path: any hit on /preview (bookmark,
// back-navigation, or direct URL) lands on the public landing at "/". The
// dev-only fixture harnesses under /preview/radar and /preview/scored-object are
// separate routes and remain gated to NODE_ENV development by src/proxy.ts.
export default function PreviewPage() {
  redirect("/");
}
