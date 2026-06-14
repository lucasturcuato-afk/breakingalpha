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
never prevents the next from running. Infrastructure failures (DB
unreachable, missing env var) exit non-zero to trigger GitHub workflow
notifications; per-thesis errors are soft-fail (exit 0).
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Any

# TODO: pattern_memory.py and source_credibility.py read SUPABASE_ANON_KEY
# at module level. New code in this file uses SUPABASE_SERVICE_ROLE_KEY
# (best practice). Migration of these remaining modules deferred to a
# separate PR. (thesis_grader.py now uses get_service_client.)

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
from grading import live_score as live_score_mod  # noqa: E402


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


def _log_pipeline_run(started_at: datetime, summary: dict, status: str) -> None:
    """Record this run in pipeline_runs (mirrors outcome_evaluator.py pattern)."""
    try:
        from supabase import create_client

        sb = create_client(
            os.environ["SUPABASE_URL"],
            os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        )
        completed_at = datetime.now(timezone.utc)
        grader_summary = summary.get("grader") or {}
        graded = 0
        if isinstance(grader_summary, dict):
            try:
                graded = int(grader_summary.get("graded") or 0)
            except Exception:
                pass

        sb.table("pipeline_runs").insert({
            "brief_type": "daily_grading",
            "started_at": started_at.isoformat(),
            "completed_at": completed_at.isoformat(),
            "duration_s": (completed_at - started_at).total_seconds(),
            "status": status,
            "selected_count": graded,
            "error_notes": str(summary),
        }).execute()
    except Exception as e:
        logger.error("daily_grading: pipeline_runs logging failed: %s", e)


def main(force: bool = False) -> dict:
    """Run grader → patterns → credibility and return a summary dict."""
    logging.basicConfig(level=logging.INFO)
    print(f"  [daily_grading] starting (force={force})")
    started_at = datetime.now(timezone.utc)

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

    # Continuous in-flight grading. Refreshes live_score / live_verdict /
    # live_score_updated_at on every non-locked thesis, regardless of whether
    # the grader produced a terminal verdict this cycle. See
    # docs/track-record-investigation.md §5–§6 for the formula and cadence
    # rationale, and sql/live_score_columns.sql for the required DDL (the
    # update is soft-fail: if the columns are missing, each persist warns and
    # the loop keeps going).
    live_score_summary = _run_step(
        "live_score", live_score_mod.update_all_live_scores
    )

    summary = {
        "grader": grader_summary,
        "patterns": patterns_summary,
        "sources": sources_summary,
        "live_score": live_score_summary,
    }
    print(
        "daily_grading: grader={grader} patterns={patterns} sources={sources} "
        "live_score={live_score}".format(
            grader=grader_summary,
            patterns=patterns_summary,
            sources=sources_summary,
            live_score=live_score_summary,
        )
    )
    logger.info(
        "daily_grading: grader=%s patterns=%s sources=%s live_score=%s",
        grader_summary,
        patterns_summary,
        sources_summary,
        live_score_summary,
    )

    _log_pipeline_run(started_at, summary, status="success")
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
    _started = datetime.now(timezone.utc)
    try:
        main(force=args.force or env_force)
    except Exception as exc:
        # Infrastructure failure (DB unreachable, missing env var, import error).
        # Log to pipeline_runs and exit non-zero so the GitHub notification fires.
        logger.exception("daily_grading: infrastructure failure: %s", exc)
        _log_pipeline_run(
            _started,
            {"error": str(exc)},
            status="failed",
        )
        sys.exit(1)
    # Per-thesis errors are logged inside _run_step and don't crash the run.
    sys.exit(0)
