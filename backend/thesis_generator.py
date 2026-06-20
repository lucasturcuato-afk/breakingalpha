"""
thesis_generator.py — BreakingAlpha
System-owned thesis generator that runs as part of the morning cron.

Mirrors the prompt + core logic of src/app/api/theses/route.ts (POST handler)
but operates without an authenticated user. Performs semantic dedup against
existing thesis embeddings so we feed evidence into existing theses rather
than spawning duplicates of the same idea:

  - Cosine similarity (cluster embedding ↔ thesis embedding) > 0.65
      → COVERED. Append today's evidence to the matched thesis's
        evidence_chain JSONB. No new thesis generated from this cluster.

  - Cosine similarity ≤ 0.65
      → NEW. Cluster goes into the batch passed to Gemini, which
        synthesizes net-new theses tagged source = "ai-generated-cron"
        and user_id = NULL.

Runnable standalone for manual testing:

    python backend/thesis_generator.py

Hooked into backend/run.py as step 16 (morning runs only, soft-fail wrapped)
so it executes automatically each morning after the existing pipeline.
"""
from __future__ import annotations

import json
import logging
import os
import re
import sys
from datetime import datetime, timedelta, timezone

# Load .env before any module-level client creation so standalone invocation
# (`python backend/thesis_generator.py`) works without a wrapper. When invoked
# via run.py the env is already populated by the cron host and load_dotenv()
# is a no-op for already-set keys.
try:
    from dotenv import load_dotenv  # type: ignore
    _env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(_env_path):
        load_dotenv(_env_path)
except Exception:
    pass

import numpy as np
from supabase import create_client
from google import genai

# Reuse the existing embedding helper so the same Gemini model + dimensions
# are used everywhere theses get embedded. Importing the module also gives
# us a sanity check that backend/embedding_job.py is intact.
import embedding_job
from outputs import record_output
from output_constants import THESIS_PROMPT_VERSION
from thesis_recommendation_guard import (
    build_thesis_correction,
    detect_thesis_violations,
    enforce_thesis_recommendation,
    has_thesis_violation,
    violation_count,
)

logger = logging.getLogger("thesis_generator")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format="%(message)s")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
SIMILARITY_THRESHOLD = 0.65       # cosine sim > this → cluster is covered
MAX_CLUSTERS = 10                 # cap per-run, mirrors TS route
MAX_ARTICLES_PER_CLUSTER = 3
LOOKBACK_DAYS = 7                 # window for trend_clusters lookup
GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_TEMPERATURE = 0.3
GEMINI_MAX_TOKENS = 2000
THESIS_SOURCE = "ai-generated-cron"   # distinguishes cron from user theses
MAX_THESES_INSERT = 5

# Conviction priority for intra-batch sector diversity tie-break.
# HIGHER number wins. Mirrors the spec's HIGH > BULLISH > BEARISH > MEDIUM > WATCH.
CONVICTION_PRIORITY = {
    "HIGH": 5,
    "BULLISH": 4,
    "BEARISH": 3,
    "MEDIUM": 2,
    "WATCH": 1,
}

# Sector → ETF map (mirrors src/app/api/theses/route.ts SECTOR_ETF_MAP exactly).
SECTOR_ETF_MAP = {
    "technology": "XLK", "tech": "XLK", "software": "XLK",
    "financials": "XLF", "finance": "XLF", "banking": "XLF",
    "healthcare": "XLV", "health": "XLV", "biotech": "XLV", "pharma": "XLV",
    "energy": "XLE", "oil": "XLE", "oil & gas": "XLE",
    "industrials": "XLI", "industrial": "XLI", "defense": "XLI", "aerospace": "XLI",
    "consumer discretionary": "XLY", "retail": "XLY", "consumer cyclical": "XLY",
    "consumer staples": "XLP",
    "communications": "XLC", "media": "XLC", "telecom": "XLC",
    "utilities": "XLU",
    "materials": "XLB",
    "real estate": "XLRE",
    "general": "SPY", "macro": "SPY", "market": "SPY",
}

# Module-level clients. Mirrors embedding_job.py — same anon key path that
# the rest of the cron uses successfully for inserts.
supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])
gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])


