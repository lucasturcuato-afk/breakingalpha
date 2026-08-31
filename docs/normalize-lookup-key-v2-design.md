# normalize_lookup_key v2: suffix + punctuation folding

Status: DESIGN ONLY. Nothing in this branch has been applied. No product code
changed, no migration run. Every number below came from read-only SELECTs
against the prod Supabase on 2026-07-26.

Companion SQL: `sql/proposals/0020_normalize_lookup_key_v2.sql` (written, NOT run).

---

## 1. Recon: what normalize_lookup_key is today

### 1.1 There is no SQL function

Checked `pg_proc` for anything matching `%normalize%` or `%lookup_key%`. The only
hits are Postgres builtins (`normalize`, `is_normalized`) and pgvector
(`l2_normalize`). **No `normalize_lookup_key` exists in the database.** The key
is computed entirely in application code and written as a plain `text` column.

That matters: the DB has no way to recompute or validate a key, so every writer
must independently produce the identical string. Today there are three
independent implementations.

### 1.2 The Python source of truth

`backend/normalize.py`:

```python
def normalize_lookup_key(s: str) -> str:
    s = s.replace("™", "").replace("®", "").replace("©", "")
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("’", "'").replace("‘", "'")
    s = s.replace("“", '"').replace("”", '"')
    s = s.strip().lower()
    return s
```

### 1.3 TS mirror #1

`src/lib/normalize-lookup-key.ts`:

```ts
export function normalizeLookupKey(s: string): string {
  let out = s
    .replace(/™/g, "")
    .replace(/®/g, "")
    .replace(/©/g, "");
  out = out.normalize("NFKC");
  out = out.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
  return out.trim().toLowerCase();
}
```

### 1.4 TS mirror #2 (duplicate module, same logic)

`src/lib/normalize.ts`:

```ts
export function normalizeLookupKey(s: string): string {
  s = s.replace(/[™®©]/g, "");
  s = s.normalize("NFKC");
  s = s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  return s.trim().toLowerCase();
}
```

All three are logically identical. All three do: strip TM/R/C, NFKC, fold curly
quotes, trim, lowercase. **None strips corporate suffixes. None strips
punctuation. None collapses internal whitespace.** So `Caterpillar`,
`Caterpillar Inc`, and `Caterpillar Inc.` are three distinct keys, exactly as the
PR 508 recon reported.

Two TS copies is itself a latent defect: a v2 change that lands in one and not
the other silently reintroduces divergence. Both are live (`normalize.ts` feeds
`src/app/api/companies/route.ts`, `normalize-lookup-key.ts` feeds
`resolveOrCreateCompany.ts`).

---

## 2. Every read and write path on the key

### Writers (produce `aliases.lookup_key`)

| Path | File | Behavior |
|---|---|---|
| Pipeline entity resolution | `backend/entity_resolver.py:119` → `:233` | `lookup_key = normalize_lookup_key(surface_form)`, inserted on miss |
| Pipeline resolution log | `backend/entity_resolver.py:538,552` | writes `lookup_key` into `resolution_log` |
| Alias backfill script | `backend/scripts/backfill_aliases.py:173,266` | upserts `on_conflict=lookup_key,canonical_id` |
| Frontend on-demand resolve | `src/lib/data-access/resolveOrCreateCompany.ts:141-150` | upserts `{lookup_key, canonical_id}`, `onConflict: "lookup_key,canonical_id"` |

### Readers (consume `aliases.lookup_key`)

| Path | File | Behavior |
|---|---|---|
| Pipeline resolution | `backend/entity_resolver.py:126` | `.eq("lookup_key", lookup_key)`, the hit-one / hit-many / miss branch |
| Frontend dedup guard | `src/lib/data-access/resolveOrCreateCompany.ts:191-195,240` | `.eq("lookup_key", lookupKey)` before creating a company |
| Company search API | `src/app/api/companies/route.ts:120-124` | `.eq("lookup_key", lookupKey)` |
| SEC filings resolver | `src/lib/sec-filings.ts:118` | `.ilike("lookup_key", k)`, note: ILIKE, not eq |
| Web fallback banner | `src/components/company/states/WebFallbackBanner.tsx:19` | displays the canonical name resolved via the key |

### Schema constraints in play

From `supabase/migrations/20260503235700_w2a_aliases_resolution_log.sql`:

```sql
CONSTRAINT aliases_lookup_canonical_unique UNIQUE (lookup_key, canonical_id)
CREATE INDEX aliases_lookup_key_idx ON aliases (lookup_key);
```

