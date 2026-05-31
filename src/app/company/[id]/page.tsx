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
import { CompanyMemoModalListener } from "@/components/company/CompanyMemoModalListener";
import { BriefTab } from "@/components/company/tabs/BriefTab";
import { ArticlesTab } from "@/components/company/tabs/ArticlesTab";
import { TrendTab } from "@/components/company/tabs/TrendTab";
import { FilingsTab } from "@/components/company/tabs/FilingsTab";
import { ComingSoonTab } from "@/components/company/tabs/ComingSoonTab";
import { getCompanyDetail } from "@/lib/data-access/getCompanyDetail";
import { fetchCompanyFilings } from "@/lib/sec-filings";
import {
  CANONICAL,
  canonicalize,
  buildMemoContent,
  buildMemoSystemPrompt,
  filterAndClassifyArticles,
} from "@/lib/company-intel";
import { fetchCompanyArticles } from "@/app/api/companies/[id]/articles/route";

// Convert a URL slug to a canonical company name.
// e.g. "nvidia-corporation" -> "NVIDIA", "goldman-sachs" -> "Goldman Sachs",
// "some-startup" -> "Some Startup" (title-case fallback)
function slugToCompanyName(slug: string): string {
  const decoded = decodeURIComponent(slug).replace(/-/g, " ");
  const lower = decoded.toLowerCase();
  if (CANONICAL[lower]) return CANONICAL[lower];
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

  const { articles: rawArticles } = await fetchCompanyArticles(
    supabase,
    canonicalize(companyName),
  );
  const classified = filterAndClassifyArticles(rawArticles, companyName);
  const developmentArticles = classified.filter((a) => a._isDevelopment);
  const contextArticles = classified.filter((a) => !a._isDevelopment);
  const memoContent = buildMemoContent(companyName, developmentArticles, contextArticles);
  const systemPrompt = buildMemoSystemPrompt(companyName);

  // SEC filings (read-only). Resolves by name to a CIK; private/pre-IPO names
  // resolve to a null CIK and an empty list, which FilingsTab renders as the
  // empty state. See src/lib/sec-filings.ts.
  const filingsResult = await fetchCompanyFilings(supabase, { name: companyName }, 25);

  const tabContent = {
    brief: <BriefTab company={companyName} content={memoContent} systemPrompt={systemPrompt} />,
    articles: <ArticlesTab articles={companyDetail.articles} />,
    trend: (
      <TrendTab
        ticker={companyDetail.ticker}
        companyName={companyDetail.display}
        sentiment7d={companyDetail.sentiment7d}
        tone={companyDetail.tone}
        mentions7d={companyDetail.mentions7d}
      />
    ),
    filings: <FilingsTab filings={filingsResult.filings} hasCik={filingsResult.cik != null} />,
    insider: <ComingSoonTab tabId="insider" />,
    comps: <ComingSoonTab tabId="comps" />,
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
          <CompanyTrendCard
            mentions7d={companyDetail.mentions7d}
            sentiment7d={companyDetail.sentiment7d}
            tone={companyDetail.tone}
          />
        }
      />
      <CompanyMemoModalListener
        companyName={companyName}
        memoContent={memoContent}
        systemPrompt={systemPrompt}
      />
    </LiveMoodShell>
  );
}
