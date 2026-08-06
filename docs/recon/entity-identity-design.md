# Identity-first entity resolution

Status: design only. Nothing here has been run. No migration, no product edit, no flag change.
Recon date: 2026-07-25. Base commit: `30e96431` (origin/main).
All database access for this document was SELECT only.

## 0. Why this document exists

Every previous fix for duplicate companies has been downstream cleanup: cluster
merges, unique indexes, and the `pickPreferCik` resolution fix. Duplicates
regenerate because the write path mints a company row from an article-extracted
name string and treats name equality as identity. Until identity stops being the
raw string, cleanup is a treadmill.

One correction to the framing up front, because it changes what needs fixing.

---

## 1. The reported symptom does not reproduce on CAT. It reproduces on TSM.

The premise was that four Caterpillar rows exist and the page resolves to a
CIK-less fragment. The database says otherwise. There is exactly one Caterpillar
row:

```
name         | ticker | sec_cik | mention_count
Caterpillar  | CAT    | 18230   | 197
```

The four Caterpillar entries visible in the page header are `aliases`, not
`companies` rows, and all three point at that single canonical row:

```
surface_form        | lookup_key          | mentions | canonical    | sec_cik
Caterpillar         | caterpillar         | 190      | Caterpillar  | 18230
Caterpillar Inc     | caterpillar inc     | 10       | Caterpillar  | 18230
Caterpillar Inc.    | caterpillar inc.    | 3        | Caterpillar  | 18230
```

Caterpillar is already correctly consolidated. Whatever produced the observed
`/company/CAT` empty state, it was not a CIK-less Caterpillar fragment, and a
fix aimed at that specific story would be aimed at nothing. Either the
observation predates a merge, or the failure came from a different path than
assumed. **Flagging as unresolved: the exact CAT reproduction was not
established.** What was established is that the underlying defect is real,
structural, and currently live on other tickers.

The defect: **the page and the API use different resolvers with different
tiebreakers.**

The API, `resolveCompanyCik` in `src/lib/sec-filings.ts:132`, prefers a
CIK-bearing row at every step:

```ts
// 2. Exact ticker: the CIK lives on the ticker'd row, so this is the most
//    reliable key when the caller has it.
if (ticker) {
  const { data } = await supabase.from("companies").select(COMPANY_COLS).ilike("ticker", ticker).limit(5);
  const row = pickPreferCik((data ?? []) as CompanyRow[]);
  if (row?.sec_cik != null) return toResolution(row);
}
...
// 3. Exact name (raw AND canonicalized), preferring a CIK-bearing match so a
//    null-CIK duplicate never shadows the filer row.
const nameRows = await matchCompaniesByName(supabase, [raw, canon]);
const directCik = pickPreferCik(nameRows);
```

The page, `resolveAlias` in `src/lib/data-access/aliasResolver.ts:76`, clusters
by ticker and then ranks by **mention count**, with no CIK preference anywhere:

```ts
if (ticker) {
  const { data: rows } = await supabase
    .from("companies")
    .select(RESOLVER_COLS)
    .eq("ticker", ticker);
  if (rows && rows.length > 0) cluster = rows as ResolverRow[];
}

const ranked = rankCluster(cluster);
const canonical = ranked[0];
```

```ts
function rankCluster(rows: ResolverRow[]): ResolverRow[] {
  return [...rows].sort((a, b) => {
    const am = a.mention_count ?? -1;
    const bm = b.mention_count ?? -1;
    if (bm !== am) return bm - am;   // mention count wins. sec_cik is never consulted.
    ...
```

`/company/[id]` reaches that code through
`getCompanyDetail(supabase, canonicalize(companyName))`
(`src/app/company/[id]/page.tsx:85`), and `getCompanyDetail` immediately calls
`resolveAlias` (`src/lib/data-access/getCompanyDetail.ts:97`).

So whenever a ticker is shared by a high-mention CIK-null row and a low-mention
CIK-bearing row, the page picks the CIK-less head and renders "SEC fundamentals
are not available", while the API picks the filer row and generates full
commentary. That is the reported symptom exactly. It is live right now on TSM:

```
ticker | members
TSM    | TSMC [m=439, cik=null] | Taiwan Semiconductor [m=201, cik=1046179]
PTON   | Peloton [m=26, cik=null] | Peloton Interactive Inc. [m=15, cik=1639825]
RGTI   | Rigetti [m=74, cik=null] | Gett [m=1, cik=1838359]
GEMI   | Gemini [m=21, cik=null] | Gemini Space Station, Inc. [m=17, cik=2055592]
NCLH   | Norwegian Cruise Line [m=129, cik=1513761] | NCLH [m=26, cik=null]
```

