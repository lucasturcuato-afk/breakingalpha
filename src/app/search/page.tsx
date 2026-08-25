import Link from "next/link";
import { SearchScreen, SEARCH_FIXTURE_ENABLED, type SearchStage } from "@/components/search";
/* Imported by path, never through the barrel. The barrel is reachable from the
   client graph through `search-screen`, so pulling the invented result set
   through it would put it back in the browser bundle. This page is a server
   component, so from here it stays on the server unless the gate is open. */
import { SEARCH_FIXTURE } from "@/components/search/fixture";

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
 *   /search?stage=unwired      what production draws: no source behind the
 *                              entity half, so no search ran and none is
 *                              running. Forced whenever the fixture gate is
 *                              closed, whatever ?stage= says.
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

const STAGES: SearchStage[] = ["ready", "loading", "error", "unwired"];

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
  const query = one(params.q);

  return (
    <>
      {/* Gating lives in a CLASS and this wrapper carries no inline style at
          all. An inline display beats the class at every breakpoint, which is
          the defect that shipped the tab bar to desktop once already. */}
      {/* `key` remounts the screen when the URL that seeds it changes. The
          screen keeps the query in its own state, seeded once from this prop,
          so without the key a client-side move from ?q=constellation to ?q=zzz
          would leave the previous query in the field and draw against it. The
          key is computed from the URL alone, so typing never remounts. */}
      <div className="md:hidden">
        {/* The result set is resolved HERE, on the server, and passed down as
            data. `SearchScreen` does not import the fixture module, so none of
            the invented result copy is emitted into a client chunk on any
            build. The screen re-checks the same gate before it matches
            anything, so this line being wrong would not be enough on its
            own. */}
        <SearchScreen
          key={`${stage}:${query}`}
          stage={stage}
          initialQuery={query}
          fixture={SEARCH_FIXTURE_ENABLED ? SEARCH_FIXTURE : null}
        />
      </div>

      {/* Above the breakpoint this route has no layout of its own. The desktop
          jump surface already exists as the command palette, and it is not
          being rebuilt or rerouted here.

          The palette is NOT on every page. Both the Command K listener and the
          palette itself are mounted by `AppShell` (`app-shell.tsx` lines 94 and
          198), and this route mounts no shell, so the shortcut is dead on this
          page specifically. The copy names a page that has it and links there,
          rather than telling the reader to press a key that does nothing. That
          link is also the only way off this surface: with no shell there is no
          sidebar and no nav here either. */}
      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        <p style={{ margin: 0, font: "500 17px/1.4 'Playfair Display', serif", color: "var(--c-ink)" }}>
          Search is a mobile surface.
        </p>
        <p style={{ margin: "10px 0 0", font: "400 13px/1.6 Inter, sans-serif", color: "var(--c-secondary)" }}>
          On a wider screen the desk opens the command palette instead. It is not on this page:
          open one that carries the desk chrome, then press Command K, or Control K.
        </p>
        {/* Its own line rather than a word inside the paragraph. An inline
            anchor in 13px copy measures about 21px and would sit under the 44px
            floor the runtime audit enforces at every width, this one included.
            --c-goldink, never --c-gold: gold is a fill token and may not carry
            type. */}
        <Link
          href="/dashboard"
          style={{
            marginTop: "14px",
            minHeight: "44px",
            display: "inline-flex",
            alignItems: "center",
            font: "600 13px/1 Inter, sans-serif",
            color: "var(--c-goldink)",
          }}
        >
          Open the Dashboard
        </Link>
      </div>
    </>
  );
}
