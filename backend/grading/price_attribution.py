"""
Price + attribution grader (resolution method #1).

Replaces the naive "any move in the predicted direction = correct" rule.
A call is only credited when the named entity moved meaningfully beyond
its benchmark(s) in the predicted direction. A stock that merely rose
with a market-wide rally is confounded, not correct.

Benchmarks by claim_type
    ticker  its sector ETF (companies.sector -> SECTOR_ETF_MAP) and SPY.
            Unknown sector: graded against SPY only, recorded in
            metadata.benchmark_coverage and penalized in
            attribution_confidence. A known sector whose ETF data fails
            to fetch is ungradable (no_benchmark_data), not guessed.
    sector  the sector ETF is the entity, benchmarked against SPY.
    index   the index IS the market, so there is no benchmark; graded on
            its absolute move against the tight broad-index bar.
    aggregate  never reaches this grader (router sends it to the
            explicit no-honest-grader outcome).

Thresholds: asset-class tiers (Option B)
    Fixed, named, documented percent-point bars per asset class, chosen
    to right-size "meaningful move" without live historical-volatility
    computation. dead_band_pct buckets the realized direction
    (up/down/flat); min_excess_pct is the crediting bar the entity must
    clear beyond EVERY benchmark for a clean attribution. Tier
    resolution is isolated in resolve_tier() so a specific claim_type
    can later be upgraded to per-stock realized volatility (Option A)
    without restructuring: replace the lookup for that claim_type,
    everything downstream already consumes an AttributionTier value.

Verdict x attribution matrix (bullish; bearish is mirrored)
    realized up, excess >= min_excess vs all benchmarks  correct / clean
    realized up, a benchmark also rallied meaningfully   partial / confounded
    realized up, below bar, benchmarks quiet             partial / inconclusive
    realized flat                                        partial / inconclusive
    realized down                                        wrong (attribution
                                                         tags whether the drop
                                                         was its own or market)
    neutral calls: flat while benchmarks moved = correct / clean (it
    demonstrably decoupled); flat while everything was flat = partial /
    confounded (the flat market carried the flatness, no credit).

    Verdicts are absolute-direction-first: attribution gates crediting,
    it never upgrades a directional miss into a hit. Relative
    outperformance on a missed call is visible in metadata, not the verdict.

Confidence: this grader NEVER reads the call's stored confidence field
(unguided LLM self-report, unvalidated). It emits its own
attribution_confidence in metadata, derived only from how decisively the
price/benchmark comparison cleared or failed the bars.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from typing import Callable, Mapping, Optional

from backend.grading.benchmarks import (
    BROAD_INDEX_ETFS,
    MARKET_BENCHMARK,
    SECTOR_ETF_SYMBOLS,
    normalize_index_symbol,
    sector_etf_for_label,
)
from backend.grading.resolver import (
    ATTRIBUTION_CLEAN,
    ATTRIBUTION_CONFOUNDED,
    ATTRIBUTION_INCONCLUSIVE,
    REASON_NO_BENCHMARK_DATA,
    REASON_NO_PRICE_DATA,
    REASON_UNMAPPED_SYMBOL,
    VERDICT_CORRECT,
    VERDICT_PARTIAL,
    VERDICT_WRONG,
    Outcome,
    deferred,
    ungradable,
)
from backend.market_data import fetch_historical_candle

GRADER_NAME = "price_attribution_v1"


@dataclass(frozen=True)
class AttributionTier:
    """Named threshold tier for one asset class. All values are percent
    points over the grading window (one trading session)."""

    name: str
    # Below this absolute move the entity is bucketed as flat.
    dead_band_pct: float
    # The entity must beat every benchmark by at least this much, in the
    # realized direction, for the move to be cleanly attributable. For
    # benchmark-free entities (indices) it is the absolute crediting bar.
    min_excess_pct: float


# Tier constants (Option B). Tune here; nothing else hardcodes bars.
# Rough sizing logic against typical daily volatility:
#   broad index   SPY daily sigma ~0.9%: 0.50% is a real market day.
#   sector ETF    sigma ~1.2%: must beat SPY by 0.50% to be a sector story.
#   single stock  idiosyncratic sigma ~1.5%: 0.75% beyond sector AND market.
#   high vol      sigma 3%+: 1.50% excess, noise clears smaller bars daily.
TIER_BROAD_INDEX = AttributionTier("broad_index", dead_band_pct=0.25, min_excess_pct=0.50)
TIER_SECTOR_ETF = AttributionTier("sector_etf", dead_band_pct=0.30, min_excess_pct=0.50)
TIER_SINGLE_STOCK = AttributionTier("single_stock", dead_band_pct=0.50, min_excess_pct=0.75)
TIER_HIGH_VOL = AttributionTier("high_vol", dead_band_pct=1.00, min_excess_pct=1.50)

# Manually curated high-volatility names. Placeholder for Option A
# (per-stock realized volatility); keep short and obvious.
HIGH_VOL_TICKERS = {
    "TSLA", "COIN", "MSTR", "GME", "AMC", "RIOT", "MARA", "HOOD",
    "PLTR", "SMCI", "AFRM", "UPST", "CVNA", "IONQ", "RIVN", "LCID",
}


def resolve_tier(claim_type: str, symbol: str) -> AttributionTier:
    """Single seam for tier assignment. Option A upgrade path: swap the
    static lookup for a realized-volatility computation per claim_type."""
    sym = symbol.upper()
    if claim_type == "index" or sym in BROAD_INDEX_ETFS:
        return TIER_BROAD_INDEX
    if claim_type == "sector" or sym in SECTOR_ETF_SYMBOLS:
        return TIER_SECTOR_ETF
    if sym in HIGH_VOL_TICKERS:
        return TIER_HIGH_VOL
    return TIER_SINGLE_STOCK


# ==========================================================================
# LONG-HORIZON PANEL (checkpoints + strict agreement + cleanliness grade)
# ==========================================================================
#
# A 90-day call that sat flat for 80 sessions and jumped once on the 89th
# grades identically to one that beat its benchmarks the whole way. Both clear
# the terminal bar; only one of them is a clean read. The panel separates them
# WITHOUT touching the bar.
#
# THE ONE INVARIANT. The panel is a one-directional gate on crediting. Its only
# permitted transition is
#
#     (correct, clean)  ->  (partial, inconclusive)      i.e. "no clean read"
#
# It can never create a correct, never convert a wrong into anything, and never
# raise an attribution. Removing a WIN lowers the hit rate under both of the
# rates this codebase computes (right/(right+wrong) on the dashboard, and
# correct/(correct+wrong+partial) on the briefs); removing a LOSS would raise
# the first one, which is precisely why losses are untouchable here. See
# apply_long_horizon_panel and its property test in
# backend/tests/test_long_horizon_panel.py.
#
# NO LLM, NO EXTRA IO. Checkpoints are read off the daily bar series that
# fetch_historical_candle already returns for the terminal grade, so the panel
# adds zero API requests, zero rows and zero scheduled jobs.

#: Sessions below which a call is SHORT: the terminal benchmark attribution
#: stands alone, exactly as before. A same-session brief call has one bar and
#: nothing to check in between; ~10 sessions (two trading weeks) is the first
#: point where a third of the window is a meaningful stretch of trading.
LONG_HORIZON_MIN_SESSIONS = 10

#: Where the checkpoints land, as fractions of the window. FRACTIONS, not fixed
#: intervals, so the checkpoint count is constant (2) at every horizon: a
#: quarter-long call costs exactly what a month-long call costs. On a ~63
#: session quarter these fall near the 1-month and 2-month marks.
CHECKPOINT_FRACTIONS = (1.0 / 3.0, 2.0 / 3.0)

#: How the strength of an attribution is LABELLED. Descriptive only: no verdict
#: anywhere reads these, they exist so a long call cannot quietly present
#: itself with the same authority as a same-session one.
GRADE_HIGH = "high"                # short window, direct read
GRADE_MODERATE = "moderate"        # long window, checkpoints agree
GRADE_DIRECTIONAL = "directional"  # long window, no usable interim evidence
GRADE_NONE = "none"                # nothing was cleanly attributed

#: Confidence penalty applied to a LONG window's attribution_confidence.
#: Honest labelling, not a verdict input: a quarter of drift, earnings and
#: rotation sits between entry and exit, so the same excess return supports a
#: weaker causal claim than it would over one session.
LONG_HORIZON_CONFIDENCE_PENALTY = 0.15


@dataclass(frozen=True)
class Checkpoint:
    """One fixed-fraction interim read. Pure arithmetic over bars already
    fetched for the terminal grade."""

    fraction: float
    date: str
    sessions: int
    entity_pct: float
    #: Signed excess vs the WEAKEST benchmark at this point, in the direction
    #: the terminal grade credited. Negative means the call was behind its
    #: benchmarks while it was supposedly working.
    signed_excess_pct: float
    #: The noise bar at this point, scaled by sqrt(sessions) exactly like the
    #: terminal bar, so the comparison is dimensionally consistent.
    bar_pct: float
    #: True when the call was MATERIALLY behind its benchmarks here, i.e. this
    #: interim read contradicts a clean terminal win.
    disagrees: bool

    def as_dict(self) -> dict:
        return {
            "fraction": round(self.fraction, 3),
            "date": self.date,
            "sessions": self.sessions,
            "entity_pct": round(self.entity_pct, 3),
            "signed_excess_pct": round(self.signed_excess_pct, 3),
            "bar_pct": round(self.bar_pct, 3),
            "disagrees": self.disagrees,
        }


def _pct_from_open(bars: list[dict], upto_index: int) -> float | None:
    """Percent move from the first bar's open to bars[upto_index]'s close."""
    if not bars or upto_index < 0 or upto_index >= len(bars):
        return None
    first_open = bars[0].get("open")
    close = bars[upto_index].get("close")
    if not first_open or close is None:
        return None
    return (close - first_open) / first_open * 100.0


def _index_on_or_before(bars: list[dict], day: str) -> int | None:
    """Index of the last bar dated on or before `day`. Benchmarks and the
    entity can have different session counts (halts, listings), so checkpoints
    are aligned by DATE, never by position."""
    found = None
    for i, b in enumerate(bars):
        d = b.get("date") or ""
        if d and d <= day:
            found = i
        else:
            break
    return found


def compute_checkpoints(
    entity_bars: list[dict],
    benchmark_bars: Mapping[str, list[dict]],
    credited_sign: float,
    tier: AttributionTier,
    fractions: tuple[float, ...] = CHECKPOINT_FRACTIONS,
) -> list[Checkpoint]:
    """
    Interim benchmark-excess reads at fixed fractions of the window.

    `credited_sign` is +1/-1 for the direction the terminal grade credited;
    every excess is signed into that direction so "positive" always means "the
    call was working" regardless of whether it was bullish or bearish.

    Returns [] when there is nothing honest to compute (too few sessions, no
    bars, no benchmarks). An empty list never downgrades anything: absence of
    evidence is not evidence of a dirty win.
    """
    n = len(entity_bars)
    if n < LONG_HORIZON_MIN_SESSIONS or credited_sign == 0.0:
        return []

    out: list[Checkpoint] = []
    seen_dates: set[str] = set()
    for f in fractions:
        idx = int(f * (n - 1))
        if idx <= 0 or idx >= n - 1:
            # Degenerate: a checkpoint at the very start or the terminal bar
            # tells us nothing the terminal grade does not already say.
            continue
        day = entity_bars[idx].get("date") or ""
        if not day or day in seen_dates:
            continue
        entity_pct = _pct_from_open(entity_bars, idx)
        if entity_pct is None:
            continue

        # Weakest excess across benchmarks, matching the terminal rule that the
        # entity must beat EVERY benchmark.
        worst: float | None = None
        for bars in benchmark_bars.values():
            b_idx = _index_on_or_before(bars, day)
            if b_idx is None:
                continue
            b_pct = _pct_from_open(bars, b_idx)
            if b_pct is None:
                continue
            signed = credited_sign * (entity_pct - b_pct)
            worst = signed if worst is None else min(worst, signed)
        if worst is None:
            continue

        sessions_here = idx + 1
        bar = round(tier.min_excess_pct * window_scale(sessions_here), 3)
        seen_dates.add(day)
        out.append(
            Checkpoint(
                fraction=f,
                date=day,
                sessions=sessions_here,
                entity_pct=credited_sign * entity_pct,
                signed_excess_pct=worst,
                bar_pct=bar,
                # Materially behind its benchmarks, beyond the noise bar.
                disagrees=worst <= -bar,
            )
        )
    return out


def attribution_grade(
    attribution: str, sessions: int, checkpoints: list[Checkpoint]
) -> str:
    """How strong the attribution claim is, in words. Descriptive only."""
    if attribution != ATTRIBUTION_CLEAN:
        return GRADE_NONE
    if sessions < LONG_HORIZON_MIN_SESSIONS:
        return GRADE_HIGH
    return GRADE_MODERATE if checkpoints else GRADE_DIRECTIONAL


def apply_long_horizon_panel(
    result: AttributionResult, checkpoints: list[Checkpoint]
) -> AttributionResult:
    """
    The strict agreement gate. STRICTER OR IDENTICAL, NEVER MORE LENIENT.

    Only one transition exists: a credited, cleanly attributed win whose
    interim reads contradict it becomes "no clean read". Every other input is
    returned unchanged, including every WRONG, so a miss can never be
    downgraded out of the denominator.
    """
    if result.verdict != VERDICT_CORRECT or result.attribution != ATTRIBUTION_CLEAN:
        return result
    if not any(c.disagrees for c in checkpoints):
        return result
    return AttributionResult(
        verdict=VERDICT_PARTIAL,
        attribution=ATTRIBUTION_INCONCLUSIVE,
        realized_direction=result.realized_direction,
        # A contradicted win is less certain than the terminal numbers implied.
        attribution_confidence=_clamp_conf(result.attribution_confidence - 0.20),
        detail={**result.detail, "panel_downgraded": True},
    )


def window_scale(sessions: int) -> float:
    """
    Threshold scale for multi-session grading windows: sqrt(sessions),
    the standard vol-of-sum heuristic. V1 HEURISTIC to validate against
    real outcomes later; isolated here so tuning is one edit.
    sessions <= 1 returns 1.0, keeping single-session grading (all brief
    calls) numerically identical.
    """
    if sessions <= 1:
        return 1.0
    return round(sessions ** 0.5, 3)


def scale_tier_for_sessions(tier: AttributionTier, sessions: int) -> AttributionTier:
    """Scaled copy of a tier for an N-session window. classify_attribution
    already takes the tier as a parameter, so this extends grading to
    windows without touching the classification logic itself."""
    scale = window_scale(sessions)
    if scale == 1.0:
        return tier
    return AttributionTier(
        name=tier.name,
        dead_band_pct=round(tier.dead_band_pct * scale, 3),
        min_excess_pct=round(tier.min_excess_pct * scale, 3),
    )


@dataclass(frozen=True)
class BenchmarkMove:
    symbol: str
    role: str  # "sector" | "market"
    pct_move: float  # percent points over the window
    # Bar for "this benchmark moved meaningfully on its own", i.e. could
    # have carried the entity: the benchmark tier's crediting bar.
    meaningful_bar_pct: float


@dataclass(frozen=True)
class AttributionResult:
    verdict: str
    attribution: str
    realized_direction: str  # up | down | flat
    attribution_confidence: float  # grader-derived, in [0, 1]
    detail: dict


def _realized_direction(entity_pct: float, tier: AttributionTier) -> str:
    if entity_pct >= tier.dead_band_pct:
        return "up"
    if entity_pct <= -tier.dead_band_pct:
        return "down"
    return "flat"


def _clamp_conf(x: float) -> float:
    return round(min(0.95, max(0.05, x)), 2)


def classify_attribution(
    expected_direction: str,
    entity_pct: float,
    benchmarks: list[BenchmarkMove],
    tier: AttributionTier,
) -> AttributionResult:
    """
    Pure verdict + attribution classification. All moves in percent
    points. Deterministic; no IO; never sees the call's confidence.
    """
    realized = _realized_direction(entity_pct, tier)
    sign = 1.0 if realized == "up" else -1.0 if realized == "down" else 0.0
    excesses = {b.symbol: entity_pct - b.pct_move for b in benchmarks}

    if realized == "flat":
        attribution, confidence = _classify_flat(entity_pct, benchmarks, tier)
    else:
        attribution, confidence = _classify_directional(
            entity_pct, sign, benchmarks, tier
        )

    hit = (
        (expected_direction == "bullish" and realized == "up")
        or (expected_direction == "bearish" and realized == "down")
        or (expected_direction == "neutral" and realized == "flat")
    )
    miss_opposite = (
        (expected_direction == "bullish" and realized == "down")
        or (expected_direction == "bearish" and realized == "up")
    )

    if miss_opposite:
        verdict = VERDICT_WRONG
    elif hit and attribution == ATTRIBUTION_CLEAN:
        verdict = VERDICT_CORRECT
    else:
        # Directionally right but not attributable, flat on a directional
        # call, or a neutral call that saw a real move.
        verdict = VERDICT_PARTIAL

    return AttributionResult(
        verdict=verdict,
        attribution=attribution,
        realized_direction=realized,
        attribution_confidence=confidence,
        detail={"excess_pct": {k: round(v, 3) for k, v in excesses.items()}},
    )


def _classify_directional(
    entity_pct: float,
    sign: float,
    benchmarks: list[BenchmarkMove],
    tier: AttributionTier,
) -> tuple[str, float]:
    """Attribution of a realized up/down move (independent of the call's
    expected direction; the verdict layer handles hit vs miss)."""
    if not benchmarks:
        # Benchmark-free entity (broad index): absolute crediting bar.
        ratio = (sign * entity_pct) / tier.min_excess_pct
        if ratio >= 1.0:
            return ATTRIBUTION_CLEAN, _clamp_conf(0.55 + 0.25 * min(ratio, 1.6))
        return ATTRIBUTION_INCONCLUSIVE, 0.40

    signed_excess = [sign * (entity_pct - b.pct_move) for b in benchmarks]
    if all(e >= tier.min_excess_pct for e in signed_excess):
        ratio = min(signed_excess) / tier.min_excess_pct
        return ATTRIBUTION_CLEAN, _clamp_conf(0.55 + 0.25 * min(ratio, 1.6))

    co_moving = [
        sign * b.pct_move / b.meaningful_bar_pct
        for b in benchmarks
        if sign * b.pct_move >= b.meaningful_bar_pct
    ]
    if co_moving:
        # A benchmark genuinely moved the same way: market/sector carried it.
        return ATTRIBUTION_CONFOUNDED, _clamp_conf(0.50 + 0.20 * min(max(co_moving), 2.0))

    # Moved on its own but did not clear the crediting bar, and no
    # benchmark explains it either: below threshold / mixed.
    return ATTRIBUTION_INCONCLUSIVE, 0.40


def _classify_flat(
    entity_pct: float,
    benchmarks: list[BenchmarkMove],
    tier: AttributionTier,
) -> tuple[str, float]:
    """Attribution of a flat outcome (matters for neutral calls: flat
    against a moving market is attributable stability; flat in a flat
    market is carried flatness)."""
    if not benchmarks:
        # An index that stayed flat has no confounder by definition.
        return ATTRIBUTION_CLEAN, 0.60
    moving = [
        abs(b.pct_move) / b.meaningful_bar_pct
        for b in benchmarks
        if abs(b.pct_move) >= b.meaningful_bar_pct
    ]
    if moving:
        return ATTRIBUTION_CLEAN, _clamp_conf(0.55 + 0.20 * min(max(moving), 2.0))
    return ATTRIBUTION_CONFOUNDED, 0.50


# Callable signature matches backend.market_data.fetch_historical_candle.
CandleFetcher = Callable[[str, datetime, datetime], Optional[dict]]


class PriceAttributionGrader:
    """Resolution method #1. Implements the Grader protocol."""

    name = GRADER_NAME

    def __init__(
        self,
        ticker_sectors: Mapping[str, str] | None = None,
        fetch_candle: CandleFetcher = fetch_historical_candle,
        now: Callable[[], datetime] | None = None,
    ):
        # ticker -> canonical sector label (from the companies table),
        # resolved in one batched query by the runner.
        self._ticker_sectors = {
            k.upper(): v for k, v in (ticker_sectors or {}).items()
        }
        self._fetch_candle = fetch_candle
        # Injectable clock (UTC) so the transient-vs-permanent decision for a
        # missing candle is testable. Never reads a clock in grading math.
        self._now = now or (lambda: datetime.now(timezone.utc))

    def resolve(self, call: dict) -> Outcome:
        claim_type = (call.get("claim_type") or "").strip().lower()
        target = self._entity_symbol(claim_type, call.get("target_symbol"))
        if not target:
            return ungradable(
                REASON_UNMAPPED_SYMBOL,
                f"no symbol mapping for {claim_type}/{call.get('target_symbol')!r}",
                grader=self.name,
            )

        base_tier = resolve_tier(claim_type, target)
        tier = base_tier
        # Multi-session extension (user claims): an optional window_start
        # widens the grading window; brief calls never set it, so their
        # path is unchanged.
        window = _grading_window(call.get("brief_date"), call.get("window_start"))
        if window is None:
            return ungradable(
                REASON_NO_PRICE_DATA,
                f"call has no usable brief_date: {call.get('brief_date')!r}",
                grader=self.name,
            )
        day_start, day_end = window

        entity = self._fetch_candle(target, day_start, day_end)
        if not entity:
            # Transient vs permanent absence. The session being priced is
            # day_start; its EOD candle only exists after that session closes and
            # Tiingo publishes it (hours after the 4pm ET close). When the run
            # fires on the SAME UTC day as the session (the 2026-08-07 batch
            # graded at 22:36 UTC), the candle is simply not published yet: defer,
            # leave the call unresolved, and let the next run grade it. Only a
            # PAST session that is still empty is a real ungradable, because by
            # then the bar would exist if it ever will.
            if day_start.date() >= self._now().date():
                return deferred(
                    REASON_NO_PRICE_DATA,
                    f"session candle for {target} on {day_start.date().isoformat()} "
                    "not yet published; will retry next run",
                    grader=self.name,
                )
            return ungradable(
                REASON_NO_PRICE_DATA,
                f"no session candle for {target} on {day_start.date().isoformat()}",
                grader=self.name,
                extra={"absence": "permanent"},
            )

        # Session count comes from the entity's actual candles; thresholds
        # scale by sqrt(sessions) (v1 heuristic). Single session: scale 1.0,
        # tier unchanged.
        sessions = int(entity.get("candle_count") or 1)
        scale = window_scale(sessions)
        tier = scale_tier_for_sessions(base_tier, sessions)

        benchmarks, coverage, bench_error, bench_bars = self._fetch_benchmarks(
            claim_type, target, day_start, day_end, bar_scale=scale
        )
        if bench_error:
            return ungradable(REASON_NO_BENCHMARK_DATA, bench_error, grader=self.name)

        open_price = entity["open_price"]
        close_price = entity["close_price"]
        pct_frac = (close_price - open_price) / open_price if open_price else 0.0
        entity_pct = pct_frac * 100.0

        result = classify_attribution(
            (call.get("expected_direction") or "").strip().lower(),
            entity_pct,
            benchmarks,
            tier,
        )

        # ---- Long-horizon panel -------------------------------------------
        # Short calls (under LONG_HORIZON_MIN_SESSIONS) skip this entirely and
        # keep benchmark attribution alone, so the brief-call path is byte
        # identical to before. Long calls get fixed-fraction checkpoints read
        # off bars ALREADY fetched above: no extra request, no extra row.
        credited_sign = (
            1.0
            if result.realized_direction == "up"
            else -1.0
            if result.realized_direction == "down"
            else 0.0
        )
        checkpoints = compute_checkpoints(
            entity.get("bars") or [],
            bench_bars,
            credited_sign,
            # The UNSCALED tier: compute_checkpoints applies its own
            # sqrt(sessions) scaling per checkpoint. Passing the already
            # window-scaled tier would square the scaling and inflate a
            # checkpoint's bar by ~5x on a quarter, which would silently make
            # the panel almost never fire. That is the failure direction that
            # matters: a too-large bar makes grading MORE lenient.
            base_tier,
        )
        pre_panel_verdict = result.verdict
        pre_panel_attribution = result.attribution
        result = apply_long_horizon_panel(result, checkpoints)
        panel_downgraded = result.verdict != pre_panel_verdict

        confidence = result.attribution_confidence
        if coverage == "market_only" and claim_type == "ticker":
            # Sector benchmark unavailable: attribution is less grounded.
            confidence = _clamp_conf(confidence - 0.15)
        if sessions >= LONG_HORIZON_MIN_SESSIONS:
            # A quarter of drift, earnings and rotation sits between entry and
            # exit: the same excess supports a weaker causal claim than it
            # would over one session. Labelling only; no verdict reads this.
            confidence = _clamp_conf(confidence - LONG_HORIZON_CONFIDENCE_PENALTY)
        grade = attribution_grade(result.attribution, sessions, checkpoints)

        return Outcome(
            verdict=result.verdict,
            attribution=result.attribution,
            actual_open=open_price,
            actual_close=close_price,
            actual_pct_change=round(pct_frac, 6),
            actual_direction=result.realized_direction,
            metadata={
                "grader": self.name,
                "entity_symbol": target,
                "tier": tier.name,
                "thresholds_pct": {
                    "dead_band": tier.dead_band_pct,
                    "min_excess": tier.min_excess_pct,
                },
                "entity_move_pct": round(entity_pct, 3),
                "benchmarks": [
                    {
                        "symbol": b.symbol,
                        "role": b.role,
                        "move_pct": round(b.pct_move, 3),
                        "excess_pct": round(entity_pct - b.pct_move, 3),
                        "meaningful_bar_pct": b.meaningful_bar_pct,
                    }
                    for b in benchmarks
                ],
                "benchmark_coverage": coverage,
                "attribution_confidence": confidence,
                "window": {
                    "from": day_start.isoformat(),
                    "to": day_end.isoformat(),
                },
                # Multi-session keys are added only for windowed grades so
                # single-session (brief call) metadata stays byte-identical.
                **(
                    {"window_sessions": sessions, "threshold_scale": scale}
                    if sessions > 1
                    else {}
                ),
                # Long-horizon panel keys, likewise added only where the panel
                # actually ran. A short call's row is unchanged in every byte.
                **(
                    {
                        "horizon_class": "long",
                        "attribution_grade": grade,
                        "checkpoints": [c.as_dict() for c in checkpoints],
                        "panel": {
                            # A FACT about the checkpoints, independent of
                            # whether the panel acted: the panel only evaluates
                            # credited clean wins, so a confounded call can
                            # carry a disagreeing checkpoint and never be
                            # downgraded. Reporting "agreed" as "not
                            # downgraded" would have claimed agreement that did
                            # not exist.
                            "agreed": not any(c.disagrees for c in checkpoints),
                            "downgraded": panel_downgraded,
                            # What the terminal numbers alone would have said,
                            # so a downgrade is auditable rather than silent.
                            "pre_panel_verdict": pre_panel_verdict,
                            "pre_panel_attribution": pre_panel_attribution,
                        },
                    }
                    if sessions >= LONG_HORIZON_MIN_SESSIONS
                    else {}
                ),
            },
        )

    def _entity_symbol(self, claim_type: str, raw_symbol: str | None) -> str | None:
        if claim_type == "ticker":
            return raw_symbol.strip().upper() if raw_symbol and raw_symbol.strip() else None
        if claim_type == "sector":
            return sector_etf_for_label(raw_symbol)
        if claim_type == "index":
            return normalize_index_symbol(raw_symbol)
        return None

    def _fetch_benchmarks(
        self,
        claim_type: str,
        entity_symbol: str,
        day_start: datetime,
        day_end: datetime,
        bar_scale: float = 1.0,
    ) -> tuple[list[BenchmarkMove], str, str | None, dict[str, list[dict]]]:
        """Returns (benchmarks, coverage, error, bars_by_symbol). A non-None
        error means required benchmark data failed and the call is ungradable.
        bar_scale scales the benchmarks' meaningful-move bars for
        multi-session windows; the default 1.0 is the brief-call path.

        bars_by_symbol carries each benchmark's daily series from the SAME
        fetch, so the long-horizon checkpoint panel can align interim reads
        against it without issuing a second request."""
        sym = entity_symbol.upper()
        if claim_type == "index" or sym in BROAD_INDEX_ETFS:
            # The index is the market; grading is absolute.
            return [], "none", None, {}

        wanted: list[tuple[str, str, float]] = []
        if claim_type == "ticker" and sym not in SECTOR_ETF_SYMBOLS:
            sector_etf = sector_etf_for_label(self._ticker_sectors.get(sym))
            if sector_etf and sector_etf != sym:
                wanted.append(
                    ("sector", sector_etf, round(TIER_SECTOR_ETF.min_excess_pct * bar_scale, 3))
                )
        wanted.append(
            ("market", MARKET_BENCHMARK, round(TIER_BROAD_INDEX.min_excess_pct * bar_scale, 3))
        )

        moves: list[BenchmarkMove] = []
        bars_by_symbol: dict[str, list[dict]] = {}
        for role, bench_sym, bar in wanted:
            candle = self._fetch_candle(bench_sym, day_start, day_end)
            if not candle:
                return (
                    [],
                    "none",
                    f"benchmark {bench_sym} ({role}) has no session candle "
                    f"for {day_start.date().isoformat()}",
                    {},
                )
            b_open, b_close = candle["open_price"], candle["close_price"]
            b_pct = ((b_close - b_open) / b_open * 100.0) if b_open else 0.0
            moves.append(BenchmarkMove(bench_sym, role, b_pct, bar))
            series = candle.get("bars")
            if series:
                bars_by_symbol[bench_sym] = series

        has_sector = any(b.role == "sector" for b in moves)
        coverage = "sector_and_market" if has_sector else "market_only"
        return moves, coverage, None, bars_by_symbol


def _parse_grading_date(value: object) -> date | None:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, str) and value:
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def _grading_window(
    brief_date: object, window_start: object = None
) -> tuple[datetime, datetime] | None:
    """Whole-UTC-day window around the call's brief_date so
    fetch_historical_candle returns exactly that session's daily candle.
    Live-forward only: the window is the call's own date, never today.
    Optional window_start (user claims) widens the window to
    [window_start, brief_date]; ignored unless it is a valid earlier
    date, so brief calls are unaffected."""
    d = _parse_grading_date(brief_date)
    if d is None:
        return None
    start = _parse_grading_date(window_start)
    if start is None or start >= d:
        start = d
    return (
        datetime.combine(start, time(0, 0), tzinfo=timezone.utc),
        datetime.combine(d, time(23, 59, 59), tzinfo=timezone.utc),
    )
