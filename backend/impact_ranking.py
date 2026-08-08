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
    # Rebased from #527 (O3). The "ma" theme was PRESENT-tense only, so ONE confirmed
    # deal fragmented across sub-clusters whenever its coverage used past-tense or
    # seller-side framing: Uber "Just Bought" matched no M&A verb and fell to the
    # "stock" theme, splitting distinct sources and crushing the breadth signal.
    # Every added verb is transaction-directional. Bare "sale" and "sells" are
    # deliberately kept OUT: they collide with the "offering" theme's "share sale"
    # and equity-raise framing.
    ("ma", ("acquire", "acquisition", "acquisitions", "acquires", "acquired",
            "buyout", "buy out", "to buy", "buys", "bought", "merger", "takeover",
            "tender offer", "bid for", "deal for", "sale of", "sale to", "to sell",
            "divests", "divested", "agrees to buy", "agreed to buy",
            "agrees to acquire", "agreed to acquire")),
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
    mega_demote_urls: Optional[set[str]] = None,
) -> list[dict]:
    """Cluster the pool and score each cluster. Returns clusters sorted by score
    desc. Pure: no network. `mega_deal_urls` is the set of article urls that map
    to a confirmed $1B+ deal_flow row (preserves the mega-deal lead path).
    `mega_demote_urls` is the NEGATIVE cross-check set (urls whose deal_flow row
    contradicts: unconfirmed stage or null valuation); it can only REJECT the
    article-side guaranteed lane, never promote."""
    recent_events = recent_events or set()
    mega_deal_urls = mega_deal_urls or set()
    mega_demote_urls = mega_demote_urls or set()
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
        # MEGA has TWO sources:
        #   1. deal_flow gate: a member url maps to a confirmed $1B+ deal_flow row.
        #   2. R3 article-side GUARANTEED lane: a lead-eligible member's TITLE states
        #      a confirmed >= $1B transaction that passes the DEALGUARD strict guard
        #      (tight deal_type + verb-value proximity + idiom block), and whose url
        #      is not in mega_demote_urls. Closes the dead-deal_flow-gate gap
        #      (Arlington / Mitie / Uber have no usable row) without re-admitting the
        #      Funding/Fundraising and market-cap false positives.
        # The deal_flow url gate is NOT an unconditional positive: a url that the
        # NEGATIVE cross-check flags (unconfirmed stage / null valuation) is stripped
        # here even if confirmed_mega_deal_urls admitted it via the D12 relaxed path.
        # This is what kills PayPal $53B (an "announced"/rejected bid the relaxed path
        # promoted): its row contradicts, so it must re-qualify through the ARTICLE
        # lane or not at all. A genuinely confirmed same-day deal still passes because
        # its TITLE clears _title_confirms_transaction.
        _url_mega = any(
            (x.get("url") or "").strip() in mega_deal_urls
            and (x.get("url") or "").strip() not in mega_demote_urls
            for x in arts
        )
        _art_mega = any(
            _title_confirms_transaction(x, GUARANTEED_LANE_MIN_USD_B, mega_demote_urls)
            for x in _lead_eligible_arts(arts)
        )
        is_mega = _url_mega or _art_mega

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
            reasons.append("confirmed $1B+ deal"
                           + ("" if _url_mega else " (article-confirmed guaranteed lane)"))
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
            "mega_via_article": bool(_art_mega and not _url_mega),
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


# ══════════════════════════════════════════════════════════════════════════════
# L1 - ANALYST RATING / PRICE-TARGET LEAD BAR (structural, deterministic, no LLM)
# ══════════════════════════════════════════════════════════════════════════════
# WHY: Jul 20 evening led with "UBS Raises Micron Price Target on Robust Free Cash
# Flow Outlook". An analyst price-target / rating change is the weakest possible
# lead: it republishes a sell-side opinion as the day's headline. For a compliance-
# constrained product run by a registered representative that is a lead type to bar
# STRUCTURALLY, not down-weight. These stories STAY in the corpus (rails, sections);
# they are only made INELIGIBLE to be the LEAD.
#
# The bar sits at the cluster-lead level: a cluster whose REPRESENTATIVE (best)
# article is an analyst rating / PT story is dropped from lead contention. The
# cluster's other members are unaffected; the pool is not mutated. Applied in BOTH
# the live path (compute_shadow_lead / compute_lead) and the UNIFIED_LEAD contest
# (compute_unified_lead), so the bar survives the eventual flag flip.
#
# PRECISION: title-level word-boundary regex. It fires on sell-side PT / rating
# actions ("raises/lowers/cuts X price target", "downgrades ... stock rating",
# "initiates coverage with Outperform", "upgraded to Buy by <firm>", "Maintained by
# <firm> -- Price Target Raised to $X"). It deliberately does NOT fire on a company
# raising its OWN guidance/outlook/ARR target (e.g. "IREN ... raises ARR target",
# "Levi Strauss's Upgraded Outlook"), a company maintaining holdings ("MSTR
# Maintains Bitcoin Holdings"), or substrings ("attemPT to"). Validated against the
# Jul 20 evening corpus: 60 matched titles, all genuine analyst rating/PT stories;
# zero over-match on guidance / own-outlook / holdings titles.
_ANALYST_RATING_RE = re.compile(r"""(?xi)
    \bprice\ target\b
  | \bpt\ (?:raised|lowered|cut|set|to)\b
  | \binitiat(?:es|ed|e)\ coverage\b
  | \binitiat(?:es|ed|e)\ (?:\S+\ ){0,3}?(?:stock\ )?coverage\b
  | \bcoverage\ (?:with|on)\ (?:\S+\ ){0,4}?(?:outperform|neutral|buy|sell|hold|market\ perform|overweight|underweight)\b
  | \b(?:upgrade[sd]?|downgrade[sd]?)\ (?:by|at|to)\b
  | \b(?:upgrade[sd]?|downgrade[sd]?)\ (?:\S+\ ){0,3}?(?:rating|to\ (?:buy|sell|hold|overweight|underweight|neutral|outperform|underperform|market\ perform))\b
  | \b(?:stock|shares?)\ (?:\S+\ ){0,3}?(?:upgrade[sd]?|downgrade[sd]?)\ (?:by|across|at)\b
  | \banalyst\ upgrade\b | \banalyst\ downgrade\b
  | \b(?:reiterates?|reaffirms?|maintains?)\ (?:\S+\ ){0,4}?(?:rating|outperform|underperform|overweight|underweight|neutral|market\ perform|buy|sell|hold)\b
  | \b(?:buy|sell|hold|neutral|overweight|underweight|outperform|underperform|market\ perform)\ rating\b
  | \bstock\ rating\b
  | \brating\ (?:set|changed|raised|lowered|upgraded|downgraded|reaffirmed|reiterated|update[d]?)\b
  | \(rating\ (?:upgrade|downgrade)\)
  | \bgiven\ (?:a\ )?(?:new\ )?\$?[\d.]*\ *(?:average\ rating|rating|price\ target)\b
  | \bmaintained\ (?:by|at)\b
  | \b(?:raised|cut|lowered|changed)\ to\ (?:buy|sell|hold|overweight|underweight|neutral|outperform|underperform|market\ perform)\b
""")


def is_analyst_rating_lead(article: dict) -> bool:
    """True when the article is a sell-side analyst rating / price-target story.
    Deterministic, title-level, no LLM. Used to make such stories INELIGIBLE to be
    the LEAD (they stay eligible everywhere else). Never raises."""
    try:
        return bool(_ANALYST_RATING_RE.search(str(article.get("title") or "")))
    except Exception:
        return False


def _lead_eligible_arts(arts: list[dict]) -> list[dict]:
    """The subset of a cluster's articles that are eligible to be the LEAD story:
    everything EXCEPT analyst rating / price-target stories (L1). The barred
    stories stay in the cluster for every other surface; they are removed only from
    the pool the lead REPRESENTATIVE is chosen from."""
    return [a for a in arts if not is_analyst_rating_lead(a)]


def _lead_representative(scored_cluster: dict, now: datetime.datetime) -> Optional[dict]:
    """The article that would REPRESENT this cluster as the lead, choosing only from
    the lead-eligible (non-analyst-PT) members. Returns None when EVERY member is an
    analyst-PT story (the cluster is then wholly lead-ineligible). Never raises."""
    try:
        arts = scored_cluster.get("_articles") or []
        eligible = _lead_eligible_arts(arts)
        if not eligible:
            return None
        key = scored_cluster.get("cluster_key") or ""
        bucket = key.split(":", 1)[1] if key.startswith("macro:") else None
        return _best_article_in_cluster(eligible, now, bucket=bucket)
    except Exception:
        return None


def _cluster_lead_barred(scored_cluster: dict, now: datetime.datetime) -> bool:
    """True when a cluster has NO lead-eligible article, i.e. every member is an
    analyst rating / price-target story (L1). A cluster that merely CONTAINS an
    analyst-PT story is not barred: its lead representative falls back to the
    best non-analyst member (see _lead_representative). Never raises."""
    try:
        arts = scored_cluster.get("_articles") or []
        if not arts:
            return False
        return _lead_representative(scored_cluster, now) is None
    except Exception:
        return False


