"""BreakingAlpha - Main Pipeline Orchestrator"""
import sys
from datetime import datetime

def run(mode="morning"):
    print(f"\n{'🌅' if mode == 'morning' else '🌙'} BREAKINGALPHA {mode.upper()} — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    from ingest import run_ingestion
    from synthesize import generate_briefing
    run_ingestion()
    generate_briefing(mode)
    print(f"\n🏁 {mode.title()} run complete.")

if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "morning")
