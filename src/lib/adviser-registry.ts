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
 * 5. A ROW CARRIES MORE THAN ONE NAME, AND THE OTHER ONE IS NOT NOISE. Rule 3
 *    was written, and then broken by a single `||` that selected one name and
 *    dropped the other. An ADV row files a primary business name AND a legal
 *    name; a 13F row has a current filer name AND every former name EDGAR
 *    lists, and the matcher is fed all of them, so the name that WON the link
 *    is often not the name that got printed.
 *
 *    Measured on the June 2026 roster against the 4,276-row prod companies
 *    table: of the 380 companies that render a RAUM figure, 119 sit on a row
 *    whose legal name differs from the printed business name. 39 of those
 *    differ only by a legal suffix or an article, which costs the reader
 *    nothing. 80 differ substantively, and on the 13F side 22 of 360 current
 *    filer blocks would print the name of a different firm entirely
 *    ("Martin Marietta" -> "LOCKHEED MARTIN INVESTMENT MANAGEMENT CO").
 *
 *    So both names travel to the render, and the difference between them is
 *    classified rather than discarded. See nameRelation below.
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
  /** Primary Business Name as filed: the name the adviser trades under. */
  businessName: string;
  /** Legal Name as filed. NEVER discarded; see rule 5 and nameRelation. */
  legalName: string | null;
  /** The exact registry string that won the company link, when recorded. */
  matchedName: string | null;
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
  /** The filer's CURRENT name on EDGAR. */
  filerName: string;
  /**
   * The exact registry string that won the company link. The matcher is fed
   * former names as well as the current one, so this is not always filerName.
   */
  matchedName: string | null;
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
  "crd, primary_business_name, legal_name, matched_name, raum_total_usd, raum_discretionary_usd, " +
  "raum_non_discretionary_usd, raum_total_accounts, raum_reported_at, match_tier, match_confirmed";
const MANAGER_COLS =
  "cik, filer_name, matched_name, files_13f_hr, last_filing_date, match_tier, match_confirmed";

interface AdviserRow {
  crd: number | string;
  primary_business_name: string | null;
  legal_name: string | null;
  matched_name: string | null;
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
  matched_name: string | null;
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

// ---------------------------------------------------------------------------
// RULE 5: THE RELATION BETWEEN TWO NAMES ON ONE ROW
//
// PARITY. backend/registry/match.py carries the same four verdicts, the same
// stopwords and the same jurisdiction list, because the backend job reports
// how many companies it credits and that report has to describe what this file
// will actually draw. The two implementations are held together by
// backend/tests/fixtures/filed_name_relations.json, a fixture of real SEC name
// pairs whose verdicts are HAND-WRITTEN from the filings. Both sides assert
// against it; neither side generated it. Change one side and the other side's
// test goes red on the same fixture.
// ---------------------------------------------------------------------------

/** Trailing legal-entity suffixes. Dropped from the END of a name only. */
const LEGAL_SUFFIXES = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "llc", "llp",
  "lp", "plc", "ltd", "limited", "lc", "pc", "pllc", "sa", "nv", "ag", "gmbh",
  "ab", "as", "bv", "kk", "pte", "sarl", "spa", "srl", "oy", "aps",
]);

/**
 * Pure function words. Dropped so "THE VANGUARD GROUP, INC." and "VANGUARD
 * GROUP INC" read as one entity. Deliberately NOT the matcher's GENERIC_WORDS:
 * that set drops "us", "usa", "america" and "global", which is right for
 * MATCHING and exactly wrong here, because a jurisdiction word is the whole
 * signal that a filer is a territorial slice of the group the page names.
 */
const FILER_STOPWORDS = new Set(["the", "and", "of"]);

/**
 * Country, region and US-state tokens. A hidden name that adds one of these to
 * the printed name scopes the filer to a territory. Closed list on purpose: it
 * fires on 41 of the 16,876 roster rows, so a reviewer can read every hit.
 */
