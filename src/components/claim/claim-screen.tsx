"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ClaimAnatomy, Chevron, OutcomeLead } from "@/components/ledger";
import { useCommitSheet } from "@/components/commit/commit-sheet-provider";
import type { ClaimData, ClaimOutcomeRead, ClaimStage } from "@/lib/claim-data";
import styles from "./claim.module.css";

/**
 * The Claim screen. One desk call opened out of the Ledger: the sentence, how
 * the desk settled it, the window it was judged over, the window a commitment
 * would open, and the commitment.
 *
 * IT USED TO SHOW LESS THAN THE ROW THAT OPENED IT, which is the complaint this
 * screen was rebuilt against. A mobile Calls row draws an outcome word, a dot
 * and an attribution sentence naming the entity's move against its benchmark.
 * Tapping through to the full-screen expansion of that same call gave back a
 * headline, two dates and 432px of nothing. A detail screen that subtracts is
 * not a detail screen.
 *
 * THE TWO WINDOWS ARE THE OTHER HALF, and they are why the screen read as a
 * contradiction. "The desk graded this Challenged" and "Track this call" are
 * both true and they concern DIFFERENT WINDOWS: the desk's has closed, and the
 * reader's opens today. Nothing on the screen said so, and the reader's window
 * appeared only after the tap, inside the commit sheet, which is the wrong side
 * of the decision. Both are stated now, both are labelled, and the sentence
 * under the second says plainly that the dates above it are not the reader's.
 * `src/lib/commit-legality.ts` carries the read paths that make the commitment
 * legal; nothing on this screen gates on the outcome.
 *
 * WHAT THIS SCREEN STILL DOES NOT DRAW, and why that is absence rather than a
 * stub. The design puts two more blocks here and NO COLUMN EXISTS behind
 * either: the two "what the desk sees" paragraphs and the "WHAT WOULD SETTLE
 * IT" well. THE REASON IS NO COLUMN, NOT NO TIME, and `src/lib/claim-data.ts`
 * names the schema and the writer that prove it. An empty well is a promise the
 * data cannot keep.
 *
 * "MEASURED AGAINST" HAS COME BACK, and only after grading. It was cut because
 * deriving a benchmark before the grader runs would be this screen predicting
 * what the grader picks, out of a fourth copy of a map already duplicated three
 * times. The block below derives nothing: it prints the symbols
 * `metadata.benchmarks` records the grader as having used, so it exists on a
 * settled call and is absent on every other one.
 *
 * The counter the design draws beside the back control ("2 / 5") is still gone.
 * It is a position in the brief, and the ordering it would count against is a
 * confidence sort the reader is never shown, so the numeral would be a rank
 * asserted out of a hidden ordering rather than a fact off the row.
 *
 * ANATOMY. The outcome lead, the claim and the reading come from `ClaimAnatomy`
 * at the `screen` scale, the same four slots the Ledger card and the entry row
 * use. The `lead` slot now carries `OutcomeLead`, the dot and word the mobile
 * row draws, with the eyebrow moved onto its trailing instrument edge. That is
 * the shape the design already carried; what changed is that the slot holds a
 * state rather than a bare span.
 *
 * Every measurement is taken off the rendered prototype with getComputedStyle.
 */

const PAD = "var(--v3-pad)";

