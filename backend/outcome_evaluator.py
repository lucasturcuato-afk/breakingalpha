"""
Outcome Evaluator — nightly grading job.

Reads outputs that have aged into a grading window and writes grades
to the output_grades table. Updates the outputs mirror columns.

Usage:
    python backend/outcome_evaluator.py
    python backend/outcome_evaluator.py --dry-run
    python backend/outcome_evaluator.py --output-types memo,brief_section
    python backend/outcome_evaluator.py --force-window 30
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime, timezone

from supabase import create_client

# Flexible imports — support both `python backend/outcome_evaluator.py`
# and `python -m backend.outcome_evaluator`
try:
    from outcome.router import GRADER_REGISTRY, WINDOWS_BY_TYPE, TIER_1_TYPES, TIER_2_TYPES
    from outcome.cost_tracker import CostTracker
    from outcome.types import soft_fail_grade
except ImportError:
    from backend.outcome.router import GRADER_REGISTRY, WINDOWS_BY_TYPE, TIER_1_TYPES, TIER_2_TYPES
    from backend.outcome.cost_tracker import CostTracker
    from backend.outcome.types import soft_fail_grade

logger = logging.getLogger(__name__)

# ── Defaults ──────────────────────────────────────────────────────────
DEFAULT_LIMIT_PER_WINDOW = 200
COST_ABORT_DEFAULT = 5.0


# ── Query: find outputs ready for grading ─────────────────────────────

def find_outputs_ready_for_grading(
    sb,
    output_type: str,
    window_days: int,
    limit: int = DEFAULT_LIMIT_PER_WINDOW,
) -> list[dict]:
    """
    Find outputs of the given type that:
    1. Are at least `window_days` old
    2. Don't yet have an output_grades row for this (output_id, window_days)
    """
    try:
        cutoff = datetime.now(timezone.utc).isoformat()

        # Step 1: Get candidate output IDs that are old enough
        candidates_resp = (
            sb.table("outputs")
            .select("id, output_type, content, generation_context, source_table, source_id, user_id, created_at")
            .eq("output_type", output_type)
            .lte("created_at", _window_cutoff(window_days))
            .order("created_at", desc=False)
            .limit(limit * 2)  # over-fetch to account for already-graded
            .execute()
        )
        candidates = candidates_resp.data or []
        if not candidates:
            return []

        # Step 2: Check which are already graded at this window
        candidate_ids = [c["id"] for c in candidates]
        graded_resp = (
            sb.table("output_grades")
            .select("output_id")
            .in_("output_id", candidate_ids)
            .eq("window_days", window_days)
            .execute()
        )
        already_graded = {r["output_id"] for r in (graded_resp.data or [])}

        # Step 3: Filter to ungraded, cap at limit
        ready = [c for c in candidates if c["id"] not in already_graded]
        return ready[:limit]

    except Exception as e:
        logger.error("outcome_evaluator: find_ready failed for %s@%dd: %s", output_type, window_days, e)
        return []


def _window_cutoff(window_days: int) -> str:
    """Return ISO timestamp for `now - window_days`."""
    from datetime import timedelta
    return (datetime.now(timezone.utc) - timedelta(days=window_days)).isoformat()


# ── Grade one output ──────────────────────────────────────────────────

def grade_one(sb, output: dict, output_type: str, window_days: int, cost_tracker) -> 'GradeResult | None':
    grader = GRADER_REGISTRY.get(output_type)
    if not grader:
        logger.warning("outcome_evaluator: no grader for %s, skipping", output_type)
        return None
    try:
        result = grader(sb, output, window_days)
        cost_tracker.add(output_type, result.cost_usd or 0.0)
        return result
    except Exception as e:
        logger.error(
            "outcome_evaluator: grader %s failed on %s: %s",
            output_type, output.get("id", "?"), e,
            exc_info=True,
        )
        return None


# ── Write grade to DB ─────────────────────────────────────────────────

def write_grade(sb, result) -> bool:
    """Insert into output_grades. Update outputs mirror if this is an improvement."""
    try:
        # Insert grade (UNIQUE constraint prevents duplicates)
        sb.table("output_grades").insert(result.to_dict()).execute()

        # Mirror: only overwrite if new window >= existing window
        # Fetch current mirror state
        current = (
            sb.table("outputs")
            .select("outcome_window_days")
            .eq("id", result.output_id)
            .limit(1)
            .execute()
        )
        current_window = 0
        if current.data and current.data[0].get("outcome_window_days"):
            current_window = current.data[0]["outcome_window_days"]

        if result.window_days >= current_window:
            sb.table("outputs").update({
                "outcome_window_days": result.window_days,
                "outcome_evidence": result.evidence_data,
                "outcome_checked_at": result.graded_at,
                "outcome_grader_version": result.grader_version,
            }).eq("id", result.output_id).execute()

        return True
    except Exception as e:
        # Duplicate key (already graded) is expected in concurrent runs
        if "duplicate" in str(e).lower() or "unique" in str(e).lower():
            logger.info("outcome_evaluator: duplicate grade for %s@%dd, skipping", result.output_id, result.window_days)
            return True
        logger.error("outcome_evaluator: write_grade failed for %s: %s", result.output_id, e)
        return False


# ── Main orchestrator ─────────────────────────────────────────────────

def run(
    dry_run: bool = False,
    output_types: list[str] | None = None,
    force_window: int | None = None,
) -> dict:
    sb = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )
    cost_tracker = CostTracker(
        abort_ceiling_usd=float(os.environ.get("COST_ABORT_USD", str(COST_ABORT_DEFAULT)))
    )

    types_to_process = output_types or list(WINDOWS_BY_TYPE.keys())

    # Priority ordering: deterministic (free) first, then LLM graders
    ordered_types = (
        [t for t in types_to_process if t in TIER_1_TYPES]
        + [t for t in types_to_process if t in TIER_2_TYPES]
    )
    # Include any unrecognized types at the end
    ordered_types += [t for t in types_to_process if t not in ordered_types]

    total_graded = 0
    total_failed = 0
    total_skipped = 0
    started_at = datetime.now(timezone.utc)

    for output_type in ordered_types:
        if cost_tracker.should_abort():
            logger.warning(
                "outcome_evaluator: cost ceiling reached ($%.4f), aborting",
                cost_tracker.total_cost,
            )
            break

        windows = [force_window] if force_window else WINDOWS_BY_TYPE.get(output_type, [])
        for window in windows:
            if cost_tracker.should_abort():
                break

            ready = find_outputs_ready_for_grading(sb, output_type, window)
            logger.info(
                "outcome_evaluator: %s @ %dd: %d ready",
                output_type, window, len(ready),
            )

            for output in ready:
                if cost_tracker.should_abort():
                    break

                result = grade_one(sb, output, output_type, window, cost_tracker)
                if not result:
                    total_failed += 1
                    continue

                if dry_run:
                    logger.info(
                        "outcome_evaluator: DRY RUN %s @ %dd → %s (score=%s, cost=$%.4f)",
                        output["id"][:8], window, result.verdict,
                        result.score, result.cost_usd or 0,
                    )
                    total_skipped += 1
                else:
                    if write_grade(sb, result):
                        total_graded += 1
                        logger.info(
                            "outcome_evaluator: graded %s @ %dd → %s (score=%s)",
                            output["id"][:8], window, result.verdict, result.score,
                        )
                    else:
                        total_failed += 1

    # Record run in pipeline_runs
    completed_at = datetime.now(timezone.utc)
    summary = {
        "graded": total_graded,
        "failed": total_failed,
        "skipped": total_skipped,
        "dry_run": dry_run,
        "cost": cost_tracker.summary(),
        "duration_s": round((completed_at - started_at).total_seconds(), 1),
    }

    if not dry_run:
        try:
            sb.table("pipeline_runs").insert({
                "brief_type": "outcome_evaluator",
                "started_at": started_at.isoformat(),
                "completed_at": completed_at.isoformat(),
                "duration_s": (completed_at - started_at).total_seconds(),
                "status": "aborted_cost" if cost_tracker.should_abort() else "success",
                "selected_count": total_graded,
                "error_notes": str(cost_tracker.summary()),
            }).execute()
        except Exception as e:
            logger.error("outcome_evaluator: pipeline_runs logging failed: %s", e)

    logger.info("outcome_evaluator: complete — %s", summary)
    return summary


# ── CLI entry point ───────────────────────────────────────────────────

def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Outcome Evaluator — grade outputs against reality.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Log what would be graded without writing to DB.",
    )
    parser.add_argument(
        "--output-types",
        help="Comma-separated output types to grade (default: all).",
    )
    parser.add_argument(
        "--force-window",
        type=int,
        help="Force a specific window (e.g. 30) instead of the type's default windows.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )
    args = _parse_args()
    types = args.output_types.split(",") if args.output_types else None
    result = run(
        dry_run=args.dry_run,
        output_types=types,
        force_window=args.force_window,
    )
    print(f"outcome_evaluator: {result}")
    sys.exit(0)  # Always exit 0 — observability, not halting CI
