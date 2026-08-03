---
description: Pre-PR verification gate (hard: typecheck, lint, unit, build; e2e advisory)
allowed-tools: Bash(npm:*), Bash(npx:*), Bash(rm:*)
---
Run the hard-gate battery in order. Cheap checks first, stop at the first failure, report exactly what failed.

1. Typecheck: rm -rf .next && npx tsc --noEmit
   (clears stale Next route types in .next that cause phantom TS2307 errors)
2. Lint: npm run lint -- --cache
3. Unit: npm run test:unit
   (node:test via tsx. These are the honesty invariants: no-verdict-inheritance
   for adopted claims, horizon math, the ledger line, and the desk-record
   compliance vocabulary check. They are pure and fast; a failure here means a
   guarantee the product states in its own copy has been broken.)
4. Build: npm run build

These four are the hard gates. If all pass, report "Hard gates passed (tsc, lint, unit, build)." If any fail, show the failing output and stop. Do not edit code to force a pass without telling me what you changed and why.

E2E is NOT part of the default gate. Do not run it automatically.
- Run e2e ONLY when I explicitly ask, and only for a change that touches interactive UI flows or user-facing rendering. For isolated data-access, backend, or logic changes, skip it; deterministic verification (unit, data-layer replay, or rendered-fixture proof) substitutes.
- The suite has mutating specs and the only configured target is prod Supabase. NEVER run it unattended or against the prod ref. It runs only as a supervised manual pass as the dedicated test user (RLS sandboxes that user to its own rows).
- When run, report it as advisory and differential, not pass/fail: flag only NEW failures beyond the known floor (currently 14 deterministic: 5 selector brittleness + 9 hydration). Absolute green is not the bar, and e2e never blocks the PR while the suite still targets prod.

E2E is re-promoted to a required automated gate only once it runs in CI against a dedicated non-prod target.
