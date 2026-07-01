# Web-fallback entity filter: collapsed-token anchor

Recon + scoped fix. Read-only diagnosis first, then a fix only after the bug was
confirmed against real Exa pools through the real product modules. No prod write,
no merge, no pipeline, no flag change. Base: origin/main @ f7d7bfbc.

## Verdict: BUG CONFIRMED (with a refinement to the reported symptom)

The reported "Shore" example is NOT the bug: for Lake Shore Bancorp the filter
already recovers the full name and demotes the Shore contaminants. The real bug
is narrower and worse: when the collapsed pool token is **>= 6 characters**
(`United`, `Keystone`, `Citizens`), the filter anchors on that single shared
token and pulls DIFFERENT same-word companies on-entity.

## Recon — what the on-entity match actually compares against

`src/app/api/companies/web-fallback/route.ts`:
```
127  const canonicalName   = normalizeFromResults(query, results, heuristicGuess);
141  const classifySubject = subjectForClassification(canonicalName, heuristicGuess);
142  const { onEntity, sectorContext } = classifyWebResults(
143      { canonical: classifySubject, ticker }, results);
150      canonicalName,            // <- payload/display field ONLY
```

- The filter's match key is **`classifySubject`** (line 143), NOT `canonicalName`.
- **`canonicalName` is cosmetic**: a display label returned to the client and
  interpolated into the memo prompt. The on-entity decision does NOT depend on it.
  So a response showing `canonicalName:"Shore"` is not itself proof of a bug.

The real match comparison is in `classifyWebResults` -> `matchesName`
(`src/lib/web-memo-entity.ts`). The offending line (pre-fix):
```
81  if (sig.some((t) => t.length >= DOMINANT_TOKEN_MIN_LEN && normalizedHay.includes(t))) return true;
```
Any significant token >= 6 chars substring-matches the result text. And
`subjectForClassification` (pre-fix) treated a single >= 6-char token as
"distinctive" and KEPT it:
```
150  const poolDistinctive = poolSig.some((t) => t.length >= DOMINANT_TOKEN_MIN_LEN) || poolSig.length >= 2;
152  if (!poolDistinctive && querySig.length > poolSig.length) return queryName;
```
So a pool collapsed to "United"/"Keystone"/"Citizens" stayed as-is, and every
"United ..."/"Keystone ..."/"Citizens ..." company then substring-matched.

Why "Shore" is safe but "United" is not: `subjectForClassification("Shore",
"Lake Shore Bancorp")` returns "Lake Shore Bancorp" ("shore" is 5 chars, not
distinctive), so the anchor is the full name and matchesName needs the "lake
shore" bigram. `subjectForClassification("United", "United Security Bancshares")`
returned "United" (6 chars, wrongly "distinctive"), and "united" then substring-
matched United Bankshares.

## Evidence (real Exa pools, real product modules; `recon/anchor-probe.ts`)

Read-only probe: fetches the real Exa pool with product params and runs the REAL
`normalizeFromResults` / `subjectForClassification` / `classifyWebResults`. No write.

BEFORE fix, classifySubject and on-entity contamination:

| ticker | canonicalName | classifySubject (BEFORE) | onEntity | contamination |
|---|---|---|---|---|
| LSBK | "Shore" | **Lake Shore Bancorp** (recovered) | 3 | none (correct) |
| FKYS | "Keystone" | **Keystone** | 8 | Gulf Keystone (oil), Keystone Cooperative, Keystone Hospitality, "Keystone cuts buy-to-let rates" (UK mortgages) all on-entity |
| UBFO | "United" | **United** | 7 | United Bankshares (UBSI) x4, United Development Bank on-entity |
| CZWI | "Citizens" | **Citizens** | 8 | Citizens Bank (Batesville AR) on-entity |
| KVYO/AAPL/JPM | full name | full name | clean | none |

## Fix (two parts, both required)

`src/lib/web-memo-entity.ts` only (not a protected file):

1. `subjectForClassification`: a single pool token no longer counts as trusted by
   LENGTH. Only a multi-token pool name overrides a strictly-more-specific query;
   a lone token defers to the query-derived name. So "United"/"Keystone"/
   "Citizens" become "United Security Bancshares"/"First Keystone"/"Citizens
   Community Bancorp". Single-token typo recovery ("nvdia"->"NVIDIA") is preserved
   because it only fires when the query is ALSO a single token.
2. `matchesName`: the >= 6-char substring shortcut now excludes
   `NON_DISTINCTIVE_LONG_TOKENS` (common shared bank words: united, keystone,
   citizens, security, community, national, ...). A distinctive brand token
   ("jpmorgan") still substring-matches (concatenated "JPMorganChase" preserved);
   a shared common word must clear the distinctive bigram or all-tokens test.

Both are needed: (1) gets a multi-token anchor; (2) stops one long shared token of
that anchor from substring-matching a different company.

## After fix (same probe, real pools)

| ticker | classifySubject (AFTER) | onEntity BEFORE->AFTER | demoted to sectorContext |
|---|---|---|---|
| FKYS | First Keystone | 8 -> **3** | Gulf Keystone, Keystone Cooperative, Keystone Hospitality, "Keystone cuts buy-to-let" |
| UBFO | United Security Bancshares | 7 -> **2** | United Bankshares (UBSI) x3, "Should Accelerating Profit Growth..." |
| CZWI | Citizens Community Bancorp | 8 -> **7** | Citizens Bank (Batesville AR) |
| LSBK | Lake Shore Bancorp | 3 (unchanged, already correct) | Shore Bancshares, Shore United, LakeShore Biopharma |
| KVYO | Klaviyo | 8 (unchanged) | none |
| AAPL | Apple | 6 (unchanged) | none |
| JPM | JPMorgan | 7 (unchanged) | none |
| UNM | Unum | 8 (unchanged) | none |

Full artifact: `recon/sweep-after.txt`. Note: Exa's 30-day window is relative to
now, so absolute pool composition shifts between runs; the structural result
(collapsed-token contaminants demoted, clean names unaffected) is stable.

Unit tests: `tests/unit/web-memo-entity.test.ts` 14/14 pass, including the
`JPMorganChase` concatenated-brand case and the `subjectForClassification` /
Lake Shore cases.

## Residual (honest)

A shared token that is a common word co-occurring in a competitor's summary can
still leak via the all-significant-tokens path (e.g. a "United Bankshares" summary
that also contains "security"). This is a much smaller surface than the substring
collapse and is bounded by the bigram-first check; `NON_DISTINCTIVE_LONG_TOKENS`
is the extensible knob if new shared tokens surface. Full closure would need
entity resolution (ticker-to-name authority), out of scope here.

## Optional (no functional change)

`canonicalName` in the response is a cosmetic label distinct from the filter key.
Renaming it (e.g. `displayName`) would prevent future readers from assuming the
filter anchors on it. Not changed here.
