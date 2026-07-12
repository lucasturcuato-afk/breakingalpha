"""
Close-of-day tape fetch + deterministic market-regime classification for the
brief synthesis pipeline.

Three jobs:
  1. compute_regime: Python mirror of the TS regime ladder.
  2. parse_yahoo_daily / fetch_quote / fetch_tape: baseline-correct quotes for
     ^GSPC ^IXIC ^RUT ^VIX (prior close derived from actual daily bars, not
     Yahoo's unreliable meta.chartPreviousClose).
  3. build_tape_directive / enforce_tape_consistency: prompt grounding block
     and the post-parse override backstop for sentiment_word / market_tone.

SSOT MIRROR: the regime thresholds and ladder replicate
src/lib/market-regime.ts verbatim. If you change a constant or a branch in
either file, change the other and add a row to
backend/tests/regime_parity_cases.json (shared by the TS and Python tests).

Everything here is import-safe without env vars (no Supabase, no Gemini), so
the unit tests can exercise the pure pieces directly.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import requests

logger = logging.getLogger(__name__)

# ── Regime ladder (SSOT mirror of src/lib/market-regime.ts) ────────────────
VIX_EXTREME_LEVEL = 25
VIX_ELEVATED_LEVEL = 20
VIX_CALM_LEVEL = 15
VIX_SPIKE_PCT = 3
SPX_TIEBREAK_PCT = 0.3

# ── Overview-subject materiality gate (D2+D3) ────────────────────────────────
# WHY: the default overview subject used to inherit the pre-picked lead, so a
# single-name or pure-deal story could become the market-wide read even on a day
# when nothing moved the whole tape (2026-06-24: a SpaceX post-IPO stock slump
# led on name-level volume while the broad tape was mild risk-on/neutral). The
# default overview must be a market-wide synthesis chosen independently from the
# fresh tape. A single-name / pure-deal story may BECOME the overview subject
# only when this gate passes; otherwise it is relegated to a MENTION.
#
# v1 is conservative and defaults to market-wide. Thresholds are deliberately
# tunable named constants. "Material move" means the day's tape itself moved
# enough that a single driver could plausibly own the market-wide read.
MATERIALITY_SPX_ABS_PCT = 1.0   # |S&P 500 daily %| at or above this is material
MATERIALITY_VIX_ABS_PCT = 8.0   # |VIX daily %| at or above this is material
# A cluster needs at least this many DISTINCT sources to count as "dominant
# cross-source breadth" for overview-subject eligibility.
MATERIALITY_MIN_DISTINCT_SOURCES = 6

# D14 live-quote reconciliation: a single-name lead framed bullish (surge, record,
# all-time high, rally) may NOT lead with that stale-bullish framing when the named
# ticker is materially DOWN in the current session at gen time. RECON_DIR_PCT is
# the move magnitude (percent) at which today's direction is "material" enough to
# contradict the framing. Symmetric: bearish framing against a materially-up name
# is also a contradiction.
RECON_DIR_PCT = 1.5

# T3 driver-set v1 (recon open question 2). At evening gen time the per-name
# session move is available via fetch_quote(ticker)["pct"] (P0.3), but fetch_tape
# only surfaces indices + VIX. So the day's "tape drivers" are derived by fetching
# the candidate names' quotes and selecting the materially-large movers. A name is
# a driver today when BOTH hold:
#   |session move| > DRIVER_MIN_ABS_PCT, AND
#   it is among the top DRIVER_TOP_K absolute movers in the fetched candidate set.
# Conservative and fail-safe: no quotes => empty driver set => the gate behaves as
# before (market-wide default). A name is NEVER promoted on magnitude alone; the
# overview-subject gate still also requires a material tape and dominant breadth.
# Both constants are tunable; see RUN_REPORT_LEADTRUST.md (open question 2).
DRIVER_MIN_ABS_PCT = 2.0   # a name must move at least this much (abs %) to qualify
DRIVER_TOP_K = 3           # at most this many names are the day's drivers


def build_tape_driver_names(name_to_pct: dict, *, min_abs_pct: float = DRIVER_MIN_ABS_PCT,
                            top_k: int = DRIVER_TOP_K) -> set[str]:
    """T3: from a {company_name: session_pct} mapping fetched at gen time, return
    the lower-cased set of the day's tape drivers per v1: names whose absolute
    session move exceeds `min_abs_pct`, restricted to the top `top_k` absolute
    movers. Pure, never raises. Empty input or no qualifying mover -> empty set
    (the gate then falls back to market-wide, fail-safe)."""
    pairs = []
    for name, pct in (name_to_pct or {}).items():
        nm = str(name or "").strip().lower()
        if not nm:
            continue
        try:
            p = float(pct)
        except (TypeError, ValueError):
            continue
        if abs(p) > min_abs_pct:
            pairs.append((nm, abs(p)))
    if not pairs:
        return set()
    pairs.sort(key=lambda t: t[1], reverse=True)
    return {nm for nm, _ in pairs[:top_k]}


def compute_regime(vix_level: float, vix_pct_change: float, spx_pct_change: float) -> str:
    """
    Returns 'risk-off' | 'risk-on' | 'neutral'.
    Branches replicate computeRegime in src/lib/market-regime.ts exactly:
      VIX >= 25                 -> risk-off
      VIX in [20, 25)           -> risk-off only when VIX spiked > +3%
      VIX < 15                  -> risk-on
      VIX in [15, 20)           -> SPX decides (> +0.3 on, < -0.3 off, else neutral)
    """
    if vix_level >= VIX_EXTREME_LEVEL:
        return "risk-off"
    if vix_level >= VIX_ELEVATED_LEVEL:
        return "risk-off" if vix_pct_change > VIX_SPIKE_PCT else "neutral"
    if vix_level < VIX_CALM_LEVEL:
        return "risk-on"
    if spx_pct_change > SPX_TIEBREAK_PCT:
        return "risk-on"
    if spx_pct_change < -SPX_TIEBREAK_PCT:
        return "risk-off"
    return "neutral"


# ── Sentiment vocabulary, regime-conditioned ────────────────────────────────
# All 16 words from the original prompt spec, assigned across regimes. The
# synthesis prompt constrains sentiment_word to the active regime's subset;
# enforce_tape_consistency overrides any out-of-subset word to the default.
REGIME_VOCAB = {
    "risk-off": ("heavy", "defensive", "fragile", "jittery", "uneasy", "guarded", "restrained", "cautious"),
    "risk-on": ("buoyant", "steady", "resilient"),
    "neutral": ("mixed", "divided", "split", "conflicted", "choppy"),
}
REGIME_DEFAULT_WORD = {
    "risk-off": "heavy",
    "risk-on": "buoyant",
    "neutral": "mixed",
}
REGIME_MARKET_TONE = {
    "risk-off": "RISK-OFF",
    "risk-on": "RISK-ON",
    "neutral": "NEUTRAL",
}
# market_tone values accepted without override, per regime. Neutral regime
# tolerates MIXED (the schema's fourth value) since both mean "no clear lean".
_TONE_ACCEPTED = {
    "risk-off": ("RISK-OFF",),
    "risk-on": ("RISK-ON",),
    "neutral": ("NEUTRAL", "MIXED"),
}


# ── Yahoo daily-bar quotes with baseline-correct prior close ────────────────
# Why not meta.chartPreviousClose: on range=1d it can anchor to the close TWO
# sessions back (observed live on ^RUT 2026-06-05: meta said 2893.51, the Jun 3
# close, while the true prior close was 2935.33, turning a -3.47% day into
# -2.07%). meta.previousClose is null for caret indices, so it cannot correct
# it. The fix: pull range=5d and derive the prior close from the actual last
# two daily bars. TS twin: src/lib/yahoo-daily.ts.

YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
_YAHOO_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; Signalera/1.0)"}
_DAY_SECONDS = 86400

# ── Freshness guard (P0: stale-index defense) ───────────────────────────────
# A quote timestamp (regularMarketTime, unix seconds) must belong to the CURRENT
# session to be trusted. On a weekend / holiday, or after a silently-stale fetch,
# Yahoo can echo a prior session's close indefinitely; that is exactly how an
# index panel freezes to the penny across two sessions while VIX/oil/names move.
# We treat a quote as stale when its timestamp is older than this many hours at
# fetch time. 30h covers a normal overnight gap (Fri close -> Mon open is handled
# by the weekend allowance below) without tolerating a two-session-old echo.
QUOTE_MAX_AGE_HOURS = 30
# On weekends the last real session is Friday, so a quote can legitimately be up
# to ~72h old. We do NOT hard-fail then; we only flag it. The current-session
# assert is meaningful on trading days.
_WEEKEND_MAX_AGE_HOURS = 80


def _quote_age_hours(ts: int | None, *, now_utc: datetime | None = None) -> float | None:
    """Age of a quote timestamp in hours. None when ts is missing/unusable."""
    if ts is None:
        return None
    try:
        now = now_utc or datetime.now(timezone.utc)
        return (now.timestamp() - float(ts)) / 3600.0
    except (TypeError, ValueError, OSError):
        return None


def quote_is_fresh(ts: int | None, *, now_utc: datetime | None = None) -> bool:
    """FRESHNESS ASSERT: True when a quote timestamp belongs to the current
    session (age within QUOTE_MAX_AGE_HOURS, or the weekend allowance on Sat/Sun).
    A missing timestamp is NOT fresh: we cannot prove the current session, so we
    fail loud rather than trust an unstamped price. Pure, never raises."""
    age = _quote_age_hours(ts, now_utc=now_utc)
    if age is None:
        return False
    now = now_utc or datetime.now(timezone.utc)
    # Python weekday(): Mon=0 .. Sun=6. Sat/Sun get the wider allowance.
    limit = _WEEKEND_MAX_AGE_HOURS if now.weekday() >= 5 else QUOTE_MAX_AGE_HOURS
    return 0 <= age <= limit


def parse_yahoo_daily(chart_json: dict) -> dict | None:
    """
    Derive {price, prev, pct, change, ts} from a Yahoo v8 chart response
    (interval=1d, range=5d). `prev` is the latest daily close that belongs to
    a session strictly before the session of the live quote, computed in
    exchange-local days via meta.gmtoffset.

    Degradation chain when daily bars cannot supply a prior close (fewer than
    2 bars, fresh listing, null-padded closes): meta.chartPreviousClose, then
    meta.previousClose, then no baseline (pct/change of 0.0). Never raises.
    """
    try:
        result = (chart_json or {}).get("chart", {}).get("result") or []
        if not result:
            return None
        result = result[0] or {}
        meta = result.get("meta") or {}

        timestamps = result.get("timestamp") or []
        quote = ((result.get("indicators") or {}).get("quote") or [{}])[0] or {}
        closes = quote.get("close") or []
        bars = [
            (int(ts), float(c))
            for ts, c in zip(timestamps, closes)
            if ts is not None and c is not None
        ]

        raw_price = meta.get("regularMarketPrice")
        price = float(raw_price) if raw_price is not None else (bars[-1][1] if bars else None)
        if price is None or price == 0:
            return None

        gmtoffset = int(meta.get("gmtoffset") or 0)
        market_ts = meta.get("regularMarketTime")
        if not isinstance(market_ts, (int, float)):
            market_ts = bars[-1][0] if bars else None

        prev = None
        if market_ts is not None and bars:
            quote_day = (int(market_ts) + gmtoffset) // _DAY_SECONDS
            prior = [c for ts, c in bars if (ts + gmtoffset) // _DAY_SECONDS < quote_day]
            if prior:
                prev = prior[-1]
        if prev is None:
            for key in ("chartPreviousClose", "previousClose"):
                v = meta.get(key)
                if v:
                    prev = float(v)
                    break

        if prev:
            pct = (price - prev) / prev * 100.0
            change = price - prev
        else:
            prev = 0.0
            pct = 0.0
            change = 0.0

        return {
            "price": price,
            "prev": prev,
            "pct": round(pct, 2),
            "change": change,
            "ts": int(market_ts) if market_ts is not None else None,
        }
    except Exception as e:
        logger.warning("market_tape: parse_yahoo_daily failed: %s", e)
        return None


def fetch_quote(symbol: str, timeout: int = 8) -> dict | None:
    """Fetch one symbol's baseline-correct daily quote from Yahoo. None on any failure."""
    try:
        resp = requests.get(
            YAHOO_CHART_URL.format(symbol=requests.utils.quote(symbol)),
            params={"interval": "1d", "range": "5d"},
            headers=_YAHOO_HEADERS,
            timeout=timeout,
        )
        if resp.status_code != 200:
            logger.warning("market_tape: %s returned %d", symbol, resp.status_code)
            return None
        return parse_yahoo_daily(resp.json())
    except Exception as e:
        logger.warning("market_tape: fetch_quote(%s) failed: %s", symbol, e)
        return None


