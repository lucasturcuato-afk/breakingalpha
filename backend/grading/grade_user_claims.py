"""
User-claim grading job (runner).

Grades due Radar user claims through the EXISTING attribution grader and
writes outcomes to ``user_claim_outcomes``. This mirrors the brief-call
path in grade_brief_calls.py: same resolver, same grader, same verdict
and attribution vocabulary; only the source and destination tables
differ. The grader logic is not forked.

Which claims are picked up (all conditions required):
  - source in GRADEABLE_SOURCES ('authored', 'adopted')
  - gradeable = true and resolution_method.method = 'price_attribution'
  - status = 'open' and resolution_window_end <= today (window closed)

Adopted claims used to be excluded here (source = 'authored' only), on the
premise that they inherit the original brief call's verdict. That stopped
being true once adopt started writing a REAL forward window and a
validation-derived gradeable of its own: an adopted claim is a fresh claim
from the day it was tracked, over a window the USER chose, which is
generally not the brief call's window. Inheriting the brief's same-session
verdict would answer a different question than the one the user asked, and
excluding them meant a tracked call simply never resolved at all.

Nothing about grading them is special-cased. An adopted claim carries its
own resolution_window_start/_end, so claim_to_call maps it exactly like an
authored one, the same resolver and thresholds apply, and it gets its own
user_claim_outcomes row keyed on its own claim id. adopted_from_call_id is
provenance only and is never read here.

Multi-session windows use the sqrt(sessions)-scaled tier path added to
price_attribution.py; single-session claims grade exactly like brief
calls. Live-forward: a claim is graded once, over its own declared
window, when that window closes.

Graceful degradation: if the user_claims / user_claim_outcomes tables do
not exist yet (migration sql/0012 not applied), this job logs and exits
0 so the shared grading workflow never fails on it.

Run
---
    python -m backend.grading.grade_user_claims
"""

from __future__ import annotations

import os
import sys
from datetime import date

from supabase import create_client

from backend.grading.benchmarks import sectors_for_tickers
from backend.grading.grade_brief_calls import gemini_verdict_notes, ungradable_notes
from backend.grading.price_attribution import PriceAttributionGrader
from backend.grading.resolver import Outcome, default_resolver


#: Claim sources whose claims this job grades.
#:
#: Enumerated rather than dropped, deliberately. user_claims.source is CHECKed
#: to ('authored','adopted') today, so this is currently every value, but a
#: future source (an imported or shared claim, say) must be an explicit decision
#: to grade rather than something a widened scan sweeps in silently.
GRADEABLE_SOURCES = ("authored", "adopted")


def fetch_due_claims(sb, today: str) -> list[dict]:
    """
    Claims whose window has closed and which are still open, before the
    price-gradeability and already-graded filters.

    Index-backed by idx_user_claims_due. That index carried a
    source = 'authored' predicate matching the old scan; sql/0015 rebuilds it
    without one, so this query stays index-backed rather than falling back to a
    sequential scan.
    """
    return (
        sb.table("user_claims")
        .select("*")
        .in_("source", list(GRADEABLE_SOURCES))
        .eq("gradeable", True)
        .eq("status", "open")
        .lte("resolution_window_end", today)
        .execute()
        .data
        or []
    )


def claim_to_call(claim: dict) -> dict:
    """Map a user_claims row onto the call-dict shape the resolver grades.
    brief_date = the window's closing session; window_start widens it."""
    return {
        "id": claim["id"],
        "claim_type": claim.get("claim_type"),
        "target_symbol": claim.get("target_symbol"),
        "expected_direction": claim.get("expected_direction"),
        "brief_date": claim.get("resolution_window_end"),
        "window_start": claim.get("resolution_window_start"),
    }


def is_price_gradeable(claim: dict) -> bool:
    if not claim.get("gradeable"):
        return False
    method = (claim.get("resolution_method") or {}).get("method")
    return method == "price_attribution"


def outcome_row(claim: dict, outcome: Outcome, notes: str) -> dict:
    return {
        "claim_id": claim["id"],
        "actual_open": outcome.actual_open,
        "actual_close": outcome.actual_close,
        "actual_pct_change": outcome.actual_pct_change,
        "actual_direction": outcome.actual_direction,
        "verdict": outcome.verdict,
        "attribution": outcome.attribution,
        "metadata": outcome.metadata,
        "verdict_notes": notes,
    }


def main() -> None:
    supabase_url = os.environ["SUPABASE_URL"]
    supabase_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    sb = create_client(supabase_url, supabase_key)

    today = date.today().isoformat()
    try:
        claims = fetch_due_claims(sb, today)
    except Exception as e:
        # Table not applied yet (or transient): degrade gracefully, never
        # fail the shared grading workflow.
        print(f"[claims] user_claims unavailable, skipping run: {e}", file=sys.stderr)
        return

    claims = [c for c in claims if is_price_gradeable(c)]

    # Idempotent re-runs: skip claims that already have an outcome row.
    if claims:
        try:
            graded_resp = (
                sb.table("user_claim_outcomes")
                .select("claim_id")
                .in_("claim_id", [c["id"] for c in claims])
                .execute()
            )
            graded_ids = {row["claim_id"] for row in graded_resp.data or []}
            claims = [c for c in claims if c["id"] not in graded_ids]
        except Exception as e:
            print(f"[claims] outcomes lookup failed, skipping run: {e}", file=sys.stderr)
            return

    print(f"[claims] {len(claims)} due user claims to grade")
    if not claims:
        return

    tickers = {
        (c.get("target_symbol") or "").strip().upper()
        for c in claims
        if c.get("claim_type") == "ticker" and c.get("target_symbol")
    }
    ticker_sectors = sectors_for_tickers(sb, tickers)
    resolver = default_resolver(PriceAttributionGrader(ticker_sectors=ticker_sectors))

    graded = ungraded = failed = 0
    for claim in claims:
        outcome = resolver.resolve(claim_to_call(claim))
        if outcome.is_gradable:
            notes = gemini_verdict_notes(
                claim["user_claim"], claim.get("expected_direction") or "", outcome
            )
        else:
            notes = ungradable_notes(outcome)
        try:
            sb.table("user_claim_outcomes").insert(
                outcome_row(claim, outcome, notes)
            ).execute()
            sb.table("user_claims").update(
                {"status": "graded" if outcome.is_gradable else "ungradable"}
            ).eq("id", claim["id"]).execute()
        except Exception as e:
            failed += 1
            print(f"[claims] write failed for {claim['id']}: {e}", file=sys.stderr)
            continue
        if outcome.is_gradable:
            graded += 1
            print(
                f"[claims] Graded {claim['id']}: {outcome.verdict}/{outcome.attribution}"
            )
        else:
            ungraded += 1
            print(
                f"[claims] Ungradable {claim['id']}: "
                f"{outcome.metadata.get('ungradable_reason')}"
            )

    print(f"[claims] Done: {graded} graded, {ungraded} ungradable, {failed} failed")


if __name__ == "__main__":
    main()
