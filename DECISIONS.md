# Rulings on the nine open decisions

Noah ruled all nine on 2026-08-15. This file is the record. The design handoff
at `design_handoff_signalera_mobile/README.md` states the conflicts; this states
what won.

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
| 7b | Risk appetite consumers. Removal from the prompt builders, the API, the Python pipeline and the DB column is **its own workstream**. Does not gate the redesign. | Off the build path. | Not scheduled. 19 consumers mapped in recon. |
| 8 | SIGNAL scores. **Stay.** Not a compliance issue. It is a relevance score, not an accuracy figure. Relevance ranking is editorial judgment, not a claim about accuracy, so it does not fall under the compliance rule. | **Lands on step 2, the Ledger card**, not the nav shell. The Ledger is the anatomy every other card reuses, so the design needs a slot for the badge before that card is written. Also touches steps 5, 9 and 10. | No production change. The design carries the deviation, not the code. |
| 9 | cross-source palette. **Retoken.** One file, no shared surface. | Off the build path, same route as ruling 1. | Queued, own PR. |

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
- Ruling 1's column rename is a migration. Per `CLAUDE.md`, agents do not apply
  migrations. That PR ships with the migration written and unapplied.

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
