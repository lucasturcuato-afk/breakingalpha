"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  MoreHorizontal,
  ArrowRight,
  Sparkles,
  Clock,
} from "lucide-react";
import { MemoModal } from "@/components/memo/MemoModal";
import { Tooltip } from "@/components/ui/tooltip";
import type { ThesisItem } from "./thesis-types";
import { ConvictionRing } from "./ConvictionRing";
import { SparklineChart } from "./SparklineChart";
import { TickerContext } from "./TickerContext";

// ── Adversarial Shield SVG ──

function AdversarialShield({
  passed,
  score,
}: {
  passed: boolean | null | undefined;
  score: number | null | undefined;
}) {
  const fill =
    passed === true
      ? "var(--gold)"
      : passed === false
        ? "var(--signal-dn)"
        : "none";
  const stroke =
    passed === true
      ? "var(--gold)"
      : passed === false
        ? "var(--signal-dn)"
        : "var(--text-faint)";
  const label =
    passed === true
      ? "Bull wins"
      : passed === false
        ? "Bear wins"
        : "Pending";
  const scoreStr =
    typeof score === "number" ? score.toFixed(2) : "—";

  return (
    <Tooltip content={`${label} · ${scoreStr}`}>
      <svg width={14} height={16} viewBox="0 0 14 16" className="flex-shrink-0">
        <path
          d="M7 1L1 3.5V7.5C1 11 3.5 13.5 7 15C10.5 13.5 13 11 13 7.5V3.5L7 1Z"
          fill={fill}
          stroke={stroke}
          strokeWidth={1.2}
          fillOpacity={passed === null || passed === undefined ? 0 : 0.2}
        />
      </svg>
    </Tooltip>
  );
}

// ── Outcome Icon SVG ──

function OutcomeIcon({
  outcome,
}: {
  outcome: "confirmed" | "invalidated" | "inconclusive" | null | undefined;
}) {
  const size = 14;
  const c = size / 2;
  const r = 5;

  if (outcome === "confirmed") {
    return (
      <Tooltip content="Confirmed">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={c} cy={c} r={r} fill="none" stroke="var(--signal-up)" strokeWidth={1.5} />
          <polyline
            points="4.5,7 6.5,9.5 9.5,5"
            fill="none"
            stroke="var(--signal-up)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Tooltip>
    );
  }
  if (outcome === "invalidated") {
    return (
      <Tooltip content="Invalidated">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={c} cy={c} r={r} fill="none" stroke="var(--signal-dn)" strokeWidth={1.5} />
          <line x1="5" y1="5" x2="9" y2="9" stroke="var(--signal-dn)" strokeWidth={1.5} strokeLinecap="round" />
          <line x1="9" y1="5" x2="5" y2="9" stroke="var(--signal-dn)" strokeWidth={1.5} strokeLinecap="round" />
        </svg>
      </Tooltip>
    );
  }
  if (outcome === "inconclusive") {
    return (
      <Tooltip content="Inconclusive">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={c} cy={c} r={r} fill="none" stroke="var(--signal-warn)" strokeWidth={1.5} />
          <line x1="4.5" y1={c} x2="9.5" y2={c} stroke="var(--signal-warn)" strokeWidth={1.5} strokeLinecap="round" />
        </svg>
      </Tooltip>
    );
  }
  // null / undefined
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--text-faint)" strokeWidth={1.2} strokeDasharray="2 2" />
    </svg>
  );
}

// ── Staleness indicator ──

function StalenessIndicator({ generatedAt, outcome }: { generatedAt?: string | null; outcome?: string | null }) {
  if (!generatedAt || outcome) return null;
  const age = Date.now() - new Date(generatedAt).getTime();
  const days14 = 14 * 24 * 60 * 60 * 1000;
  if (age < days14) return null;
  return (
    <Tooltip content="Stale — awaiting outcome">
      <Clock size={10} className="text-signal-warn flex-shrink-0" />
    </Tooltip>
  );
}

// ── Main Component ──

interface ThesisCardProps {
  thesis: ThesisItem;
  onUpdate?: (updated: ThesisItem) => void;
  isSelected?: boolean;
}

