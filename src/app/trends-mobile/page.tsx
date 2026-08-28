import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/shell";
import { TrendsScreen, type TrendsPreview, type TrendsStage } from "@/components/trends-mobile";
/* Imported by path, never through the barrel. The barrel is reachable from the
   client graph through `trends-screen`, so pulling the rows through it would
   put the fixture prose back in the browser bundle. This page is a server
   component, so from here the rows stay on the server. */
import { FIXTURE_ALLOWED } from "@/components/trends-mobile/fixture-gate";
import {
  TRENDS_ANCHOR_MS,
  trendsFixture,
  trendsStaleFixture,
} from "@/components/trends-mobile/fixture";
import { FONT_DISPLAY, FONT_SANS } from "@/components/mobile/fonts";

/**
 * Mobile Trends, step 10.
 *
 * Lands here rather than at `/trends`. `src/app/trends/page.tsx` is a
 * propose-only file under CLAUDE.md and is not edited by this unit; the mobile
 * list is a new file that reads the same table through the same predicate and
 * shares its derivations through `@/lib/trend-signals`. The desktop route
 * keeps its modal, its sector and activity filter rows and its signed-out
 * preview, all untouched.
 *
 * The Ask pole already owns this path: `mobile-tab-bar.tsx` carries
 * `/trends-mobile` in its `owns` list, added by the foundation PR, so the pole
 * lights on arrival without this unit touching that file.
 *
 * `src/proxy.ts` opens the path in DEV AND PREVIEW, not local dev only:
 * `isMobileRedesignDevPath` is true when `NODE_ENV !== 'production'` OR
 * `VERCEL_ENV === 'preview'`. In production the predicate is false and the
 * route falls back to the ordinary auth and beta-allowlist gates.
 *
 * That is an access gate, NOT a fixture gate, and it is not a second line of
 * defence for the rows below. A signed-in, allowlisted reader reaches this
 * route on production perfectly legitimately. The only thing standing between
 * them and three invented clusters is `FIXTURE_ALLOWED`, checked here and
 * re-checked inside `TrendsScreen`.
 *
 * Server component so it can read `?stage=` off the async searchParams,
 * matching `/ledger`. The stage switch is a development and preview
 * affordance: the runtime audit has to be able to reach loading, error, empty
 * and stale, and those cannot be reached by reproducing their conditions
 * against a live table. The gate fails closed, so a production build ignores
 * the parameter entirely and always takes the live loader.
 */

export const metadata: Metadata = {
  title: "Trends | Signalera",
};

const STAGES: TrendsStage[] = ["ready", "loading", "error", "empty", "stale"];

export default async function TrendsMobilePage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.stage) ? params.stage[0] : params.stage;

  /* Three cases, and the difference between the last two is the point.
     - Production: `FIXTURE_ALLOWED` is false, so the fixture is unreachable at
       any URL and the screen always takes the live loader. This is the case
       that matters, because real readers do reach this route in production.
     - Preview: a named `?stage=` reaches the fixture, and a bare URL does NOT.
       A reader who taps the Ask pole on a preview build lands on live rows,
       not on three invented clusters presented as the tape.
     - Local dev: a bare URL defaults to the fixture, because the parity and
       audit runs drive the bare URL and have to land on a deterministic
       screen. `?stage=live` exercises the real loader from here. */
  const bareDefault: TrendsStage | null =
    process.env.NODE_ENV === "development" ? "ready" : null;
  const stage: TrendsStage | null =
    FIXTURE_ALLOWED && raw !== "live"
      ? STAGES.includes(raw as TrendsStage)
        ? (raw as TrendsStage)
        : bareDefault
      : null;

  /* The rows are built HERE, on the server, and passed down as data. The screen
     does not import the fixture module, so none of that invented cluster prose
     is emitted into a client chunk on any build. `TrendsScreen` re-checks the
     same gate before it renders whatever it is handed, so this page being wrong
     would not be enough on its own. */
  const preview: TrendsPreview | null =
    stage === null
      ? null
      : {
          stage,
          /* The fixture's fixed anchor, not `Date.now()`. Reading a wall clock
             during render is impure, and seeding one in the client component
             put the server pass and the hydration pass on two different
             milliseconds. The live path reads the real clock in its fetch
             effect instead. */
          now: TRENDS_ANCHOR_MS,
          signals:
            stage === "ready"
              ? trendsFixture()
              : stage === "stale"
                ? trendsStaleFixture()
                : [],
        };

  return (
    <AppShell pageTitle="Trends" mobileFullBleed>
      {/* Gating lives in a class, never in an inline style: an inline display
          beats the class at every breakpoint. This wrapper carries no inline
          layout property for that reason. */}
      <div className="md:hidden">
        <TrendsScreen preview={preview} />
      </div>

      {/* Above the breakpoint the desk already has a Trends surface, with
          filters and a signal modal this screen does not rebuild. */}
      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        <p style={{ margin: 0, font: `500 17px/1.4 ${FONT_DISPLAY}`, color: "var(--c-ink)" }}>
          Trends is a mobile surface.
        </p>
        <p style={{ margin: "10px 0 0", font: `400 13px/1.6 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
          On a wider screen the desk draws the full list, with sector and activity filters.
        </p>
        <Link
          href="/trends"
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: "44px",
            marginTop: "10px",
            font: `500 13px/1 ${FONT_SANS}`,
            color: "var(--c-goldink)",
          }}
        >
          Open the desk view
        </Link>
      </div>
    </AppShell>
  );
}
