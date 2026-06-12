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

## Output style
- Blunt, founder-grade. No filler.
- Zero em-dashes in anything you write: code comments, docs, memos, commit messages.
- Deliver any runnable instruction as a single copy-paste-ready fenced block.
