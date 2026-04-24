# SPEC — Approach B: Post-Generation Regex-Based Cliche Detector

Recon Subagent 1 of 3. Read-only investigation of `backend/synthesize.py`,
`backend/deal_extractor.py`, and Lucas's four pipeline steps
(`thesis_grader.py`, `pattern_memory.py`, `source_credibility.py`,
`adversarial.py`), plus `critique.py` and `brief_feedback_loop.py`. Branch:
`main` @ `56e7d84`. No source code modified.

---

## Section 0 — RECON SURPRISE

**None found.** All three trigger conditions checked and cleared:

1. **PR #127 banned block is structurally clean.** Quoted verbatim from
   `backend/synthesize.py` lines 40–78 (MORNING) and 186–224 (EVENING).
   No typos, no escape errors, no truncated bullets, no ambiguous phrasing
   that plausibly explains model non-compliance. The block uses consistent
   straight single quotes, parallel bullet structure, and includes explicit
   BAD/GOOD examples plus an "absolute and supersedes" override clause.
   Prompt-level craftsmanship looks correct.

2. **Placement matches PR #127's claim.** The LANGUAGE CONSTRAINT block
   sits **immediately after** the SECTION RULES paragraph in both prompts:
   - MORNING_SYSTEM: SECTION RULES at line 38, LANGUAGE CONSTRAINT at line 40.
   - EVENING_SYSTEM: SECTION RULES at line 184, LANGUAGE CONSTRAINT at line 186.
   Ordering is identical in both prompts.

3. **No existing pipeline step filters cliches post-synthesis.** Searched
   `thesis_grader.py`, `pattern_memory.py`, `source_credibility.py`,
   `adversarial.py`, `critique.py`, `brief_feedback_loop.py`. Findings:
   - `thesis_grader`, `pattern_memory`, `source_credibility`, `adversarial`
     operate exclusively on the `theses` / `pattern_library` /
     `source_credibility` tables — they never touch `briefings` rows or
     the synthesized brief payload.
   - `critique.py` DOES scan the persisted briefing for banned phrases
     (lines 62–75, `BANNED_PHRASES` list), but it is **observational only**:
     it writes a row to `brief_quality_scores` and never mutates or rejects
     the brief. Its banned list is also the *legacy* 12-phrase SECTION
     RULES list — **it has NOT been updated with the PR #127 constructions**
     (`signals`, `underscores`, `highlights`, `reflects`, etc.). That's a
     relevant gap but it's a *score gap*, not a filter that already exists.
   - `brief_feedback_loop.score_brief` runs post-persist (step `[POST]` in
     `run.py`) — scoring layer, not a pre-persist filter.

Gate recommendation: **proceed** to Approach B implementation after Noah
reviews. Whether Approach B is the *right* call still depends on Recon 3's
re-run of a single post-#127 brief to confirm #127 is actually
non-performant; tonight's 8pm PT wrap ran at 5:27pm PDT — 2h14m before
PR #127 merged (7:41pm PDT), so the observed 10+ cliches are pre-#127
baseline. Approach B remains justified as a defense-in-depth layer even
if #127 is partially performant: prompt-only constraints on Gemini-2.5-
flash at `temperature=0.3` will leak under pressure; a deterministic
regex cannot.

---

## Section 1 — Current State

### 1.1 `synthesize.py` flow (file: `/Users/noahhanning/breakingalpha/backend/synthesize.py`)

Pipeline (function `run(brief_type)`, lines 1053–1402):

1. **Article pool fetch** (lines 1062–1077): pulls up to 60 articles from
   `articles` table in last 24h, ordered by `relevance_score desc`.
2. **Freshness rerank** (`_freshness_rerank`, line 1083): demotes stale
   high-score articles so a 22h-old score-9 doesn't beat a 3h score-8.
3. **Spine + floor selection** (`_select_articles_for_synthesis`, line 1085):
   12-article spine (sector_cap=3) + up to 6 breadth floor articles
   (score ≥ 7, one per uncovered sector).
4. **Watchlist injection** (lines 1089–1122): prepends `[WATCHLIST]`-tagged
   articles.
5. **Prompt assembly**: picks `MORNING_SYSTEM` or `EVENING_SYSTEM` (line
   1155). For evening, prepends a lead-dedup directive (lines 1161–1201).
   Also prepends a cached feedback-loop addendum (lines 1203–1226) and the
   aggregate engagement context (lines 1228–1232).
6. **Gemini call** (`gemini_generate`, line 634; invoked line 1237):
   - model: `gemini-2.5-flash`
   - `temperature=0.3`
   - `max_output_tokens=4096`
   - `thinking_budget=0`
   - `response_mime_type="application/json"`
7. **Response parsing** (lines 1243–1258): strips optional code fences with
   `re.sub(r"^```json|^```|```$", "", raw, flags=re.MULTILINE)`, then
   `json.loads`, then tier-2 fallback to `re.search(r"\{.*\}", raw,
   re.DOTALL)`. On failure, falls through to stub payload (lines 1260–1267).