TAPE_SYMBOLS = {
    "^GSPC": "S&P 500",
    "^IXIC": "Nasdaq Composite",
    "^DJI": "Dow Jones Industrial Average",
    "^RUT": "Russell 2000",
    "^VIX": "VIX",
}

# Additive enrichment (Agent C consumes these; existing tape keys are untouched).
# These are fetched through the SAME baseline-correct Yahoo daily path, so they
# are freshness-checked identically to the indices. ^TNX is the CBOE 10-year
# yield *10 (a 4.21% yield quotes as 42.1); CL=F is front-month WTI crude.
# NOTE ON WHAT IS *NOT* OBTAINABLE HERE: the Yahoo per-symbol chart endpoint
# returns OHLC for one instrument only. It exposes NO index constituents and NO
# advance/decline line, so a REAL market-breadth measure (pct of members up, A/D)
# cannot be derived from this source. Sector leadership is approximated below via
# the sector ETFs; it is a proxy (ETF day-moves), not true constituent breadth.
ENRICH_SYMBOLS = {
    "^TNX": "10Y Treasury Yield",
    "CL=F": "WTI Crude",
}

# Sector-leadership proxy: the 11 SPDR Select Sector ETFs. Their per-ETF daily
# move is a coarse leadership read (which sectors led / lagged), NOT breadth.
SECTOR_ETFS = {
    "XLK": "Technology",
    "XLF": "Financials",
    "XLE": "Energy",
    "XLV": "Health Care",
    "XLY": "Consumer Discretionary",
    "XLP": "Consumer Staples",
    "XLI": "Industrials",
    "XLB": "Materials",
    "XLU": "Utilities",
    "XLRE": "Real Estate",
    "XLC": "Communication Services",
}


