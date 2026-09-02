"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Chevron, LedgerDisclosureRow, OutcomeLead } from "@/components/ledger";
import { DESK_RECORD_COPY, RESOLUTION_ORDER, type Resolution } from "@/lib/desk-record.ts";
/* Type-only. A value import out of this path would put the invented record in
   this client component's chunk in `.next/static` whether or not it can ever
   paint, which is design-lint rule `fixture-in-client-bundle`. Types erase. */
import type { DeskEntryFixture, DeskRecordData } from "./fixture";
import { accountingSentences } from "./accounting";
/* One shimmer and one entrance curve in the redesign, not two. The Ledger's
   module already carries both, already rests in its drawn state, and already
   has the reduced-motion guard, so this screen consumes it rather than
   copying the keyframes into a second file that could drift. */
import styles from "@/components/ledger/ledger.module.css";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";

/**
 * Desk record, mobile. The desk's own graded calls, distinct from the user's
 * record of their own claims.
 *
 * That distinction is the whole point of the surface and it is defended in
 * three files with three independent comments: `RadarTabs.tsx` line 24,
 * `src/app/radar/desk-record/page.tsx`'s header, and `src/lib/your-record.ts`'s
 * header, which states there is no parameter through which the desk's numbers
 * could arrive. This screen is built to keep it. See CELL_LABEL below for the
 * one place the prototype broke it and what this does instead.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE WALL, AND WHAT REPLACED IT.
 *
 * This screen was the worse of the two by every measure taken. Six and seven
 * tenths viewport heights. Thirty-eight rows. EIGHTY-EIGHT PER CENT of the
 * whole scroll was row, over five distinct row heights, with nineteen in
 * twenty inside a forty pixel band: a column of near-identical objects with no
 * shape, no rhythm, and nothing bigger than anything else. Nine controls, all
 * nine of them chrome, none of them on a row and none of them on the strip.
 * Three hundred and twenty-seven pixels of the fold were prose before the first
 * number, with another hundred and eighty-eight of standing explanation under
 * it.
 *
 * THREE CHANGES, IN THE ORDER THEY MATTER.
 *
 * 1. THE STRIP IS THE WAY IN. Four counts sat across the top being read once
 *    and then scrolled past. Resolution is also the ONLY axis this record
 *    groups evenly: four buckets, evenly split, already computed, already on
 *    the screen. Sector gives fourteen groups with one huge one; brief date
 *    gives thirty-seven over thirty-eight rows; entity gives seventy-eight.
 *    So the strip becomes what it was already shaped like, a segmented
 *    control, and a reader who wants the calls that went against the desk
 *    presses one cell instead of scrolling six screens looking for them.
 *
 *    A CELL IS A CONTROL ONLY WHEN IT HAS ROWS TO SCOPE TO, which is the same
 *    rule the two disclosure precedents in this repo obey: a control with
 *    nothing behind it lies about what it does. Not-graded calls carry no
 *    verdict word and are never listed, so that cell is a plain cell. It still
 *    counts, and the line under the list still says why it has no rows.
 *
 * 2. THE ROW COLLAPSES. The grader's attribution line is on every row, it is
 *    the single largest contributor to row height, and it is the second
 *    paragraph of every row rather than the thing anyone is scanning for. It
 *    goes behind the row's own control. What stays is the state word, the
 *    instrument, and the claim's first clause. No number survives on a
 *    collapsed row: not a count, not a ratio, not a percentage.
 *
 * 3. THE STANDING EXPLANATION MOVES BELOW THE LIST, behind one control. Every
 *    word of it is still here and none of it is rewritten. What is NOT behind
 *    that control is the accounting: the two sentences that reconcile a count
 *    in the strip with a shorter list stay on the screen, above the rows, in
 *    one paragraph rather than two at opposite ends of the list. A third
 *    sentence joins them when the strip is filtering, for exactly the same
 *    reason, because a filter is a third way for a count and a list to
 *    disagree.
 *
 * WHAT DID NOT CHANGE. The read, the bucketing, the truncation, the order, the
 * words. This screen still receives `deskRecordToScreenData(fetchDeskRecord())`
 * and still draws what it is given. Filtering and opening are view state and
 * survive no reload; nothing here re-queries, re-buckets or re-sorts.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Every measurement is taken off the rendered screen through
 * `scripts/parity_harness.py --screen desk` and the geometry probe in the PR
 * body, not from the README.
 */

export type DeskStage = "ready" | "loading" | "error" | "empty" | "stale";

const PAD = "var(--v3-pad)";

