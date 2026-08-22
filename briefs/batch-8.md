# Batch 8 build brief: Settings, Alerts, Saved, Learned, Share, Compose, Desk record

Recon only. No implementation code. Every repo path below was opened and read.

This batch is a grab bag by construction. Provenance ranges from verbatim ports
to screens github.md never mentions. Two of the seven have no screen-map row at
all, and one row is factually wrong. Read the Designed fresh and NOT PORTED
sections before scoping anything.

## Screens

### Settings (`isSettings`)

Prototype flag confirmed in `Signalera Mobile v3.dc.html` at line 1727, with the
authoring comment "SETTINGS, grounded in settings/profile/page.tsx".

Route: `/settings/profile` exists. It is one of TWO settings routes and the
mobile screen draws from both (see Learned). NEW ROUTE NOT NEEDED, but see open
question 2 about which of the two routes the mobile Settings screen actually
lands on.

Sources github.md maps to it:

- `src/app/settings/profile/page.tsx`. Confirmed verbatim: the "Your
  Preferences" h1, the subhead "Changes save instantly and personalize your
  entire Signalera experience.", First name, Firm or school, the 7-role grid,
  Tracked Sectors with its "Signals from these sectors are surfaced first in
  your briefs." line and the "N sector(s) selected" counter, the comma-separated
  watchlist input with its "Comma-separated ticker symbols. Signals touching
  these will be surfaced prominently." helper, and Save changes. All present in
  the prototype. Also carries `riskOptions` (lines 48 to 52) and a 12-entry
  `SECTORS` array (lines 33 to 38).
- `src/components/onboarding/OnboardingWizard.tsx`. `ROLES` at lines 18 to 26.
  This is where the prototype's role DESCRIPTIONS come from, not from
  settings/profile. Six of seven match the wizard near-verbatim; the settings
  file's own descriptions are longer and are not what the prototype renders.

The prototype adds an "on this device" section (Theme, What Signalera has
learned, Saved deals, Brief and wrap times, Prepared record, Sign out) that has
no counterpart in either file. It is a mobile navigation spine, this project's
own.

### Compose, "Write your own call" (`isCompose`)

Prototype flag confirmed at line 2408. No authoring comment on this block.

Route: `/radar/calls` exists and hosts the composer as the `AuthorClaim` section
inside a larger page. The mobile design promotes it to a full screen. NEW ROUTE
NEEDED if it is to be reachable on its own: propose `/radar/calls/new`. Nothing
under `src/app/radar/calls/` renders the composer standalone today.

Sources github.md maps to it:

- `src/app/radar/calls/page.tsx`. `AuthorClaim` at lines 943 to 1187. Confirmed
  present: the free-text composer with the placeholder "In your own words, e.g.
  NVDA gives back the ramp hype by earnings" (line 1036, reproduced verbatim in
  the prototype), the parsed proposal block, the direction `<select>` with
  bullish / bearish / neutral (lines 1081 to 1083), the window picker, the
  `gradeable` branch (line 1063), `gradeable_alternative` (lines 1132 to 1166),
  and the "Track it" versus "Track as context" split on the single confirm
  button (line 1173).

Read in support, because the composer cannot be specced without them:

- `src/lib/call-horizons.ts`. `HORIZON_DAYS` (lines 38 to 44) gives five
  horizons; `HORIZON_LABEL` and `HORIZON_PHRASE` (lines 65 to 90) define two
  registers for saying the same window.
- `src/app/api/radar/claims/route.ts`. The POST at lines 131 onward. Server-side
  gradeability enforcement at lines 161 to 178, so README's "server-gated" is
  accurate. The insert body accepts no note field of any kind.
- `src/components/calls/TrackCallControl.tsx`. `TRACK_TRUST_LINE` and
  `UNGRADEABLE_REASON` at lines 61 to 66, and `buildLedgerLine` at line 95 whose
  header states "No id (none exists on user_claims)".

### Desk record (`isDesk`)

Prototype flag confirmed at line 2468. No authoring comment on this block.

Route: `/radar/desk-record` exists (`src/app/radar/desk-record/page.tsx`).

Sources github.md maps to it:

- `src/components/radar/RadarTabs.tsx`. The distinction github.md insists on is
  a code comment at line 24, immediately above the tab: "The desk's own graded
  record, distinct from the user's record on Calls." Four tabs total: Following,
  Watchlist, Calls, Desk record.
- `src/lib/desk-record.ts`. The pure model. `DESK_RECORD_COPY` at lines 64 to
  105 carries the surface's whole vocabulary. The bucket set is supported /
  challenged / noCleanRead / notGraded (`RESOLUTION_ORDER`, line 230).
  `awaitingNote` (line 101) states that awaiting calls "are not shown here".

Read to hold the distinction, since it is the whole point of this screen:

- `src/app/radar/desk-record/page.tsx`. Its file header repeats the separation:
  "Distinct from the 'Record' hero on /radar/calls, which is the USER's record of
  their own claims."
- `src/lib/your-record.ts`. The mirror file. Its header states the two "are two
  different objects and are never mixed", and that "There is no parameter here
  through which the desk's numbers could arrive." AWAITING is defined here, on
  the user's side, not the desk's.

The separation is enforced in three files with three independent comments. It is
the best-defended invariant in this batch and the prototype breaks it (see NOT
PORTED and deviations).

### Share (`isShare`)

Prototype flag confirmed at line 1588, with the authoring comment "PUBLIC SHARE
BRIEF, grounded in app/share/brief/[id]/page.tsx".

