"""
watchlist.py
CRUD operations for the watchlist table in Supabase.
Called from frontend API routes for the Watchlist feature.
"""

import os
import re
from datetime import datetime, timezone
from supabase import create_client

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])

# Chunk size for the boost .in_("id", ...) read. Matches the 200-id chunk that
# #301's chunked .in_ read uses in entity_resolver.increment_mention_counts:
# 200 UUIDs keep the GET querystring well under the proxy URL limit. The
# unbatched query overflowed at 1,156 ids (~52 KB URL -> raw 400 'Bad Request')
# in pipeline run #141. Env-overridable, like #301's STORE_CHUNK_SIZE.
WATCHLIST_BOOST_CHUNK = int(os.getenv("WATCHLIST_BOOST_CHUNK", "200"))


def list_watchlist():
    """Return all watchlist entries ordered by created_at descending."""
    resp = supabase.table("watchlist") \
        .select("*") \
        .order("created_at", desc=True) \
        .execute()
    return resp.data or []


def add_to_watchlist(data: dict):
    """
    Insert a new watchlist entry. Required keys: identifier, type.
    type must be 'ticker' or 'company'.
    Returns the inserted row.
    """
    row = {
        "identifier": data["identifier"],
        "type":       data["type"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    resp = supabase.table("watchlist").insert(row).execute()
    return resp.data[0] if resp.data else None


def remove_from_watchlist(entry_id: str):
    """
    Delete a watchlist entry by id.
    Returns the deleted row.
    """
    resp = supabase.table("watchlist") \
        .delete() \
        .eq("id", entry_id) \
        .execute()
    return resp.data[0] if resp.data else None


def clear_watchlist():
    """
    Delete all watchlist entries.
    Returns the list of deleted rows.
    """
    resp = supabase.table("watchlist") \
        .delete() \
        .neq("id", "00000000-0000-0000-0000-000000000000") \
        .execute()
    return resp.data or []


def _fetch_boost_candidates(article_ids):
    """Fetch the candidate article rows for boosting.

    When article_ids is provided, the .in_("id", ...) filter is split into
    batches of WATCHLIST_BOOST_CHUNK so the GET querystring never overflows the
    proxy URL limit (the unbatched query 400'd at 1,156 ids in run #141); the
    batch results are concatenated in input-batch order. When article_ids is
    empty/None the behaviour is unchanged: a single unfiltered query over all
    articles (preserved deliberately -- the caller always passes the stored ids).
    """
    cols = "id, title, summary, companies, relevance_score"
    if not article_ids:
        return supabase.table("articles").select(cols).execute().data or []

    rows = []
    for i in range(0, len(article_ids), WATCHLIST_BOOST_CHUNK):
        chunk = article_ids[i:i + WATCHLIST_BOOST_CHUNK]
        rows.extend(
            supabase.table("articles").select(cols).in_("id", chunk).execute().data or []
        )
    return rows


# ---------------------------------------------------------------------------
# Watchlist matching (token-anchored) + match recording
# ---------------------------------------------------------------------------
# What was wrong: the match test was `ident in title` -- a bare Python substring
# test on lowercased text. Watchlist identifiers include two-letter tickers
# (v, de, ba, bx, cf, gd, ge, gs, mu, on, pl), so `de` matched "demand" and
# "provide", `ba` matched "based", and `v` matched any title containing the
# letter v. Measured on a 9,600-row uuid-stratified sample of the live corpus,
# 96.5% of articles matched at least one identifier. See
# scratch/B-grader-6-7-band-avoidance.md.
#
# The second half of the defect: a match rewrote articles.relevance_score in
# place (+2, capped at 10). Because ~all rows matched, that applied a near
# constant +2 offset to the whole corpus, destroyed the grader's own scale
# (the rubric's 6-7 analyst-action band landed at 8-9), and was irreversible --
# nothing on the row recorded that a boost had been applied, so the grader's
# score could not be recovered.
#
# Both halves are fixed here:
#   1. identifiers now match only as whole tokens (see _IDENT_LEFT/_IDENT_RIGHT).
#   2. the match is RECORDED in articles.watchlist_match and relevance_score is
#      never written. The grader's score stays exactly as the grader set it.
#
# Ranking on watchlist membership is now a READ-side decision over
# watchlist_match. Nothing in this module lifts a score any more.

# Token boundaries. A plain \b is wrong here: identifiers carry embedded dots
# (BRK.B, QVC.VI, ULVR.L) where \b would fire mid-identifier. These lookarounds
# reject only an adjacent ALPHANUMERIC, so "de" does not match inside "demand"
# but does match "$DE", "(DE)", "DE," and a bare "DE". Case-insensitive.
_IDENT_LEFT = r"(?<![0-9A-Za-z])"
_IDENT_RIGHT = r"(?![0-9A-Za-z])"

# Tickers that are also ordinary English words. Token anchoring alone does not
# save these: "shares rose ON earnings" contains a standalone "on", and ON
# Semiconductor's ticker is ON. Measured on the 9,600-row sample, `on` alone
# accounted for 1,680 of 4,549 token matches (37%) -- almost all of them the
# preposition.
#
# The separator is CASE, not position. In the same sample the all-lowercase form
# is the English word essentially every time, and the company is capitalised:
#   on   1,963 all-lowercase vs   479 capitalised
#   de      63 all-lowercase vs    45 capitalised
#   net     40 all-lowercase vs    45 capitalised
#   meta     0 all-lowercase vs   268 capitalised
#   dell     0 all-lowercase vs   159 capitalised
# So for these identifiers ONLY, an all-lowercase occurrence is rejected and any
# capitalised form ("ON", "On", "$ON", "ON Semiconductor") is kept. Every other
# identifier stays fully case-insensitive.
#
# Derived by intersecting the live watchlist's <=4-character ticker identifiers
# with /usr/share/dict/words, then kept as an explicit constant rather than a
# runtime dictionary lookup. Same approach as COMMON_WORD_FIRST_TOKENS in
# src/lib/company-intel.ts. Extend when a new common-word ticker is watched.
# Cost of the rule on genuine mentions is negligible: it drops 3 lowercase "arm",
# 2 "grab", 3 "onto", 1 "spy" and 7 "v" occurrences in the sample.
_CAPITALISATION_REQUIRED = frozenset({
    "arm", "ba", "cop", "de", "dell", "fig", "ge", "grab", "hood", "lulu",
    "mara", "meta", "mu", "net", "on", "onto", "pep", "spy", "v",
})

# Exchange and venue tokens. These are never a company mention, so they are
# dropped before matching regardless of what the watchlist contains.
#
# NASDAQ is the one that actually hurt: it is a live ticker-type watchlist entry,
# and the token appears in 2,309 titles and 1,745 summaries of the 48,000-row
# sample, almost entirely as the exchange prefix in the "Company Inc
# (NASDAQ:ABCD)" pattern that wire and press-release feeds use. That is a
# listing venue, not a mention of the company. Capitalisation cannot separate
# these because the exchange prefix is itself uppercase.
#
# The siblings are included because they are the same defect waiting to happen
# and cost nothing today (none is currently watched). Counts are EXCH:TICKER
# prefix occurrences in the same sample: nyse 3,657, nasdaq 3,044, nasdaqgs 201,
# tsx 149, asx 79, lse 64, nysearca 58, otcmkts 48, nasdaqgm 34, xtra 30,
# nasdaqcm 29.
#
# NOTE: this makes "NASDAQ" unwatchable as an identifier. Nasdaq Inc. the
# operating company is still reachable by watching its real ticker, NDAQ, which
# does not collide with the exchange prefix.
_EXCHANGE_TOKENS = frozenset({
    "nasdaq", "nasdaqgs", "nasdaqgm", "nasdaqcm", "nyse", "nysearca",
    "nyseamerican", "amex", "otc", "otcmkts", "otcqb", "otcqx",
    "tsx", "tsxv", "asx", "lse", "xtra", "epa", "etr", "bme", "swx", "cboe",
})


def _build_identifier_matcher(identifiers):
    """Compile the watchlist identifiers into one token-anchored alternation.

    Returns a compiled regex, or None when there is nothing to match. Built once
    per boost pass rather than per article: the old code ran an O(articles x
    identifiers) Python loop, this is one scan per field.

    Alternatives are sorted longest-first so a longer identifier wins over a
    prefix of itself (regex alternation is first-match-wins at each position, so
    without this "ge" could shadow "ge group").

    Exchange/venue tokens (_EXCHANGE_TOKENS) are dropped here rather than
    filtered at match time: they can never be a mention, so they should not cost
    a regex alternative either.
    """
    cleaned = sorted(
        {
            i.strip() for i in identifiers
            if i and i.strip() and i.strip().lower() not in _EXCHANGE_TOKENS
        },
        key=lambda s: (-len(s), s.lower()),
    )
    if not cleaned:
        return None
    alternation = "|".join(re.escape(i) for i in cleaned)
    return re.compile(f"{_IDENT_LEFT}(?:{alternation}){_IDENT_RIGHT}", re.IGNORECASE)


def _matched_identifiers(matcher, article) -> list:
    """Return the sorted distinct watchlist identifiers this article matches.

    Scans title, summary and every companies[] element, the same three fields
    the substring version scanned. Matches are lowercased and de-duplicated so
    the stored value is a stable set regardless of how the surface form was
    capitalised in the source text.

    Identifiers in _CAPITALISATION_REQUIRED are rejected when the occurrence is
    all-lowercase, which is what separates ON Semiconductor from the preposition
    "on". Everything else stays case-insensitive.
    """
    if matcher is None:
        return []
    fields = [article.get("title") or "", article.get("summary") or ""]
    fields.extend(c for c in (article.get("companies") or []) if c)
    hits = set()
    for text in fields:
        for m in matcher.finditer(text):
            found = m.group(0)
            key = found.lower()
            if key in _CAPITALISATION_REQUIRED and found.islower():
                continue
            hits.add(key)
    return sorted(hits)


#: Cached probe for the sql/0029 watchlist_match column. Same hand-apply
#: contract as _publisher_columns_available in ingest.py: the migration is
#: applied by a human, so this module has to run correctly both before and
#: after it lands rather than failing every write with a 400.
_WATCHLIST_MATCH_COLUMN_AVAILABLE = None


def _watchlist_match_column_available():
    """True when articles.watchlist_match exists. Probes once per process."""
    global _WATCHLIST_MATCH_COLUMN_AVAILABLE
    if _WATCHLIST_MATCH_COLUMN_AVAILABLE is not None:
        return _WATCHLIST_MATCH_COLUMN_AVAILABLE
    try:
        supabase.table("articles").select("watchlist_match").limit(1).execute()
        _WATCHLIST_MATCH_COLUMN_AVAILABLE = True
    except Exception as ex:
        _WATCHLIST_MATCH_COLUMN_AVAILABLE = False
        print("  watchlist: articles.watchlist_match missing "
              f"(apply sql/0030_watchlist_match.sql) - not recording matches ({ex})")
    return _WATCHLIST_MATCH_COLUMN_AVAILABLE


def record_watchlist_matches(article_ids: list = None) -> int:
    """
    Record which watchlist identifiers each article matches, in
    articles.watchlist_match. Identifiers match as WHOLE TOKENS only.

    Does NOT modify relevance_score. The grader's score is left intact and
    watchlist membership becomes a read-side ranking input over the recorded
    match instead of an in-place rewrite of the score.

    If article_ids is provided, only those articles are considered.
    Returns the count of articles that matched at least one identifier.

    Storage semantics: only non-empty matches are written, so a NULL
    watchlist_match means "matched nothing, or the row predates this column".
    Rows are never cleared here -- this pass only ever adds a match to the
    freshly stored ids its caller hands it.
    """
    watchlist = list_watchlist()
    if not watchlist:
        return 0

    matcher = _build_identifier_matcher(
        [entry.get("identifier") or "" for entry in watchlist]
    )
    if matcher is None:
        return 0

    articles = _fetch_boost_candidates(article_ids)
    can_write = _watchlist_match_column_available()

    matched_count = 0
    for article in articles:
        hits = _matched_identifiers(matcher, article)
        if not hits:
            continue
        matched_count += 1
        if can_write:
            supabase.table("articles").update(
                {"watchlist_match": hits}
            ).eq("id", article["id"]).execute()

    return matched_count


# Backward-compatible alias. backend/ingest.py imports this name; keeping it
# avoids editing ingest.py, which is under concurrent development. The behaviour
# behind the name is now record-only -- nothing is boosted. Callers should move
# to record_watchlist_matches and stop describing the result as "boosted".
boost_watchlist_relevance = record_watchlist_matches