/**
 * The count strip's words, one per model bucket.
 *
 * The prototype draws SUPPORTED / CHALLENGED / DEVELOPING / AWAITING. Three of
 * those are fine. The fourth is not, and `briefs/batch-8.md` is right to call it
 * the most serious item in the batch:
 *
 *   - `src/lib/desk-record.ts` has four buckets, supported / challenged /
 *     noCleanRead / notGraded, and `awaitingNote` states in the model's own
 *     copy that "Calls still inside their window are awaiting a grade and are
 *     not shown here."
 *   - `src/lib/your-record.ts` defines awaiting as a property of the USER's
 *     record: a claim with no own outcome row is awaiting.
 *
 * So an AWAITING count on the desk's record is a number the desk's model
 * cannot produce, borrowed from the other record, on the one surface built to
 * keep the two apart. It is dropped. In its place the fourth cell counts the
 * model's fourth bucket, notGraded, under the model's own word for it, and
 * `awaitingNote` is stated below the strip so the absence is said out loud
 * rather than being silent.
 *
 * noCleanRead reads "Developing" because the shipped Ledger already renders a
 * no-clean-read call that way: `src/components/ledger/fixture.ts` entry e3 is a
 * confounded SOFI call whose row says Developing. `OutcomeLead` can render no
 * other word, so a strip saying "No clean read" above a row saying "Developing"
 * for the same call would put two vocabularies on one screen.
 *
 * This does not close batch-8 open question 5, which asks which buckets ship
 * and is a decision, not an implementation detail. It is the reading that keeps
 * the desk's numbers the desk's and puts nothing on the screen the model cannot
 * count. Overruling it is four strings in this table.
 */
const CELL_LABEL: Record<Resolution, string> = {
  supported: DESK_RECORD_COPY.bucketLabel.supported,
  challenged: DESK_RECORD_COPY.bucketLabel.challenged,
  noCleanRead: "Developing",
  notGraded: DESK_RECORD_COPY.bucketLabel.notGraded,
};

