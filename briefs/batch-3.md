# Batch 3 build brief: Watch, Thesis Tracker, Thesis detail

Recon only. No implementation code below. Every repo path named here was opened with Read.
Nine of nine paths github.md maps to this batch exist. Zero missing.

## Screens

### Watch

**Prototype flag:** `isWatch`. Confirmed in `Signalera Mobile v3.dc.html` at line 657
(`<sc-if value="{{ isWatch }}">`, block runs 657 to 739) and in the logic class at line 3238
(`isWatch: s.screen === 'watch'`). One screen, three tiers stacked in one scroll region:
tracked views (2 entries), watchlist (filter chips plus cards), following (theme clusters).
Header copy: "Tracked views, watchlist and following. Nothing on this screen is ever graded."

**Route: NEW ROUTE NEEDED.** No `/watch` exists. `src/app/` has no watch directory; the three
tiers currently live at three separate desktop routes:
`/radar/calls?views=open` (labelled Tracked Views by the palette), `/radar/watchlist`,
`/radar/following`. Proposed path: `src/app/watch/page.tsx`, one route rendering all three
tiers, since the mobile design merges them into one scroll and the README's navigation model
makes Watch a pole rather than a tab set.

**Mapped repo sources:**

- `src/components/radar/RadarTabs.tsx` (100 lines). The canonical Radar sub-tab vocabulary:
  `following` / `watchlist` / `calls` / `desk-record`, each with its own route and its own data
  fetching, sharing one nav spine. Line 24 carries the comment that Desk record is "The desk's
  own graded record, distinct from the user's record on Calls", which is why Desk record is a
  separate screen and not part of Watch. This file gives the tier names and the routes; it does
  not define any card.
- `src/components/shell/command-palette.tsx` (186 lines). Line 27 is the provenance for the
  "Tracked Views" label: `{ id: "thesis", label: "Tracked Views", section: "Research",
  href: "/radar/calls?views=open" }`. Line 28 is the provenance for "Thesis Tracker" pointing at
  `/radar/track-record`. Both labels in the mobile design come from this file, not from the tab
  row. Also the Pages / Research section split the Search screen adopts.
- `src/components/radar/WatchlistGallery.tsx` (319 lines). The watchlist tier, entire. File
  header states the rule the mobile design follows verbatim: "news-about-what-you-watch. Price is
  a quiet secondary detail, never the hero; the hero is the entity with today's strongest story."
  Carries the three type badges (ticker monogram tinted by move, `sector` gold tag, private
  company serif wordmark), the All / Public / Private / Industries filter set, the quiet-entity
  collapse, and the two distinct no-hero copy branches. `trackHref` is
  `/radar/calls?draft=<encoded story title>`, i.e. tracking a story pre-fills the composer.
- `src/app/radar/following/page.tsx` (886 lines). The following tier. Theme-grouped coverage
  (`ThemeView`, uppercase cluster headings with a count), four view modes (topic / activity /
  timeline / map), and three separated failure surfaces: `FeedLoadError`, the zero-match block,
  and the per-follow "Could not check" band. Lines 191 to 205 encode the rule the mobile design
  quotes: a follow whose match failed is excluded from `quiet` and surfaced separately.

### Thesis Tracker

**Prototype flag:** `isTracker`. Confirmed at line 1985 and in the logic class at line 3546
(`isTracker: s.screen === 'tracker'`). Titled **Evidence tracker** in the prototype, not "Thesis
Tracker". Back link goes to Ledger. Anatomy: a three-cell count grid (THESES TRACKED 7 open,
EVIDENCE SUPPORTS 3, MIXED OR AGAINST 4), a by-sector table (SECTOR / OPEN / LEANING), and a
"where evidence moved most" card list with a 2px top edge, a lean word, a dotted review
timeline, and a days-left line.

**Route:** `/radar/track-record` exists at `src/app/radar/track-record/page.tsx`. Reachable
today. The mobile design changes the parent: the prototype's back link is Ledger, while the repo
page renders `RadarTabs active="calls" context="Evidence tracker"`, so it currently reads as a
Radar sub-surface.

**Mapped repo sources:**

