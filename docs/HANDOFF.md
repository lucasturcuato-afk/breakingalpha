# Signalera Handoff

## Current Status (2026-04-05)
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
- `src/middleware.ts` — Supabase SSR server client, redirects unauthenticated to /auth
- `src/app/auth/page.tsx` — split layout, Google SSO + email/password, createBrowserClient from @supabase/ssr
- `src/app/auth/callback/route.ts` — PKCE code exchange, redirects to /dashboard
- Google OAuth redirectTo points to `/auth/callback` with `access_type: offline, prompt: consent`
- Supabase URL Config: Site URL = `https://breakingalpha.vercel.app`, Redirect URLs includes `/auth/callback`

## Supabase Schema
**articles:** id, title, summary, content, url, source, published_at, ingested_at, relevance_score, relevance_reason, companies, themes, sentiment, sector, deal_type

**briefings:** briefing_type, headline, summary, created_at, market_tone (text), sections (jsonb), top_deals (jsonb), sector_breakdown (jsonb)

**deal_flow:** RLS enabled, public read policy. Fields: company, acquirer, deal_type, status, value, notes, source, ingested_at

**theses:** id (uuid), title, conviction, rationale, sector, catalyst, catalyst_note (text), evidence_chain (jsonb), generated_at, source. Public read/write/update RLS.

**watchlist:** id (uuid), user_id, identifier (text), type (enum: ticker/company/sector), created_at, updated_at. User-scoped RLS (read/insert/delete own rows).

**pipeline_runs, run_articles, brief_quality_scores, selection_audit, trend_clusters:** Phase 1 observation layer tables — see git history for schemas.

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

### Still Broken / In Progress
- **Watchlist add may still fail** — API route is now authed correctly, but RLS policies may need updating in Supabase to match `auth.uid()` instead of the old hardcoded user_id. Check Supabase RLS on `watchlist` table.
- **Google OAuth consent screen** shows Supabase project name instead of "Signalera" — update in Google Cloud Console > OAuth consent screen
- **StoryCard Thesis button** (dashboard story cards) still inserts a new thesis directly instead of matching existing ones — only FeedRow button was updated

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
