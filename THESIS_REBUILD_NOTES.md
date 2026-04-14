# Thesis Section Rebuild Notes

## Assumptions Made

1. **Status mapping**: Legacy statuses (`new-signal`, `exploring`, `draft-thesis`, `needs-evidence`, `ready-for-memo`) are mapped to kanban columns via `mapToKanbanStatus()`. `new-signal` → `pending_review`, `exploring`/`draft-thesis`/`ready-for-memo` → `active`, `needs-evidence` → `watch`.

2. **Confidence score**: When `adversarial_score` exists (0-1), it's scaled to 0-100 for display. Otherwise, a heuristic based on conviction + evidence_chain length is used.

3. **Source type inference**: Evidence source types (`SEC`, `Fed`, `PR Newswire`, `News`) are inferred from the `source` field text or URL domain. This is a best-effort heuristic.

4. **Thesis notes fallback**: The GET handler attempts a PostgREST join on `thesis_notes`. If the table doesn't exist, it falls back to `select("*")` without the join and returns `notes: null`.

5. **supporting_articles vs supporting_article_ids**: The DB column is `supporting_articles` (set during generation). The ThesisItem type uses `supporting_article_ids` for clarity. The mapping happens in `mapThesisRow()`.

6. **Articles fetch**: The detail panel fetches articles via the browser Supabase client (same pattern as before), not through a new API route, to avoid adding unnecessary endpoints.

## DDL Printed But Not Auto-Applied

The following DDL is printed to stdout on first GET /api/theses call. Run it in the Supabase SQL editor:

```sql
create table if not exists public.thesis_notes (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references public.theses(id) on delete cascade,
  content text not null default '',
  updated_at timestamptz not null default now(),
  unique (thesis_id)
);
create index if not exists thesis_notes_thesis_id_idx on public.thesis_notes(thesis_id);
```

No service-role key is available in `.env.local`, so DDL cannot be auto-applied.

## Tailwind Config Token Additions

None. All required tokens already existed in the design system (globals.css + tokens.css).

## @ts-ignore Usage

None.

## Kanban DnD

Skipped. Drag-and-drop was declared out of scope in the spec. The kanban board is click-to-select only.

## Files Touched

### Modified
- `src/app/api/theses/route.ts` — Added GET handler with dedupe + digest
- `src/app/thesis-board/page.tsx` — Full page rebuild (System Intelligence panel, filters, view toggle, API fetch)
- `src/components/thesis/ThesisList.tsx` — Added pending review quick actions, score improvements
- `src/components/thesis/index.ts` — Re-exported new types
- `src/components/thesis/kanban-board.tsx` — Full rebuild with 4 columns and status mapping
- `src/components/thesis/thesis-card.tsx` — Visual rebuild (conviction ring SVG, adversarial shield, outcome icon, staleness)
- `src/components/thesis/thesis-detail-panel.tsx` — Full rebuild (API notes, bear case, signal breakdown, source types, no Regenerate)
- `src/components/thesis/thesis-types.ts` — Extended types (outcome, signal_breakdown, ticker, horizon, notes, etc.)

### Created
- `src/app/api/theses/notes/route.ts` — GET/POST for thesis notes
- `src/app/api/theses/patterns/route.ts` — GET for pattern library
- `src/app/api/theses/sources/route.ts` — GET for source credibility
- `src/app/api/theses/[id]/route.ts` — PATCH for status updates
- `THESIS_REBUILD_NOTES.md` — This file

## Pre-Existing Bugs Noticed (Not Fixed)

1. **SUPABASE_SERVICE_ROLE_KEY missing**: The POST handler's `adminSupabase` client falls back to anon key. This works but bypasses RLS via luck (pipeline tables may have permissive policies).

2. **Dedup delete in POST**: The POST handler deletes today's AI-generated theses before inserting new ones (line ~364). This violates the "never delete rows" principle but was pre-existing behavior, not introduced in this rebuild.

3. **conviction values mismatch**: The pipeline writes `HIGH`/`MEDIUM`/`WATCH` as conviction values, but the UI expects `BULLISH`/`BEARISH`/`WATCH`. The mapping `HIGH → BULLISH` happens nowhere — this is a pre-existing data mismatch.