- `src/app/radar/track-record/page.tsx` (811 lines). The whole surface. Three `StatusCard`s
  ("Theses tracked", "Where evidence supports", "Where evidence is mixed or against"), the
  by-sector table with `SectorStatus` prose, "Where evidence supports the thesis" / "Where
  evidence is mixed or against" rank cards, and "Recent theses". Line 337 is the verbatim source
  of the mobile subhead: "Evidence leanings from nightly review, not graded verdicts; graded
  calls live in Calls." Nightly cadence is real: `getNextGradingRunPT` (line 777) resolves the
  next 8:10 PM PT run through DST. Line 261 computes `supportRate` per sector; the sector table
  does not render it.

### Thesis detail

**Prototype flag:** `isThesis`. Confirmed at line 2079 and in the logic class at line 3546
(`isThesis: s.screen === 'thesis'`). Back link goes to Evidence tracker. Anatomy: an id line
(CALL-0413 CEG UTILITIES) plus a lean word, the claim as an H1, a mono ENTERED / REVIEWED
NIGHTLY / SETTLES rule, a FAILS IF well, "what you wrote" (the user's own note), "what is
reviewed each night" (four dotted readings), "review timeline" (4 dated entries), and a "WHAT
HAPPENS NEXT" block.

**Route:** `src/app/radar/track-record/[thesis_id]/page.tsx` exists. Reachable today.

**Mapped repo sources:**

- `src/app/radar/track-record/[thesis_id]/page.tsx` (565 lines). Five sections in the source:
  Original thesis, "What Signalera monitors for this thesis", Verdict reasoning (terminal only),
  Current signal, Review timeline. The mobile design's four nightly readings are the source's
  five monitored dimensions minus one: source lists price action, news sentiment, supporting
  evidence, grader confidence, time elapsed (lines 252 to 257); the mobile keeps price against
  benchmark, how coverage is written, supporting against contradicting, time against horizon,
  and drops grader confidence, which the source itself says is "computed only when a terminal
  verdict is reached". Lines 260 to 263 are the provenance for "A direction, never a score":
  terminal verdicts "are not triggered by the score crossing a fixed threshold". Loading is a
  three-block `skeleton-shimmer`; the not-found path renders "Thesis not found."
- `src/lib/track-record-live-score.ts` (332 lines). The scoring engine. Five components summed
  and clamped to [-100, +100]. Exports `verdictDisplayLabel` (Confirmed to Supported,
  Invalidated to Challenged, Tracking confirmed to Leaning supportive, Tracking invalidated to
  Leaning against, default Developing), `verdictLean`, `liveScoreChipClasses`,
  `neutralizeThesisTitle` (strips a leading long/short/buy/sell/avoid/watch), `neutralizeThesis`
  (render-time prose redaction), `outcomeDisplayLabel`, `deriveLiveVerdict`. The mobile design
  consumes the label and lean functions and deliberately does not render `score`. See NOT PORTED.

## Shared component to extract first

**The section rule.** The italic Playfair lowercase label, a 1px hairline flex spacer, and an
optional right-aligned mono count. It is the layout spine of every screen in this batch and
nothing can be laid out until it exists.

Consumers and call sites in the prototype:

- Watch: `tracked views` with count `2` (line 661), `watchlist` with `5 with news · 9 quiet`
  (line 672), `following` with `3 with coverage · 3 quiet` (line 724).
- Thesis Tracker: `by sector`, no count (line 2000); `where evidence moved most`, no count
  (line 2010).
- Thesis detail: `what you wrote` (line 2092), `what is reviewed each night` (line 2095),
  `review timeline` with count `4` (line 2104).

Nine call sites across three screens. What varies, and only this:

1. **Label text**, always lowercase italic Playfair 12.5px at `--c-secondary`.
2. **Right slot present or absent.** Watch and the thesis timeline carry it; tracker sections do
   not. When present it is JetBrains Mono 10.5px, `letter-spacing:0.045em`, `--c-muted`.
3. **Right slot content shape.** A bare integer (`2`, `4`) or a two-part split with a middot
   (`5 with news · 9 quiet`, `3 with coverage · 3 quiet`). Both are strings; the split form is
   derived from two counts, never typed. README's state rule applies: any figure describing state
   is read from state.
4. **Top margin.** 0 for the first rule in a scroll region, 22 to 26px between sections.

Repo grounding for the pattern, both opened: `src/app/radar/track-record/page.tsx` line 637
defines a `Section({ title, children })` wrapper whose heading is an 11px semibold uppercase sans
label with no rule and no count, and `src/app/radar/following/page.tsx` line 601 renders a group
heading as an uppercase 12px sans label with a bottom border and a count suffix. The mobile rule
is neither of those: it is lowercase italic serif with the hairline inline rather than under the
label. Extract it once as its own component; do not fork either desktop heading.

Second in line, and the higher-risk one, is the evidence-lean chip. It is in the inventory below.

## Component inventory

| Component | Existing path | Reusable as-is / Needs variant / Net new | Note |
|---|---|---|---|
| Section rule (label + hairline + optional count) | `src/app/radar/track-record/page.tsx` `Section` (line 637); `src/app/radar/following/page.tsx` group heading (line 601) | Net new | Closest analogues named at left. Neither carries the inline hairline or the lowercase italic serif; both are uppercase sans. Extract fresh, see above. |
| Evidence-lean chip (Strengthening / Weakening / Unmoved, Supported / Challenged) | `src/lib/track-record-live-score.ts` `verdictDisplayLabel` + `verdictLean` + `liveScoreChipClasses` | Needs variant | Label and lean logic reusable as-is and must be. `liveScoreChipClasses` returns Tailwind `bg-signal-up/15 text-signal-up italic` style strings that do not map to the mobile token set, and the prototype renders the lean as bare coloured text at `--c-greenink` / `--c-amberink` / `--c-secondary` with no chip fill. Mobile needs its own class map over the same verdict strings. Must set `transition:none` per README. |
| State top edge (2px) | Prototype lines 2013, 2035, 2057 (`height:2px` amber / green / border) | Net new | No repo counterpart. The repo uses `border-l-[3px]` accents (`track-record/page.tsx` line 614 `StatusCard`, line 748 `EmptyInflightState`, `[thesis_id]/page.tsx` line 429 `VerdictReasoning`), which the README forbids outright as coloured left borders. Top edge replaces all three. |
| Watchlist type badge (ticker monogram / private serif wordmark / industry gold tag) | `src/components/radar/WatchlistGallery.tsx` `TypeBadge` (line 94) | Needs variant | Three branches and their type semantics port directly. Sizing changes: source is `h-9 min-w-9` Tailwind with `pctColor` from `--signal-up` / `--signal-dn`; mobile is `min-width:38px;height:36px` with `--c-green-surface` and a 6px radius. |
| Quiet price | `src/components/radar/WatchlistGallery.tsx` `QuietPrice` (line 84) | Reusable as-is | 11px mono, colour by sign, never the headline. Mobile matches at 11px mono. Only the colour token changes (`--c-greenink` on cream, `#86efac` on the espresso hero). |
| Watchlist hero card (espresso) | `src/components/radar/WatchlistGallery.tsx` hero block (line 199) | Needs variant | Same idea, one entity on a dark panel with its top story. Mobile drops `ArticleMemoActions` (a hover action row has no meaning on touch) and drops the 2-up `md:grid-cols-2` moments grid for a single column. |
| Watchlist filter chips (All / Public / Private / Industries) | `src/components/radar/WatchlistGallery.tsx` filter row (line 170) | Reusable as-is | Same four keys, same labels, same order. Note the key mismatch: the component's fourth key is `industries` mapping to `type === "sector"`; the prototype's is `ind`. Pick one at build time. |
| Quiet-entity collapse ("No news today: ...") | `src/components/radar/WatchlistGallery.tsx` (line 298) | Needs variant | Source links each quiet name to `/watchlist/<identifier>` and truncates at 12 with a `+N more`. Prototype shows 4 names then `+5 more` and underlines them. Same component, different truncation constant. |
| Theme cluster group (uppercase heading + rows) | `src/app/radar/following/page.tsx` `ThemeView` (line 587) | Needs variant | Cluster labels and counts come from the same shared `useTopicClusters` tree. Mobile drops `GroupJumpNav` and the 2-up grid, keeps the heading and the hairline-separated rows. |
| Coverage row (headline + MONO SOURCE · DATE) | `src/app/radar/following/page.tsx` `SecondaryCard` (line 517) | Needs variant | Source is a bordered card with a Kicker and `SourceLine` ("Reuters · 3h ago"). Mobile is a borderless row with a bottom hairline and an uppercase mono meta line ("REUTERS · JUL 29"). Same data, different anatomy. |
| Sector leaning table | `src/app/radar/track-record/page.tsx` table (line 439) and `SectorStatus` (line 669) | Needs variant | Source columns are Sector / Status / Count with prose status ("Mixed evidence, 2 supportive, 1 against") and a coloured sector pill from `getSectorStyle`. Mobile columns are SECTOR / OPEN / LEANING, status compressed to one word, sector rendered as plain ink. |
| Count grid (three cells) | `src/app/radar/track-record/page.tsx` `StatusCard` (line 594) | Needs variant | Same three counts in the same order. Source uses a 3px coloured left border per tint, forbidden by the README. Mobile is a 1px-gap grid on `--c-border` with the first cell spanning full width. |
| Review timeline (dated entries with dots) | `src/app/radar/track-record/[thesis_id]/page.tsx` timeline (line 313) | Needs variant | Source: `border-l-2` rail, absolute dot, `verdictDotColor` by raw verdict, timestamp, `conf: N%`, notes, `model_version`. Mobile keeps the rail, dot, lean word, timestamp and notes; drops the confidence percentage and the model version. |
| Dotted review-progress strip (dot / hairline / dot, open ring at the horizon) | Prototype lines 2017 to 2029 | Net new | No repo counterpart in any file opened for this batch. It compresses the review timeline into one row on the tracker card. |
| FAILS IF well | `src/app/radar/track-record/[thesis_id]/page.tsx` `VerdictReasoning` (line 414) is the nearest block | Net new | github.md states the falsification framing was adopted from the marketing site ("the site's 'fails if' falsification framing and CALL-/TH- identifiers"). The source's nearest equivalent is `bear_case` rendered as a plain paragraph (line 235). |
| Tracked-views card | none | Net new | github.md states the anatomy has no source. See "Designed fresh, no repo counterpart". No repo analogue is named here on purpose. |

## States

The prototype's dev strip carries lifecycle jumps for Brief loading, Brief error, No brief, Stale
brief, Wrap loading, No wrap, Commit fails and Replay splash only. There is no Watch, Tracker or
Thesis state jump. README's state table lists `wlLens` and `tkLens` as filters, not lifecycle
machines, and no `*Stage` key covers these three screens.

### Watch, tracked views tier

- **Loading:** UNSPECIFIED.
- **Error:** UNSPECIFIED.
- **Empty:** UNSPECIFIED. The rule renders a count (`2`) with two entries beneath it; the
  handoff never shows the zero case.
- **Stale:** UNSPECIFIED.

### Watch, watchlist tier

- **Loading:** UNSPECIFIED.
- **Error:** UNSPECIFIED, and the source has no error state either. `src/app/radar/watchlist/page.tsx`
  line 442 logs `console.error("Watchlist fetch failed:", res.status)` and returns, leaving the
  list empty. A failed watchlist read is currently indistinguishable from an empty watchlist,
  which is the exact defect `radar/following/page.tsx` and `radar/track-record/page.tsx` each
  fixed with a dedicated `loadError` flag. See Open questions.
- **Empty:** specified, one branch only. Prototype line 722 renders "Nothing tracked under this
  filter yet." behind `--v3-wlEmpty`, verbatim from `WatchlistGallery.tsx` line 291. The source's
  second branch, "No news in the last two days for anything you watch. Quiet is a real answer;
  the feed below holds the longer window." (line 292), is not in the prototype. The two branches
  are different states in the source: nothing tracked under the filter, versus tracked but quiet.
  Note also that `--v3-wlEmpty` is set to `none` for all four lens values in the prototype's
  `setWatch` (lines 3087 to 3090), so the empty block is authored but unreachable through the UI.
- **Quiet, a distinct state and not empty:** specified. Prototype line 723, "No news today:
  BRK.B · VLO · ZION · ETN · +5 more", behind `--v3-wlQuiet`. Hidden under the Private and
  Industries lenses.
- **Stale:** UNSPECIFIED.

### Watch, following tier

github.md is explicit that this tier distinguishes an empty week from a failed load. That
distinction is carried exactly here.

- **Loading:** UNSPECIFIED in the handoff. The source renders nothing at all while loading
  (`{loading ? null : ...}`, `following/page.tsx` line 283).
- **Error, the failed load:** specified as prose only. Prototype line 735 asserts the inverse:
  "The other three follows had no coverage this week. That is an empty week, not a failed load;
  your follows are intact." The failure surface itself is not drawn. The source's is
  `FeedLoadError` (line 794): heading "Could not load what you follow.", body "This is a loading
  failure, not an empty feed. Your follows are intact.", plus a working "Try again". The
  prototype borrows the second half of that sentence for its empty state and never renders the
  error state.
- **Partial error, per-follow:** NOT PORTED. The source's "Could not check" band
  (`following/page.tsx` line 418) lists follows whose match query errored and states "Matching
  failed for these. This is an error, not an empty result." The mobile Watch screen has no
  equivalent, so a follow that failed to match will fall into the quiet count and be reported as
  an empty week. That is the precise false claim the source file's comments at lines 191 to 194
  exist to prevent.
- **Empty week:** specified. Prototype line 735, quoted above, plus the rule count "3 with
  coverage · 3 quiet".
- **First run, zero follows:** UNSPECIFIED. The source has a full `FirstRun` onboarding
  (line 814) with five starter topics; the mobile Watch screen has no add affordance at all.
- **Stale:** UNSPECIFIED.

### Thesis Tracker

- **Loading:** UNSPECIFIED in the handoff. The source skeletons only the three `StatusCard`
  headlines (`track-record/page.tsx` line 618, `skeleton-shimmer h-5 w-40`).
- **Error:** UNSPECIFIED in the handoff. The source has a real one (line 389): "Could not load
  the thesis record." / "This is a loading failure, not an empty pipeline. Nothing has been
  lost." Same empty-versus-failed discipline as following. The mobile screen has no counterpart,
  so this needs a decision.
- **Empty:** UNSPECIFIED in the handoff. The source has two distinct empties: the whole-page
  "No theses yet" `EmptyState` (line 398) gated on `!loadError`, and `EmptyInflightState`
  (line 742) for a section with no rows while the page does have theses, "Scores are in flight,
  refreshes nightly at 8:10 PM PT."
- **Awaiting first review, a real state in the source and absent from the mobile design:**
  `awaitingCount` and `overdueCount` drive a gold pending banner (line 371) reading "N theses
  awaiting first review · N overdue" with the next check time. The mobile count grid has no
  awaiting cell. Note that "awaiting" is one of the four permitted outcome words, so this state
  has a vocabulary already.
- **Stale:** UNSPECIFIED. The source renders "Last reviewed against evidence <timestamp>" plus
  "Next review 8:10 PM PT daily" (lines 353 to 363); the mobile tracker renders neither. The
  freshness of a nightly surface is only stated on the thesis detail screen.

### Thesis detail

- **Loading:** specified by the source, not by the handoff. `[thesis_id]/page.tsx` line 134
  renders three `skeleton-shimmer` blocks at 6 / 32 / 48 units. The prototype has no loading
  frame. Mark UNSPECIFIED for the mobile design.
- **Error:** UNSPECIFIED. The source swallows it: the catch at line 101 only `console.error`s, so
  a failed fetch renders the not-found path.
- **Not found:** specified by the source (line 146): a back link plus "Thesis not found." No
  mobile counterpart in the prototype.
- **Empty timeline:** specified by the source (line 307): "No verdicts yet, awaiting first
  review." The prototype always shows four reviews. UNSPECIFIED for mobile.
- **Stale:** partially specified. The prototype's "WHAT HAPPENS NEXT" block (line 2120) states
  "Reviewed again tonight at 8:10 PT", which dates the surface. No treatment exists for a review
  that did not run.

## Lucas-protected files

Two of the four are in scope for this batch. Neither needs to be edited.

**`src/lib/watchlist-utils.ts`** is on the Watch watchlist tier's read path. It exports
`getCompanySearchTerms` and `buildArticleOrFilter`; the second is imported by
`src/app/radar/watchlist/page.tsx` (line 50) and `src/app/watchlist/[identifier]/page.tsx`
(line 14) to build the PostgREST `.or()` filter that matches articles to a watchlist entry. The
mobile Watch screen is news-led, so it needs exactly that matching. How it lands without an edit:
import `buildArticleOrFilter` and call it. The file is a pure string builder with no rendering,
no layout and no copy, so nothing the redesign changes can reach it. If the mobile screen needs a
different recency window or a different result cap, that belongs in the caller, not in this file.
`src/lib/radar-following.ts` already sets the precedent: its header comment at line 9 cites "the
watchlist-utils precedent" and it reimplements its own PostgREST escaping rather than widening
the protected helper.

**`src/components/watchlist/WatchlistAddInput.tsx`** is not needed at all. It is the add control:
a type toggle (ticker / company / sector), a 300ms debounced typeahead against
`/api/finnhub-search` and `/api/company-search`, keyboard highlight state, and a submit path. Its
only importer is `src/app/radar/watchlist/page.tsx` (lines 49, 910, 1375). The mobile Watch screen
has no add affordance anywhere: the `isWatch` block (lines 657 to 739) contains four filter chips,
cards and section rules, and no input, no plus button and no form. Following likewise renders no
"+ Follow" on mobile even though the source has one. So the mobile Watch screen lands by not
rendering an add path at all, and watchlist management stays on the desktop route. That is a
product gap, not a technical one, and it is Open question 1.

The other two protected files, `src/app/api/briefing/route.ts` and `src/app/trends/page.tsx`, are
untouched by this batch. `trends/page.tsx` does import `track-record-live-score`, but this batch
consumes that module directly and never through Trends.

## Designed fresh, no repo counterpart

**Watch, tracked views tier.** github.md, screen map, verbatim:

> | Watch · tracked views | Card anatomy is still this project's own; the source groups follows by type/theme rather than defining this card. |

Related, from the same file's "Corrections, prior turn" section:

> Still ungrounded and now labelled as such above: Ask answer (Intelligence) and Watch content.

No repo file defines the tracked-views card. `command-palette.tsx` line 27 supplies the label
"Tracked Views" and the destination `/radar/calls?views=open`, and `RadarTabs.tsx` supplies the
tab name "Calls", but neither defines the card. Do not go looking for one. The prototype's own
anatomy is the spec: a 2px left rule on `--c-border`, an italic Playfair 16px note in the user's
words, a 12.5px Inter headline beneath it, and a mono meta line reading
"JUL 30 · NO DIRECTION, NO WINDOW". That last string is the whole point of the tier: these are
views without a direction or a window, therefore never gradeable, therefore never on the ledger.

The watchlist and following tiers are both grounded. github.md, verbatim:

> | Watch · watchlist | `src/components/radar/WatchlistGallery.tsx` — read. Rebuilt as news-about-what-you-watch [...] Price demoted per the file's stated rule. |
> | Watch · following | `src/app/radar/following/page.tsx` — read. Rebuilt as theme-grouped coverage with uppercase cluster headings, and the source's explicit separation of an empty week from a failed load. |

## NOT PORTED and deviations

**The per-thesis live score. NOT RENDERED, deliberate.** github.md, Notes, verbatim:

> Further departure: `track-record-live-score.ts` carries a per-thesis score on a ±100 scale. Not rendered — a number attached to a claim reads as a probability of being right. Trajectory shows as strengthening / weakening / unmoved instead, matching the repo's own ToneReadout discipline.

The score is load bearing in the repo and renders in at least four places this batch touches:
`track-record/page.tsx` line 658 puts it in the badge tooltip ("Terminal verdict (score N of
±100)"), `[thesis_id]/page.tsx` line 279 renders `{live.score} of ±{SCORE_SCALE}` as the Current
signal figure, line 379 appends a signed per-component value to every breakdown sentence, and
line 479 renders "Score at verdict". None of those four render on mobile. The score still drives
logic: `deriveLiveVerdict` thresholds at +35 / -35 with a ±10 neutral band, and `verdictLean`
buckets the resulting string. So the module is consumed in full and only its scalar output is
withheld. Note the mobile design's three lean words are Strengthening / Weakening / Unmoved,
which are not the same strings as the module's Leaning supportive / Leaning against / Developing.
That mapping has to be written and it is Open question 3.

**The sector support rate. NOT RENDERED.** github.md, verbatim:

> The repo computes a `supportRate`; not rendered. Counts only, per the brief's ban on any rate.

`track-record/page.tsx` line 261 computes `supportRate: denom > 0 ? Math.round((d.tc / denom) * 100) : 0`
and line 264 sorts the sector groups by it. The mobile sector table renders OPEN as a count and
LEANING as a word. Note the rate still orders the table, so it survives as sort logic. README
compliance rule 2 bans the figure, not the ordering, but the ordering is now unexplained on the
mobile surface.

**Aggregate accuracy. Standing conflict, unresolved.** github.md, verbatim:

> Compliance conflict, unchanged and still open: the live marketing site renders "evidence supported 71.4%", "4 of 5 supported checks", numeric SIGNAL scores, and "THESES TRACKED 1,284". The brief forbids any aggregate accuracy figure. None is reproduced.

The mobile tracker's own count grid uses the label THESES TRACKED, which is the live site's label,
attached to a count ("7 open") rather than a rate. Flagged, not resolved.

**Screen title. DEVIATION.** github.md names the screen "Evidence tracker (Thesis Tracker)" and
says it was rebuilt after an earlier version was invented:

> Rebuilt the Thesis Tracker as **Evidence tracker** after reading `radar/track-record/page.tsx`. The first version was invented: it was a filtered call list. The real surface carries "Evidence leanings from nightly review, not graded verdicts", three counts, and a by-sector table.

README's Screens table still calls the screen "Thesis Tracker" with purpose "Evidence leanings by
sector from nightly review. Not graded verdicts." The prototype H1 renders "Evidence tracker".
`command-palette.tsx` line 28 renders "Thesis Tracker". `track-record/page.tsx` line 341 renders
an H1 of "Thesis Tracker" with `RadarTabs context="Evidence tracker"` above it. Three names for
one surface. Flagged, not resolved.

**Watch group labels. Corrected label set.** github.md, verbatim:

> Corrected Watch group labels to the live Radar vocabulary: tracked views / watchlist / following (was one merged list).

**The watchlist count. Corrected arithmetic.** github.md, most recent turn, verbatim:

> Fixed a count that drifted when industries moved into the watchlist: "12 names" no longer matched either the noun or the arithmetic; now "5 with news · 9 quiet".

**Structural deviation, the desktop watchlist workspace. NOT PORTED.** `WatchlistGallery.tsx`
line 16 states management "(add, pin, reorder, remove, alerts, export) lives in the workspace
below, unchanged". None of it is on the mobile Watch screen. Not flagged as NOT PORTED in
github.md, which is itself the gap: see Open question 1.

**`ArticleMemoActions`. NOT PORTED by consequence.** Every card in `WatchlistGallery.tsx` and
every article in `following/page.tsx` carries the shared hover action row (generate memo, track,
view source). The mobile cards carry none of it, and `trackHref` is the pre-fill path into the
composer that github.md already logged as unwired:

> Noted from the same file: `trackHref` is `/radar/calls?draft=<story title>`, i.e. tracking a story pre-fills the call composer. Not yet wired in this prototype.

**Following view modes. NOT PORTED.** The source's four modes (By topic / By theme / Timeline /
View as map), the `VIEW_STORAGE_KEY` persistence, `EvidenceMap` and `GroupJumpNav` all drop. The
mobile following tier renders the theme grouping only. Not stated anywhere in github.md.