def fetch_tape(*, enrich: bool = False) -> dict | None:
    """
    Fetch the close-of-day tape and compute the regime.

    Returns {"quotes": {symbol: quote}, "regime": str, "vix_level": float,
    "enrichment": {...}, "stale": [symbols]} or None when the tape is unusable.
    Regime needs ^VIX (level + pct) and ^GSPC (pct); ^IXIC / ^RUT are included
    when available but a miss on either does not sink the tape (partial tape
    still grounds the prompt).

    FRESHNESS (P0): every index/VIX quote must belong to the current session.
    A quote whose timestamp is stale (older than QUOTE_MAX_AGE_HOURS on a trading
    day) is DROPPED LOUD, not silently served: we log a hard warning and remove
    it from the tape. A visibly missing index panel beats a confidently-wrong one
    frozen to the penny across two sessions. If the freshness drop kills ^VIX or
    ^GSPC the whole tape is declared unusable rather than grounding on stale data.

    `enrich`: OFF by default so no existing caller's behavior or network cost
    changes. Agent C opts in with fetch_tape(enrich=True) at the persistence
    site to additively pull rates/oil/sector-ETF quotes into the snapshot.
    """
    now_utc = datetime.now(timezone.utc)
    quotes = {}
    stale = []
    for sym in TAPE_SYMBOLS:
        q = fetch_quote(sym)
        if not q:
            continue
        ts = q.get("ts")
        if not quote_is_fresh(ts, now_utc=now_utc):
            age = _quote_age_hours(ts, now_utc=now_utc)
            age_str = f"{age:.1f}h" if age is not None else "no-timestamp"
            logger.warning(
                "market_tape: STALE index quote DROPPED %s (label=%s ts=%s age=%s) - "
                "refusing to serve a prior-session snapshot as today's tape",
                sym, TAPE_SYMBOLS[sym], ts, age_str,
            )
            stale.append(sym)
            continue
        quotes[sym] = q

    vix = quotes.get("^VIX")
    spx = quotes.get("^GSPC")
    if not vix or not spx:
        logger.warning(
            "market_tape: tape unusable (vix=%s spx=%s stale_dropped=%s) - "
            "synthesis will run ungrounded",
            bool(vix), bool(spx), stale or None,
        )
        return None

    regime = compute_regime(
        vix_level=vix["price"],
        vix_pct_change=vix["pct"],
        spx_pct_change=spx["pct"],
    )
    tape = {
        "quotes": quotes,
        "regime": regime,
        "vix_level": vix["price"],
        "stale": stale,
    }
    if enrich:
        tape["enrichment"] = fetch_enrichment(now_utc=now_utc)
    return tape


