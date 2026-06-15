#!/usr/bin/env bash
# Backend Python verification gate: ruff (must-fix tier) + pytest import smoke.
#
# Reproducible from a clean checkout: builds a local .venv, installs pinned
# runtime + dev deps, then lints and runs the smoke test. The only egress is
# pypi (pip install). The smoke run itself needs no network and no secrets.
#
# This is scaffolding, not the gate enforcement. Wiring it as a Stop hook is a
# PROPOSED follow-up (see the PR body), not applied here.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

VENV="$REPO_ROOT/.venv"
PY="$VENV/bin/python"

# Build the venv from 3.11 explicitly: CI and run.py execute on Python 3.11,
# so the gate must reproduce that interpreter, not whatever `python3` is default.
if [[ ! -x "$PY" ]]; then
  if ! command -v python3.11 >/dev/null 2>&1; then
    echo "ERROR: python3.11 not found. The gate must run on Python 3.11 to match CI and run.py." >&2
    echo "Install it (e.g. 'brew install python@3.11' or pyenv) and retry." >&2
    exit 1
  fi
  echo "==> Creating .venv ($(python3.11 --version 2>&1))"
  python3.11 -m venv "$VENV"
fi

echo "==> Installing pinned deps (runtime + dev)"
"$PY" -m pip install --quiet --upgrade pip
"$PY" -m pip install --quiet -r "$REPO_ROOT/backend/requirements.txt" -r "$REPO_ROOT/requirements-dev.txt"

echo "==> ruff check backend/ (must-fix tier: E9,F63,F7,F82)"
"$VENV/bin/ruff" check backend/

echo "==> pytest import smoke (backend/tests/test_smoke.py)"
set +e
"$PY" -m pytest backend/tests/test_smoke.py -q -p no:cacheprovider
PYTEST_RC=$?
set -e

# Guard against exit-5 masking: pytest returns 5 when it collected zero tests.
# A green gate that ran nothing is a silent failure, so treat it as a hard fail.
if [[ "$PYTEST_RC" -eq 5 ]]; then
  echo "ERROR: pytest collected no tests (exit 5). The smoke gate ran nothing." >&2
  exit 1
fi
if [[ "$PYTEST_RC" -ne 0 ]]; then
  echo "ERROR: pytest failed (exit $PYTEST_RC)." >&2
  exit "$PYTEST_RC"
fi

echo "==> verify-py: PASS"
