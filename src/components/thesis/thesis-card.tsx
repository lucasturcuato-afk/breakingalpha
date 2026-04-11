"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  MoreHorizontal,
  ArrowRight,
  Sparkles,
  Shield,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import { MemoModal } from "@/components/memo/MemoModal";
import type { ThesisItem } from "./thesis-types";
import type { BadgeVariant } from "@/components/ui/badge";

const convictionMap: Record<string, BadgeVariant> = {
  BULLISH: "bullish",
  BEARISH: "bearish",
  WATCH: "neutral",
};

interface ThesisCardProps {
  thesis: ThesisItem;
  onUpdate?: (updated: ThesisItem) => void;
}

export function ThesisCard({ thesis, onUpdate }: ThesisCardProps) {
  const [memoOpen, setMemoOpen] = useState(false);
  const [bearOpen, setBearOpen] = useState(false);

  // Render the adversarial stress-test row. Wrapped in try/catch so any
  // unexpected shape in thesis fields never crashes the whole card.
  const renderAdversarial = () => {
    try {
      const passed = thesis.passed_adversarial;
      const score = thesis.adversarial_score;
      const bear = thesis.bear_case;

      // STATE 1 — pending (field is null/undefined)
      if (passed === null || passed === undefined) {
        return (
          <div className="flex items-center gap-1 mb-2">
            <Shield size={9} className="text-text-faint" />
            <span className="font-data text-[9px] text-text-faint">
              Stress test pending
            </span>
          </div>
        );
      }

      const scorePct =
        typeof score === "number" ? `${(score * 100).toFixed(0)}%` : "—";

      // STATE 2 — bull wins
      if (passed === true) {
        return (
          <div
            className="rounded-md px-2 py-1 mb-2"
            style={{ background: "var(--gold-muted)" }}
          >
            <div className="flex items-center gap-1">
              <ShieldCheck size={9} className="text-gold" />
              <span className="font-data text-[9px] text-gold-dark font-semibold">
                Bull case wins · {scorePct}
              </span>
            </div>
            {bear && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setBearOpen((v) => !v);
                  }}
                  className="mt-1 font-data text-[9px] text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
                >
                  Bear case {bearOpen ? "↑" : "↓"}
                </button>
                {bearOpen && (
                  <p className="mt-1 font-sans text-[10px] text-text-secondary italic line-clamp-3">
                    {bear}
                  </p>
                )}
              </>
            )}
          </div>
        );
      }

      // STATE 3 — bear wins
      return (
        <div
          className="rounded-md px-2 py-1 mb-2"
          style={{
            background: "color-mix(in srgb, var(--signal-dn) 8%, transparent)",
          }}
        >
          <div className="flex items-center gap-1">
            <ShieldAlert size={9} className="text-signal-dn" />
            <span className="font-data text-[9px] text-signal-dn font-semibold">
              Bear case wins · {scorePct}
            </span>
          </div>
          {bear && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setBearOpen((v) => !v);
                }}
                className="mt-1 font-data text-[9px] text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
              >
                Bear case {bearOpen ? "↑" : "↓"}
              </button>
              {bearOpen && (
                <p className="mt-1 font-sans text-[10px] text-text-secondary italic line-clamp-3">
                  {bear}
                </p>
              )}
            </>
          )}
        </div>
      );
    } catch {
      return null;
    }
  };

  return (
    <>
      <div
        onClick={() => setMemoOpen(true)}
        className={cn(
          "bg-white border border-border-base rounded-xl p-3 cursor-pointer",
          "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
          "hover:border-border-hover hover:shadow-[0_2px_8px_rgba(201,146,42,0.06)]",
          "group",
        )}
      >
        {/* Top row: conviction + sector */}
        <div className="flex items-center gap-1.5 mb-2">
          <Badge variant={convictionMap[thesis.conviction]}>
            {thesis.conviction}
          </Badge>
          <Badge variant="default">{thesis.sector}</Badge>
          {thesis.evidence_chain && thesis.evidence_chain.length > 0 && (
            <span className="ml-auto font-data text-[9px] text-text-faint">
              {thesis.evidence_chain.length} evidence
            </span>
          )}
        </div>

        {/* Title */}
        <h4 className="font-display text-[13px] font-bold text-espresso leading-snug mb-1.5">
          {thesis.title}
        </h4>

        {/* Summary */}
        <p className="font-sans text-[11px] text-text-secondary leading-snug line-clamp-2 mb-2">
          {thesis.summary}
        </p>

        {/* Adversarial stress test */}
        {renderAdversarial()}

        {/* Catalyst */}
        {thesis.catalyst && (
          <p className="font-sans text-[10px] text-text-muted mb-2">
            <span className="font-semibold text-gold-dark">Catalyst:</span> {thesis.catalyst}
          </p>
        )}

        {/* Footer: timestamp + actions */}
        <div className="flex items-center justify-between">
          <span className="font-data text-[9px] text-text-faint">{thesis.updatedAt}</span>
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