There are **no foreign keys** anywhere pointing at `companies.id` or
`aliases.id`. Every `company_id` / `canonical_id` reference is logical only,
enforced by nothing. Confirmed by querying
`information_schema.table_constraints` for FKs touching `companies`/`aliases`:
zero rows. A merge therefore cannot rely on `ON DELETE CASCADE` or on the DB
rejecting an orphan. Repointing is entirely the migration's job.

### Tables carrying a logical company reference

| Table | Column | Live rows |
|---|---|---|
| `aliases` | `canonical_id` | 5,488 |
| `company_mentions` | `company_id` | 88,491 |
| `financial_facts` | `company_id` | 1,437,922 |
| `financial_facts_latest` | `company_id` | (view/table over financial_facts) |
| `insider_transactions` | `company_id` | 2,722 |
| `sec_filings` | `company_id` | 2,069 |
| `user_memo_regeneration_quota` | `company_id` | 6 |
| `resolution_log` | `resolved_canonical_id`, `candidate_canonical_ids` | 3,505 |
| `user_events` | `entity_id` | 1 non-null |

`financial_facts` at 1.44M rows is the reason a merge must be batched and
must not hold a long exclusive lock.

---

## 3. Does changing the key require re-keying stored rows?

Yes, and the failure mode is specific.

`aliases.lookup_key` is a **stored, denormalized** copy of the function output.
Change the function without re-keying and the resolver's `.eq("lookup_key", k)`
starts computing v2 keys and comparing them against v1 rows in the table. For the
1,702 company rows (and 2,172 alias rows) whose key changes, every lookup becomes
a **miss**, and the miss path in `entity_resolver.py:181` *creates a new
company*. Code-only deploy therefore does not fix duplicates; it doubles them.

Measured impact of a naive re-key (`UPDATE aliases SET lookup_key = v2(...)`):

| Metric | Value |
|---|---|
| alias rows total | 5,488 |
| alias rows whose key changes | 2,172 |
| alias rows re-keying to empty string | 0 |
| rows violating `UNIQUE(lookup_key, canonical_id)` | **518** |
| keys that become hit-many (same key, >1 canonical) | **686** |
| keys that are hit-many today | 1 |

So the naive `UPDATE` **aborts on the unique constraint** partway through. Any
re-key must fold the 518 intra-canonical duplicates first.

### What breaks during the window

Between the key change and the merge completing:

1. **686 keys go hit-many.** `entity_resolver.py:147-166` handles this, it
   tiebreaks on `max(mention_count)` and writes a `was_ambiguous=True`
   `resolution_log` row. Not a crash, but resolution becomes nondeterministic
   across the two duplicate canonicals and `resolution_log` volume spikes.
2. **`src/lib/sec-filings.ts:118` uses `.ilike(...).limit(10)`** and takes what
   it gets. With hit-many keys it can bind a filing to the losing canonical.
3. **`src/app/api/companies/route.ts:120`** returns whichever alias row comes
   back first; company search results flip between duplicates.
4. **Code/data skew.** Python, TS mirror #1, and TS mirror #2 must all ship v2
   in the same deploy. If the Vercel deploy and the pipeline cron cut over at
   different times, the lagging writer inserts v1 keys into a v2 table.

Ordering that avoids all four: **merge first, then cut code over.** See §7.

---

## 4. The v2 rules

Applied after the existing v1 steps, in this order:

1. v1 steps unchanged: strip `™ ® ©`, NFKC, fold curly quotes, trim, lowercase.
2. **Delete** `.` `'` `’` outright (no space). `Inc.` → `inc`, `L.L.C.` → `llc`,
   `Moody's` → `moodys`.
3. **Replace** every remaining `[[:punct:]]` char with a space. `Archer-Daniels-Midland`
   → `archer daniels midland`, `PG&E` → `pg e`.
4. **Collapse** runs of whitespace to one space, trim.
5. **Strip trailing corporate suffix tokens**, repeatedly, up to 3 passes:
   `inc | incorporated | corp | corporation | co | company | llc | ltd | limited |
   plc | sa | ag | nv | ab | holdings | group`
   The match requires a preceding space, so a single-token name that *is* a
   suffix word (`Group`) is never emptied.
6. **Empty guard**: if step 5 produces `''`, fall back to the step-4 output.

Accents are still preserved (`Estée Lauder` → `estée lauder`), matching the v1
spec and `backend/tests/test_normalize.py:56`.

