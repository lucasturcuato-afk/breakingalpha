"""D13 temporal grounding: anchor relative-time words to the brief date.

The bug: an article published the prior session can narrate "today" / "this
morning", and that relative time gets copied verbatim onto the next session's
brief (the 2026-06-26 Micron case: a Jun 25 ATH article said "today" and the
Jun 26 brief shipped it). Selection/ranking PRs do not touch narration, so the
fix lives here.

This module is PURE and stdlib-only (datetime + zoneinfo). No network, no DB,
no Gemini. It is the primary offline-harness target. The caller (synthesize.py)
is responsible for fetching dates and deciding whether to trigger a re-ask; this
module only computes the brief/event dates and rewrites relative-time tokens
deterministically.

Contract:
  - brief_date: the run date in market tz (ET).
  - event_date per story: date(published_at converted to ET), or None (UNKNOWN)
    when published_at is missing. CRITICAL: convert UTC -> ET BEFORE taking the
    date; a Jun 25 evening-ET article is Jun 26 in UTC, and naive UTC math
    mislabels it.
  - normalize_relative_time(text, event_date, brief_date): rewrite the
    relative-time tokens in `text` to be consistent with how far `event_date`
    is before `brief_date`. Returns (new_text, changed: bool, garbled: bool).
    `garbled` signals the caller that a safe in-place rewrite was not possible
    and a single targeted re-ask should run instead.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timezone

try:
    from zoneinfo import ZoneInfo
    _ET = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover - zoneinfo is stdlib on 3.9+
    _ET = None


# Relative-time tokens that assert "as of right now". Order matters: longer
# phrases are matched before their substrings so "earlier today" is handled
# before "today". Case-insensitive, word-boundary anchored.
_RELATIVE_TOKENS = (
    "earlier today",
    "this morning",
    "this afternoon",
    "tonight",
    "today",
    "currently",
    "right now",
    "now",
)


def to_et(ts) -> datetime | None:
    """Coerce a timestamp (ISO string with offset, or aware/naive datetime) to an
    aware ET datetime. Naive inputs are assumed UTC (the DB stores UTC). Returns
    None on anything unparseable. Never raises."""
    if ts is None:
        return None
    try:
        if isinstance(ts, datetime):
            dt = ts
        else:
            s = str(ts).strip()
            if not s:
                return None
            # Normalize a trailing Z to an explicit UTC offset for fromisoformat.
            s = s.replace("Z", "+00:00")
            dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        if _ET is not None:
            return dt.astimezone(_ET)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def brief_date_et(now: datetime | None = None) -> date:
    """The run date in ET. `now` defaults to the real clock; pass it in tests."""
    base = now or datetime.now(timezone.utc)
    et = to_et(base)
    return (et or base).date()


def event_date_et(published_at) -> date | None:
    """event_date for a story = date(published_at in ET), or None (UNKNOWN) when
    published_at is missing/unparseable. P0.1: the articles schema has no distinct
    event timestamp, so published_at (ET-converted) is the only available signal."""
    et = to_et(published_at)
    return et.date() if et is not None else None


_WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
             "Saturday", "Sunday")


def relative_phrase(event_date: date | None, brief_date: date) -> str | None:
    """The relative-time phrase that correctly describes how far `event_date` is
    before `brief_date`. Returns:
      - "today" when same day,
      - "yesterday" when one day prior,
      - the weekday name (e.g. "Thursday") when within the same trailing week,
      - "earlier this week" / "last week" for older same-/prior-week,
      - None when UNKNOWN (caller must strip relative-time, never assert today).
    Future event_date (clock skew) is treated as today.
    """
    if event_date is None:
        return None
    delta = (brief_date - event_date).days
    if delta <= 0:
        return "today"
    if delta == 1:
        return "yesterday"
    if delta <= 6:
        return _WEEKDAYS[event_date.weekday()]
    if delta <= 13:
        return "last week"
    return "earlier this month"


# Tokens whose removal/replacement is safe inline. "today" and "this morning"
# etc. map onto the relative phrase; bare "now"/"currently" assert present tense
# and are simply removed when the event is not today.
def _replacement_for(token: str, phrase: str | None) -> str | None:
    """The inline replacement for one matched token given the target phrase.
    None means "no safe inline rewrite" (caller should re-ask)."""
    t = token.lower()
    if phrase == "today":
        return None  # leave today-tokens alone when the event really is today
    # Present-tense tokens: drop them when the event is not today.
    if t in ("now", "currently", "right now"):
        return "" if phrase is not None else ""
    # Day-relative tokens.
    if t in ("today", "earlier today"):
        return phrase if phrase else ""
    if t in ("this morning", "this afternoon", "tonight"):
        if phrase == "yesterday":
            return "yesterday"
        if phrase is None:
            return ""
        # weekday / "last week" etc.: collapse the time-of-day to the day phrase.
        return phrase
    return ""


def _strip_double_spaces(s: str) -> str:
    s = re.sub(r"\s{2,}", " ", s)
    s = re.sub(r"\s+([,.;:])", r"\1", s)
    return s.strip()


def normalize_relative_time(
    text: str, event_date: date | None, brief_date: date
) -> tuple[str, bool, bool]:
    """Rewrite relative-time tokens in `text` to be consistent with `event_date`
    vs `brief_date`. Returns (new_text, changed, garbled).

    - event_date == brief_date: "today" / "this morning" allowed, no change.
    - event_date == brief_date - 1: "today" -> "yesterday", time-of-day stripped.
    - same trailing week: rewrite to the weekday name.
    - older: "last week" / "earlier this month".
    - UNKNOWN (event_date is None): remove the relative-time clause; never assert
      "today".

    `garbled` is True when a token was found that we could not rewrite cleanly in
    place (e.g. a rewrite that would break the sentence). The caller should then
    trigger ONE targeted re-ask instead of shipping the in-place edit. This
    function never calls a model.
    """
    if not text or not isinstance(text, str):
        return (text or ""), False, False

    phrase = relative_phrase(event_date, brief_date)
    # When the event is genuinely today, nothing to do.
    if phrase == "today":
        return text, False, False

    changed = False
    garbled = False
    out = text

    for token in _RELATIVE_TOKENS:
        pattern = re.compile(r"\b" + re.escape(token) + r"\b", re.IGNORECASE)
        if not pattern.search(out):
            continue
        repl = _replacement_for(token, phrase)
        if repl is None:
            # Should not happen for non-today phrases, but stay safe.
            continue

        def _sub(m: re.Match) -> str:
            nonlocal changed
            changed = True
            original = m.group(0)
            if not repl:
                return ""
            # Preserve leading-cap if the token started a sentence.
            if original[:1].isupper():
                return repl[:1].upper() + repl[1:]
            return repl

        out = pattern.sub(_sub, out)

    if changed:
        out = _strip_double_spaces(out)
        # Detect a garbled result: dangling preposition before a removed clause,
        # or an empty sentence, or a doubled day phrase. These read badly enough
        # that a re-ask is preferable to shipping them.
        if re.search(r"\b(on|at|as of)\s*[,.]", out, re.IGNORECASE):
            garbled = True
        if re.search(r"\b(\w+day)\s+\1\b", out, re.IGNORECASE):
            garbled = True
        if re.search(r"\byesterday\s+yesterday\b", out, re.IGNORECASE):
            garbled = True
        if re.search(r"[,;]\s*[,;]", out):
            garbled = True

    return out, changed, garbled


def build_temporal_directive(brief_date: date, event_date: date | None,
                             lead_title: str = "") -> str:
    """Prompt directive prepended to the synthesis system prompt: tell the model
    the brief date and the lead story's event date, and to anchor relative time to
    the brief date. The deterministic normalizer is the backstop; this is the
    first line of defense. Same injection pattern as the tape directive."""
    title = (lead_title or "").strip()[:160]
    phrase = relative_phrase(event_date, brief_date)
    lines = [
        "[TEMPORAL ANCHOR - deterministic date grounding]",
        f"Brief date (ET): {brief_date.isoformat()} ({brief_date.strftime('%A')}).",
    ]
    if event_date is None:
        lines.append(
            "The lead story has NO confirmed event date. Do NOT write 'today', "
            "'this morning', or any present-tense relative time about it; describe "
            "it without a relative-time claim."
        )
    else:
        lines.append(
            f"Lead story event date (ET): {event_date.isoformat()} "
            f"({event_date.strftime('%A')})."
        )
        if phrase == "today":
            lines.append(
                "The lead event is TODAY: 'today' / 'this morning' are accurate."
            )
        else:
            lines.append(
                f"The lead event happened {phrase}, NOT today. Anchor all "
                f"relative-time words to the brief date: say '{phrase}', never "
                "'today' or 'this morning', when describing that event. A prior-"
                "session move is past tense on today's brief."
            )
    if title:
        lines.append(f'Lead: "{title}"')
    return "\n".join(lines) + "\n\n"