For TSM, PTON, RGTI and GEMI the CIK-null row has the higher mention count and
therefore wins `rankCluster`. Those four pages should be showing the empty state
today while the commentary API works.

**This mismatch is fixable in isolation and should be, before any of the larger
redesign below.** Making `rankCluster` prefer `sec_cik is not null` as its
primary key, ahead of mention count, aligns the page with `pickPreferCik`. It is
a few lines and it does not depend on the identity model changing.

---

## 2. Recon findings

### 2.1 Every path that inserts into `companies`

Three live paths, one dead.

**(a) Article ingest, live.** `backend/entity_resolver.py:368` `_try_insert_canonical`,
reached from `resolve_entity` step 5 when the alias lookup misses:

```python
    payload = {
        "name": name,
        "key_themes": themes or [],
        "sentiment_trend": sentiment,
        "mention_count": 0,
    }
    try:
        resp = supabase.table("companies").insert(payload).execute()
```

Trigger: any surface form extracted from an article whose `lookup_key` is not
already in `aliases`. Checks before insert: exactly one, an alias lookup on
`lookup_key`. There is no CIK check, no ticker check, no junk gate, and no
human. A new string equals a new company.

The gate is only as good as the normalizer, and the normalizer is weak.
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

It folds unicode and lowercases. It does **not** strip legal suffixes or
punctuation. So `caterpillar`, `caterpillar inc`, and `caterpillar inc.` are
three different keys, three different aliases, and absent a prior merge, three
different company rows. This single function is the mechanical cause of the
entire duplicate population.

**(b) On-demand ticker mint, live.** `src/lib/data-access/resolveOrCreateCompany.ts:214`:

```ts
  // (4) Genuinely new: insert ONE row via service-role. UNIQUE(name) is the
  // synchronization primitive; on a race (23505) re-select by name.
  const { data: inserted, error } = await svc
    .from("companies")
    .insert({ name, ticker: symbol, mention_count: 0 })
    .select("id, name, ticker")
    .maybeSingle();
```

Trigger: a user searches a ticker that resolves at the market-data provider but
has no local row. Checks first: id lookup, ticker lookup, alias lookup, name
lookup. Better than the ingest path, and it does set a ticker, but it still
writes no CIK, so it mints rows that are invisible to every CIK-keyed surface.

**(c) Backfill scripts, live but operator-run.** `backend/scripts/backfill_tickers.py`,
`backfill_sec_ciks.py`, `reconcile_sec_companies.py`, `backfill_aliases.py`,
`scripts/backfill_primary_fold.py`. These repair rather than mint, but they hold
write capability and are outside any gate a resolver would impose.

**(d) `upsert_company`, dead.** `backend/ingest.py:1817`, explicitly deprecated:

```python
# DEPRECATED: replaced by register_entity per docs/w2-a-entity-resolution-design.md section 5.
# Kept as dead code for one cron cycle to enable instant revert. Delete in a follow-up after validation.
def upsert_company(name, themes, sentiment):
```

The comment says one cron cycle. It is still here. Worth deleting as part of any
gating work, because a dead insert path is a live insert path the moment someone
calls it.

**TypeScript writes to `companies` outside `resolveOrCreateCompany`: none.** The
other `.from("companies")` sites in `src/` are selects.

### 2.2 The two read paths

Covered in section 1. Summarized:

| | page (`resolveAlias`) | API (`resolveCompanyCik`) |
|---|---|---|
| entry | `/company/[id]` via `getCompanyDetail` | `fetchCompanyFinancials({name})` |
| ticker step | `.eq("ticker", UPPER)`, first row | `.ilike("ticker", t)` then `pickPreferCik` |
| name step | `ilike` exact, order by mention_count | raw + canonicalized, then `pickPreferCik` |
| alias step | none | `matchCompaniesByAlias` then `pickPreferCik` |
| tiebreak | **mention_count** | **sec_cik present** |

Two resolvers, two answers, one product.

### 2.3 Duplicate scale (real counts, 2026-07-25)

| metric | value |
|---|---|
| `companies` rows | 4,865 |
| rows with `sec_cik` | 792 (16.3%) |
| rows with `sec_cik` null | 4,073 (83.7%) |
| rows with a ticker | 962 |
| distinct normalized-name keys | 3,748 |
| clusters where >1 row shares a normalized key | 678 |
| rows sitting inside those clusters | 1,795 (36.9% of the table) |
| rows failing a "specific named organization" test | 126 |