Three passes is enough for the worst real case in the data:
`Kioxia Holdings Corp.` → `kioxia holdings corp` → `kioxia holdings` → `kioxia`.

---

## 5. Measured effect on real data

All counts are `SELECT`-derived, not estimated.

| Metric | Value |
|---|---|
| `companies` rows | 4,865 |
| distinct v1 keys | 4,864 (1 duplicate cluster today) |
| distinct keys after punctuation rules only | 4,562 |
| distinct v2 keys | **3,763** |
| duplicate clusters under v2 | **677** |
| company rows sitting in those clusters | **1,779** |
| rows absorbed (i.e. rows eliminated by merge) | **1,102** |
| company rows whose key string changes at all | 1,702 |

Attribution: punctuation rules alone produce 265 clusters / 303 absorbed rows.
Suffix stripping adds 412 clusters / 799 absorbed rows. Suffix stripping is
where the value is.

The PR 508 recon quoted 678 clusters / 1,795 rows. This design measures 677 /
1,779. The 1-cluster and 16-row delta is the exact suffix list and the empty
guard; both figures describe the same phenomenon.

### 5.1 Twenty real clusters, before → after

`new_key` on the left, then each member's current v1 key.

| # | v2 key | n | v1 keys collapsed |
|---|---|---|---|
| 1 | `samsung electronics` | 6 | `samsung electronics`, `samsung electronics co`, `samsung electronics co ltd`, `samsung electronics co.`, `samsung electronics co. ltd.`, `samsung electronics co., ltd.` |
| 2 | `archer daniels midland` | 5 | `archer daniels midland`, `archer daniels midland co.`, `archer daniels midland company`, `archer-daniels-midland`, `archer-daniels-midland company` |
| 3 | `byd` | 5 | `byd`, `byd co ltd`, `byd co.`, `byd company`, `byd company limited` |
| 4 | `cf industries` | 5 | `cf industries`, `cf industries holdings`, `cf industries holdings inc`, `cf industries holdings inc.`, `cf industries holdings, inc.` |
| 5 | `curtiss wright` | 5 | `curtiss wright`, `curtiss-wright`, `curtiss-wright corp`, `curtiss-wright corp.`, `curtiss-wright corporation` |
| 6 | `exxonmobil` | 5 | `exxonmobil`, `exxonmobil corporation`, `exxonmobil holdings`, `exxonmobil holdings corp`, `exxonmobil holdings corporation` |
| 7 | `mitsubishi ufj financial` | 5 | `mitsubishi ufj financial`, `... group`, `... group inc`, `... group inc.`, `... group, inc.` |
| 8 | `nomura` | 5 | `nomura`, `nomura holdings`, `nomura holdings inc`, `nomura holdings inc.`, `nomura holdings, inc.` |
| 9 | `o i glass` | 5 | `o i glass`, `o-i glass`, `o-i glass inc`, `o-i glass inc.`, `o-i glass, inc.` |
| 10 | `parker hannifin` | 5 | `parker hannifin`, `parker hannifin corp`, `parker-hannifin`, `parker-hannifin corp`, `parker-hannifin corporation` |
| 11 | `patterson uti energy` | 5 | `patterson uti energy`, `patterson-uti energy`, `patterson-uti energy inc`, `patterson-uti energy inc.`, `patterson-uti energy, inc.` |
| 12 | `petrochina` | 5 | `petrochina`, `petrochina co`, `petrochina co ltd`, `petrochina company`, `petrochina company limited` |
| 13 | `sherwin williams` | 5 | `sherwin williams`, `sherwin-williams`, `sherwin-williams co`, `sherwin-williams co.`, `sherwin-williams company` |
| 14 | `softbank` | 5 | `softbank`, `softbank corp`, `softbank corp.`, `softbank group`, `softbank group corp.` |
| 15 | `advantest` | 4 | `advantest`, `advantest corp`, `advantest corp.`, `advantest corporation` |
| 16 | `albany international` | 4 | `albany international`, `albany international corp`, `albany international corp.`, `albany international corporation` |
| 17 | `altria` | 4 | `altria`, `altria group`, `altria group inc`, `altria group, inc.` |
| 18 | `american express` | 4 | `american express`, `american express co`, `american express co.`, `american express company` |
| 19 | `apa` | 4 | `apa`, `apa corp`, `apa corp.`, `apa corporation` |
| 20 | `goldman sachs` | 4 | `goldman sachs`, `goldman sachs group`, `goldman sachs group inc`, `goldman sachs group, inc.` |

All twenty are correct merges.

