#!/usr/bin/env bash
# PreToolUse safety hook: block any Bash command that dispatches a production
# deploy or pipeline run. Defense-in-depth backstop for unattended runs.
# Blocks (exit 2) on:
#   - vercel ... --prod | vercel promote        (prod deploy)
#   - gh workflow run ...                        (ALL workflows; every workflow
#                                                 here except verify-py is prod,
#                                                 and this is robust to new ones)
#   - gh api .../dispatches | actions/workflows/.../dispatches  (API dispatch)
#   - python[ ...]run.py [...]                   (pipeline execution; hits prod
#                                                 Supabase/Gemini, no sandbox mode)
#   - any reference to cron-job.org              (external prod dispatcher)
# Allows: vercel preview (no --prod), vercel deploy (preview), vercel env/ls,
#         gh pr create/edit/view, reading run.py (cat), npm run dev/build,
#         local pytest / ruff / venv.
# NOTE: bash pattern-matching is leaky (see PR body). This is a backstop, not a
# proof. Dispatching prod is a human step.
set -euo pipefail

input=$(cat)
cmd=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.tool_input&&j.tool_input.command)||"")}catch(e){}})')
norm=$(printf '%s' "$cmd" | tr -s '[:space:]' ' ')

reason=""
# Vercel prod deploy: vercel + (--prod[=...] | promote). NOT: bare vercel / preview.
if printf '%s' "$norm" | grep -Eiq '(^| |;|&|\|)vercel( |$)' \
   && printf '%s' "$norm" | grep -Eiq '(--prod(=| |$)| promote( |$))'; then
  reason="vercel prod deploy"
fi
# gh workflow run (all). verify-py is harmless collateral; agents never need this.
if printf '%s' "$norm" | grep -Eiq '(^| |;|&|\|)gh +workflow +run( |$)'; then
  reason="gh workflow run"
fi
# GitHub API workflow_dispatch (what cron-job.org POSTs to)
if printf '%s' "$norm" | grep -Eiq '(gh +api .*dispatches|actions/workflows/[^ ]*/dispatches)'; then
  reason="workflow_dispatch via API"
fi
# run.py execution: file form (python backend/run.py [morning|evening]) and module
# form (python -m backend.run). NOT pytest/test_run_* (no literal run.py token).
if printf '%s' "$norm" | grep -Eiq '(^| )python[0-9.]* +([^ ]+ +)*([^ ]*/)?run\.py( |$)'; then
  reason="run.py pipeline execution"
fi
if printf '%s' "$norm" | grep -Eiq '(^| )python[0-9.]* +([^ ]+ +)*-m +backend\.run( |$)'; then
  reason="run.py pipeline execution (module form)"
fi
# cron-job.org dispatcher
if printf '%s' "$norm" | grep -Eiq 'cron-job\.org'; then
  reason="cron-job.org dispatch"
fi

if [ -n "$reason" ]; then
  echo "BLOCKED by never-dispatch-prod hook: detected [$reason]. Agents never dispatch production deploys or pipeline runs. Surface this for a human. Override only by editing .claude/hooks/block-dispatch-prod.sh." >&2
  exit 2
fi
exit 0
