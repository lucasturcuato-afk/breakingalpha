/**
 * supabase-query - the one place a PostgREST result becomes rows or an error.
 *
 * WHY THIS EXISTS. The same defect has now shipped five times: a query fails,
 * the failure is turned into an empty array, and the UI renders a confident
 * "nothing here" for what was actually a broken read. Instances found:
 *   - watchlist feed  (fetched_at window + 200-with-[] on error) -> "No recent
 *     articles for your watchlist"
 *   - Top Stories     (statement timeout -> []) -> "No stories yet. Stories
 *     will appear once articles are ingested by the pipeline", which blames
 *     the pipeline for a database timeout
 *   - thesis verdicts (bad column, PostgREST returns data:null) -> "No
 *     verdicts yet" over 32 real rows
 *   - follow matcher  (JSONB literal 22P02) -> a follow that matched nothing
 *   - competitor alerts / notifications / thesis states (data-only
 *     destructuring, error never bound)
 *
 * supabase-js does NOT throw on a query error: it resolves with
 * { data: null, error }. So `const { data } = await sb.from(...)` compiles,
 * runs, and silently yields null on every failure. That single ergonomic
 * choice is the root of the whole class.
 *
 * THE RULE this module enforces: a failed query throws. Emptiness is a fact
 * about the data and must come from a query that SUCCEEDED. Callers then
 * choose how to degrade, but they can no longer confuse the two by accident.
 */

/** A PostgREST error as supabase-js surfaces it. */
export interface PostgrestErrorLike {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

/** The { data, error } envelope every supabase-js query resolves with. */
export interface QueryResultLike<T> {
  data: T[] | null;
  error: PostgrestErrorLike | null;
}

/** Thrown when a query failed. Carries the PostgREST code so callers can
 *  distinguish a missing table or a timeout from a real error. */
export class QueryFailedError extends Error {
  readonly code: string | undefined;
  readonly context: string;

  constructor(context: string, error: PostgrestErrorLike | null) {
    super(`${context}: ${error?.message ?? "query failed"}`);
    this.name = "QueryFailedError";
    this.code = error?.code;
    this.context = context;
  }
}

/** Postgres statement timeout. Transient: the same query often succeeds on a
 *  warm cache, so it is worth one retry before giving up. */
export const STATEMENT_TIMEOUT_CODE = "57014";

/** Relation does not exist / schema cache miss. A surface may legitimately
 *  render "not available yet" for these rather than an error. */
export function isMissingTable(error: PostgrestErrorLike | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = error.message ?? "";
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /does not exist|schema cache/i.test(message)
  );
}

export function isStatementTimeout(error: PostgrestErrorLike | null | undefined): boolean {
  return error?.code === STATEMENT_TIMEOUT_CODE;
}

/**
 * Rows, or a throw. The replacement for `(data ?? [])`.
 *
 * `context` names the read so the thrown message says which query broke
 * ("Top Stories primary"), which the old console.error lines already proved
 * is the useful part.
 */
export function unwrapRows<T>(result: QueryResultLike<T>, context: string): T[] {
  if (result.error) throw new QueryFailedError(context, result.error);
  return result.data ?? [];
}

/** Backoff before each statement-timeout retry, in ms. Two retries: the
 *  observed failures are bursty (the same query alternates 0.4s and 4s within
 *  seconds), so a short wait is usually enough to land on a good moment. */
const TIMEOUT_RETRY_DELAYS_MS = [150, 450];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a query, retrying a statement timeout with short backoff.
 *
 * The failure mode actually measured on the dashboard hero is a bursty
 * statement timeout, not a permanently slow query: the identical read
 * alternates between ~0.4s and >3.5s within seconds as the instance is
 * throttled. Retrying converts most of those into a served page. A non-timeout
 * error is a real fault and throws immediately, without burning retries.
 *
 * Anything still failing after the retries throws, so the caller renders an
 * error state. It must never come back as an empty list.
 */
export async function queryRows<T>(
  run: () => PromiseLike<QueryResultLike<T>>,
  context: string,
): Promise<T[]> {
  let last: QueryResultLike<T> = await run();
  if (!last.error) return last.data ?? [];
  if (!isStatementTimeout(last.error)) throw new QueryFailedError(context, last.error);

  for (const delay of TIMEOUT_RETRY_DELAYS_MS) {
    await sleep(delay);
    last = await run();
    if (!last.error) return last.data ?? [];
    if (!isStatementTimeout(last.error)) throw new QueryFailedError(context, last.error);
  }
  throw new QueryFailedError(`${context} (timed out after retries)`, last.error);
}

/** JSON body for an API route that could not read its data. Pairs with a 500,
 *  so the client can tell a broken read from an empty one. */
export function queryErrorBody(message: string): { error: string } {
  return { error: message };
}
