import { AppShell } from "@/components/shell";
import {
  WatchScreen,
  WATCH_FIXTURE,
  type WatchData,
  type WatchStage,
} from "@/components/watch";
import { mobileFixtureScreensEnabled } from "@/lib/mobile-fixture-gate";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { loadWatch } from "@/lib/watch-data";
import { FONT_DISPLAY, FONT_SANS } from "@/components/mobile/fonts";

/**
 * Watch. Server component, so the read happens before a byte of the screen is
 * sent and the queries never reach the browser.
 *
 * WIRED. `src/lib/watch-data.ts` reads the reader's real watchlist, the real
 * articles behind each entry, and their real follows, and gives back the shape
 * `WatchScreen` already consumed. That file's header lists what it refuses to
 * read and why.
 *
 * TWO OF THE DESIGN'S THREE TIERS SHIP. Tracked views do not: `TrackedView`
 * needs the headline a note was written against, and `user_claims` carries no
 * article foreign key, no article_id and no title column. `fixture.ts` records
 * the two ways out; both need an owner and a migration, and this route does not
 * draw an empty-tier notice in the meantime because "No tracked views yet" is a
 * claim about the reader with no read behind it.
 *
 * The tiers live at two separate desktop routes today (/radar/watchlist,
 * /radar/following). Neither is edited to get here: the design dismantles
 * Radar, so mobile Watch lands at its own route and composes rather than
 * rewrites. `matchFollow` is the one genuine reuse, and the loader calls it
 * directly rather than through `/api/radar/following-feed`.
 *
 * WHERE THE SAMPLE CONTENT CAN STILL REACH: a non-production build, and only
 * with nobody signed in. That is exactly the parity harness, the width audits
 * and a signed-out local browse, and it is the same gate `/ledger` uses. A
 * signed-in reader always takes the loader, in every environment, so no real
 * person is shown invented data. The gate fails closed, so a production build
 * takes the loader branch whatever the session turns out to be.
 *
 * ?stage= forces a lifecycle state so the runtime audit can reach each one, and
 * it sits behind THE SAME gate the sample content does. It replaces the old
 * ?view= switch, which reached its states by handing the screen fixtures on a
 * route that had no loader at all.
 */

const STAGES: WatchStage[] = ["ready", "loading", "error", "stale"];

export default async function WatchPage({
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
     type error rather than invented tiers in front of a reader.

     What changed in production. This route used to pass a hand-written
     every-tier-empty shape at `stage: "ready"`, which rendered three empty
     states: "Nothing on your watchlist yet", "You follow nothing yet", "No
     tracked views yet". Every one is a statement about the reader, and none of
     them had a read behind it.
     Then it passed null and the screen said it was not wired. Now there is a
     read, so the empty states it draws are real answers. */
  const data: WatchData | null = sampleAllowed ? WATCH_FIXTURE : (loaded?.data ?? null);
  const stage: WatchStage = (sampleAllowed ? named : null) ?? loaded?.stage ?? "ready";

  return (
    <AppShell pageTitle="Radar" mobileFullBleed>
      {/* The mobile layout is gated on the same breakpoint the shell uses to
          swap the sidebar for the tab bar. Gating lives in classes, never in an
          inline style: an inline display beats the class at every breakpoint. */}
      {/* `h-full` is load bearing, and it is a CLASS not an inline style.
          The screen root carries `minHeight: 100%`, which resolves against
          this wrapper. `PageTransition` above is already `h-full` and
          definite, but this div was `auto`, so the percentage resolved to
          nothing and a short screen ended at its content height. Below that
          line the reader saw `#main-content`'s `bg-parchment` instead of the
          screen's `--c-bg`: a hard seam across the viewport, worst in dark.
          Re-verified on this branch by removing the class and measuring; the
          seam is real and the numbers are in the PR body. One class closes the
          chain, and it stays scoped to this route rather than repainting the
          shell under every mobile screen. */}
      <div className="md:hidden h-full">
        <WatchScreen stage={stage} data={data} />
      </div>

      {/* Above the breakpoint this route has no layout of its own. The desktop
          equivalents already exist under Radar and are not being rebuilt here. */}
      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        <p style={{ margin: 0, font: `500 17px/1.4 ${FONT_DISPLAY}`, color: "var(--c-ink)" }}>
          Watch is a mobile surface.
        </p>
        <p style={{ margin: "10px 0 0", font: `400 13px/1.6 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
          On a wider screen the desk splits it across your watchlist and what you follow.
        </p>
      </div>
    </AppShell>
  );
}
