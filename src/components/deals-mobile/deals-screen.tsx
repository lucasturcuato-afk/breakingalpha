"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DealRow } from "./deal-row";
import { FilterChipRow, type FilterChip } from "./filter-chip-row";
import {
  DEAL_STAGES,
  STAGE_LABEL,
  lensResultLine,
  type DealLens,
} from "./deal-stage";
import type { MobileDeal } from "./types";
import styles from "./deals.module.css";

/**
 * Deal Flow, mobile. The whole deal universe, lensed by stage.
 *
 * Prototype flag `isDeals`, markup at lines 2505 to 2547. Every number below is
 * read off the rendered prototype with getComputedStyle through
 * `scripts/parity_harness.py`, not transcribed from a document.
 *
 * THE GUTTER. The design applies `var(--v3-pad)` per section inside the screen:
 * the back bar, the masthead, the chip row and the list each carry it, and the
 * screen root carries none. That is reproduced exactly. The root sets NO
 * horizontal padding, so the gutter is applied once and only once. The parity
 * harness injects `#v3phone{padding:0 var(--v3-pad)}`, which the real prototype
 * does not have, so at `--width 390` the design side measures a 310px content
 * column against this screen's 350px. The knob is the harness's `--width`, not
 * this file. Both measurements are in the PR body.
 *
 * THE SCROLL CONTAINER. The design's list is `overflow-y:auto` inside a fixed
 * 844px phone frame. This one is not: `AppShell` already owns the scroll and
 * already reserves the tab bar's height on it, and Chrome drops a scroll
 * container's bottom padding on overflow, which would put the last deal under
 * the tab bar. The list keeps the design's 24px tail and lets the shell scroll.
 */

const PAD = "var(--v3-pad)";

export type DealsStatus = "ready" | "loading" | "error";

export interface DealsScreenProps {
  deals: MobileDeal[];
  /**
   * Chip figures, when they are not simply the length of what was passed in.
   * The design's own chips say 61 over four drawn rows, so the fixture needs
   * this. Production never passes it.
   */
  counts?: Record<string, number>;
  status?: DealsStatus;
  /** Relative age of the newest row, when the table has gone quiet. */
  staleFor?: string | null;
  initialLens?: DealLens;
  onRetry?: () => void;
  onOpenDetail?: (deal: MobileDeal) => void;
  onGenerateMemo?: (deal: MobileDeal) => void;
}

