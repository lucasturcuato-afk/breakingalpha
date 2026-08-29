/**
 * company-mobile/build - the read path behind the mobile Company Intel screen.
 *
 * The screen was built against `src/components/company/mobile/fixture.ts`, a
 * transcription of the design carrying an invented ticker, an invented price,
 * a full income statement and balance sheet attributed to a REAL issuer, and
 * invented Form 4 rows naming REAL executives. That file is deleted. This is
 * what replaces it.
 *
 * It runs on the server, it makes NO MODEL CALL, and it writes nothing.
 *
 * WHAT IT READS. Nothing new. Every input is a value
 * `src/app/company/[id]/page.tsx` already resolves for the desktop tree, so
 * this adds no query, no route and no round trip:
 *
 *   getCompanyDetail        the companies row, its aliases, the tone summary,
 *                           the attention summary and up to 50 recent articles.
 *   fetchCompanyFilings     SEC filings for the resolved CIK.
 *   getInsiderTransactions  Form 4 rows for the same CIK.
 *   fetchCompanyFinancials  validated XBRL, both bases, plus the currency the
 *                           filer actually reported in.
 *   COMPANY_IDENTITY        the curated `{ industry, brief }` pair.
 *   developmentArticles     the already-classified company-event articles.
 *
 * WHAT IT REFUSES TO DO
 *
 * NO MODEL CALL, EVER, AND THIS IS THE HARD LINE. Two routes on this surface
 * reach Gemini and neither may be touched from here. `/api/company-overview`
 * POSTs to gemini-2.5-flash on a cache miss, so the business overview comes
 * from `COMPANY_IDENTITY[canonical].brief` and from nowhere else, and is absent
 * for the 5,565 of 5,599 companies with no curated entry. `/api/memo` is a
 * model call on click, so recent developments come from the article rows the
 * page has already classified. If a block ever appears to need a model call,
 * that is a different sprint: stop and say so rather than adding one.
 *
 * NO QUOTE. Price, day change, market capitalisation, P/E and the 52-week range
 * are not on any read above. The desktop surface gets them from a CLIENT fetch
 * to `/api/company-kpis`, which reaches Yahoo and carries its own loading,
 * error and staleness states. Blocking a server render on a third party is one
 * problem; quietly emitting a stale or invented quote from a shape with no
 * quote read behind it is a worse one. Omitted entirely, and the shape cannot
 * express them.
 *
 * NO SECOND CLASSIFIER. Filing rows carry the form type and nothing else, so
 * `categorizeForm()` is the only thing that decides which chip counts a row and
 * the count and the filter cannot disagree.
 *
 * NO INVENTED PERIOD. A basis renders as many columns as it has periods. GRAB
 * has one annual period and ASML has one quarterly, and padding either to a
 * fixed pair would draw a dash under a period that was never filed.
 *
 * Nothing here is averaged, divided or scored. Every figure it produces is a
 * count of real rows or a value copied off one.
 *
 * ── THE SEAM ────────────────────────────────────────────────────────────────
 *
 * Every mapper below is a PURE FUNCTION from its own inputs to exactly one
 * block of `CompanyIntelData`. They share no state, they run in any order, and
 * none of them can observe another's output, so they can be implemented
 * independently and in parallel without coordination.
 *
 * The bodies are UNWIRED. Each gives back its own empty block and is marked
 * TODO. An empty block is the honest stub: it makes the section draw the
 * sourced empty copy it already draws for a company with no rows, whereas a
 * plausible stand-in value is the exact defect this file was written to end.
 * None of them throws, because a throw here takes the desktop tree down with
 * it and the desktop tree is the surface readers are on today.
 *
 * A suggested split, three ways, by the read each group depends on:
 *
 *   buildMasthead, buildKpis, buildPrimer   getCompanyDetail + identity +
 *                                           the classified development rows
 *   buildTone                               getCompanyDetail.tone + articles
 *   buildFilings, buildFinancials,          the three SEC reads
 *   buildInsider
 *
 * The split is a suggestion; the seam is not. Do not widen a signature, do not
 * add a parameter that is another mapper's output, and do not move work into
 * `buildCompanyIntelData` itself. It composes and does nothing else.
 *
 * THE GATE IS STILL SHUT while the bodies are stubs.
 * `mobileFixtureScreensEnabled()` in `src/app/company/[id]/page.tsx` fails
 * closed on production, so no reader sees an empty screen in the meantime. It
 * may be opened once every mapper below is wired and a rendered proof exists
 * for a company that has rows in each block.
 */

