// No `import "server-only"` here on purpose. This module holds no secret, reads
// no env var and constructs no client: the caller passes one in. Marking it
// server-only would buy nothing and would make it unreachable from the unit
// suite, which resolves `server-only` through Next's bundler alias and not from
// node_modules (the package is not installed). The server boundary that matters
// is `supabase-service.ts`, which is where the service-role key is read.
import type { SupabaseClient } from "@supabase/supabase-js";

import { escapeLikePattern } from "@/lib/like-escape";

/**
 * Lost-race (23505) recovery for INSERTs into `companies`.
 *
 * TS half of a rule that also exists in `backend/company_conflict.py`. The two
 * runtimes cannot share one implementation, so they share one LADDER instead:
 * the probe names and their order are declared as `PROBE_LADDER` in both files
 * and asserted by a test on each side. That does not cross-check the languages
 * and this comment does not claim it does; it means a reorder on one side goes
 * red on that side against a written order, instead of drifting quietly.
 *
 * WHY A LADDER AND NOT `.eq("name", name)`
 * ----------------------------------------
 * `companies` carries FOUR unique things and only ONE is a plain column.
 * Enumerated 2026-09-01 from pg_constraint AND pg_indexes, recorded in
 * sql/proposals/0020b_norm_v2_revised_phases.sql:
 *
 *     companies_name_key          UNIQUE (name)
 *     companies_name_norm_unique  UNIQUE (lower(btrim(name))) WHERE sec_cik IS NULL
 *     companies_sec_cik_unique    UNIQUE (sec_cik)            WHERE sec_cik IS NOT NULL
 *     companies_name_no_junk      CHECK (...)
 *
 * The middle two are PARTIAL UNIQUE INDEXES. A partial index carries no
 * pg_constraint row, so an audit that reads pg_constraint alone reports both as
 * absent.
 *
 * The insert in resolveOrCreateCompany writes sec_cik NULL, so a new row is
 * INSIDE companies_name_norm_unique. A 23505 from that index names a row
 * spelled differently in case or surrounding whitespace, so `.eq("name", name)`
 * returns nothing, `maybeSingle()` hands back null, and the caller returned
 * `not_found` with no error and no log. The company existed. That silent
 * wrong answer is what this replaces.
 *
 * THIS MODULE NORMALIZES NOTHING, ON PURPOSE
 * ------------------------------------------
 * The repo has two name normalizers, `normalizeLookupKey` (v1, the alias write
 * key) and the read-only v2 key in `backend/company_match.py`, and which is
 * canonical is an open decision. Neither is used here.
 *
 * The index expression is `lower(btrim(name))`, which is neither. Reproducing
 * it in TypeScript would be a THIRD definition of "same name", and a third
 * definition that disagrees with the index on any Unicode edge case turns a
 * recovery into a miss. So every comparison below is evaluated BY POSTGRES:
 * `ilike` does the case fold against the stored value, `.is("sec_cik", null)`
 * evaluates the partial index's own predicate, and the only thing done to the
 * needle here is `.trim()`, which stands in for btrim on the value we send.
 *
 * The handler is correct under v1, under v2, and under neither.
 *
 * WHEN THE ROW THAT WON IS ITSELF A DUPLICATE
 * -------------------------------------------
 * It resolves to the winning row and looks at no other row. It never ranks,
 * never prefers the row carrying a ticker or a CIK, and never merges. Live
 * example: "ExxonMobil" (no ticker, no CIK) and "Exxon" (XOM, CIK 34088) are
 * one company in two rows. A losing insert of "ExxonMobil" resolves to
 * "ExxonMobil", not to "Exxon". A 23505 names exactly one conflicting tuple and
 * that tuple is, by the database's own definition of identity, the row this
 * insert was trying to create. Redirecting to a different row is a MERGE, it
 * has no defensible default here (for this cluster the busier row is the one
 * WITHOUT identifiers), and a real merge has to repoint six dependent tables
 * inside one transaction. Recovery therefore writes nothing and cannot deepen
 * an existing duplicate.
 */

export const PROBE_EXACT_NAME = "exact_name";
export const PROBE_NORM_NAME_CIK_NULL = "norm_name_cik_null";
export const PROBE_NORM_NAME_ANY = "norm_name_any";
export const PROBE_SEC_CIK = "sec_cik";

export type Probe =
  | typeof PROBE_EXACT_NAME
  | typeof PROBE_NORM_NAME_CIK_NULL
  | typeof PROBE_NORM_NAME_ANY
  | typeof PROBE_SEC_CIK;

/**
 * The full ladder, in the order attempted when the error names no index.
 * Mirrors PROBE_LADDER in backend/company_conflict.py.
 *
 * PROBE_NORM_NAME_ANY exists for the constraint-widening PR that follows this
 * one. Today companies_name_norm_unique is partial on `sec_cik IS NULL` and
 * PROBE_NORM_NAME_CIK_NULL matches that predicate exactly; if the predicate is
 * dropped, that probe goes too narrow and the broad one covers what it misses.
 * Running both is why this handler does not need to know which shape is in
 * force, and why it can land BEFORE the widening rather than after.
 */
export const PROBE_LADDER: readonly Probe[] = [
  PROBE_EXACT_NAME,
  PROBE_NORM_NAME_CIK_NULL,
  PROBE_NORM_NAME_ANY,
  PROBE_SEC_CIK,
] as const;

/**
 * Index name -> the probe to try FIRST. A hint, never a restriction: if the
 * hinted probe misses, the rest of the ladder still runs. PostgREST echoing the
 * index name is convenient, not load-bearing.
 */