8. **Post-parse mutations**:
   - `_validate_sector_breakdown` (line 1269) — schema-echo detection,
     whitelist enforcement, compound-key remap.
   - `see-lead` clamp on `top_deals[].one_liner` (lines 1272–1284).
   - `filter_undisclosed_deals` (line 1290) — drops null/Undisclosed deals
     with See-lead exception.
   - Structured-body derived summary (lines 1296–1304).
9. **Persist** (lines 1306–1353): `briefings.insert(row_with_extras)` with
   fallback to base row on schema error.
10. **Post-persist**:
    - Morning: `extract_and_persist_claims` (line 1373) — second Gemini call.
    - Evening: `generate_morning_review_for_evening` + attach via UPDATE
      (lines 1386–1397).

### 1.2 PR #127 banned block — MORNING, verbatim (lines 40–78)

```
LANGUAGE CONSTRAINT — NO EMPTY-CALORIE PHRASES:

In addition to the banned phrases listed elsewhere in this prompt, the following constructions are also banned. Applies to: Market Pulse narrative, lead 3-column (lead_paragraph, supporting_context, what_to_watch), legacy summary, Analyst Briefing cards, Sector Signals, and Top Deals one_liners. No field is exempt.

BANNED constructions (vague or placeholder subjects/objects):
- 'signals [vague trend]' — e.g., 'signals private equity's appetite for', 'signals broader headwinds', 'signals sustained demand'
- 'underscores [vague importance]' — e.g., 'underscores the strategic importance of', 'underscores prolonged conflict'
- 'highlights [vague trend]' — e.g., 'highlights the ongoing trend toward', 'highlights significant risks'
- 'reflects [vague continuation]' — e.g., 'reflects continued investor confidence', 'reflects a prolonged conflict'
- 'demonstrates [vague positive]' — e.g., 'demonstrates robust capital deployment', 'demonstrates strong fundamentals'
- 'indicates [vague positive]' — e.g., 'indicates robust private capital activity', 'indicates resilience'
- '[X]'s strong/continued appetite for [Y]' without a named deal, comp, or data point
- '[X]'s continued/sustained [adjective] [noun]' without a concrete data point
- Abstract sector-trend language when a specific deal, number, or named company is available in source material
- Temporal filler: 'the ongoing', 'the continued', 'the sustained' without a specific timeframe or comp
- Impact filler: 'significant', 'substantial', 'major' without a specific number

This constraint is absolute and supersedes any 'unless evidenced' softeners elsewhere in this prompt. No escape clauses.

REQUIRED replacements when describing a story:
- Quote a specific number from the article (deal value, market cap, multiple, growth rate, percentage, basis points)
- Name a comparable transaction, precedent deal, or peer company by name
- State a specific forward-looking implication with a measurable target ('watch Q3 guidance', 'monitor the $X level', 'compare to [peer's] recent [metric]')
- If you cannot generate a concrete claim from source material, write a SHORTER sentence stating just the bare fact, or OMIT the sentence entirely. A shorter sentence with one real fact beats a longer sentence with wire-copy padding.

EXAMPLES:

BAD: 'AIP's acquisition signals private equity's continued appetite for industrial technology assets, particularly those with established market positions.'
GOOD: 'AIP's carve-out follows Honeywell's $5B portfolio review announced in Q2 2025.'
GOOD: 'Honeywell shed the unit at an undisclosed price; comparable warehouse-software assets traded at 12-15x EBITDA in 2024.'
GOOD: 'AIP acquires the unit.' (bare fact acceptable when nothing concrete is in source)

BAD: 'Tesla's $25B AI commitment underscores the strategic importance of capital allocation discipline.'
GOOD: 'Tesla's $25B AI spend equals 30% of FY24 free cash flow.'
GOOD: 'Tesla committed $25B to AI; analysts flagged FCF coverage as the key Q2 guidance metric.'

BAD: 'The European Union's $106 billion loan reflects sustained demand for Aerospace & Defense sector products.'
GOOD: 'EU's $106B Ukraine loan lifts European A&D backlogs to multi-decade highs; Rheinmetall and BAE Systems are the named prime contractors.'
GOOD: 'EU approved a $106B Ukraine military loan.' (bare fact fallback)
```

EVENING_SYSTEM block (lines 186–224) is byte-identical — same wording,
same bullets, same examples.

### 1.3 `deal_extractor.py` banned block, verbatim (lines 56–64)

```
LANGUAGE CONSTRAINT — NO EMPTY-CALORIE PHRASES (applies to thesis field):

The following constructions are banned in the thesis field:
- 'signals [vague trend]', 'underscores [vague importance]', 'highlights [vague trend]', 'reflects [vague continuation]', 'demonstrates [vague positive]', 'indicates [vague positive]'
- '[X]'s strong/continued appetite for [Y]' without a named deal or data point
- Abstract sector-trend language when specifics are in source material
- Impact filler ('significant', 'substantial', 'major') without a specific number

REQUIRED: the thesis must either name a specific strategic rationale (comparable transaction, concrete financial metric, named peer company) OR be a single bare-fact sentence. A shorter thesis with one real fact beats a longer thesis with wire-copy padding.
```

---

## Section 2 — Full regex pattern list derived from PR #127 verbatim

