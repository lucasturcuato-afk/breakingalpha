"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import type { EnrichedDeal } from "@/hooks/useSavedDeals";
import { BackHeader, Screen, ScreenBody } from "@/components/mobile";
import styles from "@/components/mobile/mobile.module.css";

/**
 * Saved deals, at phone width.
 *
 * github.md's row for this screen was a false receipt reading "designed fresh.
 * No repo counterpart found." It is corrected, and `src/app/saved/page.tsx` is
 * live at 271 lines. This is a port of it: the back link, the gold bookmark
 * eyebrow, the count, the CSV export, the three sort keys, the stage pills off
 * `STAGE_CONFIG`, the acquirer arrow, the saved date, the gold value, the
 * unsave control with its aria-label, the source link, and the whole empty
 * state, all carried across.
 *
 * Two things are NOT the source's.
 *
 * The stage colours. `STAGE_CONFIG` uses Tailwind amber, green, blue and a
 * muted grey, which are off-system on every other surface. They map onto the
 * `--pill-*` triples the design specifies: under_loi to watch, closed to
 * neutral, announced to bull, rumored to mixed.
 *
 * The error state. Neither the source nor the design has one, and the source's
 * hook did not report a failed read at all, so a request that died rendered as
 * "No saved deals yet". A failed read that looks like an empty one is the
 * failure github.md names, so it is separated here.
 *
 * There is deliberately no stale state. README's screens table calls Saved
 * "Offline. Brief kept automatically for the current day", the prototype and
 * the source both render bookmarked deals, and those are different features.
 * Until that is settled there is no cache policy to implement, and inventing
 * one would be worse than shipping without it.
 */

export type SavedSortKey = "saved_at" | "company" | "value";

const SORTS: { key: SavedSortKey; label: string }[] = [
  { key: "saved_at", label: "Date Saved" },
  { key: "company", label: "Company" },
  { key: "value", label: "Value" },
];

/** `STAGE_CONFIG`'s taxonomy, on the design's tokens. */
const STAGE: Record<string, { label: string; family: string }> = {
  rumored: { label: "RUMORED", family: "mixed" },
  announced: { label: "ANNOUNCED", family: "bull" },
  under_loi: { label: "UNDER LOI", family: "watch" },
  closed: { label: "CLOSED", family: "neutral" },
};

