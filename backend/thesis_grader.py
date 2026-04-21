"""
thesis_grader.py — Signalera Autonomous Thesis Grading (hybrid upgrade)

Grades AI-generated theses against structured market data AND adversarial
evidence (contradicting articles), using Gemini 2.5 Flash to produce a
verdict (confirmed | invalidated | inconclusive) plus confidence, notes,
key evidence ids, per-signal weights, and a contradiction flag.

Invocation
----------
Wired into `backend/run.py` as a soft-fail step after `summarize`. Also
runnable standalone as `python backend/thesis_grader.py`.

Writes
------
- `thesis_verdicts`: one append-only row per grading run (full history).
- `theses.outcome / outcome_notes / outcome_checked_at / signal_breakdown /
  confidence`: mirrored from the latest verdict so `pattern_memory` and
  `source_credibility` continue to read `theses.outcome` unchanged.
- `theses.locked_at` and `theses.expired`: set when lock/expire predicates
  fire (90d from generated_at).

Schema
------
Run `sql/grader_upgrade.sql` in the Supabase SQL editor ONCE. On startup
we do a guarded `select(...).limit(1)` on each new column + probe the
`thesis_verdicts` table; if anything is missing we log the DDL block and
return cleanly (soft-fail).

Every public function is wrapped in an outer try/except and returns None
on failure — the pipeline must never crash because of this module.
"""

import os
import json
import time
import logging
from datetime import datetime, timezone, timedelta
from typing import Any

import requests
from pydantic import BaseModel, Field, ValidationError
from supabase import create_client
from google import genai
from google.genai.types import GenerateContentConfig, ThinkingConfig

try:
    # When run as `python backend/thesis_grader.py` or via `import thesis_grader`
    # from within backend/, the local `grading/` package is on sys.path.
    from grading.features import FeatureVector, extract_rule_features
    from grading.evidence import (
        Article,
        fetch_supporting_articles,
        fetch_contradicting_candidates,
    )
except ImportError:  # when imported as backend.thesis_grader (tests, dry-run)
    from backend.grading.features import FeatureVector, extract_rule_features
    from backend.grading.evidence import (
        Article,
        fetch_supporting_articles,
        fetch_contradicting_candidates,
    )


logger = logging.getLogger(__name__)

# --- Clients ---------------------------------------------------------------

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])

try:
    gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
except Exception as e:  # missing key or import problem — degrade gracefully
    gemini_client = None
    logger.warning("thesis_grader: Gemini client unavailable (%s)", e)

GEMINI_MODEL = "gemini-2.5-flash"
FINNHUB_BASE = "https://finnhub.io/api/v1"
FINNHUB_TOKEN = os.environ.get("FINNHUB_API_KEY", "")


# ==========================================================================
# Module constants (grader upgrade)
# ==========================================================================

PROMPT_VERSION = "2.0.0"
COST_ABORT_USD = 10.0
LOCK_AGE_DAYS = 90
BACKFILL_OVERDUE_DAYS = 30
DEFAULT_HORIZON = "30d"
HORIZON_DAYS = {"7d": 7, "30d": 30, "90d": 90}

# Gemini 2.5 Flash pricing (verified 2026-04): $0.30/M input, $2.50/M output.
GEMINI_INPUT_PRICE_PER_TOKEN = 0.30 / 1_000_000
GEMINI_OUTPUT_PRICE_PER_TOKEN = 2.50 / 1_000_000


# ==========================================================================
# DDL — paste into Supabase SQL editor ONCE before this module runs
# ==========================================================================
THESES_GRADING_DDL = """
-- Grader upgrade — see sql/grader_upgrade.sql for the full idempotent block.
-- Summary:
--   CREATE TABLE thesis_verdicts (...) with public RLS.
--   ALTER TABLE theses ADD COLUMN locked_at timestamptz.
--   ALTER TABLE theses ADD COLUMN expired boolean NOT NULL DEFAULT false.
--   ALTER TABLE theses ADD COLUMN confidence numeric CHECK (0..1).
-- Indexes on thesis_verdicts (thesis_id, graded_at DESC) and (verdict).
-- Partial index on theses (expired, locked_at) WHERE outcome IS NULL.
"""


# ==========================================================================
# Helpers
# ==========================================================================

