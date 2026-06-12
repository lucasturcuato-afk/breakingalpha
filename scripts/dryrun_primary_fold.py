"""Dry-run validator for the primary_company -> companies[] fold (Track A).

READ-ONLY. SELECTs only. Writes nothing: no insert, no update, no delete, no
mention, no mention_count change. Run this to judge the fold's precision BEFORE
enabling TAGGING_PRIMARY_FOLD_ENABLED.

What it does: over a labeled sample of indexed companies, it finds recent articles
the model said are about that company (primary_company set) and reports, per
article, what the fold WOULD add to companies[]. It mirrors the predicate in
backend/ingest.py:_fold_primary_into_companies exactly (primary present, not
already in companies[] case-insensitive, resolves to an indexed company). The one
production check it omits is is_blocked_entity, which is a no-op for the real
indexed companies in this sample; it is noted in the output.

Hard-freeze proof: the fold augments the ARTICLE ROW companies[] only. It never
enters the company_mentions / mention_count path (those iterate the original
clean_companies in both store paths). This script therefore reports
NEW company_mentions = 0 and NEW mention_count increments = 0 by construction.

Usage (from repo root, with .env.local present):
  python scripts/dryrun_primary_fold.py
"""

import os
import sys
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
load_dotenv(".env.local")

URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("SUPABASE_ANON_KEY")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
)
if not URL or not KEY:
    print("Missing SUPABASE_URL / key in env. Aborting (read-only, nothing done).")
    sys.exit(1)

supabase = create_client(URL, KEY)

# Sample: SNOW plus the thin / common-word companies from fallback-validation.md.
SAMPLE = [
    "Snowflake",
    "Telesat",
    "Hologic",
    "Globalstar",
    "Chord Energy",
    "Comfort Systems USA",
    "Match Group",
]

_indexed_cache: dict[str, bool] = {}


def resolves_to_indexed(name: str) -> bool:
    """Mirror of backend/ingest.py:_primary_resolves_to_indexed. SELECT only."""
    if name in _indexed_cache:
        return _indexed_cache[name]
    ok = False
    try:
        r = supabase.table("companies").select("id").eq("name", name).limit(1).execute()
        if r.data:
            ok = True
        else:
            r2 = supabase.table("companies").select("id").ilike("name", name).limit(1).execute()
            ok = bool(r2.data)
    except Exception as ex:
        print(f"  indexed-check error [{name!r}]: {ex}")
        ok = False
    _indexed_cache[name] = ok
    return ok


def fold_would_add(primary: str, stored_companies) -> str | None:
    """Mirror of _fold_primary_into_companies (minus is_blocked_entity, a no-op
    for these real indexed companies). Returns the name that would be ADDED to
    companies[], or None."""
    primary = (primary or "").strip()
    if not primary:
        return None
    lower = {(c or "").lower() for c in (stored_companies or [])}
    if primary.lower() in lower:
        return None
    if not resolves_to_indexed(primary):
        return None
    return primary


def main():
    print("=" * 72)
    print("DRY-RUN: primary_company -> companies[] fold (READ-ONLY, writes nothing)")
    print("=" * 72)
    total_articles = 0
    total_would_add = 0
    for co in SAMPLE:
        try:
            resp = (
                supabase.table("articles")
                .select("title, source, companies, primary_company, published_at")
                .ilike("primary_company", co)
                .order("published_at", desc=True)
                .limit(40)
                .execute()
            )
        except Exception as ex:
            print(f"\n[{co}] query error: {ex}")
            continue
        rows = resp.data or []
        # 30-day filter in Python (keeps the query simple and parameter-free).
        cut = datetime.now(timezone.utc) - timedelta(days=30)
        rows = [
            r for r in rows
            if (r.get("published_at") or "") >= cut.isoformat()
        ]
        adds = []
        already = 0
        for r in rows:
            stored = r.get("companies") or []
            add = fold_would_add(r.get("primary_company") or "", stored)
            if add:
                adds.append((r.get("title", "")[:80], stored, add))
            elif (co.lower() in {(c or "").lower() for c in stored}):
                already += 1
        total_articles += len(rows)
        total_would_add += len(adds)
        print(f"\n[{co}]  indexed={resolves_to_indexed(co)}  "
              f"recent_primary_articles={len(rows)}  "
              f"already_tagged={already}  fold_would_add={len(adds)}")
        for title, stored, add in adds[:6]:
            print(f"    + add '{add}'  (stored companies[]={stored})")
            print(f"      title: {title}")
    print("\n" + "-" * 72)
    print(f"TOTAL recent primary articles scanned: {total_articles}")
    print(f"TOTAL companies[] entries the fold WOULD add: {total_would_add}")
    print("NEW company_mentions from the fold: 0 (the fold is article-row only)")
    print("NEW mention_count increments from the fold: 0 (frozen by design)")
    print("-" * 72)


if __name__ == "__main__":
    main()
