# Thesis Section Rebuild Notes

Completed: 2026-04-13

## Phases Completed

### Phase 1 — ConvictionRing rewrite
- Text-based conviction ring (not numeric score)
- Maps conviction string to arc percentage, hex stroke color, label
- Label rendered below ring; tooltip via `title` attribute

### Phase 2 — Conviction-based filter tabs
- Replaced sentiment-based tabs with: HIGH | MEDIUM | WATCH | All | Archived | Pending Review
- Stats row shows conviction counts
- All sentiment references removed from filter logic

### Phase 3 — Adversarial null safety
- Negative `adversarial_score` treated as null (both score and passed_adversarial)
- Applied in `mapThesisRow` on thesis-board page
- Detail panel shows "Stress test pending" gray pill when no valid score

### Phase 4 — SparklineChart
- Finnhub API integration (quote + candle endpoints)
- SVG polyline, green/red based on price direction
- Shimmer loading state, silent error handling
- Appears in thesis-card footer and detail panel header

### Phase 5 — DnD Kanban
- @dnd-kit/core for drag-and-drop
- 5 columns: Pending Review, HIGH, MEDIUM, WATCH, Archived
- `onDrop` callback with optimistic UI update + revert on failure
- PATCH handler accepts both `status` and `conviction`

### Phase 6 — Notes persistence
- Supabase `thesis_notes` table (joined in GET, separate POST endpoint)
- Auto-save on blur, failure state shown
- No localStorage usage

### Phase 7 — Visual polish
- Enhanced empty state with compass SVG icon and active signal count
- Age indicator: Today (green), Xd ago, Xw ago, stale warning
- Hover rationale preview on thesis cards
- Section header gold borders verified in detail panel

### Phase 8 — Types cleanup
- `ThesisConviction = "HIGH" | "MEDIUM" | "WATCH" | "BULLISH" | "BEARISH" | null`
- Added `sparklineData` field to ThesisItem
- SparklineChart exported from index.ts
- No `confidence_score` or `sentiment` type references remain

### Phase 9 — Verification
- `tsc --noEmit` passes clean
- No `localStorage` in thesis components
- No `confidence_score` in src/
- @dnd-kit packages confirmed in package.json

## DB Facts
- No `sentiment` column exists
- No `confidence_score` column exists
- Conviction values: HIGH, MEDIUM, WATCH, BULLISH (legacy), BEARISH
- `adversarial_score < 0` = broken run (treated as null)

## Files Modified
- `src/components/thesis/ConvictionRing.tsx` — Full rewrite (text-based conviction)
- `src/components/thesis/SparklineChart.tsx` — New (Finnhub sparklines)
- `src/components/thesis/kanban-board.tsx` — Full rewrite (@dnd-kit DnD)
- `src/components/thesis/thesis-card.tsx` — Updated ring, badges, sparkline, borders, age, hover preview
- `src/components/thesis/thesis-detail-panel.tsx` — Updated ring, sparkline, adversarial pill, empty state, notes failure state
- `src/components/thesis/thesis-types.ts` — Updated ThesisConviction type, added sparklineData
- `src/components/thesis/thesis-table.tsx` — Updated badge conviction map
- `src/components/thesis/ThesisList.tsx` — Updated conviction ring prop, null-safe helpers
- `src/components/thesis/index.ts` — Added SparklineChart export
- `src/app/thesis-board/page.tsx` — Conviction filter tabs, stats, kanban onDrop, adversarial null safety
- `src/app/api/theses/[id]/route.ts` — PATCH accepts status + conviction

## DDL (run in Supabase SQL editor if not applied)
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
