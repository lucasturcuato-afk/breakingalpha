"""
trend_mapper.py — BreakingAlpha Phase 1 Observation Layer
Trend Mapper: clusters related articles into narratives, compares against
recent prior runs, and writes durable trend memory to Supabase.

Called as step 7 of run.py after audit.py.
No LLM calls. Pure structured metadata + lightweight text similarity only.

Answers this question for each run:
    What meaningful multi-article narratives existed, which were new vs
    recurring, and which did the brief actually surface?

Provenance note
---------------
All data flows through run_articles (reconstructed selection from observe.py).
Cluster membership and surfacing observations are heuristic — not exact
synthesis input provenance. Do not use trend_clusters rows as exact editorial
verdicts. This is Phase 1 observation-only memory. No optimizer, no rollback,
no config mutation is built here.

Clustering approach
-------------------
Articles are compared pairwise using structured metadata first, with
relevance_reason as a consistently-available secondary text signal:

  Component                Weight  Notes
  ─────────────────────────────────────────────────────────────────────
  companies Jaccard        0.28   strongest narrative signal
  relevance_reason Jaccard 0.25   populated for ~100% of articles
  sector match             0.20   coarse category; reduced to prevent
                                  sector-alone over-merging
  themes Jaccard           0.17   tag-based; sparsely populated
  title token Jaccard      0.07   tiebreaker only; structurally limited
  deal_type match          0.03   very weak corroborator
  ─────────────────────────────────────────────────────────────────────
  Total                    1.00

relevance_reason is the LLM-generated ingest signal description. It names
entities and market mechanisms in domain-specific language and is present
for effectively every article that passes the ingest filter, even when
sector/companies/themes are not populated.

sector weight was reduced from 0.35 (original) to 0.20 so that a broad
sector tag alone cannot push a pair to the 0.28 threshold.

Connected components (union-find) over pairs exceeding SIMILARITY_THRESHOLD
produce clusters. Single-article groups are discarded. Each cluster is scored
for strength and confidence, classified as emerging or persistent by comparing
cluster_key against recent prior runs, and checked for surfacing in the
published briefing.

Cross-run comparison
--------------------
The last LOOKBACK_RUN_COUNT successful runs of the same brief_type are
examined. Clusters from those runs are loaded from trend_clusters. Matching
is done by normalized cluster_key equality. Persistent = key appeared in
>= PERSISTENCE_MIN_RUNS prior runs. Emerging = appeared in fewer.

For the first few runs (before trend_clusters has history) everything is
classified as emerging — this is correct behavior, not a bug.
"""

import os
import re
import json
from datetime import datetime, timedelta
from collections import defaultdict
from supabase import create_client
from google import genai
try:
    from usage_log import log_gemini_usage
except Exception:  # pragma: no cover - usage logging must never break import
    try:
        from backend.usage_log import log_gemini_usage
    except Exception:
        def log_gemini_usage(*a, **k):
            return

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])

# ---------------------------------------------------------------------------
# Phase 5 — source credibility multiplier
# Each cluster's aggregate strength is nudged by the mean win_rate of its
# contributing sources. The table is populated by `source_credibility.py`
# after `thesis_grader` produces outcomes. Until the table has rows we skip
# the multiplier entirely (returning the original strength untouched) so
# cold-start runs aren't halved by a blanket 0.5 default.
# ---------------------------------------------------------------------------
try:
    import source_credibility as _src_cred
except Exception:
    _src_cred = None

_SOURCE_WIN_RATES: dict[str, float] | None = None
_SOURCE_WIN_RATES_LOADED = False
_SOURCE_WIN_RATE_DEFAULT = 0.5


def _get_source_win_rates() -> dict[str, float] | None:
    """Load and cache `{source: win_rate}` for this process. None = skip."""
    global _SOURCE_WIN_RATES, _SOURCE_WIN_RATES_LOADED
    if _SOURCE_WIN_RATES_LOADED:
        return _SOURCE_WIN_RATES
    _SOURCE_WIN_RATES_LOADED = True
    if _src_cred is None:
        _SOURCE_WIN_RATES = None
        return None
    try:
        _SOURCE_WIN_RATES = _src_cred.load_win_rates()
    except Exception:
        _SOURCE_WIN_RATES = None
    return _SOURCE_WIN_RATES


# ---------------------------------------------------------------------------
# Phase 6 — pattern library feedback boost
# Clusters whose dominant sector matches a high-win-rate historical pattern
# get a gentle multiplier nudge so they rank above identical-strength
# clusters with no historical backing. The boost is bounded to [0.9, 1.15]
# — enough to tie-break reliably, never enough to invert a weaker cluster
# above a much stronger one.
# ---------------------------------------------------------------------------
try:
    import pattern_memory as _pattern_memory
except Exception:
    _pattern_memory = None

_PATTERN_SECTOR_RATES: dict[str, float] | None = None
_PATTERN_SECTOR_RATES_LOADED = False


def _get_pattern_sector_rates() -> dict[str, float] | None:
    """Return {sector: best_win_rate} across horizons and signals. None = skip."""
    global _PATTERN_SECTOR_RATES, _PATTERN_SECTOR_RATES_LOADED
    if _PATTERN_SECTOR_RATES_LOADED:
        return _PATTERN_SECTOR_RATES
    _PATTERN_SECTOR_RATES_LOADED = True
    if _pattern_memory is None:
        _PATTERN_SECTOR_RATES = None
        return None
    try:
        # Pull up to 200 patterns with n_observed >= 5 and build a
        # per-sector maximum win rate. query_relevant_patterns is ordered
        # by win_rate desc so the first hit per sector is the best one.
        rows = _pattern_memory.query_relevant_patterns(
            sector=None, horizon=None, min_n=5, limit=200,
        )
        best: dict[str, float] = {}
        for r in rows or []:
            sector = r.get("sector") or ""
            wr = r.get("win_rate")
            if not sector or wr is None:
                continue
            try:
                val = float(wr)
            except Exception:
                continue
            if sector not in best or val > best[sector]:
                best[sector] = val
        _PATTERN_SECTOR_RATES = best if best else None
    except Exception:
        _PATTERN_SECTOR_RATES = None
    return _PATTERN_SECTOR_RATES


