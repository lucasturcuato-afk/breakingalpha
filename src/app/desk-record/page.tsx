import { AppShell } from "@/components/shell";
import { DeskRecordScreen, type DeskStage } from "@/components/desk-record";
import { DESK_FIXTURE } from "@/components/desk-record/fixture";
import { loadDeskRecord, type DeskRecordRead } from "@/lib/desk-record-load";
import { mobileFixtureScreensEnabled } from "@/lib/mobile-fixture-gate";
import { FONT_DISPLAY, FONT_SANS } from "@/components/mobile/fonts";

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
 * The entry point is the Ledger's second tail action, "The desk grades itself
 * too", at `ledger-screen.tsx:246`. `TailAction` gained an href in PR #680 and
 * that href was repointed here from `/radar/desk-record`, so this route is
 * reachable from the mobile home in one tap. It remains the only inbound link.
 *
 * Server component, so the read happens on the server and `@supabase/supabase-js`
 * stays out of this route's client bundle. It also lets the lifecycle switch be
 * read off the async searchParams, matching /ledger and /waitlist.
 */

/**
 * THE READ MOVED, AND NOTHING ELSE DID. `LIST_LIMIT`, the `Resolved` shape and
 * `loadDeskRecord` all used to live in this file. Radar's fourth section is a
 * SECOND ENTRANCE to this same record, and the way a second entrance turns into
 * a second record is a copy of those twenty lines that later drifts from these.
 * They now live in `src/lib/desk-record-load.ts`, both routes call it, and that
 * file's header carries the reasoning and the limit's own note.
 *
 * The behaviour here is unchanged: same limit of 40, same four states, same
 * separation of a failed read from an empty one.
 */

const STAGES: DeskStage[] = ["ready", "loading", "error", "empty", "stale"];

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
  const resolved: DeskRecordRead =
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
        <DeskRecordScreen stage={resolved.stage} data={resolved.data} />
      </div>

      {/* Above the breakpoint the desktop equivalent already exists at
          /radar/desk-record and is not being rebuilt here. */}
      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        <p style={{ margin: 0, font: `500 17px/1.4 ${FONT_DISPLAY}`, color: "var(--c-ink)" }}>
          The Desk record is a mobile surface.
        </p>
        <p style={{ margin: "10px 0 0", font: `400 13px/1.6 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
          On a wider screen the desk keeps its own graded record on Radar.
        </p>
      </div>
    </AppShell>
  );
}