def fetch_enrichment(*, now_utc: datetime | None = None) -> dict:
    """ADDITIVE (Agent C): fetch rates (10Y level + bps change), oil (WTI), and a
    sector-leadership proxy (SPDR sector-ETF day moves). Same baseline-correct
    Yahoo daily path + freshness assert as the core tape, so a stale enrichment
    quote is dropped LOUD rather than served. Never raises; a total miss returns
    a well-formed dict with null/empty sub-fields (read-side stable).

    BREADTH IS NOT INCLUDED: the Yahoo per-symbol chart endpoint exposes no index
    constituents and no advance/decline line, so a real breadth measure (pct of
    members up, A/D) is NOT obtainable from this source. `leaders`/`laggards` are
    an ETF-move PROXY for sector leadership, not breadth. Callers must NOT present
    the proxy as market breadth."""
    now = now_utc or datetime.now(timezone.utc)

    def _fresh_quote(sym: str, label: str) -> dict | None:
        q = fetch_quote(sym)
        if not q:
            return None
        if not quote_is_fresh(q.get("ts"), now_utc=now):
            logger.warning(
                "market_tape: STALE enrichment quote DROPPED %s (%s) - not served",
                sym, label,
            )
            return None
        return q

    # Rates: ^TNX quotes the 10Y yield * 10 (42.1 == 4.21%). Level is that / 10;
    # bps change is (price - prev) in ^TNX points * 10 (each ^TNX point == 10bps).
    tnx = _fresh_quote("^TNX", "10Y Treasury Yield")
    rates = {"teny_level": None, "teny_bps_change": None}
    if tnx and tnx.get("price") is not None:
        rates["teny_level"] = round(float(tnx["price"]) / 10.0, 2)
        prev = tnx.get("prev")
        if prev:
            rates["teny_bps_change"] = round((float(tnx["price"]) - float(prev)) * 10.0, 1)

    oil_q = _fresh_quote("CL=F", "WTI Crude")
    oil = {
        "wti_level": (round(float(oil_q["price"]), 2) if oil_q and oil_q.get("price") is not None else None),
        "wti_pct": (oil_q.get("pct") if oil_q else None),
    }

    # Sector leadership proxy (ETF day-moves; NOT breadth).
    sector_moves = []
    for sym, label in SECTOR_ETFS.items():
        q = _fresh_quote(sym, label)
        if q and q.get("pct") is not None:
            sector_moves.append({"sector": label, "symbol": sym, "pct": q["pct"]})
    sector_moves.sort(key=lambda s: s["pct"], reverse=True)
    leaders = sector_moves[:3]
    laggards = sorted(sector_moves[-3:], key=lambda s: s["pct"]) if sector_moves else []

    return {
        "rates": rates,
        "oil": oil,
        "sector_leadership": {
            # PROXY: sector-ETF day moves, not constituent breadth.
            "leaders": leaders,
            "laggards": laggards,
            "is_proxy": True,
        },
        # Explicit contract for Agent C: breadth cannot be sourced here.
        "breadth": None,
        "breadth_available": False,
    }