import type { CompanyDetail } from "@/lib/data-access/getCompanyDetail";
import type { InsiderTransactionsResult } from "@/lib/data-access/getInsiderTransactions";
import type { CompanyFinancialsResult } from "@/lib/financial-facts";
import type { CompanyFilingsResult } from "@/lib/sec-filings";
import type { CompanyArticle, CompanyIdentity } from "@/lib/company-intel";
import type {
  CompanyIntelData,
  CompanyKpiCell,
} from "@/components/company/mobile/types";

/**
 * Everything the page has in hand by the time it draws.
 *
 * Passed as one object rather than six positional arguments so a caller cannot
 * transpose two reads that happen to share a shape, and so a mapper's inputs
 * are named at the call site.
 */
export interface CompanyMobileReads {
  detail: CompanyDetail;
  filings: CompanyFilingsResult;
  insider: InsiderTransactionsResult;
  financials: CompanyFinancialsResult;
  /** `COMPANY_IDENTITY[canonical]`, or null for an uncurated company. */
  identity: CompanyIdentity | null;
  /** `filterAndClassifyArticles(...).filter(a => a._isDevelopment)`. */
  developments: CompanyArticle[];
}

/** The masthead's four scalars. Split out so `buildMasthead` names its block. */
export type CompanyMastheadBlock = Pick<
  CompanyIntelData,
  "ticker" | "sector" | "name" | "memoCorpus"
>;

/* ── mappers ────────────────────────────────────────────────────────── */

/**
 * Ticker, sector, display name, and the corpus count on the memo control.
 *
 * `detail.ticker` and `detail.sector` are both nullable on the row. An absent
 * ticker is "" and the line simply does not draw it; it is never the slug, the
 * company name, or a dash standing in for one, because each of those reads as
 * a symbol a reader could look up.
 *
 * `memoCorpus` is a COUNT of indexed articles and never a rate, a score or a
 * confidence. `detail.articles` is the list it counts.
 *
 * TODO(wiring): unwired. Gives back the empty block.
 */
export function buildMasthead(detail: CompanyDetail): CompanyMastheadBlock {
  void detail;
  return { ticker: "", sector: "", name: "", memoCorpus: "" };
}

/**
 * The KPI grid.
 *
 * TWO CELLS, NOT FOUR. `MARKET CAP` and `P / E` are omitted with the rest of
 * the quote: see the header. What is left is read from `detail` alone.
 *
 * MENTIONS. The design labels this cell `MENTIONS · 30D` and there is no
 * 30-day read anywhere on this page. `detail.mentions` is an ALL-TIME sum,
 * `detail.mentions7d` is eight daily slots, and `detail.attention.currentCount`
 * is a 7-day count. Relabel the cell to the window that is actually read,
 * `MENTIONS · 7D` off `attention.currentCount`, rather than putting a 30-day
 * label over a number measured across a different window.
 *
 * SOURCES. The design's `primary + tier-1` meta line has no source: nothing
 * tiers a publisher on this path. The count itself is real and derivable as
 * `new Set(detail.articles.map(a => a.source)).size`. Emit the count with NO
 * meta line rather than a meta line nothing supports.
 *
 * ARTICLE TONE. `detail.tone.levelLabel` for the value, one of the closed five,
 * and `formatEvidence(detail.tone.evidence)` for the meta. `tone` on the cell
 * is tinted off `levelPolarity(detail.tone.level)` and is never pinned. Omit
 * the cell entirely when `detail.tone.sufficient` is false: "not enough
 * coverage to state a level" is not a level.
 *
 * TODO(wiring): unwired. Gives back no cells.
 */