Patterns follow the banned-construction categories one-for-one. No
improvisation. Each category maps to ≥1 regex. Python `re` syntax,
case-insensitive (`re.IGNORECASE`). Word-boundary anchored to minimize
false positives. `\b` used only where the term is not followed by an
apostrophe-s construction.

**Convention:** each entry is `{id, pattern, source_bullet, example_from_prompt}`.

```python
# Category 1 — 'signals [vague trend]'
R_SIGNALS_VAGUE = [
    # "signals" + (adjective)? + (vague noun). Covers: "signals private
    # equity's appetite for", "signals broader headwinds", "signals
    # sustained demand", "signals strong market leadership", "signals
    # likely increased government defense spending", "signals advancements
    # in unmanned defense systems", "signals robust investor appetite",
    # "signals private equity's interest".
    r"\bsignals?\b\s+(?:a\s+|an\s+|the\s+)?(?:strong|continued|sustained|broader|growing|robust|significant|increased|likely|private\s+equity'?s?|investor)?\s*(?:appetite|interest|demand|confidence|headwinds?|trend|activity|momentum|leadership|growth|expansion|spending|advancements?|resilience|strength|conviction|deployment)\b",
    # "would signal <vague>" / "could signal <vague>" — covers
    # "would signal continued strong investor confidence", "would signal
    # resilience in consumer spending".
    r"\b(?:would|could|may|might)\s+signals?\b\s+(?:continued|sustained|broader|strong|robust|significant|likely)?\s*(?:appetite|interest|demand|confidence|resilience|growth|trend|strength|activity)\b",
    # "signaling <vague>" — present participle variant. Covers
    # "signaling advancements in unmanned defense systems".
    r"\bsignaling\b\s+(?:strong|continued|sustained|broader|growing|robust|significant|likely)?\s*(?:appetite|interest|demand|confidence|headwinds?|trend|activity|momentum|leadership|growth|expansion|spending|advancements?|resilience|strength)\b",
]

# Category 2 — 'underscores [vague importance]'
R_UNDERSCORES_VAGUE = [
    # Covers: "underscores the strategic importance of", "underscores
    # prolonged conflict", "underscores robust private market interest".
    r"\bunderscores?\b\s+(?:a\s+|an\s+|the\s+)?(?:strategic|growing|continued|sustained|broader|robust|significant|prolonged|increased|private)?\s*(?:importance|interest|appetite|demand|conflict|commitment|shift|trend|momentum|confidence|resilience|need|imperative)\b",
    # "underscoring <vague>"
    r"\bunderscoring\b\s+(?:a\s+|an\s+|the\s+)?(?:strategic|growing|continued|sustained|broader|robust|significant|prolonged)?\s*(?:importance|interest|appetite|demand|conflict|commitment|shift|trend|momentum|confidence|resilience)\b",
]

# Category 3 — 'highlights [vague trend]'
R_HIGHLIGHTS_VAGUE = [
    # Covers: "highlights the ongoing trend toward", "highlights
    # significant risks". Note: `critique.py` already flags bare
    # "highlight" but as SECTION RULES legacy, not PR #127.
    r"\bhighlights?\b\s+(?:a\s+|an\s+|the\s+)?(?:ongoing|continued|sustained|broader|growing|robust|significant|increasing)?\s*(?:trend|risks?|appetite|importance|interest|demand|need|shift|momentum|concerns?)\b",
    r"\bhighlighting\b\s+(?:a\s+|an\s+|the\s+)?(?:ongoing|continued|sustained|broader|growing|robust|significant)?\s*(?:trend|risks?|appetite|importance|interest|demand|need|shift|momentum|concerns?)\b",
]

# Category 4 — 'reflects [vague continuation]'
R_REFLECTS_VAGUE = [
    # Covers: "reflects continued investor confidence", "reflects a
    # prolonged conflict", "reflects a significant expansion", "reflects
    # sustained demand".
    r"\breflects?\b\s+(?:a\s+|an\s+|the\s+)?(?:continued|sustained|ongoing|broader|growing|robust|significant|prolonged|increased|strong|increasing)?\s*(?:appetite|interest|demand|confidence|conflict|trend|momentum|growth|expansion|resilience|strength|activity|commitment)\b",
    r"\breflecting\b\s+(?:a\s+|an\s+|the\s+)?(?:continued|sustained|ongoing|broader|growing|robust|significant|prolonged)?\s*(?:appetite|interest|demand|confidence|conflict|trend|momentum|growth|expansion|resilience)\b",
]

# Category 5 — 'demonstrates [vague positive]'
R_DEMONSTRATES_VAGUE = [
    r"\bdemonstrates?\b\s+(?:a\s+|an\s+|the\s+)?(?:strong|continued|sustained|broader|growing|robust|significant|increased)?\s*(?:capital\s+deployment|fundamentals?|appetite|interest|demand|confidence|resilience|strength|commitment|growth|momentum|leadership)\b",
    r"\bdemonstrating\b\s+(?:a\s+|an\s+|the\s+)?(?:strong|continued|sustained|broader|growing|robust|significant)?\s*(?:capital\s+deployment|fundamentals?|appetite|interest|demand|confidence|resilience|strength|commitment)\b",
]

# Category 6 — 'indicates [vague positive]'
R_INDICATES_VAGUE = [
    # Covers: "indicates robust private capital activity", "indicates
    # resilience", "could indicate broader economic headwinds".
    r"\b(?:indicates?|indicating)\b\s+(?:a\s+|an\s+|the\s+)?(?:strong|continued|sustained|broader|growing|robust|significant|private|increased)?\s*(?:capital\s+activity|private\s+capital|appetite|interest|demand|confidence|resilience|strength|headwinds?|trend|momentum|activity|growth)\b",
    r"\b(?:would|could|may|might)\s+indicate\b\s+(?:a\s+|an\s+|the\s+)?(?:strong|continued|sustained|broader|growing|robust|significant)?\s*(?:capital\s+activity|appetite|interest|demand|confidence|resilience|headwinds?|trend|momentum|growth)\b",
]

# Category 7 — "[X]'s strong/continued appetite for [Y]" (no data point)
R_APPETITE_UNQUANTIFIED = [
    # Apostrophe-s possessive + modifier + appetite. The "no named deal,
    # comp, or data point" condition cannot be decided by regex alone
    # (Section 7 limitation). Flags every instance; STRIP policy is
    # appropriate.
    r"\b\w+(?:'s|s')\s+(?:strong|continued|sustained|growing|robust|increased)\s+appetite\s+for\b",
]

# Category 8 — "[X]'s continued/sustained [adj] [noun]" (no data point)
R_CONTINUED_SUSTAINED_POSSESSIVE = [
    r"\b\w+(?:'s|s')\s+(?:continued|sustained)\s+\w+\s+(?:appetite|interest|demand|confidence|growth|expansion|activity|momentum|resilience|commitment|leadership)\b",
]

# Category 9 — Abstract sector-trend language
# Cannot be purely regex'd without prompting — flagged as soft/advisory.
# Paired with concrete-fact check (see Section 4 hybrid policy).
R_ABSTRACT_SECTOR = [
    # "sector's <adj> <noun>" without a preceding dollar figure in the
    # same sentence. Implementation as a sentence-level compound check
    # (regex for phrase + negative lookbehind for `\$[\d.]+`).
    # Captured in pseudocode Section 5 as `is_abstract_sector(sentence)`.
]

# Category 10 — Temporal filler
R_TEMPORAL_FILLER = [
    # "the ongoing", "the continued", "the sustained" — flag every
    # instance. Prompt says "without a specific timeframe or comp" — that
    # disambiguation is a sentence-level compound check, not pure regex.
    # Default: flag every instance, use STRIP clause if the sentence has
    # no adjacent digit-bearing token.
    r"\bthe\s+(?:ongoing|continued|sustained)\s+\w+\b",
]

# Category 11 — Impact filler without number
R_IMPACT_FILLER = [
    # "significant" / "substantial" / "major" with no digit in the same
    # sentence. Sentence-level compound check in pseudocode.
    r"\b(?:significant|substantial|major)\s+(?:appetite|interest|demand|confidence|expansion|growth|headwinds?|trend|risks?|momentum|commitment|spending|shift|activity|impact)\b",
]

ALL_PATTERNS = {
    "signals_vague":         R_SIGNALS_VAGUE,
    "underscores_vague":     R_UNDERSCORES_VAGUE,
    "highlights_vague":      R_HIGHLIGHTS_VAGUE,
    "reflects_vague":        R_REFLECTS_VAGUE,
    "demonstrates_vague":    R_DEMONSTRATES_VAGUE,
    "indicates_vague":       R_INDICATES_VAGUE,
    "appetite_unquantified": R_APPETITE_UNQUANTIFIED,
    "continued_sustained":   R_CONTINUED_SUSTAINED_POSSESSIVE,
    "temporal_filler":       R_TEMPORAL_FILLER,
    "impact_filler":         R_IMPACT_FILLER,
}
```

