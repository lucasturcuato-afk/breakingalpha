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
 * Radar / Following, on a phone. Server component, so the read happens before
 * a byte of the screen is sent and the queries never reach the browser.
 *
 * THIS ROUTE IS NOW ONE OF FOUR, and that is the change. It used to be the
 * whole of mobile Radar: one scroll, a watchlist tier and a following tier,
 * mastheaded "Radar" and led by the watchlist. The desk has four tabs, so a
 * reader who knew the desk arrived here and found Calls and Desk record
 * missing, and this surface read as a renamed watchlist. `/watch`,
 * `/watch/watchlist`, `/watch/calls` and `/watch/desk-record` are now the same
 * four sections, in the same order, under the same four words, and
 * `RadarSegments` is the row between them. The handoff said Calls and the
 * record live under the Ledger on the phone; this is a deliberate override of
 * it and the reasoning is in `decisions/mobile-radar-mirrors-the-desk.md`.
 *
 * IT IS FOLLOWING, AND THAT MIRRORS THE DESK. `src/app/radar/page.tsx` sends
 * the bare desk route to Following, so the bare phone route draws Following. It
 * DRAWS it rather than redirecting to a `/watch/following`, because this route
 * is the Radar pole's own destination in `mobile-tab-bar.tsx`, and a pole that
 * bounces through a redirect on every tap spends a navigation arriving nowhere
 * new.
 *
 * NO EDIT TO THE POLE TABLE WAS NEEDED, and that is worth stating because the
 * obvious guess is that four new routes need four new entries. `isActive`
 * matches a path prefix and the Radar pole already owns `/watch`, so all four
 * sections light Radar. The Ledger pole owns `/radar/calls`, not
 * `/watch/calls`, so no section lights two poles.
 *
 * WIRED. `src/lib/watch-data.ts` reads the reader's real watchlist, the real
 * articles behind each entry, and their real follows, and gives back the shape
 * `WatchScreen` already consumed. That file's header lists what it refuses to
 * read and why. One loader still serves both this route and
 * `/watch/watchlist`; splitting the sections split the SCREEN, never the read,
 * and `loadWatch` is called once per route for the section that route draws.
 *
 * TRACKED VIEWS STILL DO NOT SHIP, and the reason is unchanged: a tracked view
 * is a claim with no direction and no window on it, and measured read-only on
 * 2026-08-29, across the whole table and every account, no such row exists.
 * `src/components/watch/omissions.ts` carries the measurement. The tier is
 * absent SILENTLY under the ruling of 2026-08-29: nothing on this screen names
 * a third tier, no figure counts claims, and no rendered line becomes wrong
 * without the note.
 *
 * WHERE THE SAMPLE CONTENT CAN STILL REACH: a non-production build, and only
 * with nobody signed in. That is exactly the parity harness, the width audits
 * and a signed-out local browse, and it is the same gate `/ledger` uses. A
 * signed-in reader always takes the loader, in every environment, so no real
 * person is shown invented data. The gate fails closed, so a production build
 * takes the loader branch whatever the session turns out to be.
 *
 * ?stage= forces a lifecycle state so the runtime audit can reach each one, and
 * it sits behind THE SAME gate the sample content does.
 */

const STAGES: WatchStage[] = ["ready", "loading", "error", "stale"];

export default async function RadarFollowingMobilePage({
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
        <WatchScreen
          stage={stage}
          data={data}
          segment="following"
          nav={<RadarSegments active="following" />}
        />
      </div>

      {/* Above the breakpoint this route has no layout of its own. The desktop
          equivalents already exist under Radar and are not being rebuilt here. */}
      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        <p style={{ margin: 0, font: `500 17px/1.4 ${FONT_DISPLAY}`, color: "var(--c-ink)" }}>
          Radar is four sections on a phone.
        </p>
        <p style={{ margin: "10px 0 0", font: `400 13px/1.6 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
          On a wider screen the desk draws the same four as tabs, at /radar/following.
        </p>
      </div>
    </AppShell>
  );
}
