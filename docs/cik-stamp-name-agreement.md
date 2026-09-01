# Ticker hygiene: gating the author and the amplifier

Measured against prod on 2026-09-01. Base commit `aa555f92`.

All prod access for this work was SELECT-only over PostgREST GET. No rows were
written. The write paths were exercised against the offline `FakeSB` shim in
`backend/tests/test_cik_stamp_name_agreement.py`, loaded with the real prod
snapshot.

## Prod shape

| | count |
|---|---|
| `companies` | 5610 |
| `companies.ticker NOT NULL` | 964 |
| `companies.sec_cik NOT NULL` | 793 |
| `cik_tickers` | 11072 |

## The two defects, and which one is load-bearing

### The author: an ungated ticker write off a fuzzy name search

`finnhub_helper._pick_us_primary` took `primary[0]` from a Finnhub `/search`
response with no check that the candidate had anything to do with the name we
asked about. `/search` is fuzzy and always ranks something first, so rank 1 is
a guess, not a match.

Three call sites shared that behaviour:

* `backend/scripts/backfill_tickers.py` writes the result onto an existing
  row's `ticker`, leaving the row's Gemini-extracted name untouched. This is
  the author of the named cross-wires: the row stays named `Ola` and acquires
  ticker `KO`.
* `backend/entity_resolver.py` mint path, gated to `mention_count >= 2` so it
  is inert for brand-new rows but live for anything that recurs.
* `src/lib/data-access/resolveOrCreateCompany.ts`, which does the same thing
  in TypeScript with `results[0]` and additionally registers the user's query
  as an **alias** of whatever it picked.

Verified against live `/search` on 2026-09-01, 12 calls at 1/sec. The ungated
code reproduces **10 of the 12** named prod cross-wires exactly:

| our row | prod ticker | ungated pick | rank-1 description |
|---|---|---|---|
| Ola | KO | KO | Coca-Cola Co |
| Gett | RGTI | RGTI | Rigetti Computing Inc |
| CSL | CSL | CSL | CARLISLE COS INC |
| Vanguard | AVD | AVD | American Vanguard Corp |
| Fidelity | FIS | FIS | Fidelity National Information Services Inc |
| LIC | RSG | RSG | Republic Services Inc |
| GHO | WAB | WAB | Westinghouse Air Brake Technologies Corp |
| Revolut | RVMD | RVMD | Revolution Medicines Inc |
| YC | PAYX | PAYX | Paychex Inc |
| Motive | ORLY | ORLY | O'Reilly Automotive Inc |
| AXT Inc. | BAX | (no match today) | |
| HP Inc. | HP | (no match today) | |

With the gate, all 12 return `None`. The two blanks return no match from
today's Finnhub index and cannot be reproduced live; they were written by the
same code path.

The resolver also **spreads** existing cross-wires through its ticker dedup
guard. Prod holds these aliases today, both pointing at wrong companies:

* `Fidelity National Information Services` -> the row named `Fidelity` (FIS)
* `Revolut Ltd.` -> the row named `Revolut` (RVMD)

### The amplifier: a ticker join with no name check and a truncated read

`edgar.cik_mapping._update_companies_sec_cik` read `cik_tickers` with a bare
`.execute()`. PostgREST caps that at 1000 rows and returns no error:

```
Content-Range: 0-999/11072
```

The visible window spans cik 2809..2149111. It is **not** the lowest-CIK
block: there is no `ORDER BY`, so the rows come back in heap order and the
window can shift between runs. The `companies` read returns all 964 rows and
is not truncated, but sits 36 rows from the same cliff.

The job then joined `companies` to `cik_tickers` on TICKER with no name check
and no existence guard.

Comparing `sec_cik` against `cik_tickers` **by ticker** is a tautology, since
this job is what wrote it. The authority axis is the CIK: join on
`sec_cik = cik_tickers.cik` and compare `cik_tickers.company_name` against
`companies.name`.

## Correction to an earlier claim

A previous revision of this document, and of the `fix/cik-stamp-name-agreement`
commit message, stated that *all seven named cross-wires currently hold
`sec_cik = NULL`*. That is false. Re-measured on the CIK axis, **all twelve
named cross-wires already hold a wrong `sec_cik`**:

| our name | ticker | sec_cik | SEC registrant for that CIK |
|---|---|---|---|
| Ola | KO | 21344 | COCA COLA CO |
| Gett | RGTI | 1838359 | Rigetti Computing, Inc. |
| AXT Inc. | BAX | 10456 | BAXTER INTERNATIONAL INC |
| CSL | CSL | 790051 | CARLISLE COMPANIES INC |
| Vanguard | AVD | 5981 | AMERICAN VANGUARD CORP |
| Fidelity | FIS | 1136893 | Fidelity National Information Services, Inc. |
| LIC | RSG | 1060391 | REPUBLIC SERVICES, INC. |
| GHO | WAB | 943452 | WESTINGHOUSE AIR BRAKE TECHNOLOGIES CORP |
| Revolut | RVMD | 1628171 | Revolution Medicines, Inc. |
| YC | PAYX | 723531 | PAYCHEX INC |
| Motive | ORLY | 898173 | O REILLY AUTOMOTIVE INC |
| HP Inc. | HP | 46765 | Helmerich & Payne, Inc. |