def _r4(v):
    """Round a float to 4 decimal places for Supabase storage; pass through None."""
    if v is None:
        return None
    try:
        return round(float(v), 4)
    except Exception:
        return None


def _r2(v):
    """Round a float to 2 decimal places for display/logging; pass through None."""
    if v is None:
        return None
    try:
        return round(float(v), 2)
    except Exception:
        return None


def _preflight_schema() -> bool:
    """Probe the new theses columns and thesis_verdicts table; log DDL on miss."""
    try:
        probe_cols = (
            "id, horizon, check_after, verifiable_signal, ticker, "
            "outcome, outcome_notes, outcome_checked_at, signal_breakdown, "
            "locked_at, expired, confidence"
        )
        supabase.table("theses").select(probe_cols).limit(1).execute()
        supabase.table("thesis_verdicts").select("id").limit(1).execute()
        return True
    except Exception as e:
        logger.error(
            "thesis_grader: missing schema (%s). "
            "RUN THIS IN SUPABASE SQL EDITOR:\n%s",
            e, THESES_GRADING_DDL,
        )
        return False


def _parse_dt(value) -> datetime | None:
    """Coerce a possibly-stringified timestamptz into an aware datetime."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        s = str(value).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


# ==========================================================================
# Finnhub signal fetchers (each one is fully soft-fail)
# ==========================================================================

def _finnhub_get(path: str, params: dict) -> dict | list | None:
    """GET a Finnhub endpoint; return None on any error, 403, or 429."""
    if not FINNHUB_TOKEN:
        print(f"  ⚠ Finnhub: FINNHUB_API_KEY missing — {path} skipped")
        return None
    try:
        q = dict(params)
        q["token"] = FINNHUB_TOKEN
        r = requests.get(f"{FINNHUB_BASE}{path}", params=q, timeout=15)
        if r.status_code in (403, 429):
            print(f"  ⚠ Finnhub {path} returned {r.status_code} (free-tier limit)")
            return None
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"  ⚠ Finnhub {path} failed: {e}")
        return None


def fetch_price_change(ticker: str, since: datetime) -> float | None:
    """Return Finnhub /quote.dp (percent change from previous close) for the ticker."""
    data = _finnhub_get("/quote", {"symbol": ticker})
    if not isinstance(data, dict):
        return None
    dp = data.get("dp")
    return _r4(dp)


def fetch_news_count(ticker: str, since: datetime, until: datetime) -> int | None:
    """Number of Finnhub company-news items between two dates (soft-fail)."""
    data = _finnhub_get(
        "/company-news",
        {
            "symbol": ticker,
            "from": since.date().isoformat(),
            "to": until.date().isoformat(),
        },
    )
    if data is None:
        return None
    if isinstance(data, list):
        return len(data)
    return None


def fetch_options_flow(ticker: str) -> dict | None:
    """Summarise /stock/option-chain into {n_calls, n_puts, put_call_ratio}; None on auth error."""
    data = _finnhub_get("/stock/option-chain", {"symbol": ticker})
    if not isinstance(data, dict):
        return None
    try:
        chain = data.get("data") or []
        n_calls = 0
        n_puts = 0
        for row in chain:
            opts = row.get("options") or {}
            n_calls += len(opts.get("CALL") or [])
            n_puts += len(opts.get("PUT") or [])
        pcr = None
        if n_calls:
            pcr = _r4(n_puts / n_calls)
        return {"n_calls": n_calls, "n_puts": n_puts, "put_call_ratio": pcr}
    except Exception as e:
        logger.warning("thesis_grader: options_flow parse failed for %s: %s", ticker, e)
        return None


def fetch_earnings_surprise(ticker: str) -> dict | None:
    """Return latest /stock/earnings row as {period, actual, estimate, surprise, surprise_percent}."""
    data = _finnhub_get("/stock/earnings", {"symbol": ticker, "limit": 1})
    if not isinstance(data, list) or not data:
        return None
    try:
        latest = data[0] or {}
        return {
            "period": latest.get("period"),
            "actual": _r4(latest.get("actual")),
            "estimate": _r4(latest.get("estimate")),
            "surprise": _r4(latest.get("surprise")),
            "surprise_percent": _r4(latest.get("surprisePercent")),
        }
    except Exception as e:
        logger.warning("thesis_grader: earnings parse failed for %s: %s", ticker, e)
        return None


def fetch_analyst_consensus(ticker: str) -> dict | None:
    """Latest analyst recommendation distribution (strongBuy/buy/hold/sell/strongSell)."""
    data = _finnhub_get("/stock/recommendation", {"symbol": ticker})
    if not isinstance(data, list) or not data:
        return None
    try:
        latest = data[0] or {}
        return {
            "period": latest.get("period"),
            "strong_buy": latest.get("strongBuy"),
            "buy": latest.get("buy"),
            "hold": latest.get("hold"),
            "sell": latest.get("sell"),
            "strong_sell": latest.get("strongSell"),
        }
    except Exception as e:
        logger.warning("thesis_grader: analyst parse failed for %s: %s", ticker, e)
        return None


# ==========================================================================
# Signal bundle builder (Phase 3)
# ==========================================================================

def build_signal_breakdown(ticker: str, generated_at: datetime) -> dict:
    """Collect all five Phase 3 signals for a ticker; each soft-fails independently."""
    now = datetime.now(timezone.utc)
    bundle: dict = {
        "price_change_pct": None,
        "options_flow": None,
        "earnings_surprise": None,
        "news_velocity": None,
        "analyst_consensus": None,
    }
    try:
        bundle["price_change_pct"] = fetch_price_change(ticker, generated_at)
    except Exception as e:
        logger.warning("thesis_grader: price_change_pct failed %s: %s", ticker, e)
    try:
        bundle["options_flow"] = fetch_options_flow(ticker)
    except Exception as e:
        logger.warning("thesis_grader: options_flow failed %s: %s", ticker, e)
    try:
        bundle["earnings_surprise"] = fetch_earnings_surprise(ticker)
    except Exception as e:
        logger.warning("thesis_grader: earnings_surprise failed %s: %s", ticker, e)
    try:
        bundle["news_velocity"] = fetch_news_count(ticker, generated_at, now)
    except Exception as e:
        logger.warning("thesis_grader: news_velocity failed %s: %s", ticker, e)
    try:
        bundle["analyst_consensus"] = fetch_analyst_consensus(ticker)
    except Exception as e:
        logger.warning("thesis_grader: analyst_consensus failed %s: %s", ticker, e)
    return bundle


# ==========================================================================
# Gemini verdict
# ==========================================================================

_VERDICT_SYSTEM = (
    "You are an investment thesis grader calibrating against structured market data, "
    "primary supporting evidence, and adversarial (contradicting) evidence.\n\n"
    "You MUST:\n"
    "- Weigh contradicting articles explicitly. If they disagree with the thesis in ways "
    "the supporting articles do not acknowledge, lower confidence.\n"
    "- Not reward confident writeups when adversarial signals disagree — a well-argued "
    "thesis with disconfirming evidence should land at moderate confidence, not high.\n"
    "- Default to \"inconclusive\" with confidence <= 0.4 when evidence is thin or contradictory.\n"
    "- Use \"confirmed\" only when the verifiable_signal has materialised AND contradicting "
    "signals are weak.\n"
    "- Use \"invalidated\" only when the verifiable_signal has clearly moved the wrong way.\n\n"
    "Respond with STRICT JSON only — no preamble, no code fences, no trailing commentary."
)


class SignalsWeighted(BaseModel):
    """Per-signal weights Gemini returns, each clamped to [0, 1]."""

    price_change: float = Field(ge=0.0, le=1.0)
    options_flow: float = Field(ge=0.0, le=1.0)
    earnings_surprise: float = Field(ge=0.0, le=1.0)
    news_velocity: float = Field(ge=0.0, le=1.0)
    analyst_consensus: float = Field(ge=0.0, le=1.0)
    supporting_articles: float = Field(ge=0.0, le=1.0)
    contradicting_articles: float = Field(ge=0.0, le=1.0)


class GeminiVerdict(BaseModel):
    """Strict schema for Gemini's verdict JSON output."""

    verdict: str
    confidence: float | None = None
    notes: str = ""
    key_evidence_ids: list[str] = Field(default_factory=list)
    signals_weighted: SignalsWeighted | None = None
    contradicting_evidence_considered: bool = False


