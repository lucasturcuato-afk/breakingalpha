"use client";

import type { CSSProperties } from "react";
import { STAGE_INK, STAGE_LABEL } from "./deal-stage";
import type { MobileDeal } from "./fixture";
import styles from "./deals.module.css";

/**
 * One deal, drawn the way the design draws it.
 *
 * github.md: "Card layout is still this project's own." Nothing of the desktop
 * card anatomy carries over. This is stage word plus figure on one baseline, a
 * Playfair claim line, one line of prose, a monospace slug and a single
 * outlined action, all measured off prototype lines 2517 to 2544.
 *
 * The claim line is the design's tap target for the deal detail screen. Unit
 * 18 is NOT running: the scope audit put a per-deal page at NEEDS RULING
 * because the design's dated process timeline and all four terms rows
 * (Consideration, Implied EV / EBITDA, Premium to undisturbed, Financing) have
 * no column on `deal_flow`, and the nearest fields are free text. So the
 * control is built, carries the visual treatment the design draws and its 44px
 * target, and
 * does nothing. See `onOpenDetail` below.
 *
 * The 44px target is reached the way the design reaches it, and the way the
 * handoff requires: content-box padding plus a negative margin. The element
 * does not shrink and it does not move.
 */

const claimStyle: CSSProperties = {
  boxSizing: "content-box",
  margin: "-3px 0",
  padding: "3px 0",
  minHeight: "38px",
  font: "500 15.5px/1.4 'Playfair Display', serif",
  color: "var(--c-ink)",
  textWrap: "pretty",
  cursor: "pointer",
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
  cursor: "pointer",
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
  onOpenDetail?: () => void;
  onGenerateMemo?: () => void;
}) {
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
        style={claimStyle}
        /* No-op, deliberately. TODO(unit 18, Deal detail): route this at
           /deal-flow/[id] once the timeline and the four terms rows have
           columns to read. Until then the control keeps its drawn state and
           its target rather than being removed, because removing it would make
           the built screen quietly different from the design. */
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

      <button type="button" className={styles.bare} style={memoStyle} onClick={onGenerateMemo}>
        Generate a deal memo
      </button>
    </div>
  );
}
