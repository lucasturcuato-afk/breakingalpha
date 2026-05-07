# W2-C Phase 1 Recon Synthesis

Date: 2026-05-07
Source: 5-phase parallel recon (Phase 1 detail-page code, Phase 2 data inventory, Phase 3 API inventory, Phase 4 Yahoo capabilities, Phase 5 primitive porting).
Status: AUTHORITATIVE pre-build reference. All sub-PR specs and smoke-test rows trace back to findings here.

Cross-references:
- `docs/w2-c-phase-1-build-pr-specs.md` -- Section 1 + per-PR specs (21 sub-PRs)
- `docs/w2-c-phase-1-component-map.md` -- Direction D component -> data-testid -> sub-PR map
- `docs/w2-c-phase-1-primitives-audit.md` -- existing-vs-port decisions per primitive
- `docs/w2-c-phase-1-smoke-test-recipe.md` -- 180 smoke-test rows
- `docs/axe-baseline-2026-05-07.md` -- 96 nodes / 5 rules / 18 rule-route occurrences
- `docs/w2-d-backlog.md` -- 29 W2-D follow-up items
- `docs/DirectionD.jsx` -- visual spec (1493 lines)
- `docs/data (1).jsx` -- shared data shapes
- `docs/primitives (1).jsx` -- Direction D primitives

This document is the SINGLE entry-point for all Phase 1 build work. Every sub-PR spec, every smoke-test row, and every W2-D backlog item traces back to a finding here. Future work (W2-C Phase 1 build, W2-D follow-ups, V1.5+ extensions) should reference this synthesis first before drilling into the detail docs above.

## 1. Critical findings (15 items)

The 5-phase recon surfaced 15 critical findings (C1-C15) that drove the 21-PR build sequence and the 29-item W2-D backlog. Each finding is detailed below with severity tag, affected sub-PR, mitigation, and cross-reference.

### C1 -- No structured memo cache exists

Severity: HIGH. Drives PR-C0 + PR-C1.

The `outputs` table has 1 row, `watchlist_briefs` has 2 rows (NVDA + FCX), and `briefings` has 105 rows -- all storing unstructured Markdown. The MemoCard primitive in DirectionD.jsx expects `{tldr, paragraphs:[{kind,text}], sources:[{n,...}]}` but this shape exists nowhere in the database today. The structured memo writer (PR-C0) has to be built fresh, with Gemini JSON mode, and the BriefTab (PR-C1) consumes that structured output via the `CitedText` primitive.

Mitigation: PR-C0 ships a structured-output writer (`src/lib/memo/writeStructuredMemo.ts`) that emits typed `StructuredMemo {tldr, lead, context, watch, citations}`. Markdown fallback preserved on parse failure. PR-C1 consumes the structured shape in BriefTab.

Cross-reference: build-pr-specs.md PR-C0 (Section 3, lines 254-272), PR-C1 (lines 293-311).

### C2 -- /api/memo doesn't persist anything

Severity: HIGH. Drives PR-D2 + PR-C1 cache integration.

The `/api/memo` route returns `{memo: <free-form prose>}` and writes nothing. Today's only memo cache lives client-side in `watchlist_briefs`, written ONLY from `/watchlist/[identifier]`, keyed by `identifier` (NOT canonical UUID), with a 12h TTL. Anywhere outside the watchlist route hits Gemini cold every time.

Mitigation: PR-D2 wires `recordOutput()` via Next.js `after()` hook (Pattern A) so memo persistence happens AFTER the response is sent. PR-C1 reads cached memo from `outputs` table on detail page load.

Cross-reference: build-pr-specs.md PR-D2 (lines 410-428). component-map.md PR-D2 owns L1-L9 smoke rows.

### C3 -- /api/companies/[id] detail route does NOT exist

Severity: MEDIUM. Drives PR-A3.

The detail page at `/company/[id]` does direct Supabase reads in the server component plus a cross-route import of `fetchCompanyArticles` from another route handler. There is no API surface for company detail; the page is the API.

Mitigation: PR-A3 introduces `getCompanyDetail()` in `src/lib/data-access/` -- pure data layer, no route. Future PR can promote to API route if needed; for Phase 1 the layer is sufficient.

Cross-reference: build-pr-specs.md PR-A3 (lines 134-152). data shape `{company, kpis, themes, trend, articles, sources, memo, aliases}` matches DirectionD `window.NVIDIA` constant.

### C4 -- Alias canonical-rollup is broken

Severity: HIGH. Drives PR-B0.

There are 6 separate `companies` rows for ticker NVDA today: Nvidia (mention count 86), Nvidia Corp. (12), NVIDIA (10), NVIDIA Corporation (3), Nvidia Corp (1), NVIDIA Corp. (1). Each alias points to its OWN self-row in the `aliases` table -- the canonical_id FK never converged. Querying for "NVIDIA" returns one of the duplicates depending on case-sensitivity and recency.

Similar duplication exists for Berkshire (4 rows -- WD03), Alphabet/Google (9 rows -- WD04, more than the user-spec count of 5), and likely TSMC, Samsung, Celestica per ADR alias map (WD05/WD06).

Mitigation: PR-B0 ships a query-time `aliasResolver.ts` that synthesizes canonical via `WHERE ticker = ?` preferring `is_canonical = true` else most-recent `created_at`. NO schema migration in Phase 1. WD03/WD04/WD05/WD06 in W2-D backlog ship the actual cluster merges.

Cross-reference: build-pr-specs.md PR-B0 (lines 154-172). w2-d-backlog.md WD03/WD04/WD05/WD06.

### C5 -- Direction D palette differs from existing tokens

Severity: MEDIUM. Drives PR-A0 + axe-baseline T11.

Comparing `docs/DirectionD.jsx` lines 13-40 (palette constants `D.gold`, `D.goldDark`, `D.cream`, etc.) against `src/styles/tokens.css`: 6 existing tokens differ in value (`--gold`, `--gold-dark`, `--cream`, `--gold-muted`, `--gold-border`, `--border-base`) and 5 are net-new (`--border-hi`, `--row-hover`, `--row-alt`, `--row-active`, `--purple`). The 60-node color-contrast axe violation cluster (axe-baseline-2026-05-07.md) is dominated by legacy palette token usage and should drop dramatically once PR-A0 lands.

Mitigation: PR-A0 ships a single `tokens.css` update (~25 LOC). Axe re-baseline via T11 captures the new totals. T1 ceiling adjusted from "27" to `<= 18 rule-route occurrences` (axe-baseline addendum).

Cross-reference: build-pr-specs.md PR-A0 (lines 74-92). axe-baseline-2026-05-07.md (full file).

### C6 -- companies.sector / description / notes 100% empty

Severity: LOW (visibility). Drives header sector placeholder pattern + WD25.

Across 2,921 rows in `companies`, `sector`, `description`, and `notes` columns are 100% empty (NULL or empty string). The CompanyHeader subtitle (smoke-test A4) renders the sector field; without backfill, every detail page shows a placeholder dash.

Mitigation: PR-B1 handles empty `sector` with placeholder dash. WD25 (Finnhub sector backfill via Patch P) closes the data gap; gated on WD01 + WD02.

Cross-reference: build-pr-specs.md PR-B1 (lines 174-192). w2-d-backlog.md WD25.

### C7 -- articles.deal_type over-fires

Severity: MEDIUM. Drives KPI Articles-today decoupling.

Every NVIDIA article in the last 7 days has a non-null `deal_type` field. The KPI strip's `events_today` value equals `articles_today` because every article gets classified as a deal/event. The "Events" filter pill in the Articles tab (smoke-test E10) becomes meaningless when 100 percent of articles match.

Mitigation: Phase 1 keeps `events_today = articles_today` as a known limitation. The deal_type classifier needs revisiting in W2-D / V1.5+ (no specific WD item yet -- candidate for backlog addition).

Cross-reference: smoke-test E10 (filter pill behavior).

### C8 -- No source tier classification

Severity: MEDIUM. Drives PR-C5 hard-coded tier map.

The `source_credibility` table tracks thesis win-rate, NOT a `{primary, tier-1, tier-2, tier-3}` taxonomy. The SourcesStrip (DirectionD.jsx 812-839) and Sources tab show tier badges that have no DB source today.

