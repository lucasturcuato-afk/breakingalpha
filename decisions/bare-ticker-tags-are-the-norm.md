# A bare-ticker `primary_company` tag is the norm and usually correct, and the defect is read-side code that fails to match it

Date: 2026-09-03
Ruled by: Noah

**Stop treating a bare-ticker `primary_company` value as evidence of
contamination.** It is the normal shape of a correct tag, and it is the majority
shape. Any repair, filter or metric keyed on "the tag is a bare ticker" is keyed on
the wrong signal. The real defect is on the read side, where matching code does not
recognise the form.

## Why

### The framing that was wrong, and the evidence that corrected it

The prior framing was right about provenance and wrong about implication. A
bare-ticker tag does come from the ticker fold. It is also, overwhelmingly, the
right answer. Publisher-authored headlines carry the ticker as the company's name:

```
'Raytheon',       most of the pool tagged 'RTX'
    "RTX Golden Dome Role Puts Valuation And Defense Exposure In Focus"
    "RTX Board of Directors Increases Quarterly Cash Dividend"
'General Motors', a large minority tagged 'GM'
    "Why GM stock is rising even though the car industry is shrinking"
```

Those are correct tags on correct articles. A rule that removes them destroys the
product.

**The working discriminator is the title**, plus the fingerprint that a true
cross-wire lives in a single-element `companies[]` array. Not the tag form.

### There is no corpus control for this, and there will not be one

An earlier draft of this ruling led with a tag-and-name total, presented as
reproduced exactly by two independent pulls. **That control is retired. It is not
replaced.**

Three careful measurements were made of the same quantity and they gave three
answers. The disagreement was definitional rather than drift: each sweep defined
"bare ticker" differently, over a different set of ticker shapes, and the shape of
the disagreement proves it. The measurement with the **larger** tag count returned
the **smaller** name count, which drift cannot produce and a different predicate
can. A quantity that moves in opposite directions on two axes at once is not one
quantity being measured three times.

So this ruling makes no claim about how many such tags exist. It claims the shape:
**most current `primary_company` values that look like a bare ticker are correct
tags**, and that claim survives without a total, because the evidence for it is the
co-mention headlines above and the hand adjudication below rather than a count.

**Do not put a fourth number here.** If a future reader wants one, the first
deliverable is a written definition of "bare ticker" that a second person can
implement and reproduce. Without that the number is not a measurement.

### What a symptom-only rule costs

A rule keyed on the bare-ticker shape reaches well beyond the evidence-bounded set,
and the excess is **correct co-mentions**: `AMD -> Nvidia`, `RTX -> Pratt &
Whitney`, and a long tail of subsidiaries. Held out as a test case rather than
shipped.

The naive title-based version of the same idea is worse and it looks convincing.
It reports that the overwhelming majority of shielded tags are "wrong". It is
nonsense: `RTX -> Raytheon`, `GM -> General Motors` and
`ADP -> Automatic Data Processing` all fail a title test and are all correct. Two
separate reviewers built that measurement, saw the output, and discarded it
unprompted. **Record it here so a third does not build it a fourth time.**

### The real population, keyed on evidence rather than shape

The repair that shipped as PR #811 keys on the fold's own recorded output in
`articles_companies_backfill`, matched on the exact `(primary_company, name)`
pair, then applies three refusals. Over-reach proof, independently reproduced
against live prod:

```
HP Inc.     UNCHANGED
HP Inc      UNCHANGED   <- the adjacent-name trap row
Vanguard    trimmed slightly
ARK Invest  trimmed slightly
Revolut     trimmed heavily
RTX -> Raytheon, GM -> General Motors, TSLA -> Tesla   ALL SPARED
```

Every removal was tested against an independent title test by an adversarial
reviewer who then hand-read the edge cases: **zero correct tags removed.** The
claim held under attack.

### The exception, measured non-circularly

A minority of bare-ticker tags are wrong, and the way to find them is **not** the
tag form and **not** `companies.ticker`. Compared against the SEC's own
`company_tickers.json` with every disagreement hand-adjudicated, these prod rows
genuinely hold a ticker the SEC assigns to a different company:

```
COHR -> 'Cohere'              SEC: COHR = COHERENT CORP.
BBBY -> 'Bed Bath & Beyond'   SEC: BBBY = NEIGHBORHOOD INTELLIGENCE, INC.
PAYX -> 'YC'                  SEC: PAYX = PAYCHEX INC
CMTG -> 'Claro'               SEC: CMTG = Claros Mortgage Trust, Inc.
ALMU -> 'Luma'                SEC: ALMU = Aeluma, Inc.
BIRD -> 'Allbirds'            SEC: BIRD = Smartbird, Inc.
HXL  -> 'Excel'               SEC: HXL  = HEXCEL CORP /DE/
CLFD -> 'Learfield'           SEC: CLFD = Clearfield, Inc.
NOVT -> 'Vanta'               SEC: NOVT = NOVANTA INC
EHC  -> 'Compass Inc.'        SEC: EHC  = Encompass Health Corp
KVUE -> 'Envu'                SEC: KVUE = Kenvue Inc.
ASPC -> 'Alpha Capital'       SEC: ASPC = ASPAC III Acquisition Corp.
MOV  -> 'MOVA'                SEC: MOV  = MOVADO GROUP INC
```

Plus `PGIM`, whose row holds ticker `GHY`, a closed-end fund PGIM manages, which
also collides with GHY listings on ASX, NEWCONNECT and SGX.

**That is a small minority of the shielded tags, not most of them.** It is the
honest shape and it is the one to act on. The right-hand column is public SEC data
and every line of it was independently re-derived and confirmed by a reviewer.

### Where the read side actually fails

Two distinct read-side gaps, both measured, neither about the tags:

1. **The empty brief.** `matchesCanonical` canonicalized the article side and not
   the target side, so a name could not match its own article tags. **Fixed by
   #816**, merged as `085d0eee`; the corrected predicate is at
   `src/lib/company-intel.ts:685` on `main` and returns true for a name against
   itself. Do not cite it as live. See `decisions/two-paths-one-guard.md`.
2. **The bare-ticker recall gap, separate and smaller, and still open.**
   `getCompanyVariants` never emits the bare ticker, so the database filter never
   selects on it and those rows never reach the matcher at all. This is a different
   defect from the empty brief, it was not fixed by #816, and it affects a small
   set of companies. Explicitly not the same defect.

Note the prediction that failed, because it is the reason this ruling exists:
"the affected companies will be the ones whose dominant tag is a bare ticker" was
true for **not one of them**. Not a single company rendering the empty brief had a
bare ticker outnumbering its name variants.

## What would change the answer

**Nothing about the tags.** The substantive claim rests on publisher-authored
co-mention headlines and on hand adjudication against `company_tickers.json`, and
neither of those needs a corpus total to stand up.

**The exception list is a snapshot** and will drift as rows are minted and
corrected. Re-derive it against `company_tickers.json` before acting, and hand
adjudicate, because a token matcher false-positives on `Raytheon`/`RTX Corp`,
`Moody's`/`MOODYS CORP`, `McDonald's`/`MCDONALDS CORP` and
`SpaceX`/`SPACE EXPLORATION TECHNOLOGIES`.

**A reproducible definition would reopen the counting question, and only that.**
Not a fourth sweep. A written predicate, agreed before the query is run, that two
people implement separately and reconcile. Until that exists, quote the shape.

**One predicate would retire the circular half of the repair.**
`row-still-holds-ticker` currently spares a pair when `companies.ticker` equals the
stamp, which reads the field under test as proof the test passed. It should
require that the row's ticker also agrees with an independent symbol registry.
