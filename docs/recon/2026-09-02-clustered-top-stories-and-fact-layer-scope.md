# Scope: cluster-aware Top Stories, and the fact layer

Recon date 2026-09-02. Every number below was measured against prod on that
date. Method and sample are named at each one. Nothing here is built.

Two samples are used throughout:

- **RECENT-12K** — the 12,000 most-recently-ingested articles, keyset-paged on
  `ingested_at`, spanning 2026-08-25T02:08 to 2026-09-02T13:56 (8.4 days).
- **CORPUS-10K** — 10,000 rows keyset-paged on `id` (a UUID, so effectively a
  random ~17% sample of the ~59,000-row corpus).

`SELECT count(*) FROM articles` cannot be run: it returns 57014 statement
timeout. Corpus size is taken from `content_embeddings` where
`content_type='article'` (58,806 rows), which tracks `articles` closely.

---

# PIECE 1 — Cluster-aware Top Stories

## 1.1 What `cross_source_clusters` actually contains

**27 rows. All written in one 12-millisecond burst on 2026-08-05T22:19:35.**
The event windows they cover run 2026-08-03 to 2026-08-05. The table is 28 days
stale.

It is stale because nothing populates it. `cross_source` appears nowhere in
`backend/run.py`'s step manifest (`run.py:481-506`) and nowhere in
`backend/cron/`. `backend/cross_source.py:340-370` is a `__main__` script that
someone ran by hand once.

Row shape, all 27:

| field | observed |
| --- | --- |
| `article_count` | 2 or 3 |
| `distinct_identities` | 2 or 3 |
| `tied_lead` | 0 of 27 |
| `figure_findings` | mostly empty |

Sample keys: `one:nissan-posts-first-quarterly#0`, `co:boeing:rating#0`,
`co:openai:legal#0`, `co:astrazeneca:ma#0`.

Read path: `src/app/api/cross-source/route.ts` and `src/app/cross-source/page.tsx`
only. No brief, no rail, no dashboard reads it. That page is currently rendering
a 28-day-old snapshot as if it were current — worth knowing independently of
this work.

**It is not a candidate input for Top Stories.** 27 rows from one 48h window
three weeks ago cannot serve a surface that renders every page load.

## 1.2 What `impact_ranking.cluster_key` actually contains

It contains nothing. It is a **pure function** (`impact_ranking.py:203-228`),
computed in memory on every call, never stored on `articles`. There is no
`articles.cluster_key` column.

Assignment order:

1. `MACRO_BUCKETS` keyword hit → `macro:{bucket}`. Four buckets only: fed, cpi,
   pce, jobs (`impact_ranking.py:63-72`).
2. Otherwise, if `companies[0]` is set → `co:{companies[0]}:{theme}` where theme
   is the first matching `EVENT_THEMES` bucket (12 themes, first-match-wins,
   `impact_ranking.py:88-125`) or `sig:{first 4 non-stopword title tokens}`
   (`impact_ranking.py:190-200`).
3. Otherwise → `one:{content signature}`.

### Measured on RECENT-12K

| | count | share |
| --- | ---: | ---: |
| base clusters | 6,775 | |
| singleton base clusters | 5,487 | 81.0% of clusters |
| **articles in a multi-article base cluster** | **6,513** | **54.3% of articles** |

`cross_source.py` adds a 24h time split on top (`split_by_time_gap`,
`cross_source.py:107-140`). After it:

| | count | share |
| --- | ---: | ---: |
| event instances | 8,081 | |
| singleton instances | 6,846 | 84.7% of instances |
| **articles in a multi-article instance** | **5,154** | **43.0% of articles** |
| instances with ≥2 distinct publisher identities | 830 | 3,969 articles (33.1%) |

Key prefix split: `co:` 4,449 clusters / 9,341 articles; `one:` 2,322 / 2,607;
`macro:` 4 clusters / 52 articles.

Publisher coverage has improved sharply since the module's docstring was
written: `publisher` is non-null on **90.9%** of RECENT-12K, and
`attribution_identity` resolves on 100%.

## 1.3 Spot check: are the multi-article clusters the same event?

**Partly. One theme is a wastebasket and it dominates.**

Provenance of the 1,235 multi-article instances:

| theme | instances | articles |
| --- | ---: | ---: |
| `co:*:stock` | 599 | **3,074** |
| `co:*:ma` | 184 | 676 |
| `co:*:earnings` | 106 | 496 |
| `one:sig:*` | 152 | 346 |
| `co:*:sig:*` | 84 | 212 |
| `co:*:rating` | 40 | 104 |
| everything else | 70 | 246 |

`:stock` is 60% of all clustered articles and it is a topic, not an event. Its
keyword list (`impact_ranking.py:110-112`) contains `stock`, `shares`, `rally`,
`valuation`, `market cap` — terms that appear in almost any equity headline.

**Genuinely one event** (read in full, all members concern the same news):

- `co:unum group:buyback#0`, n=6 — six outlets on one $1B repurchase
  authorization.
- `co:canadian solar:earnings#0`, n=8 — eight outlets on one Q2 result.
- `co:meta:legal#0`, n=24 — the $17B state settlement, Axios / NYT / TechCrunch /
  Benzinga / Moomoo.

**Not one event:**

- `co:nvidia:stock#1`, n=**118** — tariffs, an earnings preview, a KeyBanc
  rating note, a SpaceX deal, and a Dow futures piece, in one bucket.
