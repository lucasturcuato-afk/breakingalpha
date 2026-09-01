# Entity integrity: continuous check, decidable auto-repair, and a ledger

**Status: DESIGN ONLY. No production code, no migrations, nothing applied.**

Base: `origin/main` = `aa555f92463b74acf749ee2b1ea1678fda62d8a8` (verified by
`git fetch origin` at time of writing).

Every number below was measured read-only against prod on 2026-08-31 via
SELECT-only PostgREST GETs. No write of any kind was issued. Outbound request
cap for this work: **zero requests to sec.gov**. All SEC-derived data was read
from the already-mirrored `cik_tickers` table inside our own database, so the
SEC fair-access rules (10 req/sec, real User-Agent) were not exercised at all.
Any implementation of section 5's authority fetch inherits
`backend/edgar/client.sec_get`, which already carries the mandatory User-Agent
and pacing.

---

## 0. Verification of the artifacts this design was told to build on

The brief cited six artifacts. Four reproduce, one does not exist where the
brief implies, and one central attribution is refuted.

| Cited | Verdict |
|---|---|
| `sql/proposals/0036` | **NOT ON MAIN.** Exists only on unmerged branch `chore/sec-cik-unique-index` (commit `801da96f`, not an ancestor of `origin/main`). Content otherwise matches the brief. |
| The 0020b `moved_row` shape | **REPRODUCES.** `sql/proposals/0020b_norm_v2_revised_phases.sql:232`. |
| `articles_companies_backfill` ledger | **REPRODUCES,** and is live in prod: 30,707 rows, one `run_id`, applied 2026-08-17. |
| Its row 1 as a false fold | **REPRODUCES,** with a caveat (section 4). |
| `entity_resolver.py:528-530` | **REPRODUCES** as a line reference. Its significance does not (section 1). |
| `cik_mapping.py:94` | **REPRODUCES** as a line reference. |
| "All fifteen cross-wires came from `_update_companies_sec_cik`" | **REFUTED as stated** (section 1). |

### 0036 is not where the brief thinks it is

`sql/proposals/0037_company_name_repair.sql:11` (which *is* on main) references
`sql/proposals/0036_companies_sec_cik_unique_index.sql`, and that file is not on
main. The same header also references `0033_entity_merge_pinned.sql`,
`0034_entity_merge_follows.sql` and `0035_entity_merge_identity_first.sql`;
none are on main either, and the 0033 slot on main is occupied by an unrelated
file, `0033_user_claim_commit_note.sql`. So main carries a proposal whose four
stated prerequisites are all invisible from main, and a number collision on
0033.

This matters to ordering, not just tidiness: 0036's prerequisite (23505
handling) and 0035's survivor election are the two things this design depends
on, and neither is reviewable from main today.

One correction to how 0036 is usually described. **0036 puts its unique index on
`companies.sec_cik`, not on a normalized name key.** The brief states this
correctly. Restating it because the two constraints have opposite cost profiles:
the `sec_cik` index is free today (793 CIK-bearing rows, 793 distinct, zero
duplicate groups, gate confirmed OPEN), while the normalized-name index is
impossible today (section 3).

### The 23505 sites are real but the stated risk is wrong

Both cited lines exist and both write `sec_cik`. But 0036 claims that without
23505 handling, "applying this index without it can fail an ingest or an EDGAR
cron run." Neither site can crash a run today:

- `cik_mapping.py:94` sits inside a per-row `try/except Exception` at `:96-97`
  that logs and continues, itself nested in a whole-function `try/except` at
  `:52-54`.
- `entity_resolver.py:528` is reached only through a `try/except Exception:
  pass` at `:426-427`.

The real exposure is the opposite of a crash: a 23505 would be **swallowed
silently**, the `updated` counter would under-report, and nothing would record
that a CIK was refused. That is a worse failure than a crash, and it is the
exact failure this design's ledger exists to make visible. The prerequisite is
therefore not "do not crash", it is "classify 23505 as a lost race, write a
ledger row saying so, and count it separately from a successful write."

---

## 1. Which write path actually caused the cross-wires

The brief attributes all cross-wires to `_update_companies_sec_cik`. That does
not survive measurement. Three findings, in order of strength.

### 1a. `populate_sec_cik_for_mint` is unreachable. It is dead code.

