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
#   GATING     everything not listed in backend/tests/known_failures.txt. Any
#              failure here fails the build.
#   QUARANTINE exactly the node ids in that file. Printed, never blocking.
#
# The two tiers are kept VISUALLY DISTINCT in the log, and that is not cosmetic.
# Both print pytest output, both can print red FAILED lines, and a GitHub
# Actions log is read as plain uncoloured text with no idea which step you have
# landed in. A reader debugging a red job once followed the quarantine tier's 13
# FAILED lines and its trailing exit code, reported them as the cause, and was
# wrong: the real failure was one test far above. So every line of pytest output
# is tagged with the tier that produced it, [gate] or [quarantined], each tier
# opens with a banner saying whether it can fail the build, and the quarantine
# tier no longer prints an exit code it does not propagate.
#
# A job that is red on day one gets disabled within a day, so the pre-existing
# failures are quarantined by node id rather than by ignoring whole files. That
# keeps the passing tests inside those same files in the gate.
#
# Usage:
#   bash scripts/backend-tests.sh           gate only, exits non-zero on failure
#   bash scripts/backend-tests.sh --report  run only the quarantined tests,
#                                          always exits 0
#
# No secrets, no network, no run.py dispatch. Python 3.11 to match CI and run.py.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

KNOWN_FAILURES="backend/tests/known_failures.txt"
PY="${PYTHON:-python3}"

RULE="======================================================================"

# Tag every line of a stream with the tier that produced it. A reader who lands
# in the middle of a CI log, or greps it, can then tell a gate failure from a
# quarantined one without scrolling to any header. A bash read loop rather than
# sed: line-buffered `sed -u` is GNU-only and `sed -l` is BSD-only, and this
# script has to run on macOS bash 3.2 as well as in CI.
prefix_stream() {
  local tag="$1" line
  while IFS= read -r line || [[ -n "$line" ]]; do
    printf '%s %s\n' "$tag" "$line"
  done
}

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
  echo "$RULE"
  echo "  QUARANTINE TIER. NOT THE GATE. THIS STEP CANNOT FAIL THE BUILD."
  echo "$RULE"
  echo "  Every FAILED line below is KNOWN and PRE-EXISTING. It is listed by"
  echo "  node id in $KNOWN_FAILURES and printed here"
  echo "  on purpose, so the debt stays visible instead of being forgotten the"
  echo "  moment the gate goes green. EVERY LINE IS A DEBT. Delete it when the"
  echo "  test is fixed."
  echo
  echo "  IF YOU ARE DEBUGGING A RED JOB, THE CAUSE IS NOT IN THIS STEP."
  echo "  Everything this tier prints is tagged [quarantined]. The build gate is"
  echo "  a separate step and tags its output [gate]; its failures are the ones"
  echo "  that turned the job red."
  echo
  echo "  Quarantined test(s): ${#QUARANTINED[@]}"
  echo "$RULE"
  echo
  if [[ "${#QUARANTINED[@]}" -eq 0 ]]; then
    echo "  None. The quarantine is empty, so promote the gate to the full suite"
    echo "  and delete this tier."
    exit 0
  fi
  set +e
  "$PY" -m pytest "${QUARANTINED[@]}" -p no:cacheprovider --tb=line -rfE 2>&1 \
    | prefix_stream "[quarantined]"
  RC=${PIPESTATUS[0]}
  set -e
  echo
  echo "$RULE"
  # No exit code is printed here on purpose. This tier always exits 0, so the
  # pytest status is not this step's outcome, and printing it was read as one.
  if [[ "$RC" -eq 0 ]]; then
    echo "  QUARANTINE TIER: all ${#QUARANTINED[@]} quarantined test(s) now PASS."
    echo "  Delete their lines from $KNOWN_FAILURES so"
    echo "  the gate covers them again."
  else
    echo "  QUARANTINE TIER: the debt above is still open,"
    echo "  ${#QUARANTINED[@]} line(s) in $KNOWN_FAILURES."
    echo "  Build not affected. This step is non-blocking by design."
  fi
  echo "$RULE"
  exit 0
fi

DESELECT=()
for node in "${QUARANTINED[@]}"; do
  DESELECT+=(--deselect "$node")
done

echo "$RULE"
echo "  GATING TIER. THIS IS THE BUILD GATE. A FAILURE HERE FAILS THE BUILD."
echo "$RULE"
echo "  Scope: backend/ and tools/, minus the ${#QUARANTINED[@]} test(s) quarantined in"
echo "  $KNOWN_FAILURES."
echo "  Everything this tier prints is tagged [gate]."
echo "$RULE"
set +e
"$PY" -m pytest backend/ tools/ -q -p no:cacheprovider --tb=short -rfE "${DESELECT[@]}" 2>&1 \
  | prefix_stream "[gate]"
RC=${PIPESTATUS[0]}
set -e

# pytest exit 5 means zero tests were collected. A green gate that ran nothing is
# a silent failure, and silent failure is the entire reason this file exists.
if [[ "$RC" -eq 5 ]]; then
  echo "$RULE"
  echo "  GATE FAILURE. THIS IS WHAT FAILED THE BUILD."
  echo "$RULE"
  echo "  pytest collected no tests (exit 5). The gate ran nothing, so a green"
  echo "  result would have been a lie. Treated as a hard failure."
  echo "$RULE"
  echo "ERROR: pytest collected no tests (exit 5). The gate ran nothing." >&2
  exit 1
fi
if [[ "$RC" -ne 0 ]]; then
  echo "$RULE"
  echo "  GATE FAILURE. THIS IS WHAT FAILED THE BUILD."
  echo "$RULE"
  echo "  The cause is a [gate] FAILED line above, in this step. pytest exit $RC."
  echo "  The quarantined tests are printed by a separate, non-blocking step and"
  echo "  are tagged [quarantined]. They can never cause this."
  echo "$RULE"
  echo "ERROR: backend test gate failed (exit $RC)." >&2
  exit "$RC"
fi

echo "$RULE"
echo "  GATING TIER: PASS. The build gate is green."
echo "$RULE"