- `co:tsmc:stock#3`, n=7 — a TSMC-vs-ASML comparison, a 2026 price forecast, an
  employee-bonus item, and a Taiwan exchange interview.
- `co:mara:stock#1`, n=7 — a bitcoin rally, an earnings miss, and a CEO share
  sale.

### Two structural limits, both demonstrated on live data

**(a) `cluster_key` is keyed on `companies[0]`, so a two-sided deal splits.**
Right now the Aon / USI / KKR $17B transaction sits across three keys:
`co:aon:ma`, `co:kkr:ma`, and `co:kkr:sig:kkr-kkr-agrees-$17`.

**(b) First-match theme is brittle.** Measured:

| title | key |
| --- | --- |
| "GoPro to **Merge** With Starman Optical in $285 Million Deal" | `co:gopro:sig:gopro-merge-starman-optical` |
| "GoPro to be **acquired** by Starman Optical in $285 million deal" | `co:gopro:ma` |

Same event, two keys, because the `ma` keyword list
(`impact_ranking.py:96-101`) contains `merger` but not `merge`.

## 1.4 Is lead/echo good enough to pick a representative?

**"Lead" means first seen in our feeds, and the module says so** (`cross_source.py`
docstring, lines 25-30). It is `min(published_at)`, falling back to
`ingested_at`, with `timestamp_basis` recording which was used
(`cross_source.py:189-200`).

Known distortions, all named in the module itself: PR Newswire timestamps at
second-zero granularity; Google News carries its own indexing lag; a tie at the
front sets `tied_lead` and refuses to name a first mover.

Measured: 0 of the 27 stored clusters is `tied_lead`. That is a sample of 27
from one 48-hour window. It is not evidence that lead detection is reliable.

**This does not block anything, because picking a representative does not need
lead detection.** `keepWhichReplaces` (`src/lib/top-stories.ts:170-182`) already
does it deterministically: highest `relevance_score`, then the more complete
headline (title with the " - Outlet" suffix stripped), then earliest published,
then lowest id. That rule is shipped, total-ordered, and reproducible. Lead
identity is a display fact you could show ("first reported by X"), never a
ranking input.

## 1.5 Top Stories already collapses same-event duplicates

This is the finding that reframes the piece. There are **four** clustering
implementations already in the repo:

| # | where | gate |
| --- | --- | --- |
| 1 | `impact_ranking.cluster_key` (Python) | macro keyword → company + event theme |
| 2 | `collapseSameEvent`, `src/lib/top-stories.ts:190-227` | same `Google News (X)` ticker **AND** same `primary_company` **AND** 48h **AND** title Jaccard ≥ **0.50** |
| 3 | `clusterArticles`, `src/lib/clustering-utils.ts:70-116` | 48h **AND** Jaccard > **0.35** **AND** one shared capitalized token |
| 4 | `related_articles` RPC, `sql/0021_related_articles_rpc.sql` | pgvector HNSW cosine over 58,806 stored article embeddings |

(3) already renders a **"N more sources"** expander on the company page
(`src/app/watchlist/[identifier]/page.tsx:1183-1190`). (4) already renders an
**"In this thread"** row on the dashboard hero
(`src/components/dashboard/hero-thread.tsx:97`).

So the display pattern the brief asks for is shipped twice. What is missing is
that Top Stories uses the strictest of the four.

### The live pool, right now

`fetchTopStories` (`top-stories.ts:250-317`) fetches 24 candidates
(`TOP_STORIES_CANDIDATE_LIMIT`, line 42) and renders 4 (`TOP_STORIES_LIMIT`,
line 33). Reproducing that exact query on 2026-09-02:

| variant | groups from 24 | removed |
| --- | ---: | ---: |
| **shipped** (ticker + subject + 0.50) | 23 | 1 |
| drop the ticker gate, keep 0.50 | 22 | 2 |
| **drop the ticker gate, 0.35** | **17** | **7** |
| `impact_ranking.cluster_key` | 17 | 7 (different, wrong groups) |
| `clustering-utils.clusterArticles` | 18 | 6 |

**Rendered top 4 today, shipped code:**

1. GoPro to Merge With Starman Optical in $285 Million Deal
2. BioXcel files for bankruptcy, will sell assets to Teva for up to $125M
3. KKR (KKR) Agrees $17 Billion USI Insurance Exit
4. GoPro to be acquired by Starman Optical in $285 million deal ← **the duplicate**

Those two GoPro titles score Jaccard **0.462**. The threshold is 0.50. The
duplicate survives by 0.038.

**Same pool, subject gate + 0.35:**

1. GoPro to Merge With Starman Optical in $285 Million Deal **(+2 more)**
2. BioXcel files for bankruptcy, will sell assets to Teva
3. KKR (KKR) Agrees $17 Billion USI Insurance Exit
4. Eli Lilly Buys Merida Biosciences For $2.9 Billion **(+1 more)**

Slot 4 becomes a new distinct story. That is the requested behaviour, from a
two-constant change.

`impact_ranking.cluster_key` over the same 24 rows removes 7 as well, but groups
them **wrongly**: it splits the GoPro event across `sig:` and `ma`, and splits
the Aon/USI deal across three keys. It is not the right tool here.

### Where the relaxed predicate blows up, and why that is survivable

Running `clusterArticles`' predicate over all 11,849 RECENT-12K rows with a
`published_at`:

| semantics | groups | max group | articles in a multi group |
| --- | ---: | ---: | ---: |
| greedy seed-anchored (as shipped in `clustering-utils.ts`) | 8,273 | **40** | 45.4% |
| single-linkage (as `collapseSameEvent` matches, line 207-217) | 7,060 | **2,853** | 48.9% |