export const INDEX_PROBE_HINT: Readonly<Record<string, Probe>> = {
  companies_name_key: PROBE_EXACT_NAME,
  companies_name_norm_unique: PROBE_NORM_NAME_CIK_NULL,
  companies_sec_cik_unique: PROBE_SEC_CIK,
};

export const LOG_PREFIX = "[companies:23505]";
export const UNIQUE_VIOLATION = "23505";

export type CompanyRow = {
  id: string;
  name: string;
  ticker: string | null;
  sec_cik?: number | null;
};

/** Raised when a 23505 fired and no probe found the row. Never returned. */
export class CompanyConflictUnresolvedError extends Error {
  readonly name = "CompanyConflictUnresolvedError";
  constructor(
    message: string,
    readonly probes: string[],
    readonly indexName: string | null,
  ) {
    super(message);
  }
}

type PgErrorish = { code?: string | null; message?: string | null } | null;

export function isUniqueViolation(error: PgErrorish): boolean {
  return error?.code === UNIQUE_VIOLATION;
}

/**
 * The index named in the error, when it is one of ours. Postgres writes
 * `duplicate key value violates unique constraint "<name>"`. Matched against
 * known names only, so an unfamiliar index yields null and the full ladder runs.
 */
export function conflictingIndexName(error: PgErrorish): string | null {
  const blob = `${error?.message ?? ""}`;
  for (const indexName of Object.keys(INDEX_PROBE_HINT)) {
    if (blob.includes(indexName)) return indexName;
  }
  return null;
}

/**
 * The needle escape is `escapeLikePattern` from `@/lib/like-escape`, which is
 * the SAME function `aliasResolver` uses for its case-insensitive exact match.
 * Deliberately not re-implemented here: a recovery that escapes differently
 * from the read path it is recovering into would find nothing and report the
 * company as absent, which is the failure this file exists to remove.
 *
 * A name containing `*` OVER-matches, because PostgREST rewrites `*` to `%`
 * before SQL sees the pattern and it cannot be escaped. Safe by construction
 * here: a probe is accepted only when it returns exactly one row, so a widened
 * match returns more and is refused, and the true conflicting row is always
 * inside a widened set because widening only adds. Under-matching is the
 * dangerous direction and the escape prevents it.
 */

/** The ladder with the hinted probe moved to the front. Every probe still runs. */
export function probeOrder(indexName: string | null): Probe[] {
  const hint = indexName ? INDEX_PROBE_HINT[indexName] : undefined;
  if (!hint) return [...PROBE_LADDER];
  return [hint, ...PROBE_LADDER.filter((p) => p !== hint)];
}

const SELECT_COLS = "id, name, ticker, sec_cik";

async function runProbe(
  svc: SupabaseClient,
  probe: Probe,
  name: string,
  secCik: number | null,
): Promise<CompanyRow[]> {
  const table = () => svc.from("companies").select(SELECT_COLS);
  let query;
  switch (probe) {
    case PROBE_EXACT_NAME:
      query = table().eq("name", name).limit(2);
      break;
    case PROBE_NORM_NAME_CIK_NULL:
      query = table().ilike("name", escapeLikePattern(name.trim())).is("sec_cik", null).limit(2);
      break;
    case PROBE_NORM_NAME_ANY:
      query = table().ilike("name", escapeLikePattern(name.trim())).limit(2);
      break;
    case PROBE_SEC_CIK:
      if (secCik === null) return [];
      query = table().eq("sec_cik", secCik).limit(2);
      break;
  }
  const { data, error } = await query;
  // supabase-js returns read errors in the result object rather than throwing.
  // An unchecked `error` here would look exactly like "zero rows found", which
  // is the same silent-miss shape this whole module exists to remove, one layer
  // down. Surface it.
  if (error) {
    throw new Error(
      `${LOG_PREFIX} probe ${probe} failed: ${error.message ?? String(error)}`,
    );
  }
  return (data ?? []) as CompanyRow[];
}

/**
 * Find the row that won the race, or throw.
 *
 * Never returns null. A null would be read as "no such company" by the caller,
 * which is precisely the silent failure described at the top of this file.
 */
export async function resolveConflictingCompany(
  svc: SupabaseClient,
  opts: { name: string; secCik?: number | null; error?: PgErrorish },
): Promise<CompanyRow> {
  const { name, secCik = null, error = null } = opts;
  const indexName = conflictingIndexName(error);
  const attempted: string[] = [];

  for (const probe of probeOrder(indexName)) {
    const rows = await runProbe(svc, probe, name, secCik);
    attempted.push(`${probe}:${rows.length}`);
    // 0 rows: this index is not the one that fired, or it fired on a row this
    // probe cannot see. More than 1: the needle widened (see escapeLike) and we
    // refuse to guess which row is the conflict.
    if (rows.length !== 1) continue;
    const row = rows[0];
    console.warn(
      `${LOG_PREFIX} recovered name=${JSON.stringify(name)} ` +
        `index=${indexName ?? "unknown"} probe=${probe} winner_id=${row.id} ` +
        `winner_name=${JSON.stringify(row.name)} probes=${attempted.join(",")}`,
    );
    return row;
  }

  throw new CompanyConflictUnresolvedError(
    `${LOG_PREFIX} UNRECOVERED name=${JSON.stringify(name)} ` +
      `sec_cik=${secCik} index=${indexName ?? "unknown"} ` +
      `probes=${attempted.join(",")}: the database reported a unique violation ` +
      `but no probe found the row. Original error: ${error?.message ?? "none"}`,
    attempted,
    indexName,
  );
}