Route: `src/app/share/brief/[id]/page.tsx` exists. No new route needed.

**github.md has NO screen-map row for Share.** Confirmed by grep: the only
occurrences of "share" in github.md are the Dashboard row (unrelated prose) and
the section heading "Compliance deviations on the public share brief" at line
178. Share is absent from the Screen map table and absent from the list of seven
connective surfaces at line 54. That is a gap in github.md itself, not a gap in
the design.

Source, named only in that compliance section:

- `src/app/share/brief/[id]/page.tsx`. Confirmed present and matching the
  prototype: `robots: { index: false, follow: false }` (line 22), which grounds
  the prototype's "Not indexed by search engines"; the ticker strip; the
  eyebrow "Morning Brief · <date>"; the headline; "Market tone · <tone>" (line
  179); the summary; "Top Deals to Watch" (line 195) with company, value,
  deal_type pill and one_liner; "Analyst Briefing" (line 233) with per-section
  articles from `SECTION_TITLES` (lines 48 to 57, which include Sector
  Spotlight); and the CTA footer "Want briefings like this every morning?" (line
  281). Both em-dash CTAs are live at lines 147 and 287.

### Learned (`isLearned`)

Prototype flag confirmed at line 1525. No authoring comment on this block.

Route: no route renders this as its own screen. **NEW ROUTE NEEDED.** Propose
`/settings/learned`. The content exists today as two sections inside
`/settings/preferences`.

**github.md has NO row for Learned, and no mention of it anywhere.** Verified
independently: a case-insensitive grep for "learn" across the whole of github.md
returns ZERO hits. It is not in the Screen map, not in the corrections log, and
not among the seven connective surfaces listed at line 54. This is a
documentation gap, not an ungrounded screen.

I did NOT borrow `IntelligenceChat.tsx`. github.md maps that file to Ask /
Intelligence (line 118), which is a different screen owned by another batch, and
nothing about it matches this one. Stating plainly what I did instead: I searched
the repo independently and found an exact source, then verified it
arithmetically rather than by resemblance.

Unmapped candidate sources, offered as a finding for Noah to confirm, NOT as a
github.md provenance claim:

- `src/app/settings/preferences/page.tsx`. Section 6, lines 61 to 110. The
  prototype's Learned screen reproduces this section verbatim: the eyebrow
  "Settings", the h1 "Your preferences", the subhead "Manage every dimension of
  how Signalera personalizes your intelligence feed. Changes take effect
  immediately.", the h2 "What Signalera has learned", the explainer "These are
  inferred from your activity and blend with your declared preferences above.
  1.0 = neutral. Higher = boosted in ranking. N events considered, last updated
  X.", and the footer "Learned preferences update automatically after each
  reading session."
- Proof, not resemblance. The source computes bar width as
  `pct = ((weight - 0.3) / (2.5 - 0.3)) * 100` (line 82) and colours the bar
  gold above 1.05, red below 0.95, muted between (lines 83 to 98). Running the
  prototype's six weights through that formula: 1.84 gives 70.0, 1.42 gives
  50.9, 1.11 gives 36.8, 0.98 gives 30.9, 0.91 gives 27.7, 0.62 gives 14.5. The
  prototype's six widths are 70.0%, 50.9%, 36.8%, 30.9%, 27.7%, 14.5%, and its
  six bar colours are gold, gold, gold, muted, red, red. Every width matches to
  one decimal and every colour matches the threshold rule. This screen was built
  from this file.
- `src/components/settings/ResetLearnedPrefsButton.tsx`. Button label "Reset
  learned" (line 42), which is the prototype's `resetLabel` string exactly.
- `src/components/profile/BehavioralInsights.tsx`. Rendered by the preferences
  page at line 114. Its own heading is "How Signalera is learning about you"
  (line 97), NOT "Behavioral insights", and its body is a server narrative plus
  three Stat cells plus Leaning in / muted lists. The prototype takes the
  component's name for its heading and substitutes three hand-written bullets.
- `src/app/api/profile/insights/route.ts` exists and backs that component. Not
  read line by line; named here only as the data path.

### Alerts (`isAlerts`)

Prototype flag confirmed at line 1779, with the bare authoring comment "ALERTS".

Route: none. `src/app/alerts/page.tsx` does not exist. **NEW ROUTE NEEDED.**
Propose `/settings/alerts`, since the prototype's back link goes to Settings and
the Settings list row "Brief and wrap times" is its only entry point.

github.md line 116: "Alerts | designed fresh. No repo counterpart found.
Deliberately states that nothing here can interrupt a browser tab." No repo
source exists for this screen. I did not go looking for a substitute.

### Saved (`isSaved`)

Prototype flag confirmed at line 1640, with the authoring comment "SAVED DEALS,
grounded in app/saved/page.tsx".

Route: `/saved` exists (`src/app/saved/page.tsx`, 271 lines). No new route
needed.

github.md line 115 says: "Saved / offline | designed fresh. No repo counterpart
found."

**That row is false.** `src/app/saved/page.tsx` exists and the prototype is a
close port of it. Confirmed matching, verbatim or near: the "Back to Deal Flow"
link (line 110), the gold bookmark icon plus "Saved Deals" eyebrow (lines 113 to
116), the "N saved deal(s)" count (line 119), the Export CSV button (line 129),
the sort row with Date Saved / Company / Value (lines 137 to 151), the empty
state "No saved deals yet" plus "Bookmark deals from the Deal Flow tracker to
save them here." plus the "Go to Deal Flow" CTA (lines 169 to 179), the stage
pills RUMORED / ANNOUNCED / UNDER LOI / CLOSED from `STAGE_CONFIG` (lines 13 to
18), the `← acquirer` arrow (line 209), the "Saved <Mon D>" line (line 233), the
gold value, the X unsave control with `aria-label="Remove from saved deals"`
(line 247, reproduced character for character in the prototype), and the "View
source →" link (line 260).

