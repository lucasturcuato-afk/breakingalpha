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
from datetime import datetime, timedelta, timezone

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
# A quote timestamp (regularMarketTime, unix seconds) must belong to the most
# recent ACTUAL trading session to be trusted. On a weekend / holiday, or after a
# silently-stale fetch, Yahoo can echo a PRIOR session's close indefinitely; that
# is exactly how an index panel freezes to the penny across two sessions while
# VIX/oil/names move.
#
# THE TWO FAILURE MODES ARE DIFFERENT AND MUST NOT BE CONFLATED (PR #461 blast
# radius fix):
#   1. PROVABLY STALE: the timestamp is PRESENT and belongs to a session strictly
#      BEFORE the most recent trading session. This is a real prior-session echo.
#      Drop it loud. (quote_is_fresh -> False)
#   2. UNVERIFIABLE: the timestamp is MISSING. We cannot prove staleness OR
#      freshness. #461 itself proved this path was never actually stale (stored
#      Jul 9 != Jul 10). Absent metadata must NEVER kill a brief: keep the quote,
#      log loud, mark it unverified. quote_is_fresh returns True for a missing ts
#      so the fetch path does not drop it; the caller separates the two modes via
#      quote_staleness (below).
#
# Freshness uses a LAST-TRADING-SESSION reference, not a fixed hour window, so a
# Monday market holiday cannot false-positive a legitimate Friday-stamped quote.
# The most recent trading session is the last weekday on or before `now` (a coarse
# but holiday-safe reference: it counts Mon-Fri as sessions, so the reference is
# always the last plausible session open, and a genuine holiday only widens the
# allowance, it never tightens it). A quote is fresh when its timestamp is at or
# after that session's open, allowing for the overnight gap to `now`.

# A trading session's quote can legitimately be as old as the gap from the most
# recent session open to `now`. We add a small safety pad for clock skew and the
# after-hours stamp drift Yahoo shows post-close.
_SESSION_SKEW_HOURS = 6.0
# US regular open is 09:30 ET == 13:30 UTC (14:30 UTC in winter; the extra hour
# is absorbed by _SESSION_SKEW_HOURS). Reference the session by its UTC open.
_SESSION_OPEN_UTC_HOUR = 13.5


def _quote_age_hours(ts: int | None, *, now_utc: datetime | None = None) -> float | None:
    """Age of a quote timestamp in hours. None when ts is missing/unusable."""
    if ts is None:
        return None
    try:
        now = now_utc or datetime.now(timezone.utc)
        return (now.timestamp() - float(ts)) / 3600.0
    except (TypeError, ValueError, OSError):
        return None


def _weekday_open_on_or_before(dt: datetime) -> datetime:
    """The 09:30-ET session open (in UTC) of the last weekday on or before dt's
    calendar day, anchored to dt's date at the session-open hour. Pure."""
    ref = dt.replace(
        hour=int(_SESSION_OPEN_UTC_HOUR),
        minute=int((_SESSION_OPEN_UTC_HOUR % 1) * 60),
        second=0,
        microsecond=0,
    )
    while ref.weekday() >= 5:  # Mon=0 .. Fri=4; skip Sat/Sun
        ref = ref - timedelta(days=1)
    return ref


def last_trading_session_open(now_utc: datetime | None = None) -> datetime:
    """Return the UTC datetime of the most recent trading session's open at or
    before `now_utc`. The most recent session is the last weekday (Mon-Fri) on or
    before today; if today is a weekday but `now` is before that day's open, the
    reference is the PRIOR weekday's open. Holiday-safe by construction: a market
    holiday is not a distinct case, it only means the true last session was
    earlier, which widens the freshness allowance (never tightens it). Pure."""
    now = now_utc or datetime.now(timezone.utc)
    open_today = now.replace(
        hour=int(_SESSION_OPEN_UTC_HOUR),
        minute=int((_SESSION_OPEN_UTC_HOUR % 1) * 60),
        second=0,
        microsecond=0,
    )
    # Start from today if a weekday and we are at/after its open; else step back.
    anchor = now if now >= open_today else (now - timedelta(days=1))
    return _weekday_open_on_or_before(anchor)


