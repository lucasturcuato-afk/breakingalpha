"use client";

import Link from "next/link";
import { ClaimAnatomy, CLAIM_TYPE_SCALE, Chevron } from "@/components/ledger";
import { UNGRADEABLE_REASON } from "@/components/calls/TrackCallControl";
import { CLAIM_FIXTURE_ENABLED, type ClaimData } from "./fixture";
import styles from "./claim.module.css";

/**
 * The Claim screen. One call opened out of the Ledger: what the desk sees, what
 * would settle it, and the benchmark and window it will be judged against.
 *
 * Every measurement is taken off the rendered prototype with getComputedStyle.
 * The prototype's sc-if blocks need a runtime that does not resolve over
 * file://, so the screen was rendered through `scripts/parity_harness.py`,
 * which resolves those branches from the design's own state map.
 *
 * WHAT THIS SCREEN IS NOT ALLOWED TO DO YET. Its primary action opens the
 * commit sheet, and the commit sheet is held: the note it requires has no
 * column to be written to, which is open in PR #643. The button is built in
 * its drawn state, at its drawn position, with its drawn label, and does
 * nothing. `src/components/ledger/ledger-claim-card.tsx` set that precedent by
 * making `onTrack` optional for the same reason; the difference here is that
 * this screen's whole bottom bar IS the action, so it renders inert rather
 * than not at all.
 *
 * ANATOMY. The eyebrow and the claim come from `ClaimAnatomy` at the `screen`
 * scale, which is the same four slots the Ledger card and the entry row use.
 * Everything below the claim sits BESIDE the anatomy rather than inside it:
 * the design's reading is two paragraphs and the anatomy's prose slot is one
 * `<p>`, which a second paragraph cannot nest inside. The two paragraphs still
 * draw in the anatomy's own type, read from `CLAIM_TYPE_SCALE`, so there is no
 * second copy of the scale to drift from the first.
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
 * ready        the claim, with its action bar
 * loading      the read is in flight
 * error        the read failed, which is never rendered as emptiness
 * missing      the read succeeded and there is no such claim
 * stale        the claim came from a brief that is no longer today's
 * ungradeable  no honest grader exists for this claim type, so nothing can be
 *              committed to and the action bar carries the reason instead
 * unwired      there is no source behind this screen at all, so no read has
 *              been attempted and none is running
 *
 * The design draws exactly one of these, `ready`. The prototype's dev strip
 * enumerates lifecycle states for the brief and the wrap and none for a claim,
 * so the other six are built from the repo's own copy where it has some and
 * are flagged as authored where it does not. See the PR body.
 */
export type ClaimStage =
  | "ready"
  | "loading"
  | "error"
  | "missing"
  | "stale"
  | "ungradeable"
  | "unwired";

/**
 * `data` is required and has no default. Defaulting it to the fixture would
 * mean a caller that forgets to pass it, or that passes nothing while a read is
 * in flight, renders the sample Cash App claim as though it were the reader's
 * own. Sample content reaches a screen because a page hands it over, never
 * because a component fell back to it.
 */
