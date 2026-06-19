"""
impact_ranking.py - LIVE market-impact lead ranking for the morning/evening brief.

WHY: lead_preselect.py ranks the lead by deal dollar size (Filter A/A2 $1B+) and,
failing that, a macro/geo/sector fallback that only sees the relevance-top-60
corpus. On 2026-06-18 that produced a micro-cap holdings disclosure (Eightco,
$472M, relevance_score 10) as the lead while the prior-day hawkish Fed hold (46
articles across 16 distinct sources, relevance_score 9) was crowded out of the
top-60 entirely and never considered. The deal-size lens cannot promote a non-deal
macro event, and per-article relevance does not capture how broadly an event is
covered.

WHAT: a deterministic, testable market-impact score for the LEAD, blending:
  - coverage breadth (distinct sources covering the same event cluster) PRIMARY,
  - coverage count (articles in the cluster),
  - recency,
  - a tier-1 macro boost for FOMC / CPI / PCE / jobs, including a RECENT-EVENT
    boost when a tier-1 event landed in the last ~48h (a backward event that the
    forward calendar does not surface), and
  - a mega-deal boost so a genuine $1B+ transaction still leads.

Distinct SOURCES (not raw article count) is the primary breadth metric: it resists
the SEO / wire-duplication failure mode where one promotional story is syndicated
under many near-identical "Google News (TICKER)" rows.

LIVE: synthesize.py uses compute_lead() as the primary lead path, falling back to
lead_preselect's deal-size pick (then Gemini) when no confident cluster is found.
shadow_compare() is retained for telemetry and offline replay. Tier-1 dates come
from event_calendar.py (the SOURCE OF TRUTH section below); there is no
self-contained date table here.
"""
from __future__ import annotations

import datetime
import json
import logging
import math
import re
from typing import Optional

import event_calendar as _ec

logger = logging.getLogger(__name__)

# ── Tier-1 macro event dates (SINGLE SOURCE OF TRUTH: event_calendar.py / #386) ──
# event_calendar owns the canonical FOMC and CPI/PCE/NFP date tables. We derive the
# backward-looking sets here so there is no second date table to drift. event_calendar
# exposes only a FORWARD calendar (get_upcoming_catalysts); the recent-event / last-48h
# detection below is the backward counterpart, with its dates sourced from there.
FOMC_DECISIONS = {iso for iso, _dot in _ec.FOMC_MEETINGS}
PRINT_RELEASES = {
    "cpi": {iso for iso, _ref in _ec.CPI_RELEASES},
    "nfp": {iso for iso, _ref in _ec.NFP_RELEASES},
    "pce": {iso for iso, _ref in _ec.PCE_RELEASES},
}

# Macro cluster buckets, keyword-matched on title+summary. Order matters: the
# first bucket whose keywords hit wins (fed before generic rates).
# Keywords are precision-tuned: bare "powell" is excluded (it matches unrelated
# names like "Dina Powell McCormick"); use "jerome powell" / "fed chair". Bare
# "interest rate" is excluded (matches mortgage / savings copy); use the
# Fed-specific phrasings.
MACRO_BUCKETS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("fed", ("fomc", "federal reserve", "rate decision", "jerome powell",
             "fed chair", "dot plot", "fed funds", "rate cut", "rate hike",
             "hawkish", "dovish")),
    ("cpi", ("consumer price index", "cpi report", "cpi data", "inflation report",
             "inflation data")),
    ("pce", ("pce price", "personal consumption expenditures", "core pce")),
    ("jobs", ("nonfarm payroll", "jobs report", "employment situation",
              "unemployment rate", "payrolls")),
)
TIER1_BUCKETS = {"fed", "cpi", "pce", "jobs"}

# Scoring weights. Tuned so broad authoritative macro coverage beats a narrow
# single-name story, a tier-1 event that just happened gets promoted, and a
# genuine $1B+ deal still leads. See tests for the calibration cases.
W_DISTINCT_SOURCES = 3.0
W_ARTICLE_COUNT = 1.0
W_RECENCY = 2.0
TIER1_BOOST = 4.0
RECENT_EVENT_BOOST = 4.0
MEGA_DEAL_BOOST = 10.0
RECENCY_HALFWINDOW_H = 48.0


