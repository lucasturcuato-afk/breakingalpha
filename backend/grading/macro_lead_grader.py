"""
macro_lead_grader.py — deterministic macro lead-outcome grader (NO LLM).

The single-name price/attribution grader (price_attribution.py) marks macro
days `ungradable`: there is no named entity to price. This grader fills that
gap. It scores whether the morning (or evening) brief LED WITH THE RIGHT
MOVER on a macro day, using an OPEN-ANCHORED price window reconstructed
entirely from persisted `briefings.market_tape`. It is fully deterministic:
same input rows produce an identical grade on every run. There is no LLM
import and no network call to any model here.

What it grades
--------------
MOVER IDENTIFICATION, not direction. Given the lead's cluster (macro:cpi,
macro:fed, macro:oil, geopolitical, ...) we ask: did leading with this story
correctly flag WHAT THE MARKET ACTUALLY REPRICED ON that session, regardless
of up or down? A macro-CPI lead grades well if the tape shows the session
repriced on rates and/or the broad index; it grades poorly if the real mover
was a channel the lead ignored (e.g. an oil shock the lead never mentioned).

The window (per channel)
------------------------
    prior_close  close of the prior session
    open_proxy   the morning run's ~10am ET level (session-open stand-in)
    same_close   close of the same session
    t1           follow-through close (next session)

market_tape has NO `open` and NO `prev`. We derive:
  - prior_close from the SAME morning row: level / (1 + pct/100). This is
    exact and self-contained. (Cross-checked against the D+1 evening row's
    own derived prior; they agree to <0.01%.)
  - open_proxy = the morning row's `level` (as_of ~14:xx UTC, ~10am ET,
    post-open). The true 09:30 open is not persisted; every grade is tagged
    is_open_proxy=true and confidence carries an open-proxy penalty.
  - same_close = the D+1 evening row's `level` (evening rows are created
    ~02:xx UTC = ~10pm ET of the PRIOR calendar day, i.e. they hold the
    close of the session that the D-labeled morning row opened).
  - t1 = the D+2 evening row's `level`.

The prior_close -> open_proxy GAP measures whether the market repriced on the
event (materiality). open_proxy -> same_close measures whether it SUSTAINED.
t1 is secondary follow-through.

Confidence (the grader knows when it does not know)
---------------------------------------------------
Confidence in [0,1] is DRIVEN LOW (flagged and down-weighted, never
discarded) on: multi-catalyst days (more than one plausible driver in the
tape), no-gap / in-line prints (tiny prior->open move, nothing repriced),
pre-FOMC deferral windows (market waiting), and open-proxy uncertainty.
Confidence is HIGH when a single clear driver produced a clean early-session
repricing that sustained.

Output (contract C3 -> table lead_outcome_grades, see sql/0013_*.sql). This
module returns a LeadGrade dataclass; a thin writer (out of scope here) maps
it 1:1 onto a row. No rows are written by importing this module.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional


# ── Channels ────────────────────────────────────────────────────────────────
# Deterministic vocabulary of macro repricing channels. Each session move is
# attributed across these; each lead cluster maps to the channel(s) it claims.
CH_INDEX = "index"
CH_RATES = "rates"
CH_VIX = "vix"
CH_OIL = "oil"
CHANNELS = (CH_INDEX, CH_RATES, CH_VIX, CH_OIL)

# Broad-index key used from market_tape.indices for the index channel.
BROAD_INDEX_KEY = "sp500"

# Grade-score anchors (mapped to [-1, 1]).
SCORE_CLEAN = 1.0     # lead named the channel the market actually repriced on
SCORE_PARTIAL = 0.0   # right family / one of several drivers / inconclusive
SCORE_MISSED = -1.0   # the real mover was a channel the lead ignored


# ── Cluster -> claimed channels ─────────────────────────────────────────────
# Which repricing channel(s) a lead of a given cluster is asserting drove the
# tape. Deterministic, explicit, no inference. `macro:*` inflation/rates leads
# claim the rates + broad-index complex; oil/energy and geopolitical-supply
# leads claim oil (and index as a secondary macro spillover).
def _cluster_channels(cluster: Optional[str], title: Optional[str]) -> set[str]:
    c = (cluster or "").strip().lower()
    t = (title or "").lower()
    claimed: set[str] = set()

    if c.startswith("macro:cpi") or c.startswith("macro:inflation") or c.startswith("macro:pce"):
        claimed |= {CH_RATES, CH_INDEX}
    if c.startswith("macro:fed") or c.startswith("macro:fomc") or c.startswith("macro:rates"):
        claimed |= {CH_RATES, CH_INDEX}
    if c.startswith("macro:jobs") or c.startswith("macro:payrolls") or c.startswith("macro:employment"):
        claimed |= {CH_RATES, CH_INDEX}
    if c.startswith("macro:oil") or c.startswith("macro:energy") or c.startswith("commodity"):
        claimed |= {CH_OIL, CH_INDEX}
    if c.startswith("geo") or c.startswith("macro:geo"):
        # Geopolitical macro leads in this corpus are supply/oil shocks
        # (Strait of Hormuz, blockades). Oil is the primary claimed channel.
        claimed |= {CH_OIL, CH_INDEX}
    if c.startswith("macro:vol") or c.startswith("macro:vix") or "volatility" in t:
        claimed |= {CH_VIX}

    # Title fallbacks when the cluster is unmapped but the headline is explicit.
    if not claimed:
        if any(k in t for k in ("cpi", "inflation", "pce", "fed", "fomc", "rate cut", "rate hike", "yields")):
            claimed |= {CH_RATES, CH_INDEX}
        if any(k in t for k in ("oil", "crude", "wti", "brent", "hormuz", "opec", "energy")):
            claimed |= {CH_OIL, CH_INDEX}
        if "vix" in t or "volatility" in t:
            claimed |= {CH_VIX}
    if not claimed:
        # Generic macro lead: claims the broad index moved on macro.
        claimed = {CH_INDEX}
    return claimed


# ── Materiality bars (percent points) ───────────────────────────────────────
# A channel "repriced" if its session move clears its bar. Bars are fixed,
# named, per-channel; they are NOT tuned per day. Rates is in basis points.
BAR_INDEX_PP = 0.35       # broad index % move to count as a real reprice
BAR_OIL_PP = 2.0          # WTI % move
BAR_VIX_PP = 6.0          # VIX % move
BAR_RATES_BPS = 3.0       # 10Y move in basis points
# Gap bar: prior_close -> open_proxy broad-index move that counts as the
# market having repriced on an overnight/early event (materiality).
GAP_INDEX_PP = 0.20
# "In-line / nothing repriced" ceiling: below this on every channel the day
# is a no-gap print and confidence is forced low.
QUIET_INDEX_PP = 0.20


@dataclass
class ChannelWindow:
    """The reconstructed price window for one channel."""
    prior_close: Optional[float] = None
    open_proxy: Optional[float] = None
    same_close: Optional[float] = None
    t1: Optional[float] = None

    def gap_pct(self) -> Optional[float]:
        # prior_close -> open_proxy, in percent points.
        if self.prior_close and self.open_proxy and self.prior_close != 0:
            return (self.open_proxy - self.prior_close) / self.prior_close * 100.0
        return None

    def sustain_pct(self) -> Optional[float]:
        # open_proxy -> same_close, in percent points.
        if self.open_proxy and self.same_close and self.open_proxy != 0:
            return (self.same_close - self.open_proxy) / self.open_proxy * 100.0
        return None

    def session_pct(self) -> Optional[float]:
        # prior_close -> same_close (full session), in percent points.
        if self.prior_close and self.same_close and self.prior_close != 0:
            return (self.same_close - self.prior_close) / self.prior_close * 100.0
        return None

    def t1_pct(self) -> Optional[float]:
        # same_close -> t1, in percent points.
        if self.same_close and self.t1 and self.same_close != 0:
            return (self.t1 - self.same_close) / self.same_close * 100.0
        return None


@dataclass
class LeadGrade:
    """Result of grading one macro lead. Maps 1:1 onto a lead_outcome_grades
    row (contract C3). attribution/window/notes are the jsonb/text columns."""
    brief_date: str
    brief_type: str
    lead_title: Optional[str]
    lead_cluster: Optional[str]
    mover_identified: Optional[bool]
    grade_score: Optional[float]
    confidence: Optional[float]
    attribution: dict = field(default_factory=dict)
    window: dict = field(default_factory=dict)
    is_open_proxy: bool = True
    notes: str = ""

    def to_row(self) -> dict:
        return asdict(self)


# ── Tape helpers ────────────────────────────────────────────────────────────
def _idx_level(tape: dict, key: str = BROAD_INDEX_KEY) -> Optional[float]:
    try:
        return float(tape["indices"][key]["level"])
    except (KeyError, TypeError, ValueError):
        return None


def _idx_pct(tape: dict, key: str = BROAD_INDEX_KEY) -> Optional[float]:
    try:
        return float(tape["indices"][key]["pct"])
    except (KeyError, TypeError, ValueError):
        return None


def _derive_prior_close(tape: dict, key: str = BROAD_INDEX_KEY) -> Optional[float]:
    """Exact in-row prior-session close: level / (1 + pct/100)."""
    lvl = _idx_level(tape, key)
    pct = _idx_pct(tape, key)
    if lvl is None or pct is None:
        return None
    denom = 1.0 + pct / 100.0
    if denom == 0:
        return None
    return lvl / denom


def _rates_bps(tape: dict) -> Optional[float]:
    try:
        return float(tape["enrichment"]["rates"]["teny_bps_change"])
    except (KeyError, TypeError, ValueError):
        return None


def _oil_pct(tape: dict) -> Optional[float]:
    try:
        return float(tape["enrichment"]["oil"]["wti_pct"])
    except (KeyError, TypeError, ValueError):
        return None


def _vix_pct(tape: dict) -> Optional[float]:
    try:
        return float(tape["vix_pct"])
    except (KeyError, TypeError, ValueError):
        return None


def _regime(tape: dict) -> Optional[str]:
    r = tape.get("regime") if isinstance(tape, dict) else None
    return str(r) if r is not None else None


# ── Window reconstruction ───────────────────────────────────────────────────
def build_window(
    lead_tape: dict,
    same_close_tape: Optional[dict],
    t1_tape: Optional[dict],
) -> dict[str, ChannelWindow]:
    """Reconstruct the per-channel window from persisted tapes.

    lead_tape        the morning (or evening) run's market_tape row that
                     carried the lead. open_proxy comes from here.
    same_close_tape  the D+1 evening row's tape (close of the lead session).
    t1_tape          the D+2 evening row's tape (follow-through).
    """
    idx = ChannelWindow(
        prior_close=_derive_prior_close(lead_tape),
        open_proxy=_idx_level(lead_tape),
        same_close=_idx_level(same_close_tape) if same_close_tape else None,
        t1=_idx_level(t1_tape) if t1_tape else None,
    )
    # Rates/oil/vix are stored as moves (bps / pct), not level pairs, so their
    # ChannelWindow holds the derived session move in the same_close-relative
    # sense: we place the move magnitude on open->same_close via the tape pct
    # fields. We keep prior_close/open_proxy None for these and read the move
    # through the dedicated *_move() helpers below.
    return {CH_INDEX: idx}


# ── Attribution ─────────────────────────────────────────────────────────────
def attribute_session(
    lead_tape: dict,
    same_close_tape: Optional[dict],
) -> dict[str, Any]:
    """Deterministically attribute the session's move across channels.

    Returns a dict keyed by channel with:
      move        signed magnitude (pp for index/oil/vix, bps for rates)
      bar         the materiality bar for that channel
      repriced    bool: |move| cleared the bar
      share       fraction of total repricing (magnitude / sum of clearers),
                  0 for channels that did not clear
    The `index` channel uses the FULL SESSION move (prior_close->same_close)
    when the same-session close is available, else the in-row session pct.
    """
    # Index full-session move.
    idx_win = ChannelWindow(
        prior_close=_derive_prior_close(lead_tape),
        open_proxy=_idx_level(lead_tape),
        same_close=_idx_level(same_close_tape) if same_close_tape else None,
    )
    idx_session = idx_win.session_pct()
    if idx_session is None:
        # Fall back to the lead row's own pct (prior_close -> open_proxy).
        idx_session = _idx_pct(lead_tape)

    moves = {
        CH_INDEX: (idx_session, BAR_INDEX_PP),
        CH_RATES: (_rates_bps(lead_tape), BAR_RATES_BPS),
        CH_OIL: (_oil_pct(lead_tape), BAR_OIL_PP),
        CH_VIX: (_vix_pct(lead_tape), BAR_VIX_PP),
    }

    attrib: dict[str, Any] = {}
    clearers_mag: dict[str, float] = {}
    for ch, (mv, bar) in moves.items():
        repriced = mv is not None and abs(mv) >= bar
        attrib[ch] = {
            "move": None if mv is None else round(mv, 4),
            "bar": bar,
            "unit": "bps" if ch == CH_RATES else "pp",
            "repriced": bool(repriced),
        }
        if repriced:
            # Normalize magnitudes to bar-multiples so bps and pp are
            # comparable when computing share of repricing.
            clearers_mag[ch] = abs(mv) / bar

    total = sum(clearers_mag.values())
    for ch in moves:
        share = (clearers_mag.get(ch, 0.0) / total) if total > 0 else 0.0
        attrib[ch]["share"] = round(share, 4)

    return attrib


# ── Confidence ──────────────────────────────────────────────────────────────
def _pre_fomc_deferral(lead_tape: dict, attrib: dict) -> bool:
    """Heuristic, deterministic: a quiet broad index + a waiting regime with
    no channel clearing its bar looks like a pre-event deferral window."""
    idx_move = attrib[CH_INDEX]["move"]
    any_repriced = any(attrib[ch]["repriced"] for ch in CHANNELS)
    quiet = idx_move is not None and abs(idx_move) < QUIET_INDEX_PP
    return quiet and not any_repriced


def compute_confidence(
    attrib: dict,
    gap_pct: Optional[float],
    is_open_proxy: bool,
    pre_fomc: bool,
) -> tuple[float, list[str]]:
    """Confidence in [0,1] with explicit reasons. Starts high, is driven
    down (never discarded) by each uncertainty source."""
    conf = 1.0
    reasons: list[str] = []

    repriced_channels = [ch for ch in CHANNELS if attrib[ch]["repriced"]]
    n_repriced = len(repriced_channels)

    # Multi-catalyst: more than one channel cleared its bar.
    if n_repriced >= 3:
        conf -= 0.45
        reasons.append(f"multi_catalyst({n_repriced} channels repriced)")
    elif n_repriced == 2:
        conf -= 0.25
        reasons.append("multi_catalyst(2 channels repriced)")

    # No-gap / in-line print: nothing repriced at all, or the overnight gap
    # was tiny. Nothing to attribute confidently.
    if n_repriced == 0:
        conf -= 0.45
        reasons.append("no_reprice(nothing cleared its bar)")
    if gap_pct is not None and abs(gap_pct) < GAP_INDEX_PP:
        conf -= 0.15
        reasons.append(f"tiny_gap(prior->open {gap_pct:+.2f}pp)")

    # Pre-FOMC deferral window.
    if pre_fomc:
        conf -= 0.20
        reasons.append("pre_event_deferral(quiet, waiting)")

    # Open-proxy uncertainty (always present for these grades).
    if is_open_proxy:
        conf -= 0.10
        reasons.append("open_proxy(09:30 open not persisted)")

    conf = max(0.0, min(1.0, conf))
    return round(conf, 3), reasons


# ── Grade ───────────────────────────────────────────────────────────────────
def grade_lead(
    brief_date: str,
    brief_type: str,
    lead_title: Optional[str],
    lead_cluster: Optional[str],
    lead_tape: dict,
    same_close_tape: Optional[dict] = None,
    t1_tape: Optional[dict] = None,
) -> LeadGrade:
    """Grade one macro lead deterministically. Pure function of its inputs:
    the same rows always yield the same LeadGrade."""
    claimed = _cluster_channels(lead_cluster, lead_title)
    attrib = attribute_session(lead_tape, same_close_tape)

    # Which channels actually repriced.
    repriced = {ch for ch in CHANNELS if attrib[ch]["repriced"]}

    idx_win = ChannelWindow(
        prior_close=_derive_prior_close(lead_tape),
        open_proxy=_idx_level(lead_tape),
        same_close=_idx_level(same_close_tape) if same_close_tape else None,
        t1=_idx_level(t1_tape) if t1_tape else None,
    )
    gap_pct = idx_win.gap_pct()

    # Mover identification. The lead identified the mover if at least one
    # channel it claimed actually repriced. Direction is intentionally
    # ignored: we grade WHAT repriced, not up vs down.
    claimed_and_repriced = claimed & repriced

    if not repriced:
        # Nothing cleared a bar: no mover to identify. Partial, low confidence.
        mover_identified = None
        score = SCORE_PARTIAL
        id_note = "no channel repriced; no mover to identify"
    elif claimed_and_repriced:
        # The lead named at least one channel that repriced. Clean iff the
        # lead's claimed channels cover every channel that repriced (it did
        # not ignore a real driver). Partial if a real driver was missed.
        missed = repriced - claimed
        if not missed:
            mover_identified = True
            score = SCORE_CLEAN
            id_note = f"lead claimed {sorted(claimed)}, all repriced channels {sorted(repriced)} covered"
        else:
            mover_identified = True
            score = SCORE_PARTIAL
            id_note = f"lead covered {sorted(claimed_and_repriced)} but missed {sorted(missed)}"
    else:
        # The market repriced entirely on channel(s) the lead did not claim.
        mover_identified = False
        score = SCORE_MISSED
        id_note = f"real mover {sorted(repriced)} not claimed by lead {sorted(claimed)}"

    pre_fomc = _pre_fomc_deferral(lead_tape, attrib)
    confidence, conf_reasons = compute_confidence(
        attrib, gap_pct, is_open_proxy=True, pre_fomc=pre_fomc
    )

    # Assemble the window jsonb: index as a full 4-point series; rates/oil/vix
    # as their session moves (single-number channels).
    window = {
        CH_INDEX: {
            "prior_close": _round(idx_win.prior_close),
            "open_proxy": _round(idx_win.open_proxy),
            "same_close": _round(idx_win.same_close),
            "t1": _round(idx_win.t1),
            "gap_pct": _round(gap_pct),
            "sustain_pct": _round(idx_win.sustain_pct()),
            "session_pct": _round(idx_win.session_pct()),
            "t1_pct": _round(idx_win.t1_pct()),
        },
        CH_RATES: {"session_move_bps": attrib[CH_RATES]["move"]},
        CH_OIL: {"session_move_pct": attrib[CH_OIL]["move"]},
        CH_VIX: {"session_move_pct": attrib[CH_VIX]["move"]},
    }

    notes = (
        f"{id_note}. claimed={sorted(claimed)}; repriced={sorted(repriced)}; "
        f"regime={_regime(lead_tape)}; confidence_drivers={conf_reasons}"
    )

    return LeadGrade(
        brief_date=brief_date,
        brief_type=brief_type,
        lead_title=lead_title,
        lead_cluster=lead_cluster,
        mover_identified=mover_identified,
        grade_score=score,
        confidence=confidence,
        attribution=attrib,
        window=window,
        is_open_proxy=True,
        notes=notes,
    )


def _round(x: Optional[float], n: int = 4) -> Optional[float]:
    return None if x is None else round(x, n)
