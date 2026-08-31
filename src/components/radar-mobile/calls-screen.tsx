"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ClaimAnatomy, LedgerEntryRow, type OutcomeState } from "@/components/ledger";
import { SectionRule, WatchNotice, WatchSkeleton } from "@/components/watch";
import { ClaimEvidenceStrip } from "@/components/calls/ClaimEvidenceStrip";
import type { RawEvidenceRow } from "@/lib/claim-evidence";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";

/**
 * Radar / Calls, on a phone. The third of Radar's four sections.
 *
 * WHAT THIS SECTION IS. Two lists: the reader's own calls with the verdicts the
 * attribution grader wrote against them, and the desk's calls from the last
 * fortnight grouped by what they are about. Both are graded, which is what
 * separates this half of Radar from Following and Watchlist beside it.
 *
 * IT DRAWS NO CARD ANATOMY OF ITS OWN. Every row here is `LedgerEntryRow`, the
 * same ruled row the mobile Desk record draws its list with, so the two graded
 * sections of Radar read as one thing rather than as two screens that happen to
 * be adjacent. `ScoredObject` is the desk's card and is deliberately not used:
 * it renders "No clean read", the mobile outcome vocabulary is closed at four
 * words, and a fifth word on a phone is a compliance defect rather than a style
 * difference. `src/lib/mobile-outcome-state.ts` carries that bridge and its
 * reasoning.
 *
 * THE JUDGEMENT IS NOT RE-DERIVED HERE. The caller maps rows through
 * `claimCardProps` and `scoredCallProps`, the same two pure functions the desk
 * uses, so what a verdict MEANS is decided in one place for both surfaces and
 * only the word and the row differ.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS SECTION DOES NOT DRAW, AND WHY. None of it says so on screen,
 * under the ruling of 2026-08-29: omit silently unless the absence would
 * mislead. Nothing below leaves a rendered figure meaning something else, and
 * nothing on screen implies any of it is coming.
 *
 *   THE RECORD RING     The desk's `RecordHero` renders a percentage. No
 *                       aggregate rate or accuracy figure may appear on a
 *                       mobile surface, so this is not a layout that was too
 *                       wide to port: the figure itself is barred. Nothing here
 *                       counts, totals or divides.
 *   THE PINNED HERO     Pins live in `localStorage` under `radar-calls-pinned`
 *                       and in no table. A phone pin list would be a DIFFERENT
 *                       list from the desk's, on the same account, with nothing
 *                       to reconcile them.
 *   RESOLVING SOON      A re-sort of the list already on the screen, costing a
 *                       hero's worth of vertical space to say again what each
 *                       row's own window line says.
 *   AUTHORING           `AuthorClaim` proposes a claim through a model pass and
 *                       then writes it. This section reads; the desk authors.
 *   ADOPT               `CallCommitFooter` and the adopt path are writes, and
 *                       they belong beside the authoring flow rather than on
 *                       their own on a read surface.
 *   THE EVIDENCE MAP    `EvidenceMap` is an SVG force graph, desktop-only by
 *                       construction.
 *   TRACKED VIEWS       73 `theses` rows and every one of them has a NULL
 *                       `user_id`, so there is no reader to scope a tracked
 *                       view to. Already cut from `/watch` for the same reason;
 *                       `src/components/watch/omissions.ts` holds it.
 *   THE JUMP NAV        `GroupJumpNav` is `sticky top-0` and its `bleed` prop
 *                       assumes a `p-6` desktop page. On a full-bleed phone
 *                       screen it would pin at the very top, over the section
 *                       row rather than under it. Six group headings on a list
 *                       of twelve is navigable by thumb.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type CallsStage = "ready" | "loading" | "error";

/** One row, already reduced to what the row draws. */
export interface CallRow {
  id: string;
  /**
   * The outcome word, or null when there is no credible grade and none is
   * coming. Null is NOT "awaiting": see `src/lib/mobile-outcome-state.ts`.
   */
  state: OutcomeState | null;
  /** Ticker and date, on the trailing edge of the state row. */
  instrument?: string;
  /** The claim in the words it was made in. Never rewritten, never truncated. */
  claim: string;
  /** How it settled, or what it is watching for while it has not. */
  result?: string;
  /** Present only on a row with no grade, in place of the state word. */
  notGradedReason?: string;
  /** Supporting and challenging stories logged while the claim waits. */
  evidence?: RawEvidenceRow[] | null;
}

export interface CallGroup {
  id: string;
  label: string;
  rows: CallRow[];
}

export interface CallsData {
  /** The reader's own calls, newest first. */
  yours: CallRow[];
  /** True when `user_claims` is absent (migration sql/0012 pending). */
  yoursUnavailable: boolean;
  /** The claims read failed. NEVER the same answer as an empty list. */
  yoursFailed: boolean;
  /** The desk's recent calls, grouped by what they are about. */
  brief: CallGroup[];
  /** The brief-call read failed. NEVER the same answer as a quiet fortnight. */
  briefFailed: boolean;
  /**
   * The verdict read failed, so no row in `brief` carries a state it can trust.
   * Distinct from every call being open, which is a real answer.
   */
  briefVerdictsUnknown: boolean;
  /** How many days back the brief list reaches. Rendered, never assumed. */
  briefDays: number;
}

