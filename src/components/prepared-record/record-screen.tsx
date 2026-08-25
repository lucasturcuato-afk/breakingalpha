"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { OUTCOME_STATES } from "@/components/ledger";
import { BackChevron } from "./back-chevron";
import { RecordEntryRow } from "./record-entry-row";
import { RecordMonthRule } from "./record-month-rule";
import {
  RECORD_FIXTURE,
  RECORD_FIXTURE_ENABLED,
  RECORD_UNAVAILABLE,
  countsByState,
  groupByMonth,
  longDate,
  type RecordData,
} from "./fixture";
import styles from "./record.module.css";

/**
 * The Prepared record. The artifact: complete, uncurated, exportable, every
 * entry the user has ever made in one reverse-chronological sequence with a
 * month rule marking each boundary.
 *
 * Every measurement is taken off the rendered design through
 * `scripts/parity_harness.py --screen record` with getComputedStyle, not
 * transcribed from the README.
 *
 * THE THREE RULES THIS SCREEN EXISTS TO KEEP, and each has a way it could be
 * broken quietly:
 *
 *  1. Uncurated. There is no filter control anywhere on this screen and no
 *     sort other than the sequence the data arrives in. `groupByMonth` labels
 *     that sequence rather than re-ordering it. Adding either would be the
 *     single change that turns the record from evidence into a highlight reel.
 *  2. No aggregate. Four counts, month counts, a total in the range line.
 *     Nothing divides any of them by anything.
 *  3. Challenged entries are not punished. They carry the same row, the same
 *     type, the same cell in the count strip, and they sit where they fell.
 */

export type RecordStage =
  | "ready"
  | "loading"
  | "error"
  | "empty"
  | "unresolved"
  | "stale"
  /**
   * No source behind the screen. Distinct from `error`, and the distinction is
   * the whole point: `error` says a read was attempted and failed, `empty`
   * says a read came back with nothing, `loading` says one is running. In
   * production none of the three has happened. The fixture is withheld by the
   * gate, so there is nothing to run, and `unavailable` is the only one of the
   * four that is true. Same third state /ask built for the same situation.
   */
  | "unavailable";

const PAD = "var(--v3-pad)";

