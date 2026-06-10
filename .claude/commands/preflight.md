---
description: Pre-PR verification gate (typecheck, lint, build, e2e)
allowed-tools: Bash(npm:*), Bash(npx:*)
---
Run the verification battery in order. Cheap checks first, stop at the first failure, report exactly what failed.

1. Typecheck: npx tsc --noEmit
2. Lint: npm run lint
3. Build: npm run build
4. E2E (forced local): E2E_BASE_URL= npm run test:e2e

If all pass, report "All checks passed." If any fail, show the failing output and stop. Do not edit code to force a pass without telling me what you changed and why.