**Coverage check against the 10 observed 8pm PT examples:**

| # | Observed phrase | Matched by |
|---|---|---|
| 1 | "signals robust investor appetite" | `signals_vague` (bullet 1) |
| 2 | "underscores robust private market interest" | `underscores_vague` (bullet 1) |
| 3 | "reflects a significant expansion" | `reflects_vague` (bullet 1) |
| 4 | "would signal continued strong investor confidence" | `signals_vague` (bullet 2, `would signal`) |
| 5 | "signals private equity's interest" | `signals_vague` (bullet 1) |
| 6 | "signaling advancements in unmanned defense systems" | `signals_vague` (bullet 3, `signaling`) |
| 7 | "This signals strong market leadership" | `signals_vague` (bullet 1) |
| 8 | "This signals likely increased government defense spending" | `signals_vague` (bullet 1) |
| 9 | "would signal resilience in consumer spending" | `signals_vague` (bullet 2) |
| 10 | "could indicate broader economic headwinds" | `indicates_vague` (bullet 2, `could indicate`) |

10/10 coverage.

---

## Section 3 — Field inventory table

Source: `MORNING_SYSTEM` / `EVENING_SYSTEM` JSON schema (lines 127–161,
273–305) and persisted `briefings` row shape (lines 1306–1353 + extras).

