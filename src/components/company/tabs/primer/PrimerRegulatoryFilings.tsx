"use client";

/**
 * PrimerRegulatoryFilings (Coverage Primer)
 *
 * What a private financial firm discloses about itself, from the two SEC
 * public-domain registries: Form ADV Part 1 Item 5.F(2)(c) Regulatory Assets
 * Under Management, and Form 13F-HR filer status.
 *
 * This is the ONLY numeric section most of these names will ever have. They do
 * not file 10-Ks, so PrimerFinancialSnapshot is empty for all of them.
 *
 * WHAT IT REFUSES TO DO, and each of these is load-bearing:
 *
 *   IT NEVER SHOWS A BARE NUMBER. The entity that filed the figure is printed
 *   above it, always. The company -> registry link is a name match, and on
 *   financial firms a name match lands on affiliates: the row on the "BNP
 *   Paribas" page is BNP PARIBAS ASSET MANAGEMENT USA, INC. and its $48.4B is
 *   that subsidiary's book, not the group's. A reader who can see the filed
 *   name can tell those apart; a reader shown "$48.4B" cannot.
 *
 *   IT NEVER SHOWS AN UNDATED FIGURE. RAUM is an annual self-report, so the
 *   as-of month sits beside the number rather than in a tooltip.
 *
 *   IT NEVER IMPLIES 13F IS A PORTFOLIO. The flag says the manager reported
 *   $100M+ of section 13(f) securities on that date. It is one bit plus a date,
 *   and the copy says exactly that. No holdings are read or stored.
 *
 *   IT NEVER RENDERS EMPTY. The parent mounts it only when there is something
 *   to show, so there is no placeholder branch to get wrong.
 */

import {
  formatRaum,
  formatReportedAt,
  type AdviserRegistration,
  type InstitutionalManager,
  type RegistryMatchTier,
} from "@/lib/adviser-registry";

interface PrimerRegulatoryFilingsProps {
  /** Present only when the figure is positive and dated. */
  adviser: AdviserRegistration | null;
  /** Present only when the filer is still current. */
  manager: InstitutionalManager | null;
}

/**
 * The affiliate warning. `prefix` means the filed name merely STARTS WITH the
 * company name, which is the shape every affiliate hit takes, so that tier and
 * only that tier gets a caveat. `exact` and `core` matched the whole name.
 */
function tierNote(tier: RegistryMatchTier | null): string | null {
  return tier === "prefix"
    ? "Filed by an entity whose name begins with this company's. It may be a subsidiary rather than the group."
    : null;
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-sans text-[9px] font-bold text-text-faint">{label}</span>
      <span className="font-data text-[13px] text-espresso font-semibold">{value}</span>
    </div>
  );
}

export function PrimerRegulatoryFilings({ adviser, manager }: PrimerRegulatoryFilingsProps) {
  const raum = adviser?.raumTotalUsd ?? null;
  const asOf = formatReportedAt(adviser?.reportedAt ?? null);
  const lastFiled = formatReportedAt(manager?.lastFilingDate ?? null);

  const discretionary = adviser?.raumDiscretionaryUsd ?? null;
  const accounts = adviser?.raumTotalAccounts ?? null;

  return (
    <section
      data-testid="primer-regulatory-filings"
      className="bg-cream-hi border border-border-base rounded-lg p-4 space-y-3"
    >
      <h3 className="font-sans text-[9.5px] font-bold text-text-faint">SEC registrations</h3>

      {adviser && raum !== null && asOf ? (
        <div data-testid="primer-raum" className="space-y-2">
          <p className="font-sans text-[10px] text-text-faint">
            Form ADV Part 1, filed by{" "}
            <span className="font-semibold text-text-secondary">{adviser.filedName}</span>
            {" (CRD "}
            {adviser.crd}
            {")"}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Figure label={`Reg. AUM (${asOf})`} value={formatRaum(raum)} />
            {discretionary !== null && discretionary > 0 ? (
              <Figure label="Discretionary" value={formatRaum(discretionary)} />
            ) : null}
            {accounts !== null && accounts > 0 ? (
              <Figure label="Accounts" value={accounts.toLocaleString("en-US")} />
            ) : null}
          </div>
          {tierNote(adviser.matchTier) ? (
            <p className="font-sans text-[10px] text-text-faint leading-relaxed">
              {tierNote(adviser.matchTier)}
            </p>
          ) : null}
        </div>
      ) : null}

      {manager && lastFiled ? (
        <div data-testid="primer-13f" className="space-y-1">
          <p className="font-sans text-[10px] text-text-faint">
            Form 13F-HR, filed by{" "}
            <span className="font-semibold text-text-secondary">{manager.filerName}</span>
            {" (CIK "}
            {manager.cik}
            {")"}
          </p>
          <p className="font-sans text-[13px] text-text-secondary leading-relaxed">
            Reports institutional holdings quarterly, most recently {lastFiled}. A 13F-HR filer
            has discretion over at least $100M of exchange-listed securities. Position detail is
            not shown here.
          </p>
          {tierNote(manager.matchTier) ? (
            <p className="font-sans text-[10px] text-text-faint leading-relaxed">
              {tierNote(manager.matchTier)}
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="font-sans text-[9px] text-text-faint">
        Source: SEC Investment Adviser registration and EDGAR. Public domain. Figures are
        self-reported by the filer.
      </p>
    </section>
  );
}
