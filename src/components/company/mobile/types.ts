/**
 * Company Intel, mobile. The SHAPE of the screen's data, and nothing else.
 *
 * Split out of the deleted `./fixture` so the client component and its sections
 * can name these types without pulling an invented company into the browser
 * bundle. A `"use client"` module that value-imports a fixture downloads every
 * string in it: a gate stops the render, not the download, so invented
 * financials and invented Form 4 rows reached `.next/static` even on a
 * production build where they could never paint.
 *
 * Types erase at compile time, so this file contributes nothing to any bundle.
 * Keep it that way. Nothing here may carry a value.
 *
 * This IS the contract the loader satisfies. `src/lib/company-mobile/build.ts`
 * assembles it from the four reads `src/app/company/[id]/page.tsx` already
 * resolves server-side: `getCompanyDetail`, `fetchCompanyFilings`,
 * `getInsiderTransactions` and `fetchCompanyFinancials`. No new API surface,
 * and no model call on the render path.
 *
 * WHAT THIS SHAPE DELIBERATELY CANNOT EXPRESS, and why. Every omission below is
 * a measured absence, not an oversight. A field kept for a value no read
 * produces is an invitation to invent one, which is the defect this whole file
 * exists to prevent.
 *
 *   exchange           `CompanyDetail.exchange` is a hardcoded `null` literal
 *                      at `getCompanyDetail.ts:231`. There is no exchange
 *                      column on `companies`. A ticker line that says
 *                      "CEG · NASDAQ" would be asserting a listing venue no
 *                      row records.
 *
 *   headquarters       No column on any table. `CompanyIdentity` in
 *                      `company-intel.ts` is `{ industry, brief }` and nothing
 *                      else, and the desktop `PrimerSnapshot` renders exactly
 *                      four fields with no fifth slot. One mapper line away
 *                      but not free: Yahoo's `assetProfile` payload already on
 *                      the wire carries `city` and `state`, and
 *                      `quoteSummary.ts:111-115` drops them before they reach
 *                      anything. `company-overview.ts:72` separately instructs
 *                      the model to strip it. Wiring it means changing the
 *                      Yahoo mapper first; until then the row is absent rather
 *                      than guessed.
 *
 *   price, change,     NOT on any of the four page reads. The desktop surface
 *   market cap,        gets them from a CLIENT fetch to `/api/company-kpis`,
 *   P/E, 52-week       which reaches Yahoo. That is a second data path with its
 *                      own loading, error and staleness states, and this shape
 *                      is the set of things already resolved on the server. A
 *                      price rendered from a server shape that has no price
 *                      read behind it can only be a stale copy or an invention.
 *                      The whole price line and those KPI cells are omitted.
 *
 *   EV / EBITDA        Zero sources repo-wide. The only occurrences anywhere
 *                      are examples inside LLM prompts.
 *
 *   operational        No per-company operational-metric mechanism exists at
 *   metrics            all: no table, no column, no extractor. A generation
 *                      capacity figure beside a real ticker is the single most
 *                      convincing kind of invented number.
 *
 *   entry, following   `theses`, `user_claims` and `watchlist` all exist and
 *                      all carry real rows, but `/company/[id]` resolves NONE
 *                      of them. Rendering the reader's own record here is a new
 *                      read, not a rewire of an existing one, and it is out of
 *                      this sprint rather than out of the product.
 */

/**
 * How a tone reading is tinted.
 *
 * Never a hardcoded green. The design draws a company that happened to be read
 * constructively, and pinning the colour to that would paint a deteriorating
 * tone as an improving one the moment this reads a real level. The word always
 * carries the meaning; the colour only agrees with it.
 */
export type ToneDirection = "up" | "down" | "flat";