| JSON path | Prose type | Typical length | Regen cost | Notes |
|---|---|---|---|---|
| `headline` | Short headline, structured | 10–15 words | Cheap (required field) | Explicit word-count gate already in prompt. PR #127 block not especially likely to bite here. |
| `lead_paragraph` | Free prose | 2–3 sentences, ~60–120 words | **Expensive** (forces whole-brief regen since lead is anchor) | High cliche risk: model narrates the primary_story here. |
| `supporting_context` | Free prose | 2–3 sentences, ~60–120 words | **Expensive** | Highest cliche risk observed tonight: 4+ of the 10 examples come from this slot. |
| `what_to_watch` (lead-level string at top of JSON) | Free prose | 1–3 sentences | **Expensive** (forward-looking is inherently speculative → cliche-bait) | Overlaps ID-wise with `sections.what_to_watch` / `sections.tomorrow_setup`; keep them distinct. |
| `summary` | Free prose, legacy | 3–4 sentences | Medium (derived from structured body, lines 1296–1304) | If structured body exists, `summary` is synthesized locally. Filter only when model wrote its own. |
| `market_pulse.sentiment_word` | Single adjective, whitelisted | 1 word | Cheap | Already lint-gated. Exempt. |
| `market_pulse.narrative` | Free prose | 2–3 short paragraphs, 120–200 words | **Expensive** | High cliche risk: tonight's 8pm brief had "signals private equity's appetite" here. |
| `market_pulse.headlines[].title` | Short phrase | 6–12 words | Cheap (per-chip) | Lower cliche risk; still scan. |
| `sections.deals_and_ma` | Free prose | 2–3 sentences | Medium (section-level) | "Patterns across multiple deals" wording is near-cliche-bait. |
| `sections.public_markets` | Free prose | 2–3 sentences | Medium | |
| `sections.macro_and_rates` | Free prose | 2–3 sentences | Medium | |
| `sections.geopolitics` | Free prose, optional | 2–3 sentences | Medium | Often omitted. |
| `sections.sector_spotlight` | Free prose | 2–3 sentences | Medium | |
| `sections.what_to_watch` (morning) | Free prose | 3–4 sentences | Medium | Morning-only. |
| `sections.tomorrow_setup` (evening) | Free prose | 3–4 sentences | Medium | Evening-only. |
| `top_deals[].one_liner` | One sentence OR literal `See lead.` | 1 sentence | Cheap (per-deal) | `See lead.` entries are exempt (already clamped at line 1282). |
| `top_deals[].company` / `deal_type` / `value` / `sentiment` | Structured | Enums / strings | Cheap | Exempt. |
| `sector_breakdown[KEY]` | Free prose | 2–3 sentences | Medium | Already has `_validate_sector_breakdown` post-processor; cliche filter is additive. |
| `primary_story_id` | Structured identifier | ~80 chars | Cheap | Exempt. |
| `market_tone` | Enum | 1 token | Cheap | Exempt. |
| `deal_flow.thesis` (written by `deal_extractor.py`) | Free prose | 1 sentence | Cheap (per-deal, separate Gemini call) | `gemini-2.0-flash`, 500 max tokens, independent of main brief. |

**Regeneration cost model:**
- **Cheap (per-item)**: per-`top_deals` entry, per `sector_breakdown` key,
  per `market_pulse.headlines` chip, per `deal_flow.thesis`. Swap-
  regenerate the offending item only; small token budget.
- **Medium (per-section)**: any `sections.*` value. Can be regenerated
  in-place with a targeted follow-up prompt, but harder to keep
  consistent with siblings.
- **Expensive (whole-brief)**: `lead_paragraph` / `supporting_context` /
  `what_to_watch` / `market_pulse.narrative`. These are tightly coupled
  to each other and to `primary_story_id`; regenerating one while
  keeping the others creates drift risk. Cost ≈ one full Gemini call
  (~3–5k tokens).

---

## Section 4 — Per-field-type policy

Two policies on the table:

- **REJECT (regenerate)**: detector raises, pipeline calls Gemini again
  with a follow-up prompt that quotes the offending sentence and asks
  for a rewrite. Up to N retries, then fall through to STRIP.
- **STRIP (remove clause)**: detector rewrites the field by deleting
  the offending sentence (or the comma-bounded clause containing the
  match). No second Gemini call.

Recommendation:

| Field group | Policy | Reasoning |
|---|---|---|
| `lead_paragraph`, `supporting_context`, `what_to_watch` (top-level) | **REJECT with single retry → STRIP fallback** | Lead block is the single most visible paragraph in the brief. A stripped sentence here is more visible than a regenerated one that restates the same fact concretely. One retry bounds cost; STRIP fallback prevents infinite loops. |
| `market_pulse.narrative` | **REJECT with single retry → STRIP fallback** | Same visibility argument. Two-paragraph structure gives the stripper something to fall back on (one paragraph still reads as a Market Pulse). |
| `sections.*` (medium fields) | **STRIP** | These are already bounded to 2–3 sentences. Removing one sentence still yields a coherent section. Cost of a Gemini retry across multiple sections quickly exceeds the per-brief budget. Section-level regen also risks the model re-introducing the same cliche. |
| `sector_breakdown[KEY]` | **STRIP, then drop-key if narrative shrinks under 20 chars** | `_validate_sector_breakdown` already drops short narratives (line 597). Reuse that threshold post-strip. |
| `top_deals[].one_liner` (when NOT `See lead.`) | **STRIP the clause; if the stripped result is < 15 chars, drop the one_liner and let the UI show the structured fields only** | Per-deal regen is cheap but one-liners are short and stripping usually leaves a usable bare fact. |
| `deal_flow.thesis` (deal_extractor) | **STRIP clause; if <10 chars remain, set to NULL** | `deal_flow.thesis` column is nullable; a null thesis is preferable to a cliche one. |
| `summary` (legacy) | **Skip detector entirely when `has_structured_body=True`** | Summary is derived locally from the structured body (lines 1296–1304), so it inherits the already-filtered content. Only run the detector on `summary` when model wrote its own (structured body missing). |
| `headline`, `market_pulse.sentiment_word`, enums | **Exempt** | Not prose. |

**Retry budget**: cap at 1 retry per REJECT field. Aggregate budget cap
per brief: max 2 retries total (i.e., if the first retry for
`lead_paragraph` STILL matches, no more retries; STRIP the second time).
Cost ceiling: 2 × ~4k tokens × `gemini-2.5-flash` ≈ ~$0.01/brief extra.

**Post-filter re-scan requirement**: after STRIP, re-run the regex on
the modified field. If it still matches (unlikely with sentence-level
strip, possible with clause-level strip on a compound sentence), drop
the entire field rather than ship half-stripped prose.

---

## Section 5 — Pseudocode of hook point, detection loop, regen/strip fork

### 5.1 Hook point

File: `backend/synthesize.py`
Function: `run(brief_type)`
Line range: **between line 1290 and line 1296** — i.e., immediately
after `filter_undisclosed_deals` and immediately before the structured-
body derived summary is computed.

Rationale:
- All Gemini parsing (lines 1237–1267) has already completed.
- `_validate_sector_breakdown` has run (line 1269), so invalid sector
  keys are already dropped — the filter only sees real prose.
- `see-lead` clamp has run (line 1282), so `See lead.` one-liners are
  set literally and the filter can exempt them trivially.
- `filter_undisclosed_deals` has run (line 1290), so the top_deals
  array is already at final shape.
- The derived `summary` (line 1302) is computed AFTER this hook point,
  so any strips on `lead_paragraph` / `supporting_context` /
  `what_to_watch` automatically propagate into `summary` — no
  double-scan needed.
- `briefings.insert` happens at line 1344 — the filter runs pre-persist,
  not post-persist, so no UPDATE is ever needed for the core brief.
- Watch out: `extract_and_persist_claims` (line 1373) and
  `generate_morning_review_for_evening` (line 1388) run after the
  insert; the claims extraction reads from `data.get("headline", "")`
  and `data.get("summary", "")`, so filtering BEFORE insert is fine.

### 5.2 Pseudocode

