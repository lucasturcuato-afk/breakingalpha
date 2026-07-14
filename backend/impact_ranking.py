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

# ── Event-theme sub-buckets (D1) ─────────────────────────────────────────────
# WHY: a single company can generate many UNRELATED stories in one window (on
# 2026-06-24 SpaceX produced 48 articles across 21 sources spanning a cargo
# test, a $6.3B AI deal, a $25B bond sale, a post-IPO stock slump, analyst
# initiations, and a lockup). Bucketing all of them under "co:spacex" credited
# breadth (distinct sources) to the COMPANY, not to any single EVENT, so the
# name out-ranked genuinely broadly-covered single events on volume alone.
#
# Fix: within a company bucket, sub-cluster by EVENT theme so distinct events
# are distinct clusters and breadth is counted per EVENT. Order matters: the
# first theme whose keywords hit wins. Items that match no theme fall back to a
# content signature (below) so near-identical syndications of one story still
# merge, but unrelated stories do not. Macro buckets are unchanged.
EVENT_THEMES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("ma", ("acquire", "acquisition", "acquires", "buyout", "buy out", "to buy",
            "buys", "merger", "takeover", "tender offer", "bid for", "deal for")),
    ("funding", ("bond", "debt deal", "notes offering", "note offering",
                 "raises $", "raise $", "funding round", "series a", "series b",
                 "series c", "series d", "fundraise", "fundraising", "credit facility",
                 "term loan", "convertible")),
    ("offering", ("share sale", "stock offering", "equity raise", "equity offering",
                  "registered direct", "secondary offering", "priced its",
                  "pricing of", "at-the-market")),
    ("ipo", ("ipo", "debut", "lists publicly", "begins trading", "began trading",
             "post-ipo", "listing", "goes public")),
    ("stock", ("stock", "shares", "selloff", "sell-off", "rout", "plunge", "tumble",
               "slumps", "slump", "rally", "rallies", "rebound", "valuation",
               "market cap", "trillionaire")),
    ("rating", ("upgrade", "downgrade", "initiates coverage", "starts at",
                "price target", "neutral", "overweight", "underweight", "buy rating")),
    ("earnings", ("earnings", "quarterly results", "q1", "q2", "q3", "q4",
                  "revenue", "guidance", "eps", "beats", "misses")),
    ("buyback", ("buyback", "repurchase", "share repurchase", "dividend")),
    ("legal", ("lawsuit", "sues", "probe", "investigation", "antitrust", "appeal",
               "court", "settlement", "fine", "sanction")),
    ("layoffs", ("layoff", "layoffs", "job cuts", "cuts jobs", "restructuring",
                 "workforce reduction")),
    ("product", ("launch", "launches", "unveils", "debuts", "rollout", "rolls out",
                 "new product", "contract", "partnership", "partners with")),
)

# How many tokens form a fallback content signature for an item that matches no
# named event theme. Small enough that syndicated near-duplicates of one story
# (same head words) collapse, large enough that two unrelated stories do not.
_SIG_TOKENS = 4
_STOPWORDS = frozenset((
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "as",
    "at", "by", "is", "are", "its", "it", "after", "amid", "over", "from", "new",
    "inc", "corp", "ltd", "plc", "co", "says", "report", "reports", "reuters",
    "bloomberg", "yahoo", "finance", "google", "news",
))

# Scoring weights. Tuned so broad authoritative macro coverage beats a narrow
# single-name story, a tier-1 event that just happened gets promoted, and a
# genuine $1B+ deal still leads. See tests for the calibration cases.
W_DISTINCT_SOURCES = 3.0
W_ARTICLE_COUNT = 1.0
# D4 recency backstop: lead recency was dominated by breadth and MEGA_DEAL_BOOST,
# so a stale-but-broadly-covered cluster could out-rank a fresh event. Raise the
# recency weight and add an explicit staleness penalty for clusters whose
# freshest article is older than EVENT_STALE_AGE_H. D1/A2 catch the 06-24 case;
# this is the backstop so an old event cannot lead on accumulated breadth alone.
W_RECENCY = 4.0
TIER1_BOOST = 4.0
RECENT_EVENT_BOOST = 4.0
MEGA_DEAL_BOOST = 10.0
RECENCY_HALFWINDOW_H = 48.0
# A cluster whose freshest article is older than this (hours) takes a flat
# staleness penalty unless it is a tier-1 / recent-event macro cluster (those
# carry their own boosts and are intentionally exempt).
EVENT_STALE_AGE_H = 24.0
STALE_EVENT_PENALTY = 3.0
# How many top clusters to snapshot into the post-hoc ranker-audit payload
# (compute_materiality_lead -> preselect_decision.materiality_top_clusters).
# Capped to keep the persisted jsonb small on the rare material tape.
_TOP_CLUSTERS_AUDIT_CAP = 10


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


