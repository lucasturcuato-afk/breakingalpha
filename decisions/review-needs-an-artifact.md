# A review that never saw a commit does not discharge the build review

Date: 2026-09-03
Ruled by: Noah

**No PR reaches "shipped" without at least one independent review that names the
head SHA it read.** A reviewer dispatched against a spec produces a spec critique.
That is worth doing and it is a different deliverable, it is labelled as such, and
it does not count.

## Why

The 2026-09-03 sprint ran a concurrent review layer, one reviewer per build track,
dispatched at the same time as the builder. Then it ran a separate adversarial pass
after the builds, four fresh agents who had neither built nor reviewed. The results
separate cleanly, and not along the axis anyone expected.

### The determinant is whether the reviewer had an artifact

| PR | concurrent reviewer had a build? | blocking defects found concurrently | blocking defects found adversarially |
|---|---|---|---|
| **#806** ADV / 13F | **yes**, it rendered 21 pages in real Chromium | **3** | **2 more** |
| **#811** tag repair | no, it closed before the build | 0 on the build | 1 (circular refusal), 8 items held |
| **#812** CIK linkage | no, it closed before the build | 0 on the build | 4, including one wrong company |
| **#813** registry union | no, it reviewed **its own reconstruction** | 0 on the build | 2 blocking plus the proofs-cannot-fail finding |
| **#814** Wikipedia identity | no, it reviewed the spec | 0 on the build | 1 critical plus 5 more |

**Reviews with an artifact: 5 dispatched, 5 found blocking defects. Reviews without
one: 4 dispatched, 0 found a defect in shipped code.** The concurrent layer is not
weaker than the adversarial layer. Review C was concurrent, had a build, rendered
the pages, and produced the strongest single finding of the sprint before the
adversarial pass existed.

Two PRs, **#813 and #814, reached "shipped" state with zero independent review of
the build**, and both builders said so in their own reports rather than letting it
pass. #813 shipped a "newly wrong: ZERO" headline with no independent check, which
is exactly the suspiciously clean result a review exists to attack.

### What only the adversarial pass found

Listed because "the review layer found things" is not a measurement.

- **#812**: `First Bank and Trust` stamped to CIK 1746109, which EDGAR says is
  `BANK FIRST CORP` of Manitowoc WI. Token-set equal with the order reversed,
  surviving because `trust` is in `_WEAK`. **43 more of the 411 stamp a depositary
  registrant rather than an issuer** (PR said 34). The generator is not in the PR,
  so the four guards protecting the 411 exist nowhere in the repo and the file is
  unreproducible. Line 74 is a client meta-command that is a syntax error in the
  Supabase editor.
- **#813**: `/company/instagram` renders Meta's filings, Form 4 rows and XBRL under
  the heading "Instagram". `/company/agi` regresses from a populated Financials tab
  to an empty one. Six one-word union keys are another listed registrant's ticker
  and the one-word contest gate has no ticker check at all. P1 and P1b are
  construction identities that cannot return non-zero.
- **#814**: the verbatim gate is a tautology. Four `tsc`-clean routes to the DOM
  bypass the brand. The laundering path is live and proved at runtime. S4 recall
  costs 10.1 percent, not the claimed 0.4, blocking OpenAI, National Australia
  Bank, Bugatti and Fiduciary Trust. 38 of 70 terms never fire on 162 fresh pages.
- **#806 and the headline**: `adviser-registry.ts:173` keeps
  `primary_business_name` and discards `legal_name`, so 119 of 380 rendering
  figures discard a different legal name, 66 of them on a no-caveat tier. Both
  tables #806 depends on return 404 in prod, so **it renders nothing today** and
  every number it claims is contingent on an unapplied migration.

### The counter-evidence, which is the part worth keeping

An agent that reports "I could not break this, here is what I tried" is producing
real information, and four of them did.

- **#812 first-match-wins: held.** Track A refuses on ambiguity rather than
  ranking. Recomputed independently against SEC `company_tickers.json` (10,391
  entries, 8,001 distinct listed CIKs): **rows with more than one admissible listed
  CIK, zero**. The reviewer bounded its own claim to the 8,001-CIK half and named
  the 12 rows outside it.
- **#812 the `_WEAK` set: the pair was found and the guard held.** `E.ON` and
  `On Holding AG` both reduce to `{on}` and `names_agree` returns True. Guard E,
  leading-initials parity, eliminates it: `lead_init('E.ON') = ['e']` against `[]`.
- **#812 reversibility: held.** All 411 UPDATEs carry `AND sec_cik IS NULL`, so the
  prior value is NULL by construction and the rollback is a true inverse. The
  reviewer states plainly that it tried to make this a data-loss finding and could
  not.
- **#814 repair-off: held.** No env var, no default argument, one call site behind
  `if args.repair:` with `action="store_true"`. Confirmed by grep.
- **#814 the 46: held on independent re-adjudication.** The reviewer rebuilt the
  120-row selection deterministically, got byte-identical verdicts including both
  holds, hand-adjudicated all 46 and **agreed with the build on all 46**. It then
  corrected the framing rather than the count, which is better work than either
  agreeing or disagreeing.
- **#811 over-reach: held.** All 465 removals tested against an independent title
  test with the 10 edge cases hand-read. **0 correct tags removed.**
- **Track F's counterexamples do not apply to Track E: held, structurally.**
  `strongKey` is an ordered space-joined string with exact map lookup, so
  `{A,B,C} == {A,C,B}` has no representation. The reviewer then went past the two
  literals and checked all 815 unchecked multi-word keys, found 69 reachable from a
  real typed name, and found **every rival in all 69 unlisted**, so the
  listed-only scope lands them correctly.
- **Two reviewers built a degenerate metric, recognised it, and discarded it
  unprompted.** One scanned 774 CIK-bearing rows and got "41 Vanguard-pattern rows,
  5.3%", called it garbage itself because it fails open on every ticker-named row,
  and did not report it as a finding. The other built the naive title test, saw
  "86.3% of shielded tags are wrong", recognised that `RTX -> Raytheon` and
  `GM -> General Motors` fail it correctly, and reported the honest 2.1 percent
  instead.

## What would change the answer

**Nothing about the SHA requirement.** It is one line in a dispatch brief and the
evidence for it is 0 for 4.

**The ordering changes.** Concurrent dispatch was not the error; dispatching a
reviewer against nothing was. Two changes follow:

1. **A review brief carries a head SHA or it is not a review brief.** If the
   branch has no commits yet, the reviewer waits or is redispatched. Polling four
   times and then reviewing a reconstruction, as happened on #813, produces a
   report about an artifact nobody built.
2. **Spec critique moves before the build, not alongside it.** The spec critique
   of #814's guard correctly found that Wikidata subclasses `administrative
   territorial entity` under `organization`, so every town and commune passes a
   `P31/P279* Q43229` check. The builder rediscovered the identical fact
   independently, from `Needham, Massachusetts` passing its reachability test, and
   burned 157 Wikimedia requests on a harness bug along the way. That critique was
   worth having and it arrived too late to save the rediscovery.

**The adversarial pass stays.** It found things the concurrent layer would not
have, because it was adversarially framed rather than because it ran later: the
tautology, the construction identities, the circular refusal. Those are attacks on
the *argument*, not on the code, and they need someone whose job is to disbelieve.