/**
 * How one article's contribution to the reading is tinted.
 *
 * THREE STATES, NOT TWO. This was `"up" | "mixed"`, which cannot express a
 * negative row. The rows are built from `CompanyDetailArticle.sentiment`, which
 * is the article's own three-state label, so a bearish article had nowhere to
 * land and would have arrived tinted as merely mixed. A negative reading drawn
 * in amber understates it, silently, and only for the rows that matter most.
 *
 * Kept as its own vocabulary rather than reusing `ToneDirection`: "mixed" is a
 * statement about one article's sentiment label, while "flat" is a statement
 * about a trend across a window. They are different claims.
 */
export type ToneRowDirection = "up" | "mixed" | "down";

export interface CompanyKpiCell {
  label: string;
  value: string;
  /** Second line under the value. Absent on a bare count. */
  meta?: string;
  /** Set only on a cell the design tints, and tinted off the reading. */
  tone?: ToneDirection;
}

export interface CompanyPrimerRow {
  label: string;
  value: string;
}

export interface CompanyKeyFigure {
  label: string;
  value: string;
  /** Long values drop to the mono scale in the design. */
  scale: "figure" | "mono";
}

export interface ToneEvidenceRow {
  /**
   * Reading of the coverage, one sentence.
   *
   * A PLAIN POSTGRES READ, not a model call. This is `articles.sentiment_reason`
   * verbatim, written by Gemini during the nightly Python ingest and stored on
   * the row. The Next render never touches an LLM to produce it.
   */
  reading: string;
  /** Source and date for the one article this row is. Machine record. */
  meta: string;
  direction: ToneRowDirection;
}

/**
 * Structurally a `FilingLike`, so `countByCategory` and `applyFilter` from
 * `lib/filing-categories.ts` run on these rows directly.
 *
 * NO `category` FIELD. It used to carry one alongside the form, which is a
 * second classifier that can disagree with the shipped one. The chip counts and
 * the chip filter now both go through `categorizeForm(formType)`, so a row can
 * only ever be counted under the chip that draws it.
 */
export interface CompanyFilingRow {
  /**
   * NULLABLE, matching the column and matching `FilingLike`.
   *
   * `CompanyFiling.formType` is `string | null` because `sec_filings.form_type`
   * is nullable, and `categorizeForm()` already takes `string | null | undefined`
   * for exactly that reason. Typing it `string` here forced a cast or a
   * fabricated form label at the seam.
   */
  formType: string | null;
  date: string;
  /** Null when the summariser has not run for this accession yet. */
  summary: string | null;
}

export interface FinancialsRow {
  label: string;
  /**
   * One value per period column, newest first, and EXACTLY as many entries as
   * the basis has periods. Null renders the design's dash, which means "this
   * period exists and the cell is empty". Padding a short row to a fixed width
   * would draw that dash under a period that does not exist, which is a
   * different and false statement.
   */
  values: (string | null)[];
  /** A derived ratio sits one indent in, at the muted scale. */
  derived?: boolean;
}

export interface FinancialsBand {
  band: string;
  rows: FinancialsRow[];
}

/**
 * One reporting basis: its period columns and the bands drawn under them.
 *
 * `periods` IS A LIST, NOT A PAIR. It was `[string, string]`, and a 2-tuple
 * cannot represent what the database carries: measured on the live rows, GRAB has
 * exactly one annual period and ASML has exactly one quarterly. A pair type
 * forces such a filer to either lose its only column or gain an invented
 * second one. The header row and the value cells both read this length.
 */
export interface FinancialsBasis {
  periods: string[];
  bands: FinancialsBand[];
}

export interface InsiderOpenMarketRow {
  name: string;
  role: string;
  date: string;
  code: string;
  shares: string;
  price: string;
  heldAfter: string;
}

export interface InsiderCompactRow {
  date: string;
  code: string;
  name: string;
  detail: string;
}

