# Brief Polish Pass — Recon

**Date:** 2026-04-22
**Base:** `main` at `63cce09`
**Branch:** `feat/brief-polish-pass` — PR 121 + PR 122 merged, builds clean.

## 1A. Pull quote root cause

File: `src/components/brief/lead-hero.tsx:49` has a `splitSummary()` helper that splits the summary on the first sentence terminator and renders the first sentence as a pull-quote. When the first sentence starts "QXO Inc. is set to acquire TopBuild for $11b..." the regex `/[^.!?]+[.!?]+/` yanks "QXO Inc." as sentence #1 because the period after "Inc" ends the match. **This is a regex failure on corporate abbreviations**, not a data problem.

**Root cause classification:** rendering problem (bad sentence split). Not a synthesis problem.

**Fix option A (chosen autonomously):** remove the pull-quote treatment entirely. Render headline + body paragraphs. The headline already carries the editorial weight.

## 1B. Wall-of-text body

File: `backend/synthesize.py` MORNING_SYSTEM and EVENING_SYSTEM prompts ask for a single `summary` string, 3-4 sentences, covering multiple stories.

Current schema:
```
{ "headline": "...", "summary": "3-4 sentences covering different stories", "sections": {...}, "top_deals": [...], "sector_breakdown": {...} }
```

**Fix:** restructure summary into `lead_paragraph` (2-3 sentences on THE lead story only), `supporting_context` (2-3 sentences related context), `what_to_watch` (1-2 sentences forward-looking). Render each as its own paragraph. Keep `summary` as a fallback concatenation for backward compat (old briefings in DB).

## 1C. Sector whitelist violation

File: `backend/synthesize.py:258` `_validate_sector_breakdown()` only detects schema-echo; does NOT validate against `INDUSTRY_VERTICALS` whitelist from `backend/ingest.py:50`.

Why Morning Brief differs from Evening Wrap: same prompt, but Morning Brief's briefing.summary typically names more compound sector themes ("AI Infrastructure", "Private Equity financings") and the model invents the compound labels. Evening Wrap has cleaner data because the day's activity has resolved into clearer themes.

**Fix:**
1. Add whitelist enforcement to the synthesis SYSTEM prompts (both morning + evening) — emit sector_breakdown keys ONLY from the 11-item list.
2. Harden `_validate_sector_breakdown` to drop or remap any key not in the whitelist. Map by prefix match ("Technology AI Infrastructure" → "Technology").

## 1D. Dashboard mode is minimally weighted

File: `src/app/morning-brief/page.tsx:304-309` — `dashboardSections` sorts sections by content length, first gets `col-span-6` (full row), rest get `col-span-3`. So with 6 sections: 1 full-width row, then 2-3 rows of paired half-width cards.

**User wanted:** one big 60%-width card on the LEFT, remaining cards stacked in 40% column on the right. Side-by-side, not top-and-bottom.

**Fix:** change grid from `grid-cols-6` to an inline `gridTemplateColumns: '60fr 40fr'` with the lead quadrant in column 1 and remaining quadrants in a stacked flex column in column 2.

## 1E. Self-grading invisibility end-to-end

Full pipeline audit:

| Step | Status |
|---|---|
| SQL migrations emitted | ✅ `sql/0003_brief_self_grading.sql` + `sql/0005_briefings_morning_review_column.sql` on branch |
| Migrations applied to prod DB | ❓ Noah hasn't run them — empty state expected |
| `morning_brief_calls` populated by synthesis | ❌ Can't populate until Noah runs 0003 |
| Grading job script | ✅ `backend/grading/grade_brief_calls.py` exists |
| Grading endpoint | ✅ `src/app/api/grading/grade-brief/route.ts` exists |
| Grading cron fired | ❌ Cron-job.org not configured yet |
| `morning_brief_call_outcomes` populated | ❌ (grading never ran) |
| Evening Wrap generates reflection | ⚠️ logic exists but no outcomes to reflect on |
| `<MorningReview>` rendered on Evening Wrap page | ✅ wired between hero and Analyst Briefing on A-1 merge |
| Empty-state placeholder when no outcomes | ❌ Current: returns null → renders nothing |

**Fix strategy:**
1. Make `<MorningReview>` render a visible placeholder when outcomes are empty so Noah can see the section exists.
2. Write a seed script `scripts/seed_brief_outcomes.py` for visual preview.
3. Document the deploy-order dependency chain in handoff.

## Scope for subagents

- **Subagent 1 (synthesis):** Prompt rewrite for structured body + whitelist enforcement + validator hardening
- **Subagent 2 (dashboard):** Weighted 60/40 layout + signal-strength ordering
- **Subagent 3 (grading):** MorningReview visible placeholder + seed script + verify end-to-end
- **Subagent 4 (visual):** Typography polish, Top Stories cleanup, sector chips, cross-mode verification

## Protected files (24h Lucas + user constants)

- `src/app/trends/page.tsx`, `src/components/trends/**`, `backend/trends*.py`
- `src/lib/watchlist-utils.ts`, `src/components/watchlist/WatchlistAddInput.tsx`
- `src/app/api/brief-rating/route.ts`, `backend/brief_feedback_loop.py`, `backend/thesis_grader.py`
- `src/components/dashboard/collective-signals-widget.tsx`, `src/components/dashboard/competitor-alerts-widget.tsx`
- `src/components/thesis/thesis-detail-panel.tsx`
- `src/lib/track-event.ts`, `src/lib/user-profile.ts`
- Caution zone (edit only in scope): `src/app/morning-brief/page.tsx`, `src/app/evening-wrap/page.tsx`, `src/components/brief/brief-section.tsx`
