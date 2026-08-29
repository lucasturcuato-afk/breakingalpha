/**
 * ask-companies-data - the read behind Ask's "company intel" block.
 *
 * WHAT THIS REPLACED, and why it had to be replaced rather than wired.
 * The block was drawn as RECENT LOOKUPS. Nothing in the product records that a
 * company was viewed: there is no lookup table, no view event and no column on
 * `user_profiles` or `user_claims` that could stand in for one. The shipped
 * copy said so out loud, in production, in a notice under an empty list. A
 * history with no history behind it cannot be made honest by wiring, only by
 * becoming something else, so the block is now a DIRECTORY: the companies the
 * corpus names most often, which is a fact this read already has.
 *
 * WHAT IT READS. `companies`, the same table, columns, ordering and noise
 * filter that `GET /api/companies` already answers with. It reads the table
 * directly rather than calling that route: `/ask` is a server component and a
 * server component calling its own HTTP route is a round trip for nothing,
 * which is the shape `src/lib/watch-data.ts` set. The noise predicate is
 * IMPORTED from the route rather than copied, and so are `TICKER_RE` and
 * `slugToCompanyName`.
 *
 * TWO OF THE THREE HOPS ARE IMMUNE TO DRIFT, NOT ALL THREE, and the residual
 * is named here rather than left as an implied guarantee.
 * `src/app/company/[id]/page.tsx:89` carries its OWN private copy of
 * `slugToCompanyName` and does not import the one this file uses. So hop 1 of
 * the route runs that copy while the mirror below runs `aliasResolver`'s. The
 * two are byte identical today, checked, so nothing is wrong now; an edit to
 * one and not the other would make the proof below quietly wrong about the
 * route it is proving against. That page is not this unit's to refactor. The
 * fix, when someone takes it, is one import.
 *
 * WHAT IT REFUSES TO DO
 *
 * NO PER-READER FIGURE. The design's third column reads "2 of your entries",
 * which needs a count of the reader's own claims against each company. This
 * read does not carry one and no second query is made for it here. The column
 * carries the SECTOR instead, a fact the same read already carries, and the count
 * that actually ordered the list is stated once in the block's own copy rather
 * than repeated as a figure on every row.
 *
 * NO LINK THAT CANNOT LAND. `/company/[id]` resolves a slug through
 * `slugToCompanyName` then `canonicalize`, and takes a ticker branch or an
 * exact name match. A row whose slug reaches neither lands on the empty state,
 * which is a directory row that goes nowhere. So every href is PROVED before
 * it is built, by running the route's own reconstruction over the rows this
 * same read returned. No second query, and the check can only omit a row, never
 * mislead about one.
 *
 * Measured on the live head of this read, 60 rows deep: 56 carry a ticker, 59
 * of 60 prove out (54 through the ticker branch, 5 through the name branch),
 * and the single omission is a row whose alias target sat outside the window
 * that was read.
 *
 * PROVE-OUT DOES NOT DECAY WITH DEPTH, and an earlier version of this comment
 * said it did and used that as the reason the read is shallow. Measured at four
 * depths against the live corpus:
 *
 *   depth   ticker coverage   prove-out   ticker branch / name branch / omitted
 *      50            92.0%       98.0%              44 /  5 /  1
 *     100            96.0%      100.0%              94 /  6 /  0
 *     200            91.0%       99.0%             180 / 18 /  2
 *     500            83.2%       98.0%             413 / 77 / 10
 *
 * Ticker coverage does fall, 92% to 83%, and THE NAME BRANCH ABSORBS IT
 * EXACTLY: 5 rows at depth 50, 77 at depth 500. Prove-out is flat. So depth is
 * not a correctness constraint here and the read could go deeper safely.
 * It is shallow for the ordinary reason instead: the block draws six rows, and
 * a 500 row read to render six is 494 rows fetched to be thrown away.
 *
 * NO STALENESS AND NO CLOCK. Nothing here records when the corpus last moved,
 * and "as of" over a `last_updated` column would be a claim about the pipeline
 * this file cannot check.
 *
 * Nothing is averaged, divided or scored. The ordering is a count of real rows.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalize } from "@/lib/company-intel";
import { TICKER_RE, slugToCompanyName } from "@/lib/data-access/aliasResolver";
import { isNoiseName } from "@/app/api/companies/route";

/** One directory row, already resolved to something that renders. */
export interface AskCompanyRow {
  id: string;
  /**
   * Null when the row carries no ticker. The chip column keeps its width so
   * the names stay aligned; nothing is drawn in it. A row with no ticker is
   * still a real company (Anthropic and OpenAI are both in the head of this
   * read), so it is not dropped for the sake of a tidy column.
   */
  ticker: string | null;
  name: string;
  /** The sector. Null when the row has none; no substitute is put in its place. */
  detail: string | null;
  /** Proved to resolve. See `resolvesTo`. */
  href: string;
}

