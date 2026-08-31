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
import { DesktopTreeGate } from "@/components/company/DesktopTreeGate";
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
import { mobileFixtureAuthBypass } from "@/lib/mobile-fixture-gate";

/**
 * MOBILE REDESIGN, step 9, screen 15.
 *
 * Below `md` this route draws the redesign's Company Intel screen. That screen
 * WAS a fixture: invented filings, invented Form 4 rows naming real executives,
 * and invented validated XBRL, all attributed to a real issuer this page serves
 * the real versions of. `src/components/company/mobile/fixture.ts` is deleted
 * and `src/lib/company-mobile/build.ts` assembles the screen from the same four
 * reads the desktop tree below already uses.
 *
 * THE GATE IS OPEN, AND IT IS GONE RATHER THAN SET TO TRUE. This route no
 * longer calls `mobileFixtureScreensEnabled()` at all, because a gate is a
 * statement that there is something behind it that must not reach a reader and
 * there is not: there is no fixture module, no default and no `??` that can
 * supply a value, and every mapper emits an absence where a row is missing. A
 * `const mobileScreen = true` would leave the reader of this file looking for
 * the invented data it was protecting them from. The other five screens that
 * still draw fixtures keep the gate; this one has nothing to gate.
 *
 * WHAT THE FLIP CHANGES ON PRODUCTION, both of which used to ride on
 * `mobileScreen` and are now unconditional. `mobileFullBleed` drops the shell
 * chrome below `md`, which the screen replaces with its own header bar. And the
 * desk header steps to `h2`, because at `md` and above both trees are in the
 * document and only one of them is ever in the accessibility tree: `md:hidden`
 * is `display:none`, which removes the mobile screen outright there. The mobile
 * screen keeps the `h1` because below `md` it is the reachable one.
 *
 * AND THE ROUTE HAS AN `h1` AT EVERY WIDTH. An earlier draft of this header
 * said the flip left `md` and above with no `h1` at all. Measured on the
 * running page at 390, 1024 and 1440, enumerating every `h1` and `h2` with its
 * `offsetParent`: two `h1` elements are in the document at `md` and above and
 * exactly one is shown, the shell's "Company Intel"; the screen's "Broadcom"
 * `h1` is the one inside `display:none`. Below `md` the pair swaps, because
 * `mobileFullBleed` drops the shell chrome. One visible `h1` at every width,
 * and at `md` and above the desk header sits under it as an `h2`, which is the
 * order that was wanted. There is no heading-order finding here.
 *
 * THAT PARAGRAPH DESCRIBED THE HIT BRANCH ONLY, and the miss branch below did
 * not hold to it. It rendered without `mobileFullBleed`, so the shell head was
 * on screen at EVERY width beside `EmptyState`'s own `h1`, and the enumeration
 * came back two-deep at 375, 390, 430 and 1024 alike. The flag now ships on
 * both branches, which settles it below `md`. Above `md` the miss branch has
 * no second tree to put inside `display:none`, so it cannot borrow the trick
 * this paragraph describes: `EmptyState` spells the same rule on the heading
 * itself, `h1` below `md` and `h2` above it, and the invariant is one visible
 * `h1` at every width on both branches now rather than on one of them.
 *
 * BELOW `md` THE DESK TREE IS NOT IN THE DOCUMENT AT ALL, and that is newer
 * than the flip. `display:none` hides a subtree and mounts it: measured at
 * 390px signed in with zero interaction, the desk tree was firing
 * POST /api/company-overview on every phone load, a route that reaches
 * gemini-2.5-flash on a cache miss, plus `/api/company-kpis`,
 * `/api/company-trend`, `/api/stock-chart`, `/api/memo-cache` and
 * `/api/watchlist`. `DesktopTreeGate` decides the mount on the same pixel the
 * class decides visibility. The class is unchanged and still the only thing
 * that says which tree is SHOWN.
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

     The bypass is the NODE_ENV-only test, so a production build folds the
     condition to a bare `!user` and the redirect is unconditional there. It no
     longer carries the screen gate beside it: that gate is off this route, and
     an auth bypass is a development affordance in its own right rather than
     something the mobile screen earns. */
  if (!user && !mobileFixtureAuthBypass()) {
    redirect("/auth");
  }

  // TODO(E3): wrap CompanyDetailLayout in <Suspense fallback={...}> once
  // streaming boundaries land. Today the page is a server component that
  // fully resolves before render. The resolve below stays a standalone await:
  // every read after it needs either its result or its null short-circuit.
  const companyDetail = await getCompanyDetail(supabase, canonicalize(companyName));

  /* Null branch: no companies-row match (un-indexed via web-fallback path).
     Renders the PR-E1 empty state inside LiveMoodShell so the sidebar and
     topbar stay rendered AT `md` AND ABOVE. Tab grid is not mounted -- there
     is no data to populate.

     `mobileFullBleed` IS THE SAME FLAG THE HIT BRANCH BELOW SETS, and this
     branch not setting it was one line that shipped five separate defects to
     a phone. Measured on a production build at 375, 390 and 430 in both
     themes, signed in: the mood bar drew at y0..36 and the topbar at y36..88
     over a screen that has its own head; the topbar's disabled "Ask Signalera
     anything..." span ran three 19.2px lines inside a 32px pill and hung
     12.8px out of it at both ends; the user avatar laid out at x381.8 with a
     32px box, so its right edge reached 413.8 on a 390 viewport and an
     ancestor `overflow-hidden` cut it to a half-round sliver; and the footer
     drew at y721.8..844 with 122px of height under a fixed tab bar, because
     `app-shell.tsx` puts the tab-bar clearance on `<main>` and the footer is
     that element's SIBLING. All five are shell chrome, and all five are what
     this flag gates out below `md`.

     IT IS THIS ROUTE ONLY, not a pattern to roll out. Eight other routes set
     no `mobileFullBleed` either, and they are a separate question: this one is
     a defect specifically because the SAME route sets the flag on its other
     branch, so one company renders full-bleed and the next renders under two
     bars purely on whether it happens to be indexed. */
  if (!companyDetail) {
    return (
      <LiveMoodShell pageTitle="Company Intel" mobileFullBleed>
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

  // Everything from here down depends only on `companyDetail` (already
  // resolved) or on `companyName` (the slug-derived string computed above), so
  // the five reads are mutually independent. Awaited one after another they
  // cost the SUM of their latencies; issued together they cost the MAX. This
  // is purely a scheduling change: same functions, same arguments, same
  // results.
  //
  // Sized against the denominator a reader actually experiences. Median of 5 on
  // a warm `next start` (Next 16.2.2) against prod, over the DATA BLOCK only:
  // nvidia 883 -> 546ms, apple 857 -> 525ms, microsoft 844 -> 490ms, samsung
  // 742 -> 539ms. The post-resolve block alone goes ~580 -> ~235ms:
  // sequentially it costs articles 200 + filings 105 + insider 108 +
  // financials 180; together it costs max(articles, financials).
  //
  // That is 27-42% OF THE DATA BLOCK, and the data block is not the page. A
  // real session pays ~250-300ms of auth in front of all of this, none of it
  // parallelized here: three separate auth.getUser() round trips at 68-84ms
  // warm (the proxy() gate at proxy.ts:102, then generateMetadata and this
  // function, each building its own client via getSupabaseWithUser, so nothing
  // collapses them), plus the proxy's beta_allowlist read (proxy.ts:161, via
  // isAllowlisted) and its user_profiles read (proxy.ts:184) at ~50-60ms each.
  // Add that constant to both sides and the honest headline is ~31% user-visible:
  // ~29-32% on nvidia / apple / microsoft, ~20% on samsung whose block saving
  // is only ~200ms. Absolute saving ~330-355ms on the first three. It decays to
  // ~8% at 16 concurrent page views, where connection contention flattens the
  // gap between SUM and MAX.
  //
  // It stays BELOW the null short-circuit above on purpose. Hoisting the three
  // companyName-only reads over getCompanyDetail would make every un-indexed
  // slug pay for four reads it currently skips; that path is ~50ms / 1 query
  // today and must stay that way.
  //
  // Promise.all, not allSettled. Before you add .throwOnError(), .abortSignal(),
  // or any other modifier that lets a reject escape to one of these five reads,
  // and before you add an await that is not inside their existing trys, read
  // the reject-safety block at the top of src/lib/sec-filings.ts. A reject in
  // this array fails the whole page render, not one tab.

  // Read-only ArticlesTab fallback (ships dark behind the
  // NEXT_PUBLIC_ARTICLES_WEB_FALLBACK_ENABLED flag, default off). When an
  // indexed company has fewer than ARTICLE_FALLBACK_MIN in-tab articles, this
  // appends own-DB text-match rows (Layer 1, real relevance_score) and, only if
  // still short, synthetic Exa rows (Layer 2, badged web-sourced). It writes
  // nothing to articles, companies, or mention_count. Returns [] when the flag
  // is off or coverage already meets the threshold, so the merged list equals
  // companyDetail.articles in every prod path today. See getArticleFallback.ts.
  const [
    fallbackArticles,
    { articles: rawArticles },
    filingsResult,
    insiderResult,
    financialsResult,
  ] = await Promise.all([
    getArticleFallback(
      supabase,
      canonical,
      companyDetail.articles,
      companyDetail.display,
    ),
    fetchCompanyArticles(supabase, canonical),
    // SEC filings (read-only). Resolves by name to a CIK; private/pre-IPO names
    // resolve to a null CIK and an empty list, which FilingsTab renders as the
    // empty state. See src/lib/sec-filings.ts.
    //
    // Limit raised from 25 to 100 because the tab filters client-side: the
    // server sends one flat newest-first window and applyFilter() partitions
    // whatever arrived, so the fetch depth caps every chip at once.
    //
    // What the raise actually earns, measured read-only against prod on
    // 2026-08-20 (4,251 sec_filings rows, 667 distinct CIKs): only 9 CIKs carry
    // more than 25 filings at all, and for 8 of them the DEFAULT material view
    // gains rows -- 78 additional material filings become visible in total,
    // cik 1564708 alone going from 23 to 67.
    //
    // What it does NOT earn, contrary to the claim this replaces: it rescues
    // nobody from an empty default view. 25 CIKs have zero material filings in
    // their newest 25, and every one of those 25 has zero material filings
    // ANYWHERE in the table, so at limit 100 they render the identical empty
    // state. Reconstructed from created_at at 2026-06-01 / 07-01 / 08-01, the
    // count of companies with material filings sitting just outside a 25-row
    // window was 0 at all three instants. cik 1046179 (TSMC) is the only CIK
    // past 100 filings: 102 rows, all 102 Form 4, 0 material at any limit.
    //
    // Insider shells are 1,364 of those 4,251 rows and every one is a Form 4.
    // The table carries zero Form 3 and zero Form 5, so filing-categories.ts's
    // "Form 3/4/5" names a category with exactly one populated member.
    fetchCompanyFilings(supabase, { name: companyName }, 100),
    // Form 4 insider transactions (read-only), same name -> CIK resolution as
    // filings so all three tabs describe the same company row. The SELECT policy
    // from sql/0019_insider_transactions_read_policy.sql IS applied in prod
    // (verified 2026-07-26: one policy, cmd SELECT, roles public, qual true), so
    // an empty list here means no stored rows, not an RLS denial.
    getInsiderTransactions(supabase, { name: companyName }),
    // Validated XBRL financials (read-only). Same name -> CIK resolution as
    // filings; companies without a CIK render the tab's empty state.
    //
    // This is the ONLY one of the five that leaves our database. When the
    // sec_filings.primary_doc_url join covers the visible accessions only
    // partially, resolvePrimaryDocUrls (financial-facts.ts) falls through to a
    // raw fetch of https://data.sec.gov/submissions/CIK##########.json.
    // CLAUDE.md, learned the hard way: "SEC 8-K fetches can return 403 and hang
    // silently. Keep the timeouts in place." That call carried no AbortSignal
    // and no timeout, so inside a Promise.all a silent SEC hang would have held
    // all five reads and the whole page open for as long as the socket lived --
    // strictly worse than the sequential version, where it blocked only the
    // reads after it. It now carries AbortSignal.timeout; see
    // SEC_SUBMISSIONS_TIMEOUT_MS in financial-facts.ts.
    fetchCompanyFinancials(supabase, { name: companyName }),
  ]);

  const articlesForTab =
    fallbackArticles.length > 0
      ? [...companyDetail.articles, ...fallbackArticles]
      : companyDetail.articles;

  const classified = filterAndClassifyArticles(rawArticles, canonical);
  const developmentArticles = classified.filter((a) => a._isDevelopment);
  const contextArticles = classified.filter((a) => !a._isDevelopment);
  const memoContent = buildMemoContent(canonical, developmentArticles, contextArticles);
  const systemPrompt = buildMemoSystemPrompt(canonical);

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

  // The desktop surface, unchanged.
  //
  // titleAs is the ONE difference from what this rendered before the gate
  // opened. Both trees are in the same document now, so the outline would carry
  // two h1s; the mobile screen keeps its h1 because below `md` it is the
  // reachable one, and this steps to h2. See the heading-order note in the file
  // header for what that costs at `md` and above.
  const desk = (
    <CompanyDetailLayout
      tabContent={tabContent}
      header={<CompanyDetailHeader detail={companyDetail} titleAs="h2" />}
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
    <LiveMoodShell pageTitle="Company Intel" mobileFullBleed>
      {/* Which tree is drawn lives in a CLASS, never in an inline style: an
          inline display beats the class at every breakpoint, which is the
          defect that shipped the tab bar to desktop once already. */}
      {/* The screen paints its own ground. Without it the shell's parchment
          shows below a short state, and the loading and error states are
          exactly the short ones. backgroundColor is not a property any
          responsive class here sets, so the inline value cannot defeat the
          breakpoint. */}
      {/* `flex flex-col` are CLASSES, like `md:hidden` beside them, and never an
          inline display: an inline display beats a responsive class at every
          breakpoint and would put this tree on desktop. Tailwind emits variant
          utilities after base ones, so `md:hidden` still wins at `md` and above.
          The column is what lets the screen inside grow to this box: a
          percentage `min-height` on the screen resolves against this element's
          HEIGHT, which is auto, so it resolved to zero and the screen stopped at
          its content while this box was a full 785px tall. */}
      <div
        className="md:hidden flex flex-col"
        style={{ backgroundColor: "var(--c-bg)", minHeight: "100%" }}
      >
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
      {/* MOUNTED, not merely shown, and that was the defect. `hidden md:block`
          is `display:none` below `md`, which removes a subtree from the
          accessibility tree and from layout and unmounts nothing: measured at
          390px signed in with zero interaction, the desk tree inside was firing
          POST /api/company-overview, which reaches gemini-2.5-flash on a cache
          miss, plus five GETs, two of which leave for Yahoo and are the same
          requests this PR logged against itself as still in flight past 30
          seconds. The class still decides VISIBILITY and is unchanged; the gate
          decides the MOUNT, on the same pixel. See DesktopTreeGate. */}
      <DesktopTreeGate>{desk}</DesktopTreeGate>
      <CompanyMemoModalListener
        companyName={canonical}
        memoContent={memoContent}
        systemPrompt={systemPrompt}
      />
    </LiveMoodShell>
  );
}
