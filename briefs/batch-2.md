# Batch 2: Claim, Entry, Prepared record

Recon only. No implementation. Every repo path below was opened.

Read: `design_handoff_signalera_mobile/README.md`, `design_handoff_signalera_mobile/github.md`,
`design_handoff_signalera_mobile/Signalera Mobile v3.dc.html` (grepped by flag).

---

## Screens

### Claim (`isClaim`)

**Flag confirmed.** `Signalera Mobile v3.dc.html:469` (`<sc-if value="{{ isClaim }}">`), block runs
469 to 495. Registered in the logic class at `:3236` (`isClaim: s.screen === 'claim'`) and reachable
from the dev strip at `:2642` ("A claim") and from the Ledger claim card at `:415` (`goClaim`).

**Route: NEW ROUTE NEEDED.** No per-call detail route exists anywhere under `src/app/`. The nearest
thing is `src/app/radar/calls/page.tsx`, which renders open desk calls as a LIST of `ScoredObject`
cards with the commit footer attached, never a full-screen single call. Proposed path:
`src/app/ledger/call/[call_id]/page.tsx`, keyed on `morning_brief_calls.id` (the same id
`src/lib/desk-record.ts:207` uses as `DeskRecordEntry.id`, and the same one
`src/components/calls/TrackCallControl.tsx` takes as `callId`).

**Repo sources github.md maps to this screen: NONE.**

github.md's `## Screen map` (lines 83 to 123) has no Claim row. It carries `Ledger`, `Commit sheet`,
`Review (espresso set piece)`, `Entry detail` and `Prepared record`, and then moves on to Company
Intel. The Claim screen is absent from the map entirely. It is also not in the "designed fresh"
group, so it is unmapped, not deliberately sourceless. Recorded as a finding, not filled in with a
plausible file.

The one repo file that is load-bearing for this screen anyway, because the screen's primary CTA
fires into it:

- `src/components/calls/TrackCallControl.tsx` (386 lines, opened). Owns `TRACK_TRUST_LINE`,
  `UNGRADEABLE_REASON`, `buildLedgerLine`, `CallLedgerLine`, `CallsTrustLine`, `hasCommitFooter`,
  `CallCommitFooter`. Its file header states the three-state contract: untracked / ungradeable /
  tracked, and that the affordance is the card FOOTER passed to `ScoredObject`, not a floating
  control. The Claim screen inverts this: the CTA is a full-width 52px bar in a fixed bottom bar
  (`:490` to `:493`), outside any card.

**Boundary hit, as instructed.** The Claim screen's "Track this call" at `:492` calls `openSheet`.
`openSheet` is defined at `:3486` and sets one flag, `sheet: true`. The sheet itself is at `:2579`
(`<sc-if value="{{ sheetOpen }}">`), which is a SIBLING of every screen block, not nested inside
`isLedger`. `sheetOpen: s.sheet` at `:3485` is not gated on `s.screen` at all. Three call sites open
it: `:422` (Ledger card), `:492` (Claim, mine), `:1487` (inside `isDealDetail`, block opens at
`:1458`). So the Claim screen cannot ship without the sheet, and the sheet is not owned by the
Ledger despite both README and github.md saying it is. See Open questions 4 and 5.

### Entry (`isEntry`)

**Flag confirmed.** `Signalera Mobile v3.dc.html:523`, block runs 523 to 540. Logic class at `:3237`.
No dev-strip jump exists for it; it is reachable only via `goEntry` from the Ledger past-entry rows
(`:445`, `:450`, `:455`), the Review screen (`:517`), the Prepared record rows (`:558`, `:564`,
`:570`), Dashboard (`:1437`), Deal detail (`:1510`) and Evening Wrap (`:2486`, `:2491`, `:2496`).

**Route: NEW ROUTE NEEDED.** No per-claim detail route exists. Proposed path:
`src/app/ledger/entry/[claim_id]/page.tsx`. Constraint from
`src/components/calls/TrackCallControl.tsx:29`: "No claim id is shown. user_claims has only a uuid
(no short human id), and a uuid slice or a hash would be a fabricated identifier, so it is omitted."
The uuid may be the route param; it may not appear in copy on the page.

github.md maps: `| Entry detail | src/components/scored-object/ScoredObject.tsx,
src/components/thesis/OutcomeBadge.tsx |`

- `src/components/scored-object/ScoredObject.tsx` (290 lines, opened). The card anatomy the Entry
  screen is a full-screen expansion of: sector eyebrow, claim, receipt line, verdict zone
  (verdict word, then `attribution` as the largest line, then `calibration`), then footer. Carries a
  3px coloured left spine (`:129` to `:133`, `STATE_COLOR` at `:99`) that the mobile brief forbids
  outright. Its `verdict` default now resolves through `verdictWordForState` from
  `src/lib/verdict-vocabulary.ts`.