export function MobileSavedScreen({
  deals,
  isLoading,
  error,
  sortKey,
  onSort,
  onUnsave,
  onExport,
  exported,
  stageOf,
}: {
  deals: EnrichedDeal[];
  isLoading: boolean;
  error: string | null;
  sortKey: SavedSortKey;
  onSort: (key: SavedSortKey) => void;
  onUnsave: (dealId: string) => void;
  onExport: () => void;
  exported: boolean;
  stageOf: (deal: EnrichedDeal) => string;
}) {
  const failed = Boolean(error) && !isLoading;
  const empty = !isLoading && !failed && deals.length === 0;

  return (
    <Screen parity="saved">
      <BackHeader href="/deal-flow" label="Back to Deal Flow" />

      <div
        style={{
          flex: "none",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "12px",
          padding: "16px var(--v3-pad) 0",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="var(--c-gold)"
              stroke="var(--c-gold)"
              strokeWidth="1.6"
              strokeLinejoin="round"
            >
              <path d="M6 4h12v16l-6-4.5L6 20z" />
            </svg>
            <h1
              style={{
                margin: 0,
                font: "700 10px/1 Inter, sans-serif",
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "var(--c-goldink)",
              }}
            >
              Saved Deals
            </h1>
          </div>
          <p
            aria-live="polite"
            style={{ margin: "7px 0 0", font: "400 12px/1.4 Inter, sans-serif", color: "var(--c-muted)" }}
          >
            {isLoading
              ? "Loading"
              : failed
                ? "Count unavailable"
                : `${deals.length} saved deal${deals.length === 1 ? "" : "s"}`}
          </p>
        </div>

        {deals.length > 0 ? (
          <button
            type="button"
            onClick={onExport}
            className={styles.bare}
            style={{
              boxSizing: "content-box",
              flex: "none",
              minHeight: "40px",
              display: "inline-flex",
              alignItems: "center",
              gap: "7px",
              padding: "2px 12px",
              margin: "-2px 0",
              border: "1px solid var(--c-border)",
              borderRadius: "9px",
              backgroundColor: "var(--c-card)",
              font: "500 11px/1 Inter, sans-serif",
              color: "var(--c-secondary)",
              whiteSpace: "nowrap",
            }}
          >
            <svg
              aria-hidden="true"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M12 4v11M8 11l4 4 4-4M5 19h14" />
            </svg>
            {exported ? "Exported" : "Export CSV"}
          </button>
        ) : null}
      </div>

      {deals.length > 0 ? (
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: "7px",
            padding: "14px var(--v3-pad) 0",
            overflowX: "auto",
          }}
        >
          <span
            id="saved-sort-label"
            style={{
              flex: "none",
              font: "400 10px/1 'JetBrains Mono', monospace",
              letterSpacing: "0.07em",
              color: "var(--c-muted)",
            }}
          >
            SORT
          </span>
          {SORTS.map((s) => {
            const on = sortKey === s.key;
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={on}
                aria-describedby="saved-sort-label"
                onClick={() => onSort(s.key)}
                className={styles.bare}
                style={{
                  boxSizing: "content-box",
                  flex: "none",
                  minHeight: "40px",
                  padding: "2px 11px",
                  margin: "-2px 0",
                  display: "inline-flex",
                  alignItems: "center",
                  borderRadius: "9px",
                  whiteSpace: "nowrap",
                  font: "700 10px/1 Inter, sans-serif",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  border: `1px solid ${on ? "var(--c-gold)" : "var(--c-border)"}`,
                  backgroundColor: on ? "var(--c-well)" : "var(--c-card)",
                  color: on ? "var(--c-goldink)" : "var(--c-muted)",
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {isLoading ? (
        <ScreenBody padTop="14px">
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }} aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className={styles.sk} style={{ height: "116px", borderRadius: "12px" }} />
            ))}
          </div>
        </ScreenBody>
      ) : null}

      {failed ? (
        <ScreenBody padTop="14px">
          <div style={CENTRED} role="alert">
            <p style={{ margin: 0, font: "600 16px/1.3 'Playfair Display', serif", color: "var(--c-ink)" }}>
              Your saved deals did not load
            </p>
            <p style={{ ...CENTRED_BODY, margin: "8px 0 0" }}>
              This is a failed read, not an empty shelf. Nothing has been removed. Open the screen
              again in a moment.
            </p>
          </div>
        </ScreenBody>
      ) : null}

      {empty ? (
        <ScreenBody padTop="14px">
          <div style={CENTRED}>
            <svg
              aria-hidden="true"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--c-border)"
              strokeWidth="1.6"
              strokeLinejoin="round"
            >
              <path d="M6 4h12v16l-6-4.5L6 20z" />
            </svg>
            <p
              style={{
                margin: "14px 0 0",
                font: "600 16px/1.3 'Playfair Display', serif",
                color: "var(--c-ink)",
              }}
            >
              No saved deals yet
            </p>
            <p style={{ ...CENTRED_BODY, margin: "8px 0 0" }}>
              Bookmark deals from the Deal Flow tracker to save them here.
            </p>
            <Link
              href="/deal-flow"
              className={styles.bare}
              style={{
                marginTop: "18px",
                minHeight: "46px",
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                padding: "0 17px",
                borderRadius: "12px",
                backgroundColor: "var(--c-gold)",
                font: "700 11px/1 Inter, sans-serif",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: "var(--c-ongold)",
                textDecoration: "none",
              }}
            >
              <svg
                aria-hidden="true"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <rect x="3" y="7" width="18" height="13" rx="2" />
                <path d="M9 7V5h6v2" />
              </svg>
              Go to Deal Flow
            </Link>
          </div>
        </ScreenBody>
      ) : null}

      {!isLoading && !failed && deals.length > 0 ? (
        <ScreenBody padTop="14px">
          <ul style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
            {deals.map((deal) => (
              <DealRow key={deal.id} deal={deal} stage={stageOf(deal)} onUnsave={onUnsave} />
            ))}
          </ul>
        </ScreenBody>
      ) : null}
    </Screen>
  );
}

const CENTRED: CSSProperties = {
  minHeight: "50dvh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  paddingBottom: "40px",
};

const CENTRED_BODY: CSSProperties = {
  font: "400 13px/1.6 Inter, sans-serif",
  color: "var(--c-muted)",
  maxWidth: "30ch",
  textWrap: "pretty",
};

function DealRow({
  deal,
  stage,
  onUnsave,
}: {
  deal: EnrichedDeal;
  stage: string;
  onUnsave: (dealId: string) => void;
}) {
  const conf = STAGE[stage] ?? STAGE.rumored;
  const value = deal.value || deal.valuation;
  const savedOn = deal.saved_at
    ? new Date(deal.saved_at)
        .toLocaleDateString("en-US", { month: "short", day: "numeric" })
        .toUpperCase()
    : null;

  return (
    <li
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        padding: "14px 16px",
        border: "1px solid var(--c-border)",
        borderRadius: "12px",
        backgroundColor: "var(--c-card)",
        listStyle: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ font: "700 15px/1.3 'Playfair Display', serif", color: "var(--c-ink)" }}>
              {deal.company}
            </span>
            {deal.acquirer ? (
              <span style={{ font: "400 10px/1.3 'Playfair Display', serif", color: "var(--c-muted)" }}>
                &larr; {deal.acquirer}
              </span>
            ) : null}
          </div>

          <div style={{ marginTop: "7px", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span
              style={{
                display: "inline-block",
                padding: "2px 7px",
                borderRadius: "6px",
                border: `1px solid var(--pill-${conf.family}-border)`,
                backgroundColor: `var(--pill-${conf.family}-bg)`,
                font: "700 10px/1.5 Inter, sans-serif",
                letterSpacing: "0.04em",
                color: `var(--pill-${conf.family}-text)`,
              }}
            >
              {conf.label}
            </span>
            {deal.deal_type ? <span style={META}>{deal.deal_type}</span> : null}
            {deal.sector ? <span style={META}>{deal.sector}</span> : null}
          </div>

          {savedOn ? (
            <p
              style={{
                margin: "8px 0 0",
                font: "400 10px/1 'JetBrains Mono', monospace",
                letterSpacing: "0.07em",
                color: "var(--c-muted)",
              }}
            >
              SAVED {savedOn}
            </p>
          ) : null}
        </div>

        <div style={{ flex: "none", display: "flex", alignItems: "flex-start", gap: "10px" }}>
          {value ? (
            <span style={{ font: "600 13px/1.4 'JetBrains Mono', monospace", color: "var(--c-goldink)" }}>
              {value}
            </span>
          ) : null}
          <button
            type="button"
            aria-label="Remove from saved deals"
            onClick={() => onUnsave(deal.id)}
            className={styles.bare}
            style={{
              boxSizing: "content-box",
              flex: "none",
              minWidth: "30px",
              minHeight: "30px",
              padding: "7px",
              margin: "-7px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--c-muted)"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>

      {deal.source_url ? (
        <a
          href={deal.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.bare}
          style={{
            boxSizing: "content-box",
            margin: "10px 0 -3px",
            minHeight: "38px",
            padding: "3px 0",
            display: "inline-flex",
            alignItems: "center",
            alignSelf: "flex-start",
            font: "400 10px/1 Inter, sans-serif",
            color: "var(--c-goldink)",
            textDecoration: "none",
          }}
        >
          View source &rarr;
        </a>
      ) : null}
    </li>
  );
}

const META: CSSProperties = {
  font: "400 10px/1 Inter, sans-serif",
  color: "var(--c-muted)",
};
