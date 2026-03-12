# Breaking Alpha Handoff

## Current status
- Breaking Alpha is live on Vercel.
- Lucas’s repo / stack is the source of truth going forward.
- Noah has cloned the shared repo locally and created an initial Claude Code workflow branch.
- Repo-based project memory is being set up to replace long chat-based development.
- Yahoo Finance enrichment still needs to be ported and validated in the shared backend.

## Done
- Shared repo cloned locally
- New branch created: `noah/claude-workflow-setup`
- Initial workflow files created:
  - `CLAUDE.md`
  - `docs/HANDOFF.md`
  - `docs/ROADMAP.md`
  - `docs/SETUP.md`

## In progress
- Defining the shared Claude Code workflow
- Converting project context into repo-based memory
- Preparing for scoped development directly in the shared codebase

## Blocked / open questions
- Need to confirm exact local run commands for frontend and backend
- Need to confirm env var setup and Supabase local/dev flow
- Need to inspect current codebase to determine best path for Yahoo Finance integration
- Need final alignment with Lucas on ownership split and first implementation tasks

## Immediate next steps
1. Finalize the initial repo memory files
2. Inspect the repo structure and document setup instructions
3. Start first scoped Claude Code task inside the shared repo
4. Push this branch and send Lucas a workflow update
5. Plan the Yahoo Finance integration into the shared backend

## Ownership
- Noah:
  - Claude workflow setup
  - backend / data integration planning
  - Yahoo Finance port planning
- Lucas:
  - frontend / deployed app ownership
  - live app validation
  - collaboration on merge / review flow

## Notes
- Shared repo context should now live in the repo, not in long Claude chats.
- `CLAUDE.md` should stay stable.
- `docs/HANDOFF.md` should be updated at the end of meaningful work sessions.