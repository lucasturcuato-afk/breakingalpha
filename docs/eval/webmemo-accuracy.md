# Web-memo accuracy eval

Scope: the on-demand / web-fallback memo path that `PrimerWebMemo` (PR #410) and
the directory search screen drive. Read-only against product code at
`origin/main` @ c17ede9f. No product code, schema, or pipeline was changed.

## Method and its one caveat

For each of 10 companies the real product pipeline was reproduced:
1. **Real grounding pool**: Exa `/search` with the product's exact params
   (`category:news`, 30-day window, `numResults:16` deduped to 8), called
   directly (read-only; the `web_search_cache` upsert was skipped).
2. **Real prompt**: the verbatim `buildWebFallbackMemoSystemPrompt` from
   `src/lib/company-intel.ts` was applied to each pool.
3. **Generation**: the memo was generated under that prompt from that pool, then
   every numeric / named-entity / causal claim was extracted and classified
   SUPPORTED / UNSUPPORTED / CONTRADICTED against (a) the cited `[n]` result's
   own text and (b) an independent web check.

**Caveat (read this):** the product uses `gemini-2.5-flash` (temp 0.35). No
`GEMINI_API_KEY` exists in any env here, and the product `/api/memo` route writes
to the `outputs` cache, so neither the product path nor a direct
`gemini-2.5-flash` call was usable. The generator was therefore a strong stand-in
LLM, not `gemini-2.5-flash`. A capable instruction-follower obeys the strict
sourcing prompt well (it correctly OMITTED real-but-not-in-pool figures for
Richtech, Onto, and Mama's), so **the rates below are best read as a FLOOR; the
production model at temp 0.35 may invent more.** Crucially, the two dominant
failure modes (off-entity pool contamination, source-level error propagation) are
**pool-driven and model-agnostic** -- they would hit `gemini-2.5-flash` the same
way. The fact-check itself (does the cited result actually contain / support the
claim) is objective regardless of generator.

---

## Overall rate (137 claims across 10 companies)

| Class | Count | Rate |
|---|---|---|
| SUPPORTED | 125 | **91.2%** |
| UNSUPPORTED | 3 | 2.2% |
| CONTRADICTED | 9 | 6.6% |
| **Hallucination (U+C)** | **12** | **8.8%** |

The headline 91% hides a **strongly bimodal** distribution. It is not "9% noise
spread evenly"; it is near-zero on well-covered names and severe on the thin /
ambiguous tail.

## Per-company tally

| Company | Tier | Pool on-entity | S | U | C | Errors |
|---|---|---|---|---|---|---|
| Apple | large US | 8/8 | 20 | 0 | 0 | 0 |
| JPMorgan Chase | large US | 8/8 | 22 | 0 | 0 | 0 |
| Nvidia | large US | 8/8 | 12 | 0 | 0 | 0 |
| ASML | foreign | 8/8 | 10 | 0 | 0 | 0 |
| Richtech Robotics | small/obscure | 8/8 | 11 | 0 | 0 | 0 |
| Onto Innovation | small | 8/8 | 11 | 0 | 0 | 0 |
| Alibaba | foreign | 8/8 | 12 | 0 | 1 | 1 |
| Mama's Creations | thin | 8/8 | 12 | 1 | 0 | 1 |
| Unum Group | mid-cap | 8/8 | 7 | 2 | 3 | 5 |
| Lake Shore Bancorp | thin/ambiguous | **5/8** | 8 | 0 | 5 | 5 |

**6 of 10 companies had ZERO errors** (86 claims, all supported): every
well-covered name. The strict prompt genuinely works when the pool is clean and
on-entity. **2 companies (Unum, LSBK) carry 10 of the 12 total errors.**

A repeated positive signal: on Richtech, Onto, and (partly) Mama's the generator
faced figures that exist in reality but were absent from the pool (convertible
note size, Rigaku stake terms, the "$3,000" stub) and correctly OMITTED them per
the sourcing rule. Pure invent-from-training-knowledge was NOT the failure mode.

---

## Failure patterns (the 12 errors are 3 distinct modes, none of them "free invention")

### Mode 1 -- off-entity pool contamination (5 errors, the worst). LSBK.
Thin, name-ambiguous tickers return pools polluted with same-token DIFFERENT
companies, and the prompt's ENTITY DISAMBIGUATION clause ("treat all naming
variants as one entity") actively folds them in. Lake Shore Bancorp's 8-result
pool is only 5 on-entity; the 3 contaminants (Shore Bancshares/SHBI, North Shore
Bank/1895 Bancorp) are the only ones carrying "developments," so they dominate a
memo about a company they have nothing to do with. Verbatim worst case:

> "The near-term catalyst is consolidation pressure visible across the regional
> thrift cohort, where a parent like Shore Bancshares is reshaping leadership and
> North Shore Bank is acquiring a competitor for roughly $95 million [6][7]."

Neither event involves Lake Shore Bancorp. The "$95 million" is a Wisconsin deal
(North Shore Bank / 1895 Bancorp). 5 of 13 LSBK load-bearing claims (38%) are
misattributions, and the memo's net-negative sector verdict rests entirely on
the wrong companies.

### Mode 2 -- faithful propagation of a wrong source (4 errors). Unum, Alibaba.
The strict "cite the figure from the result" rule has no defense against a source
that is itself wrong. Unum's pool said Q1 revenue FELL 11.3% to $2.93B and missed
by 5.2%; the actual Q1 2026 was a BEAT (~$3.36B, EPS up ~9.8%, stock surged). The
memo built its ENTIRE thesis on the false decline, verbatim:

> "Unum Group reported revenues of $2.93 billion, down 11.3% year on year. This
> print fell short of analysts' expectations by 5.2%."

Alibaba's pool [4] carried FY2026 figures garbled ~10x (revenue "10,236.70B yuan"
vs real ~1.02T). The generator here happened to omit the garbled magnitudes, but
a model obeying "cite the figure in the result" would reproduce a number 10x
reality. A confidently-cited, plausibly-formatted, wrong number is the most
dangerous output because the `[n]` makes it look verified.

### Mode 3 -- over-precision / out-of-pool import (3 errors). Mama's, Unum.
"Hallucinated-but-true": names/figures imported from outside the result set.
Mama's memo cites "new Walmart and Target placements" -- correct in reality,
but **not in any pool result**; a reader clicking the citation finds nothing.
Unum's "$93.22 52-week high / $91.62 close" and "up 16.8% vs industry 15.4%" come
from a single SEO-aggregator result and are over-precise / not corroborated.

### Cross-cutting: the citation gives false assurance.
Every one of the 9 CONTRADICTED claims still ends in a real `[n]` pointing at a
real result. The `[n]` proves provenance, not accuracy: it can point at a
real-but-wrong-entity result (Mode 1) or a real-but-wrong-number result (Mode 2).
The product renders the source list under the memo, which makes a misattributed
claim look MORE trustworthy, not less.

---

## Bottom line

**Not "ship as-is."** Ship with stronger grounding constraints AND a heavier
disclaimer, and gate prod enablement (`NEXT_PUBLIC_WEB_FALLBACK_ENABLED`) on
fixing Mode 1.

Why not as-is: the 91% aggregate is real but the errors are not random -- they
land precisely on thin, obscure, name-ambiguous tickers, which is **exactly the
population the on-demand mint path exists to surface**. For a well-covered name
the memo is excellent (0/86 errors). For Lake Shore Bancorp it attributes another
bank's $95M acquisition to the subject; for Unum it builds the whole brief on a
revenue decline that did not happen. Those are the on-demand feature's primary
use case, and the production model (temp 0.35, weaker than the stand-in here)
will not do better.

### Specific grounding changes (in priority order)

1. **Entity-contamination filter on the pool, before the prompt (fixes Mode 1).**
   Before building the memo content, keep only results whose title/domain match
   the subject by ticker or strict name; label the rest "sector context" or drop
   them. And **scope the "treat all variants as one entity" instruction to true
   suffix/case variants** (Inc/Corp/.ai), never to shared tokens like "Shore."
   This single change removes the worst failure mode.
2. **Minimum-pool-quality gate.** If on-entity result count is below a threshold
   (LSBK had ~5, with the on-entity ones being routine), suppress
   developments-led mode and render an explicit "thin coverage" state instead of
   a confident brief.
3. **Programmatic `[n]` citation validation (fixes part of Modes 2/3).** After
   generation, verify each cited figure/name string actually appears in result
   `[n]`'s title/summary; drop or flag sentences that fail. Cheap post-process.
4. **Single-source and magnitude sanity checks (fixes Mode 2).** Flag figures
   that appear in only one low-quality source, and flag order-of-magnitude
   outliers (the Alibaba 10x case). Prefer cross-source-agreed figures.
5. **Make the "specific opener / temporal anchor" mandate conditional** on the
   pool actually containing one; remove the pressure to surface a specific when
   the pool is thin.
6. **Heavier disclaimer** on the web-memo surface, escalated when the pool is
   thin / low-on-entity: "Generated from N web results; may be incomplete or
   misattributed for thinly-covered companies."

---

## VERIFY

- Claims checked against ACTUAL fetched sources, not assumed: every claim was
  graded against its cited `[n]` result's own text in the fetched Exa pool, plus
  an independent web check on the load-bearing claims. The contradictions
  (LSBK misattributions, Unum revenue direction, Alibaba 10x figures) were each
  confirmed against the real source / independent search.
- Rate computed from the tally: 125 SUPPORTED / 3 UNSUPPORTED / 9 CONTRADICTED of
  137 claims = 91.2% / 2.2% / 6.6%; hallucination (U+C) = 8.8%. Computed, not
  estimated.
- Worst cases quoted verbatim: LSBK "$95 million" misattribution and Unum's false
  revenue-decline spine, above.
- Zero product files changed: only this doc is added (diff is doc-only).

### Generation provenance / reproducibility
Generator = strong stand-in LLM (no `gemini-2.5-flash` key available; product
`/api/memo` writes and was not run). Pools fetched 2026-06-22 via Exa with the
product's exact params. To reproduce against the real model: supply a
`GEMINI_API_KEY` and call `generateContent({model:"gemini-2.5-flash", temperature:0.35})`
directly with `buildWebFallbackMemoSystemPrompt` + `buildWebFallbackMemoContent`
(avoids the `/api/memo` outputs write), then re-run the same claim grading. The
pool-driven failure modes (1 and 2) are expected to reproduce model-independently.
