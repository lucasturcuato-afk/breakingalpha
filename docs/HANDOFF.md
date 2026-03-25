# Breaking Alpha Handoff

## Current Status
- Live at https://breakingalpha.vercel.app
- Pipeline auto-runs 6am PT (morning) and 10pm PT (evening), weekdays
- Morning Review and Evening Wrap both generating correctly
- 2 PRs pending merge as of 2026-03-25:
  - PR #6: AI Deal Memo Generator (lucas/deal-memo-generator)
  - PR #7: Sidebar UI Redesign (lucas/ui-sidebar-redesign)

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
5. Thesis Board — hardcoded investment theses (no backend yet)
6. Company Intel — 187 companies auto-extracted, sorted by mention frequency
7. Trends — signal momentum, sector velocity, top company movers

## In Progress

### PR #6 — AI Deal Memo Generator (lucas/deal-memo-generator)
- API route: frontend/pages/api/memo.js — POST deal data to Groq, returns IB-style memo
- GENERATE MEMO button on every Deal Flow card
- Modal: amber header, scrollable body, Copy to Clipboard
- Tested on Vercel preview — working end to end
- Known issue: **bold** markdown renders as raw asterisks — needs one-line fix
- Status: ready to merge after markdown fix

### PR #7 — Sidebar UI Redesign (lucas/ui-sidebar-redesign)
- SVG icons replacing emoji icons for all 7 nav items
- Refined nav states: gray default, amber hover with glow, amber active with left border
- Cleaned logo area spacing, subtitle sizing, sector labels, square dot indicators
- Subtle right-edge separator line added
- Tested on Vercel preview — all checks passing
- Status: ready to merge

## Recently Fixed (2026-03-25)
- Pipeline secrets: SUPABASE_KEY corrected to SUPABASE_ANON_KEY in schedule.yml — was causing KeyError on every run
- Null deal size: Evening Wrap cards now show deal.value or Undisclosed
- Deal Flow persistence: ADD DEAL form inserts to Supabase via handleAddDeal handler
- groq-sdk missing: Added to frontend/package.json — was breaking Vercel build on memo branch

## Pending / Known Issues
- Thesis Board hardcoded — no Supabase backend, resets on refresh
- Company Intel has no drill-down — clicking a company does nothing yet
- Memo modal bold markdown renders as raw asterisks — fix before merging PR #6
- Deal Flow manual entries need end-to-end verification in Supabase table editor

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
Lucas: Frontend UI, Deal Flow, Evening Wrap validation, UI polish
Noah: Backend, Supabase auth, pipeline reliability, Yahoo Finance integration

## Key Links
- Live site: https://breakingalpha.vercel.app
- GitHub: https://github.com/lucasturcuato-afk/breakingalpha
- Vercel: https://vercel.com/lucasturcuato-afks-projects/breakingalpha
- Actions: https://github.com/lucasturcuato-afk/breakingalpha/actions
- PR #6: https://github.com/lucasturcuato-afk/breakingalpha/pull/6
- PR #7: https://github.com/lucasturcuato-afk/breakingalpha/pull/7
