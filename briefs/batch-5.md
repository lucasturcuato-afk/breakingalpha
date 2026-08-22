# Batch 5 build brief: Company Intel, Memo

Recon only. No implementation. Every repo path below was opened and read.

Three em dashes appear in this file. All three are inside verbatim quotations (two of
README, one of a shipped source line) and one of them IS a reported compliance defect.
Authored prose carries none. Removing them would falsify the evidence.

## Screens

### Company Intel

Prototype flag: `isCompany`. Confirmed in `Signalera Mobile v3.dc.html` at line 767
(`<sc-if value="{{ isCompany }}">`) and in the logic class at line 3240
(`isCompany: s.screen === 'company'`). The five sections are a single flat
`coSection` state key (`'primer' | 'tone' | 'filings' | 'fin' | 'insider'`,
lines 3705 to 3712), not routes. One scroll container, chips at the top of the
section area, `v3in 200ms` on each section swap.

Route: `/company/[id]`. Exists at
`/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/app/company/[id]/page.tsx`.
The mobile screen lands here. NO new route needed. Section state should mirror
the desktop `?tab=` convention rather than invent a second one, see
`src/hooks/useCompanyTabState.ts` (native `replaceState`, no RSC refetch).

Screen-level sources:

- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/app/company/[id]/page.tsx`
  Server component. Resolves `getCompanyDetail`, `fetchCompanyFilings` (limit 100),
  `getInsiderTransactions`, `fetchCompanyFinancials`, `COMPANY_IDENTITY`, then hands
  a `tabContent` record to `CompanyDetailLayout`. Two feature flags gate content:
  `NEXT_PUBLIC_WEB_FALLBACK_ENABLED` (web memo card) and
  `FINANCIALS_COMMENTARY_ENABLED` (financials commentary), both default off. Every
  datum the five mobile sections need is already resolved server-side on this one
  page, so the mobile screen needs no new API surface.
- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/components/company/CompanyDetailLayout.tsx`
  Slot shell. Renders ALL tab panels at all times with `hidden={!isActive}` (see the
  WD113 comment at lines 114 to 122): conditional rendering unmounted panels and
  re-fired `/api/memo-cache` and `/api/stock-chart`. The mobile section switcher must
  preserve that, because `sc-if` in the prototype is a true unmount.
- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/components/company/CompanyDetailTabs.tsx`
  The desktop tab bar. Maps `TAB_ORDER` to buttons. See the tab-list contradiction
  under NOT PORTED, below.
- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/hooks/useCompanyTabState.ts`
  `CompanyTabId` is a ten-member union; `TAB_ORDER` is a seven-member array. The
  union is the deep-link vocabulary, the array is what renders.
- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/components/company/CompanyDetailHeader.tsx`
  Owns the "Generate memo" affordance. `onGenerateMemo` dispatches a window
  `CustomEvent("memo:generate", { detail: { canonical } })` (line 92). Also owns the
  watchlist toggle (POST/DELETE `/api/watchlist`) and a `company-pdf` export href.
- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/app/company/[id]/loading.tsx`
  Five lines. Renders `LoadingState`.
- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/components/company/states/LoadingSkeleton.tsx`
  Skeleton scaffold mirroring the desktop slot order, `aria-hidden`, with the live
  region owned by `LoadingStatusChip`.

#### KPI strip

Prototype: the 2x2 grid at .dc.html lines 777 to 782. Cells MARKET CAP, MENTIONS 30D,
ARTICLE TONE, SOURCES. Price sits above it as a header line (`284.11 +1.24%`), not as
a cell.

- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/components/company/CompanyKPIStrip.tsx`
  SIX cells, not four: Last, Market cap, Mentions 30d, Article tone, Articles today,
  Sources. Cells 1 and 2 hydrate client-side from `/api/company-kpis` with an
  `AbortController`; the rest come from the `companyDetail` prop. Carries a four-state
  machine (`idle | loading | ready | error | private`). Privacy source of truth is
  `shouldRenderPrivate(companyDetail.isPrivate)`, deliberately NOT the Yahoo quote
  status, per the comment at lines 164 to 169. The tone cell renders a `SentimentPill`
  plus `ToneCellMeta` (direction glyph plus `formatEvidence`), and its tooltip carries
  the "Not a price signal" framing the mobile design lifted.
  The mobile design drops two cells (Last, Articles today) and inverts the layout from
  a six-column `overflow-x-auto` grid to a 2x2. github.md records the lift as four
  cells and does not record dropping the other two. Flagged, not resolved.

#### Primer section

Prototype: `onPrimer`, .dc.html lines 804 to 823. Four blocks: a Sector/Industry/
Headquarters card, "business overview" prose, a "key figures" 2x2 (EV/EBITDA, P/E,
52-WEEK RANGE, NUCLEAR CAPACITY), and "recent developments" as two rules-separated
paragraphs, closing on "Informational only. Nothing here is a recommendation."

- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/components/company/tabs/PrimerTab.tsx`
  The composition root. Five stated sections: Snapshot, Business overview, Key stats,
  Financial snapshot, Recent developments. Runs TWO client fetches on view:
  `/api/company-kpis` for the quote and `POST /api/company-overview` for a
  Gemini-normalized overview, with a documented fallback chain
  `normalized -> trimSummary(provider) -> curated description -> hide the section`.
  Recent developments is `briefSlot`, a `ReactNode` the page passes in. The header
  comment states the component "does not touch that path", meaning `/api/memo`.
- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/components/company/tabs/primer/PrimerKeyStats.tsx`
  Eight possible stats: Market cap, P/E trailing, P/E forward, EPS TTM, 52-week range,
  Dividend yield, Beta, 1y target. Absent fields are DROPPED, not blanked. Two carry a
  mandatory attribution note, "Analyst consensus (Yahoo Finance)". Forward P/E is
  suppressed when trailing EPS is not positive.
  EV/EBITDA and NUCLEAR CAPACITY, the two figures in the prototype's key-figures grid,
  do not exist in this component or in `QuoteSummaryLive`. See Open questions.
- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/components/company/tabs/primer/PrimerFinancialSnapshot.tsx`
  Five key metrics from the latest ANNUAL XBRL period (Revenue, Gross profit,
  Operating income, Net income, EPS diluted) plus three computed margins (Gross,
  Operating, Net) derived as pure ratios of the same column. Empty copy comes from
  `financialsEmptyCopy(hasCik)`.
  github.md maps this to Primer, but the prototype's Primer has NO financial snapshot
  and no margins. That content surfaces in the mobile Financials section instead.
  Flagged, not resolved.
- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/components/company/tabs/primer/PrimerSnapshot.tsx`
  NOT in github.md's map, but it is the source of the prototype's identity card:
  Company, Ticker (falls back to the literal "Private"), Sector, Industry, each falling
  back to `DASH = "--"`. The prototype swaps Company and Ticker for Headquarters, which
  this component does not carry.

#### Price and tone section

Prototype: `onTone`, .dc.html lines 825 to 838. Level plus direction on one baseline,
an evidence line, the "not a price signal and not a score. No number sits behind this
label" disclaimer, then "what moved the reading" as three dotted evidence rows with
article counts and dates.

- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/components/company/ToneReadout.tsx`
  The tone discipline, stated in its own header: LEVEL plus DIRECTION plus EVIDENCE,
  "No bare -1..+1 scalar is ever shown". Two scales, `rail` (16/11/10) and `panel`
  (20/12/11); the prototype's 21px level is closest to `panel`. The insufficient branch
  is a separate render path with its own copy, "Not enough recent coverage" plus either
  "No articles in the last 7 days" or "Based on N articles so far".
- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/components/company/tone/ToneEvidenceList.tsx`
  "Behind this tone". Filters to the SAME trailing 7-day window the level is computed
  from (`WINDOW_MS`, mirroring `TONE_WINDOW_MS`), caps at `MAX_ROWS = 5`, and surfaces
  the remainder as "+N more this week in the Articles tab". Each row is a
  `SentimentPill` plus a truncated title plus a relative age, and opens
  `ToneArticleDetail`. Returns `null` when the window is empty.
  Two mismatches with the prototype: the prototype's rows are prose sentences with an
  article COUNT and a date ("7 ARTICLES, AUG 1"), whereas the source rows are one
  article each with a headline and an age; and the overflow line points at an Articles
  tab the mobile design does not have. Flagged, not resolved.

#### Filings section

Prototype: `onFilings`, .dc.html lines 840 to 851. Six chips carrying "Label N",
a note line bound to `filingsNote` (lines 3611 to 3616), then rows of
form-badge plus date plus summary, with "Summary pending" in italic muted.

- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/components/company/tabs/FilingsTab.tsx`
  Chip filter state is `FilingFilter | null`, where `null` is the DEFAULT view (material
  forms only) and `"all"` is a distinct chip that includes insider forms. Chips with a
  zero count are `disabled` and rendered at 40 percent opacity. Three distinct empties:
  no CIK or no filings, filter-empty with a filter pinned, and filter-empty on the
  default view with its own copy. The has-CIK empty carries an EDGAR deep link
  (`edgarFilingsUrl(cik)`); the private branch deliberately does not. Rows are
  newest-first via a `filingDate` sort. `formatFilingDate` is deliberately
  locale-independent so server and client HTML match.
- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/lib/filing-categories.ts`
  Pure, dependency-free, unit-testable. Categories `annual | quarterly | events |
  insider | other`. Amendment suffixes strip to the base form, so `10-K/A` is annual and
  `4/A` is insider. `isMaterialByDefault` excludes ONLY insider, deliberately keeping
  `other` in the default view. `FILTER_ORDER` is fixed so the chip row does not reflow
  between companies. `FILTER_LABELS` is All / Annual / Quarterly / Events / Insider /
  Other, which is exactly the prototype's chip set and order.
  The prototype's Insider chip is wired to `secInsider`, i.e. it jumps to the Insider
  section rather than filtering the list, and its style is hardcoded `pill(false)` so it
  can never render active. That is a mobile-specific behaviour with no source analogue.

#### Financials section

Prototype: `onFin`, .dc.html lines 853 to 875. Annual/Quarterly toggle right-aligned,
one table with an INCOME STATEMENT band and a BALANCE SHEET band, two period columns,
and a closing note: "Validated XBRL facts from SEC filings, reported in USD. A dash
means the figure was not reported or did not pass validation, never zero."

- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/components/company/tabs/FinancialsTab.tsx`
  Five annual or eight quarterly period COLUMNS, not two. Nine income rows, a variable
  balance-sheet block, and operating cash flow as a single key line. The equity block
  expands to parent equity plus each noncontrolling component plus a computed
  "= Total equity" only when a component is nonzero somewhere (the Cheniere case is
  named in the header comment). A row with no value across every shown period is
  DROPPED, not dashed. Per-row `Src` column deep-links the filing. A non-USD reporting
  currency prints its own note and nothing is converted.
- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/components/company/tabs/financials-format.ts`
  Pure formatter. `Fmt` is `usd | eps | shares | pct`. A reported zero renders `$0`,
  never `$0K`. Negatives render in parentheses. The currency prefix is not a hardcoded
  dollar sign: non-USD renders as `TWD 2.89B`.
  Missing cells never reach the formatter. `ValueCell` in FinancialsTab renders
  `&mdash;` first. That is an em dash, which README compliance rule 4 forbids outright.
  The prototype uses an en dash (`–`, .dc.html line 3729) and its own copy says
  "A dash". Flagged, not resolved.

#### Insider section

Prototype: `onInsider`, .dc.html lines 877 to 906. "Open market, 1" with a full card
(SEC CODE, SHARES, PRICE, HELD AFTER), then "Routine compensation, 2" as compact rows,
then the coverage caveat.

- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/components/company/tabs/InsiderTab.tsx`
  THREE groups, not two: `openMarket`, `routine`, and `other` ("Gifts, conversions, and
  codes outside the categories above"). Nine table columns. The empty branch keys on
  `transactions.length === 0` FIRST and not on `hasCik`, because
  `getInsiderTransactions` falls back to a company_id match and rows can arrive with a
  null CIK; the header comment records that the old guard hid real transactions. The
  coverage note renders under populated tables AND under the has-CIK empty state.
  The mobile design drops the `other` group. Not recorded in github.md.
- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/components/company/tabs/empty-state-copy.ts`
  Pure module, unit-tested (`empty-state-copy.test.ts` sits beside it), and the single
  source for Filings, Financials and Insider empty copy. Its HONESTY NOTE (lines 36 to
  53) states that "has a CIK but Form 4 was never polled" and "was polled and nothing
  cleared the filter" ARE NOT distinguishable from stored data, so they deliberately
  collapse into one sentence. `INSIDER_COVERAGE_NOTE` is a single exported constant so
  the populated and empty variants cannot drift.

