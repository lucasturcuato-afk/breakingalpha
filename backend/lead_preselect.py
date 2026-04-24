"""
lead_preselect.py — BreakingAlpha

Deterministic Python pre-picker for the briefing primary_story.

Background
----------
Prior to this module, synthesize.py handed Gemini the full spine+floor
corpus and relied on an in-prompt "PRIMARY STORY SELECTION" block to pick
the lead. On busy deal days that rule occasionally misfired (e.g. picking
a valuation-only story while a confirmed $1B+ transaction sat in the
pool). Path B replaces the selection step with a Python filter over
`deal_flow` (populated by deal_extractor.py), ranks by size / freshness /
source tier, and falls back through macro → geopolitical → sector when no
qualifying priced transaction exists.

Integration
-----------
Callers should invoke `preselect_primary_story(articles, brief_type)`
inside `synthesize.run()` AFTER `_freshness_rerank` and BEFORE
`_select_articles_for_synthesis`. See SPEC_path_b_lead_preselect.md §3.

If the return value is a dict, the caller should hoist it into the spine
and inject `build_preselect_directive(preselected)` into the system
prompt so Gemini narrates (not re-ranks).

If the return value is None, the legacy PR #128 in-prompt selection block
runs as fallback. This module is strictly additive — it can never force a
regression to worse-than-baseline.

No Gemini calls live in this module; the deal_flow rows it consumes are
populated by `deal_extractor.py`, which must run BEFORE synthesize for
the pre-pick to see fresh rows (see run.py step ordering).
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone, timedelta
from typing import Optional

# --- Supabase client (module-level for efficiency; mocked in tests) ----
try:
    from supabase import create_client
    _SUPABASE_URL = os.environ.get("SUPABASE_URL")
    _SUPABASE_ANON = os.environ.get("SUPABASE_ANON_KEY")
    if _SUPABASE_URL and _SUPABASE_ANON:
        supabase = create_client(_SUPABASE_URL, _SUPABASE_ANON)
    else:  # pragma: no cover — unit tests run without env
        supabase = None
except Exception:  # pragma: no cover
    supabase = None


# --- Constants ----------------------------------------------------------

# "Confirmed $1B+" deal threshold, in USD billions. Non-USD currencies are
# treated at approximate parity for the gate — a deal at A$25B, £20B, or
# €15B clears $1B USD by a wide margin at any reasonable FX rate.
MIN_DEAL_VALUE_USD_B = 1.0

# Spec §3 — confirmation_status tiers that qualify a deal_flow row for
# Filter A. deal_extractor's enum does not emit shareholder_approved or
# regulatory_approved today (Spec §5); those states are bridged via
# keyword augment on the article title/summary.
CONFIRMED_STAGES = {"signed", "closed"}

# Fallback-hierarchy freshness window (Spec §3.4). Articles older than
# this are not eligible as macro/geopolitical/sector fallbacks even if
# their relevance_score is high — a 23h-old macro print should not lead
# tomorrow's brief.
FALLBACK_MAX_AGE_HOURS = 24.0

# Sector-moving fallback (Spec §3.4c): cluster of 3+ articles in the
# same industry_vertical within the last 12h.
SECTOR_CLUSTER_WINDOW_HOURS = 12.0
SECTOR_CLUSTER_MIN_ARTICLES = 3
SECTOR_CLUSTER_MIN_SCORE = 7

# Spec §3.4a/b: macro and geopolitical fallbacks require relevance_score
# >= 8 to block out noise. Freshness re-rank runs before this so age is
# already baked in.
MACRO_GEO_MIN_SCORE = 8

# Source-tier tiebreaker for Filter A ranking (Spec §3.3). Tier 1 is
# publications with known editorial verification for M&A; tier 2 is
# everything else. Matched against article.source via case-insensitive
# substring to catch "FT.com" / "Financial Times" / "Reuters UK" etc.
TIER_1_SOURCES = (
    "financial times",
    "ft.com",
    "bloomberg",
    "reuters",
    "wall street journal",
    "wsj",
    "new york times",
    "nyt",
    "economist",
)

# Spec §5 — positive keywords that promote stage=announced rows to
# confirmed (shareholder / regulatory approvals that deal_extractor's
# enum cannot express today). All matches are phrase-based, not
# bare-word, to avoid false positives like "EU opens probe" matching
# "EU approved".
CONFIRMED_KEYWORDS: dict[str, tuple[str, ...]] = {
    "signed": (
        "signed",
        "definitive agreement",
        "agreement to acquire",
        "agreement reached",
    ),
    "shareholder_approved": (
        "shareholders approved",
        "shareholder vote",
        "shareholders voted",
        "proxy approved",
    ),
    "regulatory_approved": (
        "antitrust clearance",
        "regulatory approval",
        "ftc cleared",
        "doj cleared",
        "eu approved",
        "cma cleared",
        "regulator approved",
    ),
    "closed": (
        "closed",
        "completed",
        "consummated",
        "deal closed",
    ),
}

# Spec §5 — negative keywords. If ANY of these appear in the article
# title+summary, the row is blocked from Filter A even if deal_flow.stage
# says "signed". This is the Cognition / "potential $25B round"
# defensive layer.
UNCONFIRMED_KEYWORDS: tuple[str, ...] = (
    "early discussions",
    "exploring",
    "considering",
    "in talks",
    "may pursue",
    "weighing",
    "rumored",
    "reportedly considering",
    "approached",
    "potential bid",
    "potential round",
    "seeks ",
    "seeking ",
    "non-binding",
)


# --- Valuation parsing --------------------------------------------------

# Matches normalized valuation strings emitted by deal_extractor:
#   "$60B", "$500M", "A$25B", "€500M", "£3B"
# Leading currency prefix is optional (USD if absent).
_VAL_RE = re.compile(
    r"^\s*([A-Z]?\$|€|£)?\s*([\d]+(?:\.\d+)?)\s*([BM])\s*$",
    re.IGNORECASE,
)

# Range form: "$20–25 billion", "$20 to $25 billion". Used when parsing
# article-body strings if deal_flow valuation is missing. Take the
# midpoint, not the low end (Spec §9.4).
_RANGE_RE = re.compile(
    r"\$?\s*(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*\$?\s*(\d+(?:\.\d+)?)\s*(billion|million|b|m)\b",
    re.IGNORECASE,
)


def parse_valuation_to_usd_b(val: Optional[str]) -> Optional[float]:
    """
    Parse a normalized deal_flow.valuation string to a numeric value in
    USD-equivalent billions. Treats A$ / € / £ at approximate parity —
    we only use this for the >= $1B gate, and any reasonable FX haircut
    still clears the threshold for any deal worth calling a "lead".

    Returns None for unparseable / placeholder strings ("Undisclosed",
    "TBD", null).
    """
    if not val or not isinstance(val, str):
        return None
    val = val.strip()
    if not val or val.lower() in {"undisclosed", "tbd", "n/a", "null"}:
        return None

    # Range form — take the midpoint.
    r = _RANGE_RE.search(val)
    if r:
        lo = float(r.group(1))
        hi = float(r.group(2))
        unit = r.group(3).lower()
        mid = (lo + hi) / 2.0
        if unit.startswith("b"):
            return mid
        if unit.startswith("m"):
            return mid / 1000.0
        return None

    m = _VAL_RE.match(val)
    if not m:
        return None
    _currency = (m.group(1) or "$").strip()
    try:
        num = float(m.group(2))
    except ValueError:
        return None
    unit = m.group(3).upper()
    if unit == "B":
        return num
    if unit == "M":
        return num / 1000.0
    return None


# --- Keyword helpers ----------------------------------------------------

def _article_text(article: dict) -> str:
    """Lower-cased title + summary for keyword matching. Content body is
    NOT included — keyword checks here are meant for short-form headline
    signals, not deep body scans."""
    parts = [
        article.get("title") or "",
        article.get("summary") or "",
    ]
    return " ".join(parts).lower()


def _has_unconfirmed_keyword(text: str) -> bool:
    return any(kw in text for kw in UNCONFIRMED_KEYWORDS)


def _has_confirmed_keyword(text: str) -> bool:
    for phrases in CONFIRMED_KEYWORDS.values():
        if any(p in text for p in phrases):
            return True
    return False


def _source_tier(article: dict) -> int:
    """1 if the article's source is tier-1 wire/newspaper, 2 otherwise.
    Lower tier number wins the rank tiebreaker."""
    src = (article.get("source") or "").lower()
    if not src:
        return 2
    if any(s in src for s in TIER_1_SOURCES):
        return 1
    return 2


# --- Timestamp helpers --------------------------------------------------

def _article_age_hours(article: dict, now: datetime) -> float:
    """Age in hours from published_at → ingested_at → infinity. Mirrors
    _freshness_rerank's fallback ladder so ranking stays consistent."""
    for key in ("published_at", "ingested_at"):
        ts = article.get(key)
        if not ts:
            continue
        try:
            dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            delta = (now - dt).total_seconds() / 3600.0
            return max(0.0, delta)
        except Exception:
            continue
    return float("inf")


