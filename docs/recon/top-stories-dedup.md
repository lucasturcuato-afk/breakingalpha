# Top Stories: same-event de-duplication

Recon, plan, and verification for collapsing same-event near-duplicate stories
in the Top Stories module (dashboard + logged-out preview), both fed by
`src/lib/top-stories.ts` `fetchTopStories`.

All numbers below are read-only measurements against the live `articles` table
(no writes, no DDL). The tokeniser used in every SQL measurement matches the
existing app primitive in `src/lib/clustering-utils.ts`: lowercase, split on
`[^a-z0-9_]+`, keep tokens of length >= 3, set semantics, Jaccard =
`|A intersect B| / |A union B|`.

---

## PHASE 1 - RECON

### 1. Is there any de-duplication today, and why did it miss the VCTR pair?

**In the render path (`fetchTopStories`): none.** The function issues a primary
and a fallback `select` on `articles`, ordered by `relevance_score desc,
ingested_at desc`, `limit 4`. There is no grouping, no hashing, no title or URL
comparison. Whatever 4 rows the query returns are rendered as-is.

**At ingest (`backend/ingest.py`): exact-URL only.** The watchlist-Finnhub path
pre-loads existing article URLs from the last 30 days and drops a candidate when
`url in existing_urls` (see `backend/ingest.py` ~L618-665, structured log
`... K inserted, J duplicates`). This is an exact-string URL match.

**Why it missed the VCTR pair.** The two reported rows are different outlets'
coverage of one event (May AUM press release):

| title | source | url | published | relevance |
|---|---|---|---|---|
| Victory Capital (NASDAQ: VCTR) reports $338.9B May assets under management - Stock Titan | Google News (VCTR) | news.google.com/.../CBMiuAF... | 2026-06-09 12:22 | 10 |
| Victory Capital (VCTR) Reports Strong Assets Under Management - GuruFocus | Google News (VCTR) | news.google.com/.../CBMinwF... | 2026-06-09 12:03 | 10 |

Different URL, different source-outlet suffix, different headline => exact-URL
dedup does not fire. Same `relevance_score` (10) and same ingest batch => both
sit in the candidate pool with nothing to separate them.

There is an existing near-duplicate primitive, `clusterArticles` /`isSameStory`
in `src/lib/clustering-utils.ts` (48h window + Jaccard > 0.35 + shared
capitalised entity), but it is only wired into the **watchlist detail page**
(`src/app/watchlist/[identifier]/page.tsx`). Top Stories does not use it.

### 2. Prevalence among Top-Stories-eligible articles (last 30 days)

`relevance_score` is **saturated at the top**. For every one of the last 14
as-of days, the entire top-12 candidate set ties at `relevance_score = 10`, and
the score-10 eligible block (published <= 7d, ingested <= 72h) is enormous:

| as-of day | score-10 block size | same-event pairs in block | articles in a dup pair |
|---|---|---|---|
| 2026-06-02 | 2863 | 179 | 295 |
| 2026-06-03 | 3306 | 223 | 367 |
| 2026-06-04 | 3692 | 283 | 454 |
| 2026-06-05 | 1822 | 113 | 198 |
| 2026-06-06 | 1503 | 68 | 122 |
| 2026-06-07 | 833 | 20 | 38 |
| 2026-06-08 | 666 | 19 | 34 |
| 2026-06-09 | 1052 | 35 | 64 |

(Same-event pair = same source-ticker, published within 48h, title Jaccard
>= 0.5. Earlier days 05-27..05-31 show 0 pairs, an artefact of the retained
ingest window for a far-back as-of, not a contradiction.)

Across the whole 30-day window, of 9,675 top-tier (`relevance_score >= 9`)
fresh gnews articles, **1,548 (16.0%)** have at least one same-event partner in
the eligible pool. Duplication in the competitive band is pervasive, not rare.