def _soft_fail_verdict(note: str) -> GeminiVerdict:
    """Return the canonical inconclusive soft-fall verdict used on parse failures."""
    return GeminiVerdict(
        verdict="inconclusive",
        confidence=None,
        notes=note,
        key_evidence_ids=[],
        signals_weighted=None,
        contradicting_evidence_considered=False,
    )


def _article_to_payload(a: Article) -> dict:
    """Serialise an Article to the compact dict the LLM sees in the prompt."""
    return {
        "id": a.id,
        "title": a.title,
        "source": a.source,
        "sector": a.sector,
        "companies": a.companies or [],
        "sentiment": a.sentiment,
        "published_at": a.published_at,
        "summary": a.summary,
    }


def _build_user_prompt(
    thesis: dict,
    supporting: list[Article],
    contradicting: list[Article],
    market_signals: dict,
    features: FeatureVector,
) -> str:
    """Render the full user-side grader prompt (thesis + evidence + signals + features)."""
    thesis_payload = {
        "id": thesis.get("id"),
        "title": thesis.get("title"),
        "rationale": thesis.get("rationale"),
        "catalyst": thesis.get("catalyst"),
        "verifiable_signal": thesis.get("verifiable_signal"),
        "ticker": thesis.get("ticker"),
        "horizon": thesis.get("horizon"),
        "sector": thesis.get("sector"),
        "conviction": thesis.get("conviction"),
        "generated_at": thesis.get("generated_at"),
    }
    supporting_payload = [_article_to_payload(a) for a in supporting]
    contradicting_payload = [_article_to_payload(a) for a in contradicting]
    features_payload = features.model_dump()

    return (
        "Grade this investment thesis.\n\n"
        "THESIS:\n"
        f"{json.dumps(thesis_payload, default=str, indent=2)}\n\n"
        "SUPPORTING ARTICLES (author-selected evidence):\n"
        f"{json.dumps(supporting_payload, default=str, indent=2)}\n\n"
        "CONTRADICTING CANDIDATES (articles matching the same ticker/sector window but NOT in the thesis's supporting set):\n"
        f"{json.dumps(contradicting_payload, default=str, indent=2)}\n\n"
        "MARKET SIGNALS (Finnhub, nullable; treat missing signals as absent, not negative):\n"
        f"{json.dumps(market_signals, default=str, indent=2)}\n\n"
        "RULE FEATURES (pre-computed; use as context, do not re-derive):\n"
        f"{json.dumps(features_payload, default=str, indent=2)}\n\n"
        "Return strict JSON in this exact shape:\n"
        "{\n"
        "  \"verdict\": \"confirmed\" | \"invalidated\" | \"inconclusive\",\n"
        "  \"confidence\": <number between 0.0 and 1.0>,\n"
        "  \"notes\": \"<2-3 sentences explaining how you weighed supporting vs contradicting evidence and the key market signal>\",\n"
        "  \"key_evidence_ids\": [\"<uuid>\", ...],\n"
        "  \"signals_weighted\": {\n"
        "    \"price_change\":         <number between 0.0 and 1.0>,\n"
        "    \"options_flow\":         <number between 0.0 and 1.0>,\n"
        "    \"earnings_surprise\":    <number between 0.0 and 1.0>,\n"
        "    \"news_velocity\":        <number between 0.0 and 1.0>,\n"
        "    \"analyst_consensus\":    <number between 0.0 and 1.0>,\n"
        "    \"supporting_articles\":  <number between 0.0 and 1.0>,\n"
        "    \"contradicting_articles\": <number between 0.0 and 1.0>\n"
        "  },\n"
        "  \"contradicting_evidence_considered\": <true if the contradicting_candidates list was non-empty AND you factored it into the verdict, else false>\n"
        "}\n\n"
        "signals_weighted semantics: for each key, 0.0 means \"absent/irrelevant\", 0.5 means \"mixed or neutral\", 1.0 means \"strongly supports the observed verdict direction\". Missing market signals → 0.0."
    )


