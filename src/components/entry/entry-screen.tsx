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
import { ENTRY_FIXTURE, type EntryRecord, type EntryStage } from "./fixture";

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
 */

const PAD = "var(--v3-pad)";
const RULE = "1px solid var(--c-border)";

/* The screen's body prose, the same value ClaimAnatomy's `screen` scale
   declares. Named once here because the window's reading and the meaning well
   sit outside the anatomy's slot order. */
const PROSE = "400 13.5px/1.6 Inter, sans-serif";

export function EntryScreen({
  entry = ENTRY_FIXTURE,
  stage = "ready",
}: {
  entry?: EntryRecord;
  stage?: EntryStage;
}) {
  const showRecord = stage === "ready" || stage === "stale";
  const windowLine = entry.window.result ?? entry.window.pending;

  return (
    <div
      data-parity="entry"
      style={{
        backgroundColor: "var(--c-bg)",
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <EntryHead />

      <div className={styles.enter} style={{ padding: `22px ${PAD} 26px` }}>
        {stage === "loading" ? <EntrySkeleton /> : null}
        {stage === "error" ? <EntryError /> : null}
        {stage === "none" ? <EntryNotFound /> : null}
        {stage === "stale" ? <StaleCheckNotice entry={entry} /> : null}

        {showRecord ? (
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
                font: "400 italic 16px/1.62 'Playfair Display', serif",
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
                    font: "500 15px/1.55 Inter, sans-serif",
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
                    font: "400 13.5px/1.65 Inter, sans-serif",
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
                font: "400 10px/1.7 'JetBrains Mono', monospace",
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
    font: "500 13px/1 Inter, sans-serif",
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
      <button
        type="button"
        /* The design points Share at the Prepared record, which is where a
           record becomes shareable. That screen is a separate unit and has no
           route yet, so this is a no-op rather than a link into a 404. Wire it
           to /record when the Prepared record lands. */
        onClick={() => {}}
        className={styles.bare}
        style={control}
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
      <span style={{ font: "600 12.5px/1 Inter, sans-serif", color: t.text, transition: "none" }}>
        {OUTCOME_LABEL[state]}
      </span>
      <span
        style={{
          marginLeft: "auto",
          font: "400 11px/1 Inter, sans-serif",
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
        font: "400 11px/1 'JetBrains Mono', monospace",
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
        font: "400 italic 12.5px/1 'Playfair Display', serif",
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
    <div aria-busy="true" aria-label="Loading this entry">
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
      <p style={{ margin: 0, font: "500 17px/1.4 'Playfair Display', serif", color: "var(--c-ink)" }}>
        We could not load this entry.
      </p>
      <p
        style={{
          margin: "10px 0 0",
          font: "400 13px/1.6 Inter, sans-serif",
          color: "var(--c-secondary)",
          maxWidth: "32ch",
        }}
      >
        This is a failed read, not an empty result. Nothing is being hidden, and the entry itself is
        unchanged.
      </p>
      <button
        type="button"
        className={styles.bare}
        style={{
          marginTop: "14px",
          minHeight: "44px",
          display: "inline-flex",
          alignItems: "center",
          padding: "0 17px",
          border: "1px solid var(--c-ink)",
          borderRadius: "9px",
          font: "600 13px/1 Inter, sans-serif",
          color: "var(--c-ink)",
        }}
      >
        Try again
      </button>
    </div>
  );
}

function EntryNotFound() {
  return (
    <div>
      <p style={{ margin: 0, font: "500 17px/1.4 'Playfair Display', serif", color: "var(--c-ink)" }}>
        That entry is not on your record.
      </p>
      <p
        style={{
          margin: "10px 0 0",
          font: "400 13px/1.6 Inter, sans-serif",
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
      <div style={{ font: "600 12px/1 Inter, sans-serif", color: "var(--c-ink)" }}>
        {checked ? "This is the last completed check." : "Nothing has been checked yet."}
      </div>
      <div style={{ marginTop: "4px", font: "400 11.5px/1.5 Inter, sans-serif", color: "var(--c-body)" }}>
        {checked
          ? `Recorded ${checked}. Nothing has been re-read since, and nothing here is estimated in the meantime.`
          : "The window is still open. Nothing here is estimated in the meantime."}
      </div>
    </div>
  );
}