def serialize_tape_snapshot(tape: dict | None, as_of: str | None = None) -> dict | None:
    """Serialize the gen-time tape into a stable, structured snapshot for
    persistence (the v2 Gate 1 prerequisite). Captures per-index pct + level,
    VIX level + change, the computed regime, and an as_of timestamp. Pure: no
    network, no recompute. Returns None when there is no usable tape (weekend /
    thin / fetch failed) so the caller writes null rather than fabricating.

    The shape is read-side stable: keys never change meaning, missing symbols
    serialize to null sub-fields rather than dropping the key."""
    if not tape or not isinstance(tape, dict):
        return None
    quotes = tape.get("quotes") or {}

    def _idx(sym: str) -> dict:
        q = quotes.get(sym) or {}
        # `pct` here is the SINGLE SOURCE OF TRUTH for this index's daily move:
        # computed once in parse_yahoo_daily from baseline-correct daily bars,
        # stored verbatim, never recomputed downstream. Strip and panel must both
        # read this field so they cannot disagree (see PR body: today the frontend
        # re-derives pct live from two different instruments/vendors instead).
        return {"pct": q.get("pct"), "level": q.get("price")}

    snapshot = {
        "as_of": as_of,
        "regime": tape.get("regime"),
        "vix_level": tape.get("vix_level"),
        "vix_pct": (quotes.get("^VIX") or {}).get("pct"),
        "indices": {
            # Keys are stable; a symbol missing from the tape serializes to null
            # sub-fields rather than dropping the key (read-side stability).
            "sp500": _idx("^GSPC"),
            "nasdaq": _idx("^IXIC"),
            "dow": _idx("^DJI"),
            "russell": _idx("^RUT"),
        },
        # Loud staleness carried to the read side: symbols the freshness assert
        # dropped this run. Empty list == all quotes were current-session fresh.
        "stale": list(tape.get("stale") or []),
    }
    # Additive enrichment (Agent C). Present only when fetch_tape ran with
    # enrich=True; absent-key is fine for older readers (read-side stable).
    enrichment = tape.get("enrichment")
    if isinstance(enrichment, dict):
        snapshot["enrichment"] = enrichment
    return snapshot


# ── Overview-subject materiality gate (D2+D3) ───────────────────────────────

def tape_has_material_move(tape: dict | None) -> bool:
    """Gate (a): did the gen-time tape itself move enough that a single driver
    could plausibly own the market-wide read today? True when |S&P %| or |VIX %|
    clears its materiality threshold. Conservative: on a mild tape this is False,
    so the overview defaults to a market-wide synthesis. Pure, never raises."""
    if not tape:
        return False
    try:
        quotes = tape.get("quotes") or {}
        spx = quotes.get("^GSPC") or {}
        vix = quotes.get("^VIX") or {}
        spx_pct = abs(float(spx.get("pct") or 0.0))
        vix_pct = abs(float(vix.get("pct") or 0.0))
        return spx_pct >= MATERIALITY_SPX_ABS_PCT or vix_pct >= MATERIALITY_VIX_ABS_PCT
    except Exception as e:
        logger.warning("market_tape: tape_has_material_move failed: %s", e)
        return False