const JURISDICTION_TOKENS = new Set([
  "emea", "apac", "asia", "asian", "europe", "european", "eurozone",
  "america", "americas", "american", "iberia", "nordic", "nordics", "benelux",
  "latam", "oceania", "mena", "anz",
  "afghanistan", "argentina", "argentine", "australia", "australian",
  "austria", "austrian", "bahamas", "bahrain", "bangladesh", "belgium",
  "belgian", "bermuda", "brazil", "brazilian", "britain", "british",
  "bulgaria", "canada", "canadian", "cayman", "chile", "chilean", "china",
  "chinese", "colombia", "croatia", "cyprus", "czech", "denmark", "danish",
  "dubai", "ecuador", "egypt", "estonia", "finland", "finnish", "france",
  "french", "germany", "german", "gibraltar", "greece", "greek", "guernsey",
  "hongkong", "hungary", "iceland", "india", "indian", "indonesia", "ireland",
  "irish", "israel", "israeli", "italy", "italian", "jamaica", "japan",
  "japanese", "jersey", "jordan", "kazakhstan", "kenya", "korea", "korean",
  "kuwait", "latvia", "lebanon", "liechtenstein", "lithuania", "luxembourg",
  "macau", "malaysia", "malta", "mauritius", "mexico", "mexican", "monaco",
  "morocco", "netherlands", "norway", "norwegian", "pakistan", "panama",
  "peru", "philippines", "poland", "polish", "portugal", "qatar", "romania",
  "russia", "russian", "rwanda", "saudi", "scotland", "scottish", "singapore",
  "slovakia", "slovenia", "spain", "spanish", "sweden", "swedish",
  "switzerland", "swiss", "taiwan", "thailand", "turkey", "turkish", "uae",
  "uganda", "ukraine", "uruguay", "vietnam", "zealand",
  "us", "usa", "uk",
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
  "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
  "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine",
  "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
  "missouri", "montana", "nebraska", "nevada", "ohio", "oklahoma", "oregon",
  "pennsylvania", "tennessee", "texas", "utah", "vermont", "virginia",
  "washington", "wisconsin", "wyoming",
  "de",
]);

/**
 * How the two names on one row relate.
 *
 *   single  only one usable name on the row: nothing was discarded.
 *   same    one entity, two spellings ("THOMA BRAVO" / "THOMA BRAVO, L.P.").
 *   unit    one name extends the other: a named sub-unit of the same firm.
 *   other   two different names: treat them as two different entities.
 */
export type FiledNameRelation = "single" | "same" | "unit" | "other";

/**
 * Casefold, strip punctuation, collapse whitespace, rejoin initials.
 * Mirrors backend/registry/match.py normalize(); the parity fixture is what
 * keeps the two honest, since a rule stated twice is a rule that can drift.
 */
function normalizeName(name: string | null | undefined): string {
  if (!name) return "";
  const stripped = name.trim().toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ");
  const rejoined = stripped.replace(/\b(\p{L})\s+(?=\p{L}\b)/gu, "$1");
  return rejoined.replace(/\s+/g, " ").trim();
}

/** Identity tokens for comparing two names ON THE SAME ROW. */
function filedTokens(name: string | null | undefined): string[] {
  const toks = normalizeName(name)
    .split(" ")
    .filter((t) => t.length > 0 && !FILER_STOPWORDS.has(t));
  while (toks.length > 0 && LEGAL_SUFFIXES.has(toks[toks.length - 1])) toks.pop();
  return toks;
}

function extendsBy(base: string[], longer: string[]): string[] | null {
  if (longer.length <= base.length) return null;
  for (let i = 0; i < base.length; i += 1) if (base[i] !== longer[i]) return null;
  return longer.slice(base.length);
}

/** How the name a reader WOULD SEE relates to the other name on the row. */
export function nameRelation(
  shown: string | null | undefined,
  other: string | null | undefined,
): FiledNameRelation {
  const a = filedTokens(shown);
  const b = filedTokens(other);
  if (a.length === 0 || b.length === 0) return "single";
  if (a.length === b.length && a.every((t, i) => t === b[i])) return "same";
  if (extendsBy(a, b) !== null || extendsBy(b, a) !== null) return "unit";
  return "other";
}

/**
 * TRUE when the HIDDEN name scopes the shown one to a territory.
 *
 * Directional on purpose. "INVESCO" hiding "INVESCO CANADA LTD." is the
 * defect: the reader sees the group name over a Canadian book. The reverse, a
 * row whose printed name already says CANADA, hides nothing.
 */
