"use client";

import { useSearchParams } from "next/navigation";
import { DashboardScreen } from "./dashboard-screen";
import { BriefingSplash } from "./briefing-splash";
import { DASH_FIXTURES_ALLOWED, DASH_FIXTURE, type DashStage } from "./fixture";

/**
 * The lifecycle switch, off the URL.
 *
 * The mobile screen has no data source in this unit, so its states cannot be
 * reached by reproducing their conditions, and the runtime audit has to be
 * able to reach each one. `?stage=` does that, the same way `/ledger` does it.
 * The desktop dashboard's own loaders are untouched and keep driving the
 * desktop layout beside this.
 *
 * Split out of the screen so the `useSearchParams` read has its own Suspense
 * boundary and the screen itself stays a plain component.
 */

const STAGES: DashStage[] = ["ready", "loading", "error", "empty", "stale"];

export function MobileDashboardRoute() {
  const params = useSearchParams();
  const raw = params.get("stage");
  const stage = STAGES.includes(raw as DashStage) ? (raw as DashStage) : "ready";

  return (
    <>
      {/* Outside the screen root on purpose: a two-and-a-half second overlay
          is not part of the screen being fingerprinted, and scoping parity to
          `[data-parity="dash"]` should not pick it up. */}
      {/* Gated, and it was not before. The splash is deliberately outside the
          screen root so parity does not fingerprint it, which is also exactly
          why the screen's own gate did not cover it. Ungated, every signed-in
          phone user's first load opened on a 2.6 second full-screen overlay
          reading "142 stories read overnight. One of your calls was checked."
          over a date from the fixture. The count is invented and the claim
          about the reader's own record is false. There is no loader behind any
          of it yet, so in production there is nothing true to say here and the
          screen goes straight to its skeleton. */}
      {DASH_FIXTURES_ALLOWED ? (
        <BriefingSplash
          date={DASH_FIXTURE.date.toUpperCase()}
          headline="Your briefing is ready."
          detail="142 stories read overnight. One of your calls was checked."
        />
      ) : null}
      <DashboardScreen stage={stage} />
    </>
  );
}
