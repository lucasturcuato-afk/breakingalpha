"""Deterministic session-fit scoring for lead candidates.

Off-path helper module. Agent U (impact_ranking.py / synthesize.py) imports
`session_fit_score` and folds it into the lead contest. This module never edits
those files and never runs on its own in the live pipeline until U wires it.

WHY THIS EXISTS
The 2026-07-15 EVENING (post-close, ~10:40pm ET) wrap led with:
  "Stock market today: Dow, S&P 500, Nasdaq futures extend gains ahead of
   earnings, wholesale inflation data"
That article (published 05:18 ET, pre-market) is a PREVIEW of what MIGHT happen.
It led a post-close wrap of what DID happen because compute_lead has no session
awareness. session_fit_score catches exactly this: an evening wrap should prefer
same-session confirmed events, not a stale pre-market futures preview.

DESIGN (deterministic, no LLM, never raises)
- Keyword framing detectors:
    * PREVIEW / forward framing ("futures", "premarket", "ahead of", "set to
      open", "poised to", "before the bell", "seen ...ing", ...): previews of a
      future move.
    * CONFIRMED / past-session framing ("beats", "reports Q_ ...", "completes",
      "priced", "rose"/"fell", "surged after", ...): what already happened.
- Session windows off the article timestamp vs `now`:
    * EVENING wrap: an article whose only timestamp sits in the pre-market
      window (before market open ET) is treated as pre-market-framed; a
      same-session intraday / after-close article fits.
    * MORNING brief: opening / early-session and intraday framing is fine; a
      stale prior-session story (published well before this session) or a
      far-future preview scores lower.

Scores are clamped to [0.0, 1.0]. Bad input -> a safe neutral default (0.5).
"""

from __future__ import annotations

import datetime
import re

# Neutral fallback when the candidate carries no usable framing or timestamp
# signal, or when anything unexpected happens. Deliberately mid-range: session
# fit is a nudge, not a veto, absent evidence.
NEUTRAL = 0.5

# Score an evening pre-market/futures preview lands at. Well below any
# reasonable lead threshold so U's contest demotes it.
PREVIEW_ON_EVENING = 0.05

# Score a confirmed same-session event lands at on its correct brief.
CONFIRMED_STRONG = 0.9

# Session boundaries in US Eastern (naive wall-clock hours). The pipeline runs
# on UTC timestamps; we convert with a fixed ET offset. DST-exactness is not
# required: these windows are coarse framing gates, not a trading clock.
_ET_OFFSET_HOURS = 4  # EDT (Jul is daylight time). Coarse; see note above.
_MARKET_OPEN_ET = 9.5   # 09:30 ET
_MARKET_CLOSE_ET = 16.0  # 16:00 ET

# Forward / preview framing. Word-boundary matched so "futures" does not fire on
# "future-proof" prose and "poised" does not fire mid-word.
_PREVIEW_PATTERNS = (
    r"\bfutures?\b",
    r"\bpre-?market\b",
    r"\bahead of\b",
    r"\bbefore the bell\b",
    r"\bset to open\b",
    r"\bset to rise\b",
    r"\bset to fall\b",
    r"\bpoised to\b",
    r"\bexpected to\b",
    r"\bpoint(?:s|ing)? (?:higher|lower|to)\b",
    r"\bseen (?:hitting|rising|falling|topping|beating|reaching)\b",
    r"\bwhat to (?:watch|expect)\b",
    r"\bpreview\b",
    r"\bto watch (?:this|next) week\b",
    r"\bcould (?:rise|fall|jump|drop|surge|sink)\b",
    r"\blikely to\b",
    r"\bopening bell\b",  # morning-appropriate, evening-inappropriate; see logic
)