# --- deal_flow lookup ---------------------------------------------------

def fetch_recent_deal_flow(
    supabase_client,
    hours: int = 48,
    limit: int = 200,
) -> list[dict]:
    """
    Pull the last `hours` of deal_flow rows from Supabase. Separated out
    for testability — tests pass a mock client with a canned response.
    """
    if supabase_client is None:
        return []
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    try:
        resp = (
            supabase_client.table("deal_flow")
            .select("company, acquirer, deal_type, stage, valuation, source_url, updated_at")
            .gte("updated_at", cutoff)
            .order("updated_at", desc=True)
            .limit(limit)
            .execute()
        )
        return resp.data or []
    except Exception as e:  # pragma: no cover
        print(f"[lead_preselect] deal_flow fetch failed: {e}")
        return []


def _index_deal_flow_by_url(deal_rows: list[dict]) -> dict[str, dict]:
    """Build a source_url → deal_row index. Spec §2 notes FK article_id
    is deferred; URL match is ~97% reliable. When two deal_flow rows
    share a URL (rare; re-extracted story), the most recently updated
    row wins — deal_rows arrives ordered by updated_at desc."""
    idx: dict[str, dict] = {}
    for row in deal_rows:
        url = (row.get("source_url") or "").strip()
        if url and url not in idx:
            idx[url] = row
    return idx


