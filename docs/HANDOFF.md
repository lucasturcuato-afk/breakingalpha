# Breaking Alpha Handoff

## Current Status
- Live at https://breakingalpha.vercel.app
- Pipeline auto-runs 6am PT (morning) and 10pm PT (evening), weekdays
- Morning Review and Evening Wrap both generating correctly
- PR #13 merged March 26 — Fixed Groq [sector] placeholder bug in synthesize.py
- PR #14 merged March 26 — Watchlist relevance boost added to ingest pipeline
- PR #15 merged March 26 — Full Watchlist frontend tab live (ticker/company/sector tracking, matched articles feed, + buttons in Company Intel and Deal Flow)
- PR #16 merged March 26 — Company Intel drill-down right-side panel live (click any company card to open matched articles panel)
- PR #17 merged March 27 — Watchlist ticker validation live (Finnhub validation, uppercase normalization, duplicate prevention)
- PR #18 merged March 27 — Watchlist price display live (live prices from Finnhub in inline pill, green/red with pct%, DM Mono font)
- PR #19 merged March 29 — Morning Review date header fixed (displays today's date instead of stale briefing.created_at pipeline run date)
- Lucas has `lucas/thesis-board-live` in progress — Thesis Board frontend

## Architecture
- **Frontend:** Next.js 14 + React, hosted on Vercel (root dir: frontend)
- **Backend:** Python — ingest.py, synthesize.py, deal_extractor.py, run.py
- **Database:** Supabase — use ingested_at for ordering, NOT created_at
- **AI:** Groq API — llama-3.1-8b-instant (500k TPD free tier)
- **News:** NewsAPI + 11 RSS feeds
- **Scheduler:** GitHub Actions — 6am PT (14:00 UTC) and 10pm PT (06:00 UTC), weekdays
- **Quotes:** Finnhub (primary) + Stooq CSV (fallback)

## Supabase Schema
**articles:** id, title, summary, content, url, source, published_at, ingested_at, relevance_score, relevance_reason, companies, themes, sentiment, sector, deal_type

**briefings:** briefing_type, headline, summary, created_at, market_tone (text), sections (jsonb), top_deals (jsonb), sector_breakdown (jsonb)

**deal_flow:** RLS enabled, public read policy. Fields: company, acquirer, deal_type, status, value, notes, source, ingested_at

**theses:** Live in Supabase. Public read/write RLS. CRUD via backend/theses.py. Schema in backend/theses_schema.sql.

**watchlist:** Live in Supabase. Public read/write RLS. CRUD via backend/watchlist.py. Schema in backend/watchlist_schema.sql. Fields: id (uuid), identifier (text), type (enum: ticker/company/sector), created_at, updated_at.

## Environment Variables
**Backend — GitHub Secrets + backend/.env:**
GROQ_API_KEY, NEWS_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY

**Frontend — Vercel env vars + frontend/.env.local:**
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_FINNHUB_KEY, GROQ_API_KEY

## Nav Tabs (live)
1. Morning Review — daily AI brief, top deals, analyst sections
2. Live Tracker — 150+ articles, real-time, sector filters, auto-refreshes 60s
3. Evening Wrap — end-of-day brief, same format as morning
4. Deal Flow — 180+ deals tracked, manual entry via ADD DEAL saves to Supabase
5. Thesis Board — Supabase backend live, frontend in progress (lucas/thesis-board-live)
6. Company Intel — 187 companies auto-extracted, sorted by mention frequency
7. Trends — signal momentum, sector velocity, top company movers
8. Watchlist — live. Personalized per user. Google SSO auth gate. Onboarding modal on first sign-in. Ticker/company/sector tracking, matched articles feed, live prices, nav badge.

## In Progress

### lucas/thesis-board-live — Thesis Board Frontend
- Connecting Thesis Board UI to the live `theses` Supabase table
- Backend CRUD (theses.py) and schema (theses_schema.sql) merged via PR #10
- Status: in progress

## Recently Completed (2026-03-31)
- **Pipeline output quality — branch: noah/pipeline-output-quality**
  - `backend/ingest.py` — tightened `relevance_reason` instruction: model now leads with market implication, names companies/figures, writes like a buy-side analyst signal; never opens with "This article…"
  - `backend/synthesize.py` — `relevance_reason` now fetched from Supabase and injected as `Signal:` line per article, so briefing synthesis builds from pre-digested analyst signals rather than raw RSS copy
  - `backend/synthesize.py` — all section prompts rewritten to enforce specificity (named companies, dollar figures, causal language); banned filler phrases; `what_to_watch`/`tomorrow_setup` now require continuous prose with binary outcome framing
  - `backend/synthesize.py` — `top_deals` HARD GATE added: four-criteria qualification test, explicit Signal-line exclusion ("Signal describes relevance only, not deal qualification"), count changed from "3-5 max" to "0-5" to remove fill pressure
  - `backend/synthesize.py` — article limit reduced from 60 → 20 (top by relevance_score); input capped at 300 chars per summary; both changes right-size context for llama-3.1-8b-instant and reduce rate-limit exposure
  - `.gitignore` — `.venv/` added (not yet on main)
  - **Why it matters:** Briefing quality was bottlenecked on generic RSS summaries feeding a small model with no analyst pre-processing. Now each article carries a buy-side signal, section prompts enforce specificity, and `top_deals` has structural gating that prevents non-deal articles from leaking in.
  - **How tested:** `python synthesize.py morning` run locally. Confirmed `top_deals` no longer includes non-deal company entries (Raspberry Pi, Fractile). Sections output named companies, dollar figures, and directional language.
  - **Next step:** Monitor 2–3 live briefings post-deploy. If `relevance_reason` values remain generic (RSS summaries are thin), next leverage point is enriching ingest with full article body text.

