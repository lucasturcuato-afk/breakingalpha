"use client";

// 6-cell KPI strip. Visual ref: docs/DirectionD.jsx lines 582-610.
//
// Lucas-protected: does NOT modify watchlist-utils.ts, WatchlistAddInput.tsx,
// trends/page.tsx, briefing/route.ts, or MemoModal.tsx.
//
// Cells: Last, Market cap, Mentions 30d, Sentiment, Articles today, Sources.
// Cells 1-2 hydrate from /api/company-kpis. Cells 3-6 from companyDetail prop.

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Delta, Eyebrow, SentimentPill, type SentimentTone } from "@/components/ui";
import { Tooltip } from "@/components/ui/tooltip";
import type { CompanyDetail } from "@/lib/data-access/getCompanyDetail";
import {
  directionVerb,
  formatEvidence,
  levelPolarity,
  type ToneDirection,
  type ToneSummary,
} from "@/lib/tone";

interface CompanyKPIStripProps { companyDetail: CompanyDetail }

type KpiResponse =
  | { kind: "live"; ticker: string; last: number | null; change: number | null; marketCap: number | null }
  | { kind: "private"; ticker: string; reason: string }
  | { kind: "price-only-fallback"; ticker: string; last: number | null; change: number | null };

interface KpiState {
  status: "idle" | "loading" | "ready" | "error" | "private";
  last: number | null;
  change: number | null; // decimal form, 0.0214 = +2.14%
  marketCap: number | null;
}

const INITIAL: KpiState = { status: "idle", last: null, change: null, marketCap: null };

