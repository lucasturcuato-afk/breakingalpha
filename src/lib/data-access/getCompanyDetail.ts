import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAlias } from "@/lib/data-access/aliasResolver";
import { buildCompanyContainsOr, getCompanyVariants } from "@/lib/company-intel";
import type { Completeness } from "@/lib/article-signal";
import { computeTone, type SentimentLabel, type ToneSummary } from "@/lib/tone";
import { computeAttention, type AttentionSummary } from "@/lib/attention";
import { deriveTickerPrivacy } from "@/lib/company-privacy";
import {
  ARTICLE_DAYS_FAST,
  escalateArticleWindow,
  preferWiderRows,
} from "@/lib/article-window";

export type AliasMention = { name: string; n: number };

export type CompanyDetailArticle = {
  id: string;
  title: string;
  source: string | null;
  url: string | null;
  publishedAt: string | null;
  sentiment: string | null;
  dealType: string | null;
  relevanceScore: number | null;
  sector: string | null;
  summary: string | null;
  relevanceReason: string | null;
  /** WD49: LLM "why" for the sentiment label. Populated on all rows since the
   *  2026-05 backfill; null only guards legacy/unscored edge cases. */
  sentimentReason: string | null;
  ingestedAt: string | null;
  sourceWinRate: number | null;
  sourceSampleSize: number | null;
  completeness: Completeness;
  // Read-only fallback provenance (see getArticleFallback.ts). Optional so the
  // primary getCompanyDetail path and every existing caller are unaffected.
  // isWebSourced marks a synthetic Exa row so the tab can badge it; provenanceUrl
  // is the source URL (mirrors `url` for web rows).
  isWebSourced?: boolean;
  provenanceUrl?: string | null;
};

export interface CompanyDetail {
  /**
   * `companies.id` of the row this page resolved to: the ranked cluster head
   * from `resolveAlias`, which is a real row primary key.
   *
   * It is carried so behavioural telemetry can name the row a page view landed
   * on. Deliberately NOT a canonical entity id, a CIK, or any identifier a
   * future identity registry might redefine, because an event keyed on the
   * thing under review is unreadable once the review lands.
   */
  companyId: string;
  canonical: string;
  display: string;
  ticker: string | null;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
  aliases: string[];
  aliasMentions: AliasMention[];
  mentions: number;
  mentions7d: number[];
  sentiment7d: number[];
  tone: ToneSummary;
  attention: AttentionSummary;
  articles: CompanyDetailArticle[];
  themes: string[];
  memo: null;
  isPrivate: boolean;
}

const DAYS = 8;
// Article window policy lives in src/lib/article-window.ts, with the prod
// measurement that produced it. Summary: a fixed window cannot serve both ends
// of the corpus. 14 days renders articles on 100% of top-100 companies and
// 12.5% of the tail; widening the constant instead re-ranks the head's
// relevance-ordered slate and displaced 22 to 50 of 50 rows on every head
// company measured. So the window escalates only when the fast rung comes back
// thin.
const ARTICLE_LIMIT = 50;
const DAY_MS = 86_400_000;
// Tone (src/lib/tone.ts): a trailing 7-day window scored against the preceding
// 7-day window for direction, so mentions must be fetched 14 days back. This is
// wider than the 8 sentiment7d slots, which still drive the sparkline visuals.
const TONE_WINDOW_MS = 7 * DAY_MS;
const TONE_LOOKBACK_MS = 14 * DAY_MS;
// Attention (src/lib/attention.ts): current 7-day mention count vs the company's
// own trailing 28-day baseline (days 8 to 35 back). Fetching 35 days covers both
// the tone windows above and the attention baseline; still a few hundred rows max.
const ATTENTION_LOOKBACK_MS = 35 * DAY_MS;
const ARTICLE_COLS =
  "id, title, source, url, published_at, sentiment, deal_type, relevance_score, sector, summary, relevance_reason, sentiment_reason, ingested_at";

function utcDayMs(d: Date | string): number {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x.getTime();
}

function scoreSentiment(v: string | null): number | null {
  return v === "bullish" ? 1 : v === "bearish" ? -1 : v === "neutral" ? 0 : null;
}

