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
import os
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

try:
    from finnhub_helper import search_finnhub_ticker  # cron context: cwd=backend/
except ImportError:
    from backend.finnhub_helper import search_finnhub_ticker  # test/dev context: cwd=repo-root

try:
    from supabase_client import execute_with_retry  # cron context: cwd=backend/
except ImportError:
    from backend.supabase_client import execute_with_retry  # test/dev context: cwd=repo-root

try:
    from edgar.name_agreement import names_agree  # cron context: cwd=backend/
except ImportError:
    from backend.edgar.name_agreement import names_agree  # test/dev context: cwd=repo-root

try:
    from company_conflict import (  # cron context: cwd=backend/
        is_unique_violation,
        resolve_conflicting_company,
    )
except ImportError:
    from backend.company_conflict import (  # test/dev context: cwd=repo-root
        is_unique_violation,
        resolve_conflicting_company,
    )


# Cap recursion in the rare hot-race case where two workers keep
# colliding. Three attempts is extremely conservative; in practice the
# second attempt always wins because the loser's INSERT already fixed
# the alias table.
_MAX_RACE_RETRIES = 3


def resolve_entity(
    surface_form: str,
    supabase,
    themes: Optional[list] = None,
    sentiment: Optional[str] = None,
    _attempt: int = 0,
) -> dict:
    """
    Resolve a raw entity surface form to a canonical companies.id WITHOUT
    incrementing mention_count. Returns {"canonical_id", "alias_id"}.

    mention_count is now decoupled from resolution: the ingest store path tallies
    every PERSISTED mention and applies the increments in bulk via
    increment_mention_counts(), so a name resolved once per run (memoized) still
    contributes its full per-mention total to companies.mention_count and
    aliases.mention_count. This keeps the Company Intel ranking and the V1
    hit-many tiebreaker correct while collapsing ~13k per-mention round-trips.

    Implements the three-branch resolver from
    docs/w2-a-entity-resolution-design.md section 5:
      - hit-one: touch last_seen/themes, return canonical + alias
      - hit-many: pick highest mention_count (tiebreaker unchanged), log, return
      - miss: insert canonical + alias (mention_count 0) + resolution_log

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
        {"canonical_id": <uuid str>, "alias_id": <uuid str or None>} for the
        resolved entity. alias_id is the specific alias row the resolution
        landed on (the chosen one on hit-many), so the caller can tally
        aliases.mention_count per-mention against the exact row the V1
        tiebreaker reads.
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
        _touch_existing(
            supabase=supabase,
            alias_id=row["id"],
            canonical_id=canonical_id,
            themes=themes,
            now_iso=now_iso,
        )
        return {"canonical_id": canonical_id, "alias_id": row["id"]}

    # Step 4: hit-many. V1 tiebreak = highest mention_count on aliases
    # (denormalized from companies per design doc section 3). Tiebreaker logic
    # is UNCHANGED -- it still reads aliases.mention_count from the SELECT above.
    if len(alias_rows) > 1:
        chosen = max(alias_rows, key=lambda r: (r.get("mention_count") or 0))
        chosen_canonical_id = chosen["canonical_id"]
        candidate_ids = [r["canonical_id"] for r in alias_rows]
        _touch_existing(
            supabase=supabase,
            alias_id=chosen["id"],
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
        return {"canonical_id": chosen_canonical_id, "alias_id": chosen["id"]}

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
    new_canonical_id, conflict_exc = _try_insert_canonical(
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
            # Past the retry cap, resolve the conflicting row through the
            # full probe ladder in company_conflict.
            #
            # This used to be `.eq("name", surface_form)`, which is correct for
            # exactly ONE of the three unique indexes on companies. A 23505 from
            # companies_name_norm_unique (UNIQUE lower(btrim(name)) WHERE
            # sec_cik IS NULL) names a row spelled differently in case or
            # surrounding whitespace, so the exact-name SELECT missed it and we
            # raised while the row was sitting there. See the module docstring
            # of company_conflict.py for the full index enumeration.
            #
            # Reaching here is NOT only a hot race. It is also the standing
            # outcome for an ORPHANED canonical: a companies row whose alias
            # INSERT failed (see this module's own header note). Step 2 is an
            # alias lookup, so it can never see such a row, and every call for
            # that name previously burned three INSERTs and then threw. It now
            # resolves.
            #
            # alias_id is None here: we resolved the canonical but not a
            # specific alias row, so this mention is not tallied against
            # aliases.mention_count this run. Deliberate, and the reason the
            # recovery is left out of the alias write path entirely: it performs
            # ZERO writes, so it cannot deepen an existing duplicate.
            row = resolve_conflicting_company(
                supabase=supabase,
                name=surface_form,
                exc=conflict_exc,
                select="id, name",
            )
            return {"canonical_id": row["id"], "alias_id": None}
        return resolve_entity(
            surface_form=surface_form,
            supabase=supabase,
            themes=themes,
            sentiment=sentiment,
            _attempt=_attempt + 1,
        )

    # Canonical row created (we won the race or there was no race).
    # Now insert the alias pointing to it. surface_form stored RAW;
    # lookup_key stored normalized. mention_count starts at 0 -- the bulk
    # increment_mention_counts() applies the full per-run tally uniformly to new
    # and existing rows, so a first-seen company mentioned N times lands at
    # exactly N (was: insert at 1, then N-1 per-mention bumps).
    alias_ins = supabase.table("aliases").insert(
        {
            "surface_form": surface_form,
            "lookup_key": lookup_key,
            "canonical_id": new_canonical_id,
            "mention_count": 0,
            "last_seen_at": now_iso,
        }
    ).execute()
    new_alias_id = (alias_ins.data or [{}])[0].get("id")

    _write_resolution_log(
        supabase=supabase,
        surface_form=surface_form,
        lookup_key=lookup_key,
        resolved_canonical_id=new_canonical_id,
        candidate_canonical_ids=[],
        was_ambiguous=False,
    )

    return {"canonical_id": new_canonical_id, "alias_id": new_alias_id}


def _touch_existing(
    *,
    supabase,
    alias_id: str,
    canonical_id: str,
    themes: list,
    now_iso: str,
) -> None:
    """
    Refresh last_seen_at / last_updated and union new themes for an existing
    canonical + alias. Does NOT touch mention_count -- per-mention counting is
    applied in bulk by increment_mention_counts() from the ingest store path, so
    a name resolved once per run (memoized) still tallies every persisted
    mention. sentiment_trend is intentionally NOT updated here (see resolve_entity
    docstring for the spec-vs-existing-behavior note).
    """
    company_rows = (
        execute_with_retry(
            lambda: supabase.table("companies")
            .select("id, key_themes")
            .eq("id", canonical_id)
            .execute(),
            what="companies touch select",
        ).data
        or []
    )
    if company_rows:
        existing_themes = company_rows[0].get("key_themes") or []
        merged_themes = list(set(existing_themes + (themes or [])))
        execute_with_retry(
            lambda: supabase.table("companies").update(
                {
                    "last_updated": now_iso,
                    "key_themes": merged_themes,
                }
            ).eq("id", canonical_id).execute(),
            what="companies touch update",
        )

    execute_with_retry(
        lambda: supabase.table("aliases").update(
            {"last_seen_at": now_iso}
        ).eq("id", alias_id).execute(),
        what="aliases touch update",
    )


def register_entity(
    surface_form: str,
    supabase,
    themes: Optional[list] = None,
    sentiment: Optional[str] = None,
    _attempt: int = 0,
) -> str:
    """Back-compat shim: resolve and return the canonical id only.

    mention_count is now decoupled (resolve_entity does not increment;
    increment_mention_counts applies the per-mention tally in bulk). Retained
    because callers/tests still import register_entity and expect a cid string.
    """
    return resolve_entity(
        surface_form, supabase, themes=themes, sentiment=sentiment, _attempt=_attempt
    )["canonical_id"]


def increment_mention_counts(supabase, table: str, id_to_delta: dict) -> None:
    """Apply mention_count += delta per id for `table` ("companies" or "aliases").

    Read-modify-write in bulk: one chunked SELECT of the current counts, then one
    UPDATE per id. PostgREST has no atomic `col = col + n`; a SQL RPC would
    collapse the writes to a single statement -- flagged as a follow-up. Rows
    inserted this run start at mention_count 0, so applying the full per-run
    tally lands new and existing rows uniformly at old_count + tally.

    NOTE: like the prior per-call read-modify-write in _bump_existing, this is
    not concurrency-safe across parallel writers; the ingest pipeline is the sole
    writer during a run, so within-run correctness holds.
    """
    ids = [i for i, d in id_to_delta.items() if i and d]
    if not ids:
        return
    current = {}
    for i in range(0, len(ids), 200):
        chunk = ids[i:i + 200]
        rows = (
            execute_with_retry(
                lambda: supabase.table(table)
                .select("id, mention_count")
                .in_("id", chunk)
                .execute(),
                what=f"{table} mention-count select",
            ).data
            or []
        )
        for r in rows:
            current[r["id"]] = r.get("mention_count") or 0
    for _id in ids:
        new_val = current.get(_id, 0) + id_to_delta[_id]
        execute_with_retry(
            lambda _id=_id, new_val=new_val: supabase.table(table)
            .update({"mention_count": new_val})
            .eq("id", _id)
            .execute(),
            what=f"{table} mention-count update",
        )


def _try_insert_canonical(
    *,
    supabase,
    name: str,
    themes: list,
    sentiment: Optional[str],
) -> tuple:
    """
    Attempt to INSERT a new canonical companies row.

    Returns (new_id, None) on success, or (None, exc) if the row already
    exists (race lost). supabase-py raises postgrest APIError with .code set
    to the SQLSTATE; the exception is handed back rather than swallowed so
    the caller's recovery can read WHICH unique index fired. companies has
    three of them and they need different probes, so "a duplicate happened"
    is not enough information to recover from. (None, None) is the
    empty-response-without-exception case.

    Raw SQL intent (single statement; not expressible in supabase-py):
        INSERT INTO companies (name, key_themes, sentiment_trend, mention_count)
        VALUES ($1, $2, $3, 0)
        ON CONFLICT (name) DO NOTHING RETURNING id
    """
    payload = {
        "name": name,
        "key_themes": themes or [],
        "sentiment_trend": sentiment,
        # Start at 0; increment_mention_counts() applies the full per-run tally
        # uniformly to new and existing rows (was 1 + per-mention bumps).
        "mention_count": 0,
    }
    try:
        resp = supabase.table("companies").insert(payload).execute()
        rows = resp.data or []
        if rows:
            new_id = rows[0]["id"]
            # W2-C: best-effort ticker population on canonical creation.
            # Silent + non-blocking: a Finnhub timeout, error, or no-match
            # leaves companies.ticker NULL and the lazy-lookup backstop
            # (Workstream C) handles it on first read. The
            # DISABLE_TICKER_POPULATION env var lets unit tests opt out
            # so they don't have to mock the new HTTP call or assert on
            # the extra companies.update.
            if not os.environ.get("DISABLE_TICKER_POPULATION"):
                try:
                    # mention_count=1 here because we just inserted a fresh
                    # canonical row. Per Amendment 3 of the rules-alignment
                    # sprint, the helper applies a >= 2 gate, so this call
                    # is effectively a no-op for new rows: 1-mention rows
                    # are usually Gemini extraction noise and should not be
                    # ticker-matched. Bulk backfill picks them up later if
                    # they recur and climb past the threshold.
                    ticker = search_finnhub_ticker(name, mention_count=1)
                    if ticker:
                        try:
                            supabase.table("companies").update(
                                {"ticker": ticker}
                            ).eq("id", new_id).execute()
                        except Exception:
                            pass  # don't block on ticker write failure
                        # Gate 2: CIK-at-mint. When a ticker resolves, look up
                        # its sec_cik from the LOCAL cik_tickers table (no SEC
                        # HTTP) so the freshly minted row is XBRL-eligible and
                        # converges with bulk-loaded rows on CIK identity.
                        try:
                            populate_sec_cik_for_mint(
                                supabase=supabase,
                                company_id=new_id,
                                ticker=ticker,
                                our_name=name,
                            )
                        except Exception:
                            pass  # don't block mint on cik population failure
                except Exception:
                    pass  # don't block on ticker lookup failure
            return new_id, None
        # Empty response without exception: treat as race-lost so the
        # caller re-enters step 2. No exception to hand back.
        return None, None
    except Exception as ex:
        # Unique violation: race lost, hand the exception back so the caller
        # can read the index name off it. Any other error we re-raise so it is
        # not silently swallowed (matches the convention in backend/ingest.py
        # where unexpected errors print and propagate via the outer try in
        # upsert_company).
        #
        # The test used to be a substring scan that included "conflict", which
        # is broad enough to reclassify unrelated failures as races and return
        # a benign None for them. is_unique_violation reads the SQLSTATE first
        # and only falls back to substrings for test doubles that raise a bare
        # Exception.
        if is_unique_violation(ex):
            return None, ex
        raise


def lookup_cik_for_ticker(supabase, ticker: str) -> Optional[int]:
    """
    Resolve a sec_cik from the LOCAL cik_tickers table by ticker. NO SEC
    HTTP call (cik_tickers is the bulk-loaded ticker->cik map maintained by
    backend/edgar/cik_mapping.sync_cik_tickers).

    Reuses the access pattern from edgar/submissions.get_watchlist_ciks:
        sb.table("cik_tickers").select("cik").eq("ticker", <UPPER>) ...

    Share-class multiplicity: one ticker maps to one CIK, but cik_tickers'
    PK is UNIQUE(cik, ticker) so a single ticker should yield exactly one
    cik. If a ticker somehow maps to MULTIPLE distinct ciks (data anomaly),
    pick the numerically smallest deterministically rather than guess.
    Returns None when the ticker is absent (foreign/private/junk ticker).
    """
    t = (ticker or "").upper().strip()
    if not t:
        return None
    rows = (
        supabase.table("cik_tickers")
        .select("cik, company_name")
        .eq("ticker", t)
        .execute()
        .data
        or []
    )
    ciks = sorted({r["cik"] for r in rows if r.get("cik") is not None})
    if not ciks:
        return None
    # Single cik is the normal case; collapse share-class rows. If more than
    # one distinct cik mapped to this ticker, pick the smallest (deterministic)
    # and note the anomaly so it surfaces in logs without blocking the mint.
    if len(ciks) > 1:
        print(
            f"[cik-at-mint] ticker {t!r} maps to multiple ciks {ciks}; "
            f"picking smallest {ciks[0]}"
        )
    return ciks[0]


def _registrant_name_for_cik(supabase, ticker: str, cik: int) -> Optional[str]:
    """The cik_tickers company_name for this (ticker, cik). None when absent,
    which the name gate treats as fail-open."""
    rows = (
        supabase.table("cik_tickers")
        .select("cik, company_name")
        .eq("ticker", (ticker or "").upper().strip())
        .execute()
        .data
        or []
    )
    for r in rows:
        if r.get("cik") == cik:
            return r.get("company_name")
    return None


def populate_sec_cik_for_mint(
    *, supabase, company_id: str, ticker: str, our_name: str = ""
) -> Optional[int]:
    """
    Set companies.sec_cik on a freshly minted row from the LOCAL cik_tickers
    map, with a NAME-AGREEMENT gate and an EXPLICIT dedup existence-check guard.

    NAME GATE: a ticker match is not identity. companies.ticker carries
    Finnhub-derived and extraction-noise values, so the bare join stamps
    'Ola' with Coca-Cola's CIK. backend.edgar.name_agreement is the single
    shared policy, used by this path and by
    edgar.cik_mapping._update_companies_sec_cik. It FAILS OPEN: no authority
    name, or a caller that passes no name, means no opinion and the write
    proceeds exactly as before.

    DEDUP HAZARD GUARD: before writing, SELECT for any company row that
    already holds this sec_cik. If one exists (and it is not this row), do
    NOT set sec_cik on the new row -- that would create a second CIK holder.
    Converge onto the existing holder by leaving the minted row's sec_cik
    NULL (the resolver/dedup layer reconciles the duplicate name separately;
    minting a second CIK holder is the failure mode we must avoid here).

    This check is correct BOTH before Gate 1's UNIQUE(sec_cik) index exists
    AND after it: it does not rely on ON CONFLICT (sec_cik), which cannot be
    expressed before the index is in place. See the MERGE ORDERING note in
    the PR: before the unique index lands, this explicit SELECT reduces but
    cannot fully eliminate the TOCTOU window between two concurrent mints;
    the DB constraint is the real backstop.

    Returns the cik written, or None if nothing was written.
    """
    cik = lookup_cik_for_ticker(supabase, ticker)
    if cik is None:
        return None

    if our_name:
        registrant = _registrant_name_for_cik(supabase, ticker, cik)
        agrees, reason = names_agree(our_name, registrant)
        if not agrees:
            print(
                f"[cik-at-mint] name gate blocked {company_id}: "
                f"{our_name!r} ({ticker}) vs cik {cik} {registrant!r}: {reason}"
            )
            return None

    existing = (
        supabase.table("companies")
        .select("id")
        .eq("sec_cik", cik)
        .execute()
        .data
        or []
    )
    holder_ids = [r["id"] for r in existing if r.get("id") != company_id]
    if holder_ids:
        # Another row already holds this CIK. Do not mint a second holder;
        # converge onto the existing one by leaving this row's sec_cik NULL.
        print(
            f"[cik-at-mint] cik {cik} already held by {holder_ids[0]}; "
            f"skipping sec_cik write on minted row {company_id}"
        )
        return None

    supabase.table("companies").update({"sec_cik": cik}).eq(
        "id", company_id
    ).execute()
    return cik


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
