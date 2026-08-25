"use client";

import type { CSSProperties } from "react";
import { STAGE_INK, STAGE_LABEL } from "./deal-stage";
import type { MobileDeal } from "./types";
import styles from "./deals.module.css";

/**
 * One deal, drawn the way the design draws it.
 *
 * github.md: "Card layout is still this project's own." Nothing of the desktop
 * card anatomy carries over. This is stage word plus figure on one baseline, a
 * Playfair claim line, one line of prose, a monospace slug and a single
 * outlined action, all measured off prototype lines 2517 to 2544.
 *
 * BOTH CONTROLS ARE DISABLED WHEN THEY HAVE NOWHERE TO GO, and that is the
 * whole of their behaviour rather than an oversight.
 *
 * The claim line is the design's tap target for the deal detail screen. Unit
 * 18 is NOT running: the scope audit put a per-deal page at NEEDS RULING
 * because the design's dated process timeline and all four terms rows
 * (Consideration, Implied EV / EBITDA, Premium to undisturbed, Financing) have
 * no column on `deal_flow`, and the nearest fields are free text. So there is
 * no destination, `onOpenDetail` is never passed, and the control carries
 * `disabled` rather than a live cursor over a handler that does not exist.
 * The memo control is the same shape whenever its handler is withheld, which
 * is every render the fixture is on: an invented deal must not reach
 * /api/memo.
 *
 * A live-looking control that answers with nothing is the worse of the two
 * failures, so this follows the precedent PR #650 set at
 * `compose-screen.tsx:619`: `disabled` plus `cursor: default`, and nothing
 * else. No opacity change and no colour change, because the design draws none
 * and parity measures both.
 *
 * `disabled` and not merely handler-less, for a reason the runtime audit
 * cannot supply. `screen-audit.mjs:109` skips its dead-pointer check on
 * anything whose tag is already `button`, so an inert button reading
 * `cursor: pointer` passes that audit silently. It was checked by hand. The
 * attribute also takes the control out of the tab order, which is the right
 * answer for a destination that does not exist.
 *
 * The 44px target is reached the way the design reaches it, and the way the
 * handoff requires: content-box padding plus a negative margin. The element
 * does not shrink and it does not move. Disabling it changes neither.
 */

const claimStyle: CSSProperties = {
  boxSizing: "content-box",
  margin: "-3px 0",
  padding: "3px 0",
  minHeight: "38px",
  font: "500 15.5px/1.4 'Playfair Display', serif",
  color: "var(--c-ink)",
  textWrap: "pretty",
};

const memoStyle: CSSProperties = {
  /* content-box for the same reason the chips are: the prototype has no
     box-sizing reset, so its min-height 44 plus a 1px border draws 46. Under
     Tailwind's border-box preflight the same declaration draws 44, which the
     first parity run caught on all four memo controls. */
  boxSizing: "content-box",
  marginTop: "6px",
  minHeight: "44px",
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "0 14px",
  border: "1px solid var(--c-ink)",
  borderRadius: "9px",
  font: "600 12.5px/1 Inter, sans-serif",
  color: "var(--c-ink)",
  backgroundColor: "transparent",
};

export function DealRow({
  deal,
  closeRule = false,
  onOpenDetail,
  onGenerateMemo,
}: {
  deal: MobileDeal;
  /**
   * The design draws a bottom hair rule on the first row of the list and a top
   * rule on all four, so the list closes under its first entry and nowhere
   * else. Reproduced positionally rather than by stage, since by stage it would
   * follow the Rumored card wherever it landed. Recorded as a probable design
   * bug in the PR body, not silently corrected: it is 1px the parity diff can
   * see.
   */
  closeRule?: boolean;
  /** Withheld while unit 18 is unruled, which disables the claim line. */
  onOpenDetail?: () => void;
  /** Withheld whenever the fixture is on, which disables the memo control. */
  onGenerateMemo?: () => void;
}) {
  const detailWired = !!onOpenDetail;
  const memoWired = !!onGenerateMemo;

  return (
    /* No per-card animation. The design animates the Deal Flow screen root once
       and leaves the cards alone, unlike the Ledger where each claim rises. */
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "7px",
        padding: "15px 0",
        borderTop: "1px solid var(--c-hair)",
        borderBottom: closeRule ? "1px solid var(--c-hair)" : undefined,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "10px",
        }}
      >
        <span style={{ font: "600 11px/1 Inter, sans-serif", color: STAGE_INK[deal.stage] }}>
          {STAGE_LABEL[deal.stage]}
        </span>
        {deal.figure ? (
          <span
            style={{
              font: "500 11px/1 'JetBrains Mono', monospace",
              color: "var(--c-ink)",
            }}
          >
            {deal.figure}
          </span>
        ) : null}
      </div>

      <button
        type="button"
        className={styles.bare}
        style={{ ...claimStyle, cursor: detailWired ? "pointer" : "default" }}
        disabled={!detailWired}
        onClick={onOpenDetail}
      >
        {deal.claim}
      </button>

      {/* Both lines are conditional. A `deal_flow` row can carry no thesis and
          no sector, and an empty paragraph would still take a 7px gap. */}
      {deal.rationale ? (
        <p style={{ margin: 0, font: "400 12.5px/1.5 Inter, sans-serif", color: "var(--c-body)" }}>
          {deal.rationale}
        </p>
      ) : null}

      {deal.slug ? (
        <p
          style={{
            margin: 0,
            font: "400 10px/1 'JetBrains Mono', monospace",
            letterSpacing: "0.07em",
            color: "var(--c-muted)",
            /* Not in the design, which draws a slug short enough never to wrap.
               A real acquirer name is not, and line-height 1 means a wrapped
               slug overlaps itself. One line, clipped. */
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {deal.slug}
        </p>
      ) : null}

      {/* The visible label is the design's and stays exactly as drawn. The
          accessible name names the deal, because a list of deals repeats this
          control once per row and four identical "Generate a deal memo" entries
          in a controls list say nothing about which deal they belong to. An
          aria-label does not touch textContent, so parity is unaffected. */}
      <button
        type="button"
        className={styles.bare}
        style={{ ...memoStyle, cursor: memoWired ? "pointer" : "default" }}
        disabled={!memoWired}
        aria-label={`Generate a deal memo: ${deal.claim}`}
        onClick={onGenerateMemo}
      >
        Generate a deal memo
      </button>
    </div>
  );
}
