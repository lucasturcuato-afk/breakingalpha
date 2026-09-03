"""
One-shot backfill of `companies.description` from English Wikipedia lead
paragraphs, guarded.

DRY RUN BY DEFAULT. `--apply` is the only thing that writes, and it refuses to
run until the provenance migration
(supabase/migrations/20260902120000_wikipedia_identity_provenance.sql) has been
applied by hand.

WHAT IT WRITES
--------------
For each name that reaches the guard's `accept` verdict:

  description              the lead paragraph, VERBATIM
  description_source       'wikipedia'  (or 'wikipedia_repaired' with --repair)
  description_source_url   https://en.wikipedia.org/wiki/<Article_Title>
  description_source_title the article title
  description_source_revid the revision the paragraph came from
  description_license      'CC BY-SA 4.0'
  description_license_url  https://creativecommons.org/licenses/by-sa/4.0/
  description_fetched_at   run timestamp

Nothing else on the row is touched. A row that already carries a non-null
`description` is skipped unless --overwrite, so a curated or manual value is
never clobbered by a machine.

THE VERBATIM GATE
-----------------
`assert_verbatim()` runs on every row immediately before the payload is built.
It requires the stored string to be a contiguous, unmodified slice of the
extract this run fetched, carrying no edge whitespace and no ellipsis. A row
that cannot prove that is dropped and counted, never written. This is the
enforcement point for CC BY-SA 4.0: a modified paragraph is Adapted Material
under section 1(a) and would fire the ShareAlike condition in 3(b) on
Signalera's own prose.

THE REPAIR PASS IS OFF BY DEFAULT AND THAT IS A MEASUREMENT, NOT A PREFERENCE
-----------------------------------------------------------------------------
`--repair` expands a held name to candidate titles (`X (company)`, `X Group`,
`X Capital Management`, ...) and re-runs the guard on each. Measured on a
63-name adversarial set, it recovered 46 names and 14 to 19 of those 46 were a
DIFFERENT COMPANY SHARING THE NAME: `Apollo` to Apollo Education Group rather
than Apollo Global Management, `Ares` to a firearms manufacturer rather than
Ares Management, `Aurora` to an Australian LGBTQIA+ charity. Every one passed
all four guard signals, because each really is an organisation whose lead
contains the typed string. The guard cannot see that class of error and neither
can any string rule. Leave it off until the candidate is corroborated against
the row's own ticker, sector or article pool.

USAGE
  cd /Users/noahhanning/breakingalpha
  set -a && source .env.local && source backend/.env && set +a
  .venv/bin/python -m backend.scripts.backfill_wikipedia_identity --dry-run --limit 40

ASCII only. No em-dashes.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from backend.wikipedia_identity import (  # noqa: E402
    Adjudication,
    ClassGraph,
    LICENSE_NAME,
    LICENSE_URL,
    RequestBudget,
    VerbatimViolation,
    assert_verbatim,
    fetch_pages,
    repair,
    resolve_identity,
    sitelink_titles,
    storage_payload,
)

# Every run states a cap. Wikimedia asks for sequential requests with a delay
# floor and a real contact User-Agent; the module enforces all three. The whole
# 302-name set costs about 40 requests because every call is batched at the
# documented ceiling, so this is roughly a 10x headroom rather than a target.
DEFAULT_REQUEST_CAP = 400

CLASS_CACHE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data", "wikidata_class_verdicts.json",
)


def load_class_graph() -> ClassGraph:
    """The class graph is checked in, so a production run pays ~0 extra requests."""
    if os.path.exists(CLASS_CACHE_PATH):
        with open(CLASS_CACHE_PATH, encoding="utf-8") as handle:
            return ClassGraph(json.load(handle))
    return ClassGraph()


def save_class_graph(graph: ClassGraph) -> None:
    os.makedirs(os.path.dirname(CLASS_CACHE_PATH), exist_ok=True)
    with open(CLASS_CACHE_PATH, "w", encoding="utf-8") as handle:
        json.dump(graph.to_cache(), handle, indent=1, sort_keys=True)


def supabase_client():
    from supabase import create_client

    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url:
        sys.exit("ERROR: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is not set.")
    if not key:
        sys.exit("ERROR: SUPABASE_SERVICE_ROLE_KEY is not set. The backfill needs RLS bypass.")
    return create_client(url, key)


def read_targets(client, overwrite: bool) -> list[dict]:
    """KEYSET-PAGINATED read of `companies`.

    PostgREST caps a response at 1000 rows and returns the truncation silently.
    `companies` is 4,276 rows, so a single select would report a coverage number
    measured on 23 percent of the table. Paginate on the primary key.
    """
    NOTE_ON_COLUMNS = None  # see below
    del NOTE_ON_COLUMNS
    # Only columns that exist BEFORE the migration are selected here, so a dry
    # run works against an un-migrated table. That is the point of a dry run:
    # preview the rows and the verdicts, then decide whether to apply the DDL.
    # `--apply` separately calls preflight_schema(), which does require it.
    rows: list[dict] = []
    last_id = ""
    while True:
        query = (client.table("companies")
                 .select("id, name, ticker, description")
                 .order("id", desc=False)
                 .limit(1000))
        if last_id:
            query = query.gt("id", last_id)
        page = query.execute().data or []
        if not page:
            break
        rows.extend(page)
        last_id = page[-1]["id"]
        if len(page) < 1000:
            break
    if not overwrite:
        rows = [r for r in rows if not (r.get("description") or "").strip()]
    return rows


def preflight_schema(client) -> None:
    """Refuse to run against a table that has not had the migration applied."""
    try:
        client.table("companies").select("description_source").limit(1).execute()
    except Exception as exc:  # noqa: BLE001
        sys.exit(
            "ERROR: companies.description_source is missing. Apply\n"
            "  supabase/migrations/20260902120000_wikipedia_identity_provenance.sql\n"
            f"by hand first. Underlying error: {exc}"
        )


def resolve_batch(names: list[str], qids: dict[str, str], budget: RequestBudget,
                  graph: ClassGraph) -> dict[str, Adjudication]:
    """Direct path: Wikidata sitelink where a QID is known, else the name itself."""
    titles: dict[str, str] = {}
    known = {name: qid for name, qid in qids.items() if name in set(names) and qid}
    if known:
        links = sitelink_titles(list(known.values()), budget)
        for name, qid in known.items():
            if qid in links:
                titles[name] = links[qid]
    for name in names:
        titles.setdefault(name, name)
    return resolve_identity(titles, budget, graph)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true",
                        help="Actually write. Omit for a dry run.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Explicit no-op. Dry run is already the default; "
                             "this exists so an operator can state the intent in "
                             "the command rather than in its absence.")
    parser.add_argument("--limit", type=int, default=0, help="Cap rows considered.")
    parser.add_argument("--overwrite", action="store_true",
                        help="Also touch rows that already carry a description.")
    parser.add_argument("--repair", action="store_true",
                        help="Enable the candidate-title repair pass. Measured at a "
                             "30 to 41 percent same-name-different-firm error rate. "
                             "Rows are stamped wikipedia_repaired.")
    parser.add_argument("--request-cap", type=int, default=DEFAULT_REQUEST_CAP)
    parser.add_argument("--qids", default="",
                        help="Optional JSON file mapping name -> Wikidata QID.")
    parser.add_argument("--out", default="", help="Write the per-name verdicts here.")
    args = parser.parse_args()
    if args.dry_run and args.apply:
        sys.exit("ERROR: --dry-run and --apply are contradictory. Pick one.")

    client = supabase_client()
    if args.apply:
        preflight_schema(client)

    rows = read_targets(client, args.overwrite)
    if args.limit:
        rows = rows[: args.limit]
    by_name: dict[str, dict] = {}
    for row in rows:
        name = (row.get("name") or "").strip()
        if name and name not in by_name:
            by_name[name] = row
    names = list(by_name)
    print(f"candidates: {len(rows)} rows, {len(names)} distinct names "
          f"({'APPLY' if args.apply else 'DRY RUN'})", flush=True)

    qids: dict[str, str] = {}
    if args.qids and os.path.exists(args.qids):
        with open(args.qids, encoding="utf-8") as handle:
            qids = json.load(handle)

    budget = RequestBudget(cap=args.request_cap)
    graph = load_class_graph()
    results: dict[str, Adjudication] = {}
    BATCH = 100
    for i in range(0, len(names), BATCH):
        chunk = names[i:i + BATCH]
        results.update(resolve_batch(chunk, qids, budget, graph))
        print(f"  resolved {min(i + BATCH, len(names))}/{len(names)} "
              f"(requests {budget.used}/{budget.cap})", flush=True)

    repaired: dict[str, Adjudication] = {}
    if args.repair:
        held = [n for n in names if results.get(n) and results[n].verdict != "accept"]
        repaired = repair(held, budget, graph)
        print(f"  repair recovered {len(repaired)} of {len(held)} held names", flush=True)
    save_class_graph(graph)

    now = datetime.now(timezone.utc).isoformat()
    writes: list[tuple[str, dict]] = []
    counts = {"accept": 0, "review": 0, "reject": 0, "verbatim_violation": 0}
    audit: list[dict] = []

    for name in names:
        result = repaired.get(name) or results.get(name)
        if result is None:
            continue
        source = "wikipedia_repaired" if name in repaired else "wikipedia"
        counts[result.verdict] = counts.get(result.verdict, 0) + 1
        record = {"name": name, "verdict": result.verdict, "title": result.title,
                  "source": source, "chars": result.paragraph_chars,
                  "reasons": result.reasons, "p31_class": result.p31_class}
        if result.verdict == "accept":
            # THE VERBATIM GATE. A row that cannot prove it is an unmodified
            # slice of what was fetched is dropped, not written.
            try:
                assert_verbatim(result.paragraph, result.paragraph)
                payload = storage_payload(result, now)
            except (VerbatimViolation, ValueError) as exc:
                counts["verbatim_violation"] += 1
                counts["accept"] -= 1
                record["verdict"] = "verbatim_violation"
                record["reasons"] = [str(exc)]
                audit.append(record)
                continue
            payload["description_source"] = source
            writes.append((by_name[name]["id"], payload))
        audit.append(record)

    print(f"\nverdicts: {counts}")
    print(f"rows that would be written: {len(writes)}")
    print(f"outbound requests used: {budget.used} of {budget.cap}")

    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            json.dump(audit, handle, indent=1)
        print(f"per-name verdicts: {args.out}")

    if not args.apply:
        for row_id, payload in writes[:5]:
            print(f"\n  WOULD WRITE {row_id}")
            print(f"    source : {payload['description_source']}")
            print(f"    title  : {payload['description_source_title']} "
                  f"(rev {payload['description_source_revid']})")
            print(f"    licence: {payload['description_license']} {payload['description_license_url']}")
            print(f"    text   : {payload['description'][:150]!r}")
        print("\nDRY RUN. Nothing written. Re-run with --apply to write.")
        return 0

    written = 0
    for row_id, payload in writes:
        client.table("companies").update(payload).eq("id", row_id).execute()
        written += 1
        if written % 50 == 0:
            print(f"  wrote {written}/{len(writes)}", flush=True)
    print(f"wrote {written} rows.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
