# Web-Memo Anti-Fabrication: Diagnosis + Architecture Plan

Status: recon + design only. No product code changed. POCs are isolated under
`poc/` and not wired into the app. Anchor case: KVYO web-memo, flag ON, prod
build (origin/main @ b8f2adef). Read-only Exa re-fetches only.

Bottom line up front: the merged guards cannot bound narrative fabrication
because (1) they only inspect sentences that contain a digit-bearing figure, so
every prose claim is invisible to them, and (2) their maximum penalty is
stripping a `[n]` citation marker, never deleting the claim. A fabricated
sentence at worst loses its bracket and still renders. Prompt-only changes
cannot fix this; generation and verification must be separate components and the
verifier must be able to delete claims. Tested on the real KVYO pool, the prod
guards catch 0 of 4 fabrications as claims.

---

## Phase 1 — Live guard path, quoted, with the precise gap per guard

Live path (prod build), web-memo flag ON:

1. `POST /api/companies/web-fallback` (`src/app/api/companies/web-fallback/route.ts`)
   - `searchWeb(`${query} company news`, 8)` -> Exa `/search`, `type:auto`,
     `category:news`, 30-day window, `highlights{maxCharacters:400,numSentences:3}`.
     The ONLY per-source text that ever reaches the model is `title` + a
     ~400-char / 3-sentence highlight. No article body.
   - `normalizeFromResults` derives the subject name; `subjectForClassification`
     + `classifyWebResults` partition into `onEntity` vs `sectorContext`
     (Mode-1 entity filter — this WORKED for KVYO, no cross-company contamination).
   - `isThinPool(onEntity.length)` (`< 4` on-entity => thin state).
2. Frontend `PrimerWebMemo.tsx` builds the prompt via
   `buildWebFallbackMemoContent` + `buildWebFallbackMemoSystemPrompt`
   (`src/lib/company-intel.ts`) and POSTs `/api/memo` with `type:"company-web"`.
3. `POST /api/memo` (`src/app/api/memo/route.ts`):
   - `gemini-2.5-flash`, `temperature:0.35`, `maxOutputTokens:8192`,
     `thinkingConfig:{thinkingBudget:0}` (no reasoning budget).
   - `enforceBriefVoice` (first-person / recommendation language only — not fabrication).
   - Then, gated on `type==="company-web"` and the flag:
     ```js
     const subjectResults = parseWebResultsFromContent(originalContent);
     memo = enforceMemoCitations(memo, subjectResults);
     memo = enforceCorroboratedFigures(memo, subjectResults);
     ```
   - `recordOutput` -> render.

### Guard A: `enforceMemoCitations` (web-memo-entity.ts:247)
What it actually validates: for each split sentence that has `>=1` `[n]` AND
`>=1` digit-bearing figure token, for each cited `n` it strips that `[n]` iff the
figure's bare digits do NOT appear in `result[n-1]`'s `title+summary` text.

```js
const figs = figureTokens(sentence.replace(/\[\d+\]/g, ""));
if (figs.length === 0) continue;                 // <-- prose sentences EXIT here
...
if (!supports) fixed = fixed.split(`[${n}]`).join("");  // strips MARKER only
```

Precise gaps:
- **Prose-blind**: `if (figs.length === 0) continue` — any sentence with no digit
  is never inspected. The "upgrade from a major investment bank", "Predictive
  Send-Time AI", and "data feud / threatens tens of thousands of stores" claims
  have no digit figure, so the guard never looks at them.
- **Citation-only penalty**: the most it ever does is delete the `[n]` text. The
  claim prose always survives. A fabrication loses its bracket and still renders.
- **Semantically blind**: it matches bare digit substrings against
  `title+summary` (which also includes the URL and dates). "358" matches if those
  three characters appear anywhere in the cited result, regardless of meaning. It
  never checks the source *says* the thing the sentence claims.

### Guard B: `enforceCorroboratedFigures` (web-memo-entity.ts:344)
What it actually validates: for each sentence with `[n]` and a *financial* figure
(`scaledFigures` requires a leading `$`, a magnitude word, or `%`), it strips ALL
`[n]` from the sentence unless the figure (digits + compatible magnitude) appears
in `>= MIN_CORROBORATING_SOURCES (2)` distinct subject results.

```js
const figs = scaledFigures(sentence.replace(/\[\d+\]/g, ""));
if (figs.length === 0) continue;                 // <-- non-financial sentences EXIT
...
if (!hasDollar && !unit) continue;               // bare integers ignored
```

