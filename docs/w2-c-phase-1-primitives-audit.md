# W2-C Phase 1 -- Primitives Audit

Date: 2026-05-05
Status: independent verification of Phase 5 port-or-keep decisions.

Cross-references `docs/primitives (1).jsx` (Direction D shared primitives) against the existing `src/components/ui/` directory. For each Direction D primitive: KEEP existing, PORT (target path), or EXCLUDE (rationale). For each existing `src/components/ui/` primitive: current props, usage count via grep, and Phase 1 disposition.

## Existing primitives in `src/components/ui/`

Usage counts: `grep -r --include="*.tsx" --include="*.ts" -E "[<{ ,]<Name>[ ,>}]" src/`. Counts are JSX usage occurrences, not import statements.

| Primitive | Path | Current props (canonical) | Usage count | Phase 1 disposition |
|---|---|---|---|---|
| Button | `src/components/ui/button.tsx` | `variant: "primary" \| "secondary" \| "tertiary" \| "ghost" \| "gold" \| "danger"` (last 3 deprecated aliases), `size: "sm" \| "md" \| "lg"` | 30 | KEEP. Direction D `SBtn` (DirectionD.jsx 190-199) maps to primary/secondary cleanly. PR-A0 token swap re-styles via tokens; no API change. |
| Badge | `src/components/ui/badge.tsx` | `variant: "default" \| "gold" \| "bullish" \| "bearish" \| "risk-off" \| "risk-on" \| "neutral" \| "ma" \| "ai" \| "muted"` | 20 | KEEP. Used for ticker chip, deal-type chip, tier badge. PR-A1 maps `gold` -> ticker chip, `default` or new `tier-primary` / `tier-1` for SourcesStrip. |
| Card | `src/components/ui/card.tsx` | sub-exports `CardHeader`, `CardContent`, `CardFooter` | 6 | KEEP. Low usage but consistent pattern. Phase 1 cards (MemoCard, TrendCard, ThemesCard, SourcesStrip) can either compose Card or render inline -- same end-state visually. |
| Input | `src/components/ui/input.tsx` | (standard input forwardRef) | 11 | KEEP. Search input on Phase 1 detail page reuses. Tap-target O7 (height 36) is fixed in W2-D (WD10). |
| Table | `src/components/ui/table.tsx` | sub-exports `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` | 5 | KEEP. ArticlesTable (DirectionD.jsx 762-810) wraps these primitives. PR-D1. |
| Skeleton | `src/components/ui/skeleton.tsx` | exports `Skeleton`, `SkeletonText`, `SkeletonCard` | 59 | KEEP. Phase 1 Loading frame (PR-H1) reuses `SkeletonText` lines for memo body shimmer. High usage -- single source of truth for loading aesthetics. |
| EmptyState | `src/components/ui/empty-state.tsx` | `icon, title, description, action, className` | 16 | KEEP. PR-G1 EmptyState (Frame 7 / Stripe) extends this -- the Direction D version adds metric strip ("Last indexed", "Sources checked", "Watchlist") below the action; ship as a new variant prop OR as inline metric strip rendered alongside in the parent. |
| Tooltip | `src/components/ui/tooltip.tsx` | (standard tooltip wrapper) | 11 | KEEP. PR-G1 "Notify me when indexed" disabled-with-tooltip uses this. |
| BookmarkButton | `src/components/ui/bookmark.tsx` | (existing watchlist toggle) | 6 | KEEP. + Watchlist button on CompanyHeader uses this. NOTE: this primitive does NOT touch `src/lib/watchlist-utils.ts` (Lucas-protected) and is therefore safe to import from any Phase 1 sub-PR. |
| Logo | `src/components/ui/logo.tsx` | (brand logo) | 5 | KEEP. Sidebar/TopBar surfaces only. Not used in Phase 1 detail-page chrome. |
| Wordmark | `src/components/ui/wordmark.tsx` | `size: "sm" \| "md" \| "lg"`, `className` | 8 | KEEP. Direction D Wordmark (primitives.jsx 32-40) uses 18px default; existing primitive has `sm: 18px / md: 22px / lg: 26px`. Map DirectionD `Wordmark size=18` -> `<Wordmark size="sm" />`. No port needed. |
| SentimentPill | `src/components/ui/sentiment-pill.tsx` | `tone: "BULLISH" \| "BEARISH" \| "NEUTRAL" \| "MIXED" \| "WATCH"`, `size: "sm" \| "md"` | 7 | KEEP. Direction D version (primitives.jsx 11-30) adds `xs` and `lg` sizes. Phase 1 needs `xs` for ThemesCard rows + DetailMobile alias header. EXTEND existing component with `xs` and `lg` size variants (1-line addition each); no new file. |
| AnimatedNumber | `src/components/ui/animated-number.tsx` | `value, duration, ...` | 4 | KEEP. KPI strip values (PR-A2) wrap with this for delta animation on update. |

Total existing primitives: 13 components (12 component files plus the `index.ts` re-export barrel).

## Direction D primitives in `docs/primitives (1).jsx`