def _event_theme(t: str) -> Optional[str]:
    """First EVENT_THEMES bucket whose keywords appear in the article text, or
    None when no named theme matches."""
    for theme, kws in EVENT_THEMES:
        if any(kw in t for kw in kws):
            return theme
    return None


def _content_signature(a: dict) -> str:
    """Stable short content signature for an item with no named event theme: the
    first few significant (non-stopword) title tokens. Near-identical
    syndications of one story share a head and collapse; unrelated stories do
    not. Deterministic and pure."""
    title = str(a.get("title") or "").lower()
    toks = re.findall(r"[a-z0-9$]+", title)
    sig = [w for w in toks if w not in _STOPWORDS and len(w) > 2][:_SIG_TOKENS]
    if not sig:
        return (a.get("url") or title or "unknown").strip()[:60]
    return "-".join(sig)


def cluster_key(a: dict) -> str:
    """Assign an article to an EVENT cluster. Macro keyword buckets first (so the
    Fed is one cluster regardless of outlet), then a company+EVENT sub-cluster.

    D1: within one company, distinct EVENTS are distinct clusters. A company's
    many unrelated stories (a deal, a bond sale, a stock-price slump, an analyst
    rating) no longer collapse into one "co:NAME" mega-cluster that wins on
    name-level volume; breadth (distinct sources) is counted per EVENT. The
    sub-key is the matched event theme, else a content signature so syndicated
    near-duplicates of the SAME story still merge.

    Everything else is a SINGLETON (keyed by content signature), deliberately NOT
    bucketed by industry vertical: a sector is not an event, and lumping all of a
    sector's unrelated stories into one cluster produces a fake mega-cluster that
    always wins on breadth. Coverage breadth is only meaningful at the event
    level."""
    t = _text(a)
    for bucket, kws in MACRO_BUCKETS:
        if any(kw in t for kw in kws):
            return f"macro:{bucket}"
    companies = _parse_list(a.get("companies"))
    if companies and str(companies[0]).strip():
        co = str(companies[0]).strip().lower()
        sub = _event_theme(t) or ("sig:" + _content_signature(a))
        return f"co:{co}:{sub}"
    return "one:" + _content_signature(a)


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

        # D4: stale non-macro clusters take a flat penalty so accumulated breadth
        # on an old event cannot out-rank a fresh one. Tier-1 / recent-event macro
        # clusters are exempt (they carry their own intentional boosts).
        is_stale = (freshest != float("inf") and freshest > EVENT_STALE_AGE_H
                    and not (is_tier1 or is_recent))
        score = (
            W_DISTINCT_SOURCES * math.log1p(n_sources)
            + W_ARTICLE_COUNT * math.log1p(n_articles)
            + W_RECENCY * _recency_factor(freshest)
            + (TIER1_BOOST if is_tier1 else 0.0)
            + (RECENT_EVENT_BOOST if is_recent else 0.0)
            + (MEGA_DEAL_BOOST if is_mega else 0.0)
            - (STALE_EVENT_PENALTY if is_stale else 0.0)
        )
        reasons = []
        if is_stale:
            reasons.append("stale event (>24h)")
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


