# Recon: why confirmed mega-deals never enter the unified candidate pool

Phase 1 gate, read-only. Base: origin/main @ 611ad9df (#524 merged).
Row evidence pulled from prod (SELECT-only) on 2026-07-29.

## VERDICT

The dominant cause is a **dead upstream deal-flow gate, not a cap and not the
argmax**. The unified contest can only elevate a big deal through the
`is_mega_deal` boost, and that boost is gated on a `deal_flow` row that is
CONFIRMED (`stage in {signed, closed}`) and carries a parseable `>= $1B`
valuation, joined to the article by `source_url`. In prod that gate is
structurally starved:

1. **deal_extractor never marks a big deal signed/closed.** Of 95 `deal_flow`
   rows since 07-08, 18 parse to `>= $1B`. ZERO of those 18 are stage
   `signed`/`closed` - every one is `announced` or `rumored`. So mega-boost
   Path 1 (`confirmed_mega_deal_urls` stage path) can NEVER fire for a big deal.
   (The 47 `closed` rows in the table are all small/null-value.)
2. **57% of deal_flow rows have null/unparseable valuation.** Uber's confirmed
   $14.8B Delivery Hero deal is in `deal_flow` with `valuation = NULL` and
   `deal_type = "Minority Stake"`, so it fails the `>= $1B` parse gate outright.
3. **The biggest confirmed deals are never extracted at all.** Arlington's
   `$1.45bn` Riverpoint sale (two rel-10 articles, "closes $1.45bn") has ZERO
   `deal_flow` rows. No row -> no `source_url` -> no `is_mega_deal`.

With no mega-boost, a genuinely confirmed deal drops into the unified contest as
an ordinary single-name cluster and is actively DEMOTED: `_unified_materiality`
applies `-0.20` to a single-name pure-deal non-driver, and `_unified_confirmation`
gives it 0.80 (priced) instead of 1.00 (mega). It then loses to single-source
noise and falls below the top-10 audit cap, which is why it is ABSENT FROM THE
LOG even though it was scored.

Compounding second cause: **cluster fragmentation.** `cluster_key` keys on
`companies[0]`, so the same event splits across leads ("Arlington" vs "Arlington
Capital Partners"; "ASML..." vs "Sandisk, ASML..."). No single cluster
accumulates breadth, so broad events look like 1-source singletons.

The cap (H3) and the argmax are NOT the cause. `_TOP_CLUSTERS_AUDIT_CAP = 10` is
LOG-ONLY; the argmax runs over ALL clusters. The URL join (H4) is NOT broken:
all 18 big `deal_flow` rows have `source_url` that matches a real article url.

Ranked causes: **(1) deal_extractor gate failures** (no confirmed stage on big
deals + 57% null valuations + missing extractions) -> dominant. **(2) cluster
fragmentation by companies[0]** -> secondary, hurts breadth for both deals and
sector events.

## How the candidate set is constructed (quoted mechanics)

- Pool: `synthesize.py:4241` `_pool = impact_ranking.fetch_coverage_pool(...)` ->
  `articles` where `ingested_at in [now-24h, now)` AND `published_at in
  [now-48h, now)`, order `ingested_at desc`, limit 1000. UNIT = ARTICLE, then
  clustered.
- Clustering: `impact_ranking.cluster_key` -> `macro:<bucket>` |
  `co:<companies[0]>:<event-or-sig>` | `one:<sig>`. UNIT of a candidate = EVENT
  CLUSTER.
- Mega set: `_mega_deal_urls` -> `confirmed_mega_deal_urls(deal_rows, pool)`.
  Path 1: `stage in {signed, closed}` and `parse_valuation_to_usd_b >= 1.0`.
  Path 2 (relaxed): stale stage but `relevance_score >= 9` AND
  `distinct_sources >= 2` in the article's cluster.
- Scoring: `score_clusters` = `3*log1p(sources) + 1*log1p(articles) +
  4*recency + boosts(tier1/recent/MEGA_DEAL_BOOST=10) - stale_penalty`, then
  `compute_unified_lead` re-scores each cluster on
  `w_mat*mat + w_sf*sf + w_conf*conf + w_breadth*breadth` (defaults 4/4/3/1.5)
  and argmaxes over lead-eligible clusters.
- Cap: `_TOP_CLUSTERS_AUDIT_CAP = 10`, AUDIT-ONLY (`impact_ranking.py:1391`).
  Log = top-10 by score + forced-in shipped cluster (`below_cap=true`).
- Filter A / A2 (`lead_preselect.py`) is a SEPARATE precedence path over the
  synthesis corpus; it does NOT feed the unified contest.

## Trace: 07-27 Arlington $1.45B (morning run 84a18940, 14:37Z)

- Articles: "Exclusive: Arlington closes $1.45bn sale of Riverpoint Medical to
  Novanta" (PE Hub, rel 10, M&A, pub 12:00Z, ingested 14:03Z) and a second
  rel-10 variant (co `["Arlington Capital Partners","Brookfield"]`). BOTH inside
  the pool windows (ingested < 24h, pub < 48h before 14:37Z).
- deal_flow: ZERO Arlington rows. -> not in `mega_deal_urls` -> `is_mega_deal =
  false`.
- Unified log (11 candidates): winner = "MSTR Stock Climbs... Raises $545M
  Through Share Sale", `unified_score 7.725`, `is_mega_deal false`,
  `distinct_sources 1`, `article_count 1`. Candidates are dominated by
  single-source 13F filings ("Caxton Associates Acquires 10,862 Shares...",
  "Levin Capital Raises Stock Holdings..."). Arlington is NOT in the 11.
- Why absent from the log: scored as a single-name pure-deal cluster
  (materiality demoted -0.20, confirmation 0.80), it fell below the top-10 and
  was not the shipped lead, so it was not force-included. Had a confirmed
  `deal_flow` row existed, `is_mega_deal` would set confirmation 1.00 and skip
  the demote: est. score ~8.3 > MSTR 7.725, i.e. it would have won.

## Trace: 07-17 Uber $14.8B (morning 7cbabcd7, evening 15cade2e)

- "07-17 logged ZERO candidates" is a **misattribution, not a bug**: the unified
  telemetry did not exist until 07-20. First run with `unified_candidates` =
  2026-07-20 morning. 07-15..07-18 brief runs all have `has_unified_key=false`.
- The underlying deal gate would still have blocked it: `deal_flow` row =
  {company "Delivery Hero", acquirer "Uber", deal_type "Minority Stake", stage
  "announced", valuation NULL, source_url = a google-news RSS url}. NULL
  valuation fails the parse gate; "Minority Stake" is not in `NON_MA_DEAL_TYPES`;
  stage "announced" fails Path 1. The confirmed $14.8B Bloomberg article
  ("Uber Agrees to Buy Delivery Hero in $14.8 Billion Deal", rel 10) never got a
  priced/confirmed `deal_flow` row.

## Hypotheses

- **H1 cluster-volume bias — PARTIAL.** Candidates ARE volume/breadth clusters,
  and single-source noise (13F filings) fills slots. But the deeper miss is the
  absent mega-boost, not raw volume; M&A stories (TransDigm) do enter.
- **H2 dead deal lane — HOLDS, quantified.** Across 56 brief runs since 06-20,
  Filter A fired on 2 (07-10, 07-17 morning), Filter A2 on 0; BOTH zero on 54/56
  (96%). Root gates re-verified on current main: 57% null valuations, big deals
  stuck at `announced`, `deal_type`s "PE Investment"/"LBO"/"Asset Sale"/
  "Recap"/"Minority Stake" absent from `NON_MA_DEAL_TYPES`, `DEAL_MAX_AGE_HOURS`
  24h. Note this lane feeds precedence, not the unified contest, but the same
  gate logic gates the mega-boost.
- **H3 cap starvation — FALSE.** The cap is audit-only; argmax sees all clusters.
- **H4 join failure — FALSE for the big rows.** All 18 parseable `>= $1B`
  `deal_flow` rows have `source_url` matching a real article url.
- **H5 something else — YES, the real one.** deal_extractor never emits
  `signed`/`closed` on big deals and drops 57% of valuations to null, so the
  confirmation-gated mega-boost is structurally unreachable; and cluster_key
  fragments broad events by `companies[0]`.

## Size of the prize

- 18 `deal_flow` rows `>= $1B` since 07-08 (~14 brief days); ALL stuck at
  `announced`/`rumored`, so 0 could take mega-boost Path 1.
- Of 13 unified runs (07-20+), only 2 surfaced ANY `is_mega_deal=true` candidate.
- Plus the two flagged, both excluded by DIFFERENT gates: Arlington $1.45B (no
  row at all) and Uber $14.8B (null valuation). So ~16 of 18 parseable big deals,
  plus the null-valuation and un-extracted ones, never became a mega candidate.
  Order of magnitude: roughly one locked-out confirmed $1B+ deal PER brief day.

## Pulse: shared blind spot, distinct code path

- On 07-27 the ASML/China-DUV catalyst WAS in the pool: "ASML and U.S. chip
  stocks sink on report of China's DUV breakthrough" (rel 10, pub 13:26Z,
  ingested 14:05Z, before the 14:37Z run), alongside dozens of chip stories.
- It was NOT a scored unified candidate on 07-27 or 07-28 (not in either
  11-candidate log). Same fragmentation: the DUV story splits across
  `co:asml:*`, `co:sandisk:*`, `co:cxmt:*`, and many "Why is X falling" variants
  are analyst-PT lead-barred, so no cluster accumulates the breadth that would
  make it THE event.
- BUT the pulse is authored by the MARKET_PULSE_V2 dedicated Gemini call over
  the corpus + tape, NOT by the unified candidate set. So it is NOT literally
  starved by the same function. It is the SAME ROOT BLIND SPOT: nothing in the
  system aggregates a broad, multi-source, market-moving NON-DEAL event to the
  event level and hands it forward as the causal driver. Verdict: shared
  phenomenon, two code paths - fixing event-level clustering helps both, but a
  pulse fix also needs the causal story surfaced into the pulse corpus.

## Fix mapping

- **O1 widen the cap — NO.** The cap is audit-only; widening it changes nothing
  in selection.
- **O2 guaranteed lane — YES, primary.** Always inject any deal whose
  `deal_flow.parse_valuation_to_usd_b >= threshold` as a first-class candidate
  with mega-grade confirmation, INDEPENDENT of `stage` and of news volume. This
  is the single highest-leverage fix because the gap is "confirmed big deal has
  no path in," and it must key off `parse_valuation_to_usd_b`, not title parsing.
- **O3 fix the gates — YES, required to make O2 real.** O2 depends on a
  `deal_flow` row existing and carrying a parseable valuation. deal_extractor
  must (a) stop dropping 57% of valuations to null, (b) extract deals like
  Arlington that are currently missed, and (c) either emit `signed`/`closed` on
  confirmed deals or have the mega-gate stop requiring it. Add missing
  `deal_type`s ("PE Investment", "LBO", "Asset Sale", "Recap", "Minority Stake").
- **Secondary: cluster_key** should key broad events at the event level, not by
  `companies[0]`, so a multi-name sector move (ASML/chip) and a multi-alias deal
  (Arlington) each form ONE cluster. Helps the pulse's causal read too.

Recommended: **O2 + O3 together** (O2 is the mechanism, O3 is the data it needs),
plus the cluster_key event-level fix for the pulse symptom. O1 alone is a no-op.