def _norm_names(names) -> set[str]:
    out: set[str] = set()
    for n in names or []:
        s = str(n or "").strip().lower()
        if s:
            out.add(s)
    return out


def story_companies_are_tape_drivers(story_companies, tape_driver_names) -> bool:
    """Gate (b) proxy: are the story's resolved companies among the day's cited
    movers/driver in the tape data already fetched at gen time? `tape_driver_names`
    is the caller-supplied set of the day's biggest movers / the tape's cited
    driver. Conservative: empty driver set -> False (cannot confirm)."""
    cos = _norm_names(story_companies)
    drivers = _norm_names(tape_driver_names)
    if not cos or not drivers:
        return False
    return bool(cos & drivers)


# D14 framing classifiers ───────────────────────────────────────────────────

_BULLISH_FRAMING = (
    "surge", "surged", "soar", "soared", "rally", "rallied", "record",
    "all-time high", "all time high", "ath", "jump", "jumped", "spike",
    "spiked", "rocket", "rocketed", "skyrocket", "high", "gains", "gained",
    "climb", "climbed", "rose", "rises", "rising", "boom",
)
_BEARISH_FRAMING = (
    "plunge", "plunged", "tumble", "tumbled", "crash", "crashed", "slump",
    "slumped", "sink", "sank", "selloff", "sell-off", "rout", "slide", "slid",
    "drop", "dropped", "fell", "falls", "falling", "decline", "declined",
    "tank", "tanked", "low", "losses",
)


def classify_framing(text: str) -> str | None:
    """Coarse bullish/bearish classification of a story's framing from its lead
    text. Returns 'bullish', 'bearish', or None (mixed/neutral). Pure, never
    raises. Used only to detect a direction contradiction with the live tape."""
    if not text or not isinstance(text, str):
        return None
    low = text.lower()
    bull = sum(1 for w in _BULLISH_FRAMING if w in low)
    bear = sum(1 for w in _BEARISH_FRAMING if w in low)
    if bull > bear:
        return "bullish"
    if bear > bull:
        return "bearish"
    return None


def framing_contradicts_session(framing: str | None, session_pct) -> bool:
    """D14: True when the story's framing direction contradicts the named ticker's
    CURRENT-SESSION move by at least RECON_DIR_PCT. Bullish framing vs a materially
    DOWN ticker, or bearish framing vs a materially UP ticker. Conservative:
    unknown framing or unknown/small move -> False. Pure, never raises."""
    if framing is None or session_pct is None:
        return False
    try:
        pct = float(session_pct)
    except Exception:
        return False
    if framing == "bullish" and pct <= -RECON_DIR_PCT:
        return True
    if framing == "bearish" and pct >= RECON_DIR_PCT:
        return True
    return False


