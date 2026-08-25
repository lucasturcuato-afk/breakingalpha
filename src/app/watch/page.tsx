import { AppShell } from "@/components/shell";
import {
  WatchScreen,
  WATCH_EMPTY,
  WATCH_FIXTURE,
  type WatchData,
  type WatchStage,
} from "@/components/watch";
import { mobileFixtureScreensEnabled } from "@/lib/mobile-fixture-gate";

/**
 * Watch. One route rendering all three tiers, because the mobile design merges
 * them into one scroll and the handoff's navigation model makes Watch a pole
 * rather than a tab set.
 *
 * The three tiers live at three separate desktop routes today
 * (/radar/calls?views=open, /radar/watchlist, /radar/following). None of those
 * is edited to get here: the design dismantles Radar, so mobile Watch lands at
 * its own route and composes rather than rewrites.
 *
 * THIS SCREEN IS UNWIRED. It has no loader, and rendering a fixture is not
 * done. In production `data` is null and the screen says so; the sample tiers
 * and the state switch below are development and preview only.
 *
 * Server component so it can read the lifecycle switch off the async
 * searchParams, matching /ledger and /waitlist. With no loader the states
 * cannot be reached by reproducing their conditions, and the runtime audit has
 * to be able to reach each one.
 */

/** Query values. `empty` and `partial` are data variants, not screen stages. */
const VIEWS = ["ready", "loading", "error", "stale", "empty", "partial"] as const;
type View = (typeof VIEWS)[number];

function resolve(view: View): { stage: WatchStage; data: WatchData } {
  switch (view) {
    case "empty":
      return { stage: "ready", data: WATCH_EMPTY };
    case "partial":
      /* A follow whose match query errored. Not quiet, and never counted as
         quiet: the tail copy withdraws its "not a failed load" claim and the
         failures are named instead. */
      return {
        stage: "ready",
        data: { ...WATCH_FIXTURE, followsQuiet: 1, followsCouldNotCheck: ["NEE", "SO"] },
      };
    case "loading":
    case "error":
    case "stale":
      return { stage: view, data: WATCH_FIXTURE };
    default:
      return { stage: "ready", data: WATCH_FIXTURE };
  }
}

export default async function WatchPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.view) ? params.view[0] : params.view;

  /* THE GATE IS RESOLVED HERE and the result is passed down. The screen has no
     default and no `??` fallback on the data itself, so a deleted gate is a
     type error rather than invented tiers in front of a reader.
     `mobileFixtureScreensEnabled()` is the one gate for the whole mobile
     programme; this file used to read a second copy of it out of `fixture.ts`.

     What changed in production. This route used to pass `WATCH_EMPTY` at
     `stage: "ready"`, which rendered three empty states: "Nothing on your
     watchlist yet", "You follow nothing yet", "No tracked views yet". Every
     one is a statement about the reader, and none of them had a read behind
     it. Null instead, and the screen says it is not wired. */
  const fixtureAllowed = mobileFixtureScreensEnabled();
  const view: View = fixtureAllowed && VIEWS.includes(raw as View) ? (raw as View) : "ready";
  const resolved = fixtureAllowed ? resolve(view) : null;

  return (
    <AppShell pageTitle="Watch" mobileFullBleed>
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
          One class closes the chain, and it stays scoped to this route rather
          than repainting the shell under every mobile screen. */}
      <div className="md:hidden h-full">
        <WatchScreen stage={resolved?.stage ?? "ready"} data={resolved === null ? null : resolved.data} />
      </div>

      {/* Above the breakpoint this route has no layout of its own. The desktop
          equivalents already exist under Radar and are not being rebuilt here. */}
      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        <p style={{ margin: 0, font: "500 17px/1.4 'Playfair Display', serif", color: "var(--c-ink)" }}>
          Watch is a mobile surface.
        </p>
        <p style={{ margin: "10px 0 0", font: "400 13px/1.6 Inter, sans-serif", color: "var(--c-secondary)" }}>
          On a wider screen the desk splits it across your tracked views, your watchlist and what you follow.
        </p>
      </div>
    </AppShell>
  );
}