`entity_resolver.py:408` calls `search_finnhub_ticker(name, mention_count=1)`.
`finnhub_helper.py:45` sets `MIN_MENTION_COUNT_FOR_LOOKUP = 2`, and
`finnhub_helper.py:364-368` is the first statement in the function:

```python
if (mention_count is not None and mention_count < MIN_MENTION_COUNT_FOR_LOOKUP):
    return None
```

`1 < 2` always. The gate fires before the `HARD_TICKER_OVERRIDES` lookup, so
there is no bypass. `ticker` is therefore always `None`, `if ticker:` at `:409`
never fires, and `populate_sec_cik_for_mint` at `:421` is never called in
production. The in-repo comment at `:403-405` says as much ("effectively a
no-op for new rows") without drawing the conclusion.

So the finding is stronger than the brief's. The existence guard did not merely
fail to protect correctness; **the function containing it has never run.** Zero
CIKs in prod came from it. `entity_resolver.py:528-530` needs no 23505 handling
because it is unreachable, and adding handling there would be dead code guarding
dead code.

### 1b. `_update_companies_sec_cik` can see only 15% of the ticker population

Measured, not inferred. A bare unpaginated `.execute()` on `cik_tickers`
returns:

```
Content-Range: 0-999/11072
```

1,000 of 11,072 rows. The returned slice is **stable** (two calls, symmetric
difference 0), consistent with an unordered sequential scan. That slice contains
only **145 of the 964 tickers held by companies rows.**

The consequence is arithmetic. 793 rows carry a `sec_cik`. At most 145 of them
are reachable by this job against the current physical ordering. **648 stamped
rows are outside its reach.** Of the 23 cross-wired rows identified in section
4, only 4 have tickers inside the slice (`HP`, `PAYX`, `KO`, `COKE`); **19 are
outside it.**

### 1c. The hand-applied artifacts refused every cross-wire

Two review-only generators exist, both of which emit SQL for a human to apply
and neither of which writes to the database:
`backend/scripts/backfill_sec_ciks.py` (224 `SET sec_cik` statements in
`backend/migrations/2026-06-04-sec-cik-backfill.sql`) and
`backend/scripts/reconcile_sec_companies.py` (914 statements in
`2026-06-21-sec-ticker-reconcile-phase-a.sql`).

Grepping every file in `backend/migrations/` for the 23 cross-wired company
UUIDs returns **0 hits out of 23.** That is not a coincidence: both generators
gate on `_names_agree` (difflib ratio >= 0.60 against the SEC registrant name),
which is exactly the test the 23 fail. **The name gate worked. It refused all of
them.** They got their CIKs from somewhere with no name gate.

### 1d. What the evidence actually supports

**Proven:** the mint path stamped nothing (1a). The name-gated human paths
stamped none of the 23 (1c). `_update_companies_sec_cik` is the only remaining
ungated writer of `sec_cik` in the codebase.

**Inferred, and labelled as such:** `_update_companies_sec_cik` accumulated its
793 stamps across roughly 150 daily runs while the physical ordering of
`cik_tickers` drifted under the daily batched `upsert` at `cik_mapping.py:44`.
Non-HOT updates relocate rows, so the unordered first-1000 window is stable
minute-to-minute but not month-to-month. This is consistent with the data but is
not directly observable from a snapshot, and the design below does not depend on
it being true.

**Refuted:** that this job *authored* the errors. It did not. Every one of the
23 is a row whose **ticker is wrong for its name**, and both the CIK writers
derive `cik = cik_tickers[ticker]`. The CIK is a faithful function of a bad
input. `_update_companies_sec_cik` is the **amplifier**: it takes a latent
ticker error, which harms nothing on its own, and converts it into a live CIK
that pulls another company's SEC filings onto the page.

The actual ticker authors are two, and neither is the sync job:

| Path | Gate | Can it write a ticker onto a low-mention row? |
|---|---|---|
| `backend/scripts/backfill_tickers.py:245` | `.gte("mention_count", 2)` | No |
| `src/lib/data-access/resolveOrCreateCompany.ts:216` | **none**, inserts `{name, ticker: symbol, mention_count: 0}` | **Yes** |

`'Gett'` carries `ticker=RGTI` at `mention_count = 1`. `mention_count` only ever
grows, so this row could never have passed the `>= 2` gate. It is not
attributable to the bulk backfill and it is not attributable to the mint path.
The request-time frontend insert is the only writer that can produce it.

### 1e. Two failure modes, two owners. Do not conflate them.

The coordinator's mid-task correction is right and this design keeps them apart:

| | **Cross-wire** | **Duplicate proliferation** |
|---|---|---|
| Symptom | One row holds another company's CIK | One company occupies 2-4 rows |
| Author | Ticker written ungated (`resolveOrCreateCompany.ts:216`), CIK amplified by `cik_mapping.py:94` | `entity_resolver.py` mint on an alias miss |
| Creates rows? | No | Yes |
| Live count | 23 rows, 100 filings, 82 insider rows | 828 v2 buckets, 2,239 rows |
| Addressed by | Invariants 1 and 4, decidable repair tier A | Invariants 2 and 3, the ladder, then the name constraint |

Observed during this session: `companies` grew 5,599 -> 5,610. All 11 new rows
came from the mint path with `ticker=None, cik=None`, and two of them deepened
splits that already had an identifier-bearing canonical row (Franklin BSP Realty
Trust is now four rows, with 31 mentions on the bare duplicate against 13 on the
canonical `FBRT/1562528`; IDACORP is now three against canonical `IDA/1057877`).
That is the whole argument for piece 1 in a single session: a repair authored as
a one-time human statement lost ground while it was being written.

---

## 2. The self-catch, and the authority that escapes it

The brief's sharpest point. Here is the tautology, measured.

**Test A (tautological).** Does `companies.sec_cik` equal
`cik_tickers[companies.ticker].cik`?

```
cik-bearing rows                      793
sec_cik == cik_tickers[ticker].cik    788
ticker absent from cik_tickers          5
MISMATCH                                0
```

Zero. Exceptionless, for every row where the join is defined. That is not a
clean bill of health, it is a **restatement of the assignment**: the job
computes `new_cik = ticker_to_cik[ticker]` and writes it, so asking afterwards
whether they agree asks whether an assignment assigned. Any check joining
`sec_cik` to `cik_tickers` **on ticker** measures its own output and will report
100% forever, including on the day it is most wrong.

**How this design escapes it.** The check never joins on ticker. It joins on
CIK and compares **names**:

```
companies.name   vs   cik_tickers.company_name  WHERE cik = companies.sec_cik
```

`_update_companies_sec_cik` selects `cik, ticker` at `cik_mapping.py:73` and
never reads `company_name`. `company_name` is SEC's registrant `title` from
`company_tickers.json`, mirrored verbatim at `cik_mapping.py:31`. It is written
by SEC, not by us, and no code path in this repo derives `companies.name` from
it. **The name axis is genuinely independent of the stamping join.** Test A
returns 0 violations; Test B returns 94. The difference between those two
numbers is precisely the tautology.

Three limits, stated rather than hidden:

1. `cik_tickers` is our mirror, so it is only as fresh as the last sync. It is
   an *independent* authority, not an *external* one. Escalating a Tier-A repair
   to a live `sec_get` against SEC's own `company_tickers.json` costs at most 1
   request per check cycle, which is the outbound cap this design commits to:
   **one SEC request per run, never per row.**
2. The name axis cannot see a row whose name and CIK agree but whose *ticker* is
   wrong in a way that happens to map back to the same CIK. That set is empty by
   construction and irrelevant.
3. The name axis cannot see the Rigetti case at all. Both `'Rigetti'` and
   `'Gett'` are name-consistent with what they hold. Invariant 4 exists for
   exactly that gap.

---

## 3. Piece 1: the continuous integrity check, quantified against prod today

Four invariants. The first three are the brief's; the fourth is the
coordinator's addition and is retained because it catches a live defect none of
the other three can see.

### The normalizer question decides everything

Before the numbers: "normalized key" is ambiguous in this repo, and the
ambiguity is worth a factor of 500.

| Normalizer | Where | Stored? | Fold strength |
|---|---|---|---|
| `normalize_lookup_key` (v1) | `backend/normalize.py`, plus two identical TS copies at `src/lib/normalize.ts` and `src/lib/normalize-lookup-key.ts` | **Yes.** This is what `aliases.lookup_key` holds and what `resolve_entity` matches on | NFKC + lowercase + trim only |
| `normalize_company_key` (v2) | `backend/company_match.py:93` | **No.** Docstring: "READ-ONLY. Never store this value" | v1 + punctuation + 3 suffix passes |
| `norm_v2.lookup_key_v2` | `sql/proposals/0020`, unapplied | n/a | same shape as v2 |

Measured both ways, all 5,610 rows:

| Invariant 2, measured | v1 | v2 |
|---|---|---|
| buckets holding >1 row | **1** | **828** |
| rows in those buckets | 2 (0.0%) | 2,239 (**39.9%**) |
| buckets with exactly 1 identifier carrier | 0 | **499** (1,431 rows) |
| buckets with 0 carriers | 1 | 325 (790 rows) |
| buckets with 2+ carriers that agree | 0 | 3 |
| buckets with 2+ carriers that **disagree** | 0 | **1** |
| mentions stranded on carrier-less duplicates | 0 | **11,884** |

(These reproduce the coordinator's census exactly. I agree with the numbers and
add only the normalizer they are conditional on.)

The single disagreeing bucket is `'hp'`, holding `HP Inc.`[HP/46765],
`HP Inc`[HPQ/47217] and `HP, Inc.`[no identifier]. `HP` is Helmerich & Payne.
`HPQ` is HP Inc. One of those two rows is a cross-wire and the other is correct,
and they normalize to the same key, which makes this the one case where
invariants 1, 2 and 4 all fire on the same rows.

**Design consequence.** The prevention step in the brief is "a unique index on
the normalized name key." Under v1 that index is nearly free (1 violation) and
nearly useless (it catches the 0.0% of duplicates that differ only in case or
unicode). Under v2 it is the constraint that actually closes the duplicate class
and it is **impossible to apply today**: 499 buckets violate it. There is no
version of this that is both cheap and useful. Ordering is not a nicety here, it
is the only way the constraint is reachable at all.

### The four invariants

**I1. Every `sec_cik` agrees with the SEC registrant name for that CIK.**

Authority: `cik_tickers.company_name`, joined on `cik`, never on ticker.
Comparator: `_names_agree` from `backend/scripts/backfill_sec_ciks.py:79`
(difflib ratio >= 0.60 on suffix-stripped lowercase names). Reusing the repo's
existing threshold rather than inventing one keeps this measurable against the
same bar the human backfills already cleared.

```
cik-bearing rows                       793
agree                                  699
DISAGREE                                94   (11.9%)
cik absent from cik_tickers              0
```

**94 violations today.** This invariant is *not* deployable as a hard gate: the
majority of the 94 are false alarms driven by short canonical names, not
identity errors. `Meta` vs `Meta Platforms, Inc.` (0.444), `AMD` vs `ADVANCED
MICRO DEVICES INC` (0.240), `IBM` vs `INTERNATIONAL BUSINESS MACHINES CORP`
(0.200) are all correct rows that fail the ratio test. Triage in section 5
splits the 94; roughly 23 are genuine.

**I2. No two rows share a normalized key where one carries a ticker and the
other does not.**

**499 violations** under v2 (the useful reading), **0** under v1 (the stored
reading). See the table above. 11,884 mentions sit on the carrier-less side.

**I3. No alias points at a row duplicating an identifier-bearing row.**

```
aliases                                            6,237
dangling canonical_id                                  0
v1: alias rows in violation                            0
v2: alias rows in violation                          941  -> 941 distinct target rows
     mentions stranded on those targets           11,904
```

**941 violations** under v2. Worst targets by mentions: `Corning` (232),
`Bank of America Corp` (195), `Wells Fargo & Company` (178), `Lockheed Martin
Corporation` (163), `BlackRock Inc.` (155).

**Note for the check's design: I2 and I3 are largely the same defect counted
twice.** 11,884 vs 11,904 stranded mentions is not two problems, it is one
population seen from the row side and the alias side. The check must report them
as one finding with two facets, or every dashboard it feeds will double-count
the backlog.

**I4 (added). No two rows share a ticker.**

```
distinct tickers held by companies rows              944
tickers held by more than one row                     17
rows involved                                         37
```

**17 violations.** This is the invariant that earns its place. Worked case:

```
'Rigetti'  ticker=RGTI  cik=NULL       115 mentions   v2 key 'rigetti'
'Gett'     ticker=RGTI  cik=1838359      1 mention    v2 key 'gett'
                                          6 filings, 2 insider rows
```

Different v2 buckets, so I2 cannot see it. Both carry identifiers, so a
carrier-count test cannot see it. Both are name-consistent with what they hold
(`Gett` is the interior fragment `riGETTi`, per `sql/proposals/0037`), so I1
cannot see it. **Only a ticker-uniqueness test finds it**, and what it finds is
the 115-mention row rendering nothing while the 1-mention row holds Rigetti's
filings.

Same shape at higher volume: `TSM` split across `TSMC`(605 mentions, no CIK) and
`Taiwan Semiconductor`(285, cik 1046179); `SSNLF` across four Samsung rows;
`NCLH` across `NCLH`(38) and `Norwegian Cruise Line`(214, cik 1513761); `DJT`
across `Trump`(6) and `Trump Media`(73, cik 1849635).

Cost: cheapest of the four. One `GROUP BY ticker HAVING count(*) > 1`, no
authority fetch, no comparator, no normalizer choice, 17 rows to review. It
should ship first.

### Rollout implication

| Invariant | Violations today | Can ship as a hard gate? |
|---|---|---|
| I4 ticker uniqueness | 17 | **Yes, immediately** |
| I1 CIK-name agreement | 94 (~23 genuine) | Alert-only until triaged |
| I2 normalized-key carrier asymmetry | 499 (v2) / 0 (v1) | No. Needs the merge first |
| I3 alias to duplicate | 941 (v2) / 0 (v1) | No. Same population as I2 |

The check runs as a scheduled read-only job emitting counts per invariant plus a
row-level violation table. It ships in **alert-only mode for all four**, because
an invariant that fires 941 times on day one trains its readers to ignore it.
Gates get promoted per-invariant as each backlog is cleared, on the same
promotion discipline `CLAUDE.md` already applies to the e2e suite.

---

## 4. Piece 2: auto-repair for the decidable tier, quarantine for the rest

### The live blast radius being repaired

23 rows whose CIK belongs to a different company, measured against prod:

| row | ticker | sec_cik | mentions | filings | insider | the CIK actually is |
|---|---|---|---|---|---|---|
| HP Inc. | HP | 46765 | 102 | 4 | 2 | Helmerich & Payne |
| CSL | CSL | 790051 | 105 | 2 | 0 | Carlisle Companies |
| RBC | RBC | 1324948 | 44 | 3 | 0 | RBC Bearings |
| Fidelity | FIS | 1136893 | 41 | 9 | 1 | Fidelity National Information Services |
| GIC | GIC | 945114 | 22 | 3 | 1 | Global Industrial |
| Zip Co | ZIP | 1617553 | 22 | 4 | 3 | ZipRecruiter |
| Tencent | TME | 1744676 | 21 | 0 | 0 | Tencent Music |
| Revolut | RVMD | 1628171 | 15 | 10 | 6 | Revolution Medicines |
| PMI | PMI | 2030617 | 10 | 3 | 0 | Picard Medical |
| Ardian | GRDN | 1802255 | 8 | 7 | 0 | Guardian Pharmacy |
| Coke | COKE | 317540 | 7 | 2 | 0 | Coca-Cola Consolidated |
| LIC | RSG | 1060391 | 6 | 10 | 50 | Republic Services |
| Go Inc. | GO | 1771515 | 5 | 3 | 1 | Grocery Outlet |
| YC | PAYX | 723531 | 4 | 6 | 0 | Paychex |
| Providence | NPAC | 2048948 | 4 | 1 | 0 | New Providence Acq. III |
| Arbor / Claro / Also / GAC / Ola / Avance / Fera | CLH / CMTG / COSO / GCT / KO / TBPH / FERA | | 2 each | 3/3/3/5/9/3/1 | 0/1/0/4/11/0/0 | Clean Harbors / Claros Mortgage / CoastalSouth / GigaCloud / Coca-Cola / Theravance / Fifth Era |
| Gett | RGTI | 1838359 | 1 | 6 | 2 | Rigetti |
| **total** | | | **432** | **100** | **82** | 22 of 23 serve live SEC data |

The brief said six rows, 42 filings, 16 insider rows. **Measured today: 23 rows,
100 filings, 82 insider rows.** The brief's figure is a subset, not a total.

`Ola`[KO] and `LIC`[RSG] are the same rows `sql/proposals/0037` already
identified as interior-fragment names, which is corroboration from an
independent investigation: 0037 found them by screening ticker-vs-name letter
subsequence, this design found them by screening CIK-vs-registrant name.

### The tiers

**Tier A, DECIDABLE, auto-repairable: an authority settles it.**
Trigger: I1 or I4 fires, and the SEC registrant name for the held CIK
unambiguously names a company that is not this row. The repair is
`sec_cik := NULL` and `ticker := NULL` on the row that does not own the
identifier. It is a **retraction, never a reassignment.** Nothing is invented.

Why retraction only: `sql/proposals/0037` establishes there is no name oracle in
this database, and demonstrates what inventing one costs ("Howmet Aerospace"
renamed to "Meta"). Guessing the *right* CIK for `Revolut` requires knowing
Revolut is private and has none. Retraction requires knowing only that `RVMD` is
Revolution Medicines, which `cik_tickers` states directly.

Bound: at most 23 rows today. Effect: 100 filings and 82 insider rows detach
from the wrong company page. They do not reattach anywhere; they become
unreferenced, which is correct, because the row that should hold them either
does not exist or is the other half of a duplicate pair that Tier B handles.

**Tier B, DECIDABLE, auto-repairable: duplicate rows carry non-conflicting
identity.**
Trigger: I2 or I4 fires on a bucket with **exactly one** identifier carrier and
zero conflicts. Repair: fold the identifier-less rows onto the carrier via the
0020b `moved_row` machinery, and write an alias for each absorbed name.

Bound today: 499 v2 buckets (1,431 rows, 11,884 mentions), plus the 16
ticker-collision groups where one side has no CIK. `Rigetti`/`Gett` is Tier B on
the ticker axis after Tier A retracts `Gett`'s CIK: once `Gett` holds nothing,
`Rigetti` is the sole carrier.

Explicitly **out** of Tier B: the 325 zero-carrier buckets (790 rows). Nothing
decides which of `BYD Co.` / `BYD Company Limited` / `BYD COMPANY` / `BYD Co Ltd`
/ `BYD` survives when none holds an identifier. That is survivor election, which
is `sql/proposals/0035`'s job, not this one's.

**Tier C, QUARANTINE. Everything else.** Written to a quarantine table with the
firing invariant and the evidence, never auto-changed, surfaced for review.

Populated today by:
- the 3 v2 buckets with 2+ agreeing carriers (dedup, but which row survives is
  an election)
- the 1 bucket with disagreeing carriers: `'hp'`, where `HP`(Helmerich & Payne)
  and `HPQ`(HP Inc) both claim the key and one of them is right
- the ~71 I1 false alarms (`Meta`, `AMD`, `IBM`, `Truist`, `Apple`-shaped rows)
- every I1 hit where the registrant name is a *successor* rather than a
  different company: `TopBuild Corp.`[BLD] -> "QXO Insulation, LLC",
  `MSTR` -> "Strategy Inc", `Raytheon`[RTX] -> "RTX Corp",
  `Allbirds`[BIRD] -> "Smartbird, Inc.". These are renames at SEC, not
  cross-wires, and no automatic rule distinguishes an acquisition from an error.

`Coke`[COKE] -> Coca-Cola Consolidated is deliberately Tier C, not Tier A. 0037
already documented that "Coca-Cola Consolidated" is a genuinely different
company from KO and that sweeping them together corrupts 42 articles while
fixing 102. The same trap applies here in the other direction.

### Sequencing inside the repair

Tier A runs before Tier B, always. Tier B elects a survivor by identifier
strength; if a cross-wired row still holds a CIK when the election runs, it can
win a bucket it has no claim to. `Gett` is the worked example: at 1 mention it
loses a mention-count election but wins an identity-first election, because
until Tier A retracts it, it is the only CIK holder in its ticker group.

---

## 5. Piece 3: the ledger

Shape follows `norm_v2.moved_row` (`sql/proposals/0020b:232`) and the operating
discipline of `public.articles_companies_backfill` (`sql/0029`), extended with
the three fields those two are missing: **why**, **which invariant**, and **what
evidence**.

```
entity_integrity.repair_ledger
  id            bigserial primary key
  run_id        uuid        not null      -- one per check cycle
  invariant     text        not null      -- 'I1'|'I2'|'I3'|'I4'
  tier          text        not null      -- 'A'|'B'|'C'
  table_name    text        not null
  row_id        text        not null      -- text, any pk type (0020b precedent)
  column_name   text        not null
  value_before  jsonb       not null      -- reversal source
  value_after   jsonb       not null      -- drift guard
  authority     text        not null      -- 'cik_tickers.company_name' | 'sec.gov/company_tickers.json'
  evidence      text        not null      -- the registrant name and ratio that decided it
  applied_at    timestamptz not null default now()
  applied_by    text        not null default current_user
  unique (table_name, row_id, column_name, run_id)
```

Four properties, each inherited from a precedent that earned it:

1. **Reversible in one statement**, per column, per run:
   `UPDATE <table_name> SET <col> = value_before WHERE id = row_id AND
   <col> = value_after`. The `value_after` predicate is the drift guard from
   `sql/0029` section 2: a row the pipeline rewrote after the repair is left
   alone rather than clobbered.
2. **`value_before` and `value_after` both stored.** 0020b's `moved_row` stores
   `from_company_id`/`to_company_id` for the same reason: a reversal must be able
   to verify it is undoing its own work.
3. **`authority` and `evidence` are mandatory.** This is the field `moved_row`
   lacks and the reason `articles_companies_backfill` row 1 was catchable at all.
4. **Tier C writes rows too**, with `value_after = value_before`. A quarantine
   decision is a decision and it needs the same audit trail as a change. This is
   also what makes the check's own false-positive rate measurable over time.

`financial_facts` (1.44M rows) stays out of the journal, following 0020b's
explicit one-way carve-out.

### Row 1 of `articles_companies_backfill`, verified

The brief cites this as the precedent. It reproduces, and it is sharper than
advertised:

```json
{"id": 1, "run_id": "338fe453-382b-4d67-a228-2734125031a6",
 "primary_company": "Fidelity National Information Services Inc",
 "resolved_name": "Fidelity",
 "companies_before": ["Fidelity National Information Services Inc"],
 "companies_after":  ["Fidelity National Information Services Inc", "Fidelity"],
 "applied_at": "2026-08-17T13:39:27Z"}
```

The fold appended the short name `Fidelity` to an article about FIS. The
companies row `'Fidelity'` carries `ticker=FIS, sec_cik=1136893`, and it is
**independently one of the 94 I1 violations** (registrant "Fidelity National
Information Servic...", ratio 0.348). Two checks that share no inputs land on
the same row.

Precise about what is wrong with it: the *identity* is arguably right (FIS is
Fidelity National Information Services). The *name* is not usable as one, because
"Fidelity" in financial news overwhelmingly means Fidelity Investments, a
different and private company. So the fold trains a name-keyed corpus to route
Fidelity Investments coverage onto FIS's filings. It is a false fold in effect,
and the brief's core claim holds exactly: **the only reason it is visible is that
`resolved_name` was written down.** Without `resolved_name` the row is
indistinguishable from the 30,706 correct ones. That is the entire argument for
piece 3.

---

## 6. Prevention, and the required ORDER

Prevention is two constraints plus 23505 handling:

- `companies.sec_cik` UNIQUE partial index. This is `sql/proposals/0036`. Gate
  confirmed open today: 793 CIK-bearing, 793 distinct, 0 duplicate groups.
- `companies.<normalized name key>` UNIQUE index. **Does not exist as a
  proposal.** Gate closed: 499 v2 violations. Requires deciding which normalizer
  is canonical and then storing it, since v2 is currently documented
  "READ-ONLY. Never store this value."
- 23505 handled as a lost race at `cik_mapping.py:94`, with a ledger row rather
  than the current silent swallow. **Not** at `entity_resolver.py:528`, which is
  unreachable (section 1a).

### The order, and what breaks if it is violated

**Step 1. The ladder** (`resolve_entity` gains lookup surfaces beyond exact
`aliases.lookup_key`; Track A).

*Must precede the name constraint* because the constraint's failure mode is an
insert refusal. Today the miss path **creates a company** (`sql/proposals/0020`
header states this explicitly: "the miss path in
`backend/entity_resolver.py` CREATES A COMPANY"). Add a unique name key while the
resolver still misses on `"Franklin BSP Realty Trust"` vs
`"Franklin BSP Realty Trust, Inc."`, and every such ingest raises 23505 on a name
the resolver cannot resolve. The ladder converts those from creations into
resolutions, so there is nothing left to collide.

*Violate it:* ingest throws 23505 on names it cannot resolve, and because
`cik_mapping.py:96` and `entity_resolver.py:434-442` swallow duplicate-shaped
exceptions, it throws them **silently**. You lose entities without a log.

**Step 2. The integrity check, alert-only** (piece 1).

*Must precede repair* because 3 of 4 invariants fire in the hundreds today, and
you cannot tell a real regression from the standing backlog without a baseline.
This is the same discipline `CLAUDE.md` already applies to e2e: differential
against a known floor, not absolute green.

*Violate it:* the repair has no way to prove it improved anything, and the first
post-repair alert storm is indistinguishable from the pre-repair one.

**Step 3. Tier A retraction, then Tier B fold** (piece 2), both writing the
ledger (piece 3) from the first row.

*Tier A must precede Tier B* because Tier B elects survivors by identifier
strength, and a cross-wired row still holding a CIK can win a bucket it has no
claim to (`Gett`).

*Both must precede the constraints* because the constraints cannot be applied
over 499 violations at all. `CREATE UNIQUE INDEX` on a violated key does not warn,
it fails.

*Violate it:* `CREATE UNIQUE INDEX CONCURRENTLY` fails and leaves an **INVALID**
index that must be dropped before retrying. 0036 phase 1c exists to detect
exactly that state.

**Step 4. The constraints.** `sec_cik` unique (0036, already open) and the
normalized-name unique index (open only after step 3).

*Must precede the finite backfill* because otherwise the backfill is a snapshot.
This is 0036's own argument, restated: without the constraint, "the next pipeline
run can mint a second row carrying the same CIK and the duplicate class
reopens."

*Violate it:* you get exactly what this program has had all year, a repair that
decays. The 11 rows minted during this session are the proof.

**Step 5. One finite backfill**, closing whatever the constraint now makes
impossible to recreate.

*Last, because it is the only step that is finite.* Steps 1 to 4 change the
steady state; step 5 cleans the residue once, and the constraint keeps it clean.

*Violate it (run it earlier):* it is not wrong, it is wasted. The job that
created the problem is still running, so the backfill's output starts decaying
the moment it commits.

**Additional ordering constraint from outside this design:**
`sql/proposals/0037` PHASE 0 **refuses to run** if any `entity_merge` plan has an
approved cluster or any `companies.merged_into` tombstone exists. Any name repair
must therefore land before step 3 or after step 3 has fully rolled back. This is
a hard interlock already coded into 0037, not a preference.

---

## 7. Costed plan

**Total 6.5 build-weeks.** Piece 1, the integrity check, is **2 weeks**: one week
for the four invariant queries plus the paginated readers that the whole program
keeps getting wrong (`cik_mapping.py:73` is the third instance of an unpaginated
`.execute()` in this codebase), one week for the alert-only harness, the
per-invariant baseline, and the promotion gate. Piece 2, tiered auto-repair, is
**2.5 weeks**: 0.5 for Tier A retraction (23 rows, bounded, the authority join is
already written), 1.5 for Tier B fold (reuses 0020b's `moved_row` and repointing
functions rather than reimplementing them), 0.5 for the quarantine table and its
review surface. Piece 3, the ledger, is **1 week**, most of it spent on the
reversal path and its drift guard rather than the DDL, because the DDL is a
lightly extended copy of `moved_row`. Prevention, meaning 23505 handling at
`cik_mapping.py:94` plus a mention-gate or name-verification gate at
`resolveOrCreateCompany.ts:216`, which is where the bad tickers actually enter,
is **1 week**. **What a human must still do, permanently:** adjudicate Tier C,
which today means the 1 disagreeing `'hp'` bucket, the 3 agreeing multi-carrier
buckets, the ~71 I1 false alarms and the SEC-rename cases, plus the 325
zero-carrier buckets that belong to `0035` survivor election; approve and apply
every migration, since agents never apply migrations here; and make the one
architectural decision this design cannot make for itself, namely **which
normalizer becomes canonical and stored**, because that single choice moves the
name-constraint backlog between 1 and 499. **What becomes automatic:** detection
of all four invariants every cycle instead of by hand-investigation; retraction
of any future cross-wire within one cycle rather than one quarter; folding of
single-carrier duplicates as they appear, which is the 499-bucket, 11,884-mention
backlog that grew by two buckets during the session that designed this; a
reversal path for every automatic change; and, after step 4, structural
impossibility rather than repairability for both duplicate CIK holders and
duplicate normalized names.

**Firmest estimate:** piece 3, the ledger. It is a near-copy of a shape that
already exists twice. **Softest:** Tier B, because it depends on `0020b` and
`0035` landing, and neither is on main today.
