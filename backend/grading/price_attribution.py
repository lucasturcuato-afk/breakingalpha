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
    ):
        # ticker -> canonical sector label (from the companies table),
        # resolved in one batched query by the runner.
        self._ticker_sectors = {
            k.upper(): v for k, v in (ticker_sectors or {}).items()
        }
        self._fetch_candle = fetch_candle

    def resolve(self, call: dict) -> Outcome:
        claim_type = (call.get("claim_type") or "").strip().lower()
        target = self._entity_symbol(claim_type, call.get("target_symbol"))
        if not target:
            return ungradable(
                REASON_UNMAPPED_SYMBOL,
                f"no symbol mapping for {claim_type}/{call.get('target_symbol')!r}",
                grader=self.name,
            )

        tier = resolve_tier(claim_type, target)
        window = _grading_window(call.get("brief_date"))
        if window is None:
            return ungradable(
                REASON_NO_PRICE_DATA,
                f"call has no usable brief_date: {call.get('brief_date')!r}",
                grader=self.name,
            )
        day_start, day_end = window

        entity = self._fetch_candle(target, day_start, day_end)
        if not entity:
            return ungradable(
                REASON_NO_PRICE_DATA,
                f"no session candle for {target} on {day_start.date().isoformat()}",
                grader=self.name,
            )

        benchmarks, coverage, bench_error = self._fetch_benchmarks(
            claim_type, target, day_start, day_end
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
        confidence = result.attribution_confidence
        if coverage == "market_only" and claim_type == "ticker":
            # Sector benchmark unavailable: attribution is less grounded.
            confidence = _clamp_conf(confidence - 0.15)

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
    ) -> tuple[list[BenchmarkMove], str, str | None]:
        """Returns (benchmarks, coverage, error). A non-None error means
        required benchmark data failed and the call is ungradable."""
        sym = entity_symbol.upper()
        if claim_type == "index" or sym in BROAD_INDEX_ETFS:
            # The index is the market; grading is absolute.
            return [], "none", None

        wanted: list[tuple[str, str, float]] = []
        if claim_type == "ticker" and sym not in SECTOR_ETF_SYMBOLS:
            sector_etf = sector_etf_for_label(self._ticker_sectors.get(sym))
            if sector_etf and sector_etf != sym:
                wanted.append(("sector", sector_etf, TIER_SECTOR_ETF.min_excess_pct))
        wanted.append(("market", MARKET_BENCHMARK, TIER_BROAD_INDEX.min_excess_pct))

        moves: list[BenchmarkMove] = []
        for role, bench_sym, bar in wanted:
            candle = self._fetch_candle(bench_sym, day_start, day_end)
            if not candle:
                return (
                    [],
                    "none",
                    f"benchmark {bench_sym} ({role}) has no session candle "
                    f"for {day_start.date().isoformat()}",
                )
            b_open, b_close = candle["open_price"], candle["close_price"]
            b_pct = ((b_close - b_open) / b_open * 100.0) if b_open else 0.0
            moves.append(BenchmarkMove(bench_sym, role, b_pct, bar))

        has_sector = any(b.role == "sector" for b in moves)
        coverage = "sector_and_market" if has_sector else "market_only"
        return moves, coverage, None


def _grading_window(brief_date: object) -> tuple[datetime, datetime] | None:
    """Whole-UTC-day window around the call's brief_date so
    fetch_historical_candle returns exactly that session's daily candle.
    Live-forward only: the window is the call's own date, never today."""
    if isinstance(brief_date, date) and not isinstance(brief_date, datetime):
        d = brief_date
    elif isinstance(brief_date, str) and brief_date:
        try:
            d = date.fromisoformat(brief_date[:10])
        except ValueError:
            return None
    else:
        return None
    return (
        datetime.combine(d, time(0, 0), tzinfo=timezone.utc),
        datetime.combine(d, time(23, 59, 59), tzinfo=timezone.utc),
    )
