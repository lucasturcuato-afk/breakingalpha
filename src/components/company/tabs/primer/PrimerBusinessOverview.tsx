"use client";

/**
 * PrimerBusinessOverview (Coverage Primer)
 *
 * Renders a factual one-line business description: the live provider profile
 * summary (Yahoo assetProfile) when available, else the curated COMPANY_IDENTITY
 * description, both verbatim (no model generation). The parent only renders this
 * section when a description exists, so there is no placeholder branch: a company
 * with neither source hides the section entirely. Informational only.
 */

interface PrimerBusinessOverviewProps {
  /** Resolved description (live profile summary or curated). Always present. */
  description: string;
}

export function PrimerBusinessOverview({ description }: PrimerBusinessOverviewProps) {
  return (
    <section
      data-testid="primer-business-overview"
      className="bg-cream-hi border border-border-base rounded-lg p-4 space-y-2"
    >
      <h3 className="font-mono text-[9.5px] font-bold uppercase tracking-[0.10em] text-text-faint">
        Business overview
      </h3>
      <p className="font-sans text-[13px] text-text-secondary leading-relaxed">{description}</p>
    </section>
  );
}
