"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EveningWrapScreen, type WrapStage } from "./evening-wrap-screen";
import { mobileFixtureScreensEnabled } from "@/lib/mobile-fixture-gate";
/* TYPE ONLY. The value import that used to sit here is the defect this file
   now closes; see the note on `useSampleWrap` below. Types erase. */
import type { EveningWrapData } from "./fixture";

/**
 * The mobile Evening Wrap, wired.
 *
 * WHAT CHANGED. This used to be the whole story: it read `?stage=` off the URL
 * and handed the screen a gated fixture, so the screen drew sample content in
 * development and a permanent skeleton anywhere else. The page above it has
 * always held the real reads. The page now resolves them and passes the result
 * down, and this component is three things and nothing else: the
 * Suspense-bound reader of the URL, the sample switch parity is measured
 * through, and the pass-through.
 *
 * `stage` and `data` are the page's answer, and they are what a reader gets.
 *
 * THE TWO URL SWITCHES ARE DEVELOPMENT ONLY, which matters now in a way it did
 * not before. This screen reaches real readers, so `?stage=stale` against a
 * live wrap would draw a stale notice over current numbers and `?fixture=1`
 * would draw invented index levels. Both are gated on
 * `mobileFixtureScreensEnabled()`, which fails closed on production, so in
 * front of a reader neither parameter does anything at all.
 *
 *   ?stage=     drives the lifecycle states for the runtime audit. Several of
 *               them cannot be reached by reproducing their conditions to
 *               order.
 *   ?fixture=1  draws the design's own sample content, which is what the
 *               parity harness has to compare against. Parity keys elements by
 *               their text, so a run against a live wrap pairs almost nothing
 *               and reports a clean diff that measured nothing.
 *
 * FIXED HERE. `EVENING_FIXTURE` used to be a static value import in this
 * "use client" module and referenced in the returned tree, so its prose was
 * unshakeable and shipped in `.next/static` on every production build even
 * though the gate made it unpaintable. That was the `fixture-in-client-bundle`
 * finding on this file. The earlier note said closing it needed the sample
 * resolved on a server component and that `/evening-wrap` has no server
 * boundary to resolve it on. The first half is wrong: a dev-only dynamic
 * import closes it without one. The second half is still true and is why the
 * `/watch` shape, where a server page resolves the sample and passes it down,
 * was not available here.
 */

const STAGES: WrapStage[] = ["ready", "loading", "none", "error", "stale"];

/**
 * The design's own sample wrap, loaded on demand and only off production.
 *
 * WHY THE LITERAL IS WRITTEN OUT HERE. `mobileFixtureScreensEnabled()` is a
 * function in another module, and `DASH_FIXTURES_ALLOWED` next door is an
 * imported constant. Neither folds at this call site: Turbopack inlines
 * `process.env.NODE_ENV` inside the module that reads it and does not
 * propagate the result across a module boundary. A guard written either of
 * those ways leaves the `import()` reachable, and a reachable `import()` is
 * emitted as its own chunk under `.next/static/chunks/`, which is public and
 * needs no session. Written as the literal below it folds to `if (true)
 * return;` at build time, the `import()` is unreachable, and no chunk is
 * emitted. Verified by grepping the built output.
 *
 * Null is the honest answer while the module is in flight, and it is the
 * permanent answer on production. The caller draws `loading` for it rather
 * than `ready` over nothing.
 */
function useSampleWrap(wanted: boolean): EveningWrapData | null {
  const [sample, setSample] = useState<EveningWrapData | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (!wanted) {
      setSample(null);
      return;
    }
    let cancelled = false;
    void import("./fixture").then((mod) => {
      if (!cancelled) setSample(mod.EVENING_FIXTURE);
    });
    return () => {
      cancelled = true;
    };
  }, [wanted]);

  return sample;
}

export function EveningWrapMobile({
  stage,
  data,
}: {
  /** The lifecycle the page's own loaders landed on. */
  stage: WrapStage;
  /** The mapped wrap, or null while the read is in flight. Never a default. */
  data: EveningWrapData | null;
}) {
  const params = useSearchParams();
  const devSwitches = mobileFixtureScreensEnabled();

  const sample = devSwitches && params.get("fixture") === "1";
  const requested = params.get("stage");
  const override =
    devSwitches && STAGES.includes(requested as WrapStage) ? (requested as WrapStage) : null;

  const sampleData = useSampleWrap(sample);

  /* `sample && !sampleData` is the module still loading, which only ever
     happens off production and only for a frame. Drawing `ready` there would
     put the screen's ready state over no data; `loading` is what is true. */
  const sampleStage: WrapStage = sampleData ? "ready" : "loading";

  return (
    <EveningWrapScreen
      stage={override ?? (sample ? sampleStage : stage)}
      data={sample ? sampleData : data}
    />
  );
}
