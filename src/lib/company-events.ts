/**
 * The two company-demand events, and the pure decisions behind them.
 *
 * WHY THIS FILE EXISTS AT ALL. `user_events` holds 3,084 rows across 20 event
 * names and NOT ONE of them is a company page view or a company lookup
 * (measured against prod 2026-08-31, SELECT only). Every coverage number we
 * quote, and every number anyone would use to judge whether a resolver fix
 * worked, is scored against a denominator that has never been checked against
 * real demand. These two events are that denominator.
 *
 * WHY IT IS A MODULE AND NOT TWO INLINE OBJECT LITERALS. `company-search-target.ts`
 * already wrote the lesson down: the previous version of the directory's
 * zero-match rule lived inline in an `onKeyDown` on a 900 line `"use client"`
 * page, so its unit test restated the rule and passed against a tree that did
 * not contain it. The decisions below are pure, so they live where a test can
 * import the ACTUAL predicate. Both call sites import from here.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT IT EMITS, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * `company_id` IS `companies.id`, THE ROW PRIMARY KEY, AND NOTHING ELSE. Not a
 * canonical entity id, not a CIK, not a cluster head chosen by some registry.
 * There is a live question about whether company identity should move to a
 * registry keyed on SEC CIK, and an event keyed on the thing under review
 * becomes unreadable the moment the review lands. `companies.id` is a row that
 * exists today and will still be resolvable from any future mapping table, so
 * a week of these events survives whatever that question decides.
 *
 * THE TYPED STRING IS THE POINT. A lookup event without the string the reader
 * actually typed tells us how often search is used and nothing about what it is
 * used FOR, which is the whole reason to collect it. It is trimmed and capped
 * at MAX_QUERY_CHARS, with the pre truncation length carried alongside so a cap
 * that is too tight is visible in the data rather than silent.
 * ══════════════════════════════════════════════════════════════════════════
 */

/** Emitted once per reader per company per UTC day, from both page branches. */
export const COMPANY_PAGE_VIEWED = "company.page.viewed";
/** Emitted per settled query and again on Enter. Never deduped; see below. */
export const COMPANY_LOOKUP_SEARCHED = "company.lookup.searched";

/**
 * How a company page terminated.
 *
 * THREE VALUES, NOT TWO, and the third is the one worth having. "Did it render
 * content or an empty state" is answerable as `outcome !== "empty"`, so nothing
 * is lost by splitting the hit branch. What is GAINED is the difference between
 * two failures that are indistinguishable today and have opposite fixes:
 *
 *   empty    the resolver found no companies row. An identity problem.
 *   thin     a row resolved, and it has zero classified articles behind it. The
 *            page renders a header over empty tabs. A coverage problem.
 *   content  a row resolved and has coverage.
 *
 * A reader cannot tell `thin` from `content` in the aggregate today, so
 * "company pages viewed" currently overstates delivered value by however many
 * of them were headers over nothing.
 */
export type CompanyPageOutcome = "empty" | "thin" | "content";

/** Longest typed string carried into a payload. Beyond this it is truncated. */
export const MAX_QUERY_CHARS = 120;

export interface CompanyPageViewInput {
  /** The raw `[id]` route segment, exactly as it appeared in the URL. */
  slug: string;
  /**
   * The string the route actually handed the resolver. It is NOT the slug:
   * `page.tsx` runs `canonicalize(slugToCompanyName(id))` first, which
   * title cases function words ("bank-of-america" -> "Bank Of America"). Both
   * are carried because the gap between them is a known miss generator and is
   * invisible if only one of the two is recorded.
   */
  query: string;
  /** `companies.id` of the resolved row. Null on the miss branch only. */
  companyId: string | null;
  outcome: CompanyPageOutcome;
  /** Classified articles behind the page. 0 on both `empty` and `thin`. */
  articleCount: number;
}

