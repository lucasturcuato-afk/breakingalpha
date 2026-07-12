"""
BreakingAlpha - News Ingestion Pipeline
Fetches from 15+ sources, scores relevance across all sectors,
stores in Supabase.
"""

import concurrent.futures
import threading
import os, json, re, random, socket, time, urllib.error, urllib.request, requests, feedparser, html as _html
from datetime import datetime, timezone, timedelta
from typing import Literal, Optional
from pydantic import BaseModel, Field
from supabase import create_client
from google import genai
from google.genai import types
from dotenv import load_dotenv
from watchlist import boost_watchlist_relevance
from wikidata import is_valid_company
from fulltext import fetch_full_text, SCRAPEABLE_SOURCES
from entity_resolver import resolve_entity, increment_mention_counts
from supabase_client import get_service_client
try:
    from usage_log import accumulate_gemini_usage
except Exception:  # pragma: no cover - usage logging must never break import
    try:
        from backend.usage_log import accumulate_gemini_usage
    except Exception:
        def accumulate_gemini_usage(*a, **k):
            return

load_dotenv()

# Process-wide socket timeout. Belt-and-suspenders against any library that
# might open an unbounded socket (feedparser, requests fallbacks, supabase-py
# realtime). 30s is long enough for legitimate slow responses, short enough
# to fail fast when an upstream stalls. Per-call timeouts (urlopen, requests,
# httpx) override this when set explicitly.
socket.setdefaulttimeout(30)

# All RSS fetches use this UA. SEC requires a non-default UA (returns 403
# without one); other feeds also tend to be friendlier with an identifiable
# UA than with python-urllib's default.
RSS_USER_AGENT = "BreakingAlpha pipeline (noahhanning03@gmail.com)"
RSS_FETCH_TIMEOUT_SEC = 20

supabase = get_service_client()
gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
from models import GEMINI_MODEL
# Filter step ONLY: the per-article relevance/sentiment classifier runs on the
# cheaper Flash-Lite model. Every other Gemini step stays on GEMINI_MODEL. The
# V3 rubric (LOW-template override + analyst-action 6-7 band) was validated on
# Flash-Lite; see the temp-0.2 confirmation in the PR.
from models import GEMINI_FILTER_MODEL as FILTER_MODEL

# ---------------------------------------------------------------------------
# RE-ANCHORED RELEVANCE GRADER (RELEVANCE_GRADE_MODE) -- LUCAS-REVIEWED CORE SCORER.
#
# The legacy relevance_score (Flash-Lite, FILTER_PROMPT rubric) saturates: 34% of
# the stored corpus sits at exactly 10 and 94% at >=8, so the score cannot sort
# the top band. The re-anchored grader (format-first template demotion + concrete
# corpus-drawn bands + a true 0 floor, run on gemini-2.5-flash) spreads the
# distribution hard (offline: stdev 1.04 -> 2.92, >=8 share 96% -> 15%, exact-10
# 41% -> 0.8%) while keeping genuine first-order news high. Full diagnosis +
# offline proof: docs/recon/relevance-recalibration.md.
#
# This is shipped behind a three-state mode modeled on INGEST_BLOCKLIST_MODE so
# that DEFAULT (shadow) is PROD-NEUTRAL: deploying changes nothing about the
# stored score or the >=6 ingest gate. Flipping to `new` is a human decision (it
# changes the ingest gate semantics and the stored distribution). See the
# flip-readiness checklist in the PR.
#
#   legacy -> current Flash-Lite grade is authoritative and the only one computed.
#             >=6 ingest gate unchanged. Identical to pre-change behavior.
#   shadow -> Flash-Lite grade STAYS authoritative (stored relevance_score and the
#             >=6 gate are unchanged, so prod is untouched). The new Flash grade is
#             ALSO computed for a SAMPLED fraction of LLM-graded articles and logged
#             with the greppable tag RELEVANCE_GRADE_SHADOW (article id/title +
#             legacy score + new score + band). Writes NOTHING new to the DB.
#   new    -> the new Flash grade REPLACES relevance_score and the ingest gate
#             switches to RELEVANCE_NEW_GATE (data-derived, see below).
RELEVANCE_GRADE_MODE = os.environ.get("RELEVANCE_GRADE_MODE", "shadow").strip().lower()

# The new grader runs on full Flash (not Flash-Lite): Flash-Lite is the proximate
# cause of the high-clustering (it ignored the existing detailed LOW override at a
# measured 0% hit rate). thinking_budget=0 keeps the cost/latency delta small.
RELEVANCE_GRADE_MODEL = os.environ.get("RELEVANCE_GRADE_MODEL", GEMINI_MODEL).strip()

# Ingest gate UNDER `new` MODE ONLY. Data-derived from the offline distribution
# (docs/recon/relevance-recalibration.md): the new grader's own bands map tightly
# to score ranges -- material_first_order -> 9-10, secondary_partial (analyst
# actions, index recaps) -> 6-7, weak (routine PR/procedural) -> 3-4, template/junk
# -> 0-2. Genuine first-order news NEVER lands below 6 in the offline sample; a 0
# is reserved for pure non-market news, AI-fabricated headlines, IPO recap
# explainers, and tenuous/incidental ticker ties. Gate >=1 drops ONLY that true-0
# floor (16/360 = 4.4% of the sample, 0 of them real news) and RETAINS everything
# with any signal for downstream relevance RANKING (it does not drop junk at
# ingest; junk lands low and is sorted down by the synthesis floor, the top-stories
# ORDER BY relevance_score, and the watchlist boost). Under legacy/shadow this
# constant is NOT consulted -- the gate stays >=6, hardcoded at the gate site.
RELEVANCE_NEW_GATE = int(os.environ.get("RELEVANCE_NEW_GATE", "1"))

# Shadow-window sampling: shadow mode pays for BOTH models (legacy Flash-Lite stays
# authoritative AND the new Flash grade is computed). To bound that cost during the
# observation window, the new grade is computed for only a SAMPLED fraction of
# LLM-graded articles (default 0.10 = 10%). Set to 1.0 to dual-score every article,
# or lower to spend less. SEC-bypassed articles are never shadow-graded (they never
# touch the LLM). Has no effect under legacy/new.
RELEVANCE_GRADE_SHADOW_SAMPLE_RATE = float(
    os.environ.get("RELEVANCE_GRADE_SHADOW_SAMPLE_RATE", "0.10")
)

# Cost guard for `new` mode: skip the full-Flash re-grade on articles the Flash-Lite
# filter already marked relevant=False. The ingest gate (search "result.get(\"relevant\")")
# drops any not-relevant article BEFORE it reads relevance_score, so a not-relevant
# article is never stored and its re-grade is never consumed. Skipping it therefore
# leaves the STORED set and every stored score/band byte-identical while cutting the
# grader call volume by the filter's reject rate (measured ~92% on 2026-07-07: 25,712
# grader calls vs 2,144 stored). DEFAULT OFF so merging changes nothing until Noah
# sets GRADER_SKIP_IRRELEVANT=1. No effect under legacy/shadow (shadow never overwrites
# the stored score and is already sample-bounded).
GRADER_SKIP_IRRELEVANT = os.environ.get("GRADER_SKIP_IRRELEVANT", "").strip().lower() in (
    "1", "true", "yes", "on"
)

if RELEVANCE_GRADE_MODE not in ("legacy", "shadow", "new"):
    print(
        f"  [relevance-grade] unknown RELEVANCE_GRADE_MODE={RELEVANCE_GRADE_MODE!r}, "
        "falling back to 'shadow' (prod-neutral default)"
    )
    RELEVANCE_GRADE_MODE = "shadow"

# Per-article filter parallelism. Smoke test 3 (run 25538358541) proved that
# Gemini response_schema constrains single-object output reliably (5 errors
# of ~600 calls = 0.83%) but does not constrain list[Model] array output
# (12/13 batch chunks fell back). Per-article only with parallel workers
# gives the same end-to-end throughput as the chunked batch path with a
# clean, single code path.
#
# Throughput model: per-call latency is ~6s, and the filter runs ONE shared
# pool for the whole pass (no per-batch serialization), so sustained
# RPM ~= workers x ~9 calls/min. 50 workers ~= ~450 RPM -> a ~14k pool clears
# in ~31 min, comfortably inside the 90-min pipeline step with room for
# fetch/store, and the 60-min filter budget only trims past ~27k articles. The
# 2026-06-01 probe confirmed the (shared-project) GEMINI_API_KEY sustains
# >=1000 RPM with zero 429s, so 450 RPM stays well under the measured ceiling.
# Validated live at 30 workers / ~272 RPM (same single-pool mechanism); 50 is a
# linear step up, not re-validated live. Env-overridable to tune without redeploy.
FILTER_PARALLEL_WORKERS = int(os.getenv("FILTER_PARALLEL_WORKERS", "50"))
# FILTER_LOG_BATCH_SIZE is a logging cadence (progress line every N completions),
# not a model batch: each article is still one Gemini call.
FILTER_LOG_BATCH_SIZE = 50
# Bounded exponential backoff for transient 429 / RESOURCE_EXHAUSTED. The probe
# saw zero 429s on an isolated key, but the per-project Gemini quota is shared
# with grading / outcome_evaluator / weekly_summary, so a concurrent workflow
# can trigger transient 429s at high filter concurrency. Retry with backoff a
# bounded number of times, then drop-and-log (same contract as a schema drop).
FILTER_MAX_RATE_RETRIES = int(os.getenv("FILTER_MAX_RATE_RETRIES", "5"))
# Explicit prompt-prefix caching for the filter step (FILTER_PROMPT_CACHE).
# DEFAULT OFF: production behaviour is byte-identical to today. When ON, the
# static rubric/schema is reordered to a leading PREFIX and registered ONCE per
# run as an explicit Gemini CachedContent (~90% input discount on the ~3.9k-token
# prefix); the article fields move to the tail. Any cache create/reference
# failure SOFT-FAILS to the uncached reordered prompt and never skips an article.
# This is an LLM byte-order change: it must stay OFF until the offline
# equivalence eval (tools/filter_reorder_eval.py) shows ingest-gate decisions do
# not drift. Not wired into schedule.yml, so merging this leaves prod unchanged.
FILTER_PROMPT_CACHE = os.getenv("FILTER_PROMPT_CACHE", "0").strip().lower() in (
    "1", "true", "yes", "on",
)
# Explicit-cache TTL. The filter phase is bounded by FILTER_PHASE_BUDGET_SEC
# (3600s); 35 min covers a typical ~31-min pass with headroom, then auto-expires
# so a crashed run leaves no lingering cache beyond the TTL.
FILTER_CACHE_TTL_SEC = int(os.getenv("FILTER_CACHE_TTL_SEC", "2100"))
# Wall-clock safety net for the whole filter phase. If the candidate pool ever
# spikes again (the #294 gnews per-ticker fan-out pushed it to ~14k and hung the
# filter past the 90-min step ceiling, freezing the feed because a hard kill
# stores nothing), stop submitting new work past this budget, let in-flight
# calls finish, and proceed with a partial-but-fresh feed. Default 60 min leaves
# ~30 min of step headroom for fetch + store + downstream.
FILTER_PHASE_BUDGET_SEC = int(os.getenv("FILTER_PHASE_BUDGET_SEC", "3600"))
# Wall-clock budget for the WHOLE ingest run (measured from run_ingestion start),
# the store-phase analogue of FILTER_PHASE_BUDGET_SEC. The 06-01 retry cleared
# the filter but then hung in [4/4] store (7,947 of 13,302 stored in 61 min),
# hitting the 90-min kill so run.py's brief steps never ran. Past this budget the
# store stops, keeps what is already written, and returns so the pipeline
# proceeds to synthesize on a partial-but-fresh set. Default 80 min leaves ~10
# min downstream reserve under the 90-min step ceiling. NOTE: post-store
# enrichment + boost_watchlist_relevance still scale with the stored count and
# are not separately budgeted -- the reserve assumes they fit in the remainder.
INGEST_PHASE_BUDGET_SEC = int(os.getenv("INGEST_PHASE_BUDGET_SEC", "4800"))


# Response schema for Gemini constrained output. Smoke test 2 (chunk_size=50)
# saw 12/13 chunks emit malformed JSON despite mime_type=application/json,
# triggering fallback to per-article. response_schema enforces the structure
# at SDK level so model output is guaranteed parseable. Schema fields mirror
# what filter_articles and filter_article python parsers expect.
class CompanyEntity(BaseModel):
    name: str
    entity_type: Literal["company"]


class FilterDecision(BaseModel):
    relevant: bool
    # Floor widened ge=1 -> ge=0 so the re-anchored grader (RELEVANCE_GRADE_MODE)
    # has a true 0 anchor for pure non-market junk. Legacy Flash-Lite never emits 0
    # (its rubric floors at 1), so this widening is behavior-neutral under legacy.
    relevance_score: int = Field(ge=0, le=10)
    relevance_reason: str
    industry_verticals: list[str]
    activity_types: list[str]
    companies: list[CompanyEntity]
    themes: list[str]
    sentiment: Literal["bullish", "bearish", "neutral"]
    sentiment_reason: str
    deal_type: Optional[str] = None
    primary_company: Optional[str] = None


