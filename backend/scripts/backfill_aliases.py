"""
W2-A one-time alias backfill.
See docs/w2-a-entity-resolution-design.md sections 3 and 5 for context.

Diagnosis (2026-05-03):
  register_entity in backend/entity_resolver.py used the silent SELECT-by-
  name fallback for every pre-existing companies row, so only 20 of 2,902
  companies have an alias row. This script writes the missing 1:1 aliases.

For each companies row that does not yet have an alias pointing at it,
insert:
  surface_form  = companies.name              (raw, never normalized for storage)
  lookup_key    = normalize_lookup_key(name)  (same function the resolver uses)
  canonical_id  = companies.id
  mention_count = companies.mention_count
  last_seen_at  = companies.last_updated

The aliases table (verified live 2026-05-03) has these 7 columns:
  id, surface_form, lookup_key, canonical_id, mention_count, created_at,
  last_seen_at
The orchestrator's prompt mentioned an action_taken column; that column
does NOT exist on aliases (it would belong on resolution_log if anywhere).
We omit it from the payload. id, created_at have defaults so we omit them
too.

Constraints on aliases (verified live):
  PRIMARY KEY (id)
  FOREIGN KEY (canonical_id) REFERENCES companies(id) ON DELETE CASCADE
  UNIQUE (lookup_key, canonical_id)  [name: aliases_lookup_canonical_unique]

Idempotency note:
  We use .upsert(..., on_conflict='lookup_key,canonical_id',
  ignore_duplicates=True). The conflict target matches the composite
  UNIQUE constraint above so re-runs are no-ops. We also pre-load the set
  of canonical_ids that already have at least one alias and skip them in
  Python to avoid sending pointless writes. supabase-py 2.28.3 supports
  ignore_duplicates on upsert (verified before writing this script).

Usage:
  cd /Users/noahhanning/breakingalpha
  set -a && source .env.local && source backend/.env && set +a
  .venv/bin/python -m backend.scripts.backfill_aliases --dry-run
  .venv/bin/python -m backend.scripts.backfill_aliases   # live

ASCII only. No em-dashes.
"""
from __future__ import annotations

import argparse
import os
import sys
from typing import Optional

# Dual-path import to mirror entity_resolver.py: cron runs with
# cwd=backend/; tests/dev run with cwd=repo-root.
try:
    from normalize import normalize_lookup_key  # cron context: cwd=backend/
except ImportError:
    from backend.normalize import normalize_lookup_key  # repo-root context


def _load_env() -> None:
    """
    Load env from .env.local at repo root (where SUPABASE_SERVICE_ROLE_KEY
    lives) and backend/.env (where SUPABASE_URL lives). Falls back to the
    process environment if python-dotenv is not installed.
    """
    try:
        from dotenv import load_dotenv  # type: ignore
    except ImportError:
        return
    # Walk up from this file: backend/scripts/ -> backend/ -> repo root.
    here = os.path.dirname(os.path.abspath(__file__))
    backend_dir = os.path.dirname(here)
    repo_root = os.path.dirname(backend_dir)
    # Load repo-root .env.local first (service role key lives here).
    root_env = os.path.join(repo_root, ".env.local")
    if os.path.isfile(root_env):
        load_dotenv(root_env, override=False)
    # Then backend/.env (SUPABASE_URL etc).
    backend_env = os.path.join(backend_dir, ".env")
    if os.path.isfile(backend_env):
        load_dotenv(backend_env, override=False)


def _get_supabase_client():
    """
    Build a supabase-py client using SERVICE ROLE auth so the backfill
    bypasses RLS. Anon key would silently no-op writes through the API.
    """
    from supabase import create_client  # imported here to keep import cost off --help

    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url:
        print("ERROR: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is not set.", file=sys.stderr)
        sys.exit(1)
    if not key:
        print("ERROR: SUPABASE_SERVICE_ROLE_KEY is not set. Backfill needs RLS bypass.", file=sys.stderr)
        sys.exit(1)
    return create_client(url, key)


