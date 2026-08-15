# Batch 6 build brief: Deal Flow, Deal detail, Signal, Story, Live Feed

Recon only. No implementation code. Every repo path below was opened with Read in this pass.
Provenance authority is `design_handoff_signalera_mobile/github.md`. Where github.md and the
prototype disagree, both are quoted and neither is resolved here.

Prototype file: `design_handoff_signalera_mobile/Signalera Mobile v3.dc.html` (3749 lines).

---

## Screens

### Deal Flow

- **Flag `isDeals`.** Confirmed in the prototype at line 2505 (`<sc-if value="{{ isDeals }}">`),
  with the flag defined at line 3240 (`isDeals: s.screen === 'deals'`) and the nav handler at
  line 3521 (`goDeals: this.go('deals')`).
- **Route: `/deal-flow`, exists.** `src/app/deal-flow/page.tsx`. No new route needed for the list.
- Repo sources github.md maps to it:
  - `src/app/deal-flow/page.tsx`. 39,498 bytes, client component, `Suspense` wrapper plus
    `DealFlowContent`. The stage taxonomy is at lines 69 to 76: `type StageFilter = "ALL" |
    "rumored" | "announced" | "under_loi" | "closed"` and `STAGE_CONFIG` with labels Rumored,
    Announced, Under LOI, Closed. `STATUSES` at line 96 is the render order. `getDealStage` at
    line 91 falls back `deal.stage || deal.status || "rumored"`, so stage is a two-column read
    with a default, not a single column. The filter tabs at lines 561 to 593 are the
    "Label (count)" pattern github.md recorded; the result line at lines 765 to 774 is
    `{n} deals · {STAGE_CONFIG[filterStage].label}`. The `Deal` interface at lines 49 to 67 is
    the whole available field set: company, acquirer, deal_type, stage, status, value, valuation,
    sector, notes, summary, thesis, source, source_url, auto_extracted, updated_at, ingested_at.
    Fetch is `deal_flow` ordered by `updated_at` desc, limit 200 (lines 211 to 228).
- github.md's own words on this screen, after the "Card layout is still this project's own" clause:
  "stage taxonomy read this turn (rumored / announced / under_loi / closed), filter-tab
  \"Label (count)\" pattern, \"N deals · Label\" result line. Card layout is still this project's own."
  The prototype card (lines 2517 to 2544) is therefore design-owned: stage word plus aggregate
  value on one baseline, Playfair claim line, one-line rationale, a mono `TICKER · SECTOR · DATE`
  slug, and a per-card "Generate a deal memo" button.
- Correction receipt to preserve, quoted from github.md: "Read `deal-flow/page.tsx`. The stage
  taxonomy was wrong: the real statuses are rumored / announced / under_loi / closed.
  \"Terminated\" was invented and is removed; \"Rumored\" was missing and is added." And:
  "Corrected a FALSE receipt: the Deal Flow row previously read \"designed fresh; no repo or
  visual reference\", while `src/app/deal-flow/page.tsx` exists at 39,498 bytes."

### Deal detail

- **Flag `isDealDetail`.** Confirmed at line 1458, flag defined at line 3653, handler at line 3656.
  Reachable from the dev strip (line 2656) and from every Deal Flow card headline (`goDealDetail`).
- **NEW ROUTE NEEDED.** Proposed: `src/app/deal-flow/[id]/page.tsx`, keyed on `deal_flow.id`
  (the uuid on the `Deal` interface, `src/app/deal-flow/page.tsx` line 50). Back affordance in the
  prototype returns to Deal Flow (line 1460).
- Repo sources github.md maps to it:
  - `src/app/deal-flow/page.tsx`. Stage vocabulary only, per github.md: "Stage vocabulary from
    `src/app/deal-flow/page.tsx`. The dated process timeline and terms block are this project's
    own; the repo has no per-deal detail page." Confirmed: no `deal-flow/[id]` directory exists
    and no per-deal route appears in the App Router page list.
- Design-owned content with no backing column anywhere in the `Deal` interface: the three-row
  dated process timeline (line 1467 to 1469), the four terms rows Consideration, Implied
  EV / EBITDA, Premium to undisturbed, Financing (lines 1473 to 1476), and the
  "why the desk is watching" prose (line 1479). The nearest existing fields are `notes`,
  `summary` and `thesis`, all free text.
- The footer carries two actions (lines 1486 to 1487): "Deal memo" via `genMemo`, and
  "Track this call" via `openSheet`, which is the commit sheet, the graded path.

### Signal

