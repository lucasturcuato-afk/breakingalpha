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

## In Progress
- Thesis Board frontend — Lucas (lucas/thesis-board-live)
- Brief preferences wiring — Noah (PR #31 merged; UI exists but not yet filtering/affecting brief content)
- Post-PR #35 validation — inspect tomorrow's scheduled run for reduced comp-list blurb rate and improved Live Tracker card quality

## Next — Noah
### If blurb quality validates on tomorrow's run
- Tighten `synthesize.py` morning brief headline: fix spec adherence (10-15 words, correct dominant story selection)
- Reduce comp-list echo in synthesis sections (synthesize.py MORNING_SYSTEM / EVENING_SYSTEM section prompts)

### If blurb quality still weak after tomorrow's run
- Investigate whether llama-3.1-8b-instant is capable enough for the relevance_reason task or whether a larger filter model is needed
- Consider heuristic pre-filtering before LLM calls to reduce article count and allow a heavier model

### Other pending
- Validate `noah/brief-preferences` on Vercel preview (auth, panel renders, preferences save/load work)
- Wire saved preferences to filter/modify brief content (preferences UI now exists but has zero impact on briefs)
- Verify/enable Supabase anon SELECT on `articles` and `briefings` tables
- Article cards structured display — headline, why it matters, impacted name/theme, source, timestamp (fields already in schema, zero backend work)
- Today feed "Watchlist Only" toggle — filter articles client-side to watchlist-matched items
- SUPABASE_SERVICE_ROLE_KEY added to backend for pipeline to read all users' watchlists for relevance boost
- Google OAuth consent screen branding (app name, logo, domain) — defer until launch-ready
- Clean stale routes and unused code paths in frontend
- Tighten Supabase query consistency (confirm all tables use ingested_at not created_at)

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