- `src/components/thesis/OutcomeBadge.tsx` (52 lines, opened). A rounded-full lucide-icon pill,
  `font-data font-bold uppercase`, at 8px or 10px. Three states only: `confirmed` / `invalidated` /
  `inconclusive`, labelled through `outcomeDisplayLabel` in `src/lib/track-record-live-score.ts:287`
  which returns Supported / Challenged / Inconclusive and falls through to **"Developing"** for
  anything else. Returns `null` for a null outcome, so there is no awaiting rendering.

### Prepared record (`isRecord`)

**Flag confirmed.** `Signalera Mobile v3.dc.html:543`, block runs 543 to 654. Logic class at `:3238`.
Dev-strip jump at `:2643` ("Prepared record"). Entered from Ledger `:297`, Dashboard `:1355` and
`:1770`, Watch `:1422`, Learned `:2328`, and from Entry's own "Share" affordance at `:525`.

**Route: NEW ROUTE NEEDED.** `src/app/radar/desk-record/page.tsx` exists but is explicitly the
DESK's record, not this one. Its own header comment: "Distinct from the 'Record' hero on
/radar/calls, which is the USER's record of their own claims." The user's record currently has no
route of its own; it is a hero block inside `src/app/radar/calls/page.tsx`. Proposed path:
`src/app/record/page.tsx`.

github.md maps: `| Prepared record | src/components/record/DeskRecordView.tsx |`

- `src/components/record/DeskRecordView.tsx` (217 lines, opened). Purely presentational view over
  `DeskRecord`. Four identical `BucketTile`s in one grid, an attribution counts block, the
  attribution explainer inline (not a tooltip), then an unfiltered reverse-chronological
  `ScoredObject` list. Renders `{count} of {total}`, never a rate. Three statuses only: `loading` /
  `ready` / `error`, with empty folded into ready.

This mapping is the wrong object. See NOT PORTED and deviations, and Open question 3.

Also opened, because the prototype record screen depends on them and github.md maps them to the
Ledger and Commit sheet rows that bracket my batch:

- `src/lib/desk-record.ts` (275 lines, opened). `DESK_RECORD_COPY`, `buildDeskRecord`,
  `RESOLUTION_ORDER`, `deskRecordAuthoredStrings`. Header states the honesty rules the record screen
  inherits: nothing is filtered, buckets sum to the row count, a confounded move is never a hit,
  legacy rows are an explicit absence.
- `src/lib/call-horizons.ts` (387 lines, opened). Owns every window fact the Claim screen renders in
  its lower table: `HORIZON_DAYS`, `MAX_WINDOW_DAYS = 90`, `adoptWindowForCall`,
  `adoptWindowPhrase`, `resolutionPhrase`, `displayLoggedDate`, `isPriceableClaimType`. It owns the
  WINDOW. It does not own the benchmark set. See Open question 8.

Supporting files opened to resolve provenance (not github.md mappings, named because I read them):
`src/lib/your-record.ts`, `src/lib/verdict-vocabulary.ts`, `src/lib/scored-object-map.ts` (header
and mapper contract), `src/lib/track-record-live-score.ts` (read in part, the
`outcomeDisplayLabel` region), `src/app/radar/desk-record/page.tsx` (header), `src/app/radar/calls/page.tsx`
(header and imports), `src/components/brief/BriefCallsSection.tsx` (header),
`src/app/print/[briefing_id]/page.tsx` (header), `src/components/calls/TrackCallControl.test.ts`
(read in part, the assertion block).

**MAPPED BUT MISSING:** none. All six paths named in the batch assignment exist and were opened.

---

## Shared component to extract first

**The outcome state token.** Dot plus word plus colour, one component, no left spine, no icon, no
capitals, `transition: none`.

It has to come first because all three of my screens render it, the two adjacent screens outside my
batch render it, it is the single thing the compliance rules bind hardest, and the existing
implementation is wrong on three separate counts at once.

Consumers, all confirmed in the prototype:

- **Prepared record**, twice. As four count tiles at `:553` to `:556` (SUPPORTED 17 / CHALLENGED 12 /
  DEVELOPING 5 / AWAITING 7, 10px mono label over a 17px mono numeral), and as a per-row chip on
  every entry (`:559`, `:565`, `:573`, `:579`, `:585`, `:591`, and on down).
