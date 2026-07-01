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

import os
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

_ARTICLE_FIELDS = "id, relevance_score, published_at"


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


def select_rail_ids(client, prior_ids):
    """Pick the ordered rail: relevance_score desc, then published_at desc as the
    deterministic tiebreak, from articles published within the recency guard,
    hard-excluding prior_ids. Returns up to RAIL_SIZE article id strings in
    render order. Fetches RAIL_SIZE + len(prior_ids) candidates so removing the
    overlap still leaves a full rail."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=RECENCY_DAYS)).isoformat()
    limit = RAIL_SIZE + len(prior_ids)
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
    ordered = []
    for row in resp.data or []:
        aid = str(row.get("id"))
        if aid and aid not in exclude:
            ordered.append(aid)
        if len(ordered) >= RAIL_SIZE:
            break
    return ordered


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
