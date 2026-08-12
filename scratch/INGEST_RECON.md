# backend/ingest.py — behavioural recon

**Scope:** what the code actually does, correctness, and quality. Cost is out of scope by request.
**Code read from `origin/main`** (commit at time of writing: `517ec47`), not from any feature branch. Two open PRs (#580 deal_type validation, #581 sort tiebreakers) would change behaviour described here; both are called out where relevant.
**Production config is not the code default.** Repo variables in effect: `RELEVANCE_GRADE_MODE=new`, `GRADER_SKIP_IRRELEVANT=1`, `FILTER_PROMPT_CACHE=1`, `INGEST_BLOCKLIST_MODE` (unset → `shadow`), `TAGGING_PRIMARY_FOLD_ENABLED=true`.

**Corpus at time of measurement: 162,327 rows** (derived: the eleven `relevance_score` counts sum exactly to this, and `relevance_score IS NULL` = 0).

Every claim is tagged **[V]** verified from code or a query I ran, or **[I]** inferred.

---

# PART 1 — The pipeline, stage by stage

`run_ingestion()` (`ingest.py:2526`). Four numbered stages plus two unnumbered tails.

## Stage 0 — Fetch (`fetch_all_articles`, :1396)

Four sources, appended into one list, in this order:

| source | entry cap | freshness applied? | `publisher` set? |
|---|---|---|---|
| 18 RSS feeds (`RSS_FEEDS`, :241) | **40** if in `WIRE_SOURCES`, else **8** | yes, counted + logged | **yes** — `source` name + domain from item link |
| NewsAPI (5 queries × 8) | **8/query** | **no** | **no** |
| Watchlist Finnhub (`fetch_watchlist_finnhub_articles`, :1274) | per-ticker cap 8 | per that function | **no** |
| Google News per-ticker (`fetch_gnews_per_ticker_feeds`, :398) | **`GNEWS_ENTRY_CAP = 20`**, 8 workers | yes, **silently** | **yes** — RSS `<source>` element, falling back to the ` - Publisher` title suffix |

- **Freshness: `INGEST_FRESHNESS_DAYS = 7`** (:1394). Applied in the RSS loop (:1426) and the gnews loop (:1355). **[V]** A missing or unparseable `published_at` **passes the gate** — both loops `pass` on parse failure. **[V]**
- `published_at` is never now-stamped; missing stays NULL. **[V]**
- Fetch is bounded by `_fetch_feed_bytes(timeout=RSS_FETCH_TIMEOUT_SEC=20)`. **[V]**
- **Final URL dedup** (:1508): `if a["url"] and a["url"] not in seen and a["title"]`. Drops duplicate URLs, empty URLs, and empty titles. **No count, no log.** **[V]**
- NewsAPI is inside one `try` covering all five queries; `NEWS_API_KEY` is absent from `.env.local`, so locally this raises `KeyError` on the first query and the whole NewsAPI block is skipped. In CI the secret exists. **[V] locally / [I] in CI**

**Out:** `(unique_articles, source_fetch_stats, gnews_stats)`.

## Stage 1 — Keyword blocklist + language gate (:2540)

- `matches_ingest_blocklist` (:949). **`INGEST_BLOCKLIST_MODE` is unset → `shadow`** (:911), meaning the **legacy substring matcher over the unpruned phrase set is authoritative**; the pruned word-boundary matcher is computed and divergences logged as `BLOCKLIST_SHADOW_DIVERGENCE`. Every block logs the matched phrase and title. **[V]**
- Language gate `_is_probably_english` (:1245), three prongs: ≥20% non-Latin letters → drop; ≥`_LONG_TEXT_TOKENS`(40) tokens with <`_MIN_EN_EVIDENCE`(3) English function words → drop; short rows only dropped if a real detector is *confident* the title is a specific foreign language. Logged as a delta count only, not per article. **[V]**

## Stage 2 — Dedup-before-filter (:2556)

- `_load_store_dedup_sets(candidate_urls=…)` (:2170): URL leg is a **bounded membership probe** over the run's own URLs against a 30-day window (`_URL_PROBE_CHUNK=200`, `_URL_PROBE_CHAR_BUDGET=6000`); the title leg is a **full 24-hour paginated read** of `title`, normalised client-side. **[V]**
- `partition_unseen_articles` (:2221): drop if exact URL seen in 30d **or** normalised title seen in 24h. Logged as a count. Deliberately does **not** collapse within-run duplicates — that is left to the store. **[V]**

## Stage 3a — SEC deterministic bypass (`_apply_filter_with_sec_bypass`, :2300)

`_sec_bypass_decision` (:2265) fires only when `source` starts with `"SEC "` **and** the title matches `_SEC_TITLE_RE`. Non-matching SEC titles (~3% per the docstring) fall through to the LLM. **[V]**

Pinned output: `10-Q` → score 8, `deal_type=Earnings`. `8-K` → score 8 if the item set intersects `_SEC_MATERIAL_8K_ITEMS` else 6; `deal_type=Earnings` iff item `2.02` present. Always `companies=[]`, `themes=[]`, `sentiment=neutral`, `primary_company=filer`, and a `relevance_reason` containing the literal marker `"deterministic SEC bypass"` — which is how every later stage recognises an SEC row. **[V]**

## Stage 3b — Flash-Lite filter (`filter_articles` → `_filter_article_with_retry` → `filter_article`, :1706/:1683/:1609)

- Model `GEMINI_FILTER_MODEL = gemini-2.5-flash-lite`, `temperature=0.2`, `thinking_budget=0`, `response_schema=FilterDecision`, `max_output_tokens=2048`. **[V]**
- `FILTER_PARALLEL_WORKERS = 50`; 30s hard per-call timeout via an inner single-worker pool. **[V]**
- Retries **only** 429/RESOURCE_EXHAUSTED and 503/UNAVAILABLE, `FILTER_MAX_RATE_RETRIES = 5`, exponential backoff capped at 30s. Schema/parse/timeout failures are **not** retried here. **[V]**
- `_filter_article_with_retry` adds exactly **one** whole-call retry on `None`, logging `[filter:schema-fail]` then `[filter:retry-fail]`. **[V]**
- **`FILTER_PROMPT_CACHE=1` in production**, so the request carries only the fields tail against a cached static prefix. **[V]**
- One decision object per article: `relevant`, `relevance_score`, `relevance_reason`, `industry_verticals`, `activity_types`, `companies[{name,entity_type}]`, `themes`, `sentiment`, `sentiment_reason`, `deal_type`, `primary_company`. **[V]**

## Stage 3c — Relevance grader (`apply_relevance_grade`, :702)

Runs for every non-`legacy` mode, across the same 50-worker pool.

**Production is `new`, so the branch that actually executes is:** skip if SEC (marker test on `relevance_reason`); **skip if `GRADER_SKIP_IRRELEVANT` and `not result["relevant"]`** — set in prod, so the expensive pass runs only on articles the cheap filter kept; otherwise call `grade_relevance` (:641) on `gemini-2.5-flash` and **overwrite `result["relevance_score"]`** and set `result["relevance_band"]`. On grader failure the legacy Flash-Lite score is silently retained. **[V]**

`grade_relevance` clamps to `[0,10]` via `_clamp_relevance_score`; an unparseable score logs `[relevance-grade] unparseable` and returns `None`; band falls back to `"unknown"` if outside `_RELEVANCE_BANDS`. **[V]**

## Stage 3d — Ingest gate (:2596)

```python
ingest_gate = RELEVANCE_NEW_GATE if RELEVANCE_GRADE_MODE == "new" else 6
if result and result.get("relevant") and result.get("relevance_score", 0) >= ingest_gate:
```

**In production `ingest_gate = RELEVANCE_NEW_GATE = 1`**, not 6. **[V]** Three ways to be dropped: `result is None`, `relevant` falsy, score below 1.

## Stage 4 — Store (`store_articles_batch`, :2357)

- In-batch dedup against the same URL/title sets, extended as it goes; `dupes` counted. **[V]**
- `_clean_companies` → `extract_company_names` → `is_blocked_entity` → `_resolve_company_valid` (memoised Wikidata). **[V]**
- `_article_row` (:2045) writes: `title` (HTML-unescaped), `summary`, `url`, `source`, `published_at`, `relevance_score`, `relevance_reason`, `companies` (via `_fold_primary_into_companies`), `themes`, `sentiment`, `sentiment_reason`, `sector` (= `industry_verticals[0]` or `""`), `industry_verticals`, `activity_types`, `deal_type` (**unvalidated on main**; PR #580 adds `validate_deal_type`), `primary_company`, `content_type`, and `publisher`/`publisher_domain` when the columns exist. **[V]**
- `validate_tags` whitelists `industry_verticals` and `activity_types`. **Nothing whitelists `deal_type`, `sentiment`, or `primary_company`.** **[V]**
- Chunked at `STORE_CHUNK_SIZE = 500`; chunk insert falls back to per-row on failure. **[V]**
- `INGEST_PHASE_BUDGET_SEC = 4800` (80 min) wall-clock deadline; past it the store stops, flushes in-flight, logs `[store:budget]`. **[V]**
- `company_mentions` bulk-inserted, then `mention_count` incremented **only for rows that actually persisted**. **[V]**

## Tail A — Full-text enrichment (:2632)

For stored rows whose `source ∈ SCRAPEABLE_SOURCES`, scrape and `UPDATE articles SET content`. 0.5s sleep per article, serial. **`content_type` is never updated.** **[V]**

## Tail B — Watchlist boost

`boost_watchlist_relevance(article_ids)` — `new_score = min(10, score + 2)` for rows matching a watchlist identifier in title/summary/companies. **A mutation of `relevance_score` after storage, and the match itself is not recorded anywhere.** **[V]**

---

# PART 2 — Broken or hidden

## 2.1 Silent drops (no log line at all)

| # | site | what is lost |
|---|---|---|
| 1 | **gnews freshness skip** (:1355) | bare `continue`, **no counter, no log** — unlike the RSS loop, which counts and prints `skipped N stale`. On the path carrying ~88% of ingest volume. **[V]** |
| 2 | **gnews missing link/title** (:1345) | `if not link or not title: continue`, no log **[V]** |
| 3 | **fetch-level URL dedup** (:1508) | duplicate URL / empty URL / empty title, all dropped with no count **[V]** |
| 4 | **ingest gate** (:2596) | the loop prints `✓` only on the **pass** branch. A dropped article produces **no line**. Given the gate is the single biggest filter in the pipeline, its rejections are entirely invisible. **[V]** |
| 5 | `_resolve_company_valid` returning False inside `_clean_companies` (:2089) | company silently omitted from `companies[]`; only `is_blocked_entity` logs **[V]** |

## 2.2 Failures that fall back to a default instead of surfacing

| site | fallback |
|---|---|
| `grade_relevance` returns `None` (:701) | legacy Flash-Lite score **silently retained**. Logged at the grader, but the *article* carries no marker that it holds a legacy score, so the two populations are indistinguishable in the DB. **[V]** |
| `_load_store_dedup_sets` URL leg or title leg raises (:2208, :2217) | prints once, **continues with an empty set** → dedup silently weakens to nothing for that run **[V]** |
| `_primary_resolves_to_indexed` error (:1993) | returns `False` (fail-closed) — correct, but indistinguishable from "genuinely not indexed" **[V]** |
| RSS feed exception (:1451) | logs, continues; **that feed contributes zero articles and the run still reports success** **[V]** |
| NewsAPI block (:1478) | one `try` around all five queries; first failure skips the rest **[V]** |
| `_accumulate_filter_usage` (:1545) | bare `except: pass` **[V]** |
| `_publisher_columns_available` (:2030) | on any error, caches `False` for the whole process → publisher silently not stored for that entire run **[V]** |

## 2.3 Written to the DB that nothing downstream reads

- **`sentiment_reason`** — written on every row; I found no reader in `backend/` or `src/`. **[I]** (absence of a grep hit is not proof)
- **`activity_types`** — written and whitelisted; read by Radar follows (`radar-following.ts` taxonomy matcher) but by nothing in the brief/synthesis path. **[V] partial**
- **`content_type`** — read in exactly one place, `src/app/api/theses/route.ts:282,315`, where it is injected into the thesis-generation prompt. See 2.5 for why that is actively harmful. **[V]**

## 2.4 Computed and then discarded

| value | where computed | fate |
|---|---|---|
| **`relevance_band`** | `grade_relevance` (:686), assigned to `result["relevance_band"]` (:753) | `_article_row` never writes it. **Discarded.** **[V]** |
| **`grade["reason"]`** | `grade_relevance` (:687), 200 chars of the grader's justification | `apply_relevance_grade` reads only `score` and `band`. **Never read at all.** **[V]** |
| **gnews `<source>` href** | `extract_publisher` returns `(title, domain)` | domain **is** stored; noted here only because the pre-#551 corpus has it nowhere **[V]** |
| **headline-echo signal** | `_is_headline_echo` (:1055) | used to **blank the summary** (:1382). The fact that the summary *was* an echo is not recorded — indistinguishable afterwards from a feed that supplied no summary. **[V]** |
| **SEC item codes** | `_SEC_ITEM_RE` findall (:2280) | used for score/deal_type only, then dropped. The item set itself (e.g. 5.02, 1.01) is never stored. **[V]** |
| `source_fetch_stats`, `gnews_stats` | fetch | printed in the funnel lines, never persisted **[V]** |

## 2.5 Stated behaviour vs actual production behaviour

| stated | actual |
|---|---|
| `run_ingestion` comment (:2578): *"DEFAULT shadow is prod-neutral… leaves relevance_score and the >=6 gate untouched"* | **`RELEVANCE_GRADE_MODE=new`.** The Flash grade is authoritative and the gate is **1**. The comment describes a configuration that is not running. **[V]** |
| Gate comment (:2592) and the funnel log lines (:2622, :2631) both say **"passed relevance >= 6"** | the gate is **>= 1**. The printed funnel numbers are labelled with a threshold that has not applied since 2026-06-19. **[V]** |
| `GRADER_SKIP_IRRELEVANT` docstring (:747): *"Default OFF so merging changes nothing"* | **set to 1 in production.** **[V]** |
| `_INGEST_BLOCKLIST_MODE` default `shadow` | unset in repo variables → genuinely `shadow`; the **legacy unpruned substring matcher is what runs**. The pruned set exists but is advisory. **[V]** |
| `[filter:usage]` line (:1818) prices output at **$2.50/1M** | the filter runs on **flash-lite**, not flash. The estimate uses the wrong model's rate. It self-labels `ESTIMATED (… meter is truth)`, so it is honest about being an estimate but wrong about the constant. **[V]** |
| `accumulate_gemini_usage("shadow_grader", …)` (:673) | that label is emitted **regardless of mode**. In `new` mode the authoritative scorer meters itself under the name `shadow_grader`. **[V]** |
| `_article_row` comment (:2081): *"for 88% of the corpus [source] is one of ~819 Google News names"* | still true directionally; full-table `publisher IS NULL` is **156,112 / 162,327 = 96.2%** **[V]** |

## 2.6 Unobservable — where a regression runs for weeks

- **The ingest gate.** No per-drop logging and no persisted count of rejections. A grader shift that halved the keep rate would show up only as fewer stored rows, which is indistinguishable from a quiet news day. **[V]**
- **gnews freshness.** No counter. If a feed started returning only stale items, the articles would vanish with no signal. **[V]**
- **Per-feed health.** A permanently broken RSS feed logs one line per run and the run still succeeds. There is no persisted per-source time series; `source_fetch_stats` is printed and dropped. **[V]**
- **Grader fallback rate.** When `grade_relevance` fails, the row silently keeps a legacy score. Nothing records which rows those are, so the mixed population cannot be separated after the fact. **[V]**
- **`relevance_band`.** Computed every run, never stored — so the grader's own confidence signal cannot be trended. **[V]**
- **Score-0 rows.** 1,033 rows carry `relevance_score = 0`, which the current gate (`>= 1`) makes impossible. Their `ingested_at` range is **2026-06-15 → 2026-06-22** and there are none since. **[V]** They straddle 2026-06-19, the date `RELEVANCE_GRADE_MODE=new` was set as a repo variable — most plausibly a window where the deployed code and the variable disagreed. **[I]** — I cannot verify the deploy timeline. It is bounded and historical, not ongoing.

---

# PART 3 — Where quality is being lost

## 3.1 Full-table field reliability (n = 162,327)

| field | condition | rows | % |
|---|---|---|---|
| `publisher` | IS NULL | **156,112** | **96.2%** |
| `content` | IS NULL | 156,692 | 96.5% |
| `summary` | `= ''` | 59,015 | 36.4% |
| `primary_company` | IS NULL | 27,167 | 16.7% |
| `sector` | `= ''` | 7,749 | 4.8% |
| `content_type` | `= 'full_text'` | 1,768 | 1.1% |
| `published_at` | IS NULL | 804 | 0.5% |
| `relevance_reason` | `= ''` | 6 | 0.004% |

**Correction to my own earlier recon:** I previously reported "88% empty summaries" from a 48-hour window. **Full-table it is 36.4%.** The 48h figure was inflated by the recent gnews-heavy mix, where echo-blanking applies most. A 30-day or 48-hour window is not representative of this column.

Dependencies on the thin fields: `summary` feeds the filter prompt, the grader prompt (600 chars), `company_mentions.context`, and the brief. `publisher` is what `cross_source.py` and `source_reliability.py` group on.

## 3.2 Score distribution (full table)

| 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1,033 | 7,135 | 3,095 | 31,486 | 13,457 | 8,099 | 3,028 | 3,414 | 30,672 | 22,618 | **38,290** |
| 0.6% | 4.4% | 1.9% | 19.4% | 8.3% | 5.0% | 1.9% | 2.1% | 18.9% | 13.9% | **23.6%** |

Bimodal, confirmed at full-table scale: **32.7% in 3-5**, **4.0% in 6-7**, **56.4% in 8-10**. The 6-7 band is where `FILTER_PROMPT` explicitly routes analyst actions and index recaps — two of the most common article types in this corpus — and it holds 4% of rows. **[V]** This corroborates the 48h finding rather than contradicting it (23.6% vs 23.4% at exactly 10).

## 3.3 Near-duplicate coverage

Sample: 30,000 most recent rows, 2026-07-27 → 2026-08-08. Full-table paging deliberately avoided given the documented disk-IO budget; labelled as a sample.

- **Exact normalised-title collisions: 5,219 rows in 2,442 groups (17.4%).** Largest group 7 rows. These survive because the store's title dedup is a **24-hour** window; the same headline 25 hours later is a new row. **[V]**
- **`impact_ranking.cluster_key` event clusters: 15,066, of which 11,496 (76.3%) are singletons. 18,504 rows (61.7%) sit in a multi-article cluster.** **[V]**
- Largest clusters are `:stock`-themed and enormous: `co:spacex:stock` 147, `co:apple:stock` 128, `co:amazon:stock` 119, `co:microsoft:stock` 119. **[V]** These are topics spanning days, not events — a known limitation of that key, restated here because it bounds any dedup built on it.

## 3.4 Cross-stage contradictions

**`content_type` and `content` have ZERO overlap.** In the 30k sample: 310 rows labelled `full_text`, 529 rows holding `content`, and **0 rows where both are true**. **[V]**

Cause is structural, not accidental: `content_type` is set at fetch from `FULL_TEXT_SOURCES = {SEC 8-K, SEC 10-Q, Federal Reserve}` (:262), while `content` is populated by Tail-A enrichment for `SCRAPEABLE_SOURCES = {TechCrunch, Axios, GlobeNewswire, PR Newswire, Crunchbase News, Defense News, PE Hub, …}`. **The two sets are disjoint.** So `content_type='full_text'` means "came from SEC/Fed", never "has full text", and every row that *does* have full text is labelled `snippet`. **[V]**

This is not inert. `src/app/api/theses/route.ts:315` injects `content_type=snippet|full_text` into the thesis-generation prompt, so the generator is told the opposite of the truth on both populations. **[V]**

Other checks:
- `sector = ''` while `industry_verticals` non-empty: **0**. Consistent. **[V]**
- `deal_type = Earnings` with `activity_types` lacking `Earnings & Results`: 182 of 9,399 (2%). Largely consistent. **[V]**
- **`primary_company` not present in `companies[]`: 7,584 of 30,000 (25.3%)** — despite `TAGGING_PRIMARY_FOLD_ENABLED=true`. The fold requires the name to resolve to an existing `companies` row (`_primary_resolves_to_indexed`, :1977), so a quarter of primaries are not in the entity index. **[V]** Consequence: any query matching on `companies[]` misses those articles for their own main actor.

## 3.5 Signal the source data carries and ingest discards

- **The ` - Publisher` title suffix** was stripped and discarded for the entire pre-#551 corpus. Not recoverable: the Google News URL is a redirect blob whose page carries no publisher in the HTML. **[V]** — 96.2% of the table has no publisher.
- **The headline-echo fact** (§2.4): the summary is blanked, and "there was no distinct summary" becomes indistinguishable from "the feed sent nothing".
- **SEC item codes** are read for scoring and thrown away.
- **The grader's `band` and `reason`** are produced on every graded article and stored nowhere.
- **The watchlist match** is folded into `relevance_score` as `+2` and cannot be recovered afterwards.
- **NewsAPI and Finnhub rows never get `publisher` set** even though those payloads carry a source name — `fetch_all_articles` sets it for RSS and gnews only. **[V]**

---

# PART 4 — Observations

Each states the observation, the evidence, what would have to be true for it to matter, and the measurement that would establish it. No recommendations.

**4.1 — `content_type` is inverted relative to `content`, and feeds a prompt.**
Evidence: §3.4, zero overlap, disjoint source sets, single reader at `theses/route.ts:315`.
Would matter if: the generator's output measurably changes with that token. Measurement: hold the article set fixed and vary only the `content_type` value in the prompt; compare outputs.

**4.2 — The ingest gate is the largest filter and is entirely unlogged.**
Evidence: §2.1 #4 — the loop prints only on the pass branch; no rejection count is printed or persisted.
Would matter if: keep-rate drifts without an accompanying stored-row anomaly. Measurement: emit and persist a per-run `(candidates, passed, dropped_by_reason)` triple and watch its variance across runs.

**4.3 — Grader fallbacks are invisible after the fact.**
Evidence: §2.2 — on failure the legacy Flash-Lite score is retained with no marker on the row.
Would matter if: the fallback population is large enough to shift the score distribution, or is concentrated in a source or time window. Measurement: record which grade path produced each stored score, then compare the two distributions.

**4.4 — 17.4% of recent rows are exact title duplicates; the store's title dedup window is 24 hours.**
Evidence: §3.3, and the 24h `title_cut` at :2214.
Would matter if: the duplicates are the same event rather than legitimate re-reporting, and if they displace distinct stories from the fixed-size pools that read this table. Measurement: sample the collision groups and label same-event vs distinct; separately, count how many rows in a brief's 60-row pool belong to one collision group.

**4.5 — `relevance_band` and the grader's `reason` are computed on every graded article and discarded.**
Evidence: §2.4, verified against `_article_row`.
Would matter if: the band separates articles that the score alone does not — in particular whether the 38,290 rows at exactly 10 carry different bands. Measurement: persist the band for one run and cross-tabulate band against score.

**4.6 — 25.3% of rows have a `primary_company` that is not in their own `companies[]`.**
Evidence: §3.4, with the fold flag on, gated by `_primary_resolves_to_indexed`.
Would matter if: consumers match on `companies[]` and thereby miss articles about their main actor. Measurement: for a set of tracked tickers, count articles whose `primary_company` matches but which a `companies[]`-based query does not return.

**4.7 — 96.2% of the corpus has no publisher, and the pre-capture portion is unrecoverable.**
Evidence: §3.1; redirect-page inspection found no publisher in the HTML.
Would matter if: any consumer needs publisher coverage over a historical window rather than going forward. Measurement: track `publisher IS NOT NULL` as a share of rows ingested after capture began, and separately decide whether any consumer requires backfill.

**4.8 — The 6-7 band holds 4.0% of the corpus while the rubric routes two common article classes there.**
Evidence: §3.2 full-table distribution; `FILTER_PROMPT` reserves 6-7 for analyst actions and index recaps.
Would matter if: articles that the rubric defines as 6-7 are in fact being scored 3 or 8-10. Measurement: hand-label a stratified sample of analyst-action and index-recap articles and compare against their stored scores.

**4.9 — gnews freshness rejections are uncounted on the path carrying most of the volume.**
Evidence: §2.1 #1, bare `continue` at :1355 versus the counted RSS equivalent.
Would matter if: the rejection rate is non-trivial or changes. Measurement: add a counter and compare per-feed stale rates against the RSS feeds' logged rates.

**4.10 — The 7-day freshness window admits material that is old relative to a twice-daily brief.**
Evidence: `INGEST_FRESHNESS_DAYS = 7`; an earlier 48h-window measurement put median stored-article age at ~40 hours and p90 at ~106 hours. Not re-measured full-table here.
Would matter if: articles older than some threshold are never selected downstream, making their ingest and grading pure overhead. Measurement: join stored articles to `run_articles` / brief selections and plot selection probability against age at ingest.

**4.11 — Two independent token-accounting paths exist for the same calls.**
Evidence: `_accumulate_filter_usage` (in-process, printed once per run at :1818) and `accumulate_gemini_usage` (persisted to `gemini_usage`), both called on every filter and grader response.
Would matter if: they disagree, since one is printed to operators and the other is queried. Measurement: compare the printed `[filter:usage] calls=` against the `gemini_usage` row for the same `run_id`.

---

# Appendix — constants in effect

| constant | value | line |
|---|---|---|
| `INGEST_FRESHNESS_DAYS` | 7 | 1394 |
| `GNEWS_ENTRY_CAP` / `GNEWS_WORKERS` | 20 / 8 | 269-270 |
| RSS `entry_cap` | 40 wires, 8 otherwise | 1418 |
| `RSS_FETCH_TIMEOUT_SEC` | 20 | 49 |
| `FILTER_PARALLEL_WORKERS` | 50 | 153 |
| `FILTER_MAX_RATE_RETRIES` | 5 | 162 |
| `FILTER_PHASE_BUDGET_SEC` | 3600 | 185 |
| `INGEST_PHASE_BUDGET_SEC` | 4800 | 195 |
| `STORE_CHUNK_SIZE` | 500 | 1941 |
| `RELEVANCE_NEW_GATE` | 1 | 105 |
| `_LONG_TEXT_TOKENS` / `_MIN_EN_EVIDENCE` | 40 / 3 | 1141-1143 |
| `_URL_PROBE_CHUNK` / `_URL_PROBE_CHAR_BUDGET` | 200 / 6000 | 2107-2108 |

**Repo variables (GitHub Actions):** `RELEVANCE_GRADE_MODE=new`, `GRADER_SKIP_IRRELEVANT=1`, `FILTER_PROMPT_CACHE=1`, `MARKET_PULSE_V2=1`, `HORIZON_GRADING_MODE=active`, `TAGGING_PRIMARY_FOLD_ENABLED=true`. `INGEST_BLOCKLIST_MODE` is **not set** → `shadow`.

## What I could not verify

- Whether `sentiment_reason` has a reader. Absence of a grep hit is not proof.
- Why 1,033 rows carry score 0. The window is bounded and the cause is inferred from timing alone; I have no deploy history.
- Whether `NEWS_API_KEY` resolves in CI. Verified absent locally only.
- Whether another job populates `content` for SEC rows (`backfill_content.py` exists; not traced).
- Query plans for any of this — PostgREST plan mode is disabled (`PGRST107`) and there is no DB connection string in the environment.
