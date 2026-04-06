# Breaking Alpha Roadmap

## Completed
- Repo-based Claude Code workflow with subagents
- Collaboration process and session protocols documented (CLAUDE.md)
- Local setup and run instructions (docs/SETUP.md)
- Frontend/backend audit complete
- Data pipeline validated end-to-end
- Evening Wrap production-validated
- Watchlist — full feature complete (backend, frontend, Finnhub validation, normalization, duplicate prevention)
- Personalized watchlist + Google SSO auth — user-scoped RLS, Google OAuth, onboarding modal (PR #20)
- Company Intel drill-down panel
- Groq placeholder bug fixed
- Watchlist relevance boost in ingest pipeline
- Groq 429 exponential backoff with jitter
- Developer handoff process formalized (repo-handoff-maintainer subagent, CLAUDE.md protocols)
- Signed-out landing page + auth-aware homepage gate — unauthenticated users see static landing page; signed-in experience unchanged
- Signed-out preview mode — hero, Morning Review headline + first 2 sections (blurred + CTA), top 3 articles visible, articles 4–5 blurred with sign-in CTAs
- Onboarding UX — custom-added tickers render immediately as removable chips in the onboarding modal
- Brief preferences UI foundation — PreferencesPanel component, `/api/preferences` API route, `user_preferences` schema (PR #31); preferences data persists/loads but not yet wired to affect brief content
- Frontend stub-row fallback — homepage skips "Market Intelligence Unavailable" rows and falls back to last successful briefing
- Ingest rate-limit hotfix — filtering model → llama-3.1-8b-instant, sleep 0.25s → 2.0s; zero 429 errors observed on full validation run
- Relevance gate tightening — opinion/think-piece/cultural commentary articles rejected; named-person commentary excluded
- Filter prompt quality — style examples removed (eliminated verbatim blurb copying); personnel announcements excluded from relevance gate
- Autonomous Improvement Phase 1 — Run Recorder: `observe.py` + non-blocking hook in `run.py`; writes to `pipeline_runs` and `run_articles` in Supabase after each pipeline run (PR #42)
- Autonomous Improvement Phase 1 — Brief Critic: Heuristic-only quality scorer, non-blocking step 5 in pipeline, writes to `brief_quality_scores` per run (PR #47)
- Autonomous Improvement Phase 1 — Selection Auditor V1: Run-level selection quality recorder, non-blocking step 6 in pipeline, writes to `selection_audit` per run; provenance='reconstructed', no per-article claims, no LLM calls (PR #48, validated live 2026-04-03)
- Morning headline selection tightened — `HEADLINE SELECTION` pre-step added to `MORNING_SYSTEM`; forces story ranking by dollar figure → macro signal → sector breadth before output; headline field instruction rewritten with explicit word count, banned patterns, and BAD/GOOD examples (PR #44)
- Conservative storage-layer title dedup — `_normalize_title()` added to `ingest.py`; `store_article()` skips insert if normalized title matches any article ingested in last 24h; exact match only, no fuzzy logic, no schema changes (PR #45)
- Preferences wiring — `/api/briefing` route live, returns preference-shaped briefings; module preferences reorder sections, sector preferences reorder sector_breakdown; watchlist preference toggle deferred (PR #36)
- Sector classification fix — explicit sector instruction + validation in ingest.py; sector names aligned to SECTORS list; old blank-sector rows not backfilled (2026-04-04)
- sector_breakdown schema-echo fix — fixed "note" key parsing bug in synthesize.py system prompts; added _validate_sector_breakdown() parser hardening (PR #43)
- Autonomous Improvement Phase 1 — Trend Mapper: `backend/trend_mapper.py` built and merged (PR #51); clusters related articles into persistent/emerging narratives; non-blocking step 7 in pipeline; live-validated 2026-04-04 (6 clusters written to trend_clusters table, 1 underrepresented cluster flagged, all "emerging" due to first-run lookback=0)
- Autonomous Improvement Phase 1 — Post-run operator summary: `backend/summarize.py` merged (PR #54); reads brief_quality_scores, selection_audit, trend_clusters for current run_id; prints consolidated digest to stdout (headline pass/fail, banned phrase hits, section presence, article selection metrics, sector concentration flag, cluster count, volatility). Trend Intelligence summary fixed: was querying phantom columns, now correctly aggregates cluster metrics. All three summary sections (Brief Quality, Selection Quality, Trend Intelligence) validated live 2026-04-05 (GitHub Actions 24016130118)

## In Progress
- Thesis Board frontend — Lucas (lucas/thesis-board-live)

## Next — Noah
### Autonomous Improvement Phase 1 (observation + post-run summary complete ✓)
- Run Recorder ✓, Brief Critic ✓, Selection Auditor V1 ✓, Trend Mapper ✓, Post-run Summary ✓ — all live and validated
- **Next Phase 1 work:** Weekly cross-run summary (aggregate observation metrics across 5 pipeline runs, identify patterns, surface operator insights)
- Phase 2+ (optimizer, rollback, config mutation) deferred until Phase 1 summaries are complete

### Brief quality (residual — in priority order)
- **Near-duplicate stories with different wording** — exact-title dedup is live (PR #45); same story under materially different headlines still survives; next step is fuzzy/semantic dedup if this remains noisy
- **Residual comp-list echo in synthesis sections** — 70b-versatile synthesis echoes comp-list patterns from upstream Signal lines; expect reduction after blurb quality improves; revisit if sections still feel formulaic
- **Weak "What to watch" section** — occasional generic forward-looking statements instead of named catalysts with binary outcomes; tighten prompt
- **Residual false-positive relevance hits** — some articles score ≥6 on marginal read-through signal, not a primary market event; gate tuning deferred
- Evening system headline prompt still uses the older, looser spec (only morning was updated in PR #44)
- **Sector preference visibility recovery** — sector_breakdown reordering by user preference now live, but visibility depends on new article accumulation with valid sectors (forward-only, no backfill); expect gradual improvement as ingest populates sectors on new articles; low priority

### Other pending
- Verify/enable Supabase anon SELECT on `articles` and `briefings` tables
- Article cards structured display — headline, why it matters, impacted name/theme, source, timestamp (fields already in schema, zero backend work)
- Today feed "Watchlist Only" toggle — filter articles client-side to watchlist-matched items
- SUPABASE_SERVICE_ROLE_KEY added to backend for pipeline to read all users' watchlists for relevance boost
- Google OAuth consent screen branding (app name, logo, domain) — defer until launch-ready
- Clean stale routes and unused code paths in frontend
- Tighten Supabase query consistency (confirm all tables use ingested_at not created_at)
- **Watchlist preference toggle wiring** — toggle is disabled in UI ("COMING SOON"); deferred pending validation of sector classification stability

## Next — Lucas
- Thesis Board frontend PR and merge
- UI polish pass across all tabs

## Later
- Additional data enrichment features (sector one-pagers, yahoo_finance.py integration)
- Automation improvements
- UI/UX refinement
- Additional subagent lanes (frontend-production-incident, deployment-runtime-verification, homepage-feed-integrity)

## Ownership
- Noah: Backend, pipeline, Groq prompt quality, Supabase schema, Watchlist, Claude Code workflow and subagent infrastructure
- Lucas: Frontend UI, Thesis Board, UI polish
