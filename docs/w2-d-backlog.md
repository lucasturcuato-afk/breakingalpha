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

Total: 30 items.

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
| WD30 | Add aliases.is_canonical boolean for explicit canonical preference | XS | None | P2 | Surfaced during PR-B0 (alias resolver). Spec called for `is_canonical` + `created_at` columns; live aliases schema has neither. Implementer correctly pivoted to recon's tiebreaker hierarchy `mention_count DESC -> last_updated DESC -> first_seen ASC -> id ASC`. An explicit `is_canonical` boolean would let editorial pin the canonical alias choice (e.g. "NVIDIA" over "NVIDIA Corporation") rather than relying on heuristic. Filed 2026-05-07. |

## Notes

- This document supersedes / overlaps with `docs/w2d-backlog.md` -- consolidation pending. As of 2026-05-05 the legacy file is not present in `docs/`, so this file stands alone.
- UUIDs verified against prod Supabase 2026-05-05.
- Berkshire cluster: all 4 UUIDs in user spec confirmed (de144271, 42cb5965, 64383c40, cc3ab2b7).
- Alphabet/Google cluster: 9 candidate dup rows found (user spec said 5). See WD04 notes.
- False-positive tickers: all 5 (Advent/AVK, AWS/JWSMF, Axios/AXAC, Bitcoin/GBTC, xAI/XFLT) confirmed in DB.
- For cluster merges, refer to Patch H precedent in PR #209 / commit history.