export function RecordScreen({
  stage = "ready",
  data,
}: {
  stage?: RecordStage;
  /** Always supplied by the caller, which resolves the gate. Never defaulted. */
  data: RecordData;
}) {
  /* The gate is enforced HERE, not only at the call site. `page.tsx` also
     resolves it, because the server component picks which fixture to hand
     over, but a second entry point that forgot to would otherwise render the
     fixture straight into production. Whatever `?stage=` asks for, with the
     gate closed the screen is unavailable. In development and preview
     `?stage=unavailable` reaches this branch on purpose so the state can be
     audited and captured like the rest. */
  const effective: RecordStage = RECORD_FIXTURE_ENABLED ? stage : "unavailable";

  const entries = effective === "unavailable" ? [] : data.entries;
  const counts = countsByState(entries);
  const months = groupByMonth(entries);
  const showList =
    effective === "ready" || effective === "stale" || effective === "unresolved";
  const showExport = showList && entries.length > 0;

  return (
    <div
      data-parity="record"
      style={{
        backgroundColor: "var(--c-bg)",
        /* The shell's scroller reserves the tab bar and the safe area in its
           own padding, so its content box is exactly this. Stated rather than
           left at `100%`, which resolves against a parent with no height and
           let the shell's parchment show under a short state. */
        minHeight: "calc(100dvh - var(--mobile-tabbar-height) - env(safe-area-inset-bottom))",
        /* NO gutter on the root, deliberately. Every block below carries the
           design's own `var(--v3-pad)`, so a gutter here would be a second one
           and the text column would come out 40px narrow at 310 instead of 350.
           `#v3phone` in the prototype (line 247) has no padding; the parity
           harness injects one at its line 1062, which is why a doubled gutter
           diffs CLEAN at --width 390 and is wrong on a phone. Measured, both
           sides, in the PR body. The back bar's rule and the export bar's rule
           are full bleed for the same reason: the design draws them across the
           phone, not across the text column. */
        padding: 0,
      }}
    >
      <BackBar />

      <div className={styles.enter} style={{ padding: `24px ${PAD} 20px` }}>
        {/* The range line is a statement about the record, so it is withheld
            unless the record is actually on screen. On `loading` it would sit
            above a skeleton asserting a size nothing has read yet, and on
            `error` it would print an exact count and range directly above the
            sentence "we could not load your record". */}
        <Masthead data={effective === "unavailable" ? RECORD_UNAVAILABLE : data} summarize={showList} />

        {effective === "loading" ? <RecordSkeleton /> : null}
        {/* The retry is withheld when there is no record behind the screen.
            A button whose only action is a reload back into the same closed
            gate cannot succeed on any attempt, ever, and offering it says a
            read might work next time. */}
        {effective === "error" ? <RecordError retryable={data !== RECORD_UNAVAILABLE} /> : null}
        {effective === "unavailable" ? <RecordUnavailable /> : null}
        {effective === "empty" ? <NoCalls /> : null}
        {effective === "stale" ? <StaleNotice data={data} /> : null}
        {effective === "unresolved" ? <NoneResolved /> : null}

        {/* The count strip is drawn only once something has resolved. A record
            with nothing graded in it renders the honest sentence instead of a
            zeroed scoreboard, which is the rule src/lib/your-record.ts states
            and the reason it publishes `hasResolved` at all. */}
        {showList && entries.length > 0 && effective !== "unresolved" ? (
          <CountStrip counts={counts} />
        ) : null}

        {showList
          ? months.map((month) => (
              /* Keyed on the first entry, not on the label. `groupByMonth`
                 deliberately does not re-order, so an entry arriving out of
                 sequence opens a SECOND run of a month already rendered above
                 it and two groups then carry the same label. Keying on the
                 label duplicates a React key in exactly the case the grouper
                 exists to survive. */
              <div key={month.entries[0].id}>
                <RecordMonthRule label={month.label} count={month.entries.length} />
                {month.entries.map((entry) => (
                  <RecordEntryRow
                    key={entry.id}
                    date={entry.date}
                    state={entry.state}
                    claim={entry.claim}
                    note={entry.note}
                    outcome={entry.result ?? entry.window}
                    /* TODO: open the Entry screen. /entry is its own unit of
                       the mobile build and does not exist on this branch yet;
                       linking at it now would aim every row at a 404. No
                       `onOpen` until it does: a handler that does nothing
                       renders the row as a <button>, and forty-one focus stops
                       that announce as controls and then do nothing on tap is
                       worse than a row that never claimed to be one. The row
                       already has the non-interactive branch for this. */
                  />
                ))}
              </div>
            ))
          : null}
      </div>

      {showExport ? <ExportBar count={entries.length} /> : null}

      {/* The tab bar's height, reserved a second time, because the shell's
          reservation does not reach this content.

          The shell pads its scroller by exactly this, but the record overflows
          an intermediate `h-full` box, and a scroller's end padding is not
          added to the scrollable overflow of a descendant that overflows it.
          Measured at 390x844 with 41 entries: scrollHeight 7346 against a root
          of 7346, so the padding contributed nothing, the root's last pixel
          landed at 844 behind the tab bar, and the sticky bar at its resting
          bottom of 785 covered the final result line, which ended at 727.
          With this the bar rests flush on the last row instead. */}
      <div style={{ height: "calc(var(--mobile-tabbar-height) + env(safe-area-inset-bottom))" }} />
    </div>
  );
}

/* ── blocks ─────────────────────────────────────────────────────────── */

function BackBar() {
  return (
    <div
      style={{
        /* 49, not the design's 48. The design's bar is content-box, so its 48px
           minimum sits above a 1px rule and measures 49 rendered. Everything
           here is border-box under the framework reset, so the rule has to be
           inside the number. */
        minHeight: "49px",
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
          font: "500 13px/1 Inter, sans-serif",
          color: "var(--c-secondary)",
          textDecoration: "none",
        }}
      >
        <BackChevron />
        Ledger
      </Link>
    </div>
  );
}

