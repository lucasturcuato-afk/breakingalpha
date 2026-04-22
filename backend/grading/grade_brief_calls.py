"""
Brief call grading job.

Fetches ungraded ``morning_brief_calls`` rows, pulls Finnhub market data
for the mapped symbol, computes the actual direction and verdict, then
persists the result to ``morning_brief_call_outcomes``.

Run
---
    python -m backend.grading.grade_brief_calls              # grade today only
    python -m backend.grading.grade_brief_calls --backfill   # grade all ungraded

Intended cron: 5:00 PM PT daily (after US market close), via
``/api/grading/grade-brief`` → GitHub repository_dispatch →
``.github/workflows/brief-grading.yml``.

Edge cases handled
------------------
- Missing Finnhub key → raises once at quote call, logged + skipped.
- Finnhub returns ``c == 0`` (no quote / weekend / holiday) → skip call.
- Unmapped sector name → skip with warning.
- Gemini unavailable → fall back to a one-line deterministic note.
- Insert race condition (row already graded) → caught and logged.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date

import requests
from supabase import create_client


# Sector → sector ETF (SPDR Select) mapping. Keys are lower-cased
# normalized sector labels that the claim extractor is likely to emit.
SECTOR_ETF_MAP = {
    "technology": "XLK",
    "tech": "XLK",
    "software": "XLK",
    "semiconductors": "XLK",
    "energy": "XLE",
    "oil": "XLE",
    "gas": "XLE",
    "financials": "XLF",
    "financial": "XLF",
    "banks": "XLF",
    "bank": "XLF",
    "healthcare": "XLV",
    "health": "XLV",
    "biotech": "XLV",
    "pharma": "XLV",
    "consumer discretionary": "XLY",
    "consumer disc": "XLY",
    "retail": "XLY",
    "consumer staples": "XLP",
    "staples": "XLP",
    "industrials": "XLI",
    "industrial": "XLI",
    "manufacturing": "XLI",
    "materials": "XLB",
    "mining": "XLB",
    "real estate": "XLRE",
    "reit": "XLRE",
    "utilities": "XLU",
    "utility": "XLU",
    "communications": "XLC",
    "telecom": "XLC",
    "media": "XLC",
}

SECTOR_ETF_SYMBOLS = {
    "XLK",
    "XLE",
    "XLF",
    "XLV",
    "XLY",
    "XLP",
    "XLI",
    "XLB",
    "XLRE",
    "XLU",
    "XLC",
}


def finnhub_quote(symbol: str) -> dict | None:
    """Return the Finnhub /quote payload for a symbol, or None on failure."""
    api_key = os.environ.get("FINNHUB_API_KEY")
    if not api_key:
        raise RuntimeError("FINNHUB_API_KEY not set")
    try:
        r = requests.get(
            f"https://finnhub.io/api/v1/quote?symbol={symbol}&token={api_key}",
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
        # Finnhub returns {c:0, o:0, ...} for unknown/halted/closed symbols.
        if not data.get("c"):
            return None
        return data  # { c, o, h, l, pc, t }
    except Exception as e:
        print(f"[grade] Finnhub quote failed for {symbol}: {e}", file=sys.stderr)
        return None


def determine_symbol(claim: dict) -> str | None:
    """Map a morning_brief_calls row to a Finnhub symbol to query."""
    t = claim.get("claim_type")
    sym = claim.get("target_symbol")
    if t == "aggregate":
        return "SPY"  # default broad US equity proxy
    if t in ("index", "ticker"):
        return sym
    if t == "sector":
        if sym and sym.upper() in SECTOR_ETF_SYMBOLS:
            return sym.upper()
        if sym:
            return SECTOR_ETF_MAP.get(sym.lower())
    return None


def compute_direction(pct_change: float) -> str:
    """Bucket a percent change into up/down/flat with a 0.1% dead band."""
    if pct_change > 0.001:
        return "up"
    if pct_change < -0.001:
        return "down"
    return "flat"


def compute_verdict(expected: str, actual: str) -> str:
    """Compare the claim's expected direction to the realized actual."""
    if expected == "bullish" and actual == "up":
        return "correct"
    if expected == "bearish" and actual == "down":
        return "correct"
    if expected == "neutral" and actual == "flat":
        return "correct"
    if expected == "neutral" and actual in ("up", "down"):
        return "partial"
    if expected in ("bullish", "bearish") and actual == "flat":
        return "partial"
    return "wrong"  # opposite direction