def _fetch_feed_bytes(url: str, timeout: int = RSS_FETCH_TIMEOUT_SEC) -> bytes:
    """Fetch raw RSS/Atom bytes with a hard timeout and identifiable UA.

    Wraps urllib.request.urlopen so feedparser.parse never sees a live
    socket. Without this, feedparser.parse(url) opens its own socket and
    blocks indefinitely on slow servers (the run #98 silent-hang vector).
    Raises urllib.error.URLError / HTTPError / socket.timeout on failure;
    the per-feed try/except in fetch_all_articles catches and continues.
    """
    req = urllib.request.Request(url, headers={"User-Agent": RSS_USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()

# Reuters x3 (feeds.reuters.com is dead, URLError) and Pitchbook (404) removed
# 2026-05-08 after live probe. They contributed zero articles and added per-run
# noise. Replacements TBD; tracked in W2-D backlog.
RSS_FEEDS = {
    "NYT Technology":   "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml",
    "NYT Business":     "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
    "NYT World":        "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    "MarketWatch Top":  "https://feeds.content.dowjones.io/public/rss/mw_topstories",
    "TechCrunch":       "https://techcrunch.com/feed/",
    "FT Tech":          "https://www.ft.com/technology?format=rss",
    "Axios":            "https://www.axios.com/feeds/feed.rss",
    "Bloomberg Tech":   "https://feeds.bloomberg.com/technology/news.rss",
    "Crunchbase News":  "https://news.crunchbase.com/feed/",
    "PE Hub":           "https://www.pehub.com/feed/",
    "Defense News":     "https://www.defensenews.com/arc/outboundfeeds/rss/",
    "Breaking Defense": "https://breakingdefense.com/feed/",
    "C4ISRNET":         "https://www.c4isrnet.com/arc/outboundfeeds/rss/",
    "SEC 8-K":          "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&dateb=&owner=include&count=40&search_text=&output=atom",
    "SEC 10-Q":         "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=10-Q&dateb=&owner=include&count=10&search_text=&output=atom",
    "Federal Reserve":  "https://www.federalreserve.gov/feeds/press_all.xml",
    "PR Newswire":      "https://www.prnewswire.com/rss/news-releases-list.rss",
    "GlobeNewswire":    "https://www.globenewswire.com/RssFeed/subjectcode/01-ABN/feedTitle/All%20Press%20Releases",
}

FULL_TEXT_SOURCES = {"SEC 8-K", "SEC 10-Q", "Federal Reserve"}

# Press wire sources — used for per-wire signal/noise logging in run_ingestion.
WIRE_SOURCES = {"PR Newswire", "GlobeNewswire"}

# Google News per-ticker RSS
GNEWS_PREFIX = "https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q="
GNEWS_ENTRY_CAP = 20
GNEWS_WORKERS = 8

# Single-letter or very common-word tickers that need company name disambiguation
AMBIGUOUS_TICKERS = {
    "A", "B", "C", "D", "F", "G", "K", "L", "M", "O", "R", "T", "U", "V", "X", "Y", "Z",
    "AI", "AN", "AM", "ALL", "ARE", "BIG", "CAN", "CAR", "DD", "DO", "FUN",
    "GO", "HAS", "HE", "IT", "MAN", "MAT", "MET", "NEW", "NOW", "ON",
    "OUT", "OWL", "PAY", "RUN", "SAM", "SEE", "SO", "SUN", "TEN", "TRUE",
    "TWO", "UP", "WAR", "WE", "YOU",
}

# Ticker → company name for disambiguation (populated on first call)
_TICKER_COMPANY_NAMES: dict[str, str] = {}


def _load_ticker_company_names() -> dict[str, str]:
    """Load ticker → company name mapping from companies table (cached)."""
    if _TICKER_COMPANY_NAMES:
        return _TICKER_COMPANY_NAMES
    try:
        resp = supabase.table("companies").select("ticker, name").not_.is_("ticker", "null").execute()
        for row in (resp.data or []):
            t = (row.get("ticker") or "").strip().upper()
            n = (row.get("name") or "").strip()
            if t and n:
                _TICKER_COMPANY_NAMES[t] = n
    except Exception as ex:
        print(f"  gnews: failed to load company names: {ex}")
    return _TICKER_COMPANY_NAMES


def _build_gnews_url(ticker: str) -> str:
    """Build a Google News RSS search URL for a ticker.

    Ambiguous tickers (single letter, common words) get the company name
    appended to reduce noise. Tickers with dots (e.g. BRK.B) use '+'.
    """
    query_parts = [ticker.replace(".", "+")]
    if ticker in AMBIGUOUS_TICKERS:
        names = _load_ticker_company_names()
        company = names.get(ticker)
        if company:
            # Use first two words of company name to disambiguate
            words = company.split()[:2]
            query_parts.extend(words)
    query_parts.append("stock")
    return GNEWS_PREFIX + "+".join(urllib.request.quote(p, safe="") for p in query_parts)


def _get_gnews_tickers() -> list[str]:
    """Return deduplicated ticker list from watchlist + top companies."""
    tickers: set[str] = set()
    try:
        resp = supabase.table("watchlist").select("identifier").eq("type", "ticker").execute()
        for row in (resp.data or []):
            t = (row.get("identifier") or "").strip().upper()
            if t:
                tickers.add(t)
    except Exception as ex:
        print(f"  gnews: watchlist read failed: {ex}")
    try:
        resp = supabase.table("companies").select("ticker").not_.is_("ticker", "null").execute()
        for row in (resp.data or []):
            t = (row.get("ticker") or "").strip().upper()
            if t:
                tickers.add(t)
    except Exception as ex:
        print(f"  gnews: companies read failed: {ex}")
    return sorted(tickers)


def _fetch_single_gnews_feed(ticker: str) -> list[dict]:
    """Fetch and parse one Google News RSS feed for a ticker."""
    url = _build_gnews_url(ticker)
    articles = []
    try:
        raw = _fetch_feed_bytes(url)
        feed = feedparser.parse(raw)
        freshness_cutoff = datetime.now(timezone.utc) - timedelta(days=INGEST_FRESHNESS_DAYS)
        for e in feed.entries[:GNEWS_ENTRY_CAP]:
            link = e.get("link", "")
            title = e.get("title", "")
            if not link or not title:
                continue
            # Missing date stays NULL: never now-stamp a date-less item, or a
            # stale story masquerades as fresh (articles has no created_at; the
            # true ingest time lives in ingested_at, defaulted by the DB).
            published_at = e.get("published") or None
            # Skip articles older than INGEST_FRESHNESS_DAYS. Mirrors the main
            # RSS loop: if the date is missing or unparseable, let it through.
            if published_at:
                try:
                    pub_dt = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
                    if pub_dt < freshness_cutoff:
                        continue
                except Exception:
                    pass  # if parsing fails, let the entry through
            raw_summary = strip_html(e.get("summary", e.get("description", "")))[:500]
            # Detect the headline echo on the RAW title (where the summary still
            # matches the full title text incl. publisher) BEFORE cleaning strips
            # the " - Publisher" suffix, then store the cleaned title and empty the
            # echo summary so the frontend renders its "Headline only" note
            # (defect #4 data half) instead of echoing the title back.
            echo = _is_headline_echo(raw_summary, title)
            articles.append({
                "title": _clean_gnews_title(title),
                "summary": "" if echo else raw_summary,
                "url": link,
                "source": f"Google News ({ticker})",
                "published_at": published_at,
                "content_type": "snippet",
            })
    except Exception as ex:
        print(f"  gnews: fetch failed for {ticker}: {ex}")
    return articles


def fetch_gnews_per_ticker_feeds() -> tuple[list[dict], dict[str, dict[str, int]]]:
    """Fetch Google News RSS for all watchlist+company tickers in parallel.

    Returns (articles, gnews_stats) where gnews_stats maps
    ticker → {"fetched": N} for funnel logging.
    """
    tickers = _get_gnews_tickers()
    if not tickers:
        print("  gnews: 0 tickers found, skipping")
        return [], {}

    print(f"  gnews: fetching {len(tickers)} tickers with {GNEWS_WORKERS} workers...")
    t0 = time.time()
    all_articles: list[dict] = []
    gnews_stats: dict[str, dict[str, int]] = {}

    with concurrent.futures.ThreadPoolExecutor(max_workers=GNEWS_WORKERS) as pool:
        future_to_ticker = {pool.submit(_fetch_single_gnews_feed, t): t for t in tickers}
        for future in concurrent.futures.as_completed(future_to_ticker):
            ticker = future_to_ticker[future]
            try:
                result = future.result()
                gnews_stats[ticker] = {"fetched": len(result)}
                all_articles.extend(result)
            except Exception as ex:
                print(f"  gnews: worker error for {ticker}: {ex}")
                gnews_stats[ticker] = {"fetched": 0}

    elapsed = time.time() - t0
    print(f"  gnews: {len(all_articles)} articles from {len(tickers)} tickers in {elapsed:.1f}s")
    return all_articles, gnews_stats


INDUSTRY_VERTICALS = [
    "Technology",
    "Healthcare & Biotech",
    "Energy & Oil/Gas",
    "Financial Services",
    "Consumer & Retail",
    "Industrials & Manufacturing",
    "Aerospace & Defense",
    "Real Estate",
    "Media & Telecom",
    "Materials & Mining",
    "Agriculture",
]

ACTIVITY_TYPES = [
    "Mergers & Acquisitions",
    "Private Equity",
    "Venture Capital",
    "IPO & Capital Markets",
    "Earnings & Results",
    "Macro & Policy",
    "Geopolitics",
    "Regulation & Legal",
    "Fundraising",
    "Crypto & Digital Assets",
    "Leadership & Operations",
]


def validate_tags(tags, whitelist: list, max_count: int = 3) -> list:
    """Validate tags against a whitelist and cap at max_count.

    Robust to LLMs that return a bare string, a list containing
    comma-concatenated elements (e.g. ["Technology, Financial Services"]),
    or mixed-case / padded values. Every input is split on commas and each
    piece must match an entry in the whitelist character-for-character
    (after stripping surrounding whitespace). Anything that doesn't match
    is dropped; duplicates are removed preserving first-seen order.
    """
    if isinstance(tags, str):
        tags = [tags]
    if not isinstance(tags, list):
        return []

    whitelist_set = set(whitelist)
    result: list = []
    seen: set = set()
    for raw in tags:
        if not isinstance(raw, str):
            continue
        for piece in raw.split(","):
            t = piece.strip()
            if t and t in whitelist_set and t not in seen:
                seen.add(t)
                result.append(t)
                if len(result) >= max_count:
                    return result
    return result

FILTER_PROMPT = """You are a senior analyst at a top investment firm. Analyze this article and determine its relevance to financial markets and investing.

CRITICAL CLASSIFICATION RULE (apply before everything below): Analyst-driven coverage -- price-target changes (raised or cut), upgrades, downgrades, rating initiations or reiterations, "should you buy/sell/hold X" framing, 'Best ___ Stocks' listicles, and opinion/Cramer-style commentary -- is NOT a first-order company event. For ANY such article, sentiment MUST be "neutral" and deal_type MUST be "Other", no matter how bullish or bearish the analyst or author sounds. Anchor sentiment ONLY on a named first-order event reported by the company itself.

Article Title: {title}
Summary: {summary}
Source: {source}

Relevant topics include: M&A deals, IPOs, fundraising, valuations, earnings, market movements, geopolitical events affecting markets, macro trends, regulatory changes, PE/VC activity, public company news, economic data.

INDUSTRY_VERTICALS (required): Return a JSON array of 1-3 values from this exact list — the industry sector(s) the companies or subjects in this article operate in. Copy values character-for-character. Return [] if none clearly apply.
Allowed values: Technology, Healthcare & Biotech, Energy & Oil/Gas, Financial Services, Consumer & Retail, Industrials & Manufacturing, Aerospace & Defense, Real Estate, Media & Telecom, Materials & Mining, Agriculture

ACTIVITY_TYPES (optional): Return a JSON array of 0-3 values from this exact list — the type of event or activity the article covers. Copy values character-for-character. Return [] if none clearly apply.
Allowed values: Mergers & Acquisitions, Private Equity, Venture Capital, IPO & Capital Markets, Earnings & Results, Macro & Policy, Geopolitics, Regulation & Legal, Fundraising, Crypto & Digital Assets, Leadership & Operations

COMPANIES (required): Return a JSON array of entity objects. Each object must have exactly two fields: "name" (the entity name, verbatim from the title or summary) and "entity_type" (must be the string "company" — see definition below). Only include entities where you are confident entity_type is "company". Default to exclusion when uncertain.

COMPANY definition: A for-profit or non-profit private organization, publicly traded corporation, startup, or financial institution that has employees, operates a business, and would have a LinkedIn company page.

EXCLUDE — never include an entity that falls into any of these categories:
- Individual people, executives, politicians, or named persons (e.g. "Elon Musk", "Xi Jinping", "Trump")
- Countries, nation-states, territories, or regions (e.g. "China", "Iran", "Vietnam", "Greece")
- Government agencies, regulatory bodies, courts, or military branches (e.g. "NASA", "FAA", "Pentagon", "Space Force", "U.S. Navy", "Federal Reserve", "SEC", "DOJ")
- Currencies or crypto assets (e.g. "Bitcoin", "Ethereum", "USD")
- Stock market indexes (e.g. "S&P 500", "Nifty 50", "Nasdaq", "Sensex")
- Abstract noun phrases describing a concept, trend, or group rather than a named organization (e.g. "Ukrainian drone makers", "Russia's energy sector", "Foundation AI model for plants", "Candy stocks")
- Software products, AI models, or platforms — include the company that owns them, not the product (e.g. use "OpenAI" not "ChatGPT"; use "Anthropic" not "Claude"; use "Microsoft" not "Windows")
- Named investment vehicles, SPVs, trusts, or sovereign wealth funds (e.g. "Blackstone Digital Infrastructure Trust", "Abu Dhabi Investment Authority", "GIC") — use the parent firm ("Blackstone") if it is the primary actor
- Political parties, religious institutions, advocacy organizations (e.g. "Republican Party", "Heritage Foundation")

Good examples: "Nvidia invests in Marvell" → [{{"name": "Nvidia", "entity_type": "company"}}, {{"name": "Marvell", "entity_type": "company"}}]. "Goldman leads Apple bond offering" → [{{"name": "Goldman Sachs", "entity_type": "company"}}, {{"name": "Apple", "entity_type": "company"}}]. "Fed raises rates amid China tension" → [] (no companies — Fed is a government body, China is a country). Return [] when no entities pass the definition.

Respond ONLY in valid JSON:
{{
  "relevant": true/false,
  "relevance_score": "Integer 1-10 measuring this article's first-order market-signal value about the primary_company. Apply in two steps. STEP 1 -- LOW-TEMPLATE OVERRIDE (check FIRST; if ANY match, score 1-3 and STOP, regardless of any company, sector, or analyst named -- a LOW match ALWAYS overrides a company/sector/analyst mention): aggregator listicles and templated headlines ('N reasons to buy/sell X', 'Best <X> stocks to buy', 'X is a trending stock', 'Should you buy/sell/hold X', 'Is X the best stock to buy according to analysts', 'Prediction: ...', 'you will wish you bought'); named-pundit opinion or hot takes (e.g. Jim Cramer commentary) even when referencing a real event; ETF/index commentary with no first-order event (fund-vs-fund comparisons, 'is it a buy', 'ETF up/down X% today', 'will the S&P open up or down'); algorithmic or technical-analysis content (pivot points, 'trading systems reacting to', price forecasts, 'trading performance and risk management'); generic market-direction opinion or doom/forecast takes ('market could crash', 'playing with fire', 'turn everything upside down'); routine insider equity or RSU grant notices ('director granted/receives/awarded N shares/RSUs', routine Rule 10b5-1 sales); structured-product notices (autocallable or linked notes, coupon products); aggregator filing-rehash and historical-data pages ('10K Form and Latest SEC Filings', historical price tables); law-firm securities-lawsuit solicitation PR ('investors have opportunity to lead', 'lead plaintiff', class-action solicitation); pure non-market news with no economy/market/company/sector hook; tenuous or mis-tagged company ties where the named ticker is incidental. When a headline is ambiguous or borderline, DEFAULT to LOW (1-3), not 6. STEP 2 -- if NOT a LOW-template item, score by first-order fit: 10 = direct, material, company-specific first-order event (earnings result with named figures, product launch with named revenue or contract value, M&A with the company as named acquirer or target, named leadership change tied to strategy, named regulatory action against the company, IPO pricing or filing). 8-9 = significant first-order event with partial detail (a 10-anchor event lacking concrete figures or named parties = 9; sector trend with the company as named exemplar, partnership where the company is one of several named parties, or peer-group earnings read-through explicitly citing the company = 8). 6-7 = a genuine ANALYST ACTION (a named firm issuing or changing a rating, an initiation, an upgrade or downgrade, or a price-target change -- e.g. 'UBS raises Oracle price target', 'Jefferies initiates Buy on TeraWulf', 'Goldman downgrades X'): relevant but SECONDARY, score 6-7, NEVER 8-10; distinguish sharply from analyst-CITING listicles, which are LOW per Step 1. Also 6-7: a factual daily market/index context recap -- a session summary such as 'Dow, S&P 500 and Nasdaq moved higher' or 'stocks closed lower' -- which is RELEVANT (>=6). Below 6 (1-5) = a LOW-template item (Step 1) or an article with no first-order event; the >=6 ingest gate drops these. Use the full range and do not default to round numbers; score first-order signal value, not headline excitement.",
  "relevance_reason": "GATE — apply before writing: If this article is primarily an opinion piece, profile, cultural commentary, or trend piece with no named transaction, earnings result, financing event, guidance change, regulatory action, or specific market-moving event — set relevant: false and leave this field as an empty string. Do not fabricate a read-through. Articles discussing a named person's political views, cultural influence, public commentary, or personal philosophy are not market-moving events even if that person runs a public or private company — set relevant: false. Internal staff promotions, appointments, hires, or departures are not market-moving events unless the article explicitly links the change to a named transaction, fundraising event, earnings event, guidance change, or regulatory action — if no such link exists, set relevant: false. For articles that pass the gate: 1-2 sentences max. Lead with the concrete market implication — the named deal, specific dollar figure, rate level, or event — not a description of what happened. Only name comp companies or sector read-throughs if the mechanism directly follows from what this article reports; do not append a comp list just to fill the format. Use specific company names, dollar figures, or named sectors where available. BANNED outputs — never write these: vague taxonomy ('this is relevant to PE / VC / financial markets / investing'), article restatements that just paraphrase the headline, fabricated comp lists, filler like 'this matters because it is a transaction in private equity'. For macro or rates articles, state the concrete effect on deal economics — LBO spreads, floating-rate credit costs, buyout multiples, M&A financing conditions, or risk appetite for new deals — never write that rates moved, banks are impacted, or that interest rates affect markets generally. Write as a buy-side analyst flagging a signal to a portfolio manager.",
  "industry_verticals": ["<1-3 values from the allowed industry verticals list above>"],
  "activity_types": ["<0-3 values from the allowed activity types list above>"],
  "companies": [{{"name": "Company A", "entity_type": "company"}}],
  "themes": ["M&A", "IPO", "Earnings", "Macro", "Geopolitics", "VC", "PE", "Regulation", "AI", "Crypto"],
  "sentiment": "Classify the FIRST-ORDER EVENT TONE for the company that is the article's primary subject — NOT the stock-price reaction, NOT the editorial framing, NOT the analyst's recommendation. Apply this frame strictly: bullish (the event itself is materially positive for the company's fundamentals — beat guidance, raised guidance, won a contract, closed a positive M&A as the named beneficiary, received funding, favorable regulatory ruling, successful product launch with named revenue impact; EXCLUDES third-party investor activity, where an outside individual, fund, or firm discloses a stake in the company — that is market signal, not a first-order company event, and defaults to neutral), bearish (the event itself is materially negative for the company's fundamentals — missed guidance, cut guidance, lost a contract, named in adverse regulatory action, downgraded by official body, product failure with named cost, departure of named executive amid scandal, downward revision of revenue or EPS), neutral (the event is informational, procedural, or scheduling — earnings-date announcement, routine personnel move, partnership announcement with no named financial impact, market commentary, sector outlook, macro report with no company-specific implication, analyst note, opinion piece). Hard rules: (a) NEVER anchor on the stock-price reaction — 'stock recovered 5%' or 'stock crashed 13%' is NOT the signal; the underlying event is. Example: 'GE HealthCare crashed 13% on guidance cut — buy the dip' is BEARISH (guidance cut is the event). 'Airbus missed earnings and the stock is up' is BEARISH (missing earnings is the event). (b) NEVER anchor on the analyst's recommendation or the article's editorial framing. 'Why IONQ Stock Owns The Quantum Runway' is NEUTRAL unless IONQ itself reported a named positive event in the article. (c) For articles with no clear company-specific first-order event (commentary, macro pieces, sector outlooks), default to neutral. (d) For articles with mixed first-order signals (e.g. revenue beat + guidance miss), choose the direction of the largest named first-order item; if genuinely co-equal, choose neutral.",
  "sentiment_reason": "ONE short sentence (max 25 words) naming the specific event(s) you anchored sentiment on. Always lead with the named event, not the company. Examples: 'Guidance cut from $2.40 to $2.10 for Q3' (bearish). 'Closed acquisition of Foundry at $1.2B as named beneficiary' (bullish). 'Earnings-date announcement, no results disclosed' (neutral). 'Analyst opinion piece, no company-specific event' (neutral). For neutral with no event, write 'no first-order company event'.",
  "deal_type": "Classify as exactly one of these — apply the first definition that matches: M&A (a named buyer and a named target are identified for a single specific transaction. Sector-level deal-volume reports, league tables, and 'deals are up/down X%' stories are Macro or Other, not M&A.), IPO (a specific named operating company is going public via a primary listing. ETF launches, fund registrations, closed-end fund IPOs, secondary offerings, and SPAC over-allotment exercises after the initial listing are Other, not IPO. SPAC initial listings are IPO; subsequent de-SPAC merger announcements are M&A.), Funding (a named company is receiving investment capital — a venture round, private equity investment, debt financing, or fundraising raise; the company receiving the money determines the type), Joint-venture disambiguator (a JV is NOT its own deal_type value — always remap to one of Funding, M&A, or Other based on framing): if the article frames the JV as an investment INTO a named company that will operate as a new entity (capital flowing into a new joint vehicle), use Funding. If the article frames it as a combination of operating businesses, use M&A. If purely a commercial / sales partnership with no equity, use Other. Default to Funding when ambiguous. Earnings (ONLY a company's own officially reported financial results: revenue figures, EPS, net income, or forward guidance issued as part of a formal results announcement that has already happened. Hard exclusions, all of which map to Other: (a) pre-earnings previews, expectations, 'What's in the Offing', 'What to expect from Q__', 'Q__ Earnings: What Key Metrics Have to Say'; (b) earnings-date scheduling press releases such as 'to Report Q__ Earnings on [date]'; (c) analyst recommendations, price-target changes, upgrades, downgrades, ratings reiterations, listicles such as 'Best ___ Stocks to Buy'; (d) post-earnings opinion or thesis pieces from SeekingAlpha-style outlets that argue a buy / sell case rather than report fresh results. If the article is dated AFTER the company's most recent results and contains specific quoted EPS, revenue, or guidance numbers, label Earnings. Otherwise label Other.), Macro (central bank decisions, interest rate policy, inflation data, GDP, tariff or trade policy affecting broad markets — not specific to one company), Geopolitical (wars, sanctions, elections, cross-border disputes with market impact), Other (regulatory action, product launch, contract award, partnership announcement, legal settlement, personnel change, analyst note, market commentary — use this as a catch-all for anything that does not clearly fit the above). Return null only if the article is so general it fits none of these. Default to Other over null.",
  "primary_company": "The single company that is the MAIN ACTOR of the event this article covers — the company doing the action, not a company that is merely named or mentioned. Apply these rules in order: (1) Funding/IPO: primary_company is the company RECEIVING the investment or going public — not the investor, not a chip or technology supplier the article mentions, not a competitor named for comparison. Example: 'Mistral raises $830M to house Nvidia chips' → primary_company is Mistral, not Nvidia. (2) M&A: primary_company is the acquirer or the acquisition target — whichever is the article's central subject. Example: 'Goldman leads buyout of PortfolioCo' → primary_company is PortfolioCo (the target), not Goldman (the advisor). (3) Earnings: primary_company is the company that issued the results. (4) Commentary or market opinion: if a company's employee, analyst, or executive is quoted giving views on markets, sectors, or other companies — but the article is NOT about that company's own named event — return null. Example: 'Goldman's analyst recommends semiconductors' → null. (5) When one company is clearly driving the event and others are mentioned incidentally as suppliers, partners, advisors, or comparisons, always name the driving company. Return null only when two or more companies are genuinely co-equal actors with no single driver (e.g. a true joint venture announced by both parties equally). Never invent a name not present in the companies array. Reject and return null if the candidate primary_company is: (a) a descriptive phrase such as 'one AI chip stock', 'the company behind X', 'a Saudi delivery app'; (b) a placeholder such as 'NewCo', 'TargetCo', 'Company A'; (c) a possessive descriptor such as 'Kevin Hart's media company'; (d) a number-plus-noun headline pattern such as '1 AI Stock'; (e) a name composed only of a generic noun and an industry word."
}}"""


# ---------------------------------------------------------------------------
# Cacheable reorder of FILTER_PROMPT (used only when FILTER_PROMPT_CACHE is ON).
# The original puts the variable article fields in the MIDDLE, so the ~3.9k-token
# static rubric/schema is a SUFFIX and nothing is cacheable. We mechanically
# RELOCATE the fields block to the very END, leaving the static rubric/schema as
# a byte-identical leading PREFIX. Only byte-order changes; the text is identical
# (verified: the non-field body is character-for-character the same as
# FILTER_PROMPT). The derivation below is intentionally string surgery on the one
# source-of-truth FILTER_PROMPT, never a hand-retyped copy, so the two orderings
# can never drift in wording.
_FILTER_FIELDS_MIDDLE = "Article Title: {title}\nSummary: {summary}\nSource: {source}\n\n"
_FILTER_FIELDS_TAIL = "\n\nArticle Title: {title}\nSummary: {summary}\nSource: {source}\n"
_FILTER_STATIC_BODY_TMPL = FILTER_PROMPT.replace(_FILTER_FIELDS_MIDDLE, "", 1).rstrip("\n")
# Reordered template (fields appended at the end). Used as the uncached soft-fail
# prompt and to derive the cached prefix.
FILTER_PROMPT_REORDERED = _FILTER_STATIC_BODY_TMPL + _FILTER_FIELDS_TAIL
# Rendered static prefix (the schema's {{ }} collapse to { }) for the explicit
# cache CONTENTS. Equals the leading slice of FILTER_PROMPT_REORDERED.format(...)
# that precedes the article fields, so cache(prefix) + request(fields tail)
# reconstructs the uncached reordered prompt exactly.
_FILTER_STATIC_PREFIX = _FILTER_STATIC_BODY_TMPL.replace("{{", "{").replace("}}", "}")

# Fail loud at import if the relocation ever stops being text-preserving (e.g.
# FILTER_PROMPT is edited and the fields-block marker drifts): the fields block
# must be found and removed exactly once, and the reordered template must split
# cleanly into the cached prefix plus the formatted fields tail.
assert _FILTER_STATIC_BODY_TMPL.count("Article Title:") == 0, (
    "FILTER_PROMPT reorder: fields block not found in its expected middle position"
)
assert FILTER_PROMPT_REORDERED.format(title="", summary="", source="") == (
    _FILTER_STATIC_PREFIX + _FILTER_FIELDS_TAIL.format(title="", summary="", source="")
), "FILTER_PROMPT reorder: cached prefix + fields tail does not reconstruct the reordered prompt"


# ---------------------------------------------------------------------------
# Re-anchored relevance grader (RELEVANCE_GRADE_MODE). Single-axis 0-10 grade with
# format-first template demotion + concrete corpus-drawn bands + a true 0 floor.
# Validated offline on gemini-2.5-flash (docs/recon/relevance-recalibration.md):
# stdev 1.04 -> 2.92, >=8 share 96% -> 15%, exact-10 41% -> 0.8% (10 stays RARE,
# reserved for exceptional first-order news), genuine first-order news retained at
# 6-10. Returns {score, band, reason}; the other FilterDecision fields (sentiment,
# companies, deal_type, etc.) are produced by the legacy FILTER_PROMPT and are NOT
# re-graded here. Keep this text in sync with the offline harness NEW_PROMPT.
# ---------------------------------------------------------------------------
RELEVANCE_GRADE_PROMPT = """You are a buy-side analyst triaging a firehose of financial news. Score how much GENUINE, FIRST-ORDER, MARKET-MOVING SIGNAL this single article carries. A high score must be EARNED by substance and materiality, not by merely naming a real company or a real ticker. Headline-only is NOT disqualifying; a terse wire headline that reports a concrete material event still scores high. The discriminator is SUBSTANCE, not completeness.

Article Title: {title}
Source: {source}
Summary: {summary}

Score on a 0-10 integer scale using these BANDS. Walk them top-down and assign the FIRST band the article clearly fits.

STEP 1 - TEMPLATE / AGGREGATOR DEMOTION (check FIRST). If the article is any of the following, it scores 0-2 NO MATTER WHAT company, deal, or figure it names. These are SEO/aggregator/opinion formats with near-zero independent signal:
- Price-move recaps that exist only to narrate a move: "Why X stock is up/down/trading up/popped/surged/crashed/rocketing today", "Why X outpaced the market today", "Why did X just crash".
- Buy/sell/hold listicles and screeners: "Is X a good stock to buy now", "Should you buy/sell/hold X", "N reasons to buy/sell X", "Best <sector> stocks to buy", "X is a trending stock", "Prediction: ...".
- Named-pundit opinion / hot takes (Cramer, "Chamath flags ...", "8 stocks to watch").
- 13D/13F/13G stake-disclosure rehashes, insider RSU/Rule 10b5-1 grant notices, AUM-update blurbs ("X's May AUM increases").
- Algorithmic / technical-analysis content (pivot points, price forecasts, "trading systems reacting").
- ETF/index "is it a buy" or "ETF up/down X% today" commentary with no first-order event.
- Law-firm class-action solicitation, autocallable/structured-note notices, filing-rehash/historical-price pages.
Even if such an article mentions a real event (e.g. "Why X popped today - on an Eli Lilly partnership"), the FORMAT is an aggregator recap, so it stays 0-2. The underlying event, if material, will arrive as its own first-order wire story which is what we want to score high.

STEP 2 - if NOT demoted by Step 1, score by first-order materiality:
9-10 = MATERIAL, NOVEL, COMPANY-SPECIFIC FIRST-ORDER EVENT reported as news: M&A with a named acquirer AND target ("LongRange to acquire Pizza Hut for $1.2bn"), IPO pricing/filing/debut with named size (a CONFIRMED IPO that has PRICED, is imminently pricing, or has set a record size is real first-order news even if the listing has not opened yet - "Applied A&D to raise $650M in US IPO", "Company prices $75bn IPO, largest of all time"), earnings RESULT with named figures or a record/miss ("Nvidia posts record quarter, reveals $43B holdings"), a named financing round into a named company ("Boyne Capital backs Local Boys Outfitters"), guidance raise/cut with figures, a named regulatory action against the company, a named major contract/product launch with revenue or contract value, a market-structurally significant macro/geopolitical shock with concrete levels ("oil drops below $108 after Trump Iran remarks").
RESERVE 10 for the genuinely EXCEPTIONAL and unambiguous: a major M&A or financing with hard figures, a record print or record-setting raise, a clearly market-moving macro or geopolitical shock with concrete levels. 10 must stay RARE - if the item is material but routine-material, or its figures/parties are partial, score 9, not 10.
6-8 = REAL BUT SECONDARY or PARTIAL signal: a genuine analyst ACTION by a named firm (initiation, upgrade, downgrade, price-target change - "UBS raises Oracle PT") scores 6-7 and NEVER higher; a first-order event named but missing concrete figures/parties scores 7-8; a factual daily market/index session recap ("Dow and Nasdaq closed higher") scores 6; a sector trend citing the company as a named exemplar scores 7.
3-5 = WEAK signal: a real but routine/procedural item (earnings-date scheduling, routine partnership with no figures, minor personnel move), or a first-order event so thinly sourced or tangential the market would not act on it.
0-2 = Step-1 template/aggregator/opinion content, OR pure non-market news, OR a tenuous/mis-tagged company tie where the ticker is incidental.

Do NOT cluster on round numbers. Use the full range. Most aggregator and gnews-outlet items SHOULD land 0-5; reserve 9-10 for genuinely material first-order news and 10 for the exceptional. Score signal, not headline excitement.

Return JSON: {{"score": <int 0-10>, "band": "<one of: material_first_order|secondary_partial|weak|template_demoted>", "reason": "<max 20 words: name the concrete event you scored on, or the template pattern you demoted on>"}}"""


_RELEVANCE_BANDS = (
    "material_first_order",
    "secondary_partial",
    "weak",
    "template_demoted",
)


class RelevanceGrade(BaseModel):
    score: int = Field(ge=0, le=10)
    band: Literal["material_first_order", "secondary_partial", "weak", "template_demoted"]
    reason: str


def _clamp_relevance_score(value) -> Optional[int]:
    """Coerce a model-returned score to an int in [0, 10], or None if unparseable.

    Guards the re-anchored grader against out-of-range or non-integer output the
    response_schema did not fully constrain (e.g. a float, a numeric string, or a
    value past the ceiling). Returns None on anything that is not a finite number
    so the caller can fall back to the legacy grade rather than store garbage."""
    try:
        n = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    return max(0, min(10, n))


def grade_relevance(article):
    """Run the re-anchored relevance grader on one article (gemini-2.5-flash,
    thinking_budget=0). Returns {"score": int, "band": str, "reason": str} with the
    score clamped to [0, 10], or None on failure (caller falls back to legacy).

    This is intentionally SEPARATE from filter_article: it re-grades ONLY the
    relevance number; sentiment/companies/deal_type stay on the legacy classifier."""
    prompt = RELEVANCE_GRADE_PROMPT.format(
        title=article["title"],
        summary=(article.get("summary") or "")[:600],
        source=article["source"],
    )

    def _call():
        return gemini_client.models.generate_content(
            model=RELEVANCE_GRADE_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.2,
                max_output_tokens=2048,
                thinking_config=types.ThinkingConfig(thinking_budget=0),
                response_mime_type="application/json",
                response_schema=RelevanceGrade,
            ),
        )

    delay = 1.0
    for attempt in range(FILTER_MAX_RATE_RETRIES + 1):
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as _ex:
                response = _ex.submit(_call).result(timeout=30)
            _accumulate_filter_usage(response)
            accumulate_gemini_usage("shadow_grader", RELEVANCE_GRADE_MODEL, response)
            text = (response.text or "").strip()
            if text.startswith("```"):
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:]
            parsed = json.loads(text.strip())
            score = _clamp_relevance_score(parsed.get("score"))
            if score is None:
                print(f"  [relevance-grade] unparseable score {parsed.get('score')!r}, dropping")
                return None
            band = parsed.get("band")
            if band not in _RELEVANCE_BANDS:
                band = "unknown"
            return {"score": score, "band": band, "reason": (parsed.get("reason") or "")[:200]}
        except Exception as ex:
            if _is_rate_limit_error(ex) and attempt < FILTER_MAX_RATE_RETRIES:
                sleep_s = min(delay, 30.0) + random.uniform(0, 0.5)
                print(
                    f"  [relevance-grade:rate-limit] backoff {sleep_s:.1f}s "
                    f"(attempt {attempt + 1}/{FILTER_MAX_RATE_RETRIES})"
                )
                time.sleep(sleep_s)
                delay *= 2
                continue
            print(f"  [relevance-grade] error: {ex}")
            return None


