import { AppShell } from "@/components/shell";
import {
  WatchScreen,
  WATCH_FIXTURE,
  type WatchData,
  type WatchStage,
} from "@/components/watch";
import { RadarSegments } from "@/components/radar-mobile/radar-segments";
import { mobileFixtureScreensEnabled } from "@/lib/mobile-fixture-gate";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { loadWatch } from "@/lib/watch-data";
import { FONT_DISPLAY, FONT_SANS } from "@/components/mobile/fonts";

/**
 * Radar / Watchlist, on a phone. The second of Radar's four sections.
 *
 * SAME LOADER, SAME SCREEN, DIFFERENT SECTION. This route and `/watch` call the
 * one `loadWatch` and render the one `WatchScreen`; the `segment` prop decides
 * which tier is drawn. There is no second read of a watchlist anywhere in this
 * surface and no second component that knows how to draw one. Splitting Radar
 * into four routes split the SCREEN, deliberately, and never the read.
 *
 * IT IS NOT AN EDIT TO `/radar/watchlist`, and it must not become one. That
 * page carries a runtime `isMobile` state driven by a resize listener, and its
 * left column is `display: none` below 768 while its own empty copy tells the
 * reader to "Add tickers, companies, or sectors in the left panel". Two things
 * follow. First, adding a third arm to that branch is the exact shape the house
 * rule forbids: a wrapper beside it, never a branch inside it, so this route is
 * built beside it and that file is untouched. Second, THAT COPY IS NOT
 * REPRODUCED HERE. The empty state on this screen names the desk and links to
 * it, so a phone reader is given a destination they can actually reach rather
 * than a panel their viewport does not draw.
 *
 * WHAT THIS SECTION DOES NOT DRAW, and none of it says so on screen, under the
 * ruling of 2026-08-29 that absence is narrated only when it would mislead:
 *
 *   the gallery hero  The design promotes one entry to a pinned hero carrying
 *                     "today's strongest story". No column ranks a reader's own
 *                     names against each other, and a winner derived from
 *                     `published_at` is a timestamp dressed as a judgement.
 *                     Every entry renders as the same card, so nothing on
 *                     screen implies a rank that is then missing.
 *   an add control    `/watch` has never had one and is not getting one here.
 *                     The empty state links to the desk that does.
 *
 * The sample-content gate and the `?stage=` switch behave exactly as they do on
 * `/watch`; that route's header carries the full reasoning for both.
 */

const STAGES: WatchStage[] = ["ready", "loading", "error", "stale"];

export default async function RadarWatchlistMobilePage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.stage) ? params.stage[0] : params.stage;
  const named = STAGES.includes(raw as WatchStage) ? (raw as WatchStage) : null;

  const { supabase, user } = await getSupabaseWithUser();
  const sampleAllowed = user === null && mobileFixtureScreensEnabled();

  const loaded = sampleAllowed ? null : await loadWatch(supabase, user?.id ?? null);

  /* THE GATE IS RESOLVED HERE and the result is passed down. The screen has no
     default and no `??` fallback on the data itself, so a deleted gate is a
     type error rather than an invented watchlist in front of a reader. */
  const data: WatchData | null = sampleAllowed ? WATCH_FIXTURE : (loaded?.data ?? null);
  const stage: WatchStage = (sampleAllowed ? named : null) ?? loaded?.stage ?? "ready";

  return (
    <AppShell pageTitle="Radar" mobileFullBleed>
      {/* Gated in a CLASS, never an inline style: an inline display beats the
          class at every breakpoint, which is design-lint rule 10. */}
      {/* `h-full` is load bearing and it is a CLASS. The screen root carries
          `minHeight: 100%`, which resolves against this wrapper; without a
          definite height here the percentage resolves to nothing and a short
          screen ends at its content height, showing `#main-content`'s
          `bg-parchment` below it as a hard seam, worst in dark. The same
          measured comment stands on `/watch`, `/ledger` and `/desk-record`. */}
      <div className="md:hidden h-full">
        <WatchScreen
          stage={stage}
          data={data}
          segment="watchlist"
          nav={<RadarSegments active="watchlist" />}
        />
      </div>

      {/* Above the breakpoint the desktop equivalent already exists at
          /radar/watchlist and is not being rebuilt or edited here. */}
      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        <p style={{ margin: 0, font: `500 17px/1.4 ${FONT_DISPLAY}`, color: "var(--c-ink)" }}>
          Radar is four sections on a phone.
        </p>
        <p style={{ margin: "10px 0 0", font: `400 13px/1.6 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
          On a wider screen the desk draws the same four as tabs, at /radar/watchlist.
        </p>
      </div>
    </AppShell>
  );
}
