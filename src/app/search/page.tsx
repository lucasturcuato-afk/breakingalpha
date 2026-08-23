import { SearchScreen, type SearchStage } from "@/components/search";

/**
 * /search. A new route, and a mobile one.
 *
 * Server component so it can read the lifecycle switch and the seed query off
 * the async searchParams, matching the pattern already used at /ledger and
 * /waitlist. The screen has no backend in this unit, so its states cannot be
 * reached by reproducing their conditions and the runtime audit has to be able
 * to reach each one by URL:
 *
 *   /search                    the jump list
 *   /search?q=constellation    entity results
 *   /search?q=zzz              no results
 *   /search?stage=loading      in flight
 *   /search?stage=error        a failed read
 *
 * NO AppShell. This is the one thing about this file that looks like an
 * omission and is not. The prototype gates its bottom bar on
 * `showNav: ['dash','ledger','watch','ask'].includes(s.screen)` at line 3460;
 * `search` is absent, so the surface renders full screen with no bar and no
 * pole lit. That is DECISIONS.md open item O2, a recorded design bug, and this
 * reproduces it rather than resolving it. `AppShell` mounts `MobileTabBar`
 * unconditionally, so wrapping the screen in the shell would put a bar on a
 * surface the design draws without one, and `mobile-tab-bar.tsx` is not this
 * unit's file to edit either way. Search is the fourth screen to land on O2,
 * after Evening Wrap, Claim and Deal Flow.
 *
 * The route is reachable unauthenticated in local dev only, through
 * `MOBILE_REDESIGN_DEV_PATHS` in `src/proxy.ts`, which already carries
 * `/search`. That file is untouched here.
 */

const STAGES: SearchStage[] = ["ready", "loading", "error"];

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string | string[]; q?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = one(params.stage);
  const stage = STAGES.includes(raw as SearchStage) ? (raw as SearchStage) : "ready";

  return (
    <>
      {/* Gating lives in a CLASS and this wrapper carries no inline style at
          all. An inline display beats the class at every breakpoint, which is
          the defect that shipped the tab bar to desktop once already. */}
      <div className="md:hidden">
        <SearchScreen stage={stage} initialQuery={one(params.q)} />
      </div>

      {/* Above the breakpoint this route has no layout of its own. The desktop
          jump surface already exists as the command palette, on every page,
          and is not being rebuilt or rerouted here. */}
      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        <p style={{ margin: 0, font: "500 17px/1.4 'Playfair Display', serif", color: "var(--c-ink)" }}>
          Search is a mobile surface.
        </p>
        <p style={{ margin: "10px 0 0", font: "400 13px/1.6 Inter, sans-serif", color: "var(--c-secondary)" }}>
          On a wider screen the desk opens the command palette instead. Press Command K, or Control
          K.
        </p>
      </div>
    </>
  );
}