- **Flag `isSignal`.** Confirmed at line 2199, flag defined at line 3581, handler at line 3583.
  Per-screen clock is 12:26 (line 3234), one of the afternoon-screen clocks github.md records
  fixing.
- **NEW ROUTE NEEDED.** Proposed: `src/app/trends/[signal_id]/page.tsx`, keyed on
  `trend_clusters.id`. There is no signal route in the repo. The repo's signal detail is a modal
  rendered inside `src/app/trends/page.tsx` (lines 980 to 1200), gated on `modalSignal` state and
  opened by `handleCardClick` at line 684.
- Repo sources github.md maps to it:
  - `src/components/trends/signal-card.tsx`. 3,143 bytes. Exports `SignalData` (id, title,
    anomaly, description, sparkData?, timestamp, industry_verticals, activity_types) and a card
    with `MiniSparkline` at 80 by 24 units, stroke width 1.5, colour keyed off anomaly level.
    **It is never rendered anywhere in `src/`.** The only import of the module family outside the
    folder is a type-only import (see below).
  - `src/components/trends/anomaly-badge.tsx`. 1,099 bytes. `AnomalyLevel = "low" | "medium" |
    "high" | "critical"`, a per-level Tailwind class map (`bg-red-100 text-red-700
    border-red-300` for critical), and a 6px dot that carries `animate-pulse` on critical only.
    **Also never rendered.**
  - `src/components/trends/index.ts`. Two lines, exports both components. No consumer.
  - `src/app/trends/page.tsx`. **LUCAS-PROTECTED.** 53,458 bytes. Line 15 imports
    `type { AnomalyLevel }` from anomaly-badge, and that type import is the entire live coupling
    between the trends route and the two components github.md names. The route renders its own
    inline card (lines 858 to 899) and its own local `Pill` (line 612, declared inside the
    component body). `strengthToAnomaly` at lines 128 to 133 is the real level derivation:
    `>= 0.8 critical`, `>= 0.6 high`, `>= 0.4 medium`, else low. The `TrendSignal` interface at
    lines 65 to 83 is the available field set. The modal at lines 980 to 1200 is the closest
    thing the repo has to this screen: badge row (Emerging, N sources verified, Underreported),
    display title, tagline, a four-cell stat grid (Articles, Sources, First seen, Status where
    status is `lookback_run_count <= 1 ? "Emerging" : "Recurring"`), companies with a watchlist
    add, themes, source articles with a per-article completeness badge, a related-thesis link,
    and Generate Memo.
- The prototype's four-cell grid (lines 2212 to 2217) reads SOURCES 41, FILINGS 9, WINDOW 11 days,
  ISSUERS CEG VST NRG TLN. `trend_clusters` as selected at line 453 carries `article_count`,
  `source_count`, `top_companies`, `created_at`, `lookback_run_count`. There is no filings count
  and no window field, and the design's "SOURCES 41" is the article count in the accompanying
  prose ("Nine filings and 41 articles", line 2210) while `source_count` is a separate column.
- Prototype defect, flagged not fixed: the Signal footer control at line 2228 is a 52 by 50 div
  with `cursor:pointer`, no `onClick`, no `tabindex`, no `role` and no label. README states
  "A `cursor:pointer` element with no handler is a defect."

### Story

- **Flag `isStory`.** Confirmed at line 1493, flag defined at line 3654, handler at line 3656.
  Entered from Live Feed rows and the dev strip (line 2657); back link returns to Live Feed.
- **NEW ROUTE NEEDED.** Proposed: `src/app/story/[id]/page.tsx`. No article or story route exists
  in the App Router.
- Repo sources: **none.** github.md marks this screen designed fresh. Verbatim: "Story (reader
  view) | designed fresh. No article reader exists in the repo; rendering is publisher-indexed."
  No substitute source has been assigned here.
- What the prototype ships, for scoping only: mono kicker `REUTERS · 2026-08-06 06:12 PT · 4 MIN`,
  24px Playfair headline, a 16px lede then 15px body at 1.72 leading, a Playfair italic pull
  quote, a "why you are seeing this" rule, a linked open-call card with a 2px gold top edge, the
  line "Indexed from the publisher. Signalera does not host the full text. Informational only."
  and a real `<a target="_blank" rel="noopener noreferrer">` to the publisher. Header carries
  save (`toggleSave`) and share (`goShare`).

### Live Feed

