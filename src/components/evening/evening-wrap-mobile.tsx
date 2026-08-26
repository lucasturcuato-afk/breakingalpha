"use client";

import { useSearchParams } from "next/navigation";
import { EveningWrapScreen, type WrapStage } from "./evening-wrap-screen";
import { EVENING_FIXTURE } from "./fixture";
import { mobileFixtureScreensEnabled } from "@/lib/mobile-fixture-gate";
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
 * KNOWN, AND NOT FIXED HERE. `EVENING_FIXTURE` is imported by a client
 * component, so its prose ships in `.next/static` even though the gate makes
 * it unpaintable on production. That is the pre-existing
 * `fixture-in-client-bundle` finding on this file. Closing it needs the sample
 * resolved on a server component, and `/evening-wrap` is one large client
 * page with no server boundary to resolve it on. Said out loud in the PR body
 * rather than worked around.
 */

const STAGES: WrapStage[] = ["ready", "loading", "none", "error", "stale"];

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

  return (
    <EveningWrapScreen
      stage={override ?? (sample ? "ready" : stage)}
      data={sample ? EVENING_FIXTURE : data}
    />
  );
}