def apply_relevance_grade(article, result):
    """Apply RELEVANCE_GRADE_MODE to one (article, legacy_result) pair IN PLACE.

    Called once per article AFTER the legacy filter decision is known and BEFORE
    the ingest gate. `result` is the legacy FilterDecision dict (or None). Behavior
    by mode:
      legacy -> no-op. Legacy relevance_score is authoritative.
      shadow -> legacy score STAYS authoritative; for a sampled fraction of
                LLM-graded (non-SEC) articles, also compute the new grade and log
                RELEVANCE_GRADE_SHADOW. Mutates nothing on `result`.
      new    -> overwrite result["relevance_score"] with the new grade (falls back
                to the legacy score if the grader fails).

    Returns `result` (possibly mutated under `new`). SEC-bypassed results carry a
    deterministic relevance_reason marker and are never re-graded (they never hit
    the LLM and their scores are pinned by item code)."""
    if result is None or RELEVANCE_GRADE_MODE == "legacy":
        return result

    is_sec = "deterministic SEC bypass" in (result.get("relevance_reason") or "")

    if RELEVANCE_GRADE_MODE == "shadow":
        if is_sec:
            return result
        if random.random() >= RELEVANCE_GRADE_SHADOW_SAMPLE_RATE:
            return result
        grade = grade_relevance(article)
        if grade is not None:
            print(
                "  RELEVANCE_GRADE_SHADOW "
                f"id={article.get('url', '')[:80]!r} "
                f"legacy={result.get('relevance_score')} new={grade['score']} "
                f"band={grade['band']} "
                f"title={(article.get('title') or '')[:100]!r}"
            )
        return result

    # new: the re-anchored grade becomes authoritative. SEC stays deterministic.
    if is_sec:
        return result
    # Cost guard: a not-relevant article is dropped by the ingest gate on its
    # `relevant` flag (which grade_relevance never changes), regardless of its
    # score, so re-grading it is wasted spend that no consumer reads. Skipping it
    # keeps the stored set and every stored score identical. Default OFF.
    if GRADER_SKIP_IRRELEVANT and not result.get("relevant"):
        return result
    grade = grade_relevance(article)
    if grade is not None:
        result["relevance_score"] = grade["score"]
        result["relevance_band"] = grade["band"]
    return result


