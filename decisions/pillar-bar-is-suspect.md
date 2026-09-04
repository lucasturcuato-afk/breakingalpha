# The 2-of-3 pillar bar is arithmetically closer to 1-of-2, and it stops being quoted as a quality measure

Date: 2026-09-03
Ruled by: Noah

**No number is presented as "clears the 2-of-3 bar" without the NEWS base rate
next to it.** NEWS is true for the overwhelming majority of the population it is
scored over, so the bar it enforces is close to the single test "does a NUMBERS
artifact exist". The metric is not fraudulent and it is not measuring what its name
says.

## Why

Scored end to end over every prod `companies` row on corrected pillar definitions,
from an independent keyset-paginated pull that reconciled exactly against the
control set before deriving anything:

```
P(NEWS)             the overwhelming majority
P(NUMBERS)          a large minority
P(IDENTITY)         a small minority at its ceiling, and near zero at its floor
                    (floor = curated only, ceiling = every ticker resolves)
P(NEWS | NUMBERS)   higher still than P(NEWS)

worth via NUMBERS + NEWS       almost all of it
worth via IDENTITY + NEWS      a small tail
worth via IDENTITY + NUMBERS   a handful
rows with an EMPTY article pool   almost none
```

Over the universe names that resolve to a row, P(NEWS) is higher still.

**A pillar that is true for almost everything carries almost no information.** To
within that small tail, the 2-of-3 bar is the 1-of-1 test "does a NUMBERS artifact
exist".

### The reason is structural and nobody had written it down

**A `companies` row exists because the ingest saw the company in an article.**
Asking whether a company that was created from news has news is close to a
tautology. This is not a bug in the scorer and it cannot be tuned away. It is a
property of how the population is generated, and it means the NEWS pillar can only
ever be near-free on that population.

### This is a different disease from the one that was fixed

The original scorer had two pillars returning True on one boolean
(`tg-scratch/score.py:100-107`, both `numbers_from_ids` and `identity_from_ids`
opening `if ticker: return True`). **That specific coupling is cured.** All nine
branches of the rewritten scorer were traced to the HTTP call or table read that
supplies them and no two pillars share an upstream. NUMBERS now requires a stored
artifact row; IDENTITY requires an executed request that returned prose.

So the pillars no longer share a source. **They fail to be three pillars because
one of them is almost always true.** Fixing the first problem did not touch the
second, and the second is larger.

### Three couplings that survive on the rendered page

The scorer is honest and it measures a section of the page that does not have the
problem. On the page itself:

1. **IDENTITY and the Key Stats grid are one HTTP response.** `PrimerTab.tsx:84`
   issues a single `/api/company-kpis` fetch; `src/lib/yahoo/quoteSummary.ts:15`
   requests `price,summaryDetail,defaultKeyStatistics,financialData,earningsHistory,calendarEvents,assetProfile`
   in one call. `assetProfile.longBusinessSummary` is the identity sentence and the
   other six modules are the entire stats grid. If the crumb auth fails, the v8
   fallback returns price-only and both blocks die together.
2. **The identity sentence a reader sees is model-generated.**
   `PrimerTab.tsx:148` prefers the Gemini rewrite over the source summary, while
   `PrimerBusinessOverview.tsx:8` asserts "both verbatim (no model generation)".
   See `decisions/wikipedia-verbatim-only.md`, including the correction that the
   rewrite is served but never stored.
3. **Both pillars hang off `companies.ticker`.** I2 is gated on the ticker and
   `cluster_cik(row)` falls back to any CIK in the ticker cluster, so a wrong
   symbol fails both together.

### What this cost in this sprint

The headline promotion claimed for #806 is arithmetically real and is a promotion
across a bar that is effectively one pillar. Separately measured, on the promoted
pages themselves: **all but one of them contain no sentence saying what the firm
is.** `companies.description` is NULL on **every** row. Some of the promoted pages
render no descriptive line at all, and most of the rest render a Wikidata label
below the 74-character identity floor. Edward Jones renders the literal words
"wikimedia disambiguation page". On a systematic hand-read sample, **most** pages
rendered something an adversarial reviewer would not use.

A bar that promotes a batch of pages of which all but one cannot say what the
company does is not measuring "worth reading".

## What would change the answer

**A replacement bar has to make NEWS earn its place or drop it.** Two directions,
neither built:

- **Raise the NEWS test above the base rate.** Require something scarcer than pool
  membership: a summarised article, a minimum distinct-source count, a title that
  names the company. On the earlier scorer, requiring a summarised article moved
  the headline by exactly zero, so any candidate must be measured against the base
  rate before adoption, not after.
- **Score NUMBERS and IDENTITY only, and say so.** The honest version of the
  current bar. It would have flagged the all-but-one result before promotion rather
  than after.

**The base rate is re-measured, not assumed.** It is a property of the table on the
day it was scored. If the ingest ever mints rows from a non-news source, the
arithmetic moves and has to be rerun before this ruling is cited again.

**This ruling does not retire the pillar model.** It retires one sentence: "clears
2 of 3" as a standalone quality claim.
