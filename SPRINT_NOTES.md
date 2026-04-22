# Intelligence Sprint Notes

## Phase 1A — Fix brief_section_ratings schema + route + frontend

**Problem**: `brief_section_ratings` upsert was silently failing because no unique constraint existed on `(user_id, section_key)`. The route fell back to plain insert, causing duplicate rows (6 rows for 2 section_keys from 1 user). The GET route had no preferences aggregation. Neither morning-brief nor evening-wrap sent `briefing_id`.

**Changes**:
- `sql/brief_section_ratings_schema.sql` — Dedup legacy rows, add two partial unique indexes (with/without briefing_id), enable RLS with user-scoped policies.
- `src/app/api/brief-rating/route.ts` — Rewritten. POST: single upsert with correct onConflict (varies by presence of briefing_id), no fallback insert, proper error responses. GET: returns both latest `ratings` per section and aggregate `preferences` (up/down/net counts).
- `src/app/morning-brief/page.tsx` — Added `id` to BriefingData, pass `b.id` into state, send `briefing_id` in handleSectionRate POST and trackClientEvent.
- `src/app/evening-wrap/page.tsx` — Same changes as morning-brief.

**Migration**: Run `sql/brief_section_ratings_schema.sql` against Supabase SQL Editor before deploying.

## Phase 1B — Verify user_events table

**Finding**: Table exists with 0 rows. The JSONB column is named `metadata` but all code (4 files) was inserting/selecting `payload` — every event write was silently failing.

**Bug fix** (payload → metadata):
- `src/lib/user-profile.ts` — `trackEvent()` insert and `updateInferredWeights()` select both fixed.
- `src/app/api/user-events/route.ts` — insert column fixed.
- `src/app/api/collective-signals/route.ts` — select column fixed.
- `src/app/api/profile/insights/route.ts` — select and type cast fixed.

**Verification script**: `scripts/verify_user_events.ts` — confirms table schema, identifies column mismatch, documents FK constraint on user_id.

## Phase 1C — Article quality scoring at ingest

**What**: Deterministic (no LLM) quality score [0–1] based on structural signals: title quality, summary richness, entity presence, content availability, metadata completeness.

**Changes**:
- `backend/article_quality.py` — `compute_quality_score(article)` function, 10 weighted sub-signals normalized to [0, 1].
- `backend/ingest.py` — Imports article_quality, computes and stores quality_score at ingest time.
- `backend/synthesize.py` — Fetches quality_score alongside articles, uses it as tiebreaker in `_select_articles_for_synthesis()` (quality_score DESC within same relevance_score bucket).
- `sql/add_quality_score.sql` — Migration to add `quality_score REAL` column + index.
- `scripts/backfill_quality_scores.py` — Backfill script for existing articles.

**Migration**: Run `sql/add_quality_score.sql` in Supabase SQL Editor, then run `python3 scripts/backfill_quality_scores.py`.

## Phase 2A — Temporal context injection

**What**: Inject yesterday's briefing narrative into today's synthesis prompt for narrative continuity. The LLM sees yesterday's headline, market tone, summary, and key section leads — enabling it to build on threads, note escalations/resolutions, and avoid verbatim repetition.

**Changes**:
- `backend/synthesize.py` — New `[TEMPORAL CONTEXT]` block injected into system prompt before the Gemini call. Fetches the most recent same-type briefing from the last 48h. Soft-fails if no previous briefing exists or on any error.

## Phase 2B — Contrarian signal detection + CONTESTED pill

**What**: Detect clusters where articles disagree directionally (bullish vs bearish). When a cluster has 3+ articles and the minority sentiment makes up >= 25%, it's flagged as contested.

**Changes**:
- `backend/trend_mapper.py` — Added `sentiment` to `_normalize_article()` and article fetch. New `detect_contested(cluster)` function. `contested_flag` written to both new cluster rows and dedup updates.
- `sql/add_contested_flag.sql` — Migration to add `contested_flag BOOLEAN DEFAULT FALSE` to trend_clusters.
- `src/app/trends/page.tsx` — Added `contested_flag` to TrendSignal interface, select query, and mapped object. CONTESTED pill rendered on signal cards (amber `signal-warn` styling) and in modal detail view.

**Migration**: Run `sql/add_contested_flag.sql` in Supabase SQL Editor.