# ---------------------------------------------------------------------------
# Cluster + article fetch
# ---------------------------------------------------------------------------
def _fetch_latest_clusters(sb) -> tuple[str | None, list[dict]]:
    """Return (run_id, clusters) for the most recent trend_clusters run within
    the last LOOKBACK_DAYS days. Up to MAX_CLUSTERS clusters, ranked by
    strength_score DESC. Mirrors the TS route's lookup window + ranking.
    """
    cutoff_iso = (
        datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)
    ).isoformat()

    latest = (
        sb.table("trend_clusters")
        .select("run_id, brief_type")
        .gte("created_at", cutoff_iso)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not latest.data:
        return None, []

    run_id = latest.data[0]["run_id"]

    clusters = (
        sb.table("trend_clusters")
        .select(
            "label, cluster_type, source_count, strength_score, "
            "top_companies, top_sectors, representative_article_ids"
        )
        .eq("run_id", run_id)
        .order("strength_score", desc=True)
        .limit(MAX_CLUSTERS)
        .execute()
    )
    return run_id, clusters.data or []


def _resolve_cluster_articles(
    sb, clusters: list[dict]
) -> tuple[dict[str, dict], list[list[str]]]:
    """Resolve up to MAX_ARTICLES_PER_CLUSTER article ids per cluster, fetch
    those rows from articles, and return:
        article_map        — {article_id: article_row}
        per_cluster_ids    — [[id, id, ...], ...] aligned with `clusters`
    """
    per_cluster_ids: list[list[str]] = []
    all_ids: set[str] = set()

    for c in clusters:
        raw = c.get("representative_article_ids")
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except Exception:
                raw = []
        if not isinstance(raw, list):
            per_cluster_ids.append([])
            continue
        ids: list[str] = []
        for item in raw[:MAX_ARTICLES_PER_CLUSTER]:
            if isinstance(item, str):
                ids.append(item)
            elif isinstance(item, list):
                ids.extend([x for x in item if isinstance(x, str)])
        per_cluster_ids.append(ids)
        all_ids.update(ids)

    if not all_ids:
        return {}, per_cluster_ids

    rows = (
        sb.table("articles")
        .select("id, title, summary, sector, ingested_at, content_type")
        .in_("id", list(all_ids))
        .execute()
    )
    article_map = {r["id"]: r for r in (rows.data or [])}
    return article_map, per_cluster_ids


# ---------------------------------------------------------------------------
# Embedding + similarity
# ---------------------------------------------------------------------------
def _build_cluster_text(
    cluster: dict, article_ids: list[str], article_map: dict[str, dict]
) -> str:
    """Build the text used to embed a cluster. Combines label, top
    companies/sectors, and representative article titles + truncated summaries.
    """
    label = cluster.get("label") or "(unlabeled)"
    top_companies = cluster.get("top_companies") or []
    top_sectors = cluster.get("top_sectors") or []
    if isinstance(top_companies, list):
        tc = ", ".join([str(x) for x in top_companies[:3]])
    else:
        tc = ""
    if isinstance(top_sectors, list):
        ts = ", ".join([str(x) for x in top_sectors[:2]])
    else:
        ts = ""

    article_lines = []
    for aid in article_ids:
        a = article_map.get(aid)
        if not a:
            continue
        title = a.get("title") or ""
        summary = (a.get("summary") or "")[:300]
        article_lines.append(f"{title} — {summary}")

    return (
        f"{label}\n"
        f"Top companies: {tc}\n"
        f"Top sectors: {ts}\n"
        f"Articles:\n" + "\n".join(article_lines)
    )


def _parse_embedding(raw) -> np.ndarray | None:
    """Supabase Python client returns the pgvector column as a JSON string
    like '[0.01,0.02,...]'. Parse to numpy float32 array.
    """
    if raw is None:
        return None
    if isinstance(raw, list):
        arr = raw
    elif isinstance(raw, str):
        try:
            arr = json.loads(raw)
        except Exception:
            return None
    else:
        return None
    try:
        v = np.asarray(arr, dtype=np.float32)
        if v.ndim != 1 or v.size == 0:
            return None
        return v
    except Exception:
        return None


def _fetch_live_thesis_embeddings(sb) -> list[dict]:
    """Two-query fetch + Python-side join:
       1. theses where (expired IS FALSE OR expired IS NULL)
       2. content_embeddings filtered by content_id IN (those ids)
    The DB has 2 orphan thesis embeddings (theses deleted but embedding rows
    remained) — the id-set filter naturally excludes them.
    Returns list of {id, title, sector, ticker, evidence_chain, embedding(np)}.
    """
    # PostgREST: `expired IS FALSE OR expired IS NULL`
    theses_resp = (
        sb.table("theses")
        .select("id, title, sector, ticker, evidence_chain, expired")
        .or_("expired.is.null,expired.eq.false")
        .execute()
    )
    theses = theses_resp.data or []
    if not theses:
        return []

    thesis_ids = [t["id"] for t in theses]
    emb_resp = (
        sb.table("content_embeddings")
        .select("content_id, embedding")
        .eq("content_type", "thesis")
        .in_("content_id", thesis_ids)
        .execute()
    )
    emb_by_id: dict[str, np.ndarray] = {}
    for row in emb_resp.data or []:
        v = _parse_embedding(row.get("embedding"))
        if v is None:
            continue
        emb_by_id[row["content_id"]] = v

    out: list[dict] = []
    for t in theses:
        v = emb_by_id.get(t["id"])
        if v is None:
            continue
        out.append({
            "id": t["id"],
            "title": t.get("title") or "",
            "sector": t.get("sector") or "",
            "ticker": t.get("ticker"),
            "evidence_chain": t.get("evidence_chain"),
            "embedding": v,
        })
    return out


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    na = np.linalg.norm(a)
    nb = np.linalg.norm(b)
    if na == 0.0 or nb == 0.0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


# ---------------------------------------------------------------------------
# Evidence-chain append
# ---------------------------------------------------------------------------
def _coerce_evidence_chain(raw) -> list:
    """Defensive parse: evidence_chain may be None, a list, a JSON string, or
    something malformed. If it isn't a list after parsing, treat as []."""
    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, list) else []
        except Exception:
            return []
    return []


