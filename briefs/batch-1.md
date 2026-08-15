# Build brief, batch 1: Dashboard, Evening Wrap

Recon only. No implementation. Every repo path below was opened with Read.
Em-dashes in quoted source strings are rendered as `[EMDASH]` so this document
stays compliant while still showing the defect being quoted.

## Screens

### Dashboard (Today)

**Prototype flag:** `isDash`. Confirmed in `Signalera Mobile v3.dc.html` at line
1285 (`<sc-if value="{{ isDash }}">`), closing at 1396. Bound at line 3350:
`isDash: s.screen === 'dash'`. Two sub-branches only: `dashLoading` (1295) and
`dashReady` (1314). The briefing splash is a separate overlay driven by
`intro`/`introSeen` at 3352 and 3441 to 3449.

**Route:** `/dashboard`, already live at `src/app/dashboard/page.tsx`. No new
route. `src/components/shell/mobile-bottom-nav.tsx:31` already lists it as the
first primary tab (`{ label: "Dashboard", href: "/dashboard" }`), so the Today
pole maps onto an existing URL with no redirect.

**Sources github.md maps to this screen** (Screen map row "Dashboard (Today)"):

- `src/app/dashboard/page.tsx`: 942 lines. Wraps everything in
  `DashboardReadyProvider` / `DashboardRevealGate`. Four parallel loaders
  (`loadCounts`, `loadSpark`, `loadBriefing`, `loadStories`) joined by
  `Promise.allSettled`. Carries the For You / All tab, the bullish/bearish
  counts, `DEFAULT_MARKET_CARDS = ["SPY","VIX","TNX","SIGNALS"]`, `MIN_CARDS 2`
  / `MAX_CARDS 4`, and the real `dash-rise` delay ladder at the call sites.
- `src/components/dashboard/greeting.tsx`: 97 lines. The header slot: italic
  Playfair `text-[16px] text-gold-dark` eyebrow "Your {timeOfDay} briefing",
  Playfair 32/42px `-0.025em` headline "Good {timeOfDay}, {userName}.", italic
  Playfair sub-line. `context` has no default by design; the file comment states
  a hardcoded fallback "reads as a measured observation and is not one". Also
  exports `getMarketStatus()` and `formatShortDate()`.
- `src/components/dashboard/stat-card.tsx`: 144 lines. The figure cell: 10px
  mono label, 22px semibold `font-data` value, 12px delta on a shared baseline
  (`flex items-baseline`), `showDivider` renders the
  `border-l border-[rgba(212,168,75,0.14)]` gold hairline, and the Signals cell
  renders the up/down pair. `sparkData` is accepted and ignored: "the editorial
  stat cell renders no sparkline". Three distinct absence renders live here:
  `changeUnknown` gives "· no quote", `stale` gives "· last close",
  `countsFailed` at the call site gives the value "no count".
- `src/components/dashboard/market-card-editor.tsx`: 198 lines. Source of
  `MARKET_CARD_OPTIONS` (SPY, QQQ, DIA, VIX, TNX, BTC-USD, GC=F, CL=F,
  DX-Y.NYB, SIGNALS) and their display labels, plus `labelForSymbol`. Also holds
  `SortableMarketCard`, the dnd-kit drag wrapper.
- `src/components/dashboard/your-calls-widget.tsx`: 287 lines. `YourCallsWidget`
  plus the private `YourRecordSummary`, which is the four-bucket grid for the
  user's own record. Three honest states, enumerated in the file comment: no
  claims, claims but nothing resolved, real breakdown. Reads
  `/api/radar/claims`. Cannot see desk outcomes by construction.
- `src/components/dashboard/desk-record-summary.tsx`: 146 lines. The desk's
  four-bucket grid with the `of {record.total}` denominator and a coloured 6px
  dot per bucket. `status: "loading" | "ready" | "error"`, three renders.
  Header comment is explicit: never rendered under a "Your ..." heading, no
  top-line hit rate, "Errors and emptiness render as themselves".
- `src/components/dashboard/story-card.tsx`: 576 lines; `CompactStoryCard` is
  lines 400 onward. The 3px gold unread rule, Playfair 22px extrabold ordinal in
  `text-border-base`, meta row order (SentimentPill, sector chip, source,
  timestamp pushed with `ml-auto`), Playfair bold 13px headline. It also renders
  `CompletenessBadge`, `SignalScore` and `SourceCredibilityBadge`, none of which
  the mobile row carries. See NOT PORTED.