- **Entry**, once, as the screen header at `:527`: an 8px dot plus a 12.5px semibold Inter word.
- **Claim**, zero times in the current state. The claim is unresolved, so the token is absent. It
  appears the moment the claim is committed and re-enters as a Ledger card.
- **Ledger** (not my batch): past-entry rows at `:446`, `:451`.
- **Review** (not my batch): a 11px dot plus a 36px Playfair 700 word at `:502`.

What varies between them, precisely:

| Axis | Prepared record tile | Prepared record row | Entry header | Ledger row | Review |
|---|---|---|---|---|---|
| Word size / face | 10px mono, tracked 0.07em | 10.5px Inter 600 | 12.5px Inter 600 | 11px Inter 600 | 36px Playfair 700, -0.025em |
| Dot | none | none | 8px | 7px | 11px |
| Colour source | `--c-muted` label, `--c-ink` numeral | `--c-redink` / `--c-greenink` / `--c-amberink` | ink token + `--c-red` dot | ink token + base dot | literal `#f87171` / `#4ade80` / `#fbbf24` on espresso |
| Count slot | yes, 17px mono | no | no | no | no |

The colour axis is the trap. README: "**On pinned-espresso surfaces use the literal on-espresso
values**, not the ink tokens: `#f87171` red, `#4ade80` green, `#fbbf24` amber. The ink tokens are
light-theme values and measure 2.86 to 3.76:1 on espresso." So the component needs a surface prop
(`cream` | `espresso`), not a size prop alone. github.md logs this exact defect being shipped and
fixed on the landing outcome pill at line 161.

Grounding in existing files:

- The word table already exists and is already correct in kind:
  `src/lib/verdict-vocabulary.ts` `VERDICT_WORD` and `verdictWordForState`. Its header states why
  there is exactly one: "Extracting it here means there is nothing left to fall through TO."
- The colour map exists twice and disagrees with itself in role, not value:
  `src/components/scored-object/ScoredObject.tsx:99` `STATE_COLOR` (keyed on `ScoredState`) and
  `src/components/record/DeskRecordView.tsx:42` `RESOLUTION_COLOR` (keyed on `Resolution`). Both use
  `--signal-up` / `--signal-dn` / `--text-muted` / `--border-subtle`. The mobile tokens are
  `--c-green` / `--c-red` / `--c-amber` for fills and `--c-greenink` / `--c-redink` / `--c-amberink`
  for text, per README's Semantics table.
- The existing badge, `src/components/thesis/OutcomeBadge.tsx`, is the thing being replaced. It is
  uppercase (forbidden), icon-bearing (not in the design), rounded-full (outside the sanctioned
  4/6/9/12/14 radii), and label-mismatched (Inconclusive and Developing, neither of which is in the
  permitted four).

---

## Component inventory