## Recently Completed (2026-03-30)
- PR #20 merged — feat: personalized watchlist with Google SSO + user scoping. Supabase: user_id column added to watchlist table, 4 public RLS policies replaced with 3 user-scoped policies (read/insert/delete own rows only), Google OAuth provider enabled. New files: frontend/lib/supabaseClient.js (shared browser client), frontend/components/AuthButton.js (Google sign in/out in nav), frontend/components/OnboardingModal.js (first-run ticker/sector picker), frontend/pages/api/watchlist/batch.js (batch insert for onboarding). Updated: frontend/pages/api/watchlist.js (all routes now user-scoped via RLS), frontend/pages/index.js (auth state wiring, AuthButton in nav, OnboardingModal mount, all 7 watchlist fetch calls updated with auth headers). Supabase redirect URLs configured for Vercel and localhost.

## Recently Completed (2026-03-29)
- PR #19 merged — Morning Review date header fixed to display today's date instead of stale briefing.created_at. Added todayLabel useState/useEffect pattern in BriefView component (frontend/pages/index.js), hydration-safe.

## Recently Completed (2026-03-27)
- PR #18 merged — Watchlist price display. New /api/watchlist-quotes route fetches live Finnhub prices for tickers. Inline price pill (price + pct%, green/red, DM Mono) rendered right-aligned before TICKER badge. Mounted hydration guard added.

## Recently Completed (2026-03-27 earlier)
- PR #17 merged — Watchlist ticker validation live. Finnhub validation, uppercase normalization, duplicate prevention. Tested in production preview.


## Recently Completed (2026-03-26)
- **Feature:** Watchlist frontend — full Watchlist tab (ticker/company/sector tracking, matched articles feed, quick-add sector chips, "+" buttons in Company Intel and Deal Flow); API route at `/api/watchlist`; branch `noah/watchlist-frontend`
- **Fix:** Groq [sector] placeholder bug — added explicit instructions to MORNING_SYSTEM and EVENING_SYSTEM in synthesize.py to write actual sector/company names instead of bracket placeholders
- **Feature:** Watchlist relevance boost — boost_watchlist_relevance() in watchlist.py; called from run_ingestion() after articles stored; boosts relevance_score +2 (cap 10) for any article matching a watchlist identifier in title, summary, or companies

## Recently Completed (2026-03-25)
- **PR #12:** watchlist_schema.sql + watchlist.py; watchlist table live in Supabase with public read/write RLS
- **PR #10 merged:** Groq 429 exponential backoff with jitter, 5 retries in synthesize.py and deal_extractor.py
- **PR #10 merged:** theses.py CRUD module + theses_schema.sql; theses table live in Supabase with public read/write RLS
- **Branch cleanup:** deleted noah/claude-workflow-setup, noah/fix-supabase-auth, docs/repo-workflow-update, claude/recursing-turing

## Pending / Known Issues
- DM Mono style tag hydration warning (pre-existing, unrelated to recent fixes, noted in PR #18)

## Branch Strategy
- main — production, always deployable, auto-deploys to Vercel on push
- lucas/* — Lucas features, PR into main when tested on Vercel preview
- noah/* — Noah features, PR into main when tested on Vercel preview
- Never commit features directly to main — docs and hotfixes only

## Sync Protocol

### Lucas — start of every session
Run in Terminal:
  ba
  claude

Start every new feature with:
  git checkout -b lucas/feature-name

### Noah — start of every session
If on a feature branch:
  git fetch origin
  git merge origin/main

If on main:
  git pull origin main

## Division of Work
Lucas: Frontend UI, Thesis Board live integration, Evening Wrap validation, UI polish
Noah: Backend, pipeline reliability, Groq prompt quality, Supabase schema, Watchlist feature (backend + frontend complete)

## Key Links
- Live site: https://breakingalpha.vercel.app
- GitHub: https://github.com/lucasturcuato-afk/breakingalpha
- Vercel: https://vercel.com/lucasturcuato-afks-projects/breakingalpha
- Actions: https://github.com/lucasturcuato-afk/breakingalpha/actions