Normalization used for the key: lowercase, non-alphanumerics to space, drop the
tokens inc/incorporated/corp/corporation/llc/ltd/limited/plc/co/company/holdings/
holding/group/sa/nv/ag/se/the, collapse whitespace.

The 20 largest clusters by mention volume, showing the shape:

```
microsoft        3 rows, 1011 mentions | Microsoft [m=989, cik=789019] | Microsoft Corporation [m=14, cik=null] | Microsoft Corp [m=8, cik=null]
intel            2 rows,  924 mentions | Intel [m=918, cik=50863] | Intel Corp [m=6, cik=null]
goldman sachs    7 rows,  834 mentions | Goldman Sachs [m=722, cik=886982] | The Goldman Sachs Group, Inc. [m=71] | Goldman Sachs Group [m=15] | The Goldman Sachs Group [m=15] | Goldman Sachs Group Inc [m=6] | Goldman Sachs Group, Inc. [m=4] | The Goldman Sachs Group Inc [m=1]
oracle           2 rows,  733 mentions | Oracle [m=724, cik=1341439] | Oracle Corp [m=9, cik=null]
lockheed martin  3 rows,  598 mentions | Lockheed Martin [m=513, cik=936468] | Lockheed Martin Corporation [m=74] | Lockheed Martin Corp [m=11]
chevron          3 rows,  530 mentions | Chevron [m=523, cik=93410] | Chevron Corp [m=4] | Chevron Corp. [m=3]
eli lilly        3 rows,  522 mentions | Eli Lilly [m=511, cik=59478] | Eli Lilly & Co. [m=8] | Eli Lilly & Co [m=3]
blackstone       3 rows,  455 mentions | Blackstone [m=450, cik=1393818] | BLACKSTONE INC [m=4] | Blackstone Group [m=1]
coreweave        3 rows,  445 mentions | CoreWeave [m=436, cik=1769628] | CoreWeave, Inc. [m=8] | CoreWeave Inc [m=1]
rocket lab       2 rows,  381 mentions | Rocket Lab [m=380, cik=1819994] | Rocket Lab Corp. [m=1]
bank of america  3 rows,  370 mentions | Bank of America [m=337, cik=70858] | Bank of America Corporation [m=30] | Bank of America Corp. [m=3]
qualcomm         2 rows,  360 mentions | Qualcomm [m=349, cik=804328] | Qualcomm Inc [m=11]
broadcom         2 rows,  350 mentions | Broadcom [m=342, cik=1730168] | Broadcom Inc [m=8]
sandisk          2 rows,  349 mentions | Sandisk [m=341, cik=2023554] | SanDisk Corporation [m=8]
wells fargo      4 rows,  342 mentions | Wells Fargo [m=284, cik=72971] | Wells Fargo & Company [m=50] | Wells Fargo & Co [m=6] | Wells Fargo & Co. [m=2]
adobe            2 rows,  310 mentions | Adobe [m=306, cik=796343] | Adobe Inc [m=4]
applied materials 3 rows, 302 mentions | Applied Materials [m=277, cik=6951] | Applied Materials Inc [m=15] | Applied Materials, Inc. [m=10]
visa             2 rows,  302 mentions | Visa Inc. [m=301, cik=1403161] | Visa Inc [m=1]
lam research     3 rows,  301 mentions | Lam Research [m=193, cik=707549] | Lam Research Corporation [m=79] | Lam Research Corp [m=29]
western digital  3 rows,  300 mentions | Western Digital [m=261, cik=106040] | Western Digital Corp [m=20] | Western Digital Corporation [m=19]
```

The regularity matters. In every one of the top 20, **exactly one row carries
the CIK and the overwhelming majority of mentions**, and the fragments are
CIK-null legal-suffix variants with small counts. This is not a hard clustering
problem. It is one missing normalization rule, repeated 678 times.

Real junk entities, sampled:

```
Big Tech companies (e.g. Google, Amazon, Facebook, Apple)   [m=1, cik=null]
Bitcoin                                                     [m=6, ticker=GBTC]
Financial Times                                             [m=1]
```

### 2.4 Identity sources available today

| source | population |
|---|---|
| `cik_tickers` (cik, ticker, company_name, updated_at) | 10,888 rows, 8,226 distinct CIKs |
| `aliases` | 5,488 rows over 4,865 canonicals; every company has at least one |
| LEI data | none, anywhere |
| exchange ticker data beyond `cik_tickers` | `companies.ticker` only, 962 rows, provenance mixed |