def _append_evidence(sb, thesis_id: str, prev_chain, entry: dict) -> list | None:
    """Append a single evidence entry to a thesis. Returns the new full chain
    on success (so callers can keep their in-memory state in sync when
    multiple clusters match the same thesis in one run), or None on failure.
    """
    chain = _coerce_evidence_chain(prev_chain)
    chain.append(entry)
    try:
        sb.table("theses").update(
            {"evidence_chain": chain}
        ).eq("id", thesis_id).execute()
        return chain
    except Exception as e:
        logger.warning("evidence_chain update failed for %s: %s", thesis_id, e)
        return None


# ---------------------------------------------------------------------------
# Gemini call for net-new theses
# ---------------------------------------------------------------------------
def _build_cluster_block_for_prompt(
    cluster: dict,
    cluster_index_label: int,
    article_ids: list[str],
    article_map: dict[str, dict],
) -> str:
    """Render one cluster as a multi-line prompt block. Mirrors the TS route's
    clusterBlocks formatting verbatim so Gemini sees the same shape it's been
    trained on by months of user runs."""
    label = cluster.get("label") or "(unlabeled)"
    cluster_type = cluster.get("cluster_type") or "unknown"
    source_count = cluster.get("source_count") or 0
    strength = cluster.get("strength_score")
    strength_str = f"{strength:.2f}" if isinstance(strength, (int, float)) else "—"

    top_companies = cluster.get("top_companies") or []
    top_sectors = cluster.get("top_sectors") or []
    tc = (
        ", ".join([str(x) for x in top_companies[:3]])
        if isinstance(top_companies, list) and top_companies
        else "—"
    )
    ts = (
        ", ".join([str(x) for x in top_sectors[:2]])
        if isinstance(top_sectors, list) and top_sectors
        else "—"
    )

    article_lines = []
    for aid in article_ids:
        a = article_map.get(aid)
        if not a:
            continue
        title = a.get("title") or ""
        summary = (a.get("summary") or "")[:200]
        ctype = a.get("content_type") or "snippet"
        suffix = f" — {summary}" if summary else ""
        article_lines.append(f"  - id={a['id']} | content_type={ctype} | {title}{suffix}")
    if not article_lines:
        article_lines = ["  (no articles resolved)"]

    return (
        f"Cluster {cluster_index_label}: {label}\n"
        f"  cluster_type: {cluster_type}\n"
        f"  source_count: {source_count}\n"
        f"  strength_score: {strength_str}\n"
        f"  top_companies: {tc}\n"
        f"  top_sectors: {ts}\n"
        f"  articles:\n" + "\n".join(article_lines)
    )


