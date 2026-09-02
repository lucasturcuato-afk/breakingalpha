/**
 * Adviser-registry consumption helpers (read-only).
 *
 * Bridges a companies row to the two SEC registry tables the numbers pillar for
 * private financial firms now rests on:
 *
 *   adviser_registrations   Form ADV Part 1, keyed on CRD, carrying Item
 *                           5.F(2)(c) Regulatory Assets Under Management.
 *   institutional_managers  Form 13F filer identity, keyed on manager CIK,
 *                           carrying an EXISTENCE FLAG and no holdings.
 *
 * See supabase/migrations/20260902120000_adv_13f_numbers_pillar.sql and
 * backend/ingest_adviser_registry.py.
 *
 * FOUR RULES THIS FILE ENFORCES, each of which came out of measuring the real
 * roster rather than from the spec:
 *
 * 1. A RAUM OF ZERO IS NOT A FIGURE. 605 of the 16,876 roster rows report
 *    exactly 0.00 in Item 5.F(2)(c), including BofA Securities and Needham &
 *    Company: real registrants whose advisory book is nil. `$0` on a company
 *    page reads as a data bug, so a zero suppresses the figure entirely.
 *
 * 2. NEVER SHOW THE NUMBER WITHOUT ITS AS-OF DATE. RAUM is an ANNUAL
 *    self-report. A row with no `raum_reported_at` supplies no figure, because
 *    an undated dollar amount invites the reader to treat it as current.
 *
 * 3. NAME THE FILED ENTITY, ALWAYS. The link is a name match, and on financial
 *    firms a name match lands on affiliates: "BNP Paribas" reaches BNP PARIBAS
 *    ASSET MANAGEMENT USA (RAUM $48.4B, against a group balance sheet in the
 *    trillions), and "GE Vernova" reaches GE VERNOVA INVESTMENT ADVISERS. The
 *    figure is correct for the entity that filed it and wrong for the company
 *    the page is about, so the entity's own filed name travels with the figure
 *    and the read path never renders a bare number.
 *
 * 4. A STALE 13F IS NOT EVIDENCE OF SIZE. The flag means the manager reported
 *    $100M+ of section 13(f) securities; 13F is quarterly, so a filer whose
 *    last report predates the staleness window has dropped below the threshold
 *    or wound up. The backend applies the same cut; this is the read-side
 *    belt-and-braces so a hand-loaded row cannot bypass it.
 *
 * Consumption-side only: no writes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Match quality of the company -> registry link, stored by the ingest. */
export type RegistryMatchTier = "exact" | "core" | "prefix";

/** A 13F-HR older than this no longer describes the manager's size today. */
export const STALE_13F_DAYS = 550;

export interface AdviserRegistration {
  /** SEC/FINRA Organization CRD number. */
  crd: number;
  /** The entity's own filed name. Always shown beside the figure. */
  filedName: string;
  /** Item 5.F(2)(c), full dollars. Null when nil or undated (rules 1 and 2). */
  raumTotalUsd: number | null;
  raumDiscretionaryUsd: number | null;
  raumNonDiscretionaryUsd: number | null;
  raumTotalAccounts: number | null;
  /** ISO date of the adviser's latest ADV filing. Null only when unfiled. */
  reportedAt: string | null;
  matchTier: RegistryMatchTier | null;
  matchConfirmed: boolean;
}

export interface InstitutionalManager {
  /** The MANAGER's EDGAR CIK, not an issuer CIK. */
  cik: number;
  filerName: string;
  /** ISO date of the last 13F on file. */
  lastFilingDate: string | null;
  matchTier: RegistryMatchTier | null;
  matchConfirmed: boolean;
}

export interface RegistryProfile {
  adviser: AdviserRegistration | null;
  manager: InstitutionalManager | null;
  /**
   * TRUE when the read itself failed, which is NOT the same fact as "this
   * company is in neither registry". Kept separate for the same reason
   * financial-facts.ts keeps `readFailed`: collapsing the two makes the UI
   * assert something false about the company.
   */
  readFailed: boolean;
}

export const EMPTY_REGISTRY_PROFILE: RegistryProfile = {
  adviser: null,
  manager: null,
  readFailed: false,
};

const ADVISER_COLS =
  "crd, primary_business_name, legal_name, raum_total_usd, raum_discretionary_usd, " +
  "raum_non_discretionary_usd, raum_total_accounts, raum_reported_at, match_tier, match_confirmed";
const MANAGER_COLS = "cik, filer_name, files_13f_hr, last_filing_date, match_tier, match_confirmed";

interface AdviserRow {
  crd: number | string;
  primary_business_name: string | null;
  legal_name: string | null;
  raum_total_usd: number | string | null;
  raum_discretionary_usd: number | string | null;
  raum_non_discretionary_usd: number | string | null;
  raum_total_accounts: number | string | null;
  raum_reported_at: string | null;
  match_tier: string | null;
  match_confirmed: boolean | null;
}