# ---------------------------------------------------------------------------
# Entity quality gate — blocks currencies, countries, government bodies,
# and law firms from being written to the companies / company_mentions tables.
# ---------------------------------------------------------------------------

_CURRENCY_BLOCKLIST = {
    "bitcoin", "ethereum", "usd", "btc", "eth", "usdc", "usdt", "crypto",
    "tether", "ripple", "solana", "dogecoin", "litecoin", "binance coin",
    "binance", "eur", "gbp", "yuan", "yen", "cny", "jpy", "euro",
}

_COUNTRY_BLOCKLIST = {
    "iran", "china", "russia", "usa", "united states", "united states of america",
    "uk", "united kingdom", "israel", "north korea", "south korea", "germany",
    "france", "japan", "india", "brazil", "australia", "canada", "mexico",
    "turkey", "saudi arabia", "ukraine", "taiwan", "pakistan", "egypt",
    "indonesia", "nigeria", "south africa", "argentina",
}

_GOV_SUBSTRINGS = [
    "department of", "ministry of", "federal reserve", "sec ", "the sec",
    "congress", "senate", "white house", "pentagon",
    "european union", "world bank",
    "department of justice", "department of defense", "u.s. army",
    "u.s. navy", "u.s. air force", "treasury department",
    "internal revenue", "federal bureau",
    "securities and exchange commission",
    "federal trade commission",
    "federal deposit insurance",
    "consumer financial protection",
    "international monetary fund",
    "european commission",
    "european central bank",
    "bank of england",
    "bank of japan",
    "bank of canada",
    "reserve bank of",
]

_GOV_ACRONYM_RE = re.compile(r"\b(cia|imf|nato|doj|fbi|fda|ftc|cfpb|cftc|finra|fdic|occ|nasa|faa)\b")

_LAW_SUBSTRINGS = [
    "law offices of", "law office of", " llp", " & associates",
    "attorneys at law", "legal group", "law group", " p.c.", " pllc",
    "law firm", "legal counsel",
]

# Media outlets / financial-news aggregators that the relevance filter sometimes
# extracts as a "company" because their name appears in the headline (e.g. the
# "- Yahoo Finance" / "- Seeking Alpha" gnews title suffix). These are NOT the
# subject company and must never reach company_mentions. Matched by NORMALIZED
# EXACT name only (see _normalize_outlet) so a real company whose name merely
# contains a blocklisted token is never stripped. Every entry was verified to
# NOT collide with a real ticker / public-company name / watchlist identifier.
_OUTLET_BLOCKLIST_RAW = {
    "Yahoo Finance", "Yahoo", "Yahoo! Finance",
    "Seeking Alpha", "TradingView", "Stock Titan",
    "The Motley Fool", "Motley Fool", "The Motley Fool Australia",
    "GuruFocus", "Quiver Quantitative", "MarketBeat",
    "24/7 Wall St", "24/7 Wall St.", "Benzinga", "Statista",
    "Insider Monkey", "Stock Traders Daily", "Investing.com",
    "Business Wire", "BusinessWire", "PR Newswire", "PRNewswire",
    "GlobeNewswire", "Simply Wall St", "Simply Wall St.", "SimplyWall.st",
    "Trefis", "Moomoo",
}


def _normalize_outlet(name: str) -> str:
    """Lowercase, drop punctuation, collapse whitespace -- so 'Yahoo! Finance',
    '24/7 Wall St.' and 'Investing.com' match their blocklist entries exactly."""
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", "", (name or "").lower())).strip()


_OUTLET_BLOCKLIST = {_normalize_outlet(x) for x in _OUTLET_BLOCKLIST_RAW}


def is_blocked_entity(name: str) -> bool:
    """Return True if the entity name is a currency, country, government body,
    law firm, or media outlet/aggregator that should not be written to the
    companies table."""
    low = name.lower().strip()
    if low in _CURRENCY_BLOCKLIST:
        return True
    if low in _COUNTRY_BLOCKLIST:
        return True
    if _GOV_ACRONYM_RE.search(low):
        return True
    for pat in _GOV_SUBSTRINGS:
        if pat in low:
            return True
    for pat in _LAW_SUBSTRINGS:
        if pat in low:
            return True
    if _normalize_outlet(name) in _OUTLET_BLOCKLIST:
        return True
    return False


# ---------------------------------------------------------------------------
# Ingest keyword blocklist — pre-filters articles before Gemini batch scoring
# to avoid wasting API tokens on class-action / law-firm PRs.
# ---------------------------------------------------------------------------

_INGEST_KEYWORD_BLOCKLIST = (
    # Class-action and shareholder lawsuit boilerplate
    "securities class action",
    "class action lawsuit",
    "shareholder lawsuit",
    "lead plaintiff deadline",
    "lead plaintiff",
    "remind investors",
    "encourages investors to contact",
    "securities fraud investigation",
    "loss recovery",
    "no cost to investors",
    # Investigation announcement boilerplate
    "announces investigation into",
    "filing deadline",
)

# Pruned/tightened phrase set used by the "new" matcher. Derived from the #379
# skip-log attribution (14 pipeline runs, 99 unique blocked titles, solo-match
# analysis where solo means removing the phrase would unblock the article):
#   - "loss recovery": 0 fires, 0 solo -> REMOVED (over-broad, no demonstrated value).
#   - "filing deadline": 1 solo, and it was a LEGITIMATE article ("A warrant
#     accounting issue pushes AMC Robotics past its SEC filing deadline") -> REMOVED.
#     Lawsuit-deadline spam stays caught by "lead plaintiff deadline" / the
#     "securities class action" family.
#   - "announces investigation into": 1 solo, a law-firm merger-objection PR
#     ("Kaskela Law Firm Announces Investigation into Fairness of ...") -> TIGHTENED
#     to "announces investigation into fairness" so legitimate corporate
#     "announces investigation into <incident>" disclosures are no longer blocked.
# Every other phrase is unchanged. The tightened phrase is a superstring of the
# legacy one and word-boundary is a subset of substring, so the new matcher stays
# a strict subset of legacy at the article level: newly-blocked is still zero, and
# a shadow divergence is exactly an article the pruning RESCUES.
_INGEST_KEYWORD_BLOCKLIST_PRUNED = (
    "securities class action",
    "class action lawsuit",
    "shareholder lawsuit",
    "lead plaintiff deadline",
    "lead plaintiff",
    "remind investors",
    "encourages investors to contact",
    "securities fraud investigation",
    "no cost to investors",
    "announces investigation into fairness",
)


# Matching mode for the keyword pre-filter (INGEST_BLOCKLIST_MODE):
#   legacy -> substring match over the lowercased title+" "+summary seam-join,
#             against the CURRENT (unpruned) phrase set (original prod behavior).
#   new    -> per-field, word-boundary phrase match against the PRUNED set above
#             (the precision matching from #379 AND the pruned/tightened phrases).
#   shadow -> ACTIVE decision stays legacy/current (prod unchanged on deploy), but
#             the new (pruned) decision is also computed and every divergence is
#             logged with the greppable tag BLOCKLIST_SHADOW_DIVERGENCE. Because
#             new is a strict subset of legacy, each divergence is exactly an
#             article the precision+pruning would RESCUE; newly-blocked is zero.
_INGEST_BLOCKLIST_MODE = os.environ.get("INGEST_BLOCKLIST_MODE", "shadow").strip().lower()

# Word-boundary patterns for the new matcher, compiled once at import (not per
# call), from the PRUNED set. The LEADING \b is kept so the substring-in-word fix
# holds ("class action" never matches inside "subclass action"). The trailing
# boundary tolerates an optional plural "s" on the final word, so "class action
# lawsuit" also blocks "class action lawsuits" and "securities class action" also
# blocks "...class actions" -- closing the inflection-evasion the bare trailing \b
# opened (legacy substring already caught plurals). Internal whitespace is literal.
_INGEST_BLOCKLIST_PATTERNS = tuple(
    (phrase, re.compile(r"\b" + re.escape(phrase) + r"s?\b", re.IGNORECASE))
    for phrase in _INGEST_KEYWORD_BLOCKLIST_PRUNED
)


def _legacy_blocklist_phrase(title: str, summary: str) -> Optional[str]:
    """Original logic: first phrase that is a substring of the lowercased
    title+" "+summary seam-join, or None."""
    text = (title + " " + summary).lower()
    for phrase in _INGEST_KEYWORD_BLOCKLIST:
        if phrase in text:
            return phrase
    return None


def _new_blocklist_phrase(title: str, summary: str) -> Optional[str]:
    """Precision logic: first phrase that word-boundary matches the title OR the
    summary independently (no seam join), or None."""
    for phrase, pattern in _INGEST_BLOCKLIST_PATTERNS:
        if pattern.search(title) or pattern.search(summary):
            return phrase
    return None


def matches_ingest_blocklist(article: dict) -> bool:
    """Return True if the article's title or summary matches any blocked phrase.

    Mode is set by INGEST_BLOCKLIST_MODE (legacy|shadow|new), default shadow.
    Shadow actively blocks on the legacy decision (so deploying changes nothing)
    while logging where the new per-field word-boundary matcher would diverge.
    Logs the matched phrase and article title for audit purposes."""
    title = article.get("title") or ""
    summary = article.get("summary") or ""

    if _INGEST_BLOCKLIST_MODE == "new":
        phrase = _new_blocklist_phrase(title, summary)
        if phrase:
            print(f"  ⊘ Blocklist skip [{phrase!r}]: {title[:80]}")
            return True
        return False

    # legacy and shadow both ACTIVELY block on the legacy decision.
    legacy_phrase = _legacy_blocklist_phrase(title, summary)

    if _INGEST_BLOCKLIST_MODE == "shadow":
        new_phrase = _new_blocklist_phrase(title, summary)
        if (legacy_phrase is None) != (new_phrase is None):
            print(
                "  BLOCKLIST_SHADOW_DIVERGENCE "
                f"legacy={legacy_phrase!r} new={new_phrase!r} "
                f"title={title[:120]!r} summary={summary[:160]!r}"
            )

    if legacy_phrase is not None:
        print(f"  ⊘ Blocklist skip [{legacy_phrase!r}]: {title[:80]}")
        return True
    return False


def extract_company_names(companies_raw: list) -> list[str]:
    """Parse Gemini's companies field.

    Handles two formats:
      New format: [{"name": "Acme Corp", "entity_type": "company"}, ...]
      Old format: ["Acme Corp", ...]  (fallback — model may not comply immediately)

    Returns a flat list of company name strings, filtering out any objects where
    entity_type != "company".
    """
    if not companies_raw:
        return []
    names = []
    for item in companies_raw:
        if isinstance(item, str):
            # Old format — include as-is; downstream blocklists handle quality
            if item.strip():
                names.append(item.strip())
        elif isinstance(item, dict):
            # New format — only include if entity_type is explicitly "company"
            if item.get("entity_type") == "company":
                name = (item.get("name") or "").strip()
                if name:
                    names.append(name)
        # Any other type (int, bool, etc.) — skip silently
    return names


def strip_html(text: str) -> str:
    """Strip HTML tags, decode entities, remove bare URLs, collapse whitespace.
    Mirrors the logic in src/lib/strip-html.ts so stored summaries are clean
    for both LLM extraction and downstream UI rendering."""
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)                          # remove tags
    text = _html.unescape(text)                                    # decode &amp; &#038; etc.
    text = re.sub(r"https?://\S+", "", text)                       # bare URLs add no signal
    text = re.sub(r"\s*The post .+? appeared first on .+?\.\s*$",  # PE Hub boilerplate
                  "", text, flags=re.DOTALL)
    text = re.sub(r"\s{2,}", " ", text)                            # collapse whitespace
    return text.strip()


