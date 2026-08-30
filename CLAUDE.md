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
No unit-test runner is wired. Playwright e2e is the only test layer.

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
Eight traps, each one found the expensive way by an agent that trusted a
reading. Every one returns a plausible number rather than an error.

- A dev build serves the mobile fixtures. Measure product data on a
  production build only, or you will report fixture counts as live ones.
- `emulateMedia({colorScheme})` does nothing here. The theme is
  `localStorage.signalera_theme`, read by `theme-provider.tsx`, so set it in
  `addInitScript`. Otherwise you capture light twice and diff it against
  itself. Light body is `rgb(250,247,242)`, dark is `rgb(15,15,15)`; confirm
  two distinct values before believing a both-themes claim.
- `offsetParent` is null for `position: fixed`, so a probe built on it cannot
  see the tab bar. The bar is 58px of row plus a 1px border, height 59.
- Playwright's `newPage()` starts on `about:blank`, so `goto` pushes and
  `history.length` is 2. To reach a genuine cold entry use
  `location.replace()`.
- `.focus()` called from a script after a mouse click leaves Chromium in
  pointer modality, so `:focus-visible` does not match and the ring reads
  `3px none`. Walk to the control with real Tab presses.
- Read a focus ring at t=500ms, not t=0. `transition-colors` includes
  `outline-color` at 150ms, so an immediate read returns the start value and
  looks like a missing ring.
- A control can be focusable and invisible at the same time. `focus()`
  succeeding proves nothing about whether a reader can see what they landed
  on; read the computed opacity of the wrapper too.
- The e2e user is not on `beta_allowlist`, so a production build authenticates
  and then bounces it to `/waitlist`. Adding the row is a DB write. Measure
  signed out with `VERCEL_ENV=preview` (unprefixed, read at runtime, no
  rebuild needed).

### Two checks that answer a question nobody asked
- `design:lint --since origin/main` run before committing prints
  `no lintable files touched` and exits 0. That is not a pass, it is the tool
  saying it looked at nothing. Commit first. It also reads a bare issue
  reference like `#741` in a comment as a three-digit hex (#749).
- `plate.mjs` judges the crop rectangle including fixed and sticky boxes, but
  does not descend into shadow roots (#737), so it can report a clear frame
  with an overlay sitting in it.

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


## Output style
- Blunt, founder-grade. No filler.
- Zero em-dashes in anything you write: code comments, docs, memos, commit messages.
- Deliver any runnable instruction as a single copy-paste-ready fenced block.