Fraction of `companies` resolvable to a CIK today:

| route | rows |
|---|---|
| already has `sec_cik` | 792 |
| CIK-null, ticker matches `cik_tickers.ticker` | 75 |
| CIK-null, name exactly matches `cik_tickers.company_name` | 320 |
| **total plausibly resolvable** | **~1,187 of 4,865 (24.4%)** |

**Three quarters of the table cannot reach a CIK by any deterministic route
available today.** That single number governs the whole design. A gate that
requires a resolved external identity would reject roughly 3,700 existing rows,
and there is no evidence yet about how many of those are real private companies
versus junk versus fixable near-misses.

### 2.5 Foreign-key blast radius

**There are zero foreign-key constraints referencing `companies.id`.** Verified
against `information_schema`. Every reference is a bare uuid column held together
by convention.

Article-side references (uuid columns, no FK):

| table | rows pointing at a CIK-null company |
|---|---|
| `company_mentions` | 21,029 of 88,491 (23.8%) |
| `sec_filings` | 0 |
| `financial_facts` / `financial_facts_latest` | keyed by company_id, CIK-bearing by construction |
| `insider_transactions` | company_id present |
| `aliases.canonical_id` | 5,488 total |

User-side: **no user-side table references `companies.id` at all.** They key on
free text:

| table | key column | type |
|---|---|---|
| `watchlist` | `identifier` | text |
| `theses` | `ticker` | text |
| `user_claims` | `target_symbol` | text |
| `morning_brief_calls` | `target_symbol` | text |

This inverts the migration risk in an important way. A companies merge cannot
orphan a watchlist row by FK, because there is no FK. But it also means user
records are pinned to strings that the merge may invalidate, with nothing in the
schema to detect it. Current state:

- `watchlist`: 224 rows, **43 (19.2%) already resolve to no company** by name or
  ticker. The breakage the migration is supposed to avoid is already present.
- `theses`: 49 rows carry a ticker.

---

## 3. Design

### 3.1 Tiered resolver

Resolution order, first hit wins. Identity is the resolved external ID or the
deterministic key, never the raw article string. Names become aliases pointing at
an identity.

| tier | key | source | auto-accept |
|---|---|---|---|
| 1 | SEC CIK | `cik_tickers`, filings | yes |
| 2 | exchange ticker | `cik_tickers.ticker`, market-data provider | yes when the ticker maps to exactly one CIK |
| 3 | curated private registry | new table, human-entered | yes |
| 4 | deterministic normalized-name key | strengthened normalizer | yes only when the key already exists and is CIK-bearing |
| 5 | unresolved queue | new table | never; queued |

Tier 4's normalizer is the fix for 678 clusters. It must do what
`normalize_lookup_key` does today plus: strip punctuation, strip trailing legal
suffixes, strip a leading "the", collapse whitespace. That is the exact
transformation used for the counts in 2.3, and it collapses 4,865 names to 3,748
keys.

Keep `pickPreferCik`. It already encodes the correct preference and is used by
the working path. The change is to make the page use the same rule, not to
replace it.

### 3.2 Minting rule

No `companies` row is ever created as a side effect of parsing an article. Tiers
1 through 4 may create a row because they carry a resolved identity. Tier 5
creates a queue entry, not a company.

### 3.3 What happens to an article when nothing resolves

**The article is stored and indexed as it is today. Only the company link is
withheld.** The unresolved surface form is written to the queue with the article
reference so nothing is lost and promotion is one click.

This is the highest-risk part of the design and it must be stated plainly.
23.8% of `company_mentions` (21,029 rows) currently point at CIK-null companies.
Under a naive gate those mentions would not be created. Company Intel ranking
reads mention counts, and Deal Flow is full of private targets that will never
have a CIK. A CIK-only gate would visibly gut both surfaces.

Mitigation, and it is required, not optional: **tier 4 must accept, not queue,
when the normalized key matches an existing entity.** The gate rejects only
genuinely new unresolvable strings. Existing coverage is preserved because
existing entities keep resolving; only the rate of new junk entity creation
drops. Even so, the true regression is unmeasured. See 5.1.

### 3.4 On-demand lookup

`resolveOrCreateCompany` keeps working and keeps its create capability, because
a user typing a ticker is a deliberate act, not incidental parsing. It gains one
requirement: resolve the ticker against `cik_tickers` and populate `sec_cik` at
insert time. That closes the hole where the shipped mint path creates rows
invisible to CIK-keyed surfaces.

