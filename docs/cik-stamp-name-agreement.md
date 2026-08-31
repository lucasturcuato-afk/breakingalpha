# companies.sec_cik: one column, three write policies, one silent no-op

Scoped 2026-08-31 against prod (SELECT only). Nothing in this document has
been applied. No migration is proposed. The code change gates future writes
and never clears an existing `sec_cik`.

## 1. The two functions, and how they differ

`backend/edgar/cik_mapping.py:71` (before this PR), reached on every SEC
ingest run via `backend/ingest_sec.py:72`:

```python
def _update_companies_sec_cik(sb: Client) -> int:
    """Update companies.sec_cik by joining against cik_tickers on ticker."""
    mappings = sb.table("cik_tickers").select("cik, ticker").execute().data or []
    ticker_to_cik: dict[str, int] = {}
    for row in mappings:
        ticker_to_cik[row["ticker"]] = row["cik"]
    ...
        new_cik = ticker_to_cik.get(ticker)
        if new_cik and c.get("sec_cik") != new_cik:
            sb.table("companies").update({"sec_cik": new_cik}).eq("id", c["id"]).execute()
```

Its mint-time twin, `backend/entity_resolver.py:485`:

```python
def populate_sec_cik_for_mint(*, supabase, company_id: str, ticker: str) -> Optional[int]:
    """
    DEDUP HAZARD GUARD: before writing, SELECT for any company row that
    already holds this sec_cik. If one exists (and it is not this row), do
    NOT set sec_cik on the new row -- that would create a second CIK holder.
    """
    cik = lookup_cik_for_ticker(supabase, ticker)
    ...
    holder_ids = [r["id"] for r in existing if r.get("id") != company_id]
    if holder_ids:
        return None
    supabase.table("companies").update({"sec_cik": cik}).eq("id", company_id).execute()
```

They write the same column and agree on nothing else:

| | sync path (`_update_companies_sec_cik`) | mint path (`populate_sec_cik_for_mint`) |
|---|---|---|
| existence guard (refuse a 2nd CIK holder) | absent | **present** |
| name agreement | absent | absent |
| duplicate ticker | last write wins, unordered | **smallest CIK, logged** (`lookup_cik_for_ticker`) |
| reads whole table | **no**, capped at 1000 | n/a, single-ticker `.eq()` |
| scope | all 964 tickered rows, hourly | one freshly minted row |

The sync path is the weaker policy and it is the one that runs on every row,
every hour.

## 2. Does the job succeed in prod? PROVED: it succeeds and does nothing

This was previously undeterminable. It is now settled from prod reads alone,
with no pipeline run and no log access.

`ingest_sec.py:113` writes `str(stats)` into `pipeline_runs.error_notes`, and
`stats["cik_sync"]` is the return value of `sync_cik_tickers`. The last 12
`brief_type='edgar_ingestion'` rows are identical:

```
status=success  {'fetched': 10391, 'upserted': 10391, 'companies_updated': 0, 'coverage_pct': 82.3}
```

`companies_updated: 0` on every run, and it is not the bare `except` at
`cik_mapping.py:52` swallowing an error. Replaying the function's exact reads
against prod:

```
cik_tickers  unpaginated SELECT returned: 1000   (table truth: 11072)
companies    unpaginated SELECT returned:  964   (table truth:   964)
=> companies_updated the job WOULD report: 0
```

PostgREST caps a bare `.execute()` at 1000 rows and returns no error. The job
sees **9 percent of `cik_tickers`**, and because the read comes back in CIK
order that 9 percent is the lowest-CIK block, meaning the oldest and
best-known registrants: AIR, ABT, AMD, AAPL, BA, BAC. Only **145 of the 944
distinct company tickers** fall inside that window, and all 145 already agree.
So the loop finds nothing to do, returns 0, raises nothing, and the run is
logged `success`.

`companies` squeaks under the same cap at 964 rows. It is 36 rows from
silently truncating too.

This also answers the `AWS`/`JWSMF` question. That row is not evidence of a
failing write. `JWSMF` sits outside the visible window, so the job has never
been able to see it.

## 3. The premise correction: the cross-wires are latent, not realized

PROVED: all seven named cross-wires currently hold `sec_cik = NULL`.

```
Ola       ticker KO    -> cik 21344   'COCA COLA CO'
Vanguard  ticker AVD   -> cik 5981    'AMERICAN VANGUARD CORP'
Gett      ticker RGTI  -> cik 1838359 'Rigetti Computing, Inc.'
AXT Inc.  ticker BAX   -> cik 10456   'BAXTER INTERNATIONAL INC'
Fidelity  ticker FIS   -> cik 1136893 'Fidelity National Information Services, Inc.'
BYD       ticker BYD   -> cik 906553  'BOYD GAMING CORP'
CSL       ticker CSL   -> cik 790051  'CARLISLE COMPANIES INC'
```

