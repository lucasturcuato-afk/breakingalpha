# A check whose two sides share a writer is not a check, and a guard applied at one of two paths guards neither

Date: 2026-09-03
Ruled by: Noah

**Every predicate that decides whether a fact is true carries a two-column table
naming each side and the write path that produced it.** A PR that claims a guard,
a matcher, a pillar or a coverage number does not merge without it. Four refusals
follow from the table, and any one of them fails the PR.

## Why

The 2026-09-03 build sprint found the same defect shape in six independent places,
across three languages, in code written by six different authors, all of it passing
its own tests. Every instance is a claim checked by an expression whose two sides
are not independent.

### The six instances

| # | site | the two sides | why the check is empty |
|---|---|---|---|
| 1 | `src/lib/company-intel.ts:646-652` on `main`, and the byte-identical inlined copies at `:990-1000` and `:677-683` | `canonicalize(rawName)` vs `canonicalName` raw | the same fact under two different normalizations. The predicate is **false for a string against itself** |
| 2 | `src/lib/data-access/aliasResolver.ts:203` vs `registryResolution` at `src/lib/sec-filings.ts:218-234`, branch `track-e/registry-union` | page heading vs the three pillar tabs | two paths compute "which company is this page about". `rowMatchesRegistrant` runs on one |
| 3 | `backend/scripts/backfill_wikipedia_identity.py:261`, branch `track-d/wikipedia-identity` | `assert_verbatim(result.paragraph, result.paragraph)` | the same expression on both sides. Containment against itself is a tautology |
| 4 | `tools/repair_ticker_fold_tags.py:405-406`, branch `track-b/article-tag-repair` | `ticker_of_name[n] == p` | `companies.ticker` is read as proof the stamp was right, and that field **is** the surface under test |
| 5 | `tg-scratch/score.py:100-107`, the original pillar scorer | `numbers_from_ids` and `identity_from_ids` both open `if ticker: return True` | one boolean scored two pillars presented as independent |
| 6 | `src/lib/registry-union/resolve.test.ts:24-46`, branch `track-e/registry-union` | `strongKey(entity_name)` vs the key, which `build_index.py:63-72` **defines** as `strong_key(name)` | the test compares a value to its own definition |

### What each one cost, measured

1. **100 percent blackout, not a partial one.** `canonicalize("SoFi Technologies")`
   is `"SoFi"`, four characters, under the five-character prefix floor. All 486
   prod articles carrying a SoFi tag are rejected, including the 469 tagged with
   the exact `companies.name` string. 12 of 12 names tested cannot match
   themselves: `Google -> Alphabet`, `International Business Machines -> IBM`,
   `ORCL -> Oracle`, `Facebook -> Meta`, `Visa Inc. -> Visa`,
   `Meta Platforms Inc -> Meta`, `COIN -> Coinbase`, `News Corp -> News`,
   `CBRE Group -> CBRE`, `Coty Inc. -> Coty`, `RELX plc -> RELX`,
   `SoFi Technologies -> SoFi`. 33 resolver heads are structurally blacked out,
   10 of them reader-visible today. Live in production on `main`.
2. **`/company/instagram` renders Meta Platforms' filings, Form 4 rows and
   validated XBRL under the heading "Instagram".** The PR's own guard returns
   `rowMatchesRegistrant("Instagram", "Meta Platforms, Inc.") == false`. It is
   applied at the heading path and not at the tab path.
3. **The gate accepts a 40-character truncation, a full model rewrite, an NFD
   normalisation and an NBSP collapse.** Only three properties survive: non-empty,
   no edge whitespace, no trailing ellipsis. The whole module exists to enforce a
   licence condition and it enforces none of it.
4. **~175 tags across 14 rows are spared by a refusal reading our own error as
   ground truth.** Tested non-circularly against the SEC's own
   `company_tickers.json` plus hand adjudication: `COHR -> Cohere`,
   `PAYX -> YC`, `NOVT -> Vanta`, `GHY -> PGIM`, and 10 more.
5. **"Worth reading" was arithmetically "the landing row has a ticker string",
   plus three.** 306 rows with a ticker, 309 worth, has-ticker-but-not-worth zero.
   Three separate "findings" were restatements of that one line of code.
6. **0 of 7,685 strong keys and 0 of 1,282 one-word keys can violate the
   property.** Not "zero violations found". Zero possible.

