"""
run.py  —  BreakingAlpha pipeline orchestrator
Order: ingest → synthesize → extract deals → observe → critique
"""

import sys
from datetime import datetime, timezone
from ingest import run_ingestion as run_ingest
from synthesize import run as run_synthesize
from deal_extractor import run as run_deal_extractor
import observe
import critique

if __name__ == "__main__":
    brief_type = sys.argv[1] if len(sys.argv) > 1 else "morning"
    started_at = datetime.now(timezone.utc)

    print("=" * 50)
    print(f"🌅 BreakingAlpha Pipeline — {brief_type.upper()} RUN")
    print("=" * 50)

    print("\n[1/5] INGEST")
    ingest_count = run_ingest()

    print("\n[2/5] SYNTHESIZE")
    run_synthesize(brief_type)

    print("\n[3/5] DEAL EXTRACTION")
    run_deal_extractor()

    print("\n[4/5] OBSERVE")
    run_id = None
    try:
        run_id = observe.record_run(brief_type, started_at, ingest_count=ingest_count)
    except Exception as e:
        print(f"  ⚠ Observer failed (pipeline unaffected): {e}")

    print("\n[5/5] CRITIQUE")
    try:
        critique.score_run(brief_type, started_at, run_id=run_id)
    except Exception as e:
        print(f"  ⚠ Critic failed (pipeline unaffected): {e}")

    print("\n" + "=" * 50)
    print("✅ Pipeline complete")
    print("=" * 50)
