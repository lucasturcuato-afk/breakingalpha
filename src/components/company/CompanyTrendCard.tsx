"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { MiniBars } from "@/components/ui/mini-bars";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Tooltip } from "@/components/ui/tooltip";
import { ToneReadout } from "@/components/company/ToneReadout";
import { ToneTrendChart } from "@/components/company/ToneTrendChart";
import type { ToneSummary } from "@/lib/tone";
import {
  formatAttentionPace,
  formatAttentionVolume,
  type AttentionLevel,
  type AttentionSummary,
} from "@/lib/attention";

const MONO = "var(--font-mono), ui-monospace, monospace";
const SERIF = "var(--font-display), serif";
const SANS = "var(--font-sans), sans-serif";
// Default + minimum rail widths. The default seeds SSR and the first paint
// before ResizeObserver fires; the minimum protects against negative-sized
// SVG primitives at extreme narrow viewports.
const RAIL_W_DEFAULT = 310;
const RAIL_W_MIN = 220;

// Attention level color follows magnitude, NOT sentiment (elevated attention is
// not inherently bullish): Elevated reads gold/notable, Normal neutral, Quiet muted.
const ATTENTION_COLOR: Record<AttentionLevel, string> = {
  ELEVATED: "var(--gold-deep)",
  NORMAL: "var(--espresso)",
  QUIET: "var(--text-faint)",
};

const LEVEL_STYLE: CSSProperties = {
  fontFamily: SERIF,
  fontSize: 16,
  fontWeight: 700,
  letterSpacing: "-0.01em",
};
const CONTEXT_STYLE: CSSProperties = {
  fontFamily: SANS,
  fontSize: 10,
  color: "var(--text-faint)",
  marginTop: 4,
};

interface CompanyTrendCardProps {
  company: string;
  mentions7d: number[];
  tone: ToneSummary;
  attention: AttentionSummary;
  days?: string[];
  className?: string;
}

// Attention readout: level headline (replacing the old raw "Mentions: 100") with
// the volume + relative-pace context always shown beside it.
function AttentionReadout({ attention }: { attention: AttentionSummary }) {
  if (!attention.sufficient || !attention.level) {
    return (
      <div data-testid="trend-card-attention" data-sufficient="false">
        <div style={{ ...LEVEL_STYLE, color: "var(--text-faint)" }}>Limited coverage</div>
        <div style={CONTEXT_STYLE}>{formatAttentionVolume(attention)}</div>
      </div>
    );
  }
  const pace = formatAttentionPace(attention);
  return (
    <div data-testid="trend-card-attention" data-sufficient="true" data-level={attention.level}>
      <div data-testid="trend-card-attention-level" style={{ ...LEVEL_STYLE, color: ATTENTION_COLOR[attention.level] }}>
        {attention.levelLabel}
      </div>
      <div data-testid="trend-card-attention-context" style={CONTEXT_STYLE}>
        {formatAttentionVolume(attention)}{pace ? ` · ${pace}` : ""}
      </div>
    </div>
  );
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
  company,
  mentions7d,
  tone,
  attention,
  days,
  className,
}: CompanyTrendCardProps) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [railW, setRailW] = useState<number>(RAIL_W_DEFAULT);

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === "number" && w > 0) {
        // Section has 14px horizontal padding on the inner content wrapper;
        // subtract on both sides so chart primitives fit inside.
        const inner = Math.floor(w) - 28;
        setRailW(Math.max(RAIL_W_MIN, inner));
      }
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const dayLabels = days ?? deriveDayLabels(mentions7d.length);

  return (
    <section
      ref={sectionRef}
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
            <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: 11, color: "var(--text-faint)", fontWeight: 600, letterSpacing: "0.05em" }}>
              {mentions7d.length}d
            </span>
          </h3>
        </div>

        <div style={{ padding: "12px 14px" }}>
          <div style={{ marginBottom: 6 }}>
            <Tooltip content="News volume relative to this company's own trailing 28-day baseline. Elevated / Normal / Quiet, not a raw count.">
              <Eyebrow as="span" variant="mono" color="var(--text-faint)" testId="trend-card-attention-eyebrow">Attention</Eyebrow>
            </Tooltip>
          </div>
          <AttentionReadout attention={attention} />
          <div style={{ marginTop: 8 }}>
            <MiniBars values={mentions7d} w={railW} h={42} color="var(--gold)" gap={4} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
              {dayLabels.map((d, i) => (
                <span key={i} style={{ fontFamily: MONO, fontSize: 8.5, color: "var(--text-faint)" }}>{d}</span>
              ))}
            </div>
          </div>

          <div style={{ height: 1, background: "var(--border-subtle)", margin: "12px 0" }} />

          <div style={{ marginBottom: 6 }}>
            <Tooltip content="Plain-language tone of indexed articles over the last 7 days, with week-over-week direction. Not a price signal.">
              <Eyebrow as="span" variant="mono" color="var(--text-faint)" testId="trend-card-sentiment-eyebrow">Article tone</Eyebrow>
            </Tooltip>
          </div>
          <ToneReadout tone={tone} scale="rail" />
          <div style={{ marginTop: 8 }}>
            <ToneTrendChart company={company} compact />
          </div>
        </div>
      </div>
    </section>
  );
}