export interface AskCompaniesLoad {
  /**
   * The rows, or null when the read FAULTED. An empty array is a read that
   * answered and found nothing, which is a different fact and the screen says
   * a different thing about it.
   */
  data: AskCompanyRow[] | null;
  stage: AskCompaniesStage;
}

export type AskCompaniesStage = "ready" | "error";

/**
 * How deep the read goes, and how many rows the block draws.
 *
 * READ_LIMIT is the smallest window that keeps the proof honest with room to
 * spare, not a correctness floor: prove-out is flat at 98% to 100% from depth
 * 50 to depth 500 (the table in the header), so this could be deeper and is
 * not, because six rendered rows do not justify five hundred fetched ones.
 *
 * SHOWN is six rather than the prototype's three because three rows out of a
 * corpus this size read as a sample rather than as a way in.
 *
 * IT IS NOT A FIT. An earlier version of this comment claimed six was what the
 * scroll region holds at 390 without running past the composer. Measured on the
 * running page at 390x844: the region is `clientHeight` 497 against
 * `scrollHeight` 798, and exactly ONE row is fully visible before the reader
 * scrolls. Every count above one is a scroll, so six is a choice about how far
 * the list goes, not about what fits, and the number should be argued on that
 * ground or moved.
 */
const READ_LIMIT = 50;
const SHOWN = 6;

/** The columns the directory needs. A subset of what `/api/companies` selects. */
const DIRECTORY_COLS = "id, name, ticker, sector";

export interface DirectoryReadRow {
  id: string;
  name: string | null;
  ticker: string | null;
  sector: string | null;
}

/**
 * The live-feed page's slug transform, which is the shipped one.
 * `src/app/live-feed/page.tsx:152` carries the reasoning: whitespace to
 * hyphens and NOTHING else touched, because punctuation is load bearing on the
 * way back through `CANONICAL`, whose keys carry theirs.
 */
function nameSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Does `/company/<slug>` land on a row this read already saw?
 *
 * This is the route's own pipeline, step for step, and that is the point of
 * writing it out rather than approximating it. `page.tsx` reconstructs the
 * name from the slug and canonicalizes it; `resolveAlias` then tries the
 * ticker branch on that string, and failing that reconstructs and canonicalizes
 * a second time before its exact name match. The second pass is a no-op for a
 * name with no hyphen in it and is NOT a no-op for one that has (Coca-Cola
 * comes back as "Coca Cola"), which is exactly the case a single pass would get
 * wrong.
 *
 * Both sets come from the same read, so a true answer here is a row that is
 * known to exist. A false answer may be a row that would in fact resolve
 * against something outside the window; the check errs toward omitting a row
 * rather than toward a link that lands nowhere.
 *
 * IT ALSO REPAIRS SOME ROWS RATHER THAN ONLY OMITTING THEM, and that is worth
 * naming because it is the reason the two branches are tried in this order.
 * `/company/BRK.B` reaches the ticker branch's own gate, `TICKER_RE`, which
 * rejects the dot, then falls through to a name match on "Brk.B" that nothing
 * carries, so the shipped route answers for Berkshire Hathaway with the empty
 * state. Here the ticker slug proves false and the NAME slug proves true, so
 * the row is emitted as `/company/berkshire-hathaway`, which renders. A ticker
 * the route cannot resolve becomes a link that works rather than a row that
 * disappears.
 *
 * IT CANNOT THROW, and the try/catch is not defensive habit. `slugToCompanyName`
 * opens with `decodeURIComponent`, which raises `URIError: URI malformed` on a
 * lone `%`, and this is called on a slug derived from a company NAME rather
 * than from a URL, so a stored name like "100% Corp" reaches it unescaped.
 * `loadAskCompanies` catches the PostgREST `error` object and nothing else, so
 * an uncaught throw here would escape the `{ data, stage }` contract entirely
 * and fail the whole server render of /ask rather than omitting one row. No
 * such name is in the corpus today, which makes it latent rather than absent.
 * A slug that cannot be decoded has not been proved, so it is `false`, which is
 * the same answer every other unprovable slug gets.
 */