def _text(a: dict) -> str:
    return (str(a.get("title") or "") + " " + str(a.get("summary") or "")).lower()


def _parse_list(raw) -> list:
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            v = json.loads(raw)
            return v if isinstance(v, list) else []
        except Exception:
            # Postgres array text like {A,B}
            s = raw.strip().strip("{}")
            return [p.strip().strip('"') for p in s.split(",") if p.strip()]
    return []


def cluster_key(a: dict) -> str:
    """Assign an article to an EVENT cluster. Macro keyword buckets first (so the
    Fed is one cluster regardless of outlet), then primary company/ticker.

    Everything else is a SINGLETON (keyed by url/title), deliberately NOT bucketed
    by industry vertical: a sector is not an event, and lumping all of a sector's
    unrelated stories into one cluster produces a fake mega-cluster that always
    wins on breadth. Coverage breadth is only meaningful at the event level (one
    macro event, one company's news), so non-macro non-company items do not
    aggregate."""
    t = _text(a)
    for bucket, kws in MACRO_BUCKETS:
        if any(kw in t for kw in kws):
            return f"macro:{bucket}"
    companies = _parse_list(a.get("companies"))
    if companies and str(companies[0]).strip():
        return "co:" + str(companies[0]).strip().lower()
    uid = (a.get("url") or a.get("title") or "unknown").strip().lower()
    return "one:" + uid


def _age_hours(a: dict, now: datetime.datetime) -> float:
    for key in ("published_at", "ingested_at"):
        ts = a.get(key)
        if not ts:
            continue
        try:
            dt = datetime.datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=datetime.timezone.utc)
            return max(0.0, (now - dt).total_seconds() / 3600.0)
        except Exception:
            continue
    return float("inf")


def recent_tier1_events(asof_date: datetime.date, lookback_days: int = 2) -> set[str]:
    """Tier-1 macro buckets whose event landed in [asof - lookback, asof]. On
    2026-06-18 with the 2026-06-17 FOMC this returns {'fed'}. Backward-looking by
    design: these are events that just happened, which the forward calendar does
    not surface."""
    out: set[str] = set()
    try:
        lo = asof_date - datetime.timedelta(days=lookback_days)
        for iso in FOMC_DECISIONS:
            d = datetime.date.fromisoformat(iso)
            if lo <= d <= asof_date:
                out.add("fed")
        for bucket, dates in PRINT_RELEASES.items():
            for iso in dates:
                d = datetime.date.fromisoformat(iso)
                if lo <= d <= asof_date:
                    out.add(bucket)
    except Exception as e:
        logger.warning("impact_ranking: recent_tier1_events failed: %s", e)
    return out


def _recency_factor(age_h: float) -> float:
    if age_h == float("inf"):
        return 0.0
    return max(0.0, 1.0 - age_h / RECENCY_HALFWINDOW_H)