### Memo

Prototype flag: `isMemo`. Confirmed at .dc.html line 1889 and line 3677
(`isMemo: s.screen === 'memo'`). Full-screen, not a modal. Back chevron reads "CEG",
right-hand eyebrow reads "COMPANY BRIEF". Three body states switch on `memoStage`
(line 3678). Footer holds Copy and Export .md plus an ephemeral gold-dot notice line
(`memoNotice`, lines 3536 to 3539). Citations open `citeOpen`, a bottom sheet at
lines 1968 to 1981.

Route: NEW ROUTE NEEDED. Proposed `/company/[id]/memo`. Today the memo is a portal
modal with no URL of its own, mounted by a window event. A full-screen mobile surface
with a back affordance to `/company/[id]` needs real history, otherwise Android back
and the iOS back-swipe leave the user on the company screen with the memo still up.
The prototype's `goCompany` is a screen swap, which a route gives for free.

Sources:

- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/components/memo/CompanyIntelMemoModal.tsx`
  The mapped source. A FORK of MemoModal for "the W2-C Company Intel surfaces only"
  (header comment, lines 11 to 27). Six memo types (`deal | thesis | brief | article |
  company | company-web`) with `TYPE_LABELS` Deal Memo / Thesis Memo / Market Brief /
  Article Analysis / Company Brief. `segmentTextWithCitations` splits prose on `/\[(\d+)\]/g`
  and renders each match as a `<button>`; `handleCiteClick` calls `scrollIntoView` on a
  ref into the sources rail and flashes it gold for 220ms. Anchors whose index exceeds
  `sources.length` render `disabled` with a "not provided" title. Body is
  `grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]`; the rail `<aside>` at line 573 is
  `hidden lg:block`. Loading is `MemoSkeleton` plus `SourceRailSkeleton`; error is
  `ErrorBanner` with a real Retry; footer is Copy plus Export PDF plus Close.
  IT HAS NO LIVE CALL SITES. Confirmed two ways: a repo-wide grep finds no importer,
  and `src/app/api/memo-cache/route.ts` states at line 44 that "the only company-anchored
  modal (CompanyIntelMemoModal) has no live hosts". See NOT PORTED.
- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/components/memo/MemoModal.tsx`
  CLAUDE.md propose-only. This is what actually renders on `/company/[id]`. Sources are
  a plain `<ol>` under the memo body (lines 351 to 378), NOT a rail, and NOT responsive
  hidden. There are no inline `[n]` anchors at all: its `mdComponents` pass children
  through untouched. Error state offers Close only, no retry. Footer is
  ThumbsControl plus Copy plus Export PDF plus Close. Body animates per markdown section
  via `parseSections` with a 400ms staggered fade.
- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/components/company/CompanyMemoModalListener.tsx`
  The bridge. Listens for `memo:generate` and mounts `MemoModal` with `type="company"`.
  Its own comment: "The Lucas-protected MemoModal.tsx is NOT modified, only consumed."
  This is the pattern the mobile memo screen should copy.
- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/app/api/memo/route.ts`
  CLAUDE.md propose-only. Gemini 2.5 Flash, rate limit 10 memos per 24h, 3 regenerations
  per UTC day for `type === "company"`. Response shape is
  `{ memo, output_id, regenerations_remaining_today? }`. `memo` is a MARKDOWN STRING.
  The route returns NO structured source list. `enforceMemoCitations` and
  `enforceCorroboratedFigures` only STRIP unsupported `[n]` anchors on the web path;
  they do not emit source records.
- `/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/app/api/memo-cache/route.ts`
  `ELIGIBLE_MEMO_TYPES = new Set(["company"])`. 24h TTL. The comment above it is the
  proof that CompanyIntelMemoModal is dead code.

## Shared component to extract first

**`CitedProse`**: a markdown renderer that segments text on `[n]`, renders each anchor
as a real `<button>` with an expanded invisible hit box, and delegates activation to a
caller-supplied handler.

Extract it from
`/Users/noahhanning/breakingalpha-wt/mobile-briefs/src/components/memo/CompanyIntelMemoModal.tsx`
lines 104 to 135 (`Segment`, `segmentTextWithCitations`) and lines 297 to 395
(`renderTextWithCites`, `renderChildrenWithCites`, `mdComponents`). That logic is
correct, tested by use, and currently trapped inside a component with no live hosts.
Lifting it is the single act that lets the mobile memo ship without touching either
propose-only file.

Consumed by:

1. Mobile Memo screen. Anchors open a bottom sheet.
2. Desktop `CompanyIntelMemoModal`, if it is ever revived. Anchors scroll a rail.
3. `PrimerWebMemo` (`src/components/company/states/PrimerWebMemo.tsx`), the only
   surface in the repo that passes a `sources` array today. Its anchors currently do
   nothing, because it renders through `MemoModal`, which does not segment citations.

What varies between them, and only this:

- The activation target. Rail scroll plus 220ms gold flash on desktop, versus a
  `v3up` 280ms bottom sheet on mobile. Pass a single `onCite(n: number)` callback.
- The disabled predicate. Both need `n >= 1 && n <= sources.length`, so keep that
  inside the component and expose the styling via a class prop.
- The hit box. The mobile anchor needs the prototype's `inset:-15px -9px` pseudo
  element (.dc.html line 1927), the desktop anchor does not. Make it a boolean prop.

Nothing else varies. The prose typography differs (14px/1.7 on mobile versus
`leading-relaxed` on desktop) but that belongs to the `mdComponents` map the caller
supplies, not to the segmenter.

## Component inventory