For a ticker that does not resolve to a CIK: create the row with the ticker as
tier-2 identity if the provider confirms it, otherwise return
`status: "not_found"` and offer the queue. Never a silent nameless mint.

### 3.5 Divisions and brands

An entity is something you can take a position on. AWS and Instagram are aliases
of Amazon and Meta. The live data agrees this is broken today:

```
name | ticker  | sec_cik | mentions
AWS  | JWSMF   | null    | 41
```

`JWSMF` is not Amazon. A Finnhub name search matched "AWS" to an unrelated
foreign listing and wrote it to the row. That row is both a wrong entity and a
wrong ticker, and it is exactly the corrupt-row class the migration must
quarantine rather than merge.

Segment nuance, where it matters, belongs on the article as a tag, not as a
company row. The one real exception is a separately listed subsidiary, which is
genuinely its own entity because it has its own CIK. The tiering handles that for
free: it resolves at tier 1.

### 3.6 Embeddings: retrieval and ranking only, never the arbiter

pgvector is already used for semantic dedup. It may be used for three things:

1. **Candidate retrieval.** Given an unresolved string, pull the 10 nearest
   existing entities so a human sees the likely target immediately.
2. **Queue ranking.** Order the unresolved queue so review is a glance, not
   research.
3. **Junk classification.** Score "Big Tech companies (e.g. Google, Amazon,
   Facebook, Apple)" as not-an-organization.

It may **never** decide identity. **Any merge requires a deterministic
corroborating signal: a shared CIK, a shared ticker that maps to one CIK, or an
existing alias. Similarity alone never merges.**

The justification is a failure this product already had. "Shore Bancshares" and
"Lake Shore Bancorp" are semantically adjacent, same sector, same suffix family,
and are different companies. An embedding-led merge produced a fabricated brief.
The current data still contains the near-neighbour half of that pair:

```
Lake Shore Bancorp Inc/Md | LSBK | cik=null | m=0
```

A merge is destructive and hard to detect after the fact, so the asymmetry is
deliberate: a false split costs one duplicate row that a later merge fixes, a
false merge costs a fabricated company and there is no row left to notice it.

Proposed thresholds, to be calibrated before use, not after:

| cosine similarity | action |
|---|---|
| >= 0.95 **and** deterministic corroboration | auto-merge |
| >= 0.95, no corroboration | queue, pre-filled, top of list |
| 0.85 to 0.95 | queue as candidate, human decides |
| < 0.85 | not shown as a candidate |

Note that every threshold row except the first ends in "a human decides".
That is the point.

### 3.7 Enforcement that cannot regress

A convention drifts the first time someone adds an insert path, and this codebase
already has four. Proposed, in order of strength:

1. **Database constraint.** `CHECK (sec_cik IS NOT NULL OR ticker IS NOT NULL OR
   identity_source IS NOT NULL)` on `companies`, with a new `identity_source`
   column recording which tier resolved the row. A row with no identity cannot be
   written by any client, including a script or a psql session.
2. **Trigger** rejecting inserts whose name matches the junk classifier, for the
   cases a CHECK cannot express.
3. **CI check** failing the build on a new `.insert(` against `companies` outside
   the approved resolver modules. Cheap, catches the pattern at review time,
   and does not protect against operator scripts.

1 is the only one that actually cannot be bypassed. 3 alone is a convention with
a linter, which is what we have now.

### 3.8 Migration, designed only

Never run from this document. Properties required:

- **Idempotent.** Re-running changes nothing. Keyed on resolved identity, not on
  a one-shot row list.
- **Assert-guarded on pre-state.** Abort if counts drift from those in 2.3,
  because that means the data moved under the plan.
- **Cluster by cluster review,** as in the prior Gate 1 dedup. 678 clusters, of
  which the top 20 are unambiguous.
- **Corrupt-row quarantine.** Any row where name, ticker and CIK disagree goes to
  a quarantine table, not into a merge. `AWS/JWSMF`, `Rigetti/Gett` under RGTI,
  and `Bain Capital/BCSF` are known members.
- **User-side handling, explicitly.** Since no user table holds a `company_id`,
  the work is not FK repointing; it is rewriting `watchlist.identifier`,
  `theses.ticker`, `user_claims.target_symbol` and
  `morning_brief_calls.target_symbol` where the merge changes the winning name,
  and recording the old value so it can be reversed. **43 watchlist rows already
  resolve to nothing and must be triaged before, not during, the migration.**