Precise gaps:
- **Figure-only, and financial-figure-only**: a bare count like "167,000 paying
  customers" has no `$`/unit/`%`, so `scaledFigures` returns nothing and the
  sentence is skipped. Every prose claim is skipped a fortiori.
- **Citation-only penalty**: same as Guard A — strips markers, never the claim.
- It is genuinely good at one narrow thing (the UNM single-source
  `$2.93 billion` vs `$2.93 million` case): magnitude-aware corroboration of
  financial figures. That is its entire scope.

### Net Phase-1 finding
Both guards are figure-gated and citation-only. Neither can see a prose claim and
neither can remove a claim. The KVYO failure was entirely in the NARRATIVE prose,
so the guards were structurally incapable of touching it.

---

## Phase 2 — KVYO diagnosis against the re-fetched real pool

Re-fetched the real Exa pool with the product params (`poc/fetch-pool.mjs`,
`poc/pools/kvyo.json`, fetched 2026-06-28). Caveat: Exa's 30-day window is
relative to now, so this pool is a near-but-not-identical snapshot of the one the
live memo used (some sources have shifted in/out — see c1 and t4 below). Per
fabricated claim:

| Claim | Class | Source trace | Why every guard passed it |
|---|---|---|---|
| (a) "upgrade from a major investment bank" | pure invention at gen-time (pool now volatile) | At generation the claim was vague + uncited (training-prior leak). The re-fetched pool now contains `[3]` = Goldman strong-buy upgrade (06-25), so the SAME claim is now coincidentally grounded. | Non-numeric prose -> both guards skip. |
| (b) "Predictive Send-Time AI" | distortion ORIGINATING IN SOURCE | Taken verbatim from headline `[2]` (ecommerce-times.com, low-cred). Real product is personalized send-time models / Composer. Model is faithfully grounded to a wrong source. | Non-numeric prose -> skip. And it is genuinely *entailed* by `[2]`, so entailment alone would also pass it. |
| (c) "data feud w/ Meta, freezes since March, threatens tens of thousands of stores" | conflation on thin low-cred source | Built on headline `[7]` "Klaviyo and Meta's **ALLEGED** Data Feud Is Rattling DTC Insiders" (onlinestorenews.com; summary is just the title). Model dropped "alleged", invented "freezes since March" and "tens of thousands", elevated to central risk. | Non-numeric prose ("tens of thousands" has no digits) -> both guards skip. |
| (d) "167,000 paying customers" | stale / invented figure | Pool `[6]` says "more than **196,000** accounts". 167,000 is a stale training-prior number, in NO pool result. | Guard A strips the `[6]` marker (167000 absent from [6]) but the wrong PROSE stays; Guard B skips it (no `$`/unit/`%`). |

True claims (for contrast): $358.0M rev / +28% / $9.0M GAAP NI -> `[5]` (and +28%
in `[6]`); $500M buyback + raised guidance -> `[6]`; CFO Whalen transition -> `[4]`.
The Anthropic integration the operator confirmed TRUE is NOT in the current pool
(temporal drift) — a useful false-positive probe for pool-grounded gates.

