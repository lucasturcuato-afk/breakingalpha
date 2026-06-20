"use client";

/**
 * PrimerTab (Coverage Primer PR1)
 *
 * The Coverage Primer replaces the per-company brief tab in place: a scannable
 * interview-prep sheet assembled from existing data. Sections, top to bottom:
 *   1. Snapshot            -- ticker, sector, industry, identity (factual)
 *   2. Business overview   -- curated one-line descriptor (COMPANY_IDENTITY)
 *   3. Financial snapshot  -- latest annual XBRL digest (fetchCompanyFinancials)
 *   4. Recent developments -- the existing BriefTab, embedded UNCHANGED, which
 *      carries the informational-only brief (the #389 voice guard applies on the
 *      /api/memo path it owns; this component does not touch that path).
 *
 * Factual scaffolding only: no buy/sell/hold/overweight/exposure/allocation
 * language anywhere. Every section degrades to a neutral empty state for a
 * sparse company, so the Primer never looks broken. The brief always renders.
 */

import type { ReactNode } from "react";

import type { CompanyFinancialsResult } from "@/lib/financial-facts";
import { PrimerSnapshot } from "./primer/PrimerSnapshot";
import { PrimerBusinessOverview } from "./primer/PrimerBusinessOverview";
import { PrimerFinancialSnapshot } from "./primer/PrimerFinancialSnapshot";

interface PrimerTabProps {
  companyName: string;
  ticker: string | null;
  sector: string | null;
  /** Curated industry label from COMPANY_IDENTITY, or null when uncurated. */
  industry: string | null;
  /** Curated one-line description from COMPANY_IDENTITY.brief, or null. */
  description: string | null;
  financials: CompanyFinancialsResult;
  /** The existing BriefTab element, embedded as Recent developments unchanged. */
  briefSlot: ReactNode;
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
  return (
    <div data-testid="primer-tab" className="space-y-4">
      <PrimerSnapshot
        companyName={companyName}
        ticker={ticker}
        sector={sector}
        industry={industry}
      />
      <PrimerBusinessOverview description={description} />
      <PrimerFinancialSnapshot financials={financials} />

      {/* Recent developments: the existing brief, embedded unchanged. */}
      <section data-testid="primer-recent-developments" className="space-y-2">
        <h3 className="font-mono text-[9.5px] font-bold uppercase tracking-[0.10em] text-text-faint">
          Recent developments
        </h3>
        {briefSlot}
      </section>
    </div>
  );
}
