"use client";

/**
 * PrimerBusinessOverview (Coverage Primer PR1)
 *
 * Renders the curated one-line business description from COMPANY_IDENTITY
 * verbatim (no model generation). Uncurated companies show a neutral factual
 * placeholder rather than a blank section, so the Primer never looks broken.
 * Informational only.
 */

interface PrimerBusinessOverviewProps {
  /** Curated profile description from COMPANY_IDENTITY.brief, or null. */
  description: string | null;
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
      {description ? (
        <p className="font-sans text-[13px] text-text-secondary leading-relaxed">{description}</p>
      ) : (
        <p
          data-testid="primer-business-overview-empty"
          className="font-sans text-[12px] text-text-faint italic leading-relaxed"
        >
          No curated business overview for this company yet. See Recent developments below for the
          latest article-sourced activity.
        </p>
      )}
    </section>
  );
}