export function buildKpis(detail: CompanyDetail): CompanyKpiCell[] {
  void detail;
  return [];
}

/**
 * The Primer: lede, identity card, business overview, key figures, recent
 * developments, footnote.
 *
 * IDENTITY is sector and industry, both off `detail`, and no third row. There
 * is no headquarters column on any table; see the header on `types.ts` for the
 * one mapper line that would change that and why it is not free.
 *
 * OVERVIEW is `identity?.brief` and nothing else. "" for the great majority of
 * companies, and `PrimerSection` omits the whole block for "" rather than
 * drawing a heading over an empty well. NEVER `/api/company-overview`.
 *
 * KEY FIGURES may carry nothing at all. `EV / EBITDA` has zero sources
 * repo-wide, `P / E` and `52-WEEK RANGE` are quote data, and the design's
 * fourth cell is an operational metric for which no table, column or extractor
 * exists. What CAN be sourced is validated XBRL off `financials`, which is why
 * this mapper takes it. Emit only figures with a fact behind them; an empty
 * list draws `PrimerKeyStats`' own sourced sentence.
 *
 * DEVELOPMENTS are one entry per already-classified development article, from
 * `developments`. NEVER `/api/memo`, which is a model call on click.
 *
 * TODO(wiring): unwired. Gives back the empty block.
 */
export function buildPrimer(
  detail: CompanyDetail,
  identity: CompanyIdentity | null,
  developments: CompanyArticle[],
  financials: CompanyFinancialsResult,
): CompanyIntelData["primer"] {
  void detail;
  void identity;
  void developments;
  void financials;
  return {
    lede: "",
    identity: [],
    overview: "",
    keyFigures: [],
    developments: [],
    footnote: "",
  };
}

/**
 * The tone section: level, direction, evidence line, disclaimer, and the rows
 * under "what moved the reading".
 *
 * THE PROSE IS A DATABASE READ, NOT A MODEL CALL. `ToneEvidenceRow.reading` is
 * `articles.sentiment_reason` verbatim, written by Gemini during the nightly
 * Python ingest and stored on the row. `getCompanyDetail` already carries it as
 * `CompanyDetailArticle.sentimentReason`. The Next render never touches an LLM
 * for it.
 *
 * THE DESIGN'S COPY IS NOT PRODUCIBLE and must not be reproduced:
 *
 *   level      the design says "Constructive", which is outside the closed
 *              five-word vocabulary. `levelToLabel()` emits Strongly Positive,
 *              Positive, Mixed, Negative or Strongly Negative and no sixth
 *              word is reachable. Null when `tone.sufficient` is false, which
 *              `ToneSection` draws on its own render path.
 *   direction  the design says "▲ improving". `formatDirection()` emits
 *              "Improving · was Mixed last week" and the prior-level clause is
 *              mandatory, so the bare adjective is not a shape this data takes.
 *              "" when suppressed.
 *   evidence   the design says "Based on 34 articles from 11 sources".
 *              `ToneEvidence` is `{ total, positive, neutral, negative }` and
 *              carries NO source count. `formatEvidence()` is the sentence that
 *              exists.
 *   rows       the design groups, "7 ARTICLES · AUG 1". There is no clustering
 *              on this surface: no grouping pass, no date bucketing, and the
 *              desktop renders one article per row. ONE ARTICLE PER ROW here
 *              too, `meta` being that article's source and date.
 *
 * `levelTone` and each row's `direction` are read off the data. A pinned green
 * paints a deteriorating tone as an improving one, and a two-way row tint
 * paints a bearish article as merely mixed.
 *
 * TODO(wiring): unwired. Gives back the insufficient-level block, which is the
 * one branch that states nothing about the company.
 */
export function buildTone(detail: CompanyDetail): CompanyIntelData["tone"] {
  void detail;
  return {
    level: null,
    direction: "",
    levelTone: "flat",
    evidence: "",
    disclaimer: "",
    rows: [],
  };
}