| Component | Existing path | Status | Note |
|---|---|---|---|
| Outcome state token (dot + word) | `src/components/thesis/OutcomeBadge.tsx` | Needs variant, effectively a rewrite | Uppercase, lucide icon, `rounded-full`, 8/10px. Every one of those is forbidden or off-scale for mobile. Word table already lives in `src/lib/verdict-vocabulary.ts`; reuse it, replace the shell. |
| Verdict word table | `src/lib/verdict-vocabulary.ts` | Reusable as-is | `VERDICT_WORD` + `RESOLUTION_BY_STATE` + `verdictWordForState`. Pure, no React. Vocabulary conflict is a content decision, not a code one. |
| Scored card (claim + receipt + verdict zone) | `src/components/scored-object/ScoredObject.tsx` | Needs variant | Anatomy is right and reusable. The 3px left spine at `:129` must not render on mobile, and `footer` is a `ReactNode` slot the mobile Claim screen does not use (its CTA is a fixed bottom bar, not a card footer). |
| Commit footer / track control | `src/components/calls/TrackCallControl.tsx` | Needs variant | `CallCommitFooter` is a card-footer row with an inline `<select>` and a text button. Mobile Claim wants a 52px bottom-bar button that opens a sheet. `hasCommitFooter`, `UNGRADEABLE_REASON` and the tracked-state shape are reusable verbatim. |
| Ledger line | `src/components/calls/TrackCallControl.tsx` (`buildLedgerLine`, `CallLedgerLine`) | Needs variant | String is locked by an exact-match test. Prototype renders a different string. See Open question 2. |
| Window / horizon vocabulary | `src/lib/call-horizons.ts` | Reusable as-is | Pure, no React, no fetch. `adoptWindowPhrase` gives "resolves in about a quarter"; `resolutionPhrase` gives the deictic form the tracked card needs. Nothing to change. |
| Record model (desk) | `src/lib/desk-record.ts` | Reusable as-is for the desk record | Wrong object for MY screen. It reads `morning_brief_call_outcomes`. |
| Record model (user) | `src/lib/your-record.ts` | Needs variant | The correct model for the Prepared record: reads `user_claims` + `user_claim_outcomes` only, "There is no parameter here through which the desk's numbers could arrive." Missing what the screen needs: an entries LIST (it returns counts only, no `entries` array), a date range, and month grouping. |
| Record view | `src/components/record/DeskRecordView.tsx` | Needs variant | Desktop grid of tiles + a 2-column card list. Mobile is a 4-across count strip in one 14px-padded row, then flat rows with month rules. Statuses (`loading` / `ready` / `error`) and the empty/error copy are directly reusable. |
| Bucket count tile | `src/components/record/DeskRecordView.tsx` (`BucketTile`) | Needs variant | Desktop tile is a bordered card at 32px serif with a bucket note paragraph. Mobile is a bare `flex:1` cell, 10px mono label over 17px mono numeral, four across, no note. |
| Month rule (date + hairline + count) | none | **Net new** | Closest analogue: the Ledger's own date rule at `:444` (italic Playfair label, `flex:1` hairline), which is the same anatomy minus the trailing count. |
| Prepared-record masthead (name + provenance line) | none | **Net new** | Closest analogue: `DeskRecordView`'s `<header>` at `:134` to `:146`, which carries title + intro + a "N graded calls, from to." provenance line. Same job, different object and no person name. |
| Record export bar (Link / Export PDF) | none | **Net new** | Closest analogue: `src/app/print/[briefing_id]/page.tsx`, the only PDF path in the repo. It exports a BRIEF, via `/api/briefing`. Nothing exports a record. See Lucas-protected files. |
| Claim screen "what would settle it" well | none | **Net new** | Closest analogue: `ScoredObject`'s open-state verdict zone at `:205` to `:217`, which renders "Resolves [when], against [source]." The prototype splits that into a bordered well plus a three-row benchmark table. |
| Claim screen benchmark table | none | **Net new** | Closest analogue: `src/lib/call-horizons.ts` for the Window row only. Nothing in the repo supplies the "Measured against XLF, and SPY" row. See Open question 8. |

---

## States

The prototype's dev strip (`:2630` to `:2680`) enumerates every lifecycle state it ships:
Stale brief, Wrap loading, No wrap, Brief loading, Brief error, No brief, Replay splash, Commit
fails. **None of my three screens has a lifecycle state in it.** README's own opening line says
"31 screens, all reachable, each with its loading, error, empty and stale states"; for Claim, Entry
and Prepared record that is not what the prototype contains. Flagged, not resolved.

### Claim

- **loading** UNSPECIFIED.
- **error** UNSPECIFIED.
- **empty** UNSPECIFIED. Not obviously meaningful for a single-object screen.
- **stale** UNSPECIFIED. Note the screen is reachable from a stale brief (`briefStage: 'stale'` is a
  Ledger state), and README's stale copy says "review dates are unaffected". Whether the Claim
  screen inherits a stale marker is not stated.
- **Specified adjacent state, and the only one:** ungradeable. `UNGRADEABLE_REASON` renders verbatim
  on the Ledger card at `:441` and nowhere on the Claim screen. Whether a non-gradeable call can be
  opened as a Claim screen at all is not shown.

### Entry

- **loading** UNSPECIFIED.
- **error** UNSPECIFIED.
- **empty** UNSPECIFIED.
- **stale** UNSPECIFIED. An entry is a closed historical fact, so stale may be meaningless here, but
  the handoff does not say so.
- Only the resolved presentation exists, and only for one outcome (Challenged, at `:527`). No
  supported, developing or awaiting variant of the Entry screen is drawn.

### Prepared record

- **loading** UNSPECIFIED in the handoff. Repo candidate, unused by the design:
  `DeskRecordView.tsx:148`, a 120px skeleton block, `aria-hidden`.
- **error** UNSPECIFIED in the handoff. Repo candidate: `DESK_RECORD_COPY.errorTitle` "The record
  could not be loaded" / `errorBody` "The graded-call record is temporarily unavailable. Nothing is
  estimated in its place." For the user's own record, `YOUR_RECORD_COPY.unavailable` "Your calls are
  not available right now. Nothing is estimated in their place."
- **empty** UNSPECIFIED in the handoff. Repo candidates, and there are two distinct ones in
  `src/lib/your-record.ts`: `noClaimsTitle` "You have not made a call yet." for zero claims, and
  `noneResolvedTitle` "None of your calls has resolved yet." for claims held but nothing graded. The
  design draws neither.
