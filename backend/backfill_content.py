"""
backfill_content.py — One-time backfill of full article text for scrapeable sources.

Queries articles WHERE content IS NULL AND source IN SCRAPEABLE_SOURCES,
fetches full text, and updates the content column.

Usage:
    cd ~/Desktop/signalera/backend
    python backfill_content.py
"""

import os
import time
from supabase import create_client
from dotenv import load_dotenv
from fulltext import fetch_full_text, SCRAPEABLE_SOURCES

load_dotenv()

BATCH_SIZE = 50
INTER_BATCH_DELAY = 1.0   # seconds between batches
INTER_FETCH_DELAY = 0.5   # seconds between fetches within a batch


def main():
    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])

    # Fetch all articles with NULL content from scrapeable sources
    print("Querying articles with NULL content from scrapeable sources...")
    result = (
        supabase.table("articles")
        .select("id, url, source, title")
        .is_("content", "null")
        .in_("source", list(SCRAPEABLE_SOURCES))
        .order("ingested_at", desc=True)
        .execute()
    )
    articles = result.data or []
    total = len(articles)
    print(f"Found {total} articles to backfill\n")

    if total == 0:
        print("Nothing to backfill.")
        return

    succeeded = 0
    failed = 0
    total_chars = 0

    for batch_start in range(0, total, BATCH_SIZE):
        batch = articles[batch_start : batch_start + BATCH_SIZE]
        batch_end = min(batch_start + BATCH_SIZE, total)

        for article in batch:
            try:
                full_text = fetch_full_text(article["url"], article["source"])
                if full_text:
                    supabase.table("articles").update(
                        {"content": full_text}
                    ).eq("id", article["id"]).execute()
                    succeeded += 1
                    total_chars += len(full_text)
                    print(f"  ✓ {article['source']}: {article['title'][:60]} ({len(full_text)} chars)")
                else:
                    failed += 1
                    print(f"  ✗ {article['source']}: {article['title'][:60]} (no text extracted)")
            except Exception as ex:
                failed += 1
                print(f"  ✗ {article['source']}: {article['title'][:60]} — {ex}")

            time.sleep(INTER_FETCH_DELAY)

        print(f"\nProcessed {batch_end}/{total}...")

        if batch_end < total:
            time.sleep(INTER_BATCH_DELAY)

    avg_chars = int(total_chars / succeeded) if succeeded else 0
    print(f"\n{'='*50}")
    print(f"Backfill complete")
    print(f"  Total attempted:  {total}")
    print(f"  Succeeded:        {succeeded}")
    print(f"  Failed/skipped:   {failed}")
    print(f"  Avg content size: {avg_chars} chars")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