# ══════════════════════════════════════════════════════════════════════════════
# L2 - RUMOR / PREVIEW LEAD BAR (conditional, deterministic, no LLM)
# ══════════════════════════════════════════════════════════════════════════════
# WHY: on 2026-07-20 the morning brief led with "Micron Explores Strategic Deal to
# Stabilize Revenue" (a rumor) while a confirmed $1B+ transaction sat in the pool;
# on 2026-07-21 it led with "Tesla (TSLA) Tests Semi On Chicago Routes" (a product
# road test) over a confirmed GBP 3.1bn Mitie/OCS takeover and a $4B deal; on
# 2026-07-24 it led with "Booz Allen (BAH) To Report Earnings Tomorrow: Here Is
# What To Expect" (an earnings PREVIEW). A forward-looking / unconfirmed story is
# the weakest lead type after an analyst note: it reports a might-happen, not a
# did-happen. lead_preselect's Filter A/A2 (backend/lead_preselect.py: the
# UNCONFIRMED_KEYWORDS / UNCONFIRMED_KEYWORDS_NON_MA blocklists in _qualifies_filter_a
# and _qualifies_filter_a2) already rejects this framing for DEAL candidates; L2
# extends the SAME standard to the impact-cluster path.
#
# CONDITIONAL (unlike L1's unconditional analyst bar): a rumor / preview may LEAD
# only when no confirmed alternative exists that day. A confirmed alternative is a
# lead-eligible confirmed $1B+ mega-deal cluster (the mega-deal gate, floor named
# below) OR a tier-1 / recent-event macro release. When one exists the rumor/preview
# is lead-INELIGIBLE; when none exists it may still lead (a slow day can lead with a
# rumor rather than nothing). These stories STAY eligible in rails / sections; only
# the LEAD slot excludes them. Applied in BOTH the live path (compute_shadow_lead /
# compute_lead) AND the UNIFIED_LEAD contest (compute_unified_lead) via the shared
# _lead_bar_reason helper, so the bar survives the eventual flag flip.

# Rule 2 tunable (the ONE place Noah tunes the confirmed-alternative deal floor).
# A confirmed DEAL counts as the alternative that bars a rumor/preview only at/above
# this USD-billions floor. The mega-deal gate (confirmed_mega_deal_urls, which builds
# `mega_deal_urls`) already screens confirmed transactions at $1B via
# lead_preselect.MIN_DEAL_VALUE_USD_B, so this names that floor in one visible place
# for Noah. Raising it makes the rumor bar fire LESS often (fewer deals qualify as
# the confirming alternative), never more; it is fail-safe by construction.
RUMOR_BAR_CONFIRMED_DEAL_MIN_USD_B = 1.0

# GUARANTEED_LANE_MIN_USD_B: value floor at which an ARTICLE-side confirmed deal is
# admitted as a mega candidate in score_clusters even when NO deal_flow row backs it
# (the R3 dead-deal_flow-gate gap: Arlington / Mitie / Uber all lack a usable row).
# Same $1B floor the deal_flow mega gate uses so the two lanes agree.
GUARANTEED_LANE_MIN_USD_B = 1.0

# PRECISION: title-level word-boundary regex. Fires on forward-looking / unconfirmed
# framing: reported deal chatter ("reportedly", "explores", "in talks", "weighing",
# "mulls", "eyes a bid", "could acquire", "potential takeover"), stated intent
# ("plans to", "set to report"), and earnings / event PREVIEWS ("to report earnings",
# "what to expect", "earnings preview", "ahead of earnings", "is expected to report"),
# plus the product road-test framing ("road test", "test-drives") that led Jul 21.
# It deliberately does NOT fire on a confirmed action ("agrees", "signs", "closes",
# "priced", "acquired", "reports Q2 revenue of $X") or on a bare "expected" without a
# report/announce object. Reuses lead_preselect's UNCONFIRMED_KEYWORDS standard and
# extends it with the preview vocabulary that the deal blocklist does not carry.
_RUMOR_PREVIEW_RE = re.compile(r"""(?xi)
    \breportedly\b
  | \brumor(?:ed|s)?\b
  | \bin\ talks\b
  | \bexplor(?:es|ing|e)\b
  | \bmull(?:s|ing|ed)?\b
  | \bweigh(?:s|ing|ed)?\ (?:\S+\ ){0,3}?(?:bid|deal|sale|offer|takeover|acquisition|options?)\b
  | \b(?:is|are|reportedly)\ considering\b
  | \bplan(?:s|ning)?\ to\ (?:acquire|buy|sell|merge|raise|report|launch|spin)\b
  | \bset\ to\ report\b
  | \bto\ report\ (?:\S+\ ){0,2}?earnings\b
  | \bearnings\ (?:preview|due|tomorrow|next\ week)\b
  | \bwhat\ to\ expect\b
  | \bahead\ of\ (?:\S+\ ){0,3}?earnings\b
  | \b(?:is|are)\ expected\ to\ (?:report|post|announce|acquire|raise|merge)\b
  | \bexpected\ to\ (?:report|post|announce)\b
  | \b(?:preview|previews)\b
  | \bupcoming\ earnings\b
  | \bwill\ .{0,40}?\ react\ to\b
  | \bhow\ will\ .{0,40}?\ (?:react|fare|perform|do)\b
  | \babout\ to\ (?:fall|rise|surge|plunge|jump|soar|crash|drop|pop|rally|tank|spike)\b
  | \bwhat\ could\ move\b
  | \bthat\ could\ (?:end|reshape|transform|save|fix|reset|change|unlock|trigger|spark|reignite|upend)\b
  | \broad[-\ ]test(?:s|ing|ed)?\b
  | \btest[-\ ]driv(?:e|es|ing)\b
  | \btest(?:s|ing|ed)?\ (?:its\ |the\ )?(?:semi|truck|robotaxi|cybercab|fsd|autopilot|prototype|vehicle|drone|model)\b
  | \beye(?:s|ing)\ (?:a\ |an\ |another\ )?(?:\$?\d|bid|deal|stake|acquisition|takeover|merger)\b
  | \bcould\ (?:acquire|buy|raise|merge|sell|reach\ a\ deal)\b
  | \bmay\ (?:acquire|buy|raise|merge|sell)\b
  | \bpotential\ (?:bid|deal|acquisition|takeover|merger|buyout)\b
  | \bstrategic\ (?:options|alternatives|review)\b
""")

# Rule 2 cluster-dominance floor. A rumor/preview LEAD BAR is a CLUSTER decision (like
# the L1 analyst bar), not a single-headline decision: which member happens to be the
# representative should not decide eligibility. A cluster is a rumor/preview cluster
# when its representative reads as rumor/preview OR at least this fraction of its
# lead-eligible members do (so a company cluster that is wholly "explores a deal" /
# "upcoming earnings" / "could reshape" copy is barred regardless of which article is
# picked). Tuning UP makes the bar fire less often (needs a more one-sided cluster).
RUMOR_CLUSTER_DOMINANCE = 0.5

# Article-side confirmed-mega-deal detector for the confirmed-ALTERNATIVE check. The
# deal_flow-gated mega-deal set (confirmed_mega_deal_urls) misses a confirmed deal
# whose deal_flow row was never captured (e.g. "Mitie agrees GBP 3.1bn takeover by
# OCS", a real confirmed deal with no deal_flow join). This reads the confirmation off
# the TITLE: a confirmed-action verb ("agrees"/"signs"/"to acquire"/"priced") plus an
# explicit value at/above the floor, and NOT rumor/preview framing. Used ONLY to
# recognize a confirming alternative; it never itself promotes a story to the lead.
_CONFIRMED_DEAL_VERB_RE = re.compile(r"""(?xi)
    \b(?:agrees?|agreed|signs?|signed|to\ acquire|acquires?|acquired
       |buys?|bought|closes?|completed|completes?|priced|prices
       |secures?|clinch(?:es|ed)?|seals?|sealed|wins?|won
       |sells?|sold|to\ sell|divests?|divested|exits?|exited|offloads?|offloaded)\b
""")
_TEXT_DEAL_VALUE_RE = re.compile(
    r"(?ix)(?:us\$|a\$|c\$|\$|€|£|gbp|eur|usd)\s?(\d+(?:\.\d+)?)\s*(bn|b|billion|tn|t|trillion)\b"
)


def _title_confirms_mega_deal(article: dict, min_usd_b: float) -> bool:
    """True when the article TITLE states a CONFIRMED deal at/above min_usd_b (a
    confirmed-action verb + an explicit value), and is not itself rumor/preview
    framing. Recovers a confirmed alternative (e.g. a GBP 3.1bn 'agrees takeover')
    that the deal_flow mega-deal gate missed. Never raises."""
    try:
        t = str(article.get("title") or "")
        if not t or is_rumor_or_preview_lead(article):
            return False
        big = False
        for m in _TEXT_DEAL_VALUE_RE.finditer(t):
            v = float(m.group(1))
            if m.group(2).lower().startswith(("t",)):
                v *= 1000.0
            if v >= min_usd_b:
                big = True
                break
        if not big:
            return False
        return bool(_CONFIRMED_DEAL_VERB_RE.search(t))
    except Exception:
        return False