# How many weekday sessions before the reference session are still tolerated as
# fresh. WHY 2 (not 1): the morning brief generates pre/at-open and legitimately
# carries the PRIOR close (ref-1). One more session of slack (ref-2) absorbs a
# single market HOLIDAY without a holiday calendar: on a post-holiday Tuesday the
# true last session is Friday, which is the 2nd weekday back (Mon was closed), so
# a legitimate Friday quote stays fresh. A THREE-session-old stamp is still
# provably stale, and the frozen_suspect detector catches the real to-the-penny
# echo independently of any timestamp. Tunable.
_FRESH_SESSIONS_BACK = 2


def _fresh_floor(now_utc: datetime) -> datetime:
    """The oldest timestamp still considered current-session-fresh: the open of
    the session _FRESH_SESSIONS_BACK weekday sessions before the reference session
    (minus a skew pad). This keeps a legitimate prior-close read fresh (morning
    brief) AND absorbs one market holiday without a holiday calendar, while a stamp
    older than that is flagged provably stale. The frozen_suspect detector is the
    timestamp-independent catch for the actual echo bug. Pure."""
    ref = last_trading_session_open(now_utc)
    floor_open = ref
    for _ in range(_FRESH_SESSIONS_BACK):
        floor_open = _weekday_open_on_or_before(floor_open - timedelta(days=1))
    return floor_open - timedelta(hours=_SESSION_SKEW_HOURS)


def quote_is_fresh(ts: int | None, *, now_utc: datetime | None = None) -> bool:
    """FRESHNESS ASSERT (last-trading-session reference). Returns True when the
    quote may be served:
      - MISSING ts -> True (UNVERIFIABLE, not provably stale; the caller marks it
        unverified rather than dropping it). Missing metadata must never kill a
        brief.
      - PRESENT ts at or after the most recent trading session's open (minus a
        skew pad) -> True (belongs to the current/last session).
      - PRESENT ts before that -> False (PROVABLY STALE prior-session echo).
    Holiday-safe: the reference is the last actual weekday session, so a Monday
    holiday cannot false-flag a legitimate Friday quote. Pure, never raises."""
    return quote_staleness(ts, now_utc=now_utc) != "stale"


def quote_staleness(ts: int | None, *, now_utc: datetime | None = None) -> str:
    """Classify a quote timestamp into exactly ONE of the two failure modes plus
    the healthy case. This is the SSOT for the split #461 conflated:
      - "fresh"       : ts present and at/after the last session open (serve it).
      - "stale"       : ts present but BEFORE the last session open (drop loud).
      - "unverifiable": ts missing (keep + mark unverified; retry upstream). Pure.
    """
    if ts is None:
        return "unverifiable"
    now = now_utc or datetime.now(timezone.utc)
    try:
        ts_dt = datetime.fromtimestamp(float(ts), tz=timezone.utc)
    except (TypeError, ValueError, OSError, OverflowError):
        return "unverifiable"
    # A future timestamp is not a valid current-session stamp.
    if ts_dt > now + timedelta(hours=1):
        return "stale"
    return "fresh" if ts_dt >= _fresh_floor(now) else "stale"


# ── Direct freeze detector (the actually-observed #461 signature) ────────────
# The freeze bug does NOT depend on timestamp metadata: an index panel echoes a
# PRIOR session's close to the penny while VIX/oil/names move. The most reliable
# tell is a cross-session identity check: if a freshly fetched index level equals
# the PRIOR persisted session's level EXACTLY (to the penny), across two DIFFERENT
# sessions, that is the freeze. This catches the real bug even when the timestamp
# is missing or itself echoed.
_FREEZE_INDEX_KEYS = {
    # fetched-quote symbol -> persisted-snapshot indices key
    "^GSPC": "sp500",
    "^IXIC": "nasdaq",
    "^DJI": "dow",
    "^RUT": "russell",
}


