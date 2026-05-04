"""
W2-A entity resolution write-path.
See docs/w2-a-entity-resolution-design.md section 5 for spec.

This module is NOT yet wired into backend/ingest.py. Chunk 3b (the
integration) is a separate PR Noah does at the keyboard tomorrow.
The function exists so chunk 3a can be reviewed and tested against the
live aliases / resolution_log tables before the ingest pipeline starts
using it.

Implementation note on transactions: supabase-py does not cleanly expose
BEGIN/COMMIT semantics. The multi-statement steps below are ordered for
failure tolerance: the row everything else FKs to (companies) is written
first; if a later step fails, the orphan is harmless and recoverable on
the next call to register_entity. Specifically:

  - Step 5 ordering is companies-INSERT, then alias-INSERT, then
    resolution_log-INSERT. If alias-INSERT fails, the companies row is
    orphaned but harmless (next call recovers via re-entry at step 2).
    If resolution_log-INSERT fails, the canonical and alias rows are
    correct; only the audit trail is incomplete.

  - The race-recovery path on companies-INSERT relies on the existing
    UNIQUE(name) constraint as the synchronization primitive (per design
    doc section 5: "No advisory locks; the unique constraint is the
    synchronization primitive."). Pattern intent in raw SQL is:
        INSERT INTO companies (name) VALUES ($1)
        ON CONFLICT (name) DO NOTHING RETURNING id
    supabase-py's PostgREST layer cannot express ON CONFLICT DO NOTHING
    RETURNING id as a single statement, so we implement it as: try
    .insert(); if the response is empty (race) OR the call raises a
    unique-violation, SELECT the existing canonical_id by name and
    re-enter at step 2.
"""
from datetime import datetime, timezone
from typing import Optional

# Dual-path import. Cron runs with cwd=backend/ (per
# .github/workflows/schedule.yml working-directory). Tests and dev run
# with cwd=repo-root. Try the cron path first so production wins on the
# off chance both resolve.
try:
    from normalize import normalize_lookup_key  # cron context: cwd=backend/
except ImportError:
    from backend.normalize import normalize_lookup_key  # test/dev context: cwd=repo-root


# Cap recursion in the rare hot-race case where two workers keep
# colliding. Three attempts is extremely conservative; in practice the
# second attempt always wins because the loser's INSERT already fixed
# the alias table.
_MAX_RACE_RETRIES = 3


