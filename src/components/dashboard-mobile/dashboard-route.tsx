"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DashboardScreen } from "./dashboard-screen";
import { BriefingSplash } from "./briefing-splash";
import { DASH_FIXTURES_ALLOWED } from "./fixture-gate";
import type { DashboardData, DashStage } from "./fixture";

/**
 * The mobile Dashboard's mount point, and the one place the sample content can
 * be reached.
 *
 * TWO PATHS, AND ONLY THE FIRST ONE EXISTS IN PRODUCTION.
 *
 * The real path takes `data` and `stage` from `/dashboard`, which builds them
 * out of the reads it already runs for the desktop layout. Null data draws the
 * loading skeleton. No fixture is involved, no splash renders, and nothing on
 * screen is authored by this file.
 *
 * The preview path exists so the design can be fingerprinted. Parity compares
 * the built screen against the prototype's demo content, which no live account
 * reproduces, so the sample data has to be reachable somewhere. It needs BOTH
 * an explicit `?stage=` in the URL AND `DASH_FIXTURES_ALLOWED`, and it loads
 * the fixture through a dynamic import so the prose is not in the bundle a
 * production reader downloads. Neither condition can be met by a signed-in
 * reader on production.
 *
 * The splash lives on the preview path only. It is a full-screen overlay
 * reading "142 stories read overnight. One of your calls was checked." Both
 * halves are sample content; the second is a claim about the reader's own
 * record. It was once ungated and opened every signed-in phone load, because
 * it sits OUTSIDE the screen root so parity would not fingerprint it, which is
 * exactly why the screen's own gate did not cover it. Nothing true is
 * available to put in its place yet, so on the real path it does not render.
 */

const STAGES: DashStage[] = ["ready", "loading", "error", "empty", "stale"];

/**
 * The sample content, loaded on demand and only behind the gate.
 *
 * A static import would ship the prose to every reader whether or not the gate
 * ever lets it paint, which is what `fixture-in-client-bundle` catches. The
 * gate itself is a boolean in its own module, so reading it costs nothing.
 */
interface FixturePreview {
  data: DashboardData;
  splash: { date: string; headline: string; detail: string };
}

function useFixturePreview(stage: DashStage | null): FixturePreview | null {
  const [preview, setPreview] = useState<FixturePreview | null>(null);

  useEffect(() => {
    if (!stage || !DASH_FIXTURES_ALLOWED) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    void import("./fixture").then((mod) => {
      if (cancelled) return;
      setPreview({
        data: stage === "empty" ? mod.DASH_FIXTURE_EMPTY : mod.DASH_FIXTURE,
        splash: mod.DASH_SPLASH,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [stage]);

  return preview;
}

export function MobileDashboardRoute({
  data,
  stage,
}: {
  /** REQUIRED and NULLABLE, resolved by the caller. Null draws the skeleton. */
  data: DashboardData | null;
  stage: DashStage;
}) {
  const params = useSearchParams();
  const raw = params.get("stage");
  const requested = STAGES.includes(raw as DashStage) ? (raw as DashStage) : null;
  const previewStage = requested && DASH_FIXTURES_ALLOWED ? requested : null;
  const preview = useFixturePreview(previewStage);

  if (previewStage) {
    return (
      <>
        {preview ? (
          <BriefingSplash
            date={preview.splash.date}
            headline={preview.splash.headline}
            detail={preview.splash.detail}
          />
        ) : null}
        <DashboardScreen stage={previewStage} data={preview?.data ?? null} />
      </>
    );
  }

  return <DashboardScreen stage={stage} data={data} />;
}