# ══════════════════════════════════════════════════════════════════════════════
# PR1 - TAPE-AWARE MATERIALITY RE-RANK (shadow-first, behind MATERIALITY_RANK_MODE)
# ══════════════════════════════════════════════════════════════════════════════
# WHY: score_clusters proxies importance with coverage-breadth / recency / deal-size
# and is TAPE-BLIND. On 2026-06-30 an $8B Rocket Lab/Iridium deal led a narrow tech
# rally; on 2026-07-01 a foreign, rupee-denominated GIC/Genus stake sale led a
# payrolls-eve conflicted tape. Both are large by the deal-size lens but did NOT move
# the US tape. This re-rank is a DELTA on top of the base cluster score that rewards
# stories consistent with where the tape actually moved and demotes pure deal-size
# that did not.
#
# PURE: the tape dict and any per-name session moves are PASSED IN; this module makes
# no network call and imports no network module. FAIL-SAFE: with NO tape at all
# (weekend / fetch failure) every materiality delta is zero, so the order is
# byte-identical to compute_shadow_lead (the continuity decay is the only delta that
# can still apply, and only when a prior lead title is supplied). When a tape IS
# present the penalties (US-irrelevance, deal-that-did-not-drive-the-tape) apply at any
# magnitude and the bonuses only on a material move. All weights are named + tunable;
# Noah ratifies them.

# Materiality delta weights (tunable; see RUN_REPORT_PR1.md "WHAT NEEDS NOAH").
# MAT_DEAL_NOT_DRIVER_PENALTY is sized to ~neutralize MEGA_DEAL_BOOST (10.0) so an
# unconfirmed / non-tape-driving deal falls back to competing on its ORGANIC breadth
# + recency rather than winning on deal-size alone.
MAT_DEAL_NOT_DRIVER_PENALTY = 10.0
MAT_US_IRRELEVANT_PENALTY = 6.0
MAT_MARKET_WIDE_BONUS = 5.0
MAT_TAPE_DRIVER_BONUS = 4.0
MAT_DIRECTION_CONTRADICTION_PENALTY = 4.0
# Continuity (T2): a cluster whose lead title matches the immediately-prior brief's
# lead is decayed so the same story cannot lead two consecutive briefs. Large enough
# to drop a repeated mega-deal below a fresh competitor.
CONTINUITY_DECAY = 12.0

# Local copies of the driver-selection rule (mirrors market_tape.DRIVER_* so this
# module stays free of the network-importing market_tape). Keep in sync if tuned.
_MAT_DRIVER_MIN_ABS_PCT = 2.0
_MAT_DRIVER_TOP_K = 3

# Pure-deal event themes (from cluster_key sub-bucket) + a market-wide vocabulary.
_PURE_DEAL_THEMES = frozenset({"ma", "funding", "offering", "ipo"})
_PURE_DEAL_TYPES = frozenset({
    "m&a", "mergers & acquisitions", "lbo", "ipo", "funding", "fundraising",
    "debt financing", "minority stake", "asset sale", "ipo & capital markets",
    "stake sale", "share sale",
})
_MARKET_WIDE_TERMS = (
    "stocks", "stock market", "markets", "wall street", "s&p 500", "s&p500",
    "nasdaq", "dow ", "dow jones", "russell", "indexes", "indices", "equities",
    "benchmark", "broad market", "rally", "selloff", "sell-off", "risk-on",
    "risk-off",
)
# US-irrelevance markers: foreign currency / market copy with no US-ticker anchor.
_FOREIGN_MARKERS = (
    "rupee", "₹", "crore", "lakh", "sensex", "nifty", "bse", "nse india",
    "indian", "india's", " india", "singapore", "yuan", "renminbi", "hong kong",
    "shanghai", "yen ", "won ", "ringgit", "peso", "real ", "rand ", "baht",
    "rupiah", "european union antitrust",
)
_US_ANCHORS = (
    "nasdaq", "nyse", "s&p", "sec filing", "8-k", "10-k", "wall street",
    "federal reserve", "u.s.", "us-listed", "new york",
)


def _cluster_arts(scored_cluster: dict) -> list[dict]:
    return scored_cluster.get("_articles") or []


def _cluster_text(arts: list[dict]) -> str:
    return " ".join(_text(a) for a in arts)


