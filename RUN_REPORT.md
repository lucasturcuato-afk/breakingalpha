# RUN REPORT — Defect B1 (D6): stop now-stamping date-less items

Branch: fix/ingest-staleness (based on origin/main @ 0df8c777)
Scope: backend/ingest.py ONLY.

## Problem
`published_at` defaulted to ingest-time `now()` whenever the source omitted a
date. The `articles` table has no `created_at`, so that now-stamp became the de
facto date and stale items looked fresh.

## What changed (all in backend/ingest.py)

1. gnews single feed (`_fetch_single_gnews_feed`, was ~:314-325)
   - Missing/empty `published` -> NULL (None), never now-stamped.
   - ADDED the INGEST_FRESHNESS_DAYS skip this path lacked. Mirrors the main RSS
     loop: parse `published_at`; if older than the freshness cutoff, skip; if the
     date is missing or unparseable, let the entry through.

2. Finnhub (`fetch_watchlist_finnhub_articles`, was ~:1016)
   - Default `published_at = None` instead of `now.isoformat()`. Only set when
     the `datetime` timestamp parses.

3. Main RSS loop (`fetch_all_articles`, was ~:1067)
   - Missing/empty `published` -> NULL (None) instead of `now.isoformat()`.
   - Hardened the existing freshness skip to handle None safely (`if published_at:`
     guard before `.replace(...)`), so a NULL date is let through, not crashed on.

4. NewsAPI (`fetch_all_articles`, was ~:1113)
   - `a.get("publishedAt") or None` instead of falling back to `now()`.

Empty-string dates are coerced to None via `or None` in every path.

## Why NULL is safe (verified, read-only)
- SELECT on information_schema confirmed `articles.published_at` is_nullable=YES.
  No NOT-NULL constraint to break.
- `articles.ingested_at` exists, is_nullable=YES, default `now()`. This is the
  true ingest-time stamp; it is unaffected by this change.
- In-file recency consumers (URL/title dedup at ~:984 and ~:1909) filter on
  `ingested_at`, NOT `published_at`. NULL published_at does not break dedup.
- The only in-file fresh-only paths on `published_at` are the two freshness
  skips (main RSS + the new gnews one). Both treat missing/unparseable date as
  "let through" (NOT now, NOT skip). NULL therefore ranks as unknown, not fresh,
  and is never dropped at ingest.

## Out of scope (left untouched, by instruction)
- Per-story sentiment compute (FilterDecision schema, ~:110-111 area).
- Analyst-coverage CRITICAL CLASSIFICATION RULE (~:352 area).
- Frontend/backend recency RANKER changes (handled in other worktrees). This
  worktree only stops the now-stamp at the ingest source. A downstream ranker
  that sorts on `published_at DESC` will now see NULLs; in Postgres NULLS sort
  LAST under ASC and FIRST under DESC. See VERIFY item below.

## Tests
- `python3 -m py_compile backend/ingest.py` -> OK.
- `python3 -m unittest discover backend/tests`
  - BEFORE (clean tree, git stash): Ran 241 tests, FAILED (errors=34).
  - AFTER (with change): Ran 241 tests, FAILED (errors=34).
  - IDENTICAL baseline. Zero NEW failures introduced.
  - The 34 errors are PRE-EXISTING environment import failures (httpcore /
    typing.Union incompatibility under Python 3.14, plus missing google/supabase
    deps). They are `unittest.loader._FailedTest` import errors, not logic
    failures, and occur with no code change. Cannot be cleanly fixed from this
    worktree (env, not code).
- Isolated logic proof (the import-dependent ingest tests cannot load in this
  env): asserted all touched branches by hand — missing/empty -> None; None and
  unparseable dates let through the freshness skip; stale skipped; fresh kept.
  All asserts pass (LOGIC_ASSERTS_OK).

## HALT / VERIFY items (for a human)
- VERIFY (downstream ranker, OTHER worktree): any query that orders selected
  stories by `published_at DESC` will surface NULL-dated items FIRST in Postgres
  default ordering. The intent is NULL = OLDEST/unknown, not freshest. The
  ranker worktree must add `NULLS LAST` (or COALESCE to a floor / `ingested_at`)
  on recency sorts. Not fixable here (not in ingest.py).
- No migration needed: published_at already nullable, ingested_at already
  present. Nothing applied (per guardrails, agents never apply migrations).

## Guardrails
No merge, no push to main, no migration applied, no backend/run.py run, no
Gemini call, no prod write, no cron/backfill, no Lucas-protected file touched.
SELECT-only SQL used to verify nullability. Zero em-dashes.