function Masthead({ data, summarize }: { data: RecordData; summarize: boolean }) {
  const entries = data.entries;
  const oldest = entries[entries.length - 1];
  const newest = entries[0];

  return (
    <div style={{ paddingBottom: "16px", borderBottom: "2px solid var(--c-ink)" }}>
      <div style={{ font: "400 11px/1 'JetBrains Mono', monospace", color: "var(--c-muted)" }}>
        PREPARED RECORD
      </div>
      {/* The name is the signature on the artifact, so an absent one is left
          absent rather than filled with a placeholder. A record headed by
          somebody else's name is the one failure this screen cannot have. */}
      {data.name ? (
        <h1
          style={{
            margin: "11px 0 0",
            font: "700 25px/1.15 'Playfair Display', serif",
            letterSpacing: "-0.02em",
            color: "var(--c-ink)",
          }}
        >
          {data.name}
        </h1>
      ) : null}
      {/* The range is derived from the entries, never authored beside them. A
          hand-written range that outlives an edit to the list is how a record
          starts describing something other than itself. With no entries the
          line is withheld rather than reworded: "every entry is included" over
          an empty record is a sentence about nothing. */}
      {summarize && oldest && newest ? (
        <p
          style={{
            margin: "8px 0 0",
            font: "400 12.5px/1.55 Inter, sans-serif",
            color: "var(--c-secondary)",
          }}
        >
          {/* A record of one is a real record, and "1 calls entered between
              June 2 and June 2" is how it reads without this. */}
          {entries.length === 1
            ? `1 call entered on ${longDate(newest.date)}. `
            : `${entries.length} calls entered between ${longDate(oldest.date)} and ${longDate(newest.date)}. `}
          Every entry is included. Nothing is sorted, filtered or removed.
        </p>
      ) : null}
    </div>
  );
}