# --- Filter A: priced + confirmed $1B+ deals ---------------------------

def _qualifies_filter_a(article: dict, deal_row: Optional[dict]) -> Optional[float]:
    """
    Return the article's deal_value_usd_b if it qualifies for Filter A,
    else None.

    Rules (Spec §3.2, §5):
      - Must have a deal_flow row joined by source_url
      - deal_flow.acquirer must be non-null (Spec §9.6 Cognition defense)
      - Parsed valuation must be >= $1B USD-equivalent
      - Negative keyword in title/summary → BLOCK (overrides stage)
      - stage ∈ {signed, closed} → PASS
      - stage == announced AND positive keyword present → PASS (covers
        shareholder_approved / regulatory_approved which aren't in the
        enum today)
      - otherwise → FAIL
    """
    if not deal_row:
        return None

    # Cognition defense: auto_extracted rows without an acquirer are
    # almost always valuation-only stories that slipped past the
    # extractor's disqualifier.
    if not (deal_row.get("acquirer") or "").strip():
        return None

    val = parse_valuation_to_usd_b(deal_row.get("valuation"))
    if val is None or val < MIN_DEAL_VALUE_USD_B:
        return None

    text = _article_text(article)

    # Hard block on unconfirmed keywords — even if deal_flow.stage says
    # "signed", a headline containing "in talks" / "potential round" is
    # the Cognition failure mode and must not lead.
    if _has_unconfirmed_keyword(text):
        return None

    stage = (deal_row.get("stage") or "").lower()
    if stage in CONFIRMED_STAGES:
        return val

    if stage == "announced" and _has_confirmed_keyword(text):
        return val

    return None


def _rank_filter_a(
    candidates: list[tuple[dict, float]],
    now: datetime,
) -> dict:
    """
    Rank Filter A hits by (deal_value DESC, published_at DESC,
    source_tier ASC, article_id/url_hash). Spec §9.1 — stable tiebreaker
    by url hash prevents asymmetric picks when two $25B deals land the
    same day.
    """
    def _key(item: tuple[dict, float]):
        article, deal_val = item
        age = _article_age_hours(article, now)
        tier = _source_tier(article)
        url_hash = hash(article.get("url") or article.get("title") or "")
        # Negate values we want DESC; keep ASC values positive.
        return (-deal_val, age, tier, url_hash)

    candidates.sort(key=_key)
    return candidates[0][0]