- **stale** UNSPECIFIED.
- **Specified, and not lifecycle:** the export action machine. `recNotice` / `recNoticeText` at
  `:642` to `:647`, driven by `act()` at `:3071`. `linkLabel` idle "Link" then "Link copied"
  (`:3523`), `pdfLabel` idle "Export PDF" then "Preparing..." then "Saved to Files" (`:3525`), a
  gold-dot notice strip, auto-clearing after 2600ms. There is no failure branch for either action.

The handoff's error-state principle, which does apply here and is quoted in github.md line 138:
"This is a failed read, not an empty result. Nothing is being hidden." Adopted verbatim from
`src/app/cross-source/page.tsx`. It governs how error and empty must differ; it does not specify the
states themselves for these three screens.

---

## Lucas-protected files

**None.**

None of the six mapped sources imports `src/app/api/briefing/route.ts`, `src/lib/watchlist-utils.ts`,
`src/components/watchlist/WatchlistAddInput.tsx` or `src/app/trends/page.tsx`, and none of the three
screens renders anything owned by them.

One adjacency worth stating before it becomes a surprise: the Prepared record's "Export PDF"
(`:650`) has no repo counterpart, and the only PDF path that exists is
`src/app/print/[briefing_id]/page.tsx`, whose header says it "forwards the same cookies to
/api/briefing". If the record export is built by reusing that pipeline it lands inside a
propose-only file. Building the record export as its own route with its own data source keeps this
batch clear of all four. Raised as Open question 7 rather than decided here.

---

## Designed fresh, no repo counterpart

**None.** github.md marks four screens as designed fresh and none of them is mine:

> `| Story (reader view) | designed fresh. No article reader exists in the repo; rendering is publisher-indexed. |`
> `| Saved / offline | designed fresh. No repo counterpart found. |`
> `| Alerts | designed fresh. No repo counterpart found. Deliberately states that nothing here can interrupt a browser tab. |`
> `| Ask directory | designed fresh. No mobile browse surface exists in the repo, though command-palette.tsx is the desktop jump surface and now grounds the Search screen. |`

Separately, and it is not the same thing: **the Claim screen has no row in github.md's screen map at
all.** It is neither mapped nor declared fresh. That is an omission in the provenance document, not a
sourceless screen. See Open question 4.

---

## NOT PORTED and deviations

### 1. The coloured left spine on `ScoredObject`. Forbidden, and the design already removed it.

README, Forbidden visual treatments:

> "Frosted glass, gradients on surfaces, **coloured left borders**, all-caps decorative treatments.
>
> The coloured left border is the one that bites repeatedly, because the design system specifies a
> 3-4px gold left rule on lead cards and a state spine on scored objects. **State lives in a 2px top
> edge plus a dot and the state word**, applied consistently."

github.md, line 68, on the masthead retraction:

> "wider than the 3-4px spines this project already removed on principle (ScoredObject's state
> spine, SectorSignalCard)"

The live component still ships it. `src/components/scored-object/ScoredObject.tsx:129`:
`className="scored-object-spine absolute left-0 top-0 bottom-0 w-[3px]"`, colour from
`STATE_COLOR[state]` or `var(--gold)` when `committed`. The mobile replacement is confirmed in the
prototype: the committed Ledger card at `:394` is `height:2px;background-color:var(--c-gold)` across
the TOP of a `overflow:hidden` card, wiped in with `v3rule` over 420ms.

### 2. Outcome vocabulary. Four words specified, six shipped, and one word means two things.

README, Compliance rule 3:

> "**Outcome states use exactly:** supported, challenged, developing, awaiting. Never right, wrong,
> correct, win, or loss."

What the repo actually renders, from files I opened:

- `src/lib/verdict-vocabulary.ts:53` `VERDICT_WORD`: "Supported", "Challenged", "No clean read", and
  `undefined` for `notGraded`. `DESK_RECORD_COPY.bucketLabel.notGraded` at `desk-record.ts:76`
  supplies "Not graded" for the heading.
- `src/lib/track-record-live-score.ts:287` `outcomeDisplayLabel`: "Supported", "Challenged",
  "Inconclusive", falling through to **"Developing"**.

So the live vocabulary is Supported, Challenged, **No clean read**, **Not graded**, **Inconclusive**,
Developing. Three of those six are outside the permitted four. "Awaiting" is never rendered as a
word by any of these; it exists as `YOUR_RECORD_COPY.awaitingLabel` "Awaiting" in
`src/lib/your-record.ts:73` and as ScoredObject's `Open` chip at `:154`.

