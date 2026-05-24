# W2-D Parallel Sprint Status

**Dispatch start:** 2026-05-11T21:43:57Z
**Hard cap:** 2026-05-12T05:43:57Z (8h)
**Main tip at dispatch:** `22dd457` (gitignore auth state for w2-d sprint, on top of HANDOFF.md `8c693c0` and Phase 1 squash `22cda0c`)
**Orchestrator:** Claude Opus 4.7

## Pre-flight notes for Noah

- Main tip pulled to `22dd457`. All 6 threads branch from this.
- **Thread E auth blocker confirmed:** `auth-state.json` not present in working tree. `.gitignore` excludes it as expected, but no seed file means Thread E cannot sign in. Thread E will attempt and document; expect limited deliverable.
- 6 git worktrees being created under `.git/worktrees/` -- disk OK (168Gi free).

## Thread Roster

| Thread | Scope (WD coverage) | Branch | Type | Status | Draft PR |
|---|---|---|---|---|---|
| A | Chrome polish batch (WD81 82 84 85 86) | `noah/w2-d-chrome-polish` | code | COMPLETED | [#249](https://github.com/lucasturcuato-afk/breakingalpha/pull/249) |
| B | Orphaned component cleanup (WD87) | `noah/w2-d-orphan-cleanup` | code | COMPLETED | [#247](https://github.com/lucasturcuato-afk/breakingalpha/pull/247) |
| C | Entity resolution + process recon (WD72 61 62 64 03 06 26 60 71 69 83) | `noah/w2-d-recon-entity` | doc | COMPLETED | [#250](https://github.com/lucasturcuato-afk/breakingalpha/pull/250) |
| D | Classifier + summary audit (WD63 59 49) | `noah/w2-d-recon-classifier` | doc | COMPLETED | [#252](https://github.com/lucasturcuato-afk/breakingalpha/pull/252) |
| E | Visual smoke audit (WD89 66 91) | `noah/w2-d-recon-smoke` | doc | COMPLETED-PARTIAL | [#248](https://github.com/lucasturcuato-afk/breakingalpha/pull/248) |
| F | BriefTab regenerate button (WD70) | `noah/w2-d-wd70-regenerate` | code+migration | COMPLETED | [#251](https://github.com/lucasturcuato-afk/breakingalpha/pull/251) |

## Updates

### 2026-05-11T21:47Z -- Thread B COMPLETED

- PR: [#247](https://github.com/lucasturcuato-afk/breakingalpha/pull/247) (DRAFT)
- Branch: `noah/w2-d-orphan-cleanup`
- Commit: `422ed92`
- Files deleted: 4 (564 LOC)
  - `src/components/company/company-detail-client.tsx`
  - `src/components/company/company-header.tsx`
  - `src/components/company/company-tabs.tsx`
  - `src/components/company/index.ts` (dead barrel)
- Spec said 5 candidates; agent found 4. Reasoning: every capitalized sibling component (`CompanyDetailLayout`, `CompanyDetailHeader`, `CompanyDetailTabs`, `CompanyKPIStrip`, `CompanyTrendCard`, `CompanyThemesCard`, `CompanyMemoModalListener`, `CompanyAliasRibbon`, `CompanyStockChart`, `SourcesStrip`, `ArticlesTable`, `ArticlesRow`, `ThemesDetailRow`, `ComingSoonCard`) is actively imported. C0/C0a/C1a/C1b precursors no longer exist in `src/`.
- Gates: tsc PASS baseline + post-delete; next build fails identically pre/post with a Turbopack root resolution issue (pre-existing, unrelated). tsc proxy gate per spec.
- No Lucas-protected file touched. No filed-WD candidates.
- **Pre-existing next-build issue is a finding worth noting**: build fails with "We couldn't find the Next.js package (next/package.json) from .../src/app" -- agent flagged it as Turbopack root resolution. Worth filing as a new WD candidate at sprint-end.

### 2026-05-11T21:54Z -- Thread E COMPLETED (partial, as expected)

- PR: [#248](https://github.com/lucasturcuato-afk/breakingalpha/pull/248) (DRAFT, doc-only)
- Branch: `noah/w2-d-recon-smoke`
- Findings doc: `docs/w2-d/visual-smoke-audit.md`
- Auth wall confirmed: Google OAuth + email/password at `/auth`. `/company/[id]` redirects to `/auth`. `/company` directory + `/preview` accessible signed-out.
- Surfaces captured live: 4 signed-out (landing, auth wall, preview dashboard, directory). 0 of 180 signed-in.
- WD66 covered via code-read (legacy inline-card from deleted `company-detail-client.tsx` vs current columnar via `ArticlesTable.tsx`+`ArticlesRow.tsx`)
- WD91 sub-bugs (code-read audit):
  - (a) Brand "Breaking Alpha" string -- **BUG STILL PRESENT** at `EmptyState.tsx:93`
  - (b) Button contrast undefined `--gold-deep`/`--gold-faint` -- **BUG STILL PRESENT** (tokens never defined in `tokens.css`)
  - (c) Search Directory onClick -- **RESOLVED (as-designed)** -- Link works; inline-search is separate WD90 feature
  - (d) Ticker field blur in WatchlistAddInput -- **NEEDS-LIVE-VERIFY** + rescope finding: not reachable from EmptyState, belongs to `/watchlist` surface only
- Halts: none. No data-loss / auth-bypass observed.
- Filed-WD candidates (8):
  1. **WD-NEW-AUTH-SEED (P0)** -- seed `auth-state.json` or wire Playwright login automation. Headline blocker for future visual smoke.
  2. WD89-DEFERRED (P1) -- re-run 180-surface sweep post-seed
  3. WD91-A (P2) -- brand string fix
  4. WD91-B (P1) -- undefined gold tokens
  5. WD91-C-REGROUP (P3) -- close as-designed
  6. WD91-D-RESCOPE (P2) -- move to `/watchlist`, Lucas-coordinate
  7. **WD-NEW-LANDING-EMDASH (P3)** -- prod landing CTA renders literal em-dash glyph despite ASCII-only convention. Ironic.
  8. **WD-NEW-PREVIEW-DIRECTORY-COMPLIANCE (P2)** -- unauthenticated `/company` directory exposes real company mention counts. Confirm intended.

### 2026-05-11T21:55Z -- Thread A COMPLETED

- PR: [#249](https://github.com/lucasturcuato-afk/breakingalpha/pull/249) (DRAFT)
- Branch: `noah/w2-d-chrome-polish`
- Files touched (10):
  - `src/components/company/CompanyAliasRibbon.tsx`
  - `src/components/company/CompanyDetailHeader.tsx`
  - `src/components/company/CompanyDetailTabs.tsx`
  - `src/components/company/CompanyKPIStrip.tsx`
  - `src/components/company/CompanyTrendCard.tsx`
  - `src/components/company/tabs/BriefTab.tsx`
  - `src/components/company/tabs/TrendTab.tsx`
  - `src/components/ui/eyebrow.tsx`
  - `src/lib/company-intel.ts`
  - `src/lib/parse-memo.ts`
- WD coverage:
  - WD81 DELIVERED: tab strip motion, hover lift, gold inset underline active indicator, softened strip border
  - WD82 DELIVERED: TrendTab "Price & Sentiment . Nd" header above stock chart
  - WD84 DELIVERED: BriefTab first section as gold-faint TLDR block with 9px mono "TLDR" eyebrow per DirectionD MemoCard L668-677
  - WD85 DELIVERED 21/21 (with WD85.10/.18/.20/.21 closed-without-code-change, rationale documented)
  - WD86 DELIVERED: stale `buildMemoSources` reference removed from `formatArticleList` JSDoc
- Gates: tsc PASS; next build SKIPPED (worktree missing node_modules -- environmental, same blocker as Thread B); em-dash scan clean
- Halts: none
- Filed-WD candidates (5):
  1. BriefTab "AI Brief" card header strip component (~30 LOC, related to WD83)
  2. ArticlesTable "Recent coverage" header strip (~35 LOC)
  3. BriefTab cache-checking flash hardening (decide cache-miss before first paint)
  4. Surface alt-key glyph hint on CompanyDetailTabs if Noah wants it visible
  5. **Define `--gold-deep`/`--gold-faint` tokens in `src/styles/tokens.css`** -- 9+ references across codebase fall through silently. **Cross-cuts Thread E WD91-B finding** -- independent confirmation.

### Cross-thread converging finding

- **Undefined gold tokens (`--gold-deep`, `--gold-faint`)** independently surfaced by:
  - Thread A WD-candidate-E (broad scope: 9+ references silently failing)
  - Thread E WD91-B (narrow scope: EmptyStateCTA contrast)
- Recommend defining at root in `src/styles/tokens.css`; Thread A's broader framing closes Thread E's narrower bug.

### 2026-05-11T22:03Z -- Thread C COMPLETED

- PR: [#250](https://github.com/lucasturcuato-afk/breakingalpha/pull/250) (DRAFT, doc-only, 2 files / 812 insertions)
- Branch: `noah/w2-d-recon-entity`
- Findings docs:
  - `docs/w2-d/entity-resolution-audit.md`
  - `docs/w2-d/process-and-spec-recon.md`
- Headline counts:
  - 3,001 companies total; 974 with ticker (32.5%); 165 with mention_count > 5
  - Duplicate name-slug clusters: **100+** (TSMC=7, AMD=4, AST SpaceMobile=3, Tesla=5)
  - Ticker collisions: **100+** (TSM=7 rows, NVDA=6, AMD/TSLA/PSKY/SMCI/WBD=5 each)
  - WD61 misclassified rows: **17 confirmed**
  - WD62 segment-as-company: **4 confirmed** (AWS, Facebook, Instagram, TikTok)
  - WD06 wrong-ticker fragments: **15+** (AWS->JWSMF, NASA->RNST, NATO->STVN, "US"->IBM, Pillar->CAT, Cove->WBD) -- these are Finnhub noise matches on token stems
  - **WD64 confirmed**: `articles.primary_company` is TEXT holding names; **0 of 4127** non-null rows are UUID-shaped
- WD60 root cause CONFIRMED: `canonicalize("ExxonMobil")` returns self (CANONICAL map L141); Finnhub doesn't return XOM on camelCase; `camelCaseSplit` retry only runs at ingest, never against legacy rows. JPMorgan/J.P. Morgan variants missing from CANONICAL map. Fix: HARD_TICKER_OVERRIDES + canonicalize aliases + null-ticker-backfill cron.
- WD71 process fix recommendation: gh-CLI pre-flight check warning on any PR with `baseRefName` matching `^noah/pr-` topic-branch pattern; requires explicit `--stacked` opt-in.
- WD69 + WD83 specs delivered in `process-and-spec-recon.md` (zero code).
- pg_trgm (WD26): available v1.6 but NOT installed. Recommendation in Section 5.
- Halts: none. No silent data corruption outside Company Intel.
- Filed-WD candidates (12): WD-A name normalization, WD-B primary_company UUID FK, WD-C articles.companies link table, WD-D pg_trgm install + fuzzy ingest hook, WD-E validateExtractedCompanyName reject list, WD-F NULL fragment-row tickers one-shot UPDATE, WD-G ExxonMobil/JPMorgan/Tencent overrides, WD-H null-ticker-backfill cron, WD-I segment-as-company blocklist + parent rollup, WD-J index baseline, WD-K aliasResolver sync, WD-L upstream token-stem trace.

### 2026-05-11T22:09Z -- Thread F COMPLETED (highest-leverage thread)

- PR: [#251](https://github.com/lucasturcuato-afk/breakingalpha/pull/251) (DRAFT)
- Branch: `noah/w2-d-wd70-regenerate`
- Migration file (NOT executed): `supabase/migrations/20260511215034_wd70_user_memo_regeneration_quota.sql`
- Files touched (4):
  - `supabase/migrations/20260511215034_wd70_user_memo_regeneration_quota.sql` (new)
  - `src/app/api/memo/route.ts` (Lucas-protected exception per protocol)
  - `src/app/api/memo-cache/route.ts` (counter surface)
  - `src/components/company/tabs/BriefTab.tsx`
- Architecture notes (from recon):
  - Memo route is POST-only with NO on-route cache layer
  - "Cache" actually lives in `output_log_v0_stub` table; read by `/api/memo-cache` route
  - Regenerate implemented as `?regenerate=true` on POST (chosen over new POST handler to fit existing pattern)
  - Quota gate: 3 per UTC day via `user_memo_regeneration_quota` table
  - On regen: DELETE prior cache rows for `(user_id, company_id, variant=articles)`, run existing content path
  - Counter surfaced through both memo-cache GET (mount-time fetch) and regen POST response
- Gates: tsc PASS; next build SKIPPED (same Turbopack root issue reproduces on baseline main -- NOT introduced by this change); em-dash scan clean
- Halts: none. No Lucas-protected coupling surfaced beyond the granted exception.
- Filed-WD candidates (2):
  1. **Worktree `next build` Turbopack-root failure** -- environment-shaped but consistently surfaced across Threads A/B/F. Configure `turbopack.root` for worktree builds so future code threads can run full build verification.
  2. **`MEMO_REGENERATIONS_PER_DAY` triple-source-of-truth** -- duplicated in `/api/memo/route.ts`, `/api/memo-cache/route.ts`, and `BriefTab.tsx`. Hoist to `src/lib/quotas.ts` in a follow-up to prevent drift.
- Manual steps for Noah (verbatim from PR #251 body):
  1. Review migration SQL at `supabase/migrations/20260511215034_wd70_user_memo_regeneration_quota.sql`
  2. Execute migration in Supabase dashboard
  3. Pull branch locally and re-test regenerate end-to-end
  4. Verify RLS policies behave as expected
  5. Loop Lucas in async on PR review (no blocker per sprint protocol override)
  6. Merge when satisfied

### 2026-05-11T22:18Z -- Thread D COMPLETED

- PR: [#252](https://github.com/lucasturcuato-afk/breakingalpha/pull/252) (DRAFT, doc-only)
- Branch: `noah/w2-d-recon-classifier`
- Findings doc: `docs/w2-d/classifier-summary-audit.md`
- Sample N: 115 manually scored (18 M&A / 18 Earnings / 22 Other / 14 Funding/IPO / 14 Macro/Geopolitical / 18 mega-cap / 23 cross-checks) + aggregate SQL scans over all 5,074 rows in 21d window. Stopped when pattern catalog stabilized + prevalence quantified.
- Headline classification accuracy: **60% strict-correct, 79% correct-or-borderline**. Worst: Earnings 44%. Best: Geopolitical 86%, Macro 71%.
- **CRITICAL FINDING (reframes WD59)**: `articles.summary` is NOT LLM-generated. It is the RSS feed `description` HTML-stripped and capped at 500 chars in `backend/ingest.py:349-361, 466, 512, 543`. There is no synthesis prompt to diff. **WD59 should be reframed from "prompt-tuning audit" to "feed/normalization audit."**
- Top 3 failure patterns:
  1. Analyst notes / pre-earnings previews / earnings-date scheduling press releases get labeled `Earnings` (~30% of Earnings bucket). Prompt at `backend/ingest.py:215` forbids this but is too vague.
  2. **Sentiment driven by stock reaction or editorial framing rather than event semantics.** UI now shows BULLISH next to "guidance cut" / "missed earnings" / "liver failure" because **C1b ARTICLE TONE relabel surfaced an ambiguity that already existed in the prompt** (`backend/ingest.py:214`). This is WD49 root cause.
  3. RSS-derived summaries carry wire-service/PRNewswire dateline/SEC-filing-metadata boilerplate before content. 61 SEC rows have only `"Filed: ... AccNo: ... Size: __ MB"` as summary.
- Top 3 prompt-tuning recommendations:
  1. **P0** Tighten Earnings clause at `backend/ingest.py:215` to explicitly exclude analyst notes / pre-earnings previews / scheduling press releases / listicles. Expected: ~30% of Earnings reclassifies correctly.
  2. **P0** Define sentiment frame as EVENT (not stock reaction or editorial framing) at `backend/ingest.py:214`. Resolves WD49 root cause.
  3. **P1** Harden `primary_company` against descriptive phrases / placeholders / possessive descriptors at `backend/ingest.py:216`.
- Halts: none. No PII, no paywall reproduction, no compliance issues.
- Filed-WD candidates (12) -- **WARNING: Thread D used proposed numbers WD64-WD75 that COLLIDE with existing entries in `docs/w2-d-backlog.md`. Noah must renumber on intake.** Substance:
  - Earnings prompt tightening (P0)
  - Sentiment frame definition event-vs-reaction (P0) -- resolves WD49 root cause
  - Reintroduce Regulation deal_type bucket + backfill migration (P2)
  - `strip_html` prefix peeling for PRNewswire / Investing.com / wire datelines (P1)
  - SEC summary backfill from `content` column (P1)
  - `primary_company` hallucination guard tightening (P1)
  - Low-quality source blocklist (P3)
  - JV deal_type disambiguator (P2)
  - IPO clause excludes ETF launches and SPAC over-allotments (P2)
  - UI-side sentiment label sweep across story-card / feed-row / brief-pdf (P3)
  - **HIGHEST-LEVERAGE / LOWEST-EFFORT recommendation**: surface existing `relevance_reason` in ArticlesRow expand-row instead of noisy RSS `summary`. **LLM rationale already exists in DB and is unused by any UI surface.**
  - (Optional larger) Add a true per-article synthesized lede prompt.

## Sprint wrap-up -- 2026-05-11T22:25Z

All 6 threads returned within ~35 min of dispatch (well inside 8h cap). Zero halts requiring Noah's mid-sprint judgment. See `docs/HANDOFF.md` for the full sprint summary, recommended triage order, consolidated WD candidates, and constraint compliance attestation.

**6 draft PRs ready for Noah's review** (priority order):
1. [#251](https://github.com/lucasturcuato-afk/breakingalpha/pull/251) -- WD70 BriefTab regenerate (migration execution required first)
2. [#249](https://github.com/lucasturcuato-afk/breakingalpha/pull/249) -- WD81/82/84/85/86 chrome polish
3. [#247](https://github.com/lucasturcuato-afk/breakingalpha/pull/247) -- WD87 orphan cleanup (-564 LOC)
4. [#250](https://github.com/lucasturcuato-afk/breakingalpha/pull/250) -- WD72/61/62/64/03/06/26/60/71/69/83 entity + process recon
5. [#248](https://github.com/lucasturcuato-afk/breakingalpha/pull/248) -- WD89/66/91 visual smoke (auth-blocked, partial)
6. [#252](https://github.com/lucasturcuato-afk/breakingalpha/pull/252) -- WD63/59/49 classifier audit (number-renumber required on intake)