The large groups are false. n=40 is Yahoo's "Why Is X Up N% Since Last Earnings
Report?" template across 40 different companies. n=26 is MarketBeat 13F
boilerplate. n=30 is "Why is X stock sliding today?".

**Cause, with a line reference:** `extractCapitalizedEntities`
(`clustering-utils.ts:36-45`) keeps every capitalized token of length ≥3. In a
title-cased headline that is every word, so the shared-entity guard is vacuous.

**Fix, already written elsewhere in the codebase:** add the `primary_company`
gate `collapseSameEvent` already has (`top-stories.ts:154-158`).

| | groups | max group | in-multi |
| --- | ---: | ---: | ---: |
| greedy, no subject gate | 8,273 | 40 | 45.4% |
| **greedy + subject gate** | **10,083** | **12** | **25.5%** |

With the subject gate the capitalized-token guard becomes **exactly redundant** —
measured byte-identical output with and without it. The residual largest groups
(12 COKE institutional-holdings notes) are same-company template floods, which
are the same non-event anyway. `primary_company` is non-null on 86.2% of rows;
a null subject never clusters, which is the safe direction.

## 1.6 What it would take

**Query changes: none.** The over-fetch to 24 and the render at 4 already exist.
No new table, no new index, no new pipeline step, no LLM call.

Code changes, smallest blast radius first:

1. **Drop the ticker conjunct** at `top-stories.ts:212-213`
   (`m.ticker !== null && m.ticker === d.ticker`). Today a non-Google-News row
   never clusters at all, which is why the FT's GoPro story and Insurance
   Journal's KKR story sit outside their own events.
2. **Lower `SAME_EVENT_TITLE_SIMILARITY`** 0.50 → 0.35 (`top-stories.ts:53`).
3. **Return the group, not just the survivor.** `collapseSameEvent` currently
   maps each cluster to one row (`top-stories.ts:219-227`). Change the return to
   `{ survivor, others }[]`, widen the hydration `.in_("id", …)`
   (`top-stories.ts:307-311`) from ~4 ids to the survivors plus their members,
   and render `others` under the card.

**Display:** reuse one of the two shipped patterns. The
`{isExpanded ? 'Collapse' : 'N more sources'}` control at
`src/app/watchlist/[identifier]/page.tsx:1183-1190` is the closer match; the
"In this thread" slot at `src/components/dashboard/story-card.tsx:257` is the
alternative. Cluster members are strictly cheaper than the RPC because they are
already in the fetched candidate rows.

**Cost:** one hydration query grows from ~4 ids to ~10-24 ids. Zero extra round
trips, zero extra LLM calls.

## 1.7 What breaks

**Nothing downstream reads Top Stories.** Verified:

| surface | its own read | affected? |
| --- | --- | --- |
| synthesis pool | `synthesize.py:4873` — `articles ORDER BY relevance_score DESC LIMIT 60` | **no** |
| story rail | `story_rail.py:282` — own read, own two collapse passes (money+company heuristic, then embedding cosine) | **no** |
| watchlist feed | `src/components/dashboard/watchlist-feed.tsx:369` → `/api/watchlist-feed` | **no** |

Clustering at the Top Stories render layer changes what the reader sees and
nothing about what any generator consumes.

Real risks, in order:

1. **The `MIN_RESULTS` gate counts distinct stories.** `top-stories.ts:283`
   falls back to the wider tier when `primaryRows.length < 3`. Collapsing more
   aggressively makes that gate fire more often. Measured today: 17 groups,
   comfortably above 3. Watch it on a thin ingest day.
2. **Single-linkage chaining.** `collapseSameEvent` matches against *any*
   cluster member, not the seed (`top-stories.ts:207-217`). Over 24 rows that is
   bounded. Do **not** reuse the relaxed predicate on any unbounded feed without
   converting to the seed-anchored form — the 2,853-row group above is what
   happens.
3. **A two-sided deal will still show twice.** The Aon/USI story will appear
   once under Aon and once under KKR, because `primary_company` differs. A
   subject gate cannot merge it. That is the honest residual and it is visible
   in today's live pool at slot 3.
4. **e2e is in scope.** This is user-facing rendering, so per the preflight gate
   `e2e/dashboard.spec.ts` should run, differential against the 14-failure
   floor. tsc / lint / build remain the hard gates.

## 1.8 Build order

1. Fixture the live 24-row pool into a unit test; assert the collapse count and
   the top-4 identities before and after. Prove by mutation, not by reading.
2. Ship steps 1 and 2 (gate + threshold). Rendering is unchanged; the list just
   holds distinct stories. This alone fixes today's visible duplicate.
3. Ship step 3 (group return + expander).
4. Leave `cross_source_clusters` and `cluster_key` out of it. Both are worse on
   this pool.

**Separate, and worth its own ticket:** `cross_source.py` is not wired into
`run.py`, and `src/app/cross-source/page.tsx` is rendering its 28-day-old
27-row output as current. That is a source-reliability problem, not a Top
Stories problem, and it should not be bundled into this work.

---

# PIECE 2 — The fact layer

## 2.1 What `backend/figures.py` already does

266 lines, three regex kinds: money (`$` plus an optional scale word,
`figures.py:58-62`), percent (`figures.py:65-68`), multiple (`figures.py:71`).
`compare_figures` (`figures.py:164-266`) emits two observation kinds across a
cluster's members — `divergence` and `exclusive`.

