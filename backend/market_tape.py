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
    "^RUT": "Russell 2000",
    "^VIX": "VIX",
}


def fetch_tape() -> dict | None:
    """
    Fetch the close-of-day tape and compute the regime.

    Returns {"quotes": {symbol: quote}, "regime": str, "vix_level": float}
    or None when the tape is unusable. Regime needs ^VIX (level + pct) and
    ^GSPC (pct); ^IXIC / ^RUT are included when available but a miss on either
    does not sink the tape (partial tape still grounds the prompt).
    """
    quotes = {}
    for sym in TAPE_SYMBOLS:
        q = fetch_quote(sym)
        if q:
            quotes[sym] = q

    vix = quotes.get("^VIX")
    spx = quotes.get("^GSPC")
    if not vix or not spx:
        logger.warning(
            "market_tape: tape unusable (vix=%s spx=%s) - synthesis will run ungrounded",
            bool(vix), bool(spx),
        )
        return None

    regime = compute_regime(
        vix_level=vix["price"],
        vix_pct_change=vix["pct"],
        spx_pct_change=spx["pct"],
    )
    return {"quotes": quotes, "regime": regime, "vix_level": vix["price"]}


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