def register_entity(
    surface_form: str,
    supabase,
    themes: Optional[list] = None,
    sentiment: Optional[str] = None,
    _attempt: int = 0,
) -> str:
    """
    Resolve a raw entity surface form to a canonical companies.id.

    Implements the three-branch resolver from
    docs/w2-a-entity-resolution-design.md section 5:
      - hit-one: increment counts, update last_seen_at, return canonical
      - hit-many: pick highest mention_count, log ambiguity, return chosen
      - miss: insert canonical + alias + resolution_log, return new id

    Args:
        surface_form: Raw entity name as it appeared in the source. Stored
            verbatim in aliases.surface_form; never normalized for storage.
        supabase: A supabase-py client. Passed in (rather than imported as
            a module global) so tests can mock it; matches the pattern in
            backend/ingest.py where `supabase = create_client(...)` is
            module-level and all functions reference that singleton.
        themes: Optional list of theme strings to union into
            companies.key_themes. Mirrors upsert_company in ingest.py.
        sentiment: Optional sentiment string (e.g. "bullish"/"bearish"/
            "neutral"). NOTE: matches the upsert_company convention in
            ingest.py, which writes sentiment_trend only on INSERT, not
            on UPDATE. Spec ambiguity flagged: the design doc says
            "update sentiment_trend if provided" on the hit-one path,
            but the existing function this is replacing only sets
            sentiment on insert. We preserve the existing behavior to
            avoid behavior drift on the chunk 3b cutover; if Noah wants
            sentiment-on-update he can flip a single boolean below.
        _attempt: Internal recursion counter for race recovery; do not
            pass from callers.

    Returns:
        canonical_id (uuid as str) for the resolved entity.
    """
    themes = themes or []
    lookup_key = normalize_lookup_key(surface_form)
    now_iso = datetime.now(timezone.utc).isoformat()

    # Step 2: alias lookup.
    alias_resp = (
        supabase.table("aliases")
        .select("id, canonical_id, mention_count")
        .eq("lookup_key", lookup_key)
        .execute()
    )
    alias_rows = alias_resp.data or []

    # Step 3: hit-one.
    if len(alias_rows) == 1:
        row = alias_rows[0]
        canonical_id = row["canonical_id"]
        return _bump_existing(
            supabase=supabase,
            alias_id=row["id"],
            alias_mention_count=row.get("mention_count") or 0,
            canonical_id=canonical_id,
            themes=themes,
            now_iso=now_iso,
        )

    # Step 4: hit-many. V1 tiebreak = highest mention_count on aliases
    # (denormalized from companies per design doc section 3).
    if len(alias_rows) > 1:
        chosen = max(alias_rows, key=lambda r: (r.get("mention_count") or 0))
        chosen_canonical_id = chosen["canonical_id"]
        candidate_ids = [r["canonical_id"] for r in alias_rows]
        _bump_existing(
            supabase=supabase,
            alias_id=chosen["id"],
            alias_mention_count=chosen.get("mention_count") or 0,
            canonical_id=chosen_canonical_id,
            themes=themes,
            now_iso=now_iso,
        )
        _write_resolution_log(
            supabase=supabase,
            surface_form=surface_form,
            lookup_key=lookup_key,
            resolved_canonical_id=chosen_canonical_id,
            candidate_canonical_ids=candidate_ids,
            was_ambiguous=True,
        )
        return chosen_canonical_id

    # Step 5: miss. Try to INSERT a new canonical companies row, then the
    # alias row, then the resolution_log row.
    #
    # Raw SQL intent:
    #   INSERT INTO companies (name) VALUES ($1)
    #   ON CONFLICT (name) DO NOTHING RETURNING id
    #
    # supabase-py / PostgREST cannot express that as a single statement.
    # We implement the equivalent as: .insert() and on either an empty
    # response or a unique-violation exception, fall back to SELECT-by-
    # name. If the SELECT finds a row (race winner), we recurse to
    # re-enter at step 2 so the new alias / resolution_log writes happen
    # against the winning canonical. _MAX_RACE_RETRIES caps the loop.
    new_canonical_id = _try_insert_canonical(
        supabase=supabase,
        name=surface_form,
        themes=themes,
        sentiment=sentiment,
    )

    if new_canonical_id is None:
        # Race lost: another worker created the canonical between our
        # alias-lookup and our INSERT. Re-enter at step 2 against the
        # winning row.
        if _attempt + 1 >= _MAX_RACE_RETRIES:
            # If we keep racing past the retry cap, fall back to a
            # straight SELECT by name and return whatever's there
            # without further alias/log writes. This is defensive and
            # extremely unlikely; documented for completeness.
            existing = (
                supabase.table("companies")
                .select("id")
                .eq("name", surface_form)
                .execute()
                .data
                or []
            )
            if existing:
                return existing[0]["id"]
            # If even the SELECT misses, raise so the caller sees it
            # rather than silently returning None.
            raise RuntimeError(
                f"register_entity: could not resolve or insert {surface_form!r} "
                f"after {_MAX_RACE_RETRIES} race retries"
            )
        return register_entity(
            surface_form=surface_form,
            supabase=supabase,
            themes=themes,
            sentiment=sentiment,
            _attempt=_attempt + 1,
        )

    # Canonical row created (we won the race or there was no race).
    # Now insert the alias pointing to it. surface_form stored RAW;
    # lookup_key stored normalized.
    supabase.table("aliases").insert(
        {
            "surface_form": surface_form,
            "lookup_key": lookup_key,
            "canonical_id": new_canonical_id,
            "mention_count": 1,
            "last_seen_at": now_iso,
        }
    ).execute()

    _write_resolution_log(
        supabase=supabase,
        surface_form=surface_form,
        lookup_key=lookup_key,
        resolved_canonical_id=new_canonical_id,
        candidate_canonical_ids=[],
        was_ambiguous=False,
    )

    return new_canonical_id


