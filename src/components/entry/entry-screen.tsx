"use client";

import Link from "next/link";
import {
  ClaimAnatomy,
  Chevron,
  OUTCOME_LABEL,
  OUTCOME_TOKENS,
  type OutcomeState,
} from "@/components/ledger";
/* The Ledger's module, not a copy of it. Every rule this screen needs from it
   is motion or a chrome-free button, both already written there with their
   prefers-reduced-motion guard. A second module would be a second set of
   durations to keep in step with the first. */
import styles from "@/components/ledger/ledger.module.css";
import { ENTRY_FIXTURE_ENABLED, type EntryRecord, type EntryStage } from "./fixture";

/**
 * The Entry. One record entry read months after it was written: the claim, the
 * note the reader left, what the window showed, and what it meant.
 *
 * Measured off the prototype's isEntry block, which is a 48px ruled head over a
 * single scrolling column at 22px/pad/26px. The block draws exactly one state,
 * a challenged one, so the other three are built from the same anatomy at the
 * same size rather than drawn smaller: a challenged entry and a supported one
 * are the same object and the design's own rule is that nothing distinguishes
 * them but the word and its colour.
 *
 * The screen has no data source in this unit. It renders a fixture, and the
 * lifecycle states are reached by `?stage=`, the pattern /ledger already sets,
 * because a state with no loader behind it cannot be reached by reproducing its
 * conditions and the runtime audit still has to get at it.
 *
 * That fixture and every `?stage=` it opens are gated to development and
 * preview by ENTRY_FIXTURE_ENABLED. Outside them the screen draws `unwired`.
 * This route requires a session in production but is not otherwise closed, so
 * ungated it would put an invented entry, written in the reader's own voice,
 * on the one screen whose entire subject is what the reader actually wrote.
 */

const PAD = "var(--v3-pad)";
const RULE = "1px solid var(--c-border)";

/* The prototype is a fixed 844px phone that scrolls inside its own body. Here
   the screen sits in the app shell's scrollport, which is already the viewport
   with the tab bar's height and the home indicator reserved at its foot. The
   old value was `minHeight: "100%"`, which resolves against a containing block
   with no definite height and is therefore inert: on a short state the screen's
   background stopped at the last line instead of filling the surface. This is
   the value /claim and /record both landed on. */
const SCREEN_HEIGHT =
  "calc(100dvh - var(--mobile-tabbar-height) - env(safe-area-inset-bottom))";

/* The screen's body prose.

   This is the same string ClaimAnatomy's `screen` scale declares, and it is
   deliberately NOT imported from there. The anatomy's `SCALE` table is not
   exported on this branch, and the `screen` row itself is an open conflict
   between this PR and PR 644, which measured the same slot at 14px/1.65 and
   exports the table as CLAIM_TYPE_SCALE. Coupling to a value that is under a
   ruling would move this screen's window reading and meaning well the moment
   the ruling lands, which is a worse failure than a duplicate. Whoever applies
   the ruling should export the table and replace this constant with a read of
   it; the two are one line apart. The reading and the well sit outside the
   anatomy's four slots either way, so the constant does not disappear. */
const PROSE = "400 13.5px/1.6 var(--font-inter), sans-serif";

/**
 * `entry` is required and nullable, and it has no default.
 *
 * It used to default to `ENTRY_FIXTURE`. A call site that omitted it, or that
 * passed `undefined` while a read was in flight, rendered the sample record as
 * though it were the reader's own: a note written in the first person and a
 * record line stating an entry date and a check date, none of which happened.
 * Sample content reaches this screen because a page hands it over, never
 * because a component fell back to it. `null` is the call site saying it has no
 * record, which is a statement; an omitted prop is not.
 */