def _build_prompt(cluster_blocks: str) -> str:
    """Mirror the TS route prompt verbatim (without addendum/pattern blocks —
    those are best-effort enrichments the TS route fetches from weekly_digests
    and pattern_library; the cron stays minimal here and ships those in a
    follow-up PR if Noah wants them)."""
    return (
        "You are a senior investment banking analyst at a top-tier firm "
        "(Goldman Sachs, Blackstone, KKR level). You have been given today's "
        "market narrative clusters, each representing a group of related news "
        "articles that have been algorithmically clustered by topic, company, "
        "and sector.\n\n"
        "Your job is to synthesize these clusters into 3-5 high-conviction "
        "investment theses that a portfolio manager or deal team would actually "
        "act on.\n\n"
        "STRICT REQUIREMENTS for each thesis:\n\n"
        "1. **Title MUST be DESCRIPTIVE ANALYSIS, not a recommendation.** State "
        "what is changing for the named entity or theme and why it matters, with "
        "the security or theme as the SUBJECT. This is informational analysis, "
        "NOT advice.\n"
        "   - FORBIDDEN: any directive prefix or call. Never begin with \"Buy\", "
        "\"Sell\", \"Long\", \"Short\", \"Avoid\", or \"Watch\", and never phrase "
        "the title as an instruction to trade.\n"
        "   - REQUIRED shape: subject + what is changing, e.g. \"AeroVironment "
        "Backlog Strengthens on New Orders\", \"Defense Supplier Margins Lag "
        "Prime Backlogs\", \"Iran Risk Premium Set to Compress\", \"Optical "
        "Computing Read-Through Stays Unproven\".\n"
        "   - Use neutral analytical verbs (strengthens, weakens, re-rates, "
        "compresses, lags, outperforms, resolves, reverses, breaks down) framed "
        "as observations, not as bets the reader should place.\n"
        "   The title is 8 words MAX.\n\n"
        "2. **Rationale MUST be 2-3 sentences total**, structured as:\n"
        "   - Sentence 1: state the structural argument (why the trade exists)\n"
        "   - Sentence 2: identify the asymmetry (what the market is missing "
        "or has miscalibrated)\n"
        "   - **Sentence 3 (the close) MUST begin with one of these exact "
        "phrasings** (evidence and falsifiability, NOT a trade instruction):\n"
        "     a. \"What confirms this: [specific event/data point].\"\n"
        "     b. \"What invalidates this: [specific event/data point].\"\n"
        "   Do NOT recommend a vehicle or instrument. Never write \"the cleanest "
        "expression is [ticker]\", \"the best way to play this\", or any "
        "buy/sell/long/short/overweight/underweight phrasing. Name a security "
        "only as the SUBJECT of analysis or the falsifiable signal, never as an "
        "instrument the reader should trade.\n"
        "   No exceptions. The final sentence is the load-bearing element of "
        "the thesis.\n\n"
        "3. **Catalyst MUST be a specific upcoming event with a temporal "
        "anchor.**\n"
        "   Required structure: \"[Specific event] expected [date or 'within "
        "next N weeks/months']\"\n"
        "   Examples:\n"
        "     - \"Q3 2026 earnings from Lockheed Martin (October 24)\"\n"
        "     - \"FOMC rate decision on May 1\"\n"
        "     - \"OPEC+ ministerial meeting expected in early Q3\"\n"
        "     - \"Within the next 30 days, [observable data series] will "
        "reveal...\"\n"
        "   The catalyst points FORWARD to something not yet observed. Past "
        "events restated as catalysts are forbidden.\n\n"
        "4. **conviction must be exactly one of: HIGH, MEDIUM, or WATCH**\n"
        "   - HIGH = strong signal across multiple sources, clear catalyst, "
        "asymmetric setup\n"
        "   - MEDIUM = emerging signal, needs confirmation\n"
        "   - WATCH = early signal, monitor closely\n\n"
        "5. **supporting_article_ids must contain the EXACT article IDs from "
        "the cluster data** (the id= values shown). Minimum 2 IDs per "
        "thesis.\n\n"
        "QUALITY RULES:\n\n"
        "- Be selective. Only generate a thesis if there is genuine signal. "
        "Do not generate a thesis for every cluster — empty output is "
        "acceptable when clusters lack actionable signal.\n"
        "- Never generate generic market commentary. Every thesis must name "
        "specific companies, sectors, or macro events drawn from the cluster "
        "data.\n"
        "- Prioritize clusters with higher strength_score and source_count.\n"
        "- **Never fabricate prices, multiples, or valuations.** You do not "
        "have access to current market data. Only reference numbers "
        "explicitly provided in the cluster article summaries. Qualitative "
        "statements like \"trading at peak-cycle multiples\" are acceptable; "
        "specific figures like \"trading at 28x forward earnings\" are "
        "forbidden unless directly quoted from the input.\n"
        "- The voice is opinionated analyst, not Bloomberg headline. Imagine "
        "you are writing for a portfolio manager who has read the news and "
        "wants to know YOUR position, not a recap.\n"
        "- VOICE REGISTER (institutional, never personal): first-person "
        "singular is banned -- never \"I\", \"me\", \"my\", \"I believe\", "
        "\"I think\", \"in my view\". State the position in active third "
        "person or the institutional \"we\"; attribute stance to evidence "
        "where possible. Keep the required Sentence-3 close (\"If we're "
        "right... / if not...\") and the third-person framing the examples "
        "use. Passive-voice hedging (\"it is believed\", \"it is expected "
        "that\") is banned with the same force. This rule governs pronouns "
        "and stance ownership only; it does not relax any existing "
        "structure, the required close, or the examples.\n\n"
        "EXAMPLES of the voice we want — these are the exact format and "
        "register your output should match:\n\n"
        "EXAMPLE 1:\n"
        "{\n"
        "  \"title\": \"Defense Suppliers Lag Prime Backlogs\",\n"
        "  \"conviction\": \"HIGH\",\n"
        "  \"sector\": \"Industrials\",\n"
        "  \"rationale\": \"NATO procurement budgets are accelerating defense "
        "contractor backlogs across primes (LMT, RTX), but those names are "
        "already trading at peak-cycle multiples and have absorbed most of "
        "the news. The asymmetry sits in tier-2 suppliers (electronics, "
        "propulsion components, specialty materials) whose revenue tracks "
        "prime backlogs with a 6-9 month lag and whose multiples have not "
        "repriced. What confirms this: tier-2 supplier order books and the "
        "supplier-weighted ITA closing its gap to the prime-heavy XAR over the "
        "next two quarters.\",\n"
        "  \"catalyst\": \"Q3 2026 earnings from LMT (October 23) and RTX "
        "(October 28) will reveal whether prime-level backlog growth is "
        "translating into supplier order flow.\",\n"
        "  \"supporting_article_ids\": [\"...\", \"...\"],\n"
        "  \"ticker\": \"ITA\",\n"
        "  \"horizon\": \"90d\",\n"
        "  \"verifiable_signal\": \"ITA outperforms XAR by 3%+ between now "
        "and Q3 2026 earnings.\"\n"
        "}\n\n"
        "EXAMPLE 2:\n"
        "{\n"
        "  \"title\": \"Iran Risk Premium Compresses by Q3\",\n"
        "  \"conviction\": \"MEDIUM\",\n"
        "  \"sector\": \"Energy\",\n"
        "  \"rationale\": \"Brent's recent move to $100+ embeds a meaningful "
        "Iran-blockade risk premium that historically dissipates within "
        "60-90 days when shipping resumes or talks restart. Both sides face "
        "structural pressure to negotiate (Iran needs revenue, US faces "
        "midterm gas price politics), making prolonged blockade unlikely "
        "beyond Q2. What invalidates this: a Strait of Hormuz incident with "
        "vessel damage, which would extend the premium past 90 days.\",\n"
        "  \"catalyst\": \"OPEC+ ministerial meeting in early Q3 2026 — "
        "combined with any US-Iran statement on talks resumption — will "
        "determine whether the premium holds or collapses.\",\n"
        "  \"supporting_article_ids\": [\"...\", \"...\"],\n"
        "  \"ticker\": \"USO\",\n"
        "  \"horizon\": \"90d\",\n"
        "  \"verifiable_signal\": \"Brent crude trades below $90 within 90 "
        "days.\"\n"
        "}\n\n"
        "EXAMPLE 3:\n"
        "{\n"
        "  \"title\": \"Optical Computing Read-Through Stays Unproven\",\n"
        "  \"conviction\": \"WATCH\",\n"
        "  \"sector\": \"Technology\",\n"
        "  \"rationale\": \"Lightelligence's Hong Kong debut surge validates "
        "investor appetite for AI-infrastructure niche names, but the "
        "read-through to listed comps (Lumentum, II-VI) is unclear because "
        "most existing optical computing exposure is in private companies or "
        "non-US listings. The asymmetry is whether public optical-computing "
        "pure-plays exist in size, since if they do they should rerate quickly, "
        "and if they don't the surge is a private-market dynamic that doesn't "
        "transmit. What confirms this: Lumentum and II-VI re-rate within 30 "
        "days on disclosed optical-computing exposure; absent that, the move "
        "stays trapped in HK-listed names.\",\n"
        "  \"catalyst\": \"Within the next 30 days, Lumentum and II-VI "
        "investor-day mentions of optical-computing exposure will signal "
        "whether the public-comp read-through holds.\",\n"
        "  \"supporting_article_ids\": [\"...\", \"...\"],\n"
        "  \"ticker\": \"LITE\",\n"
        "  \"horizon\": \"30d\",\n"
        "  \"verifiable_signal\": \"LITE outperforms XLK by 5%+ within 30 "
        "days.\"\n"
        "}\n\n"
        "Match this voice. Match this structure. Match this density.\n\n"
        "Return a JSON array only. Each object must have exactly these fields:\n"
        "{\n"
        "  title: string (8 words max, DESCRIPTIVE analysis with the security or "
        "theme as subject; NO \"Buy/Sell/Long/Short/Avoid/Watch\" prefix, no "
        "trade instruction),\n"
        "  conviction: HIGH | MEDIUM | WATCH,\n"
        "  sector: string,\n"
        "  rationale: string (2-3 sentences, closing with \"What confirms this:\" "
        "or \"What invalidates this:\"; never recommends a vehicle or instrument),\n"
        "  catalyst: string (1-2 sentences, what triggered this),\n"
        "  supporting_article_ids: string[] (minimum 2 article IDs),\n"
        "  ticker: string (REQUIRED — single primary US ticker. For company-"
        "specific theses use the company ticker e.g. \"AAPL\". For macro/sector "
        "theses use the most relevant sector ETF: \"SPY\", \"XLF\", \"XLK\", "
        "\"XLE\", \"XLV\", \"XLI\", \"XLC\", \"XLY\", \"XLP\", \"XLU\", \"XLB\", "
        "\"XLRE\", \"GLD\", \"TLT\", \"DXY\". NEVER return null),\n"
        "  horizon: \"7d\" | \"30d\" | \"90d\" (when this thesis should be graded),\n"
        "  verifiable_signal: string (ONE sentence stating a concrete, falsifiable "
        "outcome — e.g. \"AAPL closes above $230 within 30 days\")\n"
        "}\n\n"
        f"CLUSTERS:\n{cluster_blocks}"
    )


