# Project
Breaking Alpha

# Goal
Build, debug, and maintain the Breaking Alpha web app and supporting data pipeline using a clean repo-based workflow rather than long chat-based development.

# Source of truth
- This GitHub repo is the source of truth for code and persistent project instructions.
- The live app is deployed on Vercel.
- `CLAUDE.md` contains stable project instructions and collaboration rules.
- `docs/HANDOFF.md` contains the current project state, latest baton-pass notes, blockers, and next exact steps.
- `docs/ROADMAP.md` contains priorities and backlog.
- `docs/SETUP.md` contains local setup, run commands, env notes, and operational setup.
- Do not treat Claude chat threads as source of truth.

# Collaboration model
- Noah and Lucas collaborate remotely in the same repo.
- Both developers should work on separate branches for meaningful changes.
- Pull requests should be used for merges.
- Shared context should live in repo files, not personal chat history.
- Keep work scoped, reviewable, and easy to hand off.

# Working style for Claude
- Read `CLAUDE.md` and `docs/HANDOFF.md` before making meaningful changes.
- Treat `CLAUDE.md` as stable instruction and `docs/HANDOFF.md` as current state.
- When debugging, rank the top 3 likely causes, choose the single most likely cause, and drive toward the smallest high-confidence fix.
- Give only 1–2 checks or commands at a time unless asked for a broader plan.
- Prefer exact fixes over generic advice.
- Do not restate long logs unnecessarily.
- Do not refactor unrelated files unless explicitly asked.
- Keep changes scoped and explain exactly which files changed and why.
- Distinguish code issues from deploy/runtime/env issues when evidence suggests they are different.
- Distinguish production-breaking issues from visual/aesthetic regressions unless there is real evidence they are the same.
- Preserve optionality: do not recommend blind merges when preview validation is still outstanding.

# Documentation rules
- Stable long-term project instructions go in `CLAUDE.md`.
- Current project state and baton-passing notes go in `docs/HANDOFF.md`.
- Priorities and backlog go in `docs/ROADMAP.md`.
- Local setup instructions go in `docs/SETUP.md`.
- After meaningful work sessions, update `docs/HANDOFF.md`.
- If stable project workflow or recurring collaboration rules change, update `CLAUDE.md`.
- Keep `docs/HANDOFF.md` concise, operational, and current rather than historical and bloated.

# Repo workflow rules
- Use feature branches for all meaningful work.
- Keep pull requests scoped.
- Prefer small, reviewable commits over broad changes.
- Do not commit secrets or local-only env files.
- Never commit `frontend/.env.local`.
- Do not auto-commit or auto-push unless explicitly asked.
- Do not auto-merge unless explicitly asked and preview/review risk is acceptable.

# Project areas
- `frontend/`
- `backend/`
- Supabase integration
- Vercel deployment
- Groq-powered backend pipeline

# Operational preferences
- When a frontend issue appears only in production or production-first, first separate:
  1. code-level SSR/client mismatch
  2. deployment/runtime/cache/env mismatch
- When a local issue differs from production aesthetics, do not immediately assume the latest code fix caused it.
- Prefer local production validation (`build` / `start`) before drawing conclusions from dev-mode behavior.
- If a change depends on protected external systems, clearly identify what must be validated by the teammate who has access.

# Subagent usage
- Use specialized subagents when they reduce drift and keep work focused.
- Keep subagents narrow and task-specific rather than broad and generic.
- Current/planned subagent lanes include:
  - `frontend-production-incident`
  - `deployment-runtime-verification`
  - `homepage-feed-integrity`
  - `repo-handoff-maintainer`

# Current collaboration preference
- Noah wants concise, operational guidance.
- Prioritize the single highest-leverage next step.
- If suggesting commands, give exact commands.
- If suggesting teammate messages, write them cleanly and briefly.
- Avoid broad brainstorming unless explicitly requested.
