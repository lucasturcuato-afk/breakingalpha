"use client";

/**
 * InsiderTab (F8) -- Form 4 insider transactions, read-only.
 *
 * Data comes from getInsiderTransactions, resolved server-side in the page and
 * passed in as a serializable list. Rows are grouped OPEN MARKET first, then
 * ROUTINE COMPENSATION, because an RSU vest and a purchase are different events
 * and a single undifferentiated table makes payroll look like conviction.
 *
 * COMPLIANCE. Structured facts only: who, when, which SEC code, how many shares,
 * at what price, holdings after. No signal language, no aggregate "insiders are
 * buying", no interpretation of intent. The reader draws the conclusion.
 *
 * COVERAGE CAVEAT, stated in the UI rather than hidden: the ingest parser keeps
 * only codes P and S, and keeps a sale only when it clears $1M or the filer is
 * C-suite (backend/edgar/forms/form_4.py). So this tab shows a filtered subset of
 * Section 16 activity, not the complete record. Claiming completeness would be
 * the actual compliance problem.
 */

import { useMemo } from "react";

import {
  describeCode,
  groupByCategory,
  sortNewestFirst,
  formatDate,
  formatShares,
  formatPrice,
  formatValue,
  formatRole,
  type InsiderTransaction,
} from "@/lib/insider-transactions";

export interface InsiderTabProps {
  transactions: InsiderTransaction[];
  /** True when the company resolved to a SEC CIK. */
  hasCik: boolean;
}

const TH = "px-3 py-2 text-[10px] font-semibold text-text-muted";

function TransactionTable({
  rows,
  testId,
}: {
  rows: InsiderTransaction[];
  testId: string;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border-subtle bg-cream-hi">
      <table
        data-testid={testId}
        className="w-full border-collapse text-left text-sm min-w-[860px]"
      >
        <thead>
          <tr className="border-b border-border-subtle bg-[var(--row-alt)]">
            <th className={`${TH} w-[116px]`}>Transaction date</th>
            <th className={`${TH} min-w-[180px]`}>Insider</th>
            <th className={`${TH} w-[140px]`}>Role</th>
            <th className={`${TH} w-[168px]`}>Type</th>
            <th className={`${TH} w-[96px] text-right`}>Shares</th>
            <th className={`${TH} w-[88px] text-right`}>Price</th>
            <th className={`${TH} w-[96px] text-right`}>Value</th>
            <th className={`${TH} w-[104px] text-right`}>Held after</th>
            <th className={`${TH} w-[64px] text-right`}>Doc</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const meaning = describeCode(t.transactionCode);
            return (
              <tr
                key={t.id}
                data-testid="insider-row"
                className="border-b border-border-subtle last:border-b-0 align-top"
              >
                <td className="px-3 py-2.5 font-sans text-[12px] tabular-nums text-text-secondary">
                  {formatDate(t.transactionDate)}
                </td>
                <td className="px-3 py-2.5 text-[13px] text-text-primary">
                  {t.insiderName ?? "Not stated"}
                </td>
                <td className="px-3 py-2.5 text-[12px] text-text-secondary">
                  {formatRole(t.insiderTitle)}
                </td>
                <td className="px-3 py-2.5">
                  <span className="inline-flex items-center rounded border border-border-base bg-cream px-1.5 py-0.5 text-[11px] font-medium text-espresso">
                    {meaning.label}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right font-sans text-[12px] tabular-nums text-text-primary">
                  {formatShares(t.shares)}
                </td>
                <td className="px-3 py-2.5 text-right font-sans text-[12px] tabular-nums text-text-secondary">
                  {formatPrice(t.pricePerShare)}
                </td>
                <td className="px-3 py-2.5 text-right font-sans text-[12px] tabular-nums text-text-primary">
                  {formatValue(t.totalValue)}
                </td>
                <td className="px-3 py-2.5 text-right font-sans text-[12px] tabular-nums text-text-secondary">
                  {formatShares(t.sharesOwnedAfter)}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {t.documentUrl ? (
                    <a
                      href={t.documentUrl}
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
          })}
        </tbody>
      </table>
    </div>
  );
}

function SectionHeading({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
        {title}
      </h3>
      <p className="text-[11px] text-text-muted">{note}</p>
    </div>
  );
}

export function InsiderTab({ transactions, hasCik }: InsiderTabProps) {
  const groups = useMemo(
    () => groupByCategory(sortNewestFirst(transactions)),
    [transactions],
  );

  if (!hasCik || transactions.length === 0) {
    return (
      <div
        data-testid="insider-tab"
        className="rounded-md border border-border-subtle bg-cream-hi p-6"
      >
        <p data-testid="insider-empty-state" className="text-sm text-text-muted">
          {hasCik
            ? "No insider transactions recorded for this company."
            : "No SEC identity for this company, so no Section 16 filings are tracked."}
        </p>
      </div>
    );
  }

  return (
    <div data-testid="insider-tab" className="space-y-6">
      {groups.openMarket.length > 0 && (
        <section data-testid="insider-open-market">
          <SectionHeading
            title={`Open market (${groups.openMarket.length})`}
            note="Purchases and sales transacted on the open market, SEC codes P and S."
          />
          <TransactionTable rows={groups.openMarket} testId="insider-open-market-table" />
        </section>
      )}

      {groups.routine.length > 0 && (
        <section data-testid="insider-routine">
          <SectionHeading
            title={`Routine compensation (${groups.routine.length})`}
            note="Grants, option exercises, and shares withheld for taxes, SEC codes A, M and F. Not open-market activity."
          />
          <TransactionTable rows={groups.routine} testId="insider-routine-table" />
        </section>
      )}

      {groups.other.length > 0 && (
        <section data-testid="insider-other">
          <SectionHeading
            title={`Other (${groups.other.length})`}
            note="Gifts, conversions, and codes outside the categories above."
          />
          <TransactionTable rows={groups.other} testId="insider-other-table" />
        </section>
      )}

      <p data-testid="insider-coverage-note" className="text-[11px] text-text-muted">
        Source: SEC Form 4 filings. Coverage is partial: the ingest records
        open-market purchases and sales, and records a sale only when it exceeds
        $1,000,000 or the filer is an executive officer. Absence of a row is not
        evidence that no transaction occurred.
      </p>
    </div>
  );
}