# ---------------------------------------------------------------------------
# MEGA-LANE GUARD (DEALGUARD, R3). _title_confirms_mega_deal above is loose ON
# PURPOSE for the rumor bar. The PROMOTION lane (score_clusters -> is_mega ->
# +MEGA_DEAL_BOOST / 1.0 confirmation) cannot tolerate that: a false positive
# injects a fake lead. Replayed prod pools showed the loose recognizer firing on
# ~105 of ~690 $1B+ titles at ~55% FP. This tightens the veto-branch
# _title_confirms_transaction along three axes, all NEGATIVE (they can only
# reject, never promote):
#   (a) a TIGHT deal_type allow-set (M&A / LBO / asset-sale / minority-stake).
#       Funding / Fundraising / debt-financing / offering / IPO are DROPPED:
#       bonds, leases, capex, term loans and bitcoin buys are all filed under
#       those types and are not transactions that should lead.
#   (b) deal_flow STAGE / valuation as a NEGATIVE cross-check WHERE A ROW EXISTS.
#       A row whose stage is not signed/closed (PayPal $53B "announced"/rejected
#       bid) or whose valuation is null (the Delivery Hero Minority Stake null
#       sibling) DEMOTES its url. deal_flow is NEVER a positive gate: 9 of 13
#       genuine deals have no row, so absence of a row is not a contradiction.
#   (c) verb-value PROXIMITY plus an idiom block, so "sell-off" / "buy-back" /
#       "reason to buy" cannot pair a stray verb with an unrelated figure
#       ("SpaceX sell-off wipes $1tn", "3 reasons to buy this $2bn stock").
_MEGA_LANE_DEAL_TYPES = frozenset({
    "m&a", "mergers & acquisitions", "lbo", "private equity",
    "asset sale", "minority stake", "stake sale",
})
# Idiom block: value+verb co-occurrences that are NOT a transaction. Earnings-only
# idioms (net income / per share / a quarter) are deliberately EXCLUDED here because
# the tight deal_type allow-set already drops Earnings; leaving them in only false-
# dropped legit M&A headlines ("... for $5B at $55 per share").
_DEAL_IDIOM_BLOCK_RE = re.compile(
    r"(?i)\b(sell[-\s]?off|sold\s+on|buy\s?back|repurchase|"
    r"market\s+cap(?:italization)?|wipe[sd]?|net\s+worth|"
    r"reasons?\s+to\s+buy|stocks?\s+to\s+buy|buy\s+the\s+dip|worth\s+buying|"
    r"top\s+pick|buy\s+rating|reason\s+to\s+sell)\b"
)
# Max character gap between a $1B+ value token and a confirmed-action verb for the
# pair to count as one transaction statement. Arlington "exits ... $1.45bn sale",
# Mitie "agrees GBP 3.1bn takeover" and Uber "agrees to buy ... $14.8 billion" all
# sit well inside this; a verb and a figure at opposite ends of a headline do not.
_VERB_VALUE_MAX_GAP = 55

# Lane-local rumor/preview reject. _title_confirms_mega_deal already applies the
# shared is_rumor_or_preview_lead, but replayed pools showed rumor-framed deal copy
# leaking into the PROMOTION lane ("...reported $53B PayPal bet", "in race to buy ...
# - report", "Uber nears EUR 12.5bn ... FT reports"). These extra markers reject that
# framing in the promotion lane ONLY (they never touch the shared rumor bar). The 12
# confirmed TPs use "agrees / to acquire / closes / completes / exits / divest" and
# are unaffected.
_MEGA_LANE_RUMOR_RE = re.compile(
    r"(?i)\b(report(?:s|ed|edly)?\b|nears?\b|in\s+talks|race\s+to|"
    r"rejected\s+bid|pay\s+package|mulls?|weigh(?:s|ing)|explor(?:es|ing)|"
    r"eyeing|potential\s+(?:bid|deal)|could\s+(?:buy|acquire))\b"
)


def _verb_value_proximate(title: str, min_usd_b: float) -> bool:
    """True when a >= min_usd_b value token and a confirmed-action verb co-occur
    within _VERB_VALUE_MAX_GAP characters in the title. Kills stray verb+figure
    co-occurrences (a 'buy' idiom far from an unrelated market-cap number). Never
    raises."""
    try:
        big_vals: list[tuple[int, int]] = []
        for m in _TEXT_DEAL_VALUE_RE.finditer(title):
            v = float(m.group(1))
            if m.group(2).lower().startswith("t"):
                v *= 1000.0
            if v >= min_usd_b:
                big_vals.append((m.start(), m.end()))
        if not big_vals:
            return False
        verbs = [(m.start(), m.end()) for m in _CONFIRMED_DEAL_VERB_RE.finditer(title)]
        if not verbs:
            return False
        for vs, ve in big_vals:
            for bs, be in verbs:
                gap = (vs - be) if vs >= be else (bs - ve)
                if gap <= _VERB_VALUE_MAX_GAP:
                    return True
        return False
    except Exception:
        return False


def _title_confirms_transaction(article: dict, min_usd_b: float,
                                demote_urls: Optional[set] = None) -> bool:
    """STRICT confirmed-transaction test for the mega PROMOTION lane (DEALGUARD).
    Beyond _title_confirms_mega_deal it requires ALL of:
      (a) a valuation-bearing deal_type in the TIGHT _MEGA_LANE_DEAL_TYPES set
          (M&A / LBO / asset-sale / minority-stake). Funding / Fundraising / IPO /
          offering / debt-financing are rejected outright.
      (b) the url is NOT in demote_urls (a deal_flow row that contradicts: stage
          not signed/closed, or null valuation). Absence of a row never demotes.
      (c) no idiomatic value+verb co-occurrence AND a proximate $1B+ value+verb
          pair (verb-value proximity).
    Arlington, Mitie, Uber/Delivery Hero, CBIZ, TransDigm etc. pass; PayPal $53B
    (announced), the Delivery Hero null sibling, bond/loan/bitcoin 'Funding' rows
    and market-cap idioms are all rejected. Never raises."""
    try:
        dt = str(article.get("deal_type") or "").strip().lower()
        if dt not in _MEGA_LANE_DEAL_TYPES:
            return False
        url = str(article.get("url") or "").strip()
        if demote_urls and url in demote_urls:
            return False
        title = str(article.get("title") or "")
        if _DEAL_IDIOM_BLOCK_RE.search(title):
            return False
        if _MEGA_LANE_RUMOR_RE.search(title):
            return False
        if not _verb_value_proximate(title, min_usd_b):
            return False
        return _title_confirms_mega_deal(article, min_usd_b)
    except Exception:
        return False


def _mega_demote_urls_from_rows(deal_rows: list[dict]) -> set:
    """NEGATIVE cross-check builder. Given deal_flow rows, return the set of
    source_urls whose row CONTRADICTS a confirmed $1B+ transaction: stage not in
    CONFIRMED_STAGES (signed/closed), or a null/unparseable valuation. Used only
    to DEMOTE the article-side promotion lane where a row exists. deal_flow is
    never a positive gate (9 of 13 genuine deals have no row). Never raises."""
    out: set = set()
    try:
        import lead_preselect as lp
        for d in deal_rows or []:
            url = str(d.get("source_url") or "").strip()
            if not url:
                continue
            v = lp.parse_valuation_to_usd_b(d.get("valuation"))
            stage = str(d.get("stage") or "").strip().lower()
            if v is None or stage not in lp.CONFIRMED_STAGES:
                out.add(url)
    except Exception as e:
        logger.warning("impact_ranking: mega_demote_urls failed: %s", e)
    return out


def is_rumor_or_preview_lead(article: dict) -> bool:
    """True when the article is a forward-looking / unconfirmed (rumor or preview)
    story. Deterministic, title-level, no LLM. Used to make such stories INELIGIBLE
    to be the LEAD when a confirmed alternative exists (L2); they stay eligible
    everywhere else. Never raises."""
    try:
        return bool(_RUMOR_PREVIEW_RE.search(str(article.get("title") or "")))
    except Exception:
        return False


def _cluster_is_rumor_preview(scored_cluster: dict, now: datetime.datetime) -> bool:
    """True when the cluster is a rumor / preview CLUSTER (not just one headline).
    Fires when the lead representative reads as rumor/preview OR at least
    RUMOR_CLUSTER_DOMINANCE of the cluster's lead-eligible members do, so which
    single member is the representative does not decide eligibility. A cluster with a
    confirmed representative and only a minority of preview copy is NOT flagged.
    Never raises."""
    try:
        arts = scored_cluster.get("_articles") or []
        eligible = _lead_eligible_arts(arts)  # non-analyst-PT members
        if not eligible:
            return False
        rep = _lead_representative(scored_cluster, now)
        if rep is not None and is_rumor_or_preview_lead(rep):
            return True
        n_rumor = sum(1 for a in eligible if is_rumor_or_preview_lead(a))
        return (n_rumor / len(eligible)) >= RUMOR_CLUSTER_DOMINANCE
    except Exception:
        return False


