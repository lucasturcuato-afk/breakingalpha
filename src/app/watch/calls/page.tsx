import { AppShell } from "@/components/shell";
import { CallsScreen, type CallsData } from "@/components/radar-mobile/calls-screen";
import { RadarSegments } from "@/components/radar-mobile/radar-segments";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { loadCallsScreen } from "@/lib/radar-calls-screen-data";
import { FONT_DISPLAY, FONT_SANS } from "@/components/mobile/fonts";

/**
 * Radar / Calls, on a phone. The third of Radar's four sections.
 *
 * WIRED, AND SERVER-SIDE, WHICH THE DESK IS NOT. `/radar/calls` is a client
 * component that fetches its claims over `/api/radar/claims` and reads the
 * desk's calls with a browser Supabase client. That is fine for the desk and it
 * is the wrong shape for a phone: it costs a round trip after paint, it puts
 * `@supabase/ssr` in the route's client bundle, and it draws nothing at all
 * while it loads.
 *
 * ONE READ, TWO TRANSPORTS. This route reads on the server through
 * `loadCallsScreen`, and the API route the desk fetches now calls the same
 * `loadRadarClaims` underneath. Neither surface owns a private copy of the
 * claim rules, which matters because four of them are easy to lose in a copy:
 * every claim reads its OWN outcome, archived claims are excluded, the newest
 * outcome per claim wins, and a missing `claim_evidence` table degrades to no
 * evidence rather than to an error.
 *
 * THERE IS NO SAMPLE CONTENT ON THIS ROUTE AND NO `?stage=`. `data` is required
 * and nullable with no `??` fallback, so the screen renders what the loader
 * gives it or says it could not work out whose calls to read. Nothing in this
 * path can produce an invented verdict, which is the property that matters most
 * on the one section of Radar where every row carries a grade.
 *
 * `/radar/calls` IS NOT EDITED BY THIS AND MUST NOT BE. It is owned by the
 * Ledger pole, it is 1100 lines of client component, and the design rule for
 * this programme is a wrapper beside it, never a branch inside it. What was
 * taken from it is the pure half only: the grouping rule and the two resolution
 * sentences, lifted into `src/lib/radar-calls-model.ts` and imported back, so
 * the two surfaces state the grading contract in one set of words.
 *
 * THIS SECTION READS AND DOES NOT WRITE. Authoring a call and adopting one are
 * both writes, both live beside the authoring flow on the desk, and both are
 * absent here. Nothing on the screen implies either is available, so under the
 * ruling of 2026-08-29 the absence is silent. The empty state points at the
 * composer, so a reader with no calls is given somewhere to go.
 *
 * IT NOW TAKES searchParams, AND THAT IS THE POINT OF THE CHANGE.
 * `/radar/calls` redirects here on a phone (`src/app/radar/calls/layout.tsx`),
 * and it reads four params. Two of them, `?views=open` and `?thesis=<id>`, ask
 * for the tracked views section, which this screen does not draw. Carrying them
 * here and then ignoring them would come to the same thing as dropping them, so
 * they are carried and ANSWERED: `viewsRequested` turns a silent omission into
 * a named one. The ruling of 2026-08-29 says omit silently unless the absence
 * would mislead, and a reader who followed a link ASKING for tracked views and
 * got a screen with none is the case where it would.
 *
 * The screen stays silent about that tier on every other arrival, which is most
 * of them. Nothing here draws a tracked view, invents one, or promises one.
 */

export default async function RadarCallsMobilePage({
  searchParams,
}: {
  searchParams: Promise<{ views?: string | string[]; thesis?: string | string[] }>;
}) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  /* Both params mean one thing to this screen: the reader asked for tracked
     views. `?thesis=` names a single one and `?views=open` opens the section.
     Since neither can be drawn here, answering them identically is honest and
     telling them apart would be theatre. */
  const viewsRequested =
    one(params.views) === "open" || Boolean(one(params.thesis)?.trim());

  const { supabase, user } = await getSupabaseWithUser();
  const read = await loadCallsScreen(supabase, user?.id ?? null);

  /* Resolved on the server and passed down. The screen has no default and no
     `??` fallback on the data, so a deleted read is a type error rather than an
     invented record in front of a reader. */
  const data: CallsData | null = read.data;

  return (
    <AppShell pageTitle="Radar" mobileFullBleed>
      {/* Gated in a CLASS, never an inline style: an inline display beats the
          class at every breakpoint, which is design-lint rule 10. */}
      {/* `h-full` is load bearing and it is a CLASS. The screen root carries
          `minHeight: 100%`, which resolves against this wrapper; without a
          definite height here the percentage resolves to nothing and a short
          screen ends at its content height, leaving `#main-content`'s
          `bg-parchment` below it as a hard seam, worst in dark. The same
          measured comment stands on `/watch`, `/ledger` and `/desk-record`. */}
      <div className="md:hidden h-full">
        <CallsScreen
          data={data}
          nav={<RadarSegments active="calls" />}
          viewsRequested={viewsRequested}
        />
      </div>

      {/* Above the breakpoint the desktop equivalent already exists at
          /radar/calls and is not being rebuilt or edited here. */}
      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        <p style={{ margin: 0, font: `500 17px/1.4 ${FONT_DISPLAY}`, color: "var(--c-ink)" }}>
          Radar is four sections on a phone.
        </p>
        <p style={{ margin: "10px 0 0", font: `400 13px/1.6 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
          On a wider screen the desk draws the same four as tabs, at /radar/calls.
        </p>
      </div>
    </AppShell>
  );
}
