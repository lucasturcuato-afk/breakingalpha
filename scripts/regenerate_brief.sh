#!/usr/bin/env bash
# Regenerate a Morning Brief or Evening Wrap by running the local synthesis
# script. Uses backend/.env for Supabase + Gemini credentials and the repo's
# .venv/bin/python interpreter.
#
# Usage:
#   scripts/regenerate_brief.sh              # morning (default)
#   scripts/regenerate_brief.sh morning
#   scripts/regenerate_brief.sh evening
#
# Requires beautifulsoup4 installed in .venv (part of backend/requirements.txt).
# If missing: .venv/bin/pip install -r backend/requirements.txt

set -euo pipefail

MODE="${1:-morning}"
if [[ "$MODE" != "morning" && "$MODE" != "evening" ]]; then
  echo "Usage: $0 [morning|evening]" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT/backend"

if [[ ! -f .env ]]; then
  echo "Missing backend/.env — copy from backend/.env.example and populate" >&2
  exit 1
fi

set -a
source .env
set +a

exec "$REPO_ROOT/.venv/bin/python" synthesize.py "$MODE"
