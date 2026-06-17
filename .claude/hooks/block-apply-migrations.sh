#!/usr/bin/env bash
# PreToolUse safety hook: block any Bash command that applies a database
# migration or runs DDL/DML against the DB. Defense-in-depth backstop.
# Blocks (exit 2) on:
#   - supabase db push | supabase migration up | supabase db reset
#   - psql ... with -f file | -c "sql" | < input   (direct SQL execution)
#   - alembic upgrade ...
# Allows: supabase migration list, supabase db diff (dry), reading a migration
#         file, psql --version / psql -l (list), local pytest / ruff.
# NOTE: bash pattern-matching is leaky (see PR body). This is a backstop, not a
# proof. Applying migrations is a human step.
set -euo pipefail

input=$(cat)
cmd=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.tool_input&&j.tool_input.command)||"")}catch(e){}})')
norm=$(printf '%s' "$cmd" | tr -s '[:space:]' ' ')

reason=""
# supabase apply forms (push / migration up / db reset). NOT: migration list, db diff.
if printf '%s' "$norm" | grep -Eiq '(^| |;|&|\|)supabase +(db +push|migration +up|db +reset)( |$)'; then
  reason="supabase migration apply"
fi
# direct psql execution (-f/--file, -c/--command, including attached -fx.sql/=,
# or < redirect). NOT: psql -l / --version. Flag check is case-SENSITIVE so the
# uppercase formatting flags (-F field-sep, -A) are not mistaken for -f/-c.
if printf '%s' "$norm" | grep -Eiq '(^| |;|&|\|)psql( |$)' \
   && printf '%s' "$norm" | grep -Eq '( -f|--file| -c|--command|<)'; then
  reason="direct psql SQL execution"
fi
# alembic upgrade, allowing an intervening -c config (not present today, future-proofing)
if printf '%s' "$norm" | grep -Eiq '(^| |;|&|\|)alembic +(-c +[^ ]+ +)?upgrade( |$)'; then
  reason="alembic upgrade"
fi

if [ -n "$reason" ]; then
  echo "BLOCKED by never-apply-migrations hook: detected [$reason]. Agents never apply migrations or run DDL against the DB. Surface the SQL for a human to apply. Override only by editing .claude/hooks/block-apply-migrations.sh." >&2
  exit 2
fi
exit 0
