"use client";

import Link from "next/link";
import { ClaimAnatomy, Chevron } from "@/components/ledger";
import { useCommitSheet } from "@/components/commit/commit-sheet-provider";
import type { ClaimData, ClaimStage } from "@/lib/claim-data";
import styles from "./claim.module.css";

/**
 * The Claim screen. One desk call opened out of the Ledger: the sentence, the
 * window it is judged over, the date it is checked, and the commitment.
 *
 * WHAT THIS SCREEN DOES NOT DRAW, and why that is absence rather than a stub.
 * The design puts three more blocks here and NO COLUMN EXISTS behind any of
 * them: the two "what the desk sees" paragraphs, the "WHAT WOULD SETTLE IT"
 * well, and the "Measured against" row. THE REASON IS NO COLUMN, NOT NO TIME.
 * `src/lib/claim-data.ts` names the schema and the writer that prove it. They
 * are omitted entirely rather than drawn empty: an empty well is a promise the
 * data cannot keep, and a derived benchmark pair would be this screen
 * PREDICTING what the grader picks on grading day, out of a fourth copy of a
 * map already duplicated three times.
 *
 * The counter the design draws beside the back control ("2 / 5") goes with
 * them. It is a position in the brief, and the ordering it would count against
 * is a confidence sort the reader is never shown, so the numeral would be a
 * rank asserted out of a hidden ordering rather than a fact off the row.
 *
 * ANATOMY. The eyebrow and the claim come from `ClaimAnatomy` at the `screen`
 * scale, the same four slots the Ledger card and the entry row use. With the
 * reading gone, nothing sits between the claim and the settlement rows except
 * the design's own hairline. The design's SECOND hairline went with the blocks
 * it separated: two rules with nothing between them is not the design's
 * spacing, it is the residue of deleting what they framed.
 *
 * Every measurement is taken off the rendered prototype with getComputedStyle.
 */

const PAD = "var(--v3-pad)";

/* THE SCREEN ENDS WHERE ITS CONTENT ENDS, and this is a correction that came
   out of a measurement.
 *
 * The first build pinned the action bar to the foot of a column stretched to
 * the full viewport, which is what the prototype draws, because the prototype
 * is a fixed 844px phone whose claim block fills it. Here the same layout
 * turned every block correctly omitted for having no column into ONE
 * CONTIGUOUS EMPTY REGION between the last line of the claim and the bar:
 * measured at 390x844, 415px on an open call, 49.1% of the viewport, and 595px
 * where the row carries no resolve_on. Half an empty phone under four short
 * lines does not read as restraint, it reads as content that failed to arrive.
 * Deleting a block and then reserving its space is deleting nothing.
 *
 * So the body no longer flexes and the bar sits directly under it. What is
 * left below is page background, which is what the foot of any short screen
 * looks like, rather than a gap framed by a rule.
 *
 * `minHeight: 100%` STILL PAINTS THE WHOLE BOX, and that part is load bearing:
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
    (settlement.window !== null || settlement.checked !== null);

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
              lead={
                <span style={{ font: "600 11px/1 var(--font-inter), sans-serif", color: "var(--c-secondary)" }}>
                  {data.eyebrow}
                </span>
              }
              claim={data.claim}
            />

            {showsSettlement ? (
              <>
                <Hairline marginTop="20px" />
                <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
                  {/* "Desk window", not the design's bare "Window". The span is
                      the DESK CALL's, brief_date to resolve_on, and a reader
                      who commits gets a DIFFERENT one: the adopt route opens
                      theirs today and runs it to their own horizon. Their
                      window belongs on /entry, which is the screen that has it.
                      The fixture this replaced said "90 days, fixed at entry",
                      which was untrue twice in six words. */}
                  {settlement.window ? (
                    <SettlementRow label="Desk window" value={settlement.window} />
                  ) : null}
                  {settlement.checked ? (
                    <SettlementRow label="Checked" value={settlement.checked} />
                  ) : null}
                </div>
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
 * that INCONSISTENCY is the defect: the missing verdict is not. So the reason
 * is stated, in the register `COMMIT_BLOCK_REASON` sets, and it states no
 * outcome. There is still no verdict on this screen: the design has no slot for
 * one, and the desk's verdict answers a different question from the reader's
 * own, which `src/lib/claim-outcome.ts` enforces by construction.
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

       The blocks are the ones that draw: eyebrow, claim, hairline, the two
       settlement rows. The three the design draws and the schema cannot fill
       are not skeletoned either, because a skeleton is a promise that content
       is coming. */
    <div role="status" aria-busy="true" aria-label="Loading this claim">
      <div className={styles.sk} style={{ height: "11px", width: "38%" }} />
      <div className={styles.sk} style={{ height: "56px", marginTop: "13px" }} />
      <div className={styles.sk} style={{ height: "1px", marginTop: "20px" }} />
      <div className={styles.sk} style={{ height: "44px", marginTop: "14px" }} />
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
