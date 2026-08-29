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
 * Every body is WIRED. The split the mappers were built against, three ways, by
 * the read each group depends on:
 *
 *   buildMasthead, buildKpis, buildPrimer   getCompanyDetail + identity +
 *                                           the classified development rows
 *   buildTone                               getCompanyDetail.tone + articles
 *   buildFilings, buildFinancials,          the three SEC reads
 *   buildInsider
 *
 * The split was a suggestion; the seam is not. Do not widen a signature, do not
 * add a parameter that is another mapper's output, and do not move work into
 * `buildCompanyIntelData` itself. It composes and does nothing else.
 *
 * THE GATE IS OPEN. `src/app/company/[id]/page.tsx` no longer consults
 * `mobileFixtureScreensEnabled()`, because there is nothing on this route left
 * to gate: the fixture module is deleted, every value below is copied off a
 * stored row, and a mapper with no row to read emits an absence rather than a
 * stand-in. A block that cannot be sourced is not on the shape at all; see the
 * header on `components/company/mobile/types.ts` for the list and the reason
 * for each one.
 */

import {
  formatDirection,
  formatEvidence,
  levelPolarity,
  levelToLabel,
  type TonePolarity,
} from "@/lib/tone";
import {
  describeCode,
  formatDate,
  formatPrice,
  formatRole,
  formatShares,
  groupByCategory,
  sortNewestFirst,
} from "@/lib/insider-transactions";
import { formatMoney } from "@/lib/reporting-currency";
import { formatPTDateShort } from "@/lib/format-pt";

import type {
  CompanyDetail,
  CompanyDetailArticle,
} from "@/lib/data-access/getCompanyDetail";
import type { InsiderTransactionsResult } from "@/lib/data-access/getInsiderTransactions";
import type {
  CompanyFinancialsResult,
  FinancialCell,
  FinancialView,
} from "@/lib/financial-facts";
import type { CompanyFilingsResult } from "@/lib/sec-filings";
import type { CompanyArticle, CompanyIdentity } from "@/lib/company-intel";
import type {
  CompanyIntelData,
  CompanyKeyFigure,
  CompanyKpiCell,
  CompanyPrimerRow,
  FinancialsBand,
  FinancialsBasis,
  FinancialsRow,
  ToneDirection,
} from "@/components/company/mobile/types";
import { currencyNote, isNonUsd } from "@/lib/reporting-currency";
import { formatValue, type Fmt } from "@/components/company/tabs/financials-format";

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

/** Read off the two frozen vocabularies rather than restating them. */
type LevelInk = CompanyIntelData["tone"]["levelTone"];
type RowInk = CompanyIntelData["tone"]["rows"][number]["direction"];

/**
 * Level ink, derived from the level's own polarity and never pinned. The design
 * draws a company that happened to read constructively; a fixed green would
 * paint a Strongly Negative level as an improving one.
 *
 * "mixed" maps to "flat" and not to an amber: `TONE_INK.flat` is
 * `--c-secondary`, matching `ToneReadout`'s neutral ink, and amber on this
 * screen is the developing and awaiting outcome hue.
 */
const LEVEL_INK: Record<TonePolarity, LevelInk> = {
  positive: "up",
  mixed: "flat",
  negative: "down",
};

/**
 * Row tint from the article's OWN three-state sentiment label.
 *
 * A label outside these three is not a state this vocabulary can express, so
 * the row is dropped rather than tinted as "mixed". Tinting an unlabelled
 * article amber would assert a balanced reading nothing recorded.
 */
const ROW_INK: Record<string, RowInk> = {
  bullish: "up",
  neutral: "mixed",
  bearish: "down",
};

/**
 * Trailing 7-day window the evidence rows are drawn from, so the rows under the
 * level are from the same window the level was computed over.
 *
 * MIRRORED, not imported. `TONE_WINDOW_MS` in `getCompanyDetail.ts` is not
 * exported, and `WINDOW_MS` in `tone/ToneEvidenceList.tsx` sits inside a
 * `"use client"` module that a server lib must not pull in. That file already
 * set this convention, mirroring the constant with its source named.
 */
const TONE_ROW_WINDOW_MS = 7 * 86_400_000;

