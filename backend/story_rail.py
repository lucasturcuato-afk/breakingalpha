"""Today's Stories rail selection (Option B: reproducible, identity-deduped snapshot).

Runs from run.py AFTER ingest and synthesis (NOT inside synthesize.py, which a
parallel sprint owns). Picks the ordered set of articles for this brief's
Today's Stories rail and persists their IDs on the briefing row, so:

  - the rail is reproducible (the same brief always shows the same stories), and
  - it is deduped by IDENTITY against the prior brief, not by an ingest-time
    clock window. Selection excludes the exact article IDs the prior brief
    already showed. This is deliberate: a story ingested AFTER the morning
    generation can still surface in the evening wrap, because dedup is by ID,
    not by when it was ingested.

Root cause this closes (defect #1, cross-brief duplication): the two rails used
to run an identical live now()-relative query, so consecutive briefs re-showed
the same top stories. Hard-excluding the prior brief's IDs makes consecutive
rails share zero articles.

Storage: briefings.story_rail_ids (jsonb array of article id strings, in render
order). Additive, nullable column (see the migration). Legacy/unpersisted rows
stay NULL and the frontend falls back to the live window query.
"""

import json
import os
import re
from datetime import datetime, timedelta, timezone

from supabase_client import get_service_client, execute_with_retry

# Rail size and candidate recency. RECENCY_DAYS matches the frontend's existing
# published_at floor so the candidate pool is the same shape as before.
RAIL_SIZE = 8
RECENCY_DAYS = 7

# How many immediately-prior briefs to hard-exclude by article ID. One = only
# the single most-recent prior brief (the previous session, any type). This is a
# named policy knob: raise it to exclude more history, or later add a
# re-surfacing rule for updated stories. Deferred knob, not built now.
EXCLUDE_PRIOR_BRIEF_COUNT = 1

# Extra candidates fetched beyond RAIL_SIZE + prior-brief exclusions, so that
# collapsing a within-brief semantic-duplicate pair (FIX 1) can refill the rail
# from the next candidate instead of shrinking it. Duplicate pairs are rare, so
# a small headroom is plenty.
COLLAPSE_HEADROOM = 8

_ARTICLE_FIELDS = "id, relevance_score, published_at, title, companies"


def _prior_rail_ids(client, before_iso):
    """Article IDs shown by the EXCLUDE_PRIOR_BRIEF_COUNT briefs immediately
    before `before_iso`. Reads the stored story_rail_ids off those rows. Legacy
    rows with a NULL list contribute nothing. Read-only, soft-fails to []."""
    try:
        resp = (
            client.table("briefings")
            .select("story_rail_ids, created_at")
            .lt("created_at", before_iso)
            .order("created_at", desc=True)
            .limit(EXCLUDE_PRIOR_BRIEF_COUNT)
            .execute()
        )
    except Exception as e:
        print(f"  ⚠ story_rail: prior-brief ID lookup failed (no exclusion): {e}")
        return []
    seen = []
    for row in resp.data or []:
        ids = row.get("story_rail_ids")
        if isinstance(ids, list):
            seen.extend(str(x) for x in ids if x)
    return seen


# --- Within-brief semantic-duplicate collapse (FIX 1) ----------------------
# HARD-SIGNAL HEURISTIC, not embeddings. Two articles collapse to one ONLY when
# they share the SAME company AND a matching normalized money amount. Both
# signals are required: ticker/company alone would eat two genuinely distinct
# stories about one company, and a shared amount alone would merge unrelated
# deals that happen to be the same size. This is a deliberate stopgap for the
# deferred embedding-based clustering; it catches the same-ticker-plus-same-
# amount pair class (e.g. the two "Ecolab ... $4.75B CoolIT" wire stories) and
# explicitly does NOT catch same-event pairs with no shared amount or with only
# different framing.

_MONEY_RE = re.compile(
    r"\$\s?([0-9]+(?:\.[0-9]+)?)\s*(trillion|billion|bn|million|mm|thousand|[kmbt])\b",
    re.IGNORECASE,
)
_MONEY_MULT = {
    "trillion": 1e12, "t": 1e12,
    "billion": 1e9, "bn": 1e9, "b": 1e9,
    "million": 1e6, "mm": 1e6, "m": 1e6,
    "thousand": 1e3, "k": 1e3,
}


def _money_amounts(text):
    """Set of normalized dollar figures in `text` so $4.75B == $4.75 billion."""
    out = set()
    for num, unit in _MONEY_RE.findall(text or ""):
        out.add(round(float(num) * _MONEY_MULT.get(unit.lower(), 1.0)))
    return out