**It does not extract into storage. It compares.** Its only caller is
`cross_source.py:229-232`, and its only sink is
`cross_source_clusters.figure_findings` — 27 rows from 2026-08-05.

What it cannot do, by construction:

- attach a figure to a **metric** ("$17 billion" is not "deal value")
- attach it to a **period**
- attach it to a **company**
- tell revenue from market cap — its own docstring says so (`figures.py:14-20`)
- capture a **statement** of any kind: zero coverage of management commentary,
  stated causes, guidance, or events

Its docstring also states the substrate limit directly (`figures.py:24-33`): it
runs against a headline.

**Verdict:** `figures.py` is a divergence detector. Reuse its tolerance
constants (`MONEY_REL_TOLERANCE` 0.02, `PERCENT_ABS_TOLERANCE` 0.5,
`MULTIPLE_REL_TOLERANCE` 0.05, `figures.py:75-83`) for dedup rounding. Do not
build the fact layer on top of it.

## 2.2 The substrate — this is the load-bearing measurement

| | RECENT-12K | CORPUS-10K |
| --- | ---: | ---: |
| `content_type = 'full_text'` | 325 (2.7%) | 283 (2.8%) |
| `summary` non-empty | 1,853 (15.4%) | 5,422 (54.2%) |
| …of those, a strict headline echo | 12 (0.6%) | 3,294 (60.8%) |
| **substantive summary** (≥20 new alnum chars over the title) | **1,636 (13.6%)** | **1,840 (18.4%)** |
| substantive summary **or** full_text | 1,660 (13.8%) | 1,870 (18.7%) |
| `primary_company` non-null | 86.3% | 83.6% |
| median title length | 73 | 76 |

Exact PostgREST counts for `ingested_at >= 2026-08-25`: **12,601** rows,
**10,604** with `summary = ''` (84.2%), **12,246** with `content IS NULL`
(97.2%).

### Correcting the framing numbers

- **"96.5% have no content" — right.** Measured 97.2%.
- **"36% have no summary" — not right for the current window.** It is **84.2%**.
  Corpus-wide it is ~46%, and roughly 61% of the non-empty half is a headline
  echo.

### Why, with a line reference

`ingest.py:571` stores `"summary": "" if echo else raw_summary`. Google News
puts the headline back into the RSS `<description>`; `_is_headline_echo` detects
it and the row is stored with an empty summary rather than a duplicate title.

Substantive-summary rate by ingest month (CORPUS-10K, months with n≥100):

| month | rate |
| --- | ---: |
| 2026-04 | 85.8% |
| 2026-05 | 83.8% |
| 2026-06 | 11.5% |
| 2026-07 | 14.1% |
| 2026-08 | 10.8% |
| 2026-09 | 30.7% |

**This is not data loss.** The discarded text was the title. It does mean the
pre-June archive is not the rich seam it looks like: those "summaries" were
largely echoes stored before the detector existed.

### The extractable population is source-shaped, not date-shaped

Genuine-prose summaries in RECENT-12K, by source: SeekingAlpha 262, Yahoo 244,
Benzinga 191, PR Newswire 115, SEC 8-K 98, Bloomberg Tech 92, PE Hub 52,
TechCrunch 52.

**One caveat for the extractor.** Some Google News rows store a concatenation of
the *other headlines in Google's own story cluster* in `summary`:

> "Nvidia Just Broke the Stock Market (Again) Yahoo Finance Analysts Expect
> Nvidia Stock to Soar 47%, But You Shouldn't Rush to Buy NVDA Here Barchart…"

That passes the echo test (it is not a prefix-equal restatement) but it is not
prose. The prose test must reject it. Incidentally it is free same-event
grouping data arriving in the feed and landing in the wrong column — noted, not
proposed.

## 2.2a SUBSTRATE CHECK — the NVIDIA case (run 2026-09-02, before anything else)

**It passes.** This was step 1 of the build order and it is now done.

Population: every NVIDIA-touching article ingested in the 45 days to
2026-09-02, unioned across four arms (`primary_company ILIKE`, `title ILIKE
nvidia`, `title ILIKE nvda`, `companies` jsonb containment, plus the
`Google News (NVDA)` feed read in weekly chunks). No arm hit the 1000-row cap.

| | count | share |
| --- | ---: | ---: |
| NVIDIA-touching articles, 45 days | 1,195 | |
| headline-only | 748 | 62.6% |
| prose via `summary` | 436 | 36.5% |
| prose via `content` (full_text) | 11 | 0.9% |
| **prose-bearing** | **447** | **37.4%** |
| …mentioning capex / guidance / margins **in the prose body** | **55** | |

Keyword split within the prose set: guidance 43, capex 13, margins 9 (union 55,
searched in `summary`+`content`, never the title).

**The exact brief scenario is on file.** Real rows, verbatim:

- `2026-08-27` **Bloomberg Tech** — "Chief Financial Officer Colette Kress
  saying the company expects to grow revenue by approximately 70% in fiscal
  2028." Named speaker, role, figure, period. A textbook fact row.
- `2026-08-27` **Benzinga** — "Memory prices will drive gross margins to
  71%–72% in Q4, the first major margin decline of the AI cycle." Figure,
  forward period, stated cause.
- `2026-07-31` **Yahoo** — "Nvidia stock rose after Amazon raised its capital
  expenditure forecast…" 27 days before the earnings brief.
- `2026-08-11` **SeekingAlpha** — "…AI capex & financing risks, China
  uncertainty and ASIC competition." 16 days before.
