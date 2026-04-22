# Intelligence Sprint Notes

## Phase 1A — Fix brief_section_ratings schema + route + frontend

**Problem**: `brief_section_ratings` upsert was silently failing because no unique constraint existed on `(user_id, section_key)`. The route fell back to plain insert, causing duplicate rows (6 rows for 2 section_keys from 1 user). The GET route had no preferences aggregation. Neither morning-brief nor evening-wrap sent `briefing_id`.

**Changes**:
- `sql/brief_section_ratings_schema.sql` — Dedup legacy rows, add two partial unique indexes (with/without briefing_id), enable RLS with user-scoped policies.
- `src/app/api/brief-rating/route.ts` — Rewritten. POST: single upsert with correct onConflict (varies by presence of briefing_id), no fallback insert, proper error responses. GET: returns both latest `ratings` per section and aggregate `preferences` (up/down/net counts).
- `src/app/morning-brief/page.tsx` — Added `id` to BriefingData, pass `b.id` into state, send `briefing_id` in handleSectionRate POST and trackClientEvent.
- `src/app/evening-wrap/page.tsx` — Same changes as morning-brief.

**Migration**: Run `sql/brief_section_ratings_schema.sql` against Supabase SQL Editor before deploying.
