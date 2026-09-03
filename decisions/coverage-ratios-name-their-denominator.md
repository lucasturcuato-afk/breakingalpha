# A coverage ratio without its denominator is not a number, and the served denominator is the one that counts

Date: 2026-09-03
Ruled by: Noah

**Every coverage figure, percentage or before-and-after count states the
population it is measured over, in the same sentence.** A figure that does not is
not admissible in a PR body, a report or a checkpoint. Where more than one
denominator is defensible, quote the one the product actually serves and name the
others.

## Why

One sprint asked two questions and produced at least nine defensible answers to
them, spanning more than an order of magnitude, all correct against some
population.

### Question one: what does #806 add to coverage?

| denominator | what it is | before | after | rate |
|---|---|---:|---:|---|
| **2,869** | the recruiting universe file `universe_scored.jsonl` | 280 | 383 | 9.8% -> **13.4%** |
| **917** | the coverage-plausible subset (`corporate_public` 678 + `bank_other` 168 + `bulge_bracket` 38 + `elite_boutique` 33) | 222 | 248 | 24.2% -> **27.0%** |
| **4,230** | distinct typed names `/company/[id]` actually serves, after `canonicalize -> slugify -> slugToCompanyName` | n/a | n/a | the resolver-change denominator |
| **4,276** | prod `companies` rows, the pages the product serves | n/a | n/a | **27.3% to 30.0%** |

The same change is **+103** against 2,869 and **+26** against 917, because 77 of
the 103 are buy-side and private names the sprint itself had classified as not a
plausible coverage target. And **383 names collapse to 338 distinct pages**,
because the universe file counts `Vanguard` and `Vanguard Group`,
`Clearlake Capital` and `Clearlake Capital Group`, `Arch Capital` and
`Arch Capital Group` as separate wins on one page each.

The 4,230 versus 2,869 split is the sharpest instance, because it flipped a
verdict rather than a percentage. Track E's headline was "newly wrong: ZERO",
hand-adjudicated. Replayed over both populations with the real `resolveCompanyCik`:

```
recruiting universe (their denominator)  2,869 names   395 changed   0 moved   0 lost
prod companies.name slugs (served)       4,230 names   430 changed   1 moved   0 lost
```

The zero reproduces on their denominator and breaks on the served one. The single
moved row is `/company/agi`, whose Financials tab goes from populated to empty.

### Question two: how many companies render the empty brief?

Five defensible answers to one question, all measured on the same day:

| number | meaning |
|---|---|
| **1** | SoFi alone. What a fix validated only on the reported URL would report. |
| **10** | reachable by a slug the app builds **and** showing the defect to a reader today. The user-facing count. |
| **16** | rendering the defect, including 6 heads no built link reaches (`Google` at 948 mentions, `ASTS` 239, `ORCL` 96). |
| **18** | the builder's count, on its own population definition. |
| **33** | structurally blacked out. The other 17 have no articles in the 14-day window right now, so they are not yet observably wrong. |

Plus **1,535**, the count of companies with a real article pool, which is the
denominator the 18 was quoted against, and **4,264**, the resolver head count.

Any single number between 1 and 33 is defensible with the right denominator.
**That is exactly why a report giving one number without naming its denominator is
not verifiable.** The reviewer's before-and-after contract is the model to copy:
"33 blackout heads before, 0 after; 10 reader-visible before, 0 after; 4,228 clean
heads unchanged."

### Two adjacent failures in the same family

**A denominator that is a fact about a file, not about the product.** "Absent from
the 2,869" was read as "absent from prod". All eight foreign-issuer exemplars
cited on that basis already resolve in prod with a stamped CIK: General Motors
GM/1467858, SAP SAP/1000184, Novo Nordisk NVO/353278, Unilever UL/217410,
Snowflake SNOW/1640147, Cloudflare NET/1477333, Spotify SPOT/1639920, Arm Holdings
ARM/1973239. Three of the eight are domestic 10-K filers. An entire research track
was framed on that conflation.

**An adjudicated bucket selected for correctness.** Of 654 names a resolver
answered on, 160 were hand-read and 494 were not, and the 494 were precisely the
ones with no corroborating prod row, that is, the least-evidenced answers. The zero
was measured on the corroborated sub-population and asserted over the whole change.
Not circular, and still not a claim about the change.

### Two numbers that had drifted while being restated as fixed

`articles` is **199,960**, not 165,802. Bare-ticker `primary_company` is
**18,656**, not 18,365. Both stale figures had been restated across several briefs
as hard-won facts not to be rediscovered. The ratio moves from a claimed 11.1
percent to an actual 9.3 percent.

What makes that drift trustworthy is the control set: the same pull reconciled
exactly on `companies` 4,276 / ticker 900 / sec_cik 774 / description 0, and on the
11,458-tags-across-971-names figure. **Keep a small reconciliation set that every
agent re-derives before it derives anything else**, and put every constant that
gets restated into it.

## What would change the answer

**Nothing about the rule.** It costs one clause per sentence.

**The served denominator is 4,276 today and it moves.** It grew by 16 rows in a
single day during this sprint. That is a reason to date it, not a reason to prefer
a static file.

**The 4,230-versus-4,276 gap is itself a finding worth revisiting.** 46 prod rows
have no distinct served slug, which is duplicate mints and canonicalize collisions.
If the mint dedupe lands, the two numbers converge and one of them can be dropped.