def _confirmed_alternative_exists(scored: list[dict], now: datetime.datetime) -> bool:
    """L2 gate: does a CONFIRMED alternative exist among today's scored clusters?
    A confirmed alternative is a lead-eligible cluster that is any of:
      - a confirmed $1B+ mega-deal (is_mega_deal, deal_flow-gated at
        RUMOR_BAR_CONFIRMED_DEAL_MIN_USD_B), OR
      - a tier-1 / recent-event macro release (is_tier1 / is_recent), OR
      - an article-side confirmed $1B+ deal whose deal_flow row was never captured
        (_title_confirms_mega_deal on the representative, e.g. a GBP 3.1bn 'agrees
        takeover').
    Analyst-PT-barred and rumor/preview clusters do NOT count as a confirming
    alternative. When this is True, rumor/preview clusters are lead-ineligible.
    Never raises."""
    try:
        for c in scored:
            if _cluster_lead_barred(c, now):
                continue
            if _cluster_is_rumor_preview(c, now):
                continue
            if c.get("is_mega_deal") or c.get("is_tier1") or c.get("is_recent"):
                return True
            rep = _lead_representative(c, now)
            if rep is not None and _title_confirms_mega_deal(
                    rep, RUMOR_BAR_CONFIRMED_DEAL_MIN_USD_B):
                return True
        return False
    except Exception:
        return False


def _lead_bar_reason(scored_cluster: dict, now: datetime.datetime, *,
                     rumor_bar_active: bool) -> Optional[str]:
    """The SHARED lead-eligibility gate used by BOTH the live path
    (compute_shadow_lead) and the unified contest (compute_unified_lead). Returns a
    short reason string when the cluster is INELIGIBLE to be the lead, else None:
      - "analyst_rating_pt"          : L1, unconditional (every member is analyst-PT).
      - "rumor_preview_alt_exists"   : L2, only when rumor_bar_active (a confirmed
                                       alternative exists that day).
    Never raises."""
    try:
        if _cluster_lead_barred(scored_cluster, now):
            return "analyst_rating_pt"
        if rumor_bar_active and _cluster_is_rumor_preview(scored_cluster, now):
            return "rumor_preview_alt_exists"
        return None
    except Exception:
        return None


def compute_shadow_lead(
    pool: list[dict],
    now: datetime.datetime,
    *,
    asof_date: Optional[datetime.date] = None,
    mega_deal_urls: Optional[set[str]] = None,
    mega_demote_urls: Optional[set[str]] = None,
) -> Optional[dict]:
    """Return the market-impact shadow lead, or None on empty input. Never raises.
    Result keys: article, cluster_key, score, reason, breadth, top_clusters.

    L1: clusters whose representative article is an analyst rating / price-target
    story are INELIGIBLE to LEAD (barred structurally, not down-weighted). L2: a
    rumor / preview cluster is INELIGIBLE only when a confirmed alternative exists
    that day (_confirmed_alternative_exists). Both bars run through the shared
    _lead_bar_reason gate. The barred stories stay in the pool and in every other
    surface; only lead selection skips them. If EVERY cluster is barred
    (pathological), the bar is relaxed so a lead still ships."""
    try:
        if not pool:
            return None
        asof_date = asof_date or now.date()
        recent = recent_tier1_events(asof_date)
        scored = score_clusters(pool, now, recent_events=recent, mega_deal_urls=mega_deal_urls,
                                mega_demote_urls=mega_demote_urls)
        if not scored:
            return None
        # L2 gate is computed ONCE over the full scored field, then applied per
        # cluster via the shared _lead_bar_reason helper (same helper the unified
        # contest uses), so the live path and the unified path bar identically.
        rumor_bar_active = _confirmed_alternative_exists(scored, now)
        eligible = [c for c in scored
                    if _lead_bar_reason(c, now, rumor_bar_active=rumor_bar_active) is None]
        # Fail-safe: never ship no lead purely because of the bar. If the bar would
        # empty the field, fall back to the full ranked list.
        ranked = eligible if eligible else scored
        top = ranked[0]
        # L1: pick the lead from the cluster's NON-analyst-PT members. Falls back to
        # the ordinary best article if the fail-safe path put a fully-barred cluster
        # back on the table.
        _bucket = top["cluster_key"].split(":", 1)[1] if top["cluster_key"].startswith("macro:") else None
        lead = _lead_representative(top, now) or _best_article_in_cluster(top["_articles"], now, bucket=_bucket)
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
    mega_demote_urls: Optional[set[str]] = None,
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
        scored = score_clusters(pool, now, recent_events=recent, mega_deal_urls=mega_deal_urls,
                                mega_demote_urls=mega_demote_urls)
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


# ══════════════════════════════════════════════════════════════════════════════
# UNIFIED SCORED LEAD CONTEST (behind UNIFIED_LEAD - see synthesize.py)
# ══════════════════════════════════════════════════════════════════════════════
# WHY: today the lead is a PRECEDENCE choice - impact_pick OR deal_pick - so a
# fresh confirmed blockbuster deal and a market-wide macro event never compete on
# a common yardstick; whichever path fires first wins. compute_unified_lead makes
# ONE deterministic argmax over the SAME candidate set score_clusters already
# produces (macro / impact clusters AND the qualified Filter A/A2 deal, which is
# itself a scored cluster in that pool - recon-confirmed). Every candidate is
# scored on ONE named-weight rubric; argmax(score) is the single lead decision.
#
# RUBRIC (all deterministic, all logged, each component normalized to [0,1]):
#   (1) materiality  - is the story consistent with where the TAPE actually moved?
#                      REUSES tape_is_material + materiality_delta (same signal the
#                      #PR1 re-rank uses) mapped into [0,1]. Weighted HIGHEST.
#   (2) session_fit  - freshness / right-for-this-session. DELEGATED to Agent S's
#                      session_fit.session_fit_score(candidate, brief_type, now).
#                      Weighted HIGHEST (tied with materiality).
#   (3) confirmation - confirmed + a real valuation ("$4B agreed") beats
#                      "seeks"/"in talks"/"announced". REUSES the mega-deal
#                      confirmation gate (is_mega_deal, from confirmed_mega_deal_urls
#                      at :861) and the lead_preselect unconfirmed-keyword blocklist.
#   (4) breadth      - market-wide / broadly-covered gets an EARNED edge, NOT an
#                      automatic win. LOWEST weight: an edge / tiebreaker, never a
#                      trump. A sleepy macro print must not out-score a confirmed
#                      blockbuster deal on breadth alone.
#
# The named weights below are the ONE place Noah tunes the contest. materiality and
# session_fit are the two HIGHEST; breadth is deliberately the smallest so breadth
# is an edge, not a trump. NO buried magic numbers - every scalar the score touches
# is a named constant here.

# ── Unified-contest weights (SAFE DEFAULT / FALLBACK) ────────────────────────
# These four hand-tuned scalars are the SAFE DEFAULT. The ACTIVE weights the
# contest uses are loaded ONCE per process from the `lead_weights` store (contract
# C4, owned by the offline calibrator) via _load_active_weights() below, falling
# back to exactly these values whenever the store is empty, missing, the table does
# not exist (the normal state today - migration written but not applied), or the row
# is stale/invalid. Only the SOURCE of the weights moves here; the default VALUES and
# the scoring math are unchanged. Noah still ratifies by tuning these defaults or by
# ratifying a calibrated row.
W_MATERIALITY = 4.0     # highest: consistency with the real tape move
W_SESSION_FIT = 4.0     # highest (tied): fresh + right for this session
W_CONFIRMATION = 3.0    # confirmed + priced beats "seeks" / "in talks"
W_BREADTH = 1.5         # EARNED edge / tiebreaker, deliberately the smallest

# The hardcoded defaults, frozen as the fallback the loader returns when the store
# yields nothing usable. Keyed by the rubric-component names the contest scores on.
_DEFAULT_LEAD_WEIGHTS: dict[str, float] = {
    "materiality": W_MATERIALITY,
    "session_fit": W_SESSION_FIT,
    "confirmation": W_CONFIRMATION,
    "breadth": W_BREADTH,
}


def _supabase_for_weights():
    """Build a READ-ONLY supabase client for the lead_weights store from env, or
    None when creds / library are absent. Never raises. Selection has NO hard
    dependency on the store: any failure here falls through to the hand defaults."""
    try:
        import os
        from supabase import create_client
        url = os.environ.get("SUPABASE_URL")
        key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
               or os.environ.get("SUPABASE_ANON_KEY"))
        if not url or not key:
            return None
        return create_client(url, key)
    except Exception:
        return None


def _read_active_weights_row() -> Optional[dict]:
    """STORE-READ SEAM (contract C4). Return the latest calibrated `lead_weights`
    row (is_default=false AND jul13_invariant_passed=true), or None when there is no
    such row / no store / no table. Isolated so verification can monkeypatch THIS one
    function to inject a fake row WITHOUT writing prod. Never raises; a missing table
    is the NORMAL state today (migration is written but not yet applied)."""
    sb = _supabase_for_weights()
    if sb is None:
        return None
    try:
        resp = (sb.table("lead_weights")
                .select("version, fit_ts, w_materiality, w_session_fit, "
                        "w_confirmation, w_breadth, n_train, is_default, "
                        "jul13_invariant_passed")
                .eq("is_default", False)
                .eq("jul13_invariant_passed", True)
                .order("version", desc=True)
                .limit(1)
                .execute())
        rows = resp.data or []
        return rows[0] if rows else None
    except Exception:
        # Missing table / permission / transport: fall through to defaults. Normal.
        return None


