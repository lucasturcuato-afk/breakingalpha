/**
 * Signup cohort attribution.
 *
 * WHY THIS EXISTS: users arriving from different channels are currently
 * indistinguishable in the data. The only segmentation that exists is an email
 * domain proxy (usc.edu and marshall.usc.edu) in the dim_users view, which puts
 * 153 of 199 users in one bucket and cannot express which club or chapter
 * someone came from. Attribution not captured at signup cannot be reconstructed
 * later, so this ships before the audit is reviewed rather than after.
 *
 * THREE FIELDS, deliberately separate rather than one free-text tag:
 *  - source: WHICH CHANNEL. A closed enum, validated server-side, because the
 *    capture endpoint is unauthenticated and client-callable. Free text here
 *    would be attacker-controlled and would reproduce at scale the problem the
 *    allowlist notes column already has, where "BSIG" and "BSIG " are two
 *    different cohorts.
 *  - institution: WHICH SCHOOL OR ORG. Normalized to a strict slug so casing and
 *    stray whitespace cannot fork a cohort in two.
 *  - batch: WHICH ADMISSION WAVE. 127 people are waiting and will be admitted in
 *    waves; batch identity has to survive the moment a waitlist row becomes a
 *    user row, which is why it is carried on beta_allowlist too and not only
 *    here.
 *
 * FIRST TOUCH WINS. registerWaitlist inserts and tolerates the unique-email
 * conflict; it does not update. A returning visitor's cohort is therefore NOT
 * overwritten on a second visit. That is a deliberate choice recorded here so
 * nobody reads the current behavior as an accident: first touch is the honest
 * attribution for "where did this person come from".
 */

/** Channel a signup arrived through. Closed set, validated server-side. */
export const COHORT_SOURCES = [
  "organic",
  "pilot",
  "outreach",
  "referral",
  "event",
  "import",
] as const;

export type CohortSource = (typeof COHORT_SOURCES)[number];

/** Query-string keys that carry cohort through the provider round trip. */
export const COHORT_PARAM_SOURCE = "cs";
export const COHORT_PARAM_INSTITUTION = "ci";
export const COHORT_PARAM_BATCH = "cb";

/** Slug fields are capped so an oversized value cannot bloat a row. */
const SLUG_MAX = 40;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export interface Cohort {
  source: CohortSource | null;
  institution: string | null;
  batch: string | null;
}

export const EMPTY_COHORT: Cohort = {
  source: null,
  institution: null,
  batch: null,
};

/**
 * Validate a source against the closed enum. Anything else becomes null rather
 * than being stored, so an unauthenticated caller cannot invent a channel.
 */
export function parseCohortSource(raw: unknown): CohortSource | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return (COHORT_SOURCES as readonly string[]).includes(v)
    ? (v as CohortSource)
    : null;
}

/**
 * Normalize an institution or batch to a strict slug. Lowercases, collapses
 * whitespace and underscores to single hyphens, strips anything else, and caps
 * the length. Returns null for empty or unusable input.
 *
 * This is the function that prevents "BSIG" and "BSIG " from becoming two
 * cohorts. Everything that writes a cohort slug must go through it.
 */
export function normalizeCohortSlug(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-$/, "");
  if (!slug || !SLUG_RE.test(slug)) return null;
  return slug;
}

/** Parse a full cohort from anything with a URLSearchParams-like getter. */
export function parseCohortFromParams(params: {
  get(name: string): string | null;
}): Cohort {
  return {
    source: parseCohortSource(params.get(COHORT_PARAM_SOURCE)),
    institution: normalizeCohortSlug(params.get(COHORT_PARAM_INSTITUTION)),
    batch: normalizeCohortSlug(params.get(COHORT_PARAM_BATCH)),
  };
}

/** Parse a cohort out of an untrusted JSON request body. */
export function parseCohortFromBody(body: {
  cohort_source?: unknown;
  cohort_institution?: unknown;
  cohort_batch?: unknown;
}): Cohort {
  return {
    source: parseCohortSource(body.cohort_source),
    institution: normalizeCohortSlug(body.cohort_institution),
    batch: normalizeCohortSlug(body.cohort_batch),
  };
}

/** True when nothing was captured, so callers can skip sending empty fields. */
export function isEmptyCohort(c: Cohort): boolean {
  return c.source === null && c.institution === null && c.batch === null;
}

/**
 * Re-encode a cohort as query params so it survives the OAuth redirect to the
 * provider and back. Only non-null fields are appended, so a cohort-less signup
 * produces a clean URL exactly as today.
 */
export function cohortToQuery(c: Cohort): string {
  const p = new URLSearchParams();
  if (c.source) p.set(COHORT_PARAM_SOURCE, c.source);
  if (c.institution) p.set(COHORT_PARAM_INSTITUTION, c.institution);
  if (c.batch) p.set(COHORT_PARAM_BATCH, c.batch);
  return p.toString();
}

/**
 * The grouping key the dashboard filters on. Mirrors the SQL expression in the
 * cohort views exactly, so the app and the database agree on what a cohort is.
 * Keep the two in sync: see cohort_key in the UNAPPLIED cohort migration.
 */
export function cohortKey(c: Cohort): string {
  if (isEmptyCohort(c)) return "unattributed";
  return [c.source ?? "unknown", c.institution ?? "unknown", c.batch ?? "unknown"].join(
    ":",
  );
}