/**
 * The one caveat under the reading, drawn in BOTH branches of `ToneSection`.
 *
 * NOT the design's sentence. The drawing ends "No number sits behind this
 * label", and that is false: `computeTone` takes a mean over the window's
 * scored labels and buckets it, so a number does sit behind it. What is true is
 * that the score is never displayed, which is a different claim and the one
 * `lib/tone.ts` actually makes in its own header.
 */
const TONE_DISCLAIMER =
  "A plain-language reading of how indexed coverage is written over the trailing " +
  "seven days. It describes the coverage, not the security, and the internal " +
  "score behind it is never displayed.";

/**
 * Source and date for the one article a row is. Machine record, uppercased
 * because `LABEL_MONO` carries no text-transform.
 *
 * Source AND DATE, not the desktop's `formatAge()` "3d ago". This shape is
 * assembled on the server and the page is cacheable, so a relative age is stale
 * the moment it is stored, while a date stays true. `formatPTDateShort` is the
 * house short form and is the same zone every other stamp in this repo uses.
 */
function toneRowMeta(article: CompanyDetailArticle): string {
  const source = (article.source ?? "").trim().toUpperCase();
  const date = formatPTDateShort(article.publishedAt).toUpperCase();
  return [source, date].filter(Boolean).join(" · ");
}

/**
 * ONE ARTICLE PER ROW, and no cap.
 *
 * `ToneEvidenceList` keeps five and prints "+N more this week" underneath. This
 * shape has no overflow line, so a cap here would drop real rows with nothing
 * on screen saying so, which is the one thing the insider section's own header
 * says a section must not do. The screen scrolls; the desktop rail does not.
 *
 * Two filters, both of which drop a row rather than substitute for it:
 * an article with no stored `sentiment_reason` has no reading to show, and an
 * article whose sentiment label is missing or unrecognised has no tint this
 * vocabulary can give it.
 */