This is the same class of error github.md caught and fixed once already for Deal
Flow at line 23: "Corrected a FALSE receipt: the Deal Flow row previously read
'designed fresh; no repo or visual reference', while src/app/deal-flow/page.tsx
exists". It recurred here and was not caught, even though the prototype's own
HTML comment names the file.

MAPPED BUT MISSING: none. Every path github.md names for this batch exists.

## Shared component to extract first

There is no component shared across all seven. The honest answer is that this
batch is a grab bag and forcing one abstraction over Share, Compose and Alerts
would be worse than shipping them separately.

The one shared by the largest subset is **the settings list row**: a full-width
row, 56 to 60px, hairline top border, label plus sub-label stacked on the left,
and one trailing control on the right.

Consumers, four of seven:

- Settings, prototype lines 1766 to 1771. Five rows plus a bare Sign out row.
- Alerts, prototype lines 1786 to 1793. Five rows.
- Learned, reached only through a Settings row.
- Saved, reached only through a Settings row.

What varies, and it is only two things:

1. **The trailing control.** Three variants and no more. A chevron (navigation:
   Settings' What Signalera has learned, Saved deals, Brief and wrap times,
   Prepared record). A switch (Alerts' five toggles). A bordered text button
   (Settings' Theme "Switch"). Sign out has no trailing control at all.
2. **Row height.** Settings rows are `min-height:56px`, Alerts rows are
   `min-height:60px`. The extra 4px buys nothing and is almost certainly drift.
   Pick one before extracting, or the component ships with a height prop that
   encodes a mistake.

Grounding in existing files: there is no such component in the repo today.
`src/app/settings/profile/page.tsx` uses `FormField` (line 353) and `Divider`
(line 364), both local to that file, and neither is a row. The closest existing
analogue is the tab row in `src/components/radar/RadarTabs.tsx`, which shares
the hairline-plus-active-treatment idea but is horizontal navigation, not a list
row. This is a net-new extraction.

Note the switch variant is load-bearing for accessibility: README's Geometry
section names "Alerts switches" explicitly as one of the six places using the
`content-box` padding plus negative margin trick to reach 44px without moving
the element. Build that into the row, not into each caller.

## Component inventory

| Component | Existing path | Status | Note |
|---|---|---|---|
| Settings list row | none | Net new | Closest analogue `src/components/radar/RadarTabs.tsx` (hairline + active treatment, but horizontal). See section above. |
| Toggle switch | none | Net new | No switch primitive exists in the repo. `src/app/settings/profile/page.tsx` uses `Button` and `Input` from `src/components/ui/`. Must carry the 44px hit box itself. |
| Role card grid | `src/app/settings/profile/page.tsx` lines 207 to 229 | Needs variant | Repo renders a 2-col grid with a lucide icon per card. Prototype drops the icons entirely and keeps 2-col. Same selected treatment (gold border, gold-muted fill). |
| Sector chip | `src/app/settings/profile/page.tsx` lines 240 to 258 | Needs variant | Repo radius is `rounded-lg`; the design system permits only 4/6/9/12/14. Prototype renders 6 of the file's 12 sectors. |
| Weight bar row | `src/app/settings/preferences/page.tsx` lines 86 to 105 | Reusable as-is | Label, track, fill, mono value. The prototype reproduces the source's pct formula exactly. Fill uses `bar-sweep-in`, which README requires rest in the drawn state. |
| Reset control | `src/components/settings/ResetLearnedPrefsButton.tsx` | Needs variant | Repo is a bare text button gated behind `confirm()`. Prototype renders a bordered pill with a 2s "Reset" confirmation and no dialog. |
| Behavioral insight list | `src/components/profile/BehavioralInsights.tsx` | Needs variant | Repo renders narrative + 3 stats + boosted/muted lists. Prototype renders three gold-dot bullets. Different anatomy, same section. |
| Deal row (saved) | `src/app/saved/page.tsx` lines 192 to 264 | Needs variant | Stage pill must move off Tailwind `amber/green/blue` onto `--pill-*` tokens. |
| Stage pill | `src/app/saved/page.tsx` lines 13 to 18 | Needs variant | `STAGE_CONFIG` is the taxonomy; the colours are off-system. Prototype maps under_loi to `--pill-watch`, closed to `--pill-neutral`, announced to `--pill-bull`, rumored to `--pill-mixed`. |
| Sort chip row | `src/app/saved/page.tsx` lines 135 to 154 | Reusable as-is | Three keys, gold active state. Prototype keeps all three labels verbatim. |
| Empty state block | `src/app/saved/page.tsx` lines 166 to 181 | Reusable as-is | Icon, Playfair title, body, CTA. The one fully-specced empty state in this batch. |
| Free-text claim composer | `src/app/radar/calls/page.tsx` lines 1024 to 1052 | Needs variant | Repo is a single-line `<input maxLength={400}>` with a Propose button. Prototype is a multi-line Playfair `<textarea>` with no Propose button. |
| Parsed proposal block | `src/app/radar/calls/page.tsx` lines 1062 to 1140 | Needs variant | Repo states the window as a phrase with a "change" affordance; prototype uses three fixed chips. |
| Direction selector | `src/app/radar/calls/page.tsx` lines 1074 to 1084 | Needs variant | Repo is a native `<select>`, lowercase values. Prototype is three chips, title case. |
| Horizon picker | `src/lib/call-horizons.ts` lines 65 to 90 | Needs variant | Source supplies five options in two registers. Prototype offers three, in the register the file says not to use when choosing. |
| Gradeable-alternative CTA | `src/app/radar/calls/page.tsx` lines 1145 to 1167 | Net new on mobile | Exists in the repo, is NOT rendered anywhere in the prototype. Closest analogue is the repo control itself. |
| Track it / Track as context button | `src/app/radar/calls/page.tsx` line 1173 | Reusable as-is | One button, label switches on `proposal.gradeable`. Prototype preserves the split exactly. |
| Outcome count strip | `src/lib/desk-record.ts` lines 64 to 105 | Needs variant | Four cells. The BUCKETS must change, not just the styling. See deviations. |
| Scored entry row | `src/lib/desk-record.ts` lines 195 to 215 | Reusable as-is | Dot, state word, entity, date, claim, attribution line. Maps 1:1 to `DeskRecordEntry`. |
| Share masthead | `src/app/share/brief/[id]/page.tsx` lines 139 to 149 | Needs variant | Repo uses `Wordmark` from `src/components/ui/wordmark`; prototype uses the CSS wordmark per the standing logo deviation. |
| Share section article | `src/app/share/brief/[id]/page.tsx` lines 236 to 248 | Reusable as-is | Title from `SECTION_TITLES`, body through `stripHtml`. |
| Share CTA footer | `src/app/share/brief/[id]/page.tsx` lines 279 to 289 | Needs variant | Em-dash removal plus a contrast fix: repo renders `text-cream` on `bg-gold`. |
| Ticker strip | `src/components/brief/ticker-strip.tsx` (referenced at share line 5, not opened) | Reusable as-is | Named only. Not read, so not claimed as verified. |

## States

Marked UNSPECIFIED where the handoff is silent. Nothing invented.

### Settings

- Loading: SPECIFIED in source. `src/app/settings/profile/page.tsx` lines 173 to
  178 render three pulsing `h-10` bars. The prototype has no loading state.
- Error: SPECIFIED in source. `error` renders inline (line 318) AND as a
  bottom-right toast (lines 340 to 346). The prototype has neither; it shows a
  Save button that flips to "Saved". Mobile has no toast pattern and README says
  "No toast" for commit, so the inline path is the one to carry.
- Empty: not applicable. A profile always renders.
- Stale: UNSPECIFIED.

### Alerts

- Loading, error, empty, stale: all UNSPECIFIED. Designed fresh with no source
  and no lifecycle key in the prototype's state table. The five toggles are
  local booleans with no persistence path.

### Saved

- Loading: SPECIFIED in source. `src/app/saved/page.tsx` lines 157 to 163, three
  pulsing `h-20` cards. Prototype has no loading state.
- Error: UNSPECIFIED anywhere. `useSavedDeals` exposes only `isLoading`; the
  page has no error branch at all. This is a real hole in both the source and
  the design, and it is the exact failure github.md calls out at line 138: a
  failed read that renders as an empty one is a trust failure. Saved currently
  renders "No saved deals yet" whether the user has none or the fetch died.
- Empty: SPECIFIED and complete. Source lines 166 to 181, reproduced in the
  prototype at lines 1656 to 1663 including the CTA.
- Stale: **load-bearing, and only partly specified.** README's PWA section
  (line 282) commits to "Do not assume push notifications exist" and the return
  trigger section (lines 284 to 293) states the four mechanisms that replace
  push. Neither says anything about Saved going stale offline. The one
  substantive commitment README makes about Saved is its Screens-table purpose
  line, "Offline. Brief kept automatically for the current day.", which the
  prototype does not implement (see the contradiction below). So: the offline
  staleness contract for Saved is UNSPECIFIED in the handoff, and it cannot be
  written until open question 1 is settled. Do not invent a cache policy.

### Learned

- Loading: SPECIFIED in the unmapped source.
  `src/components/profile/BehavioralInsights.tsx` lines 68 to 76, "Loading
  behavioral insights…". The weights section itself is server-rendered and has
  no client loading state.
- Error: SPECIFIED in the unmapped source. Same file, lines 78 to 86,
  "Couldn't load insights right now." Plus a silent soft-fail in
  `src/app/settings/preferences/page.tsx` lines 19 to 21, where a failed
  `updateInferredWeights` falls back to the stored weights with `eventCount: 0`.
  That fallback is indistinguishable from a genuine zero, which is the same
  failed-read-reads-as-empty problem.
- Empty: SPECIFIED in the unmapped source. `src/app/settings/preferences/page.tsx`
  lines 75 to 79: "Not enough data yet — interact with a few theses and come
  back." Note that string ships an em-dash and cannot be ported as-is.
- Stale: SPECIFIED in a weak form. The source renders
  `inferred_weights_updated_at` or the literal "not yet computed" (lines 24 to
  26). The prototype hardcodes "last updated Aug 13, 4:02 AM".
- The prototype renders NONE of these four states. It shows the ready state
  only.

### Share

- Loading: UNSPECIFIED. The route is a server component with
  `dynamic = "force-dynamic"` and no streaming boundary, so there is no loading
  UI to port.
- Error: SPECIFIED as `notFound()` on missing env, query error, or no row
  (`src/app/share/brief/[id]/page.tsx` lines 102 to 117). A bad or expired share
  link renders the app's 404, not a share-specific state. The prototype has no
  error state.
- Empty: SPECIFIED per section, implicitly. Every block is behind a
  `length > 0` or truthiness guard (lines 161, 168, 184, 191, 230, 254), so a
  sparse briefing simply drops sections. The prototype renders a full brief only.
- Stale: UNSPECIFIED. `revalidate = 0` means always fresh; there is no stale
  concept on a shared link, and the recipient has no session to be stale
  against.

### Compose

- Loading: SPECIFIED in source, MISSING from the prototype. The repo does a
  network round-trip to `/api/radar/claims/author` and renders "Analyzing…"
  (line 1044), then a second round-trip on confirm rendering "Saving…" (line
  1173). The prototype computes `gradeable` synchronously in the logic class
  (`hasProposal: gradeable`, line 3561) with no intermediate state at all. Since
  README and the API both make gradeability server-gated, this loading state is
  mandatory and the design does not show it.
- Error: SPECIFIED in source, MISSING from the prototype. Two distinct messages,
  "Could not analyze the claim." (lines 981 and 988) and "Could not save the
  call." (line 1006). README's Commit failure rule ("A call that silently fails
  to save is the worst possible bug in this product") applies to the second one
  and the prototype has no failure path for it.
- Empty: SPECIFIED. Empty draft renders the hint "A sentence is enough." and a
  locked submit button labelled "Write the claim and your reasoning".
- Stale: UNSPECIFIED.

### Desk record

- Loading: SPECIFIED. `src/app/radar/desk-record/page.tsx` carries a
  `"loading" | "ready" | "error"` status. The prototype has no loading state.
- Error: SPECIFIED and copy-complete.
  `src/lib/desk-record.ts` lines 98 to 100: errorTitle "The record could not be
  loaded", errorBody "The graded-call record is temporarily unavailable. Nothing
  is estimated in its place." The page header states FAIL OPEN explicitly. The
  prototype has no error state.
- Empty: SPECIFIED and copy-complete. Same file, lines 95 to 97: "No graded
  calls yet" plus "Calls appear here once their window closes and the grader has
  real prices to check them against. Nothing is shown before then." Not in the
  prototype.
- Stale: UNSPECIFIED, but adjacent copy exists: `awaitingNote` (line 101) covers
  calls still inside their window.

## Lucas-protected files

**None.**

Checked precisely, because Settings edits watchlist tickers:

- `src/lib/watchlist-utils.ts` exists (127 lines) and is NOT imported by
  `src/app/settings/profile/page.tsx`. The full import list of that file is
  lines 3 to 12 and contains react, `@supabase/ssr`, `@/components/shell`,
  `@/components/ui/input`, `@/components/ui/button`, `@/lib/utils`,
  `lucide-react`, `@/hooks/useUserProfile`, `@/hooks/useLiveMood`, and a type
  import. No watchlist module appears.
- `src/components/watchlist/WatchlistAddInput.tsx` exists (427 lines) and is
  likewise not imported. Settings uses the generic `Input` from
  `@/components/ui/input`.
- How Settings edits tickers without either: it holds one comma-separated string
  in `watchlistInput` state, splits on comma, trims, uppercases, and drops empty
  entries (lines 127 to 130), then PATCHes `watchlist_tickers` to
  `/api/user-profile`. That is the whole mechanism. The mobile screen reproduces
  the same single text field and can land without touching either protected file.
- `src/app/api/briefing/route.ts` and `src/app/trends/page.tsx` are not reached
  by any screen in this batch.

Caveat worth stating rather than burying: this means the mobile Settings screen
inherits a ticker input with no validation, no resolution, and no dedupe, while
the app has a dedicated component for exactly that. That is a product decision,
not a blocker, and it is open question 6.

## Designed fresh, no repo counterpart

Two screens are marked designed fresh by github.md, and two more have no map row
at all. Only one of the four is genuinely sourceless.

**Alerts.** github.md line 116, quoted in full: "Alerts | designed fresh. No
repo counterpart found. Deliberately states that nothing here can interrupt a
browser tab." Verified: no `src/app/alerts/` route exists. Genuinely sourceless.
Everything on this screen is a design proposal, including the five toggles,
which have no persistence path anywhere in the repo.

**Saved.** github.md line 115, quoted in full: "Saved / offline | designed
fresh. No repo counterpart found." **This claim is false.**
`src/app/saved/page.tsx` exists at 271 lines and is demonstrably the source, as
itemised in the Screens section above. The prototype's own authoring comment at
line 1639 already names the file. Treat Saved as a port, not a fresh design.

**Learned.** No row of any kind. A case-insensitive grep for "learn" across
github.md returns zero hits. Stated plainly: github.md does not document this
screen's existence, let alone its provenance. It is also absent from the
"Twenty-six screens total" tally at line 54 while README's table lists 31
screens, which is a second, structural inconsistency between the two documents.
Independent search found what is almost certainly the real source
(`src/app/settings/preferences/page.tsx`), verified by reproducing all six bar
widths and all six bar colours from the source's own formula and thresholds.
Recorded as an unmapped candidate pending Noah's confirmation, not as a github.md
mapping.

**Share.** No row in the Screen map. Not in the connective-surfaces list either.
Its only appearance in github.md is the section heading "Compliance deviations
on the public share brief" at line 178, which names
`share/brief/[id]/page.tsx` in passing while recording two CTA changes. The
source exists and the port is faithful; what is missing is the provenance row.
Report as a gap in github.md, not a gap in the design.

## NOT PORTED and deviations

Only items touching these seven screens.

### Risk Appetite, omitted

README open decision 7: "**Risk Appetite** (defensive / balanced / aggressive)
reads as individualized suitability framing. Not ported |
`settings/profile/page.tsx` `RISK_OPTIONS`".

github.md line 167: "'Risk Appetite' (defensive / balanced / aggressive) reads
as individualized suitability framing, which the product brief forbids. Omitted
from the mobile settings screen pending a decision."

Verified in source. Note one small inaccuracy in both documents: in
`src/app/settings/profile/page.tsx` the constant is `riskOptions` (line 48), not
`RISK_OPTIONS`. `RISK_OPTIONS` is the name it carries in
`src/components/onboarding/OnboardingWizard.tsx` (line 61). Both files declare
the same three ids and both would need the omission applied. The settings copy
also ships the descriptions "Prioritize downside protection and macro risks",
"Even weighting of opportunity and risk signals" and "Lead with high-conviction
asymmetric opportunities" (lines 49 to 51). Omitting the section removes all
three.

Also note `risk_appetite` is still written by the Settings save path (line 141),
so omitting the control from mobile means mobile PATCHes whatever value was
already there, or null. That is a data question, not a copy question, and it is
open question 4.

### Role labels, compliant substitutions

README open decision 5: "Role labels 'Buy-Side Analyst' / 'Sell-Side Analyst'
contain banned words inside ordinary job titles. Design renders 'Fund Analyst' /
'Equity Research' against the same enum ids | `settings/profile/page.tsx`,
`OnboardingWizard.tsx`".

github.md line 165: "`settings/profile/page.tsx` role labels 'Buy-Side Analyst'
and 'Sell-Side Analyst' contain banned substrings. The mobile design renders the
same enum ids with compliant labels (Fund Analyst, Equity Research). The live
product does not."

Verified in both files. `src/app/settings/profile/page.tsx` lines 24 and 25, and
`src/components/onboarding/OnboardingWizard.tsx` lines 20 and 21, all four carry
the banned labels. Enum ids `buy_side` and `sell_side` are unchanged by the
substitution, so no data migration is implied.

### RIA description, trimmed

README open decision 6: "RIA description 'Managing client portfolios and
allocations' contains a banned word | `settings/profile/page.tsx`".

github.md line 166: "The RIA role description 'Managing client portfolios and
allocations' contains a banned word. Trimmed in the mobile design."

Verified at `src/app/settings/profile/page.tsx` line 27. The prototype renders
"Managing client capital", which is not a trim of the settings string; it is the
OnboardingWizard's own description, verbatim from line 23. The substitution is
compliant either way, but the described mechanism ("trimmed") is not what
happened.

### CONTRADICTION: two labels for one enum id, in the repo itself

`src/app/settings/profile/page.tsx` line 27: `{ id: "ria", label: "RIA /
Advisor", ... }`.

`src/components/onboarding/OnboardingWizard.tsx` line 23: `{ id: "ria", label:
"RIA / Wealth Manager", ... }`.

Same id, two labels, two files. github.md line 112 records that it reconciled to
the wizard: "Role labels and descriptions reconciled against
`OnboardingWizard.tsx` ROLES this turn (was: invented descriptions, 'RIA /
Advisor', and a missing 7th role)." The prototype renders "RIA / Wealth
Manager". So the mobile design silently picks one side of an unresolved repo
disagreement. Flagged, not resolved.

### UNDOCUMENTED compliance substitution: family_office

`src/components/onboarding/OnboardingWizard.tsx` line 24 describes
`family_office` as "Multi-asset allocation". "allocation" is on README's banned
substring list (compliance rule 1). The prototype renders "Multi-asset
mandates". The substitution is correct and necessary; it is recorded nowhere.
github.md's compliance section lists only the RIA description. Worth adding
upstream, because github.md line 18 shows this exact word has slipped through a
scan before.

### CONTRADICTION: two role descriptions sets, two sector lists

Beyond the labels, the two files disagree on every description and on the sector
list itself. `src/app/settings/profile/page.tsx` `SECTORS` has 12 entries (lines
33 to 38, including "Materials & Mining" and "Agriculture");
`src/components/onboarding/OnboardingWizard.tsx` `SECTORS` has 10 (lines 36 to
47, missing both). The prototype renders 6. Which set the mobile Settings screen
offers is undecided in the handoff.

### Share brief: two em-dash CTAs

github.md line 179, quoted in full: "`share/brief/[id]/page.tsx` ships two
em-dash CTAs, 'Sign up — Free' and 'Try Signalera — Free'. Both are rendered
here as 'Sign up, free' and 'Try Signalera, free'. Same precedent as the Morning
Brief tagline: source fidelity does not override the em-dash rule."

Verified at source lines 147 and 287. Both are live in production and both are
reproduced in the prototype in their compliant form (prototype lines 1592 and
1632).

### Share brief: a THIRD em-dash, undocumented

`src/app/share/brief/[id]/page.tsx` line 207 renders `{deal.company || "—"}`. An
em-dash as the fallback placeholder for a missing company name, on a public,
unauthenticated, link-shareable surface. github.md records two em-dashes on this
file; there are three. The compliance rule is absolute ("No em-dashes
anywhere"), and github.md line 76 already notes that em-dash placeholders were
"the visual signature of its flaky-render bug" on the brief surfaces. Do not
port the placeholder.

### Share brief: Sector Signals not ported

`src/app/share/brief/[id]/page.tsx` lines 253 to 275 render a "Sector Signals"
section from `sector_breakdown`. The prototype's share screen renders Top Deals
and Analyst Briefing only. Undocumented omission. Either it is a deliberate
mobile cut and should be recorded, or it is an oversight.

### Share brief: gold CTA contrast

Both CTAs render `text-cream` on `bg-gold` (lines 145 and 285). README's Gold
section states gold measures 2.17:1 on cream and that "Gold never touches text
at `--c-gold`". The prototype uses `--c-ongold` (espresso on gold) instead. This
is the same contrast finding github.md raised for the desktop masthead at line
68 and it applies here too. Flagged as an additional deviation on this file.

### Desk record: the buckets are wrong, and it re-collapses the distinction

This is the most serious item in the batch, because it undoes the exact
correction github.md line 46 says it made: "Built **Desk record**, which had been
missing entirely. `RadarTabs.tsx` states it is the desk's own graded record,
distinct from the user's record on Calls; the two had been wrongly collapsed into
one idea."

The prototype's count strip (lines 2477 to 2482) reads SUPPORTED 64 / CHALLENGED
39 / DEVELOPING 18 / AWAITING 22.

`src/lib/desk-record.ts` `RESOLUTION_ORDER` (line 230) is supported /
challenged / noCleanRead / notGraded. There is no "developing" bucket. And
`DESK_RECORD_COPY.awaitingNote` (line 101) states: "Calls still inside their
window are awaiting a grade and are not shown here."

Meanwhile `src/lib/your-record.ts` (lines 15 to 17) defines AWAITING as a
property of the USER's record: "A claim with no own outcome row is AWAITING."

So the prototype puts an AWAITING count on the surface whose own model excludes
awaiting, using a vocabulary that belongs to the other record. The two ideas are
partly collapsed again, in the one place the design set out not to collapse them.
The four words are README's compliance vocabulary (rule 3), which is presumably
why they were reached for, but on this screen the compliance vocabulary and the
data model do not line up. Flagged, not resolved.

Two smaller items on the same screen. `DESK_RECORD_COPY.title` is "How the
desk's calls resolved" (line 65) and the prototype renders "Desk record", which
is the RadarTabs label rather than the surface title. And the prototype's entry
"31 users had taken this call" (line 2489) has no counterpart in the model:
`DeskRecordEntry` (lines 107 to 121) carries no adopter count, and the phrasing
"taken this call" is the drifted verb github.md line 158 says it corrected
everywhere in favour of "Track this call".

### Compose: the horizon register contradicts its own source file

The prototype's horizon chips read "3 weeks" / "A month" / "A quarter"
(prototype lines 2449 to 2451), and the READ AS block renders the same values as
"21 days" / "30 days" / "90 days" (`propHorizon`, prototype line 3565).

`src/lib/call-horizons.ts` lines 73 to 80 states the rule directly: "'3 weeks'
in a monospace chip reads as a system token, which is the wrong register for the
thing a reader is deciding to commit to. Monospace is reserved for the ledger
line... Everywhere a horizon is being CHOSEN or previewed, it reads as a sentence
fragment." `HORIZON_PHRASE` supplies "resolves in about three weeks" etc.

The prototype uses `HORIZON_LABEL` values where the file says to use
`HORIZON_PHRASE`, then renders raw day counts in the preview. Quoting both
sides and moving on.

### Compose: two of five horizons dropped

`HORIZON_TYPES` (line 46) is session / week / multiweek / month / quarter. The
prototype offers three: 21, 30 and 90 days. Dropping `session` is defensible,
since `src/app/api/radar/claims/route.ts` line 169 requires
`windowEnd > todayIso` and a same-day window would fail. Dropping `week` is not
explained anywhere, and `week` is `DEFAULT_ADOPT_HORIZON`
(`src/lib/call-horizons.ts` line 62), chosen for a stated reason: "a same-day
window would resolve before they looked again, which is the behavior this whole
change exists to fix."

### Compose: the gradeable alternative is mapped but never rendered

github.md line 103 maps the composer to
"`gradeable` / `gradeable_alternative`". The repo renders the alternative as a
one-tap CTA: "Make it gradeable: SYMBOL · direction · by DATE"
(`src/app/radar/calls/page.tsx` lines 1145 to 1167), with the source comment
"Propose-and-confirm, not reject". README's Screens table likewise says
"alternative offered when not gradeable".

The prototype's NOT CHECKABLE block (lines 2420 to 2425) offers no alternative.
It tells the user to name a company themselves, or accept context-only. The
single most valuable affordance in the mapped source is absent from the screen.

### Compose: a claim id the source says does not exist

The prototype's committed submit label reads "◆ On your ledger as CALL-0414"
(prototype line 3572). `src/components/calls/TrackCallControl.tsx` line 86
states: "No id (none exists on user_claims)". github.md line 32 describes the
CALL-0414 id appearing on an authored claim as a defect it fixed: "an
instrument-free sentence could reach the graded record as CALL-0414". The
instrument check was fixed; the id itself is still rendered on the gradeable
path.

### Compose: the required note has no field to write to

The prototype gates submission on a note ("WHY YOU THINK SO", prototype lines
2456 to 2459; `draftReady` requires it). `src/app/api/radar/claims/route.ts`
POST (lines 131 onward) parses `user_claim`, `claim_type`,
`expected_direction`, window dates, `target_symbol`, `gradeable`,
`gradeability_note` and `confidence_in_reduction`. No note. The GET's column
list (line 52) confirms `user_claims` has no note column. Blocker, see open
question 3.

### Saved: contradiction on what the screen even is

README's Screens table, line 73: "Saved | `isSaved` | Offline. Brief kept
automatically for the current day."

github.md line 115: "Saved / offline".

The prototype renders saved M&A deals bookmarked from Deal Flow, with CSV
export, sort keys and unsave. There is no brief, nothing offline, and nothing
about the current day. `src/app/saved/page.tsx` is a saved-deals page and the
prototype is faithful to it.

So README and the prototype describe two different products under one flag, and
the offline brief cache README commits to does not exist in either the repo or
the design. Quoting both sides and moving on. This is the reason the Saved stale
state cannot be written yet.

### Saved: off-system stage colours

`STAGE_CONFIG` (`src/app/saved/page.tsx` lines 13 to 18) uses Tailwind
`amber-600/amber-50/amber-200`, `green-*`, `blue-*` and `text-text-muted`. Same
class of problem as `/cross-source` in README's open decision 9. The prototype
remaps all four onto `--pill-*` token triples. Deviation, correct direction, not
recorded anywhere.

### Learned: source string ships an em-dash

`src/app/settings/preferences/page.tsx` line 77: "Not enough data yet —
interact with a few theses and come back." Cannot be ported verbatim. Same
precedent as the Morning Brief tagline.

### Learned: Behavioral insights is renamed and re-anatomised

`src/components/profile/BehavioralInsights.tsx` line 97 heads its section "How
Signalera is learning about you" and renders a server-generated narrative, three
Stat cells (Events 30d, Sectors engaged, Event types) and two lists (Leaning in,
muted). The prototype heads it "Behavioral insights" (the component's name, not
its heading) and renders three hand-authored bullets with no counterpart in the
data. The bullets are content, not a port. Note the third bullet, "Calls you
take skew to a medium horizon even when a shorter window is offered", is a
derived behavioural claim; it is not a rate, so it clears compliance rule 2, but
it has no source in the API response either.

### Settings: sector list truncated

Source offers 12 sectors; the prototype renders 6. Unrecorded.

### Alerts: nothing to port, and nothing to persist

github.md line 116 states the screen is deliberate about browser limits, and the
prototype delivers that in the "WHY THIS PAGE IS SHORT" well (prototype lines
1795 to 1798), which is consistent with README line 282: "Do not assume push
notifications exist. On mobile web they are unreliable unless installed to the
home screen, and most users will not install." No deviation, because there is no
source to deviate from. The five toggles are unbacked.

## Open questions

1. **What is Saved?** README says "Offline. Brief kept automatically for the
   current day." The prototype and `src/app/saved/page.tsx` both say saved deals
   bookmarked from Deal Flow. These are different features. Pick one. If the
   answer is both, they are two screens and the flag needs splitting, which
   changes the 31-screen count. Nothing about Saved, including its stale state,
   can be specced until this is answered.

2. **Which settings route does mobile Settings become?** Two exist.
   `/settings/profile` (name, firm, role, sectors, risk, tickers) is what
   github.md maps. `/settings/preferences` is a superset: it renders
   `PreferencesForm` with strategy, horizon, workflow and market cards on top of
   the same fields, plus the learned-weights section the mobile Learned screen
   is built from. The mobile design splits this into two screens. Is the mobile
   Settings screen the mobile view of `/settings/profile`, of
   `/settings/preferences`, or a third thing? And are the two desktop routes
   meant to converge?

3. **Where does the Compose note get written?** The screen will not submit
   without it. `user_claims` has no note column and
   `/api/radar/claims` parses no note field. Options are a schema change, reuse
   of an existing text column, or dropping the requirement on authored claims
   while keeping it on adopted ones. This is a migration decision, so it needs a
   human. Until it is answered the Compose screen cannot ship its own gate.

4. **What does mobile Settings do with `risk_appetite` on save?** The control is
   omitted but `handleSave` still PATCHes the field
   (`src/app/settings/profile/page.tsx` line 141). Should mobile send the
   existing value untouched, omit the key entirely, or is the omission the first
   step of removing the field? Sending null from a screen that never showed the
   control would silently clear a value the user set on desktop.

5. **Which desk-record buckets ship?** The compliance vocabulary (supported,
   challenged, developing, awaiting) and the data model (supported, challenged,
   noCleanRead, notGraded) do not agree on this surface, and the prototype shows
   an AWAITING count on a record whose own model excludes awaiting calls. Either
   the design adopts noCleanRead and notGraded as displayed words, or
   `desk-record.ts` grows a mapping. Both are decisions, not implementation
   details.

6. **Should mobile Settings keep the raw ticker text field?** It ships no
   validation, resolution or dedupe, while `WatchlistAddInput.tsx` exists for
   exactly that. Using it means touching a propose-only file, so the answer
   determines whether this screen stays out of Lucas's files or not.

7. **Does the Compose screen offer the gradeable alternative?** The repo does,
   README says it does, github.md maps the field, the prototype does not render
   it. If it ships, the NOT CHECKABLE block needs a control the design has not
   drawn.

8. **Alerts toggles: real or informational?** Nothing in the repo persists them
   and README is explicit that push cannot be assumed. If they persist, they
   need a table and a route; if they do not, five switches that forget their
   state on reload are worse than no switches. The screen's own argument
   ("nothing here can interrupt a browser tab") may be the whole feature.

9. **Should github.md be corrected before build?** Three defects found: the
   Saved row is a false receipt of the same class already caught once for Deal
   Flow; Learned has no entry at all; Share has no screen-map row. github.md is
   named in README line 40 as "the authoritative reference for provenance", so
   later batches will inherit these. Correcting it is a five-line edit and I did
   not make it, since this task is read-only outside this file.
