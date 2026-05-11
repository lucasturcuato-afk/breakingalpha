# W2-D backlog (audit)

Date: 2026-05-05
Source: items surfaced through W2-C Phase 1 sprint (Patches I, J, K, L, M, N1, N2, O, P, Q, S, plus the Phase 1 detail page recon).
Status: standalone backlog. A legacy `docs/w2d-backlog.md` was referenced in prior handoffs but is not present in the current `docs/` tree, so this file is the single source of truth going forward.

## Executive summary

| Bucket | Count | Top item |
|---|---|---|
| Data integrity | 4 | Berkshire / Alphabet cluster merges, false-positive ticker scrub |
| ADR alias map | 2 | TSMC / Samsung / Celestica HARD_TICKER_OVERRIDES expansion |
| UI quality | 4 | Sentiment chip contrast, mobile tap-target audit |
| Notification infra | 1 | Entity-level "notify me when indexed" subscription |
| Substrate | 2 | output_log canonical schema lock-in, observability dashboard |
| Observability + cost | 5 | Per-user web-search quota, web-fallback cost logging |
| Detail page V1.5+ | 4 | Memo prompt streaming, AI Brief auto-regen, KPI cluster expansion |
| Code hygiene | 7 | Watchlist subtitle truncation, ESLint cleanups, em-dash cleanup |

Total: 49 items.

## Items