**Contradiction, `tkLens`.** README's State table lists it as required production state:
"Filters | `wlLens`, `tkLens`, plus CSS-var-driven list filters". The prototype defines the state
key (line 2966), the setter `setTracker` (line 3099), the three CSS vars `--v3-tkStr` /
`--v3-tkWk` / `--v3-tkFlat` (line 27), the four chip style getters and four handlers (lines 3550
to 3553), and resets it (line 3740). No markup anywhere in the file reads any of them. The
Evidence tracker screen renders no filter chips at all. Both sides quoted; not resolved.

**Contradiction, tracker parent.** The prototype's back link goes to Ledger (line 1987,
`goLedger`), consistent with README's navigation model, which puts the graded record under
Ledger. The repo page renders `RadarTabs active="calls" context="Evidence tracker"`
(`track-record/page.tsx` line 335), which puts it under Radar as a suffix on the Calls tab. Both
sides quoted; not resolved.

**Coloured left borders.** README lists them under Forbidden visual treatments and github.md logs
their removal throughout. Every card in this batch's repo sources uses one:
`track-record/page.tsx` `StatusCard` `border-l-[3px]` (line 614), `EmptyInflightState` absolute
3px gold bar (line 748), `[thesis_id]/page.tsx` `VerdictReasoning` `border-l-[3px]` (line 429),
and the tracked-views tier's own 2px left rule in the prototype (line 662) is itself a left
border on a card, which reads as a tension with the same rule. Flagged.

