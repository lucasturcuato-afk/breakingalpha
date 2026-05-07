# W2-C Phase 1 Build PR Specs

Date: 2026-05-07
Source: 5-phase recon synthesis + smoke-test recipe + Direction D visual spec.
Status: pre-build draft. Specs are authoritative for sub-PR construction; deviations require Noah approval.

Scope: 22 sub-PRs branching off `noah/w2-c-phase-1`. Final integration via PR #197 to `main` after all 22 ship.

Cross-references:
- Smoke-test recipe: `docs/w2-c-phase-1-smoke-test-recipe.md` (180 rows)
- W2-D backlog: `docs/w2-d-backlog.md` (29 items)
- A11y baseline: `docs/axe-baseline-2026-05-07.md` (96 nodes, 5 rules)
- Visual spec: `docs/DirectionD.jsx` (1493 lines)
- Shared shapes: `docs/data (1).jsx`
- Primitive library: `docs/primitives (1).jsx`

Lucas-protected paths (DO NOT MODIFY in any sub-PR):
- `src/lib/watchlist-utils.ts`
- `src/components/watchlist/WatchlistAddInput.tsx`
- `src/app/trends/page.tsx`
- `src/app/api/briefing/route.ts`
- `src/components/memo/MemoModal.tsx` (shared, 17 callers)

## 1. Critical findings reference

| ID | Finding |
|---|---|
| C1 | No structured memo cache exists; outputs / watchlist_briefs / briefings all unstructured Markdown. |
| C2 | `/api/memo` doesn't persist; client-side cache lives in `watchlist_briefs` keyed by identifier with 12h TTL. |
| C3 | `/api/companies/[id]` route does NOT exist; today direct Supabase + cross-route import. |
| C4 | Alias canonical-rollup broken (6 NVDA rows; aliases point to self). |
| C5 | Direction D palette differs from existing tokens (6 differences + 5 net-new). |
| C6 | `companies.sector` / `description` / `notes` 100% empty (2,921 rows). |
| C7 | `articles.deal_type` over-fires; events_today equals articles_today. |
| C8 | No source tier classification. |
| C9 | `companies.key_themes` is `text[]` only (no weight/tone/count). |
| C10 | `companies.sentiment_trend` is text scalar (not numeric array). |
| C11 | Article-grounded memos emit no `[n]` markers; side-branch `a7d41cf` has fix. |
| C12 | Yahoo v10 quoteSummary needs crumb auth; v11 doesn't exist; v8 chart still keyless. |
| C13 | Pipeline a cycle behind; "today" KPIs frequently zero. |
| C14 | `recordOutput()` doesn't exist on main; side-branch `a67e69c` has SDK. |
| C15 | `CompanyIntelMemoModal.tsx` (746 LOC) is dead code on integration. |

## 2. Sub-PR sequence overview

| PR | Title | LOC | Depends on | Unblocks (recipe rows) |
|---|---|---|---|---|
| PR-A0 | tokens.css update to Direction D palette | ~25 | - | T8-T11; visual baseline for all subsequent |
| PR-A1 | Port 7 primitives + extend SentimentPill | ~250 | A0 | A5, B3, B4, F2, G1 |
| PR-A2 | Tab system scaffold + CompanyDetailLayout + keyboard handler + URL state | ~320 | A0 | T1-T7, K1-K6, U1-U4 |
| PR-A3 | `getCompanyDetail()` data layer in `src/lib/data-access/` | ~180 | - | D1-D6 (data plumbing) |
| PR-B0 | Alias canonical-rollup query-time WHERE ticker synthesizer | ~100 | A3 | AL1-AL4 |
| PR-B1 | CompanyDetailHeader + CompanyAliasRibbon | ~220 | A1, B0 | H1-H6, AL5 |
| PR-B2 | KPIStrip + `/api/company-kpis` route with crumb-auth | ~340 | A1, A3 | K1-K8, P1 (private) |
| PR-B3 | ThemesCard right rail + themes derivation helper | ~150 | A1, A3 | TH1-TH3 |
| PR-B4 | TrendCard right rail (MiniBars + Sparkline + SentimentHeat) + aggregation route | ~280 | A1, A3 | TR1-TR5 |
| PR-C0 | Structured-output memo writer (Gemini JSON mode + prompt rewrite) | ~200 | - | M1-M3, M5 |
| PR-C0a | Article-grounded `[n]` citation parity (re-do `a7d41cf`) | ~80 | - | M6, CIT1-CIT3 |
| PR-C1 | BriefTab content (cached memo + structured TLDR/LEAD/CONTEXT/WATCH + CitedText) | ~250 | A1, A2, C0, C0a | B1-B6 |
| PR-C2 | ArticlesTab + ArticlesTable bottom | ~220 | A2 | AR1-AR5 |
| PR-C3 | ThemesTab expanded view | ~140 | A2, B3 | TH4-TH6 |
| PR-C4 | TrendTab incorporating CompanyStockChart from PR #196 | ~180 | A2, B4 | TR6-TR8 |
| PR-C5 | SourcesTab + SourcesStrip footer + hard-coded source-to-tier map | ~200 | A2 | S1-S5 |
| PR-D1 | ComingSoonTab + F6/F7/F8/F9 placeholder content | ~140 | A2 | CS1-CS4 |
| PR-D2 | `recordOutput()` SDK + `/api/memo` integration via `after()` pattern A | ~180 | - | OBS1-OBS3 |
| PR-E1 | Empty state variant (Stripe pattern) | ~220 | A1, A2 | E1-E4 |
| PR-E2 | Web-fallback variant (Pershing typo + purple `[w1]` citations + ALIAS-RESOLVED banner) | ~270 | A1, A2, C1 | W1-W6 |
| PR-E3 | Loading state variant (skeleton + status chip) | ~140 | A1, A2 | L1-L3 |

