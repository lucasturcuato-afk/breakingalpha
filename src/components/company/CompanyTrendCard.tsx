"use client";

import type { CSSProperties } from "react";
import { MiniBars } from "@/components/ui/mini-bars";
import { Sparkline } from "@/components/ui/sparkline";
import { SentimentHeat } from "@/components/ui/sentiment-heat";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Tooltip } from "@/components/ui/tooltip";

const MONO = "var(--font-mono), ui-monospace, monospace";
const SERIF = "var(--font-display), serif";
const RAIL_W = 310;

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

interface CompanyTrendCardProps {
  mentions7d: number[];
  sentiment7d: number[];
  days?: string[];
  className?: string;
}

function sumHalves(values: number[]): { first: number; last: number } {
  if (values.length === 0) return { first: 0, last: 0 };
  const half = Math.floor(values.length / 2);
  let first = 0;
  let last = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < half) first += values[i] ?? 0;
    else last += values[i] ?? 0;
  }
  return { first, last };
}

function pctDelta(prev: number, next: number): number {
  if (prev === 0) return next === 0 ? 0 : 100;
  return ((next - prev) / prev) * 100;
}

function formatSigned(v: number, digits = 2): string {
  return (v >= 0 ? "+" : "-") + Math.abs(v).toFixed(digits);
}

function deriveDayLabels(count: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const day = d.getDate();
    if (i === count - 1 || day === 1) {
      out.push(d.toLocaleString("en-US", { month: "short" }) + " " + day);
    } else {
      out.push(String(day));
    }
  }
  return out;
}

export function CompanyTrendCard({
  mentions7d,
  sentiment7d,
  days,
  className,
}: CompanyTrendCardProps) {
  const mentionsTotal = mentions7d.reduce((a, b) => a + b, 0);
  const halves = sumHalves(mentions7d);
  const mentionsDelta = pctDelta(halves.first, halves.last);
  const sentimentLatest =
    sentiment7d.length > 0 ? sentiment7d[sentiment7d.length - 1] : 0.5;
  const sentimentFirst = sentiment7d.length > 0 ? sentiment7d[0] : 0.5;
  const sentimentSigned = sentimentLatest * 2 - 1;
  const sentimentDelta = sentimentLatest - sentimentFirst;
  const dayLabels = days ?? deriveDayLabels(mentions7d.length);
  const mUp = mentionsDelta >= 0;
  const sUp = sentimentDelta >= 0;
  const upColor = (up: boolean) =>
    up ? "var(--signal-up)" : "var(--signal-dn)";

  return (
    <section
      data-testid="trend-card"
      data-rail="trend-card-rail"
      className={className}
      aria-label="Signal Trend"
      style={{
        background: "var(--cream-hi)",
        border: "1px solid var(--border-base)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div data-testid="trend-card-rail">
        <div style={{ padding: "11px 14px", borderBottom: "1px solid var(--border-subtle)" }}>
          <h3 style={{ fontFamily: SERIF, fontSize: 14, fontWeight: 700, margin: 0, color: "var(--espresso)" }}>
            Signal Trend
            <span style={{ color: "var(--text-faint)", fontWeight: 400 }}> · </span>
            <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--text-faint)", fontWeight: 600, letterSpacing: "0.05em" }}>
              {mentions7d.length}d
            </span>
          </h3>
        </div>

        <div style={{ padding: "12px 14px" }}>
          <div style={ROW}>
            <Eyebrow as="span" color="var(--text-faint)" testId="trend-card-mentions-eyebrow">Mentions</Eyebrow>
            <span data-testid="trend-card-mentions-total" style={HEADLINE}>{mentionsTotal}</span>
            <span data-testid="trend-delta" style={{ ...DELTA, color: upColor(mUp) }}>
              {mUp ? "▲" : "▼"} {Math.abs(mentionsDelta).toFixed(0)}%
            </span>
          </div>
          <MiniBars values={mentions7d} w={RAIL_W} h={42} color="var(--gold)" gap={4} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
            {dayLabels.map((d, i) => (
              <span key={i} style={{ fontFamily: MONO, fontSize: 8.5, color: "var(--text-faint)" }}>{d}</span>
            ))}
          </div>

          <div style={{ height: 1, background: "var(--border-subtle)", margin: "12px 0" }} />

          <div style={ROW}>
            <Tooltip content="Aggregate tone of indexed articles over the past 7 days. Not a price signal.">
              <Eyebrow as="span" color="var(--text-faint)" testId="trend-card-sentiment-eyebrow">Article tone</Eyebrow>
            </Tooltip>
            <span data-testid="trend-card-sentiment-total" style={HEADLINE}>{formatSigned(sentimentSigned, 2)}</span>
            <span data-testid="trend-card-sentiment-delta" style={{ ...DELTA, color: upColor(sUp) }}>
              {sUp ? "▲" : "▼"} {Math.abs(sentimentDelta).toFixed(2)}
            </span>
          </div>
          <Sparkline values={sentiment7d} w={RAIL_W} h={36} stroke="var(--signal-up)" fill="rgba(22,163,74,0.10)" strokeWidth={1.8} />
          <div style={{ marginTop: 4 }}>
            <SentimentHeat values={sentiment7d} w={RAIL_W} h={7} gap={3} />
          </div>
        </div>
      </div>
    </section>
  );
}