def _company_set(row):
    """Lowercased company names on the article row. companies is a jsonb array;
    tolerate a stringified array from older rows."""
    comps = row.get("companies") or []
    if isinstance(comps, str):
        try:
            comps = json.loads(comps)
        except (ValueError, TypeError):
            comps = []
    return {str(c).strip().lower() for c in comps if c}


def _row_signals(row):
    return (_company_set(row), _money_amounts(row.get("title") or ""))


def _is_semantic_dup(a_sig, b_sig):
    """True when the pair shares a company AND a money amount. BOTH required."""
    return bool(a_sig[0] & b_sig[0]) and bool(a_sig[1] & b_sig[1])


def _stronger(a_row, b_row):
    """The row to KEEP from a duplicate pair: higher relevance_score; on a tie,
    the earlier published_at (ISO strings compare correctly for this)."""
    ra, rb = a_row.get("relevance_score") or 0, b_row.get("relevance_score") or 0
    if ra != rb:
        return a_row if ra > rb else b_row
    pa = a_row.get("published_at") or ""
    pb = b_row.get("published_at") or ""
    return a_row if pa <= pb else b_row


def select_rail_ids(client, prior_ids):
    """Pick the ordered rail: relevance_score desc, then published_at desc as the
    deterministic tiebreak, from articles published within the recency guard,
    hard-excluding prior_ids, then collapsing within-brief semantic-duplicate
    pairs (FIX 1). Returns up to RAIL_SIZE article id strings in render order.
    Fetches RAIL_SIZE + prior + COLLAPSE_HEADROOM candidates so both the prior
    exclusion and any collapse can refill the rail."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=RECENCY_DAYS)).isoformat()
    limit = RAIL_SIZE + len(prior_ids) + COLLAPSE_HEADROOM
    resp = (
        client.table("articles")
        .select(_ARTICLE_FIELDS)
        .gte("published_at", cutoff)
        .order("relevance_score", desc=True)
        .order("published_at", desc=True)
        .limit(limit)
        .execute()
    )
    exclude = set(prior_ids)
    kept = []        # rows in render order, one representative per dup group
    kept_sigs = []   # parallel (company_set, amount_set) for each kept row
    for row in resp.data or []:
        aid = str(row.get("id"))
        if not aid or aid in exclude:
            continue
        sig = _row_signals(row)
        dup_idx = None
        # Only dedup rows that carry BOTH signals; otherwise never collapse.
        if sig[0] and sig[1]:
            for i, ksig in enumerate(kept_sigs):
                if _is_semantic_dup(sig, ksig):
                    dup_idx = i
                    break
        if dup_idx is not None:
            # Collapse: keep the stronger of the pair at the existing slot, and
            # let a later candidate refill the freed slot toward RAIL_SIZE.
            winner = _stronger(kept[dup_idx], row)
            kept[dup_idx] = winner
            kept_sigs[dup_idx] = _row_signals(winner)
            continue
        kept.append(row)
        kept_sigs.append(sig)
        if len(kept) >= RAIL_SIZE:
            break
    return [str(r["id"]) for r in kept[:RAIL_SIZE]]


def persist_story_rail(brief_type="morning"):
    """Build and persist this brief's Today's Stories rail. Attaches the ordered
    article IDs to the most-recent briefing row of `brief_type` (the row
    synthesize just inserted). Returns the count written. Raises on hard failure
    so run.py can mark the step degraded; the site is unaffected because the
    frontend falls back to the live window query when the column is absent."""
    if not os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY required to persist the story rail")
    client = get_service_client()

    cur = (
        client.table("briefings")
        .select("id, created_at")
        .eq("briefing_type", brief_type)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not cur.data:
        print(f"  ⚠ story_rail: no {brief_type} briefing row to attach to; skipping")
        return 0
    brief_id = cur.data[0]["id"]
    created_at = cur.data[0]["created_at"]

    prior_ids = _prior_rail_ids(client, created_at)
    rail_ids = select_rail_ids(client, prior_ids)
    if not rail_ids:
        print("  ⚠ story_rail: candidate pool empty; leaving story_rail_ids NULL (frontend falls back)")
        return 0

    execute_with_retry(
        lambda: client.table("briefings")
        .update({"story_rail_ids": rail_ids})
        .eq("id", brief_id)
        .execute(),
        what="story_rail update",
    )
    print(
        f"  📌 story_rail: wrote {len(rail_ids)} IDs to {brief_type} brief {brief_id} "
        f"(excluded {len(prior_ids)} from prior brief)"
    )
    return len(rail_ids)


if __name__ == "__main__":
    import sys

    persist_story_rail(sys.argv[1] if len(sys.argv) > 1 else "morning")
