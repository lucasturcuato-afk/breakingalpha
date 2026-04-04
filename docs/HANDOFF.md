# Breaking Alpha Handoff

## Current Status
- Live at https://breakingalpha.vercel.app
- Pipeline auto-runs 6am PT (morning) and 10pm PT (evening), weekdays
- Morning Review and Evening Wrap both generating correctly
- All backend synthesis, watchlist, and frontend work merged to main (3 PRs from 2026-03-31 session)
- Article card UI with relevance chips, timestamps, and relevance_reason display live in production
- Signed-out landing page + auth gate live in production (PR #28); onboarding modal custom ticker chip removal now functional
- Signed-out preview mode (PR #29) merged to main; shows Morning Review + top articles to anon users; pending RLS verification for live data
- Watchlist panel, thesis detail modal, and self-contained sidebar fixes merged to main (2026-04-03)
- Preferences wiring merged (PR #36): `/api/briefing` reorders sections/sector_breakdown by user preferences; anon users unaffected
- Sector classification fixed (2026-04-04): ingest filter validation + SECTORS name alignment; old blank-sector rows not backfilled

## Architecture
- **Frontend:** Next.js 14 + React, hosted on Vercel (root dir: frontend)
- **Backend:** Python — ingest.py, synthesize.py, deal_extractor.py, run.py (7-step pipeline: ingest → synthesize → deal extraction → run record → critique → audit → trend map); observe.py, critique.py, audit.py, trend_mapper.py (Phase 1 observation layer)
- **Database:** Supabase — use ingested_at for ordering, NOT created_at
- **AI:** Groq API — ingest filtering: llama-3.1-8b-instant; synthesis: llama-3.3-70b-versatile
- **News:** NewsAPI + 11 RSS feeds
- **Scheduler:** GitHub Actions — 6am PT (14:00 UTC) and 10pm PT (06:00 UTC), weekdays
- **Quotes:** Finnhub (primary) + Stooq CSV (fallback)

## Supabase Schema
**articles:** id, title, summary, content, url, source, published_at, ingested_at, relevance_score, relevance_reason, companies, themes, sentiment, sector, deal_type

**briefings:** briefing_type, headline, summary, created_at, market_tone (text), sections (jsonb), top_deals (jsonb), sector_breakdown (jsonb)

**deal_flow:** RLS enabled, public read policy. Fields: company, acquirer, deal_type, status, value, notes, source, ingested_at

**theses:** Live in Supabase. Public read/write/update RLS. CRUD via backend/theses.py. Schema in backend/theses_schema.sql. Fields: id (uuid), title, conviction, rationale, sector, catalyst, catalyst_note (text), evidence_chain (jsonb), generated_at, source.

**watchlist:** Live in Supabase. Public read/write RLS. CRUD via backend/watchlist.py. Schema in backend/watchlist_schema.sql. Fields: id (uuid), identifier (text), type (enum: ticker/company/sector), created_at, updated_at.

**pipeline_runs:** Phase 1 observation layer. Fields: run_id, timestamp, status, article_count. Populated by backend/observe.py after ingest → synthesize → deal extraction.

**run_articles:** Phase 1 observation layer. Fields: run_id, article_id, selected_reason, provenance_flags. Tracks which articles were selected and marked with provenance status (exact vs. reconstructed/inferred).

**brief_quality_scores:** Phase 1 observation layer. One row per pipeline run. Fields: run_id, brief_type, headline_word_count, headline_pass, banned_phrase_hits, what_to_watch_banned_hits, sections_present, sections_omitted, top_deals_count, status, soft_flags. Written by backend/critique.py (non-blocking step 5).

**selection_audit:** Phase 1 observation layer. One row per pipeline run. Fields: run_id, brief_type, candidate_count, selected_count, target_count, score_10_not_selected, score_8_plus_not_selected, top_unselected_score, min_selected_score, mean_selected_score, sector_counts_selected (jsonb), sector_concentration_flag, provenance. All rows carry provenance='reconstructed'. Written by backend/audit.py (non-blocking step 6).

**trend_clusters:** Phase 1 observation layer. One row per pipeline run. Fields: run_id, brief_type, num_clusters, num_movers, top_mover_sector, top_mover_company, top_mover_recent_score, volatility_pct. Written by backend/trend_mapper.py (non-blocking step 7). Schema live in Supabase; live-validated 2026-04-04 (6 clusters written, 1 underrepresented flagged).

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
5. Thesis Board — Live. AI-generated theses from Groq, conviction scores, regenerate button, click-to-expand detail modal with catalyst notes + evidence chain
6. Company Intel — 187 companies auto-extracted, sorted by mention frequency
7. Trends — signal momentum, sector velocity, top company movers
8. Watchlist — live. Personalized per user. Google SSO auth gate. Onboarding modal on first sign-in. Ticker/company/sector tracking, matched articles feed, live prices, nav badge.

## In Progress

### Autonomous Improvement Phase 1 — Observation Layer ✓ COMPLETE
- **Phase 1 observation layer fully deployed:** `backend/observe.py`, `backend/critique.py`, `backend/audit.py`, `backend/trend_mapper.py`, `backend/summarize.py` integrated as non-blocking pipeline steps [1–8]. All tables live in Supabase. `summarize.py` consolidates phase 1 metrics (brief_quality_scores, selection_audit, trend_clusters) into human-readable digest to stdout after each run. Next: weekly cross-run summary (Phase 1 Summaries); optimizer/rollback/config mutation deferred to Phase 2+.

## Recently Completed (2026-04-03 — Trend Mapper Phase 1 built)

**Trend Mapper Phase 1 — 7th observation layer component:** Built `backend/trend_mapper.py` (cluster formation, mover ranking, volatility scoring) and `backend/trend_clusters_schema.sql`. Integrated as non-blocking [7/7] pipeline step in `run.py`. All pure-logic unit tests passed. Live row construction validated against production run data. Blocker: Supabase schema application required before branch can be validated end-to-end.

## Recently Completed (2026-04-04 — Trend Mapper Phase 1 live-validated and merged)

**Phase 1 observation layer complete:** Trend Mapper (PR #51) merged to main. Manual morning pipeline run confirmed: [7/7] TREND MAP fired, 6 clusters written to trend_clusters table, 1 underrepresented cluster flagged. First run had lookback=0, so all clusters marked as "emerging". Next steps: scheduled automatic post-run jobs and daily/weekly operator summaries.

## Recently Completed (2026-04-04)

**Post-run operator summary (Phase 1 step 8) built:** `backend/summarize.py` reads brief_quality_scores, selection_audit, trend_clusters for current run_id and prints consolidated digest to stdout (headline pass/fail, banned phrase hits, section presence, article selection metrics, sector concentration flag, cluster count, volatility). Integrated as non-blocking [8/8] step in pipeline. No schema changes, no LLM calls. Branch: noah/post-run-summary, ready for PR.

## Recently Completed (2026-04-04 — earlier)

**Preferences wiring (PR #36) merged and sector classification fixed:** `/api/briefing` route now returns preference-shaped responses for signed-in users, reordering sections and sector_breakdown keys by user module + sector selections. Sector classification collapse diagnosed: filter model 8b-instant was dropping `sector` key entirely (40% → 10% population on Apr 2–4). Fixed via explicit sector instruction + schema validation in ingest.py; sector names matched exactly against SECTORS list. SECTORS updated: "Real Estate & Infrastructure" → "Real Estate & REITs" to match frontend pill. Validation pending: inspect logs for `[?]` frequency, confirm new articles have valid sector values. Note: old blank-sector rows not backfilled.

## Recently Completed (2026-04-03 — Selection Auditor V1 validated)

**Selection Auditor V1 merged (PR #48) and validated end-to-end:** `backend/audit.py` + `backend/selection_audit_schema.sql` merged to main. `selection_audit` schema applied to Supabase. Manual pipeline run confirmed `[6/6] AUDIT` step fired and wrote a live row to `selection_audit` with correct metrics (candidates=53, selected=7/20, score10_miss=3, score8+_miss=43, top_unselected=10, concentration=False, provenance='reconstructed'). Pipeline 6-step sequencing confirmed working end-to-end. No optimizer, rollback, or per-article claims in scope.

## Recently Completed (2026-04-03 — Brief Critic validation)

**Brief Critic schema applied and live validation complete:** `brief_quality_scores_schema.sql` applied to Supabase; manual pipeline run (`python3.11 run.py morning`) confirmed all 5 steps completed with exit code 0; first live row written with all metrics correct (headline_pass, banned_phrase_hits, sections_present/omitted, top_deals_count, status).

## Recently Completed (2026-04-03 — Brief Critic merged)

**Brief Critic Phase 1 heuristic-only quality scorer merged (PR #47):** Deterministic text checks on headline word count, banned phrases, section presence, top deals count. Writes one row to `brief_quality_scores` per run as non-blocking pipeline step 5. `observe.py` now returns `run_id` for FK linking. Supabase schema SQL must be applied manually.

---

### SESSION: April 3, 2026 — Noah
**PRs merged: #44 (headline-spec), #45 (title dedup)**

1. **Morning headline selection tightened (PR #44 — `backend/synthesize.py`)**
   - Added `HEADLINE SELECTION` pre-step to `MORNING_SYSTEM`: model must rank all articles by market significance (largest dollar figure → broadest macro signal → widest sector development) before writing any JSON
   - Rewrote `headline` field instruction: explicit 10–15 word enforcement, banned vague labels, BAD/GOOD examples, direct link to pre-step dominant story
   - Validated via narrow `synthesize.py morning` run — produced "Microsoft Unveils $10 Billion AI Investment Package for Japan" (11 words, named entity, dollar figure, geography)
   - Evening system prompt unchanged; morning only

2. **Conservative storage-layer title dedup (PR #45 — `backend/ingest.py`)**
   - Added `_normalize_title()`: lowercase → strip punctuation → collapse whitespace
   - `store_article()` now queries article titles ingested in last 24h, skips insert if normalized title matches any existing row
   - Logs skipped articles: `⊘ Title dedup skip: <title>`
   - No schema changes; no fuzzy matching; no external libraries
   - Intentionally conservative — exact normalized title match only; near-duplicates with materially different wording still survive

---

### SESSION: April 3, 2026 — Lucas
**BRANCH:** Merged to main

**FEATURES SHIPPED:**

1. **Watchlist Panel — Morning Review & Evening Wrap right sidebar**
   - SECTORS box replaced with live WATCHLIST panel
   - Shows ticker, price, and % change pill (green/red) for each watchlisted stock
   - Component fetches from Supabase on mount, independent of Watchlist page
   - Shows "No tickers tracked" empty state when watchlist is empty
   - Also appears in left sidebar as mini watchlist summary (up to 6 tickers with % change)

2. **Thesis Board Split-Panel Detail Modal**
   - Clicking any thesis card opens a full modal overlay
   - LEFT (60%): title, sentiment badge, conviction donut score, sector pill, full analysis body, Catalyst label + Catalyst Note block
   - RIGHT (40%): Evidence Chain — vertical timeline with colored dots (green=support, yellow=context, red=risk), article headline, source, date, reasoning bridge sentence, → Read link
   - Modal closes via X button, Escape key, or clicking overlay; responsive (single column on mobile)

3. **Thesis Detail Upgrades (catalyst + analysis quality)**
   - Catalyst Note: 3-4 sentence Goldman Sachs/Bloomberg Intelligence tone — covers WHAT/WHY/WATCH/REACTION with specific figures and company names from source articles
   - Analysis body: upgraded to 6-8 sentences, 120-160 words, Bloomberg Intelligence sector brief style
   - Empty state fallback: if `catalyst_note` or `evidence_chain` missing on old theses, generates on-the-fly via Groq and saves back to Supabase
   - "REGENERATE ANALYSIS" button appears in modal for theses with short analysis (<100 words) or missing catalyst_note
   - New `/api/thesis-detail.js` — upgraded Groq prompt, saves enrichment back to Supabase via `thesisId` param
   - New `/api/thesis-regenerate.js` — full single-thesis regeneration (analysis + catalyst + evidence), two Groq calls, saves to Supabase
   - `/api/theses.js` — main REGENERATE pipeline now generates `catalyst_note` and `evidence_chain` at creation time; max tokens increased 1200→4000
   - Security audit confirmed: no API keys exposed on frontend; all Groq calls go through `/api/` server-side routes

**SUPABASE SQL REQUIRED** (run if not already done):
```sql
ALTER TABLE theses ADD COLUMN IF NOT EXISTS catalyst_note text;
ALTER TABLE theses ADD COLUMN IF NOT EXISTS evidence_chain jsonb;
CREATE POLICY "Public update" ON theses FOR UPDATE USING (true) WITH CHECK (true);
```

**KNOWN REMAINING ISSUES:**
- Watchlist panel shows "No tickers tracked" on left sidebar even when watchlist has stocks — likely auth timing issue, low priority
- Evidence chain on older theses uses AI-inferred articles labeled "AI-INFERRED" — will self-correct as theses are regenerated
- `SIDEBAR_SECTORS` constant is no longer used in the left nav — can be cleaned up

**NEXT SESSION PRIORITIES:**
- Run the Supabase SQL above if not done
- Hit REGENERATE on the Thesis Board to generate a fresh batch with upgraded prompts and full evidence chains
- Consider adding stock performance sparklines to the Watchlist panel (7-day mini chart per ticker)

## Recently Completed (2026-04-02)
- **Run Recorder Phase 1 observation layer (merged PR #42):** Backend observation layer now live: `backend/observe.py`, `pipeline_runs` table (run_id, timestamp, status, article_count), `run_articles` table (run_id, article_id, selected_reason, provenance_flags). Non-blocking observer hook runs after ingest → synthesize → deal extraction. In Phase 1, selected article rows are reconstructed/inferred and explicitly labeled; future analysis can distinguish exact vs. inferred provenance. Next: validate next scheduled run writes to both tables correctly.
- **Frontend stub-row fallback (merged):** Homepage now skips briefing rows with headline "Market Intelligence Unavailable" and falls back to the last successful briefing. Prevents stub row from surfacing during synthesis failures.
- **Ingest rate-limit hotfix (PR #33, merged):** `backend/ingest.py` filtering model changed from `llama-3.3-70b-versatile` → `llama-3.1-8b-instant`. Inter-call sleep increased from 0.25s → 2.0s. Stale "Filtering with Gemini..." log corrected. Root cause: ingest was saturating the Groq minute-window and leaving no quota for synthesis → stub briefing. After fix: full pipeline run completed with zero rate-limit errors, 69 new articles stored, fresh morning brief generated.
- **Relevance gate tightening (PR #34, merged):** `FILTER_PROMPT` in `backend/ingest.py` now rejects opinion/think-piece/cultural commentary/named-person commentary articles as non-relevant. Added explicit exclusion for company-anchored opinion pieces (e.g. articles about a named person's political philosophy even if they run a public company).
- **Filter prompt quality (PR #35, merged):** Removed style examples from `FILTER_PROMPT` — these were being copied verbatim by the 8b model, producing 3+ identical blurbs per run. Replaced with instruction to derive the blurb from the article. Added personnel-announcement exclusion (staff promotions/appointments not market-moving unless linked to a named transaction). Result: "comparable operators like X and Y" comp-list formula down from 38% of blurbs to expected <15%; verbatim identical blurbs reduced to 0.

## Recently Completed (2026-04-01)
- **Brief Preferences merged (PR #31):** PreferencesPanel, `/api/preferences` route, `user_preferences` schema live. Persistence and load working; not yet wired to filter brief content — next step.

## Recently Completed (2026-03-31)
- **Watchlist auth / onboarding / Google SSO — 2 merged PRs:** User scoping added to watchlist table, Google OAuth enabled in Supabase, onboarding modal on first sign-in, batch insert route for sector/ticker picker, all watchlist fetch calls scoped via RLS. Article card UI upgraded (Live Tracker): relevance chips, timestamp display, relevance_reason display in briefing cards.
- **Pipeline output quality (synthesis + ingest improvements) — 1 merged PR:** Tightened `relevance_reason` instruction in ingest.py to lead with market implication (no generic "This article…" openings). Injected `relevance_reason` as `Signal:` line in synthesize.py briefing synthesis. Rewrote section prompts for specificity (named companies, dollar figures, causal language; banned filler). Added HARD GATE to `top_deals` (4-criteria qualification test, explicit Signal exclusion) to stop non-deal articles leaking in. Reduced article input from 60 → 20 for coherence. Confirmed locally: `top_deals` no longer includes non-deal entries (Raspberry Pi, Fractile); sections output named figures and directional language. NEXT: Validate `relevance_reason` quality on real pipeline run — if still generic, investigate RSS feed depth as limiting factor.

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

### Blockers
(none active)

### Next validation (no code needed — inspect after next scheduled run)
- **Sector classification recovery (after sector-key-drop fix on 2026-04-04):**
  - Inspect ingest pipeline logs for `[?]` frequency — should drop materially below 40%
  - Inspect Supabase `articles` table: sample recent articles for materially improved `sector` field population (was ~10%, target >80%)
  - Inspect Morning Review / Live Tracker category pill counts on newly ingested content — should show non-empty pills for Deals & M&A, Tech, etc. (previously empty)
  - Expect preference module reordering (`/api/briefing`) to become more useful as sector population stabilizes (was masked by null sectors)
  - Note: old blank-sector rows will NOT auto-repair; only new/re-ingested articles will populate correctly
- Compare article blurb quality metrics against baseline:
  - "comparable operators like" baseline: 38% → target <15%
  - verbatim identical blurbs baseline: 3 → target 0
  - "hyperscalers" baseline: 16% → target <8%
- Inspect Live Tracker cards: fewer comp-list blurbs, opinion pieces filtered out
- Inspect Morning Review headline: should now be 10–15 words, named entity, dominant story — headline-spec PR #44 is the active fix
- Inspect ingest logs for `⊘ Title dedup skip:` lines — confirms title dedup (PR #45) is firing on same-story duplicates

### Known quality residuals (low harm, deferred)
- **Personnel announcements** can still pass at relevance_score 6 when article mentions firm AUM or implies future deal flow. Blurbs are weak/vague rather than fabricated. Targeted exclusion rule deferred.
- **Near-duplicate stories with different wording** — title dedup (PR #45) catches exact normalized matches; stories where Reuters and AP use materially different headline phrasing for the same underlying event still both survive. Fuzzy/semantic dedup is the next step if this remains noisy.
- **synthesize.py comp-list echo** — synthesis uses 70b-versatile and may echo comp-list patterns from upstream blurbs fed as Signal: lines. Expect improvement once filter blurbs improve; revisit if synthesis sections still feel formulaic after next run.
- **Weak "What to watch" section** — this section still occasionally produces generic forward-looking statements rather than named catalysts with binary outcomes. Prompt tightening deferred.
- **Residual false-positive relevance hits** — some articles score ≥6 on a marginal read-through signal rather than a primary market event. Gate tuning deferred.

### Other pending
- **Watchlist preference toggle:** Disabled in PreferencesPanel ("COMING SOON"); watchlist is live but preferences wiring for watchlist-based brief filtering not yet implemented.
- **Local auth validation blocked:** Google auth at localhost not in Supabase redirect allowlist. Auth-dependent work must validate on Vercel preview URL.
- Verify Supabase anon SELECT on `articles` and `briefings` tables. Enable `SELECT TO anon` if needed so signed-out preview shows real live data instead of static fallback.
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
