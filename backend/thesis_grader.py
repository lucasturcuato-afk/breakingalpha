"""
thesis_grader.py — Signalera Autonomous Thesis Grading (Phase 2 + Phase 3)

Grades AI-generated theses against Finnhub market data after their horizon
window has elapsed, using Gemini 2.5 Flash to produce a verdict
(confirmed | invalidated | inconclusive) and a short notes paragraph.

Invocation
----------
Wired into `backend/run.py` as a soft-fail step after `summarize`. Also
runnable standalone as `python backend/thesis_grader.py`.

Phase 2 fields written back to `theses`:
    outcome, outcome_notes, outcome_checked_at

Phase 3 adds a `signal_breakdown` jsonb column with five signals:
    price_change_pct, options_flow, earnings_surprise,
    news_velocity, analyst_consensus

Schema
------
Run `THESES_GRADING_DDL` (below) in the Supabase SQL editor ONCE. On
startup we do a guarded `select(...).limit(1)` on each new column; if any
column is missing we log the DDL block and return cleanly (soft-fail).

Every public function is wrapped in an outer try/except and returns None
on failure — the pipeline must never crash because of this module.
"""

import os
import json
import time
import logging
from datetime import datetime, timezone, timedelta

import requests
from supabase import create_client
from google import genai
from google.genai.types import GenerateContentConfig, ThinkingConfig


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
# DDL — paste into Supabase SQL editor ONCE before this module runs
# ==========================================================================
THESES_GRADING_DDL = """
-- Signalera autonomous thesis grading
-- Run ONCE in the Supabase SQL editor. Safe to re-run (IF NOT EXISTS).

alter table theses add column if not exists horizon              text;
alter table theses add column if not exists check_after          timestamptz;
alter table theses add column if not exists verifiable_signal    text;
alter table theses add column if not exists ticker               text;
alter table theses add column if not exists outcome              text;
alter table theses add column if not exists outcome_notes        text;
alter table theses add column if not exists outcome_checked_at   timestamptz;
alter table theses add column if not exists signal_breakdown     jsonb;

create index if not exists theses_outcome_check_after_idx
    on theses (outcome, check_after);
create index if not exists theses_ticker_idx
    on theses (ticker);
"""


# Maps the horizon string stored on the thesis to a concrete timedelta.
HORIZON_DAYS = {"7d": 7, "30d": 30, "90d": 90}

# Default horizon for theses that were inserted before Phase 2B (no horizon
# column value). We still want to grade them eventually — the recon notes
# describe this as a NULLS-first heuristic with a 30-day default.
DEFAULT_HORIZON = "30d"
BACKFILL_OVERDUE_DAYS = 30


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
    """
    Verify the new columns exist. Returns True if ready to run, False
    otherwise (and logs the DDL block for the operator to paste).
    """
    try:
        probe_cols = (
            "id, horizon, check_after, verifiable_signal, ticker, "
            "outcome, outcome_notes, outcome_checked_at, signal_breakdown"
        )
        supabase.table("theses").select(probe_cols).limit(1).execute()
        return True
    except Exception as e:
        logger.error(
            "thesis_grader: missing columns on theses table (%s). "
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
    """
    Current price vs a reference price on/around `since`.

    Free-tier Finnhub does not expose arbitrary historical endpoints, so we
    approximate: use /quote for the current close price and compare against
    the open-of-day price at the time of quote retrieval. For theses older
    than a day this under-reports magnitude — the more useful Phase 3 signal
    for price is actually the %change-from-previous-close Finnhub already
    provides in the `dp` field of /quote. We use `dp` directly.
    """
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
    """
    Summarize an options chain snapshot into a tiny dict.

    Free-tier Finnhub usually 403s on /stock/option-chain; we store None in
    that case. When accessible we return {n_calls, n_puts, put_call_ratio}.
    """
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
    """
    Latest earnings surprise snapshot from /stock/earnings. Returns None
    on auth error or missing data.
    """
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
    """
    Collect all five Phase 3 signals for a ticker. Each signal is isolated
    in its own try/except — one failed endpoint never kills the others.

    Returns a dict with all five keys, each either the computed value or
    None. This dict is stored verbatim on `theses.signal_breakdown`.
    """
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
    "You are an investment thesis grader. Given a thesis, its falsifiable "
    "signal, and a bundle of market data, decide whether the thesis is "
    "confirmed, invalidated, or inconclusive based strictly on the evidence. "
    "Respond ONLY with valid JSON, no preamble."
)


