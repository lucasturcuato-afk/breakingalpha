# Breaking Alpha Setup

## Repo workflow
- Clone the shared GitHub repo
- Create a feature branch before making changes
- Use pull requests for merges
- Keep changes scoped
- Read `CLAUDE.md` and `docs/HANDOFF.md` before meaningful work

## Shared memory workflow
- `CLAUDE.md` = stable project instructions and collaboration rules
- `docs/HANDOFF.md` = current project state, blockers, and next exact steps
- `docs/ROADMAP.md` = priorities and backlog
- `docs/SETUP.md` = local setup, run instructions, and operational notes

---

## Frontend

**Stack:** Next.js 14, React 18, @supabase/supabase-js

~~~bash
cd frontend
npm install
npm run dev
npm run build
npm run start
~~~

**Required env vars — create `frontend/.env.local`:**

~~~env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Optional — get a free key at finnhub.io
# If unset, quotes fall back to Stooq (daily data only)
FINNHUB_API_KEY=your-finnhub-key
~~~

---

## Backend

**Stack:** Python 3, Supabase, Groq, NewsAPI, feedparser

~~~bash
cd backend
pip install -r requirements.txt
~~~

**Known dependency note**
- If `groq` is still missing from `requirements.txt`, install it manually with `pip install groq` until the file is fixed.

**Run the full pipeline:**
~~~bash
python run.py
python run.py evening
~~~

**Run individual steps:**
~~~bash
python ingest.py
python synthesize.py
python deal_extractor.py
~~~

**Required env vars — create `backend/.env`:**

~~~env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key

GROQ_API_KEY=your-groq-key
NEWS_API_KEY=your-newsapi-key
~~~

---

## Supabase

- The app uses a shared Supabase project, not local Supabase
- Both frontend and backend connect to the same project URL
- Tables used: `articles`, `companies`, `company_mentions`, `briefings`, `deal_flow`
- Get project URL and anon key from Supabase dashboard → Project Settings → API

---

## Vercel deployment

- Frontend is deployed on Vercel from the `frontend/` directory
- Set all required frontend env vars in Vercel project settings
- Backend pipeline is run manually or via cron, not on Vercel

---

## Supabase schema notes
- Use `ingested_at` for ordering articles, not `created_at`
- `briefings` table has four extra columns added manually: `market_tone` (text), `sections` (jsonb), `top_deals` (jsonb), `sector_breakdown` (jsonb)
- `deal_flow` table has row level security enabled with a public read policy

---

## Collaboration notes
- Noah and Lucas should both work from the same shared repo
- Use feature branches for meaningful work
- Do not rely on chat history as project memory
- Keep project context inside repo docs
- Update `docs/HANDOFF.md` after meaningful work sessions
