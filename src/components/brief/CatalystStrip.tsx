/**
 * CatalystStrip - upcoming scheduled market catalysts (FOMC, CPI, PCE, jobs).
 *
 * Data rides inside the existing `macro_panel.catalysts` JSON written by
 * backend/event_calendar.py (no new column, no migration). The backend static
 * floor guarantees the schedule; `consensus` / `previous` / `actual` appear only
 * when the live layer (FRED) supplied them, and are REPORTED market data, not a
 * Signalera prediction. Renders nothing when there are no catalysts.
 */
"use client";

import React from "react";

export interface CatalystItem {
  date: string;
  when: string;
  name: string;
  type: "fomc" | "cpi" | "pce" | "nfp" | string;
  time_et: string;
  has_dot_plot?: boolean;
  consensus?: string | null;
  previous?: string | null;
  actual?: string | null;
  impact?: string;
}

function valueLine(c: CatalystItem): string | null {
  const parts: string[] = [];
  if (c.consensus) parts.push(`consensus ${c.consensus}`);
  if (c.actual) parts.push(`actual ${c.actual}`);
  if (c.previous) parts.push(`prior ${c.previous}`);
  return parts.length ? parts.join(", ") : null;
}

export default function CatalystStrip({
  catalysts,
}: {
  catalysts?: CatalystItem[] | null;
}) {
  if (!catalysts || catalysts.length === 0) return null;

  return (
    <section aria-label="Scheduled catalysts" className="w-full">
      <h3 className="mb-2 text-[11px] font-semibold text-text-muted">
        Scheduled catalysts
      </h3>
      <ul className="flex flex-wrap gap-2">
        {catalysts.map((c, i) => {
          const vline = valueLine(c);
          return (
            <li
              key={`${c.date}-${c.type}-${i}`}
              className="rounded-md border border-amber-200/60 bg-amber-50/40 px-3 py-2 text-sm"
            >
              <div className="flex items-baseline gap-2">
                <span className="font-semibold text-stone-800">{c.name}</span>
                {c.has_dot_plot ? (
                  <span className="rounded bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                    dot plot
                  </span>
                ) : null}
              </div>
              <div className="mt-0.5 text-xs text-stone-500">
                {c.when}, {c.time_et}
              </div>
              {vline ? (
                <div className="mt-0.5 text-xs text-stone-600">{vline}</div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