def _parse_gemini_json(raw: str) -> list:
    """Three-layer JSON parse: full → first array → first object wrapped.
    Mirrors the TS route's parsing fallback. Returns [] on total failure."""
    cleaned = raw.replace("```json", "").replace("```", "").strip()
    # Layer 1: whole response
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            return [parsed]
    except Exception:
        pass
    # Layer 2: first JSON array
    import re
    m = re.search(r"\[[\s\S]*\]", cleaned)
    if m:
        try:
            parsed = json.loads(m.group(0))
            if isinstance(parsed, list):
                return parsed
        except Exception:
            pass
    # Layer 3: first JSON object → wrap
    m = re.search(r"\{[\s\S]*\}", cleaned)
    if m:
        try:
            parsed = json.loads(m.group(0))
            if isinstance(parsed, dict):
                return [parsed]
        except Exception:
            pass
    return []


def _validate_thesis(t) -> bool:
    """Mirror the TS route validateThesis: title/conviction/sector all
    non-empty strings."""
    if not isinstance(t, dict):
        return False
    return (
        isinstance(t.get("title"), str) and len(t["title"]) > 0
        and isinstance(t.get("conviction"), str) and len(t["conviction"]) > 0
        and isinstance(t.get("sector"), str) and len(t["sector"]) > 0
    )