def _estimate_cost(usage: Any) -> float:
    """Compute USD cost for a single Gemini call from its usage_metadata."""
    if usage is None:
        return 0.0
    try:
        in_tokens = int(getattr(usage, "prompt_token_count", 0) or 0)
        out_tokens = int(getattr(usage, "candidates_token_count", 0) or 0)
    except Exception:
        return 0.0
    return round(
        in_tokens * GEMINI_INPUT_PRICE_PER_TOKEN
        + out_tokens * GEMINI_OUTPUT_PRICE_PER_TOKEN,
        6,
    )


def _call_gemini_once(system: str, user: str) -> tuple[str, Any]:
    """Execute one Gemini generate_content call; return (raw_text, usage_metadata)."""
    if gemini_client is None:
        raise RuntimeError("Gemini client unavailable")
    resp = gemini_client.models.generate_content(
        model=GEMINI_MODEL,
        contents=user,
        config=GenerateContentConfig(
            system_instruction=system,
            temperature=0.2,
            max_output_tokens=1024,
            response_mime_type="application/json",
            thinking_config=ThinkingConfig(thinking_budget=0),
        ),
    )
    text = (resp.text or "").strip().replace("```json", "").replace("```", "").strip()
    usage = getattr(resp, "usage_metadata", None)
    return text, usage


