import type { SupabaseClient } from "@supabase/supabase-js";
import { CANONICAL, canonicalize } from "@/lib/company-intel";

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
};

export interface CompanyDetail {
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
  articles: CompanyDetailArticle[];
  themes: string[];
  memo: null;
  isPrivate: boolean;
}

const DAYS = 8;
const ARTICLE_DAYS = 14;
const ARTICLE_LIMIT = 12;
const DAY_MS = 86_400_000;
const COMPANY_COLS = "id, name, ticker, sector, mention_count, key_themes";
const ARTICLE_COLS =
  "id, title, source, url, published_at, sentiment, deal_type, relevance_score, sector";

type Row = {
  id: string;
  name: string;
  ticker: string | null;
  sector: string | null;
  mention_count: number | null;
  key_themes: string[] | null;
};

function slugToCompanyName(slug: string): string {
  const decoded = decodeURIComponent(slug).replace(/-/g, " ");
  const lower = decoded.toLowerCase();
  if (CANONICAL[lower]) return CANONICAL[lower];
  return decoded.replace(/\b\w/g, (c) => c.toUpperCase());
}

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
  const canonicalName = canonicalize(slugToCompanyName(slug));

  const { data: anchor } = await supabase
    .from("companies")
    .select(COMPANY_COLS)
    .eq("name", canonicalName)
    .maybeSingle();
  if (!anchor) return null;

  const ticker =
    typeof anchor.ticker === "string" && anchor.ticker.trim()
      ? anchor.ticker.trim().toUpperCase()
      : null;

  let cluster: Row[] = [anchor as Row];
  if (ticker) {
    const { data: rows } = await supabase
      .from("companies")
      .select(COMPANY_COLS)
      .eq("ticker", ticker);
    if (rows && rows.length > 0) cluster = rows as Row[];
  }
  cluster.sort((a, b) => (b.mention_count ?? 0) - (a.mention_count ?? 0));
  const head = cluster[0];
  const ids = cluster.map((r) => r.id);

  const sinceDay = utcDayMs(new Date(Date.now() - (DAYS - 1) * DAY_MS));
  const sinceArticles = new Date(Date.now() - ARTICLE_DAYS * DAY_MS).toISOString();

  const [aliasesRes, mentionsRes, articlesRes] = await Promise.all([
    supabase.from("aliases").select("surface_form, mention_count").in("canonical_id", ids),
    supabase
      .from("company_mentions")
      .select("created_at, sentiment")
      .in("company_id", ids)
      .gte("created_at", new Date(sinceDay).toISOString()),
    supabase
      .from("articles")
      .select(ARTICLE_COLS)
      .contains("companies", [head.name])
      .gte("published_at", sinceArticles)
      .order("relevance_score", { ascending: false })
      .limit(ARTICLE_LIMIT),
  ]);

  const aliasRows = (aliasesRes.data ?? []) as Array<{ surface_form: string | null; mention_count: number | null }>;
  const aliasMentions: AliasMention[] = aliasRows
    .filter((r): r is { surface_form: string; mention_count: number | null } => !!r.surface_form)
    .map((r) => ({ name: r.surface_form, n: r.mention_count ?? 0 }))
    .sort((a, b) => b.n - a.n);
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

  const articleRows = (articlesRes.data ?? []) as Array<{
    id: string; title: string | null; source: string | null; url: string | null;
    published_at: string | null; sentiment: string | null; deal_type: string | null;
    relevance_score: number | null; sector: string | null;
  }>;
  const articles: CompanyDetailArticle[] = articleRows.map((r) => ({
    id: r.id,
    title: r.title ?? "",
    source: r.source,
    url: r.url,
    publishedAt: r.published_at,
    sentiment: r.sentiment,
    dealType: r.deal_type,
    relevanceScore: r.relevance_score,
    sector: r.sector,
  }));

  return {
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
    articles,
    themes: (head.key_themes ?? []) as string[],
    memo: null,
    isPrivate: ticker === null,
  };
}