function modeOf(values: Array<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
  return best;
}

export async function getCompanyDetail(
  supabase: SupabaseClient,
  slug: string,
): Promise<CompanyDetail | null> {
  const resolved = await resolveAlias(supabase, slug);
  if (!resolved) return null;

  const { canonical: head, siblings, aliasMentions } = resolved;
  const cluster = [head, ...siblings];
  // Privacy SOT: a company is private iff no ticker resolves on the canonical
  // row. Derivation extracted to company-privacy.ts so it stays unit-tested.
  const { ticker, isPrivate } = deriveTickerPrivacy(head.ticker);
  const ids = cluster.map((r) => r.id);

  const sinceDay = utcDayMs(new Date(Date.now() - (DAYS - 1) * DAY_MS));
  const sinceMentions = new Date(Date.now() - ATTENTION_LOOKBACK_MS).toISOString();

  // WD136 Phase 1: variant-expansion. Filter articles by ANY known surface form
  // of `head.name` (case + alias variants from CANONICAL), not just the single
  // canonical string. See getCompanyVariants() in company-intel.ts. Hoisted out
  // of the query so the escalation below reuses it instead of re-walking the
  // whole CANONICAL map a second time.
  const companyOr = buildCompanyContainsOr(getCompanyVariants(head.name));
  const articlesWithin = (days: number) =>
    supabase
      .from("articles")
      .select(ARTICLE_COLS)
      .or(companyOr)
      .gte("published_at", new Date(Date.now() - days * DAY_MS).toISOString())
      .order("relevance_score", { ascending: false })
      .order("published_at", { ascending: false })
      // Deterministic tiebreak. Postgres does not guarantee which rows a LIMIT
      // keeps among rows tied on every ORDER BY key, so without this the same
      // call can return a different set. Measured live: 19 of 100 rows swapped
      // on one company with the data unchanged. `id` is unique, so this pins
      // the result without changing the ranking.
      .order("id", { ascending: true })
      .limit(ARTICLE_LIMIT);

  const [mentionsRes, articlesRes] = await Promise.all([
    supabase
      .from("company_mentions")
      .select("created_at, sentiment")
      .in("company_id", ids)
      .gte("created_at", sinceMentions),
    articlesWithin(ARTICLE_DAYS_FAST),
  ]);

  const aliasSet = new Set<string>(cluster.map((r) => r.name).filter(Boolean));
  for (const a of aliasMentions) aliasSet.add(a.name);

  const mentions7d = new Array<number>(DAYS).fill(0);
  const sentiment7d = new Array<number>(DAYS).fill(0.5);
  const sentSum = new Array<number>(DAYS).fill(0);
  const sentN = new Array<number>(DAYS).fill(0);
  const mentionRows = (mentionsRes.data ?? []) as Array<{ created_at: string | null; sentiment: string | null }>;
  for (const row of mentionRows) {
    if (!row.created_at) continue;
    const idx = Math.floor((utcDayMs(row.created_at) - sinceDay) / DAY_MS);
    if (idx < 0 || idx >= DAYS) continue;
    mentions7d[idx] += 1;
    const score = scoreSentiment(row.sentiment);
    if (score !== null) { sentSum[idx] += score; sentN[idx] += 1; }
  }
  for (let i = 0; i < DAYS; i++) {
    if (sentN[i] > 0) sentiment7d[i] = (sentSum[i] / sentN[i] + 1) / 2;
  }

  // Tone (canonical, src/lib/tone.ts): split the 14-day mention set into the
  // trailing 7-day and preceding 7-day windows by timestamp, then derive the one
  // ToneSummary every tone surface renders. Empty days are excluded by simply
  // being absent from the arrays, so a quiet "today" no longer reads neutral.
  const nowMs = Date.now();
  const toneCurStart = nowMs - TONE_WINDOW_MS;
  const tonePriorStart = nowMs - TONE_LOOKBACK_MS;
  const attnBaselineStart = nowMs - ATTENTION_LOOKBACK_MS;
  const toneCurrent: SentimentLabel[] = [];
  const tonePrior: SentimentLabel[] = [];
  // Attention: count mentions (sentiment-agnostic) in the current 7-day window
  // vs the company's own trailing 28-day baseline (days 8 to 35 back).
  let attnCurrentCount = 0;
  let attnBaselineCount = 0;
  for (const row of mentionRows) {
    if (!row.created_at) continue;
    const t = new Date(row.created_at).getTime();
    if (t >= toneCurStart) attnCurrentCount += 1;
    else if (t >= attnBaselineStart) attnBaselineCount += 1;
    if (row.sentiment !== "bullish" && row.sentiment !== "bearish" && row.sentiment !== "neutral") continue;
    if (t >= toneCurStart) toneCurrent.push(row.sentiment);
    else if (t >= tonePriorStart) tonePrior.push(row.sentiment);
  }
  const tone = computeTone(toneCurrent, tonePrior);
  const attention = computeAttention(attnCurrentCount, attnBaselineCount);

  type ArticleRow = {
    id: string; title: string | null; source: string | null; url: string | null;
    published_at: string | null; sentiment: string | null; deal_type: string | null;
    relevance_score: number | null; sector: string | null;
    summary: string | null; relevance_reason: string | null;
    sentiment_reason: string | null; ingested_at: string | null;
  };
  const fastRows = (articlesRes.data ?? []) as ArticleRow[];

  // Adaptive window, rung 2. Runs ONLY when the fast rung came back thin, so a
  // well-covered company issues exactly the queries it issued before this
  // change and gets exactly the rows it got before. Sequential on purpose: the
  // fast rung's row count is the trigger, so it cannot be raced against it. On
  // an error at the fast rung there is no row count to trust, so we leave the
  // result alone rather than paper over a failed read with a wider one.
  let articleRows = fastRows;
  const wideDays = articlesRes.error ? null : escalateArticleWindow(fastRows.length);
  if (wideDays !== null) {
    const wideRes = await articlesWithin(wideDays);
    if (!wideRes.error) {
      articleRows = preferWiderRows(fastRows, (wideRes.data ?? []) as ArticleRow[]);
    }
  }

  const sources = Array.from(
    new Set(articleRows.map((a) => a.source).filter((s): s is string => !!s)),
  );
  let credMap = new Map<string, { win_rate: number | null; n_theses: number | null }>();
  if (sources.length > 0) {
    const { data: credRows } = await supabase
      .from("source_credibility")
      .select("source, win_rate, n_theses")
      .in("source", sources);
    credMap = new Map(
      (credRows ?? []).map((r: { source: string; win_rate: number | null; n_theses: number | null }) =>
        [r.source, { win_rate: r.win_rate, n_theses: r.n_theses }],
      ),
    );
  }

  const articles: CompanyDetailArticle[] = articleRows.map((r) => {
    const cred = r.source ? credMap.get(r.source) ?? null : null;
    // Derive completeness from summary only; we do NOT project article.content
    // to the client (avoids shipping paywall payloads). Matches getCompleteness()
    // summary-branch threshold in src/lib/article-signal.tsx.
    const completeness: Completeness =
      r.summary && r.summary.length > 200 ? "summary" : "headline";
    return {
      id: r.id,
      title: r.title ?? "",
      source: r.source,
      url: r.url,
      publishedAt: r.published_at,
      sentiment: r.sentiment,
      dealType: r.deal_type,
      relevanceScore: r.relevance_score,
      sector: r.sector,
      summary: r.summary,
      relevanceReason: r.relevance_reason,
      sentimentReason: r.sentiment_reason,
      ingestedAt: r.ingested_at,
      sourceWinRate: cred?.win_rate ?? null,
      sourceSampleSize: cred?.n_theses ?? null,
      completeness,
    };
  });

  return {
    companyId: head.id,
    canonical: head.name,
    display: head.name,
    ticker,
    exchange: null,
    sector: modeOf(articleRows.map((r) => r.sector)),
    industry: null,
    aliases: Array.from(aliasSet),
    aliasMentions,
    mentions: cluster.reduce((a, r) => a + (r.mention_count ?? 0), 0),
    mentions7d,
    sentiment7d,
    tone,
    attention,
    articles,
    themes: (head.key_themes ?? []) as string[],
    memo: null,
    isPrivate,
  };
}
