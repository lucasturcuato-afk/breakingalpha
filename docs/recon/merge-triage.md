# Merge triage: PRs #446, #444, #443

Read-only triage against current `origin/main` = `6f42cff9`. Scope is strictly
these three PRs and what blocks merging them. No edits, merges, or flag changes.

Caveat: this is git + source triage. Each PR's hard preflight gate (tsc / lint /
`npm run build` on the merge preview) is the final pre-merge check and was not
re-run here; the merge-cleanliness and additive/off-flag analysis below is what
decides the verdict.

## Top summary

| PR | Merge state vs main | Verdict | The one blocker / next action |
|---|---|---|---|
| #446 cik-resolve-by-name | 33 behind, **clean** | **MERGE TODAY** | preflight build on merge preview, then squash-merge |
| #444 story_items persist | 34 behind, **CONFLICT** | **REBASE-FIRST** | rebase synthesize.py onto main, re-confirm off-flag byte-identical |
| #443 financials commentary | 34 behind, **clean** | **MERGE TODAY (flag-off)** | ships dormant; flag-on is gated on a real-Gemini eval |

Merge today: **#446 and #443** (both clean, #443 dormant behind a default-off
flag). Needs a rebase: **#444** (real synthesize.py conflict). Needs the eval
before flag-on (not before merge): **#443**.

---

## #446 - fix/cik-resolve-by-name (CIK resolution by full name)

- **Behind main / conflict?** 33 behind, 1 ahead. `git merge-tree` = **clean, no
  conflict.** main has NOT touched `sec-filings.ts`, `company-intel.ts`, or the
  thin-fallback route since the branch base (verified via `git log base..main --
  <files>` = empty), so no resolveCompanyCik caller or entity-resolver change on
  main re-broke it.
- **Fix intact on the branch?** Resolution order is exactly
  `id -> ticker -> name(raw+canon, preferCik) -> alias(preferCik) -> fallback`:
  ```
  1. exact id
  2. exact ticker  -> pickPreferCik, return if sec_cik != null
  3. exact name (raw AND canonicalized) -> matchCompaniesByName -> pickPreferCik
  4. alias -> matchCompaniesByAlias(aliasKey raw+canon) -> pickPreferCik
  5. best non-CIK fallback (name/companyId still set -> honest Tier C)
  ```
  Nothing merged since re-broke it (files untouched on main).
- **IBM CANONICAL entry.** Present on the branch (`ibm`, `international business
  machines`[ + `corp`/`corporation`] -> `"IBM"`). Merging now ships CORRECT
  behavior for all tested cases: AMD full name -> cik 2488, Unum Group -> 5513,
  IBM legal name -> 51143, ASML Holding -> 937966 (all Tier A). The name-map
  entry is an acceptable-with-followup data patch (the durable fix is an alias /
  dedup backfill), **not a merge-blocker** - it is additive and idiomatic
  (mirrors the existing `"google llc" -> "Alphabet"`).

**Verdict: MERGE.** Clean merge, resolver order intact, all four tested cases
correct; IBM name-map is a documented follow-up, not a blocker.
**Next action:** run preflight build on the merge preview, then squash-merge.

---

## #444 - feat/story-items-persist (backend/synthesize.py, Move 1)

- **Behind main / conflict?** 34 behind, 1 ahead. `git merge-tree` = **CONFLICT**
  (matches GitHub `DIRTY`). The single changed file `backend/synthesize.py` was
  reworked by ~10 brief/pulse/lead commits on main since the branch base
  (LEAD_V2 #477, macro #476/#478, ranker #473, pulse v2 #455/#463/#468, opener
  guard #474...), and the PR edits the insert / candidate-ladder region those
  commits also changed. **Rebase required.**
- **What +124/-1 does / off-flag safety.** Adds `PERSONALIZATION_MODE`
  (off | shadow | active, default **off**). It builds a `story_items` jsonb
  payload from the ALREADY-SELECTED spine/floor (`_build_story_items`), resolving
  entity names -> tickers via one batched `companies` SELECT
  (`_resolve_tickers_for_names`). It reads only in-memory data synthesize already
  computed: no corpus re-query, no re-rank, no prose/lead/selection change, and
  it fails open (any error -> not written, brief unaffected). Off-flag path AS
  WRITTEN is **byte-identical**: `_story_items = None` when off, so the guard
  `if extras or _story_items is not None:` collapses to the original
  `if extras:`, and the new `if _story_items is not None:` candidate is skipped -
  the served brief is unchanged. Truly additive + flag-gated + fails open.
- **"Move 1" still coherent?** The intent (persist the selected set for a later
  read-side re-rank) is still coherent, but it presupposes the exact
  insert-candidate-ladder + spine/floor structure that main has since evolved.
  The off-flag byte-identical property must be **re-confirmed after the rebase**,
  because the conflict is precisely in that insert region.

**Verdict: REBASE-FIRST.** Real synthesize.py conflict; the off-flag logic is
sound but sits in the region main churned, so it cannot land as-is.
**Next action:** rebase onto current main, then re-verify the off-flag insert
path is byte-identical (diff the `if extras ...:` block) before re-review.

---

## #443 - feat/financials-commentary (XBRL commentary, default-OFF)

- **Behind main / conflict?** 34 behind, 1 ahead. `git merge-tree` = **clean.**
  11 files, additive; touches `FinancialsTab.tsx` (+15) and `company/[id]/page.tsx`
  (+13) but both are gated (below).
- **Off-flag safety.** Flag `FINANCIALS_COMMENTARY_ENABLED` (server env, NOT
  `NEXT_PUBLIC`). Route: `if (!enabled) return 503`. page.tsx reads
  `process.env.FINANCIALS_COMMENTARY_ENABLED === "true"` and passes
  `commentaryEnabled`; `FinancialsTab` defaults it to `false` and renders
  `<FinancialsCommentary>` only when `commentaryEnabled && companyName`. Default
  off => control never mounts, route never called => FinancialsTab render is
  unchanged from today. Safe to merge dormant.
- **Compliance filter intact?** Yes: two-layer (prompt + post-generation backstop
  `filterComplianceLanguage`), `compliance-language-filter.ts` (~195 lines) +
  `compliance-language-filter.test.ts` (7 tests) present in the diff.
- **The one blocker to a flag-ON decision.** Still exactly one: **no real
  gemini-2.5-flash output has been generated** (prod key masked locally). The
  verify harness needs a real key. Command:
  ```
  npx tsx --env-file=.env.local --env-file=.env.vercel scripts/verify-financials-commentary.mts
  ```
  What Noah needs: a real `GEMINI_API_KEY` in `.env.local` (Supabase URL +
  service/anon key are already used by the script). It pulls real XBRL, builds
  the shipped prompt, generates real commentary, and runs the compliance filter
  over both the output and planted prohibited phrasings.

**Verdict: MERGE (flag-off) is safe NOW = YES.** Flag-on is gated on the eval =
YES (nothing else blocks it).
**Next action to merge:** preflight build + squash-merge; it ships dormant.
**Next action for flag-on:** Noah runs the verify script with a real GEMINI key,
review the real output + compliance stripping, then flip the flag.
