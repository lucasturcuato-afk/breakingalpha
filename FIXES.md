# Loop fixes

Status: COMPLETE. Every item is marked done, PROPOSED, BLOCKED or PARTIAL, and
carries before-and-after evidence that is not a build result.

Every item records WHAT WAS BROKEN, WHAT CHANGED, PROOF, and RESIDUAL RISK.
Proof is a query result, a test result, or a rendered value, before and after.
A passing build is not proof and is never cited as such.

## ITEM 0, THE POPULATION. Test accounts were inside dim_users.

**Status: FIXED in the unapplied migration. This invalidates and supersedes
several numbers reported elsewhere in this document; each is restated below.**

### THE TWO QUESTIONS, answered

**1. Is the exclusion in the view definition or applied per query?**
**In the view definition.** `dim_users` carries it, and every `internal_kpi_*`
view inherits it by joining through `dim_users`. Nothing is subtracted per
query. So the PLACEMENT was already right.

The MATCHING was not. The predicate was an exact-address `NOT IN`:

```sql
WHERE lower(u.email) NOT IN (
        'noahhanning03@gmail.com',
        'lucasturcuato@gmail.com',
        'claude-agent@signalera.ai'
      )
```

Plus addressing defeats that, because a plus-addressed variant is a different
string.

**2. Do the 7 exclusions include the +e2e account created 2026-08-25?**
**No.** It was inside `dim_users`. Measured:

```
auth.users total                        : 206
excluded by the CURRENT exact-match rule : 7
dim_users                               : 199

PLUS-ADDRESSED variants of an excluded address: 5
   +tag="e2e"        created=2026-08-25 last_sign_in=2026-08-31T00:44:09  IN dim_users: YES
   +tag="tmpl0721"   created=2026-07-22 last_sign_in=2026-07-22T03:21:45  IN dim_users: YES
   +tag="fresh0721"  created=2026-07-21 last_sign_in=2026-07-21T03:53:36  IN dim_users: YES
   +tag="wltest2"    created=2026-07-20 last_sign_in=                     IN dim_users: YES
   +tag="wltest1"    created=2026-07-19 last_sign_in=                     IN dim_users: YES

would be excluded by a CANONICAL rule   : 12
dim_users under a canonical rule        : 194
```

All five were in the population. The `+e2e` sign-in at 00:44:09 today matches
the schedule described.

### ONE CORRECTION TO THE FRAMING I WAS GIVEN

The expectation was that the harness plus a personal account were "144 of
roughly 160 brief opens" and that the corrected 22 was still counting the
personal one. Measured over the window, the split is different in a way that
matters:

```
per-account brief opens, descending (no addresses printed):
    195 events  | in dim_users: YES | PLUS-VARIANT of an excluded address
     12 events  | in dim_users: no  | already-excluded (exact)
      4 events  | in dim_users: YES | real user
      3 events  | in dim_users: YES | real user
      2, 2, 2, 1, 1, 1, 1, 1, 1      | real users
      1 events  | in dim_users: no  | already-excluded (exact)
raw brief-open events, ALL accounts : 227
```

The harness is 195 of 227. The primary personal account contributed 13 across
two rows and **was already correctly excluded**: it is not in `dim_users` and
was never in the 21. So the contamination was the harness alone, not the
personal account. After the harness is excluded, the heaviest remaining real
reader has 4 events.

That does not change the fix, which is needed either way, and it makes the fix
slightly less impactful than expected rather than more.

### THE FIX

Canonical matching in the view definition, not a subtraction of ids:

```sql
WHERE
  (split_part(split_part(lower(u.email), '@', 1), '+', 1)
     || '@' || split_part(lower(u.email), '@', 2))
  NOT IN (
        'noahhanning03@gmail.com',
        'lucasturcuato@gmail.com',
        'claude-agent@signalera.ai'
      )
  AND lower(split_part(u.email, '@', 2)) NOT IN (
        'signalera-internal.com',
        'anthropic-test.local'
      );
```

The local part is truncated at the first `+` before comparing, so the SAME three
literals that already excluded the primaries now also exclude every current and
FUTURE plus variant of each, Lucas's included. **No new address literal is added
to the repository**, which also keeps this inside the no-identifiers-in-files
rule. `CREATE OR REPLACE` is safe here: the column list is unchanged, so the
dependent views are not dropped.

### THE FOUR CARDS, RECOMPUTED

Population goes 199 to 194, tenured 101 to 97.

| Card | Reported before (199) | Corrected (194) |
|---|---|---|
| **Brief opens (7d), deduped** | 21 | **16** |
| **Brief-open days median** | 1 of 7 | **1 of 7** (unchanged) |
| **WAPS, tenured** | 10.9% (11/101) | **11.3%** (11/97) |
| **% with a watchlist, tenured** | 39.6% (40/101) | **41.2%** (40/97) |

Full recompute, both populations, same instant:

