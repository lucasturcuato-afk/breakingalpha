# Signalera Handoff

## Current Status (2026-04-20)
- Live at https://breakingalpha.vercel.app (deploying as Signalera)
- Full rebrand from BreakingAlpha to Signalera shipped — logo, fonts, theme, auth page
- Auth middleware protecting all routes — unauthenticated users redirect to /auth
- Google OAuth (PKCE flow) working — callback at /auth/callback
- Per-session user isolation fixed — greeting, sidebar, settings all read from live auth
- **Personalization system consolidated** — single `user_profiles` table + `/api/user-profile` API route + `useUserProfile()` React Context; deleted duplicate systems; 401 profile settings errors fixed via cookie-based auth + RLS migration
- Pipeline auto-runs 10:00 UTC / 6am ET (morning) and 04:00 UTC / 8pm PT (evening), weekdays — triggered by **cron-job.org** (not GitHub Actions native cron)
- **AI provider:** Gemini 2.5 Flash (migrated from Groq 2026-04-10) — ingest, thesis, memo all use genai SDK
- **Backend SDK:** google.genai (newer SDK, matches frontend pattern)
- **Entity quality:** Full pipeline wired end-to-end (Gemini typed extraction → blocklist → Wikidata validation → clean_companies), stub briefing issue (PR #82) resolved
- **Thesis drag-to-archive fix:** RLS blocking PATCH via anon key — added `supabaseAdmin` client using `SUPABASE_SERVICE_ROLE_KEY` with detailed logging

## Architecture
- **Frontend:** Next.js 16 (Turbopack), hosted on Vercel (repo root)
- **Backend:** Python — ingest.py, synthesize.py, deal_extractor.py, run.py (8-step pipeline: ingest → synthesize → deal extraction → run record → critique → audit → trend map → summary)
- **Database:** Supabase (project: pnfjelfvtypkpnwpflmv) — use ingested_at for ordering, NOT created_at
- **AI:** Gemini 2.5 Flash (migrated from Groq) — ingest batch filtering, thesis generation, memo synthesis all use google.genai
- **News:** NewsAPI + 15 RSS feeds (added SEC 8-K, SEC 10-Q, Federal Reserve, PR Newswire)
- **Scheduler:** cron-job.org → GitHub `workflow_dispatch` (GitHub Actions native cron removed 2026-04-13 — unreliable)
- **Quotes:** Finnhub (primary) + Stooq CSV (fallback)
- **Auth:** Supabase Auth — Google OAuth (PKCE), email/password sign-up
- **Design:** Playfair Display (headings) + Inter (body) + JetBrains Mono (data), gold #F5A623 accent

## Environment
- **Repo:** github.com/lucasturcuato-afk/breakingalpha
- **Live:** breakingalpha.vercel.app
- **Supabase:** project pnfjelfvtypkpnwpflmv
- **Local:** /Desktop/signalera
- **Vercel Root Directory:** repo root (was previously frontend/, cleared during V2 rebrand)

## Environment Variables
**Vercel:**
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_FINNHUB_KEY, GEMINI_API_KEY

**GitHub Secrets (backend):**
GEMINI_API_KEY, NEWS_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY

## Pipeline Scheduler (cron-job.org)

Replaced GitHub Actions native cron on 2026-04-13 — GitHub's built-in scheduler is unreliable (silently skips runs, disabled after 60 days inactivity). cron-job.org POSTs to the GitHub `workflow_dispatch` API endpoint instead.

**Dispatch endpoint:**
`POST https://api.github.com/repos/lucasturcuato-afk/breakingalpha/actions/workflows/schedule.yml/dispatches`

**PAT:** `signalera-cron-dispatch` (classic token, `repo` scope)
**PAT expiry:** April 13, 2027 — **must be rotated before this date** (github.com/settings/tokens)

**Schedule:**
| Job | cron-job.org title | UTC | ET |
|-----|--------------------|-----|----|
| Morning | Signalera Morning Pipeline | 10:00 Mon–Fri | 6am ET |
| Evening | Signalera Evening Pipeline | 04:00 Mon–Fri | 8pm PT |

**Request headers (both jobs):**
- `Authorization: Bearer <PAT>`
- `Accept: application/vnd.github+json`
- `Content-Type: application/json`

**Request body:**
- Morning job: `{"ref":"main"}` (uses default mode)
- Evening job: `{"ref":"main","inputs":{"mode":"evening"}}`

**If runs stop:**
1. Check cron-job.org execution log — look for non-204 response codes
2. If 401: PAT expired or revoked → regenerate at github.com/settings/tokens, update both jobs
3. If 404: workflow file missing from main or repo renamed
4. If jobs show 204 but no GitHub run appears: check Actions tab for workflow disablement

## Auth Flow
- `src/middleware.ts` — `isAuthPage` exact-matches `/auth` only; `/auth/callback` is in `isPublicPath` so OAuth code exchange is never intercepted
- `src/app/auth/page.tsx` — split layout, Google SSO + email/password, `prompt: "select_account"` for account switching
- `src/app/auth/callback/route.ts` — PKCE code exchange, redirects to /dashboard
- `src/app/page.tsx` — server component: authenticated → redirect /dashboard; unauthenticated → renders LandingPage
- **Supabase URL Config:** Site URL = `https://breakingalpha.vercel.app`; Additional Redirect URLs must include `https://*.vercel.app/**` for preview deployments to work with Google OAuth

## Supabase Schema
**articles:** id, title, summary, content, url, source, published_at, ingested_at, relevance_score, relevance_reason, companies, themes, sentiment, sector, deal_type, primary_company (TEXT, nullable)

**briefings:** briefing_type, headline, summary, created_at, market_tone (text), sections (jsonb), top_deals (jsonb), sector_breakdown (jsonb)

**deal_flow:** RLS enabled, public read policy. Fields: company, acquirer, deal_type, status, value, notes, source, ingested_at

**theses:** id (uuid), title, conviction, rationale, sector, catalyst, catalyst_note (text), evidence_chain (jsonb), generated_at, source. Public read/write/update RLS.

**watchlist:** id (uuid), user_id, identifier (text), type (enum: ticker/company/sector), created_at, updated_at, sort_order (integer, nullable, for drag-to-reorder). User-scoped RLS (read/insert/delete own rows).

**user_profiles:** id (uuid, FK auth.users), role (text), sectors (text[]), created_at, updated_at. RLS: user can read/write own row (single FOR ALL policy).

**user_thesis_states:** id (uuid), user_id (uuid, FK auth.users), thesis_id (uuid, FK theses), state (text: 'active'|'archived'), created_at. User-scoped RLS.

**source_credibility:** id, source (text), win_rate (float), updated_at. Credibility scores for article sources; read by signal badge system.

**watchlist_articles:** identifier, title, source, published_at, relevance_score, score_breakdown (jsonb), url, fetched_at. User-agnostic (shared per identifier). V4B added `score_breakdown` column — run `ALTER TABLE watchlist_articles ADD COLUMN IF NOT EXISTS score_breakdown jsonb` if missing.

**watchlist_notifications:** id (uuid), user_id (uuid FK), title (text), body (text), type (text), identifier (text, nullable), read (boolean, default false), created_at. User-scoped RLS. Schema in `backend/watchlist_notifications_schema.sql` — **must run manually in Supabase**.

**watchlist_price_alerts:** id (uuid), user_id (uuid FK), identifier (text), alert_type (text: percent_change/price_above/price_below), threshold (numeric), direction (text: up/down/either, nullable), enabled (boolean), last_triggered (timestamptz, nullable), created_at. UNIQUE (user_id, identifier, alert_type, threshold). Schema in `backend/watchlist_alerts_schema.sql` — **must run manually in Supabase**.

**pipeline_runs:** Extended with `brief_addendum` (text, nullable) and `brief_addendum_used` (boolean) columns for feedback loop integration (migrations: 20260414_add_brief_addendum_columns.sql, 20260414_add_brief_addendum_used_pipeline_runs.sql).

**pipeline_runs, run_articles, brief_quality_scores, selection_audit, trend_clusters:** Phase 1 observation layer tables — see git history for schemas.

**user_saved_deals:** id (uuid), user_id (uuid FK auth.users), deal_id (text, composite key: `company|acquirer|deal_type`), saved_at (timestamptz). User-scoped RLS (read/insert/delete own rows). **Manual Supabase step:** Run `GRANT SELECT, INSERT, DELETE ON user_saved_deals TO authenticated` on any new environment.

## Full Diagnostic Audit (2026-04-10)

### What Was Audited
Complete codebase audit covering: all 10 backend pipeline files, all 10 frontend pages, all API routes, all GitHub Actions workflows, all LLM prompts, Supabase query patterns, and output quality against paid-user value-add standard.

### Key Findings

**Pipeline Health — CRITICAL (RESOLVED 2026-04-11)**
- ~~`schedule.yml` does NOT provide `GEMINI_API_KEY` to the pipeline~~. **RESOLVED:** Lucas's e9e235a commit added GEMINI_API_KEY to schedule.yml env block (2026-04-11).
- `deal_extractor.py` still uses Groq (llama-3.1-8b-instant) — intentional or needs migration.
- `observe.py` model metadata constants are stale (still say llama-3.1-8b-instant / llama-3.3-70b-versatile).
- No retry on synthesis Gemini call — single transient error produces stub briefing.

**Frontend**
- Dashboard "Signals Today" shows 0 — likely because pipeline hasn't run (GEMINI_API_KEY issue), plus timezone handling could cause edge cases.
- Dashboard mood block, AI Signal Bar are hardcoded static strings.
- Trends page is entirely hardcoded with 12 static signals — no live data.
- CompactStoryCard expands on hover only, not click (touch device issue).
- Company Intel route `/company` is correctly mapped in sidebar (not a code bug).

**Data Integrity**
- All Supabase queries correctly use `ingested_at` for article ordering.
- `briefings` table correctly uses `created_at` for its own timestamps.
- RLS on `articles` and `briefings` needs verification for anon SELECT.

**Output Quality — PRIMARY CONCERN**
- Company Intel memo prompt instructs model to output Company Brief verbatim (Wikipedia-level description) and describe facts without interpretation. Produces "I could have Googled this" output.
- Morning/Evening Brief section prompts are well-structured but lack a conviction requirement — sections describe what happened without stating what it means.
- Thesis generation prompt is the best in the codebase (testable claims, IB-grade language) but lacks action statements.

### Prompt Changes Recommended (Priority Order)
1. **Company Intel prompt** — Replace "output verbatim" Company Brief with analyst positioning. Add "so what" and conviction to Recent Developments and Key Watchpoints. (Effort: M)
2. **Synthesis section prompts** — Add conviction sentence rule to all sections: end with position, not description. (Effort: S)
3. **Thesis prompt** — Add action statement requirement: what to buy/sell/watch and what invalidates. (Effort: S)
4. **Cross-section coherence rule** — Connect macro signals to deal implications across sections. (Effort: S)

### Immediate Action Required (2026-04-10, PARTIALLY RESOLVED)
1. ~~Add `GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}` to schedule.yml env block~~ — DONE (e9e235a)
2. Verify `google-genai` is in requirements.txt (or add `pip install google-genai` to workflow) — Verify in next run
3. Keep `GROQ_API_KEY` in schedule.yml (still needed for deal_extractor.py) — Still active

### Waiting on Lucas
- ~~Thesis Board UI upgrade (in progress)~~ — DONE: phases 2–6 shipped with grading, pattern memory, adversarial testing, source credibility, pattern library feedback
- ~~Autonomous improvement loop (scope unknown)~~ — DONE: implemented across phases 2–6
- Do NOT modify: thesis-board/page.tsx, /api/theses/route.ts (until next Lucas cycle)

### Open Questions
1. ~~Has GEMINI_API_KEY been added as a GitHub Secret?~~ — RESOLVED: confirmed in schedule.yml env block (e9e235a)
2. Is deal_extractor.py staying on Groq intentionally?
3. ~~What is Lucas's scope for the autonomous improvement loop?~~ — RESOLVED: 12-step pipeline with thesis grading, pattern memory, source credibility, adversarial review (phases 2–6 shipped)
4. Are there active paying users? (determines urgency of fixes)
5. Status of middleware.ts → proxy.ts rename (Next.js 16 deprecation)

## Recently Completed (2026-04-20)
**Dark mode overhaul (PRs #108–#110 merged to main):** New CSS token system (5-level surface depth + warm off-white text + consistent border tokens) in `src/styles/tokens.css` and Tailwind mappings in globals.css. 10+ components patched (sidebar, topbar, mood-bar, brief-section, feed-row, deal-card, etc.). `dark-mode-overhaul` branch includes `src/lib/deal-utils.ts` getDealTypeStyle() and `src/lib/sector-colors.ts` rewrite (semantic pill color mapping via getTagPillStyle()) not yet merged separately to main.

## Recently Completed (2026-04-19)
**Deal Flow personalization and saved deals (PRs #104–#107 merged to main):** Two-column layout with analytics sidebar (268px: Pipeline Velocity, By Deal Type, Top Sectors, Largest Deals); company deduplication via `normalizeCompany()`. User profile integration: sector tracking/other split, watchlist highlighting, sector filter nudge. Saved deals table + RLS + `/api/saved-deals` server route; `/saved` page with sort controls, fade-out unsave, CSV export. Relevance scoring: `dealRelevanceScore()` + gold dot/border system (≥1.5 threshold); high-relevance row in sidebar. Fire-and-forget event tracking (`thesis_viewed`, `memo_generated`, `sector_filter_applied`) → `inferred_sector_weights`. **Manual Supabase steps:** Run `GRANT SELECT, INSERT, DELETE ON user_saved_deals TO authenticated` on any new environment. Gold dots won't appear until 4+ behavioral events compound past 1.5 threshold.

## In Progress (2026-04-19)
**Watchlist Brief Integration (branch: noah/watchlist-brief-integration):**
- `fetch_watchlist_signals()` added to `synthesize.py` — fetches all distinct identifiers from `watchlist` table (capped at 50), then retrieves top 8 cached articles from `watchlist_articles` (last 24h, sorted by `relevance_score`). Fails gracefully: any error returns `([], [])` and never crashes the pipeline.
- WATCHLIST DIRECTIVE added to both `MORNING_SYSTEM` and `EVENING_SYSTEM`: instructs Gemini to prioritize watchlist companies in `top_deals`, `deals_and_ma`, `public_markets`, `sector_spotlight`. Directive is self-disabling: explicitly tells Gemini to ignore it if no `[WATCHLIST]` articles are present.
- Watchlist signals injected as `[WATCHLIST: identifier]`-labeled articles appended after floor articles in synthesis prompt. Fallback path: if identifiers exist but no fresh articles, injects a `--- TRACKED COMPANIES ---` note instead.
- **Architecture note:** This creates a SHARED brief (one for all users) with watchlist-aware synthesis. Per-user personalization (section ordering, sector reordering) remains in the existing `/api/briefing/route.ts` layer (Lucas's work) — untouched.
- **No manual Supabase steps required** after merge.
- **Dry-run tested:** `fetch_watchlist_signals()` confirmed live against Supabase — found 38 tracked identifiers, no fresh articles (expected — watchlist_sync hasn't run today yet).
- **End-to-end test:** requires next cron run (6am or 8pm PST) with Gemini quota active.
- Does NOT touch: `/api/briefing/route.ts`, `run.py` step manifest, `watchlist_sync.py`, frontend, pipeline steps 13/14.

## Recently Completed (2026-04-19)
**Opening screen cinematic landing redesign (noah/opening-screen merged to main):** Full-viewport component with 4-column scrolling signal feed background (16 real deal/market signals, 4 parallax speeds), dark vignette + amber scan line (6s sweep). 7-step animation sequence: wordmark fade → divider extend → tagline letter-spacing → feed blur-to-sharp → hero copy up → stats row up → scan line activate. Two CTAs: "Get Started" → /auth, "Explore Preview" → /preview. Stats: 25 Sectors, 600+ Companies, 200+ Deals, 2 Daily Briefs. Zero external animation libraries. Signed-out users render OpeningScreen; signed-in still redirect to /dashboard. Fixed .gitignore for frontend/.next/ and frontend/node_modules/.

## Recently Completed (2026-04-18)
**V4D Phase 2 — Signed-out shell experience (PR #100 merged to main):** PreviewContext + tri-state auth in AppShell; redirects signed-out → `/preview`, signed-in → `/dashboard`. Added dark espresso banner + sidebar CTA. Content gates on `/trends` (first 3 signals) and `/company` (first 6 companies) with gradient fade, lock icons, SignInModal. Auth detection: `getUser()` resolves ~200ms post-mount, initializes `isSignedOut: false` to avoid tri-state timing bug. `/proxy.ts` whitelist expanded for public routes.

**Watchlist V4C sprint (PR #99 merged to main):** XLSX Summary dedup fix, price alert UI + `/api/watchlist-alerts` route, price alert trigger in watchlist_sync.py with 4h cooldown. Requires manual Supabase migration: `backend/watchlist_alerts_schema.sql`.

## Recently Completed (2026-04-17)

**Watchlist V4B sprint (PR #98 merged to main):** Real SheetJS XLSX export replacing fake CSV — Articles + Summary worksheets, 30-day window, 2000-row cap. In-app notification infrastructure — `watchlist_notifications` table + `/api/watchlist-notifications` (GET/PATCH/DELETE); bell icon in sidebar with amber badge, slide-in drawer (inline style transition), mark-read/mark-all-read. Supabase Realtime watchlist count badge in sidebar. Mobile watchlist layout — `isMobile` state + resize listener, sticky bottom bar, full bottom sheet. Keyboard nav audit/fixes on watchlist pages. Relevance scoring improvements in `watchlist_sync.py` — boilerplate penalty (`BOILERPLATE_PATTERNS`), prominence boost, `score_breakdown` JSON column in `watchlist_articles`. GDELT conditional on `exa_count < 5`. Article clustering UI in `[identifier]/page.tsx` — Jaccard similarity + capitalized entity overlap via `src/lib/clustering-utils.ts`, expandable "N more sources" rows.

**Watchlist V4A sprint (PR #97 merged to main):** Drag-to-reorder via HTML5 DnD with optimistic UI + `PATCH /api/watchlist-reorder`; `sort_order` column added (migration: `backend/watchlist_sort_order_migration.sql` — **must run manually in Supabase**). Keyboard navigation: J/K/Enter/A/Esc/? on `/watchlist`, J/K/O/B/N/Esc on identifier detail page, with `isTyping`/modal guards. Export: company PDF via `window.print()` + `#company-print-content`, full watchlist print at `/watchlist/export`, CSV at `/api/export/watchlist-xlsx`. Story clustering in `watchlist_sync.py` using Jaccard token similarity + financial entity overlap (48h window); three helpers: `_title_tokens`, `extract_key_entities`, `is_same_story`. Tailwind v4 safelist: `@source inline(...)` in globals.css forces class generation; identifier page borders switched to inline styles.

## Recently Completed (2026-04-15)
**watchlist_sync.py overhaul (PR #95 open):** GDELT rate limiting (1.5s sleep after each fetch), Exa recency filter (startPublishedDate 30 days ago), post-fetch age filter (articles >35 days or future-dated dropped before scoring), Exa payload restructure (highlights moved into contents.highlights, added type/news to query, bumped to 400 chars/3 sentences), fixed Exa response parsing, URL quality filter (is_article_url() + BLOCKED_DOMAINS/BLOCKED_URL_PATTERNS; LinkedIn/Twitter/Crunchbase/jobs/profiles/homepages filtered), title length floor (≤15 chars dropped), relevance scoring overhaul (NOISE_TITLE_PATTERNS + FINANCIAL_BOOST_PATTERNS, +2 title match/+1 summary/+1 financial/-3 noise/-1 short, floor <3 rejected).

## Recently Completed (2026-04-15, prior)
**Watchlist v2 interactive enhancements (PR #94 merged):** Clickable article headlines linking to news sources; public/private split (private markers); GDELT fallback route for zero-article entries; display name cleanup (ticker prefix removal, proper company names); stat counters (articles fetched vs total displayed); expert brief quality upgrade (analyst positioning, conviction rules). New `/api/news-search` route for GDELT-powered article discovery. Multi-identifier strategy: Finnhub ticker search, Clearbit company search, GDELT fallback. Enhanced watchlist modals with clickthrough interactions.

## Recently Completed (2026-04-15)
**Watchlist Overhaul (noah/watchlist-overhaul merged):** Two-column layout with per-identifier drill-down, unified WatchlistAddInput (ticker/company/sector with Finnhub/Clearbit autocomplete), stale sector auto-migration, per-entry article fetching (`fetchArticlesForEntry` + multi-strategy `.in()/.ilike()` filters, fuzzy match with suffix-stripping), Finnhub news fallback for zero-article tickers, Finnhub ticker search route, Clearbit company autocomplete, brief-on-entry modal at `/watchlist/brief?identifier=&type=` (Gemini memo from recent articles), HTML-stripping utility, short ticker guard (<4 chars), extended Finnhub window to 30 days, fixed GS subtitle alignment, PostgREST 400 fix. **Signal Strength & Credibility Badges:** article-signal.tsx exports `getCompleteness()` (FULL/PARTIAL/SNIPPET), `getAdjustedScore()`, `CompletenessBadge`, `SignalScore`, `SourceCredibilityBadge` (reads `source_credibility` table); used in feed-row, company intel. **Brief Feedback Loop:** `brief_feedback_loop.py` computes rolling quality signal from `brief_quality_scores` + `selection_audit`, injects self-improvement addendum into next synthesis via `pipeline_runs.brief_addendum` (new columns + migrations). **Track Record Page:** live at `/track-record`, shows thesis outcomes over time from `user_thesis_states`. **UI Explainability:** WhyThisThesis component explains thesis reasoning; TickerContext shows 1d change + 52w range on thesis cards via Finnhub. **Full-Text Scraping:** `fulltext.py` scrapes open-access sources, `backfill_content.py` backfills existing articles; ingest.py calls fulltext scraper. **AI-Personalized Briefs/Memos:** `/api/briefing` and `/api/memo` inject user profile (sectors, role) into generation prompt. **MemoModal Markdown:** proper heading/bullet/bold rendering. **Trends Live:** `/trends` page dual-dimension taxonomy (industry_verticals + activity_types) with live filter pills. **System Intelligence Widget:** dashboard widget shows pipeline health, article count, brief quality. **UI Polish:** morning brief, evening wrap, fonts, conviction ring, onboarding consolidated to single `OnboardingModal.tsx`. **Personalization system consolidation:** Merged dual conflicting preference systems into single source of truth (`user_profiles` table + `/api/user-profile` route + `useUserProfile()` React Context hook). Deleted stale `/api/preferences`, `/settings`, `/onboarding` pages + duplicate onboarding modals. Fixed profile settings 401 errors via cookie-based auth + RLS migration (single FOR ALL policy). Created `user_thesis_states` junction table for per-user thesis archive state. All consumers now use shared `useUserProfile()` hook. `user_preferences` table can be dropped.

## Recently Completed (2026-04-14)
PR #88: company intel filter accuracy — explicit sector-to-vertical mapping (COMPANY_VERTICAL_OVERRIDES 74-entry ground-truth map + SECTOR_TO_VERTICAL fallback); primary_company attribution guard prevents PE firms accumulating wrong tags. PR #87: dual-row filter UI on /deal-flow (Activity Type + Sector rows, Match Any/All toggles, Clear All button); vertical filter consistency across /company and /deal-flow. Cron-job.org Evening job updated: request body now passes `{"ref":"main","inputs":{"mode":"evening"}}` (was missing mode input, defaulted to morning, causing stale Evening Wrap).

## Recently Completed (2026-04-13)
ConvictionRing CSS refactor (conic-gradient donut) + drag-to-archive RLS fix: replaced SVG strokeDasharray (broken by Tailwind v4 preflight CSS overriding strokes) with CSS conic-gradient; inner circle now uses `.conviction-ring-bg` CSS class with context-aware color overrides (`.bg-parchment-mid .conviction-ring-bg`, `.bg-cream .conviction-ring-bg`); unfilled arc warm tone (#3a3530); PATCH `/api/theses/[id]` route fixed 500 error via `supabaseAdmin` client using `SUPABASE_SERVICE_ROLE_KEY`; removed conviction text badges from ThesisList.tsx; added detailed logging (`=== PATCH START/FAILED ===`). Service role key added to .env.local. Key files: ConvictionRing.tsx, ThesisList.tsx, route.ts, globals.css.

## Recently Completed (2026-04-13)
AUTONOMOUS_IMPROVEMENT_PLAN.md brought up to date (commit 240c713): now reflects the actual 12-step pipeline (steps 9–12 thesis_grader, pattern_memory, source_credibility, adversarial added); three previously undocumented Supabase tables documented (pattern_library, weekly_digests, source_credibility_scores); all sector/SECTORS language updated to dual-dimension taxonomy (industry_verticals + activity_types); Phase Status section (§5) added with live/complete table and explicit deferred items list; section numbering corrected (now 1–15).

Sector taxonomy migration complete: observe.py, trend_mapper.py, and feed-row.tsx migrated from single `sector` field to dual-dimension taxonomy. observe.py pool query now fetches `industry_verticals` and `_reconstruct_selected()` uses `(industry_verticals or [sector])[0]` to exactly mirror synthesize.py selection logic. trend_mapper.py `fetch_run_context()` fetches `industry_verticals` and `_normalize_article()` resolves sector as `industry_verticals[0]` with fallback — cascades to all 7+ downstream cluster functions (make_cluster_key, make_cluster_label, compute_pairwise_similarity, detect_cluster_surfacing, pattern boost, etc.) without further changes. feed-row.tsx thesis button now uses `industry_verticals[0]` before falling back to `sector`. No Supabase schema changes needed (sector backward-compat column still populated by ingest.py). tsc clean. commit: 1ddb0e0.

Dual-dimension sector taxonomy system (phases 2–7): Backend types + color system (phase 2–4, c3c1d22); user preferences UI wiring (phase 7, e857d59); pill rendering in feed/story cards with two-color system (phase 5, 0615a26); full filter bar redesign with terminal-style chips and inline active colors (phase 6, 43cea15); simplified pill rendering to blue verticals + gold activity types (a6ba43f). Merged to main via PR #85.

## Recently Completed (2026-04-12)
PRs #79–#82 entity quality and pipeline stability: PR #79 added blocklist (currencies, countries, gov bodies, law firms) and keyword pre-filter (class action / law firm) to ingest; extended isJunkEntityName() in frontend. PR #80 rewrote Gemini prompt for typed `{name, entity_type}` extraction, added Wikidata validation module with Supabase caching. PR #81 fixed articles.companies being written with raw Gemini output (now uses clean_companies list); fixed KeyError from unescaped braces in prompt. PR #82 fixed stub briefing issue — Gemini thinking tokens consumed max_output_tokens budget; disabled thinking and raised max to 4096. Pipeline now fully wired end-to-end (extraction → blocklist → Wikidata → clean_companies); ready for production validation at scale.

## Recently Completed (2026-04-11)
PR #78 (feat/company-intel-prompt-rewrite) iterative refinement: 8 cumulative prompt rule updates to buildMemoSystemPrompt() — analyst brief opener rule (proper noun required, "The" banned), low-recognition company carve-out (exception format), What Just Changed development filter (dollar figure/counterparty/product required), Cross-Signals binary verdict rule (exact format), What To Do With This bullet structure (if/then format, 75-word cap), sourcing discipline (all figures traceable to article pool), length rule (signal density not target), em-dash ban, expanded banned phrase list. Validated against live Supabase pools (NVIDIA 20 articles + Anthropic 20 articles); all figures sourced, no training knowledge leakage. Lucas's phases 2–6 commits merged in (thesis grading, pattern memory, adversarial testing, source credibility, pattern library feedback); GEMINI_API_KEY pipeline bug (previously critical) resolved via Lucas's e9e235a commit.

## Recently Completed (2026-04-10)
Full Groq→Gemini 2.5 Flash migration: frontend routes (theses, memo, thesis-detail, thesis-regenerate), backend ingest/synthesize, batch article filtering (166→127 articles, ~18min→2min pipeline), cluster-driven thesis gen, SEC/Fed feeds added, Gemini response parsing hardened (thinkingConfig, multi-fallback JSON), React hydration fix (Math.random()→deterministic), both repos clean on main, gh CLI auth set up.

## Recently Completed (2026-04-09)
Frontend debug pass completed: 8 batches (auth-gated 4 API routes, replaced createClient with createBrowserClient in 10 files, added error handling to 7 routes, Supabase/Groq validation fixes, replaced mock data with live queries across dashboard/company/ticker/shell). Resolved 8 merge conflicts (feat/signalera-frontend-v2 ↔ main), set up Playwright E2E suite (10 specs, 48 tests), created VERIFICATION.md (42 manual QA cases). Build clean, 0 TypeScript errors, 27 routes compiled.

## Recently Completed (2026-04-06)
Company Intel memo quality upgraded: replaced COMPANY_INDUSTRY string map with COMPANY_IDENTITY structured map (industry + pre-built analyst brief), injected analyst-quality sentences verbatim, tightened prompt instructions (Current Context/What To Watch prohibited from naming events outside article list). Classification hardening arc complete (primary_company matching, tiered gates, isSubjectOfTitle). 35 companies covered; prompt leakage resolved.

## What Was Done This Session (2026-04-06) — PR #57 merged to main

### Shipped — Signed-Out Conversion Funnel Restoration
1. **Landing page** (`src/components/landing/landing-page.tsx`) — signed-out users see a gated Signalera product preview at `/` with hero, stat cards, AI signal bar, story cards, and bottom CTA. Signed-in users still redirect to /dashboard.
2. **Auth gate** (`src/components/landing/auth-gate.tsx`) — blur+lock overlay wrapper; all gated interactions route to `/auth` instead of hitting raw API endpoints.
3. **Post-auth onboarding modal** (`src/components/onboarding/onboarding-modal.tsx`) — 3-step flow (Role → Sectors → Watchlist); persists to `/api/preferences` and `/api/watchlist/batch` with Bearer token on completion.
4. **Onboarding gate** (`src/components/onboarding/onboarding-gate.tsx`) — mounts on dashboard; checks `localStorage.signalera_onboarded_${userId}` (user-scoped, not browser-global); shows modal for first-time users.
5. **Middleware fix** — `isAuthPage` changed to exact match `/auth`; `/auth/callback` added to `isPublicPath` so OAuth code exchange is never intercepted.
6. **Avatar initials** — `AppShell` now fetches real user via `getUser()` and derives initials from `full_name` (email prefix fallback); was hardcoded "LT".
7. **Sidebar user card** — added sign-out button (icon-only, matches Settings icon, no name truncation).
8. **Vercel build fix** — `src/app/thesis-board/page.tsx` wrapped in Suspense boundary for `useSearchParams`.

## What Was Done This Session (2026-04-05)

### Shipped
1. **Signalera V2 rebrand** — new logo-icon.png, sidebar with "Signal" + "era" wordmark, Playfair Display + Inter + JetBrains Mono fonts, gold #F5A623 accent system, dark mode tokens
2. **Vercel deployment fixed** — root directory cleared from frontend/ to repo root
3. **Auth middleware** (`src/middleware.ts`) — all routes protected, unauthenticated → /auth, authenticated on /auth → /dashboard
4. **Google OAuth PKCE flow** — `createBrowserClient` from @supabase/ssr, callback route exchanges code for session
5. **Auth page redesign** — 55/45 split layout, left panel with brand + features, right panel with glass card, gold accents
6. **Per-session user isolation** — sidebar, greeting, settings all read from `supabase.auth.getUser()` live, no hardcoded values
7. **Watchlist API auth** — replaced hardcoded `USER_ID = "signalera_user_lucas"` with real authenticated user from cookies via createServerClient
8. **Thesis button wiring** — Live Feed "Thesis" button fetches theses, matches article sector, navigates to `/thesis-board?thesis=<id>` or shows "No thesis yet" toast. Thesis board reads `?thesis=` param and auto-selects.
9. **Weekly cross-run operator summary (PR #55)** — `backend/weekly_summary.py` aggregates observation metrics across the last 5 pipeline runs; surfaces selection quality trends, brief quality patterns, cluster momentum. Merged and production-validated.
10. **Phase 1 hardening — observe.py reconstruction fix (PR #56)** — `_reconstruct_selected()` rewritten to mirror current `synthesize._select_articles_for_synthesis()` (spine=12, floor=6, sector_cap=3, floor_min=7). `audit.py` `_TARGET_COUNT` corrected 20→18. Stale `_diversify_articles` reconstruction logic replaced. No schema changes.

## Pending / Known Issues
- **Tier 2 saved deals RLS grant** — must run `GRANT SELECT, INSERT, DELETE ON user_saved_deals TO authenticated` manually in Supabase SQL editor for new environments (migration file incomplete).
- **Relevance scoring cold start** — gold dots won't appear on fresh accounts until 4+ behavioral events compound inferred_sector_weights past 1.5 threshold. Expected, not a bug.
- **V4C watchlist_price_alerts table** — must run `backend/watchlist_alerts_schema.sql` manually in Supabase SQL editor before price alert UI/trigger is functional.
- **V4B watchlist_notifications table** — must run `backend/watchlist_notifications_schema.sql` manually in Supabase SQL editor before bell drawer shows real data.
- **V4B score_breakdown column** — run `ALTER TABLE watchlist_articles ADD COLUMN IF NOT EXISTS score_breakdown jsonb` if column was not added via V4B migration.
- **Watchlist sort_order migration pending** — V4A drag-to-reorder requires manual execution of `backend/watchlist_sort_order_migration.sql` in Supabase SQL editor to add `sort_order` column. Frontend gracefully handles missing column (null defaults to created_at order) until migration runs.
- **Track Record outcome data sparse** — Page is live but sparse outcome data until more theses cycle through archive state over time; breadth will improve as user base grows.
- **ConvictionRing partial arc fill deferred** — Currently shows full colored circle with color-coding (gold=HIGH, amber=MEDIUM, gray=WATCH, red=BEARISH); arc visualization deferred due to Tailwind v4 preflight SVG interference. Can be revisited once CSS preflight handling is resolved.
- **Wikidata validation at scale** — wikidata_entity_cache now populated on cache misses; needs full ingest run with fresh articles to validate entity quality in production
- **E2E tests need Supabase credentials** — Playwright suite configured (10 specs, 48 tests) but pending valid E2E_USER_EMAIL, E2E_USER_PASSWORD in .env.local to run against real Supabase test user
- **middleware.ts → proxy.ts** — Next.js 16 deprecation warning; rename `src/middleware.ts` to `src/proxy.ts` (breaking change in v16+)
- **Google OAuth consent screen** shows Supabase project name instead of "Signalera" — update in Google Cloud Console > OAuth consent screen
- **StoryCard Thesis button** (dashboard story cards) still inserts a new thesis directly instead of matching existing ones — only FeedRow button was updated
- **COMPANY_IDENTITY map** (35 entries, hardcoded) should eventually migrate to `company_profiles` Supabase table (ticker, industry, brief, source fields) for broader coverage
- **user_preferences table can be dropped** — Confirmed no references remain after personalization consolidation; safe to drop from Supabase
- **Article full-content archival sparse** — `content` column populated only for open-access sources; paywall-gated articles remain at summary-only; acceptable limitation for now
- **Earnings calendar integration** — requires ticker field + FMP/Polygon API; deferred
- **Legacy data inconsistency (low priority)** — a few old DB rows have stale `deal_type`/`primary_company`; won't block progress; will correct via re-ingest over time

## Nav Tabs
1. Dashboard — greeting, stat cards, top stories, system intelligence widget
2. Morning Brief — daily AI brief, top deals, analyst sections
3. Evening Wrap — end-of-day brief
4. Live Feed — 150+ articles, real-time, sector filters, auto-refreshes 60s, signal strength badges
5. Thesis Board — AI-generated theses, conviction scores, detail panel with catalyst + evidence chain + explainability
6. Deal Flow — tracked deals, manual entry
7. Company Intel — auto-extracted companies, sorted by mention frequency
8. Trends — dual-dimension taxonomy (industry_verticals + activity_types), live filter pills, signal momentum
9. Watchlist — personalized ticker/company/sector tracking, two-column layout, matched articles feed, brief-on-entry
10. Track Record — thesis outcome history, conviction vs outcome scorecard
11. Settings — profile (from auth), sectors, modules, notifications, appearance, team

## Branch Strategy
- main — production, auto-deploys to Vercel on push
- lucas/* — Lucas features, PR into main
- noah/* — Noah features, PR into main

## Division of Work
- **Lucas:** Frontend UI, design system, auth flow, Vercel deployment
- **Noah:** Backend pipeline, Groq prompt quality, Supabase schema, observation layer

## Key Links
- Live: https://breakingalpha.vercel.app
- GitHub: https://github.com/lucasturcuato-afk/breakingalpha
- Vercel: https://vercel.com/lucasturcuato-afks-projects/breakingalpha
- Actions: https://github.com/lucasturcuato-afk/breakingalpha/actions
- Supabase: project pnfjelfvtypkpnwpflmv
