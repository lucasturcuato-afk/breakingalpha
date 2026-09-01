"""The entity-resolution READ LADDER, shared by the write path and the fold.

WHY THIS MODULE EXISTS
----------------------
Two functions in this repository answer "what company does this string name",
and until now they answered it very differently.

`ingest._resolve_primary_to_canonical` had SIX surfaces: exact companies.name,
case-insensitive name, aliases.lookup_key, companies.ticker, a
suffix-normalized key, and a leading-token fold. It is SELECT-only and cannot
mint.

`entity_resolver.resolve_entity` had ONE: aliases.lookup_key exact equality.
On a miss it went straight to `_try_insert_canonical` and CREATED A COMPANY.

That asymmetry is the whole defect. Measured against prod on 2026-08-31 over
300 names drawn from `wikidata_entity_cache`, 281 of 300 (93.7%) missed the
single alias surface and would have minted, while the six-surface resolver
placed a large share of them on rows that already existed. The result is
visible in the table: 828 normalized-key buckets hold more than one companies
row, covering 2,239 of 5,610 rows (39.9%), and 11,884 mentions sit stranded on
ticker-less duplicates that a real company already has an anchor row for.

So the ladder lives in ONE place and both callers use it. The index-only
surfaces (3-6) are `company_match.resolve_against_index`, which the two offline
tools also call. This module adds the two LIVE surfaces and the snapshot
loader, because the pipeline callers need a company minted earlier in the SAME
run to be visible, and a point-in-time snapshot cannot show them that.

WHAT IT DOES NOT DO
-------------------
It never merges rows, never repoints an alias, and never deletes anything. It
decides which EXISTING row a name resolves to. Collapsing the duplicates
themselves is a migration a human applies.
"""
from typing import Optional

try:
    from normalize import normalize_lookup_key  # cron context: cwd=backend/
except ImportError:  # pragma: no cover - import-style shim, mirrors entity_resolver
    from backend.normalize import normalize_lookup_key

try:
    from company_match import (  # cron context: cwd=backend/
        company_key_tokens,
        index_tokens,
        normalize_company_key,
        resolve_against_index,
    )
except ImportError:  # pragma: no cover - import-style shim
    from backend.company_match import (
        company_key_tokens,
        index_tokens,
        normalize_company_key,
        resolve_against_index,
    )


#: PostgREST caps a response at 1000 rows.
_PAGE_SIZE = 1000

#: One-shot in-memory snapshot of the entity index. ~5.6k companies + ~6.2k
#: aliases, loaded once per process. None until first use; an empty snapshot
#: (load failed) is cached as such so we do not retry per name.
_SNAPSHOT: Optional[dict] = None


def _empty_snapshot() -> dict:
    return {
        "name_by_id": {},
        "row_by_id": {},
        "by_alias": {},
        "by_ticker": {},
        "by_norm": {},
        "by_name_tokens": {},
        "by_token_prefix": {},
    }


def select_all_rows(supabase, table: str, columns: str, page_size: int = _PAGE_SIZE) -> list:
    """Read every row of a SMALL table.

    .range() is LIMIT/OFFSET and therefore O(offset) per page, which is why the
    article-scale readers avoid it. That does not apply here: both callers are
    ~6k row reference tables, so this is a dozen pages, not 170.
    """
    out, page = [], 0
    while True:
        resp = (supabase.table(table).select(columns)
                .range(page * page_size, page * page_size + page_size - 1).execute())
        rows = resp.data or []
        out.extend(rows)
        if len(rows) < page_size:
            return out
        page += 1


def build_snapshot(supabase, verbose: bool = True) -> dict:
    """Build the read-only alias / ticker / normalized-name lookup tables.

    Loads every companies and aliases row once (~12k small rows) instead of
    issuing per-name queries, so the resolution surfaces cost one pair of reads
    per process rather than 4N round trips.

    Every map is key -> SET of canonical ids. The sets are the point: a key
    that reaches two different companies is ambiguous, and
    `company_match.elect_canonical_id` decides whether that bucket has a
    non-conflicting anchor to elect or has to be refused.

    `row_by_id` carries ticker, sec_cik and mention_count because the election
    rule needs them. That is the only column addition over the previous
    snapshot, which read "id, name, ticker".

    Fail-soft: on any error returns empty maps, which degrades resolution to
    exactly the pre-existing live-query behavior rather than breaking ingest.
    """
    snap = _empty_snapshot()
    try:
        companies = select_all_rows(supabase, "companies",
                                    "id, name, ticker, sec_cik, mention_count")
        for row in companies:
            cid, name = row.get("id"), (row.get("name") or "").strip()
            if not cid or not name:
                continue
            snap["name_by_id"][cid] = name
            snap["row_by_id"][cid] = {
                "name": name,
                "ticker": row.get("ticker"),
                "sec_cik": row.get("sec_cik"),
                "mention_count": row.get("mention_count"),
            }
            snap["by_norm"].setdefault(normalize_company_key(name), set()).add(cid)
            index_tokens(snap["by_name_tokens"], snap["by_token_prefix"],
                         company_key_tokens(name), cid, from_name=True)
            ticker = (row.get("ticker") or "").strip().upper()
            if ticker:
                snap["by_ticker"].setdefault(ticker, set()).add(cid)

        aliases = select_all_rows(supabase, "aliases", "lookup_key, canonical_id")
        for row in aliases:
            key, cid = (row.get("lookup_key") or "").strip(), row.get("canonical_id")
            # An alias pointing at a company row we do not have is unusable.
            if not key or cid not in snap["name_by_id"]:
                continue
            snap["by_alias"].setdefault(key, set()).add(cid)
            # Aliases widen the normalized surface too: "Sony Group" reaches
            # Sony through the alias even though no companies.name matches.
            snap["by_norm"].setdefault(normalize_company_key(key), set()).add(cid)
            index_tokens(snap["by_name_tokens"], snap["by_token_prefix"],
                         company_key_tokens(key), cid, from_name=False)

        if verbose:
            print(f"  entity-ladder: snapshot loaded "
                  f"({len(snap['name_by_id'])} companies, {len(snap['by_alias'])} alias keys, "
                  f"{len(snap['by_ticker'])} tickers, {len(snap['by_norm'])} normalized keys)")
    except Exception as ex:
        print(f"  entity-ladder: snapshot load failed, falling back to "
              f"name-only matching ({ex})")
        return _empty_snapshot()
    return snap