def overview_subject_gate(
    *,
    story_companies,
    is_single_name_or_deal: bool,
    cluster_distinct_sources: int,
    tape: dict | None,
    tape_driver_names=None,
    subject_session_pct=None,
    subject_framing: str | None = None,
) -> dict:
    """Decide whether a single-name OR pure-deal/fundraise story may be the
    overview SUBJECT, or must be relegated to a MENTION inside a market-wide
    overview. Returns {"subject": "story"|"market_wide", "passed": bool,
    "reasons": [...], "checks": {...}}.

    v1 conservative gate, defaults to market-wide. A story-subject overview
    requires ALL THREE proxies (use ONLY signals available at gen time):
      (a) the gen-time tape shows a material move, AND
      (b) the story's resolved companies are among the day's biggest movers /
          the tape's cited driver, AND
      (c) the story's EVENT-level cluster (post-D1) has dominant cross-source
          breadth (>= MATERIALITY_MIN_DISTINCT_SOURCES distinct sources).

    A market-wide story (not single-name / not pure-deal) is always allowed to be
    the subject and keeps the market altitude; the gate only constrains the
    single-name / pure-deal case.

    # TODO(recon open question 2): needs Noah's confirmed inputs. Gate (b) is a
    # proxy on the caller-supplied mover/driver set; precise per-story index
    # contribution is not derivable at gen time, so it is intentionally NOT
    # fabricated here.

    # D14 (NEW): direction reconciliation. `subject_session_pct` is the named
    # ticker's CURRENT-SESSION move at gen time (from market_tape.fetch_quote);
    # `subject_framing` is the story's bullish/bearish framing (classify_framing).
    # When both are supplied and the framing contradicts the live move by
    # RECON_DIR_PCT, the story may NOT lead with that stale-direction framing.
    # When either is None (the #422 call sites), this check is inert and the gate
    # behaves exactly as before (backward compatible)."""
    _dir_contradiction = framing_contradicts_session(subject_framing, subject_session_pct)
    checks = {
        "tape_material": tape_has_material_move(tape),
        "is_tape_driver": story_companies_are_tape_drivers(story_companies, tape_driver_names),
        "dominant_breadth": int(cluster_distinct_sources or 0) >= MATERIALITY_MIN_DISTINCT_SOURCES,
        # True = consistent (or unknown, which is permissive). False ONLY on a
        # confirmed contradiction.
        "direction_consistent": not _dir_contradiction,
    }
    if not is_single_name_or_deal:
        return {"subject": "story", "passed": True,
                "reasons": ["market-wide story; gate not applicable"], "checks": checks}

    reasons = []
    if not checks["tape_material"]:
        reasons.append("tape not material (no single driver owns the read)")
    if not checks["is_tape_driver"]:
        reasons.append("story companies are not the day's tape driver")
    if not checks["dominant_breadth"]:
        reasons.append(
            f"event cluster lacks dominant breadth "
            f"(<{MATERIALITY_MIN_DISTINCT_SOURCES} distinct sources)"
        )
    if not checks["direction_consistent"]:
        try:
            _pct = float(subject_session_pct)
        except Exception:
            _pct = 0.0
        reasons.append(
            f"{subject_framing} framing contradicts the ticker's live session move "
            f"({_pct:+.1f}% today): do not lead with stale-direction framing"
        )

    passed = all(checks.values())
    if passed:
        return {"subject": "story", "passed": True,
                "reasons": ["single-name/deal story cleared materiality gate"],
                "checks": checks,
                "direction_contradiction": _dir_contradiction,
                "subject_session_pct": subject_session_pct}
    return {"subject": "market_wide", "passed": False,
            "reasons": reasons or ["relegated to mention"], "checks": checks,
            "direction_contradiction": _dir_contradiction,
            "subject_session_pct": subject_session_pct}


def build_overview_subject_directive(gate: dict, story_title: str = "") -> str:
    """Render the [OVERVIEW SUBJECT] directive prepended to the synthesis system
    prompt (same injection pattern as the tape directive). Tells Gemini whether
    the market_pulse overview centers on the pre-picked story or stays a
    market-wide synthesis with that story relegated to a mention. No edits to any
    route file: this rides the existing system-prompt prepend path."""
    title = (story_title or "").strip()[:160]
    if gate.get("subject") == "story":
        body = (
            "The pre-picked lead story cleared the market-materiality gate, so the "
            "market_pulse.narrative MAY center on it, but stay at MARKET altitude: "
            "frame it as what the whole tape turns on, not a single-name writeup."
        )
    else:
        reasons = "; ".join(gate.get("reasons") or ["not material market-wide"])
        body = (
            "The pre-picked lead story did NOT clear the market-materiality gate "
            f"({reasons}). The market_pulse overview MUST be a MARKET-WIDE synthesis "
            "chosen from the tape: index moves, breadth, volatility, rates, and the "
            "dominant macro driver. Do NOT let the lead story become the overview "
            "subject. It may appear only as ONE mention among several distinct "
            "drivers, never as the through-line."
        )
    lines = [
        "[OVERVIEW SUBJECT - deterministic market-materiality gate]",
    ]
    if title:
        lines.append(f'Pre-picked lead: "{title}"')
    lines.append(body)
    # D14: when the live session contradicts the story's framing, instruct a
    # reconcile-not-celebrate reframe regardless of the subject decision. Prefer a
    # reframe that names the live move over silently dropping the story.
    if gate.get("direction_contradiction"):
        pct = gate.get("subject_session_pct")
        try:
            pct_txt = f"{float(pct):+.1f}% today" if pct is not None else "down today"
        except Exception:
            pct_txt = "down today"
        lines.append(
            "LIVE-QUOTE RECONCILIATION: the lead's bullish framing is from a PRIOR "
            f"session, but the named ticker is {pct_txt} in the current session. Do "
            "NOT celebrate the stale move as today's bullish driver. Reframe to "
            "reconcile the prior move with today's reversal (for example: 'after the "
            "prior session's record, the name is pulling back with its group today'). "
            "State today's direction, not yesterday's."
        )
    return "\n".join(lines) + "\n\n"


