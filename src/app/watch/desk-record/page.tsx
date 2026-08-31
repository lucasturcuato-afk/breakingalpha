import { AppShell } from "@/components/shell";
import { DeskRecordScreen } from "@/components/desk-record";
import { RadarSegments } from "@/components/radar-mobile/radar-segments";
import { loadDeskRecord } from "@/lib/desk-record-load";
import { FONT_DISPLAY, FONT_SANS } from "@/components/mobile/fonts";

/**
 * Radar / Desk record, on a phone. The fourth of Radar's four sections.
 *
 * A SECOND ENTRANCE TO ONE RECORD, WHICH IS THE ONLY THING THIS FILE DOES. The
 * standing constraint is exact: the Ledger stays the home of the record, two
 * entrances to one record is acceptable, two records is not. So this route
 * writes no query, no bucketing, no mapping and no view. It calls
 * `loadDeskRecord` and hands the result to `DeskRecordScreen`, which is
 * character for character what `/desk-record` does, because they are the same
 * two calls in the same order:
 *
 *   morning_brief_call_outcomes + morning_brief_calls
 *     -> fetchDeskRecord          src/lib/desk-record-query.ts
 *     -> buildDeskRecord          src/lib/desk-record.ts
 *     -> deskRecordToScreenData   src/components/desk-record/from-record.ts
 *     -> DeskRecordScreen         the view both entrances render
 *
 * The desktop `/radar/desk-record` runs the same `fetchDeskRecord` through its
 * own desktop view, so all three surfaces read one record. The acceptance test
 * for that is a bucket-count comparison between this route and `/desk-record`,
 * and it is in the PR body.
 *
 * `/ledger` IS A DIFFERENT RECORD AND IS NOT TOUCHED. `loadLedger` reads today's
 * brief plus the reader's own claims and never calls `fetchDeskRecord`. Nothing
 * here reaches into it.
 *
 * THERE IS NO `?stage=` AND NO SAMPLE RECORD ON THIS ROUTE, deliberately, and
 * this is the one place it differs from `/desk-record`. That route carries a
 * gated `?stage=` switch so the runtime audit can reach the four non-ready
 * states, and to do that it has to import `DESK_FIXTURE`. Reaching for
 * `DESK_FIXTURE` is one of the three ways a second entrance becomes a second
 * record, and it is the one that actually shipped: production once drew an
 * invented SUPPORTED 64 / CHALLENGED 39 here while `/radar/desk-record` drew the
 * true counts on the same deployment.
 *
 * A GATE WOULD HAVE BEEN ENOUGH, and no gate is stronger than a gate. The
 * states stay reachable for the audit at `/desk-record?stage=`, which is the
 * same screen, so nothing is lost by this route having no path to invented
 * counts at all. `data` on the screen is required and nullable with no `??`
 * fallback, so the four real states still arrive from the loader and only from
 * the loader.
 *
 * WHAT THIS SECTION DOES NOT DRAW. Nothing is subtracted from the screen: the
 * weakness heading and its prose are already null with a note in
 * `deskRecordToScreenData` because no column carries them, and `lastGradedOn` is
 * already null because the record model holds no grader-run timestamp, so the
 * stale state has nothing to name. Those are the view's own omissions and they
 * are identical on both entrances, which is the point.
 */

/**
 * FORCE-DYNAMIC, AND THIS ONE IS MEASURED RATHER THAN ASSUMED.
 *
 * Without it this route PRERENDERS. It takes no `searchParams`, reads no
 * cookies and calls no dynamic API, so Next has everything it needs at build
 * time and the first build of this file reported it as `○ (Static)` in the route
 * table while `/desk-record` beside it reported `ƒ (Dynamic)`. `/desk-record` is
 * dynamic only incidentally: it reads `?stage=`, and this route deliberately has
 * no such switch.
 *
 * A prerendered record is a record frozen at deploy. The grader runs on its own
 * schedule, so the first time it wrote a verdict after a deploy the two
 * entrances would have drawn different counts off one query, which is precisely
 * the "two records" failure this section exists not to reproduce. It would also
 * have been invisible in review: the numbers would be real, internally
 * consistent, and simply old.
 *
 * The route table after this line reads `ƒ /watch/desk-record`, and the
 * bucket-count comparison against `/desk-record` is in the PR body.
 */
export const dynamic = "force-dynamic";

export default async function RadarDeskRecordMobilePage() {
  const resolved = await loadDeskRecord();

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
        {/* Radar's own row replaces the back-to-Ledger control. Under Radar the
            reader's way out is the three sibling sections; the Ledger entrance
            keeps its back control and is unchanged. */}
        <DeskRecordScreen
          stage={resolved.stage}
          data={resolved.data}
          nav={<RadarSegments active="desk-record" />}
        />
      </div>

      {/* Above the breakpoint the desktop equivalent already exists at
          /radar/desk-record and is not being rebuilt or edited here. */}
      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        <p style={{ margin: 0, font: `500 17px/1.4 ${FONT_DISPLAY}`, color: "var(--c-ink)" }}>
          Radar is four sections on a phone.
        </p>
        <p style={{ margin: "10px 0 0", font: `400 13px/1.6 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
          On a wider screen the desk draws the same four as tabs, at /radar/desk-record.
        </p>
      </div>
    </AppShell>
  );
}