# --- Google News title/summary cleaning + language gate --------------------
# (defects #5 garbled titles, #4 data-half title-as-summary, #2 non-English
# clones). These run at ingest so the stored title is clean BEFORE the
# _normalize_title dedup, which means a "Headline - Publisher" suffix-only near
# duplicate collapses onto its bare-headline twin for free, and non-English wire
# clones never reach the store at all.

# Google News RSS appends " - <Publisher>", and some source feeds leak CJK
# bracket/period artifacts into the title. Strip both. The suffix match needs
# spaces around the dash and a short (<=40 char) final segment, so hyphenated
# compounds ("Cash-and-Stock", "Five-Year") and mid-sentence " -- " are kept.
_GNEWS_TITLE_ARTIFACTS = re.compile(r"[】【「」（）。]")
_GNEWS_PUBLISHER_SUFFIX = re.compile(r"\s+[-|]\s+[^-|]{1,40}$")


def _clean_gnews_title(title):
    if not title:
        return title
    t = _GNEWS_TITLE_ARTIFACTS.sub(" ", title)
    t = _GNEWS_PUBLISHER_SUFFIX.sub("", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t or title


def _alnum_key(s):
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def _is_headline_echo(summary, title):
    """True when the summary is just the headline restated (Google News stores
    the headline back as the RSS description). Mirrors the frontend guard in
    src/components/brief/dc-story-row.tsx (isHeadlineEcho): compare alphanumeric
    only forms and require near-equal length so a real body that merely opens
    with the headline is NOT treated as an echo. This pattern MUST stay in sync
    with that frontend helper; the two cannot share code across the Python/TS
    boundary, so any change to one must be mirrored in the other."""
    s = _alnum_key(summary)
    t = _alnum_key(title)
    if len(t) < 12 or not s:
        return False
    shorter, longer = (s, t) if len(s) <= len(t) else (t, s)
    return longer.startswith(shorter) and len(longer) - len(shorter) <= 8


# Dependency-free language gate (defect #2). Every configured source is
# English-intended (RSS_FEEDS + gnews en-US locale); PR Newswire / GlobeNewswire
# and gnews simply also carry occasional translated copies (DE / FR / SK / RU / ES)
# of an English release, which title-only dedup cannot collapse.
#
# This gate is a POSITIVE English check, not a foreign-language blocklist. The
# previous version enumerated foreign function words (German / French / Slavic) and
# therefore missed every language it did not list. That is a structural limit of a
# blocklist, not a tuning miss: a Spanish PR Newswire release ("e& anuncia la venta
# de su inversion en Vodafone", story 01 of the 2026-07-10 brief) sailed through all
# three prongs at once. Latin script, so the non-Latin prong saw nothing. Diacritic
# density ~0.06, under the old 0.12 line, because Spanish is diacritic-light. And
# zero Spanish tokens in the German/French/Slavic word set. So we stop naming
# languages and verify English instead: KEEP a row only when it is either short (no
# confident basis to reject) or carries real English function-word evidence.
#
# Two prongs, stdlib only (no lang-detect dep: langdetect / langid / pycld2 / lingua
# are all absent from the pipeline venv and we do not want a heavy new one):
#
#   1. NON-LATIN SCRIPT (cheap early exit, kept from before): if >= 20% of the
#      alphabetic characters are non-Latin (Cyrillic / Greek / Hebrew / Arabic /
#      Devanagari / Thai / Hangul / CJK / kana), drop. Catches Russian / Greek / CJK.
#   2. POSITIVE ENGLISH EVIDENCE: count grammatical English function words (the, of,
#      for, is, was, will, their, ...) over title + summary. DROP only when the text
#      is LONG (>= 40 word tokens) yet carries FEWER THAN 3 of them. Short or thin
#      rows are always kept: a terse real English headline ("Aon Announces Quarterly
#      Cash Dividend") can legitimately have zero function words, and dropping a real
#      English story is a silent, traceless loss, whereas a leaked foreign story is
#      visible and fixable. The foreign leaks are full press releases (43 to 80
#      tokens) with 0 to 2 English function words, so the length + evidence gate
#      separates them cleanly from real English without ever touching short rows.
#
# The function-word set is purely grammatical. Homograph landmines that also occur
# in ES / FR / DE / SK copy are deliberately excluded (a, an, in, on, or, as, at),
# as are content / company words that leak in via English brand names embedded in
# foreign copy ("TIMEX GROUP", "... Group Company").
#
# Calibrated offline, read-only, against 1000 recent prod rows (678 with a thin or
# empty summary) plus the 8 known foreign leaks. English function-word evidence
# separates the two populations: long English rows (>= 40 tokens) bottom out at 4
# hits; the foreign leaks top out at 2. Threshold chosen at < 3 hits with a >= 40
# token guard. False positives at that threshold: 0 of 1000. Title alone catches
# only 1 of 8 leaks (the Cyrillic one); the summary body carries the signal, which
# is why the check reads title + summary. Verified drops: the Spanish e&/Vodafone
# row and the Slovak / Russian / French / German Timex + Bitmine + Dar Global wire
# clones. Verified passes: Societe Generale, BNP Paribas SE, Deutsche Boerse AG,
# Nestle, LVMH, Sanofi, Ecolab, plus short and thin-summary real English rows.
_EN_FUNCTION_WORDS = {
    # determiners / demonstratives
    "the", "this", "that", "these", "those", "its", "their", "his", "her",
    "our", "your", "whose",
    # pronouns
    "it", "they", "them", "we", "us", "you", "who", "what", "which", "he", "she",
    # prepositions (homograph-safe: in / on / as / at excluded)
    "of", "to", "for", "with", "from", "into", "onto", "about", "after", "before",
    "over", "under", "between", "during", "against", "through", "than", "upon",
    "without", "within", "by",
    # conjunctions (homograph-safe: or excluded)
    "and", "but", "nor", "because", "while", "although", "however", "whether",
    "though",
    # auxiliaries / common verbs (English-specific morphology)
    "is", "are", "was", "were", "be", "been", "being", "has", "have", "had",
    "will", "would", "could", "should", "can", "may", "might", "must", "does",
    "did", "said", "says",
    # adverbs / wh-
    "not", "also", "more", "most", "now", "then", "here", "there", "when",
    "where", "why", "how", "out",
}
# A row is only eligible to DROP on the positive-evidence prong when it is at least
# this many word tokens long; shorter rows are always kept.
_LONG_TEXT_TOKENS = 40
# ... and only when it carries fewer than this many English function words.
_MIN_EN_EVIDENCE = 3
# Unicode-aware letter run (matches accented + non-Latin letters, unlike the old
# Latin-only [a-za-oo-y]).
_WORD_RE = re.compile(r"[^\W\d_]+", re.UNICODE)


def _is_non_latin_letter(o: int) -> bool:
    return (
        0x0400 <= o <= 0x04FF  # Cyrillic
        or 0x0370 <= o <= 0x03FF  # Greek
        or 0x0590 <= o <= 0x05FF  # Hebrew
        or 0x0600 <= o <= 0x06FF  # Arabic
        or 0x0750 <= o <= 0x077F  # Arabic supplement
        or 0x0900 <= o <= 0x097F  # Devanagari
        or 0x0E00 <= o <= 0x0E7F  # Thai
        or 0x1100 <= o <= 0x11FF  # Hangul Jamo
        or 0xAC00 <= o <= 0xD7AF  # Hangul syllables
        or 0x3040 <= o <= 0x30FF  # Hiragana + Katakana
        or 0x3400 <= o <= 0x4DBF  # CJK ext A
        or 0x4E00 <= o <= 0x9FFF  # CJK unified
    )


def _is_probably_english(article):
    text = f"{article.get('title', '')} {article.get('summary', '')}"
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return True

    # 1. Non-Latin script -> not English (cheap early exit).
    non_latin = sum(1 for c in letters if _is_non_latin_letter(ord(c)))
    if non_latin / len(letters) >= 0.20:
        return False

    # 2. Positive English evidence. Only a LONG body that carries almost no English
    #    function words is dropped; short and thin rows are always kept so a terse
    #    real English headline is never silently lost.
    tokens = _WORD_RE.findall(text.lower())
    en_hits = sum(1 for t in tokens if t in _EN_FUNCTION_WORDS)
    if len(tokens) >= _LONG_TEXT_TOKENS and en_hits < _MIN_EN_EVIDENCE:
        return False
    return True


def fetch_watchlist_finnhub_articles() -> list[dict]:
    """Watchlist-driven Finnhub fetch (v1).

    Pulls DISTINCT ticker identifiers from the `watchlist` table, fetches
    Finnhub company-news for the last 7 days (cap 8 per ticker), dedupes
    candidates against the last 30 days of existing rows in the `articles`
    table by URL, and returns article dicts in the same shape that
    fetch_all_articles produces. The returned articles flow through the
    existing Gemini filter + articles-table insert path — no separate
    storage path, no watchlist_articles writes.

    Emits a structured log line:
      watchlist-finnhub: N tickers, M articles fetched, K inserted, J duplicates
    where K is candidates passed back to the caller (post-DB-dedup) and
    J is the count rejected as URL-duplicates of existing rows. Final
    insert success is determined downstream by store_article.
    """
    finnhub_key = os.environ.get("FINNHUB_API_KEY", "")
    if not finnhub_key:
        print("  watchlist-finnhub: FINNHUB_API_KEY not set, skipping")
        return []

    # Pull DISTINCT ticker identifiers from watchlist (same client pattern as
    # watchlist_sync.run_sync). Uppercased + de-duplicated in Python because
    # supabase-py does not expose a DISTINCT primitive.
    try:
        resp = supabase.table("watchlist").select("identifier").eq("type", "ticker").execute()
        rows = resp.data or []
    except Exception as ex:
        print(f"  watchlist-finnhub: watchlist read failed: {ex}")
        return []

    tickers: list[str] = []
    seen_t: set[str] = set()
    for row in rows:
        ident = (row.get("identifier") or "").strip().upper()
        if ident and ident not in seen_t:
            seen_t.add(ident)
            tickers.append(ident)

    if not tickers:
        print("  watchlist-finnhub: 0 tickers, 0 articles fetched, 0 inserted, 0 duplicates")
        return []

    # Pre-load existing article URLs from the last 30 days so we can dedupe
    # candidates BEFORE handing them to the Gemini filter (saves tokens and
    # gives an accurate duplicate count in the structured log line).
    existing_urls: set[str] = set()
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        ex_resp = supabase.table("articles").select("url").gte("ingested_at", cutoff).execute()
        for r in (ex_resp.data or []):
            u = r.get("url")
            if u:
                existing_urls.add(u)
    except Exception as ex:
        print(f"  watchlist-finnhub: existing-url preload failed (continuing without DB dedupe): {ex}")

    now = datetime.now(timezone.utc)
    from_dt = now - timedelta(days=7)
    fetched = 0
    duplicates = 0
    out: list[dict] = []
    out_urls: set[str] = set()

    for ticker in tickers:
        try:
            r = requests.get(
                "https://finnhub.io/api/v1/company-news",
                params={
                    "symbol": ticker,
                    "from": from_dt.strftime("%Y-%m-%d"),
                    "to": now.strftime("%Y-%m-%d"),
                    "token": finnhub_key,
                },
                timeout=8,
            )
            r.raise_for_status()
            items = r.json() or []
        except Exception as ex:
            print(f"  watchlist-finnhub: fetch failed for {ticker}: {ex}")
            time.sleep(1.0)
            continue

        for item in items[:8]:
            url = item.get("url", "")
            title = item.get("headline", "")
            if not url or not title:
                continue
            fetched += 1
            if url in existing_urls or url in out_urls:
                duplicates += 1
                continue
            ts = item.get("datetime")
            # Missing/unparseable timestamp stays NULL: never now-stamp, or a
            # stale item looks fresh. True ingest time lives in articles.ingested_at.
            published_at = None
            if ts:
                try:
                    published_at = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
                except Exception:
                    pass
            out.append({
                "title": title,
                "summary": strip_html(item.get("summary", ""))[:500],
                "url": url,
                "source": item.get("source") or "Finnhub",
                "published_at": published_at,
                "content_type": "snippet",
            })
            out_urls.add(url)
        time.sleep(1.0)  # polite pacing — mirrors watchlist_sync.fetch_finnhub_articles

    print(
        f"  watchlist-finnhub: {len(tickers)} tickers, {fetched} articles fetched, "
        f"{len(out)} inserted, {duplicates} duplicates"
    )
    return out


INGEST_FRESHNESS_DAYS = 7

def fetch_all_articles():
    articles = []
    # Per-source fetch stats: {source: {"fetched": N, "fresh": N}}
    # Used by run_ingestion for per-wire signal/noise logging.
    source_fetch_stats: dict[str, dict[str, int]] = {}
    now = datetime.now(timezone.utc)
    freshness_cutoff = now - timedelta(days=INGEST_FRESHNESS_DAYS)
    total_skipped_stale = 0
    rss_t0 = time.time()
    rss_added = 0
    for source, url in RSS_FEEDS.items():
        skipped_stale = 0
        feed_t0 = time.time()
        feed_added = 0
        feed_total = 0
        try:
            # Bounded fetch via urllib.request.urlopen(timeout=20) so a hung
            # upstream cannot block the pipeline forever (run #98 root cause).
            raw = _fetch_feed_bytes(url)
            feed = feedparser.parse(raw)
            # Wire sources get a higher entry cap — they produce more volume
            # and the relevance filter handles noise.
            entry_cap = 40 if source in WIRE_SOURCES else 8
            for e in feed.entries[:entry_cap]:
                feed_total += 1
                # Missing date stays NULL: never now-stamp a date-less item, or a
                # stale story masquerades as fresh (articles has no created_at; the
                # true ingest time lives in ingested_at, defaulted by the DB).
                published_at = e.get("published") or None
                # Skip articles older than INGEST_FRESHNESS_DAYS. If the date is
                # missing or unparseable, let the entry through.
                if published_at:
                    try:
                        pub_dt = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
                        if pub_dt < freshness_cutoff:
                            skipped_stale += 1
                            continue
                    except Exception:
                        pass  # if parsing fails, let the entry through
                articles.append({
                    "title": e.get("title", ""),
                    "summary": strip_html(e.get("summary", e.get("description", "")))[:500],
                    "url": e.get("link", ""),
                    "source": source,
                    "published_at": published_at,
                    "content_type": "full_text" if source in FULL_TEXT_SOURCES else "snippet"
                })
                feed_added += 1
            print(f"  RSS {source}: {feed_added} articles in {time.time() - feed_t0:.2f}s")
        except (urllib.error.URLError, socket.timeout) as ex:
            print(f"  RSS error {source}: network ({type(ex).__name__}: {ex}) in {time.time() - feed_t0:.2f}s")
        except Exception as ex:
            print(f"  RSS error {source}: {ex} in {time.time() - feed_t0:.2f}s")
        if skipped_stale:
            print(f"  RSS {source}: skipped {skipped_stale} stale articles (>{INGEST_FRESHNESS_DAYS}d old)")
            total_skipped_stale += skipped_stale
        source_fetch_stats[source] = {"fetched": feed_total, "fresh": feed_added}
        rss_added += feed_added
    print(f"  RSS total: {rss_added} articles from {len(RSS_FEEDS)} feeds in {time.time() - rss_t0:.2f}s")
    if total_skipped_stale:
        print(f"  RSS total: skipped {total_skipped_stale} stale articles across all feeds")

    # NewsAPI
    try:
        queries = ["M&A acquisition merger deal", "IPO valuation funding round", "earnings revenue profit", "geopolitics trade war sanctions", "private equity buyout"]
        for q in queries:
            r = requests.get("https://newsapi.org/v2/everything", params={
                "q": q, "sortBy": "publishedAt", "pageSize": 8,
                "language": "en", "apiKey": os.environ["NEWS_API_KEY"]
            }, timeout=10)
            for a in r.json().get("articles", []):
                articles.append({
                    "title": a.get("title", ""),
                    "summary": strip_html(a.get("description", ""))[:500],
                    "url": a.get("url", ""),
                    "source": a.get("source", {}).get("name", "NewsAPI"),
                    # Missing date stays NULL, never now-stamped. True ingest
                    # time lives in articles.ingested_at (DB default now()).
                    "published_at": a.get("publishedAt") or None,
                    "content_type": "snippet"
                })
            time.sleep(0.3)
    except Exception as ex:
        print(f"  NewsAPI error: {ex}")

    # Watchlist-driven Finnhub fetch (v1) — single integration point.
    # Articles route through the same articles-table insert path as RSS/NewsAPI
    # (Gemini filter, entity validation, company_mentions linkage). This does
    # NOT touch watchlist_articles. See fetch_watchlist_finnhub_articles().
    try:
        articles.extend(fetch_watchlist_finnhub_articles())
    except Exception as ex:
        print(f"  watchlist-finnhub error: {ex}")

    # Google News per-ticker feeds
    gnews_stats: dict[str, dict[str, int]] = {}
    try:
        gnews_articles, gnews_stats = fetch_gnews_per_ticker_feeds()
        articles.extend(gnews_articles)
    except Exception as ex:
        print(f"  gnews error: {ex}")

    # Deduplicate
    seen, unique = set(), []
    for a in articles:
        if a["url"] and a["url"] not in seen and a["title"]:
            seen.add(a["url"])
            unique.append(a)
    return unique, source_fetch_stats, gnews_stats


def _is_rate_limit_error(ex) -> bool:
    """True if the exception is a Gemini rate-limit signal worth backing off on."""
    s = str(ex)
    return "429" in s or "RESOURCE_EXHAUSTED" in s


def _is_unavailable_error(ex) -> bool:
    """True for a transient Gemini 503 UNAVAILABLE (the Google capacity blip).
    Distinct from _is_rate_limit_error (429/RESOURCE_EXHAUSTED). Mirrors the eval
    harness _is_unavailable_error (tools/filter_reorder_eval.py, PR #424): without
    retrying these, a transient 503 silently drops the article from the run, which
    gutted the 2026-06-25 morning brief (11 stored vs a 400-800 norm)."""
    s = str(ex)
    return "503" in s or "UNAVAILABLE" in s


# ---------------------------------------------------------------------------
# Filter-step Gemini usage accounting (FILTER ONLY). Best-effort, thread-safe,
# and fully exception-guarded so it can NEVER break filtering. Accumulates one
# summed line per run (logged at the end of filter_articles), not per call.
# ---------------------------------------------------------------------------
_FILTER_USAGE_LOCK = threading.Lock()
_FILTER_USAGE = {"calls": 0, "prompt": 0, "candidates": 0, "thoughts": 0,
                 "cached": 0, "total": 0}


def _reset_filter_usage() -> None:
    with _FILTER_USAGE_LOCK:
        for k in _FILTER_USAGE:
            _FILTER_USAGE[k] = 0


def _accumulate_filter_usage(response) -> None:
    """Sum one filter response's token usage into the run totals. Defensive on
    a missing usage_metadata or any None field; swallows everything so logging
    can never raise into the filter path."""
    try:
        um = getattr(response, "usage_metadata", None)
        if um is None:
            return

        def _g(name):
            v = getattr(um, name, None)
            return int(v) if v else 0

        with _FILTER_USAGE_LOCK:
            _FILTER_USAGE["calls"] += 1
            _FILTER_USAGE["prompt"] += _g("prompt_token_count")
            _FILTER_USAGE["candidates"] += _g("candidates_token_count")
            _FILTER_USAGE["thoughts"] += _g("thoughts_token_count")
            _FILTER_USAGE["cached"] += _g("cached_content_token_count")
            _FILTER_USAGE["total"] += _g("total_token_count")
    except Exception:
        pass


def _create_filter_cache():
    """Create the explicit static-prefix CachedContent for this run, ONCE.

    Returns the cache resource name on success, or None on ANY failure so the
    caller soft-fails to the uncached reordered prompt. Never raises into the
    run: a cache problem must degrade cost, never correctness."""
    try:
        cache = gemini_client.caches.create(
            model=FILTER_MODEL,
            config=types.CreateCachedContentConfig(
                contents=_FILTER_STATIC_PREFIX,
                ttl=f"{FILTER_CACHE_TTL_SEC}s",
                display_name="filter-static-prefix",
            ),
        )
        print(
            f"  [filter:cache] created {cache.name} ttl={FILTER_CACHE_TTL_SEC}s "
            f"(static prefix cached; ~90% input discount on hit)"
        )
        return cache.name
    except Exception as ex:
        print(
            f"  [filter:cache] create FAILED, falling back to uncached reordered "
            f"prompt for the whole run: {ex}"
        )
        return None


def _delete_filter_cache(cache_name):
    """Best-effort delete of the per-run filter cache. Soft-fail; the TTL also
    expires it. Never raises."""
    if not cache_name:
        return
    try:
        gemini_client.caches.delete(name=cache_name)
        print(f"  [filter:cache] deleted {cache_name}")
    except Exception as ex:
        print(f"  [filter:cache] delete skipped ({cache_name}): {ex}")


def filter_article(article, cache_name=None):
    # FILTER_PROMPT_CACHE OFF -> byte-identical to the original (unchanged prompt
    # order, no cache reference). ON with a live cache -> the request carries only
    # the fields tail and references the cached static prefix. ON without a cache
    # (soft-fail) -> the full reordered prompt, uncached. All three send the same
    # semantic content; only byte-order (and, on the cached path, the cache
    # boundary) differs.
    if FILTER_PROMPT_CACHE and cache_name:
        prompt = _FILTER_FIELDS_TAIL.format(
            title=article["title"],
            summary=article["summary"],
            source=article["source"],
        )
    elif FILTER_PROMPT_CACHE:
        prompt = FILTER_PROMPT_REORDERED.format(
            title=article["title"],
            summary=article["summary"],
            source=article["source"],
        )
    else:
        prompt = FILTER_PROMPT.format(
            title=article["title"],
            summary=article["summary"],
            source=article["source"],
        )

    def _call():
        return gemini_client.models.generate_content(
            model=FILTER_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.2,
                max_output_tokens=2048,
                thinking_config=types.ThinkingConfig(thinking_budget=0),
                response_mime_type="application/json",
                response_schema=FilterDecision,
                cached_content=(cache_name if FILTER_PROMPT_CACHE else None),
            ),
        )

    # Bounded exponential backoff on transient 429 / RESOURCE_EXHAUSTED and
    # 503 / UNAVAILABLE. Schema/parse/timeout failures are NOT retried here (the
    # caller's _filter_article_with_retry handles the single schema retry); they
    # fall straight through to drop-and-log, preserving the prior behaviour.
    delay = 1.0
    for attempt in range(FILTER_MAX_RATE_RETRIES + 1):
        try:
            # Inner single-worker pool enforces the 30s per-call hard timeout.
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as _ex:
                response = _ex.submit(_call).result(timeout=30)
            _accumulate_filter_usage(response)
            accumulate_gemini_usage("filter", FILTER_MODEL, response)
            text = (response.text or "").strip()
            if text.startswith("```"):
                text = text.split("```")[1]
                if text.startswith("json"): text = text[4:]
            return json.loads(text.strip())
        except Exception as ex:
            rate_limited = _is_rate_limit_error(ex)
            unavailable = _is_unavailable_error(ex)
            if (rate_limited or unavailable) and attempt < FILTER_MAX_RATE_RETRIES:
                sleep_s = min(delay, 30.0) + random.uniform(0, 0.5)
                kind = "429/RESOURCE_EXHAUSTED" if rate_limited else "503/UNAVAILABLE"
                print(
                    f"  [filter:rate-limit] {kind}, backoff "
                    f"{sleep_s:.1f}s (attempt {attempt + 1}/{FILTER_MAX_RATE_RETRIES})"
                )
                time.sleep(sleep_s)
                delay *= 2
                continue
            print(f"  Filter error: {ex}")
            return None