- **Flag `isFeed`.** Confirmed at line 2234, flag defined at line 3582, handler at line 3584.
- **Route: `/live-feed`, exists.** `src/app/live-feed/page.tsx`.
- Repo sources github.md maps to it, quoted: "`src/app/live-feed/page.tsx` (time buckets, dedupe,
  sentiment, filters)".
  - `src/app/live-feed/page.tsx`. 26,329 bytes. `getTimeBucket` at lines 51 to 65 returns
    LAST HOUR, TODAY, YESTERDAY, EARLIER, and the render orders exactly those four (line 372).
    `dedupeStories` at lines 88 to 124 groups on `normalizeTitle` (lowercased, punctuation
    stripped, first 60 chars), keeps the newest as primary and hangs the rest off
    `duplicateArticles`; the rollup control is at lines 543 to 552 and renders
    `▾ +N sources: Bloomberg, FT`, which is the exact string shape the prototype's `srcLabel`
    reproduces at line 3618. `sentimentFromDb` at lines 32 to 38 collapses positive/negative to
    bullish/bearish. New-article detection at lines 224 to 236 plus a 30 second clear at line 254;
    the "N new" marker sits on the LAST HOUR header only (line 519). Poll interval is 60s
    (line 247). `lastRefresh` renders as `Updated HH:MM` (line 414), which the prototype mirrors
    as `UPDATED 12:41` (line 2236).
  - `src/components/feed/feed-row.tsx`. The row anatomy: unread gold dot, `SentimentPill`,
    vertical and activity pills, source, timestamp pushed right, then `CompletenessBadge`,
    `SignalScore`, `SourceCredibilityBadge`. Body summary, tags and all four actions live behind
    `onMouseEnter` / `onMouseLeave` expansion (lines 45 and 46), which has no touch equivalent.
  - `src/components/feed/filter-bar.tsx`. Two chip species by deliberate design: `FilterPill`
    (category, espresso fill when active, count nested at 70 percent opacity) and `UtilChip`
    (Alerts and Saved, gold-tinted, "functional toggles ... rather than filter categories"). The
    prototype collapses all four of its chips into one treatment.
  - `src/lib/article-signal.tsx`. `SignalScore` at lines 35 to 42 renders `Signal: 8.4`.
    `CompletenessBadge` renders Full text, Summary or Headline only, which is the honest read on
    how much body text a story actually has.

---

## Shared component to extract first

**The filter chip row.** One horizontally wrapping row of `label + count` chips that drives a
client-side lens over a list, plus the derived result line beneath it.

Consumers in this batch: **Deal Flow** (All 61, Rumored 16, Announced 22, Under LOI 14, Closed 9,
lines 2510 to 2514) and **Live Feed** (Yours 142, Everything, Alerts 6, Saved 9, lines 2239 to
2242). Consumer immediately adjacent and out of batch: **Trends** (All 34, Critical 2, High 5,
Medium 11, My sectors, lines 2133 to 2137). All three already share one style function in the
prototype, `chip(on)` at line 3220: `min-height:44px`, `border-radius:6px`, 12px Inter, ink border
and `--c-surface` fill when active, transparent with `--c-border` when not.

It goes first because the repo has three separate implementations of the same object and none is
reusable as-is:

- `src/app/deal-flow/page.tsx` lines 563 to 593: inline `<button>` chips, gold-outline active
  state, label `Rumored (16)` with the count in parentheses.
- `src/components/feed/filter-bar.tsx` lines 31 to 82: two components, `FilterPill` (espresso
  fill, count nested inside the pill) and `UtilChip` (gold-muted, badge count), fully rounded.
- `src/app/trends/page.tsx` line 612: a local `Pill` declared inside the component body, so it is
  redefined on every render and cannot be imported. This one sits in a protected file and must be
  left alone.

What varies between consumers, and must be props rather than forks:

1. **Count presence.** Deal Flow and Trends always carry a count. Live Feed's "Everything" chip
   carries none while its three siblings do.
2. **Chip semantics.** Deal Flow and Trends chips are mutually exclusive lenses (`setDeals`,
   `setTrends`, both `all` plus one). Live Feed's four are also exclusive in the prototype
   (`setFeed`), but the repo treats Alerts and Saved as independent boolean toggles
   (`showAlertsOnly`, `showSavedOnly`, `src/app/live-feed/page.tsx` lines 130 and 131), so the
   two can be on at once in production and cannot be in the design.
