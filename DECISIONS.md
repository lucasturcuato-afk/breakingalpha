# Rulings on the open decisions

Noah ruled the first nine on 2026-08-15. Ruling 10 was added on 2026-08-16,
when the Ledger build produced a deviation that needed a record. This file is
the record. The design handoff at `design_handoff_signalera_mobile/README.md`
states the conflicts; this states what won.

## How to read the "Build step" column

Build step numbers refer to **`design_handoff_signalera_mobile/IMPLEMENTATION_PROMPT.md`
lines 101 to 116, "Order to build in"**, which is the authoritative sequence:

| Step | Surface |
|---|---|
| 1 | Navigation shell |
| 2 | Ledger, the home surface and the anatomy every other card reuses |
| 3 | Commit sheet |
| 4 | Review |
| 5 | Dashboard |
| 6 | Claim, Entry, Prepared record |
| 7 | Evening Wrap, Compose, Desk record |
| 8 | Watch, Thesis Tracker, Thesis detail |
| 9 | Ask, Search, Company Intel, Memo |
| 10 | Deal Flow, Deal detail, Trends, Signal, Live Feed, Story |
| 11 | Landing, Onboarding, Sign in |
| 12 | Settings, Alerts, Saved, Learned, Share |

An earlier draft of these rulings used a separate eight-batch grouping. Those
numbers are dropped. Every ruling below is re-mapped to the list above. Where a
ruling names no step, the work sits off the mobile build path entirely.

## The rulings

