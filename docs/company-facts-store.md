# The fact store: `company_facts`

Design note for `sql/0038_company_facts.sql` and `backend/company_facts.py`.
PR 1 of the fact layer: the store only. The extractor (PR 2), the reader
(PR 3) and call citations (PR 4) come after and read this file first.

Scope source: PIECE 2 of
`docs/recon/2026-09-02-clustered-top-stories-and-fact-layer-scope.md`
(branch `docs/ingest-substrate-recon`), corrected by
`docs/recon/2026-09-04-gnews-corpus-value-and-resolver-decision.md`, whose
first finding is that the corpus is ~3.4x larger than the 09-02 doc assumed.

## What it is

One row per stated claim per article, attached to a company by id, dated,
and traceable to the article, the outlet and the verbatim sentence. Briefs,
memos, trends and calls read one accumulating store instead of re-deriving
from headlines. The concrete target sentence: a brief on NVIDIA earnings can
say "last month the coverage flagged capex pressure" because that remark is
on file, and it can tell "NVIDIA's CFO said" from "coverage flagged" because
`speaker` is NULL unless the article named the person.

## The two numbers, measured before any SQL was written

Both were re-measured over the FULL `articles` table on 2026-09-05, keyset
on `id` (batch inserts share `ingested_at`, so a timestamp keyset can drop a
page), 1,000 rows a page, with the final page short, so the walk completed
rather than hitting the PostgREST cap. Light columns only, one pass. The
earlier figures came from 97 prose rows in a 600-row recent window, which is
the sampling error that produced several wrong numbers the previous week.

"Prose" is the filter from the brief: `summary` or `content` longer than
100 characters. Measured that way it is NOT 100% precision: 25.7% of the rows
it admits are a headline echo (title plus a " - Publisher" suffix that
happens to exceed 100 characters, stored before the echo detector existed in
ingest). The numbers below are over the echo-excluded population, "genuine
prose", which is 18.7% of the table; the literal rule admits 25.1%.

| | genuine prose | literal >100 rule |
| --- | ---: | ---: |
| (a) NULL `primary_company` | **34.6%** | 29.2% |
| (a) NULL `primary_company` AND empty `companies[]` | **21.7%** | 17.6% |
| (b) NULL `publisher` | **93.8%** | 95.3% |
| (b) NULL `publisher_domain` | 93.8% | 95.3% |
| no `published_at` | 1.9% | 1.4% |

`publisher` and `publisher_domain` are NULL together: named RSS feeds carry
the outlet in `source` and never populate them, and Google News rows before
2026-08-15 predate publisher capture. The top sources among NULL-publisher
prose rows are Yahoo, SeekingAlpha, Benzinga, Bloomberg Tech and PR Newswire,
which is the named-feed leg, not a defect.

Status: **verified**, full table, both definitions.

## Decision 1: `company_id` is nullable

The threshold set in advance was "if (a) is materially below 10%, re-argue".
It is 21.7% by the strict reading (no company name anywhere on the row) and
34.6% by the reading the readers will actually use (no primary company). That
is over a fifth of the extractable population. Dropping those facts at write
time is unrecoverable; attaching them later is a backfill over the
`company_facts_unattached_idx` partial index, keyed by the same
`company_mentions` link that the rest of the pipeline uses. So:

- `company_id uuid REFERENCES companies(id) ON DELETE SET NULL`, the
  `financial_facts` shape, nullable.
- The company window index is partial (`WHERE company_id IS NOT NULL`) so
  unattached rows cost nothing on the brief's read path.
- Company merge tooling (`sql/proposals/0033` through `0035`) must repoint
  `company_facts.company_id` before deleting an absorbed row. `SET NULL`
  would otherwise detach facts silently. This is a known follow-up, not
  handled here.

What this does not settle: how the extractor resolves a name to an id. The
verbatim-name match between `articles.primary_company` and `companies.name`
was roughly half in a small sample, and `entity_resolver.resolve_entity`'s
miss path CREATES a company, so PR 2 must attach only through
`company_mentions` (present on most recent prose rows) and never through the
resolver's miss branch.

## Shape

Follows `financial_facts` (long/narrow, provenance by source id, read through
a view) and `claim_evidence` (UNIQUE on the source article for idempotence,
source fields copied at write time). Full column list and rationale are in
the SQL header. The constraints that carry the design:

| constraint | decision it enforces |
| --- | --- |
| `UNIQUE (id, article_id)` | a child table citing `fact_id` can carry `article_id` in a composite FK and cannot cross articles |
| `UNIQUE (article_id, claim_key)` | re-extracting an article is idempotent; key computed in Python, versioned by prefix |
| no UNIQUE that spans articles | dedup is in the read view; five outlets stating one figure stay five rows |
| `CHECK (speaker_role IS NULL OR speaker IS NOT NULL)` | a role without a name is coverage, not attribution |
| `CHECK (value_num IS NULL OR value_raw IS NOT NULL)` | a number the text did not print cannot be stored |
| `length(claim_text) BETWEEN 1 AND 500` | the verbatim sentence is the only wide column; longer sentences are skipped, never truncated |
| ledger `UNIQUE (article_id, extractor_version)` + `status IN (extracted, empty, failed)` | "processed, stated nothing" is a row; "never processed" is the absence of one |

