# Breaking Alpha Handoff

## Current status
- BreakingAlpha is live on Vercel.
- Backend startup/config fixes were merged into `main`.
- Groq reliability retry/backoff/logging fixes were merged into `main`.
- A frontend PR is now open from `debug/frontend-prod-issue` into `main`.
- That PR fixes multiple homepage hydration mismatches in `frontend/pages/index.js`.
- Local production build succeeds after the frontend fixes.
- Lucas has been messaged and asked to review the PR / protected Vercel preview before merge.
- Repo workflow documentation was updated and merged into `main`.
- `CLAUDE.md`, `docs/ROADMAP.md`, and `docs/SETUP.md` are now aligned and should be used as the repo source of truth for workflow/setup.
- `debug/frontend-prod-issue` has been merged with latest `main` so branch state is current.

## Frontend hydration PR
Branch:
- `debug/frontend-prod-issue`

PR purpose:
- fix homepage SSR/client hydration mismatches without broad refactors

What was fixed:
- moved render-time date logic behind client-side state/effect
- moved render-time market-open logic behind client-side state/effect
- removed conditional ticker `<style>` mismatch
- moved Google Fonts `@import` out of the inline style block into `Head`

Validation completed:
- local frontend env configured
- `npm run build` succeeds
- local production render works
- PR created and pushed

## Current blocker / open question
Do not merge blindly yet.

What still needs confirmation:
- does the Vercel preview fully resolve the homepage hydration/runtime issue?
- does the preview preserve the current polished sidebar/icon rendering?
- is the local sidebar/icon ugliness only local, or a real deploy regression?

## Immediate next step
- Lucas opens the PR / Vercel preview
- Lucas checks whether:
  - homepage loads cleanly
  - hydration/runtime issue is resolved
  - sidebar/icons still look normal
  - preview seems safe to merge

If preview looks good:
- merge the PR

If preview looks off:
- isolate sidebar/icon issue as a separate frontend follow-up

## In Progress
- **AI Deal Memo Generator** (branch: `lucas/deal-memo-generator`)
  - New API route: `frontend/pages/api/memo.js` — calls Groq llama-3.1-8b-instant with IB-style prompt
  - "Generate Memo" button on each Deal Flow card
  - Modal overlay displays formatted memo with copy-to-clipboard
  - Needs: GROQ_API_KEY added to Vercel environment variables before merge
  - Status: built, needs testing on preview before PR into main

## Recently Fixed (2026-03-25)
- **secrets mapping**: `schedule.yml` line 46 was pointing to `secrets.SUPABASE_KEY` (nonexistent); corrected to `secrets.SUPABASE_ANON_KEY`. This was causing KeyError failures in the pipeline.
- **null deal size**: Evening Wrap top_deals cards were rendering `deal.valuation` conditionally; changed to always render `deal.value || 'Undisclosed'` to match what the AI pipeline actually produces and prevent blank/null display.
- **deal flow form not saving**: `DealFlowTracker` had no add-deal UI or Supabase write path. Added a "+ ADD DEAL" form with a `handleAddDeal` handler that updates local state and inserts to the `deal_flow` table in Supabase.

## Notes
- Do not commit `frontend/.env.local`
- `.claude/` is ignored in `.gitignore` on `debug/frontend-prod-issue`
- Notion is the detailed project source of truth; this file is the short repo handoff