/**
 * The filings list.
 *
 * One row per `CompanyFiling`, form type carried through AS IT IS STORED
 * including null, because `sec_filings.form_type` is nullable and
 * `categorizeForm()` already takes null. `summary` likewise stays null when the
 * summariser has not run for that accession; the section draws the row without
 * a summary rather than inventing one.
 *
 * No count is emitted. `filingCounts()` derives the chip labels from the rows
 * that are actually present, so a chip can only ever claim what tapping it
 * produces.
 *
 * TODO(wiring): unwired. Gives back no rows.
 */
export function buildFilings(filings: CompanyFilingsResult): CompanyIntelData["filings"] {
  void filings;
  return { rows: [] };
}

/**
 * The financials table, both bases.
 *
 * PERIODS ARE A LIST. Emit exactly the periods the basis has, newest first, and
 * exactly as many `values` entries per row as there are periods. GRAB has one
 * annual period and ASML has one quarterly; padding either to a pair draws a
 * dash under a period that does not exist, which reads as a missing figure
 * rather than as an unfiled period.
 *
 * THE CURRENCY NOTE COMES FROM `currencyNote(financials.reportingCurrency)` in
 * `lib/reporting-currency.ts`, which already exists. It is never the literal
 * "reported in USD": ASML reports in EUR, Taiwan Semiconductor in TWD, Novo
 * Nordisk in DKK, and this repo has no FX source to convert with. Values go
 * through `formatMoney(value, reportingCurrency)` for the same reason, so a
 * non-USD figure can never carry a bare dollar sign.
 *
 * TODO(wiring): unwired. Gives back both bases empty, which `FinancialsSection`
 * draws as its sourced section-level empty rather than as an empty table.
 */
export function buildFinancials(
  financials: CompanyFinancialsResult,
): CompanyIntelData["financials"] {
  void financials;
  return {
    annual: { periods: [], bands: [] },
    quarterly: { periods: [], bands: [] },
    note: "",
  };
}

/**
 * The insider record.
 *
 * `routine` AND `other` ARE `[]`, AND THAT IS NOT A STUB. Measured on the live
 * table: `insider_transactions` carries exactly two transaction codes across
 * all 5,044 stored rows, S at 4,604 and P at 440, and every row is open market.
 * Nothing in the ingest writes an A, M, F, G or C row, so those two groups have
 * no source to read from. They are structurally empty database-wide rather than
 * empty for one issuer, and `InsiderSection` self-omits each group on
 * `length > 0`, so a reader sees neither.
 *
 * They stay in the shape because the grouping is the desktop `InsiderTab`'s own
 * model, and the day the extractor writes those codes the rows land in the
 * right group instead of in a group that had been deleted.
 *
 * TODO(wiring): `openMarket` unwired. Gives back no rows.
 */
export function buildInsider(insider: InsiderTransactionsResult): CompanyIntelData["insider"] {
  void insider;
  return { openMarket: [], routine: [], other: [] };
}

/* ── the assembler ──────────────────────────────────────────────────── */

/**
 * Compose one screen's data from one page's reads.
 *
 * COMPOSES AND NOTHING ELSE. No formatting, no fallback, no `??`. Every value
 * it gives back came out of exactly one mapper, so a figure a reader disputes
 * has exactly one place to have come from.
 *
 * NULL means no company resolved, and the screen draws its loader for a null
 * rather than a sentence about the reader. It is deliberately the ONLY absent
 * state this gives back: a company that resolved but has no filings is not an
 * absent company, and each section says so in its own sourced copy.
 */
export function buildCompanyIntelData(reads: CompanyMobileReads | null): CompanyIntelData | null {
  if (!reads) return null;

  return {
    ...buildMasthead(reads.detail),
    kpis: buildKpis(reads.detail),
    primer: buildPrimer(reads.detail, reads.identity, reads.developments, reads.financials),
    tone: buildTone(reads.detail),
    filings: buildFilings(reads.filings),
    financials: buildFinancials(reads.financials),
    insider: buildInsider(reads.insider),
  };
}
