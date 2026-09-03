"""
rss_feed_targets.py - monthly re-runnable RSS feed target report.

WHAT THIS ANSWERS
-----------------
"Which publishers do we see through Google News per-ticker feeds at real volume
and quality, but do not fetch directly?" Those are the named-RSS candidates:
the gnews row for them is a headline with a ~0% prose rate, while a direct feed
from the same outlet carries a real description 60-100% of the time (measured:
prose is a property of the FEED TYPE, not the publisher).

RANKING
-------
volume x median relevance_score, NOT prose rate and NOT raw volume:
  - prose rate by publisher is useless here: gnews rows are ~0% prose for every
    publisher, including ones we already fetch directly.
  - raw volume alone surfaces MarketBeat (378/day at median relevance 2, the
    13F boilerplate that produced a 2,853-row false title-cluster). Median
    relevance is the cheap quality gate the corpus already carries.

COVERAGE
--------
A publisher counts as covered when we already reach it through:
  - a configured RSS_FEEDS entry (parsed from backend/ingest.py source text,
    deliberately NOT imported: importing ingest pulls in watchlist, which opens
    a Supabase client at module load),
  - or a non-gnews `source` value observed in the same window (the NewsAPI and
    Finnhub paths stamp the real outlet name into `source`, so Yahoo / Benzinga
    / SeekingAlpha arrivals show up here without any hardcoded list).

Syndicators (publishers.SYNDICATOR_DOMAINS) are flagged and never proposed:
fetching a syndicator directly recreates the false-breadth artifact that module
exists to remove.

USAGE
-----
    python backend/tools/rss_feed_targets.py                 # report, 14 days
    python backend/tools/rss_feed_targets.py --days 30
    python backend/tools/rss_feed_targets.py --min-per-day 5 --min-rel 4
    python backend/tools/rss_feed_targets.py --probe         # also probe common
                                                             # feed URLs on each
                                                             # candidate domain
    python backend/tools/rss_feed_targets.py --json out.json

Read-only. The --probe leg makes one bounded HTTP request per URL shape per
candidate (RSS_FETCH_TIMEOUT_SEC-equivalent timeout); everything else is one
keyset-paginated read of `articles`.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import statistics
import sys
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND))

from publishers import SYNDICATOR_DOMAINS, normalize_domain  # noqa: E402

#: Mirrors ingest.RSS_FETCH_TIMEOUT_SEC without importing ingest.
FETCH_TIMEOUT_SEC = 20
_UA = "BreakingAlpha pipeline (noahhanning03@gmail.com)"

#: URL shapes tried per candidate domain under --probe, in order. Covers the
#: WordPress family (/feed), Arc newsrooms (/arc/outboundfeeds/rss/) and the
#: generic static shapes. A miss here does not mean no feed exists (CNBC's
#: search.cnbc.com shape would never be found this way); it means the cheap
#: shapes failed and a human should look once.
_FEED_SHAPES = (
    "https://{d}/feed/",
    "https://{d}/feed",
    "https://{d}/rss",
    "https://{d}/rss.xml",
    "https://{d}/feed.xml",
    "https://{d}/index.xml",
    "https://{d}/arc/outboundfeeds/rss/",
)


def _rss_feeds_from_source() -> dict[str, str]:
    """Parse the RSS_FEEDS dict out of backend/ingest.py without importing it."""
    src = (_BACKEND / "ingest.py").read_text()
    block = src[src.index("RSS_FEEDS = {"):]
    block = block[:block.index("\n}") + 2]
    return dict(re.findall(r'"([^"]+)":\s*"(https?://[^"]+)"', block))


def _norm_name(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_SEC) as resp:
        return resp.read()


def _alnum(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _prose(summary: str | None, title: str | None) -> bool:
    """Same >=20-new-alnum-chars rule the fact-layer scoping measured with."""
    s = (summary or "").strip()
    return bool(s and len(_alnum(s)) - len(_alnum(title)) >= 20)


def load_window(days: int) -> list[dict]:
    from dotenv import load_dotenv
    load_dotenv(_BACKEND.parent / ".env.local")
    os.environ.setdefault("SUPABASE_URL", os.environ.get("NEXT_PUBLIC_SUPABASE_URL", ""))
    from supabase_client import get_service_client
    sb = get_service_client()

    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    cols = "source,publisher,publisher_domain,relevance_score,ingested_at"
    rows: list[dict] = []
    last = None
    # Keyset on ingested_at (idx_articles_ingested_at): a .range() walk past
    # row ~3000 hits the statement timeout on this table, keyset does not.
    while True:
        q = (sb.table("articles").select(cols).gte("ingested_at", cutoff)
             .order("ingested_at", desc=True).limit(1000))
        if last is not None:
            q = q.lt("ingested_at", last)
        page = q.execute().data or []
        rows += page
        if len(page) < 1000 or page[-1]["ingested_at"] == last:
            break
        last = page[-1]["ingested_at"]
    return rows


def build_report(rows: list[dict], days: int, min_per_day: float, min_rel: float) -> dict:
    feeds = _rss_feeds_from_source()
    named_norm = {_norm_name(k) for k in feeds}
    synd_domains = set(SYNDICATOR_DOMAINS)

    gnews = [r for r in rows if (r.get("source") or "").startswith("Google News (")]
    non_gnews_sources = {_norm_name(r.get("source")) for r in rows
                         if not (r.get("source") or "").startswith("Google News (")}

    agg: dict[str, dict] = defaultdict(lambda: {"n": 0, "rel": [], "dom": Counter()})
    for r in gnews:
        p = (r.get("publisher") or "").strip()
        if not p:
            continue
        a = agg[p]
        a["n"] += 1
        if r.get("relevance_score") is not None:
            a["rel"].append(r["relevance_score"])
        if r.get("publisher_domain"):
            a["dom"][r["publisher_domain"]] += 1

    out = []
    for p, a in agg.items():
        dom = a["dom"].most_common(1)[0][0] if a["dom"] else None
        med = statistics.median(a["rel"]) if a["rel"] else None
        covered = _norm_name(p) in named_norm or _norm_name(p) in non_gnews_sources
        synd = bool(dom and (dom in synd_domains
                             or any(dom.endswith("." + d) for d in synd_domains)))
        per_day = a["n"] / days
        candidate = (not covered and not synd
                     and per_day >= min_per_day
                     and med is not None and med >= min_rel)
        out.append({
            "publisher": p, "n": a["n"], "per_day": round(per_day, 1),
            "median_rel": med, "domain": dom,
            "covered": covered, "syndicator": synd, "candidate": candidate,
            # the ranking key: volume x quality
            "rank_score": round(per_day * (med or 0), 1),
        })
    out.sort(key=lambda r: -r["rank_score"])
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "window_days": days,
        "gnews_rows": len(gnews),
        "distinct_publishers": len(agg),
        "publishers": out,
        "candidates": [r for r in out if r["candidate"]],
    }


def probe_candidates(report: dict, limit: int) -> None:
    """Try the cheap feed-URL shapes on each candidate domain. Mutates report."""
    for cand in report["candidates"][:limit]:
        d = normalize_domain("https://" + (cand["domain"] or "")) or cand["domain"]
        if not d:
            cand["probe"] = {"error": "no domain"}
            continue
        result = {"tried": 0, "found": None}
        for shape in _FEED_SHAPES:
            url = shape.format(d=d)
            result["tried"] += 1
            try:
                raw = _fetch(url)
            except (urllib.error.URLError, urllib.error.HTTPError,
                    socket.timeout, Exception):
                continue
            import feedparser
            feed = feedparser.parse(raw)
            if not feed.entries:
                continue
            sums = [re.sub(r"<[^>]+>", "", e.get("summary", e.get("description", "")) or "")[:500]
                    for e in feed.entries]
            titles = [e.get("title", "") for e in feed.entries]
            prose_n = sum(1 for s, t in zip(sums, titles) if _prose(s, t))
            result["found"] = {
                "url": url, "entries": len(feed.entries),
                "prose": prose_n,
                "prose_rate": round(prose_n / len(feed.entries), 2),
            }
            break
        cand["probe"] = result


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=14)
    ap.add_argument("--min-per-day", type=float, default=3.0)
    ap.add_argument("--min-rel", type=float, default=4.0)
    ap.add_argument("--probe", action="store_true",
                    help="probe common feed URL shapes on candidate domains")
    ap.add_argument("--probe-limit", type=int, default=15)
    ap.add_argument("--top", type=int, default=45)
    ap.add_argument("--json", help="write the full report to this path")
    args = ap.parse_args()

    rows = load_window(args.days)
    report = build_report(rows, args.days, args.min_per_day, args.min_rel)
    if args.probe:
        probe_candidates(report, args.probe_limit)

    print(f"window: {args.days}d  gnews rows: {report['gnews_rows']}  "
          f"distinct publishers: {report['distinct_publishers']}")
    print(f"\n{'publisher':30s} {'/day':>6s} {'medRel':>6s} {'rank':>7s} "
          f"{'covered':>8s} {'synd':>5s} {'CAND':>5s}")
    print("-" * 78)
    for r in report["publishers"][:args.top]:
        print(f"{r['publisher'][:30]:30s} {r['per_day']:6.1f} "
              f"{str(r['median_rel']):>6s} {r['rank_score']:7.1f} "
              f"{'yes' if r['covered'] else '':>8s} "
              f"{'yes' if r['syndicator'] else '':>5s} "
              f"{'<--' if r['candidate'] else '':>5s}")

    cands = report["candidates"]
    print(f"\nCANDIDATES (>= {args.min_per_day}/day, medRel >= {args.min_rel}, "
          f"not covered, not syndicator): {len(cands)}")
    for c in cands:
        line = f"  {c['publisher'][:28]:28s} {c['per_day']:6.1f}/day  medRel={c['median_rel']}  {c['domain']}"
        if "probe" in c:
            f = c["probe"].get("found")
            line += (f"  feed: {f['url']} ({f['entries']} entries, "
                     f"{int(f['prose_rate']*100)}% prose)" if f
                     else f"  feed: none of {c['probe']['tried']} cheap shapes")
        print(line)

    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=1))
        print(f"\nfull report -> {args.json}")


if __name__ == "__main__":
    main()