Worse, the prototype uses "Developing" for what the repo calls `noCleanRead`. Prototype `:591` to
`:594`:

> `Developing` ... "ZION +3.71% against XLF +3.44%. The move could not be separated from the sector."

and `:630` to `:633`:

> `Developing` ... "No clean read. The move could not be separated from the credit complex."

`src/lib/verdict-vocabulary.ts:35` defines `noCleanRead` as "the move could not be separated from
sector/market, or it sat under the attribution bar. Never counted as a hit." That is the same
condition, under a different word, in a different bucket. But the prototype ALSO uses Developing at
`:636` for a SoFi entry with no attribution line at all, which reads as still-accumulating. One word
is carrying two states. Both sides quoted. Not resolved. Open question 1.

### 3. Uppercase on the outcome badge.

README, Design-system deviations:

> "All-caps sentiment pills dropped from product copy | Forbidden decorative capitals. Capitals
> survive only in the monospace ledger line, which is machine record."

`src/components/thesis/OutcomeBadge.tsx:42` still ships `font-data font-bold uppercase`. The
prototype's record rows are sentence case Inter 600 at 10.5px (`:559`). The only capitals surviving
on my screens are the mono ledger lines at `:401` and `:537` and the record's mono count labels at
`:553` to `:556`, which is exactly the carve-out the rule names.

### 4. `buildLedgerLine` says one thing, the design draws another. This one is test-locked.

Repo, `src/components/calls/TrackCallControl.tsx:95` to `:107`, produces:

> `LOGGED 2026-07-26  ·  REVIEW 2026-08-02  ·  Fixed at entry. Reviewed on the desk's own bar.`

That exact string is asserted at `src/components/calls/TrackCallControl.test.ts:112`, with four more
assertions around it covering the drop-a-segment cases (`:135`, `:143`, `:150`).

Prototype, committed Ledger card at `:401`:

> `ENTERED 2026-08-06 06:58 PT  ·  CHECKED 2026-11-04`

Prototype, Entry screen at `:537`:

> `ENTERED 2026-06-24  ·  CHECKED 2026-07-22  ·  WINDOW FIXED AT ENTRY`

Three differences, all deliberate-looking: LOGGED becomes ENTERED, REVIEW becomes CHECKED, and the
trailing sentence "Fixed at entry. Reviewed on the desk's own bar." becomes either nothing or a
capitalised "WINDOW FIXED AT ENTRY". The prototype also adds a wall-clock time (06:58 PT) that
`buildLedgerLine` deliberately strips (test at `:159`: `assert.equal(line.includes("T14:33"), false)`).
Not resolved. Open question 2.

### 5. `TRACK_TRUST_LINE` is restated in the sheet.

Repo, `src/components/calls/TrackCallControl.tsx:61`:

> "Your window is fixed the moment you commit, and misses stay on your record. Same
> benchmark-attribution bar as the desk's own calls: a move the market explains is not a hit."

Prototype, commit sheet at `:2596`:

> "The window is fixed the moment you commit and cannot be moved afterwards. A miss stays on the
> record, and the record is better for it."

Same claim, different sentence, and the second half (the benchmark-attribution bar) is dropped
entirely. The repo comment at `:49` is explicit that the line is "Shown ONCE beneath a section
heading, never per card" and that "Repeating it above every card turned the strongest sentence in
the product into wallpaper." The mobile design moves it into the sheet, which is once per commit
rather than once per section. This sits on the Ledger side of my boundary but github.md maps
`TRACK_TRUST_LINE` into this batch's source set, so it is logged here.

### 6. `UNGRADEABLE_REASON` is the one string that matches exactly.

Repo `src/components/calls/TrackCallControl.tsx:65`, prototype `:441`, character for character:

> "No honest grader for this claim type yet, so there is nothing to commit to."

Noted because it is the only verbatim match in the batch.

### 7. Prepared record is mapped to the wrong object.

github.md: `| Prepared record | src/components/record/DeskRecordView.tsx |`

`DeskRecordView.tsx:4` says what it is: "DeskRecordView - Signalera's own call record". Its page,
`src/app/radar/desk-record/page.tsx:5`, says: "Distinct from the 'Record' hero on /radar/calls, which
is the USER's record of their own claims." And `src/lib/your-record.ts:4`: "The desk's record
(src/lib/desk-record.ts) and the user's record are two different objects and are never mixed."

The prototype's Prepared record is unambiguously the user's: `:549` is a person's name ("Maya
Reyes"), `:550` reads "41 calls entered between June 2, 2026 and February 20, 2027", and every row
carries the user's own italic note (`:561`, `:567`, `:575`). github.md itself flags this class of
error elsewhere, at line 46: "`RadarTabs.tsx` states it is the desk's own graded record, distinct
from the user's record on Calls; the two had been wrongly collapsed into one idea." Not resolved.
Open question 3.