def _apply_pattern_boost(cluster, strength: float) -> float:
    """
    Nudge a cluster's strength by its dominant sector's historical win rate.
    Multiplier = 1 + 0.3 * (win_rate - 0.5) → capped to [0.85, 1.15].
    Returns strength unchanged when pattern data is missing or inconclusive.
    """
    try:
        rates = _get_pattern_sector_rates()
        if not rates or not cluster:
            return strength
        # Dominant sector = most common non-empty sector in the cluster
        counts: dict[str, int] = {}
        for art in cluster:
            sec = art.get("sector")
            if sec:
                counts[sec] = counts.get(sec, 0) + 1
        if not counts:
            return strength
        dominant = max(counts, key=counts.get)
        wr = rates.get(dominant)
        if wr is None:
            return strength
        mult = 1.0 + 0.3 * (float(wr) - 0.5)
        mult = max(0.85, min(1.15, mult))
        return round(max(0.0, min(1.0, float(strength) * mult)), 4)
    except Exception:
        return strength


def _apply_source_credibility(cluster, strength: float) -> float:
    """
    Multiply a cluster's strength by the mean win_rate of its contributing
    sources. Unknown sources fall back to `_SOURCE_WIN_RATE_DEFAULT` (0.5).
    Returns the original strength unchanged when the table is missing.
    """
    try:
        rates = _get_source_win_rates()
        if rates is None:
            return strength
        if not cluster:
            return strength
        seen: set[str] = set()
        weights: list[float] = []
        for art in cluster:
            src = art.get("source") or ""
            if not src or src in seen:
                continue
            seen.add(src)
            weights.append(float(rates.get(src, _SOURCE_WIN_RATE_DEFAULT)))
        if not weights:
            return strength
        mult = sum(weights) / len(weights)
        return round(max(0.0, min(1.0, float(strength) * mult)), 4)
    except Exception:
        return strength


# ---------------------------------------------------------------------------
# Tunable constants
# Adjust these together, with an understanding of the trade-offs documented
# below each block. Do not tune these individually without inspecting output.
# ---------------------------------------------------------------------------

# How many prior successful runs of the same brief_type to examine for
# cross-run cluster matching. 7 covers roughly 2 work-weeks of morning runs.
LOOKBACK_RUN_COUNT = 7

# Minimum combined pairwise similarity score to connect two articles.
# Range: 0–1. Lower = more articles merge into the same cluster (looser).
# Higher = more fragmented, tighter clusters.
# 0.28 was chosen to require at least one strong structural overlap
# (shared sector + any secondary signal, or shared companies across sectors).
SIMILARITY_THRESHOLD = 0.28

# Discard clusters smaller than this. Single-article "clusters" are not trends.
MIN_CLUSTER_SIZE = 4

# Pairwise similarity component weights — must sum to 1.0
# See module docstring for full rationale. Do not adjust W_SECTOR above 0.25
# without verifying that over-merging on broad sector tags does not recur.
W_COMPANIES    = 0.28   # strongest narrative signal
W_REL_REASON   = 0.25   # most consistently populated field (~100% of articles)
W_SECTOR       = 0.20   # reduced: sector alone must not nearly reach threshold
W_THEMES       = 0.17   # tag-based; sparsely populated in current pipeline
W_TITLE_TOKENS = 0.07   # tiebreaker; cannot substitute for missing metadata
W_DEAL_TYPE    = 0.03   # very weak corroborator

# A cluster is "persistent" if its cluster_key appeared in >= this many of
# the LOOKBACK_RUN_COUNT prior runs. 2/7 is a deliberately low bar —
# appearing twice in the last two weeks is meaningful persistence.
PERSISTENCE_MIN_RUNS = 2

# Minimum strength_score for an unsurfaced cluster to set underrepresented_flag.
# 0.35 corresponds to roughly: 2+ articles, some source diversity, avg relevance ~7.
# Clusters below this floor are too weak to flag as underrepresented.
UNDERREPRESENTED_STRENGTH_FLOOR = 0.35

# Stop words stripped from title tokens before Jaccard comparison.
# Focuses on function words only — for titles, common financial nouns like
# "market" or "company" can still carry signal (e.g. "Market Maker" or
# "Company X Acquires"). Longer than typical to cover news-headline patterns.
TITLE_STOP_WORDS = frozenset({
    "a", "an", "the", "and", "or", "of", "in", "on", "at", "to", "for",
    "with", "by", "from", "as", "is", "was", "be", "are", "were", "its",
    "it", "this", "that", "has", "have", "had", "been", "will", "would",
    "could", "may", "new", "us", "says", "said", "after", "over", "up",
    "amid", "into", "than", "more", "set", "vs", "per", "how", "why",
    "what", "when", "where", "who", "can", "not", "but", "all", "now",
})