---

## 6. Wrong-merge risk: clusters that must NOT be auto-merged

This is the destructive part. A merge is irreversible in effect even if
reversible in data, because downstream memos and briefs will have been
regenerated against the merged entity.

### 6.1 How I searched

Four independent sweeps over the 677 clusters:

1. **Hard identity conflict.** Cluster members with more than one distinct
   non-null `sec_cik`, or more than one distinct non-null `ticker`. CIK is the
   strongest available identity signal. → **1 cluster**.
2. **Short / single-token keys.** Every cluster whose v2 key is ≤5 chars or has
   no space (acronyms, where collision probability is highest). → 60 clusters
   with key ≤4 chars, 310 single-token clusters; all inspected by eye.
3. **Semantically load-bearing suffix strip.** Every cluster where at least one
   member had `holdings`, `group`, `co`, or `company` stripped AND the cluster
   contains more than one distinct pre-strip form, i.e. the suffix is what
   caused the merge, not just formatting. 87 rows across the cluster set;
   listed and inspected.
4. **Sector conflict.** Cluster members carrying different `sector` values, as a
   proxy for "these are not the same business".

Below is everything those sweeps surfaced. Nothing here should merge without a
human ticking it off.

### 6.2 CONFIRMED wrong merge, hard evidence

**`hp`**, two CIKs, two tickers, genuinely different companies:

| name | ticker | sec_cik | mentions |
|---|---|---|---|
| `HP Inc` | HPQ | 47217 | 48 |
| `HP Inc.` | HP | 46765 | 63 |

CIK 47217 is HP Inc (the PC/printer company). CIK 46765 is Helmerich & Payne
(the drilling contractor, ticker HP). The second row is already mislabeled
upstream, but v2 would fuse them into one entity and the higher mention_count
(63) would make the *wrong* one the survivor. **Block this cluster.**

Note this one merges on the **punctuation rule alone** (`hp inc` vs `hp inc.`),
not the suffix rule. It is not avoidable by trimming the suffix list.

### 6.3 HIGH risk, different businesses, no CIK to prove it

| v2 key | members | why |
|---|---|---|
| `bain` | `Bain` [BCSF] / `Bain & Co` (Financial Services) | BCSF is Bain Capital Specialty Finance, a listed BDC. Bain & Company is the private consultancy. Different entities. |
| `hg` | `Hg` [HG] (Technology) / `HG Holdings, Inc.` (Financial Services) | Hg is the UK software PE firm. HG Holdings Inc is a separate listed company. Sectors disagree. |
| `eqt` | `EQT` [EQT, cik 33213] (Financial Services) / `EQT Holdings Ltd.` (Energy & Oil/Gas) | EQT AB (Swedish PE) and EQT Corporation (US natural gas) are unrelated. Sectors disagree, and the row labeled Financial Services carries EQT Corporation's CIK, already confused. |
| `genius` | `Genius` (no sector, 1 mention) / `Genius Group` [GNS, cik 1847806] (Technology) | Genius Sports and Genius Group are different listed companies. The bare `Genius` row has no identity evidence either way. |
| `go` | `Go` (Technology, 2 mentions) / `Go Inc.` [GO, cik 1771515] (Technology) | CIK 1771515 is Grocery Outlet Holding. `Go Inc.` is already a mislabeled row; merging a generic `Go` into it compounds the error. |
| `zip` | `Zip` (Financial Services, 14) / `Zip Co` [ZIP, cik 1617553] (Financial Services) | CIK 1617553 is ZipRecruiter. The name `Zip Co` is the Australian BNPL firm. Two companies already conflated in one row. |
| `cpb` | `CPB` [CPB, cik 16732] / `CPB Inc.` (no identity) | CIK 16732 is Campbell Soup. `CPB Inc.` is plausibly Central Pacific Bank. No evidence to merge. |
| `x` | `X` (Technology, 21 mentions) / `X Corp.` (1 mention) | Probably both X/Twitter, but bare `X` is also US Steel's ticker. Low confidence either way. |

### 6.4 MEDIUM risk, parent/subsidiary, judgment call

