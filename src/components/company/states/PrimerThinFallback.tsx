"use client";

/**
 * PrimerThinFallback -- shown in place of a web-memo when the thin-pool gate
 * trips (too few on-entity news sources). Rather than narrate a thesis on a
 * starved pool, it surfaces the richest available PRIMARY-SOURCE data and
 * degrades by data presence:
 *   Tier A: financial snapshot (PrimerFinancialSnapshot) + recent SEC filings.
 *   Tier B: recent SEC filings only.
 *   Tier C: honest "no coverage and no SEC data yet" suppress state.
 *
 * Everything is rendered from STRUCTURED DATA returned by
 * /api/companies/thin-fallback. The model narrates nothing here: no filing
 * interpretation, no "results were strong", no directional or valuation
 * language. Filing rows show date + form-type + document link only (the
 * model-written sec_filings.summary is never requested or shown). Gated by the
 * caller behind NEXT_PUBLIC_THIN_FALLBACK_ENABLED.
 */

import { FileText, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { PrimerFinancialSnapshot } from "@/components/company/tabs/primer/PrimerFinancialSnapshot";
import type { CompanyFinancialsResult } from "@/lib/financial-facts";
import { edgarFilingsUrl } from "@/lib/sec-filings";
import type { ThinFallbackFiling, ThinFallbackTier } from "@/lib/thin-fallback";

interface ThinFallbackResponse {
  tier: ThinFallbackTier;
  cik: number | null;
  hasCik: boolean;
  name: string | null;
  financials: CompanyFinancialsResult;
  filings: ThinFallbackFiling[];
}

interface Props {
  company: string;
  ticker?: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Deterministic, locale-free date format (mirrors FilingsTab) so nothing
// hydration-diffs and no narration is introduced.
function formatFilingDate(iso: string | null): string {
  if (!iso) return "n/a";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const idx = parseInt(mo, 10) - 1;
  if (idx < 0 || idx > 11) return iso;
  return `${MONTHS[idx]} ${parseInt(d, 10)}, ${y}`;
}

const DISCLAIMER =
  "Primary-source data shown as filed with the SEC. Informational only, not investment advice.";

function FilingsList({ filings }: { filings: ThinFallbackFiling[] }) {
  return (
    <section
      data-testid="thin-fallback-filings"
      className="bg-cream-hi border border-border-base rounded-lg p-4 space-y-3"
    >
      <h3 className="font-mono text-[9.5px] font-bold uppercase tracking-[0.10em] text-text-faint">
        Recent SEC filings
      </h3>
      <ul className="divide-y divide-border-base/60">
        {filings.map((f) => (
          <li
            key={f.accessionNumber}
            data-testid="thin-fallback-filing-row"
            className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="inline-flex flex-shrink-0 items-center rounded border border-border-base bg-cream px-1.5 py-0.5 text-[11px] font-semibold text-espresso">
                {f.formType ?? "n/a"}
              </span>
              <span className="font-sans text-[12px] tabular-nums text-text-secondary">
                {formatFilingDate(f.filingDate)}
              </span>
            </div>
            {f.documentUrl ? (
              <a
                href={f.documentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 text-[12px] font-medium text-gold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-sm"
              >
                View
              </a>
            ) : (
              <span className="flex-shrink-0 text-[12px] text-text-muted">n/a</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PrimerThinFallback({ company, ticker }: Props) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ThinFallbackResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/companies/thin-fallback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: company, ...(ticker ? { ticker } : {}) }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Fallback failed (${res.status})`);
        }
        const json = (await res.json()) as ThinFallbackResponse;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Fallback failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [company, ticker]);

  if (loading) {
    return (
      <div
        data-testid="thin-fallback-loading"
        className="flex items-center gap-2 rounded-lg border border-border-base bg-cream-hi px-4 py-4 text-text-muted"
      >
        <Loader2 size={14} className="animate-spin" />
        <span className="font-sans text-[12px]">Loading primary-source data for {company}...</span>
      </div>
    );
  }

  // On error, degrade to the same honest suppress copy rather than a broken box.
  const tier: ThinFallbackTier = error || !data ? "C" : data.tier;

  return (
    <div data-testid="thin-fallback" data-tier={tier} className="space-y-3">
      <div className="flex items-start gap-2.5">
        <FileText size={15} className="mt-0.5 flex-shrink-0" style={{ color: "var(--gold)" }} />
        <p className="font-sans text-[12px] text-text-secondary leading-relaxed">
          Not enough recent news coverage for a reliable brief on {company}.
          {tier !== "C" ? " Showing the latest primary-source data instead." : ""}
        </p>
      </div>

      {tier === "A" && data ? (
        <>
          <PrimerFinancialSnapshot financials={data.financials} />
          {data.filings.length > 0 ? <FilingsList filings={data.filings} /> : null}
        </>
      ) : null}

      {tier === "B" && data ? <FilingsList filings={data.filings} /> : null}

      {tier === "C" ? (
        <div
          data-testid="thin-fallback-suppress"
          className="rounded-lg border border-border-base bg-cream-hi p-4"
        >
          <p className="font-sans text-[13px] text-text-secondary leading-relaxed">
            No recent news coverage and no SEC data available for this company yet.
          </p>
          {data?.hasCik && data.cik != null ? (
            <a
              href={edgarFilingsUrl(data.cik)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-[12px] font-medium text-gold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-sm"
            >
              Check SEC EDGAR for future filings
            </a>
          ) : null}
        </div>
      ) : null}

      <p data-testid="thin-fallback-disclaimer" className="font-sans text-[10.5px] italic text-text-faint">
        {DISCLAIMER}
      </p>
    </div>
  );
}