# Stop words for relevance_reason tokens — extends TITLE_STOP_WORDS with
# boilerplate phrases common to LLM-generated ingest signals that would
# inflate Jaccard similarity between unrelated articles.
# "article" appears as a generic prefix in most relevance_reasons.
# "impact" / "impacts" are near-universal and don't distinguish narratives.
# Deliberately conservative — domain nouns (oil, rates, defense) are kept.
_REL_REASON_STOP_WORDS = TITLE_STOP_WORDS | frozenset({
    "article", "articles",
    "report", "reports", "reporting",
    "impact", "impacts", "impacting",
    "also", "such", "while", "due", "given", "further",
    "potential", "potentially", "significant", "significantly",
    "related", "linked", "particularly", "especially",
    "suggest", "suggests", "indicate", "indicates",
    "which", "whose", "thus", "hence",
})


# ---------------------------------------------------------------------------
# Data normalization helpers
# ---------------------------------------------------------------------------

def _safe_list(value):
    """
    Parse a field that may be a Python list, JSON string list, or None.
    Returns a list of normalized (lowercased, stripped) strings.
    Handles comma-separated string fallback for legacy data.
    """
    if value is None:
        return []
    if isinstance(value, list):
        return [str(x).strip().lower() for x in value if x]
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return []
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return [str(x).strip().lower() for x in parsed if x]
        except Exception:
            pass
        # Comma-separated fallback (some article fields may be stored this way)
        return [x.strip().lower() for x in value.split(",") if x.strip()]
    return []


def _title_tokens(title):
    """
    Tokenize a title into lowercase alphabetic tokens with stop words removed.
    Returns a frozenset for efficient Jaccard computation.
    Tokens shorter than 3 characters are excluded (articles like "AI" get
    handled by the company/theme overlap signals instead).
    """
    if not title:
        return frozenset()
    tokens = re.findall(r"[a-z]+", title.lower())
    return frozenset(t for t in tokens if len(t) >= 3 and t not in TITLE_STOP_WORDS)


def _relevance_reason_tokens(text):
    """
    Tokenize relevance_reason into lowercase alphabetic tokens using an
    expanded stop-word list that removes LLM-generated boilerplate.

    relevance_reason is the ingest-pipeline signal description — e.g.:
      "A geopolitical event affecting energy infrastructure in the Gulf
       could pressure crude prices and ripple into defense stocks."

    Uses _REL_REASON_STOP_WORDS (superset of TITLE_STOP_WORDS) to strip
    boilerplate LLM phrasing that inflates Jaccard between unrelated articles
    ("article", "impact", "report", "potential", etc.).

    Minimum token length is 4 (one longer than title tokens) to reduce noise
    from short generic words that survived the stop-word filter.

    Returns a frozenset.
    """
    if not text:
        return frozenset()
    tokens = re.findall(r"[a-z]+", text.lower())
    return frozenset(t for t in tokens if len(t) >= 4 and t not in _REL_REASON_STOP_WORDS)


def _jaccard(a, b):
    """
    Jaccard similarity between two sets or lists.
    Returns 0.0 if both inputs are empty (avoids inflating similarity
    between articles with no structured metadata).
    """
    sa = set(a) if not isinstance(a, (set, frozenset)) else a
    sb = set(b) if not isinstance(b, (set, frozenset)) else b
    if not sa and not sb:
        return 0.0
    intersection = len(sa & sb)
    union = len(sa | sb)
    return intersection / union if union else 0.0


def _normalize_article(raw):
    """
    Normalize a raw Supabase article row into a consistent working dict.
    All list fields are parsed; None fields become safe defaults.
    Token sets are pre-computed for repeated pairwise use in build_clusters.

    relevance_reason_tokens is the most robustly available text signal:
    it is present for effectively every article that passes the ingest filter,
    even when sector/companies/themes are unpopulated.
    """
    return {
        "id":                    raw.get("id"),
        "title":                 raw.get("title") or "",
        "source":                (raw.get("source") or "").strip().lower(),
        "relevance_score":       raw.get("relevance_score"),
        "companies":             _safe_list(raw.get("companies")),
        "themes":                _safe_list(raw.get("themes")),
        "sector":                ((raw.get("industry_verticals") or [raw.get("sector", "")])[0] or "").strip().lower(),
        "deal_type":             (raw.get("deal_type") or "").strip().lower(),
        "title_tokens":          _title_tokens(raw.get("title")),
        "rel_reason_tokens":     _relevance_reason_tokens(raw.get("relevance_reason")),
    }


# ---------------------------------------------------------------------------
# Pairwise similarity
# ---------------------------------------------------------------------------

def compute_pairwise_similarity(a, b):
    """
    Return a combined similarity score [0, 1] between two normalized articles.

    Components (see module docstring for weight rationale):
      companies_jaccard    — Jaccard on company name lists
      rel_reason_jaccard   — Jaccard on relevance_reason token sets
      sector_match         — 1.0 if both non-empty and equal, else 0.0
      themes_jaccard       — Jaccard on theme lists
      title_token_jaccard  — Jaccard on stop-word-stripped title tokens
      deal_type_sim        — 0.5 if both non-empty and equal (partial credit)

    All components return 0.0 when both inputs are empty — empty fields do
    not inflate similarity between articles that happen to both lack metadata.

    Returns a float ∈ [0, 1].
    """
    # Company overlap (strongest narrative signal — same company → same story)
    companies_sim = _jaccard(a["companies"], b["companies"])

    # Relevance_reason overlap — domain-specific ingest signal, ~100% populated.
    # Uses _REL_REASON_STOP_WORDS to filter boilerplate before comparison.
    rel_reason_sim = _jaccard(a["rel_reason_tokens"], b["rel_reason_tokens"])

    # Sector match — coarse category signal. Reduced weight so sector alone
    # cannot push an unrelated pair across the threshold.
    sa = a["sector"]
    sb = b["sector"]
    sector_match = 1.0 if (sa and sb and sa == sb) else 0.0

    # Theme overlap
    themes_sim = _jaccard(a["themes"], b["themes"])

    # Title tokens — tiebreaker; cannot substitute for missing metadata
    title_sim = _jaccard(a["title_tokens"], b["title_tokens"])

    # Deal type — partial credit; same type weakly corroborates
    da = a["deal_type"]
    db = b["deal_type"]
    deal_type_sim = 0.5 if (da and db and da == db) else 0.0

    return (
        W_COMPANIES    * companies_sim
        + W_REL_REASON * rel_reason_sim
        + W_SECTOR     * sector_match
        + W_THEMES     * themes_sim
        + W_TITLE_TOKENS * title_sim
        + W_DEAL_TYPE  * deal_type_sim
    )


