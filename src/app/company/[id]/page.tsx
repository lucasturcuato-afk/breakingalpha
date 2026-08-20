import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LiveMoodShell } from "@/components/shell/live-mood-shell";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { CompanyDetailLayout } from "@/components/company/CompanyDetailLayout";
import { CompanyDetailHeader } from "@/components/company/CompanyDetailHeader";
import { CompanyMissState } from "@/components/company/states/CompanyMissState";
import { PrimerWebMemo } from "@/components/company/states/PrimerWebMemo";
import { CompanyAliasRibbon } from "@/components/company/CompanyAliasRibbon";
import { CompanyKPIStrip } from "@/components/company/CompanyKPIStrip";
import { CompanyTrendCard } from "@/components/company/CompanyTrendCard";
import { CompanyMemoModalListener } from "@/components/company/CompanyMemoModalListener";
import { BriefTab } from "@/components/company/tabs/BriefTab";
import { PrimerTab } from "@/components/company/tabs/PrimerTab";
import { ArticlesTab } from "@/components/company/tabs/ArticlesTab";
import { TrendTab } from "@/components/company/tabs/TrendTab";
import { FilingsTab } from "@/components/company/tabs/FilingsTab";
import { InsiderTab } from "@/components/company/tabs/InsiderTab";
import { getInsiderTransactions } from "@/lib/data-access/getInsiderTransactions";
import { FinancialsTab } from "@/components/company/tabs/FinancialsTab";
import { ComingSoonTab } from "@/components/company/tabs/ComingSoonTab";
import { getCompanyDetail } from "@/lib/data-access/getCompanyDetail";
import { resolveAlias } from "@/lib/data-access/aliasResolver";
import { getArticleFallback } from "@/lib/data-access/getArticleFallback";
import { fetchCompanyFilings } from "@/lib/sec-filings";
import { fetchCompanyFinancials } from "@/lib/financial-facts";
import {
  CANONICAL,
  COMPANY_IDENTITY,
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
  // Prefer the resolved companies-row name over the slug reconstruction:
  // slugToCompanyName title-cases function words ("bank-of-america" ->
  // "Bank Of America"), which leaked into the <title>. Falls back to the
  // slug-derived name for unauthenticated requests (middleware redirects
  // those before any page HTML is served) and unindexed companies.
  let name = slugToCompanyName(id);
  try {
    const { supabase, user } = await getSupabaseWithUser();
    if (user) {
      const resolved = await resolveAlias(supabase, id);
      if (resolved) name = resolved.canonical.name;
    }
  } catch {
    // Resolver failures must never break metadata; keep the slug fallback.
  }
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

  // Null branch: resolveAlias found no companies row for this name. That is
  // the ONLY condition that lands here (getCompanyDetail.ts:97-98); a row with
  // zero articles yields a detail object and renders the tab grid instead. So
  // this is an unresolved name, not an uncovered company, and CompanyMissState
  // is what keeps the copy honest about the difference. Rendered inside
  // LiveMoodShell so sidebar / topbar stay put. Tab grid is not mounted, there
  // is no data to populate.
  if (!companyDetail) {
    return (
      <LiveMoodShell pageTitle="Company Intel">
        <CompanyMissState query={companyName} />
      </LiveMoodShell>
    );
  }

  // Brief inputs are keyed on the RESOLVED row name (companyDetail.canonical
  // == resolveAlias head.name), the same identity the Trend/Attention panel
  // already filters on. The slug-derived companyName title-cases function
  // words ("bank-of-america" -> "Bank Of America"), and Postgres array
  // containment on articles.companies is case-sensitive, so keying the brief
  // on it returned 0 articles while the panel showed dozens. Side effect:
  // memo-cache entries keyed under old slug-cased names miss and regenerate
  // once.
  const canonical = companyDetail.canonical;

  // Read-only ArticlesTab fallback (ships dark behind the
  // NEXT_PUBLIC_ARTICLES_WEB_FALLBACK_ENABLED flag, default off). When an
  // indexed company has fewer than ARTICLE_FALLBACK_MIN in-tab articles, this
  // appends own-DB text-match rows (Layer 1, real relevance_score) and, only if
  // still short, synthetic Exa rows (Layer 2, badged web-sourced). It writes
  // nothing to articles, companies, or mention_count. Returns [] when the flag
  // is off or coverage already meets the threshold, so the merged list equals
  // companyDetail.articles in every prod path today. See getArticleFallback.ts.
  const fallbackArticles = await getArticleFallback(
    supabase,
    canonical,
    companyDetail.articles,
    companyDetail.display,
  );
  const articlesForTab =
    fallbackArticles.length > 0
      ? [...companyDetail.articles, ...fallbackArticles]
      : companyDetail.articles;

  const { articles: rawArticles } = await fetchCompanyArticles(supabase, canonical);
  const classified = filterAndClassifyArticles(rawArticles, canonical);
  const developmentArticles = classified.filter((a) => a._isDevelopment);
  const contextArticles = classified.filter((a) => !a._isDevelopment);
  const memoContent = buildMemoContent(canonical, developmentArticles, contextArticles);
  const systemPrompt = buildMemoSystemPrompt(canonical);

  // SEC filings (read-only). Resolves by name to a CIK; private/pre-IPO names
  // resolve to a null CIK and an empty list, which FilingsTab renders as the
  // empty state. See src/lib/sec-filings.ts.
  //
  // Limit raised from 25 to 100 because the tab now filters client-side. Form
  // 3/4/5 shells are 735 of 2,069 stored filings and for some companies they are
  // ALL of the newest 25, so a 25-row window could contain zero material filings
  // and the default view would render empty while material filings sat just
  // outside the window.
  const filingsResult = await fetchCompanyFilings(supabase, { name: companyName }, 100);

  // Form 4 insider transactions (read-only), same name -> CIK resolution as
  // filings so all three tabs describe the same company row. The SELECT policy
  // from sql/0019_insider_transactions_read_policy.sql IS applied in prod
  // (verified 2026-07-26: one policy, cmd SELECT, roles public, qual true), so
  // an empty list here means no stored rows, not an RLS denial.
  const insiderResult = await getInsiderTransactions(supabase, { name: companyName });

  // Validated XBRL financials (read-only). Same name -> CIK resolution as
  // filings; companies without a CIK render the tab's empty state.
  const financialsResult = await fetchCompanyFinancials(supabase, { name: companyName });

  // Curated identity (Snapshot industry + Business overview), keyed on the same
  // canonical name the memo inputs use. Null for uncurated companies, which the
  // Primer sections render as neutral factual empty states.
  const identity = COMPANY_IDENTITY[canonical] ?? null;

  // Web-memo affordance is OFF by default. It renders only when
  // NEXT_PUBLIC_WEB_FALLBACK_ENABLED is explicitly "true" (same flag the
  // web-fallback route and the /api/memo company-web branch already gate on,
  // both default-off via !== "true"). Absent the env override the affordance is
  // not shown and POST /api/companies/web-fallback is never invoked from the UI.
  // PrimerWebMemo and the route stay in place, dormant.
  const webMemoEnabled = process.env.NEXT_PUBLIC_WEB_FALLBACK_ENABLED === "true";

  // Financials commentary affordance is OFF by default. Server-read flag (not
  // NEXT_PUBLIC, so it stays out of the client bundle and the schedule); the
  // route enforces the same gate. Absent the override the control never mounts
  // and POST /api/financials-commentary is never called.
  const financialsCommentaryEnabled = process.env.FINANCIALS_COMMENTARY_ENABLED === "true";

  const tabContent = {
    // Coverage Primer: replaces the brief tab in place. Snapshot + Business
    // overview + Financial snapshot, then the existing BriefTab embedded
    // UNCHANGED as Recent developments (no /api/memo route touch).
    brief: (
      <PrimerTab
        companyName={companyDetail.display}
        ticker={companyDetail.ticker}
        sector={companyDetail.sector}
        industry={identity?.industry ?? null}
        description={identity?.brief ?? null}
        financials={financialsResult}
        briefSlot={
          // Mutually exclusive, never stacked. No article coverage -> ONLY the
          // web-memo card; BriefTab is not mounted, so its "Generate Brief" CTA
          // cannot fire a corpus brief against zero articles. Coverage exists ->
          // ONLY the corpus BriefTab, unchanged.
          developmentArticles.length === 0 && contextArticles.length === 0 ? (
            // No coverage: web-memo card ONLY when the flag is on; otherwise
            // render nothing here (BriefTab stays unmounted so its Generate
            // Brief CTA cannot fire a corpus brief against zero articles).
            webMemoEnabled ? (
              <PrimerWebMemo company={companyDetail.display} ticker={companyDetail.ticker} />
            ) : null
          ) : (
            <BriefTab company={canonical} content={memoContent} systemPrompt={systemPrompt} />
          )
        }
      />
    ),
    articles: <ArticlesTab articles={articlesForTab} />,
    trend: (
      <TrendTab
        ticker={companyDetail.ticker}
        companyName={companyDetail.display}
        company={companyDetail.canonical}
        tone={companyDetail.tone}
        articles={companyDetail.articles}
      />
    ),
    filings: (
      <FilingsTab
        filings={filingsResult.filings}
        hasCik={filingsResult.cik != null}
        cik={filingsResult.cik}
      />
    ),
    financials: (
      <FinancialsTab
        financials={financialsResult}
        hasCik={financialsResult.cik != null}
        companyName={companyDetail.display}
        commentaryEnabled={financialsCommentaryEnabled}
      />
    ),
    insider: (
      <InsiderTab
        transactions={insiderResult.transactions}
        hasCik={insiderResult.cik != null}
      />
    ),
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
            company={companyDetail.canonical}
            mentions7d={companyDetail.mentions7d}
            tone={companyDetail.tone}
            attention={companyDetail.attention}
          />
        }
      />
      <CompanyMemoModalListener
        companyName={canonical}
        memoContent={memoContent}
        systemPrompt={systemPrompt}
      />
    </LiveMoodShell>
  );
}