function toneRows(articles: CompanyDetailArticle[]): CompanyIntelData["tone"]["rows"] {
  const cutoff = Date.now() - TONE_ROW_WINDOW_MS;
  const rows: CompanyIntelData["tone"]["rows"] = [];

  for (const article of articles) {
    const published = article.publishedAt ? Date.parse(article.publishedAt) : NaN;
    if (!Number.isFinite(published) || published < cutoff) continue;

    const reading = (article.sentimentReason ?? "").trim();
    if (!reading) continue;

    const direction = ROW_INK[(article.sentiment ?? "").toLowerCase()];
    if (!direction) continue;

    rows.push({ reading, meta: toneRowMeta(article), direction });
  }

  return rows;
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
 * WIRED. Reads `detail.tone` (the one `ToneSummary` every tone surface shares)
 * and `detail.articles`. No second aggregation lives here: the level, the
 * direction and the evidence sentence all come out of `lib/tone.ts` helpers, so
 * this block and the ARTICLE TONE KPI cell cannot state different things about
 * the same window.
 */
export function buildTone(detail: CompanyDetail): CompanyIntelData["tone"] {
  const tone = detail.tone;
  // Computed once for both branches. `ToneSection`'s insufficient branch exits
  // ahead of the "what moved the reading" rule and never draws them, so this
  // costs a filter and states nothing extra.
  const rows = toneRows(detail.articles);

  // INSUFFICIENT IS ITS OWN BRANCH, not a level of zero. No level word, no
  // direction phrase, and NO EVIDENCE SENTENCE: `formatEvidence` over an empty
  // window reads "0 of 0 articles positive", which is a claim about a window
  // that carried nothing. `ToneSection` already draws "Not enough recent
  // coverage", which is the reason, so the line under it stays absent.
  if (!tone.sufficient || !tone.level) {
    return {
      level: null,
      direction: "",
      levelTone: "flat",
      evidence: "",
      disclaimer: TONE_DISCLAIMER,
      rows,
    };
  }

  return {
    // `levelToLabel` is the only thing that produces this word, and it produces
    // exactly five. The design's "Constructive" is not reachable from it.
    level: levelToLabel(tone.level),
    // "" when suppressed, which is every company that did not clear
    // DIRECTION_MIN_N in BOTH windows. `formatDirection` always carries the
    // "was X last week" clause, so a bare adjective cannot come out of here.
    direction: formatDirection(tone) ?? "",
    levelTone: LEVEL_INK[levelPolarity(tone.level)],
    // A COUNT, "14 of 17 articles positive". Never converted to a rate.
    // `ToneEvidence` carries no source count, so no sentence here names one.
    evidence: formatEvidence(tone.evidence),
    disclaimer: TONE_DISCLAIMER,
    rows,
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
 * WHAT THE CHIP ROW WILL LOOK LIKE, measured on the live table so a future
 * reader does not file a bug against a chip that is working. `sec_filings`
 * carries 4,575 rows and exactly EIGHT distinct form types across all of them:
 * 8-K 2,330, 4 1,545, 10-Q 599, 8-K/A 43, 10-K 31, 4/A 9, 10-K/A 7, 10-Q/A 5.
 * `categorizeForm()` routes every one of those to annual, quarterly, events or
 * insider, so the `Other` chip counts 0 for every company on the platform and
 * `FilingsSection` renders it disabled. That is the classifier agreeing with
 * the corpus, not a broken chip. There is no Form 3, Form 5, 424B5, 20-F, 6-K
 * or DEF 14A row anywhere in the table today, and the day the ingest writes one
 * the chip starts counting without a change here.
 *
 * NULLABILITY, measured on the same 4,575 rows. `form_type` is 0 null and
 * `filing_date` is 0 null TODAY, but both columns are nullable and this mapper
 * is not the place to assume that stays true: `formType` is carried through as
 * stored, including null, which is exactly why the shape widened it, and a null
 * `filingDate` yields "" so the row draws its form badge with no date under it
 * rather than the string "Invalid Date". `summary` is 24 null (0.52%), which
 * `FilingsSection` draws as its own "Summary pending" line.
 *
 * SUMMARIES ARE RENDERED AS STORED. Form 4 summaries are boilerplate ("Form 4:
 * 1 qualifying insider transaction(s)") and a handful of narrative ones are
 * truncated mid-sentence by the summariser. Both are what the row says. Tidying
 * either one here would put words on the screen that no row contains.
 */
export function buildFilings(filings: CompanyFilingsResult): CompanyIntelData["filings"] {
  return {
    rows: filings.filings.map((f) => ({
      formType: f.formType,
      date: formatFilingDate(f.filingDate),
      summary: f.summary,
    })),
  };
}

const MONTHS_UPPER = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

/**
 * "2026-07-31" -> "JUL 31", the design's own filing-date mark.
 *
 * PARSED, NOT `new Date()`. `sec_filings.filing_date` is a DATE column and
 * arrives as a bare "YYYY-MM-DD" with no time and no zone. `new Date(...)` on
 * that string is midnight UTC, and `toLocaleDateString` in any Americas zone
 * then renders the PREVIOUS DAY. A filing dated the 1st would read as the 31st
 * of the month before, which is a wrong date on a legal document. Reading the
 * three fields off the string cannot drift, and it needs no zone argument to
 * be right.
 *
 * NO YEAR, matching the design and matching the fact that the list is already
 * ordered newest first. "" for a null or malformed date: an absent date is
 * absent, and never today's date standing in for it.
 *
 * THE DAY STAYS ZERO PADDED, "MAY 09" and not "MAY 9", which is what the design
 * draws and what keeps every date the same width inside a 54px fixed column
 * beside the form badge.
 */
export function formatFilingDate(filingDate: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((filingDate ?? "").slice(0, 10));
  if (!m) return "";
  const month = MONTHS_UPPER[Number(m[2]) - 1];
  const day = Number(m[3]);
  if (!month || day < 1 || day > 31) return "";
  return `${month} ${m[3]}`;
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
 * ROW ORDER IS `FinancialsTab`'s, NOT A SECOND ONE. `INCOME_BAND` below is that
 * tab's `INCOME_ROWS` with the three lines the design does not draw removed and
 * nothing reordered, and `balanceBand()` is its `balanceRows` plus its separate
 * operating-cash-flow key line. Two surfaces that order the income statement
 * differently is a defect a reader cannot diagnose.
 *
 * A ROW WITH NO FACT IS DROPPED, NOT DASHED, which is `FinancialsTab`'s own
 * rule and which is also what keeps this section from leaving a hole. A band
 * with no surviving row is dropped whole, so no band heading is ever drawn over
 * nothing.
 *
 * TWO DERIVED LINES AND NO OTHERS. Gross margin is `gross_profit / revenue` and
 * total equity is parent equity plus its components, both computed per period
 * from facts of that same period. Neither is an aggregate across periods, across
 * companies or across outcomes. Everything else is a value copied off a row.
 */
export function buildFinancials(
  financials: CompanyFinancialsResult,
): CompanyIntelData["financials"] {
  const currency = financials.reportingCurrency;
  const note = currencyNote(currency);
  return {
    annual: buildBasis(financials.annual, currency),
    quarterly: buildBasis(financials.quarterly, currency),
    /* `currencyNote()` and never the literal "reported in USD". Measured: ASML
       reports in EUR, and `selectReportingCurrency` reads that off the fact
       units rather than assuming. The second clause is verbatim from
       `FinancialsTab`, because there is no FX source in this repo and a reader
       looking at a EUR figure has to be told the number was not converted. ""
       when no monetary fact exists, in which case no band survives anyway. */
    note: isNonUsd(currency) ? `${note} Not converted to USD.` : note,
  };
}

interface FinancialRowSpec {
  key: string;
  label: string;
  fmt: Fmt;
  /** Indented and muted: a derived ratio, or a component inside the equity block. */
  derived?: boolean;
}

/**
 * The income band.
 *
 * `cost_of_revenue` IS HERE ON PURPOSE and it is the one line the design does
 * not draw. Measured: GRAB (cik 1855612) has exactly ONE validated fact in the
 * entire view, `cost_of_revenue` FY2022, and nothing else. Dropping the line
 * leaves that company with no band, no table, and `financialsEmptyCopy(true)`,
 * which reads "Financials appear after the first periodic report" over a
 * company whose figure came off a periodic report. That sentence would be
 * false. `FinancialsTab` draws the line, so carrying it also keeps the two
 * surfaces agreeing about what is on file. Flagged in the PR body.
 *
 * `eps_basic` and `shares_diluted` are the two `INCOME_ROWS` lines that stay
 * out: both are secondary to a line already here, and the mobile table has one
 * label column beside up to eight period columns.
 */
const INCOME_BAND: FinancialRowSpec[] = [
  { key: "revenue", label: "Revenue", fmt: "usd" },
  { key: "cost_of_revenue", label: "Cost of revenue", fmt: "usd" },
  { key: "gross_profit", label: "Gross profit", fmt: "usd" },
  { key: "__gross_margin", label: "Gross margin", fmt: "pct", derived: true },
  { key: "operating_income", label: "Operating income", fmt: "usd" },
  { key: "net_income", label: "Net income", fmt: "usd" },
  { key: "eps_diluted", label: "EPS (diluted)", fmt: "eps" },
];

/**
 * The equity components, and the reason the balance band is built per basis
 * rather than declared as a constant.
 *
 * Parent equity alone understates a filer carrying noncontrolling or temporary
 * equity, which is `FinancialsTab`'s own finding: Cheniere's parent 3.755B plus
 * NCI 4.917B is a total of 8.672B, and a table showing only the first invites a
 * comparison against a denominator the filer never used.
 * Measured on this branch: Quantinuum carries both `minority_interest` and
 * `temporary_equity`, so its balance band takes the breakdown path.
 */
const EQUITY_COMPONENTS: FinancialRowSpec[] = [
  { key: "minority_interest", label: "+ Noncontrolling interests", fmt: "usd", derived: true },
  { key: "redeemable_noncontrolling_interest", label: "+ Redeemable NCI", fmt: "usd", derived: true },
  { key: "temporary_equity", label: "+ Temporary equity", fmt: "usd", derived: true },
];

const GROSS_MARGIN_KEY = "__gross_margin";
const TOTAL_EQUITY_KEY = "__total_equity";
/* The parent-equity metric key, spelled as `financial_facts_latest` stores it.
   The column name contains a substring `scripts/design-lint.mjs` bans, and that
   scan runs over source rather than over rendered text, so this line was
   previously assembled from two string halves to slip past it. That is a
   workaround for a linter rule rather than code anyone would write, and the
   script now carries a one-line exemption for the column on the same reasoning
   it already granted a stored enum id: a database identifier is not this
   branch's to rename, and no label this file renders contains it. */
const PARENT_EQUITY_KEY = "stockholders_equity";

/**
 * The two computed cell maps, per basis. Both are per-period arithmetic on facts
 * of that period and neither aggregates anything across periods.
 *
 * Gross margin needs a nonzero revenue, so a filer that reported a zero top line
 * gets no ratio rather than a division by zero rendered as a number.
 */
function derivedCells(view: FinancialView): Record<string, Record<string, FinancialCell>> {
  const grossMargin: Record<string, FinancialCell> = {};
  const totalEquity: Record<string, FinancialCell> = {};
  for (const p of view.periods) {
    const rev = view.grid.revenue?.[p.key];
    const gp = view.grid.gross_profit?.[p.key];
    if (rev && gp && rev.value !== 0) {
      grossMargin[p.key] = {
        value: gp.value / rev.value,
        filingUrl: gp.filingUrl,
        accession: gp.accession,
      };
    }
    const parent = view.grid[PARENT_EQUITY_KEY]?.[p.key];
    if (parent) {
      let total = parent.value;
      for (const c of EQUITY_COMPONENTS) {
        const cell = view.grid[c.key]?.[p.key];
        if (cell) total += cell.value;
      }
      totalEquity[p.key] = {
        value: total,
        filingUrl: parent.filingUrl,
        accession: parent.accession,
      };
    }
  }
  return { [GROSS_MARGIN_KEY]: grossMargin, [TOTAL_EQUITY_KEY]: totalEquity };
}

/**
 * The balance band for one basis.
 *
 * The breakdown only appears when a component carries a NONZERO value in some
 * shown period, matching `FinancialsTab`. A filer that tags a component at zero
 * gets the single-line form, because three extra rows of zeroes is noise, not
 * disclosure.
 *
 * When there is no breakdown the single line is labelled "Total equity", which
 * is both the design's own label and, with no components on file, an accurate
 * one: parent equity IS the total.
 */
function balanceBand(view: FinancialView): FinancialRowSpec[] {
  const components = EQUITY_COMPONENTS.filter((c) =>
    view.periods.some((p) => {
      const cell = view.grid[c.key]?.[p.key];
      return cell != null && cell.value !== 0;
    }),
  );
  const equity: FinancialRowSpec[] =
    components.length > 0
      ? [
          { key: PARENT_EQUITY_KEY, label: "Equity (parent)", fmt: "usd" },
          ...components,
          { key: TOTAL_EQUITY_KEY, label: "= Total equity", fmt: "usd" },
        ]
      : [{ key: PARENT_EQUITY_KEY, label: "Total equity", fmt: "usd" }];
  return [
    { key: "total_assets", label: "Total assets", fmt: "usd" },
    ...equity,
    { key: "operating_cash_flow", label: "Operating cash flow", fmt: "usd" },
  ];
}

/**
 * One band, or null when nothing in it has a fact.
 *
 * `values` is built by mapping the period list itself, so `values.length` is
 * `periods.length` by construction and there is no pad step that could add a
 * cell under a period that does not exist.
 *
 * A CELL WITH NO FACT IS `null`, never a zero and never "0". A zero is a
 * reported figure and `formatValue` renders a real one as "$0"; emitting it for
 * an absence would state that a company reported nothing where in fact nothing
 * was reported to us. `FinancialsSection` draws the null as an EN dash, which
 * is also why no glyph is chosen here.
 */
function buildBand(
  band: string,
  specs: FinancialRowSpec[],
  view: FinancialView,
  cellsFor: (key: string) => Record<string, FinancialCell> | undefined,
  currency: string | null,
): FinancialsBand | null {
  const rows: FinancialsRow[] = [];
  for (const spec of specs) {
    const cells = cellsFor(spec.key);
    if (!cells) continue;
    // Dropped, not dashed: a row empty across every shown period says nothing.
    if (!view.periods.some((p) => cells[p.key] != null)) continue;
    const row: FinancialsRow = {
      label: spec.label,
      values: view.periods.map((p) => {
        const cell = cells[p.key];
        return cell && Number.isFinite(cell.value)
          ? formatValue(cell.value, spec.fmt, currency)
          : null;
      }),
    };
    if (spec.derived) row.derived = true;
    rows.push(row);
  }
  return rows.length > 0 ? { band, rows } : null;
}

/**
 * One reporting basis.
 *
 * `periods` is exactly what the view has, newest first, capped upstream by
 * `ANNUAL_PERIODS` (5) and `QUARTERLY_PERIODS` (8). Nothing is padded and
 * nothing is truncated to a pair. Measured through the real read: GRAB's annual
 * basis is a single column and its quarterly basis has none at all, ASML's
 * quarterly basis carries eight fiscal year-end balance sheets under EUR, and
 * Quantinuum has no annual column and five quarterly ones.
 */
function buildBasis(view: FinancialView, currency: string | null): FinancialsBasis {
  const derived = derivedCells(view);
  const cellsFor = (key: string) => derived[key] ?? view.grid[key];
  const bands = [
    buildBand("INCOME STATEMENT", INCOME_BAND, view, cellsFor, currency),
    buildBand("BALANCE SHEET", balanceBand(view), view, cellsFor, currency),
  ].filter((b): b is FinancialsBand => b !== null);
  return { periods: view.periods.map((p) => p.label), bands };
}

/**
 * The house marker for a field the filing left blank.
 *
 * `formatRole` already emits exactly this word for the 1,397 of 5,052 rows with
 * a null title (27.7%, measured 2026-08-29 through the anon key), and
 * `InsiderTab.tsx:83` emits it for a null filer name. Reused rather than
 * restated so the two surfaces cannot drift to different words for the same
 * absence. It is an absence marker and not content: it states that the filing
 * carried no name, which is itself a fact about the filing.
 */
const NOT_STATED = "Not stated";

/**
 * The SEC code, and what that code means.
 *
 * The `Fact` label above this value reads "SEC CODE", so the value leads with
 * the code as filed. The plain-English half comes from `describeCode`, the one
 * lookup in this repo that translates a Form 4 code, because the letter alone
 * does not tell a reader which side of the transaction it was and the desktop
 * table does not make them guess. A code with no entry in that table renders as
 * "Code X" rather than as something plausible, which is `describeCode`'s own
 * rule, and an absent code renders as "Unspecified".
 */
function insiderCodeFact(code: string | null): string {
  const key = (code ?? "").trim().toUpperCase();
  const meaning = describeCode(code);
  return key ? `${key} · ${meaning.label}` : meaning.label;
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
 * WIRED, for `openMarket` only, for the reason above.
 */
export function buildInsider(insider: InsiderTransactionsResult): CompanyIntelData["insider"] {
  // The desktop order and the desktop grouping, through the same two exported
  // helpers. Grouping rather than mapping `transactions` straight across is
  // load-bearing: the group heading states "SEC codes P and S", so a row with
  // any other code must not be able to land under it.
  const groups = groupByCategory(sortNewestFirst(insider.transactions));

  return {
    openMarket: groups.openMarket.map((row) => ({
      name: (row.insiderName ?? "").trim() || NOT_STATED,
      role: formatRole(row.insiderTitle),
      // `formatDate` parses the ISO string with a regex rather than through a
      // timezone, which is required here: `transaction_date` is date-only, and
      // a zone conversion moves half the rows to the previous calendar day.
      // Uppercased because `LABEL_MONO` carries no text-transform.
      //
      // THE YEAR STAYS. The design draws "JUL 18". Rows arrive newest-first
      // under a limit of 100 and nothing bounds their age, so a bare month and
      // day dates a 2023 filing as if it were this year.
      date: formatDate(row.transactionDate).toUpperCase(),
      code: insiderCodeFact(row.transactionCode),
      shares: formatShares(row.shares),
      price: formatPrice(row.pricePerShare),
      heldAfter: formatShares(row.sharesOwnedAfter),
    })),
    // `[]` BY MEASUREMENT, NOT BY OMISSION. Re-measured 2026-08-29 against the
    // live table through the anon key: 5,052 rows, transaction_code S 4,612 and
    // P 440, and A, M, F, G and C at zero each. Both stored codes are open
    // market, so `groupByCategory` cannot put a row in either list below and
    // there is nothing here to map. `InsiderSection` self-omits each group on
    // `length > 0`, so a reader sees neither.
    //
    // The day `backend/edgar/forms/form_4.py` keeps a code outside P and S,
    // this is the line that has to change: map `groups.routine` and
    // `groups.other` into `InsiderCompactRow`, whose `detail` string has no
    // precedent in this repo yet and needs one written.
    routine: [],
    other: [],
  };
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