| # | Ruling | Build step | Ships as |
|---|---|---|---|
| 1 | cross-source rate and Right/wrong. **Fix.** Counts stay, the rate goes, `n_correct`/`n_wrong` become supported/challenged. | Off the build path. `/cross-source` has no mobile counterpart (README Gaps item 1). | Two PRs. First: frontend labels and the accuracy/Wilson removal, DB columns untouched, no migration. Second: the column rename with the migration file included and **unapplied**, for Noah to decide whether to run. Both after ruling 8 and the copy swaps. |
| 2 | EVIDENCE SUPPORTED 71.4%. **Remove.** In-repo at `src/components/landing/opening-screen.tsx`, not a marketing deploy. | Step 11 surface (Landing), but **not gated on it**. Ruled to ship now. | Queued, own PR. |
| 3 | Landing headline. **Adopt** "We track which calls the evidence supports." | Step 11 surface (Landing), shipping now against current prod. | Copy PR. |
| 4 | heroPara. **Adopt** "the calls the evidence ran against." | Step 11 surface (Landing), shipping now against current prod. | Copy PR. |
| 5 | Role labels. **Adopt** Fund Analyst / Equity Research. Ids unchanged, so no migration and no backfill. All three sites, including `PreferencesForm.tsx`, which no design doc tracks. | Steps 11 (Onboarding) and 12 (Settings), shipping now against current prod. | Copy PR. |
| 6 | RIA description. **Adopt** "Managing client capital", matching the string already live in `OnboardingWizard.tsx`. | Step 12 surface (Settings), shipping now against current prod. | Copy PR. |
| 7a | Risk appetite UI. **Not ported.** The design wins. | Steps 11 (Onboarding) and 12 (Settings), but **not gated on them**. Ruled to ship now. | Queued, own PR. |
| 7b | Risk appetite consumers. Removal from the prompt builders, the API, the Python pipeline and the DB column is **its own workstream**. Does not gate the redesign. | Off the build path. | Not scheduled. 19 consumers mapped in recon. **2026-08-25:** the `Risk posture is set to X.` sentence in `narrative()` in `src/app/api/profile/insights/route.ts` was removed during the mobile sprint (PR #673) under a misreading of 7a, and has been reverted. 7a is the mobile UI; this row names the API. Reasoning recorded with the revert, relayed to the PR #673 thread rather than given in writing here, so treat the attribution as second-hand: the field still shapes generated content across all 19 consumers, and that sentence is the only surface where a reader can observe it happening, so removing it makes the product quieter about something it still does. It belongs with the other consumers, in this row. Re-confirm with Noah before citing this line as his ruling. |
| 8 | SIGNAL scores. **Stay.** Not a compliance issue. It is a relevance score, not an accuracy figure. Relevance ranking is editorial judgment, not a claim about accuracy, so it does not fall under the compliance rule. | **Lands on step 2, the Ledger card**, not the nav shell. The Ledger is the anatomy every other card reuses, so the design needs a slot for the badge before that card is written. Also touches steps 5, 9 and 10. | No production change. The design carries the deviation, not the code. |
| 9 | cross-source palette. **Retoken.** One file, no shared surface. | Off the build path, same route as ruling 1. | Queued, own PR. |
| 10 | Stats band, the VIX label. **Deviate from the design.** One anatomy across all four cells: Inter 700 in `--c-muted`. The design draws three labels in Inter 700 and the fourth in `"JetBrains Mono"` 400 at `--c-oninv-dim`, which is two anatomies in one band of equivalent cells, the thing the README's own responsive rule forbids. It also fails contrast on its own terms: `--c-oninv-dim` `#a2937a` on `--c-bg` `#fffdf9` measures **2.96:1** at a 10px label, against a 4.5 floor. The built `--c-muted` `#786a52` measures **5.19:1**. | Step 2 surface (Ledger). | **Shipped in #622.** Not to be reverted. The design carries the deviation, not the code. |
| 14 | Thesis Tracker and Thesis detail. **CUT from mobile scope.** Tracker's desktop surface is a four-line redirect shim: `/radar/theses` answers `redirect('/radar/calls?views=open')`, `RadarTabs` carries four tabs and Theses is not among them, and three files call it retired in their own comments (`radar/calls/page.tsx:250`, `search-data.ts:35`, `TrackedViews.tsx:17`). There is nothing to port. Detail (`/radar/track-record/[thesis_id]`) still renders but is orphaned: reachable only from the command palette and one link at `TrackedViews.tsx:402`, and absent from RadarTabs. | Step 8. | **Cut.** Missing-screen count corrects from 6 to 5. |
| 15 | Memo. **STAYS in scope, as a port.** Not retired: `MemoModal.tsx` is mounted at 21 sites across 17 files, the most widely mounted component in the product, and it has no mobile surface at all. | Step 9. | **In scope, unbuilt.** The largest live desktop surface with zero mobile presence. |
| 16 | Signal, Story and Deal detail. **Reclassified: NEW SCREENS, not ports.** None has a desktop source. `src/app/signal` and `src/app/story` do not exist; `/deal-flow` exists with no `[id]` route. Calling them 'missing' overstated readiness: there is nothing to port from, so each is new work. | Step 10. | **Reclassified.** |
| 17 | Pole names: **Watch becomes Radar, Today becomes Dashboard.** One decision about desktop-to-mobile continuity, ruled 2026-08-26. Both mobile labels diverged from the desktop names users already know, and in both cases the mobile label also collides with something. **Watch** is already a market-state word at `mood-bar.tsx:38` (`badgeLabel`), names an action rather than a place, and labels a surface that does not exist yet; Radar is the desktop word. **Today** is the prototype's word, but `pageTitle` at `dashboard/page.tsx:824` and the command palette both already say Dashboard, so a reader taps Today and lands on a page headed Dashboard. The prototype says Today 9 times and Dashboard 3, the latter in a jump-list context, so the design itself uses both names for one screen. | Nav shell. | **Ruled.** `badgeLabel` in `mood-bar.tsx` is NOT touched: Watch remains a market state. |
| 18 | Signed-in screenshots on a public repo. **Third instance. Remove the 24 carrying plates, keep the blobs in history.** Twenty four of 39 full-page plates committed on 2026-08-27 published account data: name and greeting, the grading tally, personalization chips including the `balanced` tone preference, a nine ticker watchlist plus a sector subscription, and a live email address with a role label. **Ruled 2026-08-28:** the plates come out and the Markdown is repaired, but history is NOT rewritten and nothing is force-pushed. The content is the owner's own account on a three-person repo, and no claim text and no review date appears in any of the 39, so blobs remaining reachable is an accepted cost rather than an oversight. | Off the build path. Affects three PR branches. | Removal commits on #698, #699 and #700. The rule moves INSIDE the capture, see below. |

### Ruling 17: what the Radar name does and does not promise

Radar's live tabs are Following, Watchlist, Calls and Desk record. **Calls and Desk record stay under the Ledger pole**
and are not moving.

So the pole named Radar delivers two of Radar's four tabs. That is accepted
deliberately: **the name is navigational continuity with desktop, not a promise
of five tabs.** A reader who knows Radar from desktop should find the pole; a
reader who expects their calls under it will find them one pole over, under
Ledger, which is where a record belongs.

Recorded because the objection is real and someone will raise it again: the name
under-describes what sits behind it, and that was weighed against the cost of a
third name for the same idea.


### Ruling 18: what was exposed, and why the rule kept failing

Recorded rather than quietly cleaned up, because a scrub with no record is how
the same thing happens a fourth time.

**What was published, on a public repository, across three PR branches.**
Twenty four full-page renders carried, between them: the greeting "Good morning,
Noah." and the account avatar; the personal grading tally in two states,
including "2 of your calls were checked"; the "Personalized for" chip row naming
three followed sectors plus a `balanced` tone preference; the full watchlist
membership across nine tickers with a Real Estate sector subscription and a 26
item count; and, on two desktop plates, the sidebar account card rendering the
address `noahhanning03+e2e` beside the role `Analyst`.

That last one is a different category from the rest. It is not product output,
it is a live deliverable mailbox, and it is the reason this ruling names the
exposure instead of summarising it.

**What was NOT exposed, verified by three independent auditors opening all 39
images individually rather than matching filenames.** No claim text and no
review date appears anywhere. That is the specific harm the two earlier
incidents caused, and it did not recur. The category around it did.

**Why history stays.** The repository has three people in it, the account is the
owner's own, and the most sensitive item is an email address that is live
whatever the repository does. Rewriting history costs a force push across three
branches, invalidates every open review, and defends against an audience that
does not exist here. The blobs stay reachable through history and through
the GitHub file views, by decision rather than by omission.

**Why the rule failed three times.** It was a rule that ran AFTER the capture:
someone had to remember it, at review time, on an image that already existed.
Three times nobody did. The two plates in all 39 that carried nothing were not
careful, they were structurally incapable of leaking: one is a pure skeleton
whose avatar pill has no letter in it, the other is a typography specimen sheet
whose only string is fabricated.

So the rule moves inside the capture. A capture refuses to write a frame
containing an account name, a record block or personalization chips, and a
component crop is the default rather than the exception. A rule that runs before
the file exists cannot be forgotten at review time, which is the only failure
mode this has ever had.

### Ruling 14 to 16: the test that produced them

Each screen still nominally in scope was checked against one question: **does the
desktop surface it would port from still exist, or was it superseded?**

That test cut two screens, kept one that looked like a cut candidate, and
reclassified three from "missing" to "new work". The reclassification matters
more than it sounds: an inventory that lists Signal, Story and Deal detail as
missing implies a port is waiting to be done, when in fact no source exists and
each is a screen to be designed and built from the prototype alone.


## Open items

Logged 2026-08-16 from a DOM read of `design_handoff_signalera_mobile/Signalera
Mobile v3.dc.html`, not from the README. These are **not rulings**. Nothing
below has been decided, and no fix is proposed in any of them. They are
numbered O1 to O3 so they never collide with the ruling numbers above.

Method note that limits all three: the prototype's `sc-if` blocks need a
runtime that does not resolve over `file://`, so the phone element renders
empty and the screens could not be clicked through live. Every line and value
cited is read from the markup and the logic class in that file, which is where
the screens are defined. What could not be done is watch a transition happen.

| # | Item | Kind | Build step |
|---|---|---|---|
| O1 | The Ledger footer states no wrap time | Design bug | Step 2, the Ledger |
| O2 | Evening Wrap and Search render with no tab bar | Design bug | Step 1 nav shell, surfacing on steps 7 and 9 |
| O3 | The Ledger has no time-of-day state | Open design question | Step 2, the Ledger |

### O1. The Ledger footer states no wrap time. Design bug, not a decision.

The handoff README, "The return trigger, without push", item 3: "Each session
states its next event. The brief closes with the wrap time; the wrap closes
with tomorrow's macro print and the brief time."

Half of that is not in the prototype. Tags stripped across the whole Ledger
block, lines 257 to 468, return no wrap time anywhere, at the foot or
elsewhere. The Ledger tail ends on past entries, "41 entries before this",
"Write your own call", and "The desk grades itself too".

The only reference to the wrap anywhere in the Ledger is a navigation control
on the date rule at line 365, which states no time:

```html
<span onClick="{{ goEvening }}" tabindex="0" role="button"
      style="min-height:44px;...text-decoration:underline;...">Evening wrap</span>
```

The wrap side does carry its half, at line 2402, as plain text with no handler:
"Tomorrow: July CPI at 8:30, then the brief at 6:45. Nothing of yours settles
until Aug 27."

So the pairing the README describes is inverted and asymmetric in both
directions at once: the Ledger has a link and no time, the wrap has a time and
no link. Recorded as a defect in the design against its own stated commitment,
not as a choice someone made.

### O2. Evening Wrap and Search render with no tab bar. Design bug.

The logic class gates the nav on a four-item list, line 3460:

```js
showNav: ['dash', 'ledger', 'watch', 'ask'].includes(s.screen),
```

`evening` and `search` are not in it, so both surfaces render full screen with
no bottom bar and no pole lit. This is a property of the design, and the
navigation shell built in PR #619 reproduces it faithfully rather than
introducing it.

Consequences visible in the file, stated as findings only:

- Evening Wrap has exactly three entry points. `goEvening` appears at line 365
  (the Ledger date rule), line 1415 (a result row inside Search), and line 2652
  (the dev strip, outside the phone frame).
- Its only in-surface exit is a single control in the masthead under the
  wordmark, line 2336, `Ledger →` at 44px. The `wrapNone` empty state offers a
  different one, "Open your record", line 2328.
- The second entry point inherits the same gap, since Search has no pole
  either. The only path to the wrap that does not start on the Ledger is Ask,
  then Ask browse, then Search, then the wrap.
- README's navigation model resolves nine desktop surfaces into four poles and
  assigns Evening Wrap to none of them. That is consistent with `showNav` and
  inconsistent with the wrap being a twice-daily destination.

### O3. The Ledger has no time-of-day state. Open design question, no answer in the prototype.

At 6pm the home surface shows a morning brief with nothing to indicate the day
has ended. The prototype cannot say what it should show, because it never
depicts that moment.

Evidence:

- `screen` is a single string in one flat state object, so opening the wrap
  replaces the Ledger outright. Nothing merges and nothing is layered.
- The Ledger's nested conditionals are `briefLoading`, `briefError`,
  `briefNone`, `briefStale`, `briefReady`, `committed`, `notCommitted`,
  `commitFailed`, `pulseOpen`, `openExpanded` and `statLoading`. Every one is a
  load state or a commit state. None is time-of-day.
- The state object has no `closed`, `afterClose`, `sessionClosed`, `timeOfDay`
  or `postClose` key. The 20 occurrences of "closed" in the file are all copy,
  such as "EA closed" and "closes under 4.50%".
- The per-screen status bar clock at line 3234 is the clearest evidence:

```js
{ ...dash: '6:52', evening: '16:41', desk: '20:14', record: '21:04', ... }[s.screen] || '6:52'
```

  `evening` is depicted at 16:41. **`ledger` has no entry at all**, so it falls
  through to the `6:52` morning default. The prototype only ever draws the
  Ledger in the morning.

`briefStale` is the nearest existing state and is not the same thing. It covers
reading yesterday's brief, which is a publication-age condition, not the
session having closed while today's brief is still current. Whether those are
one state or two is part of what is open here.

Left open deliberately. No fix proposed, and the answer is not derivable from
the prototype.

## Standing constraints

- Not every number is a claim. A relevance score orders what to read first. An
  accuracy figure asserts how often the product was right. Only the second is a
  compliance question, which is why ruling 8 landed where it did.
- The prototype's story anatomy is "a sentiment pill, the ticker, the sector,
  and source with elapsed time on one line", with no slot for the badge. Under
  ruling 8 that is now a **deviation from production, not the target**. Flagged
  as an open item in `design_handoff_signalera_mobile/github.md` and
  deliberately unresolved. The badge has to survive the rebuild, so the design
  owes a slot for it before the Ledger card is written.
- Ruling 1's column rename is a migration. Per `CLAUDE.md`, agents do not apply
  migrations. That PR ships with the migration written and unapplied.
- Ruling 10 is the second entry, after ruling 8, where the design carries the
  deviation rather than the code. Both readings are worth keeping together: a
  measurement that fails an accessibility floor is not a style preference, and
  the design does not get to overrule it by having been drawn first. The
  contrast figures above are `getComputedStyle` values off the rendered
  prototype and the rendered build, taken through `scripts/parity_harness.py`
  and `scripts/screen-audit.mjs parity`, not transcribed from either document.
- The `--pill-*` token conflict surfaced by the same parity run is **open and
  deliberately unruled**. `SentimentPill` is a shared component and its values
  differ from the design's in both themes, so restyling it from a screen PR
  would change every surface that uses it. It needs its own decision.

## Order of work

1. ~~Ruling 8, remove the SIGNAL badge.~~ **Reversed.** The badge stays. The
   PR that removed it was closed unmerged and nothing shipped. What is left is
   a design deviation to resolve, not code to write.
2. Rulings 3, 4, 5, 6, the copy adoptions.
3. Ruling 1, frontend only.
4. Ruling 9, the retoken.
5. Ruling 1 follow-up, the column rename with an unapplied migration.
6. Rulings 2 and 7a, both ruled to ship now rather than wait for a step.
7. Ruling 7b, unscheduled.

## Revisions

Ruling 8 was first recorded as "remove the numeric badge from all five
surfaces" and implemented. It was reversed before merge: a SIGNAL score is a
relevance score, not an accuracy figure, and the compliance rule reaches claims
about accuracy rather than editorial ranking. The removal PR was closed
unmerged. Every other ruling, and both build-order corrections above, stand as
originally recorded.