const PAD = "var(--v3-pad)";

export function CallsScreen({
  stage = "ready",
  data,
  nav,
  onRetry,
}: {
  stage?: CallsStage;
  /**
   * The two lists, or null when there is no reader to scope them to. REQUIRED
   * and NULLABLE, never a default parameter, for the reason
   * `src/app/desk-record/page.tsx` records: a default is a live reference the
   * bundler cannot drop, and a screen that defaults its data is a screen that
   * can render something nobody read.
   */
  data: CallsData | null;
  /** Radar's four-section row. Required, as on every section. */
  nav: ReactNode;
  onRetry?: () => void;
}) {
  const router = useRouter();
  const retry = onRetry ?? (() => router.refresh());
  const loading = stage === "loading";

  /* No reader, no calls. EARLY RETURN, so below this line TypeScript knows
     `data` is non-null and no later edit can bring an empty shape back by
     leaving the prop off. This is NOT an empty state: it says the screen could
     not work out whose calls to read, which is the only thing it knows. */
  if (data === null) {
    return (
      <Frame nav={nav}>
        <Masthead />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: `18px ${PAD} 24px` }}>
          <WatchNotice
            heading="Could not work out whose calls to read."
            body="Your session did not resolve, so nothing was read. This is not an empty record, and no call you have made has been lost."
            onRetry={retry}
          />
        </div>
        <TabBarClearance />
      </Frame>
    );
  }

  const briefRows = data.brief.reduce((n, g) => n + g.rows.length, 0);

  return (
    <Frame nav={nav} busy={loading}>
      <Masthead />

      <div style={{ flex: 1, padding: `18px ${PAD} 24px` }}>
        {/* ── your calls ─────────────────────────────────────────────── */}
        <SectionRule
          label="your calls"
          count={loading || data.yoursFailed ? undefined : `${data.yours.length}`}
        />
        <Standfirst>
          Every call you have made, in the words you made it in, with the verdict the
          grader wrote against it.
        </Standfirst>

        {loading ? <WatchSkeleton rows={3} /> : null}

        {!loading && data.yoursFailed ? (
          <WatchNotice
            heading="Could not load your calls."
            body="This is a loading failure, not an empty record. Nothing you have tracked has been lost."
            onRetry={retry}
          />
        ) : null}

        {/* A missing table is a third thing again: the read answered, and what
            it answered is that the storage is not there yet. Saying "no calls"
            would be a claim about the reader that nothing supports. */}
        {!loading && !data.yoursFailed && data.yoursUnavailable ? (
          <WatchNotice
            heading="Calls storage is not set up on this account yet."
            body="The desk's calls below are unaffected and their grades are real."
          />
        ) : null}

        {!loading && !data.yoursFailed && !data.yoursUnavailable ? (
          <>
            {data.yours.map((row, i) => (
              <Row key={row.id} row={row} first={i === 0} />
            ))}
            {data.yours.length === 0 ? (
              <WatchNotice
                body="No calls tracked yet. Calls are made in your own words on the desk, or adopted there from one of the desk's own."
                action={{ href: "/radar/calls", label: "Open the calls desk" }}
              />
            ) : null}
          </>
        ) : null}

        {/* ── from the brief ─────────────────────────────────────────── */}
        <SectionRule
          label="from the brief"
          count={loading || data.briefFailed ? undefined : `${briefRows}`}
          marginTop="26px"
        />
        <Standfirst>
          {`The desk's own calls from the last ${data.briefDays} days, grouped by what they are about. Only a move beyond sector and market counts.`}
        </Standfirst>

        {loading ? <WatchSkeleton rows={4} /> : null}

        {!loading && data.briefFailed ? (
          <WatchNotice
            heading="Could not load the desk's calls."
            body="This is a loading failure, not a quiet fortnight."
            onRetry={retry}
          />
        ) : null}

        {/* The verdicts failed while the calls arrived. Without this the reader
            would see twelve calls with no state on any of them and reasonably
            read that as twelve calls nobody has graded. */}
        {!loading && !data.briefFailed && data.briefVerdictsUnknown ? (
          <WatchNotice
            heading="Could not read the grades for these."
            body="The calls below are real and the desk published them. What is missing is how each one settled, so none of them is drawn with a state."
            onRetry={retry}
          />
        ) : null}

        {!loading && !data.briefFailed ? (
          <>
            {data.brief.map((group) => (
              <div key={group.id} style={{ marginTop: "18px" }}>
                <h2
                  style={{
                    margin: 0,
                    display: "flex",
                    alignItems: "baseline",
                    gap: "9px",
                    font: `600 11px/1.2 ${FONT_SANS}`,
                    letterSpacing: "0.04em",
                    color: "var(--c-secondary)",
                  }}
                >
                  {group.label}
                  <span
                    style={{
                      font: `400 10.5px/1 ${FONT_MONO}`,
                      letterSpacing: "0.045em",
                      color: "var(--c-muted)",
                    }}
                  >
                    {group.rows.length}
                  </span>
                </h2>
                {group.rows.map((row, i) => (
                  <Row key={row.id} row={row} first={i === 0} />
                ))}
              </div>
            ))}
            {briefRows === 0 ? (
              <WatchNotice
                body={`No calls in the desk's briefs over the last ${data.briefDays} days. That is a quiet fortnight, not a failed read.`}
              />
            ) : null}
          </>
        ) : null}
      </div>

      <TabBarClearance />
    </Frame>
  );
}

