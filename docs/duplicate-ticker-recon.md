# Duplicate tickers in `companies`: what they do, and what clearing one costs

Recon behind `sql/proposals/0038_duplicate_ticker_remediation.sql`.
Read-only against prod. Nothing in that file has been executed.

## The shape

Eleven tickers are carried by more than one `companies` row. There is **no
unique index behind `ticker`**, so nothing in the database refuses a second
holder and nothing reports one. The only check that catches it is a `GROUP BY
... HAVING count(*) > 1`, which is BLOCK 22d of the proposal.

## The premise that did not survive measurement

The expected failure was that a duplicate ticker decides which row a company
page resolves to, because `resolveCompanyCik` matches ticker before name
(`src/lib/sec-filings.ts:299`).

**On the company page it does not.** Both resolvers rank a CIK-bearing row
ahead of a CIK-less one through one shared rule in
`src/lib/company-cik-preference.ts`:

| resolver | file | entry point |
| --- | --- | --- |
| alias / cluster | `src/lib/data-access/aliasResolver.ts` | `rankCluster` -> `compareCikFirst` |
| CIK | `src/lib/sec-filings.ts:300` | `pickPreferCik` -> `preferCik` |

The resolver chain was **called** against prod through `npx tsx` for every slug
in both URL spaces, not reasoned about. On all eleven the page lands on the
CIK-bearing row, and where no row has a CIK it lands on the higher-mention one.

That is not the same as saying the pages are right. Three of them land on a
CIK-bearing row that belongs to a **different company**. See Quarantine.

## Where a duplicate ticker does real damage

Two live read paths pick a row arbitrarily among duplicates:

- `src/app/api/radar/follows/route.ts:93-98`
  `.eq("ticker", row.target).limit(1).maybeSingle()` with **no `ORDER BY`**.
  A ticker follow takes its `display_name` from whichever duplicate Postgres
  returns. For `NCLH` that is as likely to be the bare string `"NCLH"` as
  `"Norwegian Cruise Line"`.
- `src/app/radar/calls/page.tsx:226-233`
  `.in("ticker", symbols)` then `sectorByTicker[row.ticker] = row.sector`, so
  the last row read wins and the sector shown can be the duplicate's.

Neither is fixed by SQL alone. Both stop being reachable once a ticker has one
holder.

The company page self-heals a third case: `resolveAlias`'s ticker anchor
(`aliasResolver.ts:257-263`) is also unordered, but the cluster is rebuilt from
`anchor.ticker` and re-ranked, so the arbitrary anchor cannot change the head.

## The cost nobody budgets for: the ticker IS the clustering key

`aliasResolver.ts:305-316`:

```ts
let cluster = [anchor];
if (ticker) { /* refetch every row with this ticker */ }
const ranked = rankCluster(cluster);
```

With `anchor.ticker` null the cluster is `[anchor]` and the anchor **is** the
head. So clearing a ticker off a row that a slug can still reach **by name**
strands that slug on the CIK-less row: no CIK, no filings, no financials, no
insider rows, and a Private badge over a listed company.

The alias table does not rescue it. Every one of these junk rows owns an
`aliases` row whose `canonical_id` **is itself**, so `resolveCompanyCik` step 4
resolves the surface form straight back to the CIK-less row. Verified for every
junk surface form in the set.

Two further losses on the surviving page, because `getCompanyDetail` keys its
mention read on the cluster's ids and its alias ribbon on the cluster's names:

- the ribbon loses the departing row's surface forms;
- the `company_mentions` read narrows, so 7-day tone and the attention baseline
  are computed over fewer rows.

## The three kinds, and only two belong in a ticker file

| kind | meaning | instrument |
| --- | --- | --- |
| **mis-stamp** | the row is a different company from the ticker's issuer | clear the ticker |
| **bad symbol** | the ticker belongs to neither row | retire it from both |
| **same entity** | one company, two surface forms | **a 0020 merge, not a ticker clear** |