### 8. Compliance rule: no aggregate rate. Currently held on both sides.

README, Compliance rule 2:

> "**No aggregate accuracy percentage or hit rate anywhere**, including placeholder content. Counts
> are permitted; rates are not. Where a rate would be derived, withhold it and show the counts."

github.md line 30: "The repo computes a `supportRate`; not rendered. Counts only, per the brief's ban
on any rate."

`src/lib/your-record.ts:19`: "No aggregate. No hit rate, no ratio, no percentage of any kind is
computed here, because the surface must not be able to render one." `DeskRecordView.tsx:96` renders
`{count}` plus "of {total}". The prototype's record header at `:553` to `:556` shows four bare
counts, no denominator and no rate. Compliant on every side. The risk for this batch is the count
strip: if the mobile tiles gain an "of 41" they are still counts, but any percentage derived from
them is a rule break. Do not add one.

### 9. Compliance rule: challenged entries are never punished. Currently held on both sides.

README, Compliance rule 6:

> "**Challenged entries must not be visually punished or buried.** A record containing challenged
> calls is more credible than a spotless one, because it proves the record was not curated.
> Challenged entries sit in line where they fell, at the same size and weight, and the record is
> reverse-chronological and unfiltered by default."

`src/lib/desk-record.ts:228`: "Bucket render order. Misses are not pushed to the end: challenged and
no clean read sit immediately beside supported, at the same size." `RESOLUTION_ORDER` is
`["supported", "challenged", "noCleanRead", "notGraded"]`. `DeskRecordView.tsx:11` to `:19`:
"HONESTY IS THE LAYOUT ... There is no hero number, no headline hit rate, no ordering that buries the
misses ... A wrong call sits in line wherever it fell." `src/lib/your-record.ts:161` re-exports the
same order: "Bucket render order, identical to the desk record: misses are never last."

The prototype holds it: every record row is the same 15px Playfair 500 claim, same 13px italic note,
same 11.5px result line, same 15px vertical padding and same `--c-hair` rule, whether it is
Challenged (`:559`, `:573`, `:585`, `:598`, `:617`) or Supported (`:565`, `:579`, `:604`, `:610`,
`:623`). The count strip gives Challenged the same cell as Supported. The only difference is the
`--c-redink` vs `--c-greenink` word colour, and both carry their word, per README's accessibility
rule "No state is signalled by colour alone".

**Two things could break this during implementation and both must be gated for:** any default
sort that is not strict reverse-chronological, and any filter chip on the record. The record is
"Complete, uncurated, exportable" (README Screens table) and the prototype's own subhead at `:550`
says "Every entry is included. Nothing is sorted, filtered or removed." There is no filter control
anywhere in the `isRecord` block. Do not add one.

### 10. Prototype markup defects in the `isRecord` block. Three of them, all real.

- **Reverse-chronological is broken at the top of the list.** Rows at `:558` (2026-06-24) and `:564`
  (2026-07-08) sit ABOVE the "February 2027" month rule at `:571`, and above rows dated 2027-02-19,
  2027-02-17, 2027-02-12. The screen's own subhead promises the record is not sorted or filtered,
  and rule 6 above requires reverse chronological. The two lead rows contradict the ordering they
  sit in.
- **Malformed nesting at `:570` to `:572`.** A `<div onClick="{{ goEntry }}">` opens at `:570` with
  a claim-row style, and the next element inside it is the February 2027 month rule, then another
  row div opens at `:572`. The wrapper never closes where a row would.
- **Orphan row at `:636`.** After the "October 2026" month rule, a date/outcome header
  (`2026-07-15`, Developing) and a claim appear with no wrapping row div, then `:639` closes
  something. The date is also July under an October heading.

Not resolved. Open question 9.

### 11. `confidencePct` still exists on the card contract.

`src/components/scored-object/ScoredObject.tsx:44` still declares `confidencePct?: number` and
renders "70% confidence" at `:196`. `src/lib/scored-object-map.ts:34` says the converter was removed
and "no mapper renders a confidence percentage any more". `TrackCallControl.tsx:31`: "No confidence
or probability is ever rendered." `TrackCallControl.test.ts:178` greps authored copy for
`/%|\bodds\b|\blikel|\bprobab|\bchance\b|\bconfidence\b/i`. The prop is a live footgun on a card the
mobile Entry screen reuses. Flagged, not touched.

---

## Open questions