def _call_gemini(prompt: str) -> list[dict]:
    """Call Gemini-2.5-flash with the same params as the TS route, parse with
    the three-layer fallback, validate, cap at MAX_THESES_INSERT."""
    try:
        resp = gemini_client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config={
                "temperature": GEMINI_TEMPERATURE,
                "max_output_tokens": GEMINI_MAX_TOKENS,
                "response_mime_type": "application/json",
                "thinking_config": {"thinking_budget": 512},
            },
        )
    except Exception as e:
        logger.warning("Gemini call failed: %s", e)
        return []

    raw = getattr(resp, "text", "") or ""
    logger.info("Gemini raw response (first 400 chars): %s", raw[:400])

    parsed = _parse_gemini_json(raw)
    if not parsed:
        logger.warning("Gemini response could not be parsed as JSON")
        return []

    valid = [t for t in parsed if _validate_thesis(t)]
    capped = valid[:MAX_THESES_INSERT]
    return [_guard_thesis(t) for t in capped]


def _regenerate_thesis(original: dict, correction: str) -> tuple[str, str] | None:
    """Bounded re-ask: rewrite ONE thesis's title + rationale to comply, keeping
    the same facts. Returns (title, rationale) or None on any failure so the
    guard falls back to deterministic redaction. Mirrors the injected
    `regenerate` of brief_voice_guard."""
    prompt = (
        "Rewrite this single investment thesis to comply, preserving the same "
        "companies, facts, catalyst, and structure.\n\n"
        f"CURRENT TITLE: {original.get('title') or ''}\n"
        f"CURRENT RATIONALE: {original.get('rationale') or ''}\n\n"
        f"{correction}\n\n"
        'Return ONLY a JSON object: {"title": "...", "rationale": "..."}'
    )
    try:
        resp = gemini_client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config={
                "temperature": GEMINI_TEMPERATURE,
                "max_output_tokens": 600,
                "response_mime_type": "application/json",
                "thinking_config": {"thinking_budget": 0},
            },
        )
    except Exception as e:
        logger.warning("  thesis guard: re-ask failed (non-fatal): %s", e)
        return None
    raw = getattr(resp, "text", "") or ""
    try:
        cleaned = raw.replace("```json", "").replace("```", "").strip()
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        obj = json.loads(m.group(0) if m else cleaned)
    except Exception:
        return None
    if not isinstance(obj, dict):
        return None
    nt = obj.get("title")
    nr = obj.get("rationale")
    if not isinstance(nt, str) or not isinstance(nr, str):
        return None
    return (nt, nr)


def _guard_thesis(t: dict) -> dict:
    """Run the deterministic recommendation guard over a generated thesis's
    user-facing title + rationale. Structured fields (conviction, ticker,
    horizon, verifiable_signal) are NOT touched, so direction survives via
    conviction and grading stays as-is. Detect -> one bounded re-ask ->
    fail-closed redaction."""
    title = t.get("title") or ""
    rationale = t.get("rationale") or ""
    if not has_thesis_violation(title, rationale):
        return t
    before = detect_thesis_violations(title, rationale)
    logger.info(
        "  [thesis guard] %d violation(s) on '%s': enforcing descriptive framing",
        violation_count(before),
        title[:50],
    )
    res = enforce_thesis_recommendation(
        title, rationale, lambda corr: _regenerate_thesis(t, corr), max_reasks=1
    )
    out = dict(t)
    out["title"] = res.title
    out["rationale"] = res.rationale
    if res.still_violating:
        logger.warning("  [thesis guard] residual after fallback on '%s'", res.title[:50])
    return out


# ---------------------------------------------------------------------------
# Sector diversity + ticker resolution
# ---------------------------------------------------------------------------
def _apply_sector_diversity(theses: list[dict]) -> list[dict]:
    """Within this single batch only: keep only the highest-conviction thesis
    per sector. Sector match is case-insensitive on `sector` string equality."""
    by_sector: dict[str, dict] = {}
    for t in theses:
        sector = (t.get("sector") or "").strip().lower()
        prio = CONVICTION_PRIORITY.get(
            (t.get("conviction") or "").strip().upper(), 0
        )
        existing = by_sector.get(sector)
        if existing is None:
            by_sector[sector] = t
            continue
        existing_prio = CONVICTION_PRIORITY.get(
            (existing.get("conviction") or "").strip().upper(), 0
        )
        if prio > existing_prio:
            by_sector[sector] = t
    return list(by_sector.values())


def _resolve_ticker(raw_ticker, sector: str) -> str:
    if isinstance(raw_ticker, str) and raw_ticker.strip():
        return raw_ticker.strip().upper()
    return SECTOR_ETF_MAP.get((sector or "").strip().lower(), "SPY")


def _compute_check_after(generated_at_iso: str, horizon: str | None) -> str:
    days = 7 if horizon == "7d" else 90 if horizon == "90d" else 30
    d = datetime.fromisoformat(generated_at_iso.replace("Z", "+00:00"))
    return (d + timedelta(days=days)).isoformat()


