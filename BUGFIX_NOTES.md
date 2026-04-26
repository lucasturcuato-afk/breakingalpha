# Bugfix Pass — 2026-04-25

Branch: `lucas/bugfix-pass-2026-04-25`

---

## Fix 1 — React #418 hydration mismatch on /evening-wrap (and /morning-brief)

**Root cause:** Both pages compute `const now = briefing?.created_at ? new Date(briefing.created_at) : new Date()` during render. The fallback `new Date()` yields different timestamps on the server (SSR) vs the client (hydration), triggering React warning #418.

**Fix:** Replaced the bare `new Date()` fallback with `useState(() => new Date())` so the value is created once and stays stable across the SSR-to-hydration boundary. Real briefings always carry `created_at`, so the fallback only guards a null edge case.

**Files changed:**
- `src/app/evening-wrap/page.tsx` (line ~395)
- `src/app/morning-brief/page.tsx` (line ~365)

---

## Fix 2 — user_briefings.addendum migration + null-safe read path

**Investigation result: NO CODE FIX NEEDED.**

The migration already exists at `supabase/migrations/20260416_create_user_briefings.sql`. The read path is already null-safe at every layer:

1. **API route** (`src/app/api/briefing/route.ts:311-338`): Query is wrapped in try/catch. If the `user_briefings` table doesn't exist or returns an error, it logs and returns `null`. The addendum value is checked with `typeof ... === "string"` before use.
2. **Frontend** (morning-brief line 241, evening-wrap line 261): `setUserAddendum` is only called when `typeof data.user_addendum === "string"`.
3. **Render** (morning-brief line 935, evening-wrap line 938): `userAddendum` is conditionally rendered only when truthy (`{userAddendum && (...)}`).

**For Lucas:** If the `user_briefings` table has not been created in production Supabase, run `supabase/migrations/20260416_create_user_briefings.sql` in the SQL editor. Until then, the addendum simply doesn't appear — no errors, no crashes.

---

## Fix 3 — Evening Wrap TODAY'S STORY pill mute treatment

**Bug:** PR #125 muted the morning-brief TODAY'S LEAD pill background from `HERITAGE_GOLD` (`#d4a84b`) to `#a88340`. The evening-wrap TODAY'S STORY pill was missed and still used the bright gold.

**Fix:** Changed `background: HERITAGE_GOLD` to `background: "#a88340"` on the TODAY'S STORY pill in evening-wrap.

**Files changed:**
- `src/app/evening-wrap/page.tsx` (line ~870)

---

## Fix 4 — Pending Supabase migrations catalog

### REQUIRED (hard-fail if missing)

| # | File | What it does | Hard-fail? | Status |
|---|------|-------------|-----------|--------|
| 1 | `backend/watchlist_sort_order_migration.sql` | Adds `sort_order` INTEGER to watchlist | YES — drag-to-reorder API crashes | STATUS UNKNOWN |
| 2 | `backend/watchlist_alerts_schema.sql` | Creates `watchlist_price_alerts` table | YES — all alert CRUD crashes | STATUS UNKNOWN |
| 3 | `backend/watchlist_notifications_schema.sql` | Creates `watchlist_notifications` table | YES — bell drawer CRUD crashes | STATUS UNKNOWN |
| 4 | `GRANT SELECT, INSERT, DELETE ON user_saved_deals TO authenticated` | RLS grant for saved deals | YES — saves silently fail | STATUS UNKNOWN |
| 5 | `supabase/migrations/20260416_create_user_events.sql` | Creates `user_events` table | YES — all event tracking fails | STATUS UNKNOWN |
| 6 | `sql/0003_brief_self_grading.sql` | Creates `morning_brief_calls` + outcomes tables | YES — grading pipeline crashes | STATUS UNKNOWN |
| 7 | `sql/0004_briefings_public_read.sql` | Adds anon SELECT policy to briefings | YES — shared brief links return 403 | STATUS UNKNOWN |

### OPTIONAL (code soft-fails gracefully)

| # | File | What it does | Behavior if missing |
|---|------|-------------|-------------------|
| 8 | `ALTER TABLE watchlist_articles ADD COLUMN IF NOT EXISTS score_breakdown jsonb` | Adds score_breakdown column | Score breakdowns not displayed, no crash |
| 9 | `supabase/migrations/20260416_create_user_briefings.sql` | Creates `user_briefings` table | "For You" addendum silently skipped |
| 10 | `supabase/migrations/20260416_add_theses_user_id.sql` | Adds `user_id` to theses (nullable) | Per-user thesis scoping not active; app-layer only |
| 11 | `supabase/migrations/20260416_add_inferred_weights.sql` | Adds inferred weight columns to user_profiles | Weights default to `{}`, preferences page shows empty |
| 12 | `supabase/migrations/20260416_add_strategy_horizon_workflow.sql` | Adds strategy/horizon/workflow to user_profiles | Onboarding fields not persisted |
| 13 | `sql/0005_briefings_morning_review_column.sql` | Adds `morning_review` JSONB to briefings | Evening wrap self-reflection section absent |
| 14 | `sql/0006_briefings_structured_body.sql` | Adds `lead_paragraph`, `supporting_context`, `what_to_watch` | Brief falls back to summary rendering |

### INTELLIGENCE SPRINT (on branch `lucas/intelligence-sprint`, not yet merged)

| # | File | What it does | Pre-requisite |
|---|------|-------------|--------------|
| 15 | `sql/brief_section_ratings_schema.sql` | Dedup + unique indexes + RLS on brief_section_ratings | Run BEFORE deploying sprint code |
| 16 | `sql/add_quality_score.sql` | Adds `quality_score REAL` to articles | Run BEFORE `python3 scripts/backfill_quality_scores.py` |
| 17 | `sql/add_contested_flag.sql` | Adds `contested_flag BOOLEAN` to trend_clusters | Run BEFORE deploying sprint code |

### POST-MERGE CLEANUP

| # | File | What it does | When |
|---|------|-------------|------|
| 18 | `sql/0001_cleanup_zero_signal_calibration_rows.sql` | Wipes ~10 zero-signal rows from pattern_library + source_credibility | After PR #118 merges |

### INFORMATIONAL

| # | File | Notes |
|---|------|-------|
| 19 | `sql/0007_cleanup_sector_breakdown.sql` | No schema changes — documents backend validation hardening |

**DO NOT run any of these against production.** This catalog is for Lucas to triage and execute manually in the Supabase SQL editor.
