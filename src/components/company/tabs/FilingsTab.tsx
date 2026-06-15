"use client";

/**
 * FilingsTab (F6) -- SEC filings for the company, read-only.
 *
 * Data comes from fetchCompanyFilings (src/lib/sec-filings.ts), resolved
 * server-side in the page and passed in as a serializable list. Rows are
 * newest-first (filing_date desc). Two states beyond the populated table:
 *  - empty: the company has no mapped CIK (private / pre-IPO / not in EDGAR
 *    coverage) or simply no filings -- the common case, since only the
 *    watchlist CIKs have rows.
 *  - summary-pending: a filing row whose summary is still null (a fresh cron
 *    row that has not been summarized yet) renders the row with a muted
 *    placeholder instead of summary text.
 *
 * Styling mirrors ArticlesTable / the ArticlesTab empty card; no new tokens.
 */

import { useMemo } from "react";

import { edgarFilingsUrl, type CompanyFiling } from "@/lib/sec-filings";
import { filingsEmptyCopy } from "./empty-state-copy";

export interface FilingsTabProps {
  filings: CompanyFiling[];
  /** True when the company resolved to a SEC CIK. */
  hasCik: boolean;
  /** The resolved SEC CIK, or null for private / pre-IPO / unmapped names. */
  cik: number | null;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Deterministic date format (no locale) so server and client render identically.
function formatFilingDate(iso: string | null): string {
  if (!iso) return "n/a";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const idx = parseInt(mo, 10) - 1;
  if (idx < 0 || idx > 11) return iso;
  return `${MONTHS[idx]} ${parseInt(d, 10)}, ${y}`;
}

function ms(value: string | null): number {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

const TH = "px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted";

export function FilingsTab({ filings, hasCik, cik }: FilingsTabProps) {
  const sorted = useMemo(
    () => [...filings].sort((a, b) => ms(b.filingDate) - ms(a.filingDate)),
    [filings],
  );

  if (!hasCik || sorted.length === 0) {
    return (
      <div
        data-testid="filings-tab"
        className="rounded-md border border-border-subtle bg-cream-hi p-6"
      >
        <p data-testid="filings-empty-state" className="text-sm text-text-muted">
          {filingsEmptyCopy(hasCik)}
        </p>
        {/* EDGAR deep link only for public filers (hasCik). Never shown in the
            private / pre-IPO branch, where no CIK exists. */}
        {hasCik && cik != null && (
          <a
            data-testid="filings-edgar-link"
            href={edgarFilingsUrl(cik)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-[12px] font-medium text-gold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-sm"
          >
            View all filings on SEC EDGAR
          </a>
        )}
      </div>
    );
  }

  return (
    <div data-testid="filings-tab">
      <div className="overflow-x-auto rounded-md border border-border-subtle bg-cream-hi">
        <table
          data-testid="filings-table"
          className="w-full table-fixed border-collapse text-left text-sm min-w-[640px]"
        >
          <thead>
            <tr className="border-b border-border-subtle bg-[var(--row-alt)]">
              <th className={`${TH} w-[92px]`}>Form</th>
              <th className={`${TH} w-[116px]`}>Filed</th>
              <th className={`${TH} min-w-[280px]`}>Summary</th>
              <th className={`${TH} w-[72px] text-right`}>Doc</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((f) => {
              const hasSummary = !!f.summary && f.summary.trim().length > 0;
              return (
                <tr
                  key={f.accessionNumber}
                  data-testid="filings-row"
                  className="border-b border-border-subtle last:border-b-0 align-top"
                >
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center rounded border border-border-base bg-cream px-1.5 py-0.5 text-[11px] font-semibold text-espresso">
                      {f.formType ?? "n/a"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-sans text-[12px] tabular-nums text-text-secondary">
                    {formatFilingDate(f.filingDate)}
                  </td>
                  <td className="px-3 py-2.5">
                    {hasSummary ? (
                      <p className="text-[13px] leading-snug text-text-primary">{f.summary}</p>
                    ) : (
                      <p
                        data-testid="filings-summary-pending"
                        className="text-[13px] italic text-text-muted"
                      >
                        Summary pending
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {f.documentUrl ? (
                      <a
                        href={f.documentUrl}
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
    </div>
  );
}
