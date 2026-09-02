#!/usr/bin/env python3
"""Repair articles.companies[] after the norm_v2 merge. Step 12.

WHY THIS EXISTS. The merge repoints dependents by company_id and DELETES the
loser companies rows. articles.companies[] stores NAMES, and nothing in 0020 or
0020b touches articles, so every merged-away name in that array now refers to a
company that does not exist. Those articles stop matching a companies[]-based
query. This is the other half of the merge, not cleanup.

WHY NOT THE TWO UPDATEs IN sql/0029 SECTION 4. That file says it outright: they
are the LOGIC, not the execution plan. articles is ~198k rows with a GIN index
on companies, and the 2026-08-17 backfill hit 57014 "canceling statement due to
statement timeout" on a single 500-row chunk even while batched, because the
cost of flushing the GIN pending list lands on whichever statement happens to
fill it. Two unbounded UPDATEs over the whole table invite the same failure with
no ledger to reverse from.

SHAPE. Same as tools/backfill_primary_fold.py, deliberately:
  - keyset scan on articles.id, never OFFSET
  - plan in memory, apply in batches through ONE set-based RPC
  - a ledger row per (article, loser name) written BEFORE the array changes
  - a drift guard: a row whose companies[] no longer equals the planned `before`
    is skipped, not overwritten
  - a failing chunk halves and retries down to single rows, so one slow batch
    degrades instead of killing the run

REUSES public.apply_companies_backfill(jsonb) rather than adding a second apply
path. That function is already generic: it sets companies = after where
companies = before, and it does not care whether the change is an append (the
backfill) or a name swap (this). It already carries the drift guard, the 180s
statement_timeout added after the live failure, and the right grants.

TWO CASES, both handled:
  swap    loser -> survivor, when the survivor is NOT already in the array
  remove  drop the loser, when the survivor IS already there (a swap would
          produce a duplicate element)

WHAT THIS DOES NOT FIX. Names in companies[] that are not in public.companies
AND are not merge losers: strings the extractor produced that never resolved to
a canonical row. Measured 2026-09-01: 1,445 distinct names across 25,554
articles. There is no survivor to point them at. See sql/0035 section 4b.

USAGE
    python tools/repair_articles_companies.py                  # dry run, default
    python tools/repair_articles_companies.py --cache scan.json
    python tools/repair_articles_companies.py --apply --batch 400
    python tools/repair_articles_companies.py --apply --resume  # skip done ids

Reads articles and companies. Writes articles.companies and the repair ledger,
and ONLY under --apply.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import uuid
from collections import Counter, defaultdict

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, os.path.join(_ROOT, "backend"))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(os.path.join(_ROOT, "backend", ".env"))
from supabase import create_client  # noqa: E402

LEDGER = "articles_companies_repair"
APPLY_RPC = "apply_companies_backfill"
MAP_RPC = "norm_v2_merge_map"
PROGRESS_RPC = "norm_v2_merge_progress"
PAGE = 1000

_url = os.environ.get("SUPABASE_URL")
_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not _url or not _key:
    sys.exit("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.")
sb = create_client(_url, _key)


# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------
def require_merge_drained() -> None:
    """Refuse to run while any approved cluster is still unmerged.

    Repairing early is worse than not repairing at all: the run reports success,
    and every cluster merged afterwards silently reintroduces stale names that
    nothing will look for again. The operator would have no signal that the
    repair is now incomplete.

    There is deliberately NO flag to override this. A partial repair is not a
    state anyone should be able to reach by passing an argument.
    """
    try:
        res = sb.rpc(PROGRESS_RPC, {}).execute()
    except Exception as ex:
        sys.exit(f"could not read {PROGRESS_RPC}(): {ex}\n"
                 "Apply sql/0035 section 2b first. Refusing to run without "
                 "confirming the merge is drained.")
    rows = res.data or []
    if not rows:
        sys.exit(f"{PROGRESS_RPC}() returned nothing. Refusing to run.")
    p = rows[0] if isinstance(rows, list) else rows
    merged = int(p.get("merged", 0))
    todo = int(p.get("still_to_merge", 0))
    blocked = int(p.get("blocked", 0))
    print(f"  merge state: {merged} merged, {todo} still to merge, {blocked} blocked")
    if todo:
        sys.exit(
            f"REFUSING TO RUN: {todo} approved cluster(s) have not merged yet.\n"
            "Repairing now would report success and then be silently invalidated "
            "by every\ncluster merged afterwards. Drain the merge first "
            "(runbook step 10), then re-run.\nThere is no flag to bypass this."
        )


# ---------------------------------------------------------------------------
# Paged reads.
#
# PostgREST caps EVERY response at db-max-rows (1000 here) and does NOT error
# when it truncates: a query that should return 1363 rows returns 1000 and looks
# like a complete answer. That silence has now produced three separate wrong
# results in this codebase, including in this very tool, where a truncated
# loser -> survivor map planned 10,566 articles instead of 13,972 and would have
# reported success while leaving ~3,400 unrepaired with no record.
#
# So every set-returning read goes through one of these two helpers, and both
# ASSERT the row count against a server-side count(*) taken in the same breath.
# A truncated read fails loudly instead of quietly doing less work.
# ---------------------------------------------------------------------------
def _fetch_all_rpc(fn: str, order_col: str, params: dict | None = None) -> list:
    """Every row a set-returning RPC produces, with a count assertion.

    `.rpc(...)` alone is capped. `.order().range()` paginates, and
    `count="exact"` returns the true total, so the two together are both a fix
    and a check.
    """
    params = params or {}
    try:
        head = sb.rpc(fn, params, count="exact").limit(1).execute()
    except Exception as ex:
        sys.exit(f"could not read {fn}(): {ex}")
    expected = head.count
    if expected is None:
        sys.exit(f"{fn}() returned no exact count; refusing to read it unverified.")

    rows, page = [], 0
    while len(rows) < expected:
        r = sb.rpc(fn, params).order(order_col).range(page * PAGE, page * PAGE + PAGE - 1).execute()
        if not r.data:
            break
        rows += r.data
        page += 1
    if len(rows) != expected:
        sys.exit(f"TRUNCATED READ: {fn}() reports {expected} rows, fetched {len(rows)}. "
                 "Refusing to continue on a partial result.")
    return rows


def _fetch_all_table(table: str, cols: str, order_col: str = "id") -> list:
    """Every row of a table, with the same count assertion."""
    try:
        head = sb.table(table).select(cols, count="exact").limit(1).execute()
    except Exception as ex:
        sys.exit(f"could not read {table}: {ex}")
    expected = head.count
    if expected is None:
        sys.exit(f"{table} returned no exact count; refusing to read it unverified.")

    rows, page = [], 0
    while len(rows) < expected:
        r = sb.table(table).select(cols).order(order_col).range(page * PAGE, page * PAGE + PAGE - 1).execute()
        if not r.data:
            break
        rows += r.data
        page += 1
    if len(rows) != expected:
        sys.exit(f"TRUNCATED READ: {table} reports {expected} rows, fetched {len(rows)}. "
                 "Refusing to continue on a partial result.")
    return rows


def load_map() -> dict:
    """loser name -> survivor name, for clusters that actually merged.

    Comes from the database, not from any local artifact: the plan can be
    rebuilt, and repairing against a stale map would point articles at the
    wrong survivor. Fails loudly on an empty map rather than repairing nothing
    and reporting success.
    """
    rows = _fetch_all_rpc(MAP_RPC, "loser_name")
    m = {r["loser_name"]: r["survivor_name"] for r in rows}
    if len(m) != len(rows):
        sys.exit(f"{MAP_RPC}() returned {len(rows)} rows but only {len(m)} distinct "
                 "loser names. A loser cannot map to two survivors; the plan is "
                 "inconsistent. Refusing to run.")
    if not m:
        sys.exit(f"{MAP_RPC}() returned no pairs. Either no cluster has merged, "
                 "or the plan was archived. Refusing to run: an empty map would "
                 "repair nothing and exit 0.")
    return m


def live_company_names() -> set:
    return {x["name"] for x in _fetch_all_table("companies", "name")}


def scan_articles(cache: str = "", limit: int = 0) -> list:
    """Keyset scan on id. NEVER OFFSET: articles is ~198k rows and count(*) on
    it already times out, so an OFFSET walk degrades quadratically.

    EXEMPT from the count assertion the other reads carry, and deliberately: the
    exact count that assertion needs is the very query that times out on this
    table. Keyset is safe without it for a different reason. Each page asks for
    PAGE rows and continues from the last id seen, so a capped response is
    indistinguishable from a full one and the walk simply continues; truncation
    cannot silently end it. It stops only on an empty page or a short page, both
    of which mean the table is exhausted."""
    if cache and os.path.exists(cache):
        rows = json.load(open(cache))
        print(f"  scan: {len(rows)} rows from cache {cache}")
        return rows
    rows, last, t0, pages = [], None, time.time(), 0
    while True:
        q = sb.table("articles").select("id,companies").order("id").limit(PAGE)
        if last:
            q = q.gt("id", last)
        r = q.execute()
        if not r.data:
            break
        rows += r.data
        last = r.data[-1]["id"]
        pages += 1
        if pages % 50 == 0:
            print(f"  scan: {len(rows)} rows, {time.time() - t0:.0f}s")
        if limit and len(rows) >= limit:
            rows = rows[:limit]
            break
        if len(r.data) < PAGE:
            break
    el = time.time() - t0
    print(f"  scan: {len(rows)} articles in {el:.1f}s ({len(rows) / max(el, .001):.0f}/s)")
    if cache:
        json.dump(rows, open(cache, "w"))
        print(f"  scan: cached to {cache}")
    return rows


def already_done() -> set:
    """(article_id, loser_name) pairs already in the ledger, for --resume."""
    rows = _fetch_all_table(LEDGER, "article_id,loser_name")
    return {(x["article_id"], x["loser_name"]) for x in rows}


# ---------------------------------------------------------------------------
# Planning
# ---------------------------------------------------------------------------
def plan(rows: list, m: dict, done: set | None = None) -> list:
    """One change per article. An article holding several loser names produces
    ONE change with several ledger entries, because the array is rewritten once.

    SCOPE, AND IT IS ABSOLUTE. The ONLY names this touches are keys of `m`, the
    merge map. A name absent from `m` is never swapped, never removed, never
    read for anything but equality. That covers the 25,554 articles holding
    extractor strings that never resolved to a company row ('NVIDIA', 'Visa',
    'RTX', 'TSLA'): they are a separate pre-existing defect with no survivor to
    point at, and folding them into a merge repair would hide them behind a
    green run. No flag on this tool widens `m`; the map comes from
    norm_v2_merge_map() and nothing else. tools/tests asserts this.

    Order within the array is preserved: a swap edits in place, a remove drops
    the element. Nothing is sorted or deduplicated beyond the removal itself,
    so an article that needed no change is never rewritten.
    """
    changes = []
    for a in rows:
        cur = a.get("companies")
        if not cur:
            continue
        hits = [n for n in cur if n in m]
        if not hits:
            continue
        if done:
            hits = [n for n in hits if (a["id"], n) not in done]
            if not hits:
                continue
        after, entries = list(cur), []
        for loser in hits:
            surv = m[loser]
            if surv in after:
                after = [x for x in after if x != loser]
                entries.append({"action": "remove", "loser": loser, "survivor": surv})
            else:
                after = [surv if x == loser else x for x in after]
                entries.append({"action": "swap", "loser": loser, "survivor": surv})
        if after == cur:
            continue
        changes.append({"id": a["id"], "before": cur, "after": after, "entries": entries})
    return changes


# ---------------------------------------------------------------------------
# Apply
# ---------------------------------------------------------------------------
def _rpc_apply(chunk: list) -> dict:
    payload = [{"id": c["id"], "before": c["before"], "after": c["after"]} for c in chunk]
    res = sb.rpc(APPLY_RPC, {"p_rows": payload}).execute()
    return res.data if isinstance(res.data, dict) else json.loads(res.data)


def _apply_with_split(chunk: list, depth: int = 0):
    """Halve a failing chunk and retry, down to a single row.

    The failure this exists for is 57014, a statement timeout, and it is a SPIKE
    rather than a function of size: the cost of flushing the GIN pending list on
    idx_articles_companies lands on whichever statement fills it. So the right
    answer to a failing batch is a smaller statement, not a retry of the same
    one. Returns (applied, drifted, failed_ids)."""
    if not chunk:
        return 0, 0, []
    try:
        out = _rpc_apply(chunk)
        return int(out.get("applied", 0)), int(out.get("skipped_drift", 0)), []
    except Exception as ex:
        if len(chunk) == 1:
            print(f"    ! row {chunk[0]['id']} failed: {str(ex)[:140]}")
            return 0, 0, [chunk[0]["id"]]
        mid = len(chunk) // 2
        print(f"    split {len(chunk)} -> {mid}+{len(chunk) - mid} at depth {depth}: {str(ex)[:90]}")
        a_ok, a_dr, a_bad = _apply_with_split(chunk[:mid], depth + 1)
        b_ok, b_dr, b_bad = _apply_with_split(chunk[mid:], depth + 1)
        return a_ok + b_ok, a_dr + b_dr, a_bad + b_bad


def apply_changes(changes: list, run_id: str, batch: int):
    """Ledger FIRST, then the array.

    If the process dies between the two, the ledger holds a row describing a
    change that did not happen. That is recoverable: the reversal is guarded on
    companies = companies_after, so a row that was never applied is skipped. The
    other order loses the before-image of a row that WAS changed, which is not
    recoverable.
    """
    applied = drifted = failed = 0
    t0 = time.time()
    for i in range(0, len(changes), batch):
        chunk = changes[i:i + batch]
        ledger = []
        for c in chunk:
            for e in c["entries"]:
                ledger.append({
                    "run_id": run_id, "article_id": c["id"],
                    "action": e["action"], "loser_name": e["loser"],
                    "survivor_name": e["survivor"],
                    "companies_before": c["before"], "companies_after": c["after"],
                })
        try:
            sb.table(LEDGER).upsert(
                ledger, on_conflict="run_id,article_id,loser_name",
                ignore_duplicates=True,
            ).execute()
        except Exception as ex:
            sys.exit(f"ledger write failed at chunk {i // batch}: {ex}\n"
                     "Stopping BEFORE touching articles. Nothing in this chunk changed.")
        ok, dr, bad = _apply_with_split(chunk)
        applied += ok
        drifted += dr
        failed += len(bad)
        el = time.time() - t0
        rate = applied / max(el, .001)
        eta = (len(changes) - (i + len(chunk))) / max(rate, .001)
        print(f"  batch {i // batch + 1}/{(len(changes) + batch - 1) // batch}: "
              f"applied {applied}, drift {drifted}, failed {failed}, "
              f"{rate:.0f}/s, eta {eta / 60:.1f}m")
    return applied, drifted, failed


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--apply", action="store_true", help="WRITE. Default is a dry run.")
    ap.add_argument("--batch", type=int, default=400)
    ap.add_argument("--limit", type=int, default=0, help="stop after N articles (smoke)")
    ap.add_argument("--cache", default="", help="cache/reuse the article scan here")
    ap.add_argument("--resume", action="store_true", help="skip (article, loser) pairs already in the ledger")
    ap.add_argument("--json", metavar="PATH", help="write the plan as JSON")
    args = ap.parse_args()

    print("checking the merge is drained...")
    require_merge_drained()

    print("loading merge map...")
    m = load_map()
    print(f"  {len(m)} loser -> survivor pairs, {len(set(m.values()))} distinct survivors")

    live = live_company_names()
    print(f"  {len(live)} live company names")
    resurrected = [l for l in m if l in live]
    if resurrected:
        print(f"  NOTE: {len(resurrected)} loser name(s) exist in companies again "
              f"(pipeline re-minted them): {resurrected[:5]}")
        print("  Those are NOT repaired: the name resolves, so the article is not broken.")
        for l in resurrected:
            m.pop(l, None)

    print("scanning articles...")
    rows = scan_articles(args.cache, args.limit)

    done = already_done() if args.resume else None
    if done is not None:
        print(f"  --resume: {len(done)} (article, loser) pairs already in the ledger")

    changes = plan(rows, m, done)
    acts = Counter(e["action"] for c in changes for e in c["entries"])
    per_art = Counter(len(c["entries"]) for c in changes)
    print(f"\nPLAN")
    print(f"  articles to rewrite : {len(changes)}")
    print(f"  ledger rows         : {sum(len(c['entries']) for c in changes)}")
    print(f"  swap  (12b)         : {acts['swap']}")
    print(f"  remove(12c)         : {acts['remove']}")
    print(f"  loser names/article : {dict(sorted(per_art.items()))}")

    orphans = Counter()
    for a in rows:
        for n in (a.get("companies") or []):
            if n not in live and n not in m:
                orphans[n] += 1
    print(f"\n  NOT REPAIRED HERE: {len(orphans)} name(s) absent from companies that are "
          f"not merge losers,\n  across {sum(1 for a in rows if any(n in orphans for n in (a.get('companies') or [])))} "
          f"articles. Extractor strings that never resolved.\n  Top: "
          + ", ".join(f"{k!r} ({v})" for k, v in orphans.most_common(5)))

    if args.json:
        json.dump(changes, open(args.json, "w"))
        print(f"\nwrote {args.json}")

    if not args.apply:
        print("\nDRY RUN. Nothing written. Re-run with --apply to write.")
        return 0

    run_id = str(uuid.uuid4())
    print(f"\nAPPLYING. run_id = {run_id}")
    print(f"Reverse this run with sql/0035 section 3 using that uuid.\n")
    applied, drifted, failed = apply_changes(changes, run_id, args.batch)
    print(f"\nDONE. applied {applied}, skipped-drift {drifted}, failed {failed}")
    print(f"run_id = {run_id}")
    if drifted:
        print("  drift means the pipeline changed those rows after the plan was built; "
              "re-run with --resume to re-plan them.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