# ---------------------------------------------------------------------------
# Union-Find (connected components clustering)
# ---------------------------------------------------------------------------

class _UnionFind:
    """
    Path-compressed weighted union-find for connected components clustering.
    O(α(n)) per operation — fast even for hundreds of articles.
    """
    def __init__(self, n):
        self.parent = list(range(n))
        self.rank   = [0] * n

    def find(self, x):
        # Path compression: every node on the path points directly to root
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, x, y):
        rx, ry = self.find(x), self.find(y)
        if rx == ry:
            return
        # Union by rank: attach smaller tree under larger tree
        if self.rank[rx] < self.rank[ry]:
            rx, ry = ry, rx
        self.parent[ry] = rx
        if self.rank[rx] == self.rank[ry]:
            self.rank[rx] += 1


def build_clusters(articles):
    """
    Build clusters from a list of normalized article dicts using connected
    components over pairwise similarity.

    O(n²) comparison — acceptable for typical run sizes (20–60 articles).
    If article pools grow substantially, add a blocking strategy (group by
    sector first, then compare within blocks).

    Parameters
    ----------
    articles : list of normalized article dicts from _normalize_article()

    Returns
    -------
    List of clusters, each cluster being a list of article dicts.
    Clusters with fewer than MIN_CLUSTER_SIZE articles are discarded.
    """
    n = len(articles)
    if n == 0:
        return []

    uf = _UnionFind(n)

    for i in range(n):
        for j in range(i + 1, n):
            score = compute_pairwise_similarity(articles[i], articles[j])
            if score >= SIMILARITY_THRESHOLD:
                uf.union(i, j)

    # Group article indices by their root component
    groups = defaultdict(list)
    for idx in range(n):
        groups[uf.find(idx)].append(idx)

    # Filter to minimum size and build output cluster lists
    return [
        [articles[idx] for idx in indices]
        for indices in groups.values()
        if len(indices) >= MIN_CLUSTER_SIZE
    ]


# ---------------------------------------------------------------------------
# Cluster identity
# ---------------------------------------------------------------------------

def make_cluster_key(cluster):
    """
    Derive a stable, deterministic key for cross-run matching.

    Format: "{dominant_sector}|{top2_companies_sorted}|{top_theme}"
    - All components normalized to lowercase and sorted
    - Designed for approximate (not exact) cross-run matching
    - Empty components produce an empty string segment (not omitted)
    - Prioritizes cross-run matchability over within-run uniqueness

    Examples:
      "technology|apple,microsoft|m&a"
      "healthcare||drug-approval"
      "financials|jpmorgan|"
    """
    sector_counts  = defaultdict(int)
    company_counts = defaultdict(int)
    theme_counts   = defaultdict(int)

    for art in cluster:
        if art["sector"]:
            sector_counts[art["sector"]] += 1
        for c in art["companies"]:
            if c:
                company_counts[c] += 1
        for t in art["themes"]:
            if t:
                theme_counts[t] += 1

    dominant_sector = max(sector_counts, key=sector_counts.get) if sector_counts else ""
    top_two_companies = sorted(
        sorted(company_counts, key=company_counts.get, reverse=True)[:2]
    )
    top_theme = max(theme_counts, key=theme_counts.get) if theme_counts else ""

    companies_part = ",".join(top_two_companies)
    return f"{dominant_sector}|{companies_part}|{top_theme}"


def make_cluster_label(cluster):
    """
    Derive a readable human label from dominant cluster entities.

    Priority:
      1. "{TopCompany}: {TopTheme}"     if both present
      2. "{TopCompany}"                  if company but no theme
      3. "{Sector}: {TopTheme}"          if sector + theme, no company
      4. "{Sector}"                       if only sector
      5. "Unlabeled Cluster"             fallback

    No LLM calls — purely deterministic from entity frequency.
    Labels are suitable for human inspection and weekly summaries.
    """
    company_counts = defaultdict(int)
    theme_counts   = defaultdict(int)
    sector_counts  = defaultdict(int)

    for art in cluster:
        for c in art["companies"]:
            if c:
                company_counts[c] += 1
        for t in art["themes"]:
            if t:
                theme_counts[t] += 1
        if art["sector"]:
            sector_counts[art["sector"]] += 1

    top_company = max(company_counts, key=company_counts.get) if company_counts else ""
    top_theme   = max(theme_counts,   key=theme_counts.get)   if theme_counts   else ""
    top_sector  = max(sector_counts,  key=sector_counts.get)  if sector_counts  else ""

    def cap(s):
        """Title-case each word for readability. Preserves special chars like '&'."""
        if not s:
            return ""
        # Split on whitespace, capitalize each piece
        return " ".join(
            w[0].upper() + w[1:] if w else w
            for w in s.split()
        )

    tc = cap(top_company)
    tt = cap(top_theme)
    ts = cap(top_sector)

    if tc and tt:
        return f"{tc}: {tt}"
    if tc:
        return tc
    if ts and tt:
        return f"{ts}: {tt}"
    if ts:
        return ts
    return "Unlabeled Cluster"