def indices_frozen_suspect(current_quotes: dict | None, prior_session_tape: dict | None) -> list[str]:
    """PURE freeze detector. Compare freshly fetched index levels against the
    PRIOR persisted session's serialized tape snapshot. Return the list of index
    symbols whose current level is IDENTICAL TO THE PENNY to the prior session's
    level. An empty list means no freeze suspected (or nothing to compare).

    `current_quotes` is fetch_tape's quotes dict ({symbol: {"price": ...}}).
    `prior_session_tape` is a serialize_tape_snapshot() dict from the LAST
    briefing (market_tape column): {"indices": {"sp500": {"level": ...}, ...}}.

    Two different sessions printing the same index level to the penny is
    vanishingly unlikely for a real market; when it happens it is the frozen-echo
    bug. Pure, never raises, never fetches, never reads the DB (the caller wires
    the prior tape in). VIX is intentionally excluded: VIX legitimately can print
    an identical round level and is not the frozen-panel signature."""
    if not isinstance(current_quotes, dict) or not isinstance(prior_session_tape, dict):
        return []
    prior_indices = prior_session_tape.get("indices")
    if not isinstance(prior_indices, dict):
        return []
    frozen: list[str] = []
    for sym, key in _FREEZE_INDEX_KEYS.items():
        q = current_quotes.get(sym)
        cur_level = q.get("price") if isinstance(q, dict) else None
        prior = prior_indices.get(key)
        prior_level = prior.get("level") if isinstance(prior, dict) else None
        if cur_level is None or prior_level is None:
            continue
        try:
            # Identical to the penny: two decimal places is the panel's precision.
            if round(float(cur_level), 2) == round(float(prior_level), 2):
                frozen.append(sym)
        except (TypeError, ValueError):
            continue
    return frozen


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

# ^TNX convention is historically INCONSISTENT on Yahoo: the per-symbol chart
# endpoint has returned the 10Y yield both in PERCENT (~4.6) and in the *10 form
# (~46.0). A hardcoded "/10" ships 0.46% when the endpoint is already in percent
# (observed live 2026-07-11: raw 4.569 -> 0.46 instead of 4.57). Guard on
# magnitude instead: a real 10Y yield is well under 20% in any plausible regime,
# so a raw value above this threshold is the *10 form and gets divided down; a
# value at/below it is already in percent and passes through. Both conventions
# resolve to ~4.6.
_TNX_SCALE_THRESHOLD = 20.0


def normalize_teny_yield(raw) -> float | None:
    """Convert a raw ^TNX price to the 10Y yield in PERCENT (~4.6), robust to
    Yahoo's two conventions (percent ~4.6 vs *10 ~46.0). raw > 20 -> /10; else
    pass through. None on unusable input. Pure, never raises."""
    if raw is None:
        return None
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return None
    return round(v / 10.0 if v > _TNX_SCALE_THRESHOLD else v, 2)

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