def build_overlap_enforcement_directive(gate: dict) -> str:
    """T5: deterministic overlap control between the evening 'The Close' overview
    (market_pulse.narrative) and 'Today's Story' (the lead block: headline +
    lead_paragraph + supporting_context + what_to_watch). Materiality-gates the
    overlap, not a flat similarity cap: the two surfaces may share a subject ONLY
    when that subject is the day's dominant driver (the overview-subject gate
    PASSED). When the gate relegated the lead (it is not the dominant driver), the
    overview MUST take a distinct, market-wide through-line so the two surfaces do
    not both resolve to the relegated lead. Pure; rides the existing prepend path.
    Returns '' when the gate is not applicable (a market-wide story is fine to be
    shared)."""
    # When the gate passed because the lead is genuinely the dominant driver, the
    # two surfaces sharing it is correct, so emit no constraint. When the gate is
    # a market-wide story (not single-name/deal), there is nothing to constrain.
    if gate.get("passed") or gate.get("subject") != "market_wide":
        return ""
    return (
        "[OVERVIEW / LEAD OVERLAP - deterministic materiality rule]\n"
        "The lead story is NOT the day's dominant market driver (see the overview-"
        "subject gate above). Therefore 'The Close' market_pulse.narrative and the "
        "lead block (headline + lead_paragraph) MUST resolve to DISTINCT subjects: "
        "the narrative takes the market-wide through-line from the tape (the real "
        "driver of today's session), and the lead block keeps the pre-picked story. "
        "Do NOT let both surfaces center on the same relegated lead. They may share a "
        "subject ONLY when that subject is the day's dominant driver, which it is not "
        "today.\n\n"
    )


# ── Prompt grounding + post-parse enforcement ───────────────────────────────

def build_tape_directive(tape: dict) -> str:
    """
    Render the [TAPE FACTS] block prepended to the synthesis system prompt
    (same injection pattern as the morning-dedup directive in synthesize.py).
    """
    quotes = tape["quotes"]
    regime = tape["regime"]
    vocab = REGIME_VOCAB[regime]

    index_bits = []
    for sym, label in TAPE_SYMBOLS.items():
        if sym == "^VIX":
            continue
        q = quotes.get(sym)
        if q:
            index_bits.append(f"{label}: {q['pct']:+.2f}%")
    vix = quotes["^VIX"]

    lines = [
        "[TAPE FACTS - deterministic close-of-day market data]",
        " | ".join(index_bits) if index_bits else "(index data unavailable)",
        f"VIX: {vix['price']:.1f} ({vix['pct']:+.1f}% vs prior close)",
        f"Computed regime: {regime.upper()}",
        "",
        "GROUNDING RULES (absolute, supersede any conflicting guidance below):",
        "- These numbers are ground truth for today's tape. The market_pulse "
        "narrative and every market-direction claim you write MUST be consistent "
        "with them. Never describe the tape as mixed, resilient, or rallying when "
        "the indices above are broadly negative, and never describe it as heavy or "
        "defensive when they are broadly positive.",
        f"- sentiment_word MUST be one of exactly: {', '.join(vocab)}. "
        "No word outside this list is valid today.",
        f"- market_tone MUST be {REGIME_MARKET_TONE[regime]}."
        + (" (MIXED is also acceptable.)" if regime == "neutral" else ""),
    ]
    return "\n".join(lines) + "\n\n"


def enforce_tape_consistency(data: dict, regime: str | None) -> list:
    """
    Post-parse backstop, applied to the parsed Gemini JSON in place.

      - regime known: sentiment_word outside the regime's subset is overridden
        to the regime default; market_tone outside the accepted set is
        overridden to the canonical tone.
      - regime unknown (tape fetch failed): sentiment_word is forced to None
        rather than shipping an ungrounded word. Nothing here ever defaults
        to "mixed" without a computed neutral regime backing it.

    Returns a list of warning strings (already logged) for the caller's run log.
    """
    warnings = []
    mp = data.get("market_pulse")
    mp = mp if isinstance(mp, dict) else None

    if regime is None:
        if mp and mp.get("sentiment_word") is not None:
            warnings.append(
                f"tape unavailable: dropping ungrounded sentiment_word "
                f"{mp.get('sentiment_word')!r} -> None"
            )
            mp["sentiment_word"] = None
    else:
        if mp is not None:
            word = (mp.get("sentiment_word") or "").strip().lower()
            allowed = REGIME_VOCAB[regime]
            if word not in allowed:
                default = REGIME_DEFAULT_WORD[regime]
                warnings.append(
                    f"sentiment_word {word!r} not in {regime} vocab -> overriding to {default!r}"
                )
                mp["sentiment_word"] = default
            else:
                mp["sentiment_word"] = word

        tone = (data.get("market_tone") or "").strip().upper()
        if tone not in _TONE_ACCEPTED[regime]:
            canonical = REGIME_MARKET_TONE[regime]
            warnings.append(
                f"market_tone {tone!r} inconsistent with {regime} regime -> overriding to {canonical!r}"
            )
            data["market_tone"] = canonical

    for w in warnings:
        logger.warning("market_tape: %s", w)
    return warnings
