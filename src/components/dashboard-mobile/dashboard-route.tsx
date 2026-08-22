"use client";

import { useSearchParams } from "next/navigation";
import { DashboardScreen } from "./dashboard-screen";
import { BriefingSplash } from "./briefing-splash";
import { DASH_FIXTURE, type DashStage } from "./fixture";

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
      <BriefingSplash
        date={DASH_FIXTURE.date.toUpperCase()}
        headline="Your briefing is ready."
        detail="142 stories read overnight. One of your calls was checked."
      />
      <DashboardScreen stage={stage} />
    </>
  );
}