export function ThesisCard({ thesis, isSelected }: ThesisCardProps) {
  const [memoOpen, setMemoOpen] = useState(false);
  const [bearOpen, setBearOpen] = useState(false);

  // FIX 6A: sentiment left border color
  const sentimentBorder =
    thesis.conviction === "HIGH" || thesis.conviction === "BULLISH"
      ? "border-l-gold"
      : thesis.conviction === "BEARISH"
        ? "border-l-signal-dn"
        : thesis.conviction === "MEDIUM"
          ? "border-l-signal-warn"
          : "border-l-border-base";

  return (
    <>
      <div
        onClick={() => setMemoOpen(true)}
        className={cn(
          "bg-parchment border border-border-base rounded-xl p-3 cursor-pointer",
          "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
          "hover:border-border-hover hover:shadow-[0_2px_8px_rgba(201,146,42,0.06)]",
          "group border-l-2",
          isSelected ? "border-l-4 border-l-gold bg-parchment-mid" : sentimentBorder,
        )}
      >
        {/* Top row: ring + title + icons */}
        <div className="flex items-start gap-2.5">
          <ConvictionRing conviction={thesis.conviction} />
          <div className="flex-1 min-w-0">
            {/* Badges row */}
            <div className="flex items-center gap-1.5 mb-1">
              <Badge variant="default">{thesis.sector}</Badge>
              <StalenessIndicator generatedAt={thesis.generated_at} outcome={thesis.outcome} />
            </div>
            {/* Title — FIX 6C: font-display 13px semibold */}
            <h4 className="font-display text-[13px] font-semibold text-espresso leading-snug line-clamp-2 break-words">
              {thesis.title}
            </h4>
            {/* Age indicator */}
            {(() => {
              if (!thesis.generated_at) return null;
              const diffMs = Date.now() - new Date(thesis.generated_at).getTime();
              const ageDays = Math.floor(diffMs / 86400000);
              const ageHours = Math.floor(diffMs / 3600000);
              const isStale = ageDays >= 14 && !thesis.outcome;
              let label: string;
              if (ageHours < 24) label = "Today";
              else if (ageDays < 7) label = `${ageDays}d ago`;
              else label = `${Math.floor(ageDays / 7)}w ago`;
              if (isStale) label += " \u26A0";
              return (
                <span className={`font-mono text-[10px] mt-0.5 inline-block ${
                  isStale ? "text-amber-500" : "text-[var(--text-muted)]"
                }`}>
                  {label}
                </span>
              );
            })()}
            {/* Ticker context */}
            {thesis.ticker && (
              <TickerContext ticker={thesis.ticker} thesisCreatedAt={thesis.generated_at} variant="compact" />
            )}
            {/* Hover rationale preview */}
            {thesis.rationale && (
              <p className="font-sans text-[10px] italic text-text-muted mt-0.5 line-clamp-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                {thesis.rationale.length > 80 ? thesis.rationale.slice(0, 80) + "\u2026" : thesis.rationale}
              </p>
            )}
          </div>
          {/* Right side icons */}
          <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5">
            <AdversarialShield passed={thesis.passed_adversarial} score={thesis.adversarial_score} />
            <OutcomeIcon outcome={thesis.outcome} />
          </div>
        </div>

        {/* Summary */}
        <p className="font-sans text-[11px] text-text-secondary leading-snug line-clamp-2 mt-2 mb-2">
          {thesis.summary}
        </p>

        {/* Bear case collapsible */}
        {thesis.bear_case && (
          <div className="mb-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setBearOpen((v) => !v);
              }}
              className="font-data text-[9px] text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
            >
              Bear case {bearOpen ? "↑" : "↓"}
            </button>
            {bearOpen && (
              <p className="mt-1 font-sans text-[10px] text-text-secondary italic line-clamp-3 treatment-ai pl-2">
                {thesis.bear_case}
              </p>
            )}
          </div>
        )}

        {/* Catalyst */}
        {thesis.catalyst && (
          <p className="font-sans text-[10px] text-text-muted mb-2">
            <span className="font-semibold text-gold-dark">Catalyst:</span> {thesis.catalyst}
          </p>
        )}

        {/* Footer: timestamp + hover actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-data text-[9px] text-text-faint">{thesis.updatedAt}</span>
            {thesis.outcome && (
              <span className={`font-sans text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                thesis.outcome === "confirmed" ? "bg-signal-up/10 text-signal-up" :
                thesis.outcome === "invalidated" ? "bg-signal-dn/10 text-signal-dn" :
                "bg-signal-warn/10 text-signal-warn"
              }`}>
                {thesis.outcome === "confirmed" ? "✓ Confirmed" :
                 thesis.outcome === "invalidated" ? "✗ Invalidated" :
                 "~ Inconclusive"}
              </span>
            )}
            {!thesis.outcome && (
              <span className="font-sans text-[9px] px-1.5 py-0.5 rounded bg-signal-warn/10 text-signal-warn">
                ⏳ Pending
              </span>
            )}
            {thesis.ticker && (
              <span className="font-data text-[9px] text-gold-dark bg-gold-muted px-1.5 py-0.5 rounded">
                {thesis.ticker}
              </span>
            )}
            {thesis.ticker && <SparklineChart ticker={thesis.ticker} size="sm" />}
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMemoOpen(true);
              }}
              className="p-1 rounded-md hover:bg-parchment-mid transition-colors cursor-pointer"
              aria-label="Generate memo"
            >
              <Sparkles size={11} className="text-gold" />
            </button>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className="p-1 rounded-md hover:bg-parchment-mid transition-colors cursor-pointer"
              aria-label="Move to next stage"
            >
              <ArrowRight size={11} className="text-text-faint" />
            </button>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className="p-1 rounded-md hover:bg-parchment-mid transition-colors cursor-pointer"
              aria-label="More actions"
            >
              <MoreHorizontal size={11} className="text-text-faint" />
            </button>
          </div>
        </div>
      </div>

      <MemoModal
        isOpen={memoOpen}
        onClose={() => setMemoOpen(false)}
        title={thesis.title}
        content={[thesis.title, thesis.summary, thesis.rationale || ""].join("\n\n")}
        type="thesis"
      />
    </>
  );
}
