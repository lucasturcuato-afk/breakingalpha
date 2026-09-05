import type { PostgrestSingleResponse } from "@supabase/postgrest-js";

/**
 * A read that can fail, in a shape that cannot be mistaken for an empty one.
 *
 * WHY THIS EXISTS AT ALL, given that Supabase already discriminates.
 * `PostgrestSingleResponse<T>` is `PostgrestResponseSuccess<T> |
 * PostgrestResponseFailure`, discriminated on `error`, and it narrows
 * correctly under this repo's `strict: true` even with the untyped client.
 * Where the response object can travel, use it directly; wrapping something
 * that already discriminates gains nothing. This type earns its place in
 * exactly two places:
 *
 *   1. A library signature, where the response object cannot travel because
 *      the library maps the row into a domain shape before handing it back.
 *   2. The `.single()` three-state problem. `PostgrestSingleResponse` has two
 *      members, so "no such row" and "the read did not happen" land in the
 *      same one. Those are different answers and callers act on them
 *      differently: a caller may reasonably default on a missing row and must
 *      never default on a failed read.
 *
 * WHY `{code, message}` AND NEVER THE ERROR OBJECT. `PostgrestError extends
 * Error`, and an Error subclass is not a serialisable React Server Component
 * prop. A failure carried across the server boundary as the error itself
 * throws at render. Plain strings cross it.
 *
 * WHY THE FAILURE MEMBER HAS NO `data` KEY. On this union `r.data ?? []` does
 * not compile, because the failure member has no `data` to coalesce. That is
 * the entire point: the one-character habit that turns a failed read into an
 * empty render is a type error here rather than a silent lie on screen.
 */
export type ReadFailure = {
  state: "failed";
  /** Postgres or PostgREST code, e.g. `42703` for a column that is not there. */
  code: string;
  message: string;
};

/** Three states, because a row that is not there is not the same answer as a
 *  read that did not happen. */
export type Read<T> =
  | { state: "ok"; row: T }
  | { state: "missing" }
  | ReadFailure;

/** Two states, because on a list zero rows genuinely IS an answer. There is no
 *  `missing` member here and adding one would be noise. */
export type ListRead<T> = { state: "ok"; rows: T[] } | ReadFailure;

/**
 * PostgREST's code for "the query matched no rows" under `.single()`.
 * This is the discrimination that separates genuinely missing from failed:
 * `.single()` reports an empty match as an error, and treating it as one is
 * what makes a first-visit profile look like a broken database.
 */
const NO_ROWS = "PGRST116";

/** Adapter OVER a `.single()` or `.maybeSingle()` response, not a wrapper
 *  around the client. Handles both: `.maybeSingle()` signals no row as
 *  `data: null` with no error, `.single()` signals it as PGRST116. */
export function fromSingle<T>(res: PostgrestSingleResponse<T | null>): Read<T> {
  if (res.error) {
    if (res.error.code === NO_ROWS) return { state: "missing" };
    return { state: "failed", code: res.error.code, message: res.error.message };
  }
  if (res.data === null || res.data === undefined) return { state: "missing" };
  return { state: "ok", row: res.data };
}

/** Adapter over a list response. `data: null` with no error is an empty list,
 *  never a failure. */
export function fromList<T>(
  res: PostgrestSingleResponse<T[] | null>,
): ListRead<T> {
  if (res.error) {
    return { state: "failed", code: res.error.code, message: res.error.message };
  }
  return { state: "ok", rows: res.data ?? [] };
}

/**
 * The indifferent caller's whole cost: one call, one line, no branch.
 *
 * A shape that forced every caller to handle failure verbosely would be
 * worked around, and a worked-around type is worse than no type. Callers for
 * which a default is the genuinely right soft-fail keep saying so in one
 * line; callers that must not default do not reach for this.
 */
export function rowOr<T>(read: Read<T>, fallback: T): T {
  return read.state === "ok" ? read.row : fallback;
}