export interface CompanyIntelData {
  ticker: string;
  sector: string;
  name: string;
  /** Article count on the memo control. A count, never a rate. */
  memoCorpus: string;
  kpis: CompanyKpiCell[];
  primer: {
    lede: string;
    /**
     * Sector and industry only. See the header on headquarters: the column does
     * not exist, so the row is absent rather than approximated.
     */
    identity: CompanyPrimerRow[];
    /**
     * Curated business overview, or "" for absent.
     *
     * `COMPANY_IDENTITY[canonical].brief` ONLY, and coverage is 34 of 5,599
     * companies, so this is empty for almost every reader. Empty must stay
     * empty: `PrimerSection` omits the whole block rather than drawing a
     * heading over nothing.
     *
     * NEVER `/api/company-overview`. That route POSTs to gemini-2.5-flash on a
     * cache miss, and a model call on a page render path is a different sprint
     * with a different set of failure states.
     */
    overview: string;
    keyFigures: CompanyKeyFigure[];
    developments: string[];
    footnote: string;
  };
  tone: {
    /**
     * Null when the trailing 7 day window did not carry enough coverage to
     * state a level. `ToneReadout` treats that as its own render path with its
     * own copy rather than as a level of zero, and so does this screen.
     *
     * A CLOSED VOCABULARY of five: Strongly Positive, Positive, Mixed,
     * Negative, Strongly Negative. `levelToLabel()` in `lib/tone.ts` is the
     * only thing that produces it. No sixth word is reachable.
     */
    level: string | null;
    /**
     * The direction phrase, or "" when suppressed.
     *
     * `formatDirection()` emits "Improving · was Mixed last week" and always
     * carries the prior-level clause, so a bare arrow-and-adjective is not a
     * shape this data can take.
     */
    direction: string;
    /** Tints the level and the direction. Never assumed. */
    levelTone: ToneDirection;
    /**
     * The counts behind the level. `ToneEvidence` is
     * `{ total, positive, neutral, negative }` and carries NO source count, so
     * a sentence naming a number of sources is not producible here.
     */
    evidence: string;
    disclaimer: string;
    /**
     * ONE ARTICLE PER ROW. There is no clustering on this surface: no grouping
     * pass, no date bucketing, and the desktop `ToneEvidenceList` renders one
     * article per row too. A row reading "7 ARTICLES · AUG 1" would be asserting
     * a cluster that nothing computed.
     */
    rows: ToneEvidenceRow[];
  };
  filings: {
    /**
     * NO COUNTS FIELD, deliberately.
     *
     * The chip labels are derived from `rows` at render time by
     * `filingCounts()` in `sections.tsx`. A stored count is a number the chip
     * asserts and the data cannot support: this carried
     * `{ all: 47, events: 22, insider: 11, quarterly: 9 }` over six rows, so
     * "Events 22" drew two. Deriving makes the chip a description of what
     * tapping it produces instead of a claim about a corpus that is not here.
     */
    rows: CompanyFilingRow[];
  };
  financials: {
    /**
     * Both bases are carried because the toggle is a real control, and a toggle
     * that redraws the same numbers under a different label would be a false
     * statement about the period.
     */
    annual: FinancialsBasis;
    quarterly: FinancialsBasis;
    /**
     * The currency line, from `currencyNote()` in `lib/reporting-currency.ts`.
     * NEVER the string "USD" typed inline: ASML reports in EUR, Taiwan
     * Semiconductor in TWD, Novo Nordisk in DKK, and there is no FX source in
     * this repo to convert with.
     */
    note: string;
  };
  insider: {
    openMarket: InsiderOpenMarketRow[];
    /**
     * STRUCTURALLY EMPTY DATABASE-WIDE, and that is a fact about the ingest
     * rather than about any one issuer. `insider_transactions` carries exactly
     * two transaction codes across all 5,044 stored rows, S (4,604) and P
     * (440), and both are open market. Nothing writes an A, M, F, G or C row,
     * so these two lists have no source to read from and are `[]`.
     *
     * They stay on the shape rather than being deleted because the grouping is
     * the desktop `InsiderTab`'s own model and the sections already self-omit
     * on `length > 0`, so a reader sees nothing today and sees the correct
     * groups the day the extractor writes those codes.
     */
    routine: InsiderCompactRow[];
    other: InsiderCompactRow[];
  };
}