def _coerce_active_weights(row: Optional[dict]) -> dict:
    """Validate a raw lead_weights row into the active-weights meta shape, or return
    the hand defaults when the row is None / invalid. A row is VALID only when all
    four weights are present and are finite positive numbers and version is a usable
    int; anything else is treated as stale/invalid and falls back to defaults."""
    default_meta = {
        "values": dict(_DEFAULT_LEAD_WEIGHTS),
        "source": "default",
        "version": None,
    }
    if not row:
        return default_meta
    try:
        vals = {
            "materiality": float(row["w_materiality"]),
            "session_fit": float(row["w_session_fit"]),
            "confirmation": float(row["w_confirmation"]),
            "breadth": float(row["w_breadth"]),
        }
        for v in vals.values():
            if not math.isfinite(v) or v <= 0:
                return default_meta
        version = int(row["version"])
        return {
            "values": vals,
            "source": f"calibrated_v{version}",
            "version": version,
        }
    except (KeyError, TypeError, ValueError):
        return default_meta


# Per-process cache of the resolved active weights meta. The store is read ONCE
# (first contest of the process); every later call is pure/cheap. None == not yet
# loaded.
_ACTIVE_WEIGHTS_META: Optional[dict] = None


def _load_active_weights() -> dict:
    """THE SINGLE load point. Resolve + cache the active weights meta for this
    process: the latest valid calibrated row, else the hand defaults. Never raises."""
    global _ACTIVE_WEIGHTS_META
    if _ACTIVE_WEIGHTS_META is None:
        try:
            _ACTIVE_WEIGHTS_META = _coerce_active_weights(_read_active_weights_row())
        except Exception:
            _ACTIVE_WEIGHTS_META = {
                "values": dict(_DEFAULT_LEAD_WEIGHTS),
                "source": "default",
                "version": None,
            }
        if _ACTIVE_WEIGHTS_META["source"] == "default":
            logger.info("impact_ranking: lead weights = hand defaults %s",
                        _ACTIVE_WEIGHTS_META["values"])
        else:
            logger.info("impact_ranking: lead weights = %s v%s %s",
                        _ACTIVE_WEIGHTS_META["source"],
                        _ACTIVE_WEIGHTS_META["version"],
                        _ACTIVE_WEIGHTS_META["values"])
    return _ACTIVE_WEIGHTS_META


def active_weights_meta() -> dict:
    """Public accessor. Return a COPY of the active weights meta:
    {values: {materiality, session_fit, confirmation, breadth},
     source: "default" | "calibrated_vN", version: int | None}.
    Agent S1 logs this into preselect_decision (weights_used). Cheap + pure after
    the first load; never raises."""
    meta = _load_active_weights()
    return {
        "values": dict(meta["values"]),
        "source": meta["source"],
        "version": meta["version"],
    }

# Component-normalization anchors (keep the buried constants named + here).
# Materiality: materiality_delta spans roughly [-(deal+irrelevant), +(wide+driver)];
# map linearly through this half-range into [0,1], 0.5 == neutral (no signal).
_UNIFIED_MAT_HALF_RANGE = (
    MAT_DEAL_NOT_DRIVER_PENALTY + MAT_US_IRRELEVANT_PENALTY
)  # ~16.0; the largest single-direction delta magnitude we normalize against
# Breadth: distinct-source count at/above this reads as "fully broad" (component 1.0).
_UNIFIED_BREADTH_SAT_SOURCES = 12.0
# Confirmation component levels (deterministic ladder, all named). Order matters:
# a confirmed $1B+ deal is the strongest concrete fact; a HARD macro print (an actual
# CPI/Fed/jobs release) is a real, concrete event and ranks ABOVE a generic priced
# deal; a real valuation-bearing deal_type is priced; everything else is neutral;
# speculative ("seeks"/"in talks") is demoted hard.
_CONF_CONFIRMED_MEGA = 1.0    # confirmed $1B+ deal url (mega-deal gate)
_CONF_MACRO_HARD = 0.85      # a hard macro print (tier-1 / recent event) is a real event
_CONF_PRICED = 0.8           # a real valuation-bearing deal_type (M&A / funding / etc.)
_CONF_NEUTRAL = 0.5          # ordinary confirmed-enough story (incl. single-name drift)
_CONF_SPECULATIVE = 0.15     # "seeks" / "in talks" / "rumored" single-name

# ── Deal-VALUE size sensitivity (named, tunable) ─────────────────────────────
# Root cause the value terms fix: confirmation was value-BLIND. Every priced deal
# got a flat _CONF_PRICED (0.8) and every mega-deal a flat 1.0, so a $545M share
# sale tied a $1.45B acquisition and a GBP 3.1bn takeover tied a $1M raise. Deal
# VALUE now scales confirmation with a SATURATING log of USD-billions, in TWO bands
# so a large confirmed deal beats a small confirmed one:
#   - MEGA band  [CONF_MEGA_FLOOR, CONF_MEGA_CEIL]  : a deal_flow-confirmed $1B+ deal
#     (is_mega_deal). Value floored at $1B, so a mega is always >= the macro rung.
#   - PRICED band [CONF_PRICED_FLOOR, CONF_PRICED_CEIL] : a valuation-bearing deal_type
#     that did NOT clear the mega gate (currency / stale deal_flow stage). Ceiling
#     sits just under the mega floor so it never leapfrogs a confirmed mega.
# This lives ENTIRELY inside the weight-3 confirmation dimension. Materiality
# (weight 4) is untouched, so a market-moving macro event still outscores a large
# deal (demonstrated in the PR). A confirmed deal with NO parseable value is NEUTRAL
# (keeps _CONF_PRICED = 0.8), never scored as tiny. Log-scaled, not linear, so
# $14.8B beats $1.45B but not by 10x and no single refinancing dominates forever.
CONF_MEGA_FLOOR = 0.90        # a confirmed $1B mega-deal (value floored at $1B)
CONF_MEGA_CEIL = 1.00         # a confirmed mega-deal at/above the saturation point
CONF_PRICED_FLOOR = 0.55      # a confirmed but tiny (sub-$100M) priced deal
CONF_PRICED_CEIL = 0.85       # a large priced deal that missed the mega gate
CONF_VALUE_SAT_USD_B = 20.0   # USD-billions at which the value bump saturates

# Rough FX to USD for value ORDERING only (not accounting): a GBP 3.1bn takeover
# must be recognized as large. Approximate on purpose; the score only needs the
# magnitude order, and the mega gate uses lead_preselect's precise parse upstream.
_FX_TO_USD = {"£": 1.27, "gbp": 1.27, "€": 1.08, "eur": 1.08}
_UNIT_TO_B = {"trillion": 1000.0, "tn": 1000.0, "t": 1000.0,
              "billion": 1.0, "bn": 1.0, "b": 1.0,
              "million": 0.001, "mn": 0.001, "m": 0.001}
_CONF_VALUE_RE = re.compile(
    r"(?ix)(us\$|a\$|c\$|\$|€|£|gbp|eur|usd)\s?(\d+(?:\.\d+)?)\s*"
    r"(trillion|tn|t|billion|bn|b|million|mn|m)\b")


def _deal_value_usd_b(text: str) -> Optional[float]:
    """Largest monetary value in the text, in USD billions (FX-approximate, for
    ordering only). Returns None when no parseable value is present, so the caller
    can treat a value-less confirmed deal as NEUTRAL rather than tiny. Never raises."""
    try:
        best: Optional[float] = None
        for m in _CONF_VALUE_RE.finditer(text or ""):
            cur, num, unit = m.group(1).lower(), float(m.group(2)), m.group(3).lower()
            usd_b = num * _UNIT_TO_B[unit] * _FX_TO_USD.get(cur, 1.0)
            if best is None or usd_b > best:
                best = usd_b
        return best
    except Exception:
        return None


def _value_scaled_conf(value_b: Optional[float], floor: float, ceil: float) -> Optional[float]:
    """Saturating-log map of a USD-billions value into [floor, ceil]. None -> None
    (caller keeps the neutral baseline). Pure."""
    if value_b is None:
        return None
    frac = math.log1p(max(0.0, value_b)) / math.log1p(CONF_VALUE_SAT_USD_B)
    frac = min(1.0, max(0.0, frac))
    return floor + (ceil - floor) * frac

# ── Unified materiality-component shaping (named; the market-wide edge + noise demote) ──
# On a QUIET tape materiality_delta is ~0 for everyone, so the raw delta cannot tell a
# market-wide macro read apart from single-name noise. These layer a deterministic edge
# on the [0,1] materiality component so the HIGHEST-weighted dimension actually does its
# job: a market-wide / macro cluster earns an edge that SCALES WITH the tape magnitude
# (a genuinely moving tape lifts the broad read a lot; a dead-flat tape lifts it only a
# little - an EARNED edge, not an automatic win), and a single-name pure-deal cluster
# that is NOT a confirmed tape driver is demoted (the tape did not move on its account).
_MAT_WIDE_EDGE_MAX = 0.30     # max market-wide/macro lift added to the 0.5 neutral base

