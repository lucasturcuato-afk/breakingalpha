@AGENTS.md

<!-- Maintaining: after a correction, run /learn to capture it as a rule. Run /preflight before any PR. Keep this file lean; push finer learnings to auto memory. -->

# Signalera

AI-native financial intelligence platform. A daily Python pipeline ingests
financial news, synthesizes it with Gemini, and surfaces Company Intel, Deal
Flow, and theses in a Next.js app. Two founders, Noah and Lucas, who both work
across the full stack. Division of labor is fluid, not fixed: Noah leans product
direction and built Company Intel; Lucas built much of the pipeline
orchestration. Treat those as leanings, not boundaries. Do not assume a task is
out of scope based on frontend vs backend, and do not defer a change because of
who usually works in an area. Optimize for shipping correct features fast, not
for cleverness.

## Stack
- Frontend: Next.js 16 App Router, React 19, TypeScript, Tailwind v4. Active app
  is `src/`. This is a recent Next.js; do not assume Next 14 era APIs, read
  `node_modules/next/dist/docs/` before writing framework code.
- Backend: Python pipeline, entrypoint `backend/run.py`
- DB: Supabase (Postgres + pgvector for semantic dedup)
- LLM: Gemini 2.5 Flash for synthesis
- Email: Resend. Scheduling: cron-job.org, NOT GitHub Actions native schedule
- Hosting: Vercel

## Package manager
npm project (package-lock.json). Use npm. Do not use pnpm, yarn, or bun.

