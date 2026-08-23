import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/shell";
import { FIXTURE_ALLOWED, TrendsScreen, type TrendsStage } from "@/components/trends-mobile";

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
 * `src/proxy.ts` opens the path in LOCAL DEV ONLY. In production it stays
 * behind the auth and allowlist gates like every other step 3 to 12 route.
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

  /* `?stage=live` in development takes the real loader, so the data path this
     screen ships with can be exercised without a production build. */
  const stage: TrendsStage | null =
    FIXTURE_ALLOWED && raw !== "live"
      ? STAGES.includes(raw as TrendsStage)
        ? (raw as TrendsStage)
        : "ready"
      : null;

  return (
    <AppShell pageTitle="Trends" mobileFullBleed>
      {/* Gating lives in a class, never in an inline style: an inline display
          beats the class at every breakpoint. This wrapper carries no inline
          layout property for that reason. */}
      <div className="md:hidden">
        <TrendsScreen stage={stage} />
      </div>

      {/* Above the breakpoint the desk already has a Trends surface, with
          filters and a signal modal this screen does not rebuild. */}
      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        <p style={{ margin: 0, font: "500 17px/1.4 'Playfair Display', serif", color: "var(--c-ink)" }}>
          Trends is a mobile surface.
        </p>
        <p style={{ margin: "10px 0 0", font: "400 13px/1.6 Inter, sans-serif", color: "var(--c-secondary)" }}>
          On a wider screen the desk draws the full list, with sector and activity filters.
        </p>
        <Link
          href="/trends"
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: "44px",
            marginTop: "10px",
            font: "500 13px/1 Inter, sans-serif",
            color: "var(--c-goldink)",
          }}
        >
          Open the desk view
        </Link>
      </div>
    </AppShell>
  );
}
