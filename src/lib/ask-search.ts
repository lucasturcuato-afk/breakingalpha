/**
 * ask-search - what Ask's field reaches, and what the screen is allowed to say
 * about it.
 *
 * WHAT THIS REPLACED, and the replacement is the whole unit. The field ran
 * `String.includes` over the fifty rows the server had already put in the RSC
 * payload. Against a corpus of thousands that is well under one percent of it,
 * and the probe that settles it is `starbucks`: Starbucks is in `companies`
 * with ticker SBUX and hundreds of mentions, and typing its name returned
 * NOTHING, because it was not one of the fifty. The copy under the field was
 * accurate about that ("Nothing beyond this list was searched"), which is
 * exactly why copy alone could not fix it: an accurate sentence about a ceiling
 * is still a ceiling, and a reader only ever read it AFTER already failing.
 *
 * WHAT IT DOES NOW. The field queries `GET /api/companies?q=`, which is an
 * `ilike` over `name` and `ticker` across the whole table. The substring filter
 * is gone; `src/lib/ask-filter.ts` is deleted with it.
 *
 * THE FOUR RULES THIS MODULE EXISTS TO HOLD:
 *
 *   1. NO UNBOUNDED FETCH. The route's default is 500 rows and measured 1.6 to
 *      1.9 seconds warm; a two-character query measured 220 to 300ms. Nothing
 *      on this screen needs five hundred rows, so the request always carries an
 *      explicit small `limit` and is never issued without a `q`.
 *
 *   2. NOTHING IS FETCHED UNDER TWO CHARACTERS, because the route ignores `q`
 *      below two and would answer with the 500-row default. Under two the
 *      screen keeps its standing directory and says what one more character
 *      buys.
 *
 *   3. NO TYPO TOLERANCE IS PROMISED, ANYWHERE. Measured: `?q=nvidai` returns
 *      zero rows. There is no trigram index, no Levenshtein and no fuzzy match
 *      on this path. The one thing that looks like forgiveness is the route's
 *      alias branch, and it is a legal-suffix redirect over a small fraction of
 *      the alias keys, not a spelling correction. The copy below says
 *      "substring of a name or a ticker" rather than anything softer.
 *
 *   4. A FAILED READ IS NEVER AN EMPTY RESULT. `AskSearchState` carries
 *      `error` and `ready` as different shapes for the same reason the loader
 *      carries `data: null` rather than `[]`.
 *
 * NO MODEL IS CALLED ON THIS PATH, WHICH IS WHY RULING 20 IS NOT IN THE WAY.
 * `DECISIONS.md:249` rules that the Ask ANSWER is a client fetch behind a
 * submit and never a server render of `?q=`; the harm it measured was RSC
 * prefetch firing `gemini-embedding-001` plus `gemini-2.5-flash` unprompted and
 * burning 2 of a reader's 15 daily messages. `/api/companies` imports
 * `getSupabaseWithUser` and `normalizeLookupKey`, calls no model, and has no
 * per-user budget to burn. The three structural properties that closed the
 * ruling on this screen are untouched: nothing links to `/ask?q=`, the URL is
 * read on mount and never written, and the server read still takes no `q`.
 */

/** Below this the route ignores `q` entirely and answers with its default. */
export const ASK_SEARCH_MIN = 2;

/**
 * How many rows a search asks for, and therefore how many can be drawn.
 *
 * A CAP, ON PURPOSE, and the reason is a fan-out that was measured rather than
 * guessed: the directory rows are `next/link`, and one keystroke against
 * forty-nine rows already fired eight RSC prefetches of company pages. Over a
 * five-hundred-row answer that scales linearly. The cap is the first half of
 * the fix; `prefetch={false}` on searched rows is the second, and both are in
 * place because either alone still leaves a real number.
 *
 * Twenty-five rather than six: a search result that hid matches would be lying
 * about how many companies carry the name, and six is a standing-list number
 * rather than an answer-list one. Where twenty-five is not all of them, the
 * copy says so instead of implying it.
 */
export const ASK_SEARCH_LIMIT = 25;

/**
 * How long the field waits after the last keystroke.
 *
 * Two hundred, matching `src/app/company/page.tsx:290`, which is the same field
 * against the same route on the desk. A shorter wait fires a request per
 * character; a longer one is felt.
 *
 * IT IS A DEBOUNCE AND NOT A SUBMIT, and that is an open question for the owner
 * rather than a decision taken here. See the PR body.
 */
export const ASK_SEARCH_DEBOUNCE_MS = 200;