export function EntryScreen({
  entry,
  stage = "ready",
}: {
  entry: EntryRecord | null;
  stage?: EntryStage;
}) {
  /* With the gate closed the screen is unwired whatever `?stage=` says. That
     parameter is how the lifecycle states are reached in development and in a
     preview; it is not a source, and it must not be able to open a state that
     asserts something about a production reader's record. */
  const gated: EntryStage = ENTRY_FIXTURE_ENABLED ? stage : "unwired";

  /* A record is the only thing `ready` and `stale` have to draw. Without one
     they are unwired, not empty: nothing was read, so nothing came back and
     nothing was ruled out. */
  const effective: EntryStage =
    (gated === "ready" || gated === "stale") && !entry ? "unwired" : gated;

  const showRecord = entry !== null && (effective === "ready" || effective === "stale");
  const windowLine = entry ? (entry.window.result ?? entry.window.pending) : undefined;

  return (
    <div
      data-parity="entry"
      style={{
        backgroundColor: "var(--c-bg)",
        minHeight: SCREEN_HEIGHT,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <EntryHead />

      <div className={styles.enter} style={{ padding: `22px ${PAD} 26px` }}>
        {effective === "loading" ? <EntrySkeleton /> : null}
        {effective === "error" ? <EntryError /> : null}
        {effective === "none" ? <EntryNotFound /> : null}
        {effective === "unwired" ? <EntryUnwired /> : null}
        {effective === "stale" && entry ? <StaleCheckNotice entry={entry} /> : null}

        {showRecord && entry ? (
          <>
            <ClaimAnatomy
              scale="screen"
              lead={<EntryLead state={entry.state} sector={entry.sector} />}
              claim={entry.claim}
            />

            <Rule />
            <MonoStamp>{entry.wroteStamp}</MonoStamp>
            <p
              style={{
                margin: "11px 0 0",
                font: "400 italic 16px/1.62 var(--font-playfair-display), serif",
                color: "var(--c-ink)",
                textWrap: "pretty",
              }}
            >
              {entry.note}
            </p>

            {/* The whole group is gated on there being a line to put in it. A
                window states what it showed or what it will show, and a loader
                that supplies neither has a gap: a labelled empty paragraph
                would present that gap as a reading. */}
            {windowLine ? (
              <>
                <Rule />
                <SectionLabel>
                  {entry.window.result ? "what the window showed" : "what the window will show"}
                </SectionLabel>
                <p
                  style={{
                    margin: "10px 0 0",
                    font: "500 15px/1.55 var(--font-inter), sans-serif",
                    color: "var(--c-ink)",
                  }}
                >
                  {windowLine}
                </p>
                {entry.window.detail ? (
                  <p style={{ margin: "9px 0 0", font: PROSE, color: "var(--c-body)", textWrap: "pretty" }}>
                    {entry.window.detail}
                  </p>
                ) : null}
              </>
            ) : null}

            {/* The meaning is written when the window closes, so an open entry
                has none and nothing stands in for it. An empty well would read
                as a reading withheld. */}
            {entry.meaning ? (
              <div
                style={{
                  marginTop: "16px",
                  padding: "14px 15px",
                  border: RULE,
                  borderRadius: "12px",
                  backgroundColor: "var(--c-well)",
                }}
              >
                <p
                  style={{
                    margin: 0,
                    font: "400 13.5px/1.65 var(--font-inter), sans-serif",
                    color: "var(--c-body)",
                    textWrap: "pretty",
                  }}
                >
                  {entry.meaning}
                </p>
              </div>
            ) : null}

            <div
              style={{
                marginTop: "18px",
                font: "400 10px/1.7 var(--font-jetbrains-mono), monospace",
                letterSpacing: "0.07em",
                color: "var(--c-muted)",
              }}
            >
              {entry.ledgerLine}
            </div>
          </>
        ) : null}

        <div style={{ height: "calc(24px + env(safe-area-inset-bottom))" }} />
      </div>
    </div>
  );
}

/* ── head ───────────────────────────────────────────────────────────── */

/**
 * The 48px ruled head. It sticks, because the design draws it outside the
 * scrolling column: the body scrolls under a head that stays.
 *
 * Both controls are real elements. The design writes them as spans carrying
 * role=button, which is the shape that has to be typed out because a prototype
 * has no router; production has one, so the control that navigates is an anchor
 * and the control that does not is a button.
 */
function EntryHead() {
  const control: React.CSSProperties = {
    minHeight: "44px",
    display: "flex",
    alignItems: "center",
    font: "500 13px/1 var(--font-inter), sans-serif",
    color: "var(--c-secondary)",
  };

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 1,
        flex: "none",
        minHeight: "48px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: `0 ${PAD}`,
        borderBottom: RULE,
        backgroundColor: "var(--c-bg)",
      }}
    >
      <Link href="/ledger" style={{ ...control, gap: "6px" }}>
        <Chevron direction="left" size={16} stroke="currentColor" />
        Ledger
      </Link>
      {/* The design points Share at the Prepared record, which is where a
          record becomes shareable. That screen is a separate unit and has no
          route yet, so there is nothing to point it at and nothing it can do.

          It is therefore drawn as what it is. It used to be `onClick={() => {}}`
          on a `styles.bare` button, which carries `cursor: pointer`, keeps the
          control in the tab order and exposes it to a screen reader as an
          enabled button. A reader could reach it, press it, and get silence.
          `disabled` takes it out of the tab order and makes the browser report
          its real state; `aria-disabled` says the same thing to any AT reading
          the attribute rather than the property. The dimming is deliberate and
          is the one place this screen diverges visually from the design: the
          design draws a control that works.

          Delete all of it and wire an href when the Prepared record lands. */}
      <button
        type="button"
        disabled
        aria-disabled="true"
        className={styles.bare}
        style={{ ...control, cursor: "default", opacity: 0.45 }}
      >
        Share
      </button>
    </div>
  );
}