def _load_existing_alias_canonicals(supabase) -> set:
    """
    Return the set of canonical_ids that already have at least one alias
    row. Used to skip already-aliased companies without one round-trip per
    row. We page in chunks because PostgREST default ranges cap at 1000
    rows and we want a complete picture even if the table grows.
    """
    seen: set = set()
    page_size = 1000
    offset = 0
    while True:
        resp = (
            supabase.table("aliases")
            .select("canonical_id")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = resp.data or []
        for r in rows:
            cid = r.get("canonical_id")
            if cid is not None:
                seen.add(cid)
        if len(rows) < page_size:
            break
        offset += page_size
    return seen


def _iter_companies(supabase, batch_size: int):
    """
    Yield companies rows in batches ordered by id. Stops when a batch
    returns fewer rows than batch_size.

    We page by offset because the resolver is not running concurrently
    with this backfill (one-time job) so missing-row drift is not a
    concern.
    """
    offset = 0
    while True:
        resp = (
            supabase.table("companies")
            .select("id, name, mention_count, last_updated")
            .order("id")
            .range(offset, offset + batch_size - 1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return
        for r in rows:
            yield r
        if len(rows) < batch_size:
            return
        offset += batch_size


def _build_payload(company: dict) -> Optional[dict]:
    """
    Build the alias insert payload for one companies row, or return None
    if the row is unusable (missing name or id). last_seen_at falls back
    to created_at-equivalent via the column default if last_updated is
    null on the source row.
    """
    cid = company.get("id")
    name = company.get("name")
    if not cid or not name:
        return None
    payload = {
        "surface_form": name,
        "lookup_key": normalize_lookup_key(name),
        "canonical_id": cid,
        "mention_count": company.get("mention_count") or 0,
    }
    last_updated = company.get("last_updated")
    if last_updated:
        payload["last_seen_at"] = last_updated
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(
        description="One-time backfill: create a 1:1 alias row per existing companies row."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be inserted; do not write.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=100,
        help="Companies rows fetched per page (default: 100).",
    )
    args = parser.parse_args()

    _load_env()
    supabase = _get_supabase_client()

    print(
        "backfill_aliases: starting (mode={}, batch_size={})".format(
            "DRY-RUN" if args.dry_run else "LIVE", args.batch_size
        )
    )

    already_aliased = _load_existing_alias_canonicals(supabase)
    print(
        "backfill_aliases: pre-existing aliases cover {} canonical_id(s); will skip those".format(
            len(already_aliased)
        )
    )

    inserted = 0
    skipped = 0
    errored = 0
    total = 0
    sample_logged = 0
    SAMPLE_TARGET = 5

    for company in _iter_companies(supabase, args.batch_size):
        total += 1
        cid = company.get("id")

        if cid in already_aliased:
            skipped += 1
            if total % 100 == 0:
                print(
                    "backfill_aliases: progress total={} inserted={} skipped={} errored={}".format(
                        total, inserted, skipped, errored
                    )
                )
            continue

        payload = _build_payload(company)
        if payload is None:
            errored += 1
            print(
                "backfill_aliases: ERROR unusable companies row id={} name={!r}".format(
                    cid, company.get("name")
                ),
                file=sys.stderr,
            )
            continue

        if args.dry_run:
            if sample_logged < SAMPLE_TARGET:
                sample_logged += 1
                print(
                    "backfill_aliases: SAMPLE {}: lookup_key={!r} surface_form={!r} canonical_id={} mention_count={} last_seen_at={}".format(
                        sample_logged,
                        payload["lookup_key"],
                        payload["surface_form"],
                        payload["canonical_id"],
                        payload["mention_count"],
                        payload.get("last_seen_at", "<default-now()>"),
                    )
                )
            inserted += 1
        else:
            try:
                supabase.table("aliases").upsert(
                    payload,
                    on_conflict="lookup_key,canonical_id",
                    ignore_duplicates=True,
                ).execute()
                inserted += 1
            except Exception as ex:  # noqa: BLE001
                errored += 1
                print(
                    "backfill_aliases: ERROR inserting alias for canonical_id={} name={!r}: {}".format(
                        cid, company.get("name"), ex
                    ),
                    file=sys.stderr,
                )

        if total % 100 == 0:
            print(
                "backfill_aliases: progress total={} inserted={} skipped={} errored={}".format(
                    total, inserted, skipped, errored
                )
            )

    print(
        "inserted={} skipped={} errored={} total={}".format(
            inserted, skipped, errored, total
        )
    )

    return 0 if errored == 0 else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("backfill_aliases: interrupted", file=sys.stderr)
        sys.exit(130)
    except Exception as ex:  # noqa: BLE001
        print("backfill_aliases: FATAL: {}".format(ex), file=sys.stderr)
        sys.exit(1)