# Rebased from #527 (O3). A confirmed mega-deal earned only the 0.5 neutral materiality
# on a quiet tape, so a $14.8B acquisition lost the breadth tiebreak to a $101M contract.
# A confirmed >=$1B deal is material BY VALUE. Floor only: it never lowers a higher
# earned score. Value-scaled so $14.8B floors above $1.45B.
#
# THE CEILING IS LOAD-BEARING. 0.75 sits UNDER the market-wide/macro cap
# (0.5 + _MAT_WIDE_EDGE_MAX = 0.80), so a genuinely material macro on a moving tape can
# NEVER be displaced by a deal, however large. Do not raise _MEGA_MAT_FLOOR_MAX to or
# above 0.80 without deciding you want deals to outrank macro.
_MEGA_MAT_FLOOR_MIN = 0.55    # a confirmed $1B mega-deal (value floored at $1B)
_MEGA_MAT_FLOOR_MAX = 0.75    # a confirmed mega-deal at/above the value saturation point
# THE FLOOR MAY NEVER FLIP THE WINNER FROM MACRO TO A DEAL (fix for the #560 regression).
# #560 argued that capping the floor at 0.75, under the 0.80 market-wide cap, meant macro
# could never be displaced. That was wrong twice over. First, 0.80 caps macro's EARNED
# edge, and that edge is scaled by |S&P move %|, so on a quiet tape macro earns almost
# none of it: on 2026-08-07 macro:jobs earned c_materiality 0.544 and the 0.75 floor
# walked over it, which is how the payrolls-miss day led with Electronic Arts. Second,
# materiality is only ONE of four weighted components, so capping it does not even
# guarantee the ordering: on 2026-07-31 a $1.2bn tuck-in still beat macro:cpi on the
# other three (measured, not assumed).
#
# So the guard is applied where the damage actually happens, at the argmax. The floor is
# free to reorder deals among themselves and to lift a deal over single-name noise, which
# is what it was built for. It is only forbidden from being the reason a macro cluster
# stops winning. Deliberately NOT conditioned on macro_panel.fired_today: that flag was
# broken by the _MACRO_MONTHS collision for four weeks, and on 2026-07-31 it was empty
# while a real macro:cpi cluster was present, so a flag-based fix would have missed one of
# the two regressions outright.
_MAT_WIDE_MAG_SAT_PCT = 1.5   # |S&P move %| at which the wide edge saturates to the max
_MAT_SINGLE_NAME_NOISE_DEMOTE = 0.20  # demote a non-driver single-name pure-deal cluster


def _unified_session_fit(candidate: dict, brief_type: str,
                         now: datetime.datetime) -> tuple[float, bool]:
    """Session-fit component in [0,1]. DELEGATED to Agent S's detector by name;
    returns (score, used_detector). If session_fit is not importable (S not yet
    merged) OR raises, fall back to a pure freshness proxy so the contest still
    runs. The proxy is intentionally simple (recency_factor) so the real detector
    is the source of truth once merged; the fallback never out-ranks a genuinely
    fresh story."""
    try:
        import session_fit as _sf
        v = float(_sf.session_fit_score(candidate, brief_type, now))
        return max(0.0, min(1.0, v)), True
    except Exception:
        # Fallback proxy: freshness of the candidate's lead article.
        age = _age_hours(candidate, now)
        return _recency_factor(age), False


def _has_priced_deal_type(arts: list[dict]) -> bool:
    """True when the cluster carries a REAL valuation-bearing deal_type on the deal
    side (M&A / funding / offering / etc.), not merely a keyword-matched 'ipo' theme
    on a stock-drift story. This is the concreteness signal for the priced-deal rung:
    an IPO-aftermarket 'stock closes $1 above IPO price' article is NOT a priced deal."""
    for a in arts:
        if (str(a.get("deal_type") or "").strip().lower()) in _PURE_DEAL_TYPES:
            return True
    return False


def _unified_confirmation(scored_cluster: dict) -> tuple[float, str]:
    """Confirmation / concreteness component in [0,1]. Deterministic ladder (highest
    first):
      - a confirmed $1B+ deal (is_mega_deal, the mega-deal gate)          -> 1.00
      - a HARD macro print (tier-1 / recent event: an actual CPI/Fed/jobs) -> 0.85
      - a real valuation-bearing deal_type (M&A/funding/offering/etc.)     -> 0.80
      - ordinary confirmed story (incl. single-name stock drift)          -> 0.50
      - speculative ("seeks"/"in talks"/"rumored") single-name            -> 0.15
    A hard macro print ranks ABOVE a generic priced deal because a real macro release
    is a concrete, confirmed event, not a might-happen transaction. A single-name
    stock-drift story that merely matched a deal THEME (e.g. an IPO-aftermarket close)
    is NOT priced - it lands at neutral. Pure; reuses lead_preselect's
    unconfirmed-keyword blocklist so speculation is demoted the same way the deal
    pre-selector demotes it."""
    arts = _cluster_arts(scored_cluster)
    text = _cluster_text(arts)
    value_b = _deal_value_usd_b(text)
    if scored_cluster.get("is_mega_deal"):
        # MEGA band: a deal_flow-confirmed $1B+ deal, value-scaled in [0.90, 1.00].
        # Value floored at $1B (the gate's own floor) so a mega is never below the
        # macro rung even if the title omits the figure (value_b None -> $1B anchor).
        v = max(value_b if value_b is not None else 1.0, 1.0)
        conf = _value_scaled_conf(v, CONF_MEGA_FLOOR, CONF_MEGA_CEIL)
        return conf, f"confirmed $1B+ deal (mega-deal gate, value-scaled ~${v:.1f}B)"
    # Speculative single-name deal copy is demoted hard.
    try:
        import lead_preselect as _lp
        if (_lp._has_unconfirmed_keyword(text)
                or _lp._has_unconfirmed_keyword_non_ma(text)):
            return _CONF_SPECULATIVE, "speculative (seeks / in talks / rumored)"
    except Exception:
        pass
    # A hard macro print (an actual release) is a concrete, confirmed event.
    if scored_cluster.get("is_tier1") or scored_cluster.get("is_recent"):
        return _CONF_MACRO_HARD, "hard macro print (tier-1 / recent event)"
    # A REAL priced deal (valuation-bearing deal_type), not a keyword-matched theme.
    # PRICED band [0.55, 0.85] value-scaled: a large priced deal that missed the mega
    # gate (currency / stale deal_flow stage) beats a small one, but its ceiling stays
    # under the mega floor. A priced deal with NO parseable value is NEUTRAL-confirmed
    # (keeps _CONF_PRICED = 0.8), never scored as tiny.
    if _has_priced_deal_type(arts):
        conf = _value_scaled_conf(value_b, CONF_PRICED_FLOOR, CONF_PRICED_CEIL)
        if conf is None:
            return _CONF_PRICED, "priced deal (valuation-bearing deal_type, value n/a)"
        return conf, f"priced deal (value-scaled ${value_b:.2f}B)"
    return _CONF_NEUTRAL, "ordinary confirmed story"


def _unified_breadth(scored_cluster: dict) -> float:
    """Breadth component in [0,1]: distinct-source coverage, saturating at
    _UNIFIED_BREADTH_SAT_SOURCES. Market-wide / macro clusters get a small floor
    so a genuinely market-wide event carries an EARNED breadth edge - but the LOW
    W_BREADTH weight keeps this a tiebreaker, never a trump."""
    n = float(scored_cluster.get("distinct_sources") or 0)
    frac = min(1.0, n / _UNIFIED_BREADTH_SAT_SOURCES)
    key = scored_cluster["cluster_key"]
    text = _cluster_text(_cluster_arts(scored_cluster))
    if _is_market_wide_cluster(key, text):
        frac = max(frac, 0.5)  # market-wide floor: an earned edge, not a win
    return frac