## Commands
- Dev: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`
- Typecheck: `npx tsc --noEmit`   (no typecheck script is wired)
- E2E tests: `npm run test:e2e`   (Playwright, auto-starts the dev server locally)
- Pipeline: `python backend/run.py`
Unit tests: `npm run test:unit` (`tsx --test` over `src/**/*.test.ts` and
`tests/unit/**/*.test.ts`). 617 tests at time of writing. Playwright e2e is
the second layer, and per the preflight gate below a deterministic unit or
rendered-fixture proof substitutes for it on data-access and logic changes.

## Where things live
- `src/` is the canonical frontend. App Router under `src/app/` (route.ts /
  page.tsx), components, lib. Root `next.config.ts` and the npm scripts drive it.
- `frontend/` is a LEGACY separate Pages Router app with its own package.json
  and deps. Do not touch it unless explicitly migrating. Editing
  `frontend/pages/api/watchlist*.js` is editing dead code; the live versions
  live under `src/app/api/`.
- `backend/` Python pipeline. run.py orchestrates ingest.py, ingest_sec.py,
  embedding_job.py, deal_extractor.py, pattern_memory.py, outcome_evaluator.py,
  adversarial.py, audit.py, thesis_generator.py (step 16), output_constants.py
- `supabase/` and `sql/` database migrations and schema
- `e2e/`, `tests/` Playwright specs

## Workflow rules
- Recon before implementing. Read the relevant code and state a plan before
  writing. Do not guess at structure.
- Squash-and-merge is the standard.
- Never auto-merge to main. Autonomous merges happen on integration branches only.
- Use isolated git worktrees when running 2+ write subagents in parallel
  (shared .git/refs collide otherwise).
- A visual smoke test is required before every PR merge.
- Before opening a PR, run /preflight; the hard gates (tsc, lint, build) must
  pass. e2e is advisory, not a blocking gate. See the Preflight gate section.
- Agents never merge to main, apply migrations, or dispatch production pipeline
  runs. Surface these for a human.
- **This repo is PUBLIC. Never publish live product data to it.** PR bodies, PR
  comments, issues and commit messages are world-readable. Keep out: row counts
  and volumes (deals, graded calls, articles, follows, watchlist entries),
  ingest cadence or freshness, any statement that a pipeline is behind or down,
  timestamps of the last run, query latencies, and any verbatim product output
  such as a claim, a thesis, a ticker rationale or a graded verdict sentence.
  Argue in relative terms instead: "the count is legitimately zero for several
  hours a day", "all four bucket counts match on both surfaces". The reasoning
  survives; the figures are not needed to make it. Company names and headline
  fragments already in the public source are fine. When in doubt, leave it out
  and say what you left out.


## Preflight gate
Hard gates, must pass before any PR: tsc (0 errors), lint (0 errors), build
(success). e2e is NOT a required gate.
- e2e is advisory and conditional. Run it only for changes that touch
  interactive UI flows or user-facing rendering. For isolated data-access,
  backend, or logic changes, deterministic verification (unit, data-layer
  replay, or rendered-fixture proof) substitutes for e2e.
- When e2e is run, the bar is differential, not absolute: no NEW failure beyond
  the known floor (currently 14 deterministic failures: 5 selector brittleness
  + 9 hydration). Absolute green is not required while that floor exists.
- The e2e suite contains mutating specs and the only configured target is the
  prod Supabase. Agents must NEVER run the mutating e2e suite unattended or
  against the prod ref. Supervised manual runs as the dedicated test user are
  acceptable (RLS sandboxes that user to its own rows).
- Re-promote e2e to a required, automated gate ONLY once it runs in CI against a
  dedicated non-prod target. Until then it stays advisory.

## Propose-only files
High-blast-radius or actively-iterated files. Do not rewrite these
autonomously: read them, propose a diff, and stop. This is about file
sensitivity, not ownership.
- `src/components/memo/MemoModal.tsx`
- `src/app/api/memo/route.ts`
- `src/app/api/briefing/route.ts`
- `src/app/trends/page.tsx`
- `src/lib/watchlist-utils.ts`
- `src/components/watchlist/WatchlistAddInput.tsx`

## Data conventions
- Tickers: HARD_TICKER_OVERRIDES is the source of truth for ambiguous names.
  Add new overrides there. Do not hardcode tickers inline.
- Entities: resolve to canonical via the alias system + Wikidata validation
  before inserting. Do not create duplicates.
- Sectors: dual-dimension taxonomy. industry_verticals and activity_types are
  JSONB arrays, not a single sector string.

## Pipeline reliability (learned the hard way)
- Article filtering runs per-article with 5 parallel workers, a Pydantic
  response_schema, and a UA header. Do not revert to the serial Gemini fallback;
  it caused 70-minute hangs.
- SEC 8-K fetches can return 403 and hang silently. Keep the timeouts in place.

## Learnings
<!-- /learn appends new rules here when they do not fit a section above. One specific, verifiable line each. -->

### Measuring a browser
Ten traps, each one found the expensive way by an agent that trusted a
reading. Every one returns a plausible number rather than an error.

The count went from nine to ten and not to eleven, which is the honest
arithmetic: two were added and ONE OF THE ORIGINAL NINE WAS ITSELF WRONG. The
allowlist line said the e2e account was not allowlisted. It was, the whole time,
and the query that said otherwise is now the trap directly above it. A list of
traps is not exempt from being one.

- A dev build serves the mobile fixtures. Measure product data on a
  production build only, or you will report fixture counts as live ones.
- `emulateMedia({colorScheme})` does nothing here. The theme is
  `localStorage.signalera_theme`, read by `theme-provider.tsx`, so set it in
  `addInitScript`. Otherwise you capture light twice and diff it against
  itself. Light body is `rgb(250,247,242)`, dark is `rgb(15,15,15)`; confirm
  two distinct values before believing a both-themes claim.
- `offsetParent` is null for `position: fixed`, so a probe built on it cannot
  see the tab bar. The bar is 58px of row plus a 1px border, height 59.
- `git stash` IS NOT SAFE IN A WORKTREE. The stash stack belongs to the shared
  `.git`, not to your worktree, so `git stash pop` takes whatever another
  session pushed last. It happened here: a pop in one unit's worktree grabbed
  a different session's entry. The pop conflicted, which is the only reason it
  was noticed, git kept the entry, and `git reset --hard` reverted the partial
  apply with nothing lost. Had it applied cleanly it would have silently mixed
  two sessions' work into one diff. Commit to a scratch branch instead, or use
  `git worktree add` for the thing you were about to stash for.
- LAYOUT QUANTISES TO A 1/64px GRID AND THE CSSOM SERIALISES TO SIX
  SIGNIFICANT DIGITS, and those two facts disagree. A grid-exact
  `16.953125px` comes back out of `getComputedStyle` as `16.9531px`, one grid
  step LOW. Build a layout correction on that reading and the result lands a
  step short, every time, deterministically. It held nine cells at exactly
  -0.01px through two rounds of fixing on the tone-series block before it was
  found, and -0.01 is exactly the magnitude a reasonable person writes off as
  a rounding artefact rather than chasing. It is not one. When a value must be
  grid-exact, do not correct from a serialised length: measure where the
  element actually lands and correct from that.
- MEASURING LIVE DATA TWICE IS MEASURING TWO DIFFERENT CORPORA. Two companies
  changed section state between snapshots taken minutes apart inside a single
  sweep, which silently turns an A/B into a comparison of different things,
  and the diff then reads as a regression you introduced. Run both sides back
  to back and compare the state of each row as a drift check, not only the
  numbers. Any measurement on a live corpus taken minutes apart has this
  hazard.
- `page.url()` read after `waitForLoadState("networkidle")` can return the
  PRE-NAVIGATION path on a `next/link` navigation that actually succeeded. The
  client router settles the network before it settles the URL, so the read is
  taken in the window where the new page is already fetched and the address has
  not moved. It fails as a FALSE NEGATIVE: a working link scores as unreachable,
  which is the direction that invents a defect rather than hiding one. It cost a
  full first pass on `/settings/learned` and `/settings/alerts`, both scored
  unreachable before the harness was corrected. `waitForURL` is the only true
  reading. Same family as the hit-test versus real-tap distinction: the cheap
  probe answers a question adjacent to the one asked.
- Playwright's `newPage()` starts on `about:blank`, so `goto` pushes and
  `history.length` is 2. `location.replace()` is the way to a genuine cold
  entry AND IT ONLY WORKS ON A PAGE THAT HAS NEVER NAVIGATED. It replaces the
  entry it is standing on, so anything underneath survives, and `history.length`
  counts the TAB and not the call. Measured on this build: a fresh page is
  `about:blank` at length 1; `goto("about:blank")` on a fresh page does NOT push,
  because Chromium replaces the initial empty document; replacing from there
  gives length 1, `navigation.currentEntry.index` 0, `entries()` 1. Reuse a page
  that has already loaded one URL and the identical sequence gives length 3,
  index 1, entries `["/dashboard","/deal-flow"]`. The length is the visible half
  and the index is the damaging half: `shouldStepBack` reads that index, so a
  back-control test written on such a page measures the step-back branch while
  believing it measures the cold-entry branch, and passes either way. Assert
  `location.href === "about:blank"` and `history.length === 1` BEFORE replacing,
  and assert the result on `navigation.currentEntry.index`, never on
  `history.length`.
- `.focus()` called from a script after a mouse click leaves Chromium in
  pointer modality, so `:focus-visible` does not match and the ring reads
  `3px none`. Walk to the control with real Tab presses.
- `Emulation.setEmulatedMedia` alone does not flip `hover` and `any-hover` to
  `none`. `hasTouch: true` on the browser context is what does it. A harness
  that sets only the CDP call reports a coarse-pointer measurement it never
  took, and the number can still be right for the wrong reason. Assert the
  emulation landed and throw if it did not.
- Read a focus ring at t=500ms, not t=0. `transition-colors` includes
  `outline-color` at 150ms, so an immediate read returns the start value and
  looks like a missing ring.
- A control can be focusable and invisible at the same time. `focus()`
  succeeding proves nothing about whether a reader can see what they landed
  on; read the computed opacity of the wrapper too.
- A `+` in a PostgREST query string decodes as a SPACE.
  `beta_allowlist?email=eq.noahhanning03+e2e@gmail.com` gives back `[]` while
  the row is sitting there; `email=ilike.*e2e*` finds it. Percent-encode the
  value as `%2B`, or match on a fragment. Same class as the `%` that crashed
  `resolvesTo` through `decodeURIComponent`: a character that means something to
  a URL, silently changing what a query asks rather than failing. This one cost
  more than a crash would have. The false negative it produced went into six
  agent briefs in one night and shaped how several units measured.
- THE E2E USER IS ON `beta_allowlist`, since 2026-08-25, and the line that used
  to sit here saying otherwise was the `+` trap above. A production build does
  NOT bounce that account to `/waitlist`: measured signed in on a production
  build, `/radar/watchlist` is neither a public path nor in
  `MOBILE_REDESIGN_DEV_PATHS`, so it passes through the gate at `proxy.ts:160`,
  and it answers 200 and stays put. What `VERCEL_ENV=preview` (unprefixed, read
  at runtime, no rebuild needed) actually buys is SIGNED-OUT reach into the
  mobile routes, which is what a build agent with no session needs. Adding an
  allowlist row is a DB write and is still not the move.

### Work pushed to a branch whose PR has closed lands nothing
Two shapes, one failure. A branch that has been squash-merged is a dead end,
and git will happily keep accepting commits on it.

**Shape one, a stacked PR.** Merge a PR whose base is another PR's branch,
after that base has already gone upstream, and the merge succeeds into a branch
nothing reads any more. GitHub records it as merged. Nothing warns.

**Shape two, a late commit.** Push to a branch after its own PR has merged.
There is no PR left to carry it, so it sits on the branch forever.

Both happened the same day. Shape one twice, the second time 31 seconds after
the first. Shape two twice, and the second time it ate the first draft of this
very entry, so the trunk kept saying eight traps while the branch said ten.

- **`git merge-base --is-ancestor <head> main` cannot detect it.** Squash-merge
  means a head commit is never an ancestor of the trunk, so ancestry returns a
  false negative for every squash-merged PR, landed or lost alike. It reported
  both a landed PR and a lost one as missing.
- **The only reliable check is content.** Pick something the PR added or
  removed and look for it on the trunk: a new exported constant, a deleted
  file, a renamed string. `git show origin/main:<file> | grep`.
- **Recovering it is cheap and is not a reimplementation.** Diff the PR's base
  at branch time against its head, apply that to the trunk, open a fresh PR.
  Both recoveries applied clean with no resolution.
- **Avoid it by merging a stack bottom-up in one sitting**, or by retargeting
  the child at the trunk before merging the parent.

### Two checks that answer a question nobody asked
- `design:lint --since origin/main` run before committing prints
  `no lintable files touched` and exits 0. That is not a pass, it is the tool
  saying it looked at nothing. Commit first. It also reads a bare issue
  reference like `#741` in a comment as a three-digit hex (#749).
