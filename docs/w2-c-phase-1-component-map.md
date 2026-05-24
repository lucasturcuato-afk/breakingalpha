# W2-C Phase 1 -- Component Map

Date: 2026-05-05
Status: reference document. Build PR specs (Task 5 doc) and self-review subagents reference this map to validate scope.

Purpose: cross-reference every Direction D component (`docs/DirectionD.jsx`) -> smoke-test recipe data-testids (`docs/w2-c-phase-1-smoke-test-recipe.md`) -> sub-PR ownership -> Lucas-protected file scope guardrails.

## Lucas-protected files (DO NOT modify in Phase 1 build PRs)

These are the four files declared off-limits at the top of every Phase 1 task. Build PRs that need to interact with them must coordinate with Lucas separately.

| Path | Reason |
|---|---|
| `src/lib/watchlist-utils.ts` | useRef sync lock semantics + Patch L coalesce contract (smoke-test R4 KNOWN-FAIL anchor). |
| `src/components/watchlist/WatchlistAddInput.tsx` | submitting flag gating the silent-coalesce contract; ownership conflict noted in WD08. |
| `src/app/trends/page.tsx` | Trends page render path; not Phase 1 surface. |
| `src/app/api/briefing/route.ts` | Morning brief API; not Phase 1 surface. |

If a build PR's diff touches any of these paths, the self-review subagent must FAIL the PR. There is no exception in Phase 1.

## Sub-PR series (referenced names)