/* ── parts ──────────────────────────────────────────────────────────── */

/**
 * The state dot, its word, and the sector on the trailing edge.
 *
 * A wrapper beside OutcomeLead rather than a size prop inside it. The Ledger's
 * row draws a 7px dot, an 11px word and a mono instrument; this draws an 8px
 * dot, a 12.5px word and an Inter sector, which is a different trailing object
 * and not the same one larger. The word and the colours still come from the one
 * closed table, so no second vocabulary exists.
 *
 * transition:none for the reason claim-anatomy.tsx states: easing between two
 * semantic hues renders one state's word in another state's colour.
 */
function EntryLead({ state, sector }: { state: OutcomeState; sector: string }) {
  const t = OUTCOME_TOKENS[state];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
      <span
        aria-hidden="true"
        style={{
          flex: "none",
          display: "inline-block",
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          backgroundColor: t.dot,
          transition: "none",
        }}
      />
      <span style={{ font: "600 12.5px/1 var(--font-inter), sans-serif", color: t.text, transition: "none" }}>
        {OUTCOME_LABEL[state]}
      </span>
      <span
        style={{
          marginLeft: "auto",
          font: "400 11px/1 var(--font-inter), sans-serif",
          color: "var(--c-secondary)",
        }}
      >
        {sector}
      </span>
    </div>
  );
}

function Rule() {
  return <div style={{ marginTop: "20px", height: "1px", backgroundColor: "var(--c-border)" }} />;
}

function MonoStamp({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: "16px",
        font: "400 11px/1 var(--font-jetbrains-mono), monospace",
        color: "var(--c-muted)",
      }}
    >
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: "16px",
        font: "400 italic 12.5px/1 var(--font-playfair-display), serif",
        color: "var(--c-secondary)",
      }}
    >
      {children}
    </div>
  );
}

/* ── lifecycle ──────────────────────────────────────────────────────── */

function EntrySkeleton() {
  return (
    /* role="status", not a bare div. `aria-label` on an element with no role
       has nothing to attach to and every screen reader drops it, so the loading
       state announced nothing at all: the reader was told only that the region
       had emptied. /claim, /desk-record and /record all carry the role. */
    <div role="status" aria-busy="true" aria-label="Loading this entry">
      <div className={styles.sk} style={{ height: "13px", width: "46%" }} />
      <div className={styles.sk} style={{ height: "76px", marginTop: "14px", borderRadius: "6px" }} />
      <div className={styles.sk} style={{ height: "96px", marginTop: "20px", borderRadius: "6px" }} />
      <div className={styles.sk} style={{ height: "64px", marginTop: "20px", borderRadius: "12px" }} />
    </div>
  );
}

/**
 * A failed read is not an empty result. The distinction matters more here than
 * almost anywhere: this screen is the record of something the reader wrote, and
 * a read that fails quietly reads as an entry that was removed.
 */