## Open questions

1. **Can the mobile Watch screen ship with no add path?** The prototype has no add affordance in
   any of the three tiers, while both sources have one (`WatchlistAddInput.tsx` for watchlist,
   `FirstRun` plus the "+ Follow" chip for following). A first-run user reaches Watch with an
   empty watchlist, no follows and no way to add either. This is the single largest functional
   gap in the batch and it decides whether `WatchlistAddInput.tsx` needs a mobile sibling, which
   would be a new file rather than an edit to the protected one.
2. **Does the mobile following tier get the per-follow "Could not check" band?** Without it, a
   follow whose match query errored is counted as quiet and reported to the user as an empty
   week. `following/page.tsx` lines 191 to 194 exist specifically to stop that, and the mobile
   copy at prototype line 735 makes the false claim explicitly ("That is an empty week, not a
   failed load"). Either port the band or change the copy.
3. **What is the exact mapping from `verdictDisplayLabel` output to the mobile lean words?** The
   module emits Supported / Challenged / Leaning supportive / Leaning against / Inconclusive /
   Developing. The mobile tracker cards render Strengthening / Weakening / Unmoved and the thesis
   detail header renders Weakening. Six strings into three, and Unmoved has no obvious source
   (Developing? Inconclusive? Awaiting verdict?). README compliance rule 3 fixes the four outcome
   words as supported / challenged / developing / awaiting, and none of Strengthening, Weakening
   or Unmoved is among them, which is defensible because a lean is not an outcome, but it needs
   ruling before the chip is written.
4. **Which name ships for the tracker?** Evidence tracker (prototype H1), Thesis Tracker (README
   Screens table, command palette line 28, repo H1) or both. The command palette is the only
   discovery path to this surface today, so the label and the H1 disagreeing is a live defect,
   not just a mobile one.
5. **Where does the tracker sit, under Ledger or under Radar?** The prototype back link says
   Ledger; the repo says Radar / Calls. This decides the mobile route and the back-link target,
   and it cannot be deferred to build time.
6. **Should `/radar/watchlist` get a `loadError` flag before or during this work?** It is the
   only one of the three Watch data sources with no failed-versus-empty distinction; a failed
   `/api/watchlist` fetch currently renders as an empty watchlist. Porting the tier as-is copies
   that defect onto mobile. The fix lives in `src/app/radar/watchlist/page.tsx`, which is not
   protected, but it is adjacent to two files that are.
7. **Does the tracker keep the awaiting-first-review count?** The source surfaces
   `awaitingCount` and `overdueCount` prominently; the mobile three-cell grid has no room for a
   fourth figure and drops both. "Awaiting" is a permitted outcome word, and a thesis that has
   never been reviewed is materially different from one whose evidence is mixed.
8. **Is the watchlist recency window today or two days?** `WatchlistGallery.tsx` line 155 filters
   with `isRecent(a, 2)` and its quiet copy says "in the last two days", while the mobile rule
   count reads "5 with news · 9 quiet" and the collapse reads "No news today". The count and the
   window have to agree, and README's rule is that any figure describing state is read from that
   state.
