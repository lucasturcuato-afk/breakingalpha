# Breaking Alpha Handoff

## Current Status
- Live at https://breakingalpha.vercel.app
- Pipeline auto-runs 6am PT (morning) and 10pm PT (evening), weekdays
- Morning Review and Evening Wrap both generating correctly
- PR #10 merged — Groq reliability + Thesis Board backend (see below)
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

**watchlist:** Live in Supabase. Public read/write RLS. CRUD via backend/watchlist.py. Schema in backend/watchlist_schema.sql. Fields: id (uuid), identifier (text), type (enum: ticker/company), created_at, updated_at.

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
5. Thesis Board — hardcoded frontend (lucas/thesis-board-live adds Supabase backend)
6. Company Intel — 187 companies auto-extracted, sorted by mention frequency
7. Trends — signal momentum, sector velocity, top company movers

## In Progress

### lucas/thesis-board-live — Thesis Board Frontend
- Connecting Thesis Board UI to the live `theses` Supabase table
- Backend CRUD (theses.py) and schema (theses_schema.sql) merged via PR #10
- Status: in progress

## Recently Completed (2026-03-25)
- **PR #12:** watchlist_schema.sql + watchlist.py; watchlist table live in Supabase with public read/write RLS
- **PR #10 merged:** Groq 429 exponential backoff with jitter, 5 retries in synthesize.py and deal_extractor.py
- **PR #10 merged:** theses.py CRUD module + theses_schema.sql; theses table live in Supabase with public read/write RLS
- **Branch cleanup:** deleted noah/claude-workflow-setup, noah/fix-supabase-auth, docs/repo-workflow-update, claude/recursing-turing

## Pending / Known Issues
- **Evening Wrap end-to-end validation** — needs real pipeline run to confirm cards render correctly
- **Company Intel drill-down** — clicking a company does nothing; no detail view yet
- **Groq memo prompt quality** — [sector] placeholders not filling in correctly
- **Sprint 2 watchlist feature** — backend complete (PR #12); frontend wiring up next (Lucas)
- **Noah next:** relevance scoring improvement for watchlist personalization

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
Noah: Backend, pipeline reliability, Groq prompt quality, Supabase schema

## Key Links
- Live site: https://breakingalpha.vercel.app
- GitHub: https://github.com/lucasturcuato-afk/breakingalpha
- Vercel: https://vercel.com/lucasturcuato-afks-projects/breakingalpha
- Actions: https://github.com/lucasturcuato-afk/breakingalpha/actions
