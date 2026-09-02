# The commit note is required when authoring and optional when adopting

Date: 2026-08-30
Ruled by: Noah

The commit sheet keeps the note field and drops the twelve-character gate on
the adopt path. Compose keeps the gate, unchanged.

**This is a reversal.** It overturns the second half of `DECISIONS.md`
**ruling 11, "the two consequences that need owners"**, which reads: *"Requiring
a note will lower adoption conversion. That is intended. A gate that costs
nothing is not a gate. The point is that adopting a call should require saying
why, and some people will decline, which is the feature working, not failing."*

That half no longer applies to adopting. It is recorded here as reversed rather
than quietly stopped being true, so a later reader who finds ruling 11 in the
history does not restore the gate from it.

**The first half of ruling 11 is untouched and still stands.** Claims adopted
before 2026-08-25 have a permanently null note, cannot be backfilled, must read
as history rather than as a missing value, and must never fall back to
`created_at`. Nothing here weakens any of that. See "What this makes more
important", below.

## Why

Compose is the reader making a claim, and the note is the claim's reasoning.
There is no claim without it, so it is required there.

Adopting is agreeing with a call the desk already reasoned about. Requiring a
restatement at that moment taxes the product they paid for, and it makes
considered notes indistinguishable from ones typed to clear a gate. A field
that anyone can satisfy with twelve characters of nothing does not raise the
quality of the record; it raises the count of rows carrying twelve characters
of nothing, and then Review reads those back as if they were reasoning.

**The scope is client-side, and that was verified rather than assumed.**
`/api/radar/claims/adopt` and `/api/radar/claims` both accept a note and
require neither its presence nor its length. Each trims, caps at
`COMMIT_NOTE_MAX`, and stores null for anything empty; the adopt route's header
already stated "commit_note is ACCEPTED and NOT REQUIRED" before this ruling.
No route, no migration and no column constraint changes.

**Ruling 11 asked for a measurement that was never taken.** It said the
conversion cost should be measured "once anyone outside the founder accounts is
adopting calls", and compared against the pre-gate rate. That has not happened:
on 2026-08-29 the whole `user_claims` table held 18 rows across every account,
one of them carrying a `commit_note`. So this reversal is decided on the
argument above and not on a conversion number, and it should not be described
as a measured result later.

## What this makes more important

Review now reads back a null note on entries the reader was **deliberately not
asked** for one on, not only on entries that predate the column.

The treatment `NoteBlock` already carries covers this without a new string, and
that was checked rather than assumed. `src/lib/review-data.ts` splits a null
note on `created_at < 2026-08-25`, so an entry adopted today with no note is
`predatesNotes: false` and renders "Nothing was written with this call." under
the eyebrow "NO NOTE ON THIS CALL". The history sentence, which names the date
commit notes began, is reached only by rows that genuinely predate it and would
be false on an entry adopted yesterday. **Reused as is, and the two causes keep
the two strings they already had.**

The note field is now the only thing standing between an entry and that
absence, so the sheet has to make it read as wanted rather than as leftover.
The hint under an empty field says what the note is for and asks for nothing:
"A sentence is what you will read back."

## What would change the answer

Two things, and only these.

1. **Evidence that unrequired notes are not written.** If adopted entries land
   overwhelmingly with null notes once real accounts are adopting, the field is
   decorative and the question reopens. The right answer then is probably still
   not this gate, because ruling 11's cost argument survives the reversal
   intact, but the question is genuinely open again. This is the measurement
   ruling 11 asked for and never got, and it is the same one.
2. **A column constraint that requires the note.** `sql/proposals/0033` writes
   `length(btrim(commit_note)) > 0` as a check on a value that is allowed to be
   null. If that ever becomes NOT NULL, this ruling is unenforceable and the
   client is not where it would be argued.

Nothing else. In particular, a surface being new is not a reason to re-derive
this: a surface that adopts inherits the answer.

## Not covered by this change

Desktop `/radar/calls` (`src/components/calls/TrackCallControl.tsx`) adopts and
still gates on twelve characters. The ruling reaches it and this branch does not
touch it, because `/radar` was fenced off for other work in flight. It is the
one surface left to follow, and it is recorded here rather than left for someone
to find as an inconsistency.

**Followed through 2026-09-02.** The paragraph above is kept as written because
it is the record of what this branch did and did not do. It is no longer
outstanding, and its scope was one surface short of the truth: the shared
control it names serves THREE desk surfaces, not one. `/radar/calls` rendered no
note field at all; the morning brief and the evening wrap, wired by PR #694
through `BriefCallsSection`, were the two that actually gated. All three now
carry the field with no gate, applying `noteSatisfiesGate(_, "adopted")` from
this ruling's own module rather than a fourth copy of the rule. Compose is
unchanged in behaviour and now reads its half from the same function.

`DECISIONS.md` ruling 11 carries an in-place amendment quoting its reversed
half, so a reader who lands there rather than here cannot read it as current.
