"use client";

/**
 * PrimerTab (Coverage Primer)
 *
 * The Coverage Primer replaces the per-company brief tab in place: a scannable
 * interview-prep sheet assembled from existing data. Sections, top to bottom:
 *   1. Snapshot            -- company, ticker, sector, industry (factual)
 *   2. Business overview   -- live provider profile summary or curated descriptor
 *   3. Key stats           -- valuation digest from the on-view quote feed
 *   4. Financial snapshot  -- latest annual XBRL digest + computed margins
 *   5. Recent developments -- the existing BriefTab, embedded UNCHANGED, which
 *      carries the informational-only brief (#389 voice guard on the /api/memo
 *      path it owns; this component does not touch that path).
 *
 * Valuation and live profile are fetched on view from /api/company-kpis (the
 * same Yahoo v10 feed the KPI strip uses) so the page render never blocks on
 * Yahoo. Curated COMPANY_IDENTITY (industry, description) is the immediate,
 * always-available fallback; live data overlays it when it arrives.
 *
 * Factual scaffolding only: no buy/sell/hold/overweight/exposure/allocation
 * language. Every section degrades to a neutral empty state (or hides, for the
 * business overview) so the Primer never looks broken. The brief always renders.
 */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { CompanyFinancialsResult } from "@/lib/financial-facts";
import type { QuoteSummaryLive } from "@/lib/yahoo/quoteSummary";
import { PrimerSnapshot } from "./primer/PrimerSnapshot";
import { PrimerBusinessOverview } from "./primer/PrimerBusinessOverview";
import { PrimerKeyStats } from "./primer/PrimerKeyStats";
import { PrimerFinancialSnapshot } from "./primer/PrimerFinancialSnapshot";

interface PrimerTabProps {
  companyName: string;
  ticker: string | null;
  sector: string | null;
  /** Curated industry from COMPANY_IDENTITY, or null. Fallback for live profile. */
  industry: string | null;
  /** Curated description from COMPANY_IDENTITY.brief, or null. Fallback for live. */
  description: string | null;
  financials: CompanyFinancialsResult;
  /** The existing BriefTab element, embedded as Recent developments unchanged. */
  briefSlot: ReactNode;
}

/** Trim a long provider summary to a clean one-to-two-sentence overview. */
function trimSummary(text: string): string {
  const clean = text.trim();
  if (clean.length <= 280) return clean;
  // Prefer a sentence boundary within the cap; else hard-cap with an ellipsis.
  const slice = clean.slice(0, 280);
  const lastStop = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  if (lastStop > 120) return slice.slice(0, lastStop + 1);
  return slice.replace(/\s+\S*$/, "") + "...";
}

export function PrimerTab({
  companyName,
  ticker,
  sector,
  industry,
  description,
  financials,
  briefSlot,
}: PrimerTabProps) {
  const [quote, setQuote] = useState<QuoteSummaryLive | null>(null);
  const [loading, setLoading] = useState<boolean>(!!ticker);
  // Normalized, Gemini-cleaned overview (write-through cached server-side). Null
  // until it resolves; the raw/curated fallback shows in the meantime.
  const [normalized, setNormalized] = useState<string | null>(null);

  useEffect(() => {
    if (!ticker) {
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    (async () => {
      try {
        const r = await fetch(`/api/company-kpis?ticker=${encodeURIComponent(ticker)}`, {
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        if (!r.ok) {
          setQuote(null);
          return;
        }
        const body = (await r.json()) as { kind?: string } & Partial<QuoteSummaryLive>;
        if (ctrl.signal.aborted) return;
        setQuote(body.kind === "live" ? (body as QuoteSummaryLive) : null);
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
        setQuote(null);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [ticker]);

  // Live profile overlays the curated fallback; null only when neither exists.
  const resolvedIndustry = quote?.industry ?? industry ?? null;

  // Normalize the overview once we have a source (live provider summary, else
  // curated description). The route reads its write-through cache, generates on
  // miss, and returns a clean grounded overview. Falls back silently; the raw
  // text still shows until (and if) the normalized version arrives.
  const sourceSummary = quote?.businessSummary ?? description ?? null;
  useEffect(() => {
    setNormalized(null);
    if (!sourceSummary) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch("/api/company-overview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            company: companyName,
            ticker,
            sector,
            industry: resolvedIndustry,
            summary: sourceSummary,
          }),
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted || !r.ok) return;
        const body = (await r.json()) as { overview?: string };
        if (ctrl.signal.aborted) return;
        if (body.overview && body.overview.trim()) setNormalized(body.overview.trim());
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
        // Non-fatal: keep the raw/curated fallback.
      }
    })();
    return () => ctrl.abort();
  }, [companyName, ticker, sector, resolvedIndustry, sourceSummary]);

  // Resolution order: normalized (grounded, cached) -> trimmed raw provider
  // summary -> curated description -> hide the section entirely.
  const fallbackDescription = quote?.businessSummary
    ? trimSummary(quote.businessSummary)
    : description ?? null;
  const resolvedDescription = normalized ?? fallbackDescription;

  return (
    <div data-testid="primer-tab" className="space-y-4">
      <PrimerSnapshot
        companyName={companyName}
        ticker={ticker}
        sector={sector}
        industry={resolvedIndustry}
      />

      {/* Business overview: hidden entirely when neither live nor curated text. */}
      {resolvedDescription ? <PrimerBusinessOverview description={resolvedDescription} /> : null}

      <PrimerKeyStats quote={quote} loading={loading} />
      <PrimerFinancialSnapshot financials={financials} />

      {/* Recent developments: the existing brief, embedded unchanged. */}
      <section data-testid="primer-recent-developments" className="space-y-2">
        <h3 className="font-sans text-[9.5px] font-bold text-text-faint">
          Recent developments
        </h3>
        {briefSlot}
      </section>
    </div>
  );
}