def _filter_article_with_retry(article, cache_name=None):
    """filter_article() with one retry on None. Returns parsed dict or None.

    response_schema enforcement at single-object level is reliable but not
    perfect (smoke test 3 saw ~0.83% per-article failure rate). One retry
    catches transient model flakiness; persistent failures get dropped with
    a structured log line that is auditable post-merge.

    Logging contract:
      [filter:schema-fail] title='...': first call returned None, retrying
      [filter:retry-fail]  title='...': retry also failed, dropping
    """
    title_short = (article.get("title") or "")[:60].replace("\n", " ")
    result = filter_article(article, cache_name=cache_name)
    if result is not None:
        return result
    print(f"  [filter:schema-fail] title='{title_short}', retrying once")
    result = filter_article(article, cache_name=cache_name)
    if result is None:
        print(f"  [filter:retry-fail] title='{title_short}', dropping")
    return result


def filter_articles(articles):
    """Filter all articles via per-article Gemini calls with parallel workers.

    Replaces the prior batch path. Smoke test 3 (run 25538358541) confirmed
    that Gemini response_schema reliably constrains single-object output
    (5 errors of ~600 calls = 0.83% rate) but does not reliably constrain
    list[Model] array output (12/13 batch chunks fell back to per-article).
    Per-article + parallel workers gives identical throughput with proven
    schema enforcement and a single code path.

    Returns a list aligned by index with the input `articles` array. Slots
    where filter_article plus retry both fail are None; run_ingestion's
    relevance gate already treats None as 'skip this article'.

    Concurrency: a SINGLE ThreadPoolExecutor processes the whole pass, so
    batches no longer serialize (the prior code re-created a pool per 50-article
    log batch, which capped throughput at one batch at a time). FILTER_LOG_BATCH_SIZE
    now only sets the progress-log cadence.

    Safety net: FILTER_PHASE_BUDGET_SEC bounds the wall-clock for the whole
    phase. Past the budget we cancel not-yet-started calls, let in-flight calls
    finish, and return the partial set so the pipeline stores a fresh-but-partial
    feed rather than being hard-killed at the 90-min step ceiling (which writes
    nothing). Budget-skipped slots are None, same as a schema drop.
    """
    if not articles:
        return []

    _reset_filter_usage()
    total = len(articles)
    print(
        f"  filter: {total} articles, single-pool workers={FILTER_PARALLEL_WORKERS}, "
        f"budget={FILTER_PHASE_BUDGET_SEC}s, progress every {FILTER_LOG_BATCH_SIZE}"
    )

    # Create the explicit static-prefix cache ONCE for the whole pass (only when
    # the flag is ON). A None here (flag off, or create failed) means every call
    # soft-fails to the uncached path; it can never skip or alter an article.
    cache_name = _create_filter_cache() if FILTER_PROMPT_CACHE else None

    results = [None] * total
    done = kept = skipped = 0
    budget_hit = False
    t0 = time.time()

    with concurrent.futures.ThreadPoolExecutor(max_workers=FILTER_PARALLEL_WORKERS) as ex:
        fut_to_idx = {
            ex.submit(_filter_article_with_retry, a, cache_name): i
            for i, a in enumerate(articles)
        }
        for fut in concurrent.futures.as_completed(fut_to_idx):
            i = fut_to_idx[fut]
            try:
                r = fut.result()
            except concurrent.futures.CancelledError:
                continue
            except Exception as e:
                title_short = (articles[i].get("title") or "")[:60].replace("\n", " ")
                print(f"  [filter:retry-fail] title='{title_short}' error={type(e).__name__}:{e}, dropping")
                r = None
            results[i] = r
            done += 1
            if r is not None:
                kept += 1
            else:
                skipped += 1
            if done % FILTER_LOG_BATCH_SIZE == 0 or done == total:
                rpm = done / max(time.time() - t0, 1e-6) * 60.0
                print(
                    f"  filter progress {done}/{total} in {time.time() - t0:.0f}s "
                    f"({kept} parsed, {skipped} skipped, ~{rpm:.0f} RPM)"
                )
            if time.time() - t0 > FILTER_PHASE_BUDGET_SEC:
                cancelled = sum(1 for f2 in fut_to_idx if not f2.done() and f2.cancel())
                budget_hit = True
                print(
                    f"  [filter:budget] wall-clock budget {FILTER_PHASE_BUDGET_SEC}s exceeded "
                    f"after {done}/{total}; cancelled {cancelled} not-started, finishing in-flight"
                )
                break

    if budget_hit:
        # Pool has shut down (in-flight calls finished); recover any that
        # completed during the cancellation window so their calls aren't wasted.
        recovered = 0
        for f2, j in fut_to_idx.items():
            if results[j] is None and not f2.cancelled() and f2.done():
                try:
                    rr = f2.result()
                except Exception:
                    rr = None
                if rr is not None:
                    results[j] = rr
                    recovered += 1
        filtered_ok = sum(1 for r in results if r is not None)
        print(
            f"  filter done (partial): {filtered_ok} filtered, ~{total - done} unprocessed "
            f"(budget skip), {recovered} recovered in-flight, elapsed {time.time() - t0:.0f}s"
        )
    else:
        print(
            f"  filter done: {kept} filtered, {skipped} dropped, "
            f"elapsed {time.time() - t0:.0f}s (~{done / max(time.time() - t0, 1e-6) * 60.0:.0f} RPM)"
        )

    # One summed usage line for the whole filter step (never per-call). Output
    # billing is candidates + thoughts (both at the output rate); input is
    # prompt tokens. Cost is ESTIMATED -- the billing meter is the source of
    # truth. Fully guarded so it cannot abort the step.
    try:
        with _FILTER_USAGE_LOCK:
            u = dict(_FILTER_USAGE)
        out_tok = u["candidates"] + u["thoughts"]
        est = u["prompt"] * (0.30 / 1_000_000) + out_tok * (2.50 / 1_000_000)
        print(
            f"  [filter:usage] calls={u['calls']} prompt_tok={u['prompt']} "
            f"candidates_tok={u['candidates']} thoughts_tok={u['thoughts']} "
            f"cached_tok={u['cached']} total_tok={u['total']} "
            f"est_cost=${est:.4f} ESTIMATED (@ $0.30/1M in, $2.50/1M out; meter is truth)"
        )
    except Exception as ex:
        print(f"  [filter:usage] summary skipped: {ex}")

    # Best-effort teardown of the per-run cache (no-op when off / never created).
    _delete_filter_cache(cache_name)

    return results


# DEPRECATED: replaced by register_entity per docs/w2-a-entity-resolution-design.md section 5.
# Kept as dead code for one cron cycle to enable instant revert. Delete in a follow-up after validation.
def upsert_company(name, themes, sentiment):
    try:
        ex = supabase.table("companies").select("*").eq("name", name).execute()
        if ex.data:
            c = ex.data[0]
            supabase.table("companies").update({
                "mention_count": c["mention_count"] + 1,
                "last_updated": datetime.now(timezone.utc).isoformat(),
                "key_themes": list(set((c.get("key_themes") or []) + themes))
            }).eq("id", c["id"]).execute()
            return c["id"]
        else:
            r = supabase.table("companies").insert({
                "name": name, "key_themes": themes,
                "sentiment_trend": sentiment, "mention_count": 1
            }).execute()
            return r.data[0]["id"]
    except Exception as ex:
        print(f"  Company error {name}: {ex}")
        return None


