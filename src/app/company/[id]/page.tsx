import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LiveMoodShell } from "@/components/shell/live-mood-shell";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { CompanyDetailLayout } from "@/components/company/CompanyDetailLayout";
import { CompanyDetailHeader } from "@/components/company/CompanyDetailHeader";
import { EmptyState } from "@/components/company/states/EmptyState";
import { CompanyAliasRibbon } from "@/components/company/CompanyAliasRibbon";
import { CompanyKPIStrip } from "@/components/company/CompanyKPIStrip";
import { CompanyTrendCard } from "@/components/company/CompanyTrendCard";
import { CompanyThemesCard } from "@/components/company/CompanyThemesCard";
import { SourcesStrip } from "@/components/company/SourcesStrip";
import { CompanyMemoModalListener } from "@/components/company/CompanyMemoModalListener";
import { BriefTab } from "@/components/company/tabs/BriefTab";
import { ArticlesTab } from "@/components/company/tabs/ArticlesTab";
import { ThemesTab } from "@/components/company/tabs/ThemesTab";
import { TrendTab } from "@/components/company/tabs/TrendTab";
import { SourcesTab } from "@/components/company/tabs/SourcesTab";
import { getCompanyDetail, type CompanyDetailArticle } from "@/lib/data-access/getCompanyDetail";
import {
  CANONICAL,
  canonicalize,
  buildMemoContent,
  buildMemoSystemPrompt,
  type CompanyArticle,
} from "@/lib/company-intel";

// Convert a URL slug to a canonical company name.
// e.g. "nvidia-corporation" -> "NVIDIA", "goldman-sachs" -> "Goldman Sachs",
// "some-startup" -> "Some Startup" (title-case fallback)
function slugToCompanyName(slug: string): string {
  const decoded = decodeURIComponent(slug).replace(/-/g, " ");
  const lower = decoded.toLowerCase();
  if (CANONICAL[lower]) return CANONICAL[lower];
  return decoded.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Map CompanyDetailArticle -> CompanyArticle for buildMemoContent. The detail
// article shape lacks the `_isDevelopment` discriminator the legacy memo
// builder needs, so we treat dealType-bearing rows as developments.
function toCompanyArticle(a: CompanyDetailArticle): CompanyArticle {
  return {
    id: a.id,
    title: a.title,
    source: a.source ?? undefined,
    sector: a.sector ?? undefined,
    sentiment: a.sentiment ?? undefined,
    published_at: a.publishedAt ?? undefined,
    url: a.url ?? undefined,
    relevance_score: a.relevanceScore ?? undefined,
    deal_type: a.dealType,
    _isDevelopment: a.dealType != null,
  };
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

  // Auth gate -- middleware also enforces, but page must call to get a client.
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) redirect("/auth");

  // TODO(E3): wrap CompanyDetailLayout in <Suspense fallback={...}> once
  // streaming boundaries land. Today the page is a server component that
  // fully resolves before render.
  const companyDetail = await getCompanyDetail(supabase, canonicalize(companyName));

  // Null branch: no companies-row match (un-indexed via web-fallback path).
  // Renders the PR-E1 empty state inside LiveMoodShell so sidebar / topbar
  // stay rendered. Tab grid is not mounted -- there is no data to populate.
  if (!companyDetail) {
    return (
      <LiveMoodShell pageTitle="Company Intel">
        <EmptyState canonical={companyName} />
      </LiveMoodShell>
    );
  }

  const developmentArticles = companyDetail.articles
    .filter((a) => a.dealType != null)
    .map(toCompanyArticle);
  const contextArticles = companyDetail.articles
    .filter((a) => a.dealType == null)
    .map(toCompanyArticle);
  const memoContent = buildMemoContent(companyName, developmentArticles, contextArticles);
  const systemPrompt = buildMemoSystemPrompt(companyName);

  const tabContent = {
    brief: <BriefTab company={companyName} content={memoContent} systemPrompt={systemPrompt} />,
    articles: <ArticlesTab articles={companyDetail.articles} />,
    themes: <ThemesTab themes={companyDetail.themes} articles={companyDetail.articles} />,
    trend: (
      <TrendTab
        ticker={companyDetail.ticker}
        companyName={companyDetail.display}
        sentiment7d={companyDetail.sentiment7d}
        mentions7d={companyDetail.mentions7d}
      />
    ),
    sources: <SourcesTab articles={companyDetail.articles} />,
  };

  return (
    <LiveMoodShell pageTitle="Company Intel">
      <CompanyDetailLayout
        tabContent={tabContent}
        header={<CompanyDetailHeader detail={companyDetail} />}
        aliasRibbon={
          <CompanyAliasRibbon
            canonical={companyDetail.canonical}
            aliasMentions={companyDetail.aliasMentions}
          />
        }
        kpiStrip={<CompanyKPIStrip companyDetail={companyDetail} />}
        rightRail={
          <>
            <CompanyTrendCard
              mentions7d={companyDetail.mentions7d}
              sentiment7d={companyDetail.sentiment7d}
            />
            <CompanyThemesCard
              themes={companyDetail.themes}
              articles={companyDetail.articles}
            />
          </>
        }
        bottom={<SourcesStrip articles={companyDetail.articles} />}
      />
      <CompanyMemoModalListener
        companyName={companyName}
        memoContent={memoContent}
        systemPrompt={systemPrompt}
      />
    </LiveMoodShell>
  );
}
