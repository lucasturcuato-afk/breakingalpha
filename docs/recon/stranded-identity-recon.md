# Stranded SEC identity: recon and re-home plan

Companion to `sql/proposals/0029_rehome_stranded_identity.sql`.

**Nothing in this document or that file has been executed.** The SQL is written
to be hand-applied one block at a time by a human, with a guard, a read-back
and a rollback per block.

**This repo is public, so no row counts, volumes or mention counts appear
here.** Everything below is argued in relative terms. The counted version of
this analysis was delivered to the operator out of band.

## What happened

Entity resolution matched **interior substrings** and minted fragment rows from
the middle of real company names:

| fragment row | minted from |
| --- | --- |
| `Ola` | coca-c**ola** |
| `GHO` | westin**gho**use |
| `Hark` | s**hark**ninja |
| `Acer` | m**acer**ich |
| `ABC` | l**abc**orp |
| `Ely` | ard**ely**x |
| `LIC` | repub**lic** services |
| `APCO` | n**apco** |
| `NASA` | re**nasa**nt |
| `Arbor` | clean h**arbor**s |
| `Motive` | o'reilly auto**motive** |
| `NPR` | e**npr**o |
| `Avance` | ther**avance** |
| `Revolut` | **revolut**ion medicines |
| `METR` | xo**metr**y |
| `Ardian` | gu**ardian** pharmacy |
| `Roze` | sur**roze**n |
| `NEA` | li**nea**ge |
| `Accel` | **accel**erant |

The ticker backfill then stamped real SEC identity onto those fragments,
because they matched first. Facts and filings were ingested under those CIKs.
The fragments were later stripped of their identifiers, and nothing re-homed
the identity.

**Why nothing re-homed it.** `backend/edgar/cik_mapping.py::_update_companies_sec_cik`
joins on ticker and skips any row without one:

```python
ticker = (c.get("ticker") or "").upper().strip()
if not ticker:
    continue
```

The correctly-named rows carry no ticker, so the one job that would have fixed
this cannot see them. Every fragment row confirmed to carry `ticker IS NULL`
and `sec_cik IS NULL` today, so the strip hit the fragments rather than
deleting them.

## The split

A set of CIKs carry `financial_facts` and `sec_filings` that no `companies` row
claims. None is junk; every one resolves to a live tickered registrant in SEC's
own `company_tickers.json`. Every one of their `sec_filings` rows carries
`company_id NULL`, against a large majority populated table-wide: the writer
records that it cannot resolve them, on every run.

- **Shape A, correct row exists and carries nothing: 20.** Stamp CIK and
  ticker. These are the high-value cases and they render empty pages today.
- **Shape B, correct row exists but already carries a different identifier: 0.**
  None found. Every candidate receiving row is clean on both columns.
- **Shape C, no correct row exists: 26.** Named below. Not created here.

## Why the stamp alone is sufficient

Company Intel reads facts, filings and insider rows **by CIK, not by
`company_id`**:

- `src/lib/financial-facts.ts:514` reads `financial_facts_latest` with `.eq("cik", res.cik)`
- `src/lib/sec-filings.ts:365` uses `.eq("cik", res.cik)`, falling back to
  `company_id` only when the CIK is null

and `res.cik` comes from `resolveCompanyCik`, which reads `companies.sec_cik`.
Setting `sec_cik` on the correct row therefore fills the page immediately. The
dependent rows' `company_id` is not on the read path and is not touched.

## Why both columns are written

`sec_cik IS NOT NULL AND ticker IS NULL` is **zero** in prod and is
load-bearing: `src/lib/sec-filings.ts:122` relies on "every CIK-bearing
companies row carries a ticker", and `resolveCompanyCik` step 2 matches ticker
before name. Every block writes both columns. A block that wrote only `sec_cik`
would break the invariant.

## Constraint direction analysis

`companies` carries four unique things, enumerated in
`backend/company_conflict.py` from `pg_constraint` **and** `pg_indexes` (two of
the four are partial indexes and carry no `pg_constraint` row).

| constraint | direction under this change | can it raise |
| --- | --- | --- |
| `companies_name_key UNIQUE (name)` | `name` never written | no |
| `companies_name_no_junk CHECK` | `name` never written; no target name is on the list | no |
| `companies_name_norm_unique UNIQUE (lower(btrim(name))) WHERE sec_cik IS NULL` | row **leaves** the partial index as `sec_cik` goes NULL to NOT NULL | **no.** Leaving an index cannot raise |
| `companies_sec_cik_unique UNIQUE (sec_cik) WHERE sec_cik IS NOT NULL` | row **enters** this index | **YES. This is the only one that can abort a block mid-run** |