def score_clusters(
    pool: list[dict],
    now: datetime.datetime,
    *,
    recent_events: Optional[set[str]] = None,
    mega_deal_urls: Optional[set[str]] = None,
) -> list[dict]:
    """Cluster the pool and score each cluster. Returns clusters sorted by score
    desc. Pure: no network. `mega_deal_urls` is the set of article urls that map
    to a confirmed $1B+ deal_flow row (preserves the mega-deal lead path)."""
    recent_events = recent_events or set()
    mega_deal_urls = mega_deal_urls or set()
    from collections import defaultdict

    clusters: dict[str, list[dict]] = defaultdict(list)
    for a in pool:
        clusters[cluster_key(a)].append(a)

    scored = []
    for key, arts in clusters.items():
        sources = {str(x.get("source") or "").strip().lower() for x in arts if x.get("source")}
        n_sources = len(sources)
        n_articles = len(arts)
        freshest = min((_age_hours(x, now) for x in arts), default=float("inf"))
        bucket = key.split(":", 1)[1] if key.startswith("macro:") else None
        is_tier1 = bucket in TIER1_BUCKETS
        is_recent = bucket in recent_events
        is_mega = any((x.get("url") or "").strip() in mega_deal_urls for x in arts)

        score = (
            W_DISTINCT_SOURCES * math.log1p(n_sources)
            + W_ARTICLE_COUNT * math.log1p(n_articles)
            + W_RECENCY * _recency_factor(freshest)
            + (TIER1_BOOST if is_tier1 else 0.0)
            + (RECENT_EVENT_BOOST if is_recent else 0.0)
            + (MEGA_DEAL_BOOST if is_mega else 0.0)
        )
        reasons = []
        if is_recent:
            reasons.append("recent tier-1 event (<=48h)")
        if is_tier1:
            reasons.append("tier-1 macro")
        if is_mega:
            reasons.append("confirmed $1B+ deal")
        reasons.append(f"{n_sources} distinct sources / {n_articles} articles")
        scored.append({
            "cluster_key": key,
            "score": round(score, 3),
            "distinct_sources": n_sources,
            "article_count": n_articles,
            "freshest_age_h": round(freshest, 1) if freshest != float("inf") else None,
            "is_tier1": is_tier1,
            "is_recent": is_recent,
            "is_mega_deal": is_mega,
            "reason": "; ".join(reasons),
            "_articles": arts,
        })
    scored.sort(key=lambda c: -c["score"])
    return scored


def _bucket_keyword_hits(a: dict, bucket: Optional[str]) -> int:
    """How many of the bucket's keywords appear in the article text. Used to pick
    the most on-topic article to REPRESENT a macro cluster (so the Fed cluster is
    led by an actual Fed story, not a keyword false-positive)."""
    if not bucket:
        return 0
    kws = next((k for b, k in MACRO_BUCKETS if b == bucket), ())
    t = _text(a)
    return sum(1 for kw in kws if kw in t)


def _best_article_in_cluster(arts: list[dict], now: datetime.datetime,
                             bucket: Optional[str] = None) -> dict:
    """Pick the lead article within the winning cluster: for a macro cluster,
    most bucket-keyword hits first (most on-topic), then highest relevance, then
    freshest. For non-macro clusters, relevance then freshest."""
    def k(a):
        try:
            rel = int(a.get("relevance_score") or 0)
        except (TypeError, ValueError):
            rel = 0
        return (-_bucket_keyword_hits(a, bucket), -rel, _age_hours(a, now))
    return sorted(arts, key=k)[0]


def compute_shadow_lead(
    pool: list[dict],
    now: datetime.datetime,
    *,
    asof_date: Optional[datetime.date] = None,
    mega_deal_urls: Optional[set[str]] = None,
) -> Optional[dict]:
    """Return the market-impact shadow lead, or None on empty input. Never raises.
    Result keys: article, cluster_key, score, reason, breadth, top_clusters."""
    try:
        if not pool:
            return None
        asof_date = asof_date or now.date()
        recent = recent_tier1_events(asof_date)
        scored = score_clusters(pool, now, recent_events=recent, mega_deal_urls=mega_deal_urls)
        if not scored:
            return None
        top = scored[0]
        _bucket = top["cluster_key"].split(":", 1)[1] if top["cluster_key"].startswith("macro:") else None
        lead = _best_article_in_cluster(top["_articles"], now, bucket=_bucket)
        return {
            "article": lead,
            "cluster_key": top["cluster_key"],
            "score": top["score"],
            "reason": top["reason"],
            "breadth": {"distinct_sources": top["distinct_sources"],
                        "article_count": top["article_count"]},
            "recent_events": sorted(recent),
            "top_clusters": [
                {k: c[k] for k in ("cluster_key", "score", "distinct_sources",
                                   "article_count", "is_tier1", "is_recent", "is_mega_deal")}
                for c in scored[:5]
            ],
        }
    except Exception as e:
        logger.warning("impact_ranking: compute_shadow_lead failed: %s", e)
        return None