# ---------------------------------------------------------------------------
# Cluster scoring
# ---------------------------------------------------------------------------

def score_cluster_strength(cluster):
    """
    Compute strength_score ∈ [0, 1] reflecting a cluster's weight as a
    potential investable narrative.

    Ingredients and weights:
      article_count_norm  0.30  — more articles = stronger signal
      source_diversity    0.25  — corroboration across distinct outlets
      avg_relevance_norm  0.25  — average signal quality of the cluster
      max_relevance_norm  0.20  — ceiling quality (any standout article?)

    article_count is normalized as min(n/6, 1.0): clusters of 6+ articles
    max out this component. This is a reasonable upper bound for a single
    morning/evening run.

    Returns a float ∈ [0, 1] rounded to 3 decimal places.
    """
    n = len(cluster)
    if n == 0:
        return 0.0

    unique_sources = len({art["source"] for art in cluster if art["source"]})

    scores = [
        art["relevance_score"] for art in cluster
        if art["relevance_score"] is not None
    ]
    avg_rel = sum(scores) / len(scores) if scores else 0.0
    max_rel = max(scores) if scores else 0.0

    article_count_norm = min(n / 6.0, 1.0)
    source_diversity   = unique_sources / n if n > 0 else 0.0
    avg_rel_norm       = avg_rel / 10.0
    max_rel_norm       = max_rel / 10.0

    strength = (
        0.30 * article_count_norm
        + 0.25 * source_diversity
        + 0.25 * avg_rel_norm
        + 0.20 * max_rel_norm
    )
    return round(strength, 3)


def score_cluster_confidence(cluster):
    """
    Compute confidence_score ∈ [0, 1] reflecting how trustworthy the
    cluster is as a real narrative group (vs. a spurious data artifact).

    Ingredients:
      multi_source_score  0.40  — 1.0 if >=3 sources, 0.7 if >=2, 0.3 if 1
      size_score          0.35  — 1.0 if >=4 articles, 0.7 if >=3, 0.4 if 2
      entity_consistency  0.25  — fraction of cluster articles containing the
                                  most common entity (company or theme)

    entity_consistency measures internal coherence: a cluster where 5/5 articles
    mention "Microsoft" is more coherent than one where the top entity appears
    in 2/5 articles.

    Returns a float ∈ [0, 1] rounded to 3 decimal places.
    """
    n = len(cluster)
    if n == 0:
        return 0.0

    unique_sources = len({art["source"] for art in cluster if art["source"]})
    multi_source_score = 1.0 if unique_sources >= 3 else (0.7 if unique_sources >= 2 else 0.3)

    size_score = 1.0 if n >= 4 else (0.7 if n >= 3 else 0.4)

    # Entity consistency: top entity frequency / cluster size
    entity_counts = defaultdict(int)
    for art in cluster:
        for e in art["companies"] + art["themes"]:
            if e:
                entity_counts[e] += 1

    if entity_counts:
        top_entity_count = max(entity_counts.values())
        entity_consistency = top_entity_count / n
    else:
        entity_consistency = 0.0

    confidence = (
        0.40 * multi_source_score
        + 0.35 * size_score
        + 0.25 * entity_consistency
    )
    return round(confidence, 3)


# ---------------------------------------------------------------------------
# Cross-run cluster classification
# ---------------------------------------------------------------------------

def classify_cluster_type(cluster_key, prior_cluster_keys_by_run):
    """
    Classify a cluster as 'persistent' or 'emerging' based on recent run history.

    Parameters
    ----------
    cluster_key               : str — the cluster's normalized key
    prior_cluster_keys_by_run : dict { run_id → set(cluster_key) }

    Matching logic:
      - Exact cluster_key equality against each prior run's cluster keys
      - Count of distinct runs containing the key determines classification
      - >= PERSISTENCE_MIN_RUNS → 'persistent'
      - <  PERSISTENCE_MIN_RUNS → 'emerging' (includes 0 matches = fully new)

    Using exact key matching is intentionally conservative. Approximate
    matching (edit distance on keys) would risk conflating different but
    similarly-named narratives.

    Returns
    -------
    tuple: (cluster_type: str, matched_run_count: int, matched_keys: list)
    """
    matched_run_count = 0
    for keys in prior_cluster_keys_by_run.values():
        if cluster_key in keys:
            matched_run_count += 1

    cluster_type = (
        "persistent" if matched_run_count >= PERSISTENCE_MIN_RUNS else "emerging"
    )
    # matched_keys is a list (possibly empty) of the cluster_key itself
    # for schema consistency — always one value if matched, empty if not
    matched_keys = [cluster_key] if matched_run_count > 0 else []

    return cluster_type, matched_run_count, matched_keys


# ---------------------------------------------------------------------------
# Surfaced detection
# ---------------------------------------------------------------------------

def _normalize_for_match(s):
    """Lowercase and strip whitespace for entity matching."""
    return re.sub(r"\s+", " ", (s or "").lower().strip())


def _entity_in_text(entities, text):
    """
    Return True if any entity in the list appears as a meaningful match
    in the text.

    Matching strategy:
      - Entities >= 5 chars: substring match (sufficient to avoid false positives
        for multi-word company names like 'microsoft' or 'jpmorgan')
      - Entities 2–4 chars: word-boundary regex match (avoids 'AI' matching
        'TRAIL' or 'DETAIL')
      - Entities < 2 chars: skipped (too short to match meaningfully)

    Case-insensitive. Matching is conservative — it requires real entity
    presence, not vague topical overlap.
    """
    text_lower = _normalize_for_match(text)
    for entity in entities:
        entity_n = _normalize_for_match(entity)
        if not entity_n or len(entity_n) < 2:
            continue
        if len(entity_n) >= 5:
            if entity_n in text_lower:
                return True
        else:
            pattern = r"\b" + re.escape(entity_n) + r"\b"
            if re.search(pattern, text_lower):
                return True
    return False


