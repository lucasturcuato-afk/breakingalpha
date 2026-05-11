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
import time
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

    pipeline_t0 = time.time()

    print("\n[1/16] INGEST")
    _t = time.time()
    ingest_count = run_ingest()
    print(f"  [1/16] INGEST done in {time.time() - _t:.2f}s")

    # Optional backfill: RUN_BACKFILL=true python backend/run.py
    if os.getenv("RUN_BACKFILL", "false").lower() == "true":
        print("\n[1b/16] CONTENT BACKFILL")
        _t = time.time()
        try:
            import backfill_content
            backfill_content.main()
            print(f"  [1b/16] CONTENT BACKFILL done in {time.time() - _t:.2f}s")
        except Exception as e:
            print(f"  [1b/16] CONTENT BACKFILL FAILED in {time.time() - _t:.2f}s (pipeline unaffected): {e}")

    print("\n[1c/16] USER SIGNAL AGGREGATION")
    _t = time.time()
    try:
        user_signal_aggregator.main()
        print(f"  [1c/16] USER SIGNAL AGGREGATION done in {time.time() - _t:.2f}s")
    except Exception as e:
        print(f"  [1c/16] USER SIGNAL AGGREGATION FAILED in {time.time() - _t:.2f}s (pipeline unaffected): {e}")

    # Path B: deal_extractor runs BEFORE synthesize so the Python pre-picker
    # in lead_preselect.py sees fresh deal_flow rows for the $1B+ primary-story
    # filter. See SPEC_path_b_lead_preselect.md sections 2 and 8.
    print("\n[2/16] DEAL EXTRACTION")
    _t = time.time()
    deal_extractor_status = {"ok": True, "error": None, "upserted": 0}
    try:
        result = run_deal_extractor() or {}
        deal_extractor_status["upserted"] = result.get("upserted", 0)
        if deal_extractor_status["upserted"] == 0:
            deal_extractor_status["ok"] = False
            deal_extractor_status["error"] = "deal_extractor wrote 0 rows"
        print(f"  [2/16] DEAL EXTRACTION done in {time.time() - _t:.2f}s (upserted={deal_extractor_status['upserted']})")
    except Exception as e:
        deal_extractor_status["ok"] = False
        deal_extractor_status["error"] = f"deal_extractor raised: {e}"
        print(f"  [2/16] DEAL EXTRACTION FAILED in {time.time() - _t:.2f}s (pipeline continues, lead_preselect may fall back): {e}")

    print("\n[3/16] SYNTHESIZE")
    _t = time.time()
    synth_result = run_synthesize(brief_type) or {}
    print(f"  [3/16] SYNTHESIZE done in {time.time() - _t:.2f}s")

    # Snapshot lead_preselect's per-run decision log for observability.
    # Populated inside synthesize.run() via preselect_primary_story();
    # threaded into pipeline_runs so v2 calibration has empirical data.
    preselect_decision = {}
    try:
        import lead_preselect
        preselect_decision = dict(getattr(lead_preselect, "_LAST_DECISION_LOG", {}) or {})
    except Exception as e:
        print(f"  ⚠ preselect decision log read failed (pipeline unaffected): {e}")

    print("\n[4/16] OBSERVE")
    _t = time.time()
    run_id = None
    try:
        run_id = observe.record_run(
            brief_type,
            started_at,
            ingest_count=ingest_count,
            deal_extractor_status=deal_extractor_status,
            preselect_decision=preselect_decision,
        )
        print(f"  [4/16] OBSERVE done in {time.time() - _t:.2f}s (run_id={run_id})")
    except Exception as e:
        print(f"  [4/16] OBSERVE FAILED in {time.time() - _t:.2f}s (pipeline unaffected): {e}")

    print("\n[5/16] CRITIQUE")
    _t = time.time()
    try:
        critique.score_run(brief_type, started_at, run_id=run_id)
        print(f"  [5/16] CRITIQUE done in {time.time() - _t:.2f}s")
    except Exception as e:
        print(f"  [5/16] CRITIQUE FAILED in {time.time() - _t:.2f}s (pipeline unaffected): {e}")

    print("\n[6/16] AUDIT")
    _t = time.time()
    try:
        audit.audit_run(brief_type, run_id=run_id)
        print(f"  [6/16] AUDIT done in {time.time() - _t:.2f}s")
    except Exception as e:
        print(f"  [6/16] AUDIT FAILED in {time.time() - _t:.2f}s (pipeline unaffected): {e}")

    print("\n[7/16] TREND MAP")
    _t = time.time()
    try:
        trend_mapper.map_trends(brief_type, started_at, run_id=run_id)
        print(f"  [7/16] TREND MAP done in {time.time() - _t:.2f}s")
    except Exception as e:
        print(f"  [7/16] TREND MAP FAILED in {time.time() - _t:.2f}s (pipeline unaffected): {e}")

    print("\n[8/16] SUMMARY")
    _t = time.time()
    try:
        summarize.print_summary(brief_type, run_id=run_id)
        print(f"  [8/16] SUMMARY done in {time.time() - _t:.2f}s")
    except Exception as e:
        print(f"  [8/16] SUMMARY FAILED in {time.time() - _t:.2f}s (pipeline unaffected): {e}")

    print("\n[9/16] THESIS GRADING")
    _t = time.time()
    if brief_type == "morning":
        try:
            thesis_grader.main()
            print(f"  [9/16] THESIS GRADING done in {time.time() - _t:.2f}s")
        except Exception as e:
            print(f"  [9/16] THESIS GRADING FAILED in {time.time() - _t:.2f}s: {e}")
    else:
        print("  [9/16] THESIS GRADING skipped (morning only)")

    print("\n[10/16] PATTERN MEMORY")
    _t = time.time()
    if brief_type == "morning":
        try:
            pattern_memory.main()
            print(f"  [10/16] PATTERN MEMORY done in {time.time() - _t:.2f}s")
        except Exception as e:
            print(f"  [10/16] PATTERN MEMORY FAILED in {time.time() - _t:.2f}s: {e}")
    else:
        print("  [10/16] PATTERN MEMORY skipped (morning only)")

    print("\n[11/16] SOURCE CREDIBILITY")
    _t = time.time()
    if brief_type == "morning":
        try:
            source_credibility.main()
            print(f"  [11/16] SOURCE CREDIBILITY done in {time.time() - _t:.2f}s")
        except Exception as e:
            print(f"  [11/16] SOURCE CREDIBILITY FAILED in {time.time() - _t:.2f}s: {e}")
    else:
        print("  [11/16] SOURCE CREDIBILITY skipped (morning only)")

    print("\n[12/16] ADVERSARIAL REVIEW")
    _t = time.time()
    if _is_sunday_morning(brief_type):
        try:
            adversarial.main()
            print(f"  [12/16] ADVERSARIAL REVIEW done in {time.time() - _t:.2f}s")
        except Exception as e:
            print(f"  [12/16] ADVERSARIAL REVIEW FAILED in {time.time() - _t:.2f}s: {e}")
    else:
        print("  [12/16] ADVERSARIAL REVIEW skipped (Sunday morning only)")

    print("\n[13/16] WATCHLIST ARTICLE SYNC")
    _t = time.time()
    try:
        watchlist_sync.run_sync()
        print(f"  [13/16] WATCHLIST ARTICLE SYNC done in {time.time() - _t:.2f}s")
    except Exception as e:
        print(f"  [13/16] WATCHLIST ARTICLE SYNC FAILED in {time.time() - _t:.2f}s (pipeline unaffected): {e}")

    print("\n[14/16] CONTENT EMBEDDINGS (RAG)")
    _t = time.time()
    try:
        embedding_job.main()
        print(f"  [14/16] CONTENT EMBEDDINGS done in {time.time() - _t:.2f}s")
    except Exception as e:
        print(f"  [14/16] CONTENT EMBEDDINGS FAILED in {time.time() - _t:.2f}s (pipeline unaffected): {e}")

    print("\n[15/16] USER-AWARE BRIEF PERSONALIZATION")
    _t = time.time()
    try:
        user_synthesis.run(brief_type)
        print(f"  [15/16] USER-AWARE BRIEF PERSONALIZATION done in {time.time() - _t:.2f}s")
    except Exception as e:
        print(f"  [15/16] USER-AWARE BRIEF PERSONALIZATION FAILED in {time.time() - _t:.2f}s (pipeline unaffected): {e}")

    print("\n[16/16] THESIS GENERATION (system, semantic dedup)")
    _t = time.time()
    if brief_type == "morning":
        try:
            thesis_generator.main()
            print(f"  [16/16] THESIS GENERATION done in {time.time() - _t:.2f}s")
        except Exception as e:
            print(f"  [16/16] THESIS GENERATION FAILED in {time.time() - _t:.2f}s (pipeline unaffected): {e}")
    else:
        print("  [16/16] THESIS GENERATION skipped (morning only)")

    # --- Brief feedback loop: score the just-generated brief (soft-fail) ---
    print("\n[POST] BRIEF SCORING")
    _t = time.time()
    try:
        from brief_feedback_loop import score_brief
        brief_text = synth_result.get("brief_text", "")
        if brief_text:
            score_brief(brief_text, brief_type, run_id)
            print(f"  [POST] BRIEF SCORING done in {time.time() - _t:.2f}s")
        else:
            print("  [POST] BRIEF SCORING skipped (no brief text available)")
    except Exception as e:
        print(f"  [POST] BRIEF SCORING FAILED in {time.time() - _t:.2f}s: {e}")

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
    print(f"Pipeline complete in {time.time() - pipeline_t0:.2f}s ({(time.time() - pipeline_t0) / 60:.1f} min)")
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