### The rule, as something a reviewer applies in five minutes

For each predicate, write two lines:

```
side A: <expression>   <- written by <path / table.column / API response>
side B: <expression>   <- written by <path / table.column / API response>
```

Then refuse on any of four conditions.

- **Same writer on both sides.** The error vouches for itself. Instances 4 and 5.
- **Same expression on both sides.** Tautology. Instance 3, and instance 6 where
  the identity is one indirection away through a build script.
- **Same underlying fact, one side normalized and the other not.** The check
  cannot succeed on exactly the class of inputs where the normalizer moves the
  value, and no fixture notices, because fixtures are written pre-normalized.
  Instance 1.
- **More than one code path computes this fact, and the three refusals above were
  checked on one of them.** The unguarded path is the one the product runs.
  Instance 2, and instance 1 again, where the same predicate body was hand-inlined
  three times so that fixing the exported copy changes nothing.

A green test suite is not evidence against any of the four. In instance 3 the
tests call `assert_verbatim(para[:80], para)` correctly
(`backend/tests/test_wikipedia_identity.py:241,244`) while the single production
call site passes the same value twice. **The suite passes and proves nothing about
production.** In instance 4 the branch is covered by a passing assertion at
`tools/tests/test_repair_ticker_fold_tags.py:140`; coverage was never the problem.

### The automatable half

Four checks. None catches all six, and the split is worth stating so nobody
mistakes the tooling for the rule.

**C1. Same-argument call detector. Catches instance 3.**
Python, `ast` module, ~40 lines, run over `backend/`, `tools/`, `scripts/`:
flag any `ast.Call` with two or more positional args where
`ast.dump(node.args[i]) == ast.dump(node.args[j])` for any `i != j`, and the
callee name matches `^(assert|expect|require|check|verify|ensure)_` or ends in
`_agree|_matches|_equals`. TypeScript equivalent: an ESLint rule comparing
`sourceCode.getText(argA) === sourceCode.getText(argB)` on the same callee set.
Exempt `**/tests/**` and `*.test.ts`, where reflexivity assertions are legitimate.
`assert_verbatim(result.paragraph, result.paragraph)` is a literal hit.

**C2. Asymmetric-normalization detector. Catches instance 1.**
Declare the normalizer set in one place: `canonicalize`, `normalize`,
`normalize_tokens`, `strongKey`, `weakKey`, `core_tokens`, `_tokens`, `slugify`,
`lookup_key`, `strip_marker`. Flag any binary comparison (`===`, `==`,
`.startsWith`, `.includes`, `in`) where one operand's expression tree contains a
call from that set and the other's does not. Suppression requires an explicit
`// asymmetric-by-design: <reason>` on the line, which is the point: the asymmetry
becomes a thing someone had to write down. All three branches of `matchesCanonical`
trip it.

**C3. Guard call-site coverage. Catches instance 2.**
For every exported function whose name matches
`/(Matches|Agree|Guard|Verify|Reject)/` in `src/lib/**`, enumerate non-test call
sites with `git grep -n`. Flag any guard with exactly one non-test call site when
more than one function in the repo returns the type it guards.
`rowMatchesRegistrant` has one call site and two producers of a resolution.

**C4. Mutation proof. Required at merge, catches instance 3 and every future
instance of it.**
For every guard line a PR adds, delete the line, run the unit suite, and paste the
output showing a **named** test going red. Track H did this and reported
"reverting the single new line takes 5 of the 10 new tests RED". Track D did not,
and shipped a tautology under a green suite. This is one command and a binary
answer, and it is the cheapest gate on this list.

**Not statically detectable: instances 4 and 5, circularity.** No AST shape
distinguishes `ticker_of_name[n] == p` from a legitimate lookup. The only thing
that catches it is the two-column table, because writing `<- companies.ticker` on
both lines is what makes it visible. Keep the table.

## What would change the answer

**Nothing about the rule.** Six instances in one sprint across three languages is
not a run of bad luck.

**The checks are revisable.** C1 through C3 are heuristics with false positives,
and if any of them produces more noise than signal over a month, drop that check
and keep the table. C4 is not revisable on that basis: it has no false positives,
because a guard whose deletion turns nothing red is untested by definition.

**The rule retires when the shape stops appearing.** Count instances per sprint.
Two consecutive sprints at zero, with the checks still running, is the condition.
