import type { Metadata } from "next";
import { SigninMobileHarness } from "./harness";

export const metadata: Metadata = {
  title: "Design preview, mobile sign in",
  robots: { index: false, follow: false },
};

/**
 * DESIGN PREVIEW HARNESS, NOT A LIVE SURFACE.
 *
 * `/preview/*` is gated to NODE_ENV development by src/proxy.ts, so this
 * route does not exist in production. Same pattern as
 * /preview/onboarding-mobile and /preview/scored-object.
 *
 * `MobileAuth` keeps no state of its own: /auth owns every flag and
 * passes it down. That makes the screen fully testable and untestable at
 * same time, because reaching its in-flight, failed and check-email
 * states on the real route means driving Supabase. This renders the same
 * component with each flag set directly, so a screen audit can measure
 * every state without a network call.
 *
 *   /preview/signin-mobile?state=form
 *   /preview/signin-mobile?state=adopt
 *   /preview/signin-mobile?state=loading
 *   /preview/signin-mobile?state=error
 *   /preview/signin-mobile?state=email
 */
export default function SigninMobilePreviewPage() {
  return <SigninMobileHarness />;
}