# Live alias: synthesize.py calls compute_lead() for the primary lead. The
# implementation is shared with the offline/telemetry path; the name is kept for
# back-compat and tests.
compute_lead = compute_shadow_lead


# ── Coverage-pool + deal helpers (used by the live lead path and telemetry) ──
_POOL_COLS = ("title, summary, url, source, sector, industry_verticals, companies, "
              "deal_type, relevance_score, published_at, ingested_at")


def fetch_coverage_pool(sb, now: datetime.datetime, hours_ingest: int = 24,
                        hours_publish: int = 48, limit: int = 1000) -> list[dict]:
    """Point-in-time, RECENCY-ordered window (not relevance-ordered): coverage
    breadth must be computed over the true population, not the relevance-top slice
    that buries a broadly-covered macro event. Read-only; never raises."""
    try:
        ing = (now - datetime.timedelta(hours=hours_ingest)).isoformat()
        pub = (now - datetime.timedelta(hours=hours_publish)).isoformat()
        upper = now.isoformat()
        resp = (sb.table("articles").select(_POOL_COLS)
                .gte("ingested_at", ing).lt("ingested_at", upper)
                .gte("published_at", pub).lt("published_at", upper)
                .order("ingested_at", desc=True).limit(limit).execute())
        return resp.data or []
    except Exception as e:
        logger.warning("impact_ranking: fetch_coverage_pool failed: %s", e)
        return []


def _mega_deal_urls(sb, now: datetime.datetime) -> set[str]:
    """Reuse lead_preselect's deal_flow fetch, valuation parse, AND confirmation
    gate (no duplication) to mark CONFIRMED $1B+ deal urls, preserving the
    mega-deal lead path. The confirmation gate (stage in signed / closed) matters:
    without it a speculative "$7B plan" headline would get the full mega-deal boost
    and out-rank a broadly-covered event, which is the same speculative-single-name
    failure this ranker exists to avoid."""
    try:
        import lead_preselect as lp
        out: set[str] = set()
        for d in lp.fetch_recent_deal_flow(sb, hours=48, limit=300):
            v = lp.parse_valuation_to_usd_b(d.get("valuation"))
            stage = (d.get("stage") or "").strip().lower()
            if (v is not None and v >= 1.0 and stage in lp.CONFIRMED_STAGES
                    and (d.get("source_url") or "").strip()):
                out.add(d["source_url"].strip())
        return out
    except Exception as e:
        logger.warning("impact_ranking: _mega_deal_urls failed: %s", e)
        return set()


def shadow_compare(sb, live_lead_title: str, now: datetime.datetime,
                   *, asof_date: Optional[datetime.date] = None) -> dict:
    """Compute the SHADOW impact lead and a divergence record vs the live lead.
    Read-only, never raises, never changes the live brief. Returns a dict of
    shadow_* fields for the run decision log."""
    try:
        pool = fetch_coverage_pool(sb, now)
        res = compute_shadow_lead(pool, now, asof_date=asof_date or now.date(),
                                  mega_deal_urls=_mega_deal_urls(sb, now))
        if not res:
            return {"shadow_lead_title": None, "shadow_pool_size": len(pool)}
        new_title = str(res["article"].get("title") or "").strip()
        live = (live_lead_title or "").strip()
        diverged = live[:80].lower() != new_title[:80].lower()
        return {
            "shadow_lead_title": new_title[:200],
            "shadow_cluster": res["cluster_key"],
            "shadow_score": res["score"],
            "shadow_reason": res["reason"],
            "shadow_breadth": res["breadth"],
            "shadow_recent_events": res["recent_events"],
            "shadow_diverged_from_live": diverged,
            "shadow_pool_size": len(pool),
        }
    except Exception as e:
        logger.warning("impact_ranking: shadow_compare failed: %s", e)
        return {"shadow_lead_title": None, "shadow_error": str(e)}