/* THE SCREEN ENDS WHERE ITS CONTENT ENDS, and what that achieved is smaller
   than the comment here used to claim.
 *
 * The first build pinned the action bar to the foot of a column stretched to
 * the full viewport, which is what the prototype draws, because the prototype
 * is a fixed 844px phone whose claim block fills it. Here the same layout
 * turned every block omitted for having no column into ONE CONTIGUOUS EMPTY
 * REGION between the last line of the claim and the bar: measured at 390x844,
 * 415px on an open call, 49.1% of the viewport. Not flexing the body moved the
 * bar up under the content, and this comment then concluded that what was left
 * below it was "page background, which is what the foot of any short screen
 * looks like".
 *
 * THAT CONCLUSION WAS WRONG AND THE MEASUREMENT SAYS SO. Re-measured on the
 * same viewport it was 432.5px, 55.1% of this screen's own root and 51.2% of
 * the viewport. The void did not shrink. It MOVED, from between the claim and
 * the bar to below the bar, and it grew, because the bar rising took nothing
 * with it. PR 710's ceiling on an empty region is 15%. Nothing about where a
 * void sits makes it smaller.
 *
 * The repair is not a layout one and is not in this constant. It is the four
 * blocks below: the outcome, the reading, the benchmark evidence, and the
 * reader's own window. This constant stays as it is because it is still right
 * about the seam, and a screen whose content now fills it has no space left for
 * the bar to be pushed away from.
 *
 * `minHeight: 100%` PAINTS THE WHOLE BOX, and that part is load bearing:
 * `main#main-content` fills with `bg-parchment` and this screen fills with
 * `--c-bg`, and those two are not the same value in EITHER theme, so a screen
 * that shrink-wrapped its content would draw a visible two-tone seam across the
 * phone. Measured 785px of screen inside an 844px viewport. It resolves
 * against the definite height `main` gives the subtree, which is why the page's
 * gate div carries `h-full`; see the comment there and the longer one at
 * `src/app/ledger/page.tsx:114-123`. */
const SCREEN_MIN_HEIGHT = "100%";

/**
 * `data` is REQUIRED and NULLABLE, and it has no default. Defaulting it would
 * mean a caller that forgets to pass it draws something other than the claim
 * the reader asked for. Null is the page saying it has nothing to hand over,
 * and the screen then draws loading, error or missing and never a sentence
 * about the reader.
 *
 * THE `loading` ARM IS UNREACHABLE FROM THE ONLY CALL SITE, recorded here
 * rather than left for the next reader to rediscover, the way
 * `ledger-screen.tsx:96-124` records its own. `/claim/[id]/page.tsx` is a
 * server component that AWAITS its read before it renders, so by the time this
 * component exists the read has already answered ready, ungradeable, error or
 * missing. The arm stays because it is what a caller that has not answered
 * looks like, and drawing nothing instead would make an unanswered read look
 * like an answered and empty one. What would make it reachable: a client fetch,
 * or a Suspense boundary that renders this screen before the read settles.
 */