# Confirmed, already-happened framing. Past tense / completion language.
_CONFIRMED_PATTERNS = (
    r"\bbeats?\b",
    r"\bexceed(?:s|ed)\b",
    r"\bmiss(?:es|ed)\b",
    r"\breport(?:s|ed)\b",
    r"\bpost(?:s|ed)\b",
    r"\bcomplete(?:s|d)\b",
    r"\bclose(?:s|d)\b",
    r"\bpriced?\b",
    r"\bannounce(?:s|d)\b",
    r"\bsecure(?:s|d)\b",
    r"\bwin(?:s)?\b",
    r"\bwon\b",
    r"\bsign(?:s|ed)\b",
    r"\brais(?:es|ed)\b",
    r"\bcut(?:s)?\b",
    r"\bsurg(?:es|ed)\b",
    r"\bjump(?:s|ed)\b",
    r"\bsoar(?:s|ed)\b",
    r"\bskyrocket(?:s|ed)\b",
    r"\bslump(?:s|ed)\b",
    r"\bplunge(?:s|d)\b",
    r"\bris(?:es)?\b",
    r"\brose\b",
    r"\bfell\b",
    r"\bfalls?\b",
    r"\bgain(?:s|ed)\b",
    r"\bagree(?:s|d)\b",
    r"\bacquir(?:es|ed)\b",
    r"\bnears? (?:acquisition|deal|merger)\b",
    r"\bbid\b",
    r"\btender offer\b",
    r"\bmerger\b",
    r"\bafter (?:q[1-4]|earnings|results|the close)\b",
)

_PREVIEW_RE = [re.compile(p) for p in _PREVIEW_PATTERNS]
_CONFIRMED_RE = [re.compile(p) for p in _CONFIRMED_PATTERNS]

# "opening bell" is fine on a morning brief but a tell of pre-market framing on
# an evening wrap; handled explicitly rather than by list membership.
_OPENING_RE = re.compile(r"\bopening bell\b|\bat the open\b|\bearly (?:trade|session|trading)\b")


def _text(candidate: dict) -> str:
    """Lowercased title + summary + url. Read defensively; never raise."""
    try:
        parts = [
            str(candidate.get("title") or ""),
            str(candidate.get("summary") or ""),
            str(candidate.get("url") or ""),
        ]
        return " ".join(parts).lower()
    except Exception:
        return ""


def _parse_ts(candidate: dict):
    """Best-effort tz-aware UTC datetime from the candidate. The pool rows carry
    `published_at` (real publish time) and `ingested_at` (fetch time); prefer
    publish. Returns None on any failure."""
    for key in ("published_at", "timestamp", "ingested_at"):
        raw = candidate.get(key)
        if not raw:
            continue
        try:
            dt = datetime.datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=datetime.timezone.utc)
            return dt.astimezone(datetime.timezone.utc)
        except Exception:
            continue
    return None


def _et_hour(dt: datetime.datetime) -> float:
    """Wall-clock hour-of-day in US Eastern (coarse fixed offset), as a float
    (e.g. 9.5 == 09:30). Used only for pre-market / post-close window gating."""
    local = dt - datetime.timedelta(hours=_ET_OFFSET_HOURS)
    return local.hour + local.minute / 60.0


def _n_preview(text: str) -> int:
    return sum(1 for r in _PREVIEW_RE if r.search(text))


def _n_confirmed(text: str) -> int:
    return sum(1 for r in _CONFIRMED_RE if r.search(text))