def detect_cluster_surfacing(cluster, briefing):
    """
    Determine whether a cluster's dominant entities appear in the published briefing.

    Checks three surfaces separately:
      - surfaced_in_headline  — cluster entities in briefing headline
      - surfaced_in_sections  — cluster entities in any section text
      - surfaced_in_top_deals — cluster entities in top_deals company or one_liner

    Match entities used: top 3 companies + top 2 themes + dominant sector.
    Matching is entity-overlap based — it observes entity presence in the
    output, not editorial intent. Do not interpret surfaced=False as
    "the model missed this story."

    Returns a dict with all four surfacing flags as booleans.
    """
    if not briefing:
        return {
            "surfaced_in_headline":  False,
            "surfaced_in_sections":  False,
            "surfaced_in_top_deals": False,
            "surfaced_anywhere":     False,
        }

    # Collect cluster's dominant entities
    company_counts = defaultdict(int)
    theme_counts   = defaultdict(int)
    sector_counts  = defaultdict(int)

    for art in cluster:
        for c in art["companies"]:
            if c:
                company_counts[c] += 1
        for t in art["themes"]:
            if t:
                theme_counts[t] += 1
        if art["sector"]:
            sector_counts[art["sector"]] += 1

    top_companies = sorted(company_counts, key=company_counts.get, reverse=True)[:3]
    top_themes    = sorted(theme_counts,   key=theme_counts.get,   reverse=True)[:2]
    top_sector    = [max(sector_counts, key=sector_counts.get)] if sector_counts else []

    match_entities = top_companies + top_themes + top_sector

    # Headline check
    headline_text = briefing.get("headline") or ""
    surfaced_in_headline = _entity_in_text(match_entities, headline_text)

    # Sections check (concatenate all section values)
    sections_raw = briefing.get("sections")
    if isinstance(sections_raw, dict):
        sections_dict = sections_raw
    elif isinstance(sections_raw, str):
        try:
            sections_dict = json.loads(sections_raw) or {}
        except Exception:
            sections_dict = {}
    else:
        sections_dict = {}
    sections_text = " ".join(str(v) for v in sections_dict.values() if v)
    surfaced_in_sections = _entity_in_text(match_entities, sections_text)

    # Top deals check
    top_deals_raw = briefing.get("top_deals")
    if isinstance(top_deals_raw, list):
        top_deals_list = top_deals_raw
    elif isinstance(top_deals_raw, str):
        try:
            top_deals_list = json.loads(top_deals_raw) or []
        except Exception:
            top_deals_list = []
    else:
        top_deals_list = []
    top_deals_text = " ".join(
        (str(d.get("company") or "") + " " + str(d.get("one_liner") or ""))
        for d in top_deals_list
        if isinstance(d, dict)
    )
    surfaced_in_top_deals = _entity_in_text(match_entities, top_deals_text)

    surfaced_anywhere = (
        surfaced_in_headline or surfaced_in_sections or surfaced_in_top_deals
    )
    return {
        "surfaced_in_headline":  surfaced_in_headline,
        "surfaced_in_sections":  surfaced_in_sections,
        "surfaced_in_top_deals": surfaced_in_top_deals,
        "surfaced_anywhere":     surfaced_anywhere,
    }


# ---------------------------------------------------------------------------
# Database I/O
# ---------------------------------------------------------------------------