`as_of` is `published_at::date`, or `ingested_at::date` for the 1.9% of
prose rows whose feed carried no date; `article_published_at IS NULL` marks
that fallback on the row rather than inventing a date.

`claim_key` (`backend/company_facts.py`) has two forms. A figure with a named
metric and a number keys on `type|company|metric|unit|rounded value|period`,
rounded with the tolerances `backend/figures.py` already uses, so "$4.2B" and
"$4.15B" group. Everything else, including a figure whose metric is unnamed,
keys on an order-insensitive token-set hash of the sentence, so an unlabelled
"$17 billion" cannot corroborate a different $17 billion. Paraphrases stay
separate rows with separate keys; under-counting corroboration is the honest
failure.

The read view `company_facts_corroborated` groups by
`(company_id, fact_type, claim_key)` and counts DISTINCT `article_id`. It
exposes `count(DISTINCT publisher_domain)` as a secondary column only, with
the 93.8% NULL share documented next to it. It never touches `claim_text`;
readers hydrate by `first_fact_id`.

## Cost on Supabase disk

All of this is arithmetic on the column widths, not a measurement: nothing
has been written yet. Section 6b of the SQL is the query that replaces these
numbers once PR 2 has written a day of rows.

Per-row estimate: ~455 bytes heap (the verbatim sentence at a ~170-char
median is most of it) plus ~220 bytes across the primary key, the two UNIQUE
constraints and the two query indexes. The ledger adds ~220 bytes per
article.

| accumulation | rows | heap | indexes | total |
| --- | ---: | ---: | ---: | ---: |
| 278 rows/day, 12 months | ~101k | ~46 MB | ~22 MB | ~68 MB |
| ~975 rows/day (3.5 facts per article), 12 months | ~356k | ~162 MB | ~78 MB | ~240 MB |

The brief says "278 facts/day"; 278 is the prose ARTICLE rate, so both rows
are shown. Daily write IO including WAL is ~0.6 to ~2 MB/day against the 5
MB/s baseline the disk warnings quote, which is under a second of budget per
day. The backfill is the only bulk write: at 3.5 facts per article it is
~70 MB of heap and index for the brief's population and roughly a third more
for the echo-excluded population measured here, so on the order of a minute
of sustained IO at the baseline rate if done in one sitting. PR 2 should
batch it in chunks of a few hundred articles, off-peak, and the ledger makes
a paused backfill resumable.

Reads: the brief's query is one index range per company over a bounded
window with a LIMIT, a few hundred 8 KB pages per brief. The view is safe
only with a company or type predicate; an unbounded read of it is a
sequential scan and must not ship.

Indexes: `(company_id, as_of DESC) WHERE company_id IS NOT NULL` and
`(fact_type, as_of DESC)` are the two query shapes. The
`(article_id, claim_key)` UNIQUE already leads with `article_id`, so there is
no separate article index. `(company_id, metric_key, as_of DESC)` for
"capex over time" is in section 5 as optional, to be added only if the
measured plan needs it.

## Migration home

`sql/0038_company_facts.sql`, not `supabase/migrations/`. Every hand-applied
file since June (0023 through 0037) lives in `sql/` with the VERIFY / APPLY /
MEASURE layout that is run from the Studio editor, and `supabase/migrations/`
implies `supabase db push` ordering, which this repo does not use. 0038 is
the next free number across `sql/` and `sql/proposals/` together (they share
one sequence). Nothing in this PR applies DDL.

## Where the shipped design diverges from the 09-02 scope

The scoping doc exists and was read in full: PIECE 2 of
`docs/recon/2026-09-02-clustered-top-stories-and-fact-layer-scope.md`, on
branch `docs/ingest-substrate-recon` (commit `ded7a5f7`, never merged to
`main`, which is why a tree search of `main` does not find it). Each
divergence below is against its sections 2.3, 2.4 and 2.7.