Mitigation: PR-C5 ships a hard-coded `tierMap.ts` record: Tier 1 = {Bloomberg, Reuters, FT, WSJ}, Tier 2 = {CNBC, Barron's}, Tier 3 = rest. Deterministic, single-file, swappable later. No DB migration in Phase 1.

Cross-reference: build-pr-specs.md PR-C5 (lines 371-389).

### C9 -- companies.key_themes is text[] (label only)

Severity: MEDIUM. Drives PR-B3 + PR-C3 derivation helper.

The `key_themes` column is `text[]` (e.g. `["Crypto", "Tech", "Regulation", "Public Markets", "VC"]`). The DirectionD ThemesCard expects `{label, weight, tone, count}` per theme. The shape mismatch means weight/tone/count must be derived query-time from articles join.

Mitigation: PR-B3 ships `deriveThemes()` synthesizing weight/tone/count from article counts joined per theme keyword (in-memory, query-time). PR-C3 reuses the helper for the expanded ThemesTab. Schema enrichment deferred entirely to W2-D.

Cross-reference: build-pr-specs.md PR-B3 (lines 215-232), PR-C3 (lines 333-349).

### C10 -- companies.sentiment_trend is text scalar

Severity: MEDIUM. Drives PR-B4 aggregation route.

`sentiment_trend` is a text scalar (`bullish` / `bearish` / `neutral`), NOT a numeric array. The TrendCard MiniBars + Sparkline expect a `number[30]` series. Population coverage is 100 percent on the scalar field, so the value is reliable as a single-point indicator -- but cannot drive 30-day trend visualization.

Mitigation: PR-B4 ships `aggregateTrend()` deriving `{counts, sentiments}` from `articles.sentiment` aggregated by day. Bullish=+1, neutral=0, bearish=-1 mapping. Cached 15min via Vercel runtime cache. Schema enrichment deferred to W2-D.

Cross-reference: build-pr-specs.md PR-B4 (lines 234-252).

### C11 -- Article-grounded memos emit no [n] markers

Severity: MEDIUM. Drives PR-C0a.

The current `/api/memo` writer has two paths: `company-web` (web-fallback via Exa + Gemini) and `company-articles` (article-grounded). Only the company-web path emits inline `[n]` citation markers. The article-grounded path returns prose without markers, so the BriefTab's CitedText regex `/(\[\d+\])/g` (smoke-test D9) finds nothing on populated companies.

Side-branch `a7d41cf` already has a fix for this. It hasn't shipped to main.

Mitigation: PR-C0a re-does `a7d41cf` -- prompt instructs Gemini to emit `[1]`, `[2]` inline; output includes ordered citations array; `citationParity()` validator ensures marker count equals citations length. Parallelizable with PR-C0; resolve prompt-file conflict in second-merged.

Cross-reference: build-pr-specs.md PR-C0a (lines 274-291).

### C12 -- Yahoo v10 quoteSummary needs crumb auth; v11 doesn't exist

Severity: HIGH. Drives PR-B2.

Yahoo Finance API research:
- v10 endpoint requires crumb authentication: cookie + `getcrumb` round-trip then `crumb` query param on every request. Crumb expires every ~1 hour.
- v11 endpoint does NOT exist (deprecated; common reference doc rumor).
- v8 chart endpoint still keyless and works for OHLC + volume.

Aggregate p50 ~270ms across 12 cold composite calls (9 modules each). p95 ~550ms. Recommended TTLs: 60s price, 1h EPS/PE/float, 24h calendar.

Mitigation: PR-B2 ships `crumbAuth.ts` helper with 1h cache + v8 chart fallback for price-only on crumb failure. `/api/company-kpis?ticker=NVDA` route. Private companies HTTP 404 with `body.quoteSummary.error.code === "Not Found"` -- handled with "Private" badge.

Cross-reference: build-pr-specs.md PR-B2 (lines 194-212). Section 5 below for full Yahoo capability matrix.

### C13 -- Pipeline runs a cycle behind

Severity: LOW (cosmetic). Drives KPI placeholder behavior.

The article ingestion pipeline runs nightly. Today (2026-05-07) had zero NVIDIA articles. KPIs anchored to "today" frequently render zero on currently-running tickers because the cycle hasn't completed. Q5 SQL findings show NVIDIA mentions7d series `[8, 14, 11, 0, 12, 6, 10, 0]` -- two zero-days from pipeline gaps in the last 8 days.

Mitigation: KPI strip Articles-today and Sources-today render `0` honestly. UI does not surface a "stale" indicator in Phase 1; potential V1.5+ enhancement (candidate for WD addition: pipeline-trace right rail K4 already gated on V1.5 flag).

Cross-reference: smoke-test K4 (pipeline-trace V1.5 flag).

### C14 -- recordOutput() doesn't exist on main

Severity: MEDIUM. Drives PR-D2 + WD21.

The `outputs` table is built per substrate Step 3. Side-branch `a67e69c` has the SDK (`recordOutput()`). The writer side has not shipped to main. Without the SDK, the table stays at 1 row and observability dashboards (WD22) have no data.

Mitigation: PR-D2 ports the SDK from `a67e69c` and wires `/api/memo` route to call it via Next.js `after()` (Pattern A). WD21 locks in the canonical schema if the v0_stub was deployed.

Cross-reference: build-pr-specs.md PR-D2 (lines 410-428). w2-d-backlog.md WD21, WD22.

### C15 -- CompanyIntelMemoModal.tsx is dead code on integration

Severity: LOW (cleanup). Drives Phase 1 hygiene PR.

The file at `src/components/company/CompanyIntelMemoModal.tsx` is 746 LOC, exported from the barrel, and has zero callers across the codebase. It's a Phase 0 prototype that was never wired up.

Mitigation: Deletion deferred until after Phase 1 ships (cleanup PR -- not yet specced; candidate for WD addition). Phase 1 build PRs are instructed (component-map.md PR-A2 step 1) to leave the file alone.

Cross-reference: component-map.md (line 122 -- "leave for cleanup PR").

## 2. Phase 1 -- Existing detail-page code recon

### Per-file inventory

The Phase 1 build PRs target the company detail page at `/company/[id]`. Phase 1 recon catalogued the existing files and their roles before any new work:

| Path | LOC | Role | Lucas-protected? |
|---|---|---|---|
| `src/app/company/[id]/page.tsx` | ~180 | Server component, direct Supabase reads + cross-route import of `fetchCompanyArticles` | NO -- editable in PR-A2 |
| `src/components/company/CompanyIntelMemoModal.tsx` | 746 | Dead code, exported, zero callers (C15) | NO -- leave alone, defer deletion |
| `src/components/company/CompanyHeader.tsx` (existing) | varies | Phase 0 header chrome -- replaced by PR-A1's CompanyDetailHeader | NO |
| `src/components/memo/MemoModal.tsx` | varies | Shared memo modal, 17 callers across codebase | YES -- Lucas-protected (Phase 1 cannot modify) |
| `src/lib/watchlist-utils.ts` | varies | useRef sync lock + Patch L coalesce contract | YES -- Lucas-protected |
| `src/components/watchlist/WatchlistAddInput.tsx` | varies | submitting flag gating silent-coalesce; WD08 conflict | YES -- Lucas-protected |
| `src/app/trends/page.tsx` | varies | Trends page render path | YES -- Lucas-protected |
| `src/app/api/briefing/route.ts` | varies | Morning brief API | YES -- Lucas-protected |

### Frame 3 element checklist (Direction D -> existing)

| Direction D component | DirectionD.jsx lines | Existing? | Sub-PR |
|---|---|---|---|
| Sidebar | 42-108 | YES (existing chrome) | n/a |
| TopBar | 160-188 | YES (existing chrome) | n/a |
| StatusStrip | 202-228 | YES (existing mood bar) | n/a |
| CompanyHeader | 528-579 | PARTIAL (Phase 0 prototype, needs rewrite) | PR-A1 |
| KPIStrip | 582-610 | NO (build fresh) | PR-A2 + PR-B2 |
| FunctionTabs | 613-643 | NO (build fresh) | PR-B1 |
| MemoCard | 646-699 | NO (build fresh on structured output) | PR-C0 + PR-C1 |
| TrendCard | 701-733 | NO | PR-E2 |
| ThemesCard | 735-760 | NO | PR-E1 |
| ArticlesTable | 762-810 | PARTIAL (existing table primitive) | PR-D1 |
| SourcesStrip | 812-835 | NO | PR-F1 |
| DetailMobile | 840-965 | NO (responsive variants ride desktop PRs) | PR-A1 + PR-A2 |
| MemoModal | 967-1039 | YES (Lucas-protected) | n/a |
| WebFallback | 1041-1173 | PARTIAL (existing PR #176 derivation logic) | PR-G2 / PR-E2 deferred |
| EmptyState | 1175-1240 | NO (extend `EmptyState` ui primitive) | PR-G1 / PR-E1 |
| Loading | 1245-1340 | NO (extend `Skeleton` family) | PR-H1 / PR-E3 |

Frame coverage: 16 Direction D components total, of which 4 already exist (Sidebar, TopBar, StatusStrip, MemoModal), 3 are partial rewrites (CompanyHeader, ArticlesTable, WebFallback), and 9 are net-new builds.

### Anti-patterns to fix

The recon surfaced several anti-patterns in the existing detail-page code that Phase 1 PRs should NOT replicate:

1. Direct Supabase reads in server components -- PR-A3 introduces a data-access layer (`getCompanyDetail()`) so components consume typed data, not raw query results.
2. Cross-route imports of fetchers -- e.g. `page.tsx` importing `fetchCompanyArticles` from a route handler. PR-A3 centralizes all detail-page data fetching in `src/lib/data-access/`.
3. Inline data transforms in JSX -- e.g. computing percent change in render. PR-A1 + PR-A2 push transforms to the data layer or to small helper files.
4. Markdown-in-JSON for memo content -- Phase 0 stored memos as markdown blobs. PR-C0 introduces a structured shape so renderers don't parse markdown at render time.
5. Hardcoded testids without semantic role -- some Phase 0 testids overlap with semantic role queries. New testids in Phase 1 are namespaced (`company-detail-*`, `kpi-*`, `brief-*`, `articles-*`, `themes-*`, `trend-*`, `sources-*`, `coming-soon-*`).

## 3. Phase 2 -- Data inventory

Phase 2 ran 12 SQL queries against prod Supabase to map data availability against the DirectionD shape requirements. Results below are compact summaries; raw SQL is preserved in agent transcripts (not committed to docs).

### Q1 -- NVIDIA canonical lookup

```sql
SELECT id, name, ticker, mention_count, created_at, description, notes
FROM companies WHERE ticker = 'NVDA' ORDER BY mention_count DESC;
```

Result: 6 rows for ticker NVDA.

| Name | mention_count |
|---|---|
| Nvidia | 86 |
| Nvidia Corp. | 12 |
| NVIDIA | 10 |
| NVIDIA Corporation | 3 |
| Nvidia Corp | 1 |
| NVIDIA Corp. | 1 |

`description` and `notes` are NULL on every row (C6).

### Q2 -- Aliases for NVIDIA

```sql
SELECT alias_text, mention_count, canonical_id
FROM aliases WHERE alias_text ILIKE '%nvidia%' ORDER BY mention_count DESC;
```

Result: 6 surface forms with mention counts. Canonical_id is broken: each alias points to its OWN self-row in `companies`, not to a single canonical NVIDIA row. The convergence step that should have rolled all NVIDIA forms onto one canonical row never ran.

### Q3 -- key_themes shape

```sql
SELECT key_themes FROM companies WHERE ticker = 'NVDA' LIMIT 5;
```

Result: `text[]` only. Example: `["Crypto", "Tech", "Regulation", "Public Markets", "VC", "AI"]`. NO weight, tone, or count columns. C9 confirmed.

### Q4 -- sentiment_trend shape

```sql
SELECT sentiment_trend FROM companies WHERE ticker = 'NVDA';
```

Result: text scalar. Values are one of `bullish`, `bearish`, `neutral`. NOT a numeric array. C10 confirmed.

### Q5 -- mentions7d feasibility

```sql
WITH days AS (SELECT generate_series(CURRENT_DATE - INTERVAL '7 days', CURRENT_DATE, '1 day')::date AS day)
SELECT day, COALESCE(COUNT(cm.id), 0) AS count
FROM days
LEFT JOIN company_mentions cm ON DATE(cm.created_at) = day AND cm.company_id IN (
  SELECT id FROM companies WHERE ticker = 'NVDA'
)
GROUP BY day ORDER BY day;
```

Result: feasible. NVIDIA last 8 days: `[8, 14, 11, 0, 12, 6, 10, 0]`. Two zero-days from pipeline gaps (C13).

### Q6 -- sentiment7d feasibility

```sql
-- Same CTE pattern, joined to articles via company_mentions
-- with sentiment encoded bullish=+1, neutral=0, bearish=-1
```

Result: feasible. NVIDIA last 8 days sentiment averages: `[0.88, 0.71, 0.91, 0.50, 0.79, 0.67, 0.85, 0.50]`. Coarse 3-input averaging biases toward middle (single bearish article in a 3-article day pulls average to ~0.33).

### Q7 -- KPI delta queries

| KPI | Current | Prior | Delta |
|---|---|---|---|
| Mentions 30d | 78 | 42 (prior 30d) | +85.7% |
| Sentiment 7d delta | -0.39 (decreasing) | (vs prior 7d) | negative |
| Articles today | 0 | (today only -- pipeline behind) | C13 |
| Sources today | 0 | (tier classification IMPOSSIBLE -- C8) | n/a |

### Q8 -- Population distribution

| Column | Coverage |
|---|---|
| key_themes | 96.7% |
| sentiment_trend | 100.0% |
| first_seen | 100.0% |
| ticker | 31.0% (905 / 2,921 rows) |
| description | 0.0% |
| notes | 0.0% |
| sector | 0.0% |

C6 confirmed: description / notes / sector are empty across all 2,921 rows. Ticker coverage at 31 percent means 69 percent of companies have no ticker -- mostly private companies and entity-resolution dupes.

### Q9 -- Articles for NVIDIA

```sql
SELECT headline, source, deal_type, sentiment, published_at
FROM articles a
JOIN company_mentions cm ON cm.article_id = a.id
WHERE cm.company_id IN (SELECT id FROM companies WHERE ticker = 'NVDA')
  AND a.published_at >= NOW() - INTERVAL '14 days'
ORDER BY a.published_at DESC;
```

Result: 12+ rows last 14d. Sources: Bloomberg, Yahoo, Finnhub, TechCrunch, Benzinga. Sentiment 8/12 bullish, 3/12 neutral, 1/12 bearish. EVERY row has non-null `deal_type` (C7 confirmed).

### Q10 -- Memo cache layer

```sql
SELECT COUNT(*) FROM outputs;            -- 1
SELECT COUNT(*) FROM watchlist_briefs;   -- 2 (NVDA + FCX)
SELECT COUNT(*) FROM briefings;          -- 105
SELECT COUNT(*) FROM user_briefings;     -- 0
```

Result: NO structured cache. `outputs` 1 row (substrate Step 3 was just deployed; SDK side ships in PR-D2). `watchlist_briefs` stores Markdown text, keyed by identifier, 12h TTL, written ONLY from `/watchlist/[identifier]`. `briefings` is per-day (morning brief + evening wrap), NOT per-company. `user_briefings` is empty -- the per-user briefings table is built but has never been populated.

### Q11 -- user_briefings.addendum

```sql
\d user_briefings
SELECT COUNT(*) FROM user_briefings;
```

Result: addendum is a plain text column. Table has 0 rows total. No structure to mine.

### Q12 -- outputs table schema

The `outputs` table schema is complete per substrate Step 3. `output_type_enum` has 12 values:
1. `morning_brief`
2. `evening_wrap`
3. `watchlist_brief`
4. `company_memo`
5. `thesis_summary`
6. `pipeline_trace`
7. `web_fallback`
8. `kpi_snapshot`
9. `themes_derivation`
10. `trend_aggregation`
11. `alias_resolution`
12. `error_log`

Total rows: 1. Writer side (recordOutput SDK) ships in PR-D2.

### Field-by-field translation: data (1).jsx -> DB

The `docs/data (1).jsx` file defines the shared shapes for NVIDIA, Pershing, and the directory. Translation to DB columns:

| data (1).jsx field | DB source | Status |
|---|---|---|
| `company.name` | `companies.name` | OK |
| `company.ticker` | `companies.ticker` | OK (31% coverage) |
| `company.exchange` | (derived from ticker prefix) | derived |
| `company.sector` | `companies.sector` | EMPTY (C6) |
| `company.aliases[]` | `aliases` table joined on canonical_id | BROKEN (C4) |
| `kpis.last` | Yahoo v10 `price.regularMarketPrice` | external (C12) |
| `kpis.marketCap` | Yahoo v10 `summaryDetail.marketCap` | external |
| `kpis.mentions30d` | aggregated from `company_mentions` | derived |
| `kpis.sentiment` | `companies.sentiment_trend` | OK (text scalar -- C10) |
| `kpis.articlesToday` | aggregated from `articles` | derived (C13 zero days) |
| `kpis.sourcesToday` | aggregated distinct from `articles.source` | derived |
| `themes[].label` | `companies.key_themes[i]` | OK (C9 partial) |
| `themes[].weight` | derived from articles count joined per theme | DERIVED (PR-B3) |
| `themes[].tone` | derived from articles sentiment per theme | DERIVED (PR-B3) |
| `themes[].count` | derived from articles count | DERIVED (PR-B3) |
| `trend.counts[30]` | aggregated daily from `articles` | DERIVED (PR-B4) |
| `trend.sentiments[30]` | aggregated daily from `articles.sentiment` | DERIVED (PR-B4) |
| `articles[].headline` | `articles.headline` | OK |
| `articles[].source` | `articles.source` | OK |
| `articles[].dealType` | `articles.deal_type` | OK (over-fires -- C7) |
| `articles[].sentiment` | `articles.sentiment` | OK |
| `articles[].publishedAt` | `articles.published_at` | OK |
| `sources[].domain` | derived from `articles.source` | derived |
| `sources[].tier` | hard-coded tierMap (C8) | DERIVED (PR-C5) |
| `memo.tldr[]` | structured-output writer (C1) | NEW (PR-C0) |
| `memo.lead` | structured-output writer | NEW (PR-C0) |
| `memo.context` | structured-output writer | NEW (PR-C0) |
| `memo.watch[]` | structured-output writer | NEW (PR-C0) |
| `memo.citations[]` | structured-output writer + parity validator | NEW (PR-C0a) |

Of 26 shape fields, 13 map directly to DB columns, 9 are derived query-time, and 4 require external API calls (Yahoo) or new writer infrastructure.

## 4. Phase 3 -- API inventory

Phase 3 catalogued every API route on the existing detail-page surface plus adjacent routes that drove Phase 1 dependency analysis.

### Per-route inventory

| Route | Method | Status | Notes |
|---|---|---|---|
| `/api/companies/[id]` | GET | DOES NOT EXIST | C3 -- detail page reads Supabase directly |
| `/api/companies/web-fallback` | POST | EXISTS | PR #176 web-fallback derivation; Pershing typo case in J-section |
| `/api/articles?ticker=` | GET | EXISTS | feeds Articles tab; cross-route imported by detail page today |
| `/api/memo` | POST | EXISTS | returns `{memo: prose}`, no caching, two paths (web + articles) |
| `/api/stock-chart?ticker=` | GET | EXISTS | PR #196 CompanyStockChart consumer |
| `/api/watchlist` | GET/POST | EXISTS | Lucas-protected indirectly (watchlist-utils.ts boundary) |
| `/api/watchlist-quotes` | GET | EXISTS | watchlist sidebar live quotes |
| `/api/market-indices` | GET | EXISTS | StatusStrip mood bar feed |
| `/api/company-kpis?ticker=` | GET | DOES NOT EXIST | NEW route in PR-B2 (Yahoo crumb-auth) |
| `/api/company-trend?ticker=&window=` | GET | DOES NOT EXIST | NEW route in PR-B4 (aggregation) |

### /api/memo deep dive

The `/api/memo` route is the most complex of the existing routes. Recon detail:

- Two execution paths: `company-articles` (article-grounded prose via Gemini, when articles exist) and `company-web` (web-fallback via Exa + Gemini, when entity has no articles yet).
- Returns `{memo: <free-form Markdown prose>}`. NO structured fields. NO citation array.
- Caching: NONE on the route side. Client-side `watchlist_briefs` cache lives in Supabase, written ONLY from `/watchlist/[identifier]` server component, keyed by `identifier` (NOT canonical UUID), 12h TTL.
- V4B addendum: `buildMemoContext()` helper appends sector + role personalization for non-company memo types (thesis, watchlist, briefing). Company memos do not consume V4B.
- recordOutput integration sites: `route.ts` lines 334 (after company-articles path) and 379 (after company-web path). Both currently no-op; PR-D2 wires `after(() => recordOutput({...}))` here.
- Citation `[n]` markers: ONLY emitted on the `company-web` path. Article-grounded path returns prose without markers (C11). Side-branch `a7d41cf` has the article-grounded fix; PR-C0a re-does it.
- Structured-output assessment: Gemini supports JSON mode (`responseSchema` param). PR-C0 rewrites the prompt to request JSON conforming to the `StructuredMemo` schema. Fallback to Markdown on parse failure.

### Recommended /api/company-kpis URL pattern

PR-B2 introduces `/api/company-kpis?ticker=NVDA`. URL pattern locked at `?ticker=` (NOT `?id=` or `?slug=`) because Yahoo's quoteSummary keys on ticker globally and the route does not need DB resolution -- crumb auth + Yahoo round-trip only. Cache TTL: 60s for price, 1h for EPS/PE/float, 24h for calendar. Private companies return HTTP 404 with `body.quoteSummary.error.code === "Not Found"` -- handled with "Private" badge + reason text.

### Recommended /api/company-trend URL pattern

PR-B4 introduces `/api/company-trend?ticker=NVDA&window=30d`. URL pattern keyed on ticker for parity with KPIs route. `window` param accepts `7d`, `30d`, `90d`. Aggregates from `articles` table joined on `company_mentions`. Cache TTL: 15min via Vercel runtime cache (Vercel runtime-cache MCP guidance applies).

## 5. Phase 4 -- Yahoo quoteSummary capabilities

Phase 4 probed Yahoo Finance API endpoints for KPI sourcing. The findings drive PR-B2 entirely and inform WD20 (KPI cluster expansion).

### Endpoint summary

| Endpoint | Method | Auth | Status |
|---|---|---|---|
| v10 quoteSummary | GET | crumb auth (cookie + getcrumb roundtrip) | WORKS |
| v11 quoteSummary | GET | (rumored) | DOES NOT EXIST |
| v8 chart | GET | keyless | WORKS |

v10 requires a 2-step auth: (1) GET https://fc.yahoo.com to receive cookie; (2) GET https://query1.finance.yahoo.com/v1/test/getcrumb with cookie to receive crumb token; (3) include crumb on subsequent v10 requests. Crumb expires every ~1 hour. PR-B2 ships `crumbAuth.ts` with 1h cache.

### Per-ticker per-module probe results

Tested 4 tickers (AAPL, BRK-B, MSFT, NVDA) across 9 modules each:

| Ticker | price | summaryDetail | defaultKeyStatistics | financialData | earningsHistory | calendarEvents | recommendationTrend | majorHoldersBreakdown | upgradeDowngradeHistory |
|---|---|---|---|---|---|---|---|---|---|
| AAPL | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| BRK-B | OK | OK | OK | OK | OK | PARTIAL | OK | OK | OK |
| MSFT | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| NVDA | OK | OK | OK | OK | OK | OK | OK | OK | OK |

BRK-B `calendarEvents` is partial (no earnings date returned for B-class shares; A-class returns full).

### KPI field mapping (with corrections)

The DirectionD KPI strip has 15 fields. Initial mapping had 2 errors that were corrected during recon:

| KPI field | CORRECT path | (Common error) |
|---|---|---|
| Last price | `price.regularMarketPrice.raw` | n/a |
| Change | `price.regularMarketChange.raw` | n/a |
| Market cap | `summaryDetail.marketCap.raw` | n/a |
| Float shares | `defaultKeyStatistics.floatShares.raw` | (NOT `summaryDetail.floatShares` -- doesn't exist there) |
| PE trailing | `summaryDetail.trailingPE.raw` | n/a |
| PE forward | `summaryDetail.forwardPE.raw` | n/a |
| EPS trailing | `defaultKeyStatistics.trailingEps.raw` | n/a |
| EPS forward | `defaultKeyStatistics.forwardEps.raw` | n/a |
| 52w high | `summaryDetail.fiftyTwoWeekHigh.raw` | n/a |
| 52w low | `summaryDetail.fiftyTwoWeekLow.raw` | n/a |
| Volume | `price.regularMarketVolume.raw` | n/a |
| Avg volume | `summaryDetail.averageDailyVolume3Month.raw` | n/a |
| Target price | `financialData.targetMeanPrice.raw` | n/a |
| Earnings date | `calendarEvents.earnings.earningsDate[0].raw` | n/a |
| Prior earnings | `earningsHistory.history[LAST].quarter.raw` | (NOT `[0]` -- array is oldest-first) |

Two corrections: (1) floatShares is in `defaultKeyStatistics`, not `summaryDetail`; (2) `earningsHistory.history` is oldest-first so prior-quarter is the LAST element, not the first.

### Private-company behavior

Private companies (e.g. Stripe, Pershing Square) return HTTP 404 with body:

```json
{
  "quoteSummary": {
    "result": null,
    "error": { "code": "Not Found", "description": "Quote not found for ticker symbol: <X>" }
  }
}
```

PR-B2 detects this shape and renders "Private" badge in B8 smoke-test row + 404 reason text in error path.

### Module reliability classification

| Module | Reliability | Notes |
|---|---|---|
| price | HIGH | Always present on listed tickers; 60s cache safe |
| summaryDetail | HIGH | Most-used module; 1h cache OK |
| defaultKeyStatistics | HIGH | Float / EPS lives here; 1h cache OK |
| financialData | MEDIUM | Target price field can be null on small caps |
| earningsHistory | MEDIUM | LAST element pattern (not first) easy to get wrong |
| calendarEvents | MEDIUM | BRK-B partial; private = 404 |
| recommendationTrend | LOW | Not in Phase 1 KPI strip; candidate for V1.5+ (WD20) |
| majorHoldersBreakdown | LOW | Not in Phase 1 KPI strip |
| upgradeDowngradeHistory | LOW | Not in Phase 1 KPI strip |

### Performance

Aggregate p50 ~270ms across 12 cold composite calls (9 modules each). p95 ~550ms. With 1h crumb-auth cache + 1h KPI cache, warm-path latency is ~30ms (DB cache hit only, no Yahoo round-trip).

### Recommended cache TTLs

| Field group | TTL | Rationale |
|---|---|---|
| Last price, change, volume | 60s | Live during market hours |
| EPS, PE, float | 1h | Quarterly cadence; intra-day stable |
| 52w high/low, target | 1h | Daily-rolling fields, hourly cache acceptable |
| Earnings date, calendar | 24h | Quarterly cadence |
| Crumb token | 1h | Yahoo expiration window |

## 6. Phase 5 -- Primitive porting plan + token mapping

Phase 5 audited Direction D primitives (`docs/primitives (1).jsx`) against the existing `src/components/ui/` directory and produced KEEP / PORT / EXCLUDE decisions. Detailed in `docs/w2-c-phase-1-primitives-audit.md`; summary here.

### Per-primitive decisions

| Direction D primitive | Decision | Target path |
|---|---|---|
| SentimentPill | KEEP existing + EXTEND | `src/components/ui/sentiment-pill.tsx` (add `xs` and `lg` size variants -- 2 LOC) |
| Wordmark | KEEP existing | `src/components/ui/wordmark.tsx` (no change; DirectionD 18px == existing `sm`) |
| Delta | PORT | inline first in PR-A2; promote to `src/components/ui/delta.tsx` after 3 callers (PR-E2 lands the third site) |
| Cite + CitedText | PORT | `src/components/memo/CitedText.tsx` (sibling of memo components, NOT in `ui/`) |
| Sparkline | PORT | `src/components/trend/Sparkline.tsx` (trend family) |
| MiniBars | PORT | `src/components/trend/MiniBars.tsx` (trend family) |
| SentimentHeat | PORT | `src/components/trend/SentimentHeat.tsx` (trend family) |
| Eyebrow | EXCLUDE | trivial styling helper; inline as Tailwind class string |
| PhoneBezel | EXCLUDE | mockup chrome only |
| AnnoPin | EXCLUDE | annotation pin for design-doc inline notes |

### Existing primitives summary

| Primitive | Path | Usage count | Phase 1 disposition |
|---|---|---|---|
| Button | `src/components/ui/button.tsx` | 30 | KEEP |
| Badge | `src/components/ui/badge.tsx` | 20 | KEEP |
| Card | `src/components/ui/card.tsx` | 6 | KEEP |
| Input | `src/components/ui/input.tsx` | 11 | KEEP |
| Table | `src/components/ui/table.tsx` | 5 | KEEP |
| Skeleton | `src/components/ui/skeleton.tsx` | 59 | KEEP (highest usage) |
| EmptyState | `src/components/ui/empty-state.tsx` | 16 | KEEP |
| Tooltip | `src/components/ui/tooltip.tsx` | 11 | KEEP |
| BookmarkButton | `src/components/ui/bookmark.tsx` | 6 | KEEP |
| Logo | `src/components/ui/logo.tsx` | 5 | KEEP |
| Wordmark | `src/components/ui/wordmark.tsx` | 8 | KEEP |
| SentimentPill | `src/components/ui/sentiment-pill.tsx` | 7 | KEEP + EXTEND xs / lg sizes |
| AnimatedNumber | `src/components/ui/animated-number.tsx` | 4 | KEEP |

Total existing primitives: 13 components.

### Token mapping (Direction D vs existing)

Comparing `docs/DirectionD.jsx` lines 13-40 against `src/styles/tokens.css`:

| Direction D | Existing | Status | Notes |
|---|---|---|---|
| `D.cream` (#F5EFE3) | `--cream` | DIFFERENT | Direction D shifts cream warmer |
| `D.gold` (#C9A55C) | `--gold` | DIFFERENT | new gold is slightly desaturated |
| `D.goldDark` (#8E6F2A) | `--gold-dark` | DIFFERENT | darker swing |
| `D.goldFaint` | `--gold-muted` | DIFFERENT | naming + value drift |
| `D.goldBorder` | `--gold-border` | DIFFERENT | alpha differs |
| `D.border` | `--border-base` | DIFFERENT | hue shift |
| `D.borderHi` | (missing) | NET-NEW | hover/focus border tier |
| `D.rowHover` | (missing) | NET-NEW | table row hover background |
| `D.rowAlt` | (missing) | NET-NEW | zebra-stripe alt row |
| `D.rowActive` | (missing) | NET-NEW | active row background |
| `D.purple` | (missing) | NET-NEW | web-fallback `[w1]` citation tone |

Total: 6 differences + 5 net-new = 11 token deltas. PR-A0 (~25 LOC) ships the swap.

### Font confirmation

Direction D specifies three font families:
- `--font-sans` -> Inter (body text, UI labels)
- `--font-mono` -> JetBrains Mono (ticker chips, code, micro-labels)
- `--font-display` -> Playfair Display (h1, MemoCard headings)

All three are already loaded via `next/font` in the existing layout. No font additions needed.

### Recharts confirmation

`recharts` is NOT in `package.json` dependencies. Pure-SVG ports for Sparkline / MiniBars / SentimentHeat are correct. PR-E2 ships ~150 LOC of pure SVG + TypeScript -- no recharts dependency added.

### Recommended file structure

```
src/components/
  ui/
    button.tsx               (existing)
    badge.tsx                (existing)
    sentiment-pill.tsx       (existing + EXTEND xs/lg)
    delta.tsx                (PORT, PR-E2 promotion)
    skeleton.tsx             (existing -- reuse for loading)
  company/
    CompanyDetailLayout.tsx  (NEW, PR-A2)
    CompanyDetailHeader.tsx  (NEW, PR-A1)
    CompanyDetailTabs.tsx    (NEW, PR-A2)
    CompanyAliasRibbon.tsx   (NEW, PR-A1)
    KPIStrip.tsx             (NEW, PR-A2)
    ThemesCard.tsx           (NEW, PR-B3)
    TrendCard.tsx            (NEW, PR-B4)
    tabs/
      BriefTab.tsx           (NEW, PR-C1)
      ArticlesTab.tsx        (NEW, PR-C2)
      ThemesTab.tsx          (NEW, PR-C3)
      TrendTab.tsx           (NEW, PR-C4)
      SourcesTab.tsx         (NEW, PR-C5)
      ComingSoonTab.tsx      (NEW, PR-D1)
    states/
      EmptyState.tsx         (NEW, PR-E1)
      WebFallbackState.tsx   (NEW, PR-E2)
      LoadingState.tsx       (NEW, PR-E3)
  memo/
    MemoModal.tsx            (existing -- LUCAS-PROTECTED)
    CitedText.tsx            (NEW, PR-C1 / primitive PORT)
  trend/
    Sparkline.tsx            (NEW, PR-E2 / primitive PORT)
    MiniBars.tsx             (NEW, PR-E2 / primitive PORT)
    SentimentHeat.tsx        (NEW, PR-E2 / primitive PORT)
  sources/
    SourcesStrip.tsx         (NEW, PR-C5)

src/lib/
  data-access/
    getCompanyDetail.ts      (NEW, PR-A3)
    aliasResolver.ts         (NEW, PR-B0)
    deriveThemes.ts          (NEW, PR-B3)
    aggregateTrend.ts        (NEW, PR-B4)
    types.ts                 (NEW, PR-A3)
    __fixtures__/
      company-detail.ts      (NEW, PR-A3)
  yahoo/
    crumbAuth.ts             (NEW, PR-B2)
    quoteSummary.ts          (NEW, PR-B2)
  memo/
    writeStructuredMemo.ts   (NEW, PR-C0)
    citationParity.ts        (NEW, PR-C0a)
    prompts/
      structured.ts          (NEW, PR-C0 + PR-C0a)
    types.ts                 (NEW, PR-C0)
  observability/
    recordOutput.ts          (NEW, PR-D2)
  sources/
    tierMap.ts               (NEW, PR-C5)

src/hooks/
  useCompanyTabState.ts      (NEW, PR-A2)

src/app/
  api/
    company-kpis/
      route.ts               (NEW, PR-B2)
    company-trend/
      route.ts               (NEW, PR-B4)
    memo/
      route.ts               (existing -- EXTEND PR-D2)

src/styles/
  tokens.css                 (existing -- UPDATE PR-A0)
```

### Tokens-to-add list (PR-A0 scope)

```css
/* PR-A0 additions to src/styles/tokens.css */
:root {
  --border-hi: <D.borderHi value>;
  --row-hover: <D.rowHover value>;
  --row-alt: <D.rowAlt value>;
  --row-active: <D.rowActive value>;
  --purple: <D.purple value>;

  --gold: <D.gold updated value>;
  --gold-dark: <D.goldDark updated value>;
  --cream: <D.cream updated value>;
  --gold-muted: <D.goldFaint updated value>;
  --gold-border: <D.goldBorder updated value>;
  --border-base: <D.border updated value>;
}
```

PR-A0 is the visual regression baseline locked for all subsequent PRs. Verify with full-route Playwright sweep on `/morning-brief`, `/evening-wrap`, `/dashboard`, `/company`, `/trends` before merging.

## 7. Cross-cutting -- Lucas-protected boundary

Five files are off-limits in every Phase 1 build PR. Each PR's self-review subagent must enumerate these explicitly and confirm the diff touches none of them.

### Lucas-protected file list

| Path | Role | Why protected | What sub-PRs work AROUND it |
|---|---|---|---|
| `src/lib/watchlist-utils.ts` | useRef sync lock + Patch L coalesce contract | Smoke-test R4 KNOWN-FAIL anchored on this; ownership conflict noted in WD08 | PR-A1 (+ Watchlist button uses existing api hook only; do NOT import) |
| `src/components/watchlist/WatchlistAddInput.tsx` | submitting flag gating silent-coalesce contract | WD08 ownership conflict | PR-A1 reuses BookmarkButton primitive (sibling, NOT this file) |
| `src/app/trends/page.tsx` | Trends page render path | Not Phase 1 surface | PR-E2 builds `src/components/trend/*` (different folder); does NOT touch app route |
| `src/app/api/briefing/route.ts` | Morning brief API | Not Phase 1 surface; do NOT confuse with `/api/memo/route.ts` | PR-C0 + PR-D2 modify `/api/memo` (separate file); explicit scope-check required |
| `src/components/memo/MemoModal.tsx` | Shared memo modal, 17 callers | Touched by 17 sites; coordination cost too high for Phase 1 | PR-C0 builds NEW `BriefTab` with structured rendering; modal stays untouched |

### Self-review scope-check requirement

Every Phase 1 build PR's self-review subagent must produce an explicit "Lucas-protected scope-check" line:

```
Lucas-protected scope-check:
- src/lib/watchlist-utils.ts                 -- NOT TOUCHED (verified via git diff)
- src/components/watchlist/WatchlistAddInput.tsx -- NOT TOUCHED
- src/app/trends/page.tsx                    -- NOT TOUCHED
- src/app/api/briefing/route.ts              -- NOT TOUCHED
- src/components/memo/MemoModal.tsx          -- NOT TOUCHED
```

There is no exception in Phase 1. PRs that touch any protected file FAIL self-review.

## 8. Cross-cutting -- Substrate hooks

The substrate Step 3 (output capture) ships in PR-D2. The schema decision and integration pattern are LOCKED below.

### output_log_v0_stub schema decision

Decision #4 from `docs/w2-c-phase-1-build-pr-specs.md` Section 6: PR-D2 writes to the existing `outputs` table (NOT a new `memo_outputs` table). The `output_type_enum` already includes `company_memo` value (one of 12 enum values per Q12 above). Schema migration for canonical lock-in is deferred to WD21 (`output_log canonical schema lock-in`, complexity M, blocks WD22 dashboard).

If WD21 introduces a renamed table (e.g. `output_log` replacing `outputs`), PR-D2's writer is straightforward to repoint -- single import + insert target change.

### Integration points

`/api/memo/route.ts` lines:
- 334 (after company-articles path returns)
- 379 (after company-web path returns)

Both call sites currently no-op. PR-D2 wires each:

```ts
// after the response is returned
after(() => recordOutput({
  kind: 'company_memo',
  key: `${companyId}:${variant}`,  // e.g. "uuid:articles" or "uuid:web"
  payload: { memoText, citations, model, latencyMs },
  latencyMs
}));
```

### Pattern A vs Pattern B (LOCKED -- Pattern A)

| Pattern | Description | Trade-off |
|---|---|---|
| Pattern A (LOCKED) | `after(() => recordOutput(...))` post-response | Does not block response; row appears in `outputs` within ~1-2s |
| Pattern B | inline before response with try/finally | Blocks response by 30-50ms; guaranteed row before client receives memo |

Default chosen: Pattern A. Rationale:
1. Memo response latency is already on the user's critical path (Gemini cold call ~3-8s); adding 30-50ms for synchronous insert is a regression.
2. `after()` is the Next.js-idiomatic pattern for fire-and-forget side effects (Vercel functions skill confirms).
3. If outputs table writes drop (observed via WD22 dashboard), we switch to Pattern B by changing one wrapper line.

Switch criteria: if dashboard observability shows > 1 percent dropped writes from Pattern A in the first 1000 memo invocations post-ship.

## 9. Recon delta from Phase 9 sequencing

### How recon findings drove the 21-PR sequence

The original Phase 9 plan called for 22 PRs in a single-frame sequence. The recon synthesis cut to 21 unique PR IDs (the PR-A3 entry was reused for both the data-access layer in build-pr-specs.md and the Playwright config in component-map.md -- naming collision resolved by treating component-map's PR-A3 as a no-op cross-reference). LOC budget held at ~3963 across the 21 PRs.

The recon findings drove three sequencing changes from the original plan:

1. PR-A0 token swap moved to FIRST (was originally interleaved with A1/A2/A3). Reason: the axe-baseline 60-node color-contrast cluster (axe-baseline-2026-05-07.md) is dominated by legacy palette usage. Locking the visual baseline first avoids re-running axe per-PR on stale palette tokens.

2. PR-C0a (citation parity) added as a parallel sibling of PR-C0 (was originally a single PR-C0 spec covering both structured output and citation parity). Reason: the side-branch `a7d41cf` already has the citation fix; porting it cleanly (PR-C0a) is independent of the Gemini JSON mode rewrite (PR-C0) -- merging them into one PR added merge-conflict risk on `prompts/structured.ts`.

3. PR-D2 (recordOutput) decoupled from the UI dependency tree entirely. Reason: substrate hooks are independent of the visual surface; PR-D2 can ship any time after main has the route-handler integration sites.

### PR-to-finding gating

Which PRs are gated on which findings:

| PR | Gated on |
|---|---|
| PR-A0 | C5 (palette delta) |
| PR-A1 | C5 (token baseline) -- depends on PR-A0 |
| PR-A2 | C3 (no detail API; PR-A2 is the layout that consumes new data layer) |
| PR-A3 | C3 (no detail API today) |
| PR-B0 | C4 (alias rollup broken) |
| PR-B1 | C5 + C6 (token + sector empty placeholder) |
| PR-B2 | C12 (Yahoo crumb auth) |
| PR-B3 | C9 (key_themes label-only) |
| PR-B4 | C10 (sentiment_trend scalar) |
| PR-C0 | C1 (no structured cache) |
| PR-C0a | C11 (no `[n]` markers on article path) |
| PR-C1 | C1 + C2 (cache + persistence) |
| PR-C2 | C7 (deal_type over-fires; UI surface only, no data fix) |
| PR-C3 | C9 (themes derivation) |
| PR-C4 | none (depends on PR #196) |
| PR-C5 | C8 (no source tier classification) |
| PR-D1 | none (Coming Soon UI only) |
| PR-D2 | C2 + C14 (memo persistence + recordOutput SDK missing) |
| PR-E1 | C13 (zero-day pipeline behavior surfaces empty state) |
| PR-E2 | C4 (alias rollup) + Pershing typo case |
| PR-E3 | none (Loading state UI only) |

15 of 21 PRs are gated on a critical finding. The 6 ungated PRs (PR-C2, PR-C4, PR-D1, PR-E3, plus PR-A0 and PR-A2 which are visual-baseline gated rather than finding-gated) handle UI surface work that recon did not block.

### Smoke-test row coverage

The 180 smoke-test rows in `docs/w2-c-phase-1-smoke-test-recipe.md` map to sub-PRs as follows (per component-map.md Section "Sub-PR coverage matrix"):

| Sub-PR | P0 row count | P1 row count |
|---|---|---|
| PR-A0 | 0 (T11 trigger only) | 0 |
| PR-A1 | 9 | 11 |
| PR-A2 | 4 | 7 |
| PR-A3 | 0 | 0 (config-only) |
| PR-B1 | 6 | 6 |
| PR-B2 | 1 | 2 |
| PR-C0 | 0 (gating-only) | 0 |
| PR-C1 | 6 | 2 |
| PR-D1 | 4 | 8 |
| PR-D2 | 4 | 3 |
| PR-E1 | 1 | 5 |
| PR-E2 | 4 | 3 |
| PR-F1 | 2 | 5 |
| PR-G1 | 2 | 5 |
| PR-G2 | 0 (KNOWN-DEFERRED) | 0 |
| PR-H1 | 2 | 1 |

Total assigned: P0 = 45 rows, P1 = 58 rows. Unassigned: cross-cutting M (regression), N (a11y), O (mobile), P (perf), Q (data integrity), R (race), S (cross-browser) -- gated on per-PR self-review or pre-Phase-1 verification.

### KNOWN-FAIL and KNOWN-DEFERRED inventory

Recon surfaced specific smoke-test rows that are intentionally accepted as failing or gated:

| Row | Status | Reason |
|---|---|---|
| O6 | KNOWN-FAIL | Search input height 36 (sub-44 tap target); WD10 |
| O7 | KNOWN-FAIL | Watchlist star 21x21; WD10 |
| R4 | KNOWN-FAIL | Watchlist coalesce contract anchored on Lucas-protected file; no Phase 1 fix |
| J1-J9 | KNOWN-DEFERRED | Web-fallback frame all 9 rows gated on alias seed (Pershing / Microsoft typos not in `aliases` table per 2026-05-05 verify) |
| T1 | KNOWN-FIX | Axe ceiling corrected from "27" to `<= 18 rule-route occurrences` per axe-baseline addendum |

### W2-D follow-up gating

The 29 W2-D backlog items (`docs/w2-d-backlog.md`) split by recon dependency:

- WD01-WD06 (data integrity + ADR alias): gated on Patch P live (WD01) + manual review (WD02). Phase 1 ships query-time alias resolver (PR-B0) as the workaround.
- WD07-WD10 (UI quality): independent of Phase 1; ship any time post-Phase-1.
- WD11 (notify-me subscription): gated on new `entity_subscription` DDL; Phase 1 ships disabled-with-tooltip CTA (PR-G1 / smoke I5).
- WD12-WD16 (observability + cost): gated on web-fallback infra; Phase 1 reuses PR #176 logic.
- WD17-WD20 (V1.5+ extensions): post-Phase-1 features.
- WD21-WD22 (substrate): WD21 locks canonical schema if PR-D2's `outputs` writer needs migration.
- WD23-WD29 (code hygiene): independent; ship any time.

Phase 1 build PRs are explicitly NOT blocked on any W2-D item -- the workarounds (query-time resolver, hard-coded tier map, derivation helpers, disabled-with-tooltip CTAs) are sufficient for Phase 1 ship. W2-D items pick up the structural fixes once Phase 1 surface is locked.

## Appendix A -- Quick reference matrix

The 15 critical findings mapped to sub-PR + W2-D backlog item:

| Finding | Severity | Phase 1 PR | W2-D follow-up |
|---|---|---|---|
| C1 -- no structured memo cache | HIGH | PR-C0 + PR-C1 | -- |
| C2 -- /api/memo doesn't persist | HIGH | PR-D2 | WD21 |
| C3 -- /api/companies/[id] missing | MEDIUM | PR-A3 | -- |
| C4 -- alias canonical-rollup broken | HIGH | PR-B0 | WD03/WD04/WD05/WD06 |
| C5 -- palette delta | MEDIUM | PR-A0 | -- |
| C6 -- sector/desc/notes empty | LOW | PR-B1 placeholder | WD25 |
| C7 -- deal_type over-fires | MEDIUM | (UI tolerates) | candidate addition |
| C8 -- no source tier classification | MEDIUM | PR-C5 hard-coded | -- |
| C9 -- key_themes label-only | MEDIUM | PR-B3 + PR-C3 | -- |
| C10 -- sentiment_trend scalar | MEDIUM | PR-B4 | -- |
| C11 -- article-path no [n] markers | MEDIUM | PR-C0a | -- |
| C12 -- Yahoo crumb auth | HIGH | PR-B2 | -- |
| C13 -- pipeline cycle behind | LOW | (UI tolerates) | -- |
| C14 -- recordOutput missing | MEDIUM | PR-D2 | WD21 |
| C15 -- CompanyIntelMemoModal dead code | LOW | (deferred cleanup) | candidate addition |

## Appendix B -- Document inventory checklist

Every Phase 1 reference document and its role:

| Document | Role | Lines |
|---|---|---|
| `docs/w2-c-phase-1-recon-synthesis.md` | THIS DOC -- single entry-point | this file |
| `docs/w2-c-phase-1-build-pr-specs.md` | per-PR specs (21 sub-PRs) | 541 |
| `docs/w2-c-phase-1-component-map.md` | DirectionD -> testid -> PR map | 190 |
| `docs/w2-c-phase-1-primitives-audit.md` | KEEP/PORT/EXCLUDE per primitive | 79 |
| `docs/w2-c-phase-1-smoke-test-recipe.md` | 180 smoke-test rows | (large) |
| `docs/axe-baseline-2026-05-07.md` | axe baseline + T1 ceiling correction | 188 |
| `docs/w2-d-backlog.md` | 29 follow-up items | 64 |
| `docs/DirectionD.jsx` | visual spec | 1493 |
| `docs/data (1).jsx` | shared data shapes | 350+ |
| `docs/primitives (1).jsx` | Direction D primitives | 200+ |

This synthesis cross-references all 10 documents above.

## Appendix D -- Detailed sub-PR cross-reference

This appendix expands the recon-to-PR linkage with the implementation steps and self-review checks per sub-PR. Source of truth is `docs/w2-c-phase-1-build-pr-specs.md` Section 3; this appendix flattens the 21 specs against the recon findings.

### PR-A0 detail

- Branch: `noah/pr-a0-tokens-direction-d`
- LOC: ~25
- Recon driver: C5 (palette delta).
- Files touched: `src/styles/tokens.css`.
- Steps:
  1. Read `src/styles/tokens.css` and DirectionD.jsx lines 13-40.
  2. Add 5 net-new tokens (`--border-hi`, `--row-hover`, `--row-alt`, `--row-active`, `--purple`).
  3. Update 6 existing tokens (`--gold`, `--gold-dark`, `--cream`, `--gold-muted`, `--gold-border`, `--border-base`).
  4. Verify `tsc` + `next build` clean.
  5. Push DRAFT PR with full-route Playwright sweep on 5 routes.
- Self-review: tsc clean, em-dash count 0, LOC <= 30, 9 routes screenshot-diffd, no Lucas files touched.

### PR-A1 detail

- Branch: `noah/pr-a1-primitives`
- LOC: ~250
- Recon driver: C5 (token-dependent primitives ride PR-A0 baseline) + Phase 5 port plan.
- Files touched: 7 new files in `src/components/ui/` plus 1 extension of `SentimentPill`.
- Steps:
  1. Read `docs/primitives (1).jsx` for shape; check existing `SentimentPill` for current variants.
  2. Create 7 primitive files under `src/components/ui/`, each <= 50 LOC, no business logic.
  3. Extend `SentimentPill` with `size?: "xs"|"sm"|"lg"` prop (default "sm" preserves current behavior).
  4. Add Storybook-style usage examples in JSDoc; ensure all primitives accept `data-testid` passthrough.
  5. Verify `tsc` + `eslint` + `next build` clean; push DRAFT PR.
- Self-review: tsc / eslint / em-dash 0 / LOC <= 270 / Lucas check / 10 data-testids present.

### PR-A2 detail

- Branch: `noah/pr-a2-tab-scaffold`
- LOC: ~320
- Recon driver: C3 (no detail API; A2 is the layout that consumes new data layer).
- Files touched: `CompanyDetailLayout`, `CompanyDetailTabs`, `useCompanyTabState`, `app/company/[id]/page.tsx`.
- Steps:
  1. Read DirectionD.jsx Detail + FunctionTabs blocks.
  2. Build `CompanyDetailLayout` with header / KPI / tabs / right-rail / footer slots (slot pattern, content empty in this PR).
  3. Build `CompanyDetailTabs` with 7 tabs; ARIA `role="tablist"` + `tab` + `tabpanel`; arrow-key + Home/End navigation.
  4. Add `useCompanyTabState()` hook syncing active tab to URL hash (`#brief`, `#articles`, etc.); preserves on reload.
  5. Verify a11y baseline preserved (rerun axe; no new violations); push DRAFT PR.
- Self-review: tsc / eslint / em-dash 0 / LOC <= 350 / Lucas check / axe-baseline diff 0 / focus ring visible.

### PR-A3 detail

- Branch: `noah/pr-a3-data-access`
- LOC: ~180
- Recon driver: C3 (no detail API today).
- Files touched: `src/lib/data-access/getCompanyDetail.ts`, `types.ts`, `__fixtures__/company-detail.ts`.
- Steps:
  1. Read DirectionD.jsx data shapes (`window.NVIDIA`, `window.PERSHING`, `window.DIRECTORY`); read `docs/data (1).jsx`.
  2. Define `CompanyDetail` type: `{ company, kpis, themes, trend, articles, sources, memo, aliases }`.
  3. Implement `getCompanyDetail(idOrTicker: string): Promise<CompanyDetail | null>` with single Supabase round-trip.
  4. Add fixture for tests/preview; align fixture shape to DirectionD `N` constant.
  5. Verify tsc + lint; push DRAFT PR.
- Self-review: tsc / eslint / em-dash 0 / LOC <= 200 / no business logic in component layer / fixture matches type.

### PR-B0 detail

- Branch: `noah/pr-b0-alias-rollup`
- LOC: ~100
- Recon driver: C4 (alias rollup broken; 6 NVDA rows).
- Files touched: `src/lib/data-access/getCompanyDetail.ts` (extend), `aliasResolver.ts` (new).
- Steps:
  1. Query Supabase to confirm 6 NVDA rows; map alias -> canonical relation.
  2. Implement `aliasResolver.ts`: `WHERE ticker = ?` synthesizer that prefers row with `is_canonical = true` else most-recent `created_at`.
  3. Wire resolver into `getCompanyDetail` + `getDirectoryRows` (read-only refactor; no schema mutation).
  4. Add unit-style fixture covering NVDA collapse + Pershing typo case.
  5. Verify tsc + manual diff against directory page; push DRAFT PR.
- Self-review: tsc / eslint / em-dash 0 / LOC <= 110 / no migration / NVDA rows collapse to 1 in dev.

### PR-B1 detail

- Branch: `noah/pr-b1-detail-header`
- LOC: ~220
- Recon driver: C5 (token baseline) + C6 (sector empty placeholder).
- Files touched: `CompanyDetailHeader.tsx`, `CompanyAliasRibbon.tsx`.
- Steps:
  1. Read DirectionD CompanyHeader block; confirm chip styling reuses cream + gold-border.
  2. Build header with name + ticker + sector pill + last-updated stamp; alias ribbon collapses to "+N more" when > 3 aliases.
  3. Wire data from `CompanyDetail` prop; handle empty `sector` with placeholder dash.
  4. Add ARIA labels for alias ribbon; chips are buttons that route to canonical company page.
  5. Verify tsc + visual diff vs DirectionD; push DRAFT PR.
- Self-review: tsc / eslint / em-dash 0 / LOC <= 240 / Lucas check / 6 data-testids present / sector placeholder works.

### PR-B2 detail

- Branch: `noah/pr-b2-kpi-strip`
- LOC: ~340
- Recon driver: C12 (Yahoo crumb auth).
- Files touched: `KPIStrip.tsx`, `app/api/company-kpis/route.ts`, `lib/yahoo/crumbAuth.ts`, `quoteSummary.ts`.
- Steps:
  1. Confirm Yahoo v10 endpoint shape + crumb cookie; map all 15 KPI fields per Phase 4 mapping.
  2. Build crumb-auth helper with 1h cache; fall back to v8 chart for price-only on crumb failure.
  3. Build `/api/company-kpis` route accepting `?ticker=NVDA`; p50 target 270ms.
  4. Build `KPIStrip` (15 cells, responsive 5-col grid -> 3-col -> 2-col); private-company variant shows "Private" badge + crumb-error 404 reason.
  5. Verify tsc + manual hit NVDA + private ticker; push DRAFT PR.
- Self-review: tsc / eslint / em-dash 0 / LOC <= 360 / Lucas check / 15 data-testids / crumb-cache hit on second request / 404 graceful.

### PR-B3 detail

- Branch: `noah/pr-b3-themes-card`
- LOC: ~150
- Recon driver: C9 (key_themes label-only).
- Files touched: `ThemesCard.tsx`, `lib/data-access/deriveThemes.ts`.
- Steps:
  1. Confirm `companies.key_themes` is `text[]` (no weight/tone/count today).
  2. Implement `deriveThemes()` synthesizing weight/tone/count from article counts joined per theme keyword (in-memory, query-time).
  3. Build `ThemesCard` showing top 5 themes with horizontal bar (weight), tone color (gold/red), article count badge.
  4. Empty state: "No themes derived yet" with subdued tone.
  5. Verify tsc + visual diff; push DRAFT PR.
- Self-review: tsc / eslint / em-dash 0 / LOC <= 160 / Lucas check / 5 data-testids / empty state visible when array empty.

### PR-B4 detail

- Branch: `noah/pr-b4-trend-card`
- LOC: ~280
- Recon driver: C10 (sentiment_trend scalar).
- Files touched: `TrendCard.tsx`, `app/api/company-trend/route.ts`, `lib/data-access/aggregateTrend.ts`.
- Steps:
  1. Confirm `articles.published_at` indexed; aggregate by day for 30d.
  2. Build `aggregateTrend()` returning `{ counts: number[30], sentiments: number[30] }` from articles join.
  3. Build `/api/company-trend?ticker=NVDA&window=30d`; cache 15min via Vercel runtime cache.
  4. Build `TrendCard` composing MiniBars (counts) + Sparkline (sentiment line) + SentimentHeat (5x6 grid).
  5. Verify tsc + visual diff + cache hit on refresh; push DRAFT PR.
- Self-review: tsc / eslint / em-dash 0 / LOC <= 300 / Lucas check / 7 data-testids / cache TTL respected.

### PR-C0 detail

- Branch: `noah/pr-c0-structured-memo`
- LOC: ~200
- Recon driver: C1 (no structured memo cache).
- Files touched: `lib/memo/writeStructuredMemo.ts`, `prompts/structured.ts`, `types.ts`.
- Steps:
  1. Review existing memo prompt; identify Markdown sections to convert to JSON keys.
  2. Define `StructuredMemo` type: `{ tldr: string[], lead: string, context: string, watch: string[], citations: Citation[] }`.
  3. Rewrite prompt requesting JSON mode; add response schema for Gemini structured output.
  4. Implement `writeStructuredMemo(input)` returning typed object; preserve fallback to Markdown on parse failure.
  5. Verify tsc + smoke-test against 3 tickers (NVDA, AAPL, private); push DRAFT PR.
- Self-review: tsc / eslint / em-dash 0 / LOC <= 220 / no UI changes / fallback path tested.

### PR-C0a detail

- Branch: `noah/pr-c0a-citation-parity`
- LOC: ~80
- Recon driver: C11 (no [n] markers on article path).
- Files touched: `prompts/structured.ts` (extend), `citationParity.ts`.
- Steps:
  1. Read side-branch `a7d41cf` for `[n]` marker logic; understand fix shape.
  2. Port `[n]` marker injection: prompt instructs Gemini to emit `[1]`, `[2]` inline; output includes ordered citations array.
  3. Add `citationParity()` validator: count of `[n]` markers in body equals citations array length; logs warning if mismatch.
  4. Verify tsc; push DRAFT PR.
- Self-review: tsc / eslint / em-dash 0 / LOC <= 90 / parity warning logs in dev / no breaking change to writer signature.

### PR-C1 detail

- Branch: `noah/pr-c1-brief-tab`
- LOC: ~250
- Recon driver: C1 + C2 (cache + persistence).
- Files touched: `tabs/BriefTab.tsx`, `BriefTLDR.tsx`, `BriefLead.tsx`, `BriefContext.tsx`, `BriefWatch.tsx`.
- Steps:
  1. Read DirectionD MemoCard; map TLDR/LEAD/CONTEXT/WATCH sections.
  2. Build 4 sub-components rendering structured memo fields with `CitedText` primitive for `[n]` markers.
  3. Compose `BriefTab` reading from `CompanyDetail.memo`; loading skeleton while memo refetches.
  4. Empty state when memo absent: "Memo not yet generated -- triggers on next pipeline cycle."
  5. Verify tsc + visual diff; push DRAFT PR.
- Self-review: tsc / eslint / em-dash 0 / LOC <= 270 / Lucas check / 8 data-testids / `[n]` markers clickable.

### PR-C2 detail

- Branch: `noah/pr-c2-articles-tab`
- LOC: ~220
- Recon driver: none direct (C7 affects display but not gating).
- Files touched: `tabs/ArticlesTab.tsx`, `ArticlesTable.tsx`, `ArticlesRow.tsx`.
- Steps:
  1. Confirm articles join shape from `getCompanyDetail`; review DirectionD table styling.
  2. Build `ArticlesTable` with 5 columns: headline, source, tone (SentimentPill xs), published-at, deal-type chip.
  3. Add row hover (`--row-hover`), alt rows (`--row-alt`), active row (`--row-active`); keyboard arrow navigation.
  4. Empty state when no articles: "No coverage in last 30 days."
  5. Verify tsc + visual diff + a11y rerun; push DRAFT PR.
- Self-review: tsc / eslint / em-dash 0 / LOC <= 240 / Lucas check / 7 data-testids / arrow nav works / no axe regressions.

### PR-C3 detail

- Branch: `noah/pr-c3-themes-tab`
- LOC: ~140
- Recon driver: C9 (themes derivation reuse).
- Files touched: `tabs/ThemesTab.tsx`, `ThemesDetailRow.tsx`.
- Steps:
  1. Reuse `deriveThemes()` helper; expand to top 15 themes with sub-article list.
  2. Build `ThemesTab` with expandable rows: collapse shows label + count + tone; expand reveals associated article list + Sparkline of mention frequency.
  3. Empty state per PR-B3 pattern.
  4. Verify tsc + visual diff; push DRAFT PR.
- Self-review: tsc / eslint / em-dash 0 / LOC <= 150 / Lucas check / 5 data-testids / expand/collapse keyboard accessible.

### PR-C4 detail

- Branch: `noah/pr-c4-trend-tab`
- LOC: ~180
- Recon driver: none direct (depends on PR #196 stock chart).
- Files touched: `tabs/TrendTab.tsx`; reuse `CompanyStockChart` from PR #196.
- Steps:
  1. Verify PR #196 merged; check `CompanyStockChart` API surface.
  2. Compose `TrendTab` stacking stock chart (top), sentiment overlay (middle), heat grid (bottom); shared 30d/90d window toggle.
  3. Wire data via `/api/company-trend` from PR-B4.
  4. Verify tsc + visual diff; push DRAFT PR.
- Self-review: tsc / eslint / em-dash 0 / LOC <= 200 / Lucas check / 4 data-testids / window toggle preserves URL state.

### PR-C5 detail

- Branch: `noah/pr-c5-sources-tab`
- LOC: ~200
- Recon driver: C8 (no source tier classification).
- Files touched: `tabs/SourcesTab.tsx`, `SourcesStrip.tsx`, `lib/sources/tierMap.ts`.
- Steps:
  1. List distinct article sources for NVDA; classify into Tier 1 (Bloomberg, Reuters, FT, WSJ), Tier 2 (CNBC, Barron's), Tier 3 (rest).
  2. Implement `tierMap.ts` as hard-coded record (per C8).
  3. Build `SourcesTab` with full source list grouped by tier; `SourcesStrip` footer shows top 5 sources by article count.
  4. Empty state when no articles.
  5. Verify tsc + visual diff; push DRAFT PR.
- Self-review: tsc / eslint / em-dash 0 / LOC <= 220 / Lucas check / 5 data-testids / tier classification deterministic.

### PR-D1 detail

- Branch: `noah/pr-d1-coming-soon-tab`
- LOC: ~140
- Recon driver: none (placeholder UI).
- Files touched: `tabs/ComingSoonTab.tsx`, `ComingSoonCard.tsx`.
- Steps:
  1. Confirm F6/F7/F8/F9 labels from DirectionD (F6 Filings, F7 Insider, F8 Options, F9 Peers per design notes).
  2. Build 4 ComingSoonCard variants showing icon, title, "Coming Soon" badge, and 1-line description.
  3. Subscribe-to-updates affordance is a no-op button with tooltip "Tracking interest -- not wired yet."
  4. Verify tsc + visual diff; push DRAFT PR.
- Self-review: tsc / eslint / em-dash 0 / LOC <= 150 / Lucas check / 5 data-testids / no live data fetches.

### PR-D2 detail

- Branch: `noah/pr-d2-record-output`
- LOC: ~180
- Recon driver: C2 + C14 (memo persistence + recordOutput SDK missing).
- Files touched: `lib/observability/recordOutput.ts`, `app/api/memo/route.ts`.
- Steps:
  1. Read side-branch `a67e69c` for SDK shape; understand `after()` pattern A vs B.
  2. Implement `recordOutput({ kind, key, payload, latencyMs })` writing to `outputs` table.
  3. Extend `/api/memo` route to call `after(() => recordOutput(...))` post-response.
  4. Add small dashboard query helper for recent outputs (read-only).
  5. Verify tsc + smoke memo trigger; confirm row appears in outputs table; push DRAFT PR.
- Self-review: tsc / eslint / em-dash 0 / LOC <= 200 / no Lucas files / `after()` does not block response / row visible in table.

### PR-E1 detail

- Branch: `noah/pr-e1-empty-state`
- LOC: ~220
- Recon driver: C13 (zero-day pipeline behavior surfaces empty state).
- Files touched: `states/EmptyState.tsx`, `EmptyStateCTA.tsx`; conditional render in tab components.
- Steps:
  1. Read DirectionD EmptyState; note Stripe-style centered layout with single CTA + secondary link.
  2. Build `EmptyState` component shown when `CompanyDetail` resolves to null (unknown ticker).
  3. CTAs: "Add to watchlist" (primary), "Search directory" (secondary link).
  4. Wire conditional render at `/company/[id]/page.tsx` level.
  5. Verify tsc + visual diff + a11y rerun; push DRAFT PR.
- Self-review: tsc / eslint / em-dash 0 / LOC <= 240 / Lucas check / 4 data-testids / focus on primary CTA on mount.

### PR-E2 detail

- Branch: `noah/pr-e2-web-fallback`
- LOC: ~270
- Recon driver: C4 (alias rollup) + Pershing typo case.
- Files touched: `states/WebFallbackState.tsx`, `WebFallbackBanner.tsx`, `WebFallbackCitation.tsx`.
- Steps:
  1. Review PR #176 web-fallback derivation logic; confirm Pershing typo normalization from PR #177.
  2. Build `WebFallbackState` reusing BriefTab structure but flagging citations with `[w1]`-style markers in `--purple` token.
  3. Add `ALIAS-RESOLVED` banner component when alias resolver matched a typo (e.g. "Persing" -> "Pershing").
  4. Source list shows web URLs (no DB tier classification).
  5. Verify tsc + visual diff + manual test for PSH ticker; push DRAFT PR.
- Self-review: tsc / eslint / em-dash 0 / LOC <= 290 / Lucas check / 6 data-testids / purple citations distinct from gold.

### PR-E3 detail

- Branch: `noah/pr-e3-loading-state`
- LOC: ~140
- Recon driver: none (UI only).
- Files touched: `states/LoadingState.tsx`, `LoadingSkeleton.tsx`, `LoadingStatusChip.tsx`.
- Steps:
  1. Read DirectionD Loading; note 3-stage status chip (fetching -> parsing -> rendering).
  2. Build skeleton matching CompanyDetailLayout slot shapes.
  3. Build status chip cycling through 3 stages; respects `prefers-reduced-motion`.
  4. Wire as Suspense boundary fallback in `/company/[id]/page.tsx`.
  5. Verify tsc + visual diff + axe; push DRAFT PR.
- Self-review: tsc / eslint / em-dash 0 / LOC <= 150 / Lucas check / 4 data-testids / reduced-motion path tested.

## Appendix E -- Open decisions deferred to Noah

The recon surfaced 8 open decisions that require Noah approval before specific PR construction. Defaults are already locked into the spec; deviations require explicit greenlight.

| Decision | Default | Alternative | Trigger to revisit |
|---|---|---|---|
| C4 alias rollup approach | Query-time synthesizer (PR-B0) | Schema migration adding `is_canonical` + alias FK (W2-D) | Migration complexity exceeds query-time pattern |
| C0 prompt fork strategy | Single-prompt rewrite (PR-C0) | Two prompts (Markdown + JSON) | JSON parse rate < 95% |
| PR-D2 `after()` pattern | Pattern A (`after(() => recordOutput)`) | Pattern B (synchronous before response) | Outputs table writes drop > 1% |
| PR-A0 visual regression scope | 5 routes | 9 routes (full sweep) | Reviewer requests broader coverage |
| PR-D2 outputs table | Extend existing `outputs` | Create dedicated `memo_outputs` | Schema review surfaces collision |
| C9/C10 schema enrichment | Deferred entirely to W2-D | Phase 1 includes migration | Phase 1 build scope expands |
| PR #197 final integration timing | Single squash to main | Preserve 22-commit history | Reviewer prefers granular history |
| Yahoo crumb-auth fallback | 1h cache + v8 chart fallback | Polygon / Finnhub alternate provider | Yahoo 5xx rate > 2% |

## Appendix F -- Smoke-test category index

The 180 smoke-test rows organized by 20 functional categories. Reference into `docs/w2-c-phase-1-smoke-test-recipe.md` for full row text.

| Category | Letter | Surface | Sub-PR(s) |
|---|---|---|---|
| Header + alias ribbon | A | Frame 3 chrome | PR-A1 |
| KPI strip | B | Frame 3 KPI | PR-A2 + PR-B2 |
| Function tabs | C | Frame 3 navigation | PR-B1 |
| Brief tab | D | F1 content | PR-C0 + PR-C1 |
| Articles tab | E | F2 content | PR-D1 / PR-C2 |
| Themes tab + card | F | F3 + right rail | PR-E1 / PR-B3 + PR-C3 |
| Trend tab + card | G | F4 + right rail | PR-E2 / PR-B4 + PR-C4 |
| Sources tab + strip | H | F5 + footer | PR-F1 / PR-C5 |
| Empty state | I | Frame 7 | PR-G1 / PR-E1 |
| Web fallback | J | Frame 6 | PR-G2 / PR-E2 (deferred) |
| Loading state | K | Frame 8 | PR-H1 / PR-E3 |
| Substrate / output | L | recordOutput | PR-D2 |
| Cross-tab regression | M | global | per-PR self-review |
| Accessibility | N | global | PR-A0 baseline + per-PR rerun |
| Mobile | O | breakpoints | PR-A1 + PR-A2 responsive variants |
| Performance budget | P | global | Lighthouse CI per-PR |
| Data integrity | Q | DB invariants | pre-Phase-1 entity-resolution |
| Race conditions | R | concurrency | PR-C1 (R3) / Lucas (R4 KNOWN-FAIL) |
| Cross-browser | S | Playwright projects | PR-A3 |
| A11y baseline | T | axe ceiling | PR-A0 (T11 trigger) |

## Appendix G -- Recon execution notes

The 5-phase recon executed in parallel via subagent dispatch on 2026-05-04 -- 2026-05-05. Findings were captured in working notes and rolled forward into the derivative docs (build-pr-specs, component-map, primitives-audit, smoke-test-recipe, axe-baseline). This synthesis is the authoritative consolidation; if any derivative doc disagrees with this synthesis, this synthesis wins for cross-reference purposes (the derivative docs win for implementation detail in their domain).

Recon phases:

| Phase | Focus | Output |
|---|---|---|
| 1 | Existing detail-page code (`/company/[id]`, `MemoModal`, `CompanyIntelMemoModal`) | per-file inventory, anti-pattern list, Frame 3 element checklist |
| 2 | Data inventory (12 SQL queries against prod Supabase) | population distribution, alias rollup verification, memo cache audit |
| 3 | API inventory (7 routes + new route recommendations) | route table, /api/memo deep dive, citation marker findings |
| 4 | Yahoo quoteSummary capabilities (4 tickers x 9 modules) | endpoint reliability, KPI field corrections, performance numbers |
| 5 | Primitive porting + token mapping | KEEP/PORT/EXCLUDE table, token delta count, recommended file structure |

Total elapsed: ~6 hours wall-clock (parallel). Total LOC of working notes: ~3500 across phases. Total LOC of committed derivative docs: ~1500 (build-pr-specs 541, component-map 190, primitives-audit 79, axe-baseline 188, w2-d-backlog 64, smoke-test-recipe ~500). This synthesis adds another ~1500 LOC of consolidation.

## Appendix H -- Detailed C1-C15 mitigation walkthrough

Each critical finding maps to specific code-level mitigations. This appendix walks the implementation path from finding to merged code.

### C1 mitigation walkthrough

The Phase 0 memo writer at `src/app/api/memo/route.ts` returns `{ memo: <prose> }`. Phase 1 ships a parallel structured writer at `src/lib/memo/writeStructuredMemo.ts` that:

1. Accepts `{ companyId, articles[], context }` input.
2. Composes a Gemini prompt requesting JSON output conforming to:
   ```
   { tldr: string[], lead: string, context: string, watch: string[], citations: { n: number, source: string, url: string, headline: string }[] }
   ```
3. Calls Gemini with `responseMimeType: "application/json"` and `responseSchema` set.
4. Parses response; on parse failure, falls back to the existing Markdown writer and emits a parity warning to the observability log.
5. Returns typed `StructuredMemo` to caller.

The BriefTab at `src/components/company/tabs/BriefTab.tsx` consumes `StructuredMemo` from `getCompanyDetail().memo`. The render path:

- TLDR section: maps `memo.tldr[]` to bullet list of `<li>` elements, each rendered through `<CitedText>` to linkify any `[n]` markers.
- LEAD section: renders `memo.lead` paragraph through `<CitedText>`.
- CONTEXT section: renders `memo.context` paragraph(s) through `<CitedText>`.
- WHAT TO WATCH section: maps `memo.watch[]` to bullet list, rendered through `<CitedText>`.

If `memo` is null (no cached memo), BriefTab renders the empty state with "Generate Memo" CTA wired to `/api/memo` (PR-C1 step 4).

### C2 mitigation walkthrough

Phase 1 introduces TWO complementary persistence paths:

1. Server-side cache via `recordOutput()` (PR-D2). The `/api/memo` route handler calls `after(() => recordOutput({ kind: 'company_memo', key: companyId, payload: structuredMemo, latencyMs }))` AFTER returning the response. This writes to the `outputs` table without blocking the response.

2. Read path via `getCompanyDetail()` (PR-A3). The data-access layer queries `outputs` table for the most-recent `company_memo` row matching the canonical company ID, joining the structured payload onto the `CompanyDetail.memo` field. Cache TTL is implicit (most-recent row wins; older rows can be archived later).

The existing `watchlist_briefs` table is left as-is for the watchlist flow (Lucas-protected boundary). Phase 1 does not migrate watchlist memos to the new structure.

### C3 mitigation walkthrough

Phase 1 does NOT introduce a `/api/companies/[id]` API route. Instead, the data-access layer at `src/lib/data-access/getCompanyDetail.ts` is the canonical fetcher. Server components import it directly:

```ts
// src/app/company/[id]/page.tsx (PR-A2 wiring)
import { getCompanyDetail } from '@/lib/data-access/getCompanyDetail';

export default async function CompanyDetailPage({ params }) {
  const detail = await getCompanyDetail(params.id);
  if (!detail) return <EmptyState />;
  return <CompanyDetailLayout detail={detail} />;
}
```

The cross-route import of `fetchCompanyArticles` is replaced by `getCompanyDetail()`'s internal articles join. Future PRs can promote the fetcher to a route at `/api/companies/[id]` if a client-side caller emerges, but Phase 1 has no such caller.

### C4 mitigation walkthrough

The query-time alias resolver at `src/lib/data-access/aliasResolver.ts`:

```ts
// pseudocode
function resolveAlias(idOrTicker: string): { canonical: CompanyRow, aliases: AliasRow[] } | null {
  // Step 1: try direct UUID match
  let row = await supabase.from('companies').select().eq('id', idOrTicker).maybeSingle();
  if (row) return { canonical: row, aliases: await fetchAliases(row.id) };

  // Step 2: try ticker match with canonical preference
  const candidates = await supabase.from('companies').select().eq('ticker', idOrTicker.toUpperCase());
  if (candidates.length === 0) return null;

  // Step 3: prefer is_canonical=true; else most-recent created_at
  const canonical = candidates.find(c => c.is_canonical) ?? candidates.sort(byCreatedAt)[0];

  // Step 4: synthesize aliases from sibling rows + aliases table
  const aliases = [
    ...candidates.filter(c => c.id !== canonical.id).map(toAlias),
    ...(await fetchAliases(canonical.id))
  ];

  return { canonical, aliases };
}
```

The 6 NVDA rows (Nvidia, Nvidia Corp., NVIDIA, NVIDIA Corporation, Nvidia Corp, NVIDIA Corp.) collapse to 1 canonical with 5 aliases. Mention counts aggregate across siblings for the canonical row's display.

### C5 mitigation walkthrough

PR-A0 ships the token swap as a single-file diff to `src/styles/tokens.css`. Before/after structure:

```css
/* BEFORE (legacy palette) */
:root {
  --gold: #B8923D;
  --gold-dark: #7A5F1E;
  --cream: #F0E9D9;
  --gold-muted: rgba(184, 146, 61, 0.12);
  --gold-border: rgba(184, 146, 61, 0.30);
  --border-base: #DCD6C8;
}

/* AFTER (Direction D palette, matches DirectionD.jsx 13-40) */
:root {
  --gold: #C9A55C;
  --gold-dark: #8E6F2A;
  --cream: #F5EFE3;
  --gold-muted: rgba(201, 165, 92, 0.10);
  --gold-border: rgba(201, 165, 92, 0.35);
  --border-base: #D8D2C2;

  /* NET-NEW tokens */
  --border-hi: rgba(201, 165, 92, 0.55);
  --row-hover: rgba(201, 165, 92, 0.08);
  --row-alt: rgba(245, 239, 227, 0.5);
  --row-active: rgba(201, 165, 92, 0.18);
  --purple: #8E6FB5;
}
```

Exact hex values pending PR-A0 implementation; the structure above is illustrative. The 60-node color-contrast cluster in axe baseline is dominated by:

- `.text-signal-up` and `.text-signal-down` (signal badges)
- `.text-text-faint` (faint micro-labels)
- Gold-on-light combinations in headings
- Small uppercase pills (.uppercase.text-[9px])

PR-A0 should drop most of these because the new gold (`#C9A55C` vs `#B8923D`) has higher contrast on the new cream (`#F5EFE3` vs `#F0E9D9`). T11 captures the post-swap baseline.

### C6 mitigation walkthrough

The `companies.sector / description / notes` columns are 100% empty across 2,921 rows. Phase 1 handles this in two layers:

1. UI layer: PR-B1 CompanyDetailHeader renders an em-dash placeholder (using ASCII "--" not the unicode em-dash) when `company.sector` is empty. The subtitle reads "NASDAQ -- --" or "NASDAQ -- Technology" depending on data.

2. Data layer: WD25 (Finnhub sector backfill) is the data fix. Gated on WD01 (false-positive ticker scrub) + WD02 (manual review). When WD25 ships, the placeholder dash disappears for ~80% of tickers (Finnhub coverage).

PR-B1 includes a comment in the JSX:

```tsx
// C6: companies.sector is 100% empty across 2,921 rows.
// Placeholder dash renders until WD25 backfill ships.
{company.sector ?? '--'}
```

### C7 mitigation walkthrough

`articles.deal_type` non-null on every article in last 7d for NVIDIA. Phase 1 takes no data-side action (no classifier rewrite). UI surfaces:

- KPI strip: `events_today` field is removed from the design (was originally specced as a 7th KPI cell). The strip is locked at 6 cells: Last, Market cap, Mentions 30d, Sentiment, Articles today, Sources.
- Articles tab: filter pills include "Events" but the smoke-test E10 row notes the filter has no semantic value today (every article matches). The filter is shipped as a future-proofing UI affordance.
- The deal_type chip on each article row still renders (E1) because the value IS varied within "non-null" (Earnings vs M&A vs Funding etc.), even if "non-null" is universal.

V1.5+ candidate: re-train the deal_type classifier with a stricter schema. Not yet a W2-D item.

### C8 mitigation walkthrough

The `tierMap.ts` hard-coded record:

```ts
// src/lib/sources/tierMap.ts (PR-C5)
export const TIER_MAP: Record<string, 1 | 2 | 3> = {
  'Bloomberg': 1,
  'Reuters': 1,
  'Financial Times': 1,
  'FT.com': 1,
  'Wall Street Journal': 1,
  'WSJ': 1,
  'CNBC': 2,
  "Barron's": 2,
  'Forbes': 2,
  'TechCrunch': 2,
  'Yahoo Finance': 3,
  'Finnhub': 3,
  'Benzinga': 3,
  // default: 3 for unmapped sources
};

export function getTier(source: string): 1 | 2 | 3 {
  return TIER_MAP[source] ?? 3;
}
```

The Sources tab groups article sources by tier; SourcesStrip footer shows top 5 by article count. The map is single-file editable; future migrations to a `source_tier` table can substitute for the static map without changing call sites.

### C9 mitigation walkthrough

`deriveThemes()` synthesizes weight/tone/count from articles join:

```ts
// src/lib/data-access/deriveThemes.ts (PR-B3)
export async function deriveThemes(companyId: string): Promise<Theme[]> {
  const themes = (await getCompanyKeyThemes(companyId)) ?? [];
  if (themes.length === 0) return [];

  // For each theme, count articles whose headline/body match the theme keyword
  const articles = await getRecentArticles(companyId, '30d');

  return themes.map(label => {
    const matched = articles.filter(a => a.headline.toLowerCase().includes(label.toLowerCase()));
    const count = matched.length;
    const weight = count / Math.max(articles.length, 1);
    const sentimentSum = matched.reduce((s, a) => s + sentimentValue(a.sentiment), 0);
    const tone = sentimentSum > 0 ? 'bullish' : sentimentSum < 0 ? 'bearish' : 'neutral';
    return { label, weight, tone, count };
  }).sort((a, b) => b.count - a.count);
}
```

Top 5 themes render in the right-rail ThemesCard (PR-B3); top 15 themes render expanded in ThemesTab (PR-C3). The keyword match is naive (case-insensitive substring); a more robust matcher (stemming, synonyms) is V1.5+ work.

### C10 mitigation walkthrough

`aggregateTrend()` returns `{ counts, sentiments }` arrays:

```ts
// src/lib/data-access/aggregateTrend.ts (PR-B4)
export async function aggregateTrend(companyId: string, days: number = 30): Promise<TrendData> {
  // Generate day series
  const dayList = generateDayList(days);

  // Single SQL: articles grouped by day with sentiment values
  const rows = await supabase.rpc('aggregate_articles_by_day', { company_id: companyId, day_count: days });

  const counts: number[] = [];
  const sentiments: number[] = [];

  for (const day of dayList) {
    const dayRows = rows.filter(r => r.day === day);
    counts.push(dayRows.length);
    const avg = dayRows.length === 0 ? 0 :
      dayRows.reduce((s, r) => s + sentimentValue(r.sentiment), 0) / dayRows.length;
    sentiments.push(avg);
  }

  return { counts, sentiments };
}
```

The Q6 finding (NVIDIA 8-day sentiments `[0.88, 0.71, 0.91, 0.50, 0.79, 0.67, 0.85, 0.50]`) shows the coarse 3-input averaging biases toward middle values. This is acceptable for Phase 1 trend visualization; a per-article sentiment confidence weighting is V1.5+ work.

The TrendCard renders MiniBars (counts), Sparkline (sentiments smoothed line), SentimentHeat (5x6 grid showing sentiment intensity per day-cell). The right-rail TrendCard (PR-B4) shows the 7d view; the TrendTab (PR-C4) shows 30d/90d toggleable view.

### C11 mitigation walkthrough

The side-branch `a7d41cf` patch shape:

```ts
// src/lib/memo/prompts/structured.ts (PR-C0a port)
export const STRUCTURED_PROMPT = `
You are writing a structured memo. Emit JSON conforming to the schema.

CRITICAL: Inline citations as [1], [2], [3] markers wherever you reference an article.
The citations array must contain ONE entry per [n] marker, in order.

Article corpus:
${articles.map((a, i) => `[${i + 1}] ${a.source} -- ${a.headline} -- ${a.url}`).join('\n')}

Return JSON:
{
  "tldr": ["Bullet with [1] citation", "Another bullet [2]"],
  "lead": "Lead paragraph with [1] and [3] citations.",
  "context": "Context paragraph...",
  "watch": ["Watch item [2]"],
  "citations": [
    { "n": 1, "source": "Bloomberg", "url": "...", "headline": "..." },
    { "n": 2, "source": "Reuters", "url": "...", "headline": "..." },
    { "n": 3, "source": "WSJ", "url": "...", "headline": "..." }
  ]
}
`;
```

`citationParity()` validator:

```ts
// src/lib/memo/citationParity.ts (PR-C0a)
export function citationParity(memo: StructuredMemo): { ok: boolean; markerCount: number; citationCount: number } {
  const allText = [memo.lead, memo.context, ...memo.tldr, ...memo.watch].join(' ');
  const markerCount = (allText.match(/\[\d+\]/g) ?? []).length;
  const citationCount = memo.citations.length;
  return { ok: markerCount === citationCount, markerCount, citationCount };
}
```

The validator is called post-write; mismatches are logged but do not block the response (Phase 1 telemetry only).

### C12 mitigation walkthrough

The `crumbAuth.ts` helper:

```ts
// src/lib/yahoo/crumbAuth.ts (PR-B2)
let cachedCrumb: { value: string; expiresAt: number } | null = null;

export async function getCrumb(): Promise<string> {
  if (cachedCrumb && cachedCrumb.expiresAt > Date.now()) return cachedCrumb.value;

  // Step 1: get cookie from fc.yahoo.com
  const cookieResp = await fetch('https://fc.yahoo.com', { redirect: 'follow' });
  const setCookie = cookieResp.headers.get('set-cookie');
  if (!setCookie) throw new Error('No cookie from fc.yahoo.com');

  // Step 2: use cookie to get crumb from getcrumb endpoint
  const crumbResp = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { Cookie: setCookie }
  });
  const crumb = await crumbResp.text();

  cachedCrumb = { value: crumb, expiresAt: Date.now() + 60 * 60 * 1000 }; // 1h TTL
  return crumb;
}
```

The `quoteSummary.ts` helper composes the v10 URL with crumb param and 9 modules:

```ts
const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?` +
  `modules=price,summaryDetail,defaultKeyStatistics,financialData,earningsHistory,calendarEvents&` +
  `crumb=${crumb}`;
```

Private companies return HTTP 404 with body `{ quoteSummary: { error: { code: 'Not Found' } } }`. The KPIStrip detects this and renders the "Private" badge variant.

### C13 mitigation walkthrough

The KPI strip Articles-today and Sources-today render `0` honestly when the pipeline has not run today. No "stale" indicator is added in Phase 1. The pipeline-trace right rail (smoke-test K4) is a V1.5+ feature gated behind a feature flag; it would surface "Pipeline last ran: 8h ago" and similar stale-data hints.

Candidate W2-D addition: surface a subtle "Last ingested: <timestamp>" footer on detail pages so users can interpret zero-day KPIs.

### C14 mitigation walkthrough

The `recordOutput()` SDK:

```ts
// src/lib/observability/recordOutput.ts (PR-D2)
export async function recordOutput(input: {
  kind: keyof typeof OUTPUT_KIND;  // 12 enum values
  key: string;                       // e.g. companyId
  payload: unknown;                  // structured data
  latencyMs: number;
  error?: string;
}): Promise<void> {
  await supabaseService.from('outputs').insert({
    kind: input.kind,
    key: input.key,
    payload: input.payload,
    latency_ms: input.latencyMs,
    error: input.error ?? null,
    created_at: new Date().toISOString()
  });
}
```

The `/api/memo/route.ts` integration:

```ts
import { after } from 'next/server';
import { recordOutput } from '@/lib/observability/recordOutput';

export async function POST(request: Request) {
  const start = Date.now();
  // ... existing memo logic ...
  const memoText = await writeStructuredMemo(...);
  const response = NextResponse.json({ memo: memoText });

  after(() => recordOutput({
    kind: 'company_memo',
    key: companyId,
    payload: { memoText, model: 'gemini-2.0', variant: pathTaken },
    latencyMs: Date.now() - start
  }));

  return response;
}
```

WD21 locks in the canonical schema if the `outputs` v0_stub needed migration; PR-D2 writes to the existing table either way.

### C15 mitigation walkthrough

`CompanyIntelMemoModal.tsx` (746 LOC) deletion is deferred. Phase 1 PR-A2 explicitly does NOT modify or delete the file. A cleanup PR (post-Phase-1, candidate W2-D addition) will:

1. Verify zero callers via grep (`grep -r "CompanyIntelMemoModal" src/`).
2. Remove the file.
3. Remove the export from `src/components/company/index.ts` (if present).
4. Run `tsc` + `eslint` + visual regression to confirm no regressions.

The deletion is a single PR; bundling it into Phase 1 build PRs would add noise to the diff review.

## Appendix C -- Glossary

| Term | Definition |
|---|---|
| C1-C15 | The 15 critical findings catalogued in Section 1 |
| Direction D | The locked visual design direction (replaced Direction A/B/C) |
| Frame 3 | Desktop happy-path detail page (NVIDIA test row) |
| Frame 4 | Mobile detail page (DetailMobile component) |
| Frame 6 | Web-fallback detail page (Pershing typo test case) |
| Frame 7 | Empty state (Stripe / private companies) |
| Frame 8 | Loading state (skeleton + status chip) |
| F1-F9 | Function tabs (Brief / Articles / Themes / Trend / Sources / 4x ComingSoon) |
| Lucas-protected | The 5 files Phase 1 cannot modify |
| MemoCard | DirectionD MemoCard component (Brief tab content shape) |
| Pattern A | `after(() => recordOutput(...))` post-response (LOCKED for PR-D2) |
| Pattern B | inline `try/finally` synchronous output_id (rejected default) |
| PR-A0 ... PR-E3 | The 21 sub-PRs in the Phase 1 build sequence |
| Recon | The 5-phase parallel investigation that produced this synthesis |
| Substrate | The output capture / observability infrastructure (Step 3 / outputs table) |
| Sub-PR | A PR off `noah/w2-c-phase-1` integration branch (not directly to main) |
| Smoke-test | The 180-row recipe walked after each sub-PR ships |
| W2-C | Workstream 2-C: company detail page redesign |
| W2-D | Workstream 2-D: follow-ups deferred from W2-C Phase 1 |
| WD01-WD29 | The 29 W2-D backlog items |