# ---------------------------------------------------------------------------
# Insert + embed new theses
# ---------------------------------------------------------------------------
def _insert_and_embed_thesis(
    sb, raw_thesis: dict, valid_article_ids: set[str]
) -> str | None:
    """Insert one thesis row, read back the auto-generated id, then embed
    title+rationale and store in content_embeddings. Returns the new id or
    None on failure."""
    generated_at_iso = datetime.now(timezone.utc).isoformat()
    horizon_raw = raw_thesis.get("horizon")
    horizon = horizon_raw if horizon_raw in ("7d", "30d", "90d") else "30d"
    ticker = _resolve_ticker(raw_thesis.get("ticker"), raw_thesis.get("sector") or "")

    raw_supporting = raw_thesis.get("supporting_article_ids")
    if isinstance(raw_supporting, list):
        supporting = [
            sid for sid in raw_supporting
            if isinstance(sid, str) and sid in valid_article_ids
        ]
    else:
        supporting = None

    row = {
        "title": raw_thesis["title"],
        "conviction": raw_thesis["conviction"],
        "rationale": raw_thesis.get("rationale") or "",
        "sector": raw_thesis["sector"],
        "catalyst": raw_thesis.get("catalyst") or "",
        "catalyst_note": raw_thesis.get("catalyst_note") or None,
        "evidence_chain": raw_thesis.get("evidence_chain") or None,
        "supporting_articles": supporting,
        "status": "new-signal",
        "generated_at": generated_at_iso,
        "source": THESIS_SOURCE,
        "ticker": ticker,
        "horizon": horizon,
        "verifiable_signal": (
            raw_thesis["verifiable_signal"]
            if isinstance(raw_thesis.get("verifiable_signal"), str)
            else None
        ),
        "check_after": _compute_check_after(generated_at_iso, horizon),
        "user_id": None,
    }

    try:
        ins = sb.table("theses").insert(row).execute()
    except Exception as e:
        logger.warning("thesis insert failed: %s", e)
        return None
    if not ins.data:
        logger.warning("thesis insert returned no rows")
        return None
    new_id = ins.data[0].get("id")
    if not new_id:
        logger.warning("thesis insert response missing id")
        return None

    # Embed and store. Soft-fail: if embedding fails the thesis still exists
    # in the corpus; tomorrow's run won't dedupe against it but will dedupe
    # against the next successful embedding.
    embed_text = f"{row['title']}\n{row['rationale']}"[:embedding_job.TEXT_TRUNCATE_LIMIT]
    vec = embedding_job._embed_text(embed_text)
    if vec is None:
        logger.warning("embedding failed for new thesis %s — inserted but not embedded", new_id)
        return new_id
    try:
        sb.table("content_embeddings").insert({
            "content_type": "thesis",
            "content_id": new_id,
            "embedding": vec,
            "content_text": embed_text,
        }).execute()
    except Exception as e:
        logger.warning("content_embeddings insert failed for %s: %s", new_id, e)

    # Record to universal outputs table
    try:
        record_output(
            sb,
            output_type='thesis',
            content={
                'thesis_id': str(new_id),
                'title': row['title'],
                'ticker': row.get('ticker'),
                'sector': row['sector'],
                'conviction': row['conviction'],
                'horizon': row.get('horizon'),
                'rationale_excerpt': (row.get('rationale') or '')[:500],
            },
            generation_context={
                'model': GEMINI_MODEL,
                'prompt_version': THESIS_PROMPT_VERSION,
                'source': THESIS_SOURCE,
                'supporting_article_ids': [str(a) for a in (row.get('supporting_articles') or [])[:20]],
            },
            source_table='theses',
            source_id=new_id,
        )
    except Exception as rec_err:
        logger.warning("thesis_generator: record_output failed for %s: %s", new_id, rec_err)

    return new_id


# ---------------------------------------------------------------------------
# Cleanup logging
# ---------------------------------------------------------------------------
def _print_cleanup(inserted_ids: list[str], updated_ids: list[str]) -> None:
    """Print a SQL-rollback-friendly summary of every change made this run.
    `updated_ids` may contain duplicates when multiple clusters appended to
    the same thesis — we collapse + report the per-thesis count."""
    print("\n[CLEANUP] Run completed. Summary of changes:\n")
    if not inserted_ids and not updated_ids:
        print("[CLEANUP] No changes made this run.")
        return

    print(f"[CLEANUP] Inserted thesis IDs ({len(inserted_ids)} rows):")
    for tid in inserted_ids:
        print(f"  - {tid}")

    # Collapse multiple appends to the same thesis into "id (N appended today)"
    update_counts: dict[str, int] = {}
    for tid in updated_ids:
        update_counts[tid] = update_counts.get(tid, 0) + 1
    print(
        f"\n[CLEANUP] Updated thesis IDs (evidence appended) "
        f"({len(update_counts)} unique theses, {sum(update_counts.values())} total appends):"
    )
    for tid, n in update_counts.items():
        print(f"  - {tid}")

    if inserted_ids:
        ids_sql = ", ".join(f"'{tid}'" for tid in inserted_ids)
        print("\n[CLEANUP] To roll back inserts, run:")
        print(f"DELETE FROM theses WHERE id IN ({ids_sql});")
        print(
            "DELETE FROM content_embeddings WHERE content_type = 'thesis' "
            f"AND content_id IN ({ids_sql});"
        )

    if update_counts:
        print(
            "\n[CLEANUP] To roll back evidence appends, restore evidence_chain "
            "to prior state on these IDs:"
        )
        for tid, n in update_counts.items():
            entry_word = "entry" if n == 1 else "entries"
            print(f"  - {tid} ({n} {entry_word} appended today)")
        print(
            "Note: evidence appends are not trivially reversible via SQL — "
            "Noah should manually edit the evidence_chain JSONB if rollback is needed."
        )


