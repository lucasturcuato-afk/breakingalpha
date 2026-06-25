# Run Report: Brief frontend consistency (D5, D10, D7-fe)

Branch: fix/brief-frontend-consistency (based on origin/main @ 0df8c777)
Worktree: /Users/noahhanning/sig-fe

## Defects

### D5 (C1) published_at floor on rails and feed — LANDED
Commit: D5: published_at floor on brief rails and live-feed

The brief story rails and the live feed bounded only on `ingested_at`, so
date-less or weeks-old items surfaced as fresh. Added a 7-day `published_at`
floor via `.gte("published_at", publishedFloor7d)` to:
- src/app/morning-brief/page.tsx (primary 24h query + 48h fallback)
- src/app/evening-wrap/page.tsx (primary 24h query + 48h fallback)
- src/app/live-feed/page.tsx (the unbounded order-by-ingested_at query)

NULL `published_at` rows are excluded by `gte`, so date-less items drop off the
fresh rails (consistent with the requirement to treat NULL as excluded).
Displays still use `timeAgo(a.published_at || a.ingested_at)`, unchanged.

### D10 (C2) single mood snapshot — NO CHANGE NEEDED (already fixed upstream)
origin/main (0df8c777) is ahead of the recon snapshot. In the CURRENT code the
MOOD/CLOSE stat cells already read the briefing's gen-time snapshot, NOT
useLiveMood:
- morning-brief MOOD cell uses `moodWord`/`tone`, both derived from
  `briefing.market_pulse.sentiment_word` (page.tsx ~:573, ~:566, stat cell ~:750).
- evening-wrap CLOSE cell uses `closeWord` from
  `briefing.market_pulse.sentiment_word` (page.tsx ~:508, stat cell ~:677).

`useLiveMood()` in both pages now feeds ONLY the AppShell global mood banner
(mood / moodHeadline / moodDetails props), which is the deliberate cross-route
live SSOT (see the in-code comments at morning-brief ~:199-202 and evening-wrap
~:203-208). Pointing that banner at gen-time data would break the shared-banner
contract across every route and would be a regression, not the requested fix.
Since the stat cells the defect targets are already gen-time, no code change was
made. The hero and the MOOD/CLOSE stat are both gen-time today.

### D7-fe (C3) retire stale SpaceX-private patch — LANDED
Commit: D7-fe: retire stale SpaceX-private patch

track-record/page.tsx force-rendered "SpaceX (private)" via `isSpaceXThesis`
(title /spacex/i match). SpaceX is now public (SPCX), so the override masks
corrected entity facts. Removed:
- the `isSpaceXThesis` helper (now unused)
- the override branch in `TickerOrPrivate`
- the now-unused `title` prop on `TickerOrPrivate` and its single call site arg

The real ticker chip now flows through.

## Verification
- `npx tsc --noEmit`: 0 errors (clean).
- `npm run lint`: 4 errors total, ALL pre-existing on origin/main and ALL in
  files NOT touched here (react-hooks/set-state-in-effect in
  src/hooks/useUserProfile.tsx and src/app/track-record/[thesis_id]/page.tsx,
  etc.). My three touched files introduce 0 new lint errors/warnings.
- `npm run build`: FAILS, but only due to the environment, not the code.
  Turbopack rejects the symlinked node_modules ("Symlink [project]/node_modules
  is invalid, it points out of the filesystem root"). This is the setup symlink,
  not the diff. tsc and lint resolve through the symlink fine. STATUS item: a
  real build needs a worktree with its own node_modules (npm install) or a
  Turbopack root that tolerates the symlink.

## Guardrails
- No merge, no push to main, no migration, no pipeline, no Gemini, no prod
  writes.
- No Lucas-protected files edited (briefing/route.ts, MemoModal.tsx,
  watchlist-utils.ts, WatchlistAddInput.tsx, trends/page.tsx untouched).
- No em-dashes introduced. One commit per defect.

## REQUIRES LUCAS
None.

## Skipped
- D10 code change: skipped because already satisfied on origin/main; making the
  literal banner change would regress the cross-route live SSOT banner.
