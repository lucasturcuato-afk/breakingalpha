# Breaking Alpha Setup

## Repo workflow
- Clone the shared GitHub repo
- Create a feature branch before making changes
- Use pull requests for merges
- Keep changes scoped

## Shared memory workflow
- `CLAUDE.md` = stable project instructions for Claude Code
- `docs/HANDOFF.md` = current project status and baton pass
- `docs/ROADMAP.md` = priorities and backlog
- `docs/SETUP.md` = local setup and run instructions

---

## Frontend

**Stack:** Next.js 14, React 18, @supabase/supabase-js

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
npm run build      # production build check
```

**Required env vars — create `frontend/.env.local`:**

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Optional — get a free key at finnhub.io
# If unset, quotes fall back to Stooq (daily data only)
FINNHUB_API_KEY=your-finnhub-key
```

---

## Backend

**Stack:** Python 3, Supabase, Groq (llama-3.x), NewsAPI, feedparser

```bash
cd backend
pip install -r requirements.txt
```

> **Known issue:** `groq` is missing from `requirements.txt`.
> Until fixed, install it manually: `pip install groq`

**Run the full pipeline:**
```bash
python run.py              # morning run (default)
python run.py evening      # evening run
```

**Run individual steps:**
```bash
python ingest.py           # fetch + filter articles → Supabase
python synthesize.py       # generate briefing → Supabase
python deal_extractor.py   # extract deals from articles → Supabase
```

**Required env vars — create `backend/.env`:**

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key

GROQ_API_KEY=your-groq-key        # groq.com — free tier available
NEWS_API_KEY=your-newsapi-key     # newsapi.org — free tier available
```

---

## Supabase

- The app uses a shared Supabase project (not local Supabase).
- Both frontend and backend connect to the same project URL.
- Tables used: `articles`, `companies`, `company_mentions`, `briefings`, `deal_flow`
- Get project URL and anon key from: Supabase dashboard → Project Settings → API

---

## Vercel deployment

- Frontend is deployed on Vercel from the `frontend/` directory.
- Set all `NEXT_PUBLIC_*` and `FINNHUB_API_KEY` vars in Vercel project settings.
- Backend pipeline is run manually or via cron (not on Vercel).

---

## Supabase schema notes
- Use `ingested_at` for ordering articles, NOT `created_at`.
- `briefings` table has four extra columns added manually: `market_tone` (text), `sections` (jsonb), `top_deals` (jsonb), `sector_breakdown` (jsonb).
- `deal_flow` table has row level security enabled with a public read policy.

---

## Collaboration notes
- Noah and Lucas should both work from the same shared repo.
- Do not rely on chat history as project memory.
- Keep project context inside repo docs.
