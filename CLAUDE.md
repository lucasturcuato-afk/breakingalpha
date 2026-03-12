# Project
Breaking Alpha

# Goal
Build and maintain the Breaking Alpha web app and its supporting data pipeline using a clean repo-based workflow instead of long chat-based development.

# Source of truth
- This GitHub repo is the source of truth.
- The live app is deployed on Vercel.
- Do not treat Claude chat threads as source of truth.
- Stable project memory belongs in this file and in /docs.

# Current collaboration model
- Noah and Lucas are collaborating remotely.
- Both developers should work on separate branches.
- Pull requests should be used for merges.
- Shared project context should live in repo files, not personal chat history.

# Working style for Claude
- Read `CLAUDE.md` and `docs/HANDOFF.md` before making changes.
- When debugging, rank the top 3 likely causes.
- Choose the single most likely cause.
- Give only 1–2 checks or commands at a time.
- Prefer exact fixes over generic advice.
- Do not restate long logs unnecessarily.
- Do not refactor unrelated files unless asked.
- Keep changes scoped and explain which files changed.

# Documentation rules
- Stable long-term context goes in `CLAUDE.md`.
- Current project state and baton-passing notes go in `docs/HANDOFF.md`.
- Priorities and backlog go in `docs/ROADMAP.md`.
- Local setup instructions go in `docs/SETUP.md`.

# Important project areas
- `frontend/`
- `backend/`
- Supabase integration
- Vercel deployment
- Yahoo Finance enrichment integration

# Collaboration rules
- Use feature branches for all meaningful work.
- Keep pull requests scoped.
- Update `docs/HANDOFF.md` after meaningful sessions.
- If stable project context changes, update `CLAUDE.md`.