def fetch_run_context(run_id, brief_type, started_at_iso):
    """
    Fetch all data needed by the Trend Mapper for one pipeline run.

    Three data sources:
      1. run_articles → article_ids for this run (candidates + selected)
      2. articles     → full metadata for those ids
      3. briefings    → the briefing written by this run (for surfacing check)
      4. pipeline_runs + trend_clusters → prior run cluster keys for lookback

    Returns
    -------
    tuple: (articles, briefing, prior_cluster_keys_by_run)
      articles                  : list of normalized article dicts
      briefing                  : dict or None
      prior_cluster_keys_by_run : dict { run_id → set(cluster_key) }
    """
    articles = []
    briefing = None
    prior_cluster_keys_by_run = {}

    # Step 1: fetch article_ids from run_articles for this run
    article_ids = []
    try:
        ra_resp = (
            supabase.table("run_articles")
            .select("article_id")
            .eq("run_id", run_id)
            .execute()
        )
        article_ids = [
            r["article_id"] for r in (ra_resp.data or [])
            if r.get("article_id")
        ]
    except Exception as e:
        print(f"  [trend_mapper] run_articles fetch failed: {e}")

    # Step 2: fetch full article metadata for those ids
    if article_ids:
        try:
            raw_articles = []
            # Batch in chunks of 100 to respect Supabase IN clause limits
            for i in range(0, len(article_ids), 100):
                chunk = article_ids[i:i + 100]
                resp = (
                    supabase.table("articles")
                    .select(
                        "id, title, source, relevance_score, "
                        "companies, themes, sector, industry_verticals, deal_type, relevance_reason"
                    )
                    .in_("id", chunk)
                    .execute()
                )
                raw_articles.extend(resp.data or [])
            articles = [_normalize_article(r) for r in raw_articles]
        except Exception as e:
            print(f"  [trend_mapper] articles fetch failed: {e}")

    # Step 3: fetch the briefing written by this run
    try:
        br_resp = (
            supabase.table("briefings")
            .select("headline, summary, sections, top_deals")
            .eq("briefing_type", brief_type)
            .gte("created_at", started_at_iso)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        briefing = br_resp.data[0] if br_resp.data else None
    except Exception as e:
        print(f"  [trend_mapper] briefing fetch failed: {e}")

    # Step 4: fetch recent prior run ids for the same brief_type
    prior_run_ids = []
    try:
        pr_resp = (
            supabase.table("pipeline_runs")
            .select("id")
            .eq("brief_type", brief_type)
            .eq("status", "success")
            .neq("id", run_id)
            .order("started_at", desc=True)
            .limit(LOOKBACK_RUN_COUNT)
            .execute()
        )
        prior_run_ids = [r["id"] for r in (pr_resp.data or [])]
    except Exception as e:
        print(f"  [trend_mapper] prior runs fetch failed: {e}")

    # Step 5: fetch cluster keys from those prior runs
    if prior_run_ids:
        try:
            tc_resp = (
                supabase.table("trend_clusters")
                .select("run_id, cluster_key")
                .in_("run_id", prior_run_ids)
                .execute()
            )
            for row in (tc_resp.data or []):
                rid = row.get("run_id")
                key = row.get("cluster_key")
                if rid and key:
                    if rid not in prior_cluster_keys_by_run:
                        prior_cluster_keys_by_run[rid] = set()
                    prior_cluster_keys_by_run[rid].add(key)
        except Exception as e:
            # trend_clusters may not yet exist on first run — this is expected
            print(f"  [trend_mapper] prior cluster keys fetch failed "
                  f"(expected on first run): {e}")

    return articles, briefing, prior_cluster_keys_by_run


def generate_cluster_headline(cluster, label):
    """
    Generate a concise headline + tagline for a trend cluster using Gemini.
    Returns (headline, tagline) or (None, None) on failure.
    """
    try:
        titles = [art.get("title", "") for art in cluster[:8] if art.get("title")]
        sources = list({art.get("source", "") for art in cluster if art.get("source")})
        companies = list({c for art in cluster for c in art.get("companies", [])})[:5]

        prompt = (
            "You are a financial news headline writer. Given the following cluster of related articles, "
            "write a concise headline (max 12 words) and a one-sentence tagline (max 25 words) that captures "
            "the core market narrative.\n\n"
            f"Cluster label: {label}\n"
            f"Companies: {', '.join(companies) if companies else 'N/A'}\n"
            f"Sources: {', '.join(sources)}\n"
            f"Article titles:\n" + "\n".join(f"- {t}" for t in titles) + "\n\n"
            'Respond in JSON: {"headline": "...", "tagline": "..."}'
        )

        client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))
        resp = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config={
                "thinking_config": {"thinking_budget": 0},
                "response_mime_type": "application/json",
            },
        )
        log_gemini_usage("trend_headline", "gemini-2.5-flash", resp)
        result = json.loads(resp.text)
        return result.get("headline"), result.get("tagline")
    except Exception as e:
        print(f"  [trend_mapper] headline gen failed for '{label}': {e}")
        return None, None


