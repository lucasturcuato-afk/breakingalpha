# Brief Revamp — Recon Report (overnight orchestration)

**Date:** 2026-04-22 (overnight run)
**Branch base:** `main` at `63cce09` (includes Lucas's intelligence loop `0138677`)

## 0. Critical upstream fact

Lucas landed `0138677` **55 min before this run started** — "feat: intelligence loop — thesis grading, section ratings, competitive intel, cross-user signals." It touches:

- `src/app/morning-brief/page.tsx` (+23 lines — wired section ratings)
- `src/app/evening-wrap/page.tsx` (+23 lines — wired section ratings)
- `src/components/brief/brief-section.tsx` (+35 lines — added rating thumb UI)
- Added: `backend/brief_feedback_loop.py`, `src/app/api/brief-rating/route.ts`, competitor/collective-signals APIs + widgets

**Implication:** `morning-brief/page.tsx` and `evening-wrap/page.tsx` are in Lucas's "recently touched" set. Sprint protection rule says treat as protected. However those are the exact revamp targets. **Resolution:** build ON TOP of Lucas's landed commit (we fetched it). Do NOT revert his wiring. Do NOT touch `src/app/api/brief-rating/route.ts`, `backend/brief_feedback_loop.py`, `backend/thesis_grader.py`, competitor/collective-signals files. For brief pages, we add sections and rework existing ones but keep his rating wiring intact.

## 1. Integration state

| Integration | Status | Notes |
|---|---|---|
| Finnhub | ✅ configured | `FINNHUB_API_KEY` set; endpoints: `/api/finnhub-search`, `/api/finnhub-news`, `/api/market-indices`, `/api/market-snapshot`. Already fetches SPY/VIX/TNX + multi-symbol quotes. |
| Exa AI | ✅ configured | `EXA_API_KEY` set; client-side usage pattern TBD (no direct call sites in recon) |
| Resend | ❌ not installed | Need to `npm install resend`, add `RESEND_API_KEY` + `EMAIL_FROM_ADDRESS` env vars, configure domain DNS (Noah manual) |
| PDF generator | ❌ not installed | Plan: `@react-pdf/renderer` (cleaner than Puppeteer, no Chromium dep in prod) |
| react-email / mjml | ❌ not installed | Plan: `@react-email/components` + `@react-email/render` for HTML email |

## 2. Current Morning Brief data flow

- Frontend: `src/app/morning-brief/page.tsx` — fetches `GET /api/briefing?type=morning` with optional Bearer token.
- Personalization layer: `src/app/api/briefing/route.ts` — reads latest `briefings` row, applies section reorder + sector filter by user profile, merges `user_briefings` addendum. **Stable. No mid-edit flags.**
- Backend synthesis: `backend/synthesize.py` — Gemini 2.5 Flash, writes to `briefings` table (columns: `headline, summary, market_tone, sections (jsonb), top_deals (jsonb), sector_breakdown (jsonb)`).
- Per-user: `backend/user_synthesis.py` — adds 2-3 sentence addendum to `user_briefings` table per user.
- Quality scoring (Lucas): `backend/brief_feedback_loop.py` reads scores from `brief_quality_scores` table, generates addendum prepended to next run's system prompt.
- Cron: morning brief fires via `.github/workflows/schedule.yml` at 14:00 UTC weekdays.

## 3. Existing visual structure (both pages)

Both morning-brief/page.tsx (685 LOC) and evening-wrap/page.tsx (532 LOC) have identical structure:

```
AppShell
  TickerStrip
  BriefHeader (headline + summary + marketTone badge)
  [morning only] userAddendum gold pill
  Export/Share buttons (.txt download + copy link — very primitive)
  Top Deals to Watch (morning only, 3-col fixed grid, inline JSX — not componentized)
  Analyst Briefing (2-col fixed grid of BriefSection cards)
  Sector Signals (2-col grid of SectorSignalCard)
  Top Stories (LeadStoryCard + CompactStoryCard series)
```

## 4. Audit: visual issues (via ui-ux-pro-max skill lens)

- **BriefHeader**: functional but no editorial pull-quote treatment. Headline + flat summary paragraph. No paragraph breaks. Sentiment pill is visually busy.
- **Top Deals**: hand-rolled card grid inside morning-brief/page.tsx (NOT a reusable component). 3-col fixed; no hierarchy; all deals same weight. Crappy "hover:-translate-y-0.5" styling.
- **Analyst Briefing**: 2-col fixed; no way to see one quadrant at full width; quadrants emit at equal weight regardless of signal strength.
- **Top Stories**: LeadStoryCard + CompactStoryCard imports from dashboard — badge soup (sentiment + sector + source + time + signal + source win rate). User's ask: trim to hierarchy-first treatment.
- **USEFUL? thumbs (Lucas's addition)**: lives inside BriefSection. Don't know exact treatment without reading component.
- **Export**: `const content = document.querySelector("main")?.innerText` → Blob → download `.txt`. Completely throwaway.
- **Share**: `navigator.clipboard.writeText(window.location.href)` — just copies the auth-gated page URL. No public share.

## 5. What Lucas's intelligence loop added (DO NOT DUPLICATE)

- Section rating thumbs (thumbs up/down on each BriefSection) → writes to `brief_section_ratings` table via `/api/brief-rating`.
- Competitive intel widget (dashboard-only; not relevant here).
- Cross-user collective signals widget (dashboard-only).
- `backend/brief_feedback_loop.py` → scores brief quality via LLM, emits addendum to next synthesis run's system prompt.
- Thesis grading is already running (`backend/thesis_grader.py` + cron).

**None of Lucas's additions overlap with PR B's self-grading of *brief claims vs market outcomes*.** Different concept:
- Lucas = "was this brief's *content* well-written?"
- PR B = "was this brief's *market call* right?"

## 6. Key open questions (decided autonomously; see plan doc)

1. How to make the Market Pulse backend prompt extension safe? → ship frontend component reading `briefing.market_pulse` with graceful null; backend extension is a separate risk-managed commit in synthesize.py.
2. PDF vs screenshot for export? → `@react-pdf/renderer` (no Chromium, stable in serverless).
3. Public share URL — auth gate? → create public read-only view at `/share/brief/[id]` that reads from `briefings` table directly via anon key (no user personalization). No addendum, no ratings.
4. If A7 can't finish tonight — ship what? → ship PDF path first, Resend send + HTML email as follow-up. Dropdown menu wires the placeholders.
5. B2 (Morning Brief prompt restructure) risks breaking production pipeline → ship as an **additive** step: generate claims *after* brief synthesis completes, with full try/except; original brief is untouched.

## 7. Files touched in last 12 h (must double-check before editing)

Lucas (treat as caution zone):
- `src/app/morning-brief/page.tsx` — target of revamp, build around his section-rating wiring
- `src/app/evening-wrap/page.tsx` — same
- `src/components/brief/brief-section.tsx` — his rating thumbs live here
- `src/app/dashboard/page.tsx` — not in our scope
- `src/lib/track-event.ts`, `src/lib/user-profile.ts` — +1 line each, cosmetic

Lucas (NEW files — do not touch):
- `backend/brief_feedback_loop.py`
- `backend/thesis_grader.py` (extended)
- `scripts/build_competitor_map.ts`
- `src/app/api/brief-rating/route.ts`
- `src/app/api/collective-signals/route.ts`
- `src/app/api/competitor-alerts/route.ts`
- `src/app/api/user-events/route.ts`
- `src/components/dashboard/collective-signals-widget.tsx`
- `src/components/dashboard/competitor-alerts-widget.tsx`

Noah recent (OK to build on):
- `src/app/live-feed/page.tsx`, `src/components/feed/filter-bar.tsx` (filter consistency, just merged)
- `src/components/ui/wordmark.tsx` (sprint)
- `src/styles/tokens.css`, `src/app/globals.css` (sprint)

## 8. Tailwind v4 reminder

Dynamic classes must be pre-generated or avoided. When in doubt use inline `style={{ ... }}` with CSS var references. Precedent in globals.css and auth page.

## 9. Scope compression decision (autonomous)

Given the scope + overnight bandwidth + external dependencies (Resend domain DNS is Noah's action), I'm compressing:

**PR A ships** (high confidence): A1 Market Pulse frontend, A2 Today's Lead redesign, A3 Analyst toggle, A4 Top Deals editorial, A5 Top Stories cleanup, A6 USEFUL thumbs refinement, A8 Share dropdown + basic public view. **A7 ships code with caveat** — PDF path works, Resend send code is written but requires Noah's API key + DNS to activate.

**PR B ships** (medium confidence): B1 schema SQL, B2 prompt restructure (additive), B3 grading job, B4 Evening Wrap reflection logic, B6 UI display. B5 (cron setup) is docs only.

Details and specific subagent handoffs in `.sprint-notes/brief-revamp-plan.md`.