| scoped (09-02) | shipped (0038) | judgment |
| --- | --- | --- |
| table `article_facts` | `company_facts` | naming only; the brief's name |
| `fact_type` in figure, statement, guidance, cause, event, commentary | figure, guidance, commentary, stated_cause, event | "statement" folded into commentary, "cause" renamed. PR 2 says whether "statement" earns a type back |
| `company_id references companies(id)`, nullability unstated | nullable, `ON DELETE SET NULL` | forced by the 21.7% of genuine prose rows with no company name anywhere |
| `confidence` in reported, quoted, inferred | no column; attribution is `speaker IS NOT NULL` | correct: decision 9 bans model-emitted confidence, and "inferred" is a value the store must never hold |
| `stated_cause text` column on a row | `stated_cause` is a fact_type | one shape instead of two; a cause is a stated claim like any other |
| `period_start`, `period_end`, `period_type` | `period_text` verbatim, `period_end`, `period_type` | `period_start` dropped: a start date the text did not print is inference. `period_text` keeps what it did print |
| `dedup_key` = `type|metric|round(value)|period_end`, token hash for statements | `claim_key` folds in company and unit, falls back to the text hash when the metric is unnamed, versioned prefix | needed for a plain-column UNIQUE with a nullable company, and so an unlabelled figure cannot corroborate a different one |
| `UNIQUE (article_id, dedup_key)` only | plus `UNIQUE (id, article_id)` | the claim_evidence shape, for PR 4's composite FK |
| provenance: `as_of`, `speaker`, `claim_text` copied at write | plus `article_published_at`, `source`, `publisher`, `publisher_domain`, `value_raw`, `extractor_version` | the store must stand on its own as a product; `value_raw` is what the number CHECK enforces |
| no ledger | `company_facts_extractions` | scoped doc had no way to tell "processed, empty" from "never processed" |
| view `article_facts_agreed` joining `articles`, `count(*)` as `n_sources`, `count(DISTINCT publisher)` as `n_publishers` | `company_facts_corroborated`, no join, `count(DISTINCT article_id)`, `publisher_domain` secondary | the scoped `n_publishers` would read 1 on 93.8% of rows; the join is unnecessary once provenance is copied |
| "ship the base table and the four indexes first; add the view only once you can measure it with EXPLAIN ANALYZE on real volume" | view ships in the same file | divergence by instruction: decisions 3 and 4 put dedup in a read view. Section 6c of the SQL is the measurement the scope asked for |
| four indexes: `(company_id, as_of)`, `(company_id, metric_key, as_of)` partial, `(article_id)`, `(as_of)` | `(company_id, as_of)` partial, `(fact_type, as_of)`, unattached partial, ledger; metric index optional in section 5 | `(article_id)` duplicates the UNIQUE; `(as_of)` alone had no reader, the extractor windows on `articles`; `(fact_type, as_of)` is the brief's second query shape and was not scoped |
| prose cut: `content_type = 'full_text' OR summary adds >= 20 alnum chars over the title` | the brief's ">100 chars" rule, measured here | the scoped cut is echo-aware and the brief's is not. PR 2 should use the scoped cut, or ">100 AND not echo"; see the next section |
| corpus ~59k, ~11k prose, ~800 facts/day, ~290k rows/year | full table is 3.4x that; genuine prose 18.7% of it | superseded by the 09-04 corpus doc and by this walk |

Sections 2.5, 2.6 and 2.8 of the scope (where extraction runs, cost per
call, the brief reader) are PR 2 and PR 3 material and are not diverged from
here.

## The prose filter is not 100% precision

No file in this repo states that the ">100 characters" rule is 100%
precision and 100% recall. The claim came from a prose-filter follow-up that
is not committed on any ref; a search of every `.md`, `.py`, `.sql`, `.ts`
and `.txt` file on `main` and on `docs/ingest-substrate-recon` for the
phrase finds only this document. So there is nothing to correct in place,
and the corrected figure lives here: measured over the full `articles` table
on 2026-09-05, 25.7% of the rows the rule admits are a headline echo longer
than 100 characters (a title plus a " - Publisher" suffix, stored before
ingest's echo detector existed). Recall against genuine prose is not
affected by that finding; precision is. The 09-02 scope's own cut (at least
20 alphanumeric characters beyond the title) already excluded echoes, and
PR 2 should extract under that cut, not the literal rule.

## Verified vs inferred

| claim | status |
| --- | --- |
| the two numbers above, both definitions | verified, full table, keyset walk completed |
| 09-02 scope doc exists on `docs/ingest-substrate-recon` | verified, `git show` on the ref |
| duplicate company clusters still form under the v2 rule | verified, full `companies` table, 2026-09-05 |
| the merge's destructive phase has run | inferred from a populated post-merge repair ledger; `norm_v2` is not visible through PostgREST |
| echo share of the >100-char rule | verified, same walk, prefix-and-margin rule over normalised title/summary |
| `financial_facts` is applied and populated | verified (its header still says NOT APPLIED; the header is stale) |
| `articles` has no company id column; the link is `company_mentions` | verified from live column lists |
| the SQL parses | verified with libpg_query (`pglast`) in the test; not the same as applying it |
| every storage and IO figure | inferred, column-width arithmetic; replace via SQL section 6b |
| per-row facts count of ~3.5 | inferred from the 09-02 doc's estimate; PR 2 measures it |