interface ManagerRow {
  cik: number | string;
  filer_name: string | null;
  files_13f_hr: boolean | null;
  last_filing_date: string | null;
  match_tier: string | null;
  match_confirmed: boolean | null;
}

/** Postgres numerics arrive as strings over PostgREST. */
function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toTier(value: string | null): RegistryMatchTier | null {
  return value === "exact" || value === "core" || value === "prefix" ? value : null;
}

/**
 * Days between an ISO date and `now`. Returns null for an unparseable date, so
 * callers treat "no usable date" the same as "no date".
 */
export function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.floor((now.getTime() - then) / 86_400_000);
}

/** Rules 1 and 2: a figure exists only when it is positive AND dated. */
export function hasRaumFigure(adviser: AdviserRegistration | null): boolean {
  if (!adviser) return false;
  return adviser.raumTotalUsd !== null && adviser.raumTotalUsd > 0 && adviser.reportedAt !== null;
}

/** Rule 4: the flag counts only while the manager is still filing. */
export function is13FCurrent(
  manager: InstitutionalManager | null,
  now: Date,
  maxAgeDays: number = STALE_13F_DAYS,
): boolean {
  if (!manager) return false;
  const age = daysSince(manager.lastFilingDate, now);
  return age !== null && age <= maxAgeDays;
}

/**
 * TRUE when this profile supplies the NUMBERS pillar. Deliberately the same
 * predicate the backend measured with, so what the scorer counts and what the
 * page draws can never drift apart.
 */
export function suppliesNumbersPillar(profile: RegistryProfile, now: Date): boolean {
  return hasRaumFigure(profile.adviser) || is13FCurrent(profile.manager, now);
}

function mapAdviser(row: AdviserRow): AdviserRegistration {
  return {
    crd: toNumber(row.crd) ?? 0,
    filedName: (row.primary_business_name || row.legal_name || "").trim(),
    raumTotalUsd: toNumber(row.raum_total_usd),
    raumDiscretionaryUsd: toNumber(row.raum_discretionary_usd),
    raumNonDiscretionaryUsd: toNumber(row.raum_non_discretionary_usd),
    raumTotalAccounts: toNumber(row.raum_total_accounts),
    reportedAt: row.raum_reported_at,
    matchTier: toTier(row.match_tier),
    matchConfirmed: row.match_confirmed === true,
  };
}

function mapManager(row: ManagerRow): InstitutionalManager {
  return {
    cik: toNumber(row.cik) ?? 0,
    filerName: (row.filer_name || "").trim(),
    lastFilingDate: row.last_filing_date,
    matchTier: toTier(row.match_tier),
    matchConfirmed: row.match_confirmed === true,
  };
}

/**
 * Read both registry rows for one companies row.
 *
 * REJECT-SAFE. This runs inside the company page's Promise.all, where a single
 * rejection fails the whole page render rather than one section, so every path
 * is inside a try and the failure surfaces as `readFailed` instead of throwing.
 *
 * A company links to at most one row in each table (company_id is set by the
 * ingest's single best match), so `maybeSingle` is the right shape and a second
 * row would be a data defect rather than something to rank here.
 */
export async function fetchRegistryProfile(
  supabase: SupabaseClient,
  companyId: string | null,
): Promise<RegistryProfile> {
  if (!companyId) return EMPTY_REGISTRY_PROFILE;

  let adviser: AdviserRegistration | null = null;
  let manager: InstitutionalManager | null = null;
  let readFailed = false;

  const [adviserResult, managerResult] = await Promise.all([
    (async () => {
      try {
        return await supabase
          .from("adviser_registrations")
          .select(ADVISER_COLS)
          .eq("company_id", companyId)
          .maybeSingle();
      } catch {
        return { data: null, error: { message: "adviser read threw" } };
      }
    })(),
    (async () => {
      try {
        return await supabase
          .from("institutional_managers")
          .select(MANAGER_COLS)
          .eq("company_id", companyId)
          .eq("files_13f_hr", true)
          .maybeSingle();
      } catch {
        return { data: null, error: { message: "manager read threw" } };
      }
    })(),
  ]);

  if (adviserResult.error) readFailed = true;
  else if (adviserResult.data) adviser = mapAdviser(adviserResult.data as unknown as AdviserRow);

  if (managerResult.error) readFailed = true;
  else if (managerResult.data) manager = mapManager(managerResult.data as unknown as ManagerRow);

  return { adviser, manager, readFailed };
}

/**
 * Compact dollar rendering for RAUM: "$182.9B", "$1.0T", "$518.6M".
 *
 * Full dollars in, so the scale is chosen here rather than assumed by the
 * caller. Sub-million books print in full, because "$0.0M" hides the number
 * this whole section exists to show.
 */
export function formatRaum(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** "2026-05-11" -> "May 2026". RAUM is annual; the day would imply precision. */
export function formatReportedAt(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