def _cluster_companies(arts: list[dict]) -> set[str]:
    out: set[str] = set()
    for a in arts:
        for c in _parse_list(a.get("companies")):
            s = str(c or "").strip().lower()
            if s:
                out.add(s)
    return out


def _cluster_sub_theme(cluster_key_str: str) -> Optional[str]:
    # co:<name>:<sub> -> <sub> (may be "sig:..."); macro:*/one:* -> None
    if cluster_key_str.startswith("co:"):
        parts = cluster_key_str.split(":", 2)
        return parts[2] if len(parts) == 3 else None
    return None


def _is_pure_deal_cluster(cluster_key_str: str, arts: list[dict]) -> bool:
    sub = _cluster_sub_theme(cluster_key_str)
    if sub in _PURE_DEAL_THEMES:
        return True
    for a in arts:
        if (str(a.get("deal_type") or "").strip().lower()) in _PURE_DEAL_TYPES:
            return True
    return False


def _is_single_name_cluster(cluster_key_str: str, companies: set[str]) -> bool:
    # A company cluster with a small resolved roster (<=2 names).
    return cluster_key_str.startswith("co:") and 1 <= len(companies) <= 2


def _is_market_wide_cluster(cluster_key_str: str, text: str) -> bool:
    if cluster_key_str.startswith("macro:"):
        return True
    return any(term in text for term in _MARKET_WIDE_TERMS)


def _is_us_irrelevant(text: str) -> bool:
    has_foreign = any(m in text for m in _FOREIGN_MARKERS)
    has_us = any(m in text for m in _US_ANCHORS)
    return has_foreign and not has_us


def _driver_names_from_moves(name_session_pct: Optional[dict]) -> set[str]:
    """Mirror of market_tape.build_tape_driver_names, kept local so impact_ranking
    imports no network module. Names whose |session move| exceeds the threshold,
    top-K by magnitude, lower-cased. Empty input -> empty set (fail-safe)."""
    pairs = []
    for name, pct in (name_session_pct or {}).items():
        nm = str(name or "").strip().lower()
        if not nm:
            continue
        try:
            p = float(pct)
        except (TypeError, ValueError):
            continue
        if abs(p) > _MAT_DRIVER_MIN_ABS_PCT:
            pairs.append((nm, abs(p)))
    if not pairs:
        return set()
    pairs.sort(key=lambda t: t[1], reverse=True)
    return {nm for nm, _ in pairs[:_MAT_DRIVER_TOP_K]}


