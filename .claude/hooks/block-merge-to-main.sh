#!/usr/bin/env bash
# PreToolUse safety hook: block any Bash command that would merge to or push the
# protected main/master branch. Defense-in-depth backstop for unattended runs.
# Blocks (exit 2) on:
#   - gh pr merge ...
#   - git push ... main|master   (explicit origin, implicit, HEAD:main refspec,
#                                  and force-push variants, since all name main)
# Allows: feature-branch pushes, git push origin HEAD, gh pr create/edit/view,
#         git commit, local git merge of a feature branch, force-with-lease to a
#         feature branch.
# NOTE: bash pattern-matching is leaky (see PR body). This is a backstop, not a
# proof. A push to remote main is what actually mutates main, and that is blocked.
set -euo pipefail

input=$(cat)
cmd=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.tool_input&&j.tool_input.command)||"")}catch(e){}})')
# Collapse all whitespace runs to single spaces so multi-space / newline-chained
# commands cannot evade the single-space patterns. Portable (no \s / \b).
norm=$(printf '%s' "$cmd" | tr -s '[:space:]' ' ')

reason=""
# gh pr merge (the autonomous-merge vector)
if printf '%s' "$norm" | grep -Eiq '(^| |;|&|\|)gh +pr +merge( |$)'; then
  reason="gh pr merge"
fi
# git push that names main/master as a ref (origin main, main, HEAD:main, origin/main, --force ... main)
if printf '%s' "$norm" | grep -Eiq '(^| |;|&|\|)git +push( |$)' \
   && printf '%s' "$norm" | grep -Eiq '(^| |/|:|\+)(main|master)( |:|$)'; then
  reason="git push to main/master"
fi

if [ -n "$reason" ]; then
  echo "BLOCKED by never-merge-to-main hook: detected [$reason]. Agents never merge or push to main. Open a draft PR and let a human merge. Override only by editing .claude/hooks/block-merge-to-main.sh." >&2
  exit 2
fi
exit 0
