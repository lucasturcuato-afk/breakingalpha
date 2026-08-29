import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LiveMoodShell } from "@/components/shell/live-mood-shell";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { CompanyDetailLayout } from "@/components/company/CompanyDetailLayout";
import { CompanyDetailHeader } from "@/components/company/CompanyDetailHeader";
import { EmptyState } from "@/components/company/states/EmptyState";
import { CompanyAutoResolve } from "@/components/company/states/CompanyAutoResolve";
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
import { CompanyIntelScreen } from "@/components/company/mobile";
import { buildCompanyIntelData } from "@/lib/company-mobile/build";
import {
  mobileFixtureAuthBypass,
  mobileFixtureScreensEnabled,
} from "@/lib/mobile-fixture-gate";

/**
 * MOBILE REDESIGN, step 9, screen 15.
 *
 * Below `md` this route draws the redesign's Company Intel screen. That screen
 * WAS a fixture: invented filings, invented Form 4 rows naming real executives,
 * and invented validated XBRL, all attributed to a real issuer this page serves
 * the real versions of. `src/components/company/mobile/fixture.ts` is deleted
 * and `src/lib/company-mobile/build.ts` assembles the screen from the same four
 * reads the desktop tree below already uses, so there is no invented data left
 * on this route to gate.
 *
 * THE GATE STAYS SHUT ANYWAY, for a different reason than before. The mappers
 * in `build.ts` are stubs: every one gives back its own empty block, so the screen
 * would draw honest but empty sections. `mobileFixtureScreensEnabled()` fails
 * closed on production, which keeps that off a reader's phone while the mappers
 * are filled in, and leaves it open on a development server so the wiring can
 * be seen. Open it once every mapper is wired and a rendered proof exists.
 *
 * With the gate shut, nothing below `md` changes: the desktop tree renders
 * exactly the element it renders today, with no extra wrapper, at every width.
 */

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
  /* NO `?stage=` PARAMETER, and this is the one live path a wiring unit could
     have left behind. It accepted ready|loading|error|empty off the query
     string, which was harmless over a fixture and is not harmless over a real
     company: `?stage=empty` would draw an empty screen over a name that has
     filings, insider rows and financials on file, from a link anyone can send.
     The screen's own lifecycle is derived from whether the data resolved. */
  const mobileScreen = mobileFixtureScreensEnabled();

  // Auth gate -- middleware also enforces, but page must call to get a client.
  const { supabase, user } = await getSupabaseWithUser();

  /* This second gate is why src/proxy.ts cannot open the route: the proxy's
     MOBILE_REDESIGN_DEV_PATHS list makes the request public and then this line
     sends it to /auth anyway, so every parity, audit and smoke run measures the
     sign-in page. Opened on a development server only, matching the proxy's own
     precedent. A preview deployment keeps its redirect.

     IT FALLS THROUGH NOW RATHER THAN RETURNING ITS OWN TREE. The branch that
     used to sit here rendered the screen with the fixture, because a signed-out
     request had nothing else to draw. There is no fixture, and a branch that
     returned early could only draw a loader over a company it had not read, so
     it lets the normal path run instead: the reads below use the anon client
     and the public-read policies on companies, articles, sec_filings and
     insider_transactions answer them.

     Order still matters for the build, not just for the read. The bypass is the
     NODE_ENV-only test, so a production build folds the condition to a bare
     `!user` and the redirect is unconditional there. */
  if (!user && !(mobileFixtureAuthBypass() && mobileScreen)) {
    redirect("/auth");
  }

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
        <CompanyAutoResolve query={companyName} />
        <EmptyState canonical={companyName} />
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

  // The desktop surface, unchanged. Held in a const so the gate can place it
  // without the shut branch acquiring a wrapper element it does not have today.
  //
  // titleAs is the ONE difference between the two placements, and it exists
  // because the gate open means both trees are in the same document. Only one
  // is visible, so assistive tech already sees a single heading, but the
  // document outline sees two h1s. The mobile screen keeps h1 because that is
  // the reachable one below `md`; this steps to h2 on the gated path. With the
  // gate shut, `mobileScreen` is false and this renders h1 exactly as today.
  const desk = (
    <CompanyDetailLayout
      tabContent={tabContent}
      header={
        <CompanyDetailHeader detail={companyDetail} titleAs={mobileScreen ? "h2" : "h1"} />
      }
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
  );

  return (
    <LiveMoodShell pageTitle="Company Intel" mobileFullBleed={mobileScreen}>
      {mobileScreen ? (
        <>
          {/* Gating lives in a CLASS, never in an inline style: an inline
              display beats the class at every breakpoint, which is the defect
              that shipped the tab bar to desktop once already. */}
          {/* The screen paints its own ground. Without it the shell's parchment
              shows below a short state, and the loading and error states are
              exactly the short ones. backgroundColor is not a property any
              responsive class here sets, so the inline value cannot defeat the
              breakpoint. */}
          <div className="md:hidden" style={{ backgroundColor: "var(--c-bg)", minHeight: "100%" }}>
            {/* NO TRUTH STRIP. The amber "every figure below is invented" band
                used to render unconditionally inside both branches, because
                every figure below WAS invented. The screen reads this company's
                own rows now, so the band would be the false statement on the
                page. */}
            {/* `hasCik` is passed explicitly and the prop carries no default,
                so leaving it off is a build failure rather than a silent true.
                It picks which sourced empty copy the Filings, Financials and
                Insider sections use, and claiming an SEC identity a company
                does not have puts "no filings on file" where "not an SEC
                filer" belongs. */}
            <CompanyIntelScreen
              data={buildCompanyIntelData({
                detail: companyDetail,
                filings: filingsResult,
                insider: insiderResult,
                financials: financialsResult,
                identity,
                developments: developmentArticles,
              })}
              hasCik={filingsResult.cik != null}
            />
          </div>
          <div className="hidden md:block">{desk}</div>
        </>
      ) : (
        desk
      )}
      <CompanyMemoModalListener
        companyName={canonical}
        memoContent={memoContent}
        systemPrompt={systemPrompt}
      />
    </LiveMoodShell>
  );
}