| v2 key | members | note |
|---|---|---|
| `ubs` | `UBS` [UBS, cik 1610520] / `UBS AG` / `UBS Group AG` | UBS Group AG is the parent, UBS AG the bank subsidiary. Legally distinct, almost certainly the same thing for our purposes. Recommend merge, but it should be an explicit tick. |
| `tata` | `Tata` (5 mentions) / `Tata Group` (1) | `Tata` bare could mean Tata Motors or TCS rather than the conglomerate. |
| `exxonmobil` | includes `ExxonMobil Holdings`, `ExxonMobil Holdings Corp`, `ExxonMobil Holdings Corporation` | "ExxonMobil Holdings" is not a real entity; these look like model-hallucinated names. Merging is right, but flag that the source produced fake legal names. |
| `ig` | `IG Group` / `IG Group Holdings Plc` | Same company. Included only because `group` is a load-bearing strip. |

### 6.5 Merges that are correct but where survivor choice is dangerous

These clusters should merge, but the highest-`mention_count` row carries a
**wrong ticker or CIK** that must not be promoted onto the survivor:

| v2 key | contaminated row | bad identity |
|---|---|---|
| `axt` | `AXT Inc.` | ticker `BAX`, cik `10456`, that is Baxter International, not AXT |
| `xai` | `xAI` | ticker `XFLT`, that is the XAI Octagon closed-end fund, not xAI |

The migration therefore picks the survivor by mention_count but **does not
propagate ticker/sec_cik** from a loser onto the survivor, and quarantines any
cluster where members disagree on a non-null ticker or CIK (§6.2 rule).

### 6.6 Known non-fixes

v2 does **not** collapse internal spacing differences. `ExxonMobil` and
`Exxon Mobil` remain two keys, so `Exxon Mobil Holdings` and `ExxonMobil
Holdings` stay in separate clusters. Fixing that means space-stripping, which
would fuse far more distinct names (`Go Pro` / `Gopro` is fine; `Sea Ltd` /
`Seal td` is not). Out of scope, documented deliberately.

---

## 7. Rollout order

1. **Ship the SQL function** `normalize_lookup_key_v2` (phase 1 of the SQL).
   Pure addition, no behavior change.
2. **Materialize the plan table** and hand it to a human. Nothing mutates.
3. **Human review**: flip `approved = true` per cluster. Everything in §6.2–§6.4
   stays `false` unless explicitly cleared.
4. **Run the merge** on approved clusters only, in batches.
5. **Only then** cut Python + both TS mirrors to v2, in one deploy, with the
   pipeline cron paused across the deploy.

Doing 5 before 4 turns the 686 hit-many keys into duplicate-creation events.

---

## 8. Parity requirement

Because there is no DB-side enforcement, v2 must land in four places with
byte-identical output:

- `backend/normalize.py`
- `src/lib/normalize-lookup-key.ts`
- `src/lib/normalize.ts`
- `normalize_lookup_key_v2()` in Postgres

`backend/tests/test_normalize.py` should gain a shared fixture table exercised by
both the Python tests and a SQL assertion, so drift fails a test rather than
silently splitting the index. Consolidating the two TS modules into one is
strongly recommended before v2 lands.

---

## 9. Known out of scope: leading-word variants stay split

Added 2026-08-30, after the section 1 punctuation fix.

`lookup_key_v2` folds trailing corporate suffixes and punctuation. It does
nothing about a differing LEADING word, so these remain three clusters over one
company:

| key | rows | mentions | identity |
|---|---|---|---|
| `disney` | Disney, Disney+ | 192 | DIS, cik 1744489 |
| `walt disney` | Walt Disney, Walt Disney Co | 40 | none |
| `disney entertainment` | Disney Entertainment | 1 | none |

**This is the same class of problem the migration exists to fix**, and it is
worth stating plainly rather than leaving implied: the canonical Disney row
carries the ticker and 189 mentions, while 41 mentions sit on rows that resolve
to nothing. After the merge runs, a `companies[]`-based query for Disney still
misses them.

Deliberately NOT addressed here. Stripping a leading "The" was measured and
rejected during 0020b (zero rows recovered, 65 new ambiguous collisions), and a
general leading-word rule is strictly harder: `walt disney` -> `disney` is
correct, but the same rule collapses `general electric` onto `electric` and
`american express` onto `express`. It needs its own measurement pass and its own
review queue, not a clause bolted onto this one.

The tractable version is narrower and probably where to start: fold a cluster
into another when one key is a strict token-suffix of the other AND exactly one
of the two carries identity. That covers Disney and misses General Electric,
because `electric` is not a cluster. Unmeasured; treat as a hypothesis.

Sibling cases live in the same shape: check `alibaba` / `alibaba group holding`,
`rocket lab` / `rocket lab usa`, `moodys` / `moodys ratings`, and
`the coca cola` / `coca cola femsa` before assuming Disney is the only one.
