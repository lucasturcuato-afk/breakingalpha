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
 * for that is a rendered comparison between this route and `/desk-record`, over
 * the strip's four cells, the ordered list of rows text for text, the
 * last-graded stamp and the accounting line, and it is in the PR body.
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
 * WHAT THIS SECTION DOES NOT DRAW. Nothing is subtracted from the screen. The
 * weakness heading and its prose are null, with a note in
 * `deskRecordToScreenData`, because no column carries them. That is the view's
 * own omission and it is identical on both entrances, which is the point.
 *
 * THIS PARAGRAPH USED TO CARRY A SECOND OMISSION AND IT IS NO LONGER TRUE. It
 * read that `lastGradedOn` is "already null because the record model holds no
 * grader-run timestamp, so the stale state has nothing to name". `graded_at` is
 * non-null on every outcome row and `fetchDeskRecord` has always selected it;
 * what was missing was a FIELD on the model. `buildDeskRecord` now folds it as a
 * maximum over every row read, the mapper reads it, and the screen draws it as
 * one stamp under the title. Both entrances get it off the same call, so it is
 * one record with one answer rather than a second one. The stale STAGE is still
 * never selected on the wired path, for a reason that has nothing to do with
 * the date: the notice claims that calls closed after the last run are missing
 * from the record, and no fact in this read establishes that claim.
 *
 * THE SCREEN IS NO LONGER A LIST YOU ONLY SCROLL, and that is the other thing
 * this header outlived. The count strip is a segmented control, three of whose
 * four cells scope the list to one outcome; every row opens where it stands and
 * carries a link to `/claim/[id]`; and the standing explanation sits behind one
 * control below the list. NONE OF THAT REACHES THE RECORD. It is view state in
 * the strict sense: it selects among the entries `loadDeskRecord` handed down
 * and can reach nothing else. No fetch, no re-bucket, no re-sort, no
 * persistence, and no list limit that differs by entrance. The bucket a cell
 * scopes by is carried through from the model rather than inverted from the
 * rendered word, and whether a cell is a control at all is decided from the
 * rows the list actually carries.
 *
 * A COUNT MAY NOW DISAGREE WITH THE LIST BY THE READER'S OWN CHOICE, which is a
 * third way to reach the gap the two standing sentences already covered.
 * `src/components/desk-record/accounting.ts` owns all three sentences and the
 * branches between them, and a chosen bucket gets that bucket's own arithmetic
 * rather than the record's total. Nothing is hidden to make the numbers agree.
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