```python
# New module: backend/cliche_detector.py

def detect_cliches(text: str) -> list[dict]:
    """
    Returns list of {pattern_id, span: (start, end), match_text}.
    Pure regex; no LLM.
    """
    hits = []
    for pid, patterns in ALL_PATTERNS.items():
        for regex in patterns:
            for m in re.finditer(regex, text or "", re.IGNORECASE):
                hits.append({
                    "pattern_id": pid,
                    "span": (m.start(), m.end()),
                    "match_text": m.group(0),
                })
    return hits


def split_sentences(text: str) -> list[tuple[int, int, str]]:
    """Naive sentence splitter: period/question/exclam + whitespace.
    Returns list of (start, end, text).
    """
    ...


def strip_cliche_sentences(text: str) -> tuple[str, int]:
    """
    Sentence-level strip: drop any sentence whose text contains a
    cliche hit. Returns (new_text, n_stripped).
    """
    sents = split_sentences(text)
    keep = [
        s for s in sents
        if not detect_cliches(s[2])
    ]
    new = " ".join(s[2] for s in keep).strip()
    return new, len(sents) - len(keep)


def regenerate_field(
    system: str,
    user_content: str,
    field_name: str,
    offending_text: str,
    hits: list[dict],
    primary_story_id: str,
) -> str | None:
    """
    Targeted follow-up Gemini call asking the model to rewrite a
    single field. Returns new text or None on failure.

    Prompt template:
      "Your previous output for `{field_name}` violated the
       LANGUAGE CONSTRAINT in the system prompt. The offending
       construction was: '{match_text}' (category: {pattern_id}).
       The primary_story_id is '{primary_story_id}'. Rewrite this
       field ONLY — no JSON, just prose — per the LANGUAGE
       CONSTRAINT rules. If you cannot state a concrete fact,
       write a SHORTER bare-fact sentence or omit."
    """
    ...


# Integration in synthesize.py:run() between lines 1290 and 1296

# --- Cliche filter: REJECT-or-STRIP per-field policy ---
CLICHE_RETRY_BUDGET = 2
retries_used = 0
primary_story_id = (data.get("primary_story_id") or "").strip()

FIELD_POLICIES = [
    # (path, policy: "reject-then-strip" | "strip" | "strip-then-drop")
    (["lead_paragraph"],          "reject-then-strip"),
    (["supporting_context"],      "reject-then-strip"),
    (["what_to_watch"],           "reject-then-strip"),
    (["market_pulse", "narrative"], "reject-then-strip"),
    (["sections", "deals_and_ma"], "strip"),
    (["sections", "public_markets"], "strip"),
    (["sections", "macro_and_rates"], "strip"),
    (["sections", "geopolitics"], "strip"),
    (["sections", "sector_spotlight"], "strip"),
    (["sections", "what_to_watch"], "strip"),   # morning only
    (["sections", "tomorrow_setup"], "strip"),  # evening only
    # sector_breakdown: iterate dynamic keys, policy="strip-then-drop"
    # top_deals: iterate, apply "strip-on-one-liner"
]

for path, policy in FIELD_POLICIES:
    text = _get(data, path)
    if not isinstance(text, str) or not text.strip():
        continue
    hits = detect_cliches(text)
    if not hits:
        continue

    print(f"  🎯 cliche detected in {'.'.join(path)}: {len(hits)} hit(s)")

    if policy == "reject-then-strip" and retries_used < CLICHE_RETRY_BUDGET:
        new = regenerate_field(system, user_content, ".".join(path),
                               text, hits, primary_story_id)
        retries_used += 1
        if new and not detect_cliches(new):
            _set(data, path, new)
            continue
        # fall through to strip

    stripped, n = strip_cliche_sentences(text)
    # re-scan post-strip; if it still hits, drop the field.
    if detect_cliches(stripped):
        print(f"  ⚠ post-strip still hit in {'.'.join(path)} — dropping field")
        _unset(data, path)
    elif len(stripped) < 20:
        print(f"  ⚠ post-strip too short in {'.'.join(path)} — dropping field")
        _unset(data, path)
    else:
        _set(data, path, stripped)

# Dynamic-key fields:
for sector_key in list((data.get("sector_breakdown") or {}).keys()):
    narrative = data["sector_breakdown"][sector_key]
    if detect_cliches(narrative):
        stripped, _ = strip_cliche_sentences(narrative)
        if len(stripped) < 20 or detect_cliches(stripped):
            del data["sector_breakdown"][sector_key]
        else:
            data["sector_breakdown"][sector_key] = stripped

for deal in data.get("top_deals", []) or []:
    ol = deal.get("one_liner", "") or ""
    if ol.strip().lower().startswith("see lead"):
        continue  # See-lead exception
    if detect_cliches(ol):
        stripped, _ = strip_cliche_sentences(ol)
        deal["one_liner"] = stripped if len(stripped) >= 15 else ""

# --- end cliche filter ---
```

### 5.3 Parallel hook in `deal_extractor.py`

File: `backend/deal_extractor.py`
Function: `extract_deal()` (lines 118–139)
Hook point: immediately after `data = json.loads(raw)` (line 132), before
`return data`. Apply STRIP policy to `data["thesis"]`. If post-strip
length < 10 chars, set `data["thesis"] = None`.

### 5.4 Observability

Emit a structured log line per brief containing: `{brief_type, field,
pattern_id, match, action: retry|strip|drop}`. Consumer (future):
`brief_quality_scores` new column `cliche_actions` jsonb. Out of scope
for the weekend sprint per Noah's ambiguity-1 question below.

### 5.5 Update `critique.py` (recommended, cheap)

Add the PR #127 constructions to `critique.py:BANNED_PHRASES` or a new
`EMPTY_CALORIE_PATTERNS` list so the observational score reflects the
new rules. Independent of the filter; purely a metric gap close. ~5
lines. Not strictly part of Approach B but makes regression monitoring
meaningful.

---

## Section 6 — Weekend wall-clock estimate

Assuming Saturday-morning to Sunday-evening window, solo, no blocking
review:

| Task | Estimate |
|---|---|
| Create `backend/cliche_detector.py` with `ALL_PATTERNS`, `detect_cliches`, `split_sentences`, `strip_cliche_sentences` | 2–3 h |
| Write unit tests covering the 10 observed phrases + 5 false-positive guards (see Section 7) | 1–2 h |
| Integrate hook in `synthesize.py` (REJECT/STRIP fork, per-field policy table, logging) | 1.5–2 h |
| Add `regenerate_field` targeted Gemini call (system prompt variant, token budget) | 1–1.5 h |
| Integrate hook in `deal_extractor.py` (thesis STRIP) | 0.5 h |
| Update `critique.py` to count the new patterns (observability parity) | 0.5 h |
| Dry-run on 3–5 recent persisted briefs (fetch, pass text through detector, verify actions without re-persisting) | 1 h |
| Documentation + PR description | 0.5 h |

**Total: 8–11 hours of focused work.** Comfortable in a weekend; risk
comes from the regen prompt needing iteration (Section 7).