def _parse_verdict(text: str) -> GeminiVerdict:
    """Parse raw Gemini JSON text into a validated GeminiVerdict (raises on failure)."""
    parsed = json.loads(text)
    verdict = str(parsed.get("verdict", "")).lower()
    if verdict not in ("confirmed", "invalidated", "inconclusive"):
        verdict = "inconclusive"
    parsed["verdict"] = verdict
    confidence = parsed.get("confidence")
    if confidence is not None:
        try:
            c = float(confidence)
            parsed["confidence"] = max(0.0, min(1.0, c))
        except Exception:
            parsed["confidence"] = None
    notes = str(parsed.get("notes", "")).strip()[:2000]
    parsed["notes"] = notes
    ids_raw = parsed.get("key_evidence_ids") or []
    if isinstance(ids_raw, list):
        parsed["key_evidence_ids"] = [str(x) for x in ids_raw if x]
    else:
        parsed["key_evidence_ids"] = []
    return GeminiVerdict.model_validate(parsed)


def grade_with_gemini(system: str, user: str) -> tuple[GeminiVerdict, float]:
    """Call Gemini, parse verdict with retry-once fallback, and return (verdict, cost_usd)."""
    if gemini_client is None:
        return _soft_fail_verdict("Gemini client unavailable"), 0.0

    total_cost = 0.0
    last_raw = ""
    for attempt in (1, 2):
        try:
            text, usage = _call_gemini_once(system, user)
            total_cost += _estimate_cost(usage)
            last_raw = text
            return _parse_verdict(text), total_cost
        except (json.JSONDecodeError, ValidationError) as e:
            logger.warning(
                "thesis_grader: Gemini parse failure attempt=%d err=%s raw=%s",
                attempt, e, last_raw[:400],
            )
            if attempt == 2:
                return _soft_fail_verdict("parse error"), total_cost
        except Exception as e:
            logger.warning("thesis_grader: Gemini call failure attempt=%d err=%s", attempt, e)
            if attempt == 2:
                return _soft_fail_verdict(f"grader error: {e}"), total_cost
    return _soft_fail_verdict("parse error"), total_cost


# ==========================================================================
# Lock / expire predicates
# ==========================================================================

# Lifetime semantics for these predicates:
#   day 89: returns False (still gradable on next cycle).
#   day 90 exactly: returns False (strict `>`).
#   day 91+: returns True once a terminal verdict is reached.

def should_lock(thesis: dict, verdict: str, now: datetime) -> bool:
    """Hard-lock a thesis after a final verdict past 90d from generated_at."""
    if verdict not in ("confirmed", "invalidated"):
        return False
    gen = _parse_dt(thesis.get("generated_at"))
    if gen is None:
        return False
    return (now - gen).days > LOCK_AGE_DAYS


def should_expire(thesis: dict, verdict: str, now: datetime) -> bool:
    """Expire an inconclusive thesis once it crosses 90d from generated_at."""
    if verdict != "inconclusive":
        return False
    gen = _parse_dt(thesis.get("generated_at"))
    if gen is None:
        return False
    return (now - gen).days > LOCK_AGE_DAYS


# ==========================================================================
# Per-thesis grading
# ==========================================================================

def _is_overdue(thesis: dict, now: datetime) -> bool:
    """True when a thesis is due for grading (skips locked/expired rows)."""
    if thesis.get("locked_at") is not None:
        return False
    if thesis.get("expired") is True:
        return False
    ca = _parse_dt(thesis.get("check_after"))
    if ca is not None:
        return ca < now
    ga = _parse_dt(thesis.get("generated_at"))
    if ga is None:
        return False
    return ga < (now - timedelta(days=BACKFILL_OVERDUE_DAYS))