- **Rollback.** Every merge writes `merged_from_id`, `merged_to_id`, and the full
  prior row to an audit table. Rollback replays it in reverse.

Order: quarantine, then junk deletion (126 rows), then cluster merges, then alias
backfill, then constraint enablement. Constraint last, because it will reject
rows the earlier steps are still fixing.

### 3.9 Success criteria and sequencing

Measurable done:

- zero normalized-name clusters with more than one row
- zero rows failing the junk classifier
- page and API return the same company id for all of TSM, PTON, RGTI, GEMI, NCLH
- `/company/CAT` renders financials
- new duplicate rate: zero new clusters created in 30 days of ingest

Sequencing. These ship independently and in this order:

1. **`rankCluster` prefers CIK.** Days. Fixes the visible bug for TSM and
   friends. No schema change, no migration, reversible in one line.
2. **Strengthen the normalizer.** Stops new suffix duplicates at the source.
   Must ship with the alias backfill so existing keys still resolve.
3. **Unresolved queue plus junk classifier.** Additive.
4. **Migration of the 678 clusters.** Reviewed, batched.
5. **Database constraint.** Last, and only once 4 is done, or it rejects live
   writes.

Only step 5 is one-way. Steps 1 through 4 are individually reversible.

---

## 4. Open decisions for Noah

1. **Junk-gate strictness.** Strict means more queue friction and a real chance
   of blocking a legitimate obscure private company. Loose means junk keeps
   arriving. The 126 currently-junk rows are the sample to calibrate against.
2. **Private-company curation burden.** Tier 3 is a human-maintained registry.
   Roughly 3,700 rows have no deterministic identity today. How many of those
   are worth curating, and who does it, is a resourcing question, not a design
   one.
3. **Commercial private-company registry later.** Would collapse most of tier 3
   into tier 2. Costs money. Worth revisiting once the queue volume is known,
   which requires shipping step 3 first.

---

## 5. Adversarial self-critique

Attacking the design above. Where it fails, it is marked and either revised or
flagged unresolved.

### 5.1 Where this loses data or coverage versus today

**Company Intel mention ranking degrades.** 21,029 of 88,491 `company_mentions`
(23.8%) point at CIK-null rows. Any gate that stops creating those rows stops
creating their mentions. Company Intel ranks by mention count. The revision in
3.3 (tier 4 accepts against existing entities) preserves existing entities, but a
genuinely new private company that appears in 40 articles next month accumulates
nothing until someone promotes it from the queue. **The surface that gets worse
is Company Intel's coverage of newly emerging private names, and the lag is
however long the queue sits unreviewed.**

**Deal Flow is the worst-hit surface.** It is built on deal targets and
acquirers, which skew private and non-filer. I did not measure what fraction of
Deal Flow entities are CIK-null, and I should have. **Unresolved.** This must be
measured before step 3 ships, because if it is above roughly 50%, the queue
becomes the critical path for a whole product surface and the design needs a
faster auto-accept tier for it.

**The queue is unstaffed by assumption.** The design says "a human decides" at
four separate points and never establishes that the human exists or how many
items per day they face. At current ingest volume the queue's arrival rate is
unknown. If it is 50 a day, this design quietly requires a daily chore that two
founders will not do, and the queue becomes a write-only log. **Unresolved, and
it is the single most likely way this design fails in practice.**

### 5.2 What currently works that this breaks

**On-demand lookup for foreign filers.** 3.4 requires the mint path to populate
`sec_cik` from `cik_tickers`. Foreign issuers and ADRs are unevenly present in
that map. Samsung is the proof, already in the data with four fragments and no
CIK on any of them:

```
SSNLF | Samsung [m=130] | Samsung Electronics [m=26] | Samsung Electronics Co. [m=13] | Samsung Electronics Co. Ltd. [m=3]   all cik=null
```

Under a CIK-preferring `rankCluster`, this cluster has no CIK-bearing row at all,
so ranking falls through to mention count and behaves exactly as today. That is
fine. But under the tier-1/tier-2 gate, a new foreign name with no `cik_tickers`
entry gets queued rather than created. **Foreign coverage gets worse. Mitigation:
tier 2 should accept a provider-confirmed ticker even when no CIK exists, which
the table in 3.1 allows but the prose in 3.4 contradicted. Revised: 3.4 now says
"create the row with the ticker as tier-2 identity if the provider confirms
it".**

