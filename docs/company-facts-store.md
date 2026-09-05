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

## Verified vs inferred

| claim | status |
| --- | --- |
| the two numbers above, both definitions | verified, full table, keyset walk completed |
| echo share of the >100-char rule | verified, same walk, prefix-and-margin rule over normalised title/summary |
| `financial_facts` is applied and populated | verified (its header still says NOT APPLIED; the header is stale) |
| `articles` has no company id column; the link is `company_mentions` | verified from live column lists |
| the SQL parses | verified with libpg_query (`pglast`) in the test; not the same as applying it |
| every storage and IO figure | inferred, column-width arithmetic; replace via SQL section 6b |
| per-row facts count of ~3.5 | inferred from the 09-02 doc's estimate; PR 2 measures it |
