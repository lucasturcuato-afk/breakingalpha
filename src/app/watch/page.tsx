import { AppShell } from "@/components/shell";
import {
  WatchScreen,
  WATCH_EMPTY,
  WATCH_FIXTURE,
  WATCH_FIXTURE_ALLOWED,
  type WatchData,
  type WatchStage,
} from "@/components/watch";

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
 * Server component so it can read the lifecycle switch off the async
 * searchParams, matching /ledger and /waitlist. The screen has no loader in
 * this unit, so the states cannot be reached by reproducing their conditions
 * and the runtime audit has to be able to reach each one.
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

  /* Sample content, and the switch that reaches it, are development and
     preview only. The tiers draw a desk's own tracked views, watchlist and
     follows, so shipping invented ones to a signed-in user would put words in
     their mouth. Production gets the empty data and the empty states until a
     real loader lands. The gate fails closed. */
  const view: View = WATCH_FIXTURE_ALLOWED && VIEWS.includes(raw as View)
    ? (raw as View)
    : "ready";
  const resolved = WATCH_FIXTURE_ALLOWED
    ? resolve(view)
    : { stage: "ready" as WatchStage, data: WATCH_EMPTY };

  return (
    <AppShell pageTitle="Watch" mobileFullBleed>
      {/* The mobile layout is gated on the same breakpoint the shell uses to
          swap the sidebar for the tab bar. Gating lives in classes, never in an
          inline style: an inline display beats the class at every breakpoint. */}
      <div className="md:hidden">
        <WatchScreen stage={resolved.stage} data={resolved.data} />
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