# ---------------------------------------------------------------------------
# Main orchestration
# ---------------------------------------------------------------------------
def main() -> None:
    print("🧠 thesis_generator — starting")

    run_id, clusters = _fetch_latest_clusters(supabase)
    if not run_id or not clusters:
        logger.info("No trend_clusters found in last %d days — nothing to do", LOOKBACK_DAYS)
        _print_cleanup([], [])
        return
    logger.info("Fetched %d clusters for run_id=%s", len(clusters), run_id)

    article_map, per_cluster_ids = _resolve_cluster_articles(supabase, clusters)
    valid_article_ids = set(article_map.keys())
    logger.info("Resolved %d unique articles across clusters", len(article_map))

    # Embed each cluster (skip on embedding failure — cluster is dropped
    # from this run, neither matched nor used to seed a new thesis).
    cluster_embeddings: dict[int, np.ndarray] = {}
    for i, c in enumerate(clusters):
        text = _build_cluster_text(c, per_cluster_ids[i], article_map)
        vec = embedding_job._embed_text(text)
        if vec is None:
            logger.warning("cluster %d (%s) — embedding failed, skipping",
                           i + 1, c.get("label"))
            continue
        cluster_embeddings[i] = np.asarray(vec, dtype=np.float32)

    if not cluster_embeddings:
        logger.warning("No clusters successfully embedded — exiting")
        _print_cleanup([], [])
        return

    thesis_records = _fetch_live_thesis_embeddings(supabase)
    logger.info("Loaded %d live thesis embeddings", len(thesis_records))

    # Classify each cluster: covered (similarity > threshold) vs new.
    today_iso = datetime.now(timezone.utc).date().isoformat()
    matches: list[tuple[int, dict, float]] = []   # (cluster_idx, thesis_record, sim)
    new_indices: list[int] = []
    for i in cluster_embeddings:
        c_vec = cluster_embeddings[i]
        if not thesis_records:
            new_indices.append(i)
            continue
        # Find max-sim thesis for this cluster.
        best_sim = -1.0
        best_t: dict | None = None
        for t in thesis_records:
            sim = _cosine(c_vec, t["embedding"])
            if sim > best_sim:
                best_sim = sim
                best_t = t
        cluster_label = clusters[i].get("label") or "(unlabeled)"
        if best_t is not None and best_sim > SIMILARITY_THRESHOLD:
            logger.info(
                "cluster %d [%s] → COVERED by thesis %s (sim=%.3f)",
                i + 1, cluster_label, best_t["id"], best_sim,
            )
            matches.append((i, best_t, best_sim))
        else:
            logger.info(
                "cluster %d [%s] → NEW (top sim=%.3f%s)",
                i + 1, cluster_label, best_sim,
                f", best={best_t['id']}" if best_t else "",
            )
            new_indices.append(i)

    # Append evidence to matched theses. Two clusters matching the same
    # thesis correctly produce two appended entries: we keep an in-memory
    # cache of the current evidence_chain per thesis so the second update
    # builds on top of the first instead of overwriting it.
    current_chains: dict[str, list] = {}
    updated_thesis_ids: list[str] = []
    for cluster_idx, thesis, sim in matches:
        c = clusters[cluster_idx]
        top_companies = c.get("top_companies") or []
        tc = (
            ", ".join([str(x) for x in top_companies[:3]])
            if isinstance(top_companies, list) and top_companies
            else ""
        )
        entry = {
            "date": today_iso,
            "run_id": run_id,
            "cluster_label": c.get("label") or "",
            "article_ids": per_cluster_ids[cluster_idx],
            "similarity": round(sim, 4),
            "summary": f"{c.get('label') or ''}: {tc}",
        }
        prev = current_chains.get(thesis["id"], thesis.get("evidence_chain"))
        new_chain = _append_evidence(supabase, thesis["id"], prev, entry)
        if new_chain is not None:
            current_chains[thesis["id"]] = new_chain
            updated_thesis_ids.append(thesis["id"])
    logger.info(
        "Appended evidence (%d total appends across %d unique theses)",
        len(updated_thesis_ids), len(current_chains),
    )

    # Generate net-new theses from uncovered clusters.
    inserted_thesis_ids: list[str] = []
    if not new_indices:
        logger.info("All clusters covered — no new theses to generate")
    else:
        block_strs = [
            _build_cluster_block_for_prompt(
                clusters[i], i + 1, per_cluster_ids[i], article_map
            )
            for i in new_indices
        ]
        prompt = _build_prompt("\n\n".join(block_strs))
        raw_theses = _call_gemini(prompt)
        logger.info("Gemini returned %d valid theses (pre-diversity)", len(raw_theses))

        diverse = _apply_sector_diversity(raw_theses)
        logger.info(
            "After sector diversity: %d theses (dropped %d intra-batch duplicates)",
            len(diverse), len(raw_theses) - len(diverse),
        )

        for t in diverse:
            new_id = _insert_and_embed_thesis(supabase, t, valid_article_ids)
            if new_id:
                inserted_thesis_ids.append(new_id)
        logger.info("Inserted + embedded %d new theses", len(inserted_thesis_ids))

    _print_cleanup(inserted_thesis_ids, updated_thesis_ids)
    print("🧠 thesis_generator — done")


if __name__ == "__main__":
    main()