def _build_verdict_row(
    thesis: dict,
    verdict_obj: GeminiVerdict,
    features: FeatureVector,
    signals: dict,
    cost: float,
    contradicting_count: int,
) -> dict:
    """Construct the thesis_verdicts INSERT row — all columns populated."""
    signals_weighted: dict | None = None
    if verdict_obj.signals_weighted is not None:
        signals_weighted = verdict_obj.signals_weighted.model_dump()
    return {
        "thesis_id": thesis["id"],
        "verdict": verdict_obj.verdict,
        "confidence": verdict_obj.confidence,
        "notes": verdict_obj.notes,
        "key_evidence_ids": verdict_obj.key_evidence_ids or [],
        "signals_weighted": signals_weighted,
        "contradicting_evidence_considered": bool(
            verdict_obj.contradicting_evidence_considered and contradicting_count > 0
        ),
        "tag_overlap_count": features.tag_overlap_count,
        "new_article_count": features.new_article_count,
        "weighted_sentiment_alignment": features.weighted_sentiment_alignment,
        "source_diversity_score": features.source_diversity_score,
        "time_elapsed_days": features.time_elapsed_days,
        "supporting_vs_contradicting_ratio": features.supporting_vs_contradicting_ratio,
        "model_version": GEMINI_MODEL,
        "prompt_version": PROMPT_VERSION,
        "cost_estimate": cost,
    }


def grade_one(thesis: dict) -> dict | None:
    """Run the 10-step grading flow for one thesis; return a summary dict or None."""
    thesis_id = thesis.get("id")
    ticker = (thesis.get("ticker") or "").strip().upper()
    if not thesis_id:
        return None
    if not ticker:
        print(f"  ⚠ thesis {thesis_id[:8]}… has no ticker — skipped")
        logger.info("grader: step skip thesis=%s reason=no_ticker", thesis_id)
        return None

    try:
        now = datetime.now(timezone.utc)
        generated_at = _parse_dt(thesis.get("generated_at")) or now
        print(f"  → grading {ticker} ({(thesis.get('title') or '')[:50]}…)")

        # Step 1 — supporting articles
        supporting = fetch_supporting_articles(thesis, supabase)
        logger.info("grader: step=1 thesis=%s supporting=%d", thesis_id, len(supporting))

        # Step 2 — contradicting candidates
        contradicting = fetch_contradicting_candidates(thesis, now, supabase, limit=25)
        logger.info("grader: step=2 thesis=%s contradicting=%d", thesis_id, len(contradicting))

        # Step 3 — rule features
        supporting_dicts = [a.model_dump() for a in supporting]
        contradicting_dicts = [a.model_dump() for a in contradicting]
        features = extract_rule_features(thesis, supporting_dicts, contradicting_dicts, now)
        logger.info("grader: step=3 thesis=%s features=%s", thesis_id, features.model_dump())

        # Step 4 — market signals
        signals = build_signal_breakdown(ticker, generated_at)
        n_signals = sum(1 for v in signals.values() if v is not None)
        logger.info("grader: step=4 thesis=%s signals=%d/5", thesis_id, n_signals)
        print(
            f"    signals: {n_signals}/5 fetched "
            f"(price={_r2(signals.get('price_change_pct'))}, news={signals.get('news_velocity')})"
        )

        # Step 5 — build prompt
        user_prompt = _build_user_prompt(thesis, supporting, contradicting, signals, features)
        logger.info("grader: step=5 thesis=%s prompt_len=%d", thesis_id, len(user_prompt))

        # Step 6 — Gemini call + parse
        verdict_obj, cost = grade_with_gemini(_VERDICT_SYSTEM, user_prompt)
        logger.info(
            "grader: step=6 thesis=%s verdict=%s confidence=%s cost_usd=%s",
            thesis_id, verdict_obj.verdict, verdict_obj.confidence, cost,
        )

        # Step 7 — insert thesis_verdicts row
        verdict_row = _build_verdict_row(
            thesis, verdict_obj, features, signals, cost, len(contradicting)
        )
        supabase.table("thesis_verdicts").insert(verdict_row).execute()
        logger.info("grader: step=7 thesis=%s verdict_row_inserted=1", thesis_id)

        # Steps 8/9/10 — combined theses update (outcome mirror + lock + expire)
        now_iso = now.isoformat()
        update: dict = {
            "outcome": verdict_obj.verdict,
            "outcome_notes": verdict_obj.notes,
            "outcome_checked_at": now_iso,
            "signal_breakdown": signals,
            "confidence": verdict_obj.confidence,
        }
        locked = should_lock(thesis, verdict_obj.verdict, now)
        expired = should_expire(thesis, verdict_obj.verdict, now)
        if locked:
            update["locked_at"] = now_iso
        if expired:
            update["expired"] = True
        supabase.table("theses").update(update).eq("id", thesis_id).execute()
        logger.info(
            "grader: step=8-10 thesis=%s outcome=%s locked=%s expired=%s",
            thesis_id, verdict_obj.verdict, locked, expired,
        )

        print(f"    ✓ {ticker} → {verdict_obj.verdict} (conf={verdict_obj.confidence})")
        return {
            "thesis_id": thesis_id,
            "verdict": verdict_obj.verdict,
            "confidence": verdict_obj.confidence,
            "cost": cost,
            "locked": locked,
            "expired": expired,
        }
    except Exception as e:
        logger.exception("thesis_grader: failed to grade %s: %s", thesis_id, e)
        return None