export function ClaimScreen({
  data,
  stage = "ready",
}: {
  data: ClaimData;
  stage?: ClaimStage;
}) {
  /* With the fixture gate closed the screen is `unwired` whatever `?stage=`
     says. That parameter is a way to reach the lifecycle states in development
     and a preview; it is not a source, so it cannot be allowed to put invented
     content, or a confident empty state, in front of a production reader. In
     development and preview `?stage=unwired` reaches this branch on purpose so
     it can be audited and captured like the rest. */
  const effective: ClaimStage = CLAIM_FIXTURE_ENABLED ? stage : "unwired";

  const showsClaim =
    effective === "ready" || effective === "stale" || effective === "ungradeable";

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
          justifyContent: "space-between",
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
        {/* The counter is a fact about a claim that was read. On loading, error
            and missing there is no claim, so a position for it is an assertion
            the screen cannot make: "2 / 5" sitting above "There is no claim at
            this address" is the header contradicting the body. Gated on the
            same condition the claim body is. */}
        {showsClaim ? (
          <span
            style={{
              font: "400 10.5px/1 var(--font-jetbrains-mono), monospace",
              letterSpacing: "0.045em",
              color: "var(--c-muted)",
            }}
          >
            {data.position.index} / {data.position.total}
          </span>
        ) : null}
      </div>

      <div style={{ flex: 1, padding: `22px ${PAD} 24px` }}>
        {effective === "loading" ? <ClaimSkeleton /> : null}
        {effective === "error" ? <ClaimError /> : null}
        {effective === "missing" ? <ClaimMissing /> : null}
        {effective === "unwired" ? <ClaimUnwired /> : null}
        {effective === "stale" ? <StaleNotice generatedAt={data.generatedAt} /> : null}

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

            <Hairline marginTop="20px" />

            <div
              style={{
                marginTop: "16px",
                font: "400 italic 12.5px/1 var(--font-playfair-display), serif",
                color: "var(--c-secondary)",
              }}
            >
              what the desk sees
            </div>
            {data.reading.map((paragraph, i) => (
              <p
                key={i}
                style={{
                  /* 10px under the label, 11px between paragraphs. The design
                     draws both and they are not the same number. */
                  margin: `${i === 0 ? "10px" : "11px"} 0 0`,
                  font: CLAIM_TYPE_SCALE.screen.prose,
                  color: "var(--c-body)",
                  textWrap: "pretty",
                }}
              >
                {paragraph}
              </p>
            ))}

            <div
              style={{
                marginTop: "18px",
                padding: "14px 15px",
                border: "1px solid var(--c-border)",
                borderRadius: "12px",
                backgroundColor: "var(--c-well)",
              }}
            >
              {/* Capitals, and sanctioned. The design's own carve-out is that
                  they survive in the monospace machine record and nowhere
                  else; this is a mono label on a well, set as literal capitals
                  rather than by text-transform, so it is what it says it is. */}
              <div style={{ font: "400 11px/1 var(--font-jetbrains-mono), monospace", color: "var(--c-muted)" }}>
                WHAT WOULD SETTLE IT
              </div>
              <p
                style={{
                  margin: "9px 0 0",
                  font: "400 13.5px/1.6 var(--font-inter), sans-serif",
                  color: "var(--c-body)",
                  textWrap: "pretty",
                }}
              >
                {data.settles}
              </p>
            </div>

            <Hairline marginTop="18px" />

            <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <SettlementRow label="Measured against" value={data.settlement.benchmarks} />
              <SettlementRow label="Window" value={data.settlement.window} />
              <SettlementRow label="Checked" value={data.settlement.checked} />
            </div>
          </>
        ) : null}
      </div>

      {showsClaim ? <ActionBar ungradeable={effective === "ungradeable"} /> : null}
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
 * The bottom bar. Two controls in the design, and both of them are inert.
 *
 * The primary opens the commit sheet, which is held. The secondary is drawn
 * with no handler, no label and no state anywhere in the prototype: it is a
 * bordered square carrying the same rotated 12px diamond the design uses as its
 * "on your ledger" mark, and nothing in the handoff says what pressing it
 * does. It is built as a real button with an authored label rather than
 * dropped, because removing it would change the geometry of the bar the
 * primary sits in, and built as a button rather than a div because a
 * cursor:pointer element with no control behind it is a defect the runtime
 * audit rejects. The label is inferred. See the PR body.
 *
 * BOTH CARRY A REAL DISABLED AFFORDANCE, and the first build did not.
 *
 * It shipped two keyboard-reachable buttons that announced as buttons, drew a
 * `cursor:pointer`, ran a press animation on touch, and called an empty
 * function. `README.md:309` calls a `cursor:pointer` element with no handler a
 * defect; an empty handler is the same defect with a function around it. The
 * unit's constraint is that the primary stays inert, and that constraint says
 * nothing about lying to the reader while it is.
 *
 * So: `aria-disabled` on both, the default cursor rather than the pointer, the
 * drawn colours at reduced opacity, and no press animation, since the press
 * was the last thing telling a reader their tap had landed. `aria-disabled`
 * rather than `disabled` on purpose. `disabled` drops the control out of the
 * tab order entirely, so a keyboard reader would never find it and would never
 * be told it is here and not yet available; `aria-disabled` keeps it
 * reachable and announces it as unavailable. No handler is attached at all,
 * so nothing runs on the click `aria-disabled` still permits.
 *
 * WHY EACH IS INERT, kept here because the empty functions that used to carry
 * these notes are gone:
 *
 *   Track this call   opens the commit sheet, which is held. The note it
 *                     requires has nowhere to persist, which is open in
 *                     PR #643. Deliberately inert rather than partially wired:
 *                     a sheet that takes a note and drops it is worse than a
 *                     control that says it is not ready.
 *   Save this claim   there is no save path for a claim. `useSavedDeals` and
 *                     `user_saved_deals` are deal-shaped, and github.md
 *                     records the live Saved surface as deals only.
 */
