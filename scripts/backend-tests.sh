#!/usr/bin/env bash
# Backend Python test gate: runs the whole backend/ unittest+pytest suite.
#
# Companion to scripts/verify-py.sh, which runs ruff plus a single import smoke
# (backend/tests/test_smoke.py). That smoke gate proves the modules import. This
# script proves they behave. Until this existed, 1073 backend tests were executed
# by nothing, and test_macro_slice2.py sat red for four weeks holding the exact
# assertion that would have caught the _MACRO_MONTHS constant collision.
#
# Two tiers, on purpose:
#   GATING   everything not listed in backend/tests/known_failures.txt. Any
#            failure here fails the build.
#   REPORTED exactly the node ids in that file. Printed, never blocking.
#
# A job that is red on day one gets disabled within a day, so the pre-existing
# failures are quarantined by node id rather than by ignoring whole files. That
# keeps the passing tests inside those same files in the gate.
#
# Usage:
#   bash scripts/backend-tests.sh           gate only, exits non-zero on failure
#   bash scripts/backend-tests.sh --report  run only the quarantined tests
#
# No secrets, no network, no run.py dispatch. Python 3.11 to match CI and run.py.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

KNOWN_FAILURES="backend/tests/known_failures.txt"
PY="${PYTHON:-python3}"

if [[ ! -f "$KNOWN_FAILURES" ]]; then
  echo "ERROR: $KNOWN_FAILURES is missing. The gate refuses to guess its own scope." >&2
  exit 1
fi

# Strip comments and blanks. Everything left is a pytest node id.
# Portable read loop rather than mapfile: mapfile is bash 4+, and macOS ships
# bash 3.2, so this script has to run for a developer locally as well as in CI.
QUARANTINED=()
while IFS= read -r line; do
  [[ -n "$line" ]] && QUARANTINED+=("$line")
done < <(sed -e 's/#.*//' -e 's/[[:space:]]*$//' -e '/^$/d' "$KNOWN_FAILURES")

if [[ "${1:-}" == "--report" ]]; then
  echo "==> REPORTED tier: ${#QUARANTINED[@]} known-failing test(s), non-blocking"
  echo "    Source of truth: $KNOWN_FAILURES"
  echo "    Every line is a debt. Delete it when the test is fixed."
  echo
  if [[ "${#QUARANTINED[@]}" -eq 0 ]]; then
    echo "    None. The quarantine is empty, so promote the gate to the full suite"
    echo "    and delete this tier."
    exit 0
  fi
  set +e
  "$PY" -m pytest "${QUARANTINED[@]}" -p no:cacheprovider --tb=line -rfE
  RC=$?
  set -e
  echo
  echo "==> REPORTED tier exit code: $RC (intentionally not propagated)"
  exit 0
fi

DESELECT=()
for node in "${QUARANTINED[@]}"; do
  DESELECT+=(--deselect "$node")
done

echo "==> GATING tier: backend/ minus ${#QUARANTINED[@]} quarantined test(s)"
set +e
"$PY" -m pytest backend/ tools/ -q -p no:cacheprovider --tb=short -rfE "${DESELECT[@]}"
RC=$?
set -e

# pytest exit 5 means zero tests were collected. A green gate that ran nothing is
# a silent failure, and silent failure is the entire reason this file exists.
if [[ "$RC" -eq 5 ]]; then
  echo "ERROR: pytest collected no tests (exit 5). The gate ran nothing." >&2
  exit 1
fi
if [[ "$RC" -ne 0 ]]; then
  echo "ERROR: backend test gate failed (exit $RC)." >&2
  exit "$RC"
fi

echo "==> backend-tests: PASS"
