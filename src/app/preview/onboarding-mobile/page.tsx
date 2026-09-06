import type { Metadata } from "next";
import { OnboardingMobileHarness } from "./harness";

export const metadata: Metadata = {
  title: "Design preview, mobile onboarding",
  robots: { index: false, follow: false },
};

/**
 * DESIGN PREVIEW HARNESS, NOT A LIVE SURFACE.
 *
 * The `/preview/*` clause in src/proxy.ts is a PUBLIC-path clause, not a
 * block. It only decides whether a signed-out reader is bounced to /auth.
 * On production a signed-in allowlisted reader falls straight through it
 * and this route renders. Measured on a production build, not inferred.
 * That is why the banner below is not optional. It follows the pattern
 * already set by /preview/scored-object and /preview/radar.
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
  return (
    <>
      {/* Same non-production banner the sibling harnesses carry, and the same
          reason: this route draws invented content on a real-looking screen,
          so the screen has to say so before anyone reads it. Wording is
          /preview/radar's, with the comma form of the title this file's own
          metadata already uses. */}
      <div className="px-4 pt-4">
        <div
          className="rounded-md border px-4 py-3 font-sans"
          style={{
            borderColor: "var(--signal-warn)",
            background: "color-mix(in srgb, var(--signal-warn) 8%, transparent)",
          }}
        >
          <p className="text-sm font-semibold text-text-primary">
            Design preview, not a live surface
          </p>
          <p className="mt-1 text-[13px] text-text-secondary">
            Fixture states for the onboarding steps. Every value is a fixture and
            nothing is written to a profile. Toggle the app theme for dark mode.
          </p>
        </div>
      </div>
      <OnboardingMobileHarness />
    </>
  );
}