```
--- CURRENT exact-match exclusion (dim_users = 199) ---
total_users 199 | tenured 101 | weekly_actives 14 | brief_open_users_7d 12
brief_opens_7d (DEDUPED) 21 | brief_open_days_median_7d 1 of 7
waps_tenured_pct 10.9 (11/101) | waps_active_pct 85.7 (12/14)
watchlist_tenured_pct 39.6 (40/101) | retention_4w_pct 12.0 (12/100)

--- CANONICAL exclusion, plus-addressing stripped (194) ---
total_users 194 | tenured 97 | weekly_actives 13 | brief_open_users_7d 11
brief_opens_7d (DEDUPED) 16 | brief_open_days_median_7d 1 of 7
waps_tenured_pct 11.3 (11/97) | waps_active_pct 84.6 (11/13)
watchlist_tenured_pct 41.2 (40/97) | retention_4w_pct 12.5 (12/96)
```

The raw brief-open figure moves much further than the deduped one: 214 to 19.
That is the dedupe and the exclusion catching the same account from two
directions, which is why both halves were needed.

Note the two percentage cards go UP, not down. Removing test accounts removes
them from the DENOMINATOR too, and they were not opening briefs or holding
watchlists in proportion.

**Companies researched is unaffected**, and stays 57. It is a global count over
`outputs` with no `dim_users` join, so no population change touches it.

### PROOF

Two new invariants, both correctly failing today and both passing after the
migration:

```
FAIL  NEW-a  auth.users minus the CANONICAL exclusion list equals dim_users exactly
        auth_users=206 excluded=12 (by_address=3 by_plus_variant=5 by_domain=4)
        expected=194 dim_users=199 | null_email=0 whitespace_padded=0

FAIL  NEW-c  no plus-addressed variant of an excluded address is inside dim_users
        plus_variants_in_dim_users=5 tags=[e2e, tmpl0721, fresh0721, wltest2, wltest1]
```

NEW-c is the sharp one. NEW-a is a reconciliation and can in principle be
satisfied by two errors cancelling; NEW-c names the exact leak class and reports
the `+tags` rather than the addresses.

### RESIDUAL RISK

Canonical matching handles `+`. It does NOT handle the other Gmail alias forms:
dots in the local part are ignored by Gmail, so a dotted variant of an excluded
address would still get through. I did not add dot-stripping, because it is
correct for Gmail and wrong for most other providers, and applying it to every
domain would silently merge distinct real addresses elsewhere. Measured: zero
dotted variants of the three excluded addresses exist today. NEW-c would not
catch one, which is a known blind spot rather than an oversight.

The harness will keep generating events. Excluding it from `dim_users` stops it
polluting the cards, but its rows stay in `user_events` and still appear in the
instrumentation health table, which is global by design. The new
`pct_outside_dim_users` column is what makes that visible rather than confusing.

## ITEM 1, commit sheet reachability

**Status: NO CHANGE NEEDED. The premise is false. A regression guard ships
instead.**

### WHAT WAS BROKEN

Nothing. `DASH-AUDIT.md` reported that "the commit sheet is unreachable for
every signed-in user", mounted "behind a gate that requires
`user === null && mobileFixtureScreensEnabled()`". **That finding was wrong,
and it was mine.** This run corrects it.

What is actually true in `src/app/ledger/page.tsx`:

```
107	  return (
108	    <AppShell pageTitle="Ledger" mobileFullBleed>
109	      <CommitSheetProvider initialTarget={commitPreview}>
```

The provider mounts inside the plain `return`, unconditionally, for every
reader in every environment. A second unconditional mount is at
`src/app/claim/[id]/page.tsx:72` with `initialTarget={null}`.

The fixture gate sits on `initialTarget` ONLY, which is the forced-open
`?sheet=open` preview target the parity harness and the width audits measure:

```
97	  const commitPreview: CommitTarget | null =
98	    sampleAllowed && sheetRaw === "open" && previewClaim !== null && data !== null
```

The audit conflated "the preview target is gated" with "the sheet is gated".
Those are one identifier apart in the source and produce opposite conclusions
about whether the product works.

A signed-in reader reaches the sheet by tapping a card, through
`useCommitSheet()?.open(target)` at `src/components/ledger/ledger-screen.tsx:215-225`.

### ORIGIN OF THE CONDITION, since the brief asked before changing it

No logged ruling governs it. Eleven term searches across `DECISIONS.md` and all
files in `decisions/` for `sampleAllowed`, `mobileFixtureScreensEnabled`,
`CommitSheetProvider`, signed-out, unauthenticated and related terms return
nothing. The rationale lives in commit bodies and file headers, and it is a
two-step lineage:

- `fede5a46` (PR #670) introduced `mobileFixtureScreensEnabled()` on `/ledger`
  as a production-safety fix, after the route was found serving `LEDGER_FIXTURE`
  to signed-in readers with no gate at all.
- `6fa08bc2` (PR #680) added the `user === null &&` conjunct when the Ledger was
  wired to real data, because a signed-in reader on a dev or preview build could
  otherwise paint `?stage=error` over a brief that had loaded fine.
- `a5203e1d` (PR #686) reused that existing expression for the sheet's preview
  target, so the harness could measure an overlay that otherwise exists only
  after a tap.

So the gate is deliberate, correct, and protecting a real harness path. Nothing
was reversed.

### WHAT CHANGED

`tests/unit/commit-sheet-reachable.test.ts`, a new regression guard. No product
code changed.

The defect the audit imagined is one deleted line away from being real, and it
would fail silently: `useCommitSheet()` returns null outside a provider, and
both consumers degrade quietly by design. `ledger-screen.tsx` passes
`onTrack={undefined}` and the card then renders no control at all; the claim
screen draws no action. No type error, no lint error, no build error, no crash.
The card simply stops offering the action.

Three assertions plus a detector proof:
1. No page gates the provider MOUNT on the fixture gate.
2. Every `useCommitSheet` consumer is rendered by a page that mounts the
   provider. This is the one that catches a third surface added later.
3. The preview target IS still gated, so "fixing" a defect that does not exist
   cannot mean opening the fixture path to real readers.

### PROOF

Not a build result. The guard was mutation-tested: the real defect was
introduced, the test was run, then the change was reverted.

Passing against the shipped tree:

```
✔ the commit sheet provider mounts unconditionally on every page that mounts it
✔ every useCommitSheet consumer is rendered by a page that mounts the provider
✔ the forced-open preview target is still gated to non-production and signed-out
✔ providerMountIsGated detects a gated mount and clears an ungated one
ℹ pass 4   ℹ fail 0
```

Against a mutant that gates the mount, which is exactly the defect the audit
described:

```
MUTANT APPLIED: provider mount gated on sampleAllowed
✖ the commit sheet provider mounts unconditionally on every page that mounts it
✔ every useCommitSheet consumer is rendered by a page that mounts the provider
✔ the forced-open preview target is still gated to non-production and signed-out
✔ providerMountIsGated detects a gated mount and clears an ungated one
ℹ pass 3   ℹ fail 1
```

Revert verified clean: `git diff --stat src/app/ledger/page.tsx` reports 0
changed lines.

Independent corroboration that the signed-in path works end to end, from PR
#686's own measurement rather than from this run: `/api/radar/claims/adopt`
answered 200 with `noteWritten: true`, and the Ledger's "Track this call" count
moved from 7 to 6 while "On your ledger" moved from 1 to 2.

### RESIDUAL RISK

I could not perform a signed-in session myself. `.env.local` and
`e2e/.auth/user.json` are both absent from this worktree, so
`npm run test:e2e` fails at the `setup` project before any spec runs. **Final
confirmation that a signed-in reader on production can open the sheet and write
a row requires a signed-in session on production, and I could not perform it.**
See NEEDS HUMAN VERIFICATION.

The guard is a source-text test, not a render test. This runner is `node:test`
via `tsx` with no DOM, no jsdom and no React test renderer, so mounting the
provider in a unit test is not possible. A structural test cannot prove the
sheet opens; it proves the provider is above the consumers that open it.

## ITEM 2, note required on adopt

**Status: BLOCKED. Not implemented. It would reverse a ruling dated today.**

### THE CONFLICT

The brief says: "The documented product loop is that a call cannot be tracked
without a note. Restore that. Enforce server side in the adopt route."

`decisions/commit-note-optional-when-adopting.md` rules the opposite. Dated
**2026-08-30**, ruled by Noah, merged as PR #761 in commit `205f0db5` at
19:09 today:

> The commit sheet keeps the note field and drops the twelve-character gate on
> the adopt path. Compose keeps the gate, unchanged.
>
> **This is a reversal.** It overturns the second half of `DECISIONS.md`
> ruling 11 ... That half no longer applies to adopting. **It is recorded here
> as reversed rather than quietly stopped being true, so a later reader who
> finds ruling 11 in the history does not restore the gate from it.**

That last sentence describes this item exactly. The brief's premise, "the
documented product loop is that a call cannot be tracked without a note", is
ruling 11, and ruling 11's note requirement was reversed for adopting today.

The ruling also forecloses the specific mechanism the brief asks for:

> **The scope is client-side, and that was verified rather than assumed.**
> `/api/radar/claims/adopt` and `/api/radar/claims` both accept a note and
> require neither its presence nor its length ... **No route, no migration and
> no column constraint changes.**

And it names the "1 of 18 claims" statistic the brief cites, ruling that it is
not evidence for a gate:

> `user_claims` table held 18 rows across every account, one of them carrying a
> `commit_note`. So this reversal is decided on the argument above and not on a
> conversion number, and it should not be described as a measured result later.

### WHY I STOPPED RATHER THAN PROCEEDED

The setup instruction is "Do not silently reverse a logged ruling", and item 1's
instruction is to proceed only if a ruling "was clearly superseded". This ruling
is not superseded. It is the most recent ruling in the repository, it postdates
the audit that seeded this brief, and it explicitly anticipates being
re-reversed by someone reading the older ruling.

A server-side gate would also be strictly harder to undo than a client-side one:
it would reject writes from the mobile sheet, which the ruling deliberately left
ungated, so the sheet would start failing on submit for anyone who left the note
blank.

### WHAT THE AUDIT GOT WRONG HERE TOO

`DASH-AUDIT.md` attributed the 17 null notes to the commit sheet being
unreachable. That causal claim is void along with item 1's premise. The real
reasons are that the note is optional by ruling, and that the desktop brief path
at `src/components/brief/BriefCallsSection.tsx` posts `commit_note` from its own
gated field rather than through the sheet.

### THE STATE OF THE GATE TODAY, measured

- `src/components/commit/commit-gate.ts:55-57`: `noteRequiredFor(origin)` returns
  `origin === "authored"`. Compose gates, adopt does not. This is the ruling,
  implemented.
- `src/components/commit/commit-target.ts:69`: `COMMIT_NOTE_MIN = 12`.
- `src/components/calls/TrackCallControl.tsx:84-86`: desktop `/radar/calls` DOES
  still gate on twelve characters. The ruling names this as the one surface left
  to follow, and says the ruling reaches it. **So the outstanding work here is
  the OPPOSITE of the brief: desktop should drop its gate to match, not gain a
  server-side one.** I did not make that change either, because it is a product
  decision the ruling flagged rather than scheduled, and reversing the brief's
  direction unattended is not mine to do.

### IF A HUMAN DECIDES TO OVERRIDE THE RULING

The change is small and is written here rather than applied. In
`src/app/api/radar/claims/adopt/route.ts`, after `readCommitNote`:

```ts
// Would enforce ruling 11's gate server side. NOT APPLIED: reversed by
// decisions/commit-note-optional-when-adopting.md on 2026-08-30.
if (origin === "adopted" && (note === null || note.length < COMMIT_NOTE_MIN)) {
  return NextResponse.json(
    { error: "note_required", min: COMMIT_NOTE_MIN },
    { status: 422 },
  );
}
```

What a desktop adopt with no note would then do: the POST returns 422
`note_required`, `BriefCallsSection`'s optimistic row reverts, and the card
returns to its untracked state. The error surface would need copy; the compliant
wording already in the tree is `TRACK_NOTE_GATED_LABEL = "Write your reasoning
first"` at `TrackCallControl.tsx:150`, which uses none of the prohibited
vocabulary. Outcome states are untouched by this item.

### PROOF

No code changed, so there is no before-and-after to show. The evidence is the
ruling itself and its provenance:

```
205f0db52db8332e069098b95559df29b0c0994c
  date:   2026-08-30 19:09:10 -0400
  author: noahhanning
  subj:   The commit note is required when authoring and optional when adopting (#761)
```

Nothing newer touches the note gate. The two later decision commits, `1f553d67`
and `8655899c`, cover the Ask directory and amendments to rulings 19 and 20.

### RESIDUAL RISK

The product loop now has no enforced reasoning requirement on the adopt path by
design, so the record will keep accumulating note-less adopted claims. The
ruling accepts that and names the measurement that would reopen it: whether
adopted entries land overwhelmingly with null notes once accounts outside the
founders' are adopting. That measurement is still not possible; see ITEM 7.

## ITEM 3, brief opens

**Status: DONE at the source, MIGRATION WRITTEN AND UNAPPLIED in the read path.**

### WHAT WAS BROKEN

Both ends. At the source, the emit was guarded only by a `useRef` allocated
inside the component body, which lives exactly as long as one mount. A remount,
a client route re-entry, a second tab or a reload each reset it to null and the
effect fired again. In the read path, `brief_opens_7d` was a raw `count(*)`, so
it counted page mounts and called them opens.

Measured over the window `[2026-08-23T23:39:40Z, 2026-08-30T23:39:40Z)`:

```
RAW event count (dim_users only)                    : 215
DEDUPED distinct (user, briefing, date)             : 22
raw events per opener, descending                   : [195,4,3,3,2,2,1,1,1,1,1,1]
distinct briefing ids per opener, descending        : [5,4,3,2,1,1,1,1,1,1,1,1]
inflation factor                                    : 9.77x
```

One account produced 195 of 215, across 5 distinct briefings. That is not five
briefs read 195 times; it is one component mounting 195 times.

### WHAT CHANGED

**Source**, shipped and live in this branch. `trackClientEvent` gains a `once`
option: a once-per-UTC-day guard keyed per caller-supplied string, scoped
internally by `event_type` so the dotted and legacy names stay paired 1:1.
Backed by `localStorage`, because `sessionStorage` dies with the tab and would
still let every reload and every second tab re-fire. Fails OPEN: a throwing
store emits rather than drops.

Both emit sites now pass `once: briefingId`. The `useRef` stays as a cheap
same-mount short circuit.

**Read path**, in the unapplied migration. `brief_opens_7d` becomes
`count(DISTINCT briefing || ':' || utc_date)`. The card
`brief_opens_per_active` is REMOVED and replaced by
`brief_open_days_median_7d`, median distinct open-days per opener on a 1 to 7
scale.

### PROOF

Not a build result.

**Source guard**, seven assertions over the pure layer, run:

```
✔ the first claim of a key on a day emits, the second does not
✔ a different key on the same day is independent
✔ a new UTC day re-opens the same key
✔ entries older than the retention window are pruned, so the map cannot grow
✔ a corrupted stored value does not wedge telemetry forever
✔ the map is written under one namespaced key
✔ onceDayStamp is UTC, so the key matches the SQL dedupe key
ℹ pass 7   ℹ fail 0
```

**Read path, before and after.** Before, from both live views:

```
internal_kpi_summary       All: brief_opens_7d=215  brief_opens_per_active=15.36
internal_kpi_summary_by_cohort All: brief_opens_7d=215  brief_opens_per_active=15.36
```

After, computed from raw data because the migration is deliberately unapplied:

```
deduped brief_opens_7d                        : 22
deduped opens per active (22 / 14)            : 1.57
median brief-open days per opener, 1 to 7     : 1
days-per-user vector across 12 openers        : [1,1,1,1,1,1,1,1,1,2,3,3]

SUPERSEDED BY ITEM 0. That 22 was computed against a dim_users that still
contained five plus-addressed test accounts, including the e2e harness, which
alone produced 195 of 227 raw opens. Under the corrected population the deduped
figure is 16 across 11 openers. The median stays 1 of 7.
```

Nine of twelve openers opened on exactly one day. The card said 15.36; the
habit is 1 day in 7.

**The invariant that catches this** now fails on the live data and will pass
after the migration:

```
FAIL  R9  no single reader exceeds briefs published per day times a refresh factor
        opens=215 openers=12 top_per_user=[195, 4, 3, 3, 2] max_per_day=27.86
        bound=5.50 (briefs_per_day=1.83 x refresh_factor=3)
```

### RESIDUAL RISK

The source guard is per browser. A reader on two devices still produces two
opens per day, which the read-path dedupe then collapses. That layering is
deliberate: neither half is sufficient alone.

The guard does not retro-correct the 195 historical rows. Those stay in
`user_events`; the read-path dedupe is what stops them inflating the card.

A server-side unique index would be the authoritative third layer, and it is
NOT included. The legacy event names write a NULL `entity_id`, so an index on
that column would silently miss half the rows until the legacy emits carry it.
Recorded as a follow-up rather than half-done.

## ITEM 4, companies researched

**Status: DONE in the unapplied migration. The brief's premise was wrong.**

### WHAT WAS BROKEN

Not capture. **The read expression.**

The card unioned `outputs.source_id` for memo rows with `company_id` from the
regeneration quota. `source_id` is a `uuid` polymorphic pointer to the ORIGIN
record an artifact was generated from, qualified by `source_table`. It is not a
company reference and could never hold one:

```
q.sh "outputs?select=id&source_id=eq.Swvl&limit=1"
{"code":"22P02","message":"invalid input syntax for type uuid: \"Swvl\""}
```

It is NULL on every memo row, so that leg contributed zero and the displayed 5
came entirely from the 6-row quota table.

Meanwhile the company had been persisted the whole time, one key over. The
audit checked `content->>'ticker'` (44 of 143) and missed
`content->>'target_company'`, written by `/api/memo` on every memo it can
resolve:

```
memo rows fetched                : 143
target_company populated         : 89 = 62.2%
source_id populated              : 0  (0.0%)
distinct target_company          : 58
distinct quota company_id        : 5
quota names already in tc        : 5 of 5
```

So the audit's "96.3 percent of research actions never register" was wrong.
Capture is 62.2 percent by row, and the card was reading the wrong column.

### WHAT CHANGED

The card now counts distinct `lower(btrim(content->>'target_company'))` over
memo rows, unioned with the quota table. The quota leg is kept as belt and
braces even though it now adds nothing.

### PROOF

The brief asked for a query showing the event landing rather than a diff. The
honest form of that here is a query showing the DATA landing, because no new
emit was needed and generating a memo would mean a write and a model call,
both of which this run is forbidden.

Before, live:

```
q.sh "internal_kpi_summary?select=distinct_companies_researched&segment_domain=eq.All"
[{"distinct_companies_researched":5}]
```

After, computed from the same rows the corrected expression reads:

```
AFTER, union(target_company, quota) : 58
AFTER, case-insensitive union       : 57
```

**5 becomes 57.** The case-normalized figure is the one that ships; the one-name
gap between 58 and 57 is a casing duplicate that `lower(btrim(...))` merges.

### RESIDUAL RISK

54 of 143 memo rows still carry no company. They are concentrated: all 15
`brief` rows, which legitimately have no single subject company and arguably
should be excluded from this card, and 8 of 10 `thesis` rows.

`lower(btrim(...))` cannot merge suffix variants, so "Visa" and "Visa Inc."
still count as two. Names are stored verbatim on purpose because
`/api/memo-cache` matches them exactly, so normalizing at write time would
break the cache.

The `memo_generated` EVENT payload is still inconsistent across its five emit
sites: the two deal-flow sites send `company`, the trends site sends only
`signal_id`, and both memo modals send only `memo_type` and `title`. That is a
real gap but a secondary one, because the event is a behavioral stream and the
`outputs` row is the canonical record. Follow-up, not done here.

Found in passing and NOT fixed, because it is outside this item: the regenerate
cache invalidation at `src/app/api/memo/route.ts:465-470` deletes with
`.eq("source_id", company)`, a company NAME against a uuid column. It has never
matched a row and its error is never inspected.

## ITEM 5, remaining card defects

**Status: DONE in the unapplied migration and in the page, for every defect the
audit recorded that items 3 and 4 did not cover.**

| Defect | Fix | Before | After |
|---|---|---|---|
| D3 censoring | `window_closed` and `cohort_size_observed` on both cohort views, plus a `censored` marker in both tables | 2026-08-24 row prints "2% activated", "2.0% retention" as measurement; 0 of its 98 members have a closed window, 96 have never fired an event | marked censored, marker driven off `max(created_at) + 7d <= now()` |
| D4 populations | `events_all_real_users` and `pct_outside_dim_users` on instrumentation health, global scope KEPT | page prints "Memos generated 160" beside `memo_generated events_all 264` in identical styling | the 104 gap is labelled and reconciles on the row |
| D5 WAPS denominator | `waps_tenured_pct` and `waps_active_pct`, renamed not redefined | 6.0% over all 199 signups | 10.9% tenured, 85.7% active |
| D6 `thesis_approved` | `never_fired` flag via a FULL OUTER JOIN against a declared roster | invisible: `GROUP BY` over stored rows cannot emit a row for an event that never fired | appears with `never_fired=true`, 0 rows, 7 code references |
| D7 orphaned events | `feeds_no_metric` flag | 1109 of 3082 rows (36.0%) feed nothing, rendered identically to those that do | flagged per row |
| D10 `weeks_since_signup` | measured from `max(created_at)`, the newest member | measured from the Monday of the signup week, overstating up to 199 of 199 depending on the weekday the page loads | cannot overstate |
| D11 rounding | `, 1` added to both activation percentages | 67.2 printed as 67, 51.7 as 52, 16.7 as 17, 33.3 as 33 twice | one decimal, matching every other percentage |
| D12 stale copy | referent computed from `window_closed` | hard-coded "the 2026-04-27 cohort is the reliable read", false as a superlative since 2026-08-24 reached n=98 | computed largest CLOSED cohort, still 2026-04-27 at n=58, but it now follows the data |
| activation lower bound | `first_onb >= created_at` and the `least()` twin | no floor, so a backdated event would count a user as onboarded before they existed | bounded. Latent, 0 violations today, minimum observed gap +31.9 seconds |
| `days_since_last` clock | elapsed seconds, not a date subtraction | two clocks in adjacent columns: a 0.9-hour event could print "1 day ago", and 5.8-hour and 24.0-hour events could print the same number | one clock |

Three defects (D6, D7, D9) could NOT be fixed by correcting any existing card,
because the cards they concern were marked DEFECT: NONE and are arithmetically
right. Each is surfaced as a new column instead. D9 in particular is a
disagreement between two SOURCES (264 memo events against 143 artifacts,
1.846x, disagreeing on 45 of 66 days), so changing 160/0/5 would have been
wrong; it is now an invariant instead, and it fails.

### PROOF: both summary views agree

The brief requires any card change to land in BOTH views and to be proven. The
post-change values cannot be queried, because the migration is deliberately
unapplied, so this is proven two ways.

**Baseline, live, before any change.** 17 of 17 shared metrics agree today:

```
metric                        summary    by_cohort   agree
total_users                       199          199   YES
weekly_actives                     14           14   YES
brief_opens_7d                    215          215   YES
brief_opens_per_active          15.36        15.36   YES
waps_pct                            6            6   YES
watchlist_pct                    20.1         20.1   YES
retention_4w_pct                   12           12   YES
... (17 rows total)
shared metrics compared: 17 | disagreements: 0
```

**Textual, over the migration itself.** Both view bodies were extracted, their
grouping keys normalised to one token, and every metric expression compared:

```
shared metric expressions: 34
byte-identical after normalising the grouping key: 34
MISMATCHES: none
present only in internal_kpi_summary (global, by design): waitlist_count, distinct_companies_researched
```

### RESIDUAL RISK

The Waitlist card cannot be scoped in SQL at all. `public.waitlist` has no
`user_id` column, so it is structurally unjoinable to `dim_users`. Its fix is
rendered copy only, and it remains a genuinely different population rendered in
the same `Stat` component as user counts.

The instrumentation view keeps its global scope deliberately, because its
stated job is whether an event fires at all. The scoped counter sits beside it
rather than replacing it.

## ITEM 6, invariants

**Status: DONE and RUN.**

### WHAT WAS BROKEN

Nine of the twelve existing invariants were true by construction: both sides
were `count(*) FILTER (...)` over the same rows, in one statement, under one
frozen `now()`. No value of any datum could make them fail.

### WHAT CHANGED

`scripts/invariants.mjs`. Thirteen assertions. Every replacement issues its two
sides as SEPARATE requests, because collapsing an assertion into one SQL
statement re-freezes `now()` across both sides and reinstates the exact defect
being removed. Both request timestamps are logged so drift is distinguishable
from logic. Exit contract copied from `scripts/cohort-selftest.mjs`: 0 pass,
1 failed, 2 NOT RUN.

### PROOF, full run pasted

```
13 assertions, 8 passed, 5 failed, 16 HTTP requests
FAILED: A6, R9, R10, R12, 12b
KNOWN live defects, shipped failing on purpose: A6, R9, R10, R12, 12b.
No regressions: every failure above is a known defect.
```

The two required reconciliations both PASS, and neither is a defect:

```
PASS  NEW-a  auth.users minus the exclusion list equals dim_users exactly
        auth_users=206 excluded=7 (by_address=3 by_domain=4) expected=199
        dim_users=199 | null_email=0 whitespace_padded=0

PASS  NEW-b  cohort roster sums to the cohort summary All row
        sum(member_count)=199 All.total_users=199 buckets=1 DEGENERATE: one
        bucket holds every user, so this is equal by circumstance. It becomes a
        real test on the first attributed signup.
```

**206 minus 7 equals 199 EXACTLY.** The 7 decompose as 3 explicit addresses plus
4 domain matches, with zero NULL emails, zero whitespace-padded emails and zero
soft-deleted rows, so none of the four latent hazards is live.

**One NEW defect, found by this suite and not previously recorded:**

```
FAIL  R10  every event-active user in 30d also has a sign-in in 30d
        event_active_30d=18 signed_in_30d=106 active_without_signin=5
```

Five users emitted events in the last 30 days with no sign-in in the same
window. The old assertion compared counts (18 <= 106) and had so much headroom
it would never fire; the set-containment form fires on the first such user.

Assertions that would still be true by construction and are therefore NOT
shipped in that form: the naive R8 (comparing the USC domain count to the view's
own CASE expression re-evaluates the very predicate it audits, so only the regex
form ships), and any replacement collapsed into a single statement.

### RESIDUAL RISK

NEW-b is near-degenerate: one bucket holds all 199 users, so it is equal by
circumstance rather than by construction. A guard prints DEGENERATE on the row.
It becomes a real test on the first attributed signup.

R9's refresh factor of 3 is a judgement call, named as a constant rather than
buried. The verdict is stable for any factor below roughly 9.8.

The suite is wired into no npm script and no CI workflow, matching
`cohort-selftest.mjs`, which has the same gap. Both should be added to CI or
they will not run.

## ITEM 7, loop instrumentation

**Status: PARTIAL. Two of the three required cards are computable and ship. The
third cannot be computed and deliberately does not ship as a number.**

### WHAT WAS BROKEN

The dashboard measures reach, not the loop. `src/app/internal/page.tsx` and
`src/lib/internal-kpis.ts` contain zero references to `claim`, `adopt`,
`outcome` or `record`.

### WHAT CHANGED

**(a) Adoption rate over brief openers.** New view
`internal_kpi_loop_adoption`. Denominator is distinct brief openers in the
window, never all-time signups. An `EXISTS` intersection keeps the numerator a
subset of its denominator, so the card cannot print above 100 percent.

**(b) Resolution view rate. NOT SHIPPED as a view, on purpose.** No event that
has ever fired is a view of a graded record, and all six surfaces that render
one contain no tracking import. A view created now would return a NULL rate
forever, and a card printing 0 percent would be a false statement about reader
behavior rather than a true one about instrumentation. The SQL is written into
the migration as a comment, ready to create once rows exist.

**(c) Return after an adopted call moves to challenged.** New view
`internal_kpi_loop_post_challenge`. CHALLENGED is `verdict = 'wrong'` plus
`attribution = 'clean'`, verified in `src/lib/scored-object-map.ts` (maps to
state "wrong") and `src/lib/verdict-vocabulary.ts` (`RESOLUTION_BY_STATE` maps
"wrong" to "challenged"). No other pair reaches it.

**Denominators that drift downward forever**, both found and both replaced:
WAPS and percent-with-a-watchlist. See item 5.

**Every new card carries** its denominator label, its window as literal UTC
instants (`window_start_utc`, `window_end_utc`), its population filter, and
`computed_at`. The refresh time is `now()` INSIDE the view rather than a
timestamp taken in the page, because `now()` is transaction start time and is
therefore the exact instant every ratio on that row was defined against. The
page makes six separate view reads, so one page-level timestamp would silently
claim they were all as of one moment.

### PROOF

```
ADOPTION RATE OVER BRIEF OPENERS (7d window)
  distinct brief openers (real)  : 12
  of whom adopted (ever)         : 1
  rate                           : 8.3%
  same numerator over all-time signups (the defect this replaces): 0.5%

RETURN AFTER CHALLENGED
  verdict/attribution            : {"partial/clean":1,"ungradable/null":4,
                                    "correct/clean":3,"partial/confounded":1,
                                    "wrong/clean":1}
  CHALLENGED (wrong+clean)       : 1
  later distinct sessions        : 9, all on the SAME UTC day as graded_at
```

### RESIDUAL RISK, and this one matters more than the cards

**Almost every loop card reads n=1.** Only one real user has ever adopted a
call: 15 adopted rows exist but 12 of them and 2 of the 3 adopting users are
founder or test accounts that `dim_users` excludes.

The post-challenge card would print **100 percent from a denominator of 1**,
and all 9 of its "later sessions" fall on the same UTC day as the grading, so
it is measuring tab churn as much as a return. `session_id` is per tab from
`sessionStorage`. The view therefore emits `claims_with_a_later_day` beside
`claims_with_a_later_session`, and the day figure is the honest one.

A rate over a denominator of one is a sentence about one person, and it will be
quoted in a pilot conversation as if it were a rate. Every such card carries its
n on the face for that reason.

The commit-sheet emits for loop steps 4 and 5 are NOT added. They would be
straightforward, but the sheet is reached only by tapping a card on the mobile
Ledger, and adding the emit without first knowing real usage would produce a
card that reads 0 and looks like a product fact.

## NEEDS HUMAN VERIFICATION

Ordered, item 1 first as required.

1. **ITEM 1. That a signed-in reader on PRODUCTION can open the commit sheet
   and write a row.** I could not do this. `.env.local` and `e2e/.auth/user.json`
   are both absent from this worktree, so `npm run test:e2e` fails at the `setup`
   project before any spec runs. My evidence is structural (the provider mounts
   unconditionally, proven by reading the source and by a mutation test) plus PR
   #686's own signed-in measurement from 2026-08-26. Neither is a live check
   today. **This is the top of the list because the audit claimed the opposite
   and I am asserting the audit was wrong.**

2. **ITEM 2, the ruling conflict.** Someone with authority must decide whether
   the note gate is restored. I did not implement it, because
   `decisions/commit-note-optional-when-adopting.md`, ruled today, reverses
   exactly that and warns against restoring it from the older ruling 11. If the
   decision is to restore it, the diff is in item 2 above. If the decision is to
   follow the ruling through, the outstanding work is the OPPOSITE: desktop
   `/radar/calls` still gates on twelve characters at
   `TrackCallControl.tsx:84-86` and the ruling says it should not.

3. **The migration has never been parsed by a server.** Every "after" number in
   this document was computed from raw data in node, not by executing the SQL.
   Two constructs deserve attention on first run: `count(DISTINCT a || b)`,
   which is written as text concatenation because `count(DISTINCT (a, b))` does
   not parse, and `percentile_disc(...) WITHIN GROUP (...) FILTER (...)`, an
   ordered-set aggregate inside a GROUPING SETS query. Run
   `node scripts/invariants.mjs` before and after.

4. **That 5 becoming 57 on Companies researched is the number you want.** It is
   arithmetically right for the expression I wrote, but it includes every memo
   subject, including the 15 market-brief rows that have no single subject
   company. Excluding `memo_type = 'brief'` is a product judgement I did not
   make.

5. **The R10 failure, which is new.** Five users emitted events in 30 days with
   no sign-in in 30 days. I did not root-cause it. The plausible mechanisms are
   a long-lived JWT, or events attributed to a user whose session never
   refreshed. Neither is verified.

6. **Whether the 2026-08-28 batch of 96 users is real signups or an import.**
   Still unresolved from the prior audit. It is 48 percent of the base and it
   dominates every window-sensitive card, including several I just changed the
   denominators of.

7. **That removing `brief_opens_per_active` does not break a consumer I did not
   find.** I grepped and changed the two views, the type and the page. A
   dashboard, notebook or saved query outside this repo would not have been
   found.