# --- Filter B: fallback hierarchy --------------------------------------

def _recent_high_score(
    articles: list[dict],
    deal_type: str,
    min_score: int,
    max_age_hours: float,
    now: datetime,
) -> list[dict]:
    out = []
    for a in articles:
        if (a.get("deal_type") or "") != deal_type:
            continue
        try:
            score = int(a.get("relevance_score") or 0)
        except (TypeError, ValueError):
            score = 0
        if score < min_score:
            continue
        if _article_age_hours(a, now) > max_age_hours:
            continue
        out.append(a)
    return out


def _pick_macro(articles: list[dict], now: datetime) -> Optional[dict]:
    """Spec §3.4a — largest macro or rates event, relevance_score >= 8."""
    hits = _recent_high_score(
        articles, "Macro", MACRO_GEO_MIN_SCORE, FALLBACK_MAX_AGE_HOURS, now
    )
    if not hits:
        return None
    hits.sort(
        key=lambda a: (
            -int(a.get("relevance_score") or 0),
            _article_age_hours(a, now),
        )
    )
    return hits[0]


def _pick_geopolitical(articles: list[dict], now: datetime) -> Optional[dict]:
    """Spec §3.4b — major geopolitical event, relevance_score >= 8."""
    hits = _recent_high_score(
        articles, "Geopolitical", MACRO_GEO_MIN_SCORE, FALLBACK_MAX_AGE_HOURS, now
    )
    if not hits:
        return None
    hits.sort(
        key=lambda a: (
            -int(a.get("relevance_score") or 0),
            _article_age_hours(a, now),
        )
    )
    return hits[0]


def _pick_sector_cluster(articles: list[dict], now: datetime) -> Optional[dict]:
    """
    Spec §3.4c — at least SECTOR_CLUSTER_MIN_ARTICLES (3) articles from
    the same primary industry_vertical in the last 12h, all with
    relevance_score >= 7. Pick the highest-scoring article in the
    largest cluster.
    """
    from collections import defaultdict

    clusters: dict[str, list[dict]] = defaultdict(list)
    for a in articles:
        if _article_age_hours(a, now) > SECTOR_CLUSTER_WINDOW_HOURS:
            continue
        try:
            score = int(a.get("relevance_score") or 0)
        except (TypeError, ValueError):
            score = 0
        if score < SECTOR_CLUSTER_MIN_SCORE:
            continue
        verticals = a.get("industry_verticals") or []
        if isinstance(verticals, str):
            # Defensive: some pipelines stringify arrays
            import json as _json
            try:
                verticals = _json.loads(verticals)
            except Exception:
                verticals = []
        if not verticals:
            continue
        primary = verticals[0]
        if primary:
            clusters[primary].append(a)

    qualifying = [
        (vertical, members)
        for vertical, members in clusters.items()
        if len(members) >= SECTOR_CLUSTER_MIN_ARTICLES
    ]
    if not qualifying:
        return None

    # Largest cluster wins; within the cluster, highest score + freshest.
    qualifying.sort(key=lambda kv: -len(kv[1]))
    _, members = qualifying[0]
    members.sort(
        key=lambda a: (
            -int(a.get("relevance_score") or 0),
            _article_age_hours(a, now),
        )
    )
    return members[0]


# --- Public API ---------------------------------------------------------