Verified at analysis time that no other row holds any target CIK, that no CIK
appears twice in the plan, that no row is targeted twice, and that no other row
already carries any ticker being stamped. Separately verified that no other row
shares `lower(btrim(name))` with any target, so the slot each row vacates in
`companies_name_norm_unique` was not shared.

**None of that is trusted at apply time.** Prod drifts and the daily pipeline
can mint a CIK holder between analysis and application, so every block
re-checks all of it inside its own guard and refuses rather than raising 23505.

The ticker check is in the guard even though there is no unique index behind
it. It cannot abort a statement, but a second row carrying the same ticker
would misroute the page through `resolveCompanyCik` step 2, which is a worse
outcome than an abort because it is silent.

## Identity lives in four stores; the stamp writes one

| store | after the stamp |
| --- | --- |
| `companies.sec_cik` | **written.** Now names the correct company |
| `financial_facts.cik` | unchanged, now **agrees**. Always held the right CIK; nothing claimed it |
| `sec_filings.cik` | unchanged, now **agrees**. Its `company_id` stays NULL and still disagrees, silently, as it did before. Not on the read path while a CIK resolves |
| `insider_transactions.cik` | unchanged, now **agrees**. Column is `cik`, not `issuer_cik`. Its `company_id` is NULL throughout, same status |

The store that **openly disagrees** afterwards is `financial_facts.company_id`.
On most of the 20 it still points at the fragment row; on the rest it is
already NULL. It is deliberately not touched: it is a **receipt** of who owned
the CIK at ingest, which is how the detach was traced, so overwriting it
destroys the evidence. Repointing it is a separate decision and belongs with
the `sql/proposals/0020` merge, which already owns the dependent-row question.

## The journal

`norm_v2.moved_row` **does not exist**. It is named only inside a comment in
`sql/proposals/0020_normalize_lookup_key_v2.sql` phase 8d, in a file whose own
header says "PROPOSAL. NOT APPLIED", as the four-column signature
`moved_row(table_name, row_id, from_company_id, to_company_id)` that phase 6
would have to write for rollback to be exact. There is no table, no schema and
no prior row to match.

The merge's four columns are kept **verbatim** as the spine, so one reversal
procedure covers both operations, and are kept even though this operation never
populates `from_company_id` / `to_company_id`.

What is added, and why the merge shape alone is not enough: a merge moves a
dependent row **between** companies, so from/to company ids fully describe it.
This operation moves no row at all. It changes two columns **on** a companies
row. `before` / `after` jsonb carry those values, and a reversal dispatches on
one rule:

```
to_company_id IS NOT NULL  -> repoint the dependent   (the 0020 merge)
to_company_id IS NULL      -> restore `before` onto row_id  (this file)
```

A partial unique index on `(table_name, row_id, op) WHERE op = 'stamp_identity'`
makes a re-applied block a no-op in the journal too. Without it a second run
would write a journal row whose `before` is the already-stamped state, and the
rollback would then restore the wrong thing.

## Shape C: no correct row exists

Twenty-six CIKs carry facts and filings with no correctly-named row anywhere in
`companies`. Only the fragment row exists.

Creating a row would require a name, and the only trustworthy source for it is
SEC's own `company_tickers.json` title. `backend/recruiting_universe.py` already
has the shape for this: seed name plus ticker plus `sec_cik` copied from
`cik_tickers`, never guessed.

**Ingest will not create these on its own.** `entity_resolver` mints a company
only when an article names it, and it would mint from the article's surface
form, which is the same path that produced the fragments. A mint would also
land inside `companies_name_norm_unique` with `sec_cik NULL`, so it would not
pick the CIK up either. These stay stranded until someone seeds them
deliberately.

The Shape C registrants: American Vanguard, Helmerich & Payne, VF, Renasant,
First Keystone, Dentsply Sirona, Clean Harbors, O'Reilly Automotive, Macerich,
Flotek Industries, Republic Services, ON Semiconductor, CoastalSouth
Bancshares, MagnaChip Semiconductor, Ardelyx, ZipRecruiter, KKR Real Estate
Finance Trust, Xometry, Equillium, Foghorn Therapeutics, Surrozen, Falcon's
Beyond Global, SharkNinja, Accelerant Holdings, Fifth Era Acquisition, New
Providence Acquisition.

## The reverse set

A second set of rows carry a `sec_cik` and hold no facts at all. Asking SEC what
each registrant actually publishes splits them cleanly, and the split is on
**taxonomy**, not on error:

- **IFRS filers.** Eight rows publish a complete financial statement set under
  `ifrs-full` and file 6-K / 20-F / 40-F. Our ingest reads `us-gaap` only, so we
  hold nothing. **Real coverage gaps**, and one shared cause rather than eight
  separate bugs. Telesat, PetroChina, YPF, IAMGOLD, Vermilion Energy, POET
  Technologies, Alvotech, Mobilicom. Their one or two stray `us-gaap` tags are
  incidental crossover, not statements.
