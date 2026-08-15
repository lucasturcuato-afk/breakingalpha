# Rulings on the nine open decisions

Noah ruled all nine on 2026-08-15. This file is the record. The design handoff
at `design_handoff_signalera_mobile/README.md` states the conflicts; this states
what won.

## How to read the "Build step" column

Build step numbers refer to **`design_handoff_signalera_mobile/IMPLEMENTATION_PROMPT.md`
lines 101 to 116, "Order to build in"**, which is the authoritative sequence:

| Step | Surface |
|---|---|
| 1 | Navigation shell |
| 2 | Ledger, the home surface and the anatomy every other card reuses |
| 3 | Commit sheet |
| 4 | Review |
| 5 | Dashboard |
| 6 | Claim, Entry, Prepared record |
| 7 | Evening Wrap, Compose, Desk record |
| 8 | Watch, Thesis Tracker, Thesis detail |
| 9 | Ask, Search, Company Intel, Memo |
| 10 | Deal Flow, Deal detail, Trends, Signal, Live Feed, Story |
| 11 | Landing, Onboarding, Sign in |
| 12 | Settings, Alerts, Saved, Learned, Share |

An earlier draft of these rulings used a separate eight-batch grouping. Those
numbers are dropped. Every ruling below is re-mapped to the list above. Where a
ruling names no step, the work sits off the mobile build path entirely.

## The rulings

| # | Ruling | Build step | Ships as |
|---|---|---|---|
| 1 | cross-source rate and Right/wrong. **Fix.** Counts stay, the rate goes, `n_correct`/`n_wrong` become supported/challenged. | Off the build path. `/cross-source` has no mobile counterpart (README Gaps item 1). | Two PRs. First: frontend labels and the accuracy/Wilson removal, DB columns untouched, no migration. Second: the column rename with the migration file included and **unapplied**, for Noah to decide whether to run. Both after ruling 8 and the copy swaps. |
| 2 | EVIDENCE SUPPORTED 71.4%. **Remove.** In-repo at `src/components/landing/opening-screen.tsx`, not a marketing deploy. | Step 11 surface (Landing), but **not gated on it**. Ruled to ship now. | Queued, own PR. |
| 3 | Landing headline. **Adopt** "We track which calls the evidence supports." | Step 11 surface (Landing), shipping now against current prod. | Copy PR. |
| 4 | heroPara. **Adopt** "the calls the evidence ran against." | Step 11 surface (Landing), shipping now against current prod. | Copy PR. |
| 5 | Role labels. **Adopt** Fund Analyst / Equity Research. Ids unchanged, so no migration and no backfill. All three sites, including `PreferencesForm.tsx`, which no design doc tracks. | Steps 11 (Onboarding) and 12 (Settings), shipping now against current prod. | Copy PR. |
| 6 | RIA description. **Adopt** "Managing client capital", matching the string already live in `OnboardingWizard.tsx`. | Step 12 surface (Settings), shipping now against current prod. | Copy PR. |
| 7a | Risk appetite UI. **Not ported.** The design wins. | Steps 11 (Onboarding) and 12 (Settings), but **not gated on them**. Ruled to ship now. | Queued, own PR. |
| 7b | Risk appetite consumers. Removal from the prompt builders, the API, the Python pipeline and the DB column is **its own workstream**. Does not gate the redesign. | Off the build path. | Not scheduled. 19 consumers mapped in recon. |
| 8 | SIGNAL scores. **Stay.** Not a compliance issue. It is a relevance score, not an accuracy figure. Relevance ranking is editorial judgment, not a claim about accuracy, so it does not fall under the compliance rule. | **Lands on step 2, the Ledger card**, not the nav shell. The Ledger is the anatomy every other card reuses, so the design needs a slot for the badge before that card is written. Also touches steps 5, 9 and 10. | No production change. The design carries the deviation, not the code. |
| 9 | cross-source palette. **Retoken.** One file, no shared surface. | Off the build path, same route as ruling 1. | Queued, own PR. |

## Standing constraints

- Not every number is a claim. A relevance score orders what to read first. An
  accuracy figure asserts how often the product was right. Only the second is a
  compliance question, which is why ruling 8 landed where it did.
- The prototype's story anatomy is "a sentiment pill, the ticker, the sector,
  and source with elapsed time on one line", with no slot for the badge. Under
  ruling 8 that is now a **deviation from production, not the target**. Flagged
  as an open item in `design_handoff_signalera_mobile/github.md` and
  deliberately unresolved. The badge has to survive the rebuild, so the design
  owes a slot for it before the Ledger card is written.
- Ruling 1's column rename is a migration. Per `CLAUDE.md`, agents do not apply
  migrations. That PR ships with the migration written and unapplied.
- Ruling 1's column rename is a migration. Per `CLAUDE.md`, agents do not apply
  migrations. That PR ships with the migration written and unapplied.

## Order of work

1. ~~Ruling 8, remove the SIGNAL badge.~~ **Reversed.** The badge stays. The
   PR that removed it was closed unmerged and nothing shipped. What is left is
   a design deviation to resolve, not code to write.
2. Rulings 3, 4, 5, 6, the copy adoptions.
3. Ruling 1, frontend only.
4. Ruling 9, the retoken.
5. Ruling 1 follow-up, the column rename with an unapplied migration.
6. Rulings 2 and 7a, both ruled to ship now rather than wait for a step.
7. Ruling 7b, unscheduled.

## Revisions

Ruling 8 was first recorded as "remove the numeric badge from all five
surfaces" and implemented. It was reversed before merge: a SIGNAL score is a
relevance score, not an accuracy figure, and the compliance rule reaches claims
about accuracy rather than editorial ranking. The removal PR was closed
unmerged. Every other ruling, and both build-order corrections above, stand as
originally recorded.