This matters for scope. The gate governs writes and never clears an existing
value, so **it does not repair any of these twelve**. They are already wrong
and stay wrong until a human rules on them. What the gate does is stop the
count from growing.

These rows are not inert. The existence guard shows one of them actively
blocking a correct stamp:

```
cik 1838359 already held by 'Gett'; not stamping 'Rigetti'
```

The cross-wired `Gett` row squats on Rigetti Computing's CIK, so the
legitimate `Rigetti` row cannot have it.

## The matcher

`backend/edgar/name_agreement.py`, mirrored by `src/lib/name-agreement.ts`.
One policy, both runtimes. Parity is asserted over 881 fixtures drawn from the
prod snapshot: **0 mismatches**, on both the verdict and the reason string.

Accept clauses, in order: identical token sets; subset with >= 2 shared
identity tokens; `difflib` ratio >= 0.80; acronym; bounded head prefix.

FAIL OPEN: no authority name means no opinion and the write proceeds. The gate
governs writes only and never clears an existing value, so a rejection costs a
**missing** identifier, never a **wrong** one. Every tuning choice below
resolves ties in that direction.

### Four corrections to the first revision of the matcher

**1. Acronym floor of 3 letters.** `HP Inc.` vs `Helmerich & Payne, Inc.`
matched on the `{h, p}` initials and was accepted. That is a real prod
cross-wire. Two-letter acronyms collide too freely to be evidence. Cost:
genuine two-letter acronyms like `GE` vs `GENERAL ELECTRIC` now go unstamped.

**2. Weak-identity tokens are kept for the acronym test.** The suffix list
conflated legal forms (`inc`, `corp`) with generic words (`international`,
`holdings`, `group`). Stripping `international` cost
`INTERNATIONAL BUSINESS MACHINES` its I, so `IBM` failed to match itself. The
list is now split: `_LEGAL` is dropped everywhere, `_WEAK` only for set
comparison.

**3. Bounded head prefix, on by default.** The first revision shipped head
prefix matching OFF because unbounded it could not reject `Fidelity` inside
`Fidelity National Information Services`. Bounding the authority to **at most
one extra identity token** separates the two shapes:

| | extra tokens | verdict |
|---|---|---|
| `Coinbase` in `Coinbase Global, Inc.` | +1 | accept |
| `Chime` in `Chime Financial, Inc.` | +1 | accept |
| `Fidelity` in `Fidelity National Information Services` | +3 | reject |
| `BNY` in `BNY MELLON STRATEGIC MUNICIPALS, INC.` | +3 | reject |
| `xAI` in `XAI Floating Rate & Alternative Income Trust` | +4 | reject |

Position is load-bearing and cannot be relaxed to "appears anywhere":
`Vanguard` is a +1 **interior** token of `AMERICAN VANGUARD CORP`.

**4. The positional test runs on raw tokens.** Stripping legal forms from our
side first let a brand that genuinely ends in one pose as a bare prefix:
`Urban Company` reduces to `['urban']`, a +1 head prefix of
`URBAN OUTFITTERS INC`. Urban Company is an Indian home-services firm. On raw
tokens the second position disagrees. Nothing is lost, because a name
differing only in legal form (`Foo Inc` vs `Foo Corporation`) is already
accepted by the token-set equality clause.

Plus one tokenizer fix: **single-character tokens are dropped**. Stripping the
dots out of `S.A.` and `N.V.` left loose letters that counted as unmatchable
identity, which rejected `Globant` / `Globant S.A.`, `Spotify` /
`Spotify Technology S.A.` and `Nebius` / `Nebius Group N.V.`.

### Measured on the 793 stamped rows, CIK axis

| | inherited strict | this PR |
|---|---|---|
| flagged of 793 | 131 (16.5%) | **85 (10.7%)** |
| name IS the ticker, not adjudicable | 37 | 27 |
| adjudicable | 94 | **58** |
| true positives (stamp really is wrong) | 44 | **47** |
| false rejections | 50 | **11** |

The new matcher finds **more** genuine errors while making **a fifth** as many
false rejections. The 11 remaining false rejections are `Allbirds`, `Apollo`,
`Chipotle`, `Disney`, `Kingsway Financial`, `Nordic`, `Raytheon`, `SpaceX`,
`The Metals Company`, `TopBuild` and `United Bank`.

### Shapes that stay rejected, and why that is acceptable

`Raytheon` / `RTX Corp`, `MicroStrategy` / `Strategy Inc`, `SpaceX` /
`SPACE EXPLORATION TECHNOLOGIES CORP` and `Disney` / `Walt Disney Co`.