- `plate.mjs` judges the crop rectangle including fixed and sticky boxes, but
  does not descend into shadow roots (#737), so it can report a clear frame
  with an overlay sitting in it.

### A response of exactly 1000 rows is not an answer, it is a ceiling
PostgREST caps every response at `db-max-rows`, which is **1000** here, and it
does not error when it truncates. A query that should return 50,386 rows returns
1000 and looks exactly like a complete answer. `.limit(5000)` does not raise, it
truncates. This has now produced four wrong numbers in this codebase from one
cause, so treat any count that lands at or near 1000 as suspect until proven.

- **`.limit(n)` above 1000 is a lie you will believe.** `tools/`'s merge map
  asked for every pair, got 1000 of 1363, and planned 10,566 article repairs
  instead of 13,979. It would have exited 0 and left ~3,400 articles unrepaired
  with nothing in the ledger recording the miss.
- **`count="exact"` returns the TRUE total while the body is still truncated.**
  That is the cheapest possible check and the basis of the fix: fetch with
  `.order().range()` in a loop, then assert `len(rows) == count`. A read that
  cannot reach its reported count should exit, not return a short list.
- **A count(*) that times out is not a reason to skip the assertion, it is a
  reason to use keyset.** `articles` cannot be counted (57014), so paginate on
  `.gt("id", last)`: a capped page is indistinguishable from a full one and the
  walk simply continues, which is why keyset is the one safe unbounded read.
- **The damage is worst where nobody looks at the number.** The three found by
  sweeping were all silent: ingest's 24h title-dedup preload saw 1000 of 1602 so
  duplicate titles could be stored; its 30-day URL preload saw 1000 of 50,386,
  which is 2% of the dedup set and a wrong duplicate count in the structured
  log; and 22 of 43 users' watchlist xlsx exports silently dropped rows.
- **Grep for the shape, not the symptom.** `\.limit\(\s*[0-9]{4,}` finds the
  explicit ones. The rest are reads with no `.limit`, no `.range`, no
  `.single()` and no narrowing `.eq`/`.in_` on a table that can exceed 1000.
  Filter out writes (`.insert`/`.upsert`) or the sweep is mostly false hits.
- **Under 1000 today is not a fix.** `companies WHERE ticker IS NOT NULL` sits
  at 961. It crosses on its own, with no code change and no signal.

### Claims to distrust in your own writing
- "Byte-identical" and "exactly N properties move" are the two claims most
  often falsified under audit. Both were wrong this week: `text-align` moves
  `left` to `start` wherever `.bare` is dropped, and a follow-row change that
  claimed two moved properties moved ten. Enumerate the full computed diff
  rather than the properties you thought about.
- A test that pins an identifier is satisfied by the import line. Pin the
  call: `/NAME\.map\(/`, not `/NAME/`. Prove it by mutation, not by reading.
- Do not report a fix as working when you could not exercise it. Fulfil the
  blocking request with a canned body instead of aborting it, or say the
  claim is inferred. A dead-loop fix shipped inferred this week turned out to
  address a fraction of the case it named.


### A test whose fingerprint is incidental to what it claims to prove
Three of these in one week, each a test carrying a copy of something it should
have been reading, or reading a symptom of the thing its name promises.

- `src/lib/call-horizons.test.ts` (#713) held a hand-written copy of the adopt
  route's gradeability predicate, under a comment claiming to be "the exact
  predicate the route applies". The route's compare moved from `>` to `>=` and
  the copy stayed `>`. It stayed green because every case exercised `week`,
  where the two compares agree. Probing `session` split them.
- `tests/unit/company-directory-search-target.test.ts` (#754) restated the
  directory's zero-match gate in a local `navigatesTo()` helper and asserted
  against the restatement. Four of its five tests passed against `main`, where
  the gate was a different regex in a file the test never loaded.
- `backend/tests/test_long_horizon_panel.py::TestGradingIsPurePriceMath::test_the_grading_loop_makes_no_llm_call_by_default`
  proves "no model call" with `assert "correct" in notes and "clean" in notes`.
  Its own comment names the real mechanism: no API key, no reachable network,
  so a call would take the exception path. The assertion does not test that. It
  reads two words that the deterministic fallback happens to interpolate from
  `outcome.verdict` and `outcome.attribution`, so a copy edit to the grader's
  vocabulary breaks a proof about network behaviour. `1 failed, 1582 passed`.

- **Recognising it.** The name or docstring promises a MECHANISM (which
  function ran, whether a call was made, which branch was taken) and the
  assertion reads a SYMPTOM (a substring, a rendered date, a count). Ask two
  questions: what else could make this pass, and what unrelated edit could make
  it fail. Any answer to either means the fingerprint is incidental.
- **Why it survives review.** It is green, and the proxy is usually true on the
  day it is written. Nothing goes red until someone edits the thing the proxy
  was standing in for, and then it goes red for a reason that has nothing to do
  with the defect it was guarding, and the next reader edits the test.
- **Assert the seam, not the symptom.** Import the rule rather than restating
  it, and if it is not exported, export it. Assert the branch (`notes` equals
  the deterministic fallback, the injected fetcher was the only IO) rather than
  words the branch happens to emit. `company-directory-search-target.test.ts`
  says it best: a test that cannot go red on the tree it is describing is
  documentation with an exit code.
- **Not this trap, though it was read as it twice.** Two PRODUCTION constants
  mirroring one rule is a different shape with a different fix. The four
  divergent `TICKER_RE` regexes (issue #738, not a PR) and the three 7-day tone
  windows (#721) are real, filed, and self-documented, but no test carried
  those copies. Do not fold them into this entry.


## Output style
- Blunt, founder-grade. No filler.
- Zero em-dashes in anything you write: code comments, docs, memos, commit messages.
- Deliver any runnable instruction as a single copy-paste-ready fenced block.