function formatPrice(v: number | null): string {
  return v === null ? "--" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatMarketCap(v: number | null): string {
  if (v === null) return "--";
  const a = Math.abs(v);
  if (a >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

// Pill color follows tone polarity; the pill text carries the level label.
function pillToneFor(t: ToneSummary): SentimentTone {
  if (!t.level) return "NEUTRAL";
  const p = levelPolarity(t.level);
  return p === "positive" ? "BULLISH" : p === "negative" ? "BEARISH" : "MIXED";
}

const DIR_GLYPH: Record<ToneDirection, string> = { improving: "▲", deteriorating: "▼", steady: "→" };
const DIR_COLOR: Record<ToneDirection, string> = {
  improving: "var(--signal-up)",
  deteriorating: "var(--signal-dn)",
  steady: "var(--text-faint)",
};

// Sub-content under the tone level: a compact week-over-week direction (when not
// suppressed) plus the evidence count, which ALWAYS renders beside a level.
function ToneCellMeta({ tone }: { tone: ToneSummary }) {
  if (!tone.sufficient) {
    return <span style={{ color: "var(--text-faint)" }}>Not enough coverage yet</span>;
  }
  return (
    <>
      {tone.direction ? (
        <div
          data-testid="kpi-card-sentiment-direction"
          style={{ color: DIR_COLOR[tone.direction], fontWeight: 600 }}
        >
          {DIR_GLYPH[tone.direction]} {directionVerb(tone.direction)}
        </div>
      ) : null}
      <div data-testid="kpi-card-sentiment-evidence">{formatEvidence(tone.evidence)}</div>
    </>
  );
}

const cellBase: CSSProperties = { padding: "11px 14px", minWidth: 0 };
const cellRight: CSSProperties = { ...cellBase, borderRight: "1px solid var(--border-soft, #e6dccd)" };
const valueStyle: CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: 19, fontWeight: 700,
  color: "var(--espresso, #2a1f15)", marginTop: 3,
  fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em",
};
const subStyle: CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-faint, #8a7a68)", marginTop: 1,
};
const privateBadgeStyle: CSSProperties = {
  display: "inline-block", marginLeft: 6, padding: "1px 6px",
  fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700,
  letterSpacing: "0.08em", textTransform: "uppercase",
  color: "var(--text-faint, #8a7a68)",
  border: "1px solid var(--border, #d8cfc1)", borderRadius: 3, verticalAlign: "middle",
};

interface CellProps {
  label: string; valueTestId: string; value: ReactNode;
  delta?: number | null; sub?: ReactNode; isLast?: boolean; trailing?: ReactNode;
  tooltip?: ReactNode;
}

function Cell({ label, valueTestId, value, delta, sub, isLast, trailing, tooltip }: CellProps) {
  const showDelta = delta !== null && delta !== undefined && Number.isFinite(delta);
  const labelNode = <Eyebrow as="span" variant="mono">{label}</Eyebrow>;
  return (
    <div data-testid="kpi-card" style={isLast ? cellBase : cellRight}>
      {tooltip ? <Tooltip content={tooltip}>{labelNode}</Tooltip> : labelNode}
      <div data-testid={valueTestId} style={valueStyle}>{value}{trailing}</div>
      {showDelta && (
        <div data-testid={valueTestId === "kpi-card-last" ? "kpi-card-last-delta" : undefined} style={{ marginTop: 1 }}>
          <Delta value={delta as number} size={11} />
        </div>
      )}
      {sub && <div style={subStyle}>{sub}</div>}
    </div>
  );
}

export function CompanyKPIStrip({ companyDetail }: CompanyKPIStripProps) {
  const ticker = companyDetail.ticker;
  const [kpi, setKpi] = useState<KpiState>(
    ticker ? INITIAL : { ...INITIAL, status: "private" },
  );

  useEffect(() => {
    if (!ticker) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch(`/api/company-kpis?ticker=${encodeURIComponent(ticker)}`, { signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        if (!r.ok) { setKpi({ status: "error", last: null, change: null, marketCap: null }); return; }
        const body = (await r.json()) as KpiResponse;
        if (ctrl.signal.aborted) return;
        if (body.kind === "private") setKpi({ status: "private", last: null, change: null, marketCap: null });
        else if (body.kind === "live") setKpi({ status: "ready", last: body.last, change: body.change, marketCap: body.marketCap });
        else setKpi({ status: "ready", last: body.last, change: body.change, marketCap: null });
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
        setKpi({ status: "error", last: null, change: null, marketCap: null });
      }
    })();
    return () => ctrl.abort();
  }, [ticker]);

  const isPrivate = kpi.status === "private" || companyDetail.isPrivate;
  const changePct = kpi.change !== null ? kpi.change * 100 : null;
  const m = companyDetail.mentions7d;
  const todayN = m.length > 0 ? m[m.length - 1] : 0;
  const sourcesCount = new Set(
    companyDetail.articles.map((a) => a.source).filter((s): s is string => !!s),
  ).size;
  const eventsToday = companyDetail.articles.filter((a) =>
    a.dealType ? ["M&A", "Earnings", "Funding", "IPO"].includes(a.dealType) : false,
  ).length;
  const tone = companyDetail.tone;

  return (
    <div
      data-testid="kpi-strip"
      className="overflow-x-auto"
      style={{
        background: "var(--cream-hi, #f5ede0)",
        border: "1px solid var(--border, #d8cfc1)",
        borderRadius: 8, display: "grid",
        gridTemplateColumns: "repeat(6, minmax(120px, 1fr))",
      }}
    >
      <Cell label="Last" valueTestId="kpi-card-last" value={formatPrice(kpi.last)}
        trailing={isPrivate ? <span style={privateBadgeStyle}>Private</span> : null}
        delta={changePct} />
      <Cell label="Market cap" valueTestId="kpi-card-marketcap"
        value={isPrivate ? "--" : formatMarketCap(kpi.marketCap)}
        sub={isPrivate ? "private" : null} />
      <Cell label="Mentions · 30d" valueTestId="kpi-card-mentions"
        value={companyDetail.mentions.toLocaleString("en-US")} />
      <Cell label="Article tone" valueTestId="kpi-card-sentiment"
        value={
          <SentimentPill
            tone={pillToneFor(tone)}
            label={tone.sufficient ? tone.levelLabel : "Limited"}
            size="sm"
            testId="kpi-card-sentiment-pill"
          />
        }
        sub={<ToneCellMeta tone={tone} />}
        tooltip="Plain-language tone of indexed articles over the last 7 days, with week-over-week direction. Not a price signal." />
      <Cell label="Articles · today" valueTestId="kpi-card-articles-today" value={todayN}
        sub={eventsToday > 0 ? `${eventsToday} ${eventsToday === 1 ? "event" : "events"}` : null} />
      <Cell label="Sources" valueTestId="kpi-card-sources" value={sourcesCount}
        sub={sourcesCount > 0 ? "primary + tier-1" : null} isLast />
    </div>
  );
}