**Mechanism that surfaces them together.** Because the top block is one giant
`relevance_score = 10` tie, ordering collapses to the `ingested_at desc`
tiebreaker. Within a single ingest batch many rows share an *identical*
`ingested_at` (e.g. `2026-06-09 13:08:58.297332+00` on hundreds of rows), so the
final order is effectively physical row order. Syndications of one event are
pulled from the same per-ticker feed in one batch and land adjacently, so the
`limit 4` readily returns two of them next to each other. (A naive top-4
simulation that re-breaks ties deterministically does **not** reproduce the
pair, precisely because visibility depends on this physical-order tiebreak --
documented here so the next reader does not mistake 0/14 for "no bug".)

### 3. Threshold data: same-event vs distinct, same-ticker, same window

Jaccard distribution over ~125k same-ticker / within-48h / `relevance_score >= 8`
title pairs (30 days):

| Jaccard band | pairs | cumulative % |
|---|---|---|
| [0.0, 0.3) | 117,020 | 93.6% |
| [0.3, 0.4) | 3,584 | 96.4% |
| [0.4, 0.5) | 1,564 | 97.7% |
| [0.5, 0.6) | 842 | 98.4% |
| [0.6, 1.0) | 1,626 | 99.7% |
| = 1.0 | 422 | 100% |