export function DealsScreen({
  deals,
  counts,
  status = "ready",
  staleFor = null,
  initialLens = "all",
  onRetry,
  onOpenDetail,
  onGenerateMemo,
}: DealsScreenProps) {
  const [lens, setLens] = useState<DealLens>(initialLens);

  /* The seed is a prop, so it can change under a mounted screen: a client-side
     navigation from /deal-flow to /deal-flow?lens=closed keeps this component
     mounted and only swaps the prop, and a useState initialiser would ignore
     it. Adjusting during render rather than in an effect, so the first paint
     after the navigation already carries the new lens. A tap on a chip still
     wins until the seed changes again. */
  const [seededLens, setSeededLens] = useState<DealLens>(initialLens);
  if (seededLens !== initialLens) {
    setSeededLens(initialLens);
    setLens(initialLens);
  }

  const derivedCounts = useMemo(() => {
    const out: Record<string, number> = { all: deals.length };
    for (const stage of DEAL_STAGES) out[stage] = 0;
    for (const deal of deals) out[deal.stage] = (out[deal.stage] || 0) + 1;
    return out;
  }, [deals]);

  const figures = counts ?? derivedCounts;

  const chips: FilterChip<DealLens>[] = [
    { key: "all", label: "All", count: figures.all ?? 0 },
    ...DEAL_STAGES.map((stage) => ({
      key: stage as DealLens,
      label: STAGE_LABEL[stage],
      count: figures[stage] ?? 0,
    })),
  ];

  const rows = useMemo(
    () => (lens === "all" ? deals : deals.filter((d) => d.stage === lens)),
    [deals, lens],
  );

  const chipsShown = status === "ready" && deals.length > 0;

  return (
    <div
      data-parity="deals"
      className={styles.enter}
      style={{
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--c-bg)",
        minHeight: "100%",
      }}
    >
      {/* Back to Ask. The design gives this screen a back chevron and no tab
          bar: `showNav` at prototype line 3460 lists four screens and `deals`
          is not among them, the same design bug DECISIONS.md logs as O2 for
          Evening Wrap and Search. The shell's tab bar is not removed here, so
          the Ask pole lights and this control is the design's own second exit
          rather than the only one. */}
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
        <Link
          href="/intelligence"
          style={{
            minHeight: "44px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            font: "500 13px/1 Inter, sans-serif",
            color: "var(--c-secondary)",
            cursor: "pointer",
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
          Ask
        </Link>
      </div>

      <div style={{ flex: "none", padding: `14px ${PAD} 0` }}>
        <h1
          style={{
            margin: 0,
            font: "700 24px/1.14 'Playfair Display', serif",
            letterSpacing: "-0.02em",
            color: "var(--c-ink)",
          }}
        >
          Deal Flow
        </h1>
        <p
          style={{
            margin: "7px 0 0",
            font: "400 12.5px/1.5 Inter, sans-serif",
            color: "var(--c-secondary)",
          }}
        >
          {status === "loading"
            ? "Reading the deal table."
            : status === "error"
              ? "The deal table did not answer."
              : lensResultLine(lens, figures[lens] ?? rows.length)}
        </p>
      </div>

      {/* Stale. Neither the prototype nor the desktop route has a freshness
          stamp on this screen, so the anatomy is borrowed from the prototype's
          own notice card (line 266) rather than invented: well fill, border,
          radius 12. The condition is the newest `updated_at`, never a clock. */}
      {staleFor && status === "ready" ? (
        <div
          style={{
            flex: "none",
            margin: `10px ${PAD} 0`,
            padding: "8px 12px",
            borderRadius: "12px",
            border: "1px solid var(--c-border)",
            backgroundColor: "var(--c-well)",
            font: "400 12px/1.5 Inter, sans-serif",
            color: "var(--c-secondary)",
          }}
        >
          This is not today&apos;s deal flow. The newest row was updated {staleFor}.
        </div>
      ) : null}

      {/* Chips only when there is something to lens. A row of "Rumored 0" over
          an empty table is noise, and a row still showing counts under a failed
          read is worse than noise: it states a figure the screen did not read.
          The desktop route already gates its own filter tabs on
          `deals.length > 0`, so this follows the surface it sits beside. */}
      {chipsShown ? (
        <FilterChipRow
          chips={chips}
          active={lens}
          onSelect={setLens}
          label="Filter deals by stage"
        />
      ) : null}

      <div
        style={{
          /* The chip row carries a 14px top gap. When it is not drawn, the list
             carries it instead, so the first rule does not butt the masthead. */
          padding: `${chipsShown ? 0 : 14}px ${PAD} 24px`,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {status === "loading" ? <DealsSkeleton /> : null}

        {status === "error" ? <DealsError onRetry={onRetry} /> : null}

        {status === "ready" && deals.length === 0 ? (
          /* Says what the read did and stops there. The previous copy read
             "Deal pipeline populating / The extractor is reading ingested
             articles for transactions", which is a statement about a backend
             process this screen has no source for: it reads `deal_flow` and
             learns nothing about whether the extractor is running, has run, or
             has failed. PR #661 names that exact shape. The predicate below is
             real and is this screen's own, so it can be described. */
          <DealsNotice
            title="No deals to show"
            detail="The deal table answered with no rows carrying an acquirer or a figure."
          />
        ) : null}

        {status === "ready" && deals.length > 0 && rows.length === 0 ? (
          <DealsNotice
            title="No deals match"
            detail={
              lens === "all"
                ? "Nothing in the table clears this lens right now."
                : `Nothing in the table is at ${STAGE_LABEL[lens]} right now. Another stage will have rows.`
            }
          />
        ) : null}

        {status === "ready"
          ? rows.map((deal, i) => (
              <DealRow
                key={deal.id}
                deal={deal}
                closeRule={i === 0}
                onOpenDetail={onOpenDetail ? () => onOpenDetail(deal) : undefined}
                onGenerateMemo={onGenerateMemo ? () => onGenerateMemo(deal) : undefined}
              />
            ))
          : null}
      </div>
    </div>
  );
}

/**
 * Loading. The design draws no skeleton for this screen. The blocks follow the
 * card's own rhythm so the list does not reflow when the rows arrive.
 */
function DealsSkeleton() {
  return (
    <div aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "7px",
            padding: "15px 0",
            borderTop: "1px solid var(--c-hair)",
          }}
        >
          <div className={styles.sk} style={{ height: "11px", width: "38%" }} />
          <div className={styles.sk} style={{ height: "44px" }} />
          <div className={styles.sk} style={{ height: "19px", width: "84%" }} />
          <div className={styles.sk} style={{ height: "10px", width: "46%" }} />
          {/* The memo control's own box. Without it the list grows by 52px per
              row the moment the deals land, which is the reflow a skeleton
              exists to prevent. */}
          <div className={styles.sk} style={{ height: "46px", width: "176px", marginTop: "6px" }} />
        </div>
      ))}
    </div>
  );
}