export interface CompanyLookupInput {
  /** Exactly what the reader typed, before truncation. */
  query: string;
  /** Rows the directory had for this query when the event was built. */
  matches: number;
  /**
   * True when the reader pressed Enter, false for a query that merely settled.
   *
   * BOTH ARE EMITTED, on one event name, and the flag is what separates them.
   * Enter only would miss the reader who types, sees nothing, and gives up
   * without committing, which is the most informative miss on this surface.
   * Settle only would lose the act of choosing. Prefix noise from a fast typist
   * ("st", "sta", "star") is recoverable at read time by dropping any query
   * that is a strict prefix of a later one in the same `session_id`; an
   * abandoned miss that was never recorded is not recoverable by anything.
   */
  committed: boolean;
  /** Path pushed on Enter, or null when Enter did nothing. */
  destination: string | null;
  /** `companies.id` the reader was sent to, when a matched row was opened. */
  companyId: string | null;
}

/** Trim, then cap. Empty in, empty out. */
export function clampQuery(raw: string): string {
  return raw.trim().slice(0, MAX_QUERY_CHARS);
}

export function companyPageViewPayload(
  input: CompanyPageViewInput,
): Record<string, unknown> {
  const query = clampQuery(input.query);
  return {
    company_id: input.companyId,
    outcome: input.outcome,
    resolved: input.outcome !== "empty",
    slug: clampQuery(input.slug),
    query,
    query_len: input.query.trim().length,
    article_count: input.articleCount,
  };
}

/**
 * The dedupe key, or null to emit every time.
 *
 * ONE VIEW PER READER PER COMPANY PER UTC DAY. This event fires from an effect
 * on mount, which is the exact shape that produced the brief open over count:
 * a remount, a client route re entry, a second tab or a reload each fired it
 * again, and one account logged 195 of 221 opens in a 7 day window off five
 * briefings. A company page is reachable by back nav, by the directory's
 * `router.push`, and by `CompanyAutoResolve` pushing a second slug for the SAME
 * row, so it has strictly more remount paths than the brief did. Raw view
 * counts under those conditions measure reload behaviour, not demand, and are
 * not comparable between companies. Distinct reader days per company are.
 *
 * KEYED ON THE RESOLVED ROW, NOT THE SLUG, on the hit branch. `/company/NVDA`
 * and `/company/nvidia-corporation` are one company and must count once. On the
 * miss branch there is no row to key on, so the slug is the identity, which is
 * correct there: two different failing strings are two different facts.
 */
export function companyPageViewOnceKey(input: CompanyPageViewInput): string {
  return input.companyId ? `id:${input.companyId}` : `miss:${clampQuery(input.slug).toLowerCase()}`;
}

/**
 * The miss branch flushes immediately; the hit branch batches.
 *
 * `CompanyAutoResolve` mounts beside the empty state and pushes a different
 * route within a few hundred milliseconds of a successful resolve, so the miss
 * branch is the one most likely to be abandoned before the 3s interval fires.
 * A dropped miss does not just add noise, it biases the measured miss rate
 * downward, which is the number this whole PR exists to establish. Misses are
 * rare by construction, so the extra request is bounded by the thing being
 * measured.
 */
export function companyPageViewImmediate(input: CompanyPageViewInput): boolean {
  return input.outcome === "empty";
}

export function companyLookupPayload(
  input: CompanyLookupInput,
): Record<string, unknown> {
  const query = clampQuery(input.query);
  return {
    query,
    query_len: input.query.trim().length,
    resolved: input.matches > 0,
    matches: input.matches,
    committed: input.committed,
    destination: input.destination,
    company_id: input.companyId,
    /**
     * The reader typed, committed, and the surface did nothing at all. There is
     * no navigation, no error and no result, so today this leaves no trace of
     * any kind anywhere. It is the single highest value row in this dataset.
     */
    dead_end: input.committed && input.matches === 0 && input.destination === null,
  };
}