export function isJurisdictionScoped(
  shown: string | null | undefined,
  other: string | null | undefined,
): boolean {
  const added = extendsBy(filedTokens(shown), filedTokens(other));
  return added !== null && added.some((t) => JURISDICTION_TOKENS.has(t));
}

/**
 * SUPPRESSION, not a caveat. The filer is a named territorial slice of the
 * group the page is about, so the figure is a fraction of the group book and
 * no label placed near it can fix that. The roster proves the arithmetic
 * without leaving the file: INVESCO CANADA LTD. files $19.87B while INVESCO
 * CAPITAL MANAGEMENT LLC files $941.02B on the same June 2026 roster, so the
 * figure the Invesco page would print is 2.1% of the group's largest single
 * registrant. Fires on 5 of the 380 rendering figures.
 *
 * A human adjudication overrides it. backend/data/adviser_link_overrides.json
 * is already the place a person rules on a link, and match_confirmed is already
 * the flag it sets; a confirmed link is a decision this rule must not undo.
 */
export function isTerritorialSlice(adviser: AdviserRegistration | null): boolean {
  if (!adviser || adviser.matchConfirmed) return false;
  return isJurisdictionScoped(adviser.businessName, adviser.legalName);
}

/**
 * Rules 1, 2 and 5: a figure exists only when it is positive, dated, and not a
 * territorial slice of the group the page names.
 */
export function hasRaumFigure(adviser: AdviserRegistration | null): boolean {
  if (!adviser) return false;
  if (adviser.raumTotalUsd === null || adviser.raumTotalUsd <= 0) return false;
  if (adviser.reportedAt === null) return false;
  if (isTerritorialSlice(adviser)) return false;
  return true;
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
 * Rule 5 on the 13F side: the row must name the entity that won the link.
 *
 * The matcher is fed every FORMER name EDGAR lists for a filer, so a link can
 * be won by a name the filer no longer uses while the row renders the current
 * one. When those two are different names rather than two spellings of one,
 * the block would assert that a firm files 13F under a name belonging to
 * somebody else. Measured: 22 of the 360 current filer blocks, including
 * "Martin Marietta" rendering LOCKHEED MARTIN INVESTMENT MANAGEMENT CO,
 * "United States" rendering BOSTON TRUST WALDEN NATIONAL ASSOCIATION, and
 * "Warner" rendering FSB PREMIER WEALTH MANAGEMENT, INC.
 *
 * A row with no recorded matched_name (a hand-loaded row, or one written before
 * the column existed) is attributable: there is no evidence of a conflict, and
 * inventing one would suppress every legitimate row.
 */
export function is13FAttributable(manager: InstitutionalManager | null): boolean {
  if (!manager) return false;
  if (manager.matchConfirmed) return true;
  return nameRelation(manager.filerName, manager.matchedName) !== "other";
}

/** Rules 4 and 5: a 13F block is evidence only when current AND attributable. */
export function has13FEvidence(
  manager: InstitutionalManager | null,
  now: Date,
  maxAgeDays: number = STALE_13F_DAYS,
): boolean {
  return is13FCurrent(manager, now, maxAgeDays) && is13FAttributable(manager);
}

/**
 * TRUE when this profile supplies the NUMBERS pillar. Deliberately the same
 * predicate the backend measured with, so what the scorer counts and what the
 * page draws can never drift apart.
 */
export function suppliesNumbersPillar(profile: RegistryProfile, now: Date): boolean {
  return hasRaumFigure(profile.adviser) || has13FEvidence(profile.manager, now);
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapAdviser(row: AdviserRow): AdviserRegistration {
  // BOTH names survive. The `||` that used to sit here selected one and threw
  // the other away, which is the whole of rule 5. The legal name still stands
  // in when there is no business name, but then it is not ALSO reported as a
  // second name, because a row with one name hides nothing.
  const business = trimOrNull(row.primary_business_name);
  const legal = trimOrNull(row.legal_name);
  return {
    crd: toNumber(row.crd) ?? 0,
    businessName: business ?? legal ?? "",
    legalName: business === null ? null : legal,
    matchedName: trimOrNull(row.matched_name),
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
    matchedName: trimOrNull(row.matched_name),
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