def _unified_materiality(scored_cluster: dict, *, tape: Optional[dict],
                         driver_names: set[str],
                         name_session_pct: Optional[dict],
                         apply_mega_floor: bool = True) -> tuple[float, list[str]]:
    """Materiality component in [0,1], the HIGHEST-weighted dimension. Built on
    materiality_delta (the #PR1 signal) PLUS a deterministic market-wide edge and a
    single-name-noise demote, so the component discriminates macro-vs-single-name
    even on a QUIET tape (where the raw delta is ~0 for everyone and cannot).

    Layers (all named constants):
      base 0.5  (neutral)
      + materiality_delta mapped through the half-range   (the #PR1 tape-consistency)
      + market-wide/macro EARNED edge, scaled by |S&P move %| up to _MAT_WIDE_MAG_SAT_PCT
        (a genuinely moving tape lifts the broad read a lot; a dead-flat tape barely)
      - single-name pure-deal NON-driver demote (the tape did not move on its account)
    Clamped to [0,1]. Pure."""
    md = materiality_delta(scored_cluster, tape=tape, driver_names=driver_names,
                           name_session_pct=name_session_pct)
    reasons = list(md["reasons"])
    hr = _UNIFIED_MAT_HALF_RANGE or 1.0
    comp = 0.5 + (md["delta"] / (2.0 * hr))

    key = scored_cluster["cluster_key"]
    arts = _cluster_arts(scored_cluster)
    text = _cluster_text(arts)
    companies = _cluster_companies(arts)

    # Market-wide / macro EARNED edge, scaled by the tape magnitude. Uses |S&P move %|
    # as the magnitude proxy; on a flat tape the edge is small, on a big move it hits
    # the cap. This is the "market-wide gets an EARNED edge, NOT an automatic win" rule.
    if tape and _is_market_wide_cluster(key, text):
        p = tape_pcts(tape)
        mag = abs(p["spx"]) if p["spx"] is not None else 0.0
        frac = min(1.0, mag / (_MAT_WIDE_MAG_SAT_PCT or 1.0))
        edge = _MAT_WIDE_EDGE_MAX * frac
        if edge > 0:
            comp += edge
            reasons.append(f"market-wide earned edge (+{round(edge, 3)}, |spx|={mag:.2f}%)")

    # Single-name pure-deal that is NOT a confirmed tape driver: the tape did not move
    # on its account, so its materiality is low. (Confirmed drivers / mega deals keep
    # their materiality; those are handled by materiality_delta bonuses + confirmation.)
    is_driver = bool(companies & driver_names)
    if (_is_pure_deal_cluster(key, arts) and _is_single_name_cluster(key, companies)
            and not is_driver and not scored_cluster.get("is_mega_deal")):
        comp -= _MAT_SINGLE_NAME_NOISE_DEMOTE
        reasons.append(f"single-name non-driver noise (-{_MAT_SINGLE_NAME_NOISE_DEMOTE})")

    # Rebased from #527 (O3). Confirmed mega-deal materiality floor: see the constants
    # above. Floor only, value-scaled, capped under the market-wide edge.
    if scored_cluster.get("is_mega_deal") and apply_mega_floor:
        v = _deal_value_usd_b(text)
        floor = _value_scaled_conf(max(v if v is not None else 1.0, 1.0),
                                   _MEGA_MAT_FLOOR_MIN, _MEGA_MAT_FLOOR_MAX)
        if floor is not None and comp < floor:
            reasons.append(
                f"confirmed mega-deal value floor (-> {round(floor, 3)}, "
                f"~${max(v or 1.0, 1.0):.1f}B)"
            )
            comp = floor

    return max(0.0, min(1.0, comp)), reasons


def compute_unified_lead(
    pool: list[dict],
    now: datetime.datetime,
    *,
    brief_type: str = "morning",
    tape: Optional[dict] = None,
    name_session_pct: Optional[dict] = None,
    mega_deal_urls: Optional[set[str]] = None,
    mega_demote_urls: Optional[set[str]] = None,
    asof_date: Optional[datetime.date] = None,
    always_include_clusters: Optional[set[str]] = None,
) -> Optional[dict]:
    """UNIFIED scored lead contest. ONE deterministic argmax over the SAME candidate
    set score_clusters produces (macro / impact clusters AND the qualified deal,
    which is already a scored cluster in the pool). Every candidate is scored on the
    named-weight rubric (materiality / session_fit / confirmation / breadth); the
    argmax is the lead. PURE: tape + per-name moves are passed in; session-fit is
    delegated to session_fit.session_fit_score. Never raises; returns None on empty.

    always_include_clusters: cluster_key set (e.g. the SHIPPED lead's cluster) whose
    full component vector MUST appear in the returned 'unified_candidates' audit even
    when it ranks below _TOP_CLUSTERS_AUDIT_CAP. Without this, on disagreement days
    the shipped lead's feature vector is dropped from the log (it ranked below the
    top-10 of hundreds of clusters), so the calibrator cannot join that day's grade to
    the shipped lead and the run is unusable for training. Forced-in rows carry
    below_cap=true; every audited row carries its cluster_key so is_shipped_lead
    resolves. No re-score: the component vector is already computed; this just does not
    drop it. Deduped against the top-cap slice.

    Result mirrors compute_materiality_lead's shape PLUS 'unified' (the winner's
    component breakdown) and 'unified_candidates' (per-cluster component tables for
    the audit log)."""
    try:
        if not pool:
            return None
        asof_date = asof_date or now.date()
        recent = recent_tier1_events(asof_date)
        scored = score_clusters(pool, now, recent_events=recent,
                                mega_deal_urls=mega_deal_urls,
                                mega_demote_urls=mega_demote_urls)
        if not scored:
            return None
        driver_names = _driver_names_from_moves(name_session_pct)

        # SINGLE weight-load point: active weights come from the calibrated store,
        # falling back to the hand defaults. Only the SOURCE differs from before; the
        # math and the default values are unchanged.
        _wmeta = active_weights_meta()
        _w = _wmeta["values"]
        w_materiality = _w["materiality"]
        w_session_fit = _w["session_fit"]
        w_confirmation = _w["confirmation"]
        w_breadth = _w["breadth"]

        # L2 gate, computed ONCE over the full scored field via the SAME helper the
        # live path (compute_shadow_lead) uses, so the rumor/preview bar fires
        # identically on both paths and survives the UNIFIED_LEAD flip.
        rumor_bar_active = _confirmed_alternative_exists(scored, now)

        ranked = []
        for c in scored:
            _bkt = (c["cluster_key"].split(":", 1)[1]
                    if c["cluster_key"].startswith("macro:") else None)
            # L1: the LEAD representative is chosen from the cluster's non-analyst-PT
            # members; a cluster is lead-barred only when EVERY member is analyst-PT.
            # A cluster that merely contains a PT story leads with its best non-PT
            # article. Fall back to the ordinary best only for the (barred) score rep.
            _lead_rep = _lead_representative(c, now)
            rep = _lead_rep or _best_article_in_cluster(_cluster_arts(c), now, bucket=_bkt)
            mat_comp, mat_reasons = _unified_materiality(
                c, tape=tape, driver_names=driver_names,
                name_session_pct=name_session_pct)
            # Same vector with the mega-deal floor switched off. Used only by the
            # macro-protection guard below; it never changes what is scored or logged.
            if c.get("is_mega_deal"):
                _mat_nofloor, _ = _unified_materiality(
                    c, tape=tape, driver_names=driver_names,
                    name_session_pct=name_session_pct, apply_mega_floor=False)
            else:
                _mat_nofloor = mat_comp
            sf_comp, sf_used = _unified_session_fit(rep, brief_type, now)
            conf_comp, conf_reason = _unified_confirmation(c)
            breadth_comp = _unified_breadth(c)
            unified_score = round(
                w_materiality * mat_comp
                + w_session_fit * sf_comp
                + w_confirmation * conf_comp
                + w_breadth * breadth_comp,
                4,
            )
            rec = dict(c)
            rec["_rep_article"] = rep
            rec["c_materiality"] = round(mat_comp, 4)
            rec["c_session_fit"] = round(sf_comp, 4)
            rec["c_confirmation"] = round(conf_comp, 4)
            rec["c_breadth"] = round(breadth_comp, 4)
            rec["session_fit_from_detector"] = sf_used
            rec["confirmation_reason"] = conf_reason
            rec["unified_materiality_reasons"] = mat_reasons
            rec["unified_score"] = unified_score
            # Shadow score with the mega-deal floor off. Not logged into the C1 vector
            # (which must stay exactly the served components); used only by the guard.
            rec["_score_nofloor"] = round(
                w_materiality * _mat_nofloor
                + w_session_fit * sf_comp
                + w_confirmation * conf_comp
                + w_breadth * breadth_comp,
                4,
            )
            # Guard trigger is the macro: cluster KEY, not _is_market_wide_cluster.
            # That helper also classifies generic index-move copy ("European Stock
            # Indexes Gain at Open", "Stock Market Today: futures gain") as market-wide,
            # and those are exactly the low-signal stories the floor is helping us
            # escape. Measured: triggering on the helper suppressed the floor on 7 days
            # and cost real improvements (Uber $14.8bn, DCC GBP 5.75bn, Visa/BioCatch).
            # A real release cluster is keyed macro:jobs, macro:cpi and so on.
            rec["_is_macro_cluster"] = c["cluster_key"].startswith("macro:")
            # L1 + L2: a cluster is LEAD-INELIGIBLE when the shared _lead_bar_reason
            # gate returns a reason: analyst rating / PT (L1, unconditional) OR
            # rumor / preview with a confirmed alternative present (L2, conditional).
            # The row stays in the audit (with lead_barred=True + lead_bar_reason) so
            # the calibrator can see it was scored and dropped; it is excluded only
            # from the argmax that picks the served lead.
            _bar_reason = _lead_bar_reason(c, now, rumor_bar_active=rumor_bar_active)
            rec["lead_barred"] = _bar_reason is not None
            rec["lead_bar_reason"] = _bar_reason
            ranked.append(rec)

        # MACRO-PROTECTION GUARD. The mega-deal floor may reorder deals and lift a deal
        # over single-name noise. It may NOT be the reason a macro cluster stops winning.
        # If the floored argmax is a floored mega-deal while the unfloored argmax is a
        # macro cluster, the floor caused the flip: undo it for that candidate only.
        _elig = [c for c in ranked if not _lead_bar_reason(c, now, rumor_bar_active=rumor_bar_active)] or ranked
        if _elig:
            _win_f = max(_elig, key=lambda c: c["unified_score"])
            _win_n = max(_elig, key=lambda c: c["_score_nofloor"])
            if (_win_f.get("is_mega_deal")
                    and _win_f["unified_score"] > _win_f["_score_nofloor"]
                    and _win_n.get("_is_macro_cluster")
                    and _win_n["cluster_key"] != _win_f["cluster_key"]):
                logger.info(
                    "unified: mega-deal floor flipped the winner from macro %s (%.4f) to "
                    "%s (%.4f); reverting the floor on that deal",
                    _win_n["cluster_key"], _win_n["_score_nofloor"],
                    _win_f["cluster_key"], _win_f["unified_score"],
                )
                # Suppress the floor for the WHOLE FIELD on this day, not just for the
                # winning deal. Reverting one candidate only hands the lead to the next
                # floored deal (measured: 2026-08-07 fell through to a Pizza Hut sale).
                # The day either gets the floor or it does not.
                for _r in ranked:
                    if _r["unified_score"] == _r["_score_nofloor"]:
                        continue
                    _delta = _r["unified_score"] - _r["_score_nofloor"]
                    _r["unified_score"] = _r["_score_nofloor"]
                    _r["c_materiality"] = round(
                        _r["c_materiality"] - _delta / (w_materiality or 1.0), 4
                    )
                    _r.setdefault("unified_materiality_reasons", []).append(
                        "mega-deal floor suppressed: it would have displaced a macro lead"
                    )

        for _r in ranked:
            _r.pop("_score_nofloor", None)
            _r.pop("_is_macro_cluster", None)
        ranked.sort(key=lambda c: -c["unified_score"])
        # L1: the LEAD argmax is over candidates NOT barred as analyst rating / PT.
        # Fail-safe: if the bar would empty the field, fall back to the full ranking
        # so a lead still ships.
        _eligible = [c for c in ranked if not c.get("lead_barred")]
        top = (_eligible or ranked)[0]
        lead = top["_rep_article"]

        def _rep_title(rec: dict) -> Optional[str]:
            a = rec.get("_rep_article") or {}
            t = (a.get("title") or "").strip()
            return t[:200] or None

        def _audit_row(c: dict, *, below_cap: bool = False) -> dict:
            return {
                "cluster_key": c["cluster_key"],
                "title": _rep_title(c),
                "unified_score": c["unified_score"],
                "c_materiality": c["c_materiality"],
                "c_session_fit": c["c_session_fit"],
                "c_confirmation": c["c_confirmation"],
                "c_breadth": c["c_breadth"],
                "session_fit_from_detector": c["session_fit_from_detector"],
                "confirmation_reason": c["confirmation_reason"],
                "distinct_sources": c["distinct_sources"],
                "article_count": c["article_count"],
                "is_mega_deal": c.get("is_mega_deal", False),
                "is_tier1": c.get("is_tier1", False),
                "lead_barred": c.get("lead_barred", False),
                "lead_bar_reason": c.get("lead_bar_reason"),
                "below_cap": below_cap,
            }

        top_slice = ranked[:_TOP_CLUSTERS_AUDIT_CAP]
        candidates_audit = [_audit_row(c) for c in top_slice]
        # L1: the SERVED lead cluster (top) can be an eligible cluster that ranks
        # below the raw-score cap when barred analyst-PT clusters sit above it. Force
        # it into the audit so the served lead's vector is never dropped, and so
        # unified_winner (below) resolves to the served lead rather than a barred
        # higher-scored row.
        force = set(always_include_clusters or ())
        force.add(top["cluster_key"])
        _in_audit = {c["cluster_key"] for c in top_slice}
        for c in ranked[_TOP_CLUSTERS_AUDIT_CAP:]:
            if c["cluster_key"] in force and c["cluster_key"] not in _in_audit:
                candidates_audit.append(_audit_row(c, below_cap=True))
                _in_audit.add(c["cluster_key"])
        # unified_winner is the SERVED lead (eligible argmax), not the raw top score.
        _winner_row = next(
            (r for r in candidates_audit if r["cluster_key"] == top["cluster_key"]),
            candidates_audit[0] if candidates_audit else None,
        )
        losers = [r for r in candidates_audit
                  if r is not _winner_row and not r.get("below_cap")
                  and not r.get("lead_barred")][:2]
        return {
            "article": lead,
            "cluster_key": top["cluster_key"],
            "score": top["unified_score"],
            "reason": top["reason"],
            "breadth": {"distinct_sources": top["distinct_sources"],
                        "article_count": top["article_count"]},
            "recent_events": sorted(recent),
            "unified": {
                "score": top["unified_score"],
                "c_materiality": top["c_materiality"],
                "c_session_fit": top["c_session_fit"],
                "c_confirmation": top["c_confirmation"],
                "c_breadth": top["c_breadth"],
                "weights": {
                    "W_MATERIALITY": w_materiality,
                    "W_SESSION_FIT": w_session_fit,
                    "W_CONFIRMATION": w_confirmation,
                    "W_BREADTH": w_breadth,
                },
                "weights_source": _wmeta["source"],
                "weights_version": _wmeta["version"],
                "session_fit_from_detector": top["session_fit_from_detector"],
                "confirmation_reason": top["confirmation_reason"],
                "materiality_reasons": top["unified_materiality_reasons"],
            },
            "unified_winner": _winner_row,
            "unified_losers": losers,
            "unified_candidates": candidates_audit,
        }
    except Exception as e:
        logger.warning("impact_ranking: compute_unified_lead failed: %s", e)
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