def snapshot(supabase) -> dict:
    """The process-wide snapshot, built on first use."""
    global _SNAPSHOT
    if _SNAPSHOT is None:
        _SNAPSHOT = build_snapshot(supabase)
    return _SNAPSHOT


def reset_snapshot() -> None:
    """Drop the cached snapshot. Called per run: it is a point-in-time copy, so
    a long-lived process must rebuild it or it resolves against a stale index."""
    global _SNAPSHOT
    _SNAPSHOT = None


def register_minted(canonical_id: str, name: str, lookup_key: str,
                    ticker: Optional[str] = None) -> None:
    """Make a company minted mid-run visible to the EXACT surfaces of the ladder.

    DELIBERATELY PARTIAL. Only `name_by_id`, `row_by_id`, `by_alias` and
    `by_ticker` are updated. `by_norm` and the two token maps are NOT.

    The reason is order-dependence. Adding a mint to `by_norm` can turn a
    bucket that had one member into a bucket with two, so a name that resolved
    uniquely earlier in the run resolves differently later, and the run's output
    then depends on article order. The exact surfaces cannot do that: the
    minted alias key is the key that just missed, so nothing that previously
    resolved can start resolving elsewhere.

    Registering into by_norm would collapse more within-run duplicates. It is a
    real option, and it is deliberately not taken here without a measurement.
    """
    if not canonical_id or not name:
        return
    snap = _SNAPSHOT
    if snap is None:
        return
    snap["name_by_id"][canonical_id] = name
    snap["row_by_id"][canonical_id] = {
        "name": name, "ticker": ticker, "sec_cik": None, "mention_count": 0,
    }
    if lookup_key:
        snap["by_alias"].setdefault(lookup_key, set()).add(canonical_id)
    t = (ticker or "").strip().upper()
    if t:
        snap["by_ticker"].setdefault(t, set()).add(canonical_id)


def resolve_to_canonical_id(name: str, supabase) -> Optional[str]:
    """The FULL ladder. Returns an existing canonical companies.id, or None.

    Surfaces, first hit wins:
      1. exact companies.name           LIVE query
      2. case-insensitive companies.name LIVE query
      3. aliases.lookup_key             snapshot
      4. companies.ticker               snapshot, guarded by looks_like_ticker
      5. suffix/punctuation-normalized  snapshot, ambiguity guard applies
      6. leading-token fold             snapshot, ambiguity guard applies

    1-2 are live rather than snapshot reads so a company minted earlier in THIS
    run is visible, which is how the pre-existing fold behaved. 3-6 are
    `company_match.resolve_against_index`, the single shared implementation.

    SELECT-only. Writes nothing, mints nothing. Fail-closed: any error resolves
    to None, which returns the caller to its previous behavior rather than
    handing back a guess.
    """
    if not name or not name.strip():
        return None
    try:
        r = supabase.table("companies").select("id").eq("name", name).limit(1).execute()
        if r.data:
            return r.data[0]["id"]
        r2 = supabase.table("companies").select("id").ilike("name", name).limit(1).execute()
        if r2.data:
            return r2.data[0]["id"]
        return resolve_against_index(snapshot(supabase), name)
    except Exception as ex:
        print(f"  entity-ladder: resolution error [{name!r}]: {ex}")
        return None


def resolve_to_canonical_name(name: str, supabase) -> Optional[str]:
    """`resolve_to_canonical_id` mapped back to the canonical companies.name.

    Returns the CANONICAL name, not the input. That is the point for the
    article-tagging fold: folding the raw string "ARM" into companies[] does
    nothing for a reader querying "Arm Holdings", and folding the wrong casing
    fails PostgREST `.contains`, which is case-sensitive.
    """
    cid = resolve_to_canonical_id(name, supabase)
    if not cid:
        return None
    snap = _SNAPSHOT
    if snap is not None and cid in snap["name_by_id"]:
        return snap["name_by_id"][cid]
    try:
        r = supabase.table("companies").select("name").eq("id", cid).limit(1).execute()
        return r.data[0]["name"] if r.data else None
    except Exception:
        return None


def lookup_key(name: str) -> str:
    """The v1 WRITE key. Re-exported so callers do not import two normalizers."""
    return normalize_lookup_key(name)