| Component | Existing path | Status | Note |
|---|---|---|---|
| CompanyKPIStrip | `src/components/company/CompanyKPIStrip.tsx` | Needs variant | Six cells in a `repeat(6, minmax(120px,1fr))` scroller. Mobile needs four in a 2x2. The `/api/company-kpis` fetch, the `KpiState` machine and `shouldRenderPrivate` are reusable verbatim; only `Cell` layout and the cell set change. |
| ToneReadout | `src/components/company/ToneReadout.tsx` | Reusable as-is | Already has a `panel` scale at 20/12/11 and its own insufficient branch. Prototype renders 21px. Add a scale key rather than forking. |
| ToneEvidenceList | `src/components/company/tone/ToneEvidenceList.tsx` | Needs variant | Row anatomy differs (per-article rows versus the prototype's grouped sentences) and the overflow line points at an Articles tab mobile does not have. |
| ToneArticleDetail | `src/components/company/tone/ToneArticleDetail.tsx` | Needs variant | Consumed by ToneEvidenceList as the row detail. On mobile it should be the same bottom sheet the memo citations use. |
| PrimerTab | `src/components/company/tabs/PrimerTab.tsx` | Reusable as-is | It is a composition root with two fetches and a `briefSlot`. Keep the fetch and fallback chain; restyle children. |
| PrimerSnapshot | `src/components/company/tabs/primer/PrimerSnapshot.tsx` | Needs variant | `grid-cols-2 sm:grid-cols-4` to a stacked label/value list. Prototype drops Company and Ticker, adds Headquarters. |
| PrimerBusinessOverview | `src/components/company/tabs/primer/PrimerBusinessOverview.tsx` | Reusable as-is | Prose block. Not opened line by line; named here because PrimerTab imports it at line 32 and the prototype renders its output. |
| PrimerKeyStats | `src/components/company/tabs/primer/PrimerKeyStats.tsx` | Needs variant | `grid-cols-2 sm:grid-cols-3` to the prototype's bordered 2x2. Attribution notes must survive the reflow. |
| PrimerFinancialSnapshot | `src/components/company/tabs/primer/PrimerFinancialSnapshot.tsx` | Needs variant | Prototype relocates this content out of Primer entirely. |
| FilingsTab | `src/components/company/tabs/FilingsTab.tsx` | Needs variant | Table to stacked rows. Chips already match `FILTER_LABELS` exactly; they need 44px content-box padding per README. |
| filing-categories | `src/lib/filing-categories.ts` | Reusable as-is | Pure. Zero changes. |
| FinancialsTab | `src/components/company/tabs/FinancialsTab.tsx` | Needs variant | Five or eight period columns cannot fit 390px. The prototype shows two. Column windowing is a real design decision, not a restyle. |
| financials-format | `src/components/company/tabs/financials-format.ts` | Reusable as-is | Pure. Zero changes. |
| InsiderTab | `src/components/company/tabs/InsiderTab.tsx` | Needs variant | Nine-column table to the prototype's card plus compact rows. The `other` group needs a mobile home. |
| empty-state-copy | `src/components/company/tabs/empty-state-copy.ts` | Reusable as-is | Pure, unit-tested. Zero changes. Use it, do not restate its copy. |
| CompanyDetailLayout | `src/components/company/CompanyDetailLayout.tsx` | Needs variant | Keep the all-panels-mounted rule. Drop the `lg:grid-cols-[1.55fr_1fr]` rail and the Alt+1..9 handler. |
| CompanyDetailTabs | `src/components/company/CompanyDetailTabs.tsx` | Needs variant | Seven tabs to five chips, and the chips carry no InfoTooltip on mobile. |
| ComingSoonTab / ComingSoonCard | `src/components/company/tabs/ComingSoonTab.tsx`, `src/components/company/ComingSoonCard.tsx` | Not ported | README Gap 3. Nothing to render. |
| MemoModal | `src/components/memo/MemoModal.tsx` | Reusable as-is | Propose-only. CONSUME, never edit. |
| CompanyIntelMemoModal | `src/components/memo/CompanyIntelMemoModal.tsx` | Needs variant | Dead code with the right ideas in it. Harvest, do not mount. |
| `CitedProse` | none | NET NEW | Closest analogue: `segmentTextWithCitations` plus `renderChildrenWithCites` in `src/components/memo/CompanyIntelMemoModal.tsx` lines 114 to 348. |
| `SourceSheet` (memo citation bottom sheet) | none | NET NEW | Closest analogue: the sources rail `<li>` in `src/components/memo/CompanyIntelMemoModal.tsx` lines 581 to 624, which carries the `[n]` badge, title link, and `source · date` line. The sheet adds a quote and a primary action; neither exists in the repo. |
| Memo screen shell | none | NET NEW | Closest analogue: `src/components/company/CompanyMemoModalListener.tsx`, the consume-only bridge pattern. |
| `.md` export | none | NET NEW | Closest analogue: `downloadMemoPdf` in `src/lib/download-memo-pdf.ts`, wired at `MemoModal.tsx` line 405 and `CompanyIntelMemoModal.tsx` line 405. Both export PDF. Nothing in the repo exports markdown. |

## States

### Company Intel, screen level

- Loading: `src/app/company/[id]/loading.tsx` renders `LoadingState`, which wraps
  `LoadingSkeleton` (header strip, alias ribbon, KPI four-tile row, tab strip, then the
  two-column grid) plus `LoadingStatusChip` for the live region. Handoff: the prototype
  has NO company-level loading state and the dev strip exposes no company lifecycle
  jump. UNSPECIFIED. The skeleton shape must be re-derived for a 2x2 KPI grid.
- Error: UNSPECIFIED. `page.tsx` has no error branch; a `getCompanyDetail` throw is an
  unhandled server error today. github.md line 138 records the governing principle from
  `src/app/cross-source/page.tsx`, quoted there as "This is a failed read, not an empty
  result. Nothing is being hidden." That principle is stated for the brief surfaces, not
  for Company Intel.
- Empty: `page.tsx` lines 93 to 100. A null `companyDetail` renders
  `CompanyAutoResolve` plus `EmptyState` inside the shell, with the tab grid NOT
  mounted. Handoff: UNSPECIFIED.
- Stale: UNSPECIFIED everywhere. README defines `briefStage` stale and `isStale` copy
  for the brief surfaces only. Company Intel has no freshness marker in the prototype,
  yet the KPI strip's Last and Market cap are live quote data and the tone level is a
  trailing 7-day read. No source of truth for "how old is this" exists on the screen.

### Company Intel, per section

Primer:
- Loading: real and per-block. `PrimerTab` holds `loading` (quote fetch) and
  `normalized` (overview fetch) independently. `PrimerKeyStats` renders
  "Loading market data..." in the empty slot while `loading` is true. Handoff:
  UNSPECIFIED, the prototype renders Primer fully resolved.
- Error: silent by design. Both fetches swallow non-abort errors and fall back
  (`PrimerTab` lines 95 to 101 and 135 to 138). There is no error UI. Handoff:
  UNSPECIFIED.
- Empty: three independent empties. Business overview HIDES ENTIRELY when neither
  live nor curated text exists (`PrimerTab` line 160). Key stats renders "Market data
  not available. This company is private, pre-IPO, or not currently quoted."
  Financial snapshot renders `financialsEmptyCopy(hasCik)`. Handoff: UNSPECIFIED.
- Stale: UNSPECIFIED. The normalized overview is write-through cached server-side with
  no age surfaced.

Price and tone:
- Loading: none. Tone is server-resolved in `companyDetail`. Handoff: UNSPECIFIED.
- Error: UNSPECIFIED.
- Empty: two distinct, both real. `ToneReadout` insufficient branch renders "Not enough
  recent coverage" plus "No articles in the last 7 days" (zero seen) or "Based on N
  articles so far" (nonzero but insufficient). `ToneEvidenceList` returns `null` when
  the 7-day window has no rows, so the section can render a level with no evidence list
  beneath it. Handoff: the prototype shows the sufficient branch only. UNSPECIFIED.
- Stale: UNSPECIFIED. The window is a fixed trailing 7 days with no as-of stamp.

Filings:
- Loading: none, server-resolved. Handoff: UNSPECIFIED.
- Error: UNSPECIFIED. `fetchCompanyFilings` failure is not distinguished from empty.
- Empty: THREE, all sourced. (1) No CIK or zero filings: `filingsEmptyCopy(hasCik)`,
  i.e. "No recent 8-K, periodic, or insider filings." with CIK, or "No SEC filings.
  This company is private, pre-IPO, or not in the EDGAR coverage list." without, plus an
  EDGAR link only on the has-CIK branch. (2) Filter empty with a chip pinned: "No filings
  in this category." (3) Default view empty: "No material filings recorded. Every stored
  filing for this company is an insider form; use the Insider chip or the Insider tab."
  Handoff: the prototype ships ONE of these, the Other-chip empty at .dc.html line 846,
  "Nothing uncategorised" plus "The two filings here are prospectus supplements, both
  superseded." That copy has no source counterpart and is prototype fiction.
- Per-row stale: real and named. A filing whose summary is null renders "Summary
  pending" in italic muted (`FilingsTab` lines 184 to 189). The prototype carries this
  verbatim at .dc.html line 850.

Financials:
- Loading: none, server-resolved. Handoff: UNSPECIFIED.
- Error: UNSPECIFIED.
- Empty: `financialsEmptyCopy(hasCik)` on `!hasCik || !hasAnyData`, i.e. "Financials
  appear after the first periodic report." or "SEC fundamentals are not available for
  this company yet." Note the module comment: the no-CIK branch is deliberately NEUTRAL
  because an on-demand minted public ticker has a null CIK and is not private.
  Handoff: UNSPECIFIED.
- Per-cell empty: a missing cell renders a dash, never zero, and a row empty across
  every visible period is dropped entirely. Both are load-bearing and both are stated
  in the prototype's closing note.
- Stale: UNSPECIFIED. Periods are labelled (FY2025, Q2 26) which is the only recency
  signal.

Insider:
- Loading: none, server-resolved. Handoff: UNSPECIFIED.
- Error: UNSPECIFIED.
- Empty: `insiderEmptyCopy(hasCik)` returns a `{ headline, note }` pair. No CIK:
  "No SEC identity is on file for this company, so Form 4 insider transactions are not
  tracked." with a null note. Has CIK: "No qualifying insider transactions are on file
  for this company." plus `INSIDER_COVERAGE_NOTE`. The module states that "polled and
  empty" versus "never polled" are not distinguishable and must not be split.
  Handoff: UNSPECIFIED.
- Stale: UNSPECIFIED, and this is the section where it matters most, because absence is
  explicitly not evidence of absence per the coverage note.

### Memo

README State table: `memoStage: 'loading' | 'ready' | 'error'`, plus `openCite`.
Carried in full.

- Loading (`memoLoading`, .dc.html 1899 to 1910): a skeleton of one 34 percent bar, one
  78 percent bar, then three paragraph groups, closing on a live status line "Reading 34
  indexed articles and 4 filings." The footer is NOT rendered while loading. Source
  analogue: `MemoSkeleton` in `CompanyIntelMemoModal.tsx` lines 687 to 705, which uses
  `animate-pulse`; README specifies `skeletonShimmer` 1.8s infinite instead.
- Ready (`memoReady`, default `true` in the initial state at .dc.html line 2966): the
  full memo plus the numbered source list plus the footer.
- Error (`memoError`, .dc.html 1912 to 1919): a bordered red well, heading "Generation
  did not complete.", body "The source set came back empty, so nothing was written.
  Nothing has been saved and no partial memo is shown.", and a 44px "Try again" that
  calls `retryMemo`. Note the body asserts a SPECIFIC cause; `/api/memo` returns five
  different failure strings including "Failed to generate memo", "Gemini returned empty
  memo, retry" and a 401. Only one of those matches the copy.
  Source analogues: `ErrorBanner` plus `handleRetry` in `CompanyIntelMemoModal.tsx`
  lines 421 to 423 and 723 to 756 (has a retry), versus `MemoModal.tsx` lines 323 to 333
  (Close only, no retry). The live surface is the one without a retry.
- Empty: `CompanyIntelMemoModal` has a fourth branch the prototype does not,
  `isEmpty` at line 452, rendering "No memo available." UNSPECIFIED in the handoff.
- Stale: UNSPECIFIED as a UI state, but real in the data. `/api/memo-cache` serves a 24h
  TTL cached memo for `type === "company"`. The prototype prints "GENERATED 06:59, AUG 6"
  as a static string with no staleness treatment.
- Action states, from the logic class: Copy goes to "checkmark Copied"; Export .md goes
  "Preparing..." then "checkmark Saved" (lines 3532 to 3534). Each fires a transient
  notice line, "The memo and all five sources copied as plain text." and "Saved as
  CEG-company-brief.md with the citations intact." (lines 3538 to 3539).
- Citation sheet: `citeOpen` is `s.openCite != null`. Content per source is title, meta,
  quote, action, from the `CITES` map at .dc.html lines 2929 to 2940. Source [5] is the
  user's own ledger entry with the action "Open the entry".

## Lucas-protected files

**None of the four named in my instructions is touched by this batch's sources.**
Explicitly:

- `src/app/api/briefing/route.ts`: not imported by any file in this batch.
- `src/lib/watchlist-utils.ts`: not imported. `CompanyDetailHeader.tsx` calls
  `/api/watchlist` over HTTP, which is not a source edit.
- `src/components/watchlist/WatchlistAddInput.tsx`: not imported.
- `src/app/trends/page.tsx`: not imported. It is a batch-6 concern.

The Memo screen sits on the two CLAUDE.md propose-only files, and both are avoidable.

**`src/components/memo/MemoModal.tsx`** (CLAUDE.md propose-only). This is the component
that actually renders the company brief today, mounted by
`CompanyMemoModalListener.tsx` in response to a `memo:generate` window event fired by
`CompanyDetailHeader.tsx` line 92. The mobile Memo screen lands without editing it by
doing exactly what that listener already does: consume, do not modify. The mobile
screen is a NEW route component that calls `POST /api/memo` itself, or reuses the
`memo:generate` event, and renders its own markup. `MemoModal` stays mounted for every
desktop caller and is not imported by the mobile screen at all. The listener's own
comment is the precedent: "The Lucas-protected MemoModal.tsx is NOT modified, only
consumed."

**`src/app/api/memo/route.ts`** (CLAUDE.md propose-only). The mobile screen needs
nothing from it that it does not already return. `POST /api/memo` with
`{ content, type: "company", systemPrompt }` returns `{ memo, output_id,
regenerations_remaining_today }`, and `page.tsx` already builds `content` and
`systemPrompt` via `buildMemoContent` and `buildMemoSystemPrompt`. The mobile screen
reuses that payload unchanged.

ONE CAVEAT, and it is the only thing that could force a route edit: the route returns
markdown and nothing else. The mobile citation sheet needs a per-source title,
publisher, date, and the specific line the memo leaned on. None of that is in the
response. See Open questions 1.

**CONTRADICTION, flagged and not resolved.** Three lists of protected files disagree.

1. My instructions name four: `src/app/api/briefing/route.ts`,
   `src/lib/watchlist-utils.ts`, `src/components/watchlist/WatchlistAddInput.tsx`,
   `src/app/trends/page.tsx`.
2. The repo's own `CLAUDE.md` names six under "Propose-only files", adding
   `src/components/memo/MemoModal.tsx` and `src/app/api/memo/route.ts`, and frames the
   rule differently: "High-blast-radius or actively-iterated files... This is about file
   sensitivity, not ownership."
3. A third list lives in the source itself. `src/components/company/CompanyKPIStrip.tsx`
   lines 5 to 6 say: "Lucas-protected: does NOT modify watchlist-utils.ts,
   WatchlistAddInput.tsx, trends/page.tsx, briefing/route.ts, or MemoModal.tsx." That is
   five, and it calls `MemoModal.tsx` Lucas-protected, which is the ownership framing
   CLAUDE.md explicitly disclaims. `CompanyMemoModalListener.tsx` line 9 repeats it:
   "The Lucas-protected MemoModal.tsx".

So `MemoModal.tsx` is Lucas-protected per two source comments, propose-only per
CLAUDE.md, and unlisted per my instructions. `api/memo/route.ts` is propose-only per
CLAUDE.md and unlisted everywhere else. I am not picking a winner. For this batch it
does not matter, because the plan edits neither. It will matter the moment question 1
is answered "extend the route".

## Designed fresh, no repo counterpart

None. github.md grounds every screen in this batch. Its Screen map rows read:

> | Company Intel, header KPIs | `src/components/company/CompanyKPIStrip.tsx` |
> | Company Intel, Primer | `src/components/company/tabs/PrimerTab.tsx`, `primer/PrimerKeyStats.tsx`, `primer/PrimerFinancialSnapshot.tsx` |
> | Company Intel, Price & tone | `src/components/company/ToneReadout.tsx`, `src/components/company/tone/ToneEvidenceList.tsx` |
> | Company Intel, Filings | `src/components/company/tabs/FilingsTab.tsx`, `src/lib/filing-categories.ts` |
> | Company Intel, Financials | `src/components/company/tabs/FinancialsTab.tsx`, `tabs/financials-format.ts` |
> | Company Intel, Insider | `src/components/company/tabs/InsiderTab.tsx`, `tabs/empty-state-copy.ts` |
> | Company Intel, Generate memo | `src/components/memo/CompanyIntelMemoModal.tsx` |

MAPPED BUT MISSING: none. Every path resolves. Two notes on resolution rather than
absence: `primer/PrimerKeyStats.tsx` and `primer/PrimerFinancialSnapshot.tsx` are
written relative to the preceding `tabs/` path and resolve to
`src/components/company/tabs/primer/`. There is no `src/components/company/primer/`
directory. Same for `tabs/financials-format.ts` and `tabs/empty-state-copy.ts`.

Sub-blocks that ARE fresh, inside grounded screens:

- The prototype's "your entries on this name" block (.dc.html lines 786 to 793): a
  challenged ledger entry card plus a "Following since Jun 2" card. github.md does not
  map it. No repo counterpart exists on the company page.
- The memo's "AGAINST YOUR OWN RECORD" block. github.md line 43 claims it as an
  addition: "Added the user's own ledger entry as a numbered source in the memo
  apparatus, alongside filings and wire stories."
- The Filings "Nothing uncategorised" empty copy.
- Primer key figures EV/EBITDA and NUCLEAR CAPACITY.

## NOT PORTED and deviations

**Transcripts and Comps, refused.** github.md line 40:

> Refused Transcripts and Comps (the repo renders them via `ComingSoonTab.tsx`); Brief
> is not a mobile tab because the whole app is a brief.

README Gaps, item 3:

> **Company Intel Transcripts and Comps tabs** — the repo renders both via
> `ComingSoonTab.tsx`, so there is nothing to port.

CONTRADICTION with the repo, flagged not resolved. The repo does NOT render both via
`ComingSoonTab.tsx`. `src/app/company/[id]/page.tsx` builds a `tabContent` record with
seven keys (`brief`, `articles`, `trend`, `filings`, `financials`, `insider`, `comps`)
and `comps: <ComingSoonTab tabId="comps" />` is the ONLY ComingSoonTab in it. There is
no `transcripts` key. `CompanyDetailLayout` skips ids with no content
(`if (!content) return null`), and `TAB_ORDER` in `src/hooks/useCompanyTabState.ts` does
not contain `transcripts`, so no button exists either. The hook's own comment states it:
"Themes and Sources were cut; Transcripts is dropped from the bar (no button)."
`ComingSoonTab.tsx` still declares a `transcripts` slot in `SLOTS`, but nothing
constructs it. The refusal reaches the right answer from a false premise.

**Brief omitted as a mobile tab.** Same github.md line 40: "Brief is not a mobile tab
because the whole app is a brief." Note what this actually means in the repo: `brief` is
the DEFAULT tab id and it does not render a brief. `page.tsx` line 183 assigns
`brief: <PrimerTab ... />`, and `PrimerTab`'s own comment says "The Coverage Primer
replaces the per-company brief tab in place". The desktop brief survives inside the
Primer as `briefSlot`, an embedded `BriefTab`, which the prototype renders as "recent
developments". So Brief is not omitted on mobile; it is nested, exactly as it is on
desktop. github.md's stated reason does not match the mechanism.

**CONTRADICTION, the ten-tab list.** github.md Notes:

> Tab list read from `CompanyDetailTabs.tsx`: Brief, Articles, Themes, Price & Tone,
> Sources, Filings, Financials, Transcripts, Insider, Comps.

That is `TAB_LABELS`, the id-to-label map at `CompanyDetailTabs.tsx` lines 19 to 30. The
strip renders `TAB_ORDER.map(...)` at line 61, and `TAB_ORDER` is seven ids: Brief,
Articles, Price & Tone, Filings, Financials, Insider, Comps. Themes and Sources have no
buttons and no content. The mobile design therefore drops FIVE surfaces from the shipped
seven, not five from ten.

**Articles, dropped without a record.** `articles` is the second tab in `TAB_ORDER` and
`page.tsx` line 209 mounts `<ArticlesTab articles={articlesForTab} />` over a merged
list that can include `getArticleFallback` rows. It is absent from the mobile section
set and github.md does not mention it. Compounding: `ToneEvidenceList` line 94 renders
"+N more this week in the Articles tab", copy that will be false on mobile.

**Trends, mapped to a Lucas-protected file.** github.md maps Trends to
`src/app/trends/page.tsx`. That is batch 6, listed here only so the batch boundary is
explicit: nothing in batch 5 reads it.

**NOT PORTED from CompanyKPIStrip:** the Last cell and the Articles today cell, with its
`eventsToday` sub-count derived from `dealType` in `["M&A", "Earnings", "Funding",
"IPO"]`. Also the `Tooltip` wrappers on the Mentions and Article tone labels, which is
where the "Not a price signal" sentence lives on desktop. The prototype promotes that
sentence into the Price and tone section body instead.

**NOT PORTED from InsiderTab:** the `other` group (gifts, conversions, codes outside the
two named categories) and its heading. Also the Value column, which the desktop
computes via `formatValue(t.totalValue)`.

**NOT PORTED from FinancialsTab:** cost of revenue, EPS basic, diluted shares, total
liabilities, cash and equivalents, the noncontrolling-interest equity breakdown with its
computed "= Total equity" line, the per-row `Src` filing deep link, the non-USD currency
note, and `FinancialsCommentary`. The prototype shows two period columns against the
desktop's five annual or eight quarterly.

**NOT PORTED from MemoModal:** `ThumbsControl` output feedback (line 387), the
`parseSections` staggered ink fade, and `regenerations_remaining_today`, which the route
returns specifically so a frontend can render a quota counter without a second round
trip.

**DEVIATION, Export PDF to Export .md.** Both memo components ship Export PDF via
`downloadMemoPdf`. The prototype ships "Export .md" with the notice "Saved as
CEG-company-brief.md with the citations intact." No markdown export exists in the repo.
Not recorded as a deviation in github.md.

**DEVIATION, the memo citation defect.** github.md line 42:

> Fixed a real mobile defect while porting it: the desktop sources rail is
> `hidden lg:block`, so at phone width every inline `[n]` citation anchor points at
> nothing. Citations now raise the source as a bottom sheet.

README repeats it under Interactions:

> The desktop implementation scrolls a sticky sources rail, which is `hidden lg:block`
> — so at phone width every anchor currently points at nothing. The sheet is the mobile
> inversion of that, and it is better than the desktop behaviour rather than a degraded
> version.

The mechanism is real and the string is exact: `hidden lg:block` appears exactly once in
the repo, at `src/components/memo/CompanyIntelMemoModal.tsx` line 573. Because it is a
CSS class and not a conditional render, the `<li>` elements still mount and populate
`sourceRefs`, so `handleCiteClick` finds a node and calls `scrollIntoView` on a
`display:none` element. It does not throw. It does nothing visible, and the 220ms gold
flash paints on a hidden node. The anchor is live, focusable, and inert.

CONTRADICTION, flagged not resolved: the defect is in a component with NO LIVE HOSTS.
`src/app/api/memo-cache/route.ts` line 44 states "the only company-anchored modal
(CompanyIntelMemoModal) has no live hosts", and a repo-wide grep confirms no importer.
The component the company page actually mounts is `MemoModal`, which has no rail, no
`hidden lg:block`, and no inline `[n]` anchors at all. Its `mdComponents` pass children
through untouched, so a `[3]` in the memo prose renders as literal text. And the only
caller in the entire repo that passes a `sources` array is
`src/components/company/states/PrimerWebMemo.tsx` line 174, which is gated behind
`NEXT_PUBLIC_WEB_FALLBACK_ENABLED` and default off. So on the live company brief path
today there is no rail, no anchor, and no source list. The bottom sheet is not an
inversion of a broken desktop behaviour; it is the first citation UI this product would
ship. That is a stronger claim than the handoff makes, and it changes the estimate.

**DEVIATION, the 44px exception.** README Geometry:

> **Tap targets: 44px minimum, no exceptions.**

then, one paragraph later:

> **Inline citations are the one deliberate exception**: a 17px glyph in flowing prose
> cannot be 44px without wrecking the line. They carry an expanded invisible hit box
> measuring ~47px, and every source additionally has a 59px row in the list at the foot
> of the memo, so no source is reachable only through the small anchor.

Both halves are in the prototype and both are load-bearing. The anchor is
`position:relative` (`citeStyle`, .dc.html line 3690) with a `style-after` of
`content:'';position:absolute;inset:-15px -9px`, giving roughly 47px of vertical hit box
around a 17px glyph. In React that is a `::after` on a `<button>`, not a wrapper div,
because a wrapper changes the line box. The redundant path is real: every one of the five
`[n]` rows in the source list at .dc.html lines 1947 to 1951 carries the same
`onClick={cite<n>}` as the inline anchor, so the sheet is reachable twice. Do not ship
the anchor without the list. That is the whole reason the exception is granted.

The literal "no exceptions" and "the one deliberate exception" sit two paragraphs apart
in the same section. Quoted both, not resolved.

**DEVIATION, em dashes in shipped code.** README compliance rule 4 is "No em-dashes
anywhere", and rule 1 extends the substring ban to "code identifiers and comments, since
a compliance grep over source will hit them". Three hits in this batch's sources:

- `src/app/company/[id]/page.tsx` line 70: `title: \`${name} — Company Intel\``. That is
  the browser tab title, user-facing, with a literal em dash.
- `src/components/company/tabs/FinancialsTab.tsx` line 96: `<span
  className="text-text-muted">&mdash;</span>`, the missing-value cell. Every sparse row
  in the desktop financials table renders an em dash. The prototype uses an en dash.
- `src/hooks/useCompanyTabState.ts` line 8, a comment.

And on rule 1's substring ban, `FinancialsTab.tsx` lines 160 and 164 render the row
labels "Stockholders' equity (parent)" and "Stockholders' equity", both containing the
banned substring "hold" in user-facing copy. The prototype's financials table renders
"Total equity" and no stockholders' equity row at all, which sidesteps it. github.md does
not record that as a compliance-driven choice.

**Open compliance conflicts from github.md that touch this batch:** none of the seven
listed conflicts names a Company Intel or Memo file. The four em-dash and substring hits
above are new and unlogged.

## Open questions

1. **The citation sheet has no data contract.** `POST /api/memo` returns
   `{ memo, output_id, regenerations_remaining_today? }` where `memo` is a markdown
   string. The prototype's sheet needs, per source, a title, a publisher, a date, a
   quote of "the specific line the memo leaned on" (README), and a typed action
   ("Open on EDGAR" versus "Open the article" versus "Open the entry"). None of it is in
   the response, and the only caller in the repo that supplies a `sources` array is
   flag-gated off. Three ways out, and this one decision gates the whole Memo screen:
   (a) extend `/api/memo` to return structured sources, which requires editing a
   CLAUDE.md propose-only file and therefore a Lucas diff; (b) build the source list
   client-side from the same `developmentArticles` and `contextArticles` that
   `buildMemoContent` already consumes in `page.tsx`, which keeps the route untouched but
   means the sheet's quote is an article summary rather than the line the memo used; or
   (c) ship the memo with no citations on mobile first. Which?
2. **Does the mobile memo render inline `[n]` anchors at all today?** The company-path
   prompt is built by `buildMemoSystemPrompt` in `src/lib/company-intel.ts`, and
   `enforceMemoCitations` (`src/lib/web-memo-entity.ts` line 283) only STRIPS anchors on
   the web path. If the company prompt does not instruct Gemini to emit `[n]`, the entire
   citation apparatus, sheet and 44px exception included, has nothing to attach to. I did
   not open `company-intel.ts`; it is outside the mapped set. Needs one grep before the
   Memo screen is scoped.
3. **EV/EBITDA and NUCLEAR CAPACITY.** The prototype's Primer key-figures grid shows
   four cells and two of them have no data source. `PrimerKeyStats` offers eight fields
   and neither is among them; `QuoteSummaryLive` does not carry enterprise value or
   EBITDA, and "nuclear capacity" is a per-company fact with no schema anywhere. Ship the
   real eight in a 2x2 window, or add an EV/EBITDA computation, or accept a company-
   specific slot? The prototype's other three cells are all real fields.
4. **Where does PrimerFinancialSnapshot go?** github.md maps it to Primer.
   The prototype puts no snapshot in Primer and a two-column table in Financials.
   Either the mobile Primer grows a snapshot section the prototype does not show, or the
   mapping is wrong and the snapshot is superseded by the Financials section. These are
   different builds.
5. **Financials column windowing.** The desktop shows five annual or eight quarterly
   period columns. The prototype shows two. Two columns is not a restyle, it is a data
   decision: which two, is it always the newest pair, and is the rest reachable? An
   `overflow-x: auto` table on a 390px column is the obvious alternative and the
   prototype rejected it. Confirm the two-column read is intended and permanent.
6. **The Articles surface.** `articles` is a shipped desktop tab with a real fallback
   merge path, it is absent from the mobile five, and github.md does not record dropping
   it. Also `ToneEvidenceList` hardcodes "+N more this week in the Articles tab", which
   becomes a dangling reference. Drop Articles and rewrite that string, or add a sixth
   section?
7. **The Insider `other` group.** Gifts and conversions are real Form 4 rows the desktop
   groups separately. The mobile design shows two of three groups. Dropping them means a
   company whose only insider activity is a gift renders an empty Insider section while
   the data exists. Fold `other` into routine, or add a third group?
8. **Company Intel has no loading, error or stale state in the handoff.** The prototype
   has no company lifecycle jumps in its dev strip, and README's `*Stage` table covers
   brief, wrap, dash and memo only. The screen carries live quote data and a 7-day tone
   window, so a stale read is a real condition. Does Company Intel get a `companyStage`
   machine, or does it inherit the route-level `loading.tsx` and nothing else?
9. **The memo error copy asserts one specific cause.** "The source set came back empty,
   so nothing was written." `/api/memo` can fail as a 401, a 429 rate limit (10 per 24h),
   a quota exhaustion for `type === "company"` (3 regenerations per UTC day), an empty
   Gemini return, or a generic 500. Rendering the empty-source-set sentence for a rate
   limit is a false statement about the user's own account. Does the mobile error state
   branch on the route's error, and does the quota case get its own copy?
10. **`CompanyIntelMemoModal` is dead code that this batch is built on.** github.md maps
    the Memo screen to it, the repo confirms it has no live hosts, and the shipped path
    uses `MemoModal` instead. Building the mobile memo means either reviving it (a
    desktop change nobody asked for), harvesting the citation logic into a shared
    component and leaving the fork to rot, or deleting the fork. I recommend harvest, per
    the Shared component section. Confirm before the extraction lands, because deleting
    a 756-line file is not a mobile-redesign decision.