def _normalize_title(title):
    """Lowercase, strip punctuation, collapse whitespace for exact-title dedup.
    Decodes HTML entities first (defect FIX 2) so an entity-encoded title and its
    decoded twin (e.g. "Rearm &amp; Rebuild" vs "Rearm & Rebuild") produce the
    same dedup key instead of diverging on the stray "amp"."""
    t = _html.unescape(title or "").lower()
    t = re.sub(r"[^\w\s]", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


# --- Within-run entity resolution cache + per-mention tally (store-scale fix) -
# At gnews scale a single run sees ~13k articles that map to far fewer unique
# company names. The expensive parts -- Wikidata validation and the entity
# resolution (alias lookup / canonical-id) -- are memoized once per unique
# surface form per run. is_valid_company already does its own Supabase
# cache-first lookup (backend/wikidata.py); this is an additional in-process memo.
#
# Counting is DECOUPLED from resolution (see backend/entity_resolver.resolve_entity
# + increment_mention_counts): resolution is memoized (side-effect-free), but every
# PERSISTED company_mention is tallied per canonical id AND per alias id, and the
# tallies are applied in bulk after the writes. So companies.mention_count and
# aliases.mention_count keep their exact per-mention totals (Company Intel ranking
# in src/app/api/companies/route.ts and the V1 hit-many tiebreaker stay correct),
# computed in a handful of UPDATEs instead of ~26k per-mention round-trips.
_RUN_VALID_COMPANY_CACHE: dict = {}
_RUN_ENTITY_RESOLUTION_CACHE: dict = {}   # surface form -> (canonical_id, alias_id)
_RUN_COMPANY_MENTION_TALLY: dict = {}     # canonical_id -> persisted-mention count
_RUN_ALIAS_MENTION_TALLY: dict = {}       # alias_id -> persisted-mention count


def _reset_run_entity_caches() -> None:
    """Clear the per-run entity memo + mention tallies. Called at the top of
    run_ingestion so a long-lived process does not carry resolutions or counts
    across runs (in CI each run is a fresh process, so this is belt-and-suspenders)."""
    _RUN_VALID_COMPANY_CACHE.clear()
    _RUN_ENTITY_RESOLUTION_CACHE.clear()
    _RUN_COMPANY_MENTION_TALLY.clear()
    _RUN_ALIAS_MENTION_TALLY.clear()


def _resolve_company_valid(company: str) -> bool:
    """is_valid_company() memoized for the run. Pure validation -> safe to cache."""
    if company in _RUN_VALID_COMPANY_CACHE:
        return _RUN_VALID_COMPANY_CACHE[company]
    ok = is_valid_company(company, supabase)
    _RUN_VALID_COMPANY_CACHE[company] = ok
    return ok


def _resolve_company_entity(company: str, themes, sentiment):
    """resolve_entity() memoized by surface form for the run (side-effect-free
    resolution; no mention_count increment). Returns (canonical_id, alias_id),
    either of which may be None on a resolution failure."""
    if company in _RUN_ENTITY_RESOLUTION_CACHE:
        return _RUN_ENTITY_RESOLUTION_CACHE[company]
    try:
        res = resolve_entity(company, supabase, themes=themes, sentiment=sentiment)
        cid, alias_id = res.get("canonical_id"), res.get("alias_id")
    except Exception as ex:
        print(f"  resolve_entity error [{company!r}]: {ex}")
        cid, alias_id = None, None
    _RUN_ENTITY_RESOLUTION_CACHE[company] = (cid, alias_id)
    return cid, alias_id


def _tally_mention(canonical_id, alias_id) -> None:
    """Record one PERSISTED company_mention against its canonical id + alias id.
    Applied in bulk by increment_mention_counts() after the writes."""
    if canonical_id:
        _RUN_COMPANY_MENTION_TALLY[canonical_id] = _RUN_COMPANY_MENTION_TALLY.get(canonical_id, 0) + 1
    if alias_id:
        _RUN_ALIAS_MENTION_TALLY[alias_id] = _RUN_ALIAS_MENTION_TALLY.get(alias_id, 0) + 1


# --- Batched store path (store-scale fix) ----------------------------------
# The legacy per-article store_article() issued ~5 Supabase round-trips per
# article (url-dedup SELECT, a recent-titles SELECT that re-pulled the whole
# growing 24h window every call -- O(N^2) -- the insert, an entity lookup, and a
# mention insert). At ~13k relevant articles that did ~16k dedup GETs alone and
# could not finish inside the 90-min step. store_articles_batch() pre-loads the
# dedup sets once and bulk-inserts articles + company_mentions in chunks.
STORE_CHUNK_SIZE = int(os.getenv("STORE_CHUNK_SIZE", "500"))


# ---------------------------------------------------------------------------
# primary_company fold into companies[] (dark, go-forward, mention_count frozen)
# ---------------------------------------------------------------------------
# Source of truth: docs/recon/tagging-coverage.md (Option A2 + Phase A6).
#
# Why: companies[] is the field the ArticlesTab and most Company Intel surfaces
# filter on. It is written only from the Gemini `companies` array filtered by the
# blocklist and the Wikidata gate. Common-word company names (for example
# "Snowflake", whose bare Wikidata hit is a Kate Bush song) get dropped by the
# gate, so an article whose primary_company the model correctly identified as
# Snowflake lands with companies[] empty or holding only co-mentions, and the
# company page looks empty. Gemini reliably sets primary_company; this folds that
# vetted single main actor into the article's companies[] when it resolves to an
# already-indexed company.
#
# HARD FREEZE: this widens the article.companies[] MATCH FIELD ONLY. It is applied
# inside _article_row, which builds the article-insert row. It is deliberately NOT
# used to build company_mentions or to increment companies.mention_count or
# aliases.mention_count: both store paths iterate the ORIGINAL clean_companies for
# those (store_articles_batch carries clean_companies in its `stored` tuple;
# store_article loops clean_companies inline). So the longitudinal attention and
# trend moat signals are unchanged by this flag; only the read-side
# article-to-company match widens.
#
# Default OFF. When off, _fold_primary_into_companies returns clean_companies
# unchanged and behavior is byte-identical to today.
TAGGING_PRIMARY_FOLD_ENABLED = os.getenv("TAGGING_PRIMARY_FOLD_ENABLED", "false").strip().lower() == "true"

# Process-level memo of "does this primary_company name resolve to an indexed
# companies row". Read-only SELECTs only; populated lazily.
_PRIMARY_INDEXED_CACHE: dict[str, bool] = {}


def _primary_resolves_to_indexed(name: str) -> bool:
    """SELECT-only: does `name` resolve to an existing companies row (exact name,
    else case-insensitive name match)? Memoized per process. Fail-closed: on any
    error return False so a name we could not confirm is indexed is never folded.
    Writes nothing."""
    cached = _PRIMARY_INDEXED_CACHE.get(name)
    if cached is not None:
        return cached
    result = False
    try:
        r = supabase.table("companies").select("id").eq("name", name).limit(1).execute()
        if r.data:
            result = True
        else:
            r2 = supabase.table("companies").select("id").ilike("name", name).limit(1).execute()
            result = bool(r2.data)
    except Exception as ex:
        print(f"  primary-fold: indexed check error [{name!r}]: {ex}")
        result = False
    _PRIMARY_INDEXED_CACHE[name] = result
    return result


def _fold_primary_into_companies(clean_companies, analysis):
    """Return the companies[] list to write ON THE ARTICLE ROW.

    Flag off (default): returns clean_companies unchanged.
    Flag on: returns a NEW list = clean_companies plus primary_company, when
    primary_company is non-empty, not a blocked entity, resolves to an indexed
    company, and is not already present (case-insensitive). Never mutates
    clean_companies. See the HARD FREEZE note above: this does not feed
    company_mentions or mention_count."""
    if not TAGGING_PRIMARY_FOLD_ENABLED:
        return clean_companies
    primary = (analysis.get("primary_company") or "").strip()
    if not primary:
        return clean_companies
    if is_blocked_entity(primary):
        return clean_companies
    if primary.lower() in {c.lower() for c in clean_companies}:
        return clean_companies
    if not _primary_resolves_to_indexed(primary):
        return clean_companies
    return [*clean_companies, primary]


def _article_row(article, analysis, clean_companies):
    """Build the articles-table insert row. Shared by store_article (legacy) and
    store_articles_batch so the column shape can never drift between them."""
    industry_verticals = validate_tags(analysis.get("industry_verticals", []), INDUSTRY_VERTICALS)
    activity_types = validate_tags(analysis.get("activity_types", []), ACTIVITY_TYPES)
    # Backward compat: write sector as first vertical so synthesize.py and any
    # frontend code still reading the old column keeps working.
    sector_fallback = industry_verticals[0] if industry_verticals else ""
    return {
        # Decode HTML entities in the stored title (defect FIX 2): PR Newswire /
        # Bloomberg feeds leak literal &amp; / &#39; / &quot; into the title.
        # Shared by both store paths, so this covers every source, not just gnews.
        "title": _html.unescape(article["title"] or ""),
        "summary": article["summary"] or "",
        "url": article["url"],
        "source": article["source"],
        "published_at": article["published_at"],
        "relevance_score": analysis["relevance_score"],
        "relevance_reason": analysis.get("relevance_reason", ""),
        # companies[] is the article-to-company MATCH FIELD. Fold in primary_company
        # when the flag is on (dark by default). This widens the match field ONLY;
        # company_mentions and mention_count keep iterating the original
        # clean_companies in both store paths. See _fold_primary_into_companies.
        "companies": _fold_primary_into_companies(clean_companies, analysis),
        "themes": analysis.get("themes", []),
        "sentiment": analysis.get("sentiment", "neutral"),
        "sentiment_reason": analysis.get("sentiment_reason"),
        "sector": sector_fallback,
        "industry_verticals": industry_verticals,
        "activity_types": activity_types,
        "deal_type": analysis.get("deal_type"),
        "primary_company": analysis.get("primary_company"),
        "content_type": article.get("content_type", "snippet"),
    }


def _clean_companies(analysis):
    """Validate + filter the analysis company list (blocklist + memoized Wikidata)."""
    out = []
    for company in extract_company_names(analysis.get("companies", [])):
        if is_blocked_entity(company):
            continue
        if not _resolve_company_valid(company):
            continue
        out.append(company)
    return out


def _load_store_dedup_sets():
    """Pre-fetch existing URLs (30d) and recent normalized titles (24h) ONCE,
    replacing the per-article dedup SELECTs. Paginated past PostgREST's 1000-row
    default cap. Read-only; failures degrade to empty sets (store still runs)."""
    existing_urls, recent_titles = set(), set()

    def _paged(select_col, since_iso):
        rows_out, page, size = [], 0, 1000
        while True:
            resp = (supabase.table("articles").select(select_col)
                    .gte("ingested_at", since_iso)
                    .range(page * size, page * size + size - 1).execute())
            rows = resp.data or []
            rows_out.extend(rows)
            if len(rows) < size:
                return rows_out
            page += 1

    try:
        url_cut = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        for r in _paged("url", url_cut):
            if r.get("url"):
                existing_urls.add(r["url"])
    except Exception as ex:
        print(f"  store: existing-url preload failed (continuing without it): {ex}")
    try:
        title_cut = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        for r in _paged("title", title_cut):
            nt = _normalize_title(r.get("title", "") or "")
            if nt:
                recent_titles.add(nt)
    except Exception as ex:
        print(f"  store: recent-title preload failed (continuing without it): {ex}")
    return existing_urls, recent_titles


def partition_unseen_articles(articles, existing_urls, recent_titles):
    """Split a fetched pool into (fresh, skipped_count) against the store's dedup
    key, so dedup-before-filter only sends genuinely-new articles to the Gemini
    filter. An article is already-in-DB if its exact url is in existing_urls
    (articles.url, 30d) OR its normalized title is in recent_titles
    (articles.title, 24h) -- the SAME key store_articles_batch uses.

    This deliberately does NOT collapse within-run duplicates (two fresh
    articles with the same normalized title): that is left to the store's own
    in-batch dedup, exactly as today, so the filter input is identical to the
    current pool minus the rows the store would have dropped as already-stored.
    Already-in-DB rows produce zero DB mutations today (no insert, no mention,
    no mention_count) -- skipping them pre-filter removes only the wasted LLM
    call and changes no stored data.
    """
    fresh, skipped = [], 0
    for a in articles:
        url = a.get("url")
        if url and url in existing_urls:
            skipped += 1
            continue
        nt = _normalize_title(a.get("title", "") or "")
        if nt and nt in recent_titles:
            skipped += 1
            continue
        fresh.append(a)
    return fresh, skipped


# ---------------------------------------------------------------------------
# Deterministic SEC bypass. SEC RSS filings (source "SEC 8-K"/"SEC 10-Q") enter
# with the rigid EDGAR title "{FORM} - {FILER} ({CIK}) (Filer)" and carry 8-K
# item codes in the summary ("Item N.NN"). We score them deterministically so
# the SEC feed does not depend on the relevance model. COVERAGE-NEUTRAL on the
# current model: every pinned score is >=6, matching today's behavior where the
# model rates all SEC filings 6-10 (0 below the gate in 30d of data).
# ---------------------------------------------------------------------------
_SEC_TITLE_RE = re.compile(r"^(8-K|10-Q)\s+-\s+(.+?)\s+\((\d{10})\)\s+\(Filer\)\s*$")
_SEC_ITEM_RE = re.compile(r"Item (\d+\.\d+)")
# Material 8-K items keep the filing at the top of the SEC band (8); routine-only
# items keep it at the gate floor (6). Both stay >=6, so coverage is unchanged.
_SEC_MATERIAL_8K_ITEMS = {"1.01", "1.03", "2.01", "2.02", "2.03", "3.02", "4.01", "4.02", "5.02"}


def _sec_bypass_decision(article):
    """Return a FilterDecision-shaped result dict for an SEC RSS filing,
    bypassing the Gemini filter -- or None if the article is not SEC-sourced or
    its title does not match the canonical EDGAR pattern (~3%), in which case it
    falls back to the normal LLM filter. Mirrors today's stored SEC behavior:
    primary_company = filer, companies = [] (SEC filings produce no
    company_mentions), sentiment = neutral, relevance pinned >=6."""
    src = article.get("source") or ""
    if not src.startswith("SEC "):
        return None
    m = _SEC_TITLE_RE.match(article.get("title") or "")
    if not m:
        return None  # odd title -> normal LLM filter, never force-pinned
    form, filer = m.group(1), m.group(2).strip()
    items = set(_SEC_ITEM_RE.findall(article.get("summary") or ""))
    if form == "10-Q":
        score, deal = 8, "Earnings"
    else:  # 8-K
        score = 8 if (items & _SEC_MATERIAL_8K_ITEMS) else 6
        deal = "Earnings" if "2.02" in items else "Other"
    return {
        "relevant": True,
        "relevance_score": score,
        "relevance_reason": f"SEC {form} filing by {filer} (deterministic SEC bypass)",
        "industry_verticals": [],
        "activity_types": [],
        "companies": [],
        "themes": [],
        "sentiment": "neutral",
        "sentiment_reason": "SEC filing; no first-order event tone (deterministic)",
        "deal_type": deal,
        "primary_company": filer,
    }


def _apply_filter_with_sec_bypass(fresh, filter_fn):
    """Route `fresh` through the SEC deterministic bypass plus the Gemini filter.

    SEC filings matching the EDGAR pattern get a deterministic decision; every
    other article (incl. ~3% of SEC titles that don't match) goes to filter_fn.
    Returns (results, n_sec, n_llm) where `results` is index-aligned with
    `fresh`, so callers can zip(fresh, results) exactly as before."""
    sec_results = {}            # index in `fresh` -> deterministic decision
    llm_items = []              # (index, article) routed to the Gemini filter
    for i, a in enumerate(fresh):
        dec = _sec_bypass_decision(a)
        if dec is not None:
            sec_results[i] = dec
        else:
            llm_items.append((i, a))
    llm_results = filter_fn([a for _i, a in llm_items])
    results = [None] * len(fresh)
    for i, dec in sec_results.items():
        results[i] = dec
    for (i, _a), r in zip(llm_items, llm_results):
        results[i] = r
    return results, len(sec_results), len(llm_items)


def _bulk_insert(table, rows):
    """Insert a list of rows in one call; return inserted .data, or None on error."""
    if not rows:
        return []
    try:
        resp = supabase.table(table).insert(rows).execute()
        return resp.data or []
    except Exception as ex:
        print(f"  store: bulk insert into {table} failed ({len(rows)} rows): {ex}")
        return None


def _insert_articles_chunk(chunk):
    """Insert a chunk of (article, analysis, companies, row) and yield
    (article_id, article, analysis, companies). Falls back to per-row inserts if
    the bulk call fails or returns an ambiguous row count, so one bad row never
    drops the whole chunk and id->row alignment stays exact."""
    rows = [row for (_a, _an, _c, row) in chunk]
    inserted = _bulk_insert("articles", rows)
    aligned = inserted is not None and len(inserted) == len(chunk)
    if aligned:
        for (a, analysis, companies, _row), ins in zip(chunk, inserted):
            if ins.get("id"):
                yield (ins["id"], a, analysis, companies)
        return
    if inserted is not None and len(inserted) != len(chunk):
        print(f"  store: bulk insert returned {len(inserted)} for {len(chunk)} rows; per-row fallback")
    for (a, analysis, companies, row) in chunk:
        one = _bulk_insert("articles", [row])
        if one and one[0].get("id"):
            yield (one[0]["id"], a, analysis, companies)


def store_articles_batch(relevant, deadline=None, dedup_sets=None):
    """Store relevant (article, analysis) pairs with batched dedup + bulk insert.

    Returns (stored_pairs, dupes_skipped) where stored_pairs is a list of
    (article_id, article) preserving the legacy contract for enrichment/boost.

    `deadline` is an absolute time.time() value (INGEST_PHASE_BUDGET_SEC from the
    run start). Past it the store stops taking on new work, keeps what is already
    written, and returns so the pipeline proceeds to synthesize on a partial set
    instead of running into the 90-min step kill that writes-then-dies.

    `dedup_sets` is an optional pre-loaded (existing_urls, recent_titles) tuple.
    When the caller already partitioned the fetched pool against the same sets
    (dedup-before-filter), it passes them in so the store does not re-read them
    from the DB. The in-batch dedup (url/title seen within this run) still runs,
    so behavior is identical whether the sets are loaded here or upstream.

    SCOPE NOTE: bulk-write correctness (column shape, PostgREST returned-row
    ordering, UNIQUE guards) is validated at the logic level only in this PR --
    no live Supabase schema test. The post-merge dispatch is the integration
    test. Chunk inserts fall back to per-row on any failure to stay safe.
    """
    if dedup_sets is not None:
        existing_urls, recent_titles = dedup_sets
    else:
        existing_urls, recent_titles = _load_store_dedup_sets()
    seen_urls, seen_titles = set(existing_urls), set(recent_titles)

    def _over_budget():
        return deadline is not None and time.time() > deadline

    # Build and flush by chunk in one pass. The budget is checked once per
    # article (cheap); on a budget stop we break but still flush the in-flight
    # buffer, so already-built rows are never discarded ("finish in-flight").
    stored = []   # (article_id, article, analysis, companies)
    buf = []      # (article, analysis, companies, row) for the current chunk
    dupes = budget_skipped = 0

    def _flush():
        if buf:
            stored.extend(_insert_articles_chunk(buf))
            buf.clear()

    for idx, (a, analysis) in enumerate(relevant):
        if _over_budget():
            budget_skipped = len(relevant) - idx
            print(f"  [store:budget] ingest budget reached after {idx} of "
                  f"{len(relevant)}; skipping {budget_skipped} and flushing in-flight")
            break
        try:
            url = a.get("url")
            if not url or url in seen_urls:
                dupes += 1
                continue
            norm = _normalize_title(a.get("title", ""))
            if norm and norm in seen_titles:
                dupes += 1
                continue
            companies = _clean_companies(analysis)
            buf.append((a, analysis, companies, _article_row(a, analysis, companies)))
            seen_urls.add(url)
            if norm:
                seen_titles.add(norm)
            if len(buf) >= STORE_CHUNK_SIZE:
                _flush()
        except Exception as ex:
            print(f"  store: row build failed [{(a.get('title') or '')[:50]}]: {ex}")
    _flush()  # final partial chunk (and the in-flight buffer on a budget stop)

    # Resolve entities (memoized, side-effect-free) and bulk-insert
    # company_mentions for the stored set. Each mention carries its (cid,
    # alias_id) so we can tally per-mention counts for ONLY the rows that
    # actually persist, then apply the increments in bulk (decoupled counting).
    mention_items = []  # (row, cid, alias_id)
    for (aid, a, analysis, companies) in stored:
        for company in companies:
            cid, alias_id = _resolve_company_entity(
                company, analysis.get("themes", []), analysis.get("sentiment", "neutral")
            )
            if cid:
                mention_items.append((
                    {
                        "company_id": cid, "article_id": aid,
                        "context": (a.get("summary") or "")[:300],
                        "sentiment": analysis.get("sentiment", "neutral"),
                    },
                    cid, alias_id,
                ))
    for i in range(0, len(mention_items), STORE_CHUNK_SIZE):
        if _over_budget():
            print(f"  [store:budget] budget reached; {len(mention_items) - i} "
                  f"company_mentions left unwritten (articles already stored)")
            break
        chunk = mention_items[i:i + STORE_CHUNK_SIZE]
        if _bulk_insert("company_mentions", [m[0] for m in chunk]) is not None:
            for (_row, cid, alias_id) in chunk:
                _tally_mention(cid, alias_id)
        else:
            # per-row fallback: tally only the rows that actually insert
            for (row, cid, alias_id) in chunk:
                if _bulk_insert("company_mentions", [row]) is not None:
                    _tally_mention(cid, alias_id)

    # Apply per-mention counts in bulk for exactly what was persisted. Runs after
    # the writes (even on a budget-stopped partial set) so companies.mention_count
    # and aliases.mention_count match the stored company_mentions.
    increment_mention_counts(supabase, "companies", _RUN_COMPANY_MENTION_TALLY)
    increment_mention_counts(supabase, "aliases", _RUN_ALIAS_MENTION_TALLY)

    if budget_skipped:
        print(f"  [store:budget] stored {len(stored)}, skipped {budget_skipped} "
              f"under budget; proceeding to downstream on the partial set")

    return [(aid, a) for (aid, a, _an, _c) in stored], dupes


def store_article(article, analysis):
    try:
        if supabase.table("articles").select("id").eq("url", article["url"]).execute().data:
            return None

        # Title dedup: skip if same normalized title stored in last 24h
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        recent = supabase.table("articles").select("title").gte("ingested_at", cutoff).execute().data or []
        norm_new = _normalize_title(article["title"])
        for row in recent:
            if _normalize_title(row.get("title", "")) == norm_new:
                print(f"  ⊘ Title dedup skip: {article['title'][:70]}")
                return None
        raw_companies = extract_company_names(analysis.get("companies", []))
        clean_companies = []
        for company in raw_companies:
            if is_blocked_entity(company):
                print(f"  ⊘ Blocked entity: {company}")
                continue
            if not _resolve_company_valid(company):
                continue
            clean_companies.append(company)

        r = supabase.table("articles").insert(
            _article_row(article, analysis, clean_companies)
        ).execute()
        article_id = r.data[0]["id"]
        for company in clean_companies:
            # Legacy single-article path: resolve (no count) then increment this
            # one mention inline, preserving the original per-mention semantics.
            cid, alias_id = _resolve_company_entity(
                company, analysis.get("themes", []), analysis.get("sentiment", "neutral")
            )
            if cid:
                supabase.table("company_mentions").insert({
                    "company_id": cid, "article_id": article_id,
                    "context": article["summary"][:300],
                    "sentiment": analysis.get("sentiment", "neutral")
                }).execute()
                increment_mention_counts(supabase, "companies", {cid: 1})
                if alias_id:
                    increment_mention_counts(supabase, "aliases", {alias_id: 1})
        return article_id
    except Exception as ex:
        print(f"  Store error: {ex}")
        return None


def run_ingestion():
    print(f"\n{'='*60}\nBreakingAlpha Ingestion - {datetime.now().strftime('%Y-%m-%d %H:%M')}\n{'='*60}")
    t_total = time.time()
    _reset_run_entity_caches()

    t = time.time()
    print("\n[1/4] Fetching articles...")
    articles, source_fetch_stats, gnews_stats = fetch_all_articles()
    print(f"  [1/4] DONE: {len(articles)} unique articles in {time.time() - t:.2f}s")

    t = time.time()
    print(f"\n[2/4] Pre-filtering {len(articles)} articles against keyword blocklist...")
    articles = [a for a in articles if not matches_ingest_blocklist(a)]
    # Language gate (defect #2): drop non-English wire clones (PR Newswire /
    # GlobeNewswire DE/FR copies of an English release) before the Gemini filter,
    # so they never store and never surface on the rail. Also saves filter calls.
    _before_lang = len(articles)
    articles = [a for a in articles if _is_probably_english(a)]
    if len(articles) != _before_lang:
        print(f"  [2/4] language gate dropped {_before_lang - len(articles)} non-English rows")
    print(f"  [2/4] DONE: {len(articles)} after keyword pre-filter in {time.time() - t:.2f}s")

    # Dedup-before-filter: drop articles already in the DB BEFORE the per-article
    # Gemini filter so we only spend filter calls on genuinely-new stories. Uses
    # the SAME dedup key as the store (url 30d / normalized title 24h); the sets
    # are loaded once here and handed to store_articles_batch so the DB read is
    # not repeated. Already-in-DB rows produce no stored data today (they are
    # skipped at store with no mention/count side effect), so removing them here
    # is data-neutral -- it only saves the redundant filter calls.
    dedup_sets = _load_store_dedup_sets()
    fresh, prefilter_skipped = partition_unseen_articles(articles, *dedup_sets)
    print(
        f"  [3/4] dedup-before-filter: {prefilter_skipped} already-in-DB skipped, "
        f"{len(fresh)} genuinely-new to filter (of {len(articles)})"
    )

    # SEC deterministic bypass: route SEC-sourced filings around the Gemini
    # filter and assign their decision fields from the structured EDGAR title +
    # item codes, so the SEC feed is independent of the relevance model.
    # Coverage-neutral on the current model (all pinned scores >=6); SEC titles
    # that don't match the EDGAR pattern (~3%) fall back to the LLM. Results stay
    # index-aligned with `fresh`, so order/shape are identical downstream.
    t = time.time()
    print(f"\n[3/4] Filtering {len(fresh)} fresh articles (SEC pinned deterministically, "
          f"rest via Gemini per-article + parallel)...")
    results, n_sec, n_llm = _apply_filter_with_sec_bypass(fresh, filter_articles)
    print(f"  [3/4] DONE: {n_sec} SEC pinned (no Gemini), Gemini filter on {n_llm} "
          f"in {time.time() - t:.2f}s")

    # Re-anchored relevance grader (RELEVANCE_GRADE_MODE). DEFAULT shadow is
    # prod-neutral: it leaves relevance_score and the >=6 gate untouched and only
    # logs RELEVANCE_GRADE_SHADOW divergence on a sampled fraction. `new` replaces
    # the score and switches the gate to RELEVANCE_NEW_GATE. `legacy` is a no-op.
    # Runs across the same shared parallel pool as the filter so the extra Flash
    # calls do not serialize. SEC-bypassed and None results are skipped inside
    # apply_relevance_grade. The gate below reads the (possibly-updated) score.
    if RELEVANCE_GRADE_MODE != "legacy":
        tg = time.time()
        with concurrent.futures.ThreadPoolExecutor(max_workers=FILTER_PARALLEL_WORKERS) as _gpool:
            list(_gpool.map(lambda pair: apply_relevance_grade(pair[0], pair[1]),
                            list(zip(fresh, results))))
        print(f"  [3/4] relevance-grade mode={RELEVANCE_GRADE_MODE} "
              f"(shadow_sample_rate={RELEVANCE_GRADE_SHADOW_SAMPLE_RATE}) "
              f"applied in {time.time() - tg:.2f}s")

    # Ingest gate. Under legacy/shadow it is the unchanged >=6 (so deploying the
    # shadow default changes nothing in prod). Under `new` it switches to the
    # data-derived RELEVANCE_NEW_GATE (>=1: drop only the true-0 junk floor, retain
    # everything with any signal for downstream relevance ranking).
    ingest_gate = RELEVANCE_NEW_GATE if RELEVANCE_GRADE_MODE == "new" else 6
    relevant = []
    for a, result in zip(fresh, results):
        if result and result.get("relevant") and result.get("relevance_score", 0) >= ingest_gate:
            relevant.append((a, result))
            print(f"  ✓ [{result['relevance_score']}/10] [{result.get('sector','?')[:20]}] {a['title'][:60]}...")

    t = time.time()
    print(f"\n[4/4] Storing {len(relevant)} articles (batched)...")
    stored_pairs, dupes = store_articles_batch(
        relevant, deadline=t_total + INGEST_PHASE_BUDGET_SEC, dedup_sets=dedup_sets
    )
    article_ids = [aid for aid, _ in stored_pairs]
    stored = len(article_ids)
    print(f"  [4/4] DONE: {stored} stored, {dupes} dupes skipped in {time.time() - t:.2f}s")
    print(f"\nINGEST total elapsed: {time.time() - t_total:.2f}s ({stored} new articles stored)")

    # Per-wire signal/noise funnel
    for src in sorted(WIRE_SOURCES):
        stats = source_fetch_stats.get(src, {"fetched": 0, "fresh": 0})
        wire_relevant = sum(1 for a, _ in relevant if a["source"] == src)
        print(
            f"  [ingest] {src}: {stats['fetched']} articles fetched, "
            f"{stats['fresh']} passed freshness, {wire_relevant} passed relevance >= 6"
        )

    # Google News per-ticker funnel
    if gnews_stats:
        gnews_total_fetched = sum(s["fetched"] for s in gnews_stats.values())
        gnews_relevant = sum(1 for a, _ in relevant if a["source"].startswith("Google News ("))
        print(
            f"  [ingest] Google News: {len(gnews_stats)} tickers, "
            f"{gnews_total_fetched} articles fetched, {gnews_relevant} passed relevance >= 6"
        )

    # [4b] Full-text enrichment for scrapeable sources
    enriched = 0
    for aid, a in stored_pairs:
        if a["source"] not in SCRAPEABLE_SOURCES:
            continue
        try:
            full_text = fetch_full_text(a["url"], a["source"])
            if full_text:
                supabase.table("articles").update({"content": full_text}).eq("id", aid).execute()
                print(f"  Full text fetched: {a['source']} {a['title'][:50]} ({len(full_text)} chars)")
                enriched += 1
            time.sleep(0.5)
        except Exception as ex:
            print(f"  ⚠ Enrichment failed for {a['title'][:50]}: {ex}")
    if enriched:
        print(f"  📝 {enriched} articles enriched with full text")

    boosted = boost_watchlist_relevance(article_ids)
    print(f"  ★ {boosted} articles boosted by watchlist relevance")
    return stored

if __name__ == "__main__":
    run_ingestion()