3. **The result line.** Deal Flow derives a sentence per lens (`dealCount`, line 3598: "61 deals.
   The whole universe, not only what you follow." then `22 deals · Announced` and siblings). Live
   Feed derives per-bucket counts instead (`fdH1Count` / `fdH2Count`, lines 3595 and 3596). Same
   component, two different derived-figure slots.
4. **Colour role.** Deal Flow's stage word is coloured per stage in the card
   (`--c-amberink` rumored and under LOI, `--c-secondary` announced, `--c-greenink` closed), but
   the chips themselves are never stage-coloured. Do not let stage colour leak into the chip.

README's rule applies to all of them: 44px minimum tap target, radius 6 is inside the sanctioned
4 / 6 / 9 / 12 / 14 scale. Note the sibling `pill()` helper at line 3230 uses `border-radius:99px`,
which is outside that scale; it is used by Filings, not by this batch, and is flagged here only so
the extraction does not copy it.

---

## Component inventory

| Component | Existing path | Status | Note |
|---|---|---|---|
| Filter chip row | `src/components/feed/filter-bar.tsx` (`FilterPill`, `UtilChip`) | Needs variant | Three repo implementations, one design treatment. See section above. Trends' copy is trapped in a protected file. |
| Stage label and colour map | `src/app/deal-flow/page.tsx` lines 71 to 76 (`STAGE_CONFIG`) | Needs variant | Colours are Tailwind (`text-blue-600 bg-blue-50`), not cream / espresso / gold. A second divergent copy exists at `src/app/saved/page.tsx` lines 13 to 18 with ALL CAPS labels, which the brief forbids as decorative capitals. |
| Stage resolver | `src/app/deal-flow/page.tsx` line 91 (`getDealStage`) | Reusable as-is | Pure function, `stage || status || "rumored"`. Duplicated verbatim at `src/app/saved/page.tsx` line 20. |
| Deal card | `src/app/deal-flow/page.tsx` lines 789 to 950 | Needs variant | Repo card is company-first with acquirer, watchlist star, bookmark and an expand. Prototype card is claim-first with a Playfair sentence. github.md: "Card layout is still this project's own." |
| Deal memo action | `src/components/memo/MemoModal.tsx`, imported at `src/app/deal-flow/page.tsx` line 24 | Needs variant | Portal modal with markdown, copy, PDF download and a thumbs control. Mobile wants a full-screen memo screen. `MemoModal.tsx` is propose-only under CLAUDE.md. |
| Deal detail screen | none | Net new | Closest analogue is the expanded deal card in `src/app/deal-flow/page.tsx` lines 789 to 950. Timeline and terms have no repo counterpart and no backing columns. |
| Signal detail screen | none | Net new | Closest analogue is the modal in `src/app/trends/page.tsx` lines 980 to 1200. Extraction of that modal would mean editing a protected file. |
| Anomaly badge | `src/components/trends/anomaly-badge.tsx` | Needs variant | Never mounted. Tailwind red / amber palette, not the token system. `animate-pulse` on critical conflicts with README's reduced-motion rule unless gated. |
| Signal card | `src/components/trends/signal-card.tsx` | Needs variant | Never mounted. `sparkData` is optional and nothing populates it; `trend_clusters` has no time series. Consumed by the Trends list, which is out of batch. |
| Anomaly level derivation | `src/app/trends/page.tsx` lines 128 to 133 (`strengthToAnomaly`) | Reusable as-is | Pure function on `strength_score`. Read-only use, no edit needed. |
| Feed row | `src/components/feed/feed-row.tsx` | Needs variant | Hover-expand has no touch equivalent, the same class of mobile defect github.md found in the memo sources rail. Prototype renders summary always visible, clamped to 2 lines. |
| Time bucket grouping | `src/app/live-feed/page.tsx` lines 51 to 65 and 369 to 380 | Reusable as-is | Prototype shows only Last hour and Today; Yesterday and Earlier exist in the repo and have no prototype rendering. |
| Source dedupe rollup | `src/app/live-feed/page.tsx` lines 88 to 124 and 543 to 580 | Reusable as-is | Logic is portable unchanged. The disclosure UI needs a 44px target; the repo control is a 9px chip. |
| Sentiment pill | `src/components/ui/sentiment-pill.tsx` | Reusable as-is | github.md lifted this verbatim for the Market Pulse driver chips. The mobile Live Feed does not use it; see deviations. |
| Signal score | `src/lib/article-signal.tsx` lines 35 to 42 | Needs variant | Renders `Signal: 8.4`. README open decision 8 forbids a per-story scalar. Live in the repo feed row today. |
| Completeness badge | `src/lib/article-signal.tsx` lines 12 to 33 | Reusable as-is | Full text / Summary / Headline only. Not rendered anywhere in the prototype; it is the honest read on how much body a Story screen will actually have. |
| Empty state | `src/components/ui/empty-state.tsx` | Reusable as-is | icon, title, description, action. Already used by both list routes. |
| Skeleton | `src/components/ui/skeleton.tsx` | Reusable as-is | `skeleton-shimmer` class, matching README's 1.8s `skeletonShimmer`. `SkeletonCard` exists and is unused by these routes. |
| Commit sheet entry from Deal detail | `src/components/calls/TrackCallControl.tsx` | Needs variant | The one implementation of committing to a call, and it takes a claim-shaped object (`TrackedClaimLike`, lines 69 to 73). A deal row is not a claim. See open question 4. |

---

## States

Handoff position first, then what exists in the repo. Nothing invented.

README's Overview asserts "**31 screens**, all reachable, each with its loading, error, empty and
stale states." For this batch that assertion does not hold: the prototype's dev strip exposes
lifecycle jumps only for Brief loading, Brief error, No brief, Stale brief, Wrap loading, No wrap,
Commit fails and Replay splash. None of the five screens here has one. Recorded as a contradiction,
not resolved.

### Deal Flow

- **Loading: UNSPECIFIED.** Repo has a 4 by `h-20` skeleton block (`src/app/deal-flow/page.tsx`
  lines 747 to 753).
- **Error: UNSPECIFIED, and absent from the repo too.** The fetch logs and returns on error
  (lines 218 to 221), leaving `deals` empty, so a failed read renders as the empty state. This is
  the exact failure github.md calls out as a trust failure: "This is a failed read, not an empty
  result. Nothing is being hidden."
- **Empty: UNSPECIFIED in the handoff.** Repo has two: "Deal pipeline populating" with
  "AI is extracting deals from ingested articles. Check back shortly." (lines 756 to 762) and
  "No deals match" with "Try a different search term or filter" (lines 952 to 957).
- **Stale: UNSPECIFIED.** No freshness stamp on this screen in either the prototype or the repo.

### Deal detail

- **Loading, error, empty, stale: all UNSPECIFIED.** The prototype renders one populated instance
  with no alternate states, and there is no repo route to inherit states from.

### Signal

- **Loading: UNSPECIFIED.** The repo modal has a partial: source articles render
  "Loading articles..." in italic 11px while `articleCache` fills (`src/app/trends/page.tsx`
  line 1159). The list behind it uses a 5 by `h-20` pulse block (lines 786 to 791).
- **Error: UNSPECIFIED, and absent from the repo.** `[trends] fetch error` is logged only
  (line 459), so a failed read falls through to the empty state.
- **Empty: UNSPECIFIED for the detail screen.** The list has "No trend clusters yet" and
  "No signals match your filters" (lines 792 to 797 and 824 to 829); a signal detail cannot be
  empty because it is only reachable from a populated card.
- **Stale: UNSPECIFIED.** The prototype shows `EMERGING · FIRST SEEN JUL 26` (line 2205), which is
  provenance, not freshness.

### Story

- **Loading, error, empty, stale: all UNSPECIFIED.** No source, no route, no states in the
  prototype. The only lifecycle-adjacent behaviour is the save toggle (`saveIcon` / `saveLabel`).

### Live Feed

- **Loading: UNSPECIFIED.** Repo renders 5 skeleton rows and only when `articles.length === 0`, so
  a poll refresh never flashes a skeleton (`src/app/live-feed/page.tsx` line 455).
- **Error: UNSPECIFIED, and absent from the repo.** `Failed to fetch articles` is logged only
  (line 238).
- **Empty: partially specified.** The prototype authors one empty block at line 2287, "Nothing
  saved yet" with "Tap the bookmark on any article to keep it here." **It is unreachable as
  built**: `setFeed` sets `empty:0` for all four lenses including `saved` (lines 3111 to 3120), so
  no chip can display it. The repo has three distinct empties: saved (bookmark icon, "No saved
  articles yet"), alerts ("No bearish signals in the last 48 hours"), and filtered
  ("No stories match this filter"), at lines 468 to 491.
- **Stale: partially specified.** The header carries `UPDATED 12:41` (line 2236) and a green
  "2 new" marker on the Last hour bucket. Neither is a stale state; there is no rule for what the
  screen shows when the poll stops returning. Repo backing: `lastRefresh` at line 414, 60s poll at
  line 247, 30s new-marker clear at line 254.

---

## Lucas-protected files

Of the four, this batch's sources touch exactly one.

- `src/app/api/briefing/route.ts`: not touched. No screen in this batch reads briefing data.
- `src/lib/watchlist-utils.ts`: not touched by any mapped source. Note for scope control:
  `src/app/trends/page.tsx` performs its own watchlist insert inline (lines 655 to 675) rather than
  going through that helper, and `src/app/deal-flow/page.tsx` has its own
  `handleAddToWatchlist`. If any screen in this batch grows an add-to-watchlist affordance it will
  need a decision about which path it uses, and that decision touches a protected file. The
  prototype's Signal, Deal Flow, Deal detail, Story and Live Feed screens carry **no**
  add-to-watchlist control, so as designed this batch stays clear of it.
- `src/components/watchlist/WatchlistAddInput.tsx`: not touched.
- `src/app/trends/page.tsx`: **touched, and it is the hard case.** Detail below.

### How Signal lands without editing `src/app/trends/page.tsx`

The problem, stated precisely: github.md maps the Signal screen to that file, and the file is the
only place the repo has ever rendered a signal detail. That detail is a **modal**, `modalSignal`
state plus the block at lines 980 to 1200, opened by `handleCardClick` (line 684) from a card the
same file renders inline. There is no route, no exported component, and no props boundary. Every
piece of it (badges, stat grid, companies, themes, source articles, related thesis, memo action) is
inline JSX inside `TrendsPage`. Extracting it is a rewrite of the protected file.

What the mobile Signal screen actually needs from it, and how each need is met read-only:

1. **The data shape.** `TrendSignal` (lines 65 to 83) and the exact select list at line 453. The
   new route re-declares its own interface against the same `trend_clusters` columns. Reading a
   type off a protected file costs nothing; copying the interface into the new route means no
   import edge back into it.
2. **The level derivation.** `strengthToAnomaly` (lines 128 to 133) is a pure function of
   `strength_score` with fixed thresholds 0.8 / 0.6 / 0.4. Reimplement it in a shared lib that the
   new route imports. Do not move it out of the protected file, and do not let the two drift: if a
   threshold changes in one, the badge on Trends and the badge on Signal disagree.
3. **The dedupe.** `deduplicateSignals` (line 274) and `areSignalsDuplicates` (line 182) run on the
   list, not the detail. The detail route fetches one row by id and needs neither.
4. **The article fetch.** Lines 506 to 517 fetch `representative_article_ids.slice(0, 10)` when the
   modal opens. The new route does the same fetch on its own, keyed on the route param, with no
   coupling to the modal's `articleCache`.
5. **The entry point.** This is the only genuine collision. In the repo, tapping a trend card opens
   a modal in place. In the design, tapping it navigates to `/trends/[signal_id]`. Changing that
   means editing `handleCardClick`, which is a protected-file edit. **The batch ships without it.**
   Signal is reachable from three prototype affordances that are not in the protected file: the
   Live Feed "Grid capacity" cluster link (line 2266), the Watch industry rows (lines 706 and 714)
   and the Watch coverage row (line 728). Build the route, wire those entries, and leave the
   Trends list untouched. Then propose one diff to Lucas: `handleCardClick` becomes
   `router.push('/trends/' + signal.id)`, or the modal keeps working on desktop and only the
   mobile breakpoint navigates. Propose it, do not apply it.
6. **Do not touch the local `Pill`** at line 612. It is the third copy of the chip primitive this
   batch wants to extract. The Signal detail screen has no chip row, so the extraction can proceed
   for Deal Flow and Live Feed and simply leave the Trends copy in place until Lucas rules.

Two further observations from reading that file, raised for Lucas rather than acted on:

- Line 699 renders "Previewing trend signals", then a U+2014 em dash, then "sign in to unlock all
  N signals and filters." Line 146 (`getDisplayTitle`) joins label segments on a space-padded
  U+2014, written in source as an HTML entity escape. Both are em dashes in user-facing copy, which README
  rule 4 forbids. Described by codepoint here rather than reproduced.
- `Pill` is declared inside the render body, so it is a new component identity on every render and
  React remounts the subtree. Performance nit only, and not this batch's to fix.

---

## Designed fresh, no repo counterpart

One screen in this batch. github.md, verbatim:

> Story (reader view) | designed fresh. No article reader exists in the repo; rendering is
> publisher-indexed.

No repo source has been assigned to Story and none is proposed here. That is a finding, not a gap
to fill. The Deal detail screen is a partial case of the same thing, quoted in full:

> Deal detail | Stage vocabulary from `src/app/deal-flow/page.tsx`. The dated process timeline and
> terms block are this project's own; the repo has no per-deal detail page.

---

## NOT PORTED and deviations

Restricted to these five screens.

1. **README Gaps, item 2.** Titled "Trends and Live Feed interiors", it reads: "entry rows with
   real counts only. No visual reference exists for their interiors." This sits directly against
   the Screens table, which gives Live Feed the flag `isFeed` with the note "Grouped coverage.
   Interiors are rows only, see Gaps", and Trends the flag `isTrends` with "Theme list. Interiors
   not built, see Gaps". The Live Feed screen in this batch **is** the entry surface; what is
   unbuilt is what sits behind a row, and the prototype answers that with Story, which is designed
   fresh. Flagged, not resolved.
2. **Deal Flow, stage taxonomy correction.** github.md: "The stage taxonomy was wrong: the real
   statuses are rumored / announced / under_loi / closed. \"Terminated\" was invented and is
   removed; \"Rumored\" was missing and is added." Residue remains in the prototype: the handler
   is `dlTerm`, the state value is `'term'`, and the CSS variable is `--v3-dlTerm`, all while the
   rendered label is "Rumored" (lines 2511, 3600, 3604, 3130). Name the production filter
   `rumored`.
3. **Deal Flow, FALSE receipt corrected.** github.md: "Corrected a FALSE receipt: the Deal Flow row
   previously read \"designed fresh; no repo or visual reference\", while
   `src/app/deal-flow/page.tsx` exists at 39,498 bytes." Verified this pass: the file exists at
   that size.
4. **Deal Flow card layout is design-owned.** github.md: "Card layout is still this project's own."
   Nothing about the repo card anatomy carries over except the stage words and the count pattern.
5. **Coloured left borders, three live instances against a standing prohibition.** README:
   "Forbidden visual treatments: Frosted glass, gradients on surfaces, **coloured left borders**,
   all-caps decorative treatments," and github.md logs a retraction where a 10px gold left bar was
   removed for exactly this reason. Yet: the Story screen's pull quote at prototype line 1504 uses
   `border-left:2px solid var(--c-gold)`; the repo deal card applies `border-l-2 border-gold` when
   a deal is both high-relevance and saved (`src/app/deal-flow/page.tsx` line 800); and the repo
   feed marks a new article with `absolute left-0 ... w-0.5 bg-signal-up`
   (`src/app/live-feed/page.tsx` line 536). The design's own sanctioned treatment is a 2px **top**
   edge plus a dot and a word. Both sides quoted, not resolved.
6. **Sentiment, two treatments inside one design.** github.md logs the driver chips being grounded
   in `sentiment-pill.tsx` and lifted at `size="sm"` on all eight properties, and records the
   contradiction it resolved: "the guide states \"Sentiment pills are SHOUTED\" ... but
   `SentimentPill` renders `tone.charAt(0) + tone.slice(1).toLowerCase()`. The mobile design
   follows the component." The Live Feed screen does not follow it: sentiment renders as bare
   coloured text at 10.5px semibold in `--c-greenink` / `--c-redink` / `--c-secondary`
   (prototype lines 2247, 2263, 2270). Same datum, two anatomies across screens.
7. **`SignalScore` is live in the repo feed.** README open decision 8: "Numeric SIGNAL scores
   (8.4, 9.1) per story. A per-story scalar is the same class of derived figure the brief forbids"
   and sources it to the live marketing site. It is also in the product:
   `src/components/feed/feed-row.tsx` line 102 renders `<SignalScore score={story.adjustedScore} />`
   and `src/lib/article-signal.tsx` line 39 prints `Signal: {score.toFixed(1)}`. The prototype
   renders no score. NOT PORTED, and the conflict is wider than the README records.
8. **Signed-out gating, NOT PORTED and not acknowledged.** `src/app/live-feed/page.tsx` line 494
   sets `GATE_LIMIT = user === null ? 5 : filtered.length` and truncates the feed at five stories
   for signed-out readers; `src/app/trends/page.tsx` lines 696 to 718 render a preview banner and
   replace the whole filter bar with "Filters available after sign in". The prototype has neither,
   on any of the five screens.
9. **Feed row expansion, NOT PORTED by necessity.** The repo row reveals summary, tags and all four
   actions on `onMouseEnter` (`src/components/feed/feed-row.tsx` lines 45 and 46). The prototype
   shows the summary permanently, clamped to two lines, and keeps only a source link and a ticker
   or cluster link. This is the same class of finding as the memo sources rail github.md fixed:
   a desktop-only reveal that resolves to nothing at phone width.
10. **Time buckets, partially ported.** The repo produces four buckets, LAST HOUR / TODAY /
    YESTERDAY / EARLIER (`src/app/live-feed/page.tsx` lines 57 to 64). The prototype renders two,
    Last hour and Today. No note anywhere says whether the other two were dropped or simply not
    drawn.
11. **Stage vocabulary duplicated with forbidden casing.** `src/app/saved/page.tsx` lines 13 to 18
    holds a second `STAGE_CONFIG` with labels RUMORED / ANNOUNCED / UNDER LOI / CLOSED. README:
    "All-caps sentiment pills dropped from product copy. Forbidden decorative capitals."
12. **`SignalCard` and `AnomalyBadge` are dead code.** github.md states the signal screens were
    "Built ... from `signal-card.tsx` / `anomaly-badge.tsx` / `trends/page.tsx`". Verified this
    pass: neither component is rendered anywhere under `src/`. The only cross-folder reference is
    `import type { AnomalyLevel }` at `src/app/trends/page.tsx` line 15. The design was grounded in
    components the product does not mount, which is not wrong, but it means there is no shipped
    visual precedent to match.
13. **`animate-pulse` on the critical anomaly dot** (`src/components/trends/anomaly-badge.tsx`
    line 33) has no equivalent in the prototype, and README requires
    `@media (prefers-reduced-motion: reduce)` to disable every animation.

---

## Open questions

1. **Signal's entry point.** The repo opens signal detail as a modal inside the Lucas-protected
   `src/app/trends/page.tsx`. Building `/trends/[signal_id]` is clean, but making the Trends list
   navigate to it requires editing `handleCardClick` in that file. Ship the route wired only from
   Live Feed and Watch and propose the one-line diff, or hold Signal until Lucas rules on the
   protected edit?
2. **Signal's stat grid has two fields that do not exist.** The design asks for SOURCES, FILINGS,
   WINDOW, ISSUERS. `trend_clusters` supplies `article_count`, `source_count`, `top_companies`,
   `created_at`, `lookback_run_count`. There is no filings count and no window. Also, the design's
   SOURCES cell shows 41, which its own prose calls the article count, while `source_count` is a
   different column. Which field backs which cell, and do we drop FILINGS and WINDOW or add them
   to the cluster payload?
3. **Deal detail has no data.** The process timeline and all four terms rows (Consideration,
   Implied EV / EBITDA, Premium to undisturbed, Financing) have no columns on `deal_flow`. Ship the
   screen against the fields that exist (company, acquirer, deal_type, stage, value, sector, notes,
   summary, thesis, source_url), or is a schema and extractor change in scope for this batch?
4. **Deal detail's "Track this call" has no claim.** `TrackCallControl` takes a claim-shaped object
   and the commit path writes a graded ledger entry, but the same screen's YOUR POSITION block
   reads "You are tracking this with a view since Jul 30. No direction, no window, so it is never
   graded." A deal row carries no direction and no horizon. Does the CTA open the composer
   pre-filled, create an ungraded context follow, or come off this screen?
5. **Story's body.** github.md says designed fresh and publisher-indexed, and the prototype's own
   footer says "Signalera does not host the full text," yet it renders four paragraphs plus a pull
   quote. `CompletenessBadge` in the repo classifies a large share of articles as Summary or
   Headline only. What does Story render when there is no body, and does the design's reader view
   survive that?
6. **Signed-out behaviour.** Live Feed truncates at five stories and Trends locks its filters for
   signed-out readers today. The prototype has neither. Does mobile carry the gate, drop it, or
   redirect signed-out traffic to Landing?
7. **Sentiment treatment.** `SentimentPill` is the repo's stated single source of truth and
   github.md lifted it verbatim for the driver chips, but the mobile Live Feed renders bare
   coloured words. Pick one before either is built, because the pill is a shared component and the
   bare word is not.
8. **Trends is unassigned.** It is Signal's parent surface, README's Gaps item 2 says its interior
   has no visual reference, and the prototype does render a full `isTrends` screen at lines 2128 to
   2197. Who owns that screen, and does the chip-row extraction cover its `Pill` given the file is
   protected?
9. **Stage vocabulary needs one owner.** `STAGE_CONFIG` exists twice, in `src/app/deal-flow/page.tsx`
   and `src/app/saved/page.tsx`, with different casing and different colours. Extract to one module
   as part of this batch, or leave both and let mobile carry a third?
10. **`SignalScore` disposition.** It renders `Signal: 8.4` in the shipped feed row today. README
    open decision 8 forbids a per-story scalar but records it only against the marketing site.
    Suppress in the mobile row only, or remove from `feed-row.tsx` and make the decision
    product-wide?
