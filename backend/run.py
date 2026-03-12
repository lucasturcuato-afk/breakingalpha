"""
run.py  —  BreakingAlpha pipeline orchestrator
Order: ingest → synthesize → extract deals
"""

import sys
from ingest import run_ingestion as run_ingest
from synthesize import run as run_synthesize
from deal_extractor import run as run_deal_extractor

if __name__ == "__main__":
    brief_type = sys.argv[1] if len(sys.argv) > 1 else "morning"

    print("=" * 50)
    print(f"🌅 BreakingAlpha Pipeline — {brief_type.upper()} RUN")
    print("=" * 50)

    print("\n[1/3] INGEST")
    run_ingest()

    print("\n[2/3] SYNTHESIZE")
    run_synthesize(brief_type)

    print("\n[3/3] DEAL EXTRACTION")
    run_deal_extractor()

    print("\n" + "=" * 50)
    print("✅ Pipeline complete")
    print("=" * 50)