- `2026-08-27` **SeekingAlpha** — "Nvidia Delivered - The Margin Guide Is The
  Catch… hyperscaler AI capex (AWS 2M GPUs)."

### One caveat that narrows the claim

Of the 447 prose rows, only **16** carry a statement attributable to *management*
(a role or named-executive token co-occurring with a saying verb), and most of
those name someone else's executive (Wistron's chairman, RedCloud's CEO,
Ouster's CEO). NVIDIA management specifically appears in two: the Kress FY28
growth quote (Bloomberg, 08-27) and a Kress line on Vera CPU shipments
(TechCrunch, 08-26).

So the literal target sentence splits into two claims with different support:

| claim | supported today? |
| --- | --- |
| "last month the coverage flagged capex pressure" | **yes**, densely — 13 capex rows across July and August |
| "last month **they** flagged capex pressure" (they = NVIDIA management) | **thin** — management commentary is 3.6% of the prose set |

That is a `confidence` and `speaker` design problem, not a substrate failure.
Store `speaker` null unless the article names the person, set
`confidence = 'reported'` rather than `'quoted'`, and the brief writes "coverage
flagged" instead of "they flagged". The store is honest either way; only the
generated phrasing has to respect the difference.

### The prose rate is much better where people actually look

Prose rate by `primary_company`, same 45-day window:

| company | rows | prose | rate |
| --- | ---: | ---: | ---: |
| Nvidia | 451 | 182 | **40.4%** |
| Meta | 451 | 144 | 31.9% |
| Palantir | 262 | 82 | 31.3% |
| Broadcom | 191 | 52 | 27.2% |
| Apple | 397 | 107 | 27.0% |
| Eli Lilly | 222 | 58 | 26.1% |
| Amazon | 316 | 82 | 25.9% |
| Oracle | 232 | 57 | 24.6% |
| Microsoft | 287 | 62 | 21.6% |
| Tesla | 405 | 78 | 19.3% |
| **corpus-wide** | | | **13.8%** |

Heavily-covered names draw named-RSS coverage, not just Google News ticker
feeds. The fact layer will be **1.5-3x denser** than the corpus average for
exactly the companies a watchlist holds. This raises the value of backfill
tier 1 (watchlist companies, 180 days) and is the strongest argument for
starting there.

## 2.2b Why the prose rate is 13.8%, and what would raise it

Not a scraping problem. Not a fetching problem. **A feed-mix problem**, and the
84% is structural.

Prose rate by feed class, RECENT-12K:

| feed class | rows | share | prose | prose rate | full_text |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Google News (TICKER)** | 10,104 | 84.2% | 33 | **0.3%** | 0 |
| named RSS — other | 1,096 | 9.1% | 910 | 83.0% | 0 |
| named RSS — scrapeable | 425 | 3.5% | 412 | 96.9% | 325 |
| named RSS — paywalled | 224 | 1.9% | 207 | 92.4% | 0 |
| SEC | 151 | 1.3% | 98 | 64.9% | 0 |
| **total** | 12,000 | | 1,660 | **13.8%** | 325 |

Every non-Google-News class runs 65-97% prose. The single Google News class runs
0.3% and is 84% of the corpus. The whole shortfall is that one row.

**And it cannot be scraped.** All 10,104 Google News rows carry a
`news.google.com/rss/articles/CBMi…` redirect URL. `ingest.py:3484` gates
full-text enrichment on `source in SCRAPEABLE_SOURCES`, and no
`Google News (TICKER)` value is in that set — but even lifting the gate would
not work. Measured on 8 live URLs today:

- All 8 return **HTTP 200**, not a 3xx, and the final URL is still
  `news.google.com`. **0 of 8 resolved.**
- The served page is a ~594KB Angular shell. The only non-Google hosts anywhere
  in its HTML are `angular.dev` and `www.w3.org`. The destination is not in the
  markup.
- The `CBMi…` blob base64-decodes cleanly and contains **zero** embedded URLs.

The destination is fetched by a client-side `batchexecute` XHR. Recovering it
server-side needs a headless browser or a reverse-engineered RPC that Google has
broken repeatedly. That is not a line-item; it is a project with an ongoing
maintenance tail, ~1,200 fetches/day of outbound traffic, and a hard dependency
on an undocumented endpoint.

**What we do already have on those rows:** `publisher` and `publisher_domain`,
read from the RSS `<source>` element, non-null on **90.9%**. We know *who*
published; we just do not have the article URL.

### Three levers, ranked by return per unit of risk

**1. Add named RSS feeds. Cheapest, safest, and the only one with no external
dependency.** The named-RSS classes are 15.8% of rows and produce 100% of the
prose. Doubling named-feed volume roughly doubles the extractable population,
with no scraping and no new failure mode. Start with the outlets already
arriving *through* Google News at high volume — the `publisher` column now names
them, so the target list is a `GROUP BY publisher` away rather than a guess.

**2. Widen `SCRAPEABLE_SOURCES` (`fulltext.py:29-43`, 13 entries).** Absent from
it today, with their current volumes and prose rates: SeekingAlpha (287, 91.6%),
Benzinga (281, 68.0%), Yahoo (273, 89.7%), MarketWatch Top (37, 70.3%),
ChartMill (35, 94.3%), CNBC (25, 88.0%). These already carry prose in their RSS
description, so this buys **depth, not coverage** — full paragraphs instead of a
150-char blurb, which is worth more per fact but does not move the 13.8%. Do it
after lever 1, and honour `PAYWALLED_SOURCES`.

