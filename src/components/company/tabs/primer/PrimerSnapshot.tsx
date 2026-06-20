"use client";

/**
 * PrimerSnapshot (Coverage Primer PR1)
 *
 * Factual identity scaffolding: ticker, sector, industry, and a one-line
 * descriptor. Informational only, no directional or allocation language.
 * Graceful for sparse companies: a private/pre-IPO name shows "Private" for the
 * ticker, and missing sector/industry fall back to a neutral em-dash rather
 * than rendering blank.
 */

interface PrimerSnapshotProps {
  companyName: string;
  ticker: string | null;
  sector: string | null;
  /** Curated industry label from COMPANY_IDENTITY, or null when uncurated. */
  industry: string | null;
}

const DASH = "—";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-text-faint">
        {label}
      </span>
      <span className="font-sans text-[13px] text-espresso font-semibold">{value}</span>
    </div>
  );
}

export function PrimerSnapshot({ companyName, ticker, sector, industry }: PrimerSnapshotProps) {
  return (
    <section
      data-testid="primer-snapshot"
      className="bg-cream-hi border border-border-base rounded-lg p-4 space-y-3"
    >
      <h3 className="font-mono text-[9.5px] font-bold uppercase tracking-[0.10em] text-text-faint">
        Snapshot
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label="Company" value={companyName} />
        <Field label="Ticker" value={ticker || "Private"} />
        <Field label="Sector" value={sector || DASH} />
        <Field label="Industry" value={industry || DASH} />
      </div>
    </section>
  );
}
