"""
run.py  —  BreakingAlpha pipeline orchestrator
Order: ingest → synthesize → extract deals → observe → critique → audit →
       trend_map → summarize → thesis_grader → pattern_memory →
       source_credibility → adversarial

Gating:
  - thesis_grader / pattern_memory / source_credibility → morning runs only
  - adversarial → Sunday morning only (weekly)
"""

import logging
import sys
from datetime import datetime, timezone

from ingest import run_ingestion as run_ingest
from synthesize import run as run_synthesize
from deal_extractor import run as run_deal_extractor
import observe
import critique
import audit
import trend_mapper
import summarize
import thesis_grader
import pattern_memory
import source_credibility
import adversarial

logger = logging.getLogger("run")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format="%(message)s")


def _is_sunday_morning(brief_type: str) -> bool:
    return (
        brief_type == "morning"
        and datetime.now(timezone.utc).weekday() == 6
    )


if __name__ == "__main__":
    brief_type = sys.argv[1] if len(sys.argv) > 1 else "morning"
    started_at = datetime.now(timezone.utc)

    print("=" * 50)
    print(f"🌅 BreakingAlpha Pipeline — {brief_type.upper()} RUN")
    print("=" * 50)

    print("\n[1/12] INGEST")
    ingest_count = run_ingest()

    print("\n[2/12] SYNTHESIZE")
    run_synthesize(brief_type)

    print("\n[3/12] DEAL EXTRACTION")
    run_deal_extractor()

    print("\n[4/12] OBSERVE")
    run_id = None
    try:
        run_id = observe.record_run(brief_type, started_at, ingest_count=ingest_count)
    except Exception as e:
        print(f"  ⚠ Observer failed (pipeline unaffected): {e}")

    print("\n[5/12] CRITIQUE")
    try:
        critique.score_run(brief_type, started_at, run_id=run_id)
    except Exception as e:
        print(f"  ⚠ Critic failed (pipeline unaffected): {e}")

    print("\n[6/12] AUDIT")
    try:
        audit.audit_run(brief_type, run_id=run_id)
    except Exception as e:
        print(f"  ⚠ Auditor failed (pipeline unaffected): {e}")

    print("\n[7/12] TREND MAP")
    try:
        trend_mapper.map_trends(brief_type, started_at, run_id=run_id)
    except Exception as e:
        print(f"  ⚠ Trend Mapper failed (pipeline unaffected): {e}")

    print("\n[8/12] SUMMARY")
    try:
        summarize.print_summary(brief_type, run_id=run_id)
    except Exception as e:
        print(f"  ⚠ Summary failed (pipeline unaffected): {e}")

    print("\n[9/12] THESIS GRADING")
    if brief_type == "morning":
        try:
            thesis_grader.main()
        except Exception as e:
            logger.warning("thesis_grader step failed: %s", e)
    else:
        logger.info("thesis_grader: skipped (morning only)")

    print("\n[10/12] PATTERN MEMORY")
    if brief_type == "morning":
        try:
            pattern_memory.main()
        except Exception as e:
            logger.warning("pattern_memory step failed: %s", e)
    else:
        logger.info("pattern_memory: skipped (morning only)")

    print("\n[11/12] SOURCE CREDIBILITY")
    if brief_type == "morning":
        try:
            source_credibility.main()
        except Exception as e:
            logger.warning("source_credibility step failed: %s", e)
    else:
        logger.info("source_credibility: skipped (morning only)")

    print("\n[12/12] ADVERSARIAL REVIEW")
    if _is_sunday_morning(brief_type):
        try:
            adversarial.main()
        except Exception as e:
            logger.warning("adversarial step failed: %s", e)
    else:
        logger.info("adversarial: skipped (Sunday morning only)")

    print("\n" + "=" * 50)
    print("✅ Pipeline complete")
    print("=" * 50)