- PR-A0  -- Direction D token swap (palette, fonts, semantic tokens). Drives axe re-baseline (T11).
- PR-A1  -- CompanyHeader + alias ribbon shell (Frame 3 chrome).
- PR-A2  -- KPI strip layout + empty-state.
- PR-A3  -- `playwright.config.ts` cross-browser project additions (1 LOC config addition; gates S1-S8).
- PR-B1  -- FunctionTabs strip + Alt+number / `[`/`]` keyboard handlers + URL `?tab=` persistence.
- PR-B2  -- Yahoo quoteSummary integration for KPI Last/Market cap + crumb-auth recovery.
- PR-C0  -- Memo prompt structured output (BriefTab BLOCKER -- enables D-section tests).
- PR-C1  -- BriefTab cached-memo render + CitedText `[n]` linkifier + Generate Memo CTA empty-state.
- PR-D1  -- Articles tab table + filter pills + sort.
- PR-D2  -- recordOutput integration in `src/app/api/memo/route.ts` (gates L1-L9).
- PR-E1  -- Themes tab + Themes Card right rail.
- PR-E2  -- Trend tab (MiniBars + Sparkline + SentimentHeat) + Trend Card right rail + CompanyStockChart embed.
- PR-F1  -- Sources tab + Sources Strip footer + tier badge map.
- PR-G1  -- Empty-state (Frame 7 / Stripe pattern) + "Notify me when indexed" gated CTA + "Generate from web" wiring.
- PR-G2  -- Web-fallback Frame 6 (ALIAS-RESOLVED banner, WEB-SOURCED chip, purple `[w1]` citations). KNOWN-DEFERRED until alias seed lands.
- PR-H1  -- Loading skeletons + "Generating" chip + (V1.5 only) pipeline-trace right rail.
- PR-N1  -- Skip-to-main link (already PR #213; included for cross-reference).

## Frame 3 -- desktop happy-path (NVIDIA)

| Direction D component | DirectionD.jsx lines | Smoke-test category | data-testids touched | Sub-PR | Lucas-protected files NOT to touch |
|---|---|---|---|---|---|
| Sidebar | 42-108 | M (cross-tab regression), N (a11y skip link) | `[data-testid="sidebar"]` (O2), `[data-testid="watchlist-count"]` (M3) | n/a (existing) | `src/components/watchlist/WatchlistAddInput.tsx` (sidebar count update) |
| TopBar | 160-188 | M (regression) | (none specific; breadcrumb only) | n/a (existing) | -- |
| StatusStrip | 202-228 | M (mood bar M4-M6) | `[data-testid="mood-bar"]` (M4) | n/a (existing) | -- |
| CompanyHeader | 528-579 | A (header + alias ribbon), Q (alias correctness), T (a11y heading hierarchy) | `[data-testid="company-logo"]` A1, `[data-testid="ticker-chip"]` A3 + Q3 + Q8, `[data-testid="company-subtitle"]` A4, `[data-testid="sentiment-pill"]` A5, `[data-testid="alias-ribbon"]` A9, `[data-testid="alias-chip"]` A10 + Q1 | PR-A1 | `src/lib/watchlist-utils.ts` (do not import; + Watchlist button is wired via existing api hook only) |
| KPIStrip | 582-610 | B (KPI strip), B8 Stripe empty | `[data-testid="kpi-strip"]` B1 + B8, `[data-testid="kpi-card"]` B1, `[data-testid="delta"]` B2 | PR-A2 (layout) + PR-B2 (Yahoo data) | -- |
| FunctionTabs | 613-643 | C (tabs), N (a11y) | `[role="tab"][aria-selected="true"]` C1 + T5, `[role="tabpanel"]` T6 | PR-B1 | -- |
| MemoCard | 646-699 | D (Brief tab), K (loading), R2/R3 (concurrency) | TLDR/Lead/Context/Watch headings (D1-D4), `[data-testid="brief-skeleton"]` K1, `getByRole('link',{name:'[1]'})` D5 | PR-C0 + PR-C1 + PR-H1 | `src/app/api/briefing/route.ts` (do NOT confuse with `src/app/api/memo/route.ts`; memo route is fair game for PR-C0 + PR-D2) |
| TrendCard | 701-733 | G (Trend tab + right rail) | `[data-testid="mini-bars"]` G1, `[data-testid="sparkline"]` G2, `[data-testid="sentiment-heat"]` G3 + `[data-testid="heat-cell"]`, `[data-testid="trend-card"]` G8, `[data-testid="company-stock-chart"]` G6 | PR-E2 | -- |
| ThemesCard | 735-760 | F (Themes tab + right rail) | `[data-testid="theme-row"]` F1, `[data-testid="theme-weight"]` F2, `[data-testid="theme-sentiment"]` F3, `[data-testid="theme-count"]` F4, `[data-testid="themes-card"]` F6 | PR-E1 | -- |
| ArticlesTable | 762-810 | E (Articles tab) | `[data-testid="article-row"]` E1, `[data-testid="article-source"]` E3, `[data-testid="signal-score"]` E4, `[data-testid="row-sentiment"]` E5, `[data-testid="filter-pill"]` E9-E11 | PR-D1 | -- |
| SourcesStrip | 812-835 | H (Sources tab + footer strip) | `[data-testid="source-row"]` H1, `[data-testid="source-domain"]` H2, `[data-testid="tier-badge"]` H3 + H4, `[data-testid="sources-strip"]` H5 + J9 | PR-F1 | -- |

## Frame 4 -- mobile (DetailMobile)

| Direction D component | DirectionD.jsx lines | Smoke-test category | data-testids touched | Sub-PR | Notes |
|---|---|---|---|---|---|
| DetailMobile | 840-965 | O (mobile) | `page.setViewportSize({width:380,height:800})`, sidebar collapse (O2), tap-target bounding-box checks (O6 KNOWN-FAIL, O7 KNOWN-FAIL, O8) | PR-A1 + PR-A2 (responsive variants ride with desktop sub-PRs) | O6 + O7 deferred to W2-D (WD10). |

## Frame 6 -- web-fallback (Pershing typo)

| Direction D component | DirectionD.jsx lines | Smoke-test category | data-testids touched | Sub-PR | Status |
|---|---|---|---|---|---|
| WebFallback | 1041-1173 | J (J1-J9) | `[data-testid="alias-resolved-banner"]` J2, `[data-testid="web-sourced-chip"]` J3, `[data-testid="web-citation"]` J4 | PR-G2 | All 9 J-rows are KNOWN-DEFERRED. Alias seed for "Perishing Square" / "Mircosoft" required first; SQL verification 2026-05-05 confirmed neither typo form exists in `aliases` table. File as W2-D follow-up. |

## Frame 7 -- empty state (Stripe / private companies)

| Direction D component | DirectionD.jsx lines | Smoke-test category | data-testids touched | Sub-PR | Notes |
|---|---|---|---|---|---|
| EmptyState | 1175-1240 | I (empty state) | `getByText(/last indexed/i)` I1, `getByText(/sources checked/i)` I3, `getByText(/watchlist .* users/i)` I4, `getByRole('button',{name:/notify me/i})` I5, "Generate from web" CTA -> POST `/api/companies/web-fallback` (I6) | PR-G1 | I5 "Notify me" CTA disabled-with-tooltip pending WD11 (entity_subscription DDL). I6/I7 wire to existing web-fallback endpoint. |

## Frame 8 -- loading state

| Direction D component | DirectionD.jsx lines | Smoke-test category | data-testids touched | Sub-PR | Notes |
|---|---|---|---|---|---|
| Loading | 1245-1340 | K (loading) | `[data-testid="brief-skeleton"]` K1, `getByText('Generating')` K2, `[data-testid="pipeline-trace"]` K4 | PR-H1 | K4 pipeline-trace right rail is V1.5 only; gate behind feature flag. |

## Modal -- CompanyIntelMemoModal

| Direction D component | DirectionD.jsx lines | Smoke-test category | data-testids touched | Sub-PR | Notes |
|---|---|---|---|---|---|
| MemoModal | 967-1039 | M (regression M2) | `[data-testid="memo-modal"]` M2 | n/a (existing in `src/components/memo/MemoModal.tsx`) | Verify still opens after Phase 1 chrome rewrite. |

## Primitive -> sub-PR mapping (ports)

Phase 5 recon (read from `docs/primitives (1).jsx`) flagged primitives that should be ported into `src/components/ui/`. Existing primitives in `src/components/ui/` are listed independently in `docs/w2-c-phase-1-primitives-audit.md`. Below is the build-PR mapping only.

| Primitive | DirectionD ref | Where it ships | Sub-PR |
|---|---|---|---|
| SentimentPill | primitives.jsx 11-30 | already exists `src/components/ui/sentiment-pill.tsx` -- KEEP, palette swap rides with PR-A0 | PR-A0 |
| Wordmark | primitives.jsx 32-40 | already exists `src/components/ui/wordmark.tsx` -- KEEP | n/a |
| Delta (▲/▼ + value) | primitives.jsx 42-54 | NEW primitive needed for KPI delta arrows + Trend card deltas | PR-A2 (ship inline with KPIStrip; promote to ui/ if reused 3+ times) |
| Cite + CitedText | primitives.jsx 57-72 | NEW primitive `src/components/memo/CitedText.tsx` (sibling of existing memo components) | PR-C1 |
| Sparkline | primitives.jsx 75-92 | NEW primitive for TrendCard | PR-E2 |
| MiniBars | primitives.jsx 95-106 | NEW primitive for TrendCard | PR-E2 |
| SentimentHeat | primitives.jsx 109-124 | NEW primitive for TrendCard | PR-E2 |
| Eyebrow | primitives.jsx 127-133 | minor styling helper -- inline or co-locate; not promotion-worthy | n/a |
| PhoneBezel | primitives.jsx 136-175 | preview/mock only -- DO NOT port | -- |
| AnnoPin | primitives.jsx 178-201 | preview/mock only -- DO NOT port | -- |

## data-testid manifest (alphabetical)

For self-review subagents to grep against PR diffs and confirm coverage. Every PR's self-review must produce a coverage table mapping its added testids to smoke-test rows below.

| data-testid | Smoke-test rows | Owning sub-PR |
|---|---|---|
| `alias-chip` | A10, Q1, Q2 | PR-A1 |
| `alias-resolved-banner` | J2 | PR-G2 (deferred) |
| `alias-ribbon` | A9 | PR-A1 |
| `article-row` | E1 | PR-D1 |
| `article-source` | E3 | PR-D1 |
| `brief-skeleton` | K1 | PR-H1 |
| `company-grid` | M1 | n/a (existing) |
| `company-logo` | A1 | PR-A1 |
| `company-stock-chart` | G6 | PR-E2 |
| `company-subtitle` | A4 | PR-A1 |
| `delta` | B2 | PR-A2 |
| `filter-pill` | E9, E10, E11 | PR-D1 |
| `heat-cell` | G3 | PR-E2 |
| `kpi-card` | B1-B7 | PR-A2 |
| `kpi-strip` | B1, B8 | PR-A2 |
| `memo-modal` | M2 | n/a (existing) |
| `mini-bars` | G1 | PR-E2 |
| `mood-bar` | M4, M5 | n/a (existing) |
| `pipeline-trace` | K4 | PR-H1 (V1.5 flag) |
| `row-sentiment` | E5 | PR-D1 |
| `sentiment-heat` | G3 | PR-E2 |
| `sentiment-pill` | A5 | PR-A1 |
| `sidebar` | O2 | n/a (existing) |
| `signal-score` | E4 | PR-D1 |
| `source-domain` | H2 | PR-F1 |
| `source-row` | H1 | PR-F1 |
| `sources-strip` | H5, J9 | PR-F1 |
| `sparkline` | G2 | PR-E2 |
| `theme-count` | F4 | PR-E1 |
| `theme-row` | F1 | PR-E1 |
| `theme-sentiment` | F3 | PR-E1 |
| `theme-weight` | F2 | PR-E1 |
| `themes-card` | F6 | PR-E1 |
| `ticker-chip` | A3, Q3, Q8 | PR-A1 |
| `tier-badge` | H3, H4 | PR-F1 |
| `trend-card` | G8 | PR-E2 |
| `watchlist-count` | M3 | n/a (existing) |
| `web-citation` | J4 | PR-G2 (deferred) |
| `web-sourced-chip` | J3 | PR-G2 (deferred) |

## Sub-PR coverage matrix

How many P0/P1 smoke-test rows each sub-PR is on the hook for landing green.

| Sub-PR | Smoke-test categories owned | P0 row count | P1 row count | Lucas-protected scope-check verdict |
|---|---|---|---|---|
| PR-A0 token swap | T (a11y re-baseline) | 0 (T11 trigger only) | 0 | OK -- pure CSS tokens. |
| PR-A1 CompanyHeader + alias ribbon | A (12 rows), Q (alias correctness Q1, Q2, Q3, Q8) | A1, A2, A3, A5, A6, A8, Q1, Q3, Q7 (9) | A4, A7, A9, A10, A11, A12, Q2, Q4, Q5, Q6, Q9 (11) | OK -- + Watchlist button uses existing api hook; do not import watchlist-utils.ts. |
| PR-A2 KPIStrip layout + empty | B (B1-B11) | B1, B2, B4, B8 (4) | B3, B5, B6, B7, B9, B10, B11 (7) | OK. |
| PR-A3 playwright config | S (S1-S8) | 0 | 0 | OK -- config-only. |
| PR-B1 FunctionTabs | C (14 rows), N (N5, N6, N7) | C1, C2, C3, C7, C8, C9 (6) | C4, C5, C6, C10, C11, C14 (6) | OK. |
| PR-B2 Yahoo KPI data | B10 (crumb-auth), G7 + M8 (BRK-B substitution) | M8 (1) | B10, G7 (2) | OK. |
| PR-C0 memo prompt structured | gates D-section tests | 0 (gating-only) | 0 | OK -- modifies `src/app/api/memo/route.ts` (NOT briefing/route.ts which IS protected). |
| PR-C1 BriefTab + CitedText | D (D1-D10) | D1, D2, D3, D4, D5, D8 (6) | D6, D9 (2) | OK. |
| PR-D1 Articles tab | E (E1-E12) | E1, E2, E3, E12 (4) | E4-E11 (8) | OK. |
| PR-D2 recordOutput | L (L1-L9) | L1, L2, L3, L4 (4) | L5, L6, L7 (3) | OK -- modifies memo route only. |
| PR-E1 Themes tab + card | F (F1-F7) | F1 (1) | F2, F3, F4, F5, F6 (5) | OK. |
| PR-E2 Trend tab + chart | G (G1-G8) | G1, G2, G3, G6 (4) | G4, G5, G8 (3) | OK. |
| PR-F1 Sources tab + footer | H (H1-H7) | H1, H2 (2) | H3, H4, H5, H6, H7 (5) | OK. |
| PR-G1 EmptyState | I (I1-I7) | I1, I6 (2) | I2, I3, I4, I5, I7 (5) | OK. |
| PR-G2 Web-fallback | J (J1-J9) | 0 -- all KNOWN-DEFERRED | 0 | OK -- gated on alias seed. |
| PR-H1 Loading skeletons | K (K1-K5) | K1, K2 (2) | K3 (1) | OK. |

## Cross-cutting categories not owned by any single PR

| Category | Coverage strategy |
|---|---|
| M (cross-tab regression) | Each sub-PR's self-review must run the existing `e2e/*.spec.ts` smoke against `/company`, `/trends`, `/thesis`. M1, M2, M4-M6, M9 must stay green per-PR. M8 BRK-B substitution is owned by PR-B2 but every sub-PR runs the regression. |
| N (a11y) | N1-N3 already gated on PR #213. PR-A0 token swap re-baselines T1. Each PR's self-review must run axe and confirm no NEW serious-or-critical rule introduced. |
| O (mobile) | PR-A1 + PR-A2 ship the responsive variants; later PRs ride the same breakpoints. O6, O7 stay KNOWN-FAIL until WD10. |
| P (perf budgets) | Reference-only in smoke-test; tracked via Lighthouse CI per Phase 1 sub-PR. Bundle delta < 50KB gzip is the hard gate. |
| Q (data integrity) | Q1-Q10 are DB invariants; verified pre-Phase-1 by entity-resolution work. Smoke-test runs SELECTs against prod read-replica per-PR. |
| R (race conditions) | R3 (concurrent Generate Memo coalesce) is owned by PR-C1; R4 is KNOWN-FAIL anchored on Lucas-protected files. |
| S (cross-browser) | Gated on PR-A3. |

## Notes

- The 27-violation T1 ceiling in `docs/w2-c-phase-1-smoke-test-recipe.md` is incorrect. See `docs/axe-baseline-2026-05-07.md` (and the addendum at the bottom of that doc) for the corrected `<= 96 nodes` / `<= 18 rule-route occurrences` ceiling. Build-PR self-reviews should assert against the corrected metric, not 27.
- The Alphabet/Google cluster has 9 dup rows (not 5; see WD04). Smoke-test Q-section assertions on Alphabet must run after WD04 ships.
- Every sub-PR's self-review must include a "Lucas-protected scope-check" line that explicitly enumerates the 4 protected files and confirms the diff touches none of them.
