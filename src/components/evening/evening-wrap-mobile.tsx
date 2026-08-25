"use client";

import { useSearchParams } from "next/navigation";
import { EveningWrapScreen, type WrapStage } from "./evening-wrap-screen";

/**
 * The mobile Evening Wrap, with its lifecycle switch read off the URL.
 *
 * `?stage=` renders a lifecycle state directly, matching the pattern
 * `src/app/ledger/page.tsx` established. The screen has no data source in this
 * unit, so the states cannot be reached by reproducing their conditions, and
 * the runtime audit has to be able to reach each one.
 *
 * The reader lives here rather than in the page because `/evening-wrap` is one
 * large client component and `useSearchParams` needs a Suspense boundary above
 * whatever calls it. The page can wrap this; it could not wrap itself.
 */

const STAGES: WrapStage[] = ["ready", "loading", "none", "error", "stale"];

export function EveningWrapMobile() {
  const params = useSearchParams();
  const raw = params.get("stage");
  const stage = STAGES.includes(raw as WrapStage) ? (raw as WrapStage) : "ready";
  return <EveningWrapScreen stage={stage} />;
}