**Thinly covered tickers.** `cik_tickers` has 8,226 distinct CIKs. The US listed
universe is larger than that once you count OTC and recent IPOs. A ticker absent
from the map fails tier 2 and lands in the queue even though it is a real listed
company. I did not measure the map's freshness (`updated_at` exists; I did not
query its distribution). **Unresolved.**

**Step 1 is not risk-free either.** Making `rankCluster` prefer CIK changes the
canonical head for any cluster where a CIK-null row currently wins. For TSM the
page would start showing "Taiwan Semiconductor" where it now shows "TSMC". That
is more correct and it is also a visible name change on a page users know, and
`getCompanyDetail` keys article lookup on `head.name` via
`getCompanyVariants(head.name)`. If "Taiwan Semiconductor" has fewer article
matches than "TSMC", **fixing the financials could reduce the article list on the
same page.** That interaction is not resolved here and must be checked before
step 1 ships. It is the kind of thing that makes a one-line fix a two-day fix.

### 5.3 Where the resolver could merge two different companies

Tier 4 merges on normalized-name key. The normalizer strips
`co|company|group|holdings|the` among others. That is aggressive enough to
collide real distinct companies. From the live data:

```
Bancorp                   | TBBK | cik=1295401   (The Bancorp, Inc.)
Community Bancorp         | null | cik=null
First BanCorp             | null | cik=null
```

`Bancorp` normalizes to `bancorp`. Any future row named "Bancorp Inc" or
"The Bancorp" collapses onto TBBK correctly, but a genuinely different
"Bancorp Group" would also collapse onto it, and TBBK is CIK-bearing so tier 4
would auto-accept. **The rule "auto-accept only when the existing key is
CIK-bearing" makes the CIK-bearing row a magnet for any name that normalizes
into it.** That is backwards: CIK presence should make the target trustworthy,
not make the match automatic.

**Revision: tier 4 auto-accepts only when the normalized key matches AND the
unnormalized names differ by suffix tokens alone.** "Caterpillar Inc." to
"Caterpillar" qualifies. "Bancorp Group" to "Bancorp" does not, because "Group"
is a stripped token but the residual differs. Anything else queues.

The stronger pair, same sector, that the thresholds in 3.6 would wrongly merge:
`Shore Bancshares` and `Lake Shore Bancorp`. Only the second is in the data today
(`Lake Shore Bancorp Inc/Md`, LSBK, cik null, 0 mentions), so I could not
construct the pair from live rows alone; I searched the `bancorp|bancshares|
financial|savings` family and `%shore%` and found 40 rows, one of which is the
LSBK half. Their normalized keys differ (`shore bancshares` vs `lake shore
bancorp`), so **tier 4 does not merge them**. Cosine similarity would very
plausibly exceed 0.85 and put them adjacent in the queue, which is precisely why
3.6 forbids similarity-only merges. The design survives this attack, but only
because of the deterministic-corroboration rule, and that rule is therefore
load-bearing and must not be relaxed for throughput later.

A closer real pair the design does not obviously handle:

```
Burke & Herbert Financial Services       | null | cik=null      | m=10
Burke & Herbert Financial Services Corp  | null | cik=null      | m=3
Burke & Herbert Financial Services Corp. | BHRB | cik=1964333   | m=7
Burke Herbert Financial Services Corp    | null | cik=null      | m=1
```

Four rows, one company, and the CIK-bearing row does **not** have the highest
mention count. Under today's `rankCluster` the page picks the 10-mention CIK-less
row. Under step 1 it picks BHRB correctly. This cluster is a good migration test
case because the ampersand variant means punctuation stripping is doing real work.

### 5.4 What is convention rather than enforced constraint

- **"No company row is created incidentally"** is prose. Until the CHECK
  constraint in 3.7 exists, it is enforced by whoever reviews the next PR.
- **"Embeddings never arbitrate identity"** is prose. Nothing in the schema stops
  a future job from writing a merge based on similarity. It could be enforced by
  requiring the merge audit row to carry a non-null deterministic signal, and
  that should be added.
- **"Backfill scripts respect the gate"** is false today and will stay false.
  Scripts use the service role and bypass everything except database
  constraints. This is the strongest argument for choosing the CHECK constraint
  over the CI check.
- **The zero-FK situation is itself a standing convention.** Adding real foreign
  keys on `company_mentions.company_id` and friends is not in this design and
  probably should be, since it is the only thing that would make a bad merge
  fail loudly instead of silently orphaning 21,029 mention rows.