---

## Section 7 — Explicit limitations

1. **False positives on category 9 / 10 / 11** (Abstract sector-trend,
   Temporal filler, Impact filler): these bullets were specified in PR
   #127 as conditional ("without a specific timeframe or comp" /
   "without a specific number" / "when a specific deal, number, or
   named company is available in source material"). Pure regex cannot
   know whether the sentence *also* contains a concrete number — that
   requires sentence-scope parsing. Mitigation in the proposed impl:
   - Impact filler (`significant`/`substantial`/`major`): restrict
     regex to the cliche-adjacent nouns (`appetite`, `interest`,
     `demand`, `expansion`, etc.) rather than free `significant`. A
     phrase like "significant 30% revenue growth" won't match because
     "growth" is in the noun list — so this WILL false-positive. Accept
     it; the STRIP fallback will still leave a coherent sentence if
     the surrounding prose has other sentences.
   - Temporal filler (`the ongoing|continued|sustained`): flag every
     instance. This is aggressive but aligns with the prompt's
     absolute framing ("no escape clauses"). Real-world false
     positives: "the continued funding of X" in a factual report —
     accept the strip; analyst prose should rephrase as "funding of X
     continues, per Y".
   - Abstract sector-trend: intentionally NOT implemented as a regex
     pattern — deferred to the "hybrid" sentence-level check in
     pseudocode but marked optional. Highest false-positive risk.

2. **Regen loops**: a model that already leaked a cliche is at risk of
   leaking a different cliche on retry. Mitigation: cap `retries_used
   <= CLICHE_RETRY_BUDGET` per brief (proposed: 2), fall through to
   STRIP deterministically. If STRIP also fails the re-scan, drop the
   field.

3. **Cost**: worst case is 2 retry Gemini calls per brief × 4096 output
   tokens × gemini-2.5-flash. At current pricing, ≤ $0.02 extra per
   brief. Target volume ≈ 2 briefs × 365 days × $0.02 ≈ $15/yr.
   Negligible.

4. **Sentence splitting is naive**. Abbreviations ("U.S.", "Inc.",
   "$1.5B") break naive period-split. Mitigation: preload a small
   abbrev list and use a slightly smarter splitter, or accept that a
   mid-sentence strip is better than a 10+ cliche brief. Sentence
   splitting has been a solved problem (nltk, spaCy) but adding a new
   dependency for this one use case is overkill — hand-roll a 30-line
   splitter with an abbrev exception list.

5. **Case-insensitive matching may hit inside code/URLs**: harmless in
   practice because brief prose has neither, but defensive guard: skip
   matches inside `[A-Z0-9_-]{8,}` token runs (tickers, acronyms).

6. **Won't catch cliches outside the banned list**. Approach B is
   bounded by the PR #127 enumeration. If Gemini invents new vague
   phrases ("manifests broader dynamism"), the detector won't see
   them. Acceptable; Approach B is a defense-in-depth patch, not a
   full style checker.

7. **No effect on the two post-insert Gemini calls**. Claims
   extraction (line 1373) reads `data["headline"]` and
   `data["summary"]` — both of which *are* filtered pre-insert, so
   claims inherit the cleaned text. Evening morning-review
   (`generate_morning_review_for_evening`, line 388) reads graded
   calls from DB, not brief text — unaffected by the filter. No
   additional hook needed.

8. **`critique.py` measures what it measures**. If we don't
   simultaneously extend `critique.py:BANNED_PHRASES`, the
   `banned_phrase_hits` metric in `brief_quality_scores` will continue
   to undercount cliches even after Approach B is live. Recommend
   adding the PR #127 constructions to `critique.py` in the same PR.

---

## Section 8 — Open questions for Noah

1. **Observability scope**: do we want a new `cliche_actions` column
   on `brief_quality_scores` (jsonb array of per-field actions), or is
   a stdout log line sufficient for weekend-sprint scope? Default if
   unanswered: stdout only, defer the column to a follow-up PR.

2. **Should `market_pulse.headlines[].title` be scanned?** Per-chip
   prose is short (6–12 words) and cliche risk is lower, but we have
   seen "signals private equity's appetite for" in narrative-adjacent
   chips. Default if unanswered: YES, scan them with STRIP-or-drop
   (drop the chip if the strip would empty the title).

3. **Retry budget**: proposed 2 retries/brief. Too lean? Too generous?
   Default: 2.

4. **Do we update `critique.py:BANNED_PHRASES` in the same PR as
   Approach B, or keep them separate?** Default if unanswered: same
   PR — it's a 5-line observability parity change.

5. **Approach-B gating vs Approach-A fix**: if Recon 2 or 3 finds
   evidence that a small prompt tweak would restore #127 efficacy
   (e.g., moving the block earlier, making it a final directive,
   adding it to the JSON schema instructions rather than a
   stand-alone section), should we de-scope Approach B entirely, or
   ship both? Default if unanswered: ship Approach B regardless;
   prompt discipline on `gemini-2.5-flash` at `temperature=0.3` is
   inherently probabilistic and a deterministic filter has standalone
   value.

---

*End of spec.*
