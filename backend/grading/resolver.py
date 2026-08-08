"""
Call resolver: routes each morning_brief_calls row to a resolution method
by claim_type and returns a structured Outcome.

This is the dispatch layer for call grading. Each resolution method
implements the Grader protocol (resolve(call) -> Outcome). Method #1 is
the price + attribution grader (price_attribution.py). Future methods
(earnings outcome, economic data, event confirmation) are declared below
as interface stubs only.

Honest non-grading is a first-class outcome, not an error path: when no
registered grader can grade a call credibly, resolve() returns an
Outcome with verdict "ungradable" and an explicit machine-readable
reason in metadata["ungradable_reason"]. We refuse to grade what we
cannot grade honestly; we never force a verdict and never leave a call
silently open forever.

Verdict semantics (see price_attribution.py for the full matrix):
  correct    directional hit AND the move is cleanly attributable
  partial    directionally right but confounded/inconclusive, or flat
  wrong      moved meaningfully against the call
  ungradable no grader can grade this call credibly

The call's stored confidence field is an unguided LLM self-report and is
never read by any grader. It must not influence verdicts or attribution.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

# Verdict vocabulary. Superset of the legacy correct/wrong/partial;
# "ungradable" requires sql/0010_call_attribution_grading.sql.
VERDICT_CORRECT = "correct"
VERDICT_WRONG = "wrong"
VERDICT_PARTIAL = "partial"
VERDICT_UNGRADABLE = "ungradable"
# Not a verdict and never persisted. A call whose session candle does not exist
# YET (the session has not closed or the EOD bar is not yet published) is left
# unresolved and re-scanned next run, instead of being locked as ungradable
# forever for a temporary condition. See deferred() and is_deferred.
VERDICT_DEFERRED = "deferred"

# Attribution tags (nullable column, only set on price-graded outcomes).
ATTRIBUTION_CLEAN = "clean"
ATTRIBUTION_CONFOUNDED = "confounded"
ATTRIBUTION_INCONCLUSIVE = "inconclusive"

# Machine-readable reasons for refusing to grade.
REASON_UNMAPPED_SYMBOL = "unmapped_symbol"
REASON_NO_PRICE_DATA = "no_price_data"
REASON_NO_BENCHMARK_DATA = "no_benchmark_data"
REASON_NO_HONEST_GRADER = "no_honest_grader"


@dataclass
class Outcome:
    """Structured result of resolving one call. Maps 1:1 onto a
    morning_brief_call_outcomes row (metadata is the jsonb column)."""

    verdict: str
    attribution: str | None = None
    actual_open: float | None = None
    actual_close: float | None = None
    # Fraction (0.0123 = +1.23%), matching legacy rows. Attribution
    # thresholds work in percent points inside the grader; the stored
    # unit stays the historical one for cross-row comparability.
    actual_pct_change: float | None = None
    actual_direction: str | None = None  # up | down | flat
    metadata: dict = field(default_factory=dict)

    @property
    def is_gradable(self) -> bool:
        return self.verdict not in (VERDICT_UNGRADABLE, VERDICT_DEFERRED)

    @property
    def is_deferred(self) -> bool:
        """True when grading was postponed (transient data absence). The runner
        writes NO row for this, so the call stays unresolved and is re-scanned."""
        return self.verdict == VERDICT_DEFERRED


def ungradable(
    reason: str, detail: str, grader: str = "resolver", extra: dict | None = None
) -> Outcome:
    """Explicit, visible refusal to grade. Never a silent skip. `extra` merges
    into metadata so callers can mark, e.g., absence='permanent'."""
    meta = {
        "grader": grader,
        "ungradable_reason": reason,
        "ungradable_detail": detail,
    }
    if extra:
        meta.update(extra)
    return Outcome(verdict=VERDICT_UNGRADABLE, metadata=meta)


def deferred(reason: str, detail: str, grader: str = "resolver") -> Outcome:
    """Grading postponed: the data is absent NOW but expected to arrive (the
    session candle is not yet published). Never persisted; the call is left
    unresolved and re-scanned on the next run. Metadata marks the absence as
    transient so it is distinguishable from a permanent ungradable."""
    return Outcome(
        verdict=VERDICT_DEFERRED,
        metadata={
            "grader": grader,
            "deferred_reason": reason,
            "deferred_detail": detail,
            "absence": "transient",
        },
    )


class Grader(Protocol):
    """A resolution method. Implementations must be deterministic given
    market data and must never read the call's stored confidence."""

    name: str

    def resolve(self, call: dict) -> Outcome: ...


class CallResolver:
    """Dispatches a call to the grader registered for its claim_type."""

    def __init__(self, registry: dict[str, Grader]):
        self._registry = dict(registry)

    def resolve(self, call: dict) -> Outcome:
        claim_type = (call.get("claim_type") or "").strip().lower()
        grader = self._registry.get(claim_type)
        if grader is None:
            return ungradable(
                REASON_NO_HONEST_GRADER,
                _no_grader_detail(claim_type),
            )
        return grader.resolve(call)


def _no_grader_detail(claim_type: str) -> str:
    if claim_type == "aggregate":
        return (
            "aggregate/macro claims have no single-ticker proxy; forcing a "
            "price grade against SPY would produce false verdicts. Needs the "
            "economic-data or event-confirmation grader."
        )
    return f"no registered grader for claim_type '{claim_type or '(missing)'}'"


def default_resolver(price_grader: Grader) -> CallResolver:
    """
    Standard registry. Method #1 (price + attribution) grades ticker,
    sector, and index claims. Aggregate claims are deliberately NOT
    registered: they route to the explicit no-honest-grader outcome
    until a real macro grader exists (stubs below).
    """
    return CallResolver(
        {
            "ticker": price_grader,
            "sector": price_grader,
            "index": price_grader,
        }
    )


# ---------------------------------------------------------------------------
# Interface stubs for future resolution methods. NOT implementations and
# NOT registered in default_resolver(). Each future grader implements the
# Grader protocol and gets registered for the claim_type(s) it can grade
# honestly. Building these is explicitly out of scope for the attribution
# grader work; do not flesh them out as a side effect of other changes.
# ---------------------------------------------------------------------------


class EarningsOutcomeGrader:
    """STUB. Grade calls about earnings results (beat/miss/guidance)
    against reported EPS/revenue vs consensus, not price action."""

    name = "earnings_outcome_v0_stub"

    def resolve(self, call: dict) -> Outcome:
        raise NotImplementedError("earnings-outcome grader is a stub")


class EconomicDataGrader:
    """STUB. Grade macro/aggregate calls (CPI, jobs, rates) against the
    released economic figure. The honest home for most 'aggregate'
    claims that price attribution refuses today."""

    name = "economic_data_v0_stub"

    def resolve(self, call: dict) -> Outcome:
        raise NotImplementedError("economic-data grader is a stub")


class EventConfirmationGrader:
    """STUB. Grade calls predicting a discrete event (deal closes, product
    launches, filing lands) by confirming the event occurred."""

    name = "event_confirmation_v0_stub"

    def resolve(self, call: dict) -> Outcome:
        raise NotImplementedError("event-confirmation grader is a stub")
