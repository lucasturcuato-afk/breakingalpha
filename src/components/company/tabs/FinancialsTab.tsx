"use client";

/**
 * FinancialsTab -- validated XBRL financials for the company, read-only.
 *
 * Data comes from fetchCompanyFinancials (src/lib/financial-facts.ts),
 * resolved server-side in the page and passed in as a serializable pivot.
 * Source: the financial_facts_latest view (validated facts only; quarantined
 * facts never reach this tab, so a missing cell is rendered as an em-dash --
 * never an implied $0).
 *
 * Layout: metrics as rows grouped Income / Balance sheet, plus Operating
 * cash flow as a single key line; periods as columns, newest left, headers
 * from the period-derived fiscal labels. Annual (5 FY) / Quarterly (8 Q)
 * toggle, default Annual. Quarterly Q4 income cells are blank for most
 * filers (no Q4 10-Q; only cash flow carries a derived Q4) -- expected.
 *
 * Equity: when noncontrolling / redeemable / temporary equity rows exist,
 * the block renders parent equity + each component + a computed Total
 * equity line, because parent equity alone reads wrong for NCI-heavy
 * companies (Cheniere: parent 3.755B + NCI 4.917B = total 8.672B).
 *
 * Styling mirrors FilingsTab / ArticlesTable; no new tokens.
 */

import { useMemo, useState } from "react";

import type {
  CompanyFinancialsResult,
  FinancialCell,
  FinancialView,
} from "@/lib/financial-facts";
import { formatValue, type Fmt } from "./financials-format";

export interface FinancialsTabProps {
  financials: CompanyFinancialsResult;
  /** True when the company resolved to a SEC CIK. */
  hasCik: boolean;
}

interface RowDef {
  key: string;
  label: string;
  fmt: Fmt;
  /** Indent + muted label (component lines inside the equity block). */
  sub?: boolean;
  /** Semibold (computed totals). */
  strong?: boolean;
}

const INCOME_ROWS: RowDef[] = [
  { key: "revenue", label: "Revenue", fmt: "usd" },
  { key: "cost_of_revenue", label: "Cost of revenue", fmt: "usd" },
  { key: "gross_profit", label: "Gross profit", fmt: "usd" },
  { key: "__gross_margin", label: "Gross margin", fmt: "pct", sub: true },
  { key: "operating_income", label: "Operating income", fmt: "usd" },
  { key: "net_income", label: "Net income", fmt: "usd" },
  { key: "eps_diluted", label: "EPS (diluted)", fmt: "eps" },
  { key: "eps_basic", label: "EPS (basic)", fmt: "eps", sub: true },
  { key: "shares_diluted", label: "Diluted shares", fmt: "shares" },
];

const EQUITY_COMPONENTS: RowDef[] = [
  { key: "minority_interest", label: "+ Noncontrolling interests", fmt: "usd", sub: true },
  {
    key: "redeemable_noncontrolling_interest",
    label: "+ Redeemable NCI",
    fmt: "usd",
    sub: true,
  },
  { key: "temporary_equity", label: "+ Temporary equity", fmt: "usd", sub: true },
];

const TH = "px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted";
const SECTION_TH =
  "px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted";

function ValueCell({ cell, fmt }: { cell: FinancialCell | undefined; fmt: Fmt }) {
  if (!cell || !Number.isFinite(cell.value)) {
    return <span className="text-text-muted">&mdash;</span>;
  }
  return (
    <span className={cell.value < 0 ? "text-negative" : undefined}>
      {formatValue(cell.value, fmt)}
    </span>
  );
}

