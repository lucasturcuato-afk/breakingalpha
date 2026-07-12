"use client";

/**
 * PrimerFinancialSnapshot (Coverage Primer PR1)
 *
 * Compact read-only digest of the latest validated annual XBRL period: a short
 * key-metric column, sourced from the same fetchCompanyFinancials view the full
 * Financials tab uses. This is a scannable summary, not the full grid; the
 * Financials tab remains the detailed surface.
 *
 * Graceful for sparse companies: a non-CIK / no-periods company shows the same
 * neutral empty copy the Financials tab uses (private vs no-report-yet), never a
 * blank or broken section. Informational only, no directional language.
 */

import type { CompanyFinancialsResult } from "@/lib/financial-facts";
import { formatValue, type Fmt } from "../financials-format";
import { financialsEmptyCopy } from "../empty-state-copy";

interface PrimerFinancialSnapshotProps {
  financials: CompanyFinancialsResult;
}

// A short, scannable key-metric set (the full ledger lives in the Financials
// tab). Keys match financial_facts_latest metric_key; fmt mirrors FinancialsTab.
const KEY_METRICS: { key: string; label: string; fmt: Fmt }[] = [
  { key: "revenue", label: "Revenue", fmt: "usd" },
  { key: "gross_profit", label: "Gross profit", fmt: "usd" },
  { key: "operating_income", label: "Operating income", fmt: "usd" },
  { key: "net_income", label: "Net income", fmt: "usd" },
  { key: "eps_diluted", label: "EPS (diluted)", fmt: "eps" },
];

export function PrimerFinancialSnapshot({ financials }: PrimerFinancialSnapshotProps) {
  const hasCik = financials.cik != null;
  const annual = financials.annual;
  const latest = annual.periods[0]; // newest first; undefined when none

  // Rows present in the latest annual column (skip metrics with no fact).
  const rows = latest
    ? KEY_METRICS.map((m) => {
        const cell = annual.grid[m.key]?.[latest.key];
        return cell && Number.isFinite(cell.value)
          ? { label: m.label, display: formatValue(cell.value, m.fmt) }
          : null;
      }).filter((r): r is { label: string; display: string } => r !== null)
    : [];

  // Margins computed from the fundamentals already shown (latest annual column).
  // Pure ratios of reported statement values, no external data. Skipped when the
  // numerator or a non-zero revenue denominator is missing.
  const cellVal = (key: string): number | null => {
    if (!latest) return null;
    const c = annual.grid[key]?.[latest.key];
    return c && Number.isFinite(c.value) ? c.value : null;
  };
  const revenue = cellVal("revenue");
  const margins: { label: string; display: string }[] = [];
  if (revenue && revenue !== 0) {
    const addMargin = (label: string, numerator: number | null) => {
      if (numerator != null) margins.push({ label, display: formatValue(numerator / revenue, "pct") });
    };
    addMargin("Gross margin", cellVal("gross_profit"));
    addMargin("Operating margin", cellVal("operating_income"));
    addMargin("Net margin", cellVal("net_income"));
  }

  return (
    <section
      data-testid="primer-financial-snapshot"
      className="bg-cream-hi border border-border-base rounded-lg p-4 space-y-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-sans text-[9.5px] font-bold text-text-faint">
          Financial snapshot
        </h3>
        {latest ? (
          <span className="font-sans text-[9px] text-text-faint">
            {latest.label}
          </span>
        ) : null}
      </div>

      {rows.length > 0 ? (
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
          {rows.map((r) => (
            <div key={r.label} className="flex flex-col gap-0.5">
              <dt className="font-sans text-[9px] font-bold text-text-faint">
                {r.label}
              </dt>
              <dd className="font-data text-[13px] text-espresso font-semibold">
                {r.display}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p
          data-testid="primer-financial-snapshot-empty"
          className="font-sans text-[12px] text-text-faint italic leading-relaxed"
        >
          {financialsEmptyCopy(hasCik)}
        </p>
      )}

      {margins.length > 0 ? (
        <div data-testid="primer-margins" className="pt-1 border-t border-border-base/60">
          <dl className="grid grid-cols-3 gap-x-4 gap-y-2 pt-2">
            {margins.map((m) => (
              <div key={m.label} className="flex flex-col gap-0.5">
                <dt className="font-sans text-[9px] font-bold text-text-faint">
                  {m.label}
                </dt>
                <dd className="font-data text-[13px] text-espresso font-semibold">
                  {m.display}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </section>
  );
}
