"use client";

/**
 * LoadingStatusChip (PR-E3) -- 3-stage progress chip for the company-detail
 * Suspense fallback. Cycles `fetching -> parsing -> rendering` on a 900ms
 * interval. Under `prefers-reduced-motion: reduce`, freezes on stage 0
 * and skips the timer. Pill chrome mirrors DirectionD's gold "Generating"
 * chip (gold-muted bg, gold-border, mono uppercase 10px, pulsing 5px dot).
 */

import { useEffect, useState } from "react";

const STAGES = [
  { id: "fetching", label: "Fetching" },
  { id: "parsing", label: "Parsing" },
  { id: "rendering", label: "Rendering" },
] as const;

const CHIP_STYLE = {
  background: "var(--gold-muted)",
  border: "1px solid var(--gold-border)",
  color: "var(--gold-dark)",
  fontFamily: "var(--font-sans), sans-serif",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
};

export function LoadingStatusChip() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      setStage((s) => (s + 1) % STAGES.length);
    }, 900);
    return () => window.clearInterval(id);
  }, []);

  const active = STAGES[stage];
  return (
    <div
      data-testid="company-loading-status-chip"
      className="inline-flex items-center gap-2 rounded-full px-3 py-1"
      style={CHIP_STYLE}
    >
      <span
        aria-hidden="true"
        className="track-record-pending-dot inline-block rounded-full"
        style={{ width: 5, height: 5, background: "var(--gold)" }}
      />
      <span data-testid={`company-loading-status-${active.id}`}>{active.label}</span>
    </div>
  );
}