export function FinancialsTab({ financials, hasCik }: FinancialsTabProps) {
  const [mode, setMode] = useState<"annual" | "quarterly">("annual");
  const view: FinancialView = mode === "annual" ? financials.annual : financials.quarterly;
  const { periods, grid } = view;

  // Derived rows + computed equity, per visible view.
  const derived = useMemo(() => {
    const grossMargin: Record<string, FinancialCell> = {};
    const totalEquity: Record<string, FinancialCell> = {};
    for (const p of periods) {
      const rev = grid.revenue?.[p.key];
      const gp = grid.gross_profit?.[p.key];
      if (rev && gp && rev.value !== 0) {
        grossMargin[p.key] = {
          value: gp.value / rev.value,
          filingUrl: gp.filingUrl,
          accession: gp.accession,
        };
      }
      const parent = grid.stockholders_equity?.[p.key];
      if (parent) {
        let total = parent.value;
        for (const c of EQUITY_COMPONENTS) {
          const cell = grid[c.key]?.[p.key];
          if (cell) total += cell.value;
        }
        totalEquity[p.key] = {
          value: total,
          filingUrl: parent.filingUrl,
          accession: parent.accession,
        };
      }
    }
    return { grossMargin, totalEquity };
  }, [periods, grid]);

  // Equity breakdown only when a component carries a nonzero value somewhere.
  const visibleEquityComponents = EQUITY_COMPONENTS.filter((c) =>
    periods.some((p) => {
      const cell = grid[c.key]?.[p.key];
      return cell != null && cell.value !== 0;
    }),
  );
  const equityBreakdown = visibleEquityComponents.length > 0;

  const balanceRows: RowDef[] = [
    { key: "total_assets", label: "Total assets", fmt: "usd" },
    { key: "total_liabilities", label: "Total liabilities", fmt: "usd" },
    ...(equityBreakdown
      ? [
          { key: "stockholders_equity", label: "Stockholders' equity (parent)", fmt: "usd" as Fmt },
          ...visibleEquityComponents,
          { key: "__total_equity", label: "= Total equity", fmt: "usd" as Fmt, strong: true },
        ]
      : [{ key: "stockholders_equity", label: "Stockholders' equity", fmt: "usd" as Fmt }]),
    { key: "cash_and_equivalents", label: "Cash & equivalents", fmt: "usd" },
  ];

  function cellsFor(key: string): Record<string, FinancialCell> | undefined {
    if (key === "__gross_margin") return derived.grossMargin;
    if (key === "__total_equity") return derived.totalEquity;
    return grid[key];
  }

  // A row with no value across every shown period is dropped, not dashed.
  function rowVisible(row: RowDef): boolean {
    const cells = cellsFor(row.key);
    if (!cells) return false;
    return periods.some((p) => cells[p.key] != null);
  }

  function sourceUrl(row: RowDef): string | null {
    const cells = cellsFor(row.key);
    if (!cells) return null;
    for (const p of periods) {
      const url = cells[p.key]?.filingUrl;
      if (url) return url;
    }
    return null;
  }

  const hasAnyData =
    financials.annual.periods.length > 0 || financials.quarterly.periods.length > 0;

  if (!hasCik || !hasAnyData) {
    return (
      <div
        data-testid="financials-tab"
        className="rounded-md border border-border-subtle bg-cream-hi p-6"
      >
        <p data-testid="financials-empty-state" className="text-sm text-text-muted">
          {hasCik
            ? "Financials not available. No validated XBRL facts for this company yet."
            : "Financials not available. This company is private, pre-IPO, or not an SEC filer."}
        </p>
      </div>
    );
  }

  const renderRow = (row: RowDef) => {
    if (!rowVisible(row)) return null;
    const cells = cellsFor(row.key);
    const src = sourceUrl(row);
    return (
      <tr
        key={row.key}
        data-testid="financials-row"
        className="border-b border-border-subtle last:border-b-0"
      >
        <td
          className={[
            "px-3 py-2 text-[13px]",
            row.sub ? "pl-6 text-text-muted" : "text-text-primary",
            row.strong ? "font-semibold" : "",
          ].join(" ")}
        >
          {row.label}
        </td>
        {periods.map((p) => (
          <td
            key={p.key}
            className={[
              "px-3 py-2 text-right font-sans text-[12px] tabular-nums",
              row.strong ? "font-semibold text-text-primary" : "text-text-secondary",
            ].join(" ")}
          >
            <ValueCell cell={cells?.[p.key]} fmt={row.fmt} />
          </td>
        ))}
        <td className="px-3 py-2 text-right">
          {src ? (
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] font-medium text-gold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-sm"
            >
              View
            </a>
          ) : (
            <span className="text-[12px] text-text-muted">n/a</span>
          )}
        </td>
      </tr>
    );
  };

  const sectionHeader = (label: string) => (
    <tr key={`section-${label}`} className="bg-[var(--row-alt)]">
      <td colSpan={periods.length + 2} className={SECTION_TH}>
        {label}
      </td>
    </tr>
  );

  return (
    <div data-testid="financials-tab">
      <div className="mb-2 flex items-center justify-end gap-1">
        {(["annual", "quarterly"] as const).map((m) => {
          const isActive = mode === m;
          return (
            <button
              key={m}
              type="button"
              data-testid={`financials-toggle-${m}`}
              aria-pressed={isActive}
              onClick={() => setMode(m)}
              className={[
                "px-[11px] py-[5px] rounded-[5px] border text-[12px] font-sans",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-1",
                isActive
                  ? "border-gold-border bg-cream-hi font-semibold text-espresso shadow-[inset_0_-2px_0_0_var(--gold)]"
                  : "border-border-base bg-transparent font-medium text-text-secondary hover:bg-cream-hi hover:border-border-hi",
              ].join(" ")}
            >
              {m === "annual" ? "Annual" : "Quarterly"}
            </button>
          );
        })}
      </div>
      <div className="overflow-x-auto rounded-md border border-border-subtle bg-cream-hi">
        <table
          data-testid="financials-table"
          className="w-full border-collapse text-left text-sm min-w-[640px]"
        >
          <thead>
            <tr className="border-b border-border-subtle bg-[var(--row-alt)]">
              <th className={`${TH} min-w-[180px]`}>Metric</th>
              {periods.map((p) => (
                <th key={p.key} className={`${TH} w-[110px] text-right`}>
                  {p.label}
                </th>
              ))}
              <th className={`${TH} w-[64px] text-right`}>Src</th>
            </tr>
          </thead>
          <tbody>
            {sectionHeader("Income statement")}
            {INCOME_ROWS.map(renderRow)}
            {sectionHeader("Balance sheet")}
            {balanceRows.map(renderRow)}
            {renderRow({ key: "operating_cash_flow", label: "Operating cash flow", fmt: "usd" })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-text-muted">
        Validated XBRL facts from SEC filings. Missing cells were not reported
        or did not pass validation. In the quarterly view, fiscal year-end
        columns (FY labels) carry the year-end balance sheet; income lines
        dash there because full-year figures live in the Annual view.
      </p>
    </div>
  );
}
