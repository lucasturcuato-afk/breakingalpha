"use client";

import Link from "next/link";
import { LedgerEntryRow } from "@/components/ledger";
import { DESK_RECORD_COPY, RESOLUTION_ORDER, type Resolution } from "@/lib/desk-record.ts";
/* Type-only. A value import out of this path would put the invented record in
   this client component's chunk in `.next/static` whether or not it can ever
   paint, which is design-lint rule `fixture-in-client-bundle`. Types erase. */
import type { DeskRecordData } from "./fixture";
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
 * Every measurement is taken off the rendered prototype through
 * `scripts/parity_harness.py --screen desk`, not from the README.
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
}: {
  stage?: DeskStage;
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

  /* No record, no record. EARLY RETURN on purpose: below this line TypeScript
     knows `data` is non-null, so no later reader needs a guard and no later
     edit can bring the fixture back by omission.

     error and empty are the two states that legitimately have nothing to draw,
     and they say different things. Anything else with no data renders the
     load, which claims only that something is on its way. */
  if (data === null) {
    return (
      <DeskChrome>
        {stage === "error" ? <DeskError /> : stage === "empty" ? <DeskEmpty /> : <DeskSkeleton />}
      </DeskChrome>
    );
  }

  return (
    <DeskChrome>
      {stage === "loading" ? <DeskSkeleton /> : null}
      {stage === "error" ? <DeskError /> : null}
      {stage === "empty" ? <DeskEmpty /> : null}

      {settled ? (
        <>
          <div
            style={{
              marginTop: "16px",
              padding: "13px 15px",
              border: "1px solid var(--c-border)",
              borderRadius: "12px",
              backgroundColor: "var(--c-well)",
            }}
          >
            <p
              style={{
                margin: 0,
                font: `400 12.5px/1.6 ${FONT_SANS}`,
                color: "var(--c-body)",
                textWrap: "pretty",
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
              Every call the desk has published{data.since ? ` since ${data.since}` : ""} that the
              grader has reached is counted here, including the ones that went against it. Nothing
              is sorted by outcome and no figure is derived from the mix.
            </p>
          </div>

          {stage === "stale" && data.lastGradedOn !== null ? (
            <DeskStaleNotice lastGradedOn={data.lastGradedOn} />
          ) : null}

          <CountStrip data={data} />

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

          <SectionRule label={data.listHeading} />
          {/* The cap, said before the reader counts rows rather than after.
              The strip above counts every row the read returned; this list is
              given only the newest page of them. A reader who counted 13
              SUPPORTED rows under a cell reading SUPPORTED 32 had no way to
              learn why, and the only cue was the word "recent" in the heading
              above.

              Both numbers come off the model, and the line claims nothing
              beyond them: how many rows the list was given, and how many the
              strip counts. It does not claim they are the only two steps
              between the two figures. They are not: the not-graded rows are
              dropped again below, which the line at the foot of the list
              accounts for. Absent entirely when nothing was truncated. */}
          {data.listCap !== null ? (
            <p
              style={{
                margin: "11px 0 0",
                font: `400 11.5px/1.55 ${FONT_SANS}`,
                color: "var(--c-muted)",
                textWrap: "pretty",
              }}
            >
              Only the {data.listCap.read} most recent calls in the record are read into this list.
              All {data.listCap.counted} are counted in the strip above.
            </p>
          ) : null}
          {/* NO `onOpen`. `ledger-entry-row.tsx:63` turns any truthy handler
              into a real `<button type="button">` with `.bare`'s pointer
              cursor, so `onOpen={() => {}}` shipped 35 focusable 350x117
              targets over real graded calls that did nothing on tap or on
              Enter. README.md:309 forbids an inert control, and a row that
              cannot be opened should not announce itself as one.

              Omitting the prop makes the row a plain container, which is the
              same call `watch-screen.tsx` already makes for the private card:
              "A card that looks tappable and is not is worse than one that
              does not."

              The Entry screen is step 6 and does not exist. Pass a handler
              here the day it does, and the rows become controls again with no
              other change. */}
          {data.entries.map((e, i) => (
            <LedgerEntryRow
              key={e.id}
              state={e.state}
              instrument={e.instrument}
              claim={e.claim}
              result={e.result}
              first={i === 0}
            />
          ))}
          {/* The list closes on a rule. Every row draws its own top hairline,
              so the last one needs a bottom edge to sit against. Gated on
              there being a list: with a loader wired, counts can be non-zero
              while the list page is empty, and a lone hairline under the
              heading reads as a rendering failure. */}
          {data.entries.length > 0 ? (
            <div style={{ height: "1px", backgroundColor: "var(--c-hair)" }} />
          ) : null}

          {/* The strip and the list disagree on purpose when a not-graded call
              is in the read: it is counted above and has no verdict word, so
              it is not listed. An unexplained gap between a count and a list
              reads as a bug or, worse, as a quiet omission. */}
          {data.hasUnlistedNotGraded ? (
            <p
              style={{
                margin: "12px 0 0",
                font: `400 11.5px/1.55 ${FONT_SANS}`,
                color: "var(--c-muted)",
                textWrap: "pretty",
              }}
            >
              Not-graded calls are counted in the strip above and are not listed here, because they
              carry no verdict. {DESK_RECORD_COPY.bucketNote.notGraded}
            </p>
          ) : null}
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
 */
function DeskChrome({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-parity="desk"
      className={styles.enter}
      style={{ backgroundColor: "var(--c-bg)", minHeight: "100%" }}
    >
      <BackToLedger />

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
          The desk&apos;s own calls, graded on the same bar as yours. Published so you can judge
          whether the briefs are worth reading before you commit to one.
        </p>

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
 * Four cells, equal width, in the model's own order. No cell is emphasised and
 * none is sorted to the front: `RESOLUTION_ORDER` puts challenged second on
 * purpose, immediately beside supported and at the same size.
 *
 * There is no total, no ratio and no derived figure of any kind here, and the
 * well above says so in the reader's own words.
 */
function CountStrip({ data }: { data: DeskRecordData }) {
  const byBucket = new Map(data.counts.map((c) => [c.bucket, c.count]));
  return (
    <div
      style={{
        marginTop: "18px",
        display: "flex",
        padding: "14px 0",
        borderTop: "1px solid var(--c-border)",
        borderBottom: "1px solid var(--c-border)",
      }}
    >
      {RESOLUTION_ORDER.map((bucket) => (
        <div key={bucket} style={{ flex: 1 }}>
          <div
            style={{
              font: `400 10px/1 ${FONT_MONO}`,
              letterSpacing: "0.07em",
              color: "var(--c-muted)",
            }}
          >
            {CELL_LABEL[bucket].toLocaleUpperCase("en-US")}
          </div>
          <div
            style={{
              marginTop: "7px",
              font: `500 17px/1 ${FONT_MONO}`,
              color: "var(--c-ink)",
            }}
          >
            {byBucket.get(bucket) ?? 0}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Italic Playfair label, then a hairline to the trailing edge. */
function SectionRule({ label }: { label: string }) {
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
      <div className={styles.sk} style={{ height: "82px", borderRadius: "12px" }} />
      {/* No gap on this row. CountStrip has none either, and a gap here would
          narrow every cell, so the four counts would step sideways the moment
          the record arrived. Separation comes from the bar widths instead. */}
      <div
        style={{
          marginTop: "18px",
          display: "flex",
          padding: "14px 0",
          borderTop: "1px solid var(--c-border)",
          borderBottom: "1px solid var(--c-border)",
        }}
      >
        {RESOLUTION_ORDER.map((bucket) => (
          <div key={bucket} style={{ flex: 1 }}>
            <div className={styles.sk} style={{ height: "10px", width: "82%" }} />
            <div className={styles.sk} style={{ height: "17px", marginTop: "7px", width: "46%" }} />
          </div>
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className={styles.sk} style={{ height: "88px", marginTop: "18px" }} />
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
 * UNREACHABLE IN PRODUCTION, by three independent mechanisms, and deliberately
 * so: `?stage=` is gated shut, `loadDeskRecord` never yields `stale`, and the
 * wired mapper has no grader-run timestamp to name so it sets `lastGradedOn`
 * null. It is reachable in dev via `?stage=stale` on the sample record, which
 * is what keeps it auditable. This is a documented absence, not live
 * behaviour, and it becomes live the day the model carries a run timestamp.
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