The first three are renames with little or no shared string; no string matcher
can connect them, and recovering them needs an alias or an override, not a
looser threshold. `Raytheon` and `SpaceX` already have entries in
`HARD_TICKER_OVERRIDES`, which returns before the gate.

`Disney` is the direct price of blocking `Vanguard`. Both are one-extra-token
matches where our name is not in leading position. Relaxing the rule to accept
`Disney` inside `Walt Disney Co` necessarily accepts `Vanguard` inside
`AMERICAN VANGUARD CORP`. All four are already stamped, and the gate never
clears, so today's cost is zero.

## Duplicate tickers

Prod holds 11 tickers mapping to two CIKs each; SEC's own file has none,
because `cik_tickers` is accretive and a successor registrant is added
alongside its predecessor. The previous behaviour was last-write-wins over an
**unordered** read, which picked the higher CIK every time.

The rule is now **smallest CIK**, matching what
`entity_resolver.lookup_cik_for_ticker` already did. One rule, not two. Every
collapse is logged.

| ticker | chosen (smallest) | discarded | note |
|---|---|---|---|
| XOM | 34088 EXXON MOBIL CORP | 2115436 ExxonMobil Holdings Corp | fixes a wrong resolution |
| PARA | 813828 Paramount Global | 1826011 Banzai International, Inc. | fixes a wrong resolution |
| LCCCU | 2049248 Lakeshore Acquisition III Corp. | 2125703 Dance Emotion Studios Inc. | fixes a wrong resolution |
| EQR | 906107 EQUITY RESIDENTIAL | 931182 ERP OPERATING LTD PARTNERSHIP | operating partnership, not the REIT |
| GORO | 1160791 GOLD RESOURCE CORP | 1515964 Goldgroup Mining Inc. | fixes a wrong resolution |
| NVRI | 45876 ENVIRI Corp | 2104052 Enviri Corp | same company, legacy CIK |
| XPRO | 1575828 EXPRO GROUP HOLDINGS N.V. | 2126198 Expro Ltd | same company, legacy CIK |
| CBAT | 1117171 CBAK Energy Technology, Inc. | 2086841 CBAK Energy Technology Ltd | same company |
| CLBK | 1723596 Columbia Financial, Inc. | 2115119 Columbia Financial, Inc./MD/ | same company |
| UROY | 1711570 Uranium Royalty Corp. | 2143673 Uranium Royalty Corp. | identical names |
| MF | 1851682 Missfresh Ltd | 1888525 MindForge Inc. | see below |

Smallest-CIK is right or harmless in 10 of 11. `MF` is the one case where the
newer registrant may be the live one; neither company is in `companies`, so
nothing turns on it today, and the name gate would catch a mismatch anyway.

## Pagination: safe now, with the numbers

Paginating the `cik_tickers` read **without** the gate would attempt 74
writes, every one of them a fresh stamp onto a currently-NULL `sec_cik` and
every one of them a new cross-wire, including `AWS` -> Jaws Mustang
Acquisition, `Neuberger` -> Getty Images, `BNY` -> BNY Mellon Strategic
Municipals, `xAI` -> XAI Floating Rate, and both `BYD` rows -> Boyd Gaming.

Dry run of the shipping code against the prod snapshot through `FakeSB`:

```
{'considered': 74, 'blocked_name': 54, 'blocked_holder': 4, 'updated': 16, 'failed': 0}
```

All 16 writes land on rows whose `sec_cik` is NULL. There are no overwrites.
Hand-adjudicated: 15 are correct (`Aspire`, `Chime`, `Euronet`, `Huron`,
`KalVista`, `Klaviyo`, `Lake Shore Bancorp`, `Lyra`, `Mako`, `Richtech
Robotics`, `Seaport`, `Skye`, `Sunlands`, `Twist Bioscience`, `Voyager`).

One is **not verifiable**: `BCG` -> Binah Capital Group, cik 1953984. Our row
is named `BCG`, which in news copy almost certainly means Boston Consulting
Group, a private firm. The name is identical to the ticker, so it carries no
independent identity and no name gate can adjudicate it. It falls in the
27-row blind spot below. A human should rule on this one.

The 4 rows blocked by the existence guard are all duplicate rows wanting a CIK
another row already holds: `Bain Capital` (held by `Bain Capital Insurance`),
`Peloton` (held by `Peloton Interactive Inc.`), `NCLH` (held by
`Norwegian Cruise Line`), and `Rigetti` (held by the cross-wired `Gett`).

## Known blind spot

27 of the 793 stamped rows have a name identical to their ticker. For those
the name provides no corroboration and the gate is structurally blind. This is
a property of the data, not of the matcher; closing it needs a second
authority axis (exchange listing, or a Wikidata check), not a stricter string
rule.

## Not in this change

No migration. The 47 true positives and the 12 named cross-wires are wrong
today and stay wrong until a human rules on them. The gate stops the bleeding;
it does not clean the wound.
