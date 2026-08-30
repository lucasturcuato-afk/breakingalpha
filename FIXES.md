# Loop fixes

Status: IN PROGRESS. Written incrementally, one section per item. A section
reading PENDING was not complete at the time of the last commit.

Every item records WHAT WAS BROKEN, WHAT CHANGED, PROOF, and RESIDUAL RISK.
Proof is a query result, a test result, or a rendered value, before and after.
A passing build is not proof and is never cited as such.

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

PENDING

## ITEM 4, companies researched

PENDING

## ITEM 5, remaining card defects

PENDING

## ITEM 6, invariants

PENDING

## ITEM 7, loop instrumentation

PENDING

## NEEDS HUMAN VERIFICATION

PENDING
