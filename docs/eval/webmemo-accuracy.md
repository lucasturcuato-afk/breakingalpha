# Web-memo accuracy eval

Scope: the on-demand / web-fallback memo path that `PrimerWebMemo` (PR #410) and
the directory search screen both drive. Read-only against product code at
`origin/main` @ c17ede9f. No product code, schema, or pipeline was changed.

Bottom line is at the end. Read the BLOCKER section first: the claim-level
hallucination RATE could not be measured this run, and why.

---

## Generation path (traced)

1. `PrimerWebMemo` / directory search -> `POST /api/companies/web-fallback`
   (`src/app/api/companies/web-fallback/route.ts`). Feature-flagged
   (`NEXT_PUBLIC_WEB_FALLBACK_ENABLED`, default off), signed-in only. Calls
   `searchWeb(\`${query} company news\`, 8)` -> Exa `/search`, `category:news`,
   `type:auto`, `numResults:16`, 30-day window, 3-sentence highlights. Returns
   `{ results, canonicalName }`. The only persistence is a 6h `web_search_cache`
   row inside `searchWeb`; it does NOT write `companies`.
2. `buildWebFallbackMemoContent(canonicalName, results)` formats the numbered
   result pool; `buildWebFallbackMemoSystemPrompt(canonicalName, n)` is the
   grounding prompt (`src/lib/company-intel.ts`).
3. `<MemoModal type="company-web">` -> `POST /api/memo` -> `ai.models.generateContent({ model: "gemini-2.5-flash", temperature: 0.35 })`
   with the system prompt as `systemInstruction`, plus a self-correction redo at
   temp 0.2 (`src/app/api/memo/route.ts:534-567`). The memo is the model output.

So the memo is `gemini-2.5-flash`, grounded on an Exa 30-day news pool, under a
strict citation prompt.

---

## BLOCKER: live generation could not be run read-only

The method (generate 10 memos, fact-check each claim against its cited sources)
requires producing the actual memo text. Both routes to that are closed here:

- **The product path writes.** `/api/memo` records every generated memo to the
  `outputs` table via `recordOutput` (`route.ts:601,687`). The task forbids
  writes ("if generation requires a write, STOP and flag"). Generating 10 memos
  through the product = 10 cache writes. Not run.
- **No out-of-band model access.** `gemini-2.5-flash` needs `GEMINI_API_KEY`
  (`route.ts:17`). It is absent from every env file checked (`GEMINI_API_KEY`,
  `GOOGLE_API_KEY`, `GOOGLE_GENAI_API_KEY`, `VERTEX*` all missing; only
  `EXA_API_KEY` is present). So the memo cannot be regenerated as a pure read.
- Substituting a different model (e.g. me) would NOT evaluate
  `gemini-2.5-flash`'s behavior, so it is rejected as misleading.

What IS runnable read-only, and was run: the Exa search half (the grounding
substrate), called directly against the API (skipping the `web_search_cache`
upsert). Pool quality is the dominant predictor of hallucination pressure, so
this is the empirically defensible part of the eval. The per-claim
SUPPORTED/UNSUPPORTED/CONTRADICTED tally is **pending** a generation run; the
harness to produce it is in the appendix.

---

## Empirical finding 1: grounding-pool quality by coverage tier

Exa `/search` (the product's exact params), 30-day window, run 2026-06-22.
`on-entity` = result is actually about the subject company (manually verified for
the thin cases; first-token heuristic for the rest). `w/fig` = result carries a
citable hard figure ($, %, Q, year, mn/bn).

| Company | Tier | Pool | On-entity | w/fig | Newest (days) |
|---|---|---|---|---|---|
| Apple | large US | 16 | ~15 | 7 | 0 |
| JPMorgan Chase | large US | 16 | ~15 | 9 | 0 |
| Nvidia | large US | 16 | ~15 | 9 | 0 |
| ASML | foreign | 16 | ~15 | 7 | 0 |
| Alibaba | foreign | 16 | 16 | 6 | 0 |
| Richtech Robotics | small/obscure | 14 | 14 | 8 | 0 |
| Unum Group | mid-cap | 16 | ~12 (12/12 on manual read) | 14 | 2 |
| Onto Innovation | small | 16 | 16 | 14 | 0 |
| Mama's Creations | thin | 13 | ~9 | 11 | 11 |
| **Lake Shore Bancorp** | **thin/ambiguous** | **16** | **~3-5** | 11 | 3 |

Takeaway: for any reasonably-covered name (including the small but hyped Richtech
RR and mid-cap UNM), the pool is fresh, on-entity, and figure-rich. The strict
prompt has real material to cite. The failure mode is NOT empty pools; it is
**off-entity contamination on thin, name-ambiguous tickers.**

## Empirical finding 2: the worst case (Lake Shore Bancorp) verbatim

The on-demand path exists to surface obscure tickers, so this tier is the one
that matters most. The LSBK 30-day pool (12 shown, verbatim titles + domains):

```
[1]  Brautigam exercises options in Lake Shore Bancorp | LSBK Insider Trading   stocktitan.net   ON
[2]  WSFS Financial (WSFS) & Lake Shore Bancorp (LSBK) Financial Survey         thecerbatgem.com ON (comparison)
[3]  Financial Contrast: Lake Shore Bancorp (LSBK) and WSFS Financial           baseballnewssource.com ON (comparison)
[4]  Shore Bancshares names B. Scot Ebron bank president | SHBI                  stocktitan.net   OFF (SHBI)
[5]  Shore Bancshares, Inc. Announces Appointment of B. Scot Ebron              gurufocus.com    OFF (SHBI)
[6]  Shore United Bank PARTNERS WITH GREENLIGHT ...                             shoreupdate.com  OFF (Shore United)
[7]  Shore Bancshares (SHBI) Sets New 52-Week High                              thelincolnianonline.com OFF (SHBI)
[8]  Maryland Financial Firm Automates with Jack Henry ...                      mcpressonline.com OFF
[9]  North Shore Bank buying PyraMax Bank owner for ~$95 million                jsonline.com     OFF (North Shore)
[10] North Shore Bank, 1895 Bancorp: agreement for North Shore to acquire       wisbusiness.com  OFF (North Shore)
[11] Shore Bancshares director awarded 1,855 RSUs | SHBI                        stocktitan.net   OFF (SHBI)
[12] Shore Bancshares director awarded 1,855 RSUs | SHBI                        stocktitan.net   OFF (SHBI, dup)
```

~3 of 12 are actually Lake Shore Bancorp; the rest are Shore Bancshares (SHBI),
Shore United Bank, North Shore Bank, and 1895 Bancorp - unrelated banks sharing
the token "Shore." A memo built on this pool, under a prompt that demands
specific figures and named events, is highly likely to attribute SHBI's "B. Scot
Ebron named president" [4][5] or North Shore's "$95M PyraMax acquisition" [9][10]
to Lake Shore Bancorp - each with a real `[n]` citation pointing at a real
result. That is a CONTRADICTED-class fabrication that the citation requirement
does NOT prevent, because the citation is to a real but wrong-entity source.

## Structural finding 3: the prompt grounds figures but not identity, and mandates specifics

From `buildWebFallbackMemoSystemPrompt` (verbatim excerpts):

- Strong, genuinely good anti-invention guardrails: "Do not supplement with
  training knowledge. Do not add figures, valuations, growth rates, timelines,
  or named events that do not appear explicitly in the provided results... When
  in doubt, omit." Every figure must end with a `[n]`.
- But the citation is **model-asserted, never validated**: nothing checks that
  result `[n]` actually contains the cited figure. A hallucinated number with a
  plausible `[n]` passes.
- "Implications and analytical framing drawn from cited facts are permitted (and
  do not need a citation themselves)" - an **uncited channel** where causal and
  forward-looking claims can drift.
- Identity defense is the wrong shape for the contamination case: "Treat all
  naming variants... as one entity. Do not split coverage across naming
  variants." This **merges** same-name-fragment results - exactly the wrong move
  for the LSBK pool, where the "Shore" results are different companies, not
  variants.
- Pressure to produce specifics even when the pool is thin: the opener "must
  begin with a proper noun or specific figure," the Analyst Brief "must contain
  at least one temporal anchor: a specific upcoming event, earnings print,
  regulatory deadline, or named catalyst." A mandate to surface a specific
  catalyst against a thin/contaminated pool is a classic invention vector.

Mitigations already present that lower (not eliminate) risk: temp 0.35, a
self-correction redo pass (temp 0.2), and the omit-when-in-doubt framing.

---

## Failure patterns (predicted, grounded in pool + prompt; pending generation to quantify)

1. **Off-entity misattribution on ambiguous thin tickers** (highest severity).
   Wrong-company news cited as the subject's, with a valid-looking `[n]`. LSBK is
   the worst observed pool. Not defended by the variant-merge rule.
2. **Uncited framing drift.** Causal/forward claims ("positioning it to...",
   "signaling a shift toward...") are permitted without citation and can outrun
   the facts.
3. **Mandated-specific invention.** The required temporal anchor / figure-led
   opener pressures a specific even when the pool lacks one.
4. **Unvalidated citations.** `[n]` can point to a real result that does not
   contain the cited figure; no programmatic check.

The well-covered tiers (Apple/JPM/NVDA/ASML/BABA/UNM/ONTO/RR) have clean,
figure-rich pools, so for those the strict prompt likely holds up well; the
residual risk concentrates on the thin/ambiguous tail - which is exactly the
population the on-demand mint path surfaces.

---

## Bottom line

**Not "ship as-is."** Recommendation: **ship with stronger grounding constraints
plus a heavier disclaimer, and gate prod enablement on the empirical run below.**

The reason is structural and pool-driven, not a vibe: the prompt grounds figures
well but (a) does not validate citations against source text, (b) leaves framing
uncited, (c) mandates specifics that pressure invention, and (d) its identity
rule merges rather than filters same-name-fragment contamination. The covered
tiers are fine; the on-demand path's reason for existing is the obscure tail,
and that tail has the worst pools (LSBK ~75% off-entity).

Specific grounding changes to make before flipping the flag:

1. **Entity-contamination filter on the pool, before the prompt.** Keep only
   results whose title/domain actually match the subject (ticker or strict name
   match), and label the rest "sector context" rather than feeding them as
   subject material. Drop the "treat all variants as one entity" instruction for
   the thin case, or scope it to true suffix/case variants only.
2. **Programmatic citation validation.** After generation, for each `[n]`-tagged
   figure, verify the figure string appears in result `[n]`'s title/summary; drop
   or flag sentences that fail. Cheap post-process, closes the biggest hole.
3. **Make the "specific opener / temporal anchor" mandate conditional** on the
   pool actually containing one; otherwise allow a neutral opener. Remove the
   pressure to invent.
4. **Require citations on causal/forward framing too,** or explicitly fence
   forward-looking statements behind a hedge.
5. **Heavier disclaimer on the web-memo surface**, especially when the pool is
   thin or low-on-entity ("Generated from N web results; may be incomplete or
   misattributed for thinly-covered companies").

---

## VERIFY

- Claims checked against ACTUAL fetched sources, not assumed: the Exa pools were
  fetched live (read-only) and the LSBK/Unum result titles are quoted verbatim
  from that fetch. The grounding-substrate findings are empirical.
- Rate computed from a tally: NOT possible this run. The per-claim
  SUPPORTED/UNSUPPORTED/CONTRADICTED rate requires generating the memos, which is
  blocked (write-on-generate + no `GEMINI_API_KEY`). Flagged, not faked. The
  harness below produces it.
- Worst case quoted verbatim: Lake Shore Bancorp pool above.
- Zero product files changed: only this doc is added.

## Appendix: ready-to-run empirical harness

Run once a `GEMINI_API_KEY` is available in a sandbox where `/api/memo`'s
`outputs` write is acceptable (or by calling `generateContent` directly to avoid
the write):

```
for each of the 10 companies:
  pool = exa("<name> company news", news, 30d, 16)          # read-only
  sys  = buildWebFallbackMemoSystemPrompt(canonical, len)    # product helper
  body = buildWebFallbackMemoContent(canonical, pool)        # product helper
  memo = gemini-2.5-flash.generate(systemInstruction=sys, content=body, temp=0.35)
  for each numeric/named/causal claim in memo:
    cited_n = the [n] on the claim
    SUPPORTED   if the claim's figure/name appears in pool[cited_n]
    CONTRADICTED if pool[cited_n] (or an independent check) says otherwise
    UNSUPPORTED  if no [n], or [n] does not contain it
  tally per company; aggregate the rate; quote the worst sentences verbatim
```

Without the generation step this run, the doc reports the grounding-substrate
evidence and the structural risk that substrate creates, and defers the
claim-level rate to this harness.