def persist_trend_clusters(rows):
    """
    Insert a list of trend_clusters row dicts into Supabase.
    Batches in chunks of 50 to stay within payload limits.
    Returns the number of rows successfully inserted.
    """
    if not rows:
        return 0
    inserted = 0
    try:
        for i in range(0, len(rows), 50):
            batch = rows[i:i + 50]
            supabase.table("trend_clusters").insert(batch).execute()
            inserted += len(batch)
    except Exception as e:
        print(f"  [trend_mapper] batch insert failed after {inserted} rows: {e}")
    return inserted


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def map_trends(brief_type, started_at, run_id=None):
    """
    Build trend clusters for one pipeline run and write them to trend_clusters.

    Parameters
    ----------
    brief_type : str      — 'morning' | 'evening'
    started_at : datetime — timezone-aware UTC; when run.py started
    run_id     : str|None — id from pipeline_runs; if None, skips gracefully

    This function never raises. All failures are caught and printed locally.
    The caller (run.py) is unaffected by Trend Mapper failures.
    """
    if run_id is None:
        print("  [trend_mapper] run_id is None — skipping trend_clusters write")
        return

    started_at_iso = started_at.isoformat()

    # Fetch all run context in one logical block
    articles, briefing, prior_cluster_keys_by_run = fetch_run_context(
        run_id, brief_type, started_at_iso
    )

    if not articles:
        print(f"  [trend_mapper] no articles found for run_id={run_id} — skipping")
        return

    # Build clusters using connected components over pairwise similarity
    clusters = build_clusters(articles)

    if not clusters:
        print(f"  [trend_mapper] no multi-article clusters found for run_id={run_id}")
        return

    lookback_run_count = len(prior_cluster_keys_by_run)
    print(
        f"  [trend_mapper] {len(articles)} articles → {len(clusters)} clusters "
        f"(lookback={lookback_run_count} prior {brief_type} runs)"
    )

    # Score and classify each cluster, then build the DB row
    rows = []
    for cluster_idx, cluster in enumerate(clusters):
        try:
            cluster_key = make_cluster_key(cluster)
            label       = make_cluster_label(cluster)
            strength    = score_cluster_strength(cluster)
            strength    = _apply_source_credibility(cluster, strength)  # Phase 5
            strength    = _apply_pattern_boost(cluster, strength)       # Phase 6
            confidence  = score_cluster_confidence(cluster)

            cluster_type, matched_run_count, matched_prior_keys = classify_cluster_type(
                cluster_key, prior_cluster_keys_by_run
            )

            surf = detect_cluster_surfacing(cluster, briefing)

            # Underrepresented: meaningfully strong cluster that wasn't surfaced
            underrepresented_flag = (
                strength >= UNDERREPRESENTED_STRENGTH_FLOOR
                and not surf["surfaced_anywhere"]
            )

            # Aggregate stats for the row
            sources = list({art["source"] for art in cluster if art["source"]})
            scores  = [
                art["relevance_score"] for art in cluster
                if art["relevance_score"] is not None
            ]
            avg_rel = round(sum(scores) / len(scores), 2) if scores else None
            max_rel = max(scores) if scores else None

            # Top entities by frequency (stored for inspection and future queries)
            company_counts = defaultdict(int)
            theme_counts   = defaultdict(int)
            sector_counts  = defaultdict(int)
            for art in cluster:
                for c in art["companies"]: company_counts[c] += 1
                for t in art["themes"]:   theme_counts[t]   += 1
                if art["sector"]:          sector_counts[art["sector"]] += 1

            top_companies_list = sorted(
                company_counts, key=company_counts.get, reverse=True
            )[:5]
            top_themes_list = sorted(
                theme_counts, key=theme_counts.get, reverse=True
            )[:5]
            top_sectors_list = sorted(
                sector_counts, key=sector_counts.get, reverse=True
            )[:3]

            # Representative articles: first 5 article ids in the cluster
            representative_ids = [
                art["id"] for art in cluster if art["id"]
            ][:5]

            # Novelty score: 1.0 = never seen in lookback, 0.0 = seen every run
            novelty_score = round(
                1.0 - (matched_run_count / LOOKBACK_RUN_COUNT)
                if LOOKBACK_RUN_COUNT > 0 else 1.0,
                3
            )

            # Cross-source flag: corroborated by 3+ distinct outlets
            cross_source_flag = len(sources) >= 3

            # Quality gate — only surface clusters with meaningful evidence
            if len(cluster) < 4 or len(sources) < 2:
                print(f"  [trend_mapper]   Skipping low-evidence cluster: {label} ({len(cluster)} articles, {len(sources)} sources)")
                continue

            # Cross-run deduplication — if same label exists in last 7 days, update instead of inserting
            cutoff = (datetime.utcnow() - timedelta(days=7)).isoformat()
            existing = (
                supabase.table("trend_clusters")
                .select("id")
                .eq("label", label)
                .gte("created_at", cutoff)
                .neq("run_id", run_id)
                .limit(1)
                .execute()
            )
            if existing.data:
                print(f"  [trend_mapper]   Dedup: updating existing cluster for '{label}'")
                supabase.table("trend_clusters").update({
                    "run_id": run_id,
                    "article_count": len(cluster),
                    "source_count": len(sources),
                    "strength_score": strength,
                    "confidence_score": confidence,
                    "novelty_score": novelty_score,
                    "cross_source_flag": cross_source_flag,
                    "representative_article_ids": json.dumps(representative_ids),
                }).eq("id", existing.data[0]["id"]).execute()
                continue

            # Generate AI headline + tagline
            headline, tagline = generate_cluster_headline(cluster, label)

            row = {
                "run_id":                     run_id,
                "brief_type":                 brief_type,
                "cluster_key":                cluster_key,
                "label":                      label,
                "headline":                   headline,
                "tagline":                    tagline,
                "cluster_type":               cluster_type,
                "article_count":              len(cluster),
                "source_count":               len(sources),
                "avg_relevance_score":        avg_rel,
                "max_relevance_score":        max_rel,
                "top_companies":              json.dumps(top_companies_list),
                "top_themes":                 json.dumps(top_themes_list),
                "top_sectors":                json.dumps(top_sectors_list),
                "representative_article_ids": json.dumps(representative_ids),
                "strength_score":             strength,
                "confidence_score":           confidence,
                "surfaced_in_headline":       surf["surfaced_in_headline"],
                "surfaced_in_sections":       surf["surfaced_in_sections"],
                "surfaced_in_top_deals":      surf["surfaced_in_top_deals"],
                "surfaced_anywhere":          surf["surfaced_anywhere"],
                "underrepresented_flag":      underrepresented_flag,
                "lookback_run_count":         lookback_run_count,
                "matched_prior_cluster_keys": json.dumps(matched_prior_keys),
                "novelty_score":              novelty_score,
                "cross_source_flag":          cross_source_flag,
                "provenance":                 "reconstructed",
            }
            rows.append(row)

            # Log one line per cluster for validation and monitoring
            surf_note = (
                "surfaced"
                if surf["surfaced_anywhere"]
                else ("⚑ underrepresented" if underrepresented_flag else "not surfaced")
            )
            print(
                f"  [trend_mapper]   [{cluster_idx}] '{label}' — "
                f"type={cluster_type}, n={len(cluster)}, "
                f"src={len(sources)}, str={strength}, conf={confidence}, "
                f"{surf_note}"
            )

        except Exception as e:
            print(f"  [trend_mapper]   [{cluster_idx}] cluster failed (skipped): {e}")
            continue

    # Persist to Supabase
    if rows:
        inserted = persist_trend_clusters(rows)
        summary = (
            f"{inserted}/{len(rows)} cluster rows written — "
            f"persistent={sum(1 for r in rows if r['cluster_type'] == 'persistent')}, "
            f"emerging={sum(1 for r in rows if r['cluster_type'] == 'emerging')}, "
            f"underrepresented={sum(1 for r in rows if r['underrepresented_flag'])}"
        )
        print(f"  [trend_mapper] {summary}")
    else:
        print("  [trend_mapper] no valid cluster rows to write")
