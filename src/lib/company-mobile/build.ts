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

import { formatEvidence, levelPolarity, type TonePolarity } from "@/lib/tone";
import { formatMoney } from "@/lib/reporting-currency";

import type { CompanyDetail } from "@/lib/data-access/getCompanyDetail";
import type { InsiderTransactionsResult } from "@/lib/data-access/getInsiderTransactions";
import type { CompanyFinancialsResult } from "@/lib/financial-facts";
import type { CompanyFilingsResult } from "@/lib/sec-filings";
import type { CompanyArticle, CompanyIdentity } from "@/lib/company-intel";
import type {
  CompanyIntelData,
  CompanyKeyFigure,
  CompanyKpiCell,
  CompanyPrimerRow,
  ToneDirection,
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
 * WIRED. Four reads off `detail`, no derivation on any of them.
 *
 * `ticker` is null on 4,635 of 5,599 companies (964 carry one), so the absent
 * case is the common case and it renders as nothing at all. Not a dash, not the
 * slug and not the display name: each of those reads as a symbol somebody could
 * put into a quote box.
 *
 * `sector` is `modeOf(articles.map(r => r.sector))` inside `getCompanyDetail`,
 * which is the modal sector of this company's own indexed articles over the
 * trailing 14 days, NOT the `companies.sector` column. It is null for a company
 * with no articles in that window, and null draws nothing.
 *
 * NO `exchange`. `CompanyDetail.exchange` is a hardcoded `null` literal at
 * `getCompanyDetail.ts:231` and no exchange column exists on any table, so a
 * listing venue is not a thing this page can state. The field is off the shape
 * and must stay off it.
 *
 * NO `price` and NO `change`. Both come from a CLIENT fetch to
 * `/api/company-kpis`, which reaches Yahoo. Off the shape for the same reason.
 */
export function buildMasthead(detail: CompanyDetail): CompanyMastheadBlock {
  /* A COUNT of indexed articles, and the unit word is spelled out so it cannot
     be mistaken for a score or a rate. `detail.articles` is the 14-day window
     `getCompanyDetail` reads, capped at 50 rows by ARTICLE_LIMIT, so this is a
     count of what the memo control would actually have in hand. */
  const corpus = detail.articles.length;

  return {
    ticker: detail.ticker ?? "",
    sector: detail.sector ?? "",
    name: detail.display,
    memoCorpus: `${corpus} ${corpus === 1 ? "ARTICLE" : "ARTICLES"}`,
  };
}

/**
 * Tone polarity to the screen's tint vocabulary.
 *
 * `mixed` lands on `flat`, not on an amber. `TONE_INK` in `sections.tsx` keeps
 * amber away from a tone level on purpose: amber is the developing and awaiting
 * outcome hue, and a tone level is not an outcome.
 *
 * The polarity itself comes from `levelPolarity()` in `lib/tone.ts`, the one
 * function that turns a level into a polarity, so the KPI cell here and the
 * tone section body read the same answer.
 */
const POLARITY_INK: Record<TonePolarity, ToneDirection> = {
  positive: "up",
  mixed: "flat",
  negative: "down",
};

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
 * WIRED, AND THE LIST IS VARIABLE-LENGTH. The design draws a fixed grid of
 * four. Two of those four are quote data and are gone, and of the two that are
 * left one is conditional: a company with no indexed articles has no sources to
 * count and no coverage to read a tone off. A cell carrying an empty value is
 * the thing this file exists to prevent, so an unsourced cell is not emitted at
 * all and the grid draws however many it was handed.
 */
export function buildKpis(detail: CompanyDetail): CompanyKpiCell[] {
  const cells: CompanyKpiCell[] = [];

  /* MENTIONS. Relabelled to the window that is actually read. The design says
     30D and no 30-day read exists on this page: `detail.mentions` is an
     ALL-TIME sum and `detail.mentions7d` is eight daily slots, so
     `attention.currentCount`, a trailing 7-day count, is the only mention
     number here with a window behind it. Always emitted, including at zero,
     because zero mentions in seven days is a measured answer rather than a
     missing one. */
  cells.push({
    label: "MENTIONS · 7D",
    value: String(detail.attention.currentCount),
  });

  /* ARTICLE TONE. Omitted entirely when the window did not carry enough scored
     coverage to state a level: "not enough coverage to state a level" is not a
     level, and `levelLabel` is "" on that branch anyway. The tint goes through
     `levelPolarity()`, the same function the tone SECTION reads, so the cell
     and the section body cannot disagree. Never pinned to a colour. */
  if (detail.tone.sufficient && detail.tone.level !== null) {
    cells.push({
      label: "ARTICLE TONE",
      value: detail.tone.levelLabel,
      meta: formatEvidence(detail.tone.evidence),
      tone: POLARITY_INK[levelPolarity(detail.tone.level)],
    });
  }

  /* SOURCES. A derived count of distinct publishers over the same article list
     the primer counts, and NO meta line. The design's `primary + tier-1` has no
     source: nothing on this path tiers a publisher, and there is no primary
     flag on `articles`, so the second line would be a claim with nothing
     under it. `source` is nullable on the row, so a null is not a publisher. */
  const publishers = new Set(
    detail.articles
      .map((a) => a.source)
      .filter((name): name is string => typeof name === "string" && name.trim() !== ""),
  );
  if (publishers.size > 0) {
    cells.push({ label: "SOURCES", value: String(publishers.size) });
  }

  /* NO MARKET CAP and NO P / E. Both are quote data off the client fetch to
     `/api/company-kpis`; see the header. Two cells rather than four is the
     honest shape of what this page resolves. */
  return cells;
}

/**
 * The primer's opening line.
 *
 * A STATEMENT ABOUT THIS FILE, verifiable by reading it, and never a statement
 * about the reader. The design's own lede is "A coverage primer you could walk
 * into an interview with", which addresses the reader and promises a use; this
 * says what the block below is made of instead. Every value the primer emits is
 * copied off a stored row or off the curated identity map, and none of them is
 * divided, averaged or scored.
 */
const PRIMER_LEDE =
  "Every line below is read from a stored row or a curated entry. Nothing is averaged, scored or inferred.";

/**
 * The closing caveat. The house line, matching `src/lib/waitlist-email.ts:45`.
 *
 * The design's "Nothing here is a recommendation" is the same claim in weaker
 * words. This one is the sentence the rest of the product already uses.
 */
const PRIMER_FOOTNOTE = "Informational only, not investment advice.";

/**
 * The figures the primer may draw, in the order it prefers them.
 *
 * Plain monetary facts off `financial_facts_latest`, each one a value a filer
 * reported. No ratio and no margin: a margin is a division, the primer states no
 * derived number at all, and the desktop `PrimerFinancialSnapshot` already owns
 * that digest on its own surface.
 *
 * THE FIRST TWO THAT EXIST, NOT THE FIRST TWO ON THE LIST. Measured on the live
 * table, Broadcom's newest annual column carries `revenue` and no `net_income`,
 * so a mapper pinned to those two exact keys drew ONE cell into a two-column
 * grid and left the second column painted in the grid's own border colour. That
 * reads as a figure that failed to arrive. Walking the list until two facts are
 * in hand fills the row with figures that are all equally real, and the full
 * ledger stays where it already lives, in the Financials section.
 *
 * TWO IS THE WHOLE CONTRACT. The primer names two figures and the grid is two
 * columns wide. Nothing is hidden by the cap: every fact this filer reported is
 * on the Financials section under its own period column.
 */
const PRIMER_FIGURES: { key: string; label: string }[] = [
  { key: "revenue", label: "REVENUE" },
  { key: "net_income", label: "NET INCOME" },
  { key: "operating_income", label: "OPERATING INCOME" },
  { key: "gross_profit", label: "GROSS PROFIT" },
];

/** How many figures the two-column grid draws when the facts are there. */
const PRIMER_FIGURE_COUNT = 2;

/**
 * The newest period the filer actually filed, on whichever basis carries one.
 *
 * ANNUAL FIRST, QUARTERLY ONLY IF THERE IS NO ANNUAL. Measured on the live
 * table, GRAB carries exactly one annual period and ASML exactly one quarterly,
 * so a mapper that read `annual.periods[0]` alone would draw nothing for a real
 * filer with real facts on file. Null when neither basis carries a period,
 * which is every company with no CIK.
 */
function latestFiledPeriod(
  financials: CompanyFinancialsResult,
): { period: CompanyFinancialsResult["annual"]["periods"][number]; view: CompanyFinancialsResult["annual"] } | null {
  const annual = financials.annual.periods[0];
  if (annual) return { period: annual, view: financials.annual };
  const quarterly = financials.quarterly.periods[0];
  if (quarterly) return { period: quarterly, view: financials.quarterly };
  return null;
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
 * WIRED. Four blocks, each variable-length, each self-pruning.
 *
 * IDENTITY is two rows at most and often fewer. Sector is `detail.sector`, the
 * modal sector of this company's own 14-day articles, absent for a company with
 * none. Industry is `COMPANY_IDENTITY[canonical].industry`, a curated map with
 * 34 entries against 5,599 companies, absent for the other 5,565.
 * `detail.industry` is NOT read: it is a hardcoded `null` literal at
 * `getCompanyDetail.ts:231`, so reading it would be reading nothing.
 *
 * NO HEADQUARTERS ROW. No column on any table carries it, and `CompanyIdentity`
 * is `{ industry, brief }` and nothing else. It is one mapper line away and the
 * line does not exist: Yahoo's `assetProfile` payload is already on the wire and
 * carries `city` and `state`, and `quoteSummary.ts:111-115` drops both before
 * anything can read them, while `company-overview.ts:72` separately instructs
 * the model to strip it. Wiring it means changing the Yahoo mapper first, and
 * that mapper is a client fetch this screen does not make. Absent, not guessed.
 *
 * OVERVIEW is `identity.brief` and nothing else, so it is "" for 5,565 of 5,599
 * companies and `PrimerSection` omits the whole block for "".
 *
 *   NEVER `/api/company-overview`. That route POSTs to gemini-2.5-flash on a
 *   cache miss. A model call on a server render path is a hard stop, not a
 *   fallback, and this mapper does not have one.
 *
 *   NEVER `companies.description` either. Measured on the live table: 0 non-null
 *   rows out of 5,599. It is a dead column, so reading it would add a query that
 *   can only ever answer null.
 *
 * KEY FIGURES are validated XBRL and nothing else: the first two facts the
 * filer reported off its newest filed period, with the period named in the
 * label so a figure can never float free of the column it was filed under.
 * Values go through `formatMoney(value, reportingCurrency)` so a filer
 * reporting in EUR, TWD or DKK can never carry a bare dollar sign, and nothing
 * here is divided: every figure is a value copied off a fact row.
 *
 *   NO `EV / EBITDA`. Zero sources repo-wide; the only occurrences anywhere in
 *   this repo are examples inside LLM prompts.
 *
 *   NO `P / E` and NO `52-WEEK RANGE`. Quote data off the client fetch to
 *   `/api/company-kpis`; see the header.
 *
 *   NO `NUCLEAR CAPACITY`, and no operational metric of any kind. There is no
 *   per-company operational-metric mechanism at all: no table, no column, no
 *   extractor. A generation capacity figure beside a real issuer is the most
 *   convincing kind of invented number there is.
 *
 *   The grid is therefore EMPTY for a company with no CIK and no filed period,
 *   which is the common case, and it draws however many figures it was handed
 *   rather than padding to the design's four.
 *
 * DEVELOPMENTS are one line per already-classified development article, off the
 * rows the page has in hand. The line is the article's stored `summary` when it
 * has one and its title otherwise, both of which are plain Postgres columns
 * written during the nightly ingest.
 *
 *   NEVER `/api/memo`. That is a model call on click, and this runs on render.
 *
 *   NOT TRUNCATED. The pool is already bounded upstream by `fetchCompanyArticles`,
 *   so a cap here would only hide rows the page had already paid to read.
 */
export function buildPrimer(
  detail: CompanyDetail,
  identity: CompanyIdentity | null,
  developments: CompanyArticle[],
  financials: CompanyFinancialsResult,
): CompanyIntelData["primer"] {
  const identityRows: CompanyPrimerRow[] = [];
  if (detail.sector) identityRows.push({ label: "Sector", value: detail.sector });
  if (identity?.industry) identityRows.push({ label: "Industry", value: identity.industry });

  const keyFigures: CompanyKeyFigure[] = [];
  const filed = latestFiledPeriod(financials);
  if (filed) {
    for (const figure of PRIMER_FIGURES) {
      if (keyFigures.length === PRIMER_FIGURE_COUNT) break;
      const cell = filed.view.grid[figure.key]?.[filed.period.key];
      if (!cell || !Number.isFinite(cell.value)) continue;
      keyFigures.push({
        /* The period is IN the label. A figure that does not name its column is
           a figure a reader has to guess the year of, and the two bases carry
           different ones. */
        label: `${figure.label} · ${filed.period.label.toUpperCase()}`,
        value: formatMoney(cell.value, financials.reportingCurrency),
        scale: "figure",
      });
    }
  }

  return {
    lede: PRIMER_LEDE,
    identity: identityRows,
    overview: identity?.brief ?? "",
    keyFigures,
    developments: developments
      .map((article) => {
        const summary = article.summary?.trim();
        return summary && summary.length > 0 ? summary : article.title.trim();
      })
      .filter((line) => line.length > 0),
    footnote: PRIMER_FOOTNOTE,
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
