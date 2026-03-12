# Breaking Alpha Handoff

## Current status
- Breaking Alpha is live on Vercel.
- Repo-based Claude Code workflow is set up and documented.
- `docs/SETUP.md` is now complete with real commands, env vars, and Supabase notes.
- Yahoo Finance enrichment still needs to be ported and validated in the shared backend.

## Done
- Shared repo cloned locally
- New branch created: `noah/claude-workflow-setup`
- Workflow and documentation files created and filled in:
  - `CLAUDE.md` — stable project instructions for Claude Code
  - `docs/HANDOFF.md` — current project state (this file)
  - `docs/ROADMAP.md` — priorities and backlog
  - `docs/SETUP.md` — local setup, run commands, env vars, Supabase notes ✅
- Codebase audited: frontend (Next.js 14), backend (Python/Groq/Supabase), API routes inspected

## Frontend nav (current state)
- The insider trading tab has been fully removed from the nav.
- The insider trading API route (`frontend/pages/api/insider.js`) has been deleted.
- The current nav has exactly 7 tabs (in order): Morning Review, Live Tracker, Evening Wrap, Deal Flow, Thesis Board, Company Intel, Trends.

## Known issues (not yet fixed — needs scoped PR)
- `backend/requirements.txt` lists `google-generativeai` but the backend uses `groq`. The `groq` package is missing. Backend will fail on `pip install` + run without a manual `pip install groq`. Needs a targeted fix PR.

## In progress
- Preparing first scoped development task (Yahoo Finance enrichment or pipeline validation)

## Blocked / open questions
- Need Lucas to confirm env var values and Supabase project access
- Need alignment on Yahoo Finance integration approach before starting
- Need final alignment on ownership split for first implementation task

## Immediate next steps
1. Push `noah/claude-workflow-setup` branch and open PR for Lucas to review
2. Lucas validates `docs/SETUP.md` against his local setup
3. Fix `backend/requirements.txt` in a separate scoped PR
4. Align on Yahoo Finance integration plan
5. Start first backend implementation task on a new feature branch

## Ownership
- Noah:
  - Claude workflow setup
  - backend / data integration planning
  - Yahoo Finance port planning
- Lucas:
  - frontend / deployed app ownership
  - live app validation
  - collaboration on merge / review flow

## Operational notes
- GitHub Actions scheduler runs twice daily: 6am PT (morning briefing) and 10pm PT (evening briefing), weekdays only.
- Finnhub is the primary quotes source. Stooq CSV is the fallback if Finnhub is unavailable.
- Evening Wrap was not confirmed generating as of last check — needs validation.
- Deal Flow manual entry form exists in the UI but only saves to local state — does NOT write to Supabase yet.
- Thesis Board has no backend persistence — resets on page refresh.

## Notes
- Shared repo context should now live in the repo, not in long Claude chats.
- `CLAUDE.md` should stay stable.
- `docs/HANDOFF.md` should be updated at the end of meaningful work sessions.