export function ClaimScreen({
  data,
  stage = "ready",
}: {
  data: ClaimData | null;
  stage?: ClaimStage;
}) {
  /* Null outside a `CommitSheetProvider`, and the screen then draws no action
     rather than an action that goes nowhere. `/claim/[id]/page.tsx` mounts its
     own provider around this screen. That is a second provider, not a second
     sheet competing with the Ledger's: the context is created once at module
     scope but its VALUE is per-instance state, and the overlay portals to
     document.body off a ref callback. It is also why the sheet's
     `router.refresh()` re-reads THIS claim, which is what turns the button
     into the marker with no toast. */
  const commit = useCommitSheet();

  const showsClaim = data !== null && stage === "ready";
  const settlement = data?.settlement;
  const showsSettlement =
    showsClaim &&
    settlement != null &&
    (settlement.window !== null ||
      settlement.checked !== null ||
      settlement.published !== null ||
      settlement.type !== null ||
      settlement.direction !== null);
  /* "unread" is the read that did not answer, and it is never an ungraded call.
     Narrowed once here so no block below can treat the literal as an outcome. */
  const outcome = showsClaim && data.outcome !== "unread" ? data.outcome : null;
  const measure = outcome?.measure ?? null;
  const readerWindow = showsClaim ? data.readerWindow : null;

  return (
    <div
      data-parity="claim"
      className={styles.enter}
      style={{
        backgroundColor: "var(--c-bg)",
        minHeight: SCREEN_MIN_HEIGHT,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          flex: "none",
          minHeight: "48px",
          display: "flex",
          alignItems: "center",
          padding: `0 ${PAD}`,
          borderBottom: "1px solid var(--c-border)",
        }}
      >
        {/* A real anchor. The design draws a span with a click handler, which
            is the one thing on this screen that a keyboard and a screen reader
            both need to be something else. */}
        <Link
          href="/ledger"
          style={{
            minHeight: "44px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            font: "500 13px/1 var(--font-inter), sans-serif",
            color: "var(--c-secondary)",
            textDecoration: "none",
          }}
        >
          <Chevron direction="left" size={16} stroke="currentColor" />
          Ledger
        </Link>
      </div>

      {/* `flex: none`. The bar follows the content instead of being pushed to
          the bottom of the viewport; see SCREEN_MIN_HEIGHT above. */}
      <div style={{ flex: "none", padding: `22px ${PAD} 24px` }}>
        {/* One chain, so exactly one of these draws. A stage that says there is
            a claim with no claim to draw falls to missing rather than to
            nothing: unreachable from the loader, where `ready` and
            `ungradeable` both carry a payload, and it is the honest landing
            for a caller that has answered with no row. */}
        {showsClaim ? (
          <>
            <ClaimAnatomy
              scale="screen"
              /* THE SLOT THE ROW USES, WITH WHAT THE ROW PUTS IN IT. The
                 eyebrow moves onto `OutcomeLead`'s trailing instrument edge,
                 which is where the mobile Calls row already draws the ticker,
                 so the state word gains a place without the eyebrow losing
                 one. */
              lead={<ClaimLead outcome={data.outcome} eyebrow={data.eyebrow} />}
              claim={data.claim}
              /* The reading. On a settled call it is the grader's attribution
                 sentence; on an open one it is what the call is watching for.
                 The loader picks between them with the row's own fallback
                 chain, so this slot never has to know which it got. */
              prose={outcome?.reading ?? undefined}
            />

            {/* A FAILED READ IS NOT AN OPEN CALL, and this is the one thing on
                the screen that has to say so out loud. Everything else here is
                real; only the grade is missing, and a reader shown a stateless
                claim would reasonably read it as one nobody has settled. */}
            {showsClaim && data.outcome === "unread" ? <OutcomeUnread /> : null}

            {showsSettlement ? (
              <>
                <Hairline marginTop="20px" />
                {/* EVERY LABEL IN THIS BLOCK SAYS "DESK", and that is the whole
                    repair. The span is the DESK CALL's, brief_date to
                    resolve_on, and a reader who commits gets a DIFFERENT one:
                    the adopt route opens theirs today and runs it to their own
                    horizon. That second window is stated below rather than left
                    to the sheet, so "Desk checks on" cannot be read as the date
                    the Track control resolves against. */}
                <Section label="The desk's call">
                  {settlement.type ? <SettlementRow label="Type" value={settlement.type} /> : null}
                  {settlement.direction ? (
                    <SettlementRow label="Direction" value={settlement.direction} />
                  ) : null}
                  {settlement.window ? (
                    <SettlementRow label="Desk window" value={settlement.window} />
                  ) : null}
                  {settlement.checked ? (
                    <SettlementRow label="Desk checks on" value={settlement.checked} />
                  ) : null}
                  {/* Provenance as a LINE and never as a link. The brief id is
                      on the row, but no route renders an arbitrary brief for a
                      reader, so a link would have nowhere to go. */}
                  {settlement.published ? (
                    <SettlementRow label="Published" value={settlement.published} />
                  ) : null}
                </Section>
              </>
            ) : null}

            {/* THE EVIDENCE, AND ONLY AFTER GRADING. Every figure here is a
                number the grader wrote down, not one this screen worked out:
                the entity it measured, the benchmarks it actually chose, and
                the bar the move had to clear. See the header for why naming a
                benchmark BEFORE grading would have been a prediction. */}
            {measure ? (
              <>
                <Hairline marginTop="18px" />
                <Section label="Measured against">
                  {measure.entity ? (
                    <SettlementRow label={measure.entity.symbol} value={measure.entity.move} />
                  ) : null}
                  {measure.benchmarks.map((b) => (
                    <SettlementRow key={b.symbol} label={b.symbol} value={b.move} />
                  ))}
                  {measure.bar ? <SettlementRow label="Bar to clear" value={measure.bar} /> : null}
                  {outcome?.gradedOn ? (
                    <SettlementRow label="Checked by the desk on" value={outcome.gradedOn} />
                  ) : null}
                </Section>
              </>
            ) : null}

            {/* THE READER'S WINDOW, BEFORE THE PRESS RATHER THAN AFTER IT. The
                span is `commitWindow`'s, which is the same
                `adoptWindowForCall(sessionIso, resolveOn)` the commit sheet
                calls, so this is the window a press actually writes and not a
                second arithmetic of the same idea. Absent on a call with no
                commitment on offer, and on one already committed to: see
                `ClaimData.readerWindow`. */}
            {readerWindow ? (
              <>
                <Hairline marginTop="18px" />
                <Section label="If you track this">
                  <SettlementRow label="Your window" value={readerWindow.span} />
                  <SettlementRow label="Closes on" value={readerWindow.closes} />
                  <p
                    style={{
                      margin: "4px 0 0",
                      font: "400 12.5px/1.55 var(--font-inter), sans-serif",
                      color: "var(--c-secondary)",
                      /* The measure every explanatory paragraph on this screen
                         is set to. Without it the sentence sets one line
                         shorter on a 430 phone than on a 390 one, which is the
                         width where a long line is least readable, not most. */
                      maxWidth: "34ch",
                    }}
                  >
                    Tracking this opens your own window today. The dates above are the
                    desk&rsquo;s; yours is graded on yours, even where the desk has
                    already settled its own.
                  </p>
                </Section>
              </>
            ) : null}
          </>
        ) : stage === "loading" ? (
          <ClaimSkeleton />
        ) : stage === "error" ? (
          <ClaimError />
        ) : (
          <ClaimMissing />
        )}
      </div>

      {showsClaim ? (
        <ActionBar
          variant={data.variant}
          commitReason={data.commitReason}
          /* Gated the way `ledger-screen.tsx` gates the card, on the SAME
             condition, computed once in `src/lib/commit-legality.ts` and read
             by both loaders. The two surfaces used to test different things and
             reached opposite conclusions about the same five call ids. */
          onTrack={
            data.variant === "open" && commit
              ? () =>
                  commit.open({
                    callId: data.callId,
                    claim: data.claim,
                    resolveOn: data.resolveOn,
                    sessionIso: data.sessionIso,
                  })
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

function Hairline({ marginTop }: { marginTop: string }) {
  return <div style={{ marginTop, height: "1px", backgroundColor: "var(--c-border)" }} />;
}

/**
 * A named group of settlement rows.
 *
 * THE LABEL IS THE POINT. Three blocks of label/value rows with no headings
 * would put the desk's dates, the grader's figures and the reader's window in
 * one undifferentiated column, and mistaking one for another is the exact
 * defect this screen was rebuilt to fix. Sentence case, not caps: the design
 * lint's rule 6 bans the transform outright, and nothing on a mobile surface is
 * set in capitals except the monospace instrument on the lead's trailing edge.
 */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
      <span style={{ font: "600 11px/1 var(--font-inter), sans-serif", color: "var(--c-secondary)" }}>
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * The lead slot, in the THREE renderings the mobile Calls row already carries.
 *
 *   a state       `OutcomeLead`, one of four words and a filled dot in its
 *                 semantic hue, with the eyebrow on the trailing edge.
 *   no state      a HOLLOW RING and a marker that is not an outcome word at
 *                 all. 46 of the graded rows in the live pool resolve to no
 *                 word, so a screen that drew `OutcomeLead` unconditionally
 *                 would crash or draw a blank on a quarter of them.
 *   unread        the bare eyebrow, exactly as this screen shipped. The read
 *                 did not answer, so neither a word nor a "not graded" marker
 *                 would be true, and `OutcomeUnread` says which it is.
 *
 * `OUTCOME_STATES` IS CLOSED AT FOUR AND IS NOT TOUCHED. The hollow-ring
 * marker sits OUTSIDE that set, in this wrapper, which is where
 * `calls-screen.tsx` puts its own. It takes no filled dot for the reason that
 * file states: the four states each own one in a semantic hue and a fifth fill
 * would read as a fifth state.
 *
 * IT IS THE ROW'S MARKUP AND NOT A SHARED COMPONENT, which is a cost recorded
 * rather than hidden. The ring lives inside `Row` in
 * `src/components/radar-mobile/calls-screen.tsx` and is not exported; lifting
 * it would edit a file another unit is working in on this branch. The values
 * are the row's exactly, so extracting it later is a move rather than a
 * reconciliation.
 */
function ClaimLead({ outcome, eyebrow }: { outcome: ClaimOutcomeRead; eyebrow: string }) {
  if (outcome === "unread" || outcome.state === null) {
    const marker =
      outcome === "unread" ? null : outcome.pending ? "Not graded yet" : "Not graded";
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {marker !== null ? (
          <>
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
            <span style={{ font: "600 11px/1 var(--font-inter), sans-serif", color: "var(--c-muted)" }}>
              {marker}
            </span>
          </>
        ) : null}
        <span
          style={{
            marginLeft: marker !== null ? "auto" : undefined,
            font: marker !== null
              ? "400 10px/1 var(--font-jetbrains-mono), monospace"
              : "600 11px/1 var(--font-inter), sans-serif",
            letterSpacing: marker !== null ? "0.07em" : undefined,
            color: marker !== null ? "var(--c-muted)" : "var(--c-secondary)",
          }}
        >
          {eyebrow}
        </span>
      </div>
    );
  }
  return <OutcomeLead state={outcome.state} instrument={eyebrow} />;
}

/**
 * The grade read did not answer.
 *
 * The wording is the Calls section's, near enough to be recognisable as the
 * same fact: "Could not read the grades for these", said about one call. The
 * second sentence is the load-bearing one, and it is the sentence the list
 * gives its own notice: what is missing is HOW THIS SETTLED, not whether it
 * did, and nothing else on the screen is affected.
 */
function OutcomeUnread() {
  return (
    <div role="status" style={{ marginTop: "12px" }}>
      <p style={{ margin: 0, font: "600 12.5px/1.45 var(--font-inter), sans-serif", color: "var(--c-ink)" }}>
        Could not read the desk&rsquo;s grade for this call.
      </p>
      <p
        style={{
          margin: "6px 0 0",
          font: "400 12.5px/1.55 var(--font-inter), sans-serif",
          color: "var(--c-secondary)",
          maxWidth: "34ch",
        }}
      >
        The call above is real and the desk published it. What is missing is how it
        settled, so it is drawn with no state rather than as an open call.
      </p>
    </div>
  );
}

function SettlementRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px" }}>
      <span style={{ font: "400 12.5px/1 var(--font-inter), sans-serif", color: "var(--c-secondary)" }}>{label}</span>
      <span
        style={{
          font: "600 12px/1 var(--font-jetbrains-mono), monospace",
          color: "var(--c-ink)",
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * The bottom bar. Three renderings, and only one of them carries a control.
 *
 * THE SQUARE IS NOT A CONTROL, and that is a correction rather than a
 * simplification. It shipped here as a button with an authored label ("Save
 * this claim. Not available yet.") and `aria-disabled`, which put a
 * keyboard-reachable control on the screen announcing a name the design never
 * gave it and a state it could never leave. The evidence is measured: in the
 * prototype at `'Signalera Mobile v3.dc.html':491` the square is a bare div
 * with NO onClick, NO tabindex and NO role, while on the SAME screen the back
 * control at `:471` and the primary at `:492` each carry all three. The design
 * marks its controls and does not mark this one. There is also nowhere for it
 * to write: `claim_follows` exists nowhere on this ref, `follows` is
 * CHECK-constrained with no claim slot, and `user_saved_deals` is deal-shaped.
 *
 * So it is a plain div with the design's geometry and no role, no tabindex, no
 * handler and no `cursor: pointer`. The prototype does draw the pointer on it;
 * a pointer over an element with no control behind it is the defect
 * `README.md:309` names, and it is the one drawn value not carried over.
 *
 * GEOMETRY, MEASURED ON THE RUNNING BUILD rather than claimed. The square is
 * 54x54 and the bar is 85px tall, and the `boxSizing: "content-box"` on the
 * square is what makes that true. The prototype writes
 * `min-width:52px;min-height:52px;border:1px` with no CSS reset, so the
 * designer saw 52 of content plus 2 of border. Under Tailwind preflight's
 * global `border-box` the same declarations render 52 including the border,
 * which is the trap `ledger-claim-card.tsx:135` writes `content-box` for by
 * name. This file did not, and drew 52x52 in an 83px bar while its own comment
 * claimed 54 and 85. The bar has no `align-items`, so the primary stretches to
 * the square's height the way the prototype's does.
 *
 * THE PRIMARY IS LIVE. It opens the commit sheet, which is a global overlay
 * mounted by the provider on the route, so this screen adds a trigger and
 * inherits the note gate, the press, the write and the failure path. Nothing in
 * `src/components/commit/` changed to make that work.
 *
 * WHY THE BAR ALWAYS SAYS SOMETHING. A reader who saw Track on one call and
 * nothing on the next could not tell a settled call from a broken screen, and
 * that INCONSISTENCY is the defect. So the reason is stated, in the register
 * `COMMIT_BLOCK_REASON` sets, and it states no outcome.
 *
 * THE SCREEN NOW CARRIES THE DESK'S OUTCOME AND THIS BAR STILL DOES NOT READ
 * IT, which was the sentence here that had to change without the behaviour
 * changing with it. This comment used to say "there is still no verdict on this
 * screen", and there is one: the lead slot draws the word and the dot the
 * mobile row draws, and the block above states the benchmark evidence behind
 * it. What has not changed by a line is what decides this bar. `variant`,
 * `commitReason` and `onTrack` come out of `commitLegality(call, today)`, which
 * has NO PARAMETER an outcome could arrive through, and
 * `tests/unit/claim-outcome-render-only.test.ts` drives the loader over a
 * matrix of outcome rows on one call and asserts all three are identical every
 * time. The desk's verdict and the reader's answer different questions, which
 * `src/lib/claim-outcome.ts` enforces by construction.
 *
 * The commitment is withheld for exactly one kind of reason, and it is a fact
 * about the CALL: no instrument to measure against, no direction to measure,
 * or a claim type the price grader cannot resolve. Those are the three
 * tests `isAdoptGradeable` applies before the adopt route writes `gradeable`,
 * so a control withheld here matches a row the route would refuse.
 *
 * IT USED TO WITHHOLD ON THREE MORE, and none of the three was a fact about
 * the reader. `graded`, `windowClosed` and `noWindow` all describe the DESK's
 * window, which the row a commit writes never touches: the reader's window
 * opens today and `grade_user_claims.py` resolves it on the reader's own dates. On the five calls in the live brief
 * this screen printed "there is nothing left to commit to" while /ledger
 * committed to the same ids successfully. The comment that justified it cited
 * the adopt route writing a hardcoded `gradeable: false`, which that route
 * stopped doing when it started writing a forward window.
 * `src/lib/commit-legality.ts` carries the argument and the read paths.
 */

function ActionBar({
  variant,
  commitReason,
  onTrack,
}: {
  variant: ClaimData["variant"];
  commitReason: string | null;
  onTrack?: () => void;
}) {
  const onLedger = variant === "onLedger";
  /* The sentence, straight off the loader. It is the same string /ledger prints
     on the same call, because both come out of COMMIT_BLOCK_REASON. A screen
     that reworded it here would be a second copy of the rule, said
     differently. */
  const reason = variant === "ungradeable" ? commitReason : null;
  /* The one case with no bar at all: an open call on a screen with no provider
     above it, which is a wiring mistake rather than a state a reader reaches.
     Every other path below draws either a control or a sentence. */
  if (!onLedger && reason === null && !onTrack) return null;

  return (
    <div
      style={{
        flex: "none",
        padding: `14px ${PAD} 16px`,
        borderTop: "1px solid var(--c-border)",
        display: "flex",
        gap: "9px",
      }}
    >
      {onLedger ? (
        /* The Ledger's own marker, verbatim: the diamond, the words, 600 12px,
           `--c-muted` (ledger-claim-card.tsx:127-146). A claim adopted while
           its window is still open has NO /entry page, because the record
           lists graded entries only, so this screen is the only surface that
           state is visible on and it has to carry it. Never a disabled Track
           button: a control that announces itself and cannot be operated is
           what this bar just removed. */
        <div
          style={{
            minHeight: "52px",
            display: "flex",
            alignItems: "center",
            font: "600 12px/1 var(--font-inter), sans-serif",
            color: "var(--c-muted)",
          }}
        >
          <span aria-hidden="true" style={{ marginRight: "6px" }}>
            {"\u25C6"}
          </span>
          On your ledger
        </div>
      ) : reason !== null ? (
        <p
          style={{
            margin: 0,
            font: "400 11.5px/1.5 var(--font-inter), sans-serif",
            color: "var(--c-muted)",
          }}
        >
          {reason}
        </p>
      ) : (
        <>
          <div
            style={{
              /* See the geometry note above. 52 of content plus 2 of border is
                 the 54 the design draws, and preflight's global border-box
                 would otherwise make the same numbers mean 52. */
              boxSizing: "content-box",
              flex: "none",
              minWidth: "52px",
              minHeight: "52px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid var(--c-border)",
              borderRadius: "9px",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: "12px",
                height: "12px",
                border: "1.5px solid var(--c-secondary)",
                transform: "rotate(45deg)",
              }}
            />
          </div>

          <button
            type="button"
            onClick={onTrack}
            className={styles.press}
            style={{
              flex: 1,
              minHeight: "52px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              appearance: "none",
              margin: 0,
              padding: 0,
              border: 0,
              backgroundColor: "var(--c-inverse)",
              borderRadius: "9px",
              font: "600 14.5px/1 var(--font-inter), sans-serif",
              color: "var(--c-oninv)",
              cursor: "pointer",
            }}
          >
            Track this call
          </button>
        </>
      )}
    </div>
  );
}

function ClaimSkeleton() {
  return (
    /* role="status" is load bearing, not decoration. aria-label on a bare div
       lands on the generic role, which prohibits an author name, so without
       the role a screen reader arriving here announces nothing at all: no
       label, no content, just silence where the claim will be.

       The blocks are the ones that ALWAYS draw: the lead, the claim, the
       reading, the hairline and the desk's own rows. The blocks that depend on
       what the read finds are not skeletoned, because a skeleton is a promise
       that content is coming and neither the benchmark evidence nor the
       reader's window is owed on every call. Nor are the two the design draws
       and the schema cannot fill. */
    <div role="status" aria-busy="true" aria-label="Loading this claim">
      <div className={styles.sk} style={{ height: "11px", width: "38%" }} />
      <div className={styles.sk} style={{ height: "56px", marginTop: "13px" }} />
      <div className={styles.sk} style={{ height: "42px", marginTop: "9px" }} />
      <div className={styles.sk} style={{ height: "1px", marginTop: "20px" }} />
      <div className={styles.sk} style={{ height: "11px", marginTop: "14px", width: "30%" }} />
      <div className={styles.sk} style={{ height: "108px", marginTop: "10px" }} />
    </div>
  );
}

/**
 * A failed read is not an empty result, and the copy says so in both
 * directions. The principle is already stated verbatim in the repo, and the
 * Ledger's own error block words it the same way, so the two surfaces do not
 * describe the same failure differently.
 */
function ClaimError() {
  return (
    <div role="alert">
      <p style={{ margin: 0, font: "500 17px/1.4 var(--font-playfair-display), serif", color: "var(--c-ink)" }}>
        We could not load this claim.
      </p>
      <p
        style={{
          margin: "10px 0 0",
          font: "400 13px/1.6 var(--font-inter), sans-serif",
          color: "var(--c-secondary)",
          maxWidth: "32ch",
        }}
      >
        This is a failed read, not an empty result. Nothing is being hidden.
      </p>
    </div>
  );
}

/**
 * The read came back and no desk call has this id.
 *
 * THE SECOND SENTENCE USED TO BE FALSE IN THE ONE CASE THIS SCREEN'S OWN HEADER
 * ANTICIPATES. It read "A claim is never removed once it is written, so this
 * one was never here", which is a true premise carried to a conclusion about
 * the reader's own data that this screen never established. Paste a real
 * `user_claims` id in here, which is the case the routing exists to handle, and
 * the row it names WAS written, DOES exist, and lives one route over. The
 * screen was telling a reader their own claim had never existed.
 *
 * What is left says only what the read established: this address reads a desk
 * call, and no desk call has this id. It deliberately does not name /entry,
 * because that route is still fixture-gated and sending a reader to a screen
 * that draws nothing in production would be a second false promise.
 */
function ClaimMissing() {
  return (
    <div>
      <p style={{ margin: 0, font: "500 17px/1.4 var(--font-playfair-display), serif", color: "var(--c-ink)" }}>
        There is no claim at this address.
      </p>
      <p
        style={{
          margin: "10px 0 0",
          font: "400 13px/1.6 var(--font-inter), sans-serif",
          color: "var(--c-secondary)",
          maxWidth: "32ch",
        }}
      >
        Nothing failed to load. This address reads a call from a morning brief, and no call
        has this id.
      </p>
    </div>
  );
}