def _bump_existing(
    *,
    supabase,
    alias_id: str,
    alias_mention_count: int,
    canonical_id: str,
    themes: list,
    now_iso: str,
) -> str:
    """
    Increment alias and companies mention_counts for an existing canonical,
    bump aliases.last_seen_at, and union new themes into companies.key_themes.

    Mirrors the UPDATE branch of upsert_company in backend/ingest.py: we
    read existing key_themes, union with the new themes, write back.
    sentiment_trend is intentionally NOT updated here (see register_entity
    docstring for the spec-vs-existing-behavior note).
    """
    # Read current canonical row so we can union themes and increment
    # mention_count atomically-ish (single UPDATE).
    company_rows = (
        supabase.table("companies")
        .select("id, mention_count, key_themes")
        .eq("id", canonical_id)
        .execute()
        .data
        or []
    )
    if company_rows:
        company = company_rows[0]
        existing_themes = company.get("key_themes") or []
        merged_themes = list(set(existing_themes + (themes or [])))
        supabase.table("companies").update(
            {
                "mention_count": (company.get("mention_count") or 0) + 1,
                "last_updated": now_iso,
                "key_themes": merged_themes,
            }
        ).eq("id", canonical_id).execute()

    supabase.table("aliases").update(
        {
            "mention_count": (alias_mention_count or 0) + 1,
            "last_seen_at": now_iso,
        }
    ).eq("id", alias_id).execute()

    return canonical_id


def _try_insert_canonical(
    *,
    supabase,
    name: str,
    themes: list,
    sentiment: Optional[str],
) -> Optional[str]:
    """
    Attempt to INSERT a new canonical companies row.

    Returns the new id on success, or None if the row already exists
    (race lost). The companies table has UNIQUE(name); supabase-py
    surfaces that as an exception we catch here.

    Raw SQL intent (single statement; not expressible in supabase-py):
        INSERT INTO companies (name, key_themes, sentiment_trend, mention_count)
        VALUES ($1, $2, $3, 1)
        ON CONFLICT (name) DO NOTHING RETURNING id
    """
    payload = {
        "name": name,
        "key_themes": themes or [],
        "sentiment_trend": sentiment,
        "mention_count": 1,
    }
    try:
        resp = supabase.table("companies").insert(payload).execute()
        rows = resp.data or []
        if rows:
            return rows[0]["id"]
        # Empty response without exception: treat as race-lost so the
        # caller falls back to SELECT-by-name and re-enters step 2.
        return None
    except Exception as ex:
        # Unique-violation on companies.name: race lost. Any other error
        # we re-raise so it is not silently swallowed (matches the
        # convention in backend/ingest.py where unexpected errors print
        # and propagate via the outer try in upsert_company).
        msg = str(ex).lower()
        if "duplicate" in msg or "unique" in msg or "conflict" in msg or "23505" in msg:
            return None
        raise


def _write_resolution_log(
    *,
    supabase,
    surface_form: str,
    lookup_key: str,
    resolved_canonical_id: Optional[str],
    candidate_canonical_ids: list,
    was_ambiguous: bool,
) -> None:
    """
    Append a row to resolution_log. Used for V2 trigger analysis (design
    doc section 10: ambiguity rate). Failures here are non-fatal to the
    caller (audit-only); we still propagate exceptions so the caller can
    decide whether to swallow or log them.
    """
    supabase.table("resolution_log").insert(
        {
            "surface_form": surface_form,
            "lookup_key": lookup_key,
            "resolved_canonical_id": resolved_canonical_id,
            "candidate_canonical_ids": candidate_canonical_ids,
            "was_ambiguous": was_ambiguous,
        }
    ).execute()
