# W2-C: Company Intel Redesign Design

Author: Noah Hanning. Date: 2026-05-04. Status: scoping. Lucas signed off on the sidebar redesign that ships alongside Company Intel; mockup synthesis (A+C direction across 10 frames) is locked. This doc is for the team (Noah, Lucas, future contributors) and is the foundation for the W2-C build. Implementation is phased across three milestones; section 8 lists the open questions Lucas decides before Phase 1 starts.

### 1. Context and goals

Company Intel is the most-used research surface in Signalera. The current implementation (`src/app/company/page.tsx`, 1013 lines) is a 3-column card grid with a 420px side detail panel. The detail route (`src/app/company/[id]/page.tsx`, 93 lines) renders an inline header plus an article list grouped into Company Events / Sector Context. The full current-state inventory lives in `docs/w2-c-company-intel-audit-2026-05-04.md` (PR #187, merged); this doc references that audit rather than re-inventorying.

W2-C ships a redesigned Company Intel that:

1. Uses a denser, terminal-style layout (28-row table, 9 columns, sortable headers, keyboard navigation) inside the existing workspace shell.
2. Promotes data the backend already produces but the current UI does not render: sector chips on rows, alias-count badges, Themes card on detail, KPI cluster.
3. Surfaces the W2-A entity-resolution work in two visible ways: canonical alias ribbon on detail, and post-W2A typo-redirect on directory search misses.
4. Replaces the side detail panel with a dedicated detail page experience (KPI cluster, AI Brief card, Themes card, Signal Trend sparkline, Recent Coverage, Sources, F1-F7 function-key tabs).
5. Refactors the sidebar in the same shipping window so all pages share the new shell at once instead of staggering.

W2-C does NOT redesign the brand, change the typography scale beyond what the new surfaces require, or introduce new color tokens. The synthesis direction (A+C) preserves brand cohesion with the rest of the app.

### 2. Current state

See `docs/w2-c-company-intel-audit-2026-05-04.md` for the full audit. Compressed inputs to this design:

- **Surface area.** 8 files for Company Intel (1 list page, 1 detail route, 1 layout, 3 components, 4 API routes, 1 helper module). Plus the shared `MemoModal` (`src/components/memo/MemoModal.tsx`, 384 lines), used by 7 other surfaces in the app.
- **Backend already produces.** `companies.{name,ticker,sector,mention_count,last_updated,key_themes,sentiment_trend,first_seen,description,notes}`. `articles.{title,source,sector,sentiment,summary,content,published_at,ingested_at,url,companies,primary_company,relevance_score,deal_type}`. Post-W2-A: `aliases.{surface_form,lookup_key,canonical_id,mention_count,last_seen_at}`, `resolution_log.{was_ambiguous,candidate_canonical_ids,resolved_canonical_id}`. `source_credibility` scores per source.
- **Backend produces but no UI renders.** `companies.sentiment_trend`, `companies.first_seen`, `companies.key_themes` (key_themes is selected by the list route but discarded by `dedupeAndMapApiCompanies`), `articles.sentiment`. Post-W2-A alias data has no read route yet; design doc section 9 spec'd one.
- **Pain points already cataloged.** Dedup fragmentation (NVIDIA / Nvidia / Nvidia Corp, etc., partly handled client-side via `CANONICAL` map but not for production-scale clusters; W2-A is the structural fix). Web-fallback fires on bare `ilike` zero-results, hits indexed entities the user mistyped (W2-A typo-redirect is the structural fix). Mobile responsiveness unaddressed (`grid-cols-3` hardcoded; detail panel fixed at 420px).

### 3. Synthesis direction

Mockup synthesis combines variant A (terminal-grade information density) with variant C (workspace-shell continuity). The locked decisions:

- **A+C, not A or C alone.** Variant A's 28-row table density wins for the directory; variant C's app-shell continuity (sidebar, mood bar, page chrome) is preserved across both directory and detail. The detail page borrows A's KPI density.
- **Existing brand tokens stay.** `text-espresso`, `text-gold`, `bg-parchment`, `bg-cream`, the gold accent ramp, `font-display` / `font-sans` / `font-data`. The audit catalogs these in section 3 of `w2-c-company-intel-audit-2026-05-04.md`.
- **No new typography scale.** The audit flagged that every text size today is a bracketed pixel literal (`text-[9px]` through `text-[24px]`) rather than a token reference. W2-C does not solve that as a side effect; it inherits the bracketed values where it must and keeps to a small palette (9px / 11px / 13px / 14px for body / display sizes for KPI numbers). Tokenizing the scale is a separate workstream.
- **Function-key affordances are mockup-described, not user-validated.** The F1-F7 tabs and `j/k` / `w` keyboard shortcuts are in the mockups but the designer flagged F1-F7 as the least-sure call. Phase 3 (section 7) defers F1-F7 until V1 ships and we observe whether tab-style navigation is what users reach for.

### 4. Feature preservation audit

This is the most important section. Each row is a feature surface from current UI, backend capability inventory, or the mockup. The Action column says how W2-C handles it.

Action codes:

- **KEEP**: feature preserved as-is in the new design
- **ADD**: feature is in the backend but current UI does not show it; the mockup adds it
- **DEPRECATE**: feature is in current UI but the mockup intentionally drops it; flagged for Lucas review where decision is non-obvious
- **GAP**: feature is in current UI but the mockup may have accidentally dropped it; this is the regression risk and the most important class of row
- **LATER**: feature is in the backend, neither current UI nor mockup show it; V2 candidate

#### Directory page

| Feature | Current UI | Backend | Mockup | Action |
|---|---|---|---|---|
| Search input | yes (page.tsx:520) | yes | yes (search bar) | KEEP |
| Industry vertical filter chips | yes (page.tsx:531) | yes (sector field) | yes (sector filter chips) | KEEP |
| Match Any / All filter toggle | yes (page.tsx:561) | UI-side only | not described | **GAP** (Lucas: drop or carry?) |
| 3-column card grid | yes (page.tsx:717) | n/a | replaced | DEPRECATE (intentional) |
| 28-row dense table | no | n/a | yes | ADD |
| 9 columns (name, ticker, sector, mentions, alias count, last seen, sentiment, watchlist, sparkline) | no (3 fields visible today) | partial (sentiment series and last_seen need work) | yes | ADD (some columns require LATER backend work) |
| Sortable column headers | no | yes (data is sortable) | yes | ADD |
| Watchlist star toggle per row | no on directory; yes on detail and on `/watchlist` | yes (`/api/watchlist` POST) | yes | ADD |
| Keyboard nav `j` / `k` (next / prev row) | no | n/a | yes | ADD |
| Keyboard shortcut `w` (toggle watchlist) | no | yes (write endpoint exists) | yes | ADD |
| Sign-in lock for rows past the 6th | yes (page.tsx:743-769) | n/a | not described | **GAP** (recommend: keep, render as locked rows past row N in the new table) |
| Side detail panel (420px) | yes (page.tsx:776-975) | n/a | replaced by detail page | DEPRECATE (intentional; flow reroutes to `/company/[id]`) |
| Web-fallback CTA on zero results | yes (page.tsx:611) | yes | yes (web-fallback variant) | KEEP |
| Web-fallback result list | yes (page.tsx:666) | yes | yes (web sources [w1]-[w5]) | KEEP |
| Mood bar | yes (`useLiveMood`) | n/a | not described | **GAP** (recommend: keep; ambient app-shell element, removing it breaks workspace cohesion) |
| Sector display in row | no on card | yes (route returns sector) | yes (sector chip column) | ADD |
| Alias count badge per row | no | yes (post-W2-A: COUNT alias rows by canonical_id) | yes | ADD (depends on W2-A read-path, see section 8) |
| Loading skeletons (6 cards) | yes | n/a | replaced by progress trace | DEPRECATE (intentional) |
| Status strip | no | n/a | yes | ADD |

#### Detail page

| Feature | Current UI | Backend | Mockup | Action |
|---|---|---|---|---|
| Inline header (name, sector subtitle, total articles caption) | yes (company-detail-client.tsx:56-68) | yes | replaced by KPI cluster + canonical alias ribbon | DEPRECATE-and-evolve |
| KPI cluster | no | most fields available | yes | ADD |
| Canonical alias ribbon | no | yes (post-W2-A) | yes | ADD (depends on W2-A read-path PR; section 8) |
| F1-F7 function-key tabs | no | n/a | yes (mockup) | LATER (Phase 3; least-sure design call) |
| Tabs component (`company-tabs.tsx`, exported but unwired) | exported, not mounted | n/a | F1-F7 maps the same idea | KEEP-evolved |
| AI Brief card (memo content surfaced inline on the page) | no (memo only opens in modal today) | yes (`/api/memo`) | yes | ADD |
| Themes card | no (`key_themes` selected by route, never rendered) | yes | yes | ADD (free win, no backend work) |
| Signal Trend sparkline | no | no time-series API today | yes | LATER (needs backend job for mention-history rollup) |
| Recent Coverage list | yes (article list, grouped Events / Sector Context) | yes | yes (consolidated) | KEEP-evolved (drop the two-group split unless Lucas wants it kept) |
| Sources list at the bottom of detail | no (sources only in modal today) | yes | yes | ADD |
| Structured memo paragraphs with `[n]` citations | partial: PR #185 added wiring, but `[n]` markers are still plain text | yes (backend produces citations) | yes (anchor-wired) | ADD (extend PR #185 to anchor `[n]` -> source list) |
| Add to Watchlist button | yes (company-detail-client.tsx:73) | yes | yes | KEEP |
| Generate Memo button | yes | yes (`/api/memo`) | yes (opens modal or surfaces inline) | KEEP |
| Tooltip toast (no-articles case) | yes (company-detail-client.tsx:71-104) | n/a | not described | **GAP** (recommend: surface as part of the empty state for the detail page; do not silently drop) |
| Articles grouped Company Events / Sector Context | yes | implicit grouping logic | replaced by single Recent Coverage list | DEPRECATE (Lucas: confirm; the audit notes the grouping is duplicated near-verbatim with the directory's side panel) |
| Article cards with deal-type chip | yes | yes | yes (Recent Coverage rows) | KEEP |
| `SourceCredibilityBadge` on each article | yes (page.tsx:895) | yes (`source_credibility` table) | not explicitly described | **GAP** (recommend: keep; signal-quality is core to Signalera positioning) |
| `SignalScore` (relevance_score) on each article | yes | yes | not explicitly described | **GAP** (recommend: keep; same reasoning) |
| Article completeness indicator (content vs summary) | yes (`getCompleteness`) | yes | not described | **GAP** (recommend: keep; sets reader expectations on rendering) |

#### Memo modal

| Feature | Current UI | Backend | Mockup | Action |
|---|---|---|---|---|
| Type label | yes | n/a | yes | KEEP |
| Title | yes | yes | yes | KEEP |
| Web-grounded chip when type=company-web | yes (MemoModal:256-268) | n/a | yes (WEB-SOURCED status pill) | KEEP |
| Centered loading spinner | yes (MemoModal:282) | n/a | replaced by streaming status | KEEP-evolved (or LATER if streaming is V2) |
| Streaming token render | no | no streaming today | yes | LATER (needs backend streaming work) |
| Markdown render with custom components | yes (MemoModal:12-50) | n/a | yes | KEEP |
| Staggered fade-in animation | yes (MemoModal:191-207) | n/a | not described | DEPRECATE (Lucas: confirm; mockup is fullscreen and structural, fade-in may not fit) |
| Sources list | yes when `sources` prop is passed (web-fallback only on main; PR #185 extends to article-grounded) | yes | yes | KEEP |
| Citation `[n]` -> source anchor wiring | no on main | yes (data exists) | yes | ADD (extend PR #185) |
| Copy button | yes | n/a | yes | KEEP |
| Export .md button | yes | n/a | yes | KEEP |
| Close button | yes | n/a | yes | KEEP |
| Backdrop dim (`bg-espresso/50`) | yes | n/a | yes (modal pattern) | KEEP |
| Max-w-2xl constraint | yes (672px) | n/a | mockup is fullscreen | DEPRECATE (intentional) |
| Modal SHARED across 7 other pages (deal-flow, evening-wrap, trends, morning-brief, watchlist, dashboard/story-card, feed/feed-row) | yes | n/a | mockup is Company-Intel-specific | **OPEN QUESTION** (Lucas: evolve all 7 callers, or fork a Company-Intel modal? See section 8) |

#### Web-fallback variant

| Feature | Current UI | Backend | Mockup | Action |
|---|---|---|---|---|
| Alias-resolved banner ("Did you mean Pershing Square?") | no (no typo redirect on directory route) | yes (post-W2-A) | yes | ADD (depends on W2-A read-path PR; section 8) |
| WEB-SOURCED status pill | yes (Web-grounded chip in MemoModal) | n/a | yes | KEEP-evolved |
| Web sources `[w1]`-`[w5]` | rendered as `[1]`-`[5]` today (page.tsx:682) | yes (`searchWeb` returns sources) | yes (distinct prefix to disambiguate from article citations) | ADD (rename prefix in renderer + prompt) |
| Auto-upgrade copy ("This memo will upgrade to article-grounded once we index this entity") | no | no upgrade logic exists | yes | LATER (needs ingest-pipeline coupling) |

#### Empty and loading states

| Feature | Current UI | Backend | Mockup | Action |
|---|---|---|---|---|
| Empty: ingest-checked count ("We've checked N sources today") | no | trivial to compute (count today's articles) | yes | ADD (small backend addition or client-side count) |
| Empty: notify CTA | no | needs notification infra | yes | LATER (verify what notification surface exists for the entity-not-found case) |
| Empty: generate-from-web CTA | yes (existing web-fallback CTA) | yes | yes | KEEP |
| Empty: last-indexed footer ("Last full ingest: 6:42 AM PT") | no | trivial to expose | yes | ADD |
| Empty: watchlist user count ("847 analysts watching") | no | possible (watchlist GROUP BY identifier) | yes | LATER (privacy review on showing other users' aggregate activity) |
| Loading: progress trace 6 pipeline steps | no | could expose | yes | ADD |
| Loading: streaming status | no | no streaming today | yes | LATER (needs backend streaming) |

#### Sidebar redesign (Lucas-approved scope)

| Feature | Current | Mockup | Action |
|---|---|---|---|
| Two-tier nav (Main + Research sections) | yes (sidebar.tsx:65-77) | unspecified in prompt | **OPEN QUESTION** |
| Drag-and-drop section reorder | yes (`@dnd-kit` + `user_profiles.sidebar_section_order`) | unspecified | KEEP unless Lucas removes |
| Live-dot indicator | yes | unspecified | KEEP |
| Notifications bell | yes | unspecified | KEEP |
| User avatar | yes | unspecified | KEEP |
| Wordmark | yes | unspecified | KEEP |
| Watchlist as a destination link | yes (`/watchlist`) | mockup may treat watchlist as ambient rail surface | **OPEN QUESTION** |
| Sidebar collapse on mobile | implicit but not robust | mobile views in mockup | ADD |

### 5. Surfaces in scope

Six surfaces from the mockups, in build order:

1. **Sidebar** (refactor first to de-risk; touches every page)
2. **Directory** (highest user impact; the 28-row table + sector chips + watchlist toggle + keyboard nav)
3. **Detail page** (KPI cluster, canonical alias ribbon, AI Brief card, Themes card, Recent Coverage, Sources)
4. **Memo modal** (fullscreen, Sources list, Copy + Export, citation anchor wiring)
5. **Web-fallback variant** (alias-resolved banner, web sources `[w1]`-`[w5]`, WEB-SOURCED status; depends on W2-A read-path)
6. **Empty and loading states** (progress trace, ingest-checked count, last-indexed footer)

Mobile views and the F1-F7 function-key tabs are mockup-described but explicitly deferred (section 6).

### 6. Out of scope for V1

- F1-F7 function-key tabs (designer flagged as least-sure; defer until V1 telemetry shows users want tab navigation)
- Mobile sticky bottom-tab nav
- Disambiguation modal for hit-many alias paths (depends on `resolution_log` ambiguity-rate analysis per W2-A design section 10; trigger threshold is 5% of resolutions)
- Signal Trend sparkline (needs mention-history time-series backend job)
- Streaming token memo render (needs backend streaming)
- Auto-upgrade web-fallback memo copy (needs ingest-pipeline coupling so an indexed entity that arrives later can rewrite a stale web-fallback memo)
- Watchlist user count on empty state (privacy review)
- Tokenizing the typography scale (separate workstream)
- Brand redesign of any kind

### 7. Implementation phases

#### Phase 1 (W2-C V1, target 2 weeks)

Sidebar refactor lands first. Then directory, detail, memo modal in parallel feature branches off main. Each has its own draft PR.

- Sidebar refactor: navigation hierarchy decided in section 8, drag-and-drop preserved, mobile collapse added. Touches all pages because every route renders inside `app-shell.tsx`.
- Directory: 28-row table, sector chips, sortable headers, watchlist toggle, `j/k/w` keyboard nav, alias-count badges (depends on W2-A read-path; if read-path slips, ship without the badge column and add later).
- Detail page: KPI cluster, canonical alias ribbon (depends on W2-A read-path; if slips, render the ribbon empty until the data is wired), AI Brief card, Themes card, Recent Coverage list (drop the Events / Sector Context split unless Lucas keeps it), Sources at the bottom.
- Memo modal: fullscreen layout, citation anchor wiring (extends PR #185), Sources list across both article-grounded and web-fallback paths.

#### Phase 2 (W2-C V1.5, target 1 week)

- Web-fallback variant page state (alias-resolved banner, web sources `[w1]`-`[w5]`, WEB-SOURCED pill). Depends on W2-A read-path being live.
- Empty state surface (ingest-checked count, last-indexed footer, generate-from-web CTA, no watchlist-user-count yet).
- Loading state with progress trace.
- Mobile views (sidebar collapse, table -> stack on narrow viewports, detail page reflow).

#### Phase 3 (W2-C V2, later)

- F1-F7 function-key tabs (only if V1 telemetry shows users want them).
- Mobile sticky bottom-tab nav.
- Disambiguation modal (gated on W2-A `resolution_log` ambiguity rate; design doc section 10 trigger).
- Signal Trend sparkline once a mention-history job ships.
- Streaming memo render once backend supports it.
- Auto-upgrade web-fallback copy.

#### Validating phasing against the GAP rows

Every row marked **GAP** in section 4 maps to either Phase 1 or a Lucas decision in section 8:

- Match Any / All filter toggle: section 8 question 7
- Sign-in lock past row 6: Phase 1 (table renders locked rows past N)
- Mood bar: Phase 1 (preserved as ambient app-shell element)
- Tooltip toast no-articles: Phase 1 (becomes part of detail empty state)
- `SourceCredibilityBadge` / `SignalScore` / completeness indicator: Phase 1 (preserved on Recent Coverage rows)
- Staggered fade-in: section 8 question 8
- Memo modal shared across 7 callers: section 8 question 3

### 8. Open questions for Lucas

Each question is one sentence and answerable with a one-word or one-line decision. Lucas signs off before Phase 1 starts.

1. **Sidebar nav hierarchy.** Keep the current Main / Research two-section split, or collapse to a single section with the same 11 items?
2. **Watchlist treatment in sidebar rail.** Stays as a destination link (current behavior, navigates to `/watchlist`) or evolves to an ambient rail surface (live count badge, recent additions popover)?
3. **Memo modal scope.** Evolve the shared `MemoModal` for all 7 calling pages in this PR, or fork a Company-Intel-specific modal and migrate other pages later?
4. **Mobile breakpoint.** What viewport width collapses the sidebar (default proposal: 1024px)?
5. **Watchlist destination.** New table-row star toggle posts to `/api/watchlist` and the existing `/watchlist` page remains the destination, or do we add a Company-Intel-specific watchlist sub-view?
6. **Branch / PR strategy.** One feature branch per phase (3 branches, 3 merges) or one feature branch per surface (6 branches, 6 merges) inside each phase?
7. **Match Any / All filter toggle.** Drop in V1 (mockup omits it) or carry over (today the filter row supports it)?
8. **Memo staggered fade-in animation.** Keep the existing 180ms-per-section fade or drop it for the fullscreen layout?
9. **Article grouping (Events / Sector Context).** Drop the two-group split in detail's Recent Coverage, or keep it because the routing logic is already there?
10. **Tooltip toast (no articles on detail).** Surface as part of the detail empty state (recommended) or accept the GAP?
11. **W2-A read-path dependency.** Section 9 of the W2-A design doc spec'd the typo-redirect into `src/app/api/companies/route.ts`; that has not shipped. Schedule the W2-A read-path PR ahead of W2-C Phase 1 so the alias-resolved banner and alias-count badges have data, or ship Phase 1 with those columns empty and backfill in Phase 1.5?
12. **F1-F7 in V1 vs V2.** Defer to V2 as recommended, or include as a stretch in Phase 1?

### 9. Risks and revert paths

- **Memo modal evolution affects 7 callers.** Mitigation: section 8 question 3 forces an explicit decision before any code lands. If we evolve in place, every caller's manual smoke test becomes part of the PR's pre-merge checklist. If we fork, the legacy modal stays untouched and removable in a later sweep.
- **Sidebar refactor blocks every page.** Mitigation: ship sidebar in its own PR ahead of any other Phase 1 work. If something breaks, revert is one PR. The drag-and-drop reorder + `user_profiles.sidebar_section_order` write path must be smoke-tested with at least two accounts.
- **W2-A read-path slippage.** Section 8 question 11 covers this. Phase 1 must have a fallback rendering for empty alias data so the directory and detail page work without the read-path PR.
- **Keyboard nav `j/k/w` collisions with browser shortcuts or other app surfaces.** Mitigation: scope the listener to the directory route only; bail out when an input is focused (matches the convention used by the audit's mood-bar code path; need to add a focus check explicitly).
- **Article grouping drop changes user expectations.** If Lucas drops Events / Sector Context, surface a brief release note in the next handoff.
- **`grid-cols-3` -> 28-row table is a fundamentally different scan pattern.** Users who built muscle memory on the 3-column grid will be slower for the first session. Accept the cost; the audit shows the dense table maps directly to the data structure better.

### 10. Success criteria

- Phase 1 complete when: sidebar refactor merged, directory renders the 28-row table with sector chips and watchlist toggle, detail page renders KPI cluster + canonical alias ribbon (or empty if W2-A read-path slips) + AI Brief + Themes + Recent Coverage + Sources, memo modal is fullscreen with citation anchors wired.
- All Phase 1 changes pass `npx tsc --noEmit` clean and ESLint without new warnings on touched files.
- Each Phase 1 surface has a manual smoke-test recipe in its PR body (no test infra exists for these paths; matches the convention in PR #185 and PR #189).
- Zero protected-file modifications outside the W2-C surfaces. The protected-file list at the start of `docs/w2-a-entity-resolution-design.md` is the binding inventory.
- Phase 2 ships within one week of Phase 1.
- V1 telemetry from the first week of Phase 1 informs whether F1-F7 ships in Phase 3 or is dropped entirely.
- `MemoModal` evolution (per section 8 question 3) does not regress any of the 7 calling pages. Each caller's smoke test is part of the PR.
