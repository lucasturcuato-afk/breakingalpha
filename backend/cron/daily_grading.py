"""
daily_grading.py — Signalera daily grading orchestrator (Track A)

Standalone wrapper that runs the grading trifecta in sequence:

    thesis_grader.main(force=...)   → pattern_memory.main() → source_credibility.main()

Designed to be invoked from `.github/workflows/grading.yml` on a daily
schedule, via `workflow_dispatch`, or via a `repository_dispatch` event
fired from `POST /api/grading/trigger` (cron-job.org → Vercel → GitHub).

Intentionally does NOT modify `backend/run.py` — Noah's main pipeline is
Lucas-protected. This script is the grading track's independent entry
point so its blast radius stays small.

CLI
---
    python backend/cron/daily_grading.py            # normal daily run
    python backend/cron/daily_grading.py --force    # skip overdue gate

Also honours the env var ``DAILY_GRADING_FORCE=true`` so the workflow
can pass the flag through the environment if preferred.

Each stage is wrapped in its own try/except so a failure in one module
never prevents the next from running. The script always exits 0 — the
goal is observability, not halting CI.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from typing import Any


# --- Path + env bootstrap --------------------------------------------------
# Make sibling backend modules importable regardless of cwd. The workflow
# runs with `working-directory: backend`, but local invocations like
# `python backend/cron/daily_grading.py` need the same modules on path too.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Load env from backend/.env if present (mirrors backend/run.py convention).
try:
    from dotenv import load_dotenv  # type: ignore

    _env_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        ".env",
    )
    if os.path.isfile(_env_path):
        load_dotenv(_env_path)
except Exception:
    # dotenv is optional; env vars may come from the GitHub Actions env block.
    pass


import thesis_grader  # noqa: E402
import pattern_memory  # noqa: E402
import source_credibility  # noqa: E402


logger = logging.getLogger(__name__)


def _run_step(name: str, fn) -> Any:
    """Run a pipeline step with soft-fail semantics. Returns the step's
    return value (typically a summary dict) or ``None`` on failure."""
    try:
        return fn()
    except Exception as e:  # soft-fail to match existing backend pattern
        logger.exception("daily_grading: step %s crashed: %s", name, e)
        print(f"  ⚠ daily_grading: step {name} crashed: {e}")
        return None


def main(force: bool = False) -> dict:
    """Run grader → patterns → credibility and return a summary dict."""
    logging.basicConfig(level=logging.INFO)
    print(f"  [daily_grading] starting (force={force})")

    grader_summary = _run_step(
        "thesis_grader",
        lambda: thesis_grader.main(force=force),
    )

    graded = 0
    if isinstance(grader_summary, dict):
        try:
            graded = int(grader_summary.get("graded") or 0)
        except Exception:
            graded = 0

    if graded > 0:
        print(f"  [daily_grading] grader produced {graded} new verdicts")
    else:
        # pattern_memory + source_credibility are idempotent and cheap — run
        # them anyway so the aggregate tables stay consistent even when the
        # grader skipped (e.g. nothing overdue, or first-boot with 0 rows).
        print(
            "  [daily_grading] grader returned no new verdicts — still running aggregators"
        )

    patterns_summary = _run_step("pattern_memory", pattern_memory.main)
    sources_summary = _run_step("source_credibility", source_credibility.main)

    summary = {
        "grader": grader_summary,
        "patterns": patterns_summary,
        "sources": sources_summary,
    }
    print(
        "daily_grading: grader={grader} patterns={patterns} sources={sources}".format(
            grader=grader_summary,
            patterns=patterns_summary,
            sources=sources_summary,
        )
    )
    logger.info(
        "daily_grading: grader=%s patterns=%s sources=%s",
        grader_summary,
        patterns_summary,
        sources_summary,
    )
    return summary


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the Signalera daily grading pipeline (grader → patterns → credibility)."
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Bypass the overdue gate in thesis_grader (backfill / manual run).",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    env_force = os.environ.get("DAILY_GRADING_FORCE", "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    main(force=args.force or env_force)
    # Always exit 0 — the point is observability, not halting CI.
    sys.exit(0)
