# Signalera Handoff

## Current Status (2026-04-10)
- Live at https://breakingalpha.vercel.app (deploying as Signalera)
- Full rebrand from BreakingAlpha to Signalera shipped — logo, fonts, theme, auth page
- Auth middleware protecting all routes — unauthenticated users redirect to /auth
- Google OAuth (PKCE flow) working — callback at /auth/callback
- Per-session user isolation fixed — greeting, sidebar, settings all read from live auth
- Pipeline auto-runs 6am PT (morning) and 10pm PT (evening), weekdays

## Architecture
- **Frontend:** Next.js 16 (Turbopack), hosted on Vercel (repo root)
- **Backend:** Python — ingest.py, synthesize.py, deal_extractor.py, run.py (8-step pipeline: ingest → synthesize → deal extraction → run record → critique → audit → trend map → summary)
- **Database:** Supabase (project: pnfjelfvtypkpnwpflmv) — use ingested_at for ordering, NOT created_at
- **AI:** Groq API — ingest filtering: llama-3.1-8b-instant; synthesis: llama-3.3-70b-versatile
- **News:** NewsAPI + 11 RSS feeds
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
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_FINNHUB_KEY, GROQ_API_KEY

**GitHub Secrets (backend):**
GROQ_API_KEY, NEWS_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY

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

## Recently Completed (2026-04-10)
- Brief reliability layer shipped (PR #77): freshness check + run-status visibility on dashboard/morning/evening pages; debug endpoint `/api/debug/brief-status` added for diagnostics; GitHub Actions schedule validated; evening wrap headline selection brought to parity with morning spec
- Company Intel memo quality hardened (PR #75): ranked context articles by company-specific signal (3 new scoring functions), explicit 250-word limit, evidence-driven "What To Watch" bullets
- Company Intel development classification tightened (PR #74): restricted `isMaterialCounterparty` to M&A only, eliminated 4 NVIDIA false-positives (Funding/IPO articles)

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
- **In Progress: fix/brief-freshness-observability** — freshness check + run-status visibility deployed; monitoring for edge cases in scheduler integration
- **E2E tests need Supabase credentials** — Playwright suite configured (10 specs, 48 tests) but pending valid E2E_USER_EMAIL, E2E_USER_PASSWORD in .env.local to run against real Supabase test user
- **middleware.ts → proxy.ts** — Next.js 16 deprecation warning; rename `src/middleware.ts` to `src/proxy.ts` (breaking change in v16+)
- **Google OAuth consent screen** shows Supabase project name instead of "Signalera" — update in Google Cloud Console > OAuth consent screen
- **StoryCard Thesis button** (dashboard story cards) still inserts a new thesis directly instead of matching existing ones — only FeedRow button was updated
- **COMPANY_IDENTITY map** (35 entries, hardcoded) should eventually migrate to `company_profiles` Supabase table (ticker, industry, brief, source fields) for broader coverage
- **Key Watchpoints / Sector Context thin for low-coverage companies** — article data quality issue, not a code issue; defer until article ingest improves
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
