# Merge RE-triage: PRs #446, #444, #443 (against current main)

Current `origin/main` = **`ae7ae2c7`** (feat(landing) #496). This SUPERSEDES the
`#479` triage doc, which was written against `6f42cff9` (many PRs have merged
since). Read-only; every verdict below is backed by a real `git merge-tree`
against `ae7ae2c7` and a `git log base..main -- <PR files>` staleness check.

## Top summary

| PR | vs main | merge-tree | main touched its files? | Verdict |
|---|---|---|---|---|
| #446 cik-resolve-by-name | 50 behind | **CLEAN** | No | **MERGE TODAY** (strip recon scratch) |
| #444 story_items persist | 51 behind | **CONFLICT** (synthesize.py) | Yes, ~20 commits | **CONFLICT-BLOCKED / REBASE-FIRST** |
| #443 financials commentary | 51 behind | **CLEAN** | Yes, 1 commit (#449, non-conflicting) | **MERGE TODAY (flag-off)** |

Can merge today: **#446 and #443**. Needs a rebase: **#444**.

---

## #446 - fix/cik-resolve-by-name

- **merge-tree vs `ae7ae2c7`: CLEAN.** 50 behind, 1 ahead; merge-base `98ccce83`.
- **Staleness check:** `git log 98ccce83..ae7ae2c7 -- src/lib/sec-filings.ts
  src/lib/company-intel.ts src/app/api/companies/thin-fallback/route.ts` =
  **EMPTY**. main has NOT touched the resolver, the CANONICAL map, or the
  thin-fallback route since base. The prior "clean" verdict HOLDS unchanged; no
  merge re-broke the `id -> ticker -> name -> alias -> preferCik` order.
- **Scratch files:** the PR still carries `recon/verify.ts` and `recon/verify2.ts`
  (read-only harnesses, not product code). Flag as **strip-before-merge** (or
  keep intentionally); they do not affect build but are dev scratch.

**Verdict: MERGE TODAY.** Clean, files untouched on main, resolver intact.
**Next action:** strip `recon/verify.ts` + `recon/verify2.ts`, preflight build, squash-merge.

---

## #444 - feat/story-items-persist (backend/synthesize.py)

- **merge-tree vs `ae7ae2c7`: CONFLICT** - `CONFLICT (content): Merge conflict in
  backend/synthesize.py` (the single changed file). 51 behind; merge-base `4934216b`.
- **Staleness check / conflict deepened:** since `6f42cff9`, main added ~8 MORE
  synthesize.py commits on top of the earlier set: #495, #494, #493, #491, #486,
  #481, #480, #483 (pulse fallback, lead PT-bar, evening routing, unified lead,
  macro-basis labels...). The conflict is broader than at the last triage, not
  narrower.
- **Off-flag property:** the `PERSONALIZATION_MODE=off` -> served-brief-unchanged
  (byte-identical) property was true on the branch AS WRITTEN, but it lives in
  the exact insert/candidate-ladder region main rewrote. It is **re-checkable
  ONLY after the rebase** - do not assert it against the current branch.

**Verdict: CONFLICT-BLOCKED / REBASE-FIRST.** Real synthesize.py conflict,
deepened by this week's brief/pulse/lead merges.
**Next action:** rebase synthesize.py onto `ae7ae2c7`, then re-verify the
off-flag insert path is byte-identical before re-review.

---

## #443 - feat/financials-commentary (CRITICAL re-check)

- **merge-tree vs `ae7ae2c7`: CLEAN.** 51 behind; merge-base `4934216b`.
- **Did main touch this PR's Company Intel files?** YES - one commit:
  `b270426c feat(design): visual identity ... de-texture sweep (#449)`. It touched
  **`FinancialsTab.tsx` only (2 insertions / 2 deletions, a styling change)**. It
  did NOT touch `company/[id]/page.tsx` or `FinancialsCommentary.tsx`. So the
  earlier belief that Company Intel was untouched is slightly wrong - #449 lightly
  restyled FinancialsTab - but the hunks do not overlap the PR's added gate, so
  the auto-merge is clean.
- **Off-flag safety verified in the ACTUAL merged tree** (not just the branch).
  Merged `FinancialsTab.tsx`:
  ```
  99:  commentaryEnabled = false,                       // default OFF
  309:  {commentaryEnabled && companyName && (
  310:    <FinancialsCommentary companyName={companyName} enabled={commentaryEnabled} />
  ```
  Merged `company/[id]/page.tsx`:
  ```
  162:  const financialsCommentaryEnabled = process.env.FINANCIALS_COMMENTARY_ENABLED === "true";
  216:  commentaryEnabled={financialsCommentaryEnabled}
  ```
  Flag off (default) => `commentaryEnabled=false` => the control never mounts and
  `POST /api/financials-commentary` is never called (route also 503s server-side).
  Off-flag safety is **INTACT** after merging with #449.

**Verdict: MERGE TODAY (flag-off).** Clean auto-merge; #449's restyle does not
conflict and the off-flag gate survives in the merged tree.
**Next action:** preflight build on the merge preview, squash-merge (ships
dormant). Flag-ON remains gated on the real gemini-2.5-flash eval (unchanged;
out of scope for this triage).

---

VERIFY: current main `ae7ae2c7` != `6f42cff9` (confirmed). Each verdict backed by
a real `merge-tree` against `ae7ae2c7` and a `log base..main -- <files>` list. No
edits, merges, rebases, or flag changes. The `#479` doc is superseded by this one.