export function DeskRecordScreen({
  stage = "ready",
  data,
  nav,
}: {
  stage?: DeskStage;
  /**
   * WHAT SITS ABOVE THE TITLE, when the caller has something better than a back
   * control to put there.
   *
   * THIS IS CHROME AND NOT DATA, which is why it is optional where `data` below
   * is required and nullable. Getting `data` wrong invents a record; getting
   * this wrong draws the wrong navigation, which is visible at a glance and
   * fixable without a migration. The default is exactly what this screen has
   * always drawn, so `/desk-record` passes nothing and is unchanged.
   *
   * IT EXISTS FOR RADAR'S SECOND ENTRANCE. `/watch/desk-record` renders THIS
   * screen from THIS data, and passes Radar's four-section row here instead of
   * the back-to-Ledger control, because under Radar the reader's way out is the
   * three sibling sections rather than the Ledger.
   *
   * TWO ENTRANCES, ONE RECORD. That distinction is the whole constraint on this
   * component and it is worth spelling out where the second entrance is added:
   * a second entrance is a second ROUTE rendering the same loader through the
   * same view. It becomes a second RECORD the moment a caller re-queries
   * `morning_brief_call_outcomes`, re-buckets the rows, or hands this screen
   * `DESK_FIXTURE`. All three have shipped in this repo before, and the header
   * of `src/app/desk-record/page.tsx` records what it cost. A prop that swaps a
   * navigation element cannot do any of the three, and neither can the view
   * state below: filtering and opening are decided per render from the entries
   * this screen was handed, and both entrances hand it the same ones.
   */
  nav?: React.ReactNode;
  /**
   * The record, or null when there is none to draw. REQUIRED and NULLABLE, and
   * never a default parameter.
   *
   * This screen shipped with the sample record as its default parameter and no
   * gate anywhere in its path, so production drew SUPPORTED 64 / CHALLENGED 39
   * under copy promising
   * "Every call the desk has published since June 2 is here", while
   * /radar/desk-record drew the desk's true counts on the same deployment. Two
   * different track records, one product, one day. The caller now resolves
   * where the record comes from and passes the result; a missing prop is a
   * type error rather than an invented record in front of a reader.
   */
  data: DeskRecordData | null;
}) {
  const settled = stage === "ready" || stage === "stale";

  /* View state, and it is view state in the strict sense: it selects among the
     entries this screen was handed and can reach nothing else. No fetch, no
     re-bucket, no re-sort, no persistence. */
  const [bucket, setBucket] = useState<Resolution | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set<string>());

  const toggle = useCallback((id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const entries = data?.entries;

  /* How many LISTED rows each bucket has. Off the rendered list on purpose and
     not off the strip: this decides whether a cell is a control, and a control
     is honest only about the rows it can actually scope to. The strip's own
     numbers are still the model's and are untouched. */
  const listedByBucket = useMemo(() => {
    const m = new Map<Resolution, number>();
    for (const e of entries ?? []) m.set(e.bucket, (m.get(e.bucket) ?? 0) + 1);
    return m;
  }, [entries]);

  const visible = useMemo(
    () => (bucket === null ? (entries ?? []) : (entries ?? []).filter((e) => e.bucket === bucket)),
    [entries, bucket],
  );

  /* What the STRIP counts, per bucket. Hoisted out of `CountStrip` because the
     accounting under the list heading needs the same numbers: a reader looking
     at one outcome has to be able to reconcile that outcome's cell against that
     outcome's rows, and it cannot do that from a total. */
  const countedByBucket = useMemo(
    () => new Map((data?.counts ?? []).map((c) => [c.bucket, c.count])),
    [data],
  );

  const choose = useCallback((next: Resolution) => {
    setBucket((prev) => (prev === next ? null : next));
    /* Every row closes when the list changes underneath it. A row left open
       from the previous selection would reappear opened the moment the reader
       came back to it, which reads as the screen having remembered something
       about that call rather than about the session. */
    setOpen(new Set<string>());
  }, []);

  /* No record, no record. EARLY RETURN on purpose: below this line TypeScript
     knows `data` is non-null, so no later reader needs a guard and no later
     edit can bring the fixture back by omission.

     error and empty are the two states that legitimately have nothing to draw,
     and they say different things. Anything else with no data renders the
     load, which claims only that something is on its way. */
  if (data === null) {
    return (
      <DeskChrome nav={nav}>
        {stage === "error" ? <DeskError /> : stage === "empty" ? <DeskEmpty /> : <DeskSkeleton />}
      </DeskChrome>
    );
  }

  /* Composed from the model only, never from the rendered rows' text. */
  const accountingLines = accountingSentences({
    bucket,
    countedInBucket: bucket === null ? 0 : (countedByBucket.get(bucket) ?? 0),
    listed: visible.length,
    listCap: data.listCap,
    hasUnlistedNotGraded: data.hasUnlistedNotGraded,
    label: bucket === null ? "" : CELL_LABEL[bucket],
  });

  return (
    <DeskChrome nav={nav} lastGradedOn={settled ? data.lastGradedOn : null}>
      {stage === "loading" ? <DeskSkeleton /> : null}
      {stage === "error" ? <DeskError /> : null}
      {stage === "empty" ? <DeskEmpty /> : null}

      {settled ? (
        <>
          {stage === "stale" && data.lastGradedOn !== null ? (
            <DeskStaleNotice lastGradedOn={data.lastGradedOn} />
          ) : null}

          <CountStrip
            countedByBucket={countedByBucket}
            selected={bucket}
            listedByBucket={listedByBucket}
            onChoose={choose}
          />

          {/* Both halves or neither. The weakness reading is editorial and the
              loader produces nothing that could stand in for it, so on the
              wired path the section is absent rather than empty. */}
          {data.weaknessHeading !== null && data.weaknessProse !== null ? (
            <>
              <SectionRule label={data.weaknessHeading} />
              <p
                style={{
                  margin: "11px 0 0",
                  font: `400 13.5px/1.65 ${FONT_SANS}`,
                  color: "var(--c-body)",
                  textWrap: "pretty",
                }}
              >
                {data.weaknessProse}
              </p>
            </>
          ) : null}

          <SectionRule
            label={data.listHeading}
            count={`${visible.length}${bucket === null ? "" : ` of ${data.entries.length}`}`}
          />

          {/* THE ACCOUNTING, IN ONE PLACE, BEFORE THE READER COUNTS ROWS.
              Three ways a count in the strip and this list can disagree, and
              every one of them is named rather than left to be inferred:

                the filter    the reader's own choice, and the only one that
                              was not already a defect. Reversible from the
                              same control that set it, and the line says so.
                the cap       the strip counts every row the read returned and
                              the list is given only the newest page. This is
                              the largest of the three and was once silent.
                not graded    counted in the strip, never listed, because
                              there is no verdict word for it.

              PER BUCKET WHEN A BUCKET IS CHOSEN. The first cut kept the global
              sentence and appended the bucket's name to it, which put three
              denominators on one screen with no clause tying the two that
              matter together. That is the failure this paragraph exists to
              stop, and filtering made it worse rather than better. The
              sentences live in `accounting.ts` with their branches and their
              test, because this is the one paragraph on the screen that may
              not be wrong. */}
          {accountingLines.length > 0 ? (
            <p
              style={{
                margin: "11px 0 0",
                font: `400 11.5px/1.55 ${FONT_SANS}`,
                color: "var(--c-muted)",
                textWrap: "pretty",
              }}
            >
              {accountingLines.join(" ")}
            </p>
          ) : null}

          {visible.map((e, i) => (
            <DeskRow
              key={e.id}
              entry={e}
              first={i === 0}
              open={open.has(e.id)}
              onToggle={() => toggle(e.id)}
            />
          ))}

          {/* NO CLOSING RULE. It existed only to give the last of a stack of
              top-hairline rows a bottom edge to sit against. Every row is a
              boxed card now and draws four sides of its own, so the rule
              became a stray hairline floating under the last card. */}

          <HowThisIsCounted since={data.since} />
        </>
      ) : null}
    </DeskChrome>
  );
}

/**
 * Back control, title and standfirst. Drawn once and shared by every state,
 * including the one with no record at all, so the screen cannot grow two
 * mastheads that drift apart.
 *
 * No horizontal padding on the root. The screen's gutter is 20px, drawn once,
 * by the two blocks below. The prototype's own `#v3phone` (line 247 of the
 * .dc.html) carries no padding either; the harness written by
 * parity_harness.py:1062 injects one, which makes the DESIGN side of a 390px
 * parity run 40px narrower than the build and reports the wrapping difference
 * as a height mismatch. That is a harness artifact, and matching it here would
 * ship the screen 40px too narrow to satisfy a measuring tape. See the PR body
 * for the 390 and the 430 runs.
 *
 * Neither string is a claim about the record. They say what the surface is for,
 * which is true whether or not a record was read.
 *
 * THE STANDFIRST LOST ITS SECOND SENTENCE, which now opens the block at the
 * foot. It is the reason to read the record rather than a description of it,
 * and it was three lines of the fold above the first number. Nothing is
 * rewritten and nothing is dropped.
 *
 * "A GRADED OUTCOME", NOT "AN OUTCOME", and the word is doing real work. The
 * strip draws four cells and one of them cannot be pressed, so a sentence
 * saying "press an outcome" was true of three quarters of what it pointed at.
 * The three pressable cells are exactly the three GRADED buckets and the inert
 * one is the not-graded bucket, so the qualifier is not a hedge: it names the
 * condition precisely, in the cell's own word.
 *
 * BOTH HALVES HAD TO GIVE. The copy was overclaiming AND the cell was drawn
 * identically to the live ones, so fixing either alone would have left the
 * other lying. `CountStrip` carries the cell half and its reasoning.
 */
function DeskChrome({
  children,
  nav,
  lastGradedOn,
}: {
  children: React.ReactNode;
  /* Undefined means "this screen's own back control", which is what every
     caller wanted before Radar had a second entrance to the record. */
  nav?: React.ReactNode;
  /**
   * The date the grader last completed, when the record carries one.
   *
   * A RECORD SCREEN INVITES THE QUESTION "when was this last checked", and this
   * one had no answer: `lastGradedOn` was hard null in the mapper because the
   * MODEL had no field, not because the column was missing. `graded_at` is
   * non-null on every outcome row and `fetchDeskRecord` has always selected it.
   *
   * IT IS NOT A SECOND RECORD AND CANNOT BECOME ONE. It is one date read off
   * the same rows the counts are read off, by the same builder, on the same
   * call, so both entrances get the same answer or neither gets one. It is not
   * a count, it is not derived from the mix, and nothing on the screen is
   * filtered or ordered by it.
   */
  lastGradedOn?: string | null;
}) {
  return (
    <div
      data-parity="desk"
      className={styles.enter}
      style={{ backgroundColor: "var(--c-bg)", minHeight: "100%" }}
    >
      {/* The caller's navigation, or this screen's own. Drawn in the same slot
          either way, so the title and the standfirst sit at the same height on
          both entrances and neither one grows a second masthead. */}
      {nav ?? <BackToLedger />}

      <div style={{ padding: `22px ${PAD} 24px` }}>
        <h1
          style={{
            margin: 0,
            font: `700 24px/1.15 ${FONT_DISPLAY}`,
            letterSpacing: "-0.02em",
            color: "var(--c-ink)",
          }}
        >
          Desk record
        </h1>
        <p
          style={{
            margin: "9px 0 0",
            font: `400 13px/1.6 ${FONT_SANS}`,
            color: "var(--c-body)",
            textWrap: "pretty",
          }}
        >
          The desk&apos;s own calls, graded on the same bar as yours. Press a graded outcome to
          scope the list.
        </p>
        {lastGradedOn ? (
          <p
            style={{
              margin: "9px 0 0",
              /* The ledger line, which is where capitals survive. */
              font: `400 10px/1.4 ${FONT_MONO}`,
              letterSpacing: "0.07em",
              color: "var(--c-muted)",
            }}
          >
            {`LAST GRADED ${lastGradedOn.toLocaleUpperCase("en-US")}`}
          </p>
        ) : null}

        {children}

        {/* Clearance for the tab bar, not a plain 24px gutter.
            /desk-record is in no pole's `owns` list, so no pole lights on it,
            but the bar still RENDERS on the route. Measured on the running
            page at 390: with 24px the last line bottomed out at 796px against
            a bar top of 761px, so 35px of it sat behind the bar. This is the
            same element and the same expression `/watch` carries, for the
            same reason. */}
        <div
          aria-hidden="true"
          style={{
            height: "calc(var(--mobile-tabbar-height) + env(safe-area-inset-bottom) + 24px)",
          }}
        />
      </div>
    </div>
  );
}

/* ── blocks ─────────────────────────────────────────────────────────── */

/**
 * The back control. A real anchor, not the prototype's `div role="button"`,
 * so it is a link to a link's keyboard and assistive technology.
 *
 * The chevron is drawn here rather than through `@/components/ledger`'s
 * `Chevron`, which has only right and down and says so in its own header. A
 * left arm is a shape that component does not have, and adding one would be a
 * branch inside a primitive several screens in this batch share.
 */
function BackToLedger() {
  return (
    <div
      style={{
        minHeight: "48px",
        display: "flex",
        alignItems: "center",
        padding: `0 ${PAD}`,
        borderBottom: "1px solid var(--c-border)",
      }}
    >
      <Link
        href="/ledger"
        style={{
          minHeight: "44px",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          font: `500 13px/1 ${FONT_SANS}`,
          color: "var(--c-secondary)",
          textDecoration: "none",
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
          style={{ flex: "none" }}
        >
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Ledger
      </Link>
    </div>
  );
}

/**
 * Four cells, equal width, in the model's own order, and now the way into the
 * list.
 *
 * NOTHING ABOUT THE NUMBERS CHANGED. No cell is emphasised and none is sorted
 * to the front: `RESOLUTION_ORDER` puts challenged second on purpose,
 * immediately beside supported and at the same size. There is no total, no
 * ratio and no derived figure of any kind here, and the block at the foot of
 * the screen says so in the reader's own words.
 *
 * WHAT CHANGED IS THAT A CELL DOES SOMETHING. Resolution is the only axis this
 * record divides evenly, it was already computed, and it was already drawn
 * across the top of the screen doing nothing. A reader who wants the calls that
 * went against the desk now presses one cell rather than scrolling for them.
 *
 * A CELL WITH NO ROWS IS NOT A CONTROL. `listedByBucket` counts the rows the
 * list actually holds, and a bucket with none of them renders as the plain cell
 * it always was. That is the not-graded cell on every real record: those calls
 * carry no verdict word and are never listed, which the line under the list
 * heading says out loud. A pressable cell that scoped a list to nothing would
 * be the exact defect the two disclosure precedents in this repo exist to
 * prevent.
 *
 * THE STRIP'S HEIGHT IS UNCHANGED. The cell takes the 44px floor and the outer
 * padding gives back what it takes, so the four counts sit where they sat and
 * the skeleton beside them still prefigures the same box.
 */
function CountStrip({
  countedByBucket,
  selected,
  listedByBucket,
  onChoose,
}: {
  /** The model's counts, in the model's own order. Passed rather than rebuilt:
   *  the accounting under the list reads the same map, and two copies of it is
   *  how a cell and the sentence explaining it come to disagree. */
  countedByBucket: Map<Resolution, number>;
  selected: Resolution | null;
  listedByBucket: Map<Resolution, number>;
  onChoose: (bucket: Resolution) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filter the list by outcome"
      style={{
        marginTop: "18px",
        display: "flex",
        padding: "4px 0",
        borderTop: "1px solid var(--c-border)",
        borderBottom: "1px solid var(--c-border)",
      }}
    >
      {RESOLUTION_ORDER.map((bucket) => {
        const on = selected === bucket;
        /* A cell is a control only when it has rows to scope to, which on a
           real record is every bucket except this one. */
        const live = (listedByBucket.get(bucket) ?? 0) > 0;
        const cell = (
          <>
            <div
              style={{
                font: `400 10px/1 ${FONT_MONO}`,
                letterSpacing: "0.07em",
                color: on ? "var(--c-ink)" : "var(--c-muted)",
              }}
            >
              {CELL_LABEL[bucket].toLocaleUpperCase("en-US")}
            </div>
            <div
              style={{
                marginTop: "7px",
                /* THE INERT CELL LOOKS INERT, and until this it did not.
                   It was drawn identically to the three live ones in both
                   themes; the only difference was `cursor`, and there is no
                   cursor on a phone. So the accessibility tree was honest and
                   the glass was not, on the one cell built specifically to
                   obey the rule that a control with nothing behind it lies.

                   The number is the loudest thing in the strip, so it is the
                   thing that changes: ink at 500 on a cell you can press, muted
                   at 400 on the one you cannot. TWO channels, weight and hue,
                   because a state carried by hue alone is a state carried by
                   nothing for some readers, and both tokens are already used in
                   this strip in both themes.

                   Rejected: a second background fill, which would put three
                   cell backgrounds on a four-cell row and make the pressed
                   state ambiguous; and a resting rule under the live cells,
                   which lands on the strip's own bottom border where the gold
                   pressed mark already sits and reads as a thicker border
                   rather than as an affordance. */
                font: `${live ? 500 : 400} 17px/1 ${FONT_MONO}`,
                color: live ? "var(--c-ink)" : "var(--c-muted)",
              }}
            >
              {countedByBucket.get(bucket) ?? 0}
            </div>
          </>
        );

        /* Vertical padding only. Horizontal padding on a `flex: 1` cell under
           `content-box` would widen the track past its share and push the
           fourth word off the edge, which is the failure `RadarSegments`
           records for the same four-column row. */
        const box: React.CSSProperties = {
          flex: 1,
          minWidth: 0,
          boxSizing: "content-box",
          minHeight: "44px",
          padding: "5px 0",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        };

        if (!live) {
          return (
            <div key={bucket} style={box}>
              {cell}
            </div>
          );
        }

        return (
          <button
            key={bucket}
            type="button"
            aria-pressed={on}
            onClick={() => onChoose(bucket)}
            className={`${styles.bare} ${styles.focusable}`}
            style={{
              ...box,
              position: "relative",
              textAlign: "left",
              borderRadius: "6px",
              backgroundColor: on ? "var(--c-well)" : "transparent",
            }}
          >
            {cell}
            {on ? (
              /* The chosen cell is marked the way Radar's own four-section row
                 marks its chosen section: a 2px gold bar sitting ON the rule
                 rather than above it. Same shape, same token, same offset
                 logic as `RadarSegments`, so a reader who has met one row of
                 four in this app has met this one. The well fill alone was
                 legible in dark and nearly invisible in light, and a state
                 carried by a fill that faint is a state carried by nothing.

                 -5px clears the strip's own 4px padding and lands the bar over
                 the 1px bottom border, which is why the strip owns that border
                 and the cell does not. */
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: "8px",
                  right: "8px",
                  bottom: "-5px",
                  height: "2px",
                  backgroundColor: "var(--c-gold)",
                }}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One resolved call.
 *
 * A WRAPPER BESIDE THE ROW, NEVER A BRANCH INSIDE IT, which is the same house
 * rule `calls-screen.tsx`'s own `Row` obeys. What it wraps changed:
 * `LedgerDisclosureRow` rather than `LedgerEntryRow`, because the reading is now
 * behind the row's own control and the entry row's container is a navigation
 * control that cannot carry `aria-expanded`.
 *
 * THE ROW NOW HAS A DESTINATION, and this is the correction to what the
 * previous pass recorded here. That comment said the Entry screen did not exist
 * and so no handler could be passed. True, and beside the point: a record entry
 * IS a `morning_brief_calls` row, `/claim/[id]` takes exactly that id, and it
 * is the surface where a reader can see the call's window and take it onto
 * their own record. `/entry/[id]`, the route that does not exist, takes a
 * `user_claims` id and was never this row's destination.
 *
 * The link sits INSIDE the opened body and never on the collapsed row. A link
 * inside a button is nested interactive content, and a row carrying two taps
 * at once is a row where neither is predictable.
 *
 * THE ROW IS NOW A BOXED CARD, drawn by `LedgerDisclosureRow` itself rather
 * than by a fourth wrapper here. `state` is passed twice on purpose and to two
 * different ends: once into `OutcomeLead`, which renders the dot and the word,
 * and once as the row's own `state`, which colours the 2px top edge. The edge
 * earns more here than it does on Calls, because `awaiting` never appears on
 * the record: what is left is three distinct hues, so a reader can see where
 * the challenged calls fall in a five-row window without reading a word.
 */
function DeskRow({
  entry,
  first,
  open,
  onToggle,
}: {
  entry: DeskEntryFixture;
  first: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <LedgerDisclosureRow
      lead={<OutcomeLead state={entry.state} instrument={entry.instrument} />}
      state={entry.state}
      claim={entry.claim}
      reading={entry.result}
      first={first}
      open={open}
      onToggle={onToggle}
      detail={
        <Link
          href={`/claim/${entry.id}`}
          className={`${styles.bare} ${styles.focusable}`}
          style={{
            minHeight: "44px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            font: `600 12.5px/1 ${FONT_SANS}`,
            color: "var(--c-goldink)",
          }}
        >
          Open this call
          <Chevron direction="right" stroke="var(--c-goldink)" />
        </Link>
      }
    />
  );
}

/**
 * The standing explanation, behind one control, at the foot.
 *
 * WHAT IS IN HERE AND WHAT IS DELIBERATELY NOT. Everything below is a standing
 * claim about how the record is kept: true today, true tomorrow, read once. It
 * was three hundred and fifteen pixels of the fold and the top of the list, and
 * it is now one 44px control below the rows. Nothing is rewritten and nothing
 * is dropped: `DESK_RECORD_COPY` supplies every word except the framing
 * sentence, which is the one this screen has always authored.
 *
 * The ACCOUNTING is not in here. The two sentences that reconcile a count with
 * a shorter list stay above the rows where a reader meets them before counting,
 * because those are claims about THIS read rather than about the record.
 *
 * THE FOUR BUCKET NOTES ARE NEW TO THIS SURFACE and they are here because the
 * strip is a control now. Only the not-graded note was ever drawn on a phone. A
 * reader being asked to choose between four words is owed the four definitions,
 * and they are the model's own copy, already asserted clean by
 * `tests/unit/desk-record.test.ts`.
 *
 * The toggle follows the two hand-rolled precedents in this repo,
 * `evening-wrap-screen.tsx` and `feed-mobile-screen.tsx`: a real button, 44px,
 * gold ink, `aria-expanded`. It always has something behind it, so the "only
 * when there is more to show" half of that rule is satisfied by construction
 * rather than by a guard.
 */
function HowThisIsCounted({ since }: { since: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: "6px" }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`${styles.bare} ${styles.focusable}`}
        style={{
          minHeight: "44px",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          font: `600 12.5px/1 ${FONT_SANS}`,
          color: "var(--c-goldink)",
        }}
      >
        How this record is counted
        <Chevron direction={open ? "down" : "right"} stroke="var(--c-goldink)" />
      </button>

      {open ? (
        <div
          className={styles.enter}
          style={{
            padding: "13px 15px",
            border: "1px solid var(--c-border)",
            borderRadius: "12px",
            backgroundColor: "var(--c-well)",
          }}
        >
          {/* Every word here is load bearing and two of them were wrong.
              "is counted here", not "is here": the strip counts every row
              the read returned and the list below it is capped, so the
              stronger claim was never true of the list.
              "that the grader has reached", not a bare "every call":
              `fetchDeskRecord` reads outcome rows and joins back to the
              calls, so a published call with no outcome row at all is in
              neither the counts nor the list. The very next line on this
              screen says such calls exist, so a bare "every" made the
              screen contradict itself one paragraph later.
              The window clause is dropped rather than guessed when no row
              carries a brief date. */}
          <p
            style={{
              margin: 0,
              font: `400 12.5px/1.6 ${FONT_SANS}`,
              color: "var(--c-body)",
              textWrap: "pretty",
            }}
          >
            Every call the desk has published{since ? ` since ${since}` : ""} that the grader has
            reached is counted here, including the ones that went against it. Nothing is sorted by
            outcome and no figure is derived from the mix. Published so you can judge whether the
            briefs are worth reading before you commit to one.
          </p>

          {/* The strip lost the prototype's AWAITING cell. Saying so is the
              point: an absence the reader cannot see is indistinguishable
              from a number that was quietly left out. */}
          <p
            style={{
              margin: "10px 0 0",
              font: `400 11.5px/1.55 ${FONT_SANS}`,
              color: "var(--c-muted)",
              textWrap: "pretty",
            }}
          >
            {DESK_RECORD_COPY.awaitingNote}
          </p>

          <dl style={{ margin: "12px 0 0" }}>
            {RESOLUTION_ORDER.map((b) => (
              <div key={b} style={{ marginTop: "9px" }}>
                <dt
                  style={{
                    font: `600 11px/1.3 ${FONT_SANS}`,
                    color: "var(--c-secondary)",
                  }}
                >
                  {CELL_LABEL[b]}
                </dt>
                <dd
                  style={{
                    margin: "3px 0 0",
                    font: `400 11.5px/1.5 ${FONT_SANS}`,
                    color: "var(--c-muted)",
                    textWrap: "pretty",
                  }}
                >
                  {DESK_RECORD_COPY.bucketNote[b]}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

/** Italic serif label, a hairline to the trailing edge, and an optional count. */
function SectionRule({ label, count }: { label: string; count?: string }) {
  return (
    <div style={{ marginTop: "20px", display: "flex", alignItems: "center", gap: "11px" }}>
      <span
        style={{
          font: `400 italic 12.5px/1 ${FONT_DISPLAY}`,
          color: "var(--c-secondary)",
        }}
      >
        {label}
      </span>
      <span aria-hidden="true" style={{ flex: 1, height: "1px", backgroundColor: "var(--c-border)" }} />
      {count ? (
        <span
          style={{
            font: `400 10.5px/1 ${FONT_MONO}`,
            letterSpacing: "0.045em",
            color: "var(--c-muted)",
          }}
        >
          {count}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The load prefigures the layout it is standing in for, four count cells
 * included, so nothing jumps sideways when the record arrives.
 */
function DeskSkeleton() {
  return (
    <div
      style={{ paddingTop: "16px" }}
      /* role="status" as well as the label: aria-label on a bare div is a name
         on a generic element, which assistive technology is free to ignore, so
         without a role the load announces nothing at all. */
      role="status"
      aria-busy="true"
      aria-label="Loading the desk record"
    >
      {/* No gap on this row. CountStrip has none either, and a gap here would
          narrow every cell, so the four counts would step sideways the moment
          the record arrived. Separation comes from the bar widths instead. The
          4px outer padding and the 44px cell are the strip's, so the two boxes
          still measure the same. */}
      <div
        style={{
          marginTop: "18px",
          display: "flex",
          padding: "4px 0",
          borderTop: "1px solid var(--c-border)",
          borderBottom: "1px solid var(--c-border)",
        }}
      >
        {RESOLUTION_ORDER.map((bucket) => (
          <div
            key={bucket}
            style={{
              flex: 1,
              boxSizing: "content-box",
              minHeight: "44px",
              padding: "5px 0",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
            }}
          >
            <div className={styles.sk} style={{ height: "10px", width: "82%" }} />
            <div className={styles.sk} style={{ height: "17px", marginTop: "7px", width: "46%" }} />
          </div>
        ))}
      </div>
      {[0, 1, 2, 3, 4].map((i) => (
        /* The collapsed row, not the old two-paragraph one. A skeleton that
           prefigures a taller row than the list draws is a layout shift with a
           shimmer on it. */
        <div key={i} className={styles.sk} style={{ height: "69px", marginTop: "16px" }} />
      ))}
    </div>
  );
}

/**
 * A failed read is not an empty record, and the two say different things. The
 * copy is the model's, verbatim, so the mobile screen and the desktop route
 * cannot describe the same failure differently.
 */
function DeskError() {
  return (
    <div style={{ paddingTop: "18px" }} role="alert">
      <p style={{ margin: 0, font: `500 17px/1.4 ${FONT_DISPLAY}`, color: "var(--c-ink)" }}>
        {DESK_RECORD_COPY.errorTitle}
      </p>
      <p
        style={{
          margin: "10px 0 0",
          font: `400 13px/1.6 ${FONT_SANS}`,
          color: "var(--c-secondary)",
          maxWidth: "32ch",
        }}
      >
        {DESK_RECORD_COPY.errorBody}
      </p>
    </div>
  );
}

function DeskEmpty() {
  return (
    <div style={{ paddingTop: "18px" }}>
      <p style={{ margin: 0, font: `500 17px/1.4 ${FONT_DISPLAY}`, color: "var(--c-ink)" }}>
        {DESK_RECORD_COPY.emptyTitle}
      </p>
      <p
        style={{
          margin: "10px 0 0",
          font: `400 13px/1.6 ${FONT_SANS}`,
          color: "var(--c-secondary)",
          maxWidth: "32ch",
        }}
      >
        {DESK_RECORD_COPY.emptyBody}
      </p>
    </div>
  );
}

/**
 * Stale is not specified in the handoff for this screen. It is built from the
 * one fact that can go stale here: the grader's last completed run. The counts
 * and the list stay exactly where they are, because a late grading run is not
 * a reason to hide calls that were already settled.
 *
 * STILL UNREACHABLE IN PRODUCTION, and deliberately, but for one reason fewer
 * than before. `?stage=` is gated shut and `loadDeskRecord` never yields
 * `stale`; what is no longer true is that the mapper has nothing to name.
 * `lastGradedOn` is now a real date off `graded_at`, which the read has always
 * selected, so this branch would draw a true sentence the day a loader decides
 * the record is behind. Nothing here decides that, because nothing in the read
 * establishes it: the notice claims that calls closed after the run are
 * missing, and no fact in this query supports that claim.
 */
function DeskStaleNotice({ lastGradedOn }: { lastGradedOn: string }) {
  return (
    <div
      style={{
        marginTop: "14px",
        border: "1px solid var(--c-amber-edge)",
        backgroundColor: "var(--c-amber-well)",
        borderRadius: "12px",
        padding: "13px 14px",
      }}
    >
      <div style={{ font: `600 12px/1 ${FONT_SANS}`, color: "var(--c-ink)" }}>
        This record is not current.
      </div>
      <div style={{ marginTop: "4px", font: `400 11.5px/1.5 ${FONT_SANS}`, color: "var(--c-body)" }}>
        The grader last completed a run on {lastGradedOn}. Calls that closed after it are not
        on the record yet, and nothing below has been estimated in their place.
      </div>
    </div>
  );
}