They carry a wrong **ticker**, and the CIK column shows what that ticker
*would* resolve to. The harm is armed, not fired.

That inverts the priority. **Fixing the pagination bug without adding the name
gate immediately converts 74 ticker errors into CIK errors**, including all
seven above. The gate is a prerequisite for the pagination fix, not an
independent nicety, and the two must ship together.

## 4. A third defect: duplicate tickers resolve to the wrong registrant

Prod `cik_tickers` holds 11 tickers mapping to two CIKs each. SEC's own file
has zero, because the table is accretive: a successor registrant is added
beside the predecessor rather than replacing it. The sync path's dict-build is
last-write-wins over a CIK-ordered read, so it picks the **higher** CIK every
time, which is the newer shell. All 11 diverge from
`lookup_cik_for_ticker`'s smallest-CIK rule:

```
XOM    job picks 2115436 'ExxonMobil Holdings Corp'   vs 34088  'EXXON MOBIL CORP'
PARA   job picks 1826011 'Banzai International, Inc.' vs 813828 'Paramount Global'
LCCCU  job picks 2125703 'Dance Emotion Studios Inc.' vs 2049248 'Lakeshore Acquisition III Corp.'
```

The `LCCCU` row confirms the known-wrong mapping independently. The `XOM` row
matters most: `Exxon` is one of two prod rows the current job would
**overwrite**, replacing a correct 34088 with 2115436.

## 5. The name-agreement rule, stated before measuring

Governing principle, inherited from the prior phase: **FAIL OPEN**. Prod's
staleness is protective because `cik_tickers` is accretive, so no gated row
lacks an authority row. The gate reads the LOCAL table only and makes no SEC
HTTP call.

Given our `companies.name` and the `cik_tickers.company_name` for the
candidate CIK:

0. **Fail open** if the ticker has no `cik_tickers` row, the authority name is
   empty, or our name has no identity tokens. No authority means no opinion.
1. Normalize both to token sets: lowercase, drop a trailing `/ QUALIFIER`,
   strip punctuation, drop legal-form stopwords (`inc corp co ltd plc holdings
   group the class common stock ...`).
2. **ALLOW** if any of: token sets equal; one set is a subset of the other
   **and** shares at least `MIN_SHARED_TOKENS = 2`; `difflib` ratio on the
   joined normalized strings `>= RATIO_ACCEPT = 0.80`; one side is an acronym
   of the other.
3. Otherwise **FLAG**, meaning do not write, and log the row.

A flag never clears an existing value, so its cost is a missing CIK, never a
wrong one.

`ALLOW_HEAD_PREFIX` is a second, **default-off** clause: accept when our
tokens form a leading run of the registrant's token sequence. Measured below.

## 6. The measurement, both directions

Two populations, both from a prod snapshot of 5,599 companies and 11,072
`cik_tickers` rows taken 2026-08-31.

- **A, retroactive audit**: the 793 rows that already hold a `sec_cik`.
- **B, forward-looking**: the 74 rows a pagination-fixed job would write.

| | strict (shipped default) | `ALLOW_HEAD_PREFIX=True` |
|---|---|---|
| A: flagged of 793 stamped | 131 (16.52%) | 77 (9.71%) |
| B: blocked of 74 writes | 68 | 43 |
| B: allowed | 6 | 31 |

Fail-open rate on A is **0 of 793**: every stamped CIK has an authority row,
which is what the accretive table guarantees. 102 tickered companies have no
`cik_tickers` row at all and are skipped before the gate is consulted.

### The 131 strict flags, adjudicated by hand

Counts reconcile: 47 + 47 + 37 = 131.

| bucket | n | reading |
|---|---|---|
| OTHER | 47 | 41 true positives, 6 false rejections |
| HEAD-PREFIX | 47 | 44 same company, 3 different company |
| PLACEHOLDER | 37 | the gate has no name to judge |

**Direction 1, true positives (44 of 94 adjudicable flags).** Rows whose
stamped CIK belongs to a differently-named registrant. Beyond the seven named
above: `ABC` on LabCorp, `ARK Invest` on PennantPark, `Acer` on Macerich,
`Arbor` on Clean Harbors, `Bed Bath & Beyond` on NEIGHBORHOOD INTELLIGENCE,
`Magna` on MagnaChip, `NASA` on Renasant, `Revolut` on Revolution Medicines,
`Science Corp.` on Gilead Sciences, `TopBuild Corp.` on QXO Insulation,
`YC` on Paychex.