def tape_pcts(tape: Optional[dict]) -> dict:
    """Extract per-index + VIX percents from either a live tape
    ({"quotes": {sym: {"pct": ..}}}) or a persisted snapshot
    ({"indices": {"sp500": {"pct": ..}}, "vix_pct": ..}). Pure, never raises.
    Missing values -> None."""
    out = {"spx": None, "nasdaq": None, "dow": None, "russell": None, "vix": None}
    if not isinstance(tape, dict):
        return out

    def _f(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    quotes = tape.get("quotes")
    if isinstance(quotes, dict):  # live tape shape
        out["spx"] = _f((quotes.get("^GSPC") or {}).get("pct"))
        out["nasdaq"] = _f((quotes.get("^IXIC") or {}).get("pct"))
        out["dow"] = _f((quotes.get("^DJI") or {}).get("pct"))
        out["russell"] = _f((quotes.get("^RUT") or {}).get("pct"))
        out["vix"] = _f((quotes.get("^VIX") or {}).get("pct"))
    idx = tape.get("indices")
    if isinstance(idx, dict):  # persisted snapshot shape (overrides if present)
        out["spx"] = _f((idx.get("sp500") or {}).get("pct")) if out["spx"] is None else out["spx"]
        out["nasdaq"] = _f((idx.get("nasdaq") or {}).get("pct")) if out["nasdaq"] is None else out["nasdaq"]
        out["dow"] = _f((idx.get("dow") or {}).get("pct")) if out["dow"] is None else out["dow"]
        out["russell"] = _f((idx.get("russell") or {}).get("pct")) if out["russell"] is None else out["russell"]
    if out["vix"] is None:
        out["vix"] = _f(tape.get("vix_pct"))
    return out


# Materiality thresholds (mirror market_tape.MATERIALITY_* so the two surfaces agree).
MAT_SPX_ABS_PCT = 1.0
MAT_VIX_ABS_PCT = 8.0
MAT_MIN_DISTINCT_SOURCES = 6


def tape_is_material(tape: Optional[dict]) -> bool:
    p = tape_pcts(tape)
    spx = abs(p["spx"]) if p["spx"] is not None else 0.0
    vix = abs(p["vix"]) if p["vix"] is not None else 0.0
    return spx >= MAT_SPX_ABS_PCT or vix >= MAT_VIX_ABS_PCT


def tape_is_broad(tape: Optional[dict]) -> bool:
    """True when >=2 equity indices moved the SAME direction (a broad move a single
    name is unlikely to own alone). Pure."""
    p = tape_pcts(tape)
    signs = [1 if v and v > 0 else (-1 if v and v < 0 else 0)
             for v in (p["spx"], p["nasdaq"], p["dow"], p["russell"])]
    pos = sum(1 for s in signs if s > 0)
    neg = sum(1 for s in signs if s < 0)
    return pos >= 2 or neg >= 2


def _tape_direction(tape: Optional[dict]) -> int:
    p = tape_pcts(tape)
    spx = p["spx"]
    if spx is None:
        return 0
    return 1 if spx > 0 else (-1 if spx < 0 else 0)


def materiality_delta(scored_cluster: dict, *, tape: Optional[dict],
                      driver_names: set[str], name_session_pct: Optional[dict]) -> dict:
    """Pure per-cluster materiality delta. Returns {"delta": float, "reasons": [..]}.

    Two tiers, so the two ratified days (a MATERIAL 06-30 evening and an IMMATERIAL,
    divided 07-01 morning) both resolve market-wide:
      - PENALTIES (US-irrelevance, deal-that-did-not-drive-the-tape) apply whenever a
        tape is PRESENT, regardless of magnitude. A foreign rupee stake sale or a
        narrow single-name deal that is not the tape's driver should not lead a US
        brief on a quiet OR a busy day.
      - BONUSES (market-wide, tape-driver) apply only on a MATERIAL tape, where there
        is a real move to be consistent with. Conservative: quiet days do not get
        their ordinary market-wide stories boosted, only clearly-wrong leads demoted.

    FAIL-SAFE: with NO tape at all (weekend / fetch failure) every delta is zero, so
    the order is identical to compute_shadow_lead."""
    reasons: list[str] = []
    if not tape:
        return {"delta": 0.0, "reasons": ["no tape (no-op)"]}

    key = scored_cluster["cluster_key"]
    arts = _cluster_arts(scored_cluster)
    text = _cluster_text(arts)
    companies = _cluster_companies(arts)
    distinct_sources = int(scored_cluster.get("distinct_sources") or 0)
    is_material = tape_is_material(tape)
    tdir = _tape_direction(tape)
    name_pct = {str(k).strip().lower(): v for k, v in (name_session_pct or {}).items()}

    is_pure_deal = _is_pure_deal_cluster(key, arts)
    is_single = _is_single_name_cluster(key, companies)
    is_driver = bool(companies & driver_names)

    delta = 0.0

    # (1) US-irrelevance [any present tape]: a foreign / non-USD story with no US
    # anchor cannot own the US tape (GIC/Genus rupee stake sale, 07-01).
    if _is_us_irrelevant(text):
        delta -= MAT_US_IRRELEVANT_PENALTY
        reasons.append(f"US-irrelevant (-{MAT_US_IRRELEVANT_PENALTY})")

    # (2) Deal-size that did not drive the tape [any present tape]: a single-name
    # pure-deal cluster that is NOT a confirmed tape driver and lacks dominant
    # cross-source breadth -> demote by ~the mega-deal boost so it competes on organic
    # merit. A genuinely broadly-covered deal (distinct_sources >= threshold) is
    # exempt and still leads; a deal confirmed as a driver on a material tape is also
    # exempt (is_driver). Fires on both the material 06-30 (Rocket Lab) and the
    # immaterial 07-01 (GIC/Genus) tapes.
    if (is_pure_deal and is_single and not is_driver
            and distinct_sources < MAT_MIN_DISTINCT_SOURCES):
        delta -= MAT_DEAL_NOT_DRIVER_PENALTY
        reasons.append(f"pure deal, not a tape driver (-{MAT_DEAL_NOT_DRIVER_PENALTY})")

    # (3) Market-wide story on a MATERIAL tape -> reward the broad read.
    if is_material and _is_market_wide_cluster(key, text):
        delta += MAT_MARKET_WIDE_BONUS
        reasons.append(f"market-wide, tape material (+{MAT_MARKET_WIDE_BONUS})")

    # (4) Confirmed tape driver moving WITH a MATERIAL tape -> reward the genuine driver.
    if is_material and is_driver and tdir != 0:
        same_dir = False
        for co in companies:
            if co in name_pct:
                try:
                    csign = 1 if float(name_pct[co]) > 0 else (-1 if float(name_pct[co]) < 0 else 0)
                except (TypeError, ValueError):
                    csign = 0
                if csign != 0 and csign == tdir:
                    same_dir = True
        if same_dir:
            delta += MAT_TAPE_DRIVER_BONUS
            reasons.append(f"tape driver, direction-consistent (+{MAT_TAPE_DRIVER_BONUS})")

    # (5) A cluster's named mover contradicts a MATERIAL tape direction -> penalty
    # (a down-name leading an up-tape is not the market-wide story).
    contradiction = False
    for co in companies:
        if is_material and co in name_pct and tdir != 0:
            try:
                csign = 1 if float(name_pct[co]) > 0 else (-1 if float(name_pct[co]) < 0 else 0)
                cmag = abs(float(name_pct[co]))
            except (TypeError, ValueError):
                csign, cmag = 0, 0.0
            if csign != 0 and csign != tdir and cmag >= _MAT_DRIVER_MIN_ABS_PCT and co in driver_names:
                contradiction = True
    if contradiction and not _is_market_wide_cluster(key, text):
        delta -= MAT_DIRECTION_CONTRADICTION_PENALTY
        reasons.append(f"named mover contradicts tape direction (-{MAT_DIRECTION_CONTRADICTION_PENALTY})")

    return {"delta": round(delta, 3), "reasons": reasons}


def _continuity_decay(scored_cluster: dict, now: datetime.datetime,
                      prior_lead_title: Optional[str]) -> dict:
    """T2: decay a cluster whose lead article title matches the immediately-prior
    brief's lead, so the same story cannot lead two consecutive briefs. Fuzzy match
    on significant title tokens (>=0.6 Jaccard) OR shared content signature. Pure."""
    if not prior_lead_title:
        return {"delta": 0.0, "reasons": []}
    arts = _cluster_arts(scored_cluster)
    if not arts:
        return {"delta": 0.0, "reasons": []}
    key = scored_cluster["cluster_key"]
    _bucket = key.split(":", 1)[1] if key.startswith("macro:") else None
    lead = _best_article_in_cluster(arts, now, bucket=_bucket)
    lead_title = str(lead.get("title") or "")

    def _toks(s: str) -> set[str]:
        return {w for w in re.findall(r"[a-z0-9$]+", s.lower())
                if w not in _STOPWORDS and len(w) > 2}

    a, b = _toks(lead_title), _toks(prior_lead_title)
    if not a or not b:
        return {"delta": 0.0, "reasons": []}
    jac = len(a & b) / len(a | b)
    same_sig = _content_signature(lead) == _content_signature({"title": prior_lead_title})
    if jac >= 0.6 or same_sig:
        return {"delta": -CONTINUITY_DECAY,
                "reasons": [f"repeat of prior brief lead (jaccard={jac:.2f}, -{CONTINUITY_DECAY})"]}
    return {"delta": 0.0, "reasons": []}


def compute_materiality_lead(
    pool: list[dict],
    now: datetime.datetime,
    *,
    tape: Optional[dict] = None,
    name_session_pct: Optional[dict] = None,
    prior_lead_title: Optional[str] = None,
    mega_deal_urls: Optional[set[str]] = None,
    asof_date: Optional[datetime.date] = None,
) -> Optional[dict]:
    """Tape-aware materiality re-rank of the coverage pool. PURE: tape + per-name
    session moves are passed in; no network. Returns a result shaped like
    compute_shadow_lead PLUS 'materiality' (the delta breakdown for the winner) and
    'base_cluster_key' (what the tape-blind ranker would have picked), or None on an
    empty pool. Never raises.

    FAIL-SAFE: with no tape / an immaterial tape and no prior_lead_title, every delta
    is zero and this returns the SAME lead as compute_shadow_lead."""
    try:
        if not pool:
            return None
        asof_date = asof_date or now.date()
        recent = recent_tier1_events(asof_date)
        scored = score_clusters(pool, now, recent_events=recent, mega_deal_urls=mega_deal_urls)
        if not scored:
            return None
        base_top_key = scored[0]["cluster_key"]

        driver_names = _driver_names_from_moves(name_session_pct)
        adjusted = []
        for c in scored:
            md = materiality_delta(c, tape=tape, driver_names=driver_names,
                                   name_session_pct=name_session_pct)
            cd = _continuity_decay(c, now, prior_lead_title)
            total = round(c["score"] + md["delta"] + cd["delta"], 3)
            rec = dict(c)
            rec["base_score"] = c["score"]
            rec["materiality_delta"] = md["delta"]
            rec["continuity_delta"] = cd["delta"]
            rec["adjusted_score"] = total
            rec["materiality_reasons"] = md["reasons"] + cd["reasons"]
            adjusted.append(rec)
        adjusted.sort(key=lambda c: -c["adjusted_score"])
        top = adjusted[0]
        _bucket = top["cluster_key"].split(":", 1)[1] if top["cluster_key"].startswith("macro:") else None
        lead = _best_article_in_cluster(top["_articles"], now, bucket=_bucket)

        # Per-story ordered ranking snapshot for post-hoc audit. This is the
        # ordered list the pulse was handed: for each competing cluster we keep
        # the representative title + BOTH the impact (base) and materiality
        # (adjusted) scores + the delta breakdown + the reason strings, so the
        # full ordering can be reconstructed after the fact. Capped at
        # _TOP_CLUSTERS_AUDIT_CAP to keep the persisted jsonb small.
        def _rep_title(rec: dict) -> Optional[str]:
            arts = rec.get("_articles") or []
            if not arts:
                return None
            b = rec["cluster_key"].split(":", 1)[1] if rec["cluster_key"].startswith("macro:") else None
            a = _best_article_in_cluster(arts, now, bucket=b)
            t = (a.get("title") or "").strip()
            return t[:200] or None

        top_clusters_audit = [
            {
                "cluster_key": c["cluster_key"],
                "title": _rep_title(c),
                "impact_score": c["base_score"],
                "materiality_score": c["adjusted_score"],
                "materiality_delta": c["materiality_delta"],
                "continuity_delta": c["continuity_delta"],
                "distinct_sources": c["distinct_sources"],
                "article_count": c["article_count"],
                "materiality_reasons": list(c["materiality_reasons"]),
                "reason": c["reason"],
            }
            for c in adjusted[:_TOP_CLUSTERS_AUDIT_CAP]
        ]
        return {
            "article": lead,
            "cluster_key": top["cluster_key"],
            "score": top["adjusted_score"],
            "base_score": top["base_score"],
            "materiality_delta": top["materiality_delta"],
            "continuity_delta": top["continuity_delta"],
            "reason": top["reason"],
            "materiality_reasons": top["materiality_reasons"],
            "breadth": {"distinct_sources": top["distinct_sources"],
                        "article_count": top["article_count"]},
            "recent_events": sorted(recent),
            "base_cluster_key": base_top_key,
            "diverged_from_base": top["cluster_key"] != base_top_key,
            "top_clusters": top_clusters_audit,
        }
    except Exception as e:
        logger.warning("impact_ranking: compute_materiality_lead failed: %s", e)
        return None


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


# D12 same-day-confirmation relaxation thresholds. A deal whose deal_flow stage
# is STALE (e.g. still 'rumored' after the deal was actually announced, because
# deal_extractor did not re-run) can still qualify for the mega-deal boost when
# the TODAY-side article signal is unambiguous: explicit value, high relevance,
# and broad cross-source coverage of that same deal. These are the article-side
# proxies for "clearly confirmed" when the deal_flow stage cannot be trusted.
MEGA_DEAL_RELAX_MIN_RELEVANCE = 9
MEGA_DEAL_RELAX_MIN_DISTINCT_SOURCES = 2


def confirmed_mega_deal_urls(deal_rows: list[dict], pool: list[dict]) -> set[str]:
    """Pure: given deal_flow rows and the article pool, return the set of article
    source_urls that map to a CONFIRMED $1B+ deal eligible for the mega-deal boost.

    Two paths (D12):
      1. Stage path (original): deal_flow stage in CONFIRMED_STAGES.
      2. Relaxed same-day path: the deal_flow stage is STALE but the article side
         is unambiguous, i.e. the deal has an explicit >= $1B valuation AND the
         EVENT cluster of the matched article(s) shows high relevance and
         dominant cross-source breadth (multiple distinct sources). This recovers
         a genuine confirmed same-day deal (e.g. Qualcomm/Modular $4B) whose
         deal_flow row was never re-confirmed past 'rumored'.

    Unconfirmed-keyword headlines ("in talks", "rumored", "potential bid") are
    still blocked via lead_preselect's blocklist so a speculative single-name does
    NOT get the boost."""
    import lead_preselect as lp

    out: set[str] = set()
    if not deal_rows:
        return out

    # Index the pool by url and by event cluster so we can read the article-side
    # confirmation signal for a given deal_flow source_url.
    by_url: dict[str, dict] = {}
    for a in pool:
        u = (a.get("url") or "").strip()
        if u and u not in by_url:
            by_url[u] = a

    from collections import defaultdict
    cluster_members: dict[str, list[dict]] = defaultdict(list)
    for a in pool:
        cluster_members[cluster_key(a)].append(a)

    for d in deal_rows:
        url = (d.get("source_url") or "").strip()
        if not url:
            continue
        v = lp.parse_valuation_to_usd_b(d.get("valuation"))
        if v is None or v < 1.0:
            continue
        stage = (d.get("stage") or "").strip().lower()

        # Path 1: trusted stage.
        if stage in lp.CONFIRMED_STAGES:
            out.add(url)
            continue

        # Path 2: relaxed same-day confirmation from the article side.
        art = by_url.get(url)
        if not art:
            continue
        text = (str(art.get("title") or "") + " " + str(art.get("summary") or "")).lower()
        # Block speculative single-name headlines even under the relaxed path.
        if lp._has_unconfirmed_keyword(text) or lp._has_unconfirmed_keyword_non_ma(text):
            continue
        try:
            rel = int(art.get("relevance_score") or 0)
        except (TypeError, ValueError):
            rel = 0
        members = cluster_members.get(cluster_key(art), [art])
        distinct_sources = len({
            str(x.get("source") or "").strip().lower() for x in members if x.get("source")
        })
        if (rel >= MEGA_DEAL_RELAX_MIN_RELEVANCE
                and distinct_sources >= MEGA_DEAL_RELAX_MIN_DISTINCT_SOURCES):
            out.add(url)
    return out


def _mega_deal_urls(sb, now: datetime.datetime) -> set[str]:
    """Reuse lead_preselect's deal_flow fetch + valuation parse, then apply the
    confirmation gate (confirmed_mega_deal_urls) to mark CONFIRMED $1B+ deal urls,
    preserving the mega-deal lead path. D12: the gate now also admits a clearly
    confirmed same-day deal whose deal_flow stage is stale (see
    confirmed_mega_deal_urls). Read-only; never raises."""
    try:
        import lead_preselect as lp
        deal_rows = lp.fetch_recent_deal_flow(sb, hours=48, limit=300)
        pool = fetch_coverage_pool(sb, now)
        return confirmed_mega_deal_urls(deal_rows, pool)
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
