# A bare-ticker `primary_company` tag is the norm and usually correct, and the defect is read-side code that fails to match it

Date: 2026-09-03
Ruled by: Noah

**Stop treating a bare-ticker `primary_company` value as evidence of
contamination.** It is the normal shape of a correct tag: **11,458 such tags across
971 names**, reproduced exactly by two independent pulls. Any repair, filter or
metric keyed on "the tag is a bare ticker" is keyed on the wrong signal. The real
defect is on the read side, where matching code does not recognise the form.

## Why

### The framing that was wrong, and the measurement that corrected it

The prior framing was right about provenance and wrong about implication. A
bare-ticker tag does come from the ticker fold. It is also, overwhelmingly, the
right answer:

```
'Raytheon'        300 tagged, 176 with primary_company = 'RTX'
    "RTX Golden Dome Role Puts Valuation And Defense Exposure In Focus"
    "RTX Board of Directors Increases Quarterly Cash Dividend"
'General Motors'  300 tagged,  65 with primary_company = 'GM'
    "Why GM stock is rising even though the car industry is shrinking"
```

Those are correct tags on correct articles. A rule that removes them destroys the
product.

**The working discriminator is the title**, plus the fingerprint that a true
cross-wire lives in a single-element `companies[]` array. Not the tag form.

### What a symptom-only rule costs, measured

A rule keyed on the bare-ticker shape reaches **1,893 tags**, and the 1,428-tag
excess over the evidence-bounded set is **correct co-mentions**: `AMD -> Nvidia`
38, `RTX -> Pratt & Whitney` 12, and a long tail of subsidiaries. Held out as a
test case rather than shipped.

The naive title-based version of the same idea is worse and it looks convincing.
It reports that 7,264 of 8,420 shielded tags, 86.3 percent, are "wrong". It is
nonsense: `RTX -> Raytheon`, `GM -> General Motors` and
`ADP -> Automatic Data Processing` all fail a title test and are all correct. Two
separate reviewers built that measurement, saw the output, and discarded it
unprompted. **Record it here so a third does not build it a fourth time.**

### The real population, keyed on evidence rather than shape

The repair that shipped as PR #811 keys on the fold's own recorded output in
`articles_companies_backfill`, matched on the exact `(primary_company, name)`
pair, then applies three refusals. Survivors: **43 pairs, 465 articles**. Over-reach
proof, independently reproduced against live prod:

```
HP Inc.     104 -> 104   ZERO removed
HP Inc      187 -> 187   ZERO removed   <- the adjacent-name trap row
Vanguard     70 ->  67
ARK Invest   49 ->  47
Revolut      71 ->  16
RTX -> Raytheon, GM -> General Motors, TSLA -> Tesla   ALL SPARED
```

All 465 removals were tested against an independent title test by an adversarial
reviewer who then hand-read the 10 edge cases: **0 correct tags removed.** The
claim held under attack.

### The exception, measured non-circularly

A minority of bare-ticker tags are wrong, and the way to find them is **not** the
tag form and **not** `companies.ticker`. Compared against the SEC's own
`company_tickers.json` with every disagreement hand-adjudicated, **13 prod rows
genuinely hold a ticker the SEC assigns to a different company**:

```
COHR -> 'Cohere'             31 tags   SEC: COHR = COHERENT CORP.
BBBY -> 'Bed Bath & Beyond'  23        SEC: BBBY = NEIGHBORHOOD INTELLIGENCE, INC.
PAYX -> 'YC'                 17        SEC: PAYX = PAYCHEX INC
CMTG -> 'Claro'              17        SEC: CMTG = Claros Mortgage Trust, Inc.
ALMU -> 'Luma'               16        SEC: ALMU = Aeluma, Inc.
BIRD -> 'Allbirds'           11        SEC: BIRD = Smartbird, Inc.
HXL  -> 'Excel'              10        SEC: HXL  = HEXCEL CORP /DE/
CLFD -> 'Learfield'           9        SEC: CLFD = Clearfield, Inc.
NOVT -> 'Vanta'               8        SEC: NOVT = NOVANTA INC
EHC  -> 'Compass Inc.'        7        SEC: EHC  = Encompass Health Corp
KVUE -> 'Envu'                6        SEC: KVUE = Kenvue Inc.
ASPC -> 'Alpha Capital'       6        SEC: ASPC = ASPAC III Acquisition Corp.
MOV  -> 'MOVA'                4        SEC: MOV  = MOVADO GROUP INC
```

Plus `PGIM`, whose row holds ticker `GHY`, a closed-end fund PGIM manages, which
also collides with GHY listings on ASX, NEWCONNECT and SGX.

**~175 tags across 14 rows.** That is 2.1 percent of the shielded tags, not 86
percent. It is the honest number and it is the one to act on.

### Where the read side actually fails

Two distinct read-side gaps, both measured, neither about the tags:

1. **The empty brief.** `matchesCanonical` canonicalizes the article side and not
   the target side, so 33 resolver heads cannot match their own name. Live on main.
   See `decisions/two-paths-one-guard.md`.
2. **The bare-ticker recall gap, separate and smaller.** `getCompanyVariants`
   never emits the bare ticker, so the database filter never selects on it and
   those rows never reach the matcher at all. **28 companies, 133 articles in the
   30-day window.** Not fixed by the empty-brief repair, and explicitly not the
   same defect.

Note the prediction that failed, because it is the reason this ruling exists:
"the affected companies will be the ones whose dominant tag is a bare ticker" was
**0 of 18**. Not one company rendering the empty brief had a bare ticker
outnumbering its name variants.

## What would change the answer

**Nothing about the tags.** The 11,458 / 971 figure reproduces exactly across
independent pulls and the co-mention evidence is publisher-authored.

**The 14-row exception list is a snapshot** and will drift as rows are minted and
corrected. Re-derive it against `company_tickers.json` before acting, and hand
adjudicate, because a token matcher false-positives on `Raytheon`/`RTX Corp`,
`Moody's`/`MOODYS CORP`, `McDonald's`/`MCDONALDS CORP` and
`SpaceX`/`SPACE EXPLORATION TECHNOLOGIES`.

**One predicate would retire the circular half of the repair.**
`row-still-holds-ticker` currently spares a pair when `companies.ticker` equals the
stamp, which reads the field under test as proof the test passed. It should
require that the row's ticker also agrees with an independent symbol registry.
