"use client";

import { useCallback, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Chevron,
  LedgerDisclosureRow,
  OutcomeLead,
  type OutcomeState,
} from "@/components/ledger";
import ledger from "@/components/ledger/ledger.module.css";
import { SectionRule, WatchNotice, WatchSkeleton } from "@/components/watch";
import {
  EVIDENCE_COPY,
  evidenceCountLine,
  summarizeClaimEvidence,
  type RawEvidenceRow,
} from "@/lib/claim-evidence";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";
import { TabBarClearance } from "@/components/mobile/tab-bar-clearance";

/**
 * Radar / Calls, on a phone. The third of Radar's four sections.
 *
 * WHAT THIS SECTION IS. Two lists: the reader's own calls with the verdicts the
 * attribution grader wrote against them, and the desk's calls from the last
 * fortnight grouped by what they are about. Both are graded, which is what
 * separates this half of Radar from Following and Watchlist beside it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE ROWS COLLAPSE, WHICH IS THE WHOLE OF THIS REVISION.
 *
 * The screen shipped as a wall and it was one in numbers, not in impression:
 * three and a half viewport heights, fifteen rows, and seventy-one per cent of
 * the entire scroll was row. Twelve of fifteen row heights sat inside a forty
 * pixel band, so nothing on the screen was any bigger than anything else. There
 * were nine controls, and all nine were chrome: a skip link, four section
 * links, four tab-bar poles. Not one of them was on a row. Nothing collapsed,
 * expanded, opened or led anywhere.
 *
 * THE HALF THAT GOES BEHIND THE CONTROL IS THE READING. Every row carries two
 * paragraphs, the claim and then how it settled or what it is watching for, and
 * the second is the single largest contributor to row height. It is also never
 * the thing a reader is scanning for: they are scanning the state word and the
 * name. So the row collapses to the state word, the instrument and the claim's
 * first clause, and the reading is one tap away. `LedgerDisclosureRow` carries
 * the mechanism and its reasoning.
 *
 * NO NUMBER SURVIVES ON A COLLAPSED ROW. Not a count, not a ratio, not a
 * percentage. The evidence counts are inside the opened body or nowhere.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE EVIDENCE BLOCK RENDERED ON EVERY ROW AND WAS TRUE ON ALMOST NONE.
 *
 * It drew on all fifteen. It could say something true and useful on one. Four
 * separate reasons, all of them structural rather than accidental, and
 * `radar-calls-screen-data.ts` now holds each one at the point it is decided:
 *
 *   a brief row       `claim_evidence` keys on a `user_claims` id, so a brief
 *                     call cannot be the subject of one for any reader on any
 *                     day. Twelve rows drew "No new evidence yet." and could
 *                     never have drawn anything else.
 *   a settled row     the mapper deliberately does not look once a verdict
 *                     exists, and the empty copy then reported that nothing was
 *                     recorded. The truth is that nothing was read.
 *   a not-graded row  two counts directly under a word saying no grade is
 *                     coming, in the one place a reader is most likely to take
 *                     a count for the missing verdict. This is the row the
 *                     complaint was made about.
 *   an unscanned type `backend/grading/claim_evidence.py` never matches index,
 *                     aggregate or unclassified claims. Same false absence as a
 *                     brief row, one list up.
 *
 * The block now renders under an open claim of a scanned type, and nowhere
 * else. Silent under the ruling of 2026-08-29: no figure anywhere on the screen
 * means anything different without it.
 *
 * AND IT NAMES ITS BASIS. A sector claim matches every article carrying its
 * sector's label; a ticker claim matches the articles that name one company. So
 * two rows in one list could carry counts orders of magnitude apart with
 * nothing on screen saying why. The line now says which of the two it is.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * "NOT GRADED" WAS ONE WORD OVER TWO DIFFERENT FACTS.
 *
 * `mobile-outcome-state.ts` defines it as the case where "no credible grade
 * exists and never will", and it is right to. But three structurally different
 * routes reached it and the screen collapsed them into that one word:
 *
 *   the window closed and the grader has not run yet   PENDING, not terminal
 *   an outcome row carrying `verdict = ungradable`     terminal
 *   a claim written `gradeable: false`                 terminal by construction
 *
 * On the first the word is false. That row is gradeable, its window has closed,
 * it satisfies every condition the grader scans for and it is queued. It reads
 * Not graded yet, and its reading says so.
 *
 * THIS IS NOT A FIFTH OUTCOME WORD. `OUTCOME_STATES` is closed at four and is
 * untouched; a fifth would need `claim-anatomy.tsx` to change, which is the
 * friction that keeps it closed. Both markers here sit OUTSIDE that set, in
 * this wrapper, exactly where "Not graded" already sat, and neither is rendered
 * by `OutcomeLead`. Neither takes a filled dot: the four states each own one in
 * a semantic hue and a fifth fill would read as a fifth state.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHERE A ROW GOES.
 *
 *   a brief row    `/claim/[id]` takes a `morning_brief_calls` id, which is
 *                  exactly what a brief row is. It is one screen with no
 *                  scroll and it carries Track this call, the only write path
 *                  anywhere near this surface. The link sits INSIDE the opened
 *                  body, never on the collapsed row: a row with two controls
 *                  stacked on it is two taps competing for one thumb.
 *   your own call  `/entry/[id]` renders the unwired stage in production and
 *                  has no loader. There is no destination, so the row resolves
 *                  in place and offers nothing that would fail. The day that
 *                  route is wired the link goes here and nothing else changes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS SECTION DOES NOT DRAW, AND WHY. None of it says so on screen,
 * under the ruling of 2026-08-29: omit silently unless the absence would
 * mislead. Nothing below leaves a rendered figure meaning something else, and
 * nothing on screen implies any of it is coming.
 *
 *   THE RECORD RING     The desk's `RecordHero` renders a percentage. No
 *                       figure of that shape may appear on a mobile surface, so
 *                       this is not a layout that was too wide to port: the
 *                       figure itself is barred. Nothing here counts, totals or
 *                       divides.
 *   THE PINNED HERO     Pins live in `localStorage` under `radar-calls-pinned`
 *                       and in no table. A phone pin list would be a DIFFERENT
 *                       list from the desk's, on the same account, with nothing
 *                       to reconcile them.
 *   RESOLVING SOON      A re-sort of the list already on the screen, costing a
 *                       hero's worth of vertical space to say again what each
 *                       row's own window line says.
 *   AUTHORING           `AuthorClaim` proposes a claim through a model pass and
 *                       then writes it. This section reads; the desk authors.
 *   ADOPT               `CallCommitFooter` and the adopt path are writes. The
 *                       Claim screen a brief row now opens carries the one that
 *                       belongs on a read surface, on the screen built for it.
 *   THE EVIDENCE MAP    `EvidenceMap` is an SVG force graph, desktop-only by
 *                       construction.
 *   TRACKED VIEWS       Not drawn, and NOT SILENTLY when a reader asks for it:
 *                       see `viewsRequested` below. `/radar/calls` takes
 *                       `?views=open` and `?thesis=<id>`, the phone redirect
 *                       carries both, and an arrival that asked for the tier
 *                       gets the absence named instead of a screen that looks
 *                       like it answered.
 *
 *                       THE REASON WRITTEN HERE BEFORE WAS WRONG, and so is the
 *                       one in `src/components/shell/mobile-tab-bar.tsx`. This
 *                       entry said every `theses` row has a NULL `user_id` so
 *                       there is no reader to scope to, and cited
 *                       `src/components/watch/omissions.ts` as holding the same
 *                       finding. Both halves fail on a read. `theses.user_id`
 *                       is a live column with a foreign key on it, per-reader
 *                       state lives in `user_thesis_states` and is what
 *                       `TrackedViews` already scopes with, and `omissions.ts`
 *                       records something else entirely. The tab bar's entry
 *                       says `user_claims` has no article foreign key, which is
 *                       true of the column list and beside the point, and
 *                       `src/lib/watch-data.ts` and `src/components/watch/
 *                       fixture.ts` both RETRACT that same premise in as many
 *                       words. Three files, three reasons, no agreement.
 *
 *                       WHAT IS ACTUALLY IN THE WAY is a product decision
 *                       nobody has taken, not a column. The desk's section
 *                       draws `theses` rows, which are the system's, and the
 *                       phone tier in the design draws the reader's own written
 *                       notes, which are `user_claims` rows. Those are two
 *                       different objects wearing one name. The PR that added
 *                       this comment puts the question to an owner rather than
 *                       picking for them, and until it is answered this section
 *                       draws neither.
 *   THE EVIDENCE        The desk's `ClaimEvidenceStrip` is NOT reused, and this
 *   STRIP'S LINKS       one was found by measuring rather than by reading. Its
 *                       three recent-story links measured 13px tall at every
 *                       width, on a production build, signed in. That is a real
 *                       tap target on a phone and it is a third of the floor.
 *                       They are also `truncate`d inside a clipping parent, so
 *                       each link's box measured 565px wide inside a 320px
 *                       viewport; the page does not scroll sideways, because the
 *                       parent clips, but a link whose text is ellipsed to a
 *                       third of itself is not a link anybody can choose.
 *   THE JUMP NAV        `GroupJumpNav` is `sticky top-0` and its `bleed` prop
 *                       assumes a `p-6` desktop page. On a full-bleed phone
 *                       screen it would pin at the very top, over the section
 *                       row rather than under it. The group headings are now a
 *                       fraction of the scroll they were.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type CallsStage = "ready" | "loading" | "error";

/** One row, already reduced to what the row draws. */
export interface CallRow {
  id: string;
  /**
   * The outcome word, or null when there is no grade. Null is NOT "awaiting":
   * see `src/lib/mobile-outcome-state.ts`. Whether null is terminal is
   * `notGradedPending` below, and the two are not the same question.
   */
  state: OutcomeState | null;
  /**
   * True when the row has no grade YET: gradeable, window closed, queued. False
   * on the terminal routes to the same absence. Only read when `state` is null.
   */
  notGradedPending?: boolean;
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
  /**
   * What the evidence ledger was matched against, when it could be matched at
   * all. Absent means the block does not render: see the header.
   */
  evidenceBasis?: { kind: "ticker" | "sector"; symbol: string };
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
  viewsRequested = false,
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
  /**
   * The arrival asked for tracked views, through `?views=open` or `?thesis=`.
   * DEFAULTS FALSE, so every arrival that did not ask is unchanged and the
   * omission stays silent for them. See the TRACKED VIEWS entry in the header
   * for what is in the way and why this names it rather than drawing it.
   */
  viewsRequested?: boolean;
}) {
  const router = useRouter();
  const retry = onRetry ?? (() => router.refresh());
  const loading = stage === "loading";

  /* One open set for both lists. Ids are uuids out of two tables and cannot
     collide, and a single set is what would let a later control close every
     row without either list knowing the other exists. */
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set<string>());
  const toggle = useCallback((id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

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
  /* A heading over one group is a divider that divides nothing, and the shared
     grouping rule is one quiet fortnight away from producing exactly that. The
     rule itself is the desk's, lifted into `radar-calls-model.ts` so both
     surfaces state it once, and it is NOT forked here. This decides only
     whether the label is drawn. */
  const showGroupLabels = data.brief.length > 1;

  return (
    <Frame nav={nav} busy={loading}>
      <Masthead />

      <div style={{ flex: 1, padding: `18px ${PAD} 24px` }}>
        {/* ── the tier that was asked for and is not here ─────────────── */}
        {/* FIRST, ABOVE BOTH LISTS, because it answers the arrival. A reader
            who followed a link named Tracked Views and lands on two lists of
            something else will scroll both of them looking for a third before
            concluding anything, and the conclusion they reach is that the
            screen is broken. It is drawn only when it was asked for.

            NO ACTION LINK, AND THAT IS DELIBERATE. The obvious one is the desk,
            and the desk is where this reader just came from: `/radar/calls`
            redirects here below md, so a control offering to open it would
            return them to this screen and read as a dead button. There is no
            other surface that draws the tier. Saying so plainly and stopping is
            the honest end of the sentence. */}
        {viewsRequested ? (
          <WatchNotice
            heading="Tracked views are not on this screen."
            body="You followed a link to them. They are a desk section, and which object a tracked view is on a phone is still an open question, so nothing here stands in for one. Your calls and the desk's are below, and neither is affected."
          />
        ) : null}

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
              <Row
                key={row.id}
                row={row}
                first={i === 0}
                open={open.has(row.id)}
                onToggle={() => toggle(row.id)}
              />
            ))}
            {data.yours.length === 0 ? (
              /* THE ACTION MOVED OFF THE DESK, and it had to. It pointed at
                 `/radar/calls`, which below md now redirects straight back to
                 this screen: the control would have returned the reader to the
                 empty state they tapped it from. `/compose` is the phone screen
                 for writing a call, it POSTs to the same two routes the desk
                 does, and its own H1 is the words on this control. */
              <WatchNotice
                body="No calls tracked yet. A call is made in your own words, and the desk's own calls below can be taken onto your record from the screen each one opens."
                action={{ href: "/compose", label: "Write your own call" }}
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
          {`The desk's own calls from the last ${data.briefDays} days. Only a move beyond sector and market counts.`}
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
              <div key={group.id} style={{ marginTop: showGroupLabels ? "16px" : 0 }}>
                {showGroupLabels ? (
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
                ) : null}
                {group.rows.map((row, i) => (
                  <Row
                    key={row.id}
                    row={row}
                    first={showGroupLabels && i === 0}
                    open={open.has(row.id)}
                    onToggle={() => toggle(row.id)}
                    href={`/claim/${row.id}`}
                  />
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
            behind it and is true in every state.

            NO "tap a call to open it" HERE, and that was measured rather than
            argued. The second sentence cost a second line, which pushed the
            first row eighteen pixels DOWN on a screen whose whole revision is
            about what clears the fold. Every row draws a chevron, is a 44px
            button and carries `aria-expanded`, so the affordance is on the
            object itself. The record keeps its hint because a count strip that
            filters is not self-evident; a chevron is. */}
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
 * A WRAPPER BESIDE THE ANATOMY, NEVER A BRANCH INSIDE IT, which is the house
 * rule this function already obeyed and still does. What changed is which row
 * it wraps: `LedgerDisclosureRow` rather than `LedgerEntryRow`, because the row
 * now opens where it stands and the entry row's container is a NAVIGATION
 * control that cannot carry `aria-expanded`.
 *
 * THE ROW IS NOW A BOXED CARD, and no fourth wrapper was written to make it
 * one. `LedgerDisclosureRow` owns the container and every consumer of that
 * component gets the box, so this file gained one prop and lost a component.
 * `state` is passed for the 2px top edge alone: the lead is still built here,
 * because a row with no grade draws a hollow ring and a marker that is not an
 * outcome word, and null is what that row passes for its edge.
 *
 * ELEVEN OF THE FIFTEEN ROWS ON THIS SCREEN ARE `developing` OR `awaiting`,
 * which share a base token by design and can never be told apart by a fill. So
 * the edge is not what separates this list: the box is. Four sides and an 8px
 * gap land on every row whatever it carries, and the edge is the extra that
 * makes the four rows which are NOT that pair findable without reading.
 *
 * Two leads, one anatomy. A graded or open row gets `OutcomeLead` and one of
 * the four words. A row with no grade gets a hollow ring and a marker that is
 * not an outcome word at all, in one of two forms, because pending and terminal
 * are two different facts and the screen used to say them with one.
 */
function Row({
  row,
  first,
  open,
  onToggle,
  href,
}: {
  row: CallRow;
  first: boolean;
  open: boolean;
  onToggle: () => void;
  /** Present on a brief row only. See the header on destinations. */
  href?: string;
}) {
  const pending = row.state === null && row.notGradedPending === true;

  const lead =
    row.state !== null ? (
      <OutcomeLead state={row.state} instrument={row.instrument} />
    ) : (
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {/* A hollow ring, not a filled dot. The four states each own a filled
            dot in a semantic hue, and a fifth fill would read as a fifth
            state. This says there is nothing to fill in. Both markers share
            it: pending and terminal differ in the word and never in the
            colour, which is the rule `OutcomeLead` states for its own four. */}
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
          {pending ? "Not graded yet" : "Not graded"}
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
    );

  /* THE PENDING SENTENCE IS THE MAPPER'S NOW, not this screen's.
     `scored-object-map.ts` used to write "Window closed without a grade." for
     this branch, which reads as a window that closed and produced nothing, and
     this screen wrote its own truthful sentence beside it rather than touch a
     string the desk also renders. That left the desk saying the false thing and
     put two sentences in the repo for one fact. Both literals are gone: the
     sentence lives in `verdict-vocabulary.ts` with the rest of the vocabulary
     and every surface reads it from there, so this row simply renders the
     reason it was given. */
  const reading = row.state === null ? (row.notGradedReason ?? row.result) : row.result;

  const hasDetail = Boolean(row.evidenceBasis) || Boolean(href);

  return (
    <LedgerDisclosureRow
      lead={lead}
      state={row.state}
      claim={row.claim}
      reading={reading}
      first={first}
      open={open}
      onToggle={onToggle}
      detail={
        hasDetail ? (
          <>
            {row.evidenceBasis ? (
              <EvidenceCounts rows={row.evidence} basis={row.evidenceBasis} />
            ) : null}
            {href ? <OpenCall href={href} /> : null}
          </>
        ) : undefined
      }
    />
  );
}

/**
 * The destination, inside the opened body.
 *
 * A REAL ANCHOR, so it is a link to a link's keyboard, its assistive technology
 * and its long press. `LedgerEntryRow`'s `onOpen` would have made the whole row
 * a button calling `router.push`, which throws away all three and gives one row
 * two competing meanings for one tap.
 *
 * The chevron points right, which is `Chevron`'s documented sense: the reading
 * continues elsewhere. The row's own chevron points down for the opposite
 * reason. Two directions, one vocabulary, and a reader can tell which control
 * leaves the screen without reading either label.
 */
function OpenCall({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className={`${ledger.bare} ${ledger.focusable}`}
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
  );
}

/**
 * What has landed against an open claim since it was committed, as counts.
 *
 * IT RENDERS ON ONE KIND OF ROW ONLY, and that is the fix rather than a detail
 * of it. See the screen header: the block drew on fifteen of fifteen rows and
 * said something true and useful on one. It is now gated on
 * `row.evidenceBasis`, which `radar-calls-screen-data.ts` sets only for an open
 * claim of a type the evidence pass actually scans.
 *
 * THE SUMMARY IS THE DESK'S, THE PRESENTATION IS NOT. `summarizeClaimEvidence`
 * and `evidenceCountLine` are the same pure functions `ClaimEvidenceStrip`
 * calls, so what counts as supporting and what counts as challenging is decided
 * in one place for both surfaces. What is not reused is the desk strip's markup:
 * its three story links measured 13px tall, and its titles are `truncate`d
 * inside a clipping parent, so a link's box measured 565px wide in a 320px
 * viewport. Neither is a control a thumb can use.
 *
 * THE BASIS IS NAMED, and it answers a defect nobody had reported.
 * `backend/grading/claim_evidence.py` matches a ticker claim on the articles
 * that name one company and a sector claim on every article carrying that
 * sector's label, so a sector claim absorbs everything written about its sector
 * while a ticker claim gets single digits. Two rows in one list could carry
 * counts orders of magnitude apart with nothing on screen saying why. The
 * clause says which.
 *
 * DELIBERATELY NOT A SCORE. No percentage, no ratio, no implied verdict. The
 * price-attribution grader is the only thing that resolves a claim, and this is
 * an observation log sitting under one that has not resolved yet.
 *
 * The empty line is still drawn rather than omitted, and now it is true when it
 * is drawn: this row is a row the pass scans, so nothing matched means nothing
 * matched. Absence is the common state, roughly four stories in five are
 * neutral and record nothing.
 */
function EvidenceCounts({
  rows,
  basis,
}: {
  rows: RawEvidenceRow[] | null | undefined;
  basis: NonNullable<CallRow["evidenceBasis"]>;
}) {
  const summary = summarizeClaimEvidence(rows);
  /* `evidenceCountLine` is the assertion that the counts are sayable as one
     sentence, and it gives back null on an empty summary. Both halves are
     checked below so the two cannot disagree about whether there is anything to
     say. The line itself is not rendered: the visible spans already read as one
     continuous sentence, and the desk strip's extra screen-reader copy of it
     duplicates rather than replaces them. */
  const line = evidenceCountLine(summary);

  const where =
    basis.kind === "sector"
      ? `across everything written about the ${basis.symbol} sector`
      : `on ${basis.symbol}`;

  if (summary.isEmpty || line === null) {
    return (
      <p style={{ margin: 0, font: `400 11px/1.45 ${FONT_SANS}`, color: "var(--c-muted)" }}>
        {`${EVIDENCE_COPY.empty} Nothing has matched ${where} ${EVIDENCE_COPY.since}.`}
      </p>
    );
  }

  return (
    <p style={{ margin: 0, font: `500 11px/1.45 ${FONT_SANS}`, color: "var(--c-muted)" }}>
      <span style={{ color: "var(--c-greenink)" }}>{summary.supporting} supporting</span>
      {", "}
      <span style={{ color: "var(--c-redink)" }}>{summary.challenging} challenging</span>{" "}
      <span>{`${where} ${EVIDENCE_COPY.since}.`}</span>
    </p>
  );
}