def fetch_tape(*, enrich: bool = False, prior_session_tape: dict | None = None) -> dict | None:
    """
    Fetch the close-of-day tape and compute the regime.

    Returns {"quotes": {symbol: quote}, "regime": str, "vix_level": float,
    "enrichment": {...}, "stale": [symbols], "unverified": [symbols],
    "frozen_suspect": [symbols]} or None when the tape is unusable. Regime needs
    ^VIX (level + pct) and ^GSPC (pct); ^IXIC / ^RUT are included when available
    but a miss on either does not sink the tape (partial tape still grounds the
    prompt).

    FRESHNESS (P0) - TWO FAILURE MODES, SPLIT (PR #461 blast-radius fix):
      1. PROVABLY STALE (timestamp PRESENT, older than the last trading session's
         open): a real prior-session echo. DROPPED LOUD, listed under tape["stale"].
         If the drop kills ^VIX or ^GSPC the tape is declared unusable rather than
         grounding on a prior-session snapshot. This is the #461 behavior, kept.
      2. UNVERIFIABLE (timestamp MISSING): we cannot prove staleness. #461 itself
         proved this path was never actually stale. We RETRY the fetch once; if the
         timestamp is still missing we KEEP the quote, log loud, and list it under
         tape["unverified"]. Missing metadata NEVER nukes the tape.

    DIRECT FREEZE DETECTOR (timestamp-independent): when `prior_session_tape` (the
    last briefing's serialized market_tape) is supplied, any fetched index whose
    level is IDENTICAL TO THE PENNY to the prior session's level is flagged under
    tape["frozen_suspect"]. This catches the actually-observed frozen-panel echo
    without depending on any timestamp metadata. The reading of the prior tape from
    the DB is wired by the caller (synthesize.py); this function stays pure w.r.t.
    the DB and only compares what it is handed.

    `enrich`: OFF by default so no existing caller's behavior or network cost
    changes. Agent C opts in with fetch_tape(enrich=True) at the persistence
    site to additively pull rates/oil/sector-ETF quotes into the snapshot.
    """
    now_utc = datetime.now(timezone.utc)
    quotes = {}
    stale = []
    unverified = []
    for sym in TAPE_SYMBOLS:
        q = fetch_quote(sym)
        if not q:
            continue
        state = quote_staleness(q.get("ts"), now_utc=now_utc)
        if state == "unverifiable":
            # Mode 2: missing timestamp. Retry ONCE before deciding - a transient
            # meta gap can clear on a second fetch.
            q_retry = fetch_quote(sym)
            if q_retry:
                if quote_staleness(q_retry.get("ts"), now_utc=now_utc) != "unverifiable":
                    q = q_retry
                    state = quote_staleness(q.get("ts"), now_utc=now_utc)
        if state == "stale":
            # Mode 1: provably stale prior-session echo. Drop loud.
            age = _quote_age_hours(q.get("ts"), now_utc=now_utc)
            age_str = f"{age:.1f}h" if age is not None else "no-timestamp"
            logger.warning(
                "market_tape: PROVABLY-STALE index quote DROPPED %s (label=%s ts=%s age=%s) - "
                "timestamp predates the last trading session; refusing to serve a "
                "prior-session snapshot as today's tape",
                sym, TAPE_SYMBOLS[sym], q.get("ts"), age_str,
            )
            stale.append(sym)
            continue
        if state == "unverifiable":
            # Still no timestamp after the retry. KEEP it (missing metadata must
            # not kill a brief) but flag it loud so the read side knows.
            logger.warning(
                "market_tape: UNVERIFIABLE index quote KEPT %s (label=%s) - no timestamp "
                "after retry; cannot prove staleness, serving with tape['unverified'] flag",
                sym, TAPE_SYMBOLS[sym],
            )
            unverified.append(sym)
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
    # DIRECT FREEZE DETECTOR: compare fetched index levels against the prior
    # persisted session (timestamp-independent). Empty list when no prior tape or
    # no penny-identical match.
    frozen_suspect = indices_frozen_suspect(quotes, prior_session_tape)
    if frozen_suspect:
        logger.warning(
            "market_tape: FROZEN-SUSPECT indices %s - fetched level is identical to "
            "the prior session's persisted level to the penny; the panel may be echoing "
            "a stale close. Flagged under tape['frozen_suspect'] for the read side",
            frozen_suspect,
        )
    tape = {
        "quotes": quotes,
        "regime": regime,
        "vix_level": vix["price"],
        "stale": stale,
        "unverified": unverified,
        "frozen_suspect": frozen_suspect,
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

    # Rates: ^TNX is the 10Y yield, but Yahoo's convention (percent ~4.6 vs *10
    # ~46.0) is inconsistent, so normalize BOTH the level and the prior close to
    # percent via the magnitude guard, then derive bps from the percent difference
    # (1 percentage point == 100 bps). This is convention-agnostic: normalizing
    # first means the bps math never depends on which form the raw quote used.
    tnx = _fresh_quote("^TNX", "10Y Treasury Yield")
    rates = {"teny_level": None, "teny_bps_change": None}
    if tnx and tnx.get("price") is not None:
        level = normalize_teny_yield(tnx.get("price"))
        rates["teny_level"] = level
        prev = normalize_teny_yield(tnx.get("prev"))
        if level is not None and prev:
            rates["teny_bps_change"] = round((level - prev) * 100.0, 1)

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
        # Symbols KEPT despite a missing timestamp (mode 2). Present-but-empty by
        # default; a non-empty list means the read side should treat those index
        # values as unverified (not proven stale, not proven fresh).
        "unverified": list(tape.get("unverified") or []),
        # Symbols whose fetched level was identical TO THE PENNY to the prior
        # persisted session (direct freeze detector). Non-empty == likely echo.
        "frozen_suspect": list(tape.get("frozen_suspect") or []),
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