def preselect_primary_story(
    articles: list[dict],
    brief_type: str,
    *,
    supabase_client=None,
    now: Optional[datetime] = None,
) -> Optional[dict]:
    """
    Return the article dict to hoist as primary_story, or None to let
    Gemini fall back to in-prompt selection.

    Parameters
    ----------
    articles : list[dict]
        The freshness-reranked corpus (output of _freshness_rerank).
        Each dict must include url, title, summary, deal_type,
        relevance_score, published_at (or ingested_at), and
        industry_verticals. `source` is used for tier-tiebreak but
        optional.
    brief_type : {"morning", "evening"}
        Currently unused — both briefs apply the same algorithm. Kept
        in the signature so future tuning (different thresholds for the
        evening wrap) has a home without callsite churn.
    supabase_client : optional
        Injected for tests. Defaults to the module-level `supabase`
        client.
    now : optional datetime
        Injected for tests. Defaults to datetime.now(timezone.utc).

    Returns
    -------
    dict or None
        The selected article, augmented with a `_preselect_reason` key
        describing why it was chosen. None means no deterministic pick —
        caller should fall back to Gemini's in-prompt selector.

    Never raises. All exceptions are swallowed and logged; on any
    internal error the function returns None so the briefing still
    ships via the legacy path.
    """
    try:
        if not articles:
            return None

        sb = supabase_client if supabase_client is not None else supabase
        now = now or datetime.now(timezone.utc)

        # --- Filter A: priced + confirmed $1B+ deals --------------------
        deal_rows = fetch_recent_deal_flow(sb, hours=48)
        deal_idx = _index_deal_flow_by_url(deal_rows)

        filter_a: list[tuple[dict, float]] = []
        for a in articles:
            url = (a.get("url") or "").strip()
            if not url:
                continue
            deal_row = deal_idx.get(url)
            val = _qualifies_filter_a(a, deal_row)
            if val is not None:
                filter_a.append((a, val))

        if filter_a:
            winner = _rank_filter_a(filter_a, now)
            winner = dict(winner)  # shallow copy so we don't mutate caller
            # Attach metadata for _build_preselect_directive and audit
            deal_row = deal_idx.get((winner.get("url") or "").strip()) or {}
            winner["_preselect_reason"] = "filter_a_priced_1b"
            winner["_preselect_deal_value"] = deal_row.get("valuation")
            winner["_preselect_stage"] = deal_row.get("stage")
            winner["_preselect_acquirer"] = deal_row.get("acquirer")
            return winner

        # --- Filter B: fallback hierarchy (macro > geo > sector) --------
        macro = _pick_macro(articles, now)
        if macro:
            macro = dict(macro)
            macro["_preselect_reason"] = "filter_b_macro"
            return macro

        geo = _pick_geopolitical(articles, now)
        if geo:
            geo = dict(geo)
            geo["_preselect_reason"] = "filter_b_geopolitical"
            return geo

        sector = _pick_sector_cluster(articles, now)
        if sector:
            sector = dict(sector)
            sector["_preselect_reason"] = "filter_b_sector_cluster"
            return sector

        # No deterministic pick → Gemini falls back to PR #128 prompt rule.
        return None

    except Exception as e:  # pragma: no cover
        print(f"[lead_preselect] preselect_primary_story error (fallback to Gemini): {e}")
        return None


def build_preselect_directive(preselected: dict) -> str:
    """
    Build the short directive block that gets prepended to the system
    prompt when a pre-pick succeeds. Tells Gemini which article is the
    lead so it narrates rather than re-ranks, and explicitly marks the
    in-prompt PRIMARY STORY SELECTION block as fallback-only for today.

    Kept terse — we're adding prompt tokens to every pre-picked run.
    """
    title = (preselected.get("title") or "").strip()
    url = (preselected.get("url") or "").strip()
    source = (preselected.get("source") or "").strip()
    deal_value = preselected.get("_preselect_deal_value")
    stage = preselected.get("_preselect_stage")
    reason = preselected.get("_preselect_reason") or "fallback"
    # Spec §3 — primary_story_id should be the first ~80 chars of the
    # headline. Strip newlines so Gemini doesn't render a broken ID.
    psid = re.sub(r"\s+", " ", title)[:80]

    lines = [
        "[PRE-SELECTED PRIMARY STORY — deterministic pick from today's deal flow]",
        f'  title: "{title[:160]}"',
    ]
    if source:
        lines.append(f"  source: {source}")
    if url:
        lines.append(f"  url: {url}")
    if deal_value:
        lines.append(f"  deal_value: {deal_value}")
    if stage:
        lines.append(f"  confirmation_status: {stage}")
    lines.append(f"  selection_reason: {reason}")
    lines.append(f'  primary_story_id: "{psid}"')
    lines.append("")
    lines.append(
        "Narrate THIS article as the primary_story. The headline, "
        "lead_paragraph, supporting_context, and what_to_watch MUST be "
        "about this story only. Do NOT reselect. The PRIMARY STORY "
        "SELECTION block below (steps 1-7) is for fallback days when no "
        "pre-pick is injected — skip steps 1-4 and 6 today and proceed "
        "directly to writing the JSON, using the primary_story_id above."
    )
    return "\n".join(lines)
