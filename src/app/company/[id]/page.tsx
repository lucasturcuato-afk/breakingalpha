import type { Metadata } from "next";
import { LiveMoodShell } from "@/components/shell/live-mood-shell";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { CompanyDetailClient } from "@/components/company/company-detail-client";
import {
  CANONICAL,
  COMPANY_IDENTITY,
  canonicalize,
  filterAndClassifyArticles,
  buildMemoContent,
  buildMemoSystemPrompt,
} from "@/lib/company-intel";
import { fetchCompanyArticles } from "@/app/api/companies/[id]/articles/route";
import type { CredibilityMap } from "@/components/company/company-detail-client";

// Convert a URL slug to a canonical company name.
// e.g. "nvidia-corporation" → "NVIDIA", "goldman-sachs" → "Goldman Sachs",
// "some-startup" → "Some Startup" (title-case fallback)
function slugToCompanyName(slug: string): string {
  const decoded = decodeURIComponent(slug).replace(/-/g, " ");
  const lower = decoded.toLowerCase();

  // Direct CANONICAL lookup (handles openai → OpenAI, spacex → SpaceX, etc.)
  if (CANONICAL[lower]) return CANONICAL[lower];

  // Title-case fallback for everything else
  return decoded.replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const name = slugToCompanyName(id);
  return { title: `${name} — Company Intel` };
}

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const companyName = slugToCompanyName(id);
  const identity = COMPANY_IDENTITY[companyName] ?? null;

  const { supabase } = await getSupabaseWithUser();

  // Cache-first read via the new /api/companies/[id]/articles helper.
  // Replaces the prior 1500-article scan that scaled with feed depth.
  const { articles } = await fetchCompanyArticles(supabase, canonicalize(companyName));

  // Pull the public-equity ticker from the companies table so the detail page
  // can render the stock chart. canonicalize() resolves variant spellings.
  // Most rows carry tickers post-W2-C bulk backfill; the lazy lookup below
  // is the backstop for rows the backfill missed or that were created before
  // the web-fallback ticker-population path shipped.
  let ticker: string | null = null;
  let companyRowId: string | null = null;
  try {
    const { data: companyRow } = await supabase
      .from("companies")
      .select("id, ticker")
      .eq("name", canonicalize(companyName))
      .maybeSingle();
    if (companyRow) {
      companyRowId = companyRow.id ?? null;
      if (typeof companyRow.ticker === "string" && companyRow.ticker.trim()) {
        ticker = companyRow.ticker.trim().toUpperCase();
      }
    }
  } catch {
    // soft-fail: detail page still renders without a ticker
  }

  // Lazy lookup: if no ticker on file but we have a company row, try Finnhub
  // once and persist for next load. Fire-and-forget on the write so detail
  // rendering is not blocked by Supabase.
  if (!ticker && companyRowId) {
    const { fetchTickerFromFinnhub } = await import("@/lib/finnhub-ticker");
    const lookedUp = await fetchTickerFromFinnhub(canonicalize(companyName));
    if (lookedUp) {
      ticker = lookedUp.trim().toUpperCase();
      void supabase
        .from("companies")
        .update({ ticker })
        .eq("id", companyRowId)
        .then(() => undefined);
    }
  }

  const classified = filterAndClassifyArticles(articles, companyName);
  const developmentArticles = classified.filter((a) => a._isDevelopment);
  const contextArticles = classified.filter((a) => !a._isDevelopment);

  // Batch fetch source credibility
  const uniqueSources = [...new Set(classified.map(a => a.source).filter(Boolean) as string[])];
  let credibilityMap: CredibilityMap = {};
  if (uniqueSources.length > 0) {
    try {
      const { data: credData } = await supabase
        .from("source_credibility")
        .select("source, win_rate")
        .in("source", uniqueSources);
      if (credData) {
        for (const r of credData) {
          credibilityMap[r.source] = r.win_rate;
        }
      }
    } catch { /* soft-fail */ }
  }

  const memoContent = buildMemoContent(companyName, developmentArticles, contextArticles);
  const systemPrompt = buildMemoSystemPrompt(companyName);

  return (
    <LiveMoodShell pageTitle="Company Intel">
      <CompanyDetailClient
        companyName={companyName}
        industry={identity?.industry ?? null}
        ticker={ticker}
        developmentArticles={developmentArticles}
        contextArticles={contextArticles}
        memoContent={memoContent}
        systemPrompt={systemPrompt}
        totalArticles={classified.length}
        credibilityMap={credibilityMap}
      />
    </LiveMoodShell>
  );
}