A same-entity duplicate is a merge. `sql/proposals/0020` owns that question and
can repoint the alias and the dependent rows. Clearing a ticker only orphans
them.

## Disposition

| ticker | kind | action |
| --- | --- | --- |
| BCG | mis-stamp (`Kingswood`) | BLOCK 02 |
| DJT | mis-stamp (`Trump`, the person) | BLOCK 03 |
| CHX | mis-stamp (`CHAMP`, an athlete branding firm) | BLOCK 04 |
| BCSF | mis-stamp x2 (`Bain`, `Bain Capital`) | BLOCKS 05, 06 |
| EP PR C | bad symbol, wrong on both rows | BLOCKS 07, 08 |
| NCLH | same entity, head-safe | BLOCK 09 |
| CWAN | same entity, head-safe | BLOCK 10 |
| SSNLF | same entity, head-safe | BLOCK 11 |
| TSM | same entity, high loss | **HOLD** |
| PTON | same entity, straight regression | **HOLD** |
| GEMI | same entity, straight regression | **HOLD** |

After BLOCKS 02 to 11, BLOCK 22d returns exactly three groups: TSM, PTON, GEMI.
BLOCK 22e names them so a fourth is recognisable as new.

### Why the three are held

- **PTON** and **GEMI**: `/company/peloton` and `/company/gemini` are reached by
  NAME and land on the CIK-less row the moment its ticker is gone. Both lose a
  real CIK and render an empty state. On PTON that is the higher-traffic of the
  two slugs. `GEMI` has a second problem: the CIK-less row's coverage mixes
  Gemini the exchange with Google's Gemini model, so it is a disambiguation
  question rather than a ticker one.
- **TSM**: no slug moves, because `canonicalize()` maps `"tsmc"` to
  `"Taiwan Semiconductor"`. But the CIK-less row carries substantially more
  mentions than the filer row, so the surviving page's cluster loses the larger
  half of its mention history and its most-used alias chip. Largest available
  data loss in the set, for no page defect fixed.

## What SEC actually has

Checked against `company_tickers.json`, the submissions API and EDGAR company
search. **Rate cap self-imposed at 1 request per second against SEC's 10 per
second fair-access allowance**, with a descriptive User-Agent.

| symbol | SEC | note |
| --- | --- | --- |
| BCG | cik 1953984, **Binah Capital Group, Inc.** | Nasdaq, also BCGWW. Not Boston Consulting Group. |
| BCSF | cik 1655050, **Bain Capital Specialty Finance, Inc.** | NYSE, formerly Sankaty Capital Corp. |
| CWAN | cik 1866368, Clearwater Analytics Holdings, Inc. | NYSE. Absent from `company_tickers.json`; the submissions record is authoritative. |
| GEMI | cik 2055592, Gemini Space Station, Inc. | Nasdaq. |
| NCLH, TSM, PTON, DJT | match the rows that hold them | no action. |
| **CHX** | **not in the ticker file** | ChampionX Corp is cik 1723089, submissions show `tickers: []` and `exchanges: []`, i.e. delisted. Stamping it is a separate human decision. |
| **SSNLF** | **not in the ticker file** | EDGAR search returns one conformed name, `SAMSUNG ELECTRONICS CO LTD /FI`, a foreign-filer record with no XBRL. Korean issuer, no 10-K, grey-market symbol. **No CIK invented.** |
| **EP PR C** | **not in the ticker file** under any spelling tried | `EP` maps to cik 887396, Empire Petroleum. A preferred-share symbol in the `<root> PR <series>` convention, on a private PE firm. Wrong on both rows; retired, not moved. |
| Kingswood | not in the ticker file | Kingswood Capital Management is private. |

## Quarantine, and its link to #843

Issue #843 is `The Compass Inc. row carries Encompass Health's ticker and CIK`.
Its fix section, step 3, predicted this file:

> the same sweep found brand-form rows carrying tickers that belong to
> unrelated issuers, including a private company sharing a name prefix with a
> closed-end fund.

That is the BCSF cluster, found again independently here: **Bain Capital**, a
private PE firm, sharing a name prefix with **Bain Capital Specialty Finance**,
a listed BDC.

Three rows are now known to carry another issuer's identity. Same defect, none
of them fixed by a ticker clear:

| row name | ticker / cik | actually is |
| --- | --- | --- |
| `Compass Inc.` | EHC / 785161 | Encompass Health (#843) |
| `BCG` | BCG / 1953984 | Binah Capital Group |
| `Bain Capital Insurance` | BCSF / 1655050 | Bain Capital Specialty Finance |

The `BCG` row is the sharpest of the three. Its coverage is not one company:
earnings and stock-move items plausibly about Binah, a TechCrunch piece where
BCG is Boston Consulting Group, and an oncology piece where BCG is Bacillus
Calmette-Guerin, the bladder cancer immunotherapy. A three-letter string is
acting as an entity and currently resolves to a real issuer's XBRL.

**Not decided in the proposal, on purpose.** Each needs a human to choose
between renaming the row to the registrant, clearing both identity columns, or
splitting the row. Clearing `sec_cik` is also the one edit in this area that
moves a row **into** `companies_name_norm_unique` and can raise 23505, so it
needs its own analysis. No block in `0038` writes `sec_cik`.

## Constraint direction

`companies` carries four unique things (`backend/company_conflict.py:9-12`).
**No block in `0038` can raise 23505**, which is the structural difference from
`0029`, whose every block entered `companies_sec_cik_unique`.

| thing | can this file fire it |
| --- | --- |
| `companies_name_key UNIQUE (name)` | no, `name` is never written |
| `companies_name_no_junk CHECK` | no, `name` is never written |
| `companies_sec_cik_unique UNIQUE (sec_cik) WHERE sec_cik IS NOT NULL` | no, `sec_cik` is never written |
| `companies_name_norm_unique UNIQUE (lower(btrim(name))) WHERE sec_cik IS NULL` | no. Membership is keyed on `sec_cik IS NULL`, which never changes here, so no row enters or leaves the index |
| `ticker` | there is no unique index on it at all |

The hazard here is not a constraint. It is correctness: a clear that strands a
slug fails silently and renders a plausible wrong page.

### The one invariant that could break

`sec_cik IS NOT NULL AND ticker IS NULL` is 0 in prod and is load-bearing
(`src/lib/sec-filings.ts:121-122`). Every target row carries `sec_cik IS NULL`
today, and **every block refuses if its row has acquired a CIK since analysis**.
That guard is not decoration: `backend/edgar/cik_mapping.py:194` stamps CIKs
daily and joins on ticker to do it.

## The journal `op` decision

`norm_v2.stamped_identity` already carries a partial unique index,
`stamped_identity_stamp_once ON (table_name, row_id, op) WHERE op =
'stamp_identity'`. Most of `0038` **clears** a ticker rather than **stamping**
an identity.

**Decision: a new op, `clear_ticker`, plus a second partial unique index.**
BLOCK 01 creates it.

1. The `op` is the only field that says what happened, and the reversal
   procedures genuinely differ: `0029`'s restores two columns from `before`,
   this one restores one.
2. **Decisive on its own.** `0029`'s BLOCK 99 is scoped by
   `op = 'stamp_identity'`. Sharing the op would make a full `0029` rollback
   silently re-apply every ticker `0038` cleared and write `sec_cik` on rows
   `0038` never touched. That is a correctness fault, not a naming preference.
3. A new op with **no** index is strictly worse than either alternative, and is
   exactly the failure the first index exists to prevent.

One unconditional unique on `(table_name, row_id, op)` was considered and
rejected: creating it means dropping a live index that has already refused real
rows, and a `CREATE UNIQUE INDEX` over existing data can fail on rows nobody
has enumerated. Adding one index beside another cannot fail that way.

`norm_v2` is **not exposed through PostgREST** (`Only the following schemas are
exposed: public, graphql_public`), so the journal could not be read from the
application side. BLOCK 00b asserts its existence and column set instead.

## Batching, given that a paste is atomic

The Supabase SQL editor wraps the whole paste in one transaction and ignores
inner `BEGIN`/`COMMIT`.

1. **A batch is atomic.** One block's `RAISE EXCEPTION` rolls back every other
   block in the same paste, including their journal rows.
2. **A read-back inside a paste is not durable.** It shows uncommitted state.
3. **BLOCK 01 must be its own paste, committed first.** If it shares a paste
   with a block that refuses, the index rolls back too and the retry runs with
   no idempotence guard.
4. **BLOCK 22 must be its own paste, run after.**

Recommended sequence, one paste per line:

```
BLOCK 00                 read-only pre-flight
BLOCK 01                 journal index
BLOCK 02 .. BLOCK 06     BATCH 1, mis-stamps
BLOCK 22                 read-only, confirm
BLOCK 07 + BLOCK 08      BATCH 2, retire EP PR C, paste together
BLOCK 22                 read-only, confirm
BLOCK 09 .. BLOCK 11     BATCH 3, same-entity, head-safe
BLOCK 22                 read-only, confirm
```

BLOCKS 07 and 08 must be pasted together. Unlike the mis-stamp blocks they
deliberately retire the symbol entirely, so they carry a different guard and
tolerate becoming the last holder. Applying only one leaves a single row
carrying a symbol that belongs to a different issuer, which is worse than
either the before or the after.

## Will the pipeline undo this

Partly, and it is worth knowing before applying.

- **`backend/scripts/backfill_tickers.py`** selects on
  `.is_("ticker", "null")` and a `mention_count` gate, then writes back
  whatever Finnhub's search returns for the row's name. **That selection
  predicate is exactly the state `0038` creates.** A re-run would offer
  `Peloton`, `Gemini`, `Bain Capital`, `Samsung Electronics` and the rest
  straight back to Finnhub, which returns the same symbols. It is not wired
  into any workflow in `.github/workflows` and is run by hand, so this is a
  "do not re-run it blind" caveat rather than a countdown.
- **`backend/entity_resolver.py:426-441`** writes a ticker at **mint only**, on
  a freshly inserted row, behind a mention gate and `DISABLE_TICKER_POPULATION`.
  It cannot re-stamp an existing row.
- **`backend/edgar/cik_mapping.py:163-199`** writes `sec_cik` only, never
  ticker, and skips rows with no ticker (`if not ticker: continue`). After
  `0038` the cleared rows are invisible to it, which is the intended outcome.

**The durable fix is an override, not a one-off UPDATE.** `CLAUDE.md` names
`HARD_TICKER_OVERRIDES` as the source of truth for ambiguous names. A negative
entry, or a `ticker_locked` column, is what would stop the backfill from
re-proposing these. Designing that is a separate change.

## Method

- Every resolution claim in this document and in `0038` comes from **calling**
  `resolveAlias`, `getCompanyDetail` and `resolveCompanyCik` against prod
  through `npx tsx`. No resolver was ported or simulated.
- The one counterfactual that cannot be produced by a call, "which row becomes
  the anchor after the clear", was measured by re-issuing the two reads
  `resolveAlias` itself issues with the cleared rows removed from the **ticker**
  reads only, never from a name read, and ranking the result with the imported
  `rankCluster`. `resolveByMatchKey` ranks on `sec_cik`, which this change never
  writes, so its answer is unchanged by construction.
- The company enumeration was walked with keyset pagination and asserted
  against a `count=exact` total, because a bare PostgREST read caps silently.
