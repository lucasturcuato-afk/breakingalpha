"""
Backfill sparkline_data for all trend_clusters.
For each cluster, searches articles matching its themes/companies
over the last 90 days, groups by week, and stores weekly article counts.
"""

import os
import json
import time
from datetime import datetime, timedelta
from collections import defaultdict
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")

from supabase import create_client

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def safe_list(raw):
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            p = json.loads(raw)
            return p if isinstance(p, list) else []
        except Exception:
            return []
    return []


def get_week_key(date_str):
    try:
        dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        start = dt - timedelta(days=dt.weekday())
        return start.strftime("%Y-%m-%d")
    except Exception:
        return ""


def search_articles_for_cluster(cluster):
    top_companies = safe_list(cluster.get("top_companies", []))
    top_themes = safe_list(cluster.get("top_themes", []))

    search_terms = []
    for c in top_companies[:3]:
        if len(c) > 2:
            search_terms.append(c.lower())
    for t in top_themes[:2]:
        if len(t) > 2:
            search_terms.append(t.lower())

    if not search_terms:
        return []

    cutoff = (datetime.utcnow() - timedelta(days=90)).isoformat()
    primary_term = search_terms[0]

    try:
        result = (
            supabase.table("articles")
            .select("id, published_at, ingested_at")
            .gte("ingested_at", cutoff)
            .ilike("title", f"%{primary_term}%")
            .order("ingested_at", desc=True)
            .limit(200)
            .execute()
        )
        return result.data or []
    except Exception as e:
        print(f"  Search error: {e}")
        return []


def compute_sparkline(articles):
    now = datetime.utcnow()
    weeks = []
    for i in range(11, -1, -1):
        week_start = now - timedelta(weeks=i)
        week_start = week_start - timedelta(days=week_start.weekday())
        week_start = week_start.replace(hour=0, minute=0, second=0, microsecond=0)
        weeks.append(week_start.strftime("%Y-%m-%d"))

    counts = defaultdict(int)
    for a in articles:
        date_str = a.get("published_at") or a.get("ingested_at") or ""
        week_key = get_week_key(date_str)
        if week_key:
            counts[week_key] += 1

    return [{"week": w, "count": counts.get(w, 0)} for w in weeks]


def main():
    result = (
        supabase.table("trend_clusters")
        .select("id, label, top_companies, top_themes")
        .order("created_at", desc=True)
        .limit(500)
        .execute()
    )

    clusters = result.data or []
    print(f"Computing sparklines for {len(clusters)} clusters...")

    for i, cluster in enumerate(clusters):
        label = cluster.get("label", "")[:50]
        print(f"[{i + 1}/{len(clusters)}] {label}...", end=" ")

        articles = search_articles_for_cluster(cluster)
        sparkline = compute_sparkline(articles)

        active_weeks = sum(1 for s in sparkline if s["count"] > 0)
        total_articles = sum(s["count"] for s in sparkline)

        supabase.table("trend_clusters").update({
            "sparkline_data": sparkline
        }).eq("id", cluster["id"]).execute()

        print(f"{total_articles} articles across {active_weeks} weeks")
        time.sleep(0.1)

    print(f"\nDone. Sparklines computed for {len(clusters)} clusters.")


if __name__ == "__main__":
    main()