Total spec'd: 21 sub-PRs (brief said "22" but enumerated list has 21 unique IDs; PR count corrected here for accuracy). Estimated combined LOC ~3963 across feature work.

## 3. Sub-PR specs

### PR-A0 -- tokens.css update to Direction D palette

- Branch: `noah/pr-a0-tokens-direction-d`
- Base: `noah/w2-c-phase-1`
- LOC: ~25 + 18 PNG fixtures
- Visual ref: `docs/DirectionD.jsx` lines 13-40 (palette constants `D.cream`, `D.gold`, `D.goldDark`, etc.)
- Files touched: `src/styles/tokens.css`
- Files NOT touched: all 5 Lucas-protected paths
- data-testid manifest: (none -- token PR)
- Smoke-test rows unblocked: T8-T11; visual regression baseline for all subsequent PRs.
- Depends on: none.
- Steps:
  1. Recon: read `src/styles/tokens.css` and DirectionD.jsx lines 13-40.
  2. Capture pre-A0 screenshots of 9 routes via Playwright + commit to `docs/visual-baseline-pre-A0/` BEFORE applying token swap.
  3. Add 5 net-new tokens: `--border-hi`, `--row-hover`, `--row-alt`, `--row-active`, `--purple`.
  4. Update 6 existing: `--gold`, `--gold-dark`, `--cream`, `--gold-muted`, `--gold-border`, `--border-base`.
  5. Capture post-A0 screenshots of 9 routes + commit to `docs/visual-baseline-post-A0/`.
  6. Verify `tsc` + `next build` clean.
  7. Push as DRAFT PR with full-route Playwright sweep on `/morning-brief`, `/evening-wrap`, `/dashboard`, `/company`, `/trends`.
- Self-review checks: tsc clean, em-dash count 0, LOC <= 30, 9 routes screenshot-diff'd, no Lucas files touched, 9-route screenshot diff committed (18 fixtures total), color-contrast nodes shifted by <=3 (else update T1 ceiling per recipe T11).
- Smoke-test on preview: gold tone shift on header buttons across 3 pages; cream surface tone on cards.

### PR-A1 -- Port 7 primitives + extend SentimentPill

- Branch: `noah/pr-a1-primitives`
- Base: `noah/w2-c-phase-1`
- LOC: ~250
- Visual ref: `docs/primitives (1).jsx` (full file); DirectionD.jsx Sparkline + MiniBars + SentimentHeat usages.
- Files touched: `src/components/ui/Delta.tsx`, `Cite.tsx`, `CitedText.tsx`, `Sparkline.tsx`, `MiniBars.tsx`, `SentimentHeat.tsx`, `Eyebrow.tsx`; `src/components/ui/SentimentPill.tsx` (extend xs/lg variants).
- Files NOT touched: Lucas list; `Wordmark` (already exists, KEEP); `PhoneBezel`, `AnnoPin` (EXCLUDE).
- data-testid manifest: `delta-positive`, `delta-negative`, `delta-neutral`, `cite-marker`, `cited-text-line`, `sparkline-svg`, `minibars-svg`, `sentiment-heat-cell`, `eyebrow-label`, `sentiment-pill-{xs,sm,lg}`.
- Smoke-test rows unblocked: A5, B3, B4, F2, G1.
- Depends on: PR-A0.
- Steps:
  1. Recon: read `docs/primitives (1).jsx` for shape; check existing `SentimentPill` for current variants.
  2. Create 7 primitive files under `src/components/ui/`, each <= 50 LOC, no business logic.
  3. Extend `SentimentPill` with `size?: "xs"|"sm"|"lg"` prop (default "sm" preserves current behavior).
  4. Add Storybook-style usage examples in JSDoc; ensure all primitives accept `data-testid` passthrough.
  5. Verify `tsc` + `eslint` + `next build` clean; push DRAFT PR.
- Self-review checks: tsc / eslint / em-dash 0 / LOC <= 270 / Lucas check / 10 data-testids present.
- Smoke-test on preview: render each primitive in `/sandbox/primitives` (temporary route, removed in same PR or follow-up).

### PR-A2 -- Tab system scaffold + CompanyDetailLayout + keyboard handler + URL state

- Branch: `noah/pr-a2-tab-scaffold`
- Base: `noah/w2-c-phase-1`
- LOC: ~320
- Visual ref: `docs/DirectionD.jsx` lines 495-528 (Detail), 613-645 (FunctionTabs), 528-581 (CompanyHeader frame).
- Files touched: `src/components/company/CompanyDetailLayout.tsx`, `CompanyDetailTabs.tsx`, `useCompanyTabState.ts` (URL hash sync); `src/app/company/[id]/page.tsx` (wire layout).
- Files NOT touched: Lucas list; CompanyIntelMemoModal.tsx (dead code, leave for cleanup PR).
- data-testid manifest: `company-detail-layout`, `company-tab-list`, `company-tab-{brief,articles,themes,trend,sources,coming-soon}`, `company-tab-panel-{...}`, `company-tab-empty-state`.
- Smoke-test rows unblocked: T1-T7, K1-K6 (keyboard nav), U1-U4 (URL state).
- Depends on: PR-A0.
- Steps:
  1. Recon: read DirectionD.jsx Detail + FunctionTabs blocks; check existing `src/app/company/[id]/page.tsx`.
  2. Build `CompanyDetailLayout` with header slot, KPI slot, tabs slot, right-rail slot, footer slot (slot pattern, content empty in this PR).
  3. Build `CompanyDetailTabs` with 7 tabs; ARIA `role="tablist"` + `tab` + `tabpanel`; arrow-key + Home/End navigation.
  4. Add `useCompanyTabState()` hook syncing active tab to URL hash (`#brief`, `#articles`, etc.); preserves on reload.
  5. Verify a11y baseline preserved (rerun axe; no new violations); push DRAFT PR.