| Direction D primitive | primitives.jsx lines | Disposition | Target path | Rationale |
|---|---|---|---|---|
| `SentimentPill` | 11-30 | KEEP existing + EXTEND | `src/components/ui/sentiment-pill.tsx` | Already exists. Add `xs` (font 8.5, pad "2px 5px") and `lg` (font 11, pad "5px 11px") size variants per Direction D spec. Single-file change, ships in PR-A0 OR PR-E1 (whichever lands first that needs `xs`). |
| `Wordmark` | 32-40 | KEEP existing | `src/components/ui/wordmark.tsx` | Already exists. Direction D 18px default == existing `sm`. No port. |
| `Delta` | 42-54 | PORT | inline in `KPIStrip` first; promote to `src/components/ui/delta.tsx` if reused 3+ times | DirectionD.jsx KPIStrip (lines 600-606) inlines the same up/down arrow + value pattern. PR-A2 ships inline; reused by TrendCard headers (PR-E2) and Articles row delta (PR-D1) -- promotion-worthy after PR-E2 lands. |
| `Cite` + `CitedText` | 57-72 | PORT | `src/components/memo/CitedText.tsx` (NEW, sibling of existing memo components, NOT in `ui/`) | Citation marker is memo-specific, not a generic UI primitive. Lives in the memo component family. Regex `/(\[\d+\])/g` matches D9 smoke-test row. PR-C1 owner. |
| `Sparkline` | 75-92 | PORT | `src/components/trend/Sparkline.tsx` (NEW) OR `src/components/ui/sparkline.tsx` if reused outside trend family | Phase 1 only uses Sparkline in TrendCard. Park in trend family for Phase 1; promote to ui/ later if Phase 2 reuses. PR-E2 owner. |
| `MiniBars` | 95-106 | PORT | `src/components/trend/MiniBars.tsx` (NEW) | Same as Sparkline. TrendCard-only in Phase 1. PR-E2 owner. |
| `SentimentHeat` | 109-124 | PORT | `src/components/trend/SentimentHeat.tsx` (NEW) | Same as Sparkline. TrendCard-only in Phase 1. PR-E2 owner. |
| `Eyebrow` | 127-133 | EXCLUDE | -- | Trivial styling helper (font 10, weight 700, letter-spacing 0.14em, uppercase, gold). Implement inline as Tailwind class string `"font-mono text-[10px] font-bold tracking-[0.14em] uppercase text-gold"`. Promotion-worthy only if usage exceeds 5 sites; in Phase 1 it appears in 2-3 places at most. |
| `PhoneBezel` | 136-175 | EXCLUDE | -- | Mockup chrome only -- wraps mobile previews in a phone bezel for design comps. Has no production use. Drop entirely. |
| `AnnoPin` | 178-201 | EXCLUDE | -- | Annotation pin for the design-doc inline notes (`{n}` markers in DirectionD.jsx commentary). Not a runtime UI element. Drop. |

## Drift vs Phase 5 recon

If Phase 5 recon's port-or-keep decisions differ from the table above, note the divergences here. Without the original Phase 5 doc available in `docs/` to diff against, this audit is the canonical recommendation. The decisions above are derived independently from:

1. `docs/primitives (1).jsx` (Direction D shared primitives, all 10 listed).
2. `src/components/ui/index.ts` (barrel) + each file's exported types.
3. Usage counts via grep against `src/**/*.{ts,tsx}`.

If a Phase 5 doc ships later that contradicts any row above, the discrepancy goes through Lucas / design review (no judgment call from this audit).

## Recommended port order

Sequenced to minimize cross-PR coupling:

1. PR-A0 (token swap) -- no primitive ports; pure CSS variable / tailwind config swap. SentimentPill extension can ride here OR with PR-E1.
2. PR-A2 (KPIStrip) -- inline `Delta` JSX; do NOT port yet.
3. PR-D1 (Articles) -- if Articles row needs `Delta`, this is the second site -> still inline.
4. PR-E2 (Trend tab) -- ports `Sparkline`, `MiniBars`, `SentimentHeat` into `src/components/trend/`. After this PR, `Delta` has 3 callers -> promote to `src/components/ui/delta.tsx` in the same PR.
5. PR-C1 (BriefTab) -- ports `Cite` + `CitedText` into `src/components/memo/CitedText.tsx`.

## Lucas-protected scope-check

None of the primitive ports above touch any of the four Lucas-protected files:

- `src/lib/watchlist-utils.ts` -- not imported by any primitive in this list.
- `src/components/watchlist/WatchlistAddInput.tsx` -- BookmarkButton is a sibling, not this file.
- `src/app/trends/page.tsx` -- `src/components/trend/*` is a different folder; the trend primitives ship into the components family, not the app/trends route.
- `src/app/api/briefing/route.ts` -- no primitive imports any API route.

## Insight surfaced

- `Skeleton` has 59 usages across the codebase -- by far the most-used primitive. The Phase 1 Loading frame (PR-H1) should reuse `SkeletonText` (or compose `Skeleton`) verbatim instead of inlining new shimmer markup.
- `SentimentPill` already exists with size `sm` and `md`. Direction D requires size `xs` and `lg` as well -- a 2-line extension, not a new component. Build PR scope-check should reject any Phase 1 PR that creates a duplicate sentiment pill primitive.
- `Card` has only 6 usages. Phase 1 cards (MemoCard, TrendCard, ThemesCard, SourcesStrip) can compose `Card` to grow that count -- consider this a code-hygiene win even though both inline divs and `<Card>` would render identically.