function EntryError() {
  return (
    <div role="alert">
      <p style={{ margin: 0, font: "500 17px/1.4 var(--font-playfair-display), serif", color: "var(--c-ink)" }}>
        We could not load this entry.
      </p>
      <p
        style={{
          margin: "10px 0 0",
          font: "400 13px/1.6 var(--font-inter), sans-serif",
          color: "var(--c-secondary)",
          maxWidth: "32ch",
        }}
      >
        This is a failed read, not an empty result. Nothing is being hidden, and the entry itself is
        unchanged.
      </p>
      {/* This shipped with no handler at all. It is the only recovery
          affordance in the error state, it is keyboard-reachable, and
          `styles.bare` gives it `cursor: pointer`, so it read as live and did
          nothing. There is no loader to retry against, so the retry is the
          read: reloading re-runs whatever this route resolves to, which is
          exactly what a reader pressing it means. /record wires the identical
          button the same way. */}
      <button
        type="button"
        onClick={() => window.location.reload()}
        className={styles.bare}
        style={{
          marginTop: "14px",
          minHeight: "44px",
          display: "inline-flex",
          alignItems: "center",
          padding: "0 17px",
          border: "1px solid var(--c-ink)",
          borderRadius: "9px",
          font: "600 13px/1 var(--font-inter), sans-serif",
          color: "var(--c-ink)",
        }}
      >
        Try again
      </button>
    </div>
  );
}

/**
 * No source behind the screen.
 *
 * Every other state on this screen is a statement about the reader's record.
 * `ready` shows them an entry, `none` tells them a link does not point at one
 * they wrote, `error` tells them a read failed, `stale` tells them when the
 * last check ran. All four are true only once something has actually been
 * read, and nothing on this branch reads anything.
 *
 * So the fallback says the third thing. It names the screen, not the reader:
 * no entry was fetched, so none was found, none was missed and none was ruled
 * out. A skeleton here would be its own lie, because nothing is coming.
 */
function EntryUnwired() {
  return (
    <div role="status">
      <p style={{ margin: 0, font: "500 17px/1.4 var(--font-playfair-display), serif", color: "var(--c-ink)" }}>
        This screen is not reading from your record yet.
      </p>
      <p
        style={{
          margin: "10px 0 0",
          font: "400 13px/1.6 var(--font-inter), sans-serif",
          color: "var(--c-secondary)",
          maxWidth: "34ch",
          textWrap: "pretty",
        }}
      >
        No entry has been fetched, so nothing has been found and nothing has been ruled out. The
        screen is built and the read behind it is not.
      </p>
    </div>
  );
}

function EntryNotFound() {
  return (
    <div>
      <p style={{ margin: 0, font: "500 17px/1.4 var(--font-playfair-display), serif", color: "var(--c-ink)" }}>
        That entry is not on your record.
      </p>
      <p
        style={{
          margin: "10px 0 0",
          font: "400 13px/1.6 var(--font-inter), sans-serif",
          color: "var(--c-secondary)",
          maxWidth: "32ch",
        }}
      >
        Nothing failed to load. This link does not point at an entry you have written, and the rest
        of your record is unaffected.
      </p>
    </div>
  );
}

/**
 * Stale on this screen is not a stale brief. The entry is a record and does not
 * go out of date; what can be old is the check behind it. So the notice states
 * the date of the last completed check and says nothing has been re-estimated
 * since, and the entry renders in full beneath it.
 *
 * An entry whose window is still open has no completed check, so it gets the
 * second wording rather than the first with a date invented for it. Naming the
 * entry date as a check is the record stating something that did not happen,
 * which is the one thing this screen exists to not do.
 */
function StaleCheckNotice({ entry }: { entry: EntryRecord }) {
  const checked = entry.checkedOn;
  return (
    <div
      style={{
        marginBottom: "18px",
        border: "1px solid var(--c-amber-edge)",
        backgroundColor: "var(--c-amber-well)",
        borderRadius: "12px",
        padding: "13px 14px",
      }}
    >
      <div style={{ font: "600 12px/1 var(--font-inter), sans-serif", color: "var(--c-ink)" }}>
        {checked ? "This is the last completed check." : "Nothing has been checked yet."}
      </div>
      <div style={{ marginTop: "4px", font: "400 11.5px/1.5 var(--font-inter), sans-serif", color: "var(--c-body)" }}>
        {checked
          ? `Recorded ${checked}. Nothing has been re-read since, and nothing here is estimated in the meantime.`
          : "The window is still open. Nothing here is estimated in the meantime."}
      </div>
    </div>
  );
}