def grade_with_gemini(thesis: dict, signals: dict) -> dict:
    """
    Call Gemini with the thesis text and signal bundle. Returns a dict
    {verdict, notes}. On any failure returns {verdict: 'inconclusive',
    notes: '<short error message>'}.
    """
    if gemini_client is None:
        return {"verdict": "inconclusive", "notes": "Gemini client unavailable"}

    payload = {
        "thesis": {
            "title": thesis.get("title"),
            "rationale": thesis.get("rationale"),
            "catalyst": thesis.get("catalyst"),
            "verifiable_signal": thesis.get("verifiable_signal"),
            "ticker": thesis.get("ticker"),
            "horizon": thesis.get("horizon"),
            "sector": thesis.get("sector"),
        },
        "market_data": signals,
    }
    user_content = (
        "Grade this thesis against the observed market data.\n\n"
        f"```json\n{json.dumps(payload, indent=2, default=str)}\n```\n\n"
        "Return JSON in this exact shape:\n"
        '{"verdict": "confirmed|invalidated|inconclusive", "notes": "2-3 sentence rationale"}\n\n'
        "Scoring rules:\n"
        "- confirmed: the verifiable_signal clearly matches the market data direction "
        "(e.g. price move, earnings beat, analyst upgrades, news velocity) in the thesis's favor.\n"
        "- invalidated: the signal clearly went the opposite way.\n"
        "- inconclusive: insufficient data or mixed signals. Default here when in doubt."
    )
    try:
        resp = gemini_client.models.generate_content(
            model=GEMINI_MODEL,
            contents=user_content,
            config=GenerateContentConfig(
                system_instruction=_VERDICT_SYSTEM,
                temperature=0.2,
                max_output_tokens=512,
                response_mime_type="application/json",
                thinking_config=ThinkingConfig(thinking_budget=0),
            ),
        )
        text = (resp.text or "").strip()
        text = text.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(text)
        verdict = str(parsed.get("verdict", "inconclusive")).lower()
        if verdict not in ("confirmed", "invalidated", "inconclusive"):
            verdict = "inconclusive"
        notes = str(parsed.get("notes", "")).strip()[:1000]
        return {"verdict": verdict, "notes": notes}
    except Exception as e:
        logger.warning("thesis_grader: Gemini grading failed: %s", e)
        return {"verdict": "inconclusive", "notes": f"grader error: {e}"}


# ==========================================================================
# Per-thesis grading
# ==========================================================================

def _is_overdue(thesis: dict, now: datetime) -> bool:
    """
    True when a thesis is due for grading.

    Preferred: check_after IS NOT NULL AND check_after < now.
    Fallback: check_after IS NULL AND generated_at < now - 30d (legacy rows).
    """
    ca = _parse_dt(thesis.get("check_after"))
    if ca is not None:
        return ca < now
    ga = _parse_dt(thesis.get("generated_at"))
    if ga is None:
        return False
    return ga < (now - timedelta(days=BACKFILL_OVERDUE_DAYS))


def grade_one(thesis: dict) -> dict | None:
    """
    Fetch signals for a thesis, ask Gemini for a verdict, and update the
    row. Returns the update payload on success, None on any failure.
    """
    thesis_id = thesis.get("id")
    ticker = (thesis.get("ticker") or "").strip().upper()
    if not thesis_id:
        return None
    if not ticker:
        print(f"  ⚠ thesis {thesis_id[:8]}… has no ticker — skipped")
        return None

    try:
        generated_at = _parse_dt(thesis.get("generated_at")) or datetime.now(timezone.utc)
        print(f"  → grading {ticker} ({thesis.get('title', '')[:50]}…)")
        signals = build_signal_breakdown(ticker, generated_at)
        n_signals = sum(1 for v in signals.values() if v is not None)
        print(f"    signals: {n_signals}/5 fetched (price={_r2(signals.get('price_change_pct'))}, news={signals.get('news_velocity')})")
        verdict = grade_with_gemini(thesis, signals)
        now_iso = datetime.now(timezone.utc).isoformat()

        update = {
            "outcome": verdict["verdict"],
            "outcome_notes": verdict["notes"],
            "outcome_checked_at": now_iso,
            "signal_breakdown": signals,
        }
        supabase.table("theses").update(update).eq("id", thesis_id).execute()
        print(f"    ✓ {ticker} → {verdict['verdict']}")
        logger.info(
            "thesis_grader: %s %s → %s (price=%s, news=%s)",
            thesis_id, ticker, verdict["verdict"],
            _r2(signals.get("price_change_pct")),
            signals.get("news_velocity"),
        )
        return update
    except Exception as e:
        logger.exception("thesis_grader: failed to grade %s: %s", thesis_id, e)
        return None


# ==========================================================================
# main()
# ==========================================================================

def main() -> dict | None:
    """
    Pull all theses where outcome IS NULL, filter to overdue rows, and
    grade each one. Returns a summary dict or None on catastrophic failure.
    """
    try:
        if not _preflight_schema():
            return None

        # Fetch candidates. We pull by `outcome IS NULL` then filter overdue
        # in Python because the legacy fallback (check_after IS NULL + old
        # generated_at) is cleaner expressed that way than with a compound
        # PostgREST filter.
        resp = (
            supabase.table("theses")
            .select(
                "id, title, rationale, catalyst, sector, source, "
                "ticker, horizon, check_after, generated_at, "
                "verifiable_signal, outcome"
            )
            .is_("outcome", "null")
            .order("generated_at", desc=False)
            .limit(200)
            .execute()
        )
        candidates = resp.data or []
        now = datetime.now(timezone.utc)
        overdue = [t for t in candidates if _is_overdue(t, now)]
        logger.info(
            "thesis_grader: %d candidates, %d overdue",
            len(candidates), len(overdue),
        )
        print(f"  [thesis_grader] {len(candidates)} candidates, {len(overdue)} overdue")

        graded = 0
        skipped = 0
        for t in overdue:
            update = grade_one(t)
            if update is None:
                skipped += 1
            else:
                graded += 1
            # Gentle pacing to stay inside Finnhub free-tier rate limits
            time.sleep(0.5)

        summary = {
            "candidates": len(candidates),
            "overdue": len(overdue),
            "graded": graded,
            "skipped": skipped,
        }
        print(f"  [thesis_grader] graded={graded} skipped={skipped}")
        return summary

    except Exception as e:
        logger.exception("thesis_grader.main crashed: %s", e)
        return None


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()