- `src/components/dashboard/dashboard-fx.tsx`: 232 lines. `DatePill`
  (9.5px-family mono pill with market status), `CursorGlow`, `TileSpotlight`,
  and `DashboardIntro`, the splash. The splash is gated on
  `sessionStorage["signalera_dash_intro_seen"]`, skipped entirely under reduced
  motion, `setLeaving` at 1900ms, unmount at 2600ms. Its four elements carry
  `animationDelay` 0 / 140 / 260 / 360ms.
- `src/lib/your-record.ts`: 189 lines. `buildYourRecord`, `resolutionForClaim`,
  `YOUR_RECORD_COPY`. No rate is computed here, deliberately: "No aggregate. No
  hit rate, no ratio, no percentage of any kind is computed here, because the
  surface must not be able to render one."
- `src/lib/desk-record.ts`: 275 lines. `RESOLUTION_ORDER`
  (supported, challenged, noCleanRead, notGraded), `DESK_RECORD_COPY` including
  `bucketLabel`, `awaitingNote`, `emptyTitle`/`emptyBody`,
  `errorTitle`/`errorBody`, and the attribution explainer. Bucket order comment:
  "misses are not pushed to the end".
- `src/components/ui/sentiment-pill.tsx`: 71 lines. Title-case label via
  `tone.charAt(0) + tone.slice(1).toLowerCase()`, `letterSpacing: "normal"`,
  `borderRadius: 4`, `--pill-{tone}-{bg,text,border}` triples, four sizes
  (xs 8.5/`2px 5px`, sm 9/`3px 7px`, md 10/`4px 9px`, lg 11/`5px 11px`).
- `src/app/globals.css`: 805 lines. `@keyframes dash-rise` 720ms translateY(12px)
  at 616 to 620, with the comment at 609 that the wrapper "intentionally does NOT
  fade as a block". `.dash-dots` texture 623. `.dash-figcell::after` gold
  baseline, `left:20px right:20px`, hover-triggered, 655 to 670. `.dash-intro`
  radial gold wash 705, `dash-intro-up` 640ms 716, `dash-intro-out` 700ms
  opacity + `scale(1.03)` 715, `dash-mark-glow` 2.2s infinite 717.
  `bar-sweep-in` 400ms `scaleX(0)` to `scaleX(1)` at 311 to 318. Reduced-motion
  block at 777 to 792 kills all of it and hides the splash outright.

Not mapped by github.md but reached by the page and needed to build it:
`src/components/dashboard/dashboard-ready.tsx` (the reveal gate every widget
registers with) and `src/components/dashboard/dash-tile.tsx`. Both exist.

### Evening Wrap

**Prototype flag:** `isEvening`. Confirmed at line 2296, closing at 2406. Bound
at 3547: `isEvening: s.screen === 'evening'`. Sub-branches: `wrapLoading` (2314),
`wrapNone` (2323), `wrapReady` (2331), plus `pbShown` for the personalization
banner (2304) and `closeOpen` for the "Read the full close" toggle (2375).

**Route:** `/evening-wrap`, already live at `src/app/evening-wrap/page.tsx`. No
new route. It sits in the mobile nav's secondary list, not the primary tabs
(`mobile-bottom-nav.tsx:40`).

**Sources github.md maps to this screen** (Screen map row "Evening Wrap"):

- `src/app/evening-wrap/page.tsx`: 1565 lines. The masthead at 786 to 830
  carries the exact gradient github.md lifted:
  `linear-gradient(90deg, #d4a84b 0%, #d4a84b 30%, #1a1208 75%, #1a1208 100%)`,
  "Signal" in `DC_CREAM` with "era" in `DC_ESPRESSO`, the 20px "Evening Wrap"
  title, the italic tagline, and the "5 min read" pill. The comment at 780 says
  it "mirrors Morning Brief". Stats bar 833 to 876: Close / Movers / Theses /
  VIX with the tone colour rules and the muted "CLOSED · Signalera Desk" dot.
  The Close hero at 936 onward: `background: DC_ESPRESSO`, the
  `radial-gradient(circle, ${HERITAGE_GOLD}60, transparent 70%)` corner glow,
  the gold verdict pill, and `SCORECARD_SYMBOLS` (defined at 74) driving the
  six cells. `closeBody` at 690 is the narrative. Colour literals
  `HERITAGE_GOLD` / `DC_ESPRESSO` / `DC_CREAM` are pinned at 87 to 89.
  Lifecycle at 879 to 892 is exactly two branches: `loading` then `!briefing`.
- `src/app/morning-brief/page.tsx`: read only for the masthead comparison
  github.md asserts. Lines 806 to 850 carry a byte-identical gradient string to
  the wrap's, the same 26px wordmark, the same 1px `rgba(26,18,8,0.25)` divider,
  the same structure, and a "4 min read" pill against the wrap's "5 min read".
  The mirror claim holds. Morning Brief is not a batch-1 screen.