| ID | Item | Complexity | Dependencies | Priority | Notes |
|---|---|---|---|---|---|
| WD01 | False-positive ticker scrub before Patch P live | XS | Patch P live | P0 | NULL bogus tickers via `UPDATE companies SET ticker = NULL WHERE id IN ('78964d77-7ddb-4403-9d6f-8d2a60c08b73','4584e7b0-8184-4dc3-a67e-cafd2eed9eeb','5931d5a3-9e63-4bc3-b687-d879c47e48c7','aec84192-5a04-477d-a370-fad6fd8e13a9','d858429e-2b65-4d57-8b0b-96e7c4a8decc');` Covers Advent/AVK, AWS/JWSMF, Axios/AXAC, Bitcoin/GBTC, xAI/XFLT. Verified 2026-05-05. |
| WD02 | Spot-check 10 random clean rows from Patch P CSV | XS | Patch P CSV ready | P0 | Manual review before live run. Compare CSV ticker column against Finnhub canonical for 10 sampled rows. |
| WD03 | Berkshire cluster merge (Patch H style) | S | WD01 ships first | P0 | Merge 42cb5965 (Berkshire, mention=5) and 64383c40 (Berkshire Hathaway Inc., mention=1) into canonical de144271 (Berkshire Hathaway, BRK.B, mention=18). Exclude cc3ab2b7 (Berkshire Gray, robotics). UUIDs verified 2026-05-05. |
| WD04 | Alphabet/Google cluster merge | S | WD03 precedent | P0 | Found 9 dup rows (user spec said 5). Canonical: f1776f5c (Alphabet, GOOGL, 55). Merge into canonical: c663ba6f (Google, 84), 62b83fce (Alphabet Inc., GOOGL, 11), 2b3cbf9e (Google Cloud, 6), d036d510 (Alphabet Inc.'s Google), e088f7fb (Google LLC), 26356997 (Alphabet (Google)), 4013c87e (Big Tech...), e9d2ad39 (Alphabet GOOGL). Decision needed: does Google Cloud stay as separate subsidiary row? |
| WD05 | ADR brand alias map expansion (HARD_TICKER_OVERRIDES) | S | None | P1 | Add TSMC -> TSM, Samsung -> SSNLF, Celestica -> CLS. Same pattern as Berkshire -> BRK.B precedent. |
| WD06 | ADR / wrong-class-share audit via Finnhub | M | WD05 design | P1 | Sweep named entities that resolve to wrong-listing tickers today. Output candidate alias additions for HARD_TICKER_OVERRIDES. |
| WD07 | Sentiment chip contrast on /morning-brief and /evening-wrap | XS | None | P1 | NEUTRAL/BULLISH/BEARISH chips low contrast on espresso card. P2 carryover from prior session, promoted to P1 due to user-facing visibility. Confirmed visually on /morning-brief during PR-A0 eyeball (Lumentum Q3 Revenue card). Slate-on-slate-on-espresso stack fails practical legibility test. |
| WD08 | Watchlist directory star icon doesn't update sidebar count | S | Lucas approval (file is Lucas-protected) | P1 | WatchlistAddInput.tsx ownership conflict. Pre-existing bug surfaced via smoke-test O7. |
| WD09 | Watchlist icon inconsistency (star vs bookmark) | XS | WD08 | P1 | User wants bookmark everywhere. Currently star in directory, bookmark on detail page. |
| WD10 | Mobile tap-target audit (sub-44x44 elements) | S | None | P1 | Search input height 36 (smoke-test O6), watchlist star 21x21 (O7). Sweep remaining sub-44 elements. |
| WD11 | Entity-level "notify me when indexed" subscription | M | New table (entity_subscription) | P1 | Empty-state CTA Frame 7 currently disabled-with-tooltip per smoke-test I4. Needs DDL + UI + worker hookup. |
| WD12 | Per-user web-search quota at /api/companies | M | New user_web_search_quota table | P1 | DDL + UI usage display + enforcement at /api/companies route. Caps per-user Exa/Gemini spend. |
| WD13 | Web-fallback observability logging (Exa + Gemini cost) | S | None | P1 | Log cost per call to existing observability table. Feeds WD14. |
| WD14 | Internal daily cost dashboard | M | WD13 | P1 | Aggregate web-fallback costs per day across providers. Internal only. |
| WD15 | Cache lock on web-fallback path | S | None | P1 | Prevents duplicate Exa/Gemini fetches on simultaneous novel-entity hits. Redis or DB-row-lock pattern. |
| WD16 | Stale-data refresh job for web-fallback companies | M | WD15 | P1 | Companies created via web-fallback need periodic re-fetch. Cron-driven. |
| WD17 | Memo prompt streaming for /api/memo | M | None | P1 | Frame 8 pipeline trace expects real streaming. Currently buffered. |
| WD18 | AI Brief auto-regenerate on key_themes invalidation | S | None | P1 | When key_themes refresh fires, AI Brief stale. Hook regen into invalidation event. |
| WD19 | Memo token budget increase (750 -> 1200) | XS | None | P2 | Single config bump. Watch cost. |
| WD20 | KPI cluster: forward P/E, dividend yield, beta | S | Yahoo modules support check | P2 | Extend KPI cluster on detail page V1.5+. Feasibility check first. |
| WD21 | output_log canonical schema lock-in | M | Lucas Step 3 ships | P1 | Migrate from output_log_v0_stub if stub was deployed. Coordinate with Lucas. |
| WD22 | Substrate observability dashboard | L | WD21 | P2 | Per the 5-amendment response to Lucas's plan. |
| WD23 | Watchlist subtitle truncation | XS | None | P2 | Long company names overflow watchlist row subtitle. |
| WD24 | ESLint cleanups in /api/memo error path | XS | None | P2 | Lint warnings in error branches. |
| WD25 | Finnhub sector backfill (Patch P) | S | WD01, WD02 | P1 | In-progress. Live execution gated on WD01 + WD02. |
| WD26 | pg_trgm fuzzy match (entity resolution) | M | None | P2 | Reduces dup-creation rate at ingest. Improvement to entity resolution layer. |
| WD27 | Vercel project disconnect cleanup | XS | None | P2 | Stale Vercel project links in repo settings. |
| WD28 | PR-body temp file fix | XS | None | P2 | Tooling cleanup -- temp file leftover from PR-body workflow. |
| WD29 | Em-dash cleanup in /api/memo error text | XS | None | P2 | ASCII-only convention violation in user-visible error strings. |
| WD30 | F1-F9 tab labels imply Option+number keyboard shortcuts not wired | XS | None | P1 | Either implement keyboard shortcut handlers (Alt+1..9) OR strip the Fn labels from tabs. ~30 LOC either direction. Pre-#197 polish. |
| WD31 | Tab switch animation, hover states, active indicator missing on Company Intel detail page tab bar | XS | None | P1 | CSS-only fix on `src/components/company/CompanyDetailTabs.tsx`. |
| WD32 | TrendTab missing context header ("Price & Sentiment 8d" or similar) | XS | None | P2 | User needs to know what tab they're on independent of F4 highlight. Small chrome addition. |
| WD33 | BriefTab download/export button missing | S | None | P1 | Prod MemoModal had a download action that wasn't ported to BriefTab during C1a. ~30-50 LOC. Pre-beta-launch polish. |
| WD34 | BriefTab TLDR gold-faint block per DirectionD MemoCard chrome (Phase 2 enhancement) | S | None | P2 | Reclassified from P0-drift to P2 since production MemoModal also lacks this treatment. |
| WD35 | 21 batched P1/P2 chrome polish items from C1b/C1c drift reports | M | None | P1 | Single chrome-sweep PR scope. Details in PR #243 drift appendix and PR #244 drift appendix. |
| WD36 | Stale JSDoc comment in `src/lib/company-intel.ts:510` (formatArticleList) references deleted `buildMemoSources` function | XS | None | P2 | Non-functional but should be cleaned up. |
| WD37 | Orphaned legacy components from PR-A2 -> PR-E0 migration | XS | None | P2 | `company-detail-client.tsx`, `company-header.tsx`, `company-tabs.tsx`, `index.ts` barrel, `companyDetailFixture.ts`. Zero importers verified. Safe to delete. |
| WD38 | Lucas-protected file review post-#197 | XS | Lucas conversation | P2 | Evaluate whether `MemoModal.tsx`, `trends/page.tsx`, `briefing/route.ts` protections are still load-bearing given Phase 1 architectural shifts (BriefTab supersedes MemoModal's role for company memos). Coordinate with Lucas. Scope TBD if any removals are agreed. |
| WD39 | Pre-#197 systematic visual smoke audit across all Company Intel surfaces | S | None | P1 | Phase 4 of overnight run executed a static-analysis version; a manual authenticated browser audit by Noah is still recommended pre-#197 ship. |
| WD40 | User-triggered web-fallback search on empty-state surface for unindexed companies | M | WD11-WD16 (backend infra exists) | P1 | Backend web-fallback infrastructure exists per WD11-WD16. New scope: wire user-initiated search on `/company/[unindexed-id]` empty state to invoke the web-fallback pipeline (with quota enforcement per WD12). Product scope decision required: is this Phase 1 or Phase 2? |
| WD41 | Empty-state surface bug scope (brand string, contrast, search-directory, ticker blur) | S | WD40 (web-fallback) for full resolution | P1 | Phase 2 of overnight run classifications: (a) brand "Breaking Alpha" should be "Signalera" at `EmptyState.tsx:93` -- introduced in PR-E1 #238, never displayed correct brand. (b) "Add to watchlist" button uses undefined CSS tokens `--gold-deep`/`--gold-faint` in `EmptyStateCTA.tsx:39-45`, fails through to cream-on-cream-hi -- never worked. (c) "Search directory" is a `<Link href="/company">` in `EmptyStateCTA.tsx:86-94`, no onClick missing -- if user expected inline search, that flow was never built (see WD40). (d) Ticker controlled-input blur in Lucas-protected `WatchlistAddInput.tsx` -- byte-identical to main, pre-existing, requires Lucas coordination. All four bugs classified (iii) NEVER WORKED or (i) PRE-EXISTING + Lucas-protected; no C1c regressions surfaced. |
| WD51 | ThemesTab substring match over-broad | S | None | P2 | Surfaced during Phase 4 WD50 audit. Theme matching uses naive substring filter that may over-match unrelated articles (e.g. theme "AI" matches any article containing "AI" anywhere in title). Consider word-boundary regex or token match. |
| WD52 | Duplicate "Sources" h3 on detail page (SourcesStrip footer + SourcesTab heading) | XS | None | P2 | Surfaced during Phase 4 WD50 audit. Both surfaces label themselves "Sources" creating visual confusion when both visible simultaneously. Consider renaming the footer strip to "Top sources" or removing one h3. |
| WD53 | CompanyTrendCard sentiment Sparkline ink hardcoded green | XS | None | P2 | Surfaced during Phase 4 WD50 audit. The right-rail TrendCard sentiment line is hardcoded green regardless of actual sentiment polarity. Should bind to the sentiment value (green for bullish, red for bearish, gray for neutral). |
| WD54 | CompanyKPIStrip "events today" label vs data window mismatch | XS | None | P2 | Surfaced during Phase 4 WD50 audit. Label says "events today" but the underlying count uses a 14-day window. Either relabel "events 14d" or scope the count to actual today. |
| WD55 | CompanyDetailHeader subtitle hardcoded "NASDAQ" for any tickered company | XS | None | P2 | Surfaced during Phase 4 WD50 audit. Pre-existing on main: subtitle reads "NASDAQ" even for NYSE-listed or foreign tickers. Should bind to actual exchange field or omit. |
| WD56 | CompanyAliasRibbon alias chips are buttons with no onClick (misleading affordance) | XS | None | P2 | Surfaced during Phase 4 WD50 audit. Alias chips render as `<button>` elements with no click handler, suggesting interactivity that doesn't exist. Either implement filter-by-alias behavior or convert to `<span>`. |
| WD57 | No distinct 404 surface for malformed `/company/[id]` slugs | S | None | P2 | Surfaced during Phase 4 WD50 audit. When slug doesn't resolve, page falls back to EmptyState (the "isn't on Signalera yet" surface) which is meant for valid-but-unindexed companies. Add a true 404 path for malformed inputs. |
| WD58 | Tab keyboard hint advertises Alt+number but omits `[`/`]` cycle keys | XS | None | P2 | Surfaced during Phase 4 WD50 audit. CompanyDetailTabs tooltip / a11y hint shows Alt+1..9 but the handler also supports `[`/`]` for cycling. Either document both or remove the bracket-key support. |

## Notes

- This document supersedes / overlaps with `docs/w2d-backlog.md` -- consolidation pending. As of 2026-05-05 the legacy file is not present in `docs/`, so this file stands alone.
- UUIDs verified against prod Supabase 2026-05-05.
- Berkshire cluster: all 4 UUIDs in user spec confirmed (de144271, 42cb5965, 64383c40, cc3ab2b7).
- Alphabet/Google cluster: 9 candidate dup rows found (user spec said 5). See WD04 notes.
- False-positive tickers: all 5 (Advent/AVK, AWS/JWSMF, Axios/AXAC, Bitcoin/GBTC, xAI/XFLT) confirmed in DB.
- For cluster merges, refer to Patch H precedent in PR #209 / commit history.
