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
import {
  CompanyIntelScreen,
  type CompanyIntelData,
  type CompanyStage,
} from "@/components/company/mobile";
/* Imported by path, never through the barrel. The barrel is reachable from the
   client graph through `company-intel-screen`, so pulling the invented company
   through it would put it back in the browser bundle. This page is a server
   component, so from here the fixture stays on the server and reaches the
   screen as data. */
import {
  COMPANY_INTEL_EMPTY,
  COMPANY_INTEL_FIXTURE,
} from "@/components/company/mobile/fixture";
import {
  mobileFixtureAuthBypass,
  mobileFixtureScreensEnabled,
} from "@/lib/mobile-fixture-gate";
import { FONT_DISPLAY, FONT_SANS } from "@/components/mobile/fonts";

/**
 * MOBILE REDESIGN, step 9, screen 15.
 *
 * Below `md` this route draws the redesign's Company Intel screen, and that
 * screen is a FIXTURE: invented filings, invented Form 4 rows and invented
 * validated XBRL. This page serves the real versions of all three for a real
 * ticker in production today, so the fixture is gated behind
 * mobileFixtureScreensEnabled(), which fails closed on production and opens
 * only on a non-production build or an explicit Vercel preview.
 *
 * With the gate shut, nothing below `md` changes: the desktop tree renders
 * exactly the element it renders today, with no extra wrapper, at every width.
 */
const STAGES: CompanyStage[] = ["ready", "loading", "error", "empty"];

function readStage(raw: string | string[] | undefined): CompanyStage {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return STAGES.includes(value as CompanyStage) ? (value as CompanyStage) : "ready";
}

/**
 * Resolve the gate HERE, on the server, and hand the screen the result.
 *
 * `CompanyIntelScreen` takes `data` as a required, nullable prop and never
 * imports the fixture itself, so the invented company is emitted into no
 * client chunk on any build. The gate is still the thing that decides whether
 * it is drawn; this only makes the gate decide whether it is DOWNLOADED too.
 * `enabled` is always `mobileFixtureScreensEnabled()`, never a local guess.
 *
 * `if (!enabled) return null` IS UNREACHABLE ON THIS ROUTE TODAY, and it is
 * belt-and-braces rather than a live path. Both call sites already sit inside
 * a `mobileFixture ?` branch, and with the gate shut this page renders the
 * desk tree instead of the mobile screen at all, so nothing ever calls this
 * with `enabled` false. The gate above it is what does the work.
 *
 * It stays for two reasons and neither is "it might fire". First, it makes the
 * gate visible AT the call site, which is what stops a third call site being
 * added later without one. Second, it is what keeps `data` honestly typed
 * `| null`, and that type is the thing that turns a forgotten prop into a
 * build failure instead of an invented company.
 *
 * The consequence to be honest about: the screen's own null branch, which
 * draws the loader, therefore never executes in production on this route and
 * nothing exercises it. Do not read it as tested behaviour.
 */
function companyFixture(enabled: boolean, stage: CompanyStage): CompanyIntelData | null {
  if (!enabled) return null;
  return stage === "empty" ? COMPANY_INTEL_EMPTY : COMPANY_INTEL_FIXTURE;
}

/**
 * The truth strip. Sits ABOVE the screen and OUTSIDE `[data-parity="company"]`,
 * so parity never sees it and a human always does. A reviewer on a preview
 * deployment is looking at a real company's URL, and nothing inside the drawing
 * says the numbers are not that company's.
 */
function FixtureNotice() {
  return (
    <p
      style={{
        margin: 0,
        padding: "9px 20px",
        backgroundColor: "var(--c-amber-well)",
        borderBottom: "1px solid var(--c-amber-edge)",
        font: `500 11px/1.4 ${FONT_SANS}`,
        color: "var(--c-amberink)",
      }}
    >
      Design fixture. Every figure below is invented and none of it describes this company.
    </p>
  );
}

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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stage?: string | string[] }>;
}) {
  const { id } = await params;
  const companyName = slugToCompanyName(id);
  const stage = readStage((await searchParams).stage);
  const mobileFixture = mobileFixtureScreensEnabled();

  // Auth gate -- middleware also enforces, but page must call to get a client.
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) {
    // This second gate is why src/proxy.ts cannot open the route: the proxy's
    // MOBILE_REDESIGN_DEV_PATHS list makes the request public and then this
    // line sends it to /auth anyway, so every parity, audit and smoke run
    // measures the sign-in page. Opened on a development server only, matching
    // the proxy's own precedent. A preview deployment keeps its redirect.
    //
    // Order matters for the build, not just for the read. The bypass is the
    // NODE_ENV-only test, so putting it first lets the production build fold
    // the whole block to nothing rather than keep it as dead bytes behind a
    // redirect that throws. Verified against a real production build; see the
    // PR body.
    if (mobileFixtureAuthBypass() && mobileFixture) {
      return (
        <LiveMoodShell pageTitle="Company Intel" mobileFullBleed>
          {/* The screen paints its own ground. Without it the shell's parchment
              shows below a short state, and the loading and error states are
              exactly the short ones. backgroundColor is not a property any
              responsive class here sets, so the inline value cannot defeat the
              breakpoint. */}
          <div className="md:hidden" style={{ backgroundColor: "var(--c-bg)", minHeight: "100%" }}>
            <FixtureNotice />
            {/* Stated rather than left to a default. The fixture describes a
                public filer, so the sourced empty copy this picks is the
                has-CIK branch. The signed-in path below reads the real
                resolution instead. */}
            <CompanyIntelScreen stage={stage} data={companyFixture(mobileFixture, stage)} hasCik />
          </div>
          <div className="hidden md:block" style={{ padding: "48px" }}>
            <p style={{ margin: 0, font: `500 17px/1.4 ${FONT_DISPLAY}`, color: "var(--c-ink)" }}>
              Sign in to read Company Intel.
            </p>
            <p style={{ margin: "10px 0 0", font: `400 13px/1.6 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
              The desktop surface renders this company&apos;s own filings, insider record and
              financials, so it is not drawn for a signed-out reader.
            </p>
          </div>
        </LiveMoodShell>
      );
    }
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
  // gate shut, `mobileFixture` is false and this renders h1 exactly as today.
  const desk = (
    <CompanyDetailLayout
      tabContent={tabContent}
      header={
        <CompanyDetailHeader detail={companyDetail} titleAs={mobileFixture ? "h2" : "h1"} />
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
    <LiveMoodShell pageTitle="Company Intel" mobileFullBleed={mobileFixture}>
      {mobileFixture ? (
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
            <FixtureNotice />
            <CompanyIntelScreen
              stage={stage}
              data={companyFixture(mobileFixture, stage)}
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