const INERT_CONTROL = {
  cursor: "default",
  opacity: 0.55,
} as const;

function ActionBar({ ungradeable }: { ungradeable: boolean }) {
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
      {ungradeable ? (
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
          <button
            type="button"
            aria-disabled="true"
            aria-label="Save this claim. Not available yet."
            style={{
              flex: "none",
              minWidth: "52px",
              minHeight: "52px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              appearance: "none",
              margin: 0,
              padding: 0,
              background: "none",
              border: "1px solid var(--c-border)",
              borderRadius: "9px",
              ...INERT_CONTROL,
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
          </button>

          <button
            type="button"
            aria-disabled="true"
            aria-label="Track this call. Not available yet."
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
              ...INERT_CONTROL,
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
       label, no content, just silence where the claim will be. */
    <div role="status" aria-busy="true" aria-label="Loading this claim">
      <div className={styles.sk} style={{ height: "11px", width: "38%" }} />
      <div className={styles.sk} style={{ height: "56px", marginTop: "13px" }} />
      <div className={styles.sk} style={{ height: "1px", marginTop: "20px" }} />
      <div className={styles.sk} style={{ height: "92px", marginTop: "16px" }} />
      <div className={styles.sk} style={{ height: "76px", marginTop: "18px", borderRadius: "12px" }} />
    </div>
  );
}

/**
 * A failed read is not an empty result, and the copy says so in both
 * directions. The principle is already stated verbatim in the repo, and the
 * Ledger's own error block words it the same way, so the two surfaces do not
 * describe the same failure differently.
 *
 * It used to close with "and the claim is unchanged on the ledger". That is a
 * statement about the reader's own record, made by a screen that just failed
 * to read anything and has no second source to check it against. Cut. What is
 * left describes only the read that failed, which is the one thing this state
 * does know.
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
 * "Your open calls are unaffected" used to close this block, and it is gone
 * for the same reason as the line above it. This screen reads one claim. It
 * has never read the reader's open calls and cannot say anything about them.
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

/**
 * No source at all, which is this screen's honest production state today.
 *
 * `loading` would say a read is on its way when nothing is coming. `missing`
 * would say a read came back empty. `error` would say a read failed. None of
 * the three happened, so this state says the fourth thing and asserts nothing
 * about the reader, their brief or their record. It names what is absent and
 * stops.
 */
function ClaimUnwired() {
  return (
    <div role="status">
      <p style={{ margin: 0, font: "500 17px/1.4 var(--font-playfair-display), serif", color: "var(--c-ink)" }}>
        This screen is not wired to a claim yet.
      </p>
      <p
        style={{
          margin: "10px 0 0",
          font: "400 13px/1.6 var(--font-inter), sans-serif",
          color: "var(--c-secondary)",
          maxWidth: "32ch",
        }}
      >
        Nothing has been read and nothing is being read. The desk&rsquo;s reading and the
        benchmark a claim would be measured against have no source behind them on this screen.
      </p>
    </div>
  );
}

function StaleNotice({ generatedAt }: { generatedAt: string }) {
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
        This claim is from yesterday&rsquo;s brief.
      </div>
      <div style={{ marginTop: "4px", font: "400 11.5px/1.5 var(--font-inter), sans-serif", color: "var(--c-body)" }}>
        Generated {generatedAt}. Its review date is unaffected.
      </div>
    </div>
  );
}