**3. Resolve the Google News redirect.** Highest ceiling by far (it would take
84% of the corpus from 0.3% to whatever the publishers give) and by far the
worst risk profile, per the measurements above. Not recommended as part of this
work. If it is ever attempted it should be its own project with its own
fail-open, and it should be measured on a sample before any pipeline dependency
is created.

**What none of this changes:** Piece 1 is unaffected. Top Stories clusters on
titles, and Google News rows have titles. The 84% is only a fact-layer problem.

## 2.3 The defensible cut

Extract from a row only when it carries prose:

```sql
content_type = 'full_text'
OR (
  summary <> ''
  AND length(regexp_replace(lower(summary), '[^a-z0-9]', '', 'g'))
    - length(regexp_replace(lower(title),   '[^a-z0-9]', '', 'g')) >= 20
)
```

Hit rate: **13.8%** on RECENT-12K, **18.7%** on CORPUS-10K.

Everything else is a 73-character headline. A fact row extracted from it says
what the headline said. That is not a fact layer; it is a second copy of the
title in a table that every brief queries.

## 2.4 Table design

Reuse the `financial_facts` pattern
(`supabase/migrations/20260603120000_create_financial_facts.sql`) — it is
applied, populated, and already solves provenance, restatement and fail-closed
validation for XBRL. `article_facts` is its prose sibling.

```
id                uuid pk
company_id        uuid references companies(id)
article_id        uuid references articles(id) on delete cascade
fact_type         text   -- figure | statement | guidance | cause | event | commentary
metric_key        text   -- 'revenue','capex','headcount'; null for a statement
value_num         numeric
value_unit        text
period_start      date
period_end        date
period_type       text   -- duration | instant | forward
as_of             date        NOT NULL   -- article published_at::date
claim_text        text        NOT NULL   -- verbatim span, capped at 500
speaker           text                   -- named exec, or null
speaker_role      text
stated_cause      text
confidence        text   -- reported | quoted | inferred
extraction_model  text
extracted_at      timestamptz
dedup_key         text        NOT NULL
UNIQUE (article_id, dedup_key)
```

**Provenance.** `article_id` is the only source of truth, and no fact is stored
without one — that is what `accession_number` does for `financial_facts`.
`as_of`, `speaker` and `claim_text` are copied at write time so the ledger stays
auditable if the article later mutates, exactly as `claim_evidence` copies
`article_sentiment` and `article_published_at` (`sql/0026_claim_evidence.sql:29-33`).

**Dedup when five articles report the same figure: do not dedup on write.**

- `UNIQUE (article_id, dedup_key)` is the only uniqueness the write path can
  honestly enforce, and it is what makes the pass idempotent and re-runnable.
  Same reasoning as `UNIQUE (claim_id, article_id)` in
  `sql/0026_claim_evidence.sql:37`.
- Five outlets reporting "$17 billion" **is** the corroboration signal. Merging
  it on write destroys the count.

Dedup on **read**, in a view, the way `financial_facts_latest` does:

```sql
CREATE VIEW article_facts_agreed AS
SELECT f.company_id, f.fact_type, f.metric_key, f.value_num, f.value_unit,
       f.period_start, f.period_end,
       count(*)                       AS n_sources,
       count(DISTINCT a.publisher)    AS n_publishers,
       min(f.as_of)                   AS first_reported,
       array_agg(f.article_id)        AS sources
FROM article_facts f
JOIN articles a ON a.id = f.article_id
GROUP BY 1,2,3,4,5,6,7;
```

`dedup_key` is a normalized signature the extractor computes:
`fact_type|metric_key|round(value_num)|period_end` for a figure, a token-set
hash of `claim_text` for a statement. Round with `figures.py`'s existing
tolerances rather than inventing new ones.

## 2.5 Where extraction runs

**A separate pass over stored articles.** New `backend/fact_extractor.py`,
inserted in the step manifest (`run.py:481-506`) after step 2 `deal_extractor`
and before step 3 `synthesize`, so the day's facts are on file before the brief
reads.

**It must not touch the filter call, and the constraint is real.**
`ingest.py:2095-2131` assembles the filter prompt as
`_FILTER_STATIC_PREFIX` + `_FILTER_FIELDS_TAIL` and passes
`cached_content=cache_name`; `ingest.py:967-968` asserts the reordered prompt is
byte-identical to prefix+tail. Measured cache hit rate over the last five runs:
**91.5%** of filter input tokens served from cache (2026-09-02T14:04:
19,137,211 of 19,336,653). Editing that prefix invalidates the cache and roughly
triples the filter's input cost.

Reading stored rows also means extraction sees a **post-filter, post-dedup**
population: ~1,393 stored per day against ~5,600 filter calls per run, so it
does about 1/8 the work the filter does, and it can re-run or backfill without
re-ingesting.

Shape it like `deal_extractor` — the closest working precedent: Pydantic
`response_schema`, `thinking_budget=0`, parallel workers, a per-call timeout, and
`accumulate_gemini_usage("fact_extractor", …)` so its cost lands in
`gemini_usage` next to everything else and the numbers in this document stay
checkable.

## 2.6 Cost

Measured from `gemini_usage`, aggregating on the `calls` column (one row
aggregates a whole run — reading row counts as call counts is wrong by ~10,000x
on the filter step):

