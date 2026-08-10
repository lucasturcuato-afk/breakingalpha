"""
brief_email_personal.py - the per-recipient slice of the Morning Brief.

STRICTLY A PROJECTION. Every function here is pure: it takes dicts that the
send path already fetched once for the whole run and returns the subset that
belongs to one user. There is no client parameter, no IO, and above all NO
MODEL CALL. A digest that made one Gemini call per recipient would turn a
single-run cost into a per-subscriber cost and would put an unbounded LLM
dependency on the delivery path. The block is assembled from rows, or it is not
assembled.

WHAT A READER SEES, in this order:
  1. Their tracked calls that resolved since we last mailed them.
  2. Their tracked calls that resolve inside the next week.
  3. Today's stories that touch a ticker on their watchlist.

WHAT AN EMPTY READER SEES: nothing. personal_block() returns None and the
section is omitted. Measured against production on 2026-08-10, the block
renders for 2 of the 42 users who have a watchlist at all: only 13 user_claims
exist product-wide, and the daily story rail is five articles, so a watchlist
hit is rarer than it sounds. That is the case this design is built for. An
empty state would read as a broken email rather than as an honest absence, and
an email is not a dashboard.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any

try:  # pragma: no cover - import shim, mirrors the other backend modules
    from brief_email_render import PersonalBlock, PersonalClaim
    from verdict_vocabulary import verdict_word
except ImportError:  # pragma: no cover
    from backend.brief_email_render import PersonalBlock, PersonalClaim
    from backend.verdict_vocabulary import verdict_word

#: How far forward "resolves soon" reaches.
UPCOMING_DAYS = 7

#: When we have never mailed a user, how far back "since the last send" means.
#: One session, so a first email shows the last session's resolutions and not a
#: retrospective of everything they ever tracked.
FIRST_SEND_LOOKBACK_HOURS = 48

#: Per-list caps. This is a block inside a newsletter, not a report.
MAX_PER_LIST = 3

#: A ticker short enough to collide with ordinary prose ("A", "IT", "ON") is
#: matched only through its display name.
MIN_TICKER_LEN = 3

#: A display name has to be distinctive before substring matching is safe.
MIN_NAME_LEN = 4


@dataclass
class PersonalContext:
    """Shared rows, fetched once per run, sliced per user.

    Nothing in here is per-user work. claims_by_user and watchlist_by_user are
    bucketed once by the caller so a run over 107 recipients is 107 dict
    lookups, not 107 queries.
    """

    claims_by_user: dict[str, list[dict]] = field(default_factory=dict)
    outcomes_by_claim: dict[str, dict] = field(default_factory=dict)
    watchlist_by_user: dict[str, list[dict]] = field(default_factory=dict)
    story_rows: list[dict] = field(default_factory=list)
    last_send_by_user: dict[str, str] = field(default_factory=dict)


def _as_datetime(raw: Any) -> datetime | None:
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def _as_date(raw: Any) -> date | None:
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    if isinstance(raw, str) and len(raw) >= 10:
        try:
            return date.fromisoformat(raw[:10])
        except ValueError:
            return None
    return None


def _ticker_base(identifier: str) -> str:
    """"ULVR.L" -> "ULVR". The exchange suffix never appears in a headline."""
    return (identifier or "").strip().upper().split(".")[0]


#: "eBay (NASDAQ: EBAY)" carries an exchange tag, not a mention of the index.
#: A reader watching NASDAQ was being shown every story with a ticker tag in
#: its headline. Stripping the "EXCHANGE:" prefix leaves the ticker itself
#: matchable and takes the exchange name out of the haystack.
_EXCHANGE_TAG = re.compile(
    r"\b(?:NYSE|NASDAQ|NYSEARCA|AMEX|OTC|LSE|TSX|ASX)\s*:\s*", re.IGNORECASE
)


def _story_haystack(story: dict) -> str:
    companies = story.get("companies")
    if isinstance(companies, str):
        joined = companies
    elif isinstance(companies, (list, tuple)):
        joined = " ".join(str(c) for c in companies)
    else:
        joined = ""
    raw = " ".join(
        str(part)
        for part in (story.get("title"), story.get("primary_company"), joined)
        if part
    )
    return _EXCHANGE_TAG.sub("", raw)


def story_matches_watch(story: dict, watch: dict) -> bool:
    """Does this story touch this watchlist row?

    Two independent signals, either sufficient:
      ticker  a whole-word, case-SENSITIVE match. Headlines write tickers in
              caps, and case sensitivity is what stops "IT" or "ON" matching
              every other sentence. Short tickers are excluded outright.
      name    a case-insensitive substring of the title, primary_company or
              companies list. Only for names long enough to be distinctive.
    """
    haystack = _story_haystack(story)
    if not haystack:
        return False

    ticker = _ticker_base(str(watch.get("identifier") or ""))
    if len(ticker) >= MIN_TICKER_LEN and re.search(
        rf"\b{re.escape(ticker)}\b", haystack
    ):
        return True

    name = str(watch.get("display_name") or "").strip()
    if len(name) >= MIN_NAME_LEN and name.upper() != ticker:
        return name.lower() in haystack.lower()
    return False


def _claim_line(claim: dict, outcome: dict | None, *, today: date) -> PersonalClaim:
    text = str(claim.get("user_claim") or "").strip()
    symbol = (claim.get("target_symbol") or "").strip() or None

    if outcome:
        move = outcome.get("actual_pct_change")
        try:
            pct = f"{float(move) * 100.0:+.2f}%" if move is not None else None
        except (TypeError, ValueError):
            pct = None
        detail = f"Moved {pct}." if pct else "Graded against the close."
        return PersonalClaim(
            claim=text,
            symbol=symbol,
            verdict=verdict_word(outcome.get("verdict")),
            detail=detail,
        )

    end = _as_date(claim.get("resolution_window_end"))
    if end is None:
        detail = "Window not set."
    elif end <= today:
        detail = "Resolves today."
    else:
        days = (end - today).days
        detail = f"Resolves in {days} day{'s' if days != 1 else ''}."
    return PersonalClaim(claim=text, symbol=symbol, verdict=None, detail=detail)


def personal_block(
    user_id: str,
    ctx: PersonalContext,
    *,
    now: datetime,
) -> PersonalBlock | None:
    """One recipient's slice, or None when there is nothing to show.

    Pure. Takes no client and performs no IO, which is what makes "no per-user
    model call" a property of the type signature rather than a promise.
    """
    today = now.astimezone(timezone.utc).date()

    cutoff = _as_datetime(ctx.last_send_by_user.get(user_id))
    if cutoff is None:
        cutoff = now - timedelta(hours=FIRST_SEND_LOOKBACK_HOURS)

    resolved: list[PersonalClaim] = []
    upcoming: list[PersonalClaim] = []
    for claim in ctx.claims_by_user.get(user_id, []):
        outcome = ctx.outcomes_by_claim.get(str(claim.get("id")))
        if outcome:
            graded = _as_datetime(outcome.get("graded_at"))
            if graded is not None and graded >= cutoff:
                resolved.append(_claim_line(claim, outcome, today=today))
            continue
        end = _as_date(claim.get("resolution_window_end"))
        if end is not None and today <= end <= today + timedelta(days=UPCOMING_DAYS):
            upcoming.append(_claim_line(claim, None, today=today))

    stories: list[tuple[str, str]] = []
    seen_titles: set[str] = set()
    for watch in ctx.watchlist_by_user.get(user_id, []):
        label = _ticker_base(str(watch.get("identifier") or "")) or str(
            watch.get("display_name") or ""
        )
        for story in ctx.story_rows:
            title = str(story.get("title") or "").strip()
            if not title or title in seen_titles:
                continue
            if story_matches_watch(story, watch):
                stories.append((label, title))
                seen_titles.add(title)
        if len(stories) >= MAX_PER_LIST:
            break

    block = PersonalBlock(
        resolved=resolved[:MAX_PER_LIST],
        upcoming=upcoming[:MAX_PER_LIST],
        watchlist_stories=stories[:MAX_PER_LIST],
    )
    # Omitted, never rendered empty. A blank section reads as a broken email.
    return None if block.is_empty() else block


def bucket_by(rows: list[dict], key: str) -> dict[str, list[dict]]:
    """Group shared rows once so the per-user pass is a dict lookup."""
    out: dict[str, list[dict]] = {}
    for row in rows or []:
        value = str(row.get(key) or "")
        if value:
            out.setdefault(value, []).append(row)
    return out
