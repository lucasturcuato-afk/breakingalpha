import type { Metadata } from "next";
import { OnboardingMobileHarness } from "./harness";

export const metadata: Metadata = {
  title: "Design preview, mobile onboarding",
  robots: { index: false, follow: false },
};

/**
 * DESIGN PREVIEW HARNESS, NOT A LIVE SURFACE.
 *
 * `/preview/*` is gated to NODE_ENV development by src/proxy.ts, so this
 * route does not exist in production. It follows the pattern already set
 * by /preview/scored-object and /preview/radar.
 *
 * It exists because the real surface cannot be measured. /onboarding is a
 * server component that redirects to /auth without a session and to
 * /dashboard once onboarding_completed is true, so scripts/screen-audit
 * cannot reach the wizard at all, and reaching it for real would mean
 * signing in as a live user and writing to that user's profile. This
 * harness renders the same component against fixtures, at any of the
 * seven steps and any of step 7's three states, with no session and no
 * write.
 *
 *   /preview/onboarding-mobile?step=5
 *   /preview/onboarding-mobile?step=7&preview=loading
 *   /preview/onboarding-mobile?step=7&preview=error
 */
export default function OnboardingMobilePreviewPage() {
  return <OnboardingMobileHarness />;
}