| step | calls | avg in | avg out | cached share | $/call |
| --- | ---: | ---: | ---: | ---: | ---: |
| filter | 883,768 | 3,921 | 327 | 91.5% | $0.001188 |
| shadow_grader | 474,671 | 1,214 | 38 | 0% | $0.000461 |
| deal_extractor | 4,851 | 1,566 | 21 | 21.5% | $0.000447 |
| form_8k | 1,408 | 1,692 | 84 | 0% | $0.000718 |
| brief_synthesis | 468 | 3,523 | 543 | 3.4% | $0.002390 |

Priced at Flash $0.30/$2.50 per 1M with cached input at $0.075/1M — the rates
`cross_source.py:276-277` uses — so the steps compare on one scale. **The filter
actually runs on `gemini-2.5-flash-lite` at $0.10/$0.40** (`ingest.py:88-89`),
so its true per-call cost is about a third of the table figure.

An extraction call sized like `deal_extractor` (~1,600 token prompt over one
article's title+summary, ~250 output tokens for 3-6 fact rows) costs about
**$0.0011** at Flash rates, **$0.00035** at Flash-Lite.

**Per run.** 9,751 articles stored in the 7 days to 2026-09-02 = **~1,393/day**.
Apply the 13.8% prose cut = **~192 articles/day**.

| scope | per day | per month |
| --- | ---: | ---: |
| prose cut, Flash | $0.21 | **$6.30** |
| prose cut, Flash-Lite | $0.07 | $2.10 |
| every stored article, Flash | $1.53 | $46 |

Five times the spend for a store that would be ~86% restated headlines.

**Backfill.** Corpus ~59,000 articles. At 18.7% prose that is **~11,000
articles**: **$12 one-time** at Flash, $4 at Flash-Lite.

Cost is not the constraint. The constraint is that 81% of the corpus has nothing
to extract from.

Recommended backfill tiers, tightest first:

1. Prose rows for companies on at least one watchlist, last 180 days. Smallest
   set, highest read probability, proves the NVIDIA case.
2. All prose rows, last 180 days.
3. All prose rows, all time (~11,000, $12).

Do not backfill headline-only rows at any tier.

## 2.7 The load question

The constraint is documented, not hypothetical:
`sql/0024_disk_io_indexes.sql:9-12` records *"Disk IO Budget about to deplete
(baseline 5 MB/s once burst credits are exhausted)"*, and `sql/0023` records the
57014 timeouts it produced on Top Stories. It bit this recon: both
`count(*) FROM articles` and `count(*) FROM financial_facts` timed out.

**Sizing.** ~192 articles/day × ~4 facts = **~800 rows/day, ~290k/year**. Small
next to `articles` in row count. The risk is the read pattern, not the size.

**Index for the brief's actual query, from the start:**

```sql
CREATE INDEX CONCURRENTLY article_facts_company_asof_idx
  ON article_facts (company_id, as_of DESC);              -- the brief's read

CREATE INDEX CONCURRENTLY article_facts_company_metric_asof_idx
  ON article_facts (company_id, metric_key, as_of DESC)
  WHERE metric_key IS NOT NULL;                           -- "capex over time"

CREATE INDEX CONCURRENTLY article_facts_article_idx
  ON article_facts (article_id);                          -- provenance, cascade

CREATE INDEX CONCURRENTLY article_facts_asof_idx
  ON article_facts (as_of DESC);                          -- the daily pass window
```

Rules that keep it off the IO budget:

- The brief reads a bounded set:
  `WHERE company_id = ANY($1) AND as_of >= now() - interval '90 days'` with an
  explicit LIMIT. Never an unbounded `SELECT *`.
- `claim_text` is the only wide column. Cap it at 500 chars and keep it out of
  every `ORDER BY` — that is precisely the fix `sql/0023` documents for Top
  Stories (rank on light columns, hydrate after).
- Build indexes `CONCURRENTLY`, one statement at a time, off-peak, per the
  `sql/0024` header. Agents do not apply migrations.
- Every read paginates on keyset or asserts `len(rows) == count`. A 1000-row
  response does not error when it truncates.
- The aggregation view is where cost hides. Ship the base table and the four
  indexes first; add `article_facts_agreed` only once you can measure it with
  `EXPLAIN ANALYZE` on real volume.

## 2.8 One reader: the morning brief

**Change site:** `synthesize.py:5466-5481`, where `spine_texts` is assembled and
joined into `article_text`. It already decorates each spine article with an
`Entities:` line and a `Signal:` line. Add a third.

```python
def _facts_line(a):
    rows = facts_for(_companies_of(a), before=brief_date, days=90, limit=6)
    if not rows:
        return ""
    return "\nOn file: " + "; ".join(
        f"{r['as_of']}: {r['claim_text']}" for r in rows
    )
```

**One query per brief, not per article.** Collect every company across spine +
floor (12 + 6 articles, ≤ ~30 distinct companies), issue a single
`.in_("company_id", ids).gte("as_of", cutoff)` read, group in Python. That is
one indexed read per brief — the entire IO cost of the feature.

**Token cost:** 6 facts × ~30 tokens = ~180 extra input tokens per spine
article × 12 = ~2,200, against a `brief_synthesis` prompt that currently
averages 3,523 input tokens. At Flash that is **+$0.00066 per brief**, about
$0.04/month across two briefs a day.

**Do not put facts in `MORNING_SYSTEM`.** That is the cached-prefix mistake in a
different file. The corpus block is where per-run content already goes.

### How to tell whether the output actually got better

Three checks, ordered by how much each one proves.

**1. Structural, and the only mechanical one.** Count sentences in the generated
brief that cite a date more than 7 days before the brief date *and* name a
company with a matching `article_facts` row. **Today that count is 0 by
construction** — the synthesis pool is a 48h window (`publish_cutoff`,
`synthesize.py:4873`), so the brief cannot reference last month. Any number
above 0 is the feature working, and every such sentence traces to an
`article_id`. Run it as a shadow: generate both briefs from the same pool, diff.

**2. Grounding regression — the most likely way this breaks the brief.**
`_unsupported_orgs_in_sections` (`synthesize.py:2319`) fails a brief that names
an org absent from the corpus text. Facts will introduce org names that are not
in the corpus. Either the facts block joins `corpus_text` for that check or the
check gets a second allowlist. This will not surface until a real run.

**3. Critic scores.** `brief_quality_scores`
(`backend/brief_quality_scores_schema.sql`) writes one row per run with
`banned_phrase_hits`, `headline_pass`, `sections_present`. Compare the 14 runs
either side. It measures voice, not accuracy — a regression guard, not proof.

**The NVIDIA acceptance test, and run it first.** Take a real NVIDIA earnings
article from the last cycle and a real NVIDIA article ~30 days earlier that
mentions capex. Extract from both. Confirm the earlier row surfaces in the
later article's brief prompt. If that earlier article turns out to be a
73-character headline, **the case fails on substrate, not on code** — which is
exactly why this is step 1 and not step 6.

## 2.9 Build order

1. ~~**Measure the NVIDIA case against real rows.**~~ **DONE 2026-09-02 —
   passed.** 447 prose rows in 45 days, 55 touching capex/guidance/margins,
   including a named-CFO guidance quote. See §2.2a. The one adjustment it forces
   is on `speaker`/`confidence`, not on the plan: management commentary is 3.6%
   of the prose set, so the brief must say "coverage flagged", not "they
   flagged", unless a speaker is named.
2. `sql/00xx_article_facts.sql` — hand-apply, table plus the four indexes,
   `CONCURRENTLY`, one statement at a time, off-peak. Human applies it.
3. `backend/fact_extractor.py` with a `--dry-run` that prints and writes
   nothing, mirroring `cross_source.py`'s shape. Validate the schema against 200
   real prose articles before a single write. **Build the golden eval here**,
   modelled on `backend/evals/xbrl_golden_eval.py`.
4. Wire into `run.py`'s manifest between steps 2 and 3. Register in
   `gemini_usage`.
5. Backfill tier 1 behind a ledger, keyset-paginated, asserting every read
   reaches its reported count.
6. The reader in `synthesize.py`, shadow-diffed for 3 runs before it enters the
   shipped prompt.
7. Only then the aggregation view, and only then memos, wraps, and company
   pages.

## 2.10 Where it goes wrong

- **The substrate is the ceiling.** 86% of stored rows have no prose. If the cut
  is loosened to fill the table, the table fills with restated headlines and
  every reader gets noisier. The 13.8% is not a starting point to improve on; it
  is the honest ceiling until ingest captures more prose.
- **Extraction quality is unmeasured.** There is a golden eval for XBRL
  (`backend/evals/xbrl_golden_eval.py`). There is none for prose facts. Without
  one, "the output got better" is a vibe. Build it in step 3, not after step 6.
- **A fact with no period cannot be aged.** Guidance and commentary usually have
  no `period_end`. `as_of` answers "last month they said"; `period_end` answers
  "FY27 guidance". Storing only one collapses two different questions.
- **Misattributing a statement is the worst failure here** — worse than a wrong
  number, because it is quotable. Store `speaker` as null unless the article
  names the person. Never infer a role.
- **`financial_facts` and `article_facts` will disagree.** XBRL says revenue was
  X; an article says the CFO said "about Y". Both are true rows. A reader that
  silently prefers one will eventually publish the wrong number. Decide the
  precedence rule before the second reader ships, and put it in the view, not in
  each caller.
- **The IO budget.** Adding a table every brief queries is the exact shape that
  produced the Top Stories timeouts. The four indexes are the mitigation and
  they are unproven until measured with `EXPLAIN ANALYZE` on real volume.

---

## Appendix: how each number was produced

| claim | method |
| --- | --- |
| `cross_source_clusters` = 27 rows, one timestamp | `select(count="exact")`, then full read ordered by `computed_at` |
| cluster distributions | `impact_ranking.cluster_key` + `cross_source.split_by_time_gap` run over RECENT-12K in process |
| live Top Stories pool | `fetchTopStories`' tier-1 query reproduced exactly: `gte(ingested_at, -72h)`, `gte(published_at, -7d)`, four-key order, `limit(24)` |
| collapse variants | `collapseSameEvent` and `clusterArticles` reimplemented in Python from `top-stories.ts:190-227` and `clustering-utils.ts:70-116`, run over the same 24 rows |
| corpus-scale clustering | capitalized-token inverted index for blocking, then greedy seed-anchored grouping matching `clusterArticles`' loop exactly |
| summary / content coverage | RECENT-12K and CORPUS-10K in process, cross-checked with exact PostgREST counts for `ingested_at >= 2026-08-25` |
| Gemini costs | full read of `gemini_usage` (7,102 rows), aggregated on `calls`, priced at the Flash rates in `cross_source.py:276-277` |
| ingest rate | `count(exact)` on `ingested_at >= 2026-08-26` = 9,751 over 7 days |

Reads that could not be completed, and why they are absent rather than
estimated: `count(*) FROM articles`, `count(*) FROM financial_facts`, and
per-month exact summary counts for June/July all returned 57014 statement
timeout.
