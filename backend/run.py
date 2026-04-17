"""
run.py  —  BreakingAlpha pipeline orchestrator
Order: ingest → synthesize → extract deals → observe → critique → audit →
       trend_map → summarize → thesis_grader → pattern_memory →
       source_credibility → adversarial → watchlist_sync

Gating:
  - thesis_grader / pattern_memory / source_credibility → morning runs only
  - adversarial → Sunday morning only (weekly)
"""

import logging
import os
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
import watchlist_sync
import user_synthesis

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

    # Optional backfill: RUN_BACKFILL=true python backend/run.py
    if os.getenv("RUN_BACKFILL", "false").lower() == "true":
        print("\n[1b/12] CONTENT BACKFILL")
        try:
            import backfill_content
            backfill_content.main()
        except Exception as e:
            print(f"  ⚠ Backfill failed (pipeline unaffected): {e}")

    print("\n[2/12] SYNTHESIZE")
    synth_result = run_synthesize(brief_type) or {}

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

    print("\n[12/14] ADVERSARIAL REVIEW")
    if _is_sunday_morning(brief_type):
        try:
            adversarial.main()
        except Exception as e:
            logger.warning("adversarial step failed: %s", e)
    else:
        logger.info("adversarial: skipped (Sunday morning only)")

    print("\n[13/14] WATCHLIST ARTICLE SYNC")
    try:
        watchlist_sync.run_sync()
    except Exception as e:
        logger.warning("watchlist sync failed (pipeline unaffected): %s", e)

    print("\n[14/14] USER-AWARE BRIEF PERSONALIZATION")
    try:
        user_synthesis.run(brief_type)
    except Exception as e:
        logger.warning("user_synthesis step failed (pipeline unaffected): %s", e)

    # --- Brief feedback loop: score the just-generated brief (soft-fail) ---
    print("\n[POST] BRIEF SCORING")
    try:
        from brief_feedback_loop import score_brief
        brief_text = synth_result.get("brief_text", "")
        if brief_text:
            score_brief(brief_text, brief_type, run_id)
        else:
            logger.info("brief scoring: skipped (no brief text available)")
    except Exception as e:
        logger.warning("brief scoring skipped: %s", e)

    # --- Build improvement addenda once daily (morning run only, soft-fail) ---
    if brief_type == "morning":
        print("\n[POST] BRIEF IMPROVEMENT ADDENDUM")
        try:
            from brief_feedback_loop import build_brief_improvement_addendum
            for bt in ("morning", "evening"):
                addendum = build_brief_improvement_addendum(bt)
                if addendum:
                    # Cache into the most recent weekly_digests row
                    col = f"{bt}_brief_addendum"
                    try:
                        from supabase import create_client as _sc
                        import os as _os
                        _sb = _sc(_os.environ["SUPABASE_URL"], _os.environ["SUPABASE_ANON_KEY"])
                        latest = (
                            _sb.table("weekly_digests")
                            .select("id")
                            .order("generated_at", desc=True)
                            .limit(1)
                            .execute()
                        )
                        if latest.data:
                            _sb.table("weekly_digests").update(
                                {col: addendum}
                            ).eq("id", latest.data[0]["id"]).execute()
                            logger.info("brief addendum cached: %s (%d chars)", bt, len(addendum))
                    except Exception as e2:
                        logger.warning("brief addendum cache write failed for %s: %s", bt, e2)
        except Exception as e:
            logger.warning("brief addendum build skipped: %s", e)

    print("\n" + "=" * 50)
    print("✅ Pipeline complete")
    print("=" * 50)

# ---------------------------------------------------------------------------
# STEP MANIFEST — canonical pipeline order (update when adding steps)
# ---------------------------------------------------------------------------
# 1:    ingest
# 2:    synthesize
# 3:    deal_extractor
# 4:    observe
# 5:    critique
# 6:    audit
# 7:    trend_mapper
# 8:    summarize
# 9:    thesis_grader        (morning only)
# 10:   pattern_memory       (morning only)
# 11:   source_credibility   (morning only)
# 12:   adversarial          (Sunday morning only)
# 13:   watchlist_sync       (V3A — Noah)
# 14:   user_synthesis       (Lucas personalization sprint — per-user addendum)
# [POST] brief scoring, brief improvement addendum
# ---------------------------------------------------------------------------
