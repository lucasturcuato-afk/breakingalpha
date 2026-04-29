"""
run.py  —  BreakingAlpha pipeline orchestrator
Order: ingest → extract deals → synthesize → observe → critique → audit →
       trend_map → summarize → thesis_grader → pattern_memory →
       source_credibility → adversarial → watchlist_sync

Ordering note (Path B):
  deal_extractor is intentionally run BEFORE synthesize so the Python
  pre-picker in lead_preselect.py can see today's fresh deal_flow rows
  when choosing the primary_story. Prior to Path B the order was
  ingest → synthesize → deal_extractor; deals were extracted after the
  brief had already been written.

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
import user_signal_aggregator
import embedding_job
import thesis_generator

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

    print("\n[1c/15] USER SIGNAL AGGREGATION")
    try:
        user_signal_aggregator.main()
    except Exception as e:
        print(f"  ⚠ User signal aggregation failed (pipeline unaffected): {e}")

    # Path B: deal_extractor runs BEFORE synthesize so the Python pre-picker
    # in lead_preselect.py sees fresh deal_flow rows for the $1B+ primary-story
    # filter. See SPEC_path_b_lead_preselect.md §2 and §8.
    print("\n[2/15] DEAL EXTRACTION")
    deal_extractor_status = {"ok": True, "error": None, "upserted": 0}
    try:
        result = run_deal_extractor() or {}
        deal_extractor_status["upserted"] = result.get("upserted", 0)
        if deal_extractor_status["upserted"] == 0:
            deal_extractor_status["ok"] = False
            deal_extractor_status["error"] = "deal_extractor wrote 0 rows"
    except Exception as e:
        deal_extractor_status["ok"] = False
        deal_extractor_status["error"] = f"deal_extractor raised: {e}"
        print(f"  ⚠ Deal Extractor failed (pipeline continues, lead_preselect may fall back): {e}")

    print("\n[3/15] SYNTHESIZE")
    synth_result = run_synthesize(brief_type) or {}

    # Snapshot lead_preselect's per-run decision log for observability.
    # Populated inside synthesize.run() via preselect_primary_story();
    # threaded into pipeline_runs so v2 calibration has empirical data.
    preselect_decision = {}
    try:
        import lead_preselect
        preselect_decision = dict(getattr(lead_preselect, "_LAST_DECISION_LOG", {}) or {})
    except Exception as e:
        print(f"  ⚠ preselect decision log read failed (pipeline unaffected): {e}")

    print("\n[4/15] OBSERVE")
    run_id = None
    try:
        run_id = observe.record_run(
            brief_type,
            started_at,
            ingest_count=ingest_count,
            deal_extractor_status=deal_extractor_status,
            preselect_decision=preselect_decision,
        )
    except Exception as e:
        print(f"  ⚠ Observer failed (pipeline unaffected): {e}")

    print("\n[5/15] CRITIQUE")
    try:
        critique.score_run(brief_type, started_at, run_id=run_id)
    except Exception as e:
        print(f"  ⚠ Critic failed (pipeline unaffected): {e}")

    print("\n[6/15] AUDIT")
    try:
        audit.audit_run(brief_type, run_id=run_id)
    except Exception as e:
        print(f"  ⚠ Auditor failed (pipeline unaffected): {e}")

    print("\n[7/15] TREND MAP")
    try:
        trend_mapper.map_trends(brief_type, started_at, run_id=run_id)
    except Exception as e:
        print(f"  ⚠ Trend Mapper failed (pipeline unaffected): {e}")

    print("\n[8/15] SUMMARY")
    try:
        summarize.print_summary(brief_type, run_id=run_id)
    except Exception as e:
        print(f"  ⚠ Summary failed (pipeline unaffected): {e}")

    print("\n[9/15] THESIS GRADING")
    if brief_type == "morning":
        try:
            thesis_grader.main()
        except Exception as e:
            logger.warning("thesis_grader step failed: %s", e)
    else:
        logger.info("thesis_grader: skipped (morning only)")

    print("\n[10/15] PATTERN MEMORY")
    if brief_type == "morning":
        try:
            pattern_memory.main()
        except Exception as e:
            logger.warning("pattern_memory step failed: %s", e)
    else:
        logger.info("pattern_memory: skipped (morning only)")

    print("\n[11/15] SOURCE CREDIBILITY")
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

    print("\n[14/16] CONTENT EMBEDDINGS (RAG)")
    try:
        embedding_job.main()
    except Exception as e:
        logger.warning("embedding_job step failed (pipeline unaffected): %s", e)

    print("\n[15/16] USER-AWARE BRIEF PERSONALIZATION")
    try:
        user_synthesis.run(brief_type)
    except Exception as e:
        logger.warning("user_synthesis step failed (pipeline unaffected): %s", e)

    print("\n[16/16] THESIS GENERATION (system, semantic dedup)")
    if brief_type == "morning":
        try:
            thesis_generator.main()
        except Exception as e:
            logger.warning("thesis_generator step failed (pipeline unaffected): %s", e)
    else:
        logger.info("thesis_generator: skipped (morning only)")

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
# 1c:   user_signal_aggregator  (aggregate user behavioral events → digest)
# 2:    deal_extractor          (MUST run before synthesize — Path B pre-picker
#                                reads deal_flow for confirmed $1B+ leads)
# 3:    synthesize              (consumes user_signal_digest for engagement context
#                                and deal_flow for lead_preselect)
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
# 14:   embedding_job        (RAG content embeddings for Intelligence chat)
# 15:   user_synthesis       (Lucas personalization sprint — per-user addendum)
# 16:   thesis_generator     (morning only — system theses, semantic dedup)
# [POST] brief scoring, brief improvement addendum
# ---------------------------------------------------------------------------
