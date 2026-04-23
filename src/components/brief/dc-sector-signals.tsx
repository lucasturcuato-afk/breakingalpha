"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const HERITAGE_GOLD = "#d4a84b";
const DC_ESPRESSO = "#1a1208";

const SECTOR_ACCENTS: Record<string, string> = {
  "Technology M&A": "#d4a84b",
  Technology: "#d4a84b",
  "Venture Capital": "#8b5cf6",
  "Private Equity": "#3b82f6",
  "Public Markets": "#10b981",
  "Geopolitics & Macro": "#ef4444",
  Geopolitics: "#ef4444",
  "Fintech & Crypto": "#06b6d4",
  "Healthcare & Biotech": "#ec4899",
  "Energy & Climate": "#22c55e",
  "Consumer & Retail": "#f97316",
  "Real Estate & REITs": "#64748b",
  "Financial Services": "#3b82f6",
  "Aerospace & Defense": "#64748b",
  "Industrials & Manufacturing": "#94a3b8",
};

export interface DCSectorSignalsProps {
  breakdown: Record<string, string>;
}

export function DCSectorSignals({ breakdown }: DCSectorSignalsProps) {
  const [filter, setFilter] = useState<string | null>(null);
  const sectors = Object.keys(breakdown);
  if (sectors.length === 0) return null;
  const entries = filter ? [[filter, breakdown[filter]] as [string, string]] : Object.entries(breakdown);

  return (
    <section style={{ marginBottom: 40 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 18,
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <h3
          className="font-[family-name:var(--font-playfair-display)]"
          style={{
            fontSize: 26,
            fontWeight: 800,
            color: "var(--espresso)",
            margin: 0,
            letterSpacing: "-0.015em",
          }}
        >
          Sector Signals
        </h3>
        {sectors.length > 1 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <SectorPill
              label="All"
              active={!filter}
              onClick={() => setFilter(null)}
            />
            {sectors.map((s) => (
              <SectorPill
                key={s}
                label={s}
                active={filter === s}
                onClick={() => setFilter(filter === s ? null : s)}
              />
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {entries.map(([sector, analysis]) => {
          const accent = SECTOR_ACCENTS[sector] ?? HERITAGE_GOLD;
          return (
            <div
              key={sector}
              style={{
                background: "var(--elevated)",
                border: "1px solid var(--border-base)",
                borderRadius: 12,
                borderLeft: `4px solid ${accent}`,
                padding: "16px 18px",
              }}
            >
              <p
                className="font-sans"
                style={{
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--gold-dark)",
                  fontWeight: 700,
                  margin: "0 0 8px",
                }}
              >
                {sector}
              </p>
              <p
                className="font-sans"
                style={{
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: "var(--text-primary)",
                  margin: 0,
                  whiteSpace: "pre-line",
                }}
              >
                {analysis}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SectorPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("font-sans cursor-pointer")}
      style={{
        padding: "5px 11px",
        borderRadius: 18,
        border: `1.5px solid ${active ? HERITAGE_GOLD : "var(--border-base)"}`,
        background: active ? HERITAGE_GOLD : "var(--elevated)",
        color: active ? DC_ESPRESSO : "var(--text-secondary)",
        fontSize: 11,
        fontWeight: active ? 700 : 500,
        letterSpacing: "0.02em",
      }}
    >
      {label}
    </button>
  );
}
