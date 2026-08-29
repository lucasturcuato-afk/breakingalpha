"use client";

import Link from "next/link";
import { ClaimAnatomy, Chevron } from "@/components/ledger";
import { UNGRADEABLE_REASON } from "@/components/calls/TrackCallControl";
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

/* The prototype is a fixed 844px phone and scrolls inside its own body. Here
   the screen lives in the app shell's scrollport, which is already 100dvh with
   the tab bar's height reserved at its foot, so a second scroller nested in it
   would give the screen two scrollbars and hide the action bar behind the tab
   bar. The screen fills that box instead and lets the shell do the scrolling:
   the action bar is the last block either way, and on a claim short enough to
   fit it lands exactly where the design pins it. */
const SCREEN_HEIGHT =
  "calc(100dvh - var(--mobile-tabbar-height) - env(safe-area-inset-bottom))";

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

  const showsClaim = data !== null && (stage === "ready" || stage === "ungradeable");
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
        minHeight: SCREEN_HEIGHT,
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

      <div style={{ flex: 1, padding: `22px ${PAD} 24px` }}>
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
          ungradeable={stage === "ungradeable"}
          /* Gated the way `ledger-screen.tsx:209-211` gates the card, plus two
             conditions the Ledger does not need. The Ledger draws today's
             brief, so its cards are open by construction; this screen can be
             reached by a bookmark long after the card is gone, and the loader's
             `variant` carries the closed window and the already-graded call
             that the Ledger never has to describe. */
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
 * The bottom bar. Four renderings, and only one of them carries a control.
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
 * `README.md:309` names, and it is the one drawn value not carried over. The
 * geometry is: square 54x54 including its border, the primary flexing to fill,
 * 9px between them, an 85px bar.
 *
 * THE PRIMARY IS LIVE. It opens the commit sheet, which is a global overlay
 * mounted by the provider on the route, so this screen adds a trigger and
 * inherits the note gate, the press, the write and the failure path. Nothing in
 * `src/components/commit/` changed to make that work.
 *
 * WHEN THE BAR DRAWS NOTHING AT ALL. A call the desk has already graded, and a
 * call whose window has closed, both arrive as `variant: "closed"` and get no
 * bar. The design has no graded state and this screen has no slot for an
 * outcome word, so inventing one would be a new design rather than a wiring;
 * the desk's verdict also answers a different question from the reader's own,
 * which `src/lib/claim-outcome.ts` enforces by construction. And adopting a
 * closed-window call is worse than useless: the adopt route silently writes
 * `gradeable: false` (adopt/route.ts:141-149), a commitment that can never
 * settle.
 */
function ActionBar({
  variant,
  ungradeable,
  onTrack,
}: {
  variant: ClaimData["variant"];
  ungradeable: boolean;
  onTrack?: () => void;
}) {
  const onLedger = variant === "onLedger";
  if (!onLedger && !ungradeable && !onTrack) return null;

  return (
    <div
      style={{
        flex: "none",
        padding: `14px ${PAD} 16px`,
        borderTop: "1px solid var(--c-border)",
        display: "flex",
        alignItems: "center",
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
      ) : ungradeable ? (
        <p
          style={{
            margin: 0,
            font: "400 11.5px/1.5 var(--font-inter), sans-serif",
            color: "var(--c-muted)",
          }}
        >
          {UNGRADEABLE_REASON}
        </p>
      ) : (
        <>
          <div
            style={{
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
 * The read came back and there is no such claim.
 *
 * This is also where an id belonging to the SIBLING route lands. /entry takes a
 * user_claims id, both are uuids, and nothing in the string distinguishes them,
 * so the loader does not guess: it looks the id up in morning_brief_calls, and
 * a user_claims id is not there.
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
        Nothing failed to load. A claim is never removed once it is written, so this one was
        never here.
      </p>
    </div>
  );
}
