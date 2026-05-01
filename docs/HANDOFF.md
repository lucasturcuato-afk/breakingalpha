# Signalera/Breaking Alpha — Claude Chat Handoff
**Date:** 2026-05-01 evening (PT)
**Last session focus:** Wave 2 overnight orchestration (5 parallel agents via git worktrees) — 2 ship PRs (#175, #171), 3 audit PRs (#173, #172, #174). PR #170 merged (contact email fix).
**Status:** Wave 2 PRs ready-for-review (#175 email + SQL migration, #171 avatar consistency). Audits complete (entity resolution, track-record evidence, company intel). OAuth + SITE_URL config still pending.

---

## Recently Completed (2026-05-01 evening)
**Wave 2 overnight orchestration complete (5 parallel agents):** 2 ship-ready PRs (#175 email polish + SQL migration, #171 avatar consistency); 3 audit-only read-only PRs (#173 entity resolution, #172 track-record evidence, #174 company intel). All five confirm "Zero edits to backend/synthesize.py or backend/ingest.py." Email PR flagged schema deviation (no sent_at column, used MAX(issue_number) instead). Avatar bug: topbar discarded computed initials. Audits surface W2-A (entity alias strategy), W2-I (evidence schema choice), and Strategy A/B/C direction decision for company intel. Five git worktrees on disk for cleanup after merge.

## Recently Completed (2026-05-01)
**Wave 1 orchestration complete:** PRs #167 (fix: brief flaky-render via page-transition), #168 (fix: mood-bar SSoT via useLiveMood hook), #169 (feat: track-record live-score grading) merged to main via parallel git worktrees. PR #170 (fix: contact email swap + legal nav + domain string) merged at e1d19ee (prior handoff claim was stale). Auth redirect bug diagnosed (`docs/auth-redirect-diagnosis.md`): Supabase Site URL + Redirect URLs allowlist still pinned to old `*.vercel.app` — requires manual Noah action. Track-record DDL (`sql/live_score_columns.sql`) needs manual application to Supabase prod; frontend renders correctly without it via TS fallback.

---

---

## 1. What happened this session

### PR #131 production validation — PASSED
- Morning Brief PDF export: POST `/api/brief/export-pdf` → 200, "PDF downloaded" confirmation visible in UI, no error toast
- Evening Wrap PDF export: POST → 200 (verified via Chrome MCP network log)
- Cookie-forwarded auth flow works end-to-end on prod. Vercel SSO bypass code path is correctly a no-op on prod (preview-only)

### PR #130 (cliche-detector-v1) — CLOSED
Closed via Chrome MCP. Branch `feat/cliche-detector-v1` preserved; only the PR is closed.

**Why closed:** Ran 3-way runtime comparison via Claude Code (main vs #129 vs #130) against today's article pool with Supabase writes intercepted in-memory. PR #130 produced a measurably worse brief:
- Orphaned "However," in market_pulse with no contrasting clause to oppose (sentence 1's content was stripped, sentence 2's "However" left dangling)
- Two of three `top_deals[].one_liner` fields emptied to "" — renders as blank cards in production UI
- Inconsistent regex enforcement: same banned word ("indicates", "signaling") stripped in some fields, retained in others within the same brief
- Retry budget didn't help: `lead_paragraph` and `supporting_context` triggered retries, retries didn't clear the cliche, fields got stripped anyway
- Detector flagged legitimate financial usage (e.g. "signaling sustained interest") and nuked entire sentences containing real news (€8B Vinted valuation lost from market_pulse)
- Runtime jumped 11s → 29s (2.6×) for retries that didn't succeed

**What's salvageable for v2:** The detector observability (hit counts per pattern, fields that triggered) is genuinely useful. Right v2 is observability-only first — log clichés to a `brief_quality_scores.cliche_actions` jsonb column, ship for a week, see which clichés actually appear most often and where, then add stripping only to fields where empty output is non-fatal, with a sentence-coherence post-pass that catches orphan conjunctions.

### PR #129 (lead-preselect-v1) — STAYS DRAFT
**Verdict:** promising but unvalidated. Don't merge yet.

**What we learned:**
- ✅ Mergeable: GitHub compare view confirms "Able to merge" against current main, no conflicts (handoff's prediction of synthesize.py conflict surface was wrong)
- ✅ All CI checks pass (3/3), Vercel preview deployed cleanly Apr 24
- ✅ No migration prerequisite. Claude Code confirmed reading PR #129's actual diff: it does NOT add a `briefings.preselect_reason` column write. The reason code lives only on an in-memory `_preselect_reason` field on the article dict. The `primary_story_id` column it writes to already exists in prod (verified via Supabase SQL editor)
- ✅ Code didn't crash. Branch produced a complete brief JSON with a different headline than main ("Global Military Spending Reaches Record $2.9 Trillion" vs main's "EBay Rival Vinted Valued at €8 Billion")
- ✅ Top Deals same as main (Vinted, Kashable, vVardis) — deal extraction undisturbed

**What we don't yet know:**
- Today's afternoon test only exercised the **macro fallback path** (Filter B → military spending). `deal_flow` had 0 rows in the last 24h (latest is 2026-04-17, 10 days stale). The **priced-deal primary path** — which is the actual justification for the PR — was never tested.
- Whether the headline the macro-fallback chose ("Global Military Spending") is consistently better than what Gemini chooses unaided. One data point isn't enough; arguably main's Vinted headline is the better lede today.
- One yellow flag: lead-preselect's market_pulse had 2 cliché hits vs main's 1. Adding the pre-selector might make Gemini's narration slightly worse because it's narrating around an externally-imposed lead rather than its own choice. Worth watching.

**Action for next session:** Re-run the 3-way comparison on a day with priced $1B+ deals in `deal_flow`. If the priced-deal path picks a sensible lead, mark Ready for Review and merge. If it picks something clearly worse than what Gemini would've picked, fix scoring before merging.

### Lucas reply — SENT (verify in your channel of choice)
Used "more context on closures" variant. Covers PR #131 status, PR #130 closure rationale, PR #129 staying draft, unblocks `lucas/intelligence-sprint` rebase, gives him narrow caution about lead-selection block in synthesize.py.

---

## 2. Findings to track (logged, not blocking)

### React #418 hydration error on /morning-brief and /evening-wrap
- Caught in console during prod smoke test
- PR #132 supposedly fixed hydration on these routes via `useState` lazy initializer (per handoff "Recently Completed 2026-04-25")
- Either regressed or new instance. Not blocking PDF export. Worth a 10-min look next session.
- Stack trace points into minified Next.js chunks — needs source map or a dev-mode reproduction to identify the actual component

### deal_flow staleness (10 days)
- `deal_flow` last 24h: 0 rows. Latest entry 2026-04-17.
- Cron-job.org Morning Pipeline fired clean at 6am ET 4/27 (returned 204), so the trigger works.
- Means deal_extractor is either not extracting, not writing, or extracting things that don't meet insert criteria.
- Independent of PR #129 but **blocks the PR #129 priced-deal path test** until resolved.
- Diagnostic for next session: check `pipeline_runs` table for last 7 days, look at deal_extractor step output. deal_extractor still uses Groq llama-3.1-8b-instant per prior handoff — could be Groq API issue.

---

## 3. THREE OPEN THREADS for next session (priority order)

### Thread A: PR #129 re-test
**Trigger:** wait until `deal_flow` has rows from the last 24h with at least one $1B+ priced deal.
**Blocker:** the deal_flow staleness above. Until that's resolved, PR #129's primary path can't be tested.
**Action:** Re-run the same 3-way comparison Claude Code did this session (artifacts at `/tmp/pr-comparison/`). Same prompt, same wrapper, same Supabase-write interception — just on a day with priced deals.
**Maybe-tonight option:** Evening wrap cron at 8pm PT could populate deal_flow if deal_extractor isn't broken. Watch that run.

### Thread B: deal_flow staleness diagnosis
**Why it matters:** Blocks Thread A. Also means production briefs are missing a signal source for 10 days running.
**Diagnostic queries:**
```sql
SELECT created_at::date, COUNT(*) FROM deal_flow GROUP BY created_at::date ORDER BY created_at::date DESC LIMIT 14;
SELECT id, run_started_at, status, error_message FROM pipeline_runs ORDER BY run_started_at DESC LIMIT 14;
```
Then look at `deal_extractor.py` step output in the most recent runs. May be a Groq API issue (deal_extractor still uses Groq llama-3.1-8b-instant per handoff).

### Thread C: React #418 hydration regression
**Why it matters:** User-facing console error on every brief page load.
**Diagnostic:** reproduce locally on dev server, compare with PR #132's `useState` lazy initializer fix, find the new component that's hydrating with mismatched text.

---

## 4. Other items deferred (carried forward)

### Personalization addendum investigation
Neither smoke-test PDF showed visible "For You" addendum content. Three possible reasons (unchanged from previous handoff):
1. `user_briefings.addendum` is empty for noahhanning's user_id today
2. print-brief.tsx doesn't render the addendum even when present
3. Cookie forwarding works but API drops the addendum field

Diagnostic: `SELECT user_id, briefing_date, length(addendum) FROM user_briefings WHERE briefing_date = CURRENT_DATE;` then trace render path if data exists.

### PDF design overhaul (proposed PR #134)
Unchanged. Newsletter-style redesign of `src/components/brief/print-brief.tsx`. Not blocking.

### Three locked agent worktrees from 4/24
Still in `.claude/worktrees/`. From this session we know they were used to host the PR branches when Claude Code couldn't `git checkout` them in main tree. Cleanup chore.

### HANDOFF.md / BUGFIX_NOTES.md cleanup (now overdue)
- Retire "STATUS UNKNOWN" labels on migration audit (this session confirmed `primary_story_id` present, `preselect_reason` not present and not needed by PR #129)
- Fix BUGFIX_NOTES typo: `morning_brief_outcomes` should be `morning_brief_call_outcomes`
- Add Vercel SSO bypass mechanism note for future devs

---

## 5. State on disk for next session

### Local repo (`~/breakingalpha`)
- main is current, working tree clean
- Active feature branches preserved: `feat/lead-preselect-v1`, `feat/cliche-detector-v1` (PR closed but branch alive)
- Locked agent worktrees: `.claude/worktrees/agent-a534…` (#129) and `.claude/worktrees/agent-acf6…` (#130) — Claude Code couldn't checkout these branches in main tree, ran from worktree backend/ via BACKEND_PATH

### Comparison artifacts (`/tmp/pr-comparison/`)
**Important: `/tmp` wipes on macOS reboot.** If you reboot before next session, these are gone. To preserve, copy to `~/breakingalpha/.session-artifacts/2026-04-27/` or similar.
- `REPORT.md` — full 3-way comparison
- `main.json` / `lead-preselect-v1.json` / `cliche-detector-v1.json` — actual brief outputs
- `*.log` — full stdout/stderr from each run
- `*.capture.json` — intercepted Supabase write payloads
- `branches.txt` — head SHA for each branch tested
- `command.txt` — exact synthesize invocation Claude Code documented
- `run_synth.py` / `build_report.py` / `check_dealflow.py` / `check_supabase.py` — wrapper and helper scripts (reusable for next test)

### Supabase prod state (`pnfjelfvtypkpnwpflmv`)
- `briefings.primary_story_id` exists (text, nullable). Last 7 days: 9 morning briefs, 2 with primary_story_id; 6 evening briefs, 1 with primary_story_id. Gemini elective-write rate is ~20%, which is the problem PR #129 solves.
- `briefings.preselect_reason` does NOT exist. Confirmed not needed.
- `deal_flow` last 24h: 0 rows. Latest entry 2026-04-17 (10 days stale).

---

## 6. User preferences for the new Claude session

Same as before, no changes:

- Blunt, founder-grade tone
- No em-dashes
- Recon-first (separate diagnostic and fix prompts; don't combine them)
- Copy-paste-ready prompts when handing off to Claude Code
- One highest-leverage next step at a time, not brainstorming
- Sanity-check destructive/irreversible actions before clicking
- Drive Chrome MCP, GitHub, Supabase, Vercel directly — don't ask Noah to click
- Prefer single-message structured deliverables over multi-turn chatter
- Push back when Noah's logic seems off (don't capitulate)

---

## 7. The exact thing the new Claude session should do FIRST

Read this handoff section + the prior 2026-04-27 (afternoon) section for the prior context.

Then ask Noah what he wants to brainstorm/tackle. He's flagged he's NOT done for the night and wants to brainstorm rather than execute a specific task.

Candidate threads in priority order (use these to anchor brainstorming, not to push):
1. **deal_flow staleness diagnosis** (Thread B) — blocks PR #129 re-test, possibly blocks production brief quality
2. **Evening cron observation at 8pm PT** — opportunity to diagnose Thread B in real-time and potentially unlock PR #129 re-test
3. **React #418 hydration regression** (Thread C) — user-visible console error
4. **Personalization addendum investigation** — neither smoke-test PDF showed the addendum
5. **HANDOFF.md / BUGFIX_NOTES.md cleanup** — overdue, not urgent

Don't preempt Noah's choice. Let him steer.

---

# Signalera Handoff

## Current Status (2026-04-20)
- Live at https://breakingalpha.vercel.app (deploying as Signalera)
- Full rebrand from BreakingAlpha to Signalera shipped — logo, fonts, theme, auth page
- Auth middleware protecting all routes — unauthenticated users redirect to /auth
- Google OAuth (PKCE flow) working — callback at /auth/callback
- Per-session user isolation fixed — greeting, sidebar, settings all read from live auth
- **Personalization system consolidated** — single `user_profiles` table + `/api/user-profile` API route + `useUserProfile()` React Context; deleted duplicate systems; 401 profile settings errors fixed via cookie-based auth + RLS migration
- Pipeline auto-runs 10:00 UTC / 6am ET (morning) and 04:00 UTC / 8pm PT (evening), weekdays — triggered by **cron-job.org** (not GitHub Actions native cron)
- **AI provider:** Gemini 2.5 Flash (migrated from Groq 2026-04-10) — ingest, thesis, memo all use genai SDK
- **Backend SDK:** google.genai (newer SDK, matches frontend pattern)
- **Entity quality:** Full pipeline wired end-to-end (Gemini typed extraction → blocklist → Wikidata validation → clean_companies), stub briefing issue (PR #82) resolved
- **Thesis drag-to-archive fix:** RLS blocking PATCH via anon key — added `supabaseAdmin` client using `SUPABASE_SERVICE_ROLE_KEY` with detailed logging

## Architecture
- **Frontend:** Next.js 16 (Turbopack), hosted on Vercel (repo root)
- **Backend:** Python — ingest.py, synthesize.py, deal_extractor.py, run.py (8-step pipeline: ingest → synthesize → deal extraction → run record → critique → audit → trend map → summary)
- **Database:** Supabase (project: pnfjelfvtypkpnwpflmv) — use ingested_at for ordering, NOT created_at
- **AI:** Gemini 2.5 Flash (migrated from Groq) — ingest batch filtering, thesis generation, memo synthesis all use google.genai
- **News:** NewsAPI + 15 RSS feeds (added SEC 8-K, SEC 10-Q, Federal Reserve, PR Newswire)
- **Scheduler:** cron-job.org → GitHub `workflow_dispatch` (GitHub Actions native cron removed 2026-04-13 — unreliable)
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
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_FINNHUB_KEY, GEMINI_API_KEY

**GitHub Secrets (backend):**
GEMINI_API_KEY, NEWS_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY

## Pipeline Scheduler (cron-job.org)

Replaced GitHub Actions native cron on 2026-04-13 — GitHub's built-in scheduler is unreliable (silently skips runs, disabled after 60 days inactivity). cron-job.org POSTs to the GitHub `workflow_dispatch` API endpoint instead.

**Dispatch endpoint:**
`POST https://api.github.com/repos/lucasturcuato-afk/breakingalpha/actions/workflows/schedule.yml/dispatches`

**PAT:** `signalera-cron-dispatch` (classic token, `repo` scope)
**PAT expiry:** April 13, 2027 — **must be rotated before this date** (github.com/settings/tokens)

**Schedule:**
| Job | cron-job.org title | UTC | ET |
|-----|--------------------|-----|----|
| Morning | Signalera Morning Pipeline | 10:00 Mon–Fri | 6am ET |
| Evening | Signalera Evening Pipeline | 04:00 Mon–Fri | 8pm PT |

**Request headers (both jobs):**
- `Authorization: Bearer <PAT>`
- `Accept: application/vnd.github+json`
- `Content-Type: application/json`

**Request body:**
- Morning job: `{"ref":"main"}` (uses default mode)
- Evening job: `{"ref":"main","inputs":{"mode":"evening"}}`

**If runs stop:**
1. Check cron-job.org execution log — look for non-204 response codes
2. If 401: PAT expired or revoked → regenerate at github.com/settings/tokens, update both jobs
3. If 404: workflow file missing from main or repo renamed
4. If jobs show 204 but no GitHub run appears: check Actions tab for workflow disablement

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

**watchlist:** id (uuid), user_id, identifier (text), type (enum: ticker/company/sector), created_at, updated_at, sort_order (integer, nullable, for drag-to-reorder). User-scoped RLS (read/insert/delete own rows).

**user_profiles:** id (uuid, FK auth.users), role (text), sectors (text[]), created_at, updated_at. RLS: user can read/write own row (single FOR ALL policy).

**user_thesis_states:** id (uuid), user_id (uuid, FK auth.users), thesis_id (uuid, FK theses), state (text: 'active'|'archived'), created_at. User-scoped RLS.

**source_credibility:** id, source (text), win_rate (float), updated_at. Credibility scores for article sources; read by signal badge system.

**watchlist_articles:** identifier, title, source, published_at, relevance_score, score_breakdown (jsonb), url, fetched_at. User-agnostic (shared per identifier). V4B added `score_breakdown` column — run `ALTER TABLE watchlist_articles ADD COLUMN IF NOT EXISTS score_breakdown jsonb` if missing.

**watchlist_notifications:** id (uuid), user_id (uuid FK), title (text), body (text), type (text), identifier (text, nullable), read (boolean, default false), created_at. User-scoped RLS. Schema in `backend/watchlist_notifications_schema.sql` — **must run manually in Supabase**.

**watchlist_price_alerts:** id (uuid), user_id (uuid FK), identifier (text), alert_type (text: percent_change/price_above/price_below), threshold (numeric), direction (text: up/down/either, nullable), enabled (boolean), last_triggered (timestamptz, nullable), created_at. UNIQUE (user_id, identifier, alert_type, threshold). Schema in `backend/watchlist_alerts_schema.sql` — **must run manually in Supabase**.

**pipeline_runs:** Extended with `brief_addendum` (text, nullable) and `brief_addendum_used` (boolean) columns for feedback loop integration (migrations: 20260414_add_brief_addendum_columns.sql, 20260414_add_brief_addendum_used_pipeline_runs.sql).

**pipeline_runs, run_articles, brief_quality_scores, selection_audit, trend_clusters:** Phase 1 observation layer tables — see git history for schemas.

**user_saved_deals:** id (uuid), user_id (uuid FK auth.users), deal_id (text, composite key: `company|acquirer|deal_type`), saved_at (timestamptz). User-scoped RLS (read/insert/delete own rows). **Manual Supabase step:** Run `GRANT SELECT, INSERT, DELETE ON user_saved_deals TO authenticated` on any new environment.

## Full Diagnostic Audit (2026-04-10)

### What Was Audited
Complete codebase audit covering: all 10 backend pipeline files, all 10 frontend pages, all API routes, all GitHub Actions workflows, all LLM prompts, Supabase query patterns, and output quality against paid-user value-add standard.

### Key Findings

**Pipeline Health — CRITICAL (RESOLVED 2026-04-11)**
- ~~`schedule.yml` does NOT provide `GEMINI_API_KEY` to the pipeline~~. **RESOLVED:** Lucas's e9e235a commit added GEMINI_API_KEY to schedule.yml env block (2026-04-11).
- `deal_extractor.py` still uses Groq (llama-3.1-8b-instant) — intentional or needs migration.
- `observe.py` model metadata constants are stale (still say llama-3.1-8b-instant / llama-3.3-70b-versatile).
- No retry on synthesis Gemini call — single transient error produces stub briefing.

**Frontend**
- Dashboard "Signals Today" shows 0 — likely because pipeline hasn't run (GEMINI_API_KEY issue), plus timezone handling could cause edge cases.
- Dashboard mood block, AI Signal Bar are hardcoded static strings.
- Trends page is entirely hardcoded with 12 static signals — no live data.
- CompactStoryCard expands on hover only, not click (touch device issue).
- Company Intel route `/company` is correctly mapped in sidebar (not a code bug).

**Data Integrity**
- All Supabase queries correctly use `ingested_at` for article ordering.
- `briefings` table correctly uses `created_at` for its own timestamps.
- RLS on `articles` and `briefings` needs verification for anon SELECT.

**Output Quality — PRIMARY CONCERN**
- Company Intel memo prompt instructs model to output Company Brief verbatim (Wikipedia-level description) and describe facts without interpretation. Produces "I could have Googled this" output.
- Morning/Evening Brief section prompts are well-structured but lack a conviction requirement — sections describe what happened without stating what it means.
- Thesis generation prompt is the best in the codebase (testable claims, IB-grade language) but lacks action statements.

### Prompt Changes Recommended (Priority Order)
1. **Company Intel prompt** — Replace "output verbatim" Company Brief with analyst positioning. Add "so what" and conviction to Recent Developments and Key Watchpoints. (Effort: M)
2. **Synthesis section prompts** — Add conviction sentence rule to all sections: end with position, not description. (Effort: S)
3. **Thesis prompt** — Add action statement requirement: what to buy/sell/watch and what invalidates. (Effort: S)
4. **Cross-section coherence rule** — Connect macro signals to deal implications across sections. (Effort: S)

### Immediate Action Required (2026-04-10, PARTIALLY RESOLVED)
1. ~~Add `GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}` to schedule.yml env block~~ — DONE (e9e235a)
2. Verify `google-genai` is in requirements.txt (or add `pip install google-genai` to workflow) — Verify in next run
3. Keep `GROQ_API_KEY` in schedule.yml (still needed for deal_extractor.py) — Still active

### Waiting on Lucas
- ~~Thesis Board UI upgrade (in progress)~~ — DONE: phases 2–6 shipped with grading, pattern memory, adversarial testing, source credibility, pattern library feedback
- ~~Autonomous improvement loop (scope unknown)~~ — DONE: implemented across phases 2–6
- Do NOT modify: thesis-board/page.tsx, /api/theses/route.ts (until next Lucas cycle)

### Open Questions
1. ~~Has GEMINI_API_KEY been added as a GitHub Secret?~~ — RESOLVED: confirmed in schedule.yml env block (e9e235a)
2. Is deal_extractor.py staying on Groq intentionally?
3. ~~What is Lucas's scope for the autonomous improvement loop?~~ — RESOLVED: 12-step pipeline with thesis grading, pattern memory, source credibility, adversarial review (phases 2–6 shipped)
4. Are there active paying users? (determines urgency of fixes)
5. Status of middleware.ts → proxy.ts rename (Next.js 16 deprecation)

## Recently Completed (2026-04-28 evening — three-PR session)

**PR #134 — deal extractor restore (merged):** Diagnosed 8-day deal_flow staleness. Root cause: PR #101 (Apr 19) migrated deal_extractor to Gemini with model `gemini-2.0-flash`, deprecated by Google. Calls returned 404 silently. Fixed via three changes: (1) bumped GEMINI_MODEL to "gemini-2.5-flash" matching synthesize.py, (2) deal_extractor.run() returns {extracted, upserted} dict, (3) run.py wraps deal step in try/except and threads status through observe.record_run, downgrading status to "degraded" when synth succeeds but deal step fails. Validated: 22 fresh deal_flow rows in tonight's 8pm cron, including Hut 8 $3.25B Debt Financing and Ineffable Intelligence $1.1B VC Round.

**PR #129 — lead-preselect v1, M&A Filter A + Filter B (merged):** Path B from SPEC_path_b_lead_preselect.md. Deterministic Python pre-picker chooses primary_story from deal_flow before Gemini synthesis. M&A Filter A (priced $1B+ M&A with named acquirer) → Filter B macro/geo/sector fallback → Gemini in-prompt fallback. Originally an "overnight draft" PR; cleaned up tonight: title rewrite, description rewrite (narrow scope explicit), rebase against main with PR #134 conflict resolved, in-code rename to "M&A Filter A" in docstrings (function names unchanged). Branch was in agent worktree at .claude/worktrees/agent-a53475761303c7358; cleanup queued.

**PR #135 — Filter A2 priced non-M&A (merged):** Audit-driven follow-up. 30-day audit (.session-artifacts/2026-04-28/audit/AUDIT_REPORT.md) showed 20 non-M&A $1B+ events vs 3 M&A — Filter A's named-acquirer gate excluded the larger pool by construction. Filter A2 mirrors Filter A's structure but with deal_type allowlist (VC Round, IPO, Debt Financing, Series A-F), no acquirer requirement, $1B threshold, observed-corpus keyword vocabulary anchored on "raised $" / "raises $" / "priced at" / "pricing of". Conservative v1: zero-corpus-hit defense-in-depth keywords for SPAC/PIPE/convertible/down-round failures intentionally omitted; will add in v2 when production data shows real failures. Observability hook: pipeline_runs.preselect_decision JSONB column persists per-run filter decision log for v2 calibration. Migration applied to prod Supabase (column added, verified). Smoke tests passed 4/4. V2 replay against tonight's pool picked X-Energy IPO ($1.02B, closed) — exactly the failure mode Filter A excluded.

**Pending follow-ups from tonight:**
- Harness env loading: .session-artifacts/2026-04-28/run_synth.py doesn't auto-load backend/.env. Add `load_dotenv("backend/.env")` for future replays.
- Tomorrow morning validation: confirm pipeline_runs.preselect_decision populates with decision log on next cron.
- 7-14 days of preselect_decision data → review for Filter A2 v2 calibration (real failure modes vs hypothesized).
- observe.py MODEL_INGEST/MODEL_SYNTH stale strings still say llama; 3-line cleanup queued for separate PR.
- Locked agent worktree at .claude/worktrees/agent-a53475761303c7358 ready for `git worktree remove --force`.

**Open Questions resolved tonight:**
- "Is deal_extractor.py staying on Groq intentionally?" → No, migrated to Gemini in PR #101 (Apr 19), restored to working state in PR #134.
- "Are non-M&A priced events covered by Filter A?" → No (by construction). Filter A2 added in PR #135.

## Recently Completed (2026-04-27)
**Bugfix & decision handoff for Noah:** PR #132 ready (5 fixes: React hydration, evening-wrap styling, migration audit with 19 items cataloged). Intelligence sprint branch preserved, 8 commits pending merge with expected conflicts. Identified blockers for Noah: PR #131 missing dependencies (@react-pdf/renderer, resend, @react-email/*), 7 TS errors from PR #131 files, framer-motion missing, 14 Supabase migrations STATUS UNKNOWN vs production. Full decision matrix in BUGFIX_NOTES.md and Pending Issues.

## Recently Completed (2026-04-25)
**PR #132 — Bugfix pass (5 commits):** React hydration mismatch on `/evening-wrap` and `/morning-brief` fixed via `useState` lazy initializer; Evening Wrap TODAY'S STORY pill muted to match morning-brief (PR #125); migration catalog audited (19 items: 7 REQUIRED, 7 OPTIONAL, 3 branch-only, 1 post-merge, 1 informational). All 14 pages smoke-tested via dev server. Noah has 3 open draft PRs (#129–#131, DO NOT MERGE); `lucas/intelligence-sprint` branch ready to merge (expect conflicts in synthesize.py, morning-brief, evening-wrap, trends, settings). `next build` fails (missing PR #131 packages); dev server works fine.

## Recently Completed (2026-04-23)
**Four-PR morning-brief stabilization sprint (PRs #124–#127 shipped to prod):** sentiment persistence in deal_extractor/deal_flow (recovered silent failures since PR #123); masthead Direction C gradient + mood bar type extensions ('mixed', 'watch'); Top Deals grid collapse (3→2→1 cols) + TODAY'S LEAD pill muted + Active Theses pill harmonization via shared SentimentPill; filter_undisclosed_deals() post-process in synthesize.py; no-cliché LANGUAGE CONSTRAINT block in MORNING_SYSTEM, EVENING_SYSTEM, deal_extractor SYSTEM_PROMPT. Validated sentiment persistence at WTI $97 vs CNBC. Pipeline A/B confirmed independent. HANDOFF.md should distinguish verified facts from spec claims from bug hypotheses — conflating led to plan corrections this session.

## Recently Completed (2026-04-21)
**Track record & trends polish (PRs #116–#117 merged to main):** Hybrid thesis grader (confidence scores, history, adversarial evidence), manual trigger endpoint + daily cron. Trends page signal radar redesign (tiered cards, integrated header, compact filters, two-line labels, hover preview with source articles). Track record empty state fix (gate on zero graded theses, not zero confirmed+invalidated). Schema reconciliation: discovered 20260416_add_theses_user_id.sql unapplied to production — per-user DB scoping missing (app-layer only); `sql/theses_current.sql` captures actual 26-column live schema. *Follow-ups pending for Noah:* After #118 merges, run `sql/0001_cleanup_zero_signal_calibration_rows.sql` in Supabase to wipe ~10 zero-signal rows; decide whether to ship user_id migration.

## Recently Completed (2026-04-20)
**Dark mode overhaul (PRs #108–#110 merged to main):** New CSS token system (5-level surface depth + warm off-white text + consistent border tokens) in `src/styles/tokens.css` and Tailwind mappings in globals.css. 10+ components patched (sidebar, topbar, mood-bar, brief-section, feed-row, deal-card, etc.). `dark-mode-overhaul` branch includes `src/lib/deal-utils.ts` getDealTypeStyle() and `src/lib/sector-colors.ts` rewrite (semantic pill color mapping via getTagPillStyle()) not yet merged separately to main.

## Recently Completed (2026-04-19)
**Deal Flow personalization and saved deals (PRs #104–#107 merged to main):** Two-column layout with analytics sidebar (268px: Pipeline Velocity, By Deal Type, Top Sectors, Largest Deals); company deduplication via `normalizeCompany()`. User profile integration: sector tracking/other split, watchlist highlighting, sector filter nudge. Saved deals table + RLS + `/api/saved-deals` server route; `/saved` page with sort controls, fade-out unsave, CSV export. Relevance scoring: `dealRelevanceScore()` + gold dot/border system (≥1.5 threshold); high-relevance row in sidebar. Fire-and-forget event tracking (`thesis_viewed`, `memo_generated`, `sector_filter_applied`) → `inferred_sector_weights`. **Manual Supabase steps:** Run `GRANT SELECT, INSERT, DELETE ON user_saved_deals TO authenticated` on any new environment. Gold dots won't appear until 4+ behavioral events compound past 1.5 threshold.

## Tomorrow Morning Validation Checkpoint (2026-04-24 after 6am PST)

After the first morning cron run (6am PST Friday 2026-04-24), validate all four PRs:

1. **Sentiment persistence:** `SELECT count(*) FROM deal_flow WHERE sentiment IS NOT NULL AND created_at > now() - interval '24 hours';` (expect > 0)
2. **Brief generation:** `SELECT count(*), max(created_at) FROM morning_brief_calls;` (expect > 0)
3. **Top Deals lead entries:** Visit `/morning-brief` — "See lead." entries should have NO filler appended
4. **Undisclosed filter:** Visit `/morning-brief` — Top Deals should have fewer or zero "Undisclosed" cards (grid should collapse if filter removed deals)
5. **No-cliché constraint validation:** Lead card, Analyst Briefing, Market Pulse narrative — count banned constructions. If materially lower than tonight's 6-per-brief, constraint is working. If not, escalate to **Approach B** (post-generation regex detector), NOT more prompt tuning.

## In Progress (2026-04-21)
**PR #118 track-record-polish (branch: noah/track-record-polish):**
- Honest empty states + backend data-layer gating for Pattern Memory and Source Credibility (previously frontend-only).
- Two commits: `4513ea7` (main implementation) and `4744b70` (fix querying thesis_verdicts instead of stale theses.outcome mirror).
- Includes `sql/0001_cleanup_zero_signal_calibration_rows.sql` for manual execution after merge (Supabase SQL editor).
- Awaiting Noah's preview QA (Vercel-SSO-gated previews); PR comment #118 has full visual checklist.
- **Schema follow-up:** Discovered 20260416_add_theses_user_id.sql never applied to production. Per-user DB scoping and dedup unique index exist only at app layer. `sql/theses_current.sql` is ground truth (26-column live schema). Decide whether to ship user_id migration with this sprint or defer.

## Recently Completed (2026-04-19)
**Opening screen cinematic landing redesign (noah/opening-screen merged to main):** Full-viewport component with 4-column scrolling signal feed background (16 real deal/market signals, 4 parallax speeds), dark vignette + amber scan line (6s sweep). 7-step animation sequence: wordmark fade → divider extend → tagline letter-spacing → feed blur-to-sharp → hero copy up → stats row up → scan line activate. Two CTAs: "Get Started" → /auth, "Explore Preview" → /preview. Stats: 25 Sectors, 600+ Companies, 200+ Deals, 2 Daily Briefs. Zero external animation libraries. Signed-out users render OpeningScreen; signed-in still redirect to /dashboard. Fixed .gitignore for frontend/.next/ and frontend/node_modules/.

## Recently Completed (2026-04-18)
**V4D Phase 2 — Signed-out shell experience (PR #100 merged to main):** PreviewContext + tri-state auth in AppShell; redirects signed-out → `/preview`, signed-in → `/dashboard`. Added dark espresso banner + sidebar CTA. Content gates on `/trends` (first 3 signals) and `/company` (first 6 companies) with gradient fade, lock icons, SignInModal. Auth detection: `getUser()` resolves ~200ms post-mount, initializes `isSignedOut: false` to avoid tri-state timing bug. `/proxy.ts` whitelist expanded for public routes.

**Watchlist V4C sprint (PR #99 merged to main):** XLSX Summary dedup fix, price alert UI + `/api/watchlist-alerts` route, price alert trigger in watchlist_sync.py with 4h cooldown. Requires manual Supabase migration: `backend/watchlist_alerts_schema.sql`.

## Recently Completed (2026-04-17)

**Watchlist V4B sprint (PR #98 merged to main):** Real SheetJS XLSX export replacing fake CSV — Articles + Summary worksheets, 30-day window, 2000-row cap. In-app notification infrastructure — `watchlist_notifications` table + `/api/watchlist-notifications` (GET/PATCH/DELETE); bell icon in sidebar with amber badge, slide-in drawer (inline style transition), mark-read/mark-all-read. Supabase Realtime watchlist count badge in sidebar. Mobile watchlist layout — `isMobile` state + resize listener, sticky bottom bar, full bottom sheet. Keyboard nav audit/fixes on watchlist pages. Relevance scoring improvements in `watchlist_sync.py` — boilerplate penalty (`BOILERPLATE_PATTERNS`), prominence boost, `score_breakdown` JSON column in `watchlist_articles`. GDELT conditional on `exa_count < 5`. Article clustering UI in `[identifier]/page.tsx` — Jaccard similarity + capitalized entity overlap via `src/lib/clustering-utils.ts`, expandable "N more sources" rows.

**Watchlist V4A sprint (PR #97 merged to main):** Drag-to-reorder via HTML5 DnD with optimistic UI + `PATCH /api/watchlist-reorder`; `sort_order` column added (migration: `backend/watchlist_sort_order_migration.sql` — **must run manually in Supabase**). Keyboard navigation: J/K/Enter/A/Esc/? on `/watchlist`, J/K/O/B/N/Esc on identifier detail page, with `isTyping`/modal guards. Export: company PDF via `window.print()` + `#company-print-content`, full watchlist print at `/watchlist/export`, CSV at `/api/export/watchlist-xlsx`. Story clustering in `watchlist_sync.py` using Jaccard token similarity + financial entity overlap (48h window); three helpers: `_title_tokens`, `extract_key_entities`, `is_same_story`. Tailwind v4 safelist: `@source inline(...)` in globals.css forces class generation; identifier page borders switched to inline styles.

## Recently Completed (2026-04-15)
**watchlist_sync.py overhaul (PR #95 open):** GDELT rate limiting (1.5s sleep after each fetch), Exa recency filter (startPublishedDate 30 days ago), post-fetch age filter (articles >35 days or future-dated dropped before scoring), Exa payload restructure (highlights moved into contents.highlights, added type/news to query, bumped to 400 chars/3 sentences), fixed Exa response parsing, URL quality filter (is_article_url() + BLOCKED_DOMAINS/BLOCKED_URL_PATTERNS; LinkedIn/Twitter/Crunchbase/jobs/profiles/homepages filtered), title length floor (≤15 chars dropped), relevance scoring overhaul (NOISE_TITLE_PATTERNS + FINANCIAL_BOOST_PATTERNS, +2 title match/+1 summary/+1 financial/-3 noise/-1 short, floor <3 rejected).

## Recently Completed (2026-04-15, prior)
**Watchlist v2 interactive enhancements (PR #94 merged):** Clickable article headlines linking to news sources; public/private split (private markers); GDELT fallback route for zero-article entries; display name cleanup (ticker prefix removal, proper company names); stat counters (articles fetched vs total displayed); expert brief quality upgrade (analyst positioning, conviction rules). New `/api/news-search` route for GDELT-powered article discovery. Multi-identifier strategy: Finnhub ticker search, Clearbit company search, GDELT fallback. Enhanced watchlist modals with clickthrough interactions.

## Recently Completed (2026-04-15)
**Watchlist Overhaul (noah/watchlist-overhaul merged):** Two-column layout with per-identifier drill-down, unified WatchlistAddInput (ticker/company/sector with Finnhub/Clearbit autocomplete), stale sector auto-migration, per-entry article fetching (`fetchArticlesForEntry` + multi-strategy `.in()/.ilike()` filters, fuzzy match with suffix-stripping), Finnhub news fallback for zero-article tickers, Finnhub ticker search route, Clearbit company autocomplete, brief-on-entry modal at `/watchlist/brief?identifier=&type=` (Gemini memo from recent articles), HTML-stripping utility, short ticker guard (<4 chars), extended Finnhub window to 30 days, fixed GS subtitle alignment, PostgREST 400 fix. **Signal Strength & Credibility Badges:** article-signal.tsx exports `getCompleteness()` (FULL/PARTIAL/SNIPPET), `getAdjustedScore()`, `CompletenessBadge`, `SignalScore`, `SourceCredibilityBadge` (reads `source_credibility` table); used in feed-row, company intel. **Brief Feedback Loop:** `brief_feedback_loop.py` computes rolling quality signal from `brief_quality_scores` + `selection_audit`, injects self-improvement addendum into next synthesis via `pipeline_runs.brief_addendum` (new columns + migrations). **Track Record Page:** live at `/track-record`, shows thesis outcomes over time from `user_thesis_states`. **UI Explainability:** WhyThisThesis component explains thesis reasoning; TickerContext shows 1d change + 52w range on thesis cards via Finnhub. **Full-Text Scraping:** `fulltext.py` scrapes open-access sources, `backfill_content.py` backfills existing articles; ingest.py calls fulltext scraper. **AI-Personalized Briefs/Memos:** `/api/briefing` and `/api/memo` inject user profile (sectors, role) into generation prompt. **MemoModal Markdown:** proper heading/bullet/bold rendering. **Trends Live:** `/trends` page dual-dimension taxonomy (industry_verticals + activity_types) with live filter pills. **System Intelligence Widget:** dashboard widget shows pipeline health, article count, brief quality. **UI Polish:** morning brief, evening wrap, fonts, conviction ring, onboarding consolidated to single `OnboardingModal.tsx`. **Personalization system consolidation:** Merged dual conflicting preference systems into single source of truth (`user_profiles` table + `/api/user-profile` route + `useUserProfile()` React Context hook). Deleted stale `/api/preferences`, `/settings`, `/onboarding` pages + duplicate onboarding modals. Fixed profile settings 401 errors via cookie-based auth + RLS migration (single FOR ALL policy). Created `user_thesis_states` junction table for per-user thesis archive state. All consumers now use shared `useUserProfile()` hook. `user_preferences` table can be dropped.

## Recently Completed (2026-04-14)
PR #88: company intel filter accuracy — explicit sector-to-vertical mapping (COMPANY_VERTICAL_OVERRIDES 74-entry ground-truth map + SECTOR_TO_VERTICAL fallback); primary_company attribution guard prevents PE firms accumulating wrong tags. PR #87: dual-row filter UI on /deal-flow (Activity Type + Sector rows, Match Any/All toggles, Clear All button); vertical filter consistency across /company and /deal-flow. Cron-job.org Evening job updated: request body now passes `{"ref":"main","inputs":{"mode":"evening"}}` (was missing mode input, defaulted to morning, causing stale Evening Wrap).

## Recently Completed (2026-04-13)
ConvictionRing CSS refactor (conic-gradient donut) + drag-to-archive RLS fix: replaced SVG strokeDasharray (broken by Tailwind v4 preflight CSS overriding strokes) with CSS conic-gradient; inner circle now uses `.conviction-ring-bg` CSS class with context-aware color overrides (`.bg-parchment-mid .conviction-ring-bg`, `.bg-cream .conviction-ring-bg`); unfilled arc warm tone (#3a3530); PATCH `/api/theses/[id]` route fixed 500 error via `supabaseAdmin` client using `SUPABASE_SERVICE_ROLE_KEY`; removed conviction text badges from ThesisList.tsx; added detailed logging (`=== PATCH START/FAILED ===`). Service role key added to .env.local. Key files: ConvictionRing.tsx, ThesisList.tsx, route.ts, globals.css.

## Recently Completed (2026-04-13)
AUTONOMOUS_IMPROVEMENT_PLAN.md brought up to date (commit 240c713): now reflects the actual 12-step pipeline (steps 9–12 thesis_grader, pattern_memory, source_credibility, adversarial added); three previously undocumented Supabase tables documented (pattern_library, weekly_digests, source_credibility_scores); all sector/SECTORS language updated to dual-dimension taxonomy (industry_verticals + activity_types); Phase Status section (§5) added with live/complete table and explicit deferred items list; section numbering corrected (now 1–15).

Sector taxonomy migration complete: observe.py, trend_mapper.py, and feed-row.tsx migrated from single `sector` field to dual-dimension taxonomy. observe.py pool query now fetches `industry_verticals` and `_reconstruct_selected()` uses `(industry_verticals or [sector])[0]` to exactly mirror synthesize.py selection logic. trend_mapper.py `fetch_run_context()` fetches `industry_verticals` and `_normalize_article()` resolves sector as `industry_verticals[0]` with fallback — cascades to all 7+ downstream cluster functions (make_cluster_key, make_cluster_label, compute_pairwise_similarity, detect_cluster_surfacing, pattern boost, etc.) without further changes. feed-row.tsx thesis button now uses `industry_verticals[0]` before falling back to `sector`. No Supabase schema changes needed (sector backward-compat column still populated by ingest.py). tsc clean. commit: 1ddb0e0.

Dual-dimension sector taxonomy system (phases 2–7): Backend types + color system (phase 2–4, c3c1d22); user preferences UI wiring (phase 7, e857d59); pill rendering in feed/story cards with two-color system (phase 5, 0615a26); full filter bar redesign with terminal-style chips and inline active colors (phase 6, 43cea15); simplified pill rendering to blue verticals + gold activity types (a6ba43f). Merged to main via PR #85.

## Recently Completed (2026-04-12)
PRs #79–#82 entity quality and pipeline stability: PR #79 added blocklist (currencies, countries, gov bodies, law firms) and keyword pre-filter (class action / law firm) to ingest; extended isJunkEntityName() in frontend. PR #80 rewrote Gemini prompt for typed `{name, entity_type}` extraction, added Wikidata validation module with Supabase caching. PR #81 fixed articles.companies being written with raw Gemini output (now uses clean_companies list); fixed KeyError from unescaped braces in prompt. PR #82 fixed stub briefing issue — Gemini thinking tokens consumed max_output_tokens budget; disabled thinking and raised max to 4096. Pipeline now fully wired end-to-end (extraction → blocklist → Wikidata → clean_companies); ready for production validation at scale.

## Recently Completed (2026-04-11)
PR #78 (feat/company-intel-prompt-rewrite) iterative refinement: 8 cumulative prompt rule updates to buildMemoSystemPrompt() — analyst brief opener rule (proper noun required, "The" banned), low-recognition company carve-out (exception format), What Just Changed development filter (dollar figure/counterparty/product required), Cross-Signals binary verdict rule (exact format), What To Do With This bullet structure (if/then format, 75-word cap), sourcing discipline (all figures traceable to article pool), length rule (signal density not target), em-dash ban, expanded banned phrase list. Validated against live Supabase pools (NVIDIA 20 articles + Anthropic 20 articles); all figures sourced, no training knowledge leakage. Lucas's phases 2–6 commits merged in (thesis grading, pattern memory, adversarial testing, source credibility, pattern library feedback); GEMINI_API_KEY pipeline bug (previously critical) resolved via Lucas's e9e235a commit.

## Recently Completed (2026-04-10)
Full Groq→Gemini 2.5 Flash migration: frontend routes (theses, memo, thesis-detail, thesis-regenerate), backend ingest/synthesize, batch article filtering (166→127 articles, ~18min→2min pipeline), cluster-driven thesis gen, SEC/Fed feeds added, Gemini response parsing hardened (thinkingConfig, multi-fallback JSON), React hydration fix (Math.random()→deterministic), both repos clean on main, gh CLI auth set up.

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

## Outstanding Work Tiers

**TIER A** (Blocking, ship immediately)
- None — all shipped or validated not-a-bug.

**TIER B** (High priority, real product sprint)
- **Lead selection scoring rework** — Switch top_deals selection from first-match order to AIP/Honeywell-over-Tesla/SpaceX scoring. Biggest open product question. Real product sprint, 2–4 hours.

**TIER C** (Medium priority, shipped with validation)
- **No-cliché LANGUAGE CONSTRAINT** — SHIPPED as PR #127 (2026-04-23). Validate tomorrow morning via checkpoint #5. Iterate to **Approach B** (post-generation regex detector) if needed, NOT more prompt tuning.

**TIER D** (Ops/conversation)
- **Ingestion cadence decision** — Ops conversation with Lucas; affects cron timing and brief freshness.

**TIER E** (Multi-day, deferred)
- **Sentiment subject tagging** — Extend sentiment field with subject markers (macro/sector/company). Multi-day work, deferred.

**TIER F** (Data layer, deferred)
- **Real comp data integration** — Polygon/FMP API integration + Lucas budget conversation. Deferred.

## Pending / Known Issues

**Just merged (2026-05-01 evening) — Wave 2 orchestration complete**
- **PR #175 — fix(email): morning brief polish + view-in-browser, issue numbering, unsubscribe** — branch w2/email-polish, ready-for-review. New `sql/brief_email_unsubscribe.sql` DDL (adds `briefings.issue_number int`, `user_profiles.brief_email_subscribed bool`; idempotent). Email helpers: site-url resolver, issue-number caching (MAX(issue_number)+1 strategy, soft-fail if column missing), HMAC-sha256 unsubscribe tokens. New `/api/unsubscribe` GET/POST route (RFC 8058 one-click). Updated brief email template (View-in-browser bar, Issue #N line, footer Unsubscribe link). Updated send-email route (per-recipient loop, List-Unsubscribe headers, filterUnsubscribed() opt-out, ensureIssueNumber() caching). Schema deviation noted: spec called for sent_at + COUNT(*) numbering, but `briefings` has no sent_at column; used MAX(issue_number)+1 instead. **MANUAL STEP REQUIRED:** Apply `sql/brief_email_unsubscribe.sql` to prod Supabase before merging.
- **PR #171 — fix(ui): unify user avatar component across shell** — branch w2/avatar-consistency, ready-for-review. Bug: topbar hardcoded brand "S" glyph, ignored computed `userInitials` prop. Sidebar correctly computed initials. New `src/components/shell/user-avatar.tsx` (single source of truth for avatar rendering; topbar/sidebar variants). Files touched: user-avatar.tsx (new), topbar.tsx, sidebar.tsx, app-shell.tsx, index.ts. tsc clean; lint net -1.
- **PR #173 — AUDIT: Entity resolution current state** — branch w2/entity-resolution-audit, read-only. Single doc: docs/entity-resolution-audit.md (398 lines). Headline: no canonical entity ID; every table holds free-text names; two parallel canonicalization layers (backend + frontend) don't share state. Alias table + canonical_id FK swap recommended (reversible, unblocks W2-B/C/H, 2-3 eng days + 1-2 weeks observation). **Lucas coordination required** before W2-A starts.
- **PR #172 — AUDIT: Track record evidence chain** — branch w2/track-record-evidence-audit, read-only. Single doc: docs/track-record-evidence-audit.md (379 lines). KEY: thesis_verdicts already has notes + key_evidence_ids (written nightly by thesis_grader.py). Surfacing the "why" panel needs ZERO new ingestion, ZERO new LLM spend. Five product questions in doc for Noah to answer (voice / schema / LLM / placement / scope).
- **PR #174 — AUDIT: Company intel current state + improvements** — branch w2/company-intel-current-state, read-only. Single file: docs/company-intel-current-state.md + 5 screenshots. Headline: search gap is structural (441-row table, no fallback path, bars found entries for Anduril/Mistral/Stripe/Perplexity). Memo is strong (9 patterns documented to preserve). No persistence (each click re-spends budget, no company_memos table). Mobile fails (3-col grid doesn't collapse, names truncate). Recommended: Strategy C (memo-led + directory depth), ship Strategy A first (web-search fallback).
- **PR #170 — fix: contact email + legal nav + stale domain** — merged at e1d19ee. Email swap: `lucasturcuato@gmail.com` → `admin@signalera.ai`. Legal nav: added `src/app/legal/layout.tsx`. Domain: `breakingalpha.vercel.app` → `signalera.ai` in intros.
- **Local worktrees — ready for cleanup:** `/Users/noahhanning/ba-w2-email` (PR #175), `/Users/noahhanning/ba-w2-avatars` (PR #171), `/Users/noahhanning/ba-w2-entityaudit` (PR #173), `/Users/noahhanning/ba-w2-evidenceaudit` (PR #172), `/Users/noahhanning/ba-w2-cintelaudit` (PR #174). Plus three Wave 1 worktrees: `/Users/noahhanning/ba-w1-mood`, `/Users/noahhanning/ba-w1-trackrec`, `/Users/noahhanning/ba-w1-briefload` (all branches merged).

**URGENT — OAuth auth redirect broken after domain migration to signalera.ai**
- **Symptom:** Google OAuth sign-in redirects to landing page (`/`) instead of `/dashboard` after domain switch from `breakingalpha.vercel.app` to `signalera.ai`.
- **Root cause:** Supabase Auth dashboard Site URL + Redirect URLs allowlist still pinned to old `*.vercel.app` hosts. Full diagnosis in `docs/auth-redirect-diagnosis.md` (just committed, see hypothesis (b) = primary suspect, trace at §Trace of the failing flow).
- **Manual fix required (Noah — no code changes needed):** (1) Supabase project → Authentication → URL Configuration. Set Site URL to `https://signalera.ai`. Add to Redirect URLs: `https://signalera.ai/**`, `https://www.signalera.ai/**` if applicable, and Vercel preview glob. (2) Vercel prod env: set `NEXT_PUBLIC_SITE_URL=https://signalera.ai` (PDF/print only). Redeploy. (3) No Google Cloud changes needed. See `docs/auth-redirect-diagnosis.md` sections A–E for details + verification steps.
- **Impact:** Users cannot complete OAuth sign-in on signalera.ai; feature is broken in production. **Do this before next user-facing deployment.**

**Pending DDL and migrations (2026-05-01 evening)**
- **sql/brief_email_unsubscribe.sql** — Email feature (PR #175) requires manual Supabase DDL apply before merge: adds `briefings.issue_number int`, `user_profiles.brief_email_subscribed bool default true`. Idempotent. **REQUIRED before merging PR #175.**
- **sql/live_score_columns.sql** — Track-record live-score feature requires manual Supabase DDL apply: adds `live_score`, `live_verdict`, `confidence_score` (nullable) columns + ranking indexes. Frontend renders correctly without it (TS fallback), but backend persistence won't write until applied. Apply at your convenience (not blocking, but enables backend-driven data persistence).

**Wave 2 Next Steps — Product Decisions Surfaced by Audits**
- **W2-A: Entity resolution strategy** — Alias table + canonical_id FK swap (PR #173 audit) recommended as reversible path. Unblocks W2-B/C/H. Requires Lucas coordination on synthesize.py, ingest.py, wikidata.py, company-intel.ts before starting. 2-3 eng days + 1-2 weeks observation. Decision: approve strategy or explore alternatives?
- **W2-I: Track-record evidence "why" panel** — PR #172 audit surfaces five open questions (voice/schema/LLM/placement/scope). thesis_verdicts already has notes + key_evidence_ids written nightly; no new ingestion/LLM spend needed. Answer questions in PR #172 doc before sprint planning.
- **Company Intel direction: Strategy A/B/C choice** — PR #174 audit. Strategy A (web-search fallback for un-indexed companies, closest to "better than Google"). Strategy B/C deferred (memo persistence + directory depth). Pick A / A+cleanup / or revisit B/C first?
- **Manual Supabase config still pending** — Supabase Auth Site URL + Redirect URLs allowlist (OAuth broken on signalera.ai until fixed). NEXT_PUBLIC_SITE_URL=https://signalera.ai in Vercel prod env (for email/PDF links).

**From prior three-PR session (2026-04-28) — deferred**
- **ENV loading in replay scripts** — .session-artifacts/2026-04-28/run_synth.py doesn't auto-load backend/.env. Add `load_dotenv("backend/.env")` for future replays.
- **Locked agent worktree cleanup** — .claude/worktrees/agent-a53475761303c7358 ready for `git worktree remove --force`.
- **observe.py stale model strings** — MODEL_INGEST/MODEL_SYNTH still say llama; 3-line cleanup queued for separate PR.
- **preselect_decision validation timing** — Confirm pipeline_runs.preselect_decision column populates on next cron.
- **Filter A2 v2 calibration window** — 7-14 days of preselect_decision data needed to review real failure modes vs hypothesized (earliest viable: 2026-05-05).

**Post-sprint follow-ups (new, 2026-04-23) — PARTIALLY RESOLVED**
- **Three migration directories with two naming conventions** — `supabase/migrations/`, `backend/migrations/`, `sql/` — need canonical-dir decision with Lucas.
- **Pill consolidation debt** — 9 non-Active-Theses pill usages still on `Badge` or duplicate SentimentPill copies. Follow-up PR to consolidate fully.
- **Three duplicate SentimentPill implementations** — `dc-story-row`, `morning-brief` page-local, `evening-wrap` page-local should consolidate to shared `src/components/ui/sentiment-pill.tsx`.
- **`stash@{0}` WIP preserved** — `feat/brief-polish-pass` (sentiment wording + panoramic pulse + `inspect_pulse` helper) still stashed. Decide next session: redundant with #123? incremental? discard?
- **Vercel preview protection bypass token** — `backend/.env` contains `VERCEL_PROTECTION_BYPASS` for automation access to preview URLs without SSO wall.

**Still open — carry forward from prior sessions**
- **PR #129 (lead-preselect v1) — stays draft pending re-test** — priced-deal primary path needs real `deal_flow` rows with $1B+ M&A deals; blocked by deal_flow staleness. Last test triggered macro-fallback path only.
- **deal_flow staleness** — last reported 2026-04-17 (pre-Wave 2). Blocks PR #129 validation. Verify current state on next cron run.
- **React #418 hydration error** — caught on `/morning-brief` and `/evening-wrap` during prior prod smoke test. PR #167 may have addressed via page-transition removal of `mode="wait"`, verify on next validation pass.
- **Personalization addendum investigation** — neither prior smoke-test PDF showed visible "For You" addendum content. Three hypotheses (user_briefings.addendum empty / render path broken / API drops field). Diagnostic query in handoff § 4.1 (old session).
- **PDF design overhaul** (proposed PR #134) — Newsletter-style redesign of `src/components/brief/print-brief.tsx`. Not blocking.
- **Three Wave 1 git worktrees — ready for cleanup:** `ba-w1-mood`, `ba-w1-trackrec`, `ba-w1-briefload` (branches merged to main, worktrees can be removed).
- **Five Wave 2 git worktrees — ready for cleanup (after PRs merge):** `ba-w2-email`, `ba-w2-avatars`, `ba-w2-entityaudit`, `ba-w2-evidenceaudit`, `ba-w2-cintelaudit`.

## In Progress

(None currently; see Pending section for carry-forward items.)

**Existing (deferred or blocked)**
- **Duplicate watchlist rows (IONQ, NVDA, BRK.B, AAPL)** — Pre-existing issue. PR #156 makes pin/unpin work despite duplicates by ordering by `created_at DESC` instead of ASC. Manual SQL cleanup recommended. Also: orphan-pinned `_old` duplicate rows still hold stale `pinned_position` values from before PR #156 — invisible to UI (deduped) and self-heal on next pin to each affected slot. Worth post-launch check.
- **Unapplied 20260416_add_theses_user_id.sql migration** — Phase 1 personalization per-user DB-level scoping + dedup unique index (`idx_theses_user_title_sector_unique`) only enforced at application layer (`/api/theses` POST). Neither `user_id` column, nor indices exist in live schema. Decide: ship migration retroactively or accept app-layer enforcement indefinitely. Ground-truth schema snapshot at `sql/theses_current.sql` (26 columns, generated 2026-04-21).
- **PR #118 post-merge cleanup** — After #118 merges, manually run `sql/0001_cleanup_zero_signal_calibration_rows.sql` in Supabase SQL editor to wipe ~10 zero-signal rows from `pattern_library` and `source_credibility` tables.
- **Tier 2 saved deals RLS grant** — must run `GRANT SELECT, INSERT, DELETE ON user_saved_deals TO authenticated` manually in Supabase SQL editor for new environments (migration file incomplete).
- **Relevance scoring cold start** — gold dots won't appear on fresh accounts until 4+ behavioral events compound inferred_sector_weights past 1.5 threshold. Expected, not a bug.
- **V4C watchlist_price_alerts table** — must run `backend/watchlist_alerts_schema.sql` manually in Supabase SQL editor before price alert UI/trigger is functional.
- **V4B watchlist_notifications table** — must run `backend/watchlist_notifications_schema.sql` manually in Supabase SQL editor before bell drawer shows real data.
- **V4B score_breakdown column** — run `ALTER TABLE watchlist_articles ADD COLUMN IF NOT EXISTS score_breakdown jsonb` if column was not added via V4B migration.
- **Watchlist sort_order migration pending** — V4A drag-to-reorder requires manual execution of `backend/watchlist_sort_order_migration.sql` in Supabase SQL editor to add `sort_order` column. Frontend gracefully handles missing column (null defaults to created_at order) until migration runs.
- **Track Record outcome data sparse** — Page is live but sparse outcome data until more theses cycle through archive state over time; breadth will improve as user base grows.
- **ConvictionRing partial arc fill deferred** — Currently shows full colored circle with color-coding (gold=HIGH, amber=MEDIUM, gray=WATCH, red=BEARISH); arc visualization deferred due to Tailwind v4 preflight SVG interference. Can be revisited once CSS preflight handling is resolved.
- **Wikidata validation at scale** — wikidata_entity_cache now populated on cache misses; needs full ingest run with fresh articles to validate entity quality in production
- **E2E tests need Supabase credentials** — Playwright suite configured (10 specs, 48 tests) but pending valid E2E_USER_EMAIL, E2E_USER_PASSWORD in .env.local to run against real Supabase test user
- **middleware.ts → proxy.ts** — Next.js 16 deprecation warning; rename `src/middleware.ts` to `src/proxy.ts` (breaking change in v16+)
- **Google OAuth consent screen** shows Supabase project name instead of "Signalera" — update in Google Cloud Console > OAuth consent screen
- **StoryCard Thesis button** (dashboard story cards) still inserts a new thesis directly instead of matching existing ones — only FeedRow button was updated
- **COMPANY_IDENTITY map** (35 entries, hardcoded) should eventually migrate to `company_profiles` Supabase table (ticker, industry, brief, source fields) for broader coverage
- **user_preferences table can be dropped** — Confirmed no references remain after personalization consolidation; safe to drop from Supabase
- **Article full-content archival sparse** — `content` column populated only for open-access sources; paywall-gated articles remain at summary-only; acceptable limitation for now
- **Earnings calendar integration** — requires ticker field + FMP/Polygon API; deferred
- **Legacy data inconsistency (low priority)** — a few old DB rows have stale `deal_type`/`primary_company`; won't block progress; will correct via re-ingest over time

## Nav Tabs
1. Dashboard — greeting, stat cards, top stories, system intelligence widget
2. Morning Brief — daily AI brief, top deals, analyst sections
3. Evening Wrap — end-of-day brief
4. Live Feed — 150+ articles, real-time, sector filters, auto-refreshes 60s, signal strength badges
5. Thesis Board — AI-generated theses, conviction scores, detail panel with catalyst + evidence chain + explainability
6. Deal Flow — tracked deals, manual entry
7. Company Intel — auto-extracted companies, sorted by mention frequency
8. Trends — dual-dimension taxonomy (industry_verticals + activity_types), live filter pills, signal momentum
9. Watchlist — personalized ticker/company/sector tracking, two-column layout, matched articles feed, brief-on-entry
10. Track Record — thesis outcome history, conviction vs outcome scorecard
11. Settings — profile (from auth), sectors, modules, notifications, appearance, team

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
