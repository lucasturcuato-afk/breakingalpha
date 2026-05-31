"use client";

/**
 * TrendTab -- "Price & Tone".
 *
 * Composes CompanyStockChart (price) with the panel-scale tone surface: the
 * shared ToneReadout (level + week-over-week direction + evidence) over the
 * ToneTrendChart, a real labeled tone-over-time line backed by /api/company-trend.
 * The chart aggregates daily tone with the SAME per-mention scoring computeTone
 * uses for the headline level, so the line and the level agree by construction.
 *
 * Price and Tone are stacked peers, each with its own range strip (price: Yahoo
 * ranges; tone: 7D / 30D / 90D matched to real company_mentions depth). The true
 * Price-vs-Tone overlay (divergence) is a separate future redesign.
 */

import type { CSSProperties } from "react";
import { CompanyStockChart } from "@/components/company/CompanyStockChart";
import { ToneReadout } from "@/components/company/ToneReadout";
import { ToneTrendChart } from "@/components/company/ToneTrendChart";
import type { ToneSummary } from "@/lib/tone";

const SERIF = "var(--font-display), serif";
const SANS = "var(--font-sans), sans-serif";

const PANEL: CSSProperties = {
  background: "var(--cream-hi)",
  border: "1px solid var(--border-base)",
  borderRadius: 8,
  overflow: "hidden",
};
const PANEL_HEAD: CSSProperties = {
  padding: "11px 14px",
  borderBottom: "1px solid var(--border-subtle)",
  display: "flex",
  alignItems: "baseline",
  gap: 8,
};
const PANEL_TITLE: CSSProperties = {
  fontFamily: SERIF,
  fontSize: 14,
  fontWeight: 700,
  margin: 0,
  color: "var(--espresso)",
};
const EMPTY: CSSProperties = {
  padding: 16,
  textAlign: "center",
  fontFamily: SANS,
  fontSize: 12,
  color: "var(--text-faint)",
};

export interface TrendTabProps {
  ticker: string | null;
  companyName: string;
  /** Canonical identifier the tone-trend endpoint resolves against. */
  company: string;
  tone: ToneSummary;
}

export function TrendTab({ ticker, companyName, company, tone }: TrendTabProps) {
  return (
    <section
      data-testid="trend-tab"
      aria-label="Signal Trend"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      <div
        data-testid="trend-tab-context-header"
        style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "0 2px" }}
      >
        <h2 style={{ ...PANEL_TITLE, fontSize: 16 }}>Price &amp; Tone</h2>
      </div>

      {ticker ? (
        <div data-testid="trend-tab-stock-chart" style={PANEL}>
          <CompanyStockChart ticker={ticker} companyName={companyName} />
        </div>
      ) : (
        <div data-testid="trend-tab-stock-chart" style={PANEL}>
          <div style={EMPTY}>No price chart for private companies</div>
        </div>
      )}

      <div data-testid="trend-tab-sentiment-overlay" style={PANEL}>
        <div style={PANEL_HEAD}>
          <h3 style={PANEL_TITLE}>Tone</h3>
        </div>
        <div style={{ padding: "12px 14px" }}>
          <ToneReadout tone={tone} scale="panel" />
          <div style={{ marginTop: 12 }}>
            <ToneTrendChart company={company} defaultRange="30d" />
          </div>
        </div>
      </div>
    </section>
  );
}