- Self-review checks: tsc / eslint / em-dash 0 / LOC <= 350 / Lucas check / axe-baseline diff 0 / focus ring visible.
- Smoke-test on preview: tab keyboard nav, URL hash round-trip, focus trap absent.

### PR-A3 -- getCompanyDetail() data layer

- Branch: `noah/pr-a3-data-access`
- Base: `noah/w2-c-phase-1`
- LOC: ~180
- Visual ref: n/a (data layer).
- Files touched: `src/lib/data-access/getCompanyDetail.ts`, `src/lib/data-access/types.ts`, `src/lib/data-access/__fixtures__/company-detail.ts`.
- Files NOT touched: Lucas list; existing `/api/companies/[id]` (does not exist; this PR does NOT create the route, only the lib).
- data-testid manifest: (none -- data layer).
- Smoke-test rows unblocked: D1-D6 (data plumbing for B/C series).
- Depends on: none.
- Steps:
  1. Recon: read DirectionD.jsx data shapes (`window.NVIDIA`, `window.PERSHING`, `window.DIRECTORY`); read `docs/data (1).jsx`.
  2. Define `CompanyDetail` type: `{ company, kpis, themes, trend, articles, sources, memo, aliases }`.
  3. Implement `getCompanyDetail(idOrTicker: string): Promise<CompanyDetail | null>` with single Supabase round-trip + cross-table joins.
  4. Add fixture for tests/preview; align fixture shape to DirectionD `N` constant.
  5. Verify tsc + lint; push DRAFT PR.
- Self-review checks: tsc / eslint / em-dash 0 / LOC <= 200 / no business logic in component layer / fixture matches type.
- Smoke-test on preview: hit `getCompanyDetail("NVDA")` from a debug page; confirm shape.

### PR-B0 -- Alias canonical-rollup query-time synthesizer

- Branch: `noah/pr-b0-alias-rollup`
- Base: `noah/w2-c-phase-1`
- LOC: ~100
- Visual ref: n/a (query layer); see C4 in section 1.
- Files touched: `src/lib/data-access/getCompanyDetail.ts` (extend), `src/lib/data-access/aliasResolver.ts` (new).
- Files NOT touched: Lucas list; companies table schema (no migration; query-time only).
- data-testid manifest: (none).
- Smoke-test rows unblocked: AL1-AL4 (alias rollup correctness; 6 NVDA rows collapse to 1).
- Depends on: PR-A3.
- Steps:
  1. Recon: query Supabase to confirm 6 NVDA rows; map alias -> canonical relation.
  2. Implement `aliasResolver.ts`: `WHERE ticker = ?` synthesizer that prefers row with `is_canonical = true` else most-recent `created_at`.
  3. Wire resolver into `getCompanyDetail` + `getDirectoryRows` (read-only refactor; no schema mutation).
  4. Add unit-style fixture covering NVDA collapse + Pershing typo case.
  5. Verify tsc + manual diff against directory page (no row count regression for non-aliased tickers); push DRAFT PR.
- Self-review checks: tsc / eslint / em-dash 0 / LOC <= 110 / no migration / NVDA rows collapse to 1 in dev.
- Smoke-test on preview: directory page row count for NVDA = 1; alias chips show on detail page.

### PR-B1 -- CompanyDetailHeader + CompanyAliasRibbon

- Branch: `noah/pr-b1-detail-header`
- Base: `noah/w2-c-phase-1`
- LOC: ~220
- Visual ref: `docs/DirectionD.jsx` lines 528-582 (CompanyHeader).
- Files touched: `src/components/company/CompanyDetailHeader.tsx`, `CompanyAliasRibbon.tsx`.
- Files NOT touched: Lucas list.
- data-testid manifest: `company-detail-header`, `company-name`, `company-ticker`, `company-sector`, `company-alias-ribbon`, `company-alias-chip`.
- Smoke-test rows unblocked: H1-H6, AL5.
- Depends on: PR-A1, PR-B0.
- Steps:
  1. Recon: read DirectionD CompanyHeader block; confirm chip styling reuses cream + gold-border.
  2. Build header with name + ticker + sector pill + last-updated stamp; alias ribbon collapses to "+N more" when > 3 aliases.
  3. Wire data from `CompanyDetail` prop; handle empty `sector` with placeholder dash (per C6 emptiness).
  4. Add ARIA labels for alias ribbon; chips are buttons that route to canonical company page.
  5. Verify tsc + visual diff vs DirectionD; push DRAFT PR.
- Self-review checks: tsc / eslint / em-dash 0 / LOC <= 240 / Lucas check / 6 data-testids present / sector placeholder works.
- Smoke-test on preview: NVDA alias ribbon collapses correctly; PSH (Pershing) shows typo variant in W2 path.

### PR-B2 -- KPIStrip + /api/company-kpis route with crumb-auth