# ==========================================================================
# main()
# ==========================================================================

def main(force: bool = False) -> dict | None:
    """
    Pull all theses where outcome IS NULL, filter to overdue rows, and
    grade each one. Returns a summary dict or None on catastrophic failure.

    When ``force=True``, the ``_is_overdue()`` gate is bypassed and every
    ungraded candidate is graded immediately. Intended for backfill and
    manual/on-demand runs (cron-job.org → /api/grading/trigger → workflow).
    """
    try:
        if not _preflight_schema():
            return None

        resp = (
            supabase.table("theses")
            .select(
                "id, title, rationale, catalyst, sector, source, "
                "ticker, horizon, check_after, generated_at, "
                "verifiable_signal, outcome, supporting_articles, "
                "conviction, locked_at, expired"
            )
            .is_("outcome", "null")
            .is_("locked_at", "null")
            .eq("expired", False)
            .order("generated_at", desc=False)
            .limit(200)
            .execute()
        )
        candidates = resp.data or []
        now = datetime.now(timezone.utc)
        if force:
            overdue = candidates
            logger.info(
                "thesis_grader: FORCE mode — grading all %d ungraded candidates",
                len(candidates),
            )
            print(
                f"  [thesis_grader] FORCE mode — grading all {len(candidates)} ungraded candidates"
            )
        else:
            overdue = [t for t in candidates if _is_overdue(t, now)]
        logger.info(
            "thesis_grader: %d candidates, %d overdue (force=%s)",
            len(candidates), len(overdue), force,
        )
        print(
            f"  [thesis_grader] {len(candidates)} candidates, "
            f"{len(overdue)} overdue (force={force})"
        )

        graded = 0
        skipped = 0
        total_cost = 0.0
        aborted = False
        for t in overdue:
            result = grade_one(t)
            if result is None:
                skipped += 1
            else:
                graded += 1
                total_cost += float(result.get("cost") or 0.0)
                if total_cost > COST_ABORT_USD:
                    logger.warning(
                        "thesis_grader: cost ceiling breached ($%s > $%s) — aborting",
                        round(total_cost, 4), COST_ABORT_USD,
                    )
                    print(
                        f"  ⚠ cost ceiling breached (${round(total_cost, 4)} > "
                        f"${COST_ABORT_USD}) — aborting"
                    )
                    aborted = True
                    break
            # Gentle pacing to stay inside Finnhub free-tier rate limits
            time.sleep(0.5)

        summary = {
            "candidates": len(candidates),
            "overdue": len(overdue),
            "graded": graded,
            "skipped": skipped,
            "total_cost_usd": round(total_cost, 6),
            "aborted": aborted,
        }
        print(
            f"  [thesis_grader] graded={graded} skipped={skipped} "
            f"cost=${round(total_cost, 6)} aborted={aborted}"
        )
        return summary

    except Exception as e:
        logger.exception("thesis_grader.main crashed: %s", e)
        return None


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    _force_env = os.environ.get("THESIS_GRADER_FORCE", "").strip().lower() in (
        "1", "true", "yes", "on",
    )
    main(force=_force_env)
