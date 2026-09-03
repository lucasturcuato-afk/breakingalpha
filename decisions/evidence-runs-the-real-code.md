# A claim about what code does is produced by running that code, on a named treeish

Date: 2026-09-03
Ruled by: Noah

**Two rules, both cheap, both violated repeatedly in one sprint.**

1. Any number describing a function's behaviour is produced by importing and
   calling the real exported function, and the report carries the command that
   produced it. A hand port is admissible only as a cross-check against the
   executed result, never as the source.
2. Any `file:line` citation carries the treeish it was read on, written
   `path:line@<branch-or-sha>`, and is verified with `git show` before it enters a
   brief.

## Why

### Rule 1: a port of a data-driven function cannot reproduce a data-driven defect

The empty-brief investigation opened with a hand-ported regex model of
`canonicalize()` rather than a call to it. The port reported that 261 of 462 SoFi
tags fail to match, a 56 percent failure rate, with the long forms
`"SoFi Technologies"` and `"SoFi Technologies, Inc."` scored as passing.

Run against the real exported function with `npx tsx`:

```
canonicalize("SoFi Technologies")                          = "SoFi"
matchesCanonical("SoFi Technologies", "SoFi Technologies")  = false
```

**The true figure is 0 pass, 462 fail. A 100 percent blackout, not 56 percent.**
Both reviewers who executed the function reached it independently and immediately.

The mechanism is the general lesson. `canonicalize` consults a lookup table,
`CANONICAL` at `src/lib/company-intel.ts:161-163`, which maps all of `sofi`,
`sofi technologies` and `sofi technologies inc` to the single value `"SoFi"`. **A
port that omits the table models `canonicalize` as approximately the identity
function, and therefore cannot reproduce the defect the table causes.** The wrong
number then propagated into a downstream brief as a premise, along with a
fabricated "gap to zero" that did not exist, because there was no gap: nothing
survived to begin with.

Cost: one brief built on a false premise, one downstream agent sent hunting for a
mechanism that was not there, and a 56-percent framing that understated a live
production defect by a factor of two.

The correct method is one line:

```
npx tsx -e 'import {canonicalize, matchesCanonical} from "./src/lib/company-intel"; console.log(canonicalize("SoFi Technologies"), matchesCanonical("SoFi Technologies","SoFi Technologies"))'
```

### Rule 2: a citation without a treeish is a citation to nothing

Two premises were carried into review briefs as facts about code, and neither
existed on the branch being reviewed. Both were verified as absent afterwards with
`git cat-file -e`, which is the check that should have run before.

| citation as given | where it actually lives | where it was asserted |
|---|---|---|
| `PrimerRegulatoryFilings.tsx:55` | `src/components/company/tabs/primer/PrimerRegulatoryFilings.tsx`, **only** on `feat/adv-13f-numbers` (PR #806, unmerged). Absent from `origin/main`. | quoted as shipped component copy |
| `backend/registry/match.py` and its `GENERIC_WORDS` set | **only** on `feat/adv-13f-numbers`. Absent from `origin/main` **and** absent from `track-e/registry-union`. | given to the reviewer of `track-e/registry-union` as a premise to attack |

The second one cost real work: the reviewer opened its section with
`find . -name match.py` returning nothing and `grep -rn "GENERIC_WORDS"` returning
nothing, and had to write "whichever track owns that file, it is not this one"
before it could proceed. It handled it correctly. It should not have had to.

There is a third, smaller instance worth recording because it is the same class in
the user's own restatement of the finding: the Track E guard gap was described as
`sec-filings.ts` in `src/lib/data-access/`, which is where `aliasResolver.ts`
lives. The file is `src/lib/sec-filings.ts`. The finding is correct and the path
was not, and one `git show` would have caught it.

The verification is two commands and it proves content rather than existence:

```
git cat-file -e <treeish>:<path>            # does it exist there at all
git show <treeish>:<path> | sed -n '<line>p'  # is that line what I think it is
```

### The related failure, same family: constants restated as fixed

`articles 165,802` and `bare-ticker tags 18,365` were restated across several
briefs as hard-won facts not to be rediscovered. Measured independently over 200
keyset pages with a short final page proving termination: **199,960 and 18,656.**
The claimed 11.1 percent ratio is really 9.3 percent.

The fix is not "get the right number", because the table grows daily. It is:
**every constant in a brief carries its measurement date and the query that
produced it**, and the two or three control numbers go into a reconciliation set
that every agent re-derives first and reports before deriving anything else. That
practice already existed here and it worked: the same pulls that found the drift
reconciled exactly on 4,276 / 900 / 774 / 0 and on 11,458 tags across 971 names,
and that exact agreement is what made the drift trustworthy rather than suspect.
The two stale constants were simply not in the reconciliation set.

## What would change the answer

**Nothing.** Both rules cost one command each and both were violated by omission
rather than by any considered trade-off.

**Rule 1 has one legitimate exception**: when the real function cannot be run at
all, for example because it needs credentials the agent is not permitted to hold.
Then the port is stated as a port, in the sentence that reports the number, and the
number is labelled as a model rather than a measurement.
