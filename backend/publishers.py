"""
publishers.py - publisher identity for ingested articles.

WHY THIS EXISTS
---------------
`articles.source` does NOT name a publisher for the bulk of the corpus. The
Google News ingest path stores `f"Google News ({ticker})"` (ingest.py), which
names the SEARCH FEED an item arrived on, not who wrote it. Measured on a
6,000-article window: 88% of rows carry one of 819 distinct `Google News (*)`
feed names, and 996 of 1,000 sampled URLs are `news.google.com/rss/articles/...`
redirect blobs, so the URL cannot recover the publisher either.

The publisher IS available and free: Google News RSS puts it in the item's
`<source>` element (feedparser exposes `entry.source.title` and
`entry.source.href`). Nothing read it. `_clean_gnews_title` additionally strips
the " - Publisher" suffix off the title before storage, discarding the same
identity a second time.

This module is the single home for turning a feed entry into a publisher, and
for deciding whether that publisher is a syndicator rather than an originator.

Pure module: no IO, no env, no Supabase, no network. Importable from tests.

SCOPE NOTE. Nothing here backfills history. The suffix is already stripped from
stored rows and the RSS source element was never persisted, so articles ingested
before this ships stay publisher-less (NULL). That is honest and intended: a
guessed publisher is worse than a missing one.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

#: Value stored when we genuinely do not know who published an item. Callers
#: MUST treat NULL/None as "unknown", never as a publisher named "unknown".
UNKNOWN_PUBLISHER = None


#: Hosts that redistribute other outlets' reporting. Presence here does NOT mean
#: "low quality" and it is NOT an accuracy judgment -- it means an item from this
#: host is usually a copy of reporting that originated elsewhere, so counting it
#: as independent corroboration inflates breadth.
#:
#: Each entry is listed with why it qualifies. Keep this list short and
#: defensible; when in doubt leave a host OUT (a missed syndicator understates
#: breadth, a wrong one silently demotes a real outlet).
SYNDICATOR_DOMAINS: dict[str, str] = {
    "news.google.com": "Google News aggregator redirect",
    "finance.yahoo.com": "Yahoo Finance, predominantly syndicated wire copy",
    "yahoo.com": "Yahoo, predominantly syndicated wire copy",
    "finnhub.io": "Finnhub news API relay, not a publisher",
    "msn.com": "MSN, licensed republication",
    "news.yahoo.com": "Yahoo News, licensed republication",
    "stocktwits.com": "Stocktwits, user/feed aggregation",
    "investing.com": "Investing.com, heavy wire syndication",
}

#: `source` values (the feed name, not the publisher) that are aggregator
#: wrappers by construction. Matched by prefix so all 819 `Google News (TICKER)`
#: feeds are covered without enumerating them.
SYNDICATOR_SOURCE_PREFIXES: tuple[str, ...] = ("Google News (",)

#: `source` values that are aggregator relays exactly.
SYNDICATOR_SOURCE_EXACT: frozenset[str] = frozenset({"Yahoo", "Finnhub"})


def normalize_domain(href: Any) -> str | None:
    """Reduce a URL or bare host to a lowercase host with any leading `www.`
    removed. Returns None for anything unparseable or empty.

    Accepts a bare host ("benzinga.com") as well as a full URL, because the RSS
    source element carries a full href but callers may hold either.
    """
    if not href or not isinstance(href, str):
        return None
    raw = href.strip()
    if not raw:
        return None
    if "//" not in raw:
        # Bare host: urlparse would put it in `path`, not `netloc`.
        raw = "//" + raw
    try:
        host = (urlparse(raw).netloc or "").lower()
    except Exception:
        return None
    if not host:
        return None
    host = host.split("@")[-1].split(":")[0]  # strip credentials and port
    if host.startswith("www."):
        host = host[4:]
    return host or None


def _entry_source(entry: Any) -> Any:
    """Read the RSS `<source>` element off a feedparser entry.

    feedparser exposes it as a dict-like with `title` and `href`. Both a plain
    dict and a FeedParserDict satisfy the `.get` path; a bare string is handled
    by the caller.
    """
    if entry is None:
        return None
    try:
        if hasattr(entry, "get"):
            return entry.get("source")
    except Exception:
        return None
    return None


def extract_publisher(entry: Any) -> tuple[str | None, str | None]:
    """Return `(publisher, publisher_domain)` for one feed entry.

    Reads the RSS `<source>` element. Returns `(None, None)` when the feed does
    not carry one -- most non-Google feeds do not, and a missing publisher stays
    missing rather than being inferred from the feed name.
    """
    src = _entry_source(entry)
    if src is None:
        return (UNKNOWN_PUBLISHER, None)

    title = None
    href = None
    if isinstance(src, str):
        title = src
    else:
        try:
            title = src.get("title")
            href = src.get("href")
        except Exception:
            return (UNKNOWN_PUBLISHER, None)

    if isinstance(title, str):
        title = title.strip() or None
    else:
        title = None

    domain = normalize_domain(href)
    if title is None and domain is None:
        return (UNKNOWN_PUBLISHER, None)
    return (title, domain)


def publisher_from_title_suffix(raw_title: Any) -> str | None:
    """Recover the publisher from a Google News title's " - Publisher" suffix.

    Fallback for entries with no `<source>` element. Mirrors the suffix shape
    that `ingest._clean_gnews_title` strips: a spaced dash or pipe followed by a
    short (<=40 char) final segment containing no further separator. Returns
    None when the title has no such suffix, so a hyphenated headline
    ("Cash-and-Stock Deal") never yields a fake publisher.
    """
    if not raw_title or not isinstance(raw_title, str):
        return None
    text = raw_title.strip()
    for sep in (" - ", " | "):
        idx = text.rfind(sep)
        if idx == -1:
            continue
        tail = text[idx + len(sep):].strip()
        if not tail or len(tail) > 40:
            continue
        if " - " in tail or " | " in tail:
            continue
        return tail
    return None


def is_syndicator(
    publisher: str | None = None,
    publisher_domain: str | None = None,
    source: str | None = None,
) -> bool:
    """True when this item is a redistribution rather than original reporting.

    Checks the publisher domain first (the reliable signal once publisher
    capture is live), then falls back to the feed `source` name so rows
    ingested before publisher capture are still classified correctly.

    This is a breadth-counting aid, NOT a quality or accuracy judgment.
    """
    domain = normalize_domain(publisher_domain)
    if domain and domain in SYNDICATOR_DOMAINS:
        return True

    if source and isinstance(source, str):
        s = source.strip()
        if s in SYNDICATOR_SOURCE_EXACT:
            return True
        if any(s.startswith(p) for p in SYNDICATOR_SOURCE_PREFIXES):
            return True

    return False


def syndicator_reason(publisher_domain: str | None) -> str | None:
    """Human-readable reason a domain is on the syndicator list, or None."""
    domain = normalize_domain(publisher_domain)
    if not domain:
        return None
    return SYNDICATOR_DOMAINS.get(domain)


def attribution_identity(
    publisher: str | None,
    publisher_domain: str | None,
    source: str | None,
) -> str | None:
    """The name a cross-source or credibility computation should group on.

    Prefers the real publisher, then its domain, and only falls back to the feed
    `source` when neither exists. Returns None when the fallback would be a
    Google News feed name, because grouping on `Google News (AMD)` produces the
    exact false-breadth artifact this module exists to remove: a cluster of ten
    ticker feeds reads as ten independent outlets.
    """
    if publisher and publisher.strip():
        return publisher.strip()
    domain = normalize_domain(publisher_domain)
    if domain:
        return domain
    if source and isinstance(source, str):
        s = source.strip()
        if s and not any(s.startswith(p) for p in SYNDICATOR_SOURCE_PREFIXES):
            return s
    return None