/**
 * How long a pending search must last, MEASURED FROM THE KEYSTROKE, before the
 * screen admits to it.
 *
 * The 200ms debounce is inside this number. A measured warm search is 220 to
 * 300ms, so an ordinary total is 420 to 500ms from the last character and this
 * threshold is never reached: the pending sentence is drawn only when the
 * request has already run more than twice its usual length. Drawing it every
 * time would put a sentence on screen for a fifth of a second and take it away
 * again, which is a flash and not a state.
 *
 * NOTHING SKELETAL IS DRAWN AT ANY POINT. The rows already on screen stay on
 * screen and one line of copy changes. A skeleton would be a drawing of a load
 * rather than a load, and would replace real rows with fake ones to do it.
 */
export const ASK_PENDING_VISIBLE_AFTER_MS = 700;

/** How many rows the directory draws when the field is EMPTY. */
export const ASK_SHOWN = 6;

/** One row, whichever list it came from. */
export interface AskSearchRow {
  id: string;
  ticker: string | null;
  name: string;
  /** The sector. Null when the row has none; nothing stands in for it. */
  detail: string | null;
  /**
   * Proved to land, or null. NULL IS RENDERED, NOT DROPPED, and this is the
   * decision the unit had to take rather than inherit.
   *
   * 9.5% of the corpus does not resolve from its own slug. Dropping those from
   * a SEARCH result would make the empty-result sentence a lie: a reader who
   * types "Hostelworld Group", a company the corpus carries, would be told no
   * company carries that name. The row is therefore drawn, without a link and
   * without a chevron, and the copy says how many of the matches have no page.
   *
   * The STANDING directory keeps the opposite rule and still omits them, which
   * is `buildAskCompanies`'s behaviour and is not changed here. Those two rules
   * differ because the two lists answer different questions: the standing list
   * is six ways in and a row that opens nothing is a dead one, while a search
   * result answers "does Signalera carry this company at all", and an unlinked
   * row answers it.
   */
  href: string | null;
}

/** An answer that landed: the rows, and the string they answered. */
export interface AskSearchAnswer {
  query: string;
  rows: AskSearchRow[];
  /**
   * Set when the typed string matched NO row by name or ticker and the route
   * resolved it through an exact alias instead. It is a legal-suffix redirect
   * ("nvidia corp" -> "Nvidia"), never a spelling correction, and the copy
   * names it as an alias for that reason.
   */
  aliasOf: string | null;
}

/**
 * What the field is doing right now.
 *
 * `off` is the state the screen has always had, and the other three are new to
 * it: before this unit both of the directory's states were resolved on the
 * server before a byte was sent, which is why the screen documents that it has
 * no skeleton. A fetch introduces pending, failed and stale, and all three are
 * modelled here rather than collapsed.
 */
export type AskSearchState =
  | { kind: "off" }
  | {
      kind: "pending";
      query: string;
      /**
       * The last ANSWER, whole, carried forward rather than discarded.
       *
       * NOTHING BLANKS AND NOTHING SKELETAL IS DRAWN. A search that supersedes
       * an answer leaves that answer on screen until the next one lands, so the
       * list never empties and refills between two keystrokes. Null only before
       * the first answer of a run, and the screen then keeps its standing
       * directory rather than clearing to nothing.
       *
       * It carries the previous QUERY as well as the rows, and it has to: the
       * sentence under the rule describes the rows that are drawn, so while a
       * new search is still in flight that sentence has to keep naming the
       * query those rows answered. Holding the rows without the query would
       * leave a correct list under a sentence about a different string.
       */
      held: AskSearchAnswer | null;
    }
  | { kind: "error"; query: string }
  | ({ kind: "ready" } & AskSearchAnswer);

/** The request this screen is allowed to make, and the only one. */
export function askSearchUrl(query: string): string {
  return `/api/companies?q=${encodeURIComponent(query)}&limit=${ASK_SEARCH_LIMIT}`;
}

/** Does this string reach the corpus, or only the standing list? */
export function reachesCorpus(query: string): boolean {
  return query.trim().length >= ASK_SEARCH_MIN;
}

interface WireRow {
  id?: unknown;
  name?: unknown;
  ticker?: unknown;
  sector?: unknown;
  href?: unknown;
}

/**
 * The route's JSON to rows, narrowing at the boundary rather than casting
 * across it.
 *
 * A row with no usable `id` or `name` is dropped: it cannot be keyed and cannot
 * be read. An `href` that is not a string becomes null, which draws the row
 * unlinked, because the alternative is a chevron over a URL nothing proved.
 */
export function parseAskSearchRows(payload: unknown): AskSearchRow[] {
  const list = (payload as { companies?: unknown } | null)?.companies;
  if (!Array.isArray(list)) return [];
  const out: AskSearchRow[] = [];
  for (const raw of list) {
    const row = raw as WireRow;
    const id = typeof row.id === "string" ? row.id : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!id || !name) continue;
    const ticker = typeof row.ticker === "string" ? row.ticker.trim().toUpperCase() : "";
    const sector = typeof row.sector === "string" ? row.sector.trim() : "";
    out.push({
      id,
      ticker: ticker || null,
      name,
      detail: sector || null,
      href: typeof row.href === "string" && row.href.length > 0 ? row.href : null,
    });
  }
  return out;
}