Two distinct fabrication families fall out of this, and they need different
defenses:
- **Family 1 — model-side invention** (c4 167k; the "freezes since March / tens of
  thousands" embellishment in c3; the gen-time vague upgrade c1): claims with
  content NOT in the pool. Caught by entailment-vs-pool and by extract-then-generate.
- **Family 2 — faithful grounding to a bad source** (c2 product name from `[2]`;
  c3's "feud" framing from `[7]`): the claim IS entailed by its cited source, so
  entailment PASSES it. Only cross-source corroboration + source-credibility
  weighting catches these.

This split is the central design constraint: no single mechanism covers both
families.

---

## Phase 3 — Hypotheses tested against the real pool (catch / miss)

POCs in `poc/`. Deterministic gates (`poc/gates-deterministic.mjs`) run as pure
code against the real `kvyo.json`. LLM gates (H1, H3) use a Claude subagent as
the gemini-2.5-flash stand-in over the same real pool; production must re-run the
eval against real gemini-2.5-flash (see Phase 4 gate metric).

Scoring rule: a gate "catches" a fabrication only if it would STRIP/DELETE the
CLAIM (not merely the citation marker).

### Baseline (prod guards), real pool
- Fabrications caught as claims: **0 / 4**. (Guard A strips the c4 `[6]` marker;
  the wrong "167,000" prose still renders.)
- True claims harmed: 0 / 4.
- Verdict: structurally cannot bound narrative fabrication.

### H2 — cross-source corroboration on named-event terms (deterministic)
- Fabrications caught: **4 / 4**.
- True claims harmed: **4 / 4**.  <-- disqualifying as a standalone strip.
- Finding: in a thin pool MOST TRUE facts are single-source by nature (the
  $358M print is only in `[5]`; the buyback only in `[6]`; the CFO move only in
  `[4]`). A blunt "needs >=2 sources or strip" rule deletes the real news along
  with the fabrications. Corroboration is necessary signal but unusable as a
  global gate; it must be claim-type-scoped (apply to adversarial/causal NAMED
  events, not routine disclosures) and credibility-weighted.

### H4 — causal / forward-looking fence (deterministic)
- Fabrications caught: **1 / 4** (the feud — speculative framing + uncorroborated).
- True claims harmed: **0 / 4**.
- Finding: cheap, precise, zero collateral, but narrow. It catches exactly the
  "threatens / feud / could undermine" risk-narrative class, which is the most
  dangerous class (c3 was elevated to the memo's central thesis). Strong as a
  targeted layer, not a general solution.

### H1 — claim-level entailment vs cited source  (LLM gate)
Decompose each claim to atomic sub-claims; judge each STRICTLY against the cited
source's text only; strip the claim if any load-bearing sub-claim is not entailed.
- Fabrications caught: **2 / 4** — c4 (167k contradicted by `[6]`'s 196k) and c3
  (its invented elaborations "freezes since March", "tens of thousands", "single
  sharpest risk" are not in `[7]`).
- Fabrications MISSED: **2 / 4** — c1 (now coincidentally grounded by re-fetched
  `[3]` Goldman upgrade; pool volatility) and **c2 (the gate PASSES it: the
  product name is verbatim in headline `[2]`, so it IS entailed by its cited
  source).**
- True claims harmed: **1 / 4** — t4-anthropic stripped because it is absent from
  the current pool. This is *correct* pool-grounded behavior, but a real coverage
  cost to log.
- Sharp finding: c3 was caught only because the model embellished *past* `[7]`.
  Had it written the source-faithful core ("an alleged Klaviyo/Meta data feud is
  rattling insiders"), entailment would have PASSED it — the same blind spot as c2.
  Entailment checks faithfulness to the cited text, never whether that text is correct.

### H3 — extract-then-generate  (LLM gate)
Extract the allowed atomic fact set from the pool FIRST (with per-fact source +
corroboration count), then only claims fully constructible from that set may be
generated.
- Fabrications prevented (NOT-CONSTRUCTIBLE): **2 / 4** — c4 (167k contradicts the
  extracted 196k fact) and c3-as-written (the escalations are extract-free).
  Caveat: a *degraded* "Klaviyo/Meta alleged feud" IS constructible from fact F11,
  so H3 shrinks c3 but does not erase the feud frame.
- Blind spots: **c1 and c2** — both trace to real pool text (c2's false product
  name lives verbatim in headline `[2]`; c1 re-grounded by the fresh Goldman
  fact). The extractor faithfully lifts both. "Headlines are pool text — extraction
  does not adjudicate source credibility or strip an 'alleged' hedge."
- True claims lost: **1 / 4** — t4-anthropic (absent from pool; correctly
  unconstructible). t1/t2/t3 map cleanly and survive.
- Note on gen-time vs re-fetch: against the ACTUAL generation-time pool (no Goldman
  upgrade yet), c1 would ALSO have been unconstructible, so H3 would have prevented
  3/4 (c1, c3-details, c4). The c1 "miss" here is a re-fetch artifact, not a true
  H3 weakness. The durable H3 blind spot is c2.

### Cross-gate results (real KVYO pool)

| Gate | Fabrications caught (as claims) | True claims harmed | Cost | Verdict |
|---|---|---|---|---|
| Baseline (prod) | **0 / 4** | 0 / 4 | 0 | structurally blind to prose; strips markers only |
| H4 causal fence | 1 / 4 (c3) | 0 / 4 | ~0 (pure code) | narrow, precise, zero collateral |
| H1 entailment | 2 / 4 (c3, c4) | 1 / 4 (t4*) | +1 LLM call | misses source-faithful distortions (c2) |
| H3 extract-then-gen | 2 / 4 (c4, c3-details); 3/4 at gen-time | 1 / 4 (t4*) | +1 LLM call | best structural prevention; blind to c2 |
| H2 corroboration (blunt) | 4 / 4 | **4 / 4** | ~0 | unusable standalone (deletes the truth) |
| H2 + source-credibility (scoped) | catches c2 + feud | low (scoped) | ~0 | the ONLY thing that catches c2 |

\* t4 "harm" is correct pool-grounded behavior (claim absent from current pool),
not a true-positive failure.

### Ranking
1. **Extract-then-generate (H3)** — highest structural payoff: changes the default
   from "generate then maybe catch" to "can only assert extracted facts". Kills
   pure invention (c4) and unsupported escalation (c3 details). Blind to c2.
2. **Source-credibility + scoped corroboration (H2 refined)** — the only mechanism
   that catches c2 (faithful grounding to a low-cred single source) and the feud
   framing, WITHOUT H2's catastrophic true-claim damage, because it is scoped to
   named-event / risk-thesis claims and skips high-cred routine disclosures.
3. **Claim-level entailment (H1)** — strong post-generation backstop; catches drift
   past the extracted facts. Cheap defense-in-depth.
4. **Causal/forward fence (H4)** — cheapest, zero collateral, defends the
   highest-blast-radius class (the central-risk slot c3 occupied). Ship first.
5. **H2 blunt** — do NOT ship standalone; 4/4 true-claim damage.

No single gate exceeds 2/4 on its own; the four fabrications span two families
(model invention vs source-faithful distortion) that require different mechanisms.
A LAYERED design (H3 spine + H1 backstop + credibility-scoped H2 + H4 fence) is
required to approach 4/4 with low true-claim damage.

---

## Phase 4 — Recommended architecture

### Core principle
**Generation and verification are separate components, and the verifier can
delete claims.** The prod build violates both halves: the guards run in the same
trust boundary as a free-form generation and their only power is to remove a
citation marker. The fix is a pipeline where (1) the generator is constrained by a
pre-extracted, credibility-tagged fact set, and (2) an independent verifier strips
whole CLAIMS (not markers) and, if a section empties, renders a coverage note.

### Recommended pipeline (layered; pre-gen + post-gen)

```
Exa pool
  -> [A] EXTRACT (LLM): pool -> allowed fact set
          each fact tagged: {text, sourceIdx, sourceCredTier, corroborationCount}
  -> [B] GENERATE (LLM): memo constrained to the fact set ONLY
          (facts are the input, not the raw pool; citations map to fact IDs)
  -> [C] VERIFY (separate components, each can DELETE a claim):
          C1 entailment gate (LLM): claim must be entailed by its cited fact(s)
          C2 credibility+corroboration gate (code): a load-bearing NAMED EVENT or
             risk-thesis claim sourced from a single LOW-cred fact is stripped or
             demoted to an explicitly-hedged "alleged/unconfirmed" form
          C3 causal/forward fence (code): "threatens/feud/could undermine" claims
             must clear C2 or be hedged/stripped
  -> render (empty section -> coverage note, never a fabricated filler)
```

Why this specific combination (each layer earns its place from the data):
- **[A]+[B] extract-then-generate** is the spine. It prevented c4 + c3-escalations
  in test and (at gen-time) c1. It is the only layer that stops invention at the
  source instead of catching it after.
- **C1 entailment** is the backstop for any drift [B] still emits. Catches c3/c4.
- **C2 credibility+corroboration** is the ONLY layer that catches c2 and the feud
  framing (faithful grounding to a single low-cred source). It must be SCOPED:
  apply only to named-event / adversarial / risk-thesis claims, and NEVER strip a
  single-source claim that comes from a high-credibility filing-grade source —
  that scoping is what avoids H2's 4/4 true-claim wipeout. Needs a domain
  credibility map (filings / Reuters / Bloomberg = high; marketbeat,
  ecommerce-times, onlinestorenews, baseballnewssource = low/aggregator).
- **C3 causal fence** is a cheap targeted guard on the single highest-risk slot
  (the "single sharpest risk" sentence c3 occupied). Zero true-claim damage in test.

Expected combined coverage on the KVYO case: c4 (A/B + C1), c3 (A/B + C1 + C3),
c2 (C2), c1 (A/B at gen-time). That is the full 4/4, each by a different layer —
which is exactly why no single hypothesis sufficed.

### Can prompt-only changes ever be sufficient? No.
The prod system prompt ALREADY contains maximal anti-fabrication instruction
(`company-intel.ts:1456`: "Do not supplement with training knowledge... If a
figure or claim is not present in the provided results, omit it entirely...
internally verify: does this exact figure appear..."). The model violated every
line of it. Reasons it cannot work:
1. A single stochastic forward pass cannot reliably self-censor: the same weights
   that hallucinate the feud also do the "internal verification". Verification
   must run in a separate pass with separate inputs (the cited source text alone),
   which is structurally a different component.
2. The current call uses `thinkingBudget:0` and `temperature:0.35` — no
   deliberation budget to even attempt self-check, and enough sampling entropy to
   drift.
3. Prompt instructions cannot DELETE output; only a post-process can. The
   architectural gap is the missing delete-capable verifier, not weak wording.
Prompt hardening is necessary hygiene but provably insufficient on its own.

### Honest tradeoffs
- **Cost**: +2 LLM calls per web-memo (extract [A] + batched entailment [C1]).
  C2/C3 are pure code (~0). Roughly 2-3x the current single-call LLM cost for this
  path. The web-fallback path is on-demand and low-volume (fires only when indexed
  search returns zero), so absolute spend impact is small.
- **Latency**: +2-4s (two extra sequential gemini-2.5-flash calls). Acceptable for
  an on-demand memo; can be hidden behind the existing generation spinner.
- **Coverage loss (residual true-claim cost)**: a strictly pool-constrained
  generator drops true facts that are absent from the current pool (t4-anthropic).
  This is correct behavior but reduces recall. Mitigation: widen the pool (more
  Exa results / multiple queries) before tightening generation; surface a "limited
  coverage" signal rather than papering over gaps.
- **Residual fabrication risk (not eliminated)**: the c2 class — a plausible,
  real-sounding claim from a single mid-credibility source — is only MITIGATED by
  credibility tiering, not closed. Credibility tiers are heuristic; a wrong claim
  from a source we rate "medium" can still pass. The honest ceiling is "no
  load-bearing fabrication from a low-cred single source, and no fabrication in the
  central-risk slot," not "zero fabrication ever."
- **Thin-pool reality**: most true facts in these pools ARE single-source. Any
  corroboration requirement must be scoped or it deletes the news. This is the
  single most important tuning constraint.

### Staged rollout (build order, cheapest-first / de-risk-first)
- **Stage 0 (pure code, ship first, no new LLM calls):**
  (a) make the EXISTING verifier delete-capable for `company-web`: on guard
  failure, strip the whole sentence (quarantine), not just the `[n]`; if a section
  empties, render its coverage note. (b) Add the C3 causal/forward fence. This
  alone removes the feud sentence from the KVYO memo. Lowest risk, immediate value.
- **Stage 1:** add C1 claim-level entailment gate (one batched gemini-2.5-flash
  call). Catches c3-escalation + c4. First new LLM cost.
- **Stage 2:** add C2 source-credibility tiering + scoped corroboration. Build the
  domain credibility map. Catches c2 + feud framing — the hardest family.
- **Stage 3:** flip [A]+[B] to extract-then-generate as the spine. Largest change,
  largest payoff; do last, once C1-C3 have de-risked the path and the eval exists.

### Eval and the gate metric to clear before trusting flag-on
- **Eval set**: start with the 4 real pools captured here (kvyo, lakeshore,
  richtech, unum) and grow to ~15-20 thin/ambiguous tickers. Generate each memo
  with **real gemini-2.5-flash** (the POCs used a Claude stand-in for the LLM
  gates; the production eval MUST re-run against gemini-2.5-flash). Hand-label
  every atomic claim true/fabricated against its pool, and tag whether it is
  load-bearing / occupies the risk-thesis slot.
- **Metrics**: (1) fabrication-survival rate = fabricated atomic claims that still
  render; (2) load-bearing-fabrication-survival = same, restricted to load-bearing
  claims; (3) true-claim retention = true pooled claims that survive (exclude
  correctly-dropped pool-absent claims from the denominator).
- **Gate to clear before flag-on**:
  - load-bearing-fabrication-survival = **0** (no fabricated claim anchors a
    section or occupies the "single sharpest risk" slot),
  - overall fabrication-survival **<= 5%**,
  - true-claim retention **>= 90%** (pooled claims).
  Until those clear on the gemini-2.5-flash eval, the web-fallback flag stays the
  way it is.

### What was NOT changed
Zero product files modified. All POCs (`poc/`) are standalone scripts, not
imported by the app. Only read-only Exa fetches were made; no merge, no pipeline
run, no flag change, no Supabase write.