**Direction 2, false rejections (50 of 94 under strict; 6 with head-prefix
on).** Rows where the strings genuinely differ but the company is the same,
so flagging is itself harm. Named:

- `Disney` inside `Walt Disney Co`
- `SpaceX` against `SPACE EXPLORATION TECHNOLOGIES CORP`
- `Raytheon` against `RTX Corp`
- `The Metals Company` against `TMC the metals Co Inc.`
- `Kingsway Financial` against `KINGSWAY Corp`
- `United Bank` against `UNITED BANKSHARES INC/WV`

plus the 44 head-prefix rows strict mode rejects: `Amazon`/`AMAZON COM INC`,
`Cisco`/`CISCO SYSTEMS`, `Exxon`/`EXXON MOBIL CORP`, `Ford`/`FORD MOTOR CO`,
`Verizon`/`VERIZON COMMUNICATIONS`, `Palantir`/`Palantir Technologies`, and 38
more of the same shape.

**The line the prior phase said cannot be drawn is confirmed, and it is wider
than reported.** `Disney` inside `Walt Disney Co` and `Vanguard` inside
`AMERICAN VANGUARD CORP` are one instance of it. `Fidelity` inside `Fidelity
National Information Services` and `Chime` inside `Chime Financial` are a
second, structurally identical pair on the head-prefix clause. `Advent` inside
`ADVENT CONVERTIBLE & INCOME FUND` and `Peloton` inside `PELOTON INTERACTIVE`
are a third. No threshold separates any of these pairs, and `SpaceX` as a
portmanteau of `SPACE EXPLORATION` remains unreachable by any token or ratio
rule. These are reported, not tuned away.

Turning `ALLOW_HEAD_PREFIX` on trades **3 true positives (including
`Fidelity`) for 44 fewer false rejections**: 41/44 caught at 0.76%
row-weighted false rejection, against strict's 44/44 at 6.31%. That is a
product call, so it ships off with the numbers attached.

### The third bucket: 37 rows the gate cannot judge

`companies.name` is literally the ticker string: `IBM`, `COIN`, `DVN`, `HIG`,
`MUFG`, `Meta`, `Uber`, `Teva`, `BCG`, `CWAN`. There is no independent name to
compare, so the only evidence is the ticker, and the ticker is exactly what is
in doubt.

This is the tautology from the prior run reappearing. It is why the
row-weighted false-rejection rate above is computed over the 94 adjudicable
flags and the 793 stamped rows, never over a set the gate itself defined. A
name-agreement gate cannot fix these. They need the resolver.

### Control set provenance

`backend/scripts/backfill_sec_ciks.py` was read and its control set was
**not** inherited. That script targets only rows where `sec_cik IS NULL`
(`fetch_targets`, line 185) and routes disagreements at `RATIO_THRESHOLD =
0.60` into a B3 bucket described as "NEVER auto-included", so measuring
against its output would score the gate on rows a weaker version of the same
check had already filtered. Both populations here are drawn directly from
`companies`, unfiltered: A is every row with a non-null `sec_cik`, B is every
row the fixed job would write.

## 7. What the fix does

`backend/edgar/name_agreement.py` (new) is the single shared policy. Both
write sites call it, so the column has one policy instead of three.

`_update_companies_sec_cik`:
1. paginates both reads (`_page_all`)
2. resolves duplicate tickers to the smallest CIK, matching
   `lookup_cik_for_ticker`
3. applies the name gate, fail open
4. refuses to mint a second holder of a CIK, matching the mint path
5. returns per-outcome counts (`updated / blocked_name / blocked_holder /
   failed / considered`) into `cik_sync.cik_update_detail`, so a zero can no
   longer mean both "nothing to do" and "the read returned 9 percent"

`populate_sec_cik_for_mint` gains the name gate via an optional `our_name`
argument. Omitting it preserves today's behavior exactly.

## 8. Not done here, deliberately

- No migration, and none is proposed. The 44 adjudicated true positives in
  population A are wrong today and stay wrong until a human rules on them.
  Correcting them is a data change on prod, not a code change.
- `companies` is 36 rows from hitting the same 1000-row cap on the read at
  `cik_mapping.py:78`. `_page_all` removes that specific fuse, but the same
  bare `.execute()` pattern should be swept for repo-wide.
- The 37 placeholder-named rows need the resolver, not this gate.