### 5.5 Assumptions the recon did not establish

Listed without softening. None of these are backed by a count I ran or code I
quoted.

1. That the 4,073 CIK-null rows are mostly legitimate private companies rather
   than junk or fixable near-misses. **I measured 126 as junk by a crude regex
   and did not classify the rest.** The entire coverage-regression argument in
   5.1 depends on this and it is unmeasured.
2. That the CAT symptom shares a cause with the TSM defect. It may not. I could
   not reproduce CAT at all.
3. That `cik_tickers` is fresh and complete enough to be tier 1's backbone.
   Never queried `updated_at`.
4. That Deal Flow's entity population is CIK-poor. Asserted from the nature of
   deal data, not measured.
5. That the unresolved queue's arrival rate is manageable. Not measured, and 5.1
   flags it as the likeliest failure mode.
6. That the article-side tables tolerate a null company link. I did not read the
   `company_mentions` write path to check whether a null company_id is even
   representable.
7. That `resolveOrCreateCompany`'s provider confirms tickers reliably enough for
   tier 2 auto-accept. The `AWS/JWSMF` row is direct evidence that the
   name-search half of that provider integration produces garbage, and I did not
   check whether the ticker-search half is better.
8. That the 43 unresolvable watchlist rows are stale rather than evidence of an
   active breakage. Not investigated.

Assumption 7 deserves emphasis: the design leans on ticker resolution as tier 2,
and the one piece of hard evidence about the ticker source in this codebase is a
row where it was catastrophically wrong.

### 5.6 If this is wrong, how would we find out, and how expensive is the reversal

**Detection is weak, which is the honest answer.** A false merge produces a
company that looks fine. There is no user-visible symptom for "these two rows
should have stayed separate" and no FK to break. The realistic detection paths:

- Mention counts jumping discontinuously for a single entity.
- A brief or memo citing a filing that does not match the company, which is how
  the Shore Bancshares failure was originally caught. **That means today's
  detector is a human reading generated prose, which is a detector that fires
  after the fabricated output has shipped.**
- The merge audit table in 3.8, if someone reads it.

The design should add a cheap active detector: after any merge, assert that the
resulting entity's filings all share one CIK and that its ticker maps to one CIK
in `cik_tickers`. That catches the `AWS/JWSMF` and `Rigetti/Gett` shapes
mechanically.

**Reversal cost by step.** Steps 1 through 3 are cheap: revert the commit. Step 4
is the expensive one. With the audit table it is a scripted replay; without it,
merged rows are unrecoverable because the source rows are gone. **The audit table
is therefore not a nice-to-have, it is the only thing standing between a bad
merge and permanent data loss, and it must land before the first merge runs, not
alongside it.** Step 5 is trivially reversible (drop the constraint) but will
have silently shaped weeks of ingest by the time anyone questions it.

Worst case: the migration merges a few hundred clusters, a handful are wrong, the
wrongness is invisible for weeks, and it surfaces as a fabricated brief. That is
the same failure mode this product has already had once. The design reduces its
likelihood through the corroboration rule and does not eliminate it.

---

## 6. Verification

- Read-only and SELECT only, confirmed. No product code changed. No migration
  written or run. No pipeline triggered. No flag touched. Only this document is
  added.
- All four insert paths enumerated with code quoted:
  `backend/entity_resolver.py:368`, `src/lib/data-access/resolveOrCreateCompany.ts:214`,
  the operator backfill scripts, and the deprecated `backend/ingest.py:1817`.
- Page-versus-API mismatch demonstrated from source, not asserted:
  `rankCluster` in `src/lib/data-access/aliasResolver.ts:61` sorts on
  `mention_count` and never reads `sec_cik`; `resolveCompanyCik` in
  `src/lib/sec-filings.ts:132` calls `pickPreferCik` at every tier. Live data
  where they diverge is listed in section 1.
- All counts are real query results. Two queries failed and are reported as
  failed rather than estimated: a large join across `company_mentions` timed out
  at 120s, and one column guess (`cik_tickers.title`) did not exist and was
  re-run correctly as `company_name`.
- Self-critique present, tied to named rows and real clusters (TSM, RGTI, SSNLF,
  BHRB, LSBK, AWS/JWSMF), and it revised the design in two places (tier 4
  auto-accept narrowed in 5.3, tier 2 ticker acceptance corrected in 5.2) rather
  than defending it.
- Stated plainly: the CAT reproduction failed, and eight design assumptions are
  unbacked and listed in 5.5.