_RELEASE_TEXT_COLS = "title, summary, source, published_at, ingested_at"


def fetch_release_text_pool(sb, now: datetime.datetime, hours_ingest: int = 24,
                            hours_publish: int = 48, limit: int = 5000) -> list[dict]:
    """Point-in-time TEXT-ONLY window for the macro release extractor.

    WHY THIS EXISTS AND WHY THE EXISTING POOLS DO NOT WORK. The extractor needs to
    see every article that mentions today's release. Neither existing pool does:

      spine (relevance-top-60)   on 2026-08-07 the payrolls articles ranked 696,
                                 718, 963 and 965 of 1000 because 600 articles tied
                                 at relevance_score 10. Never seen.
      fetch_coverage_pool        recency-ordered LIMIT 1000, but the window held
                                 2397 articles, so the 1000 rows spanned only
                                 13:59:18 to 14:04:14, FIVE MINUTES. The 13:59:18
                                 consensus article sat exactly on the cut.

    So this is a separate, deliberately CHEAP query: five small text columns, no
    content body, no join, ordered on the indexed ingested_at. It costs ONE extra
    SELECT per run and is the only way the extractor sees the whole day.
    Read-only; never raises."""
    try:
        ing = (now - datetime.timedelta(hours=hours_ingest)).isoformat()
        pub = (now - datetime.timedelta(hours=hours_publish)).isoformat()
        upper = now.isoformat()
        # PAGINATED. PostgREST enforces a server-side max-rows of 1000 regardless
        # of .limit(), so a single call silently truncates. On 2026-08-07 that gave
        # 1000 rows spanning FIVE MINUTES of a 2397-article window, and the 13:59:18
        # consensus article sat exactly on the cut. Page until the window is
        # exhausted or `limit` is reached.
        out: list[dict] = []
        page = 1000
        for start in range(0, max(limit, page), page):
            resp = (sb.table("articles").select(_RELEASE_TEXT_COLS)
                    .gte("ingested_at", ing).lt("ingested_at", upper)
                    .gte("published_at", pub).lt("published_at", upper)
                    .order("ingested_at", desc=True)
                    .range(start, start + page - 1).execute())
            batch = resp.data or []
            out.extend(batch)
            if len(batch) < page or len(out) >= limit:
                break
        return out[:limit]
    except Exception as e:
        logger.warning("impact_ranking: fetch_release_text_pool failed: %s", e)
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


def _mega_demote_urls(sb, now: datetime.datetime) -> set[str]:
    """Live builder for the NEGATIVE cross-check set. Reuse lead_preselect's
    deal_flow fetch, then flag urls whose row contradicts a confirmed $1B+
    transaction (_mega_demote_urls_from_rows). Read-only; never raises."""
    try:
        import lead_preselect as lp
        deal_rows = lp.fetch_recent_deal_flow(sb, hours=48, limit=300)
        return _mega_demote_urls_from_rows(deal_rows)
    except Exception as e:
        logger.warning("impact_ranking: _mega_demote_urls failed: %s", e)
        return set()


def shadow_compare(sb, live_lead_title: str, now: datetime.datetime,
                   *, asof_date: Optional[datetime.date] = None) -> dict:
    """Compute the SHADOW impact lead and a divergence record vs the live lead.
    Read-only, never raises, never changes the live brief. Returns a dict of
    shadow_* fields for the run decision log."""
    try:
        pool = fetch_coverage_pool(sb, now)
        res = compute_shadow_lead(pool, now, asof_date=asof_date or now.date(),
                                  mega_deal_urls=_mega_deal_urls(sb, now),
                                  mega_demote_urls=_mega_demote_urls(sb, now))
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
