import { createClient } from "@supabase/supabase-js";
import { AppShell } from "@/components/shell";
import { DeskRecordScreen, type DeskStage } from "@/components/desk-record";
import { DESK_FIXTURE, type DeskRecordData } from "@/components/desk-record/fixture";
import { deskRecordToScreenData } from "@/components/desk-record/from-record";
import { fetchDeskRecord } from "@/lib/desk-record-query.ts";
import { mobileFixtureScreensEnabled } from "@/lib/mobile-fixture-gate";

/**
 * Desk record, at its own top-level route.
 *
 * WIRED. It reads the real graded record through `src/lib/desk-record-query.ts`,
 * the same loader `/radar/desk-record` and the dashboard's summary call, so the
 * three surfaces run the same two selects and cannot disagree about a count.
 *
 * It did not start that way. This route shipped with the screen defaulting its
 * data to `DESK_FIXTURE` and no gate anywhere in its path, so production drew
 * an invented SUPPORTED 64 / CHALLENGED 39 under copy promising "Every call the
 * desk has published since June 2 is here", while /radar/desk-record drew the
 * true counts on the same deployment. A track record is the last thing in this
 * product that may be invented.
 *
 * NOT an edit to `src/app/radar/desk-record/page.tsx`. That route still exists,
 * still loads the live record, and is untouched. The design dismantles Radar,
 * so the mobile surface lands here and composes the shared model instead of
 * growing a mobile branch inside a Radar page.
 *
 * This screen is in no pole's `owns` list in `mobile-tab-bar.tsx`, so it lights
 * no tab. That is the standing decision from PR #619, which left Desk record and
 * Thesis Tracker unassigned because where they sit is still open (batch-2 Q3,
 * batch-3 Q5). It carries its own back control to the Ledger, which is what the
 * prototype draws: `showNav` lists only dash, ledger, watch and ask.
 *
 * NOTHING LINKS HERE YET. The intended entry point is the Ledger's second tail
 * action, "The desk grades itself too", but `TailAction` in `ledger-screen.tsx`
 * takes no href and no handler, so it is an inert button today. Until that is
 * wired, this route is reachable only by typing it.
 *
 * Server component, so the read happens on the server and `@supabase/supabase-js`
 * stays out of this route's client bundle. It also lets the lifecycle switch be
 * read off the async searchParams, matching /ledger and /waitlist.
 */

/** How many resolved calls the list renders. Counts always cover every row the
 *  read returned, never just the listed ones. Matches /radar/desk-record. */
const LIST_LIMIT = 40;

const STAGES: DeskStage[] = ["ready", "loading", "error", "empty", "stale"];

type Resolved = { stage: DeskStage; data: DeskRecordData | null };

/**
 * The real read. Errors and empties are kept apart on purpose: a failed query
 * that renders as "no graded calls yet" is the defect `supabase-query.ts`
 * exists to name, and it is worse here than anywhere, because the reader would
 * take an outage as the desk having no record at all.
 */
async function loadDeskRecord(): Promise<Resolved> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { stage: "error", data: null };

  try {
    // Both tables are public-readable, so this needs no session. Same client
    // shape /share/brief/[id] already uses for an anonymous server read.
    const record = await fetchDeskRecord(createClient(url, anonKey), LIST_LIMIT);
    // A null answer from fetchDeskRecord means a failed select, never an
    // empty one. The two are kept apart deliberately.
    if (!record) return { stage: "error", data: null };
    if (record.total === 0) return { stage: "empty", data: null };
    return { stage: "ready", data: deskRecordToScreenData(record) };
  } catch {
    return { stage: "error", data: null };
  }
}

export default async function DeskRecordMobilePage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.stage) ? params.stage[0] : params.stage;
  const requested = STAGES.includes(raw as DeskStage) ? (raw as DeskStage) : null;

  /* THE GATE IS RESOLVED HERE and the result is passed down. The screen has no
     default and no `??` fallback, so a deleted gate is a type error rather
     than an invented record in front of a reader.

     The sample record exists for one reason now: with a real query behind the
     screen there is no way to make it fail, time out or come back empty on
     demand, and the four non-ready states still have to be reachable for the
     audit. `?stage=` selects one, and only in development and preview. With no
     `?stage=`, dev reads the same live record production does, so the two
     cannot look different to whoever is checking. */
  const fixtureAllowed = mobileFixtureScreensEnabled();
  const resolved: Resolved =
    fixtureAllowed && requested !== null
      ? {
          stage: requested,
          // The three states that have nothing to draw draw nothing.
          data:
            requested === "loading" || requested === "error" || requested === "empty"
              ? null
              : DESK_FIXTURE,
        }
      : await loadDeskRecord();

  return (
    <AppShell pageTitle="Desk record" mobileFullBleed>
      {/* Gated on the same breakpoint the shell uses to swap the sidebar for
          the tab bar, and gated in a CLASS: an inline display beats the class
          at every breakpoint, which is the defect design-lint rule 10 exists
          to catch. */}
      <div className="md:hidden">
        <DeskRecordScreen stage={resolved.stage} data={resolved.data} />
      </div>

      {/* Above the breakpoint the desktop equivalent already exists at
          /radar/desk-record and is not being rebuilt here. */}
      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        <p style={{ margin: 0, font: "500 17px/1.4 'Playfair Display', serif", color: "var(--c-ink)" }}>
          The Desk record is a mobile surface.
        </p>
        <p style={{ margin: "10px 0 0", font: "400 13px/1.6 Inter, sans-serif", color: "var(--c-secondary)" }}>
          On a wider screen the desk keeps its own graded record on Radar.
        </p>
      </div>
    </AppShell>
  );
}