def session_fit_score(candidate: dict, brief_type: str, now) -> float:
    """Deterministic session-fit for a lead candidate, in [0.0, 1.0].

    POST-CLOSE evening wrap (brief_type == "evening"): a pre-market / futures /
    "ahead of <data>" framed candidate scores near 0.0 (it previews what MIGHT
    happen, wrong for a wrap of what DID happen); a same-session confirmed event
    scores high.
    MORNING (brief_type == "morning"): opening/early-session and intraday
    framing is fine; a stale prior-session or a far-future preview scores lower.

    Keyword + timestamp/session-window based. NEVER an LLM call. Never raises
    (bad input -> a safe neutral default). `candidate` is a
    cluster/article/deal dict; read defensively from title + url +
    published_at/timestamp. `now` is the brief generation time.
    """
    try:
        if not isinstance(candidate, dict):
            return NEUTRAL

        bt = str(brief_type or "").strip().lower()
        text = _text(candidate)
        if not text.strip():
            return NEUTRAL

        n_preview = _n_preview(text)
        n_confirmed = _n_confirmed(text)
        has_opening = bool(_OPENING_RE.search(text))

        ts = _parse_ts(candidate)
        et_h = _et_hour(ts) if ts is not None else None

        # Age of the article relative to the brief generation time, in hours.
        age_h = None
        if ts is not None and isinstance(now, datetime.datetime):
            now_utc = now if now.tzinfo else now.replace(tzinfo=datetime.timezone.utc)
            now_utc = now_utc.astimezone(datetime.timezone.utc)
            age_h = max(0.0, (now_utc - ts).total_seconds() / 3600.0)

        if bt == "evening":
            return _evening_score(n_preview, n_confirmed, et_h, age_h)
        if bt == "morning":
            return _morning_score(n_preview, n_confirmed, has_opening, age_h)

        # Unknown brief_type: no session opinion.
        return NEUTRAL
    except Exception:
        # Contract: never raise. Any surprise collapses to the neutral default.
        return NEUTRAL


def _evening_score(n_preview, n_confirmed, et_h, age_h) -> float:
    """Evening (post-close) wrap. A wrap recounts what happened this session, so
    forward / pre-market framing is wrong and confirmed same-session framing is
    right."""
    # Pre-market framing tell from the timestamp: the article's only usable
    # timestamp sits in the pre-market window (before the open). A futures
    # preview published at 05:18 ET fires here.
    premarket_ts = et_h is not None and et_h < _MARKET_OPEN_ET

    # Strong preview framing OR (preview framing AND a pre-market timestamp) is a
    # near-veto for an evening wrap. The 07-15 "futures ... ahead of ..." lead
    # hits both.
    if n_preview >= 2 or (n_preview >= 1 and premarket_ts):
        return PREVIEW_ON_EVENING

    if n_preview >= 1:
        # A single soft preview token with no pre-market timestamp: demote but
        # not to the floor (could be a mixed headline).
        base = 0.25
    elif n_confirmed >= 1:
        base = CONFIRMED_STRONG
    else:
        base = NEUTRAL

    # Stale beyond the session: an evening wrap on ~10:40pm ET should not lead on
    # a >30h-old item. Light decay so a fresh confirmed event stays high.
    if age_h is not None and age_h > 30.0 and base > NEUTRAL:
        base = max(NEUTRAL, base - 0.2)

    return _clamp(base)


def _morning_score(n_preview, n_confirmed, has_opening, age_h) -> float:
    """Morning brief. Opening / early-session and intraday framing is fine. A
    stale prior-session story or a far-future preview scores lower; a near-term
    preview ("futures point higher" this morning) is legitimately on-session."""
    # Opening-bell / early-session framing is exactly right for a morning brief.
    if has_opening:
        base = CONFIRMED_STRONG
    elif n_confirmed >= 1:
        base = 0.8
    elif n_preview >= 1:
        # Near-term preview is on-session for the morning; only demote when it is
        # clearly far-future (handled by age below).
        base = 0.65
    else:
        base = NEUTRAL

    # Stale prior-session: a morning brief should not lead on a story published
    # more than ~18h before generation (i.e. before yesterday's close carried
    # into a fresh session). Decay with age.
    if age_h is not None:
        if age_h > 48.0:
            base = min(base, 0.2)
        elif age_h > 18.0:
            base = min(base, 0.4)

    return _clamp(base)


def _clamp(x: float) -> float:
    if x != x:  # NaN guard
        return NEUTRAL
    return max(0.0, min(1.0, float(x)))
