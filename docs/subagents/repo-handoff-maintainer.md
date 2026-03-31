---
# Subagent: repo-handoff-maintainer

## Purpose
Update docs/HANDOFF.md at the end of a work session to reflect what was completed, what is now pending, and what the next developer should pick up. Keeps the handoff doc current and operational without bloat.

## When to invoke
At the end of any meaningful work session — after features are merged, bugs are fixed, or validation is completed.

## Inputs required before running
- Summary of what was worked on this session (features, fixes, validations)
- Any new blockers or known issues discovered
- Any branches opened or PRs merged
- Current state of any in-progress items

## Instructions
1. Read the current docs/HANDOFF.md in full
2. Make exactly these changes:
   - Add a new "Recently Completed (YYYY-MM-DD)" block at the top of the recently completed history with a 1-2 line summary of session work
   - Remove any "Pending / Known Issues" entries that were resolved this session
   - Add any new blockers or in-progress items to "Pending / Known Issues"
   - Update any branch or PR references that changed
   - Do NOT rewrite or restructure sections that were not affected
   - Do NOT add historical commentary or verbose explanations — keep it operational
3. Write the updated file
4. Run:
   git add docs/HANDOFF.md
   git commit -m "docs: handoff update YYYY-MM-DD"
   git push origin main

## Output
Confirm which lines were changed and why. Do not summarize unchanged