The distribution is sharply right-skewed: 93.6% of same-ticker pairs sit below
0.3. These are **distinct** stories that merely share the company name (e.g.
"Victory Capital reports May AUM" vs "Is Victory Capital's New Bid a Game Changer
for Janus Henderson" = ~0.10). The near-duplicate tail begins around 0.5 and
spikes at 1.0 (token-identical headlines re-published by different outlets).

**Hand-labelled separation quality** (samples drawn across bands):

- **[0.6, 1.0]**: ~100% genuine same-event. Pure syndication -- the same
  headline re-posted by Yahoo / Insider Monkey / Motley Fool / Barchart, etc.
- **[0.5, 0.6)**: mixed. Genuine same-event syndication (ASML "Biggest Company
  in European History", FDX "Why FedEx Stock Just Dropped", DDOG/COP "...Up
  Today", MSG "Knicks reach NBA Finals") **and** the canonical VCTR AUM pair,
  which computes to exactly **0.50**. Also present: template look-alikes (see
  false-collapse analysis below).
- **[0.4, 0.5)**: roughly half genuine, half template look-alikes (13F-filing
  and analyst-price-target boilerplate).
- **[0.3, 0.4)**: distinct stories dominate; a few genuine same-event pairs
  (ABBV EU/NHS approvals, AAPL WWDC Morgan Stanley) sit here and would be missed
  by any threshold >= 0.4.

**The key separation fact:** distinct *substantive* same-ticker stories score
~0.1 because they describe different things. High-Jaccard pairs are never two
different important events; they are either true syndications or low-value
template stories. So the false-collapse risk is bounded to low-information rows,
never to two distinct headline stories.

**False-collapse analysis at 0.5 (28-pair labelled sample of [0.50,0.60)).**
About half the marginal-band pairs are not the same event. They split into two
very different kinds:

1. *Same company, different filer/analyst* (OXY/UNP/BABA/RJF 13F filings,
   QBTS/HP analyst PT notes). Collapsing these is **desirable** -- the user does
   not want three near-identical "shares purchased by X" cards for one ticker.
2. *Different subject company* -- the genuinely harmful case. These are
   concentrated in a small set of **bank/broker tickers** whose Google-News feed
   is polluted by analyst-note headlines naming *other* companies:
   `Google News (RBC)` -> "RBC Capital raises GitLab PT" vs "RBC Capital raises
   USA Compression PT". Pair counts >= 0.5 by ticker are dominated by exactly
   these: RBC 136, UBS 48, MUFG 30, versus normal companies in the teens.

`companies[]` (a `text[]` of company names) cannot cleanly guard this: it is
empty for at least one member in **69%** (1,994 / 2,890) of pairs >= 0.5, and
only 29 pairs have both populated-and-disjoint. So a companies-overlap *positive*
requirement would suppress 69% of real collapses; at most it is usable as a
cheap *negative* guard (never collapse two rows whose populated companies are
disjoint), which catches ~1% and is not worth the branch.

### 4. Cross-surface check

Same-event near-dupes are a property of the `articles` table, so they exist
wherever raw article rows are listed. But the **visible duplicate-card** problem
is specific to surfaces that render raw rows:

- **Top Stories (dashboard + preview)** -- raw rows, no dedup. This is the bug.
- **Watchlist detail** (`watchlist/[identifier]/page.tsx`) -- already collapses
  via `clusterArticles`.
- **Briefs / memos / evening-wrap** -- LLM-synthesised narrative text, not raw
  card lists; duplicate source articles are summarised away, not rendered as
  duplicate cards.

=> The fix belongs at render time in the one un-deduped raw-list surface, not in
the pipeline.

---

## PHASE 1.5 - PLAN

### Approach fork: render-time (chosen) vs pipeline-level

**Chosen: render-time dedup inside `fetchTopStories`.** Justification from
recon: (a) the only un-deduped *visible-card* surface is Top Stories; watchlist
already clusters and briefs/memos synthesise; (b) it is contained and reversible
(one file, one helper, a named threshold); (c) a pipeline-level event-clustering
change would touch `backend/ingest.py` / the writer, which the task says to stop
and escalate on, and would risk every surface for a bug seen on one. The
prevalence (16% of top-tier articles) justifies fixing it, but not at pipeline
scope. Pipeline-level clustering is recorded as a follow-up if the same dupes
later prove painful on other surfaces.

### Clustering signal (not ticker alone)

Two candidates are the same event iff **all** hold:

- **same source-ticker** parsed from `source` via `Google News \(([^)]+)\)`
  (null ticker never clusters -- non-gnews rows pass through untouched);
- **published within `SAME_EVENT_WINDOW_HOURS` (48h)** -- matches the existing
  `clustering-utils` window; genuine syndications observed minutes-to-hours
  apart;
- **title Jaccard >= `SAME_EVENT_TITLE_SIMILARITY` (0.50)** -- measured: 0.50 is
  the lowest value that still captures the canonical VCTR pair while keeping the
  collapse set out of the distinct-story mass (93.6% of same-ticker pairs are
  < 0.3; the genuine same-event tail starts at ~0.5). Same tokeniser as
  `clustering-utils`.

Ticker alone is explicitly insufficient (the 0.0-0.3 band is 93.6% distinct
same-ticker pairs). The threshold is the discriminator; same-ticker is the cheap
pre-filter.

We deliberately do **not** adopt the 0.35 value from `clustering-utils`: that
primitive also requires a shared capitalised entity and runs on a single-company
page where every article is already about one company. Within a single ticker
the company-name tokens inflate Jaccard, so 0.35 over-collapses (the 0.30-0.40
band is mostly distinct here). 0.50 is the measured within-ticker threshold.

### Keep-which rule (deterministic)

When a cluster collapses, the survivor is chosen by, in order:

1. highest `relevance_score`;
2. then most complete headline -- operationalised as the longer title after
   stripping the trailing ` - Outlet` suffix (the more specific headline; source
   credibility is not available inside `fetchTopStories`, it is fetched
   downstream in the dashboard, so completeness is the in-scope proxy);
3. then earliest `published_at` (the original break) as the final tiebreak;
4. then `id` ascending, so the result is fully deterministic.

### Backfill

The query currently `limit`s to 4. To dedup *and* still show a full list, we
over-fetch `TOP_STORIES_CANDIDATE_LIMIT` (24) rows in the same order, collapse
clusters, then slice to `TOP_STORIES_LIMIT` (4). Removing a duplicate pulls the
next distinct story up, so the list stays full. With no duplicates present the
first 4 survivors equal the previous first 4 -- behaviour is unchanged on the
common path.

### Threshold as a named constant

`SAME_EVENT_TITLE_SIMILARITY = 0.5`, `SAME_EVENT_WINDOW_HOURS = 48`, and
`TOP_STORIES_CANDIDATE_LIMIT = 24` are exported named constants for tuning.

---

## SELF-CRITIQUE #1

**False-collapse rate at 0.5, and is it worse than an occasional dupe?**
In the marginal [0.50,0.60) band ~50% of pairs are not the same event, but the
breakdown matters: most are *same-company, different-filer/analyst* boilerplate
whose collapse is desirable, and the genuinely harmful *different-company*
collapses are confined to a handful of bank/broker feed tickers (RBC/UBS/MUFG).
Above 0.6 precision is ~100%. Distinct *substantive* same-ticker stories score
~0.1 and are never collapsed. So the worst realistic harm is: one low-value
analyst/13F note is replaced by a backfilled distinct story. That is strictly
better than rendering two visibly identical AUM cards at the top. Accepted, with
the firm-feed cross-company case documented as a follow-up.

**What if all top items are one event?** Greedy collapse keeps the first cluster
member and removes only *subsequent* same-event members, then backfills from the
over-fetched 24. We never return a near-empty list: we show 1 of the cluster plus
the next distinct stories. Only if the entire 24-row candidate pool were one
event would the list shrink, which the prevalence data makes implausible (max
observed cluster sizes are small; the block holds hundreds of distinct tickers).
The function already tolerates short lists (callers degrade to EmptyState), so
even the pathological case is safe.

**Does the keep-which rule ever drop the better article?** It keeps the highest
`relevance_score`; on the saturated top block (all 10) it then prefers the more
complete headline, which is the more informative card (e.g. the VCTR Stock Titan
headline carrying the actual "$338.9B" figure over GuruFocus "Strong Assets
Under Management"). Earliest-published is only a final tiebreak. The dropped row
is by construction a same-event near-duplicate, so the user loses no distinct
information.

**Revision applied:** window kept at 48h (matches existing primitive and covers
observed syndication lag); companies-overlap rejected as a positive guard (69%
sparsity) and not added as a negative guard (catches ~1%, not worth the branch);
threshold fixed at 0.50 rather than 0.35 with the within-ticker justification
above; keep-which extended with `id` as a total-order final tiebreak for
determinism.

---

## PHASE 2 - IMPLEMENTATION SUMMARY

Single-file change in `src/lib/top-stories.ts` (+135 / -9):

- Added named constants `TOP_STORIES_CANDIDATE_LIMIT = 24`,
  `SAME_EVENT_TITLE_SIMILARITY = 0.5`, `SAME_EVENT_WINDOW_HOURS = 48`.
- Added self-contained helpers (`parseSourceTicker`, `titleTokens`, `jaccard`,
  `withinSameEventWindow`, `cleanedTitleLength`, `keepWhichReplaces`,
  `collapseSameEvent`). The tokeniser mirrors `src/lib/clustering-utils.ts`.
- Both query tiers now `.limit(TOP_STORIES_CANDIDATE_LIMIT)`; each result is run
  through `collapseSameEvent` and sliced to `TOP_STORIES_LIMIT`. The MIN_RESULTS
  gate now measures distinct (post-collapse) stories.

---

## SELF-CRITIQUE #2 + VERIFICATION

### Diff re-read and protected-file proof

Re-read the full diff against the rebased `origin/main` (`3a32113d`, which
overhauled CLAUDE.md and renamed the protected list to "Propose-only files").
`src/lib/top-stories.ts` is NOT on that list, so it is editable autonomously.
Changed files:

- `src/lib/top-stories.ts` (the fix)
- `docs/recon/top-stories-dedup.md`, `docs/recon/verify-dedup-visual.mjs`, and
  two screenshots (recon + verification artifacts)

No propose-only file is touched: MemoModal.tsx, api/memo/route.ts,
api/briefing/route.ts, trends/page.tsx, watchlist-utils.ts, WatchlistAddInput.tsx
are all absent from the diff. The implementation matches the plan: same-ticker +
48h + Jaccard >= 0.50, deterministic keep-which, over-fetch-then-collapse-then-
slice backfill, threshold as a named constant.

### Build / typecheck / lint gates

- `npx tsc --noEmit`: 0 errors in `top-stories.ts`. 5 errors total, all
  pre-existing and unrelated (driver.js missing types in SignaleraTour.tsx; four
  test-file `.ts` import-extension errors). Identical count with the change
  stashed, confirming they pre-date this work.
- `npm run lint` (eslint, new flat config from `3a32113d`): clean on the changed
  file.
- `npm run build` (next build, Turbopack): exit 0; `/preview` prerenders static.

The full `npm run test:e2e` Playwright suite is left for the human `/preflight`
before merge (this is a draft PR, no merge). The dedup behaviour itself is
covered deterministically below.

### Data-layer false-collapse measurement

Replayed the real rendered candidate pool (top-24 by `relevance_score desc,
ingested_at desc`) for each of the last 14 days and applied the exact collapse
rule:

- **rows collapsed: 5** across 4 days
- **harmful false collapses (different subject company, populated disjoint
  `companies[]`): 0**

All 5 collapses are genuine same-event syndications or duplicate filings,
including the canonical VCTR pair, where the keep-which rule retained the more
complete Stock Titan headline ("$338.9B May assets under management") over the
vaguer GuruFocus one:

| day | ticker | jaccard | kept / collapsed |
|---|---|---|---|
| 06-01 | ADSK | 0.700 | Autodesk Q1 2027 earnings (Moomoo / Quiver) |
| 06-02 | YUM | 0.538 | Yum Brands CEO Form-4 sale (Investing.com x2) |
| 06-04 | XOS | 0.538 | Xos $6M registered direct offering (Yahoo / marketscreener) |
| 06-04 | XOS | 0.727 | Xos tumbles 24% on offering (Investing.com ZA / NG) |
| 06-09 | VCTR | 0.500 | Victory Capital May AUM (Stock Titan kept / GuruFocus collapsed) |

### Visual smoke (deterministic, fixture-driven)

Live browser screenshots are non-probative here: the top tier is a saturated
`relevance_score = 10` block (hundreds to thousands of rows) and the visible 4
is an arbitrary physical-order draw, so a real page load cannot be relied on to
surface the VCTR pair on demand. Instead `docs/recon/verify-dedup-visual.mjs`
drives the real `/preview` page (real Top Stories component, real
`fetchTopStories`) and injects a controlled fixture by intercepting the Supabase
`articles` request, giving a deterministic render. The dashboard imports the
identical `fetchTopStories` and the same `LeadStoryCard` / `CompactStoryCard`,
so preview is a faithful proxy for both surfaces.

- `dedup-collapse-preview.png` - the real VCTR same-event pair (Stock Titan +
  GuruFocus) plus three distinct fillers. Rendered list shows VCTR once (Stock
  Titan survives) then Nvidia, Apple, Microsoft: the duplicate collapsed and a
  distinct story backfilled to a full list of 4.
- `dedup-control-distinct-preview.png` - two DISTINCT VCTR stories (May AUM
  report vs the Janus Henderson bid, Jaccard ~0.1) plus fillers. Both VCTR
  stories render: same ticker is not over-collapsed.

### Known limitations (carried to the PR)

1. **Saturated ranking, not fixed here.** `relevance_score` is pinned at 10 for
   up to ~3,692 rows/day, so Top Stories selection within the top tier is
   effectively arbitrary. Dedup removes visible duplicates but does not fix the
   underlying ranking gap; that is a separate sprint (decay, a secondary sort
   key, or score recalibration).
2. **VCTR sits exactly on the threshold.** The canonical pair computes to Jaccard
   0.50 against the `>= 0.50` cutoff, so it is caught by the smallest possible
   margin. A future tuning pass should revisit whether 0.50 is the right value or
   whether a second signal (subject-company match) should supplement it to lift
   the bank/broker-feed cross-company false collapses (RBC/UBS/MUFG).

---

## FOLLOW-UP (PR #345): closing the cross-company false-collapse risk

### Phase 1 recon - is there a reliable SUBJECT-company signal?

**1. Candidate fields.** `articles` carries, besides `source` (the feed) and
`companies text[]`, a single `primary_company text` column that names the
company an article is ABOUT (the subject), plus `themes text[]`. `primary_company`
is the subject signal; `companies[]` was already shown too sparse (empty for one
member in 69% of high-Jaccard pairs).

**2. Coverage and divergence (30 days, gnews, relevance >= 9).** 10,747 top-tier
rows, 10,013 with a non-null `primary_company` = **93.2% coverage**. Of the 1,258
pairs the current rule (same feed + 48h + Jaccard >= 0.50) would collapse:

| subject relationship | pairs | share |
|---|---|---|
| both non-null, same subject | 1,091 | 86.7% |
| both non-null, different subject | 111 | 8.8% |
| at least one null | 56 | 4.5% |

**3. Known cases.** For the VCTR AUM pair (Stock Titan + GuruFocus) both rows
carry `primary_company = "Victory Capital"` (exact match), while the distinct
Janus Henderson bid article correctly carries `primary_company = "Janus
Henderson"` even though its `companies[]` still lists Victory Capital -- so
`primary_company` is a better subject signal than `companies[]`. For broker
feeds the subject correctly diverges: `Google News (RBC)` -> `Wealthfront` vs
`Walmart`; `Google News (MUFG)` -> `Delfin LNG` / `CocaCola Company (The)` /
`Brown & Brown, Inc.` (all different from the feed and from each other).

**4. Null behavior.** ~6.8% of top-tier rows have no `primary_company`. The
collapse rule treats a null subject as non-clusterable (it never matches another
row), so null rows can never over-collapse.

**Two imperfections, both measured:**
- *Surface-form variance.* The 111 different-subject pairs are mostly the SAME
  company in two forms (`Palo Alto Networks`/`PANW`, `Rivian`/`RIVN`,
  `Honeywell`/`HON`, `Yum!`/`Yum`, `O'Reilly` curly vs straight apostrophe). An
  exact/normalized-equality key therefore under-collapses these legit variants
  (reconciling name vs ticker would need the entity-alias system, which is
  entity resolution we will not hack in). Under-collapse is the safe failure
  (an occasional visible dupe), and on the rendered surface it does not occur
  (see below).
- *Filer mislabeling.* Some 13F rows get `primary_company` = the filer
  (`MUFG Securities EMEA plc`) instead of the held company, so two of that
  filer's disclosures in different targets still share a subject and still
  collapse. This collapses benign same-filer low-value cards, never two distinct
  important companies.

### DECISION GATE: CLEAN -> proceed

A real subject field exists (93.2% coverage), is already in the data (no NER),
and correctly diverges from the feed ticker on the RBC/UBS/MUFG cross-company
cases. Requiring the same subject can only PREVENT collapses, never create new
ones, so it is a strict tightening of the shipped rule. It provably blocks the
111 different-subject pairs (which include the genuine cross-company class such
as RBC `GitLab` vs RBC `USA Compression`). The residual is the benign
same-filer-disclosure case above, which is not a distinct-company loss. Rendered
surface evidence below shows zero recall loss on the proven collapses.

### Phase 2 - implementation (subject requirement)

`src/lib/top-stories.ts`: added `primary_company` to `TOP_STORIES_COLUMNS` and
the `TopStoryRow` interface, a `subjectKey` helper (lowercase, strip to
alphanumerics so "Yum! Brands" == "Yum Brands"), a `subject` field on
`DecoratedRow`, and one extra clause in the cluster predicate: two rows collapse
only when `m.subject !== null && m.subject === d.subject` in addition to the
existing same-feed-ticker + 48h + Jaccard checks. A null subject is
non-clusterable. No threshold or window changed. This is a strict tightening: it
can only remove collapses, never add them.

### Self-critique + verification (follow-up)

**Diff re-read / protected files.** The only code change is
`src/lib/top-stories.ts`; the rest are recon artifacts under `docs/recon/`. No
Propose-only file (MemoModal.tsx, api/memo/route.ts, api/briefing/route.ts,
trends/page.tsx, watchlist-utils.ts, WatchlistAddInput.tsx) is touched. The
implementation matches the plan: subject-company required, null handled as
non-clusterable, 48h and Jaccard 0.50 unchanged, named constants retained.

**Cross-company now 0 by construction.** A collapse now requires both rows to
carry the SAME non-null `primary_company`, so two articles about different
subject companies can never merge, regardless of the feed they arrived through.
At population scale (30 days, relevance >= 9) this drops the 111 different-subject
pairs the old rule would have collapsed (the genuine cross-company class, e.g.
RBC `GitLab` vs RBC `USA Compression`) and the 56 null-subject pairs, while
keeping the 1,091 same-subject collapses. The one residual is benign: a 13F row
mislabeled with the filer (e.g. `MUFG Securities EMEA plc`) can still group two
of that filer's disclosures, which is a same-filer low-value collapse, never two
distinct important companies.

**Rendered surface, 14-day replay (real top-24 pool).** Collapses under the new
rule: **5** (unchanged from the shipped rule). Cross-company collapses: **0**.
Null-subject collapses: 0. The VCTR pair STILL collapses (both subjects
normalise to `victorycapital`), keeping the Stock Titan headline. Zero recall
loss on the proven collapses.

**Deterministic harness (`docs/recon/verify-dedup-visual.mjs`, real /preview,
fixtures injected via request interception).**
- `dedup-collapse-preview.png` - VCTR same-event pair collapses to one; Nvidia,
  Apple, Microsoft backfill.
- `dedup-control-distinct-preview.png` - two distinct VCTR stories (subjects
  Victory Capital vs Janus Henderson) both render.
- `dedup-crosscompany-preview.png` - two RBC-feed articles with subjects GitLab
  vs USA Compression Partners and Jaccard >= 0.50 both render: the cross-company
  merge the old rule allowed is now prevented.

**Gates.** `npx tsc --noEmit`: 0 errors in `top-stories.ts` (4 pre-existing
unrelated test-import errors). `npm run lint`: clean. `npm run build`: success,
`/preview` prerenders static. Full `npm run test:e2e` remains outstanding for
Noah's pre-merge `/preflight`.

### Updated limitations

1. **Recall on subject surface-variants.** Same-company name/ticker/suffix
   variants (`Palo Alto Networks` vs `PANW`) no longer collapse, because
   reconciling them needs the entity-alias system. This is under-collapse (an
   occasional visible dupe), the safe failure, and does not occur on the rendered
   surface across 14 days. Could be improved later by resolving subjects through
   the alias/HARD_TICKER_OVERRIDES system.
2. **Filer-mislabeled 13F rows** can still collapse two of one filer's
   disclosures (benign, never two distinct important companies).
3. **Subject coverage 93.2%**; the ~6.8% null-subject rows never collapse, so
   they may show an occasional same-event dupe. Safe by design.
4. **Saturated relevance_score** (up to ~3,692 rows tie at 10) is still the
   underlying ranking gap; dedup does not fix it. Separate sprint.
5. **VCTR sits at exactly Jaccard 0.50**; still caught by the smallest margin
   (now also gated by the subject match).