- `src/components/brief/ticker-strip.tsx`: 87 lines. The espresso ticker the
  prototype reproduces at 2298 to 2302. Twelve default symbols, items tripled
  for a seamless loop, `animate-[ticker-scroll_60s_linear_infinite]` (the
  prototype's `v3ticker 60s linear` is the same duration), 12px fade masks on
  both edges, 60s refetch interval, dash fallback quotes on error.
- `src/components/personalization/PersonalizationBanner.tsx`: 123 lines. The
  banner the prototype ports at 2304 to 2313. `sessionStorage` dismiss key
  `personalization-banner-dismissed`, re-shown each session. Two variants: an
  incomplete-profile nudge showing a completion percentage, and the
  "Personalized for:" chip row. The chip list is
  `sectors.slice(0,3)` plus `profile.risk_appetite` when set.
- `src/components/ui/empty-state.tsx`: 34 lines. Icon, `font-display` 15px bold
  title, 12px muted description capped at `max-w-[280px]`, optional action. The
  wrap's no-briefing state is this component with a `Moon` icon.
- `src/components/ui/skeleton.tsx`: exports `Skeleton` and `SkeletonText`, the
  two primitives the wrap's loading branch composes.

Also reached from the wrap and needed: `src/components/brief/morning-review.tsx`,
`src/components/brief/WatchlistBriefSection.tsx`,
`src/components/brief/BriefCallsSection.tsx`. github.md does not map these to the
Evening Wrap row; the prototype's "this morning's calls" block (2383 to 2394) is
the mobile counterpart of `BriefCallsSection` with `heading="This Morning's
Calls"` at page.tsx:1184.

**MAPPED BUT MISSING:** none. Every path github.md names for these two screens
exists on disk and was opened.

## Shared component to extract first

**The four-bucket record grid.** Working name `RecordBuckets`.

**Consumed by, inside this batch:**
- Dashboard, "your record" block (prototype 1345 to 1355), grounded in
  `YourRecordSummary` inside `src/components/dashboard/your-calls-widget.tsx:92`.
- Dashboard, "the desk's record" block (prototype 1357 to 1365), grounded in
  `src/components/dashboard/desk-record-summary.tsx:109`.

Both render on the same screen, twelve prototype lines apart, from two separate
implementations that already exist as two separate files in the repo. They share
only a model (`RESOLUTION_ORDER` and `DESK_RECORD_COPY.bucketLabel`, both from
`src/lib/desk-record.ts`, re-exported through `src/lib/your-record.ts:72` and
`:162`). Building them as two mobile components repeats the split that already
made two anatomies out of one idea. Outside this batch the same grid is the
Prepared record and the Entry screen, so extracting it first is not local.

**What actually varies between the two:**

| Property | Your record | The desk's record |
|---|---|---|
| Numeral colour | Per resolution: `--c-greenink` / `--c-redink` / `--c-secondary` / `--c-muted` | `--c-ink` for all four |
| Leading dot | none | 6px dot coloured per resolution |
| Denominator | none | `of 41` in 10px muted mono beside the value |
| Proportion bar | none | 3px `bar-sweep-in` track under each cell, staggered 360/400/440/480ms |
| Numeral size | 16px | 17px |
| Fourth bucket label | `AWAITING` | `NOT GRADED` |
| Trailing CTA | "All calls →" to the record | "The whole record →" to the desk record |
| Empty behaviour | three states (`totalClaims === 0`, `!hasResolved`, breakdown) | two (`total === 0` empty body, or breakdown) plus an error body |

Note the fourth-bucket divergence is real and not a naming slip: the desk's
fourth bucket is `notGraded` (`DESK_RECORD_COPY.bucketLabel.notGraded ===
"Not graded"`), while the user's fourth cell in the prototype reads `AWAITING`,
which in `your-record.ts` is a *separate* count (`YourRecord.awaiting`) that sits
outside `byResolution` entirely. The extraction must take buckets and an optional
awaiting figure as distinct inputs, not four interchangeable cells.

## Component inventory

| Component | Existing path | Status | Note |
|---|---|---|---|
| RecordBuckets (four-bucket grid) | `src/components/dashboard/desk-record-summary.tsx` + `YourRecordSummary` in `src/components/dashboard/your-calls-widget.tsx` | Needs variant | Extract first. Variance table above. Model stays `src/lib/desk-record.ts` + `src/lib/your-record.ts`, untouched. |
| StatCard (figure cell) | `src/components/dashboard/stat-card.tsx` | Needs variant | Desktop shares one baseline between value and delta (`flex items-baseline`). github.md's mobile deviation stacks the delta under the value in all four cells. That is a layout prop, not a fork. Keep `changeUnknown` / `stale` / `countsFailed` renders. |
| SentimentPill | `src/components/ui/sentiment-pill.tsx` | Reusable as-is | Title-case, radius 4, `letterSpacing: normal`, the `--pill-*` triples. Caveat in NOT PORTED: the prototype's dashboard pill matches no existing size preset. |
| EmptyState | `src/components/ui/empty-state.tsx` | Reusable as-is | Already the shape of the prototype's wrap-none state: icon, title, description, action slot. Copy changes, structure does not. |
| Skeleton / SkeletonText | `src/components/ui/skeleton.tsx` | Reusable as-is | Both loading branches are compositions of these. |
| Espresso hero (The Close) | `src/app/evening-wrap/page.tsx:936` onward | Needs variant | Currently inline in a 1565-line page. Mobile needs it at fixed height with the prose lifted out onto cream. Its twin (Market Pulse) is in `src/app/morning-brief/page.tsx`, out of this batch, so extract with two consumers in mind. |
| Scorecard grid | `SCORECARD_SYMBOLS` at `src/app/evening-wrap/page.tsx:74`, rendered at `:1059` | Needs variant | Six cells, 6x1 desktop, 3x2 at 390px. Symbol list and the persisted-tape vs live-quote resolution logic (`:606` to `:656`) are reusable unchanged. |
| Masthead band | `src/app/evening-wrap/page.tsx:786`, twin at `src/app/morning-brief/page.tsx:806` | Needs variant | Identical gradient strings in both files today. Two consumers, one component. Mobile stop treatment is a live deviation, see below. |
| TickerStrip | `src/components/brief/ticker-strip.tsx` | Reusable as-is | Already 60s linear, already edge-masked, already fail-soft. Only the fixed 32px height and the 12px masks need checking at 390px. |
| PersonalizationBanner | `src/components/personalization/PersonalizationBanner.tsx` | Needs variant | Mobile ports only the complete-profile variant, drops the `risk_appetite` chip, and needs the 44px content-box hit boxes on Edit and dismiss. The `text-[8px]` badge violates the 10px floor. |
| Greeting header slot | `src/components/dashboard/greeting.tsx` | Needs variant | 30px headline on mobile against the source's 32/42px. `context` must keep its no-default contract. |
| DatePill | `src/components/dashboard/dashboard-fx.tsx:14` | Reusable as-is, unused on mobile | github.md replaces it with the italic Playfair date rule. Named here so nobody re-derives it. |
| DashboardIntro splash | `src/components/dashboard/dashboard-fx.tsx:127` | Needs variant | Logic (session gate, 1900/2600 timers, reduced-motion skip) is reusable verbatim. The desktop content (S-in-a-gold-square mark, three IntroStat counters) is replaced by the decided serif-monogram icon. |
| Section rule (italic label + hairline) | no single file; inline at prototype 1335, 1345, 1357, 1367, 2383, 2395 | Net new | Closest existing analogue is the wrap's inline section headers at `src/app/evening-wrap/page.tsx:1191`. Eight uses across these two screens alone. |
| Waiting-for-you block | none | Net new | github.md marks it "THIS PROJECT'S OWN". Closest analogue is `DashTile` at `src/components/dashboard/dash-tile.tsx` for the container and the espresso card treatment at `evening-wrap/page.tsx:936` for the surface. |
| Compact story row | `src/components/dashboard/story-card.tsx:400` | Needs variant | Anatomy lifts cleanly. Three children get dropped, see NOT PORTED. |

## States

### Dashboard

- **Loading:** specified. Prototype 1295 to 1313, `dashStage === 'loading'`. A
  full-page skeleton mirroring the real layout (rule, greeting, four figure
  cells, two cards, section rule, one row) closing on the centred mono line
  "READING OVERNIGHT COVERAGE". Runs 760ms in the prototype (3443), 0ms under
  reduced motion. Repo counterpart is per-widget, not per-page: `Greeting`
  renders three pulsing bars until mounted, `YourCallsWidget` renders three 52px
  pulses, `DeskRecordSummary` one 68px pulse, top stories a 380px hero skeleton.
  The mobile screen replaces all of them with one page-level pass.
- **Error:** UNSPECIFIED at screen level. The prototype has no `dashStage:
  'error'` and README's state table lists Dashboard as `dashStage, intro,
  introSeen` only. The repo has three separate per-section absences that have no
  prototype counterpart: `storiesError` renders "Couldn't load top stories"
  (`dashboard/page.tsx:843`), `countsFailed` renders the value "no count"
  (`:574`), and `DeskRecordSummary` status `error` renders
  `DESK_RECORD_COPY.errorBody`. None appears on the mobile screen.
- **Empty:** partially specified, and only inside sub-blocks. `your-record.ts`
  supplies `noClaimsTitle` / `noClaimsBody` and `noneResolvedTitle` /
  `noneResolvedBody`; `desk-record.ts` supplies `emptyTitle` / `emptyBody`. The
  prototype renders neither: both dashboard record blocks show populated counts
  in every state. No empty-state screenshot exists for this screen.
- **Stale:** UNSPECIFIED at screen level. The repo has a per-cell stale marker
  (`StatCard` `stale` prop rendering "· last close", set from `card.closed`) that
  the prototype's four market cells do not render. `briefStage: 'stale'` belongs
  to the Ledger (prototype 300, 3405), not the Dashboard.

### Evening Wrap

- **Loading:** specified. Prototype 2314 to 2322, `wrapStage === 'loading'`,
  2200ms in the dev harness. Title bar, three text lines, a 190px hero block,
  two 78px cards, closing on "SYNTHESISING THE CLOSE". Repo counterpart at
  `evening-wrap/page.tsx:879` is `Skeleton h-10 w-3/4` + `SkeletonText lines={3}`
  + three 160px cards in a 3-col grid, so the mobile version reflows 3x1 and adds
  the mono status line.
- **Error:** UNSPECIFIED for the wrap. README's state table gives `wrapStage`
  as `null | 'loading' | 'none'` with no error member, and the prototype has no
  `wrapError`. The repo has no wrap error state either: the fetch's `catch (e)`
  at `evening-wrap/page.tsx:436` logs and falls through to `finally
  { setLoading(false) }`, so a failed read renders as `!briefing`, which is the
  empty state. This is the exact failure mode github.md names as a trust
  failure. Do not invent a state; flag and decide.
- **Empty:** specified. Prototype 2323 to 2330: moon glyph in a 52px circle,
  Playfair 20px "No evening wrap available", then "Nothing failed to load. The
  wrap publishes at 4:35, after the close. Anything reviewed today is already on
  your record.", then an "Open your record" outline button. The repo's
  description differs: "The evening wrap will appear here once the market
  closes." (`evening-wrap/page.tsx:891`) and there is no action button.
- **Stale:** UNSPECIFIED. No stale branch exists for the wrap in the prototype,
  in README's state table, or in the page. `briefStage: 'stale'` is Ledger-only.
  The wrap does carry a session-archive concept in the repo (`isCurrentSession`
  gating live quotes at `:656`) that reads as a stale-adjacent idea, but it is
  not a rendered state.

Sub-state, worth noting because it will look like a bug during QA: the wrap's
per-cell stats-bar skeleton is bound to the *brief's* lifecycle, not the wrap's.
Prototype 3416: `statLoading: s.briefStage === 'loading'`, consumed inside the
Evening Wrap's stats bar at 2349 and 2350. Since the whole stats bar sits inside
`wrapReady`, "Wrap loading" never pulses those cells.

## Lucas-protected files

One of the four is touched, indirectly and read-only.

**`src/app/api/briefing/route.ts`.** `src/app/evening-wrap/page.tsx:263` fetches
`/api/briefing?type=evening` with a bearer token, and the whole wrap renders off
`data.briefing`. The mobile Evening Wrap lands without editing that file: it is a
consumer, not a contributor. The route already returns everything the screen
needs (`market_pulse`, `sections`, `morning_review`, `created_at`, `headline`),
the mobile screen consumes strictly less of the payload than the desktop page
does, and no new field is required by anything in the prototype's `isEvening`
block. The one thing that *would* require editing it is a distinct error signal
so the wrap can tell a failed read from an absent wrap. That is called out in
Open questions rather than assumed, because it is a Lucas file.

`src/lib/watchlist-utils.ts`, `src/components/watchlist/WatchlistAddInput.tsx`
and `src/app/trends/page.tsx` are not reached by either screen. The Dashboard's
`WatchlistWidget` and `WatchlistFeed` tiles are NOT PORTED per github.md, which
is what keeps `watchlist-utils.ts` out of scope.

## Designed fresh, no repo counterpart

None. github.md grounds both screens in real files. For the record, its
"designed fresh" rows are Story (reader view), Saved / offline, Alerts and Ask
directory, none of which is in batch 1.

Two sub-blocks inside Dashboard are marked as this project's own rather than
designed fresh, which is a different claim. github.md, Dashboard row: "THIS
PROJECT'S OWN: the top-to-bottom briefing order replacing the desktop widget
grid, the 2x2 card layout, and the 'waiting for you' block."

## NOT PORTED and deviations

Quoted verbatim from github.md and README unless marked.

**Motion, NOT PORTED** (github.md, Dashboard row): "NOT PORTED, deliberately:
`#dash-cursor-glow` and the `.dash-tile` cursor spotlight (both read `--mx`/`--my`
from pointer position and have no meaning on a touch screen). ALSO NOT PORTED,
for want of anything to animate: `dash-bar` (the source's vertical track-record
bars have no mobile counterpart), `dash-fspark-draw`/`dash-fspark-dot` (the
mobile dashboard has no sparkline, and building one would mean inventing a time
series), and `dash-fill-in` (no skeleton-to-content state on mobile)."

