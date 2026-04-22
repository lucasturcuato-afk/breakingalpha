"""
Backfill quality_score for all existing articles.
Run: python scripts/backfill_quality_scores.py

Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) in env.
"""
from __future__ import annotations

import os
import sys

# Add backend to path so we can import article_quality
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from article_quality import compute_quality_score  # noqa: E402
from supabase import create_client  # noqa: E402

url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

if not url or not key:
    print("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)

supabase = create_client(url, key)


def backfill():
    print("Fetching articles without quality_score...")
    # Fetch in batches of 200
    offset = 0
    total = 0
    while True:
        resp = (
            supabase.table("articles")
            .select("id, title, summary, content, companies, themes, sector, industry_verticals, deal_type, sentiment, content_type")
            .is_("quality_score", "null")
            .range(offset, offset + 199)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            break

        for row in rows:
            qs = compute_quality_score(row)
            supabase.table("articles").update({"quality_score": qs}).eq("id", row["id"]).execute()
            total += 1

        print(f"  Scored {total} articles so far...")
        offset += 200

    print(f"\nDone — backfilled {total} articles with quality_score.")


if __name__ == "__main__":
    backfill()