export function resolvesTo(
  slug: string,
  tickers: ReadonlySet<string>,
  names: ReadonlySet<string>,
): boolean {
  try {
    const first = canonicalize(slugToCompanyName(slug)).trim();
    if (!first) return false;
    if (TICKER_RE.test(first.toUpperCase()) && tickers.has(first.toUpperCase())) return true;
    const second = canonicalize(slugToCompanyName(first)).trim();
    return second.length > 0 && names.has(second.toLowerCase());
  } catch {
    return false;
  }
}

function provedHref(
  row: DirectoryReadRow,
  tickers: ReadonlySet<string>,
  names: ReadonlySet<string>,
): string | null {
  const ticker = row.ticker?.trim() ?? "";
  if (ticker) {
    const slug = ticker.toLowerCase();
    if (resolvesTo(slug, tickers, names)) return `/company/${encodeURIComponent(slug)}`;
  }
  const slug = nameSlug(row.name ?? "");
  if (slug && resolvesTo(slug, tickers, names)) return `/company/${encodeURIComponent(slug)}`;
  return null;
}

/**
 * Rows to directory entries. Pure, so the unit test can drive it without a
 * client, and exported for that reason.
 */
export function buildAskCompanies(rows: DirectoryReadRow[], shown: number = SHOWN): AskCompanyRow[] {
  const tickers = new Set(
    rows.map((r) => r.ticker?.trim().toUpperCase() ?? "").filter((t) => t.length > 0),
  );
  const names = new Set(
    rows.map((r) => r.name?.trim().toLowerCase() ?? "").filter((n) => n.length > 0),
  );

  const out: AskCompanyRow[] = [];
  for (const row of rows) {
    if (out.length >= shown) break;
    const name = row.name?.trim() ?? "";
    // The same two gates `/api/companies` applies after its query, so the
    // directory and the desk directory cannot show different companies.
    if (name.length < 2 || isNoiseName(name)) continue;
    const href = provedHref(row, tickers, names);
    if (!href) continue;
    out.push({
      id: row.id,
      ticker: row.ticker?.trim().toUpperCase() || null,
      name,
      detail: row.sector?.trim() || null,
      href,
    });
  }
  return out;
}

/**
 * Read the directory.
 *
 * The client is passed in rather than derived here so this file and the page
 * cannot end up reading as two different sessions, which is the shape
 * `src/lib/watch-data.ts` and `src/lib/ledger-data.ts` already set. `companies`
 * carries a public read policy, so this answers signed out as well, which is
 * what the parity and width audits need.
 */
export async function loadAskCompanies(sb: SupabaseClient): Promise<AskCompaniesLoad> {
  const { data, error } = await sb
    .from("companies")
    .select(DIRECTORY_COLS)
    .not("name", "is", null)
    .not("mention_count", "is", null)
    .order("mention_count", { ascending: false, nullsFirst: false })
    .order("last_updated", { ascending: false, nullsFirst: false })
    .order("name", { ascending: true })
    .limit(READ_LIMIT);

  if (error) {
    console.error("[ask-companies] companies read", error.message);
    /* Null, never an empty list. The screen draws a failed read and an empty
       corpus as two different sentences, and it can only do that if the two
       arrive as two different values. */
    return { data: null, stage: "error" };
  }

  return { data: buildAskCompanies((data as DirectoryReadRow[] | null) ?? []), stage: "ready" };
}
