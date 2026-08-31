"""
Brief call grading job (runner).

Fetches today's ungraded ``morning_brief_calls`` rows, resolves each one
through the claim_type router (backend/grading/resolver.py), and persists
the structured outcome to ``morning_brief_call_outcomes``.

Grading is attribution-aware (backend/grading/price_attribution.py): a
call is only credited when the named entity moved meaningfully beyond
its sector/market benchmark in the predicted direction. Calls that
cannot be graded honestly (aggregate/macro claims, unmapped symbols,
missing price or benchmark data) are recorded with verdict "ungradable"
and an explicit reason instead of being silently skipped.

Requires sql/0010_call_attribution_grading.sql to be applied first
(attribution + metadata columns, "ungradable" verdict, nullable
actual_direction).

Live-forward only. There is deliberately NO backfill mode: grading old
calls produces verdicts nobody stood behind at the time, and the legacy
quote-based backfill graded them against today's prices, which is worse.

Resolution horizons (HORIZON_GRADING_MODE, default off)
-------------------------------------------------------
off     selection is today's calls only, byte-identical to the behavior
        before horizons existed.
active  due-scan: calls whose ``resolve_on`` has passed, each graded over
        the window it declared at creation, [brief_date, resolve_on].

Still live-forward. A due-scan is not a backfill: it grades a call once,
over the window that call itself declared, at the moment that window
closes. This is exactly what grade_user_claims.py already does for
authored claims. The distinction is enforced structurally: the scan
requires ``resolve_on IS NOT NULL``, and every call written before
migration 0014 has it NULL, so the historical backlog can never be swept
into a run no matter how the flag is set.

Run
---
    python -m backend.grading.grade_brief_calls    # grade today only

Intended cron: 5:00 PM PT daily (after US market close), via
``/api/grading/grade-brief`` -> GitHub repository_dispatch ->
``.github/workflows/brief-grading.yml``.

All market data flows through the paced backend/market_data.py helper
(0.5s between Finnhub calls); this module makes no HTTP requests itself.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date

from supabase import create_client

# Re-exported for compatibility: the sector map lived here historically.
from backend.grading.benchmarks import (  # noqa: F401
    SECTOR_ETF_MAP,
    SECTOR_ETF_SYMBOLS,
    sectors_for_tickers,
)
from backend.grading.price_attribution import PriceAttributionGrader
from backend.grading.resolver import Outcome, default_resolver
from backend.verdict_vocabulary import VERDICT_WORD, verdict_word


#: Whether the grading loop may call an LLM at all.
#:
#: DEFAULT OFF. Grading is pure price math: the verdict, the attribution, the
#: checkpoints and the long-horizon panel are all deterministic arithmetic, and
#: the only LLM that was ever in this loop wrote the display sentence AFTER the
#: verdict was already decided. That still cost one Gemini request per graded
#: call and made "no LLM in the grading loop" untrue, so it is now opt-in.
#:
#: Off, verdict_notes is the deterministic sentence built from the same numbers
#: the card already renders, so nothing is lost but the prose styling, and a
#: grading run costs exactly zero API spend beyond the price fetches.
#: Set GRADER_LLM_NOTES=1 to restore the generated prose.
def _llm_notes_enabled() -> bool:
    return os.environ.get("GRADER_LLM_NOTES", "").strip().lower() in {"1", "true", "yes"}


#: The attribution axis in the words the product already uses for it:
#: DESK_RECORD_COPY.attributionLabel in src/lib/desk-record.ts is Clean /
#: Confounded / Inconclusive / Not attributed, and cleanAttributionLine in
#: src/lib/scored-object-map.ts already renders "Attribution: clean" beside
#: this very sentence. Lowercase because these sit mid-sentence here.
#:
#: Attribution is a SEPARATE AXIS from direction and the sentence has to read
#: that way. A clean read is what lets a direction be credited at all; it is
#: never itself the outcome, and stapling it to the outcome in parentheses
#: presented it as one.
ATTRIBUTION_LABEL: dict[str, str] = {
    "clean": "clean",
    "confounded": "confounded",
    "inconclusive": "inconclusive",
}

#: A row with no attribution. Matches DESK_RECORD_COPY.attributionLabel.
DEFAULT_ATTRIBUTION_LABEL = "not recorded"

#: Attribution that can never be credited to the thesis, whatever direction
#: prices went. Same rule, same reason, as scoredCallProps in
#: src/lib/scored-object-map.ts: "attribution wins over raw direction".
UNCREDITABLE_ATTRIBUTIONS = frozenset({"confounded", "inconclusive"})


def outcome_word(outcome: Outcome) -> str:
    """The reader-facing outcome word for a graded row, attribution included.

    verdict_vocabulary.verdict_word() reads the direction axis only. A move the
    grader could not separate from its sector or the market is No clean read
    however the direction went, so a confounded or inconclusive row is bucketed
    on attribution first. Without this the note would say "Challenged" next to a
    card reading "No clean read" for the same row.
    """
    if (outcome.attribution or "") in UNCREDITABLE_ATTRIBUTIONS:
        return VERDICT_WORD["noCleanRead"]
    return verdict_word(outcome.verdict)


def gemini_verdict_notes(claim_text: str, expected: str, outcome: Outcome) -> str:
    """The verdict sentence. Deterministic by default (no network, no spend);
    optionally phrased by Gemini when GRADER_LLM_NOTES is set. The verdict
    itself is computed before this runs either way, and any failure falls back
    to the deterministic text.

    The outcome word comes from backend/verdict_vocabulary.py, the one table
    every surface reads, so this sentence cannot say something the card beside
    it does not. It used to interpolate the STORED verdict token, which is
    "correct" / "wrong": a raw column value leaking into reader-facing prose,
    outside the observational vocabulary, in the exact position a verdict is
    read from. Two screens rendered it (/review and /radar/calls, both via
    ScoredObject's calibration slot) because both carry verdict_notes verbatim.
    """
    meta = outcome.metadata
    entity_pct = meta.get("entity_move_pct")
    word = outcome_word(outcome)
    attr = ATTRIBUTION_LABEL.get(outcome.attribution or "", DEFAULT_ATTRIBUTION_LABEL)
    fallback = (
        f"{word}. {expected.capitalize()} call, attribution {attr}:"
        f" {meta.get('entity_symbol')}"
        f" moved {entity_pct:+.2f}% vs "
        + (
            ", ".join(
                f"{b['symbol']} {b['move_pct']:+.2f}%"
                for b in meta.get("benchmarks", [])
            )
            or "no benchmark"
        )
        + "."
    )
    if not _llm_notes_enabled():
        return fallback

    try:
        from google import genai  # google-genai

        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY not set")
        client = genai.Client(api_key=api_key)
        bench_lines = "\n".join(
            f"- {b['role']} benchmark {b['symbol']}: {b['move_pct']:+.2f}% "
            f"(entity excess {b['excess_pct']:+.2f}%)"
            for b in meta.get("benchmarks", [])
        ) or "- none (broad index, graded on absolute move)"
        prompt = f"""You are grading a market call from a morning brief with benchmark attribution.

Claim: {claim_text}
Expected direction: {expected}
Entity: {meta.get("entity_symbol")} moved {entity_pct:+.2f}% ({outcome.actual_direction})
Benchmarks over the same session:
{bench_lines}
Attribution: {outcome.attribution} (clean = moved beyond benchmarks; confounded = market/sector carried it; inconclusive = below threshold)
Outcome: {word}

Write 1-2 sentences of honest reasoning about why the evidence reads {word}.
The outcome vocabulary is exactly supported / challenged / developing / awaiting.
Never write that a call was right, wrong, correct or incorrect: a claim is
supported or challenged by evidence, and the person who made it is neither.
If the attribution is confounded, say plainly that the market or sector move explains it.
Tone: confident, never defensive. Output only the reasoning, no preamble, no formatting."""
        resp = client.models.generate_content(
            model="gemini-2.5-flash", contents=prompt
        )
        return resp.text.strip() if resp.text else fallback
    except Exception as e:
        print(f"[grade] Gemini notes failed: {e}", file=sys.stderr)
        return fallback


def ungradable_notes(outcome: Outcome) -> str:
    """Deterministic, human-readable refusal reason. No LLM: we do not
    ask a model to narrate why we declined to grade."""
    reason = outcome.metadata.get("ungradable_reason", "unknown")
    detail = outcome.metadata.get("ungradable_detail", "")
    labels = {
        "unmapped_symbol": "Not graded: unmapped symbol.",
        "no_price_data": "Not graded: no price data for the session.",
        "no_benchmark_data": "Not graded: benchmark data unavailable.",
        "no_honest_grader": "Not graded: no honest grader for this claim type yet.",
    }
    label = labels.get(reason, f"Not graded: {reason}.")
    return f"{label} {detail}".strip()


#: Three-state flag, mirroring the PERSONALIZATION_MODE / MATERIALITY_RANK_MODE
#: idiom used elsewhere in the repo.
#:   off    -> selection is byte-identical to the pre-horizons behavior
#:             (today's calls only). This is the DEFAULT.
#:   active -> due-scan: calls whose resolve_on has passed, graded over the
#:             window [brief_date, resolve_on].
#: Anything unrecognized resolves to off. A typo must never silently widen
#: what gets graded.
HORIZON_MODE_OFF = "off"
HORIZON_MODE_ACTIVE = "active"


def horizon_grading_mode(env: dict | None = None) -> str:
    """Resolve HORIZON_GRADING_MODE. Unknown or unset -> off."""
    source = env if env is not None else os.environ
    raw = (source.get("HORIZON_GRADING_MODE") or "").strip().lower()
    return HORIZON_MODE_ACTIVE if raw == HORIZON_MODE_ACTIVE else HORIZON_MODE_OFF


def is_due(call: dict, today: str) -> bool:
    """
    Is this call's window closed?

    A call is due ONLY when resolve_on is present and on or before today.

    resolve_on IS NOT NULL is load-bearing and must not be relaxed to
    COALESCE(resolve_on, brief_date). Every call written before migration 0014
    has resolve_on NULL, and coalescing would make all of them due in a single
    run, grading months of history against prices nobody stood behind at the
    time. That is the mass-backfill this module already refuses on the CLI. NULL
    rows are structurally excluded, permanently.
    """
    resolve_on = call.get("resolve_on")
    if not resolve_on:
        return False
    return str(resolve_on)[:10] <= today


def call_to_graded_input(call: dict, mode: str) -> dict:
    """
    Map a call row onto the dict the resolver grades.

    Mirrors grade_user_claims.claim_to_call: price_attribution treats brief_date
    as the window's CLOSING session and window_start as the opening one, so a
    horizon-aware call grades over [brief_date, resolve_on]. It counts the real
    sessions in that span itself and scales its thresholds by sqrt(sessions);
    nothing in price_attribution.py changes.

    In off mode, or for a call with no resolve_on, the row passes through
    untouched and the window collapses to the single brief_date session.
    """
    if mode != HORIZON_MODE_ACTIVE:
        return call
    resolve_on = call.get("resolve_on")
    if not resolve_on:
        return call
    return {
        **call,
        "brief_date": resolve_on,
        "window_start": call.get("brief_date"),
    }


def fetch_due_calls(sb, today: str, mode: str) -> list[dict]:
    """
    The calls this run should grade, before the already-graded filter.

    off    -> brief_date == today (unchanged).
    active -> resolve_on IS NOT NULL AND resolve_on <= today.
    """
    q = sb.table("morning_brief_calls").select("*")
    if mode == HORIZON_MODE_ACTIVE:
        q = q.not_.is_("resolve_on", "null").lte("resolve_on", today)
    else:
        q = q.eq("brief_date", today)
    return q.execute().data or []


def outcome_row(call: dict, outcome: Outcome, notes: str) -> dict:
    return {
        "call_id": call["id"],
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
    parser = argparse.ArgumentParser(
        description=(
            "Grade today's morning brief calls with benchmark attribution. "
            "Live-forward only; there is no backfill mode."
        )
    )
    args, unknown = parser.parse_known_args()
    del args
    if unknown:
        # Fail loudly on --backfill (or anything else): grading old calls
        # is banned, not silently ignored.
        print(
            f"[grade] Unsupported arguments {unknown}. Backfill grading was "
            "removed: grading old calls produces false verdicts.",
            file=sys.stderr,
        )
        raise SystemExit(2)

    supabase_url = os.environ["SUPABASE_URL"]
    supabase_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    sb = create_client(supabase_url, supabase_key)

    today = date.today().isoformat()
    mode = horizon_grading_mode()

    # off: today's calls only (live-forward, unchanged).
    # active: due-scan over resolve_on. Still live-forward: a call is graded
    # once, over the window IT declared, when that window closes. Calls with a
    # NULL resolve_on (everything written before migration 0014) are never
    # selected in either mode.
    calls = fetch_due_calls(sb, today, mode)
    print(f"[grade] horizon mode: {mode} ({len(calls)} candidate calls)")

    # Filter out already-graded calls (idempotent re-runs).
    if calls:
        graded_resp = (
            sb.table("morning_brief_call_outcomes")
            .select("call_id")
            .in_("call_id", [c["id"] for c in calls])
            .execute()
        )
        graded_ids = {row["call_id"] for row in graded_resp.data or []}
        calls = [c for c in calls if c["id"] not in graded_ids]

    print(f"[grade] {len(calls)} ungraded calls to process")
    if not calls:
        return

    # One batched companies lookup for every ticker claim in the run.
    tickers = {
        (c.get("target_symbol") or "").strip().upper()
        for c in calls
        if c.get("claim_type") == "ticker" and c.get("target_symbol")
    }
    ticker_sectors = sectors_for_tickers(sb, tickers)

    resolver = default_resolver(PriceAttributionGrader(ticker_sectors=ticker_sectors))

    graded = ungraded = failed = deferred_count = 0
    for call in calls:
        outcome = resolver.resolve(call_to_graded_input(call, mode))
        # Transient data absence: write NOTHING so the call stays unresolved and
        # is re-scanned next run once its candle is published. Never lock a call
        # ungradable for a temporary condition.
        if outcome.is_deferred:
            deferred_count += 1
            print(
                f"[grade] Deferred {call['id']}: "
                f"{outcome.metadata.get('deferred_detail')}"
            )
            continue
        if outcome.is_gradable:
            notes = gemini_verdict_notes(
                call["claim_text"], call["expected_direction"], outcome
            )
        else:
            notes = ungradable_notes(outcome)
        try:
            sb.table("morning_brief_call_outcomes").insert(
                outcome_row(call, outcome, notes)
            ).execute()
        except Exception as e:
            failed += 1
            print(f"[grade] Insert failed for {call['id']}: {e}", file=sys.stderr)
            continue
        if outcome.is_gradable:
            graded += 1
            print(
                f"[grade] Graded {call['id']}: {outcome.verdict}/{outcome.attribution} "
                f"({outcome.actual_direction}, "
                f"{(outcome.actual_pct_change or 0) * 100:+.2f}%)"
            )
        else:
            ungraded += 1
            print(
                f"[grade] Ungradable {call['id']}: "
                f"{outcome.metadata.get('ungradable_reason')}"
            )

    print(
        f"[grade] Done: {graded} graded, {ungraded} ungradable, "
        f"{deferred_count} deferred, {failed} failed"
    )


if __name__ == "__main__":
    main()
