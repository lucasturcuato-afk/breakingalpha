import type { Metadata } from "next";
import { LiveMoodShell } from "@/components/shell/live-mood-shell";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { CompanyDetailClient } from "@/components/company/company-detail-client";
import {
  CANONICAL,
  COMPANY_IDENTITY,
  filterAndClassifyArticles,
  buildMemoContent,
  buildMemoSystemPrompt,
} from "@/lib/company-intel";
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

  const { data: articles, error } = await supabase
    .from("articles")
    .select(
      "id, title, source, sector, sentiment, summary, content, published_at, ingested_at, url, companies, primary_company, relevance_score, deal_type",
    )
    .order("ingested_at", { ascending: false })
    .limit(1500);

  if (error) {
    console.error("Company detail query error:", error.message);
  }

  const classified = filterAndClassifyArticles(articles ?? [], companyName);
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
