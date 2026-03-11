# BreakingAlpha — Web App Setup Guide

## What This Is
A fully public web app at breakingalpha.vercel.app that:
- Pulls news from 15+ sources twice daily
- Filters with AI across 10 sectors (Tech IB, VC, PE, Macro, Geopolitics, Real Estate, Fintech, Healthcare, Energy, Consumer)
- Stores everything in Supabase forever
- Displays morning/evening briefings, sector breakdowns, company intel, thesis board, and trends
- Runs automatically at 6am and 10pm PT via GitHub Actions — no manual work

---

## STEP 1: Set Up Supabase Database

1. Go to supabase.com → open your project
2. Click SQL Editor → New Query
3. Paste and run the schema.sql contents (in backend folder)
4. Click Run → should say Success

---

## STEP 2: Set Up Backend (Python Pipeline)

### Add your API keys:
```bash
cd backend
cp .env.example .env
# Open .env in TextEdit and fill in your 4 keys
```

### Install dependencies:
```bash
pip3 install supabase google-generativeai newsapi-python feedparser requests python-dotenv
```

### Test it manually:
```bash
python3 run.py morning
```
You should see articles being fetched, filtered, and stored.

---

## STEP 3: Set Up Frontend (Next.js Web App)

### Add your Supabase keys:
```bash
cd frontend
cp .env.local.example .env.local
# Open .env.local in TextEdit and fill in your 2 Supabase keys
```

### Install and run locally:
```bash
npm install
npm run dev
```
Open http://localhost:3000 — you should see your dashboard!

---

## STEP 4: Push to GitHub

```bash
# From the breakingalpha-web root folder
git init
git add .
git commit -m "BreakingAlpha V1"
git remote add origin https://github.com/YOURUSERNAME/breakingalpha.git
git push -u origin main
```

---

## STEP 5: Deploy Frontend to Vercel (Make it Public)

1. Go to vercel.com → New Project
2. Click "Import Git Repository" → select your breakingalpha repo
3. Set Root Directory to: `frontend`
4. Add Environment Variables:
   - NEXT_PUBLIC_SUPABASE_URL = your supabase url
   - NEXT_PUBLIC_SUPABASE_ANON_KEY = your supabase anon key
5. Click Deploy

Your app is now live at `breakingalpha.vercel.app` (or similar URL)

---

## STEP 6: Set Up GitHub Actions (Automated Pipeline)

1. Go to your GitHub repo → Settings → Secrets and variables → Actions
2. Add 4 Repository Secrets:
   - SUPABASE_URL
   - SUPABASE_ANON_KEY
   - GEMINI_API_KEY
   - NEWS_API_KEY
3. Go to Actions tab → Enable workflows

Done. Pipeline runs automatically at 6am and 10pm PT every weekday forever.

---

## Daily Usage
- Open your Vercel URL on any device, anywhere
- Share the link with anyone
- Morning Brief appears after 6am PT
- Evening Brief appears after 10pm PT
- Company Intel builds over time — more powerful every week

## Manual Pipeline Run (anytime)
```bash
cd backend
python3 run.py morning   # or evening
```