function CountStrip({ counts }: { counts: Record<(typeof OUTCOME_STATES)[number], number> }) {
  return (
    <div style={{ display: "flex", padding: "14px 0", borderBottom: "1px solid var(--c-border)" }}>
      {/* OUTCOME_STATES order, not a ranking. Challenged sits second, beside
          supported, at the same size in the same kind of cell. Anything that
          moved it to the end would be burying it. */}
      {OUTCOME_STATES.map((state) => (
        <div key={state} style={{ flex: 1 }}>
          <div
            style={{
              font: "400 10px/1 'JetBrains Mono', monospace",
              letterSpacing: "0.07em",
              color: "var(--c-muted)",
            }}
          >
            {state.toUpperCase()}
          </div>
          <div
            style={{
              marginTop: "7px",
              font: "500 17px/1 'JetBrains Mono', monospace",
              color: "var(--c-ink)",
            }}
          >
            {/* A count. No denominator beside it, and nothing derived from it. */}
            {counts[state]}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── export ─────────────────────────────────────────────────────────── */

const NOTICE_MS = 2600;

function ExportBar({ count }: { count: number }) {
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const announce = useCallback((text: string) => {
    setNotice(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setNotice("");
      setCopied(false);
    }, NOTICE_MS);
  }, []);

  const onLink = useCallback(async () => {
    try {
      /* Origin and path only. `location.href` carries `?stage=`, the audit
         switch, so a link copied while auditing hands the recipient a forced
         lifecycle state instead of the record. */
      await navigator.clipboard.writeText(window.location.origin + window.location.pathname);
      setCopied(true);
      announce(
        `Link copied. It opens the record whole, all ${count} entries, and cannot be filtered before it is shared.`,
      );
    } catch {
      setCopied(false);
      announce("The link could not be copied, and nothing was shared.");
    }
  }, [announce, count]);

  /* TODO: build the record export. Nothing in the repo exports a record: the
     only PDF path is /print/[briefing_id], which forwards cookies to
     /api/briefing, a propose-only file, and what a shared record exposes is an
     access-control decision nobody has made yet (batch-2 open question 7). The
     button keeps the design's state, and says what it is instead of animating
     through a two-stage "Saved to Files" that saved nothing. */
  const onExport = useCallback(() => {
    announce("The export is not built yet. Link shares the same record, whole.");
  }, [announce]);

  return (
    <div
      className={styles.exportBar}
      style={{
        padding: `12px ${PAD} 16px`,
        borderTop: "1px solid var(--c-border)",
        display: "flex",
        flexDirection: "column",
        /* No gap: the live region below is always mounted, so a gap would
           reserve 8px above the buttons on every frame the notice is empty.
           The notice box carries its own 8px instead. */
      }}
    >
      {/* The live region is mounted for the life of the bar and only its text
          changes. Mounting the region and its content on the same frame is the
          one thing that reliably does NOT announce: a screen reader watches a
          live region for mutations, and a region that did not exist a frame ago
          has nothing to have mutated. So the box is conditional, the region is
          not, and the copy confirmation is actually spoken. */}
      <div role="status" aria-live="polite">
        {notice ? (
          <div
            className={styles.enter}
            style={{
              /* 40, not 38: the design's strip is content-box inside a 1px rule. */
              minHeight: "40px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "0 13px",
              marginBottom: "8px",
              border: "1px solid var(--c-border)",
              borderRadius: "9px",
              backgroundColor: "var(--c-well)",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                flex: "none",
                display: "inline-block",
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                backgroundColor: "var(--c-gold)",
              }}
            />
            <span style={{ font: "500 12px/1.4 Inter, sans-serif", color: "var(--c-body)" }}>
              {notice}
            </span>
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: "9px" }}>
        <button
          type="button"
          onClick={onLink}
          className={styles.bare}
          style={{
            flex: 1,
            /* 52, not the design's 50, for the same content-box reason. */
            minHeight: "52px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "7px",
            borderRadius: "9px",
            border: `1px solid ${copied ? "var(--c-gold)" : "var(--c-border)"}`,
            backgroundColor: copied ? "var(--c-well)" : "transparent",
            font: `${copied ? 600 : 500} 13px/1 Inter, sans-serif`,
            color: copied ? "var(--c-ink)" : "var(--c-secondary)",
          }}
        >
          {copied ? "✓ Link copied" : "Link"}
        </button>
        <button
          type="button"
          onClick={onExport}
          className={styles.bare}
          style={{
            flex: 1,
            minHeight: "52px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "7px",
            borderRadius: "9px",
            border: "1px solid var(--c-ink)",
            backgroundColor: "var(--c-inverse)",
            font: "600 13px/1 Inter, sans-serif",
            color: "var(--c-oninv)",
          }}
        >
          Export PDF
        </button>
      </div>
    </div>
  );
}

/* ── lifecycle ──────────────────────────────────────────────────────── */

function RecordSkeleton() {
  return (
    /* role="status", because an aria-label on a plain <div> has no role to
       attach to and is dropped by every screen reader. Without it the loading
       state announces nothing at all. */
    <div
      style={{ paddingTop: "14px" }}
      role="status"
      aria-busy="true"
      aria-label="Loading the prepared record"
    >
      <div className={styles.sk} style={{ height: "46px" }} />
      {[0, 1, 2].map((i) => (
        <div key={i} className={styles.sk} style={{ height: "118px", marginTop: "16px" }} />
      ))}
    </div>
  );
}

/**
 * A failed read is not an empty result, and on a record whose whole claim is
 * that nothing was curated away, a failed read that reads as an empty one is
 * the worst thing this screen can do. The copy says which it is in both
 * directions.
 *
 * This copy is now only ever shown over a read that actually happened and
 * actually failed. It used to double as the production fallback, which was the
 * same fault in miniature: the fixture had been withheld by the gate, nothing
 * had been read, nothing had failed, and the screen said "This is a failed
 * read" anyway. `unavailable` carries that case now.
 *
 * `retryable` is false when there is no record behind the screen at all. A
 * reload cannot change that, on this attempt or any other, and a control that
 * provably cannot succeed is worse than no control: it tells the reader the
 * read is worth trying again.
 */
function RecordError({ retryable = true }: { retryable?: boolean }) {
  return (
    <div style={{ paddingTop: "18px" }} role="alert">
      <p style={{ margin: 0, font: "500 17px/1.4 'Playfair Display', serif", color: "var(--c-ink)" }}>
        We could not load your record.
      </p>
      <p
        style={{
          margin: "10px 0 0",
          maxWidth: "32ch",
          font: "400 13px/1.6 Inter, sans-serif",
          color: "var(--c-secondary)",
        }}
      >
        This is a failed read, not an empty result. Nothing has been removed, and nothing is
        estimated in its place.
      </p>
      {retryable ? (
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
            font: "600 13px/1 Inter, sans-serif",
            color: "var(--c-ink)",
          }}
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

/**
 * No source behind the screen. What production draws.
 *
 * The rule this state exists for: when there is no data, render nothing or
 * render loading, never a sentence about the reader or their record. So this
 * block says one thing only, and it is a fact about the SCREEN rather than
 * about the record. It does not say how many calls there are, it does not say
 * there are none, it does not say a read failed, and it offers no control,
 * because there is nothing behind this surface for a control to reach.
 *
 * The masthead above it is already reduced to its label: with no entries the
 * range line is withheld, and the name is empty rather than borrowed, so
 * nothing on the screen is signed by anybody.
 *
 * The live region is polite, not an alert. Nothing here has failed.
 */
function RecordUnavailable() {
  return (
    <div style={{ paddingTop: "18px" }} role="status">
      <p style={{ margin: 0, font: "500 17px/1.4 'Playfair Display', serif", color: "var(--c-ink)" }}>
        The prepared record is not wired to a source yet.
      </p>
      <p
        style={{
          margin: "10px 0 0",
          maxWidth: "34ch",
          font: "400 13px/1.6 Inter, sans-serif",
          color: "var(--c-secondary)",
          textWrap: "pretty",
        }}
      >
        Nothing has been read here, so there is nothing to show and nothing is estimated in its
        place. Your entries are untouched by this screen. The Ledger is live.
      </p>
    </div>
  );
}

/** Zero calls entered. Adopted from YOUR_RECORD_COPY.noClaimsTitle. */
function NoCalls() {
  return (
    <div style={{ paddingTop: "18px" }}>
      <p style={{ margin: 0, font: "500 17px/1.4 'Playfair Display', serif", color: "var(--c-ink)" }}>
        You have not made a call yet.
      </p>
      <p
        style={{
          margin: "10px 0 0",
          maxWidth: "34ch",
          font: "400 13px/1.6 Inter, sans-serif",
          color: "var(--c-secondary)",
        }}
      >
        Commit one from the Ledger. It is graded on its own window and the result stands, supported
        or challenged.
      </p>
      <Link
        href="/ledger"
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
          textDecoration: "none",
        }}
      >
        Make a call
      </Link>
    </div>
  );
}

/**
 * Calls held, none resolved. A distinct state from zero calls, and the reason
 * the count strip is withheld rather than drawn at four zeros. The entries
 * still render below: an unresolved record is still the whole record.
 */
function NoneResolved() {
  return (
    <div style={{ paddingTop: "18px" }}>
      <p style={{ margin: 0, font: "500 17px/1.4 'Playfair Display', serif", color: "var(--c-ink)" }}>
        None of your calls has resolved yet.
      </p>
      <p
        style={{
          margin: "10px 0 0",
          maxWidth: "36ch",
          font: "400 13px/1.6 Inter, sans-serif",
          color: "var(--c-secondary)",
        }}
      >
        Each one is graded on its own window, against real prices, whichever way it goes. Nothing of
        the desk&rsquo;s is shown here in the meantime.
      </p>
    </div>
  );
}

/**
 * The record was prepared, then the overnight review settled more of it. Stale
 * here is about the artifact rather than about a publication: the counts above
 * describe the record as it stood when it was prepared, and the honest thing
 * is to say how many entries have moved since rather than to silently redraw.
 */
function StaleNotice({ data }: { data: RecordData }) {
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
      <div style={{ font: "600 12px/1 Inter, sans-serif", color: "var(--c-ink)" }}>
        Prepared {data.preparedAt}.
      </div>
      <div style={{ marginTop: "4px", font: "400 11.5px/1.5 Inter, sans-serif", color: "var(--c-body)" }}>
        {data.settledSincePrepared === 1
          ? "1 entry has settled"
          : `${data.settledSincePrepared} entries have settled`}{" "}
        after this record was prepared, so the counts below are the counts it was prepared with.
        Nothing has been removed.
      </div>
    </div>
  );
}