/** The alias the route redirected through, or null. */
export function parseAliasOf(payload: unknown): string | null {
  const body = payload as { alias_resolved?: unknown; query_typed?: unknown } | null;
  if (body?.alias_resolved !== true) return null;
  return typeof body.query_typed === "string" ? body.query_typed : null;
}

/**
 * The route answers 200 with an `error` field rather than a status code, so a
 * failed read looks exactly like an empty one unless this is checked.
 */
export function payloadFaulted(payload: unknown): boolean {
  const err = (payload as { error?: unknown } | null)?.error;
  return typeof err === "string" && err.length > 0;
}

/** en-US, fixed, so a server locale cannot group one way and the browser another. */
function group(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * The corpus figure as it appears in a sentence, or null when the count
 * faulted. A faulted count drops the number and keeps the claim; it never
 * prints a zero, which would say the corpus is empty.
 */
/** The sentence drawn while a search is genuinely slow. */
export function pendingLine(query: string, corpusTotal: number | null): string {
  const figure = corpusFigure(corpusTotal);
  return figure ? `Reading ${figure} companies for “${query}”.` : `Reading the corpus for “${query}”.`;
}

export function corpusFigure(corpusTotal: number | null): string | null {
  return corpusTotal !== null && corpusTotal > 0 ? group(corpusTotal) : null;
}

/**
 * The line under the section rule while the field is BELOW two characters.
 *
 * It is the one place the screen tells a reader that one more character changes
 * what is being searched, and it exists because the field silently does two
 * different things on either side of that boundary.
 */
export function belowMinimumLine(corpusTotal: number | null): string {
  const figure = corpusFigure(corpusTotal);
  return figure
    ? `One more character searches all ${figure} companies by name and ticker.`
    : "One more character searches every company by name and ticker.";
}

/**
 * The standing line, drawn when the field is empty.
 *
 * TWO FACTS NOW, WHERE THERE WERE TWO BEFORE, and one of them is swapped. It
 * used to say what ordered the six rows and then that each row opens its
 * primer, filings and financials. It now says what ordered them, HOW MANY
 * companies that is out of, and that the field above is not limited to the six.
 *
 * The destination clause is what paid for the reach clause, and the trade was
 * measured rather than assumed. Adding the reach without removing anything ran
 * this line from 110 characters to 172, which cost the scroll region 17px and
 * pushed the third destination row below the fold at 375 and 390 - a regression
 * against PR 759's own headline. The chevron on every row already says the row
 * opens something; nothing on the screen said the field reached past six
 * companies. So the sentence the rows already tell is the one that goes.
 */
export function directoryLine(corpusTotal: number | null): string {
  const figure = corpusFigure(corpusTotal);
  const scope = figure ? `the ${figure} companies` : "the companies";
  return `Named most often of ${scope} Signalera covers. The field above reaches all of them by name or ticker.`;
}

/**
 * What the screen says about a search, in one sentence per fact.
 *
 * NO SENTENCE HERE PROMISES A MISSPELLING WILL BE FORGIVEN. The zero-result
 * copy names the match rule out loud instead, because a reader who typed
 * "nvidai" and got nothing is owed the reason rather than left to conclude the
 * corpus has no NVIDIA in it.
 */
export function searchBlurb(answer: AskSearchAnswer, corpusTotal: number | null): string {
  const figure = corpusFigure(corpusTotal);
  const q = answer.query;
  const state = answer;
  const n = state.rows.length;

  if (state.aliasOf !== null) {
    const canonical = state.rows[0]?.name ?? "";
    return `Nothing is named “${state.aliasOf}”. ${canonical} carries it as an alias, so that is the row below.`;
  }

  if (n === 0) {
    const scope = figure ? `None of the ${figure} companies` : "No company";
    return `${scope} Signalera has ingested has “${q}” in its name or ticker. The match is a plain substring, so a misspelling finds nothing.`;
  }

  const unlinked = state.rows.filter((r) => r.href === null).length;
  const tail =
    unlinked === 0
      ? ""
      : unlinked === n
        ? n === 1
          ? " It has no company page yet."
          : " None of them has a company page yet."
        : ` ${unlinked} of them have no company page yet.`;

  if (n >= ASK_SEARCH_LIMIT) {
    return `The ${n} most mentioned companies with “${q}” in the name or ticker. There may be more.${tail}`;
  }
  const head =
    n === 1
      ? `One company has “${q}” in its name or ticker.`
      : `${n} companies have “${q}” in the name or ticker.`;
  const of = figure ? ` Searched across all ${figure}.` : "";
  return `${head}${of}${tail}`;
}
