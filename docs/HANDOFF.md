# Signalera Handoff

## Current Status (2026-04-12)
- Live at https://breakingalpha.vercel.app (deploying as Signalera)
- Full rebrand from BreakingAlpha to Signalera shipped — logo, fonts, theme, auth page
- Auth middleware protecting all routes — unauthenticated users redirect to /auth
- Google OAuth (PKCE flow) working — callback at /auth/callback
- Per-session user isolation fixed — greeting, sidebar, settings all read from live auth
- Pipeline auto-runs 6am PT (morning) and 10pm PT (evening), weekdays
- **AI provider:** Gemini 2.5 Flash (migrated from Groq 2026-04-10) — ingest, thesis, memo all use genai SDK
- **Backend SDK:** google.genai (newer SDK, matches frontend pattern)
- **Entity quality:** Full pipeline wired end-to-end (Gemini typed extraction → blocklist → Wikidata validation → clean_companies), stub briefing issue (PR #82) resolved

## Architecture
- **Frontend:** Next.js 16 (Turbopack), hosted on Vercel (repo root)
- **Backend:** Python — ingest.py, synthesize.py, deal_extractor.py, run.py (8-step pipeline: ingest → synthesize → deal extraction → run record → critique → audit → trend map → summary)
- **Database:** Supabase (project: pnfjelfvtypkpnwpflmv) — use ingested_at for ordering, NOT created_at
- **AI:** Gemini 2.5 Flash (migrated from Groq) — ingest batch filtering, thesis generation, memo synthesis all use google.genai
- **News:** NewsAPI + 15 RSS feeds (added SEC 8-K, SEC 10-Q, Federal Reserve, PR Newswire)
- **Scheduler:** GitHub Actions — 6am PT (14:00 UTC) and 10pm PT (06:00 UTC), weekdays
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

**watchlist:** id (uuid), user_id, identifier (text), type (enum: ticker/company/sector), created_at, updated_at. User-scoped RLS (read/insert/delete own rows).

**pipeline_runs, run_articles, brief_quality_scores, selection_audit, trend_clusters:** Phase 1 observation layer tables — see git history for schemas.

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
1. Has GEMINI_API_KEY been added as a GitHub Secret?
2. Is deal_extractor.py staying on Groq intentionally?
3. What is Lucas's scope for the autonomous improvement loop?
4. Are there active paying users? (determines urgency of fixes)
5. Status of middleware.ts → proxy.ts rename (Next.js 16 deprecation)

## Recently Completed (2026-04-13)
Dual-dimension sector taxonomy system (phases 2–7): Backend types + color system (phase 2–4, c3c1d22); user preferences UI wiring (phase 7, e857d59); pill rendering in feed/story cards with two-color system (phase 5, 0615a26); full filter bar redesign with terminal-style chips and inline active colors (phase 6, 43cea15); simplified pill rendering to blue verticals + gold activity types (a6ba43f). Branch: feat/dual-dimension-sector-taxonomy (7 commits ahead of main).

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
- **Wikidata validation at scale** — wikidata_entity_cache now populated on cache misses; needs full ingest run with fresh articles to validate entity quality in production
- **E2E tests need Supabase credentials** — Playwright suite configured (10 specs, 48 tests) but pending valid E2E_USER_EMAIL, E2E_USER_PASSWORD in .env.local to run against real Supabase test user
- **middleware.ts → proxy.ts** — Next.js 16 deprecation warning; rename `src/middleware.ts` to `src/proxy.ts` (breaking change in v16+)
- **Google OAuth consent screen** shows Supabase project name instead of "Signalera" — update in Google Cloud Console > OAuth consent screen
- **StoryCard Thesis button** (dashboard story cards) still inserts a new thesis directly instead of matching existing ones — only FeedRow button was updated
- **COMPANY_IDENTITY map** (35 entries, hardcoded) should eventually migrate to `company_profiles` Supabase table (ticker, industry, brief, source fields) for broader coverage
- **Trends page still hardcoded with static signals** — no live data integration
- **Dashboard mood block and AI Signal Bar hardcoded static strings** — needs live data source
- **Article inputs constrained to 500-char RSS summaries** — memo depth limited; full content archival deferred
- **Earnings calendar integration** — requires ticker field + FMP/Polygon API; deferred
- **Legacy data inconsistency (low priority)** — a few old DB rows have stale `deal_type`/`primary_company`; won't block progress; will correct via re-ingest over time

## Nav Tabs
1. Dashboard — greeting, stat cards, top stories
2. Morning Brief — daily AI brief, top deals, analyst sections
3. Evening Wrap — end-of-day brief
4. Live Feed — 150+ articles, real-time, sector filters, auto-refreshes 60s
5. Thesis Board — AI-generated theses, conviction scores, detail panel with catalyst + evidence chain
6. Deal Flow — tracked deals, manual entry
7. Company Intel — auto-extracted companies, sorted by mention frequency
8. Trends — signal momentum, sector velocity, top movers
9. Watchlist — personalized ticker/company/sector tracking, matched articles feed, live prices
10. Settings — profile (from auth), sectors, modules, notifications, appearance, team

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
