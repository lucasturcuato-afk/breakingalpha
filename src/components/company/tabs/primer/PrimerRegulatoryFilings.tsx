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
 *   IT NEVER PRINTS ONE NAME WHEN THE ROW HAS TWO. An ADV row files a business
 *   name and a legal name and they are frequently different entities; a 13F row
 *   has a current filer name and the former name that may have won the link.
 *   Printing one and dropping the other reinstates the bare number under a
 *   label the reader has no reason to doubt, so when the two names differ
 *   substantively BOTH are printed and the difference is named in words.
 *   Measured on the 4,276-row companies table: 80 of the 380 pages that render
 *   a RAUM figure sit on a row whose two names are substantively different.
 *
 *   IT NEVER SHOWS AN UNDATED FIGURE. RAUM is an annual self-report, so the
 *   as-of month is printed once, above the whole figure grid, where it governs
 *   the discretionary and account figures too. It used to sit inside the total's
 *   own label, which left the discretionary dollars beside it undated.
 *
 *   IT NEVER HIDES HOW THE LINK WAS MADE. Every tier gets a provenance line,
 *   not just the affiliate-shaped one, because "we matched this by name" is a
 *   fact about the figure and a reader who is shown no tier assumes there was
 *   no matching involved.
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
  nameRelation,
  type AdviserRegistration,
  type InstitutionalManager,
  type RegistryMatchTier,
} from "@/lib/adviser-registry";

interface PrimerRegulatoryFilingsProps {
  /** Present only when the figure is positive, dated and not a slice. */
  adviser: AdviserRegistration | null;
  /** Present only when the filer is current AND attributable. */
  manager: InstitutionalManager | null;
}

/**
 * How the link was made, in words, for EVERY tier.
 *
 * `prefix` means the registry name merely STARTS WITH the company name, which
 * is the shape every affiliate hit takes, so it keeps the explicit warning.
 * `exact` and `core` matched the whole name and get a plain statement of that
 * rather than silence, because silence reads as "no matching was involved".
 */
function tierNote(tier: RegistryMatchTier | null): string | null {
  if (tier === "prefix") {
    return "Linked to this company by a name that begins with the company's. It may be a subsidiary rather than the group.";
  }
  if (tier === "core") {
    return "Linked to this company by name, after setting aside legal-entity suffixes.";
  }
  if (tier === "exact") {
    return "Linked to this company by an exact name match.";
  }
  return null;
}

/**
 * The second name on the row, in words, when it is not the same entity.
 *
 * `unit` and `other` are different facts and get different sentences. Saying
 * "differs" for both would leave the reader to guess whether the figure belongs
 * to a piece of the firm or to a differently-named whole.
 */
function secondNameNote(shown: string, other: string | null, kind: "legal" | "filing"): string | null {
  const relation = nameRelation(shown, other);
  if (relation === "single" || relation === "same") return null;
  if (kind === "legal") {
    return relation === "unit"
      ? "The registered legal name names a narrower entity than the business name, so this book may be one unit of the group rather than all of it."
      : "The registered legal name is a different name from the business name it files under. The figure is that legal entity's.";
  }
  return "The company was linked to this filer under a name the filer has since changed.";
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

  const adviserSecondName = adviser
    ? secondNameNote(adviser.businessName, adviser.legalName, "legal")
    : null;
  const managerSecondName = manager
    ? secondNameNote(manager.filerName, manager.matchedName, "filing")
    : null;

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
            <span className="font-semibold text-text-secondary">{adviser.businessName}</span>
            {" (CRD "}
            {adviser.crd}
            {")"}
          </p>
          {adviserSecondName ? (
            <p data-testid="primer-raum-legal-name" className="font-sans text-[10px] text-text-faint">
              Registered legal name:{" "}
              <span className="font-semibold text-text-secondary">{adviser.legalName}</span>
            </p>
          ) : null}
          <p className="font-sans text-[9px] text-text-faint">As of {asOf}.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Figure label="Reg. AUM" value={formatRaum(raum)} />
            {discretionary !== null && discretionary > 0 ? (
              <Figure label="Discretionary" value={formatRaum(discretionary)} />
            ) : null}
            {accounts !== null && accounts > 0 ? (
              <Figure label="Accounts" value={accounts.toLocaleString("en-US")} />
            ) : null}
          </div>
          {adviserSecondName ? (
            <p className="font-sans text-[10px] text-text-faint leading-relaxed">
              {adviserSecondName}
            </p>
          ) : null}
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
          {managerSecondName ? (
            <p data-testid="primer-13f-matched-name" className="font-sans text-[10px] text-text-faint">
              Linked under:{" "}
              <span className="font-semibold text-text-secondary">{manager.matchedName}</span>
            </p>
          ) : null}
          <p className="font-sans text-[13px] text-text-secondary leading-relaxed">
            Reports institutional holdings quarterly, most recently {lastFiled}. A 13F-HR filer
            has discretion over at least $100M of exchange-listed securities. Position detail is
            not shown here.
          </p>
          {managerSecondName ? (
            <p className="font-sans text-[10px] text-text-faint leading-relaxed">
              {managerSecondName}
            </p>
          ) : null}
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