def gemini_verdict_notes(
    claim_text: str,
    expected: str,
    actual: str,
    pct_change: float,
    symbol: str,
) -> str:
    """Generate 1-2 sentence reasoning via Gemini. Graceful fallback on failure."""
    verdict = compute_verdict(expected, actual)
    try:
        from google import genai  # google-genai

        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY not set")
        client = genai.Client(api_key=api_key)
        prompt = f"""You are grading a market call from a morning brief.

Claim: {claim_text}
Expected direction: {expected}
Symbol traded: {symbol}
Actual move: {pct_change * 100:.2f}% ({actual})

Write 1-2 sentences of honest reasoning about why this call was {verdict}.
Tone: confident, never defensive. Be specific about what moved the market.
Output only the reasoning — no preamble, no formatting."""
        resp = client.models.generate_content(
            model="gemini-2.5-flash", contents=prompt
        )
        return resp.text.strip() if resp.text else ""
    except Exception as e:
        print(f"[grade] Gemini notes failed: {e}", file=sys.stderr)
        return f"{expected.capitalize()} call; {actual} close at {pct_change * 100:+.2f}%."


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Grade morning brief market calls against Finnhub quotes."
    )
    parser.add_argument(
        "--backfill",
        action="store_true",
        help="Grade all ungraded calls, not just today's.",
    )
    args = parser.parse_args()

    supabase_url = os.environ["SUPABASE_URL"]
    supabase_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    sb = create_client(supabase_url, supabase_key)

    # Fetch candidate calls.
    query = sb.table("morning_brief_calls").select("*")
    if not args.backfill:
        query = query.eq("brief_date", date.today().isoformat())
    calls = query.execute().data or []

    # Filter out already-graded calls (idempotent re-runs).
    if calls:
        graded_ids: set[str] = set()
        graded_resp = (
            sb.table("morning_brief_call_outcomes")
            .select("call_id")
            .in_("call_id", [c["id"] for c in calls])
            .execute()
        )
        for row in graded_resp.data or []:
            graded_ids.add(row["call_id"])
        calls = [c for c in calls if c["id"] not in graded_ids]

    print(f"[grade] {len(calls)} ungraded calls to process")

    for call in calls:
        symbol = determine_symbol(call)
        if not symbol:
            print(
                f"[grade] Skip {call['id']}: no symbol mapping for "
                f"{call.get('claim_type')}/{call.get('target_symbol')}"
            )
            continue
        quote = finnhub_quote(symbol)
        if not quote:
            print(f"[grade] Skip {call['id']}: no quote for {symbol}")
            continue
        close = quote.get("c")
        open_ = quote.get("o")
        if not open_ or not close:
            print(f"[grade] Skip {call['id']}: missing open/close for {symbol}")
            continue
        pct = (close - open_) / open_
        direction = compute_direction(pct)
        verdict = compute_verdict(call["expected_direction"], direction)
        notes = gemini_verdict_notes(
            call["claim_text"],
            call["expected_direction"],
            direction,
            pct,
            symbol,
        )
        try:
            sb.table("morning_brief_call_outcomes").insert(
                {
                    "call_id": call["id"],
                    "actual_open": open_,
                    "actual_close": close,
                    "actual_pct_change": pct,
                    "actual_direction": direction,
                    "verdict": verdict,
                    "verdict_notes": notes,
                }
            ).execute()
            print(
                f"[grade] Graded {call['id']}: {verdict} "
                f"({direction}, {pct * 100:+.2f}%)"
            )
        except Exception as e:
            print(f"[grade] Insert failed for {call['id']}: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
