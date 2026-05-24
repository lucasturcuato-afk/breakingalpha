"use client";

/**
 * TrendTab (F4) -- PR-C4 Path D, 8d-only.
 *
 * Composes CompanyStockChart (PR #196) with the panel-scale Sentiment overlay
 * (Sparkline + SentimentHeat from PR-A1) backed by the 8-day arrays already
 * carried on CompanyDetail (DAYS=8 in src/lib/data-access/getCompanyDetail.ts).
 *
 * Path D is intentionally toggle-less: a 30d / 90d / 1y window selector would
 * require /api/company-trend (does not exist today) and would render the
 * exact same 8d arrays no matter which option is picked. Honest UX wins --
 * we ship the 8d view directly and defer the toggle + route to PR-C4b.
 *
 * CompanyStockChart is COMPOSED, not forked. It owns its own internal range
 * strip (1D / 5D / 1M / 3M / 1Y / 5Y) which is independent of this tab's
 * sentiment-overlay window. We wrap it in a div carrying the testid since the
 * component does not expose one on its root.
 *
 * Helpers (sumHalves, pctDelta, formatSigned) are inline-copied from
 * CompanyTrendCard.tsx (PR-B4). Dedupe is tracked for W2-D follow-up; the B4
 * card is rail-shaped (RAIL_W=310) and not directly reusable as a panel.
 */

import type { CSSProperties } from "react";
import { CompanyStockChart } from "@/components/company/CompanyStockChart";
import { Sparkline } from "@/components/ui/sparkline";
import { SentimentHeat } from "@/components/ui/sentiment-heat";
import { Eyebrow } from "@/components/ui/eyebrow";

const MONO = "var(--font-mono), ui-monospace, monospace";
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
const PANEL_BADGE: CSSProperties = {
  fontFamily: MONO,
  fontSize: 11,
  color: "var(--text-faint)",
  fontWeight: 600,
  letterSpacing: "0.05em",
};
const HEADLINE: CSSProperties = {
  fontFamily: MONO,
  fontSize: 18,
  fontWeight: 700,
  color: "var(--espresso)",
  fontVariantNumeric: "tabular-nums",
};
const DELTA: CSSProperties = {
  fontFamily: MONO,
  fontSize: 11,
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
};
const ROW: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  marginBottom: 6,
};
const EMPTY: CSSProperties = {
  padding: 16,
  textAlign: "center",
  fontFamily: SANS,
  fontSize: 12,
  color: "var(--text-faint)",
};

function pctDelta(prev: number, next: number): number {
  if (prev === 0) return next === 0 ? 0 : 100;
  return ((next - prev) / prev) * 100;
}

function formatSigned(v: number, digits = 2): string {
  return (v >= 0 ? "+" : "-") + Math.abs(v).toFixed(digits);
}

export interface TrendTabProps {
  ticker: string | null;
  companyName: string;
  sentiment7d: number[];
  /** Optional. When present, used for the panel-scale chart axis count. */
  mentions7d?: number[];
}

export function TrendTab({
  ticker,
  companyName,
  sentiment7d,
  mentions7d,
}: TrendTabProps) {
  const dayCount = sentiment7d.length || mentions7d?.length || 0;
  const hasSentiment = sentiment7d.some((v) => v !== 0.5);
  const sentimentLatest = sentiment7d.length > 0 ? sentiment7d[sentiment7d.length - 1] : 0.5;
  const sentimentFirst = sentiment7d.length > 0 ? sentiment7d[0] : 0.5;
  const sentimentSigned = sentimentLatest * 2 - 1;
  const sentimentDelta = pctDelta(sentimentFirst, sentimentLatest);
  const sUp = sentimentLatest >= sentimentFirst;
  const upColor = sUp ? "var(--signal-up)" : "var(--signal-dn)";

  return (
    <section
      data-testid="trend-tab"
      aria-label="Signal Trend"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      <div
        data-testid="trend-tab-context-header"
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          padding: "0 2px",
        }}
      >
        <h2 style={{ ...PANEL_TITLE, fontSize: 16 }}>Price &amp; Tone</h2>
        <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>·</span>
        <span style={PANEL_BADGE}>{dayCount}d</span>
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
          <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>·</span>
          <span style={PANEL_BADGE}>{dayCount}d</span>
        </div>
        <div style={{ padding: "12px 14px" }}>
          {hasSentiment ? (
            <>
              <div style={ROW}>
                <Eyebrow as="span" variant="mono" color="var(--text-faint)">Latest</Eyebrow>
                <span style={HEADLINE}>{formatSigned(sentimentSigned, 2)}</span>
                <span style={{ ...DELTA, color: upColor }}>
                  {sUp ? "▲" : "▼"} {Math.abs(sentimentDelta).toFixed(0)}%
                </span>
              </div>
              <Sparkline
                values={sentiment7d}
                w={720}
                h={64}
                stroke={upColor}
                fill={sUp ? "rgba(22,163,74,0.10)" : "rgba(220,38,38,0.10)"}
                strokeWidth={1.8}
              />
              <div style={{ marginTop: 6 }}>
                <SentimentHeat values={sentiment7d} w={720} h={12} gap={3} />
              </div>
            </>
          ) : (
            <div style={EMPTY}>Not enough sentiment data yet</div>
          )}
        </div>
      </div>
    </section>
  );
}