Contradiction, not resolved here: README's motion table lists `dashFillIn` as a
live keyframe, "320ms | Skeleton to content", while github.md says it was NOT
PORTED and "removed rather than left unreferenced". Both refer to the same
`.dash-fill-in` at `globals.css:757`, which the repo does use, at
`dashboard/page.tsx:858`, `your-calls-widget.tsx:222` and
`desk-record-summary.tsx:110`.

**Dashboard widgets, NOT PORTED** (github.md, Dashboard row): "NOT PORTED: the
rotating lead hero, AI signal bar, onboarding and personalization banners, system
intelligence, fresh radar, and live drag-reorder." All seven are live in
`src/app/dashboard/page.tsx` (`RotatingLeadHero` :859, `AISignalBar` :786,
`OnboardingBanner` :672, `PersonalizationBanner` :673,
`SystemIntelligenceWidget` :781, `FreshRadar` :888, the dnd-kit block :742).
Note the collision: the personalization banner is NOT PORTED on Dashboard but IS
ported on Evening Wrap (prototype 2304, github.md: "Ported
`PersonalizationBanner.tsx` (complete-profile variant)"). Not a defect, but it
means the same repo component has two mobile fates and only one is built.

**Dashboard deviations** (github.md, Dashboard row): "DEVIATIONS: the greeting
headline is 30px rather than the source's 32/42px, and the figure cell stacks its
delta under the value in all four cells rather than sharing a baseline with it
[EMDASH] the source's baseline-shared row is unconstrained in a wide desktop band
but overflows a 175px mobile column at eight characters. Stacking all four keeps
one anatomy; letting the line break conditionally produced two anatomies in the
same band. The date slot is an italic Playfair rule rather than
`dashboard-fx.tsx`'s `DatePill` (9.5px mono), because the italic rule is this
project's established app-wide date pattern and matching the desktop pill here
would make the dashboard the only screen that dates itself differently. The
compact story headline is 14px rather than the source's 13px for mobile
legibility, and the ordinal and pill text are one step darker than the source
tokens because the originals measured 1.43:1 and 4.4:1."

Verified against source: `greeting.tsx:87` is `text-[32px] md:text-[42px]`,
`stat-card.tsx:109` is `flex items-baseline`, `story-card.tsx:493` is
`text-[13px]`, `story-card.tsx:429` is `text-border-base`. All four hold.

**Evening Wrap masthead, DEVIATION** (github.md): "DEVIATION, masthead gradient:
the source stops are gold 0-30% then espresso from 75%. At 390px every line of
masthead type lands inside the gold stop, and cream on Heritage Gold is 2.18:1.
RETRACTED: an interim fix ran gold 0-10px then espresso from 18px, which rendered
a 10px solid Heritage Gold bar down the full height of the band's left edge [EMDASH]
a coloured left border, one of the four treatments the standing brief forbids...
The band is now solid espresso with no gold background at all". Confirmed in the
prototype at 2333: `background-color:#1a1208` with no gradient. Confirmed in the
source at `evening-wrap/page.tsx:788`: the 0/30/75/100 gradient is still live.

Contradiction, not resolved here: README's deviation table still says "Mastheads
use a CSS wordmark, not the full lockup" and, separately, "Masthead gradient
stops in px, not %", which describes the treatment github.md explicitly
RETRACTED. README's Responsive section repeats it: "Gradient stops that must
clear a fixed gutter belong in pixels, not percentages." The prototype ships
neither: it ships no gradient.

**Em-dash, DEVIATION** (github.md, Morning Brief row, and the same rule applies
to the wrap): "DEVIATION: the source tagline reads 'overnight markets [EMDASH] in
four chapters.' The em dash is replaced with a comma; the compliance rule forbids
em dashes in any user-facing copy." Confirmed live in both files:
`morning-brief/page.tsx:836` and `evening-wrap/page.tsx:816` ("How the session
played out [EMDASH] and what it meant."). The prototype renders the wrap tagline
with a comma at 2341 and 2354.

**STRUCTURAL DEVIATION** (github.md): "`market_pulse.narrative` (Morning Brief)
and `closeBody` (Evening Wrap) both render INSIDE the espresso hero in the
source, at 15px/1.6 on `rgba(255,253,249,0.82)` with `whiteSpace:pre-line` and no
length cap. On mobile the narrative is split: the hero keeps the eyebrow, the
'Today the market is [word].' pull-quote and the driver chips at a fixed height,
and the prose moves below onto cream, first sentence as a 17px Playfair lede then
body copy, with paragraphs beyond the third behind a 'Read the full pulse' /
'Read the full close' toggle." Confirmed: `closeBody` is defined at
`evening-wrap/page.tsx:690` and rendered inside the hero at `:1021`. The
prototype implements the split at 2372 to 2381 with `closeOpen`.

**Espresso vocabulary, NOTE** (github.md): "this project originally reserved
espresso for the resolution moment alone. With the prod-faithful heroes there are
now four espresso surfaces, so the resolution keeps its distinction by being the
only FULL-BLEED espresso screen; every other use is a card." Batch 1 accounts for
three of the four: the wrap masthead (2333), The Close hero (2356), and the
Dashboard's "waiting for you" card (1336).

**Sentiment pill, CONTRADICTION** (github.md): "CONTRADICTION between the
design-system guide and the shipping component, resolved in favour of the
component: the guide states 'Sentiment pills are SHOUTED: BULLISH / BEARISH /
NEUTRAL / MIXED / WATCH', but `SentimentPill` renders `tone.charAt(0) +
tone.slice(1).toLowerCase()` [EMDASH] i.e. Title Case, 'Bullish' / 'Watch' [EMDASH]
with `letterSpacing: normal`. The mobile design follows the component." Confirmed
at `sentiment-pill.tsx:68`. Still listed as open under README's Open decisions in
spirit and under github.md's Open compliance conflicts explicitly.

Additional finding, not in either document. github.md's Dashboard row claims the
pill was "matched on all eight properties" against `sentiment-pill.tsx`. The
prototype's dashboard story pill (line 1377) renders `font:600 10px` with
`padding:2px 5px`. `sentiment-pill.tsx:38` has no such preset: `xs` is 8.5px with
`2px 5px`, `md` is 10px with `4px 9px`. The prototype pill is an md font on xs
padding. Separately, `sizeStyles` defines a `tr` (tracking) value per size that
the component never reads, because line 60 hardcodes `letterSpacing: "normal"`.

**Numeric SIGNAL scores, NOT ADOPTED** (github.md): "NOT ADOPTED from the live
site: numeric SIGNAL scores (8.4 / 9.1) attached to stories. A per-story scalar
is the same class of derived figure the brief forbids." This is not only a live
site issue. The component the mobile story row is grounded in renders it in code:
`story-card.tsx:478` renders `<SignalScore score={story.adjustedScore} />`, and
`src/lib/article-signal.tsx:35` renders the literal string `Signal: {score.toFixed(1)}`.
The same row renders `SourceCredibilityBadge` off a field named `win_rate`
(`dashboard/page.tsx:369`), which is both a rate and outside the permitted
outcome vocabulary. Neither appears in the mobile row.

**Related, and not flagged anywhere:** `CompactStoryCard` is no longer rendered
by the desktop dashboard at all. `dashboard/page.tsx:856` states "Top stories
live ONLY in the revolving hero (it cycles all ~4); the numbered list that
duplicated them below was removed", and a repo-wide grep finds no consumer
outside `src/components/dashboard/index.ts`. The mobile top-stories list is
therefore grounded in a component the surface it was lifted from has stopped
using.

**Stagger ladder, three-way contradiction.** README line 204: "Dashboard stagger
delays, from the source call sites: 0 / 80 / 100 / 140 / 180 / 220 / 260 / 300 /
340 / 420ms." github.md, Dashboard row: "the real per-section delay ladder from
the call sites (0 / 80 / 100 / 140 / 180 / 220 / 300 / 340 / 420ms)". The actual
call sites in `src/app/dashboard/page.tsx` are 0 (`:676`, no delay), 80 (`:736`),
100 (`:780`), 140 (`:785`), 180 (`:793`), 220 (`:887`), 300 (`:898`), 320
(`:906`), 340 (`:919`), 380 (`:926`), 420 (`:933`). Neither document has 320 or
380; README has a 260 that does not exist in the file.

**Splash offsets, contradiction.** README's motion table: "`dashIntroUp` | 640ms
| Splash elements, 120/220/320ms offsets". `dashboard-fx.tsx` sets 0ms (`:166`),
140ms (`:178`), 260ms (`:185`) and 360ms (`:198`). The 640ms duration and the
1900/2600 out-timings are correct.

**Source count, contradiction.** github.md's Dashboard row opens
"`src/app/dashboard/page.tsx` [EMDASH] read, plus five components in
`src/components/dashboard/`", then names seven (greeting, stat-card,
market-card-editor, your-calls-widget, desk-record-summary, story-card,
dashboard-fx) and two libs plus the sentiment pill.

**Screen-status contradiction.** README's Screens table lists Dashboard as a
first-class screen with its own flag and its own splash. github.md's Notes say
"the pole is 'Ledger' not 'Radar'; Dashboard is dissolved into Today's first two
lines."

**Personalization banner, silent drop.** github.md describes the port as
"'Personalized for:' + up to three sector badges + an Edit link + a dismiss".
The source component also pushes `profile.risk_appetite` into the same chip array
(`PersonalizationBanner.tsx:92`). Risk Appetite is README Open decision #7,
"reads as individualized suitability framing. Not ported". The chip is absent
from the prototype, so the omission is correct, but it is not recorded as a
deviation anywhere and a later implementer reading the component will re-add it.
The same file's `text-[8px]` badge (`:103`) is the source of the 8px violation
github.md logged under the design-system adherence pass.

**Coloured left borders, live in a batch-1 source.**
`src/app/evening-wrap/page.tsx:1315` sets `borderLeft: 2px solid ${HERITAGE_GOLD}`
and `:1397` sets `borderLeft: 4px solid ${HERITAGE_GOLD}`. README's forbidden
list names coloured left borders explicitly and github.md logs their removal as a
deviation. Neither survives into the mobile screen; naming the exact lines so
nobody ports them by accident.

## Open questions

1. **The wrap has no error state and cannot get one without a Lucas file.**
   `evening-wrap/page.tsx:436` swallows the fetch error and renders `!briefing`,
   so a failed read is indistinguishable from an absent wrap. The prototype's
   empty copy actively asserts the opposite: "Nothing failed to load." Does the
   mobile wrap ship with that assertion knowing it can be false, or does
   `src/app/api/briefing/route.ts` grow a distinguishable failure signal? The
   second is a Lucas edit and I have not proposed a diff.

2. **Which stagger ladder is authoritative?** README, github.md and the call
   sites in `dashboard/page.tsx` give three different sequences. The mobile
   screen has fewer sections than the desktop grid, so a straight copy is wrong
   either way. Confirm the mobile ladder as a decision rather than inheriting a
   miscounted one.

3. **Which sentiment pill preset does the story row use?** The prototype pill is
   10px type on xs padding and matches no size in
   `sentiment-pill.tsx:38`. Either add a preset to the shipping component (which
   changes a shared file used by other surfaces) or bind the mobile row to `xs`
   or `md` and accept the visual delta. github.md claims an eight-property match
   that does not hold.

4. **Does the dashboard get an error state at all?** The repo has three distinct
   per-section failure renders (stories error, counts failed, desk record error)
   and the prototype renders none of them. On a product whose thesis is that
   nothing is curated away, a dashboard that cannot say a section failed is the
   same trust failure as question 1. Silent per-section absence, or a page-level
   `dashStage: 'error'` that does not currently exist?

5. **Dashboard empty states are unspecified and the copy already exists.**
   `YOUR_RECORD_COPY.noClaimsTitle` / `noneResolvedTitle` and
   `DESK_RECORD_COPY.emptyBody` are written, tested and compliance-asserted. The
   prototype shows populated counts in every state. A new user sees the dashboard
   before they see anything else. Which of these renders on day one?

6. **The `CompactStoryCard` grounding.** The desktop dashboard removed its
   numbered story list; the component survives unused. Is the mobile top-stories
   list intentionally reviving a retired anatomy, or should it be grounded in
   `RotatingLeadHero`, which is what the desktop actually renders today and which
   github.md marks NOT PORTED?

7. **Is Dashboard a screen or two lines of the Ledger?** README's Screens table
   and github.md's Notes disagree. Batch 1 is scoped as if it is a screen. If it
   is being dissolved, roughly half this batch changes shape.

8. **The splash icon.** github.md records the icon as decided (candidate L, the
   serif monogram) and states it "Ships on the briefing splash and the install
   prompt". `dashboard-fx.tsx:168` still renders a gold-square "S" with
   `dash-mark-glow`. Confirm the splash mark swaps, since the mobile splash is
   the first frame of the first session.