1. **Outcome vocabulary.** README says exactly four words: supported, challenged, developing,
   awaiting. The repo renders six: Supported, Challenged, No clean read, Not graded, Inconclusive,
   Developing. The prototype then uses "Developing" for two different things, one of which is
   exactly what the repo calls `noCleanRead` (`:591`, `:630`) and the other of which reads as
   still-accumulating (`:636`). Rule: which repo bucket maps to which of the four words, and what
   does a `notGraded` row render as on the Prepared record? Blocks the shared component, which
   blocks all three screens.

2. **`buildLedgerLine` is test-locked to a string the design does not draw.**
   `src/components/calls/TrackCallControl.test.ts:112` asserts
   `"LOGGED 2026-07-26  ·  REVIEW 2026-08-02  ·  Fixed at entry. Reviewed on the desk's own bar."`
   character for character. The prototype draws `ENTERED ... · CHECKED ...` at `:401` and `:537`,
   with a wall-clock time the test at `:159` explicitly forbids. Change the string and update five
   assertions, keep the string and change the design, or fork a mobile formatter and accept two
   ledger vocabularies. Blocks Entry.

3. **Prepared record provenance.** github.md maps it to `DeskRecordView.tsx`, which is the DESK's
   record. The screen is unmistakably the USER's. `src/lib/your-record.ts` is the correct model but
   returns counts only, with no entries list, no date range and no month grouping. Confirm the
   mapping is a provenance error, then decide whether `your-record.ts` grows an entries list or the
   record screen queries directly.

4. **The Claim screen is absent from github.md's screen map.** It has no row, and it is not in the
   designed-fresh group either. Confirm this is an omission rather than a decision, and if it is an
   omission, say whether the intended source is `radar/calls`'s open-call card path
   (`ScoredObject` + `CallCommitFooter`) or something else. I did not go find a plausible file.

5. **Who ships the commit sheet, and when.** README's Screens table says
   `| Commit sheet | (within isLedger) |` and github.md's map puts it under the Ledger. The
   prototype disagrees: `:2579` is a global overlay, sibling to every screen, gated only on
   `s.sheet` (`:3485`), opened from three screens including mine (`:492`). The Ledger and Review are
   unassigned to any batch. If the sheet ships with the Ledger, the Claim screen ships with a dead
   primary CTA. Assign the sheet.

6. **`ScoredObject`'s left spine.** Removing it is required by the brief. The component is consumed
   by `src/app/radar/calls/page.tsx`, `src/components/record/DeskRecordView.tsx`,
   `src/components/brief/BriefCallsSection.tsx` and `src/app/preview/scored-object/page.tsx`, all
   desktop. Variant prop, or a mobile fork? A prop changes nothing on desktop until it is passed; a
   fork means two anatomies for the signature component of the visual identity.

7. **Record export.** "Link" and "Export PDF" at `:649` and `:650` have no repo counterpart. The only
   PDF pipeline is `src/app/print/[briefing_id]/page.tsx`, which forwards cookies to
   `/api/briefing`, a propose-only file. Also unspecified: what a share link exposes. The prototype's
   own notice at `:3529` says "Anyone with the link sees all 41 entries. It cannot be filtered
   before sharing", which is a real access-control decision, not a copy decision. Neither action has
   a failure state drawn.

8. **The Claim screen's benchmark row has no source.** `:485` renders "Measured against / XLF, and
   SPY". `src/lib/call-horizons.ts` owns the WINDOW only (`isPriceableClaimType` at `:347` gates
   ticker/sector/index, nothing selects a benchmark set). The commit sheet at `:2592` shows the same
   pair. Where does the benchmark pair come from at read time, before the grader runs? If it is
   `backend/grading/price_attribution.py`'s selection, it needs to be surfaced to the frontend or
   the row cannot be rendered honestly.

9. **Prototype defects in `isRecord`.** Two entries dated 2026 sit above the February 2027 month rule
   (`:558`, `:564`), the row wrapper at `:570` to `:572` is malformed, and `:636` is an orphan row
   dated July under an October heading. Confirm strict reverse-chronological with month rules is the
   intent, and that the two lead rows are a prototype artifact rather than a pinned "most recent
   activity" block.

10. **Empty and error for the Prepared record.** The design draws neither, and the repo has two
    distinct empties (`YOUR_RECORD_COPY.noClaimsTitle` for zero claims,
    `noneResolvedTitle` for claims held but nothing graded) plus an error
    (`YOUR_RECORD_COPY.unavailable`). Confirm these are adopted rather than designed, because
    inventing them here would collide with the "failed read is not an empty result" principle
    github.md line 138 adopted verbatim.