- Branch: `noah/pr-b2-kpi-strip`
- Base: `noah/w2-c-phase-1`
- LOC: ~340
- Visual ref: `docs/DirectionD.jsx` lines 582-612 (KPIStrip).
- Files touched: `src/components/company/KPIStrip.tsx`, `src/app/api/company-kpis/route.ts`, `src/lib/yahoo/crumbAuth.ts`, `src/lib/yahoo/quoteSummary.ts`.
- Files NOT touched: Lucas list; existing yahoo helpers (extend, don't replace).
- data-testid manifest: `kpi-strip`, `kpi-{price,change,marketcap,float,pe-trailing,pe-forward,eps-trailing,eps-forward,52w-high,52w-low,volume,avg-volume,target,earnings-date,prior-earnings}`.
- Smoke-test rows unblocked: K1-K8, P1 (private-company HTTP 404 path).
- Depends on: PR-A1, PR-A3.
- Steps:
  1. Recon: confirm Yahoo v10 endpoint shape + crumb cookie; map all 15 KPI fields per Phase 4 mapping.
  2. Build crumb-auth helper with 1h cache; fall back to v8 chart for price-only on crumb failure.
  3. Build `/api/company-kpis` route accepting `?ticker=NVDA`; p50 target 270ms.
  4. Build `KPIStrip` component (15 cells, responsive 5-col grid -> 3-col -> 2-col); private-company variant shows "Private" badge + crumb-error 404 reason.
  5. Verify tsc + manual hit NVDA + private ticker (e.g. STRIPE-equivalent placeholder); push DRAFT PR.
- Self-review checks: tsc / eslint / em-dash 0 / LOC <= 360 / Lucas check / 15 data-testids / crumb-cache hit on second request / 404 graceful.
- Smoke-test on preview: NVDA KPIs populated; PSH (private) shows 404 fallback; refresh -> crumb cache hit.

### PR-B3 -- ThemesCard right rail + themes derivation helper

- Branch: `noah/pr-b3-themes-card`
- Base: `noah/w2-c-phase-1`
- LOC: ~150
- Visual ref: `docs/DirectionD.jsx` lines 735-761 (ThemesCard).
- Files touched: `src/components/company/ThemesCard.tsx`, `src/lib/data-access/deriveThemes.ts`.
- Files NOT touched: Lucas list; companies table schema (C9 deferred to W2-D).
- data-testid manifest: `themes-card`, `themes-card-row`, `themes-card-label`, `themes-card-bar`, `themes-card-tone`.
- Smoke-test rows unblocked: TH1-TH3.
- Depends on: PR-A1, PR-A3.
- Steps:
  1. Recon: confirm `companies.key_themes` is `text[]` (no weight/tone/count today).
  2. Implement `deriveThemes()` synthesizing weight/tone/count from article counts joined per theme keyword (in-memory, query-time).
  3. Build `ThemesCard` showing top 5 themes with horizontal bar (weight), tone color (gold/red), article count badge.
  4. Empty state: "No themes derived yet" with subdued tone.
  5. Verify tsc + visual diff; push DRAFT PR.
- Self-review checks: tsc / eslint / em-dash 0 / LOC <= 160 / Lucas check / 5 data-testids / empty state visible when array empty.
- Smoke-test on preview: NVDA themes visible; ticker with empty key_themes shows empty state.

### PR-B4 -- TrendCard right rail (MiniBars + Sparkline + SentimentHeat) + aggregation route

- Branch: `noah/pr-b4-trend-card`
- Base: `noah/w2-c-phase-1`
- LOC: ~280
- Visual ref: `docs/DirectionD.jsx` lines 701-734 (TrendCard).
- Files touched: `src/components/company/TrendCard.tsx`, `src/app/api/company-trend/route.ts`, `src/lib/data-access/aggregateTrend.ts`.
- Files NOT touched: Lucas list; `companies.sentiment_trend` schema (C10 deferred).
- data-testid manifest: `trend-card`, `trend-card-minibars`, `trend-card-sparkline`, `trend-card-heat`, `trend-card-window-{7d,30d,90d}`.
- Smoke-test rows unblocked: TR1-TR5.
- Depends on: PR-A1, PR-A3.
- Steps:
  1. Recon: confirm `articles.published_at` indexed; aggregate by day for 30d.
  2. Build `aggregateTrend()` returning `{ counts: number[30], sentiments: number[30] }` from articles join.
  3. Build `/api/company-trend?ticker=NVDA&window=30d`; cache 15min via Vercel runtime cache.
  4. Build `TrendCard` composing MiniBars (counts) + Sparkline (sentiment line) + SentimentHeat (5x6 grid).
  5. Verify tsc + visual diff + cache hit on refresh; push DRAFT PR.
- Self-review checks: tsc / eslint / em-dash 0 / LOC <= 300 / Lucas check / 7 data-testids / cache TTL respected.
- Smoke-test on preview: NVDA 30d trend renders; cold start <500ms; refresh <50ms (cache hit).

### PR-C0 -- Structured-output memo writer (Gemini JSON mode + prompt rewrite)

- Branch: `noah/pr-c0-structured-memo`
- Base: `noah/w2-c-phase-1`
- LOC: ~230
- Visual ref: n/a (writer); see C1 in section 1.
- Files touched: `src/lib/memo/writeStructuredMemo.ts`, `src/lib/memo/prompts/structured.ts`, `src/lib/memo/types.ts`, `src/app/api/memo/route.ts`.
- Files NOT touched: Lucas list; `MemoModal.tsx` (shared).
- data-testid manifest: (none -- writer).
- Smoke-test rows unblocked: M1-M3, M5.
- Depends on: none + memo-token hotfix on integration (PR opened against main, syncs into integration via main merge).
- Steps:
  1. Recon: review existing memo prompt; identify Markdown sections to convert to JSON keys.
  2. Define `StructuredMemo` type: `{ tldr: string[], lead: string, context: string, watch: string[], citations: Citation[] }`.
  3. Rewrite prompt requesting JSON mode; add response schema for Gemini structured output.
  4. Implement `writeStructuredMemo(input)` returning typed object; preserve fallback to Markdown on parse failure.
  5. Implement retry-on-malformed-JSON: if first response fails JSON.parse, retry once with suffix 'your previous response was invalid JSON, return only valid JSON'. If retry also fails, log to stderr and fall back to Markdown response.
  6. Add observability: log every malformed response with input prompt to stderr. Use console.error format `[memo:malformed] type=<type> input_chars=<N> attempt=<1|2>`.
  7. Verify tsc + smoke-test against 3 tickers (NVDA, AAPL, private); push DRAFT PR.
- Self-review checks: tsc / eslint / em-dash 0 / LOC <= 250 / no UI changes / fallback path tested / JSON parse rate >= 99% across 10 test memos.
- Smoke-test on preview: trigger writer in dev; confirm JSON parse success rate >= 99% over 10 tickers.

### PR-C0a -- Article-grounded [n] citation parity

- Branch: `noah/pr-c0a-citation-parity`
- Base: `noah/w2-c-phase-1`
- LOC: ~80
- Visual ref: n/a (writer); side-branch ref `a7d41cf`.
- Files touched: `src/lib/memo/prompts/structured.ts` (extend), `src/lib/memo/citationParity.ts`.
- Files NOT touched: Lucas list.
- data-testid manifest: (none -- writer).
- Smoke-test rows unblocked: M6, CIT1-CIT3.
- Depends on: none (parallelizable with PR-C0; resolve conflicts in merge if both touch prompts).
- Steps:
  1. Recon: read side-branch `a7d41cf` for `[n]` marker logic; understand fix shape.
  2. Port `[n]` marker injection: prompt instructs Gemini to emit `[1]`, `[2]` inline; output includes ordered citations array.
  3. Add `citationParity()` validator: count of `[n]` markers in body equals citations array length; logs warning if mismatch.
  4. Verify tsc; push DRAFT PR.
- Self-review checks: tsc / eslint / em-dash 0 / LOC <= 90 / parity warning logs in dev / no breaking change to writer signature.
- Smoke-test on preview: NVDA memo emits at least 3 `[n]` markers matching citations.

### PR-C1 -- BriefTab content (cached memo + structured TLDR/LEAD/CONTEXT/WATCH + CitedText)

- Branch: `noah/pr-c1-brief-tab`
- Base: `noah/w2-c-phase-1`
- LOC: ~250
- Visual ref: `docs/DirectionD.jsx` lines 646-700 (MemoCard).
- Files touched: `src/components/company/tabs/BriefTab.tsx`, `src/components/company/BriefTLDR.tsx`, `BriefLead.tsx`, `BriefContext.tsx`, `BriefWatch.tsx`.
- Files NOT touched: Lucas list; `MemoModal.tsx` (shared).
- data-testid manifest: `brief-tab`, `brief-tldr`, `brief-tldr-item`, `brief-lead`, `brief-context`, `brief-watch`, `brief-watch-item`, `brief-citation-{n}`.
- Smoke-test rows unblocked: B1-B6.
- Depends on: PR-A1, PR-A2, PR-C0, PR-C0a.
- Steps:
  1. Recon: read DirectionD MemoCard; map TLDR/LEAD/CONTEXT/WATCH sections.
  2. Build 4 sub-components rendering structured memo fields with `CitedText` primitive for `[n]` markers.
  3. Compose `BriefTab` reading from `CompanyDetail.memo`; loading skeleton while memo refetches.
  4. Empty state when memo absent: "Memo not yet generated -- triggers on next pipeline cycle."
  5. Verify tsc + visual diff; push DRAFT PR.
- Self-review checks: tsc / eslint / em-dash 0 / LOC <= 270 / Lucas check / 8 data-testids / `[n]` markers clickable.
- Smoke-test on preview: NVDA memo TLDR has 3-5 bullets, citations clickable, scroll-into-view to articles tab.

### PR-C2 -- ArticlesTab + ArticlesTable bottom

- Branch: `noah/pr-c2-articles-tab`
- Base: `noah/w2-c-phase-1`
- LOC: ~220
- Visual ref: `docs/DirectionD.jsx` lines 762-811 (ArticlesTable).
- Files touched: `src/components/company/tabs/ArticlesTab.tsx`, `ArticlesTable.tsx`, `ArticlesRow.tsx`.
- Files NOT touched: Lucas list.
- data-testid manifest: `articles-tab`, `articles-table`, `articles-row`, `articles-row-headline`, `articles-row-source`, `articles-row-tone`, `articles-row-published-at`.
- Smoke-test rows unblocked: AR1-AR5.
- Depends on: PR-A2.
- Steps:
  1. Recon: confirm articles join shape from `getCompanyDetail`; review DirectionD table styling.
  2. Build `ArticlesTable` with 5 columns: headline, source, tone (SentimentPill xs), published-at, deal-type chip.
  3. Add row hover (`--row-hover`), alt rows (`--row-alt`), active row (`--row-active`); keyboard arrow navigation.
  4. Empty state when no articles: "No coverage in last 30 days."
  5. Verify tsc + visual diff + a11y rerun; push DRAFT PR.
- Self-review checks: tsc / eslint / em-dash 0 / LOC <= 240 / Lucas check / 7 data-testids / arrow nav works / no axe regressions.
- Smoke-test on preview: NVDA articles table sorts by published_at desc; tone pills correct.

### PR-C3 -- ThemesTab expanded view

- Branch: `noah/pr-c3-themes-tab`
- Base: `noah/w2-c-phase-1`
- LOC: ~140
- Visual ref: `docs/DirectionD.jsx` lines 735-761 (expanded ThemesCard pattern).
- Files touched: `src/components/company/tabs/ThemesTab.tsx`, `ThemesDetailRow.tsx`.
- Files NOT touched: Lucas list.
- data-testid manifest: `themes-tab`, `themes-detail-row`, `themes-detail-label`, `themes-detail-articles`, `themes-detail-trend-spark`.
- Smoke-test rows unblocked: TH4-TH6.
- Depends on: PR-A2, PR-B3.
- Steps:
  1. Recon: reuse `deriveThemes()` helper; expand to top 15 themes with sub-article list.
  2. Build `ThemesTab` with expandable rows: collapse shows label + count + tone; expand reveals associated article list + Sparkline of mention frequency.
  3. Empty state per PR-B3 pattern.
  4. Verify tsc + visual diff; push DRAFT PR.
- Self-review checks: tsc / eslint / em-dash 0 / LOC <= 150 / Lucas check / 5 data-testids / expand/collapse keyboard accessible.
- Smoke-test on preview: NVDA shows >= 5 themes; click expand reveals articles.

### PR-C4 -- TrendTab incorporating CompanyStockChart from PR #196

- Branch: `noah/pr-c4-trend-tab`
- Base: `noah/w2-c-phase-1`
- LOC: ~180
- Visual ref: `docs/DirectionD.jsx` lines 701-734 (TrendCard) + PR #196 CompanyStockChart.
- Files touched: `src/components/company/tabs/TrendTab.tsx`; reuse `CompanyStockChart` from PR #196.
- Files NOT touched: Lucas list; `CompanyStockChart` itself (compose, don't fork).
- data-testid manifest: `trend-tab`, `trend-tab-stock-chart`, `trend-tab-sentiment-overlay`, `trend-tab-window-toggle`.
- Smoke-test rows unblocked: TR6-TR8.
- Depends on: PR-A2, PR-B4; assumes PR #196 merged.
- Steps:
  1. Recon: verify PR #196 merged; check `CompanyStockChart` API surface.
  2. Compose `TrendTab` stacking stock chart (top), sentiment overlay (middle), heat grid (bottom); shared 30d/90d window toggle.
  3. Wire data via `/api/company-trend` from PR-B4.
  4. Verify tsc + visual diff; push DRAFT PR.
- Self-review checks: tsc / eslint / em-dash 0 / LOC <= 200 / Lucas check / 4 data-testids / window toggle preserves URL state.
- Smoke-test on preview: NVDA trend tab loads chart + overlay + heat together; toggle 30d <-> 90d.

### PR-C5 -- SourcesTab + SourcesStrip footer + source-to-tier map

- Branch: `noah/pr-c5-sources-tab`
- Base: `noah/w2-c-phase-1`
- LOC: ~200
- Visual ref: `docs/DirectionD.jsx` lines 812-839 (SourcesStrip).
- Files touched: `src/components/company/tabs/SourcesTab.tsx`, `SourcesStrip.tsx`, `src/lib/sources/tierMap.ts`.
- Files NOT touched: Lucas list; articles schema (no migration).
- data-testid manifest: `sources-tab`, `sources-tab-row`, `sources-strip`, `sources-strip-item`, `sources-tier-{1,2,3}`.
- Smoke-test rows unblocked: S1-S5.
- Depends on: PR-A2.
- Steps:
  1. Recon: list distinct article sources for NVDA; classify into Tier 1 (Bloomberg, Reuters, FT, WSJ), Tier 2 (CNBC, Barron's), Tier 3 (rest).
  2. Implement `tierMap.ts` as hard-coded record (per C8 -- no DB classification yet).
  3. Build `SourcesTab` with full source list grouped by tier; `SourcesStrip` footer shows top 5 sources by article count.
  4. Empty state when no articles.
  5. Verify tsc + visual diff; push DRAFT PR.
- Self-review checks: tsc / eslint / em-dash 0 / LOC <= 220 / Lucas check / 5 data-testids / tier classification deterministic.
- Smoke-test on preview: NVDA shows tiered sources; strip footer matches tab top-5.

### PR-D1 -- ComingSoonTab + F6/F7/F8/F9 placeholder content

- Branch: `noah/pr-d1-coming-soon-tab`
- Base: `noah/w2-c-phase-1`
- LOC: ~140
- Visual ref: `docs/DirectionD.jsx` lines 613-645 (FunctionTabs F6-F9 placeholders).
- Files touched: `src/components/company/tabs/ComingSoonTab.tsx`, `ComingSoonCard.tsx`.
- Files NOT touched: Lucas list.
- data-testid manifest: `coming-soon-tab`, `coming-soon-card-f6`, `coming-soon-card-f7`, `coming-soon-card-f8`, `coming-soon-card-f9`.
- Smoke-test rows unblocked: CS1-CS4.
- Depends on: PR-A2.
- Steps:
  1. Recon: confirm F6/F7/F8/F9 labels from DirectionD (F6 Filings, F7 Insider, F8 Options, F9 Peers per design notes).
  2. Build 4 ComingSoonCard variants showing icon, title, "Coming Soon" badge, and 1-line description.
  3. Subscribe-to-updates affordance is a no-op button with tooltip "Tracking interest -- not wired yet."
  4. Verify tsc + visual diff; push DRAFT PR.
- Self-review checks: tsc / eslint / em-dash 0 / LOC <= 150 / Lucas check / 5 data-testids / no live data fetches.
- Smoke-test on preview: 4 cards render; subscribe button shows tooltip.

### PR-D2 -- recordOutput() SDK + /api/memo integration via after() pattern A

- Branch: `noah/pr-d2-record-output`
- Base: `noah/w2-c-phase-1`
- LOC: ~180
- Visual ref: n/a (observability); side-branch ref `a67e69c`.
- Files touched: `src/lib/observability/recordOutput.ts`, `src/app/api/memo/route.ts` (extend with `after()` hook), `supabase/migrations/<timestamp>_output_log_v0_stub.sql`.
- Files NOT touched: Lucas list; `MemoModal.tsx` (shared); existing memo writer (extend, don't replace).
- data-testid manifest: (none -- observability).
- Smoke-test rows unblocked: OBS1-OBS3.
- Depends on: none (parallelizable).
- Steps:
  1. Recon: read side-branch `a67e69c` for SDK shape; understand `after()` pattern A vs B (defer to Noah if ambiguous).
  2. Create migration SQL `output_log_v0_stub` with schema: id (uuid PK), output_type (text), source_table (text), source_id (text), prompt_inputs (jsonb), generated_at (timestamptz), latency_ms (integer), metadata (jsonb). Run via Supabase migration tooling.
  3. Implement `recordOutput({ kind, key, payload, latencyMs })` writing to `output_log_v0_stub` table.
  4. Extend `/api/memo` route to call `after(() => recordOutput(...))` post-response.
  5. Add small dashboard query helper for recent outputs (read-only).
  6. Verify tsc + smoke memo trigger; confirm row appears in `output_log_v0_stub` table; push DRAFT PR.
- Self-review checks: tsc / eslint / em-dash 0 / LOC <= 200 / no Lucas files / `after()` does not block response / row visible in table / Migration SQL committed at supabase/migrations/<ts>_output_log_v0_stub.sql / Stub table writes do NOT touch the canonical `outputs` table.
- Smoke-test on preview: trigger memo, observe row in `output_log_v0_stub` within 5s.

### PR-E1 -- Empty state variant (Stripe pattern)

- Branch: `noah/pr-e1-empty-state`
- Base: `noah/w2-c-phase-1`
- LOC: ~220
- Visual ref: `docs/DirectionD.jsx` lines 1175-1244 (EmptyState).
- Files touched: `src/components/company/states/EmptyState.tsx`, `EmptyStateCTA.tsx`; conditional render in tab components.
- Files NOT touched: Lucas list.
- data-testid manifest: `company-empty-state`, `company-empty-state-headline`, `company-empty-state-cta-add`, `company-empty-state-cta-search`.
- Smoke-test rows unblocked: E1-E4.
- Depends on: PR-A1, PR-A2.
- Steps:
  1. Recon: read DirectionD EmptyState; note Stripe-style centered layout with single CTA + secondary link.
  2. Build `EmptyState` component shown when `CompanyDetail` resolves to null (unknown ticker).
  3. CTAs: "Add to watchlist" (primary), "Search directory" (secondary link).
  4. Wire conditional render at `/company/[id]/page.tsx` level.
  5. Verify tsc + visual diff + a11y rerun; push DRAFT PR.
- Self-review checks: tsc / eslint / em-dash 0 / LOC <= 240 / Lucas check / 4 data-testids / focus on primary CTA on mount.
- Smoke-test on preview: navigate to `/company/UNKNOWN`; empty state renders; tab keyboard advances to Add CTA.

### PR-E2 -- Web-fallback variant (Pershing typo + purple [w1] citations + ALIAS-RESOLVED banner)

- Branch: `noah/pr-e2-web-fallback`
- Base: `noah/w2-c-phase-1`
- LOC: ~270
- Visual ref: `docs/DirectionD.jsx` lines 1041-1174 (WebFallback).
- Files touched: `src/components/company/states/WebFallbackState.tsx`, `WebFallbackBanner.tsx`, `WebFallbackCitation.tsx`.
- Files NOT touched: Lucas list; existing web-fallback writer from PR #176.
- data-testid manifest: `web-fallback-state`, `web-fallback-banner-alias-resolved`, `web-fallback-citation-w1`, `web-fallback-citation-w2`, `web-fallback-tldr`, `web-fallback-source-list`.
- Smoke-test rows unblocked: W1-W6.
- Depends on: PR-A1, PR-A2, PR-C1.
- Steps:
  1. Recon: review PR #176 web-fallback derivation logic; confirm Pershing typo normalization from PR #177.
  2. Build `WebFallbackState` reusing BriefTab structure but flagging citations with `[w1]`-style markers in `--purple` token.
  3. Add `ALIAS-RESOLVED` banner component when alias resolver matched a typo (e.g. "Persing" -> "Pershing").
  4. Source list shows web URLs (no DB tier classification).
  5. Verify tsc + visual diff + manual test for PSH ticker; push DRAFT PR.
- Self-review checks: tsc / eslint / em-dash 0 / LOC <= 290 / Lucas check / 6 data-testids / purple citations distinct from gold.
- Smoke-test on preview: PSH (Pershing typo) shows ALIAS-RESOLVED banner + purple citations.

### PR-E3 -- Loading state variant (skeleton + status chip)

- Branch: `noah/pr-e3-loading-state`
- Base: `noah/w2-c-phase-1`
- LOC: ~140
- Visual ref: `docs/DirectionD.jsx` lines 1245-1349 (Loading).
- Files touched: `src/components/company/states/LoadingState.tsx`, `LoadingSkeleton.tsx`, `LoadingStatusChip.tsx`.
- Files NOT touched: Lucas list.
- data-testid manifest: `company-loading-state`, `company-loading-skeleton`, `company-loading-status-chip`, `company-loading-status-{fetching,parsing,rendering}`.
- Smoke-test rows unblocked: L1-L3.
- Depends on: PR-A1, PR-A2.
- Steps:
  1. Recon: read DirectionD Loading; note 3-stage status chip (fetching -> parsing -> rendering).
  2. Build skeleton matching CompanyDetailLayout slot shapes.
  3. Build status chip cycling through 3 stages; respects `prefers-reduced-motion`.
  4. Wire as Suspense boundary fallback in `/company/[id]/page.tsx`.
  5. Verify tsc + visual diff + axe (no skeleton a11y violations); push DRAFT PR.
- Self-review checks: tsc / eslint / em-dash 0 / LOC <= 150 / Lucas check / 4 data-testids / reduced-motion path tested.
- Smoke-test on preview: artificially slow `getCompanyDetail` to 2s; loading state visible with cycling chip.

## 4. Dependency graph

```
PR-A0 (token baseline)
  |
  |-- PR-A1 (primitives) ----+-- PR-B1 (header)        [also needs B0]
  |                          |-- PR-B2 (KPI strip)     [also needs A3]
  |                          |-- PR-B3 (themes card)   [also needs A3]
  |                          |-- PR-B4 (trend card)    [also needs A3]
  |                          |-- PR-E1 (empty state)   [also needs A2]
  |                          |-- PR-E2 (web fallback)  [also needs A2 + C1]
  |                          |-- PR-E3 (loading)       [also needs A2]
  |
  |-- PR-A2 (tab scaffold) --+-- PR-C1 (brief tab)     [also needs A1 + C0 + C0a]
                             |-- PR-C2 (articles tab)
                             |-- PR-C3 (themes tab)    [also needs B3]
                             |-- PR-C4 (trend tab)     [also needs B4 + PR #196]
                             |-- PR-C5 (sources tab)
                             |-- PR-D1 (coming soon)

PR-A3 (data layer) -- PR-B0 (alias resolver) -- feeds PR-B1, B3, B4

PR-C0 (structured memo) ---+
PR-C0a (citation parity) --+--> PR-C1

PR-D2 (recordOutput) -- independent of all UI; can ship any time
```

Note: PR-C0 also depends on the memo `maxOutputTokens` 600 -> 2400 hotfix being on integration. Hotfix lives on a separate branch off main and propagates via main -> integration sync.

## 5. Recommended merge order

1. PR-A0 first (visual regression baseline locked).
2. PR-A1 + PR-A2 + PR-A3 in parallel after A0.
3. PR-B0 after A3.
4. PR-B1 / PR-B2 / PR-B3 / PR-B4 in parallel after A1+A2+A3+B0.
5. PR-C0 + PR-C0a in parallel any time (resolve prompt-file conflict in second-merged).
6. PR-C1 after C0 + C0a + A1 + A2.
7. PR-C2 / PR-C3 / PR-C4 / PR-C5 in parallel after A2 (and respective B deps).
8. PR-D1 + PR-D2 in parallel any time after A2 (D2 has no UI dep).
9. PR-E1 / PR-E2 / PR-E3 last (depend on most-mature stack).
10. PR #197 to `main` only after all 22 ship + smoke recipe passes 180/180.

## 6. Locked decisions (Noah confirmed 2026-05-07)

1. **C4 alias rollup** -- LOCKED: query-time synthesizer (PR-B0). Reversible. Schema migration deferred to Track C entity-resolution work.

2. **C0 prompt fork** -- LOCKED: single rewrite + retry-once-on-malformed-JSON + 99% parse target. Modification from default (95% target). If Gemini returns invalid JSON, retry the same prompt with "your previous response was invalid JSON, return only valid JSON" suffix. If retry also fails, fall back to Markdown. Add observability: log every malformed response with input prompt to stderr. Adds ~30 LOC to PR-C0 (now ~230 budget).

3. **PR-D2 timing pattern** -- LOCKED: Pattern A (after() post-response fire-and-forget). Per substrate plan Step 3.

4. **PR-D2 table** -- LOCKED: NEW table `output_log_v0_stub`, NOT extend `outputs`. Modification from default. Schema: id (uuid PK), output_type (text), source_table (text), source_id (text), prompt_inputs (jsonb), generated_at (timestamptz), latency_ms (integer), metadata (jsonb). Stub naming preserves Lucas's eventual canonical Step 3 schema. Migration SQL at supabase/migrations/<timestamp>_output_log_v0_stub.sql.

5. **PR #197 squash** -- LOCKED: squash 21-commit history into single squash commit at #197 merge time. Per repo convention.

6. **Yahoo crumb fallback** -- LOCKED: 1h cache + v8 fallback (default). CRITICAL CLARIFICATION: existing Finnhub matcher integration (HARD_TICKER_OVERRIDES, lazy ticker lookup, sector data, src/lib/finnhub-ticker.ts, backend/finnhub_helper.py) is UNTOUCHED. Decision 6 only covers whether to add Polygon/Finnhub as a NEW deeper price-data fallback if Yahoo's crumb-auth fails repeatedly. Answer: no, defer to W2-D unless 5xx rate exceeds 2% over Phase 1 monitoring.

7. **C9/C10 schema enrichment** -- LOCKED: deferred to W2-D backlog. Phase 1 uses query-time derivation.

8. **PR-A0 visual regression scope** -- LOCKED: 9-route full sweep, NOT 5 routes. Modification from default. Routes: /, /morning-brief, /evening-wrap, /dashboard, /company, /company/nvidia, /company/stripe, /trends, /watchlist. PR-A0 includes ~18 PNG fixtures (9 pre + 9 post) committed to docs/visual-baseline-{pre,post}-A0/.