/**
 * Error. The desktop route logs the failure and exits early, which leaves `deals`
 * empty and renders the empty state over a failed read. github.md names that
 * exact substitution as a trust failure, so this screen says which one happened.
 */
function DealsError({ onRetry }: { onRetry?: () => void }) {
  return (
    <div
      style={{
        marginTop: "15px",
        padding: "14px",
        borderRadius: "12px",
        border: "1px solid var(--c-border)",
        backgroundColor: "var(--c-well)",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        alignItems: "flex-start",
      }}
    >
      {/* No headline. The masthead line above already says the table did not
          answer, and saying it twice reads as two separate failures. */}
      <p style={{ margin: 0, font: "400 12.5px/1.5 Inter, sans-serif", color: "var(--c-body)" }}>
        This is a failed read, not an empty result. Nothing is being hidden.
      </p>
      {onRetry ? (
        <button
          type="button"
          className={styles.bare}
          onClick={onRetry}
          style={{
            /* Same anatomy as the card's memo control, content-box included. */
            boxSizing: "content-box",
            marginTop: "6px",
            minHeight: "44px",
            display: "inline-flex",
            alignItems: "center",
            padding: "0 14px",
            border: "1px solid var(--c-ink)",
            borderRadius: "9px",
            font: "600 12.5px/1 Inter, sans-serif",
            color: "var(--c-ink)",
            backgroundColor: "transparent",
          }}
        >
          Read it again
        </button>
      ) : null}
    </div>
  );
}

/** Empty, both shapes: nothing extracted yet, and nothing at this lens. */
function DealsNotice({ title, detail }: { title: string; detail: string }) {
  return (
    <div
      style={{
        marginTop: "15px",
        paddingTop: "24px",
        paddingBottom: "24px",
        borderTop: "1px solid var(--c-hair)",
        display: "flex",
        flexDirection: "column",
        gap: "7px",
        alignItems: "center",
        textAlign: "center",
      }}
    >
      <p
        style={{
          margin: 0,
          font: "500 15.5px/1.4 'Playfair Display', serif",
          color: "var(--c-ink)",
        }}
      >
        {title}
      </p>
      <p style={{ margin: 0, font: "400 12.5px/1.5 Inter, sans-serif", color: "var(--c-body)" }}>
        {detail}
      </p>
    </div>
  );
}
