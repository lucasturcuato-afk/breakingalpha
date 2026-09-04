# A coverage ratio without its denominator is not a number, and the served denominator is the one that counts

Date: 2026-09-03
Ruled by: Noah

**Every coverage figure, percentage or before-and-after count states the
population it is measured over, in the same sentence.** A figure that does not is
not admissible in a PR body, a report or a checkpoint. Where more than one
denominator is defensible, quote the one the product actually serves and name the
others.

This ruling is deliberately written without its own numbers. The repo is public and
corpus totals do not belong in it, and the argument never needed them: what makes a
coverage claim checkable is the **named population**, not the size of it.

## Why

One sprint asked two questions and produced at least nine defensible answers to
them, spanning more than an order of magnitude, all correct against some
population.

### Question one: what does #806 add to coverage?

Four denominators were in use at once, and they are different populations rather
than different measurements of one:

| denominator | what it is |
|---|---|
| the recruiting universe file `universe_scored.jsonl` | a static file, authored for a different purpose |
| the coverage-plausible subset | `corporate_public` plus `bank_other` plus `bulge_bracket` plus `elite_boutique` within that file |
| distinct typed names `/company/[id]` actually serves | after `canonicalize -> slugify -> slugToCompanyName` |
| prod `companies` rows | the pages the product serves |

The same change is a large gain against the universe file and a much smaller one
against the coverage-plausible subset, because most of the difference is buy-side
and private names **the sprint itself had already classified as not a plausible
coverage target**. And the universe file's names collapse onto fewer distinct
pages, because it counts `Vanguard` and `Vanguard Group`, `Clearlake Capital` and
`Clearlake Capital Group`, `Arch Capital` and `Arch Capital Group` as separate wins
on one page each.

The served-versus-static split is the sharpest instance, because it flipped a
verdict rather than a percentage. Track E's headline was "newly wrong: ZERO",
hand-adjudicated. Replayed over both populations with the real `resolveCompanyCik`:

```
recruiting universe (their denominator)   ZERO moved, none lost
prod companies.name slugs (served)        exactly one moved, none lost
```

The zero reproduces on their denominator and breaks on the served one. **The single
moved row is `/company/agi`**, whose Financials tab goes from populated to empty.
One row is not a large regression. It is a falsified headline, which is a different
thing, and it is the reason the served denominator is the one that counts.

### Question two: how many companies render the empty brief?

Five defensible answers to one question, all measured on the same day, and the
ordering is the finding. From smallest to largest:

| answer | meaning |
|---|---|
| the reported URL alone | what a fix validated only on the bug report would claim |
| reachable by a slug the app builds **and** showing the defect to a reader today | the user-facing count |
| every head rendering the defect, including heads no built link reaches | adds `Google`, `ASTS`, `ORCL` and others |
| the builder's count, on its own population definition | a fourth population, undeclared |
| structurally blacked out | the rest have no articles in the window right now, so they are not yet observably wrong |

The largest of those is more than an order of magnitude above the smallest. Two
further denominators were quoted in the same discussion without being named: the
companies with a real article pool, and the resolver head count.

Any answer in that range is defensible with the right denominator. **That is
exactly why a report giving one number without naming its denominator is not
verifiable.** The reviewer's before-and-after contract is the model to copy: every
blackout head before and none after, every reader-visible instance before and none
after, every clean head unchanged. Three populations, each named, each with a
before and an after.

### Two adjacent failures in the same family

**A denominator that is a fact about a file, not about the product.** "Absent from
the universe file" was read as "absent from prod". All eight foreign-issuer
exemplars cited on that basis already resolve in prod with a stamped CIK: General
Motors GM/1467858, SAP SAP/1000184, Novo Nordisk NVO/353278, Unilever UL/217410,
Snowflake SNOW/1640147, Cloudflare NET/1477333, Spotify SPOT/1639920, Arm Holdings
ARM/1973239. Several of the eight are domestic 10-K filers. An entire research
track was framed on that conflation.

**An adjudicated bucket selected for correctness.** Of the names a resolver
answered on, a minority were hand-read and the unread majority were precisely the
ones with no corroborating prod row, that is, the least-evidenced answers. The zero
was measured on the corroborated sub-population and asserted over the whole change.
Not circular, and still not a claim about the change.

### Constants restated as fixed, which had drifted

Two corpus constants were carried across several briefs as hard-won facts not to be
rediscovered. Both had moved, and a ratio built on them moved with them. Neither is
quoted here, for the reason at the top of this file, and the lesson does not need
them: **a constant restated without its measurement date is a claim about a table
that changes daily.**

What made the drift trustworthy rather than suspect was a control set: the same
pull reconciled exactly against a small group of independently known values before
it derived anything new. **Keep a small reconciliation set that every agent
re-derives before it derives anything else**, and put every constant that gets
restated into it. The two stale constants were simply not in it.

**One candidate control was tried for that set and withdrawn.** A bare-ticker tag
total was measured three times, carefully, and gave three answers whose
disagreement was definitional rather than drift. It is not in the reconciliation
set and it is not quoted anywhere in this directory. See
`decisions/bare-ticker-tags-are-the-norm.md`. A control that cannot be defined
precisely enough for two people to reproduce is not a control.

## What would change the answer

**Nothing about the rule.** It costs one clause per sentence.

**The served denominator moves, and that is the point of dating it.** It grew
during this sprint, and it has drifted again since this ruling was drafted, which
is exactly what the ruling predicted. That is a reason to date a denominator, not a
reason to prefer a static file that never moves and never described the product.

**The served-slug versus prod-row gap is itself a finding worth revisiting.** Some
prod rows have no distinct served slug, which is duplicate mints and canonicalize
collisions. If the mint dedupe lands, the two populations converge and one of them
can be dropped.