- **Canadian National Railway (CNI).** A Canadian issuer that reports in **US
  GAAP** and publishes a full tag set we already know how to read, while we hold
  zero. **The one genuine miss inside the taxonomy we already support**, and the
  only member of this set that is a straightforward bug.
- **Pershing Square USA.** A closed-end fund reporting under `cef` on N-2. Not
  an operating company. Not a gap.
- **Publishes nothing structured.** Eleven rows whose SEC `companyfacts` is
  empty or near-empty, filing only 6-K / F-6 / D wrappers: Deutsche Telekom,
  Telenor, Aecon, Standard Life, Soitec, easyJet, DroneShield, Mako Mining,
  Braiin, PayPay, AIR Global. **Not errors.** There is nothing to ingest.

So the reverse set is **nine coverage gaps and twelve non-errors**, and the nine
are two different problems: eight are a missing `ifrs-full` reader, one is a
plain miss.

## Traps found in passing, not filed

- **A second Exxon CIK.** `2115436` is "Exxon Mobil Corporation" at SEC, a
  successor registrant filing S-8 POS, distinct from the operating registrant
  `34088` that the `Exxon` row already holds. Two null-identity rows sit beside
  it (`ExxonMobil`, the higher-traffic of the pair, and `Exxon Mobil Corp`).
  Stamping `2115436` onto either would pass `companies_sec_cik_unique` and be
  wrong. **Do not.**
- **An ETF in the filings table.** `1067839` is Invesco QQQ Trust. Correctly has
  no company row.
- **A registrant with substance and no row at all.** `704532`, Onto Innovation,
  publishes a full `us-gaap` set and we hold filings but zero facts and no
  company row.
- **`Compass Inc.` carries Encompass Health's EHC and cik 785161**, tracked as
  issue #843. Confirmed still present. Not re-filed. It is outside both sets
  here because that CIK **is** claimed, which is exactly why it is invisible to
  this analysis.
- **Duplicate rows beside several targets** stay empty after the stamp:
  `Westinghouse Air Brake` beside `Westinghouse Air Brake Technologies`,
  `Theravance` beside `Theravance Biopharma`, `GigaCloud` beside `GigaCloud
  Technology`, `Madison Square Garden Sports (MSGS)` beside `Madison Square
  Garden Sports`, `NAPCO SECURITY TECH` beside `NAPCO SECURITY TECHNOLOGIES`.
  They are duplicate-cluster rows and belong to `sql/proposals/0020`. Stamping a
  second row with the same CIK is exactly what `companies_sec_cik_unique`
  forbids.

## A false negative worth recording

The first pass classified Huntington Bancshares as Shape C, "no correct row
exists", while a mention-heavy row sat in the table. Three causes, all the same
failure class of **normalizing one side and not the other**:

- SEC titles carry a trailing state-of-incorporation segment (`/MD/`, `/CN/`,
  `/DE`, `/Cayman`) that `normalize_company_key` does not strip.
- SEC writes `O REILLY` where we write `O'Reilly`, and the normalizer **deletes**
  the apostrophe rather than spacing it, so the two sides land on different keys.
- SEC drops a leading `The` that the normalizer deliberately keeps, documented in
  `backend/company_match.py` and correct for its own purpose.

The fix was to generate fold variants with **one generator applied to both
sides**, and to back it with a token-overlap sweep so that a Shape C call means
"no row contains this registrant's distinctive tokens" rather than "my
normalizer missed". Two further Shape A rows surfaced only in that sweep, under
names SEC no longer uses: `ENPRO INDUSTRIES` for "Enpro Inc." and `Lineage
Logistics` for "Lineage, Inc.".

## Verification performed

- Every read paginated; every count taken with `Prefer: count=exact` and
  asserted against the rows actually retrieved. `financial_facts` cannot be
  counted unfiltered (`57014`), so its distinct-CIK set was walked with a keyset
  on `cik` itself, one row per hop, which terminates rather than truncating. A
  filtered `count=exact` on `cik` does work and was used for per-CIK totals.
- An earlier receipt read keysetted on `company_id`, which cannot advance when
  every row for a CIK shares one value; it silently returned a page ceiling and
  a runaway. Redone on the uuid primary key, with every result asserted equal to
  the exact count.
- The proposal parses under `libpg_query`, the parser Postgres itself uses:
  99 top-level statements and all 20 `DO` bodies parse as plpgsql. Both passes
  are needed, because `parse_sql` treats a `DO` body as an opaque string and is
  green on plpgsql that cannot run.
- Every write in the file sits inside a guarded `DO` block. There are no
  top-level `UPDATE`, `INSERT` or `DELETE` statements.
- Prod re-read at the end of the session: the three invariants were unchanged
  and all 20 guards evaluate to their proceed branch.
