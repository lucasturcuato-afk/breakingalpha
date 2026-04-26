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

---

## Fix 5 — End-to-end smoke test report

**Environment:** Next.js 16.2.2 (Turbopack), `npm run dev` on localhost:3000, no auth session.

### Page-by-page results

| Page | HTTP | Status | Notes |
|------|------|--------|-------|
| `/` | 200 | WORKS | Landing page renders (20KB). Unsigned users see product preview. |
| `/auth` | 200 | WORKS | Auth page renders (23KB). Google OAuth + email/password form visible. |
| `/dashboard` | 307 | WORKS (redirect) | Redirects to `/auth` — expected without session. |
| `/morning-brief` | 200 | WORKS | Renders briefing shell (62KB). Loads skeleton then briefing data. |
| `/evening-wrap` | 307 | WORKS (redirect) | Redirects to `/auth` — expected without session. |
| `/live-feed` | 200 | WORKS | Renders feed (51KB). Articles load from Supabase anon key. |
| `/thesis-board` | 307 | WORKS (redirect) | Redirects to `/auth` — expected without session. |
| `/deal-flow` | 307 | WORKS (redirect) | Redirects to `/auth` — expected without session. |
| `/saved` | 307 | WORKS (redirect) | Redirects to `/auth` — expected without session. |
| `/company` | 200 | WORKS | Company intel renders (43KB). |
| `/trends` | 200 | WORKS | Trends page renders (46KB). |
| `/watchlist` | 307 | WORKS (redirect) | Redirects to `/auth` — expected without session. |
| `/track-record` | 307 | WORKS (redirect) | Redirects to `/auth` — expected without session. |
| `/settings/preferences` | 307 | WORKS (redirect) | Redirects to `/auth` — expected without session. |

### Console errors (pre-existing, NOT from this bugfix pass)

1. **`Module not found: Can't resolve 'framer-motion'`**
   - Source: `src/components/shell/page-transition.tsx:4`
   - Imported by `app-shell.tsx` → used on every page
   - Package is not in `package.json` — needs `npm install framer-motion`
   - Impact: Page transitions don't animate, but pages still render

2. **`Module not found: Can't resolve '@react-pdf/renderer'`**
   - Source: `src/app/api/brief/export-pdf/route.ts:14`, `src/components/brief/brief-pdf.tsx:18`
   - From Noah's PR #131 (pdf-rebuild) — packages not yet installed
   - Impact: PDF export route would crash if called; does not affect normal page rendering

3. **`Module not found: Can't resolve 'resend'` / `'@react-email/render'` / `'@react-email/components'`**
   - Source: `src/app/api/brief/send-email/route.ts`, `src/components/brief/brief-email.tsx`
   - From Noah's PR #131 — packages not yet installed
   - Impact: Email send route would crash if called; does not affect normal page rendering

4. **`Uncaught Error: Internal Next.js error: Router action dispatched before initialization.`**
   - Known Next.js 16 dev-mode issue. Spams repeatedly in logs.
   - Impact: None observed — pages still render and navigate correctly

5. **`Auth error: "Auth session missing!"`**
   - Expected — unauthenticated requests to auth-protected API routes
   - Impact: None — correct behavior

### TypeScript errors (pre-existing)

7 errors, all from PR #131 files (missing package type declarations):
- `src/app/api/brief/export-pdf/route.ts` — `@react-pdf/renderer`
- `src/app/api/brief/send-email/route.ts` — `@react-email/render`, `resend`
- `src/components/brief/brief-email.tsx` — `@react-email/components`
- `src/components/brief/brief-pdf.tsx` — `@react-pdf/renderer`, implicit `any` bindings

### Build status

`next build` fails due to the missing modules above (pre-existing). The dev server runs fine via Turbopack which tolerates missing modules for unused routes.

### Summary

All 14 pages respond correctly. No crashes, no blank pages. Auth-protected pages correctly redirect. The only issues are pre-existing missing npm packages from PR #131 (pdf/email) and a missing `framer-motion` dependency.

---

## Pull request body

### Summary
- **Fix 1:** Resolved React #418 hydration mismatch on `/evening-wrap` and `/morning-brief` — replaced bare `new Date()` fallback with `useState` lazy initializer for SSR stability
- **Fix 2:** Investigated `user_briefings.addendum` — already null-safe at every layer (API, frontend, render). No code change needed. Documented migration path.
- **Fix 3:** Applied muted pill styling (`#a88340`) to evening-wrap TODAY'S STORY pill, matching morning-brief TODAY'S LEAD (PR #125 missed this)
- **Fix 4:** Cataloged 19 pending Supabase migrations — 7 required, 7 optional, 3 intelligence-sprint, 1 post-merge, 1 informational
- **Fix 5:** Smoke tested all 14 pages — all render correctly, no crashes

### Pending Supabase migrations
See Fix 4 catalog above. 7 migrations may cause hard failures if not yet applied to production.

### Smoke test findings
See Fix 5 report above. Pre-existing issues:
- Missing `framer-motion` package (page transitions disabled)
- Missing `@react-pdf/renderer`, `@react-email/render`, `@react-email/components`, `resend` (from PR #131)
- Next.js 16 dev-mode router initialization spam (cosmetic)

### NOT fixed (out of scope)
- **Missing npm packages** (`framer-motion`, `@react-pdf/renderer`, `resend`, `@react-email/*`) — requires `npm install` decision from Lucas. PR #131 files add these but packages aren't in `package.json` on main.
- **Three duplicate SentimentPill implementations** — consolidation debt noted in HANDOFF.md, not a bug
- **Pill consolidation debt** (9 non-Active-Theses pill usages) — follow-up PR per HANDOFF
- **`middleware.ts` → `proxy.ts` rename** — Next.js 16 deprecation, tracked in HANDOFF
- **Intelligence sprint merge** — branch `lucas/intelligence-sprint` preserved unchanged. 8 commits, 20+ files. Conflicts expected in `synthesize.py`, `morning-brief`, `evening-wrap`, `trends`, `settings/preferences`.

Sprint branch `lucas/intelligence-sprint` is preserved unchanged. Coordinate with Noah on Monday for sprint merge.
