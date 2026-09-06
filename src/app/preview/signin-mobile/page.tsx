import type { Metadata } from "next";
import { SigninMobileHarness } from "./harness";

export const metadata: Metadata = {
  title: "Design preview, mobile sign in",
  robots: { index: false, follow: false },
};

/**
 * DESIGN PREVIEW HARNESS, NOT A LIVE SURFACE.
 *
 * The `/preview/*` clause in src/proxy.ts is a PUBLIC-path clause, not a
 * block. It only decides whether a signed-out reader is bounced to /auth.
 * On production a signed-in allowlisted reader falls straight through it
 * and this route renders a screen that looks exactly like /auth. Measured
 * on a production build, not inferred. Same pattern as
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
            Fixture states for the sign in screen. Nothing here authenticates and
            nothing reaches Supabase. Toggle the app theme for dark mode.
          </p>
        </div>
      </div>
      <SigninMobileHarness />
    </>
  );
}