/* ── chrome ─────────────────────────────────────────────────────────── */

function Frame({ nav, busy, children }: { nav: ReactNode; busy?: boolean; children: ReactNode }) {
  return (
    <div
      data-parity="calls"
      /* The skeletons are aria-hidden, so without this a screen reader gets
         two section headings with nothing under either and no signal that
         anything is on its way. */
      aria-busy={busy || undefined}
      style={{
        backgroundColor: "var(--c-bg)",
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {nav}
      {children}
    </div>
  );
}

function Masthead() {
  return (
    <div style={{ flex: "none", padding: `6px ${PAD} 0` }}>
      <h1
        style={{
          margin: 0,
          font: `700 26px/1.14 ${FONT_DISPLAY}`,
          letterSpacing: "-0.02em",
          color: "var(--c-ink)",
        }}
      >
        Calls
      </h1>
      <p
        style={{
          margin: "8px 0 0",
          font: `400 12.5px/1.5 ${FONT_SANS}`,
          color: "var(--c-secondary)",
        }}
      >
        {/* The counterpart of the line Following and Watchlist carry. It is a
            claim about the product, not about the reader, so it needs no read
            behind it and is true in every state. */}
        Everything in this section is graded, or waiting to be.
      </p>
    </div>
  );
}

function Standfirst({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: "9px 0 0",
        font: `400 12.5px/1.55 ${FONT_SANS}`,
        color: "var(--c-body)",
        textWrap: "pretty",
      }}
    >
      {children}
    </p>
  );
}

/**
 * One call.
 *
 * A graded or open row is `LedgerEntryRow` unchanged, which is the same row the
 * mobile Desk record draws. A row with NO credible grade cannot be, because
 * that component requires one of the four outcome states and there is no honest
 * member of the set for it. It gets the same anatomy at the same scale with a
 * quiet marker where the state dot would be, so the two sit in one list without
 * either pretending to be the other.
 */
function Row({ row, first }: { row: CallRow; first: boolean }) {
  const strip = row.evidence?.length ? <ClaimEvidenceStrip rows={row.evidence} /> : null;

  if (row.state === null) {
    return (
      <div
        style={{
          padding: "15px 0",
          borderTop: "1px solid var(--c-hair)",
          marginTop: first ? "10px" : 0,
          display: "flex",
          flexDirection: "column",
          gap: "7px",
        }}
      >
        <ClaimAnatomy
          scale="row"
          lead={
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {/* A hollow ring, not a filled dot. The four states each own a
                  filled dot in a semantic hue, and a fifth fill would read as a
                  fifth state. This says there is nothing to fill in. */}
              <span
                aria-hidden="true"
                style={{
                  flex: "none",
                  display: "inline-block",
                  width: "7px",
                  height: "7px",
                  borderRadius: "50%",
                  border: "1px solid var(--c-edge)",
                }}
              />
              <span style={{ font: `600 11px/1 ${FONT_SANS}`, color: "var(--c-muted)" }}>
                Not graded
              </span>
              {row.instrument ? (
                <span
                  style={{
                    marginLeft: "auto",
                    font: `400 10px/1 ${FONT_MONO}`,
                    letterSpacing: "0.07em",
                    color: "var(--c-muted)",
                  }}
                >
                  {row.instrument}
                </span>
              ) : null}
            </div>
          }
          claim={row.claim}
          prose={row.notGradedReason ?? row.result}
        />
        {strip}
      </div>
    );
  }

  return (
    <>
      <LedgerEntryRow
        state={row.state}
        instrument={row.instrument}
        claim={row.claim}
        result={row.result}
        first={first}
      />
      {strip}
    </>
  );
}

/**
 * Clearance for the tab bar, as an element rather than as padding on the
 * shell's scroll container.
 *
 * `app-shell.tsx` already puts a bottom padding on `#main-content`, and on
 * these full-bleed routes that padding is not honoured at the end of the
 * scroll. Measured on `/watch` at 390 with `scripts/screen-geometry.mjs`:
 * without this element the last line bottomed out at 820px against a bar top of
 * 785px, so 35px of it sat behind the bar. Same element and same expression
 * `/watch` and `/desk-record` carry, for the same reason.
 */
function TabBarClearance() {
  return (
    <div
      aria-hidden="true"
      style={{
        flex: "none",
        height: "calc(var(--mobile-tabbar-height) + env(safe-area-inset-bottom))",
      }}
    />
  );
}
