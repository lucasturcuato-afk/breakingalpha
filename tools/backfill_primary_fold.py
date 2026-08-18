"""Historical backfill of articles.companies[] using the merged fold resolution.

The fold gate (PR #616) is FORWARD-ONLY: it changes rows written after deploy.
This rewrites the historical rows, so a companies[]-based query stops missing
articles that are demonstrably about a tracked company.

SAFETY MODEL
------------
  - DRY RUN BY DEFAULT. --apply is required to write anything.
  - Every mutated row is recorded in public.articles_companies_backfill BEFORE
    the update, so the whole run is reversible (sql/0029, section 2).
  - Idempotent: the ledger has UNIQUE(article_id), and a row already carrying
    its resolved name is skipped, so re-running is a no-op.
  - Batched. Each batch is: ledger upsert, then ONE set-based update via
    public.apply_companies_backfill. Stopping halfway leaves a coherent state,
    because the ledger is always written first and the update is guarded on the
    planned `before` value, so a row is never changed without a record of it.
  - HARD FREEZE: touches articles.companies ONLY. Never company_mentions,
    never mention_count, never companies, never aliases.
  - No minting. Resolution is read-only against a point-in-time snapshot of
    companies + aliases; resolve_entity is never called.

RESOLUTION PARITY
-----------------
Resolution is NOT reimplemented here. It imports build_index / resolve_after
from tools/primary_fold_eval.py, the same functions used to measure the fold,
which mirror backend/ingest.py _resolve_primary_to_canonical step for step:
exact name, case-insensitive name, alias lookup_key, ticker, normalized key,
each requiring a UNIQUE hit or folding nothing. The blocklist is imported from
backend.ingest itself so it cannot drift.

USAGE
    python tools/backfill_primary_fold.py                      # dry run, full report
    python tools/backfill_primary_fold.py --stale-check        # 0020 overlap
    python tools/backfill_primary_fold.py --apply --batch 500  # the real thing
    python tools/backfill_primary_fold.py --apply --resume     # continue a stopped run
"""

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
sys.path.insert(0, _HERE)

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(_ROOT, ".env.local"))
# .env.local carries the NEXT_PUBLIC_ names; backend modules read the bare ones.
# Bridge in-process rather than editing the file. The anon key is needed only
# because importing backend.ingest pulls in modules that read it at import time;
# every write in this tool goes through the service role.
for _bare, _public in (("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"),
                       ("SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY")):
    if _bare not in os.environ and _public in os.environ:
        os.environ[_bare] = os.environ[_public]

from supabase import create_client  # noqa: E402

# The measurement tool's index + resolver. Single definition, shared with the
# numbers already reported for this change.
from primary_fold_eval import build_index, resolve_after  # noqa: E402

LEDGER = "articles_companies_backfill"
PAGE = 1000

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])


def _blocklist():
    """The production blocklist, imported rather than reimplemented.

    Importing backend.ingest constructs its module-level Supabase and Gemini
    clients. Both construct offline with no network call, which is why the test
    suite imports it the same way. If the import ever fails we refuse to run
    rather than silently folding entities the gate would have blocked.
    """
    try:
        from ingest import is_blocked_entity
        return is_blocked_entity
    except Exception as ex:
        raise SystemExit(
            f"FATAL: could not import is_blocked_entity from backend.ingest ({ex}).\n"
            "Refusing to run: the backfill must apply the same blocklist as the "
            "live gate, and guessing at it is not acceptable."
        )


def scan_articles(limit=0, cache=""):
    if cache and os.path.exists(cache):
        with open(cache) as fh:
            rows = [json.loads(line) for line in fh]
        print(f"  loaded {len(rows)} rows from cache {cache}")
        return rows
    rows, cursor, t0 = [], None, time.time()
    while True:
        q = (sb.table("articles").select("id, companies, primary_company")
             .order("id").limit(PAGE))
        if cursor is not None:
            q = q.gt("id", cursor)
        batch = q.execute().data or []
        rows.extend(batch)
        if len(rows) % 20000 < PAGE:
            print(f"    {len(rows)} rows...", flush=True)
        if len(batch) < PAGE or (limit and len(rows) >= limit):
            break
        cursor = batch[-1]["id"]
    print(f"  scanned {len(rows)} article rows in {time.time() - t0:.0f}s")
    if cache:
        with open(cache, "w") as fh:
            for r in rows:
                fh.write(json.dumps(r) + "\n")
    return rows


def plan(rows, idx, is_blocked):
    """Decide, read-only, exactly which rows change and to what.

    Mirrors _fold_primary_into_companies: non-empty primary, not blocked,
    resolves to exactly one indexed company, canonical not already present
    (case-insensitive).
    """
    changes, skipped = [], Counter()
    for r in rows:
        primary = (r.get("primary_company") or "").strip()
        if not primary:
            skipped["no_primary_company"] += 1
            continue
        companies = r.get("companies") or []
        if is_blocked(primary):
            skipped["blocked_entity"] += 1
            continue
        canonical = resolve_after(idx, primary)
        if not canonical:
            skipped["unresolvable"] += 1
            continue
        if canonical.lower() in {c.lower() for c in companies}:
            skipped["already_present"] += 1
            continue
        changes.append({
            "article_id": r["id"],
            "primary_company": primary,
            "resolved_name": canonical,
            "companies_before": companies,
            "companies_after": [*companies, canonical],
        })
    return changes, skipped


def already_done(sample_ids=None):
    """article_ids already in the ledger, for --resume and idempotency."""
    done, cursor = set(), None
    try:
        while True:
            q = sb.table(LEDGER).select("article_id").order("article_id").limit(PAGE)
            if cursor is not None:
                q = q.gt("article_id", cursor)
            batch = q.execute().data or []
            for row in batch:
                done.add(row["article_id"])
            if len(batch) < PAGE:
                return done
            cursor = batch[-1]["article_id"]
    except Exception as ex:
        raise SystemExit(
            f"FATAL: cannot read {LEDGER} ({ex}).\n"
            "Apply sql/0029_articles_companies_backfill_audit.sql first. The "
            "backfill will not write without its ledger."
        )


def _rpc_apply(chunk):
    """One set-based apply call. Returns (applied, skipped_drift)."""
    payload = [{"id": c["article_id"],
                "before": c["companies_before"],
                "after": c["companies_after"]} for c in chunk]
    res = sb.rpc("apply_companies_backfill", {"p_rows": payload}).execute()
    row = res.data if isinstance(res.data, dict) else (res.data or [{}])[0]
    return int(row.get("applied") or 0), int(row.get("skipped_drift") or 0)


def _apply_with_split(chunk, depth=0):
    """Apply a chunk, halving it and retrying on failure. Returns
    (applied, skipped_drift, failed).

    REPLACES the old per-row PostgREST fallback, which was broken two ways and
    applied zero rows in the 2026-08-17 run:

      1. It passed a Python list to .eq("companies", [...]). PostgREST filters
         are query-string values and need Postgres array-literal syntax
         ({"Apple Inc."}), so every call failed with 22P02 malformed array
         literal. It was never exercised before that run, so the bug shipped.
      2. Falling back per-row was the wrong response to the actual failure
         anyway. The RPC did not become unavailable, it hit 57014 statement
         timeout. The right response to "this statement was too big" is a
         smaller statement, not 500 separate ones.

    Halving keeps ONE apply path, so the SQL drift guard has one implementation
    and there is no second serialization to get wrong. A single row that still
    fails is counted as failed and the run continues; it stays in the ledger
    unapplied, which the reconciliation query in sql/0029 section 3 surfaces.
    """
    try:
        ok, drift = _rpc_apply(chunk)
        if depth:
            print(f"    split-retry ok: {len(chunk)} row(s), applied={ok}")
        return ok, drift, 0
    except Exception as ex:
        msg = str(ex)[:110]
        if len(chunk) == 1:
            print(f"    row {chunk[0]['article_id']} FAILED: {msg}")
            return 0, 0, 1
        mid = len(chunk) // 2
        print(f"    chunk of {len(chunk)} failed ({msg}); splitting")
        a_ok, a_dr, a_bad = _apply_with_split(chunk[:mid], depth + 1)
        b_ok, b_dr, b_bad = _apply_with_split(chunk[mid:], depth + 1)
        return a_ok + b_ok, a_dr + b_dr, a_bad + b_bad


def apply_changes(changes, run_id, batch_size):
    """Ledger row FIRST, then the article update. Never the other way round.

    If the process dies between the two, the ledger holds a row whose `after`
    does not match the article. That is detectable (section 3 of sql/0029) and
    safe: the reversal is guarded on companies = companies_after, so it skips
    such a row instead of corrupting it. The reverse ordering would leave a
    mutated row with no record, which is not recoverable.
    """
    applied = failed = 0
    skipped_drift_total = [0]   # list so the inner scope can mutate it
    t0 = time.time()
    for i in range(0, len(changes), batch_size):
        chunk = changes[i:i + batch_size]
        ledger_rows = [{
            "run_id": run_id,
            "article_id": c["article_id"],
            "primary_company": c["primary_company"],
            "resolved_name": c["resolved_name"],
            "companies_before": c["companies_before"],
            "companies_after": c["companies_after"],
        } for c in chunk]
        try:
            # on_conflict on the UNIQUE(article_id): a retry of a partially
            # completed chunk inserts nothing new.
            sb.table(LEDGER).upsert(
                ledger_rows, on_conflict="article_id", ignore_duplicates=True
            ).execute()
        except Exception as ex:
            print(f"  ledger write failed for chunk at {i}: {ex}")
            failed += len(chunk)
            continue

        n_ok, n_drift, n_bad = _apply_with_split(chunk)
        applied += n_ok
        failed += n_bad
        if n_drift:
            skipped_drift_total[0] += n_drift
            print(f"  {n_drift} row(s) skipped: companies[] changed since planning")

        done = min(i + batch_size, len(changes))
        rate = done / max(time.time() - t0, 0.001)
        eta = (len(changes) - done) / max(rate, 0.001)
        print(f"  [{done}/{len(changes)}] applied={applied} failed={failed} "
              f"{rate:.0f} rows/s eta {eta / 60:.1f}m", flush=True)
    if skipped_drift_total[0]:
        print(f"  TOTAL skipped on drift: {skipped_drift_total[0]} "
              f"(rows changed between planning and apply; re-run to pick them up)")
    return applied, failed


def stale_check(changes, idx):
    """What a later sql/proposals/0020 merge would invalidate.

    0020 merges duplicate clusters and DELETES the loser company rows. It does
    NOT rewrite articles.companies[], which stores NAMES, not ids. So any name
    this backfill writes that later becomes a merge loser stops matching a live
    company, and those rows go dark again.

    Reported here so the overlap is known before the backfill runs, not after.
    """
    import re

    import company_match
    from company_match import BASE_SUFFIXES, EXTRA_SUFFIXES

    company_match._SUFFIX_RE = re.compile(
        r"\s+(" + "|".join(BASE_SUFFIXES + EXTRA_SUFFIXES) + r")$")

    rows, cursor = [], None
    while True:
        q = sb.table("companies").select(
            "id, name, ticker, sec_cik, mention_count, first_seen").order("id").limit(PAGE)
        if cursor:
            q = q.gt("id", cursor)
        b = q.execute().data or []
        rows.extend(b)
        if len(b) < PAGE:
            break
        cursor = b[-1]["id"]

    clusters = defaultdict(list)
    for r in rows:
        n = (r.get("name") or "").strip()
        if not n:
            continue
        k = company_match.normalize_company_key(n)
        if k and len(k) > 1:
            clusters[k].append(r)

    # survivor rule from sql/proposals/0020b: mention_count DESC, first_seen, id
    losers = {}
    for k, ms in clusters.items():
        if len(ms) < 2:
            continue
        ordered = sorted(ms, key=lambda m: (
            -(m.get("mention_count") or 0), m.get("first_seen") or "", m["id"]))
        for m in ordered[1:]:
            losers[m["name"]] = ordered[0]["name"]

    would_write_loser = Counter()
    for c in changes:
        if c["resolved_name"] in losers:
            would_write_loser[c["resolved_name"]] += 1

    existing_loser_refs = 0  # pre-existing, not caused by this backfill

    print("\n=== sql/proposals/0020 OVERLAP ===")
    print(f"duplicate clusters today            : {sum(1 for v in clusters.values() if len(v) > 1)}")
    print(f"company names that become LOSERS    : {len(losers)}")
    print(f"backfill writes using a loser name  : {sum(would_write_loser.values())} rows "
          f"over {len(would_write_loser)} names "
          f"({sum(would_write_loser.values()) / max(len(changes),1) * 100:.1f}% of the backfill)")
    if would_write_loser:
        print("  top names this backfill would write that 0020 later deletes:")
        for name, n in would_write_loser.most_common(12):
            print(f"    {n:>6}  {name!r}  -> survivor {losers[name]!r}")
    print("\n  These rows are NOT lost work: the ledger records resolved_name, so the")
    print("  post-0020 fix is one UPDATE joining resolved_name to the loser->survivor")
    print("  map. Nothing needs re-resolving. See the writeup.")
    return would_write_loser, losers


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="WRITE. Default is dry run.")
    ap.add_argument("--batch", type=int, default=500)
    ap.add_argument("--limit", type=int, default=0, help="stop after N articles (smoke)")
    ap.add_argument("--cache", default="", help="cache the article scan to this path")
    ap.add_argument("--resume", action="store_true", help="skip article_ids already in the ledger")
    ap.add_argument("--stale-check", action="store_true", help="report the 0020 overlap and exit")
    args = ap.parse_args()

    is_blocked = _blocklist()

    print("loading entity index...", flush=True)
    idx = build_index()
    print(f"  companies={len(idx['name_by_id'])} alias_keys={len(idx['by_alias'])} "
          f"tickers={len(idx['by_ticker'])} norm_keys={len(idx['by_norm'])}")

    print("scanning articles...", flush=True)
    rows = scan_articles(args.limit, args.cache)

    changes, skipped = plan(rows, idx, is_blocked)

    print("\n=== PLAN ===")
    print(f"articles scanned            : {len(rows)}")
    for k, v in skipped.most_common():
        print(f"  skipped {k:<22}: {v}")
    print(f"ROWS THAT WOULD CHANGE      : {len(changes)}")
    if rows:
        print(f"  as a share of the table   : {len(changes) / len(rows) * 100:.1f}%")

    top = Counter(c["resolved_name"] for c in changes)
    print("\ntop 12 companies gaining rows:")
    for name, n in top.most_common(12):
        print(f"  {n:>6}  {name}")

    if args.stale_check:
        stale_check(changes, idx)
        return

    if args.resume or args.apply:
        # DO NOT filter `changes` by ledger membership.
        #
        # The ledger records INTENT (written before the update), not outcome. In
        # the 2026-08-17 run one chunk's RPC hit a statement timeout and rolled
        # back, leaving 500 rows ledgered but unapplied. Skipping everything in
        # the ledger would have permanently skipped exactly those 500 rows: the
        # one population resume exists to pick up.
        #
        # plan() above already reflects OUTCOME, because it skips any row whose
        # canonical name is already present in companies[]. An applied row is
        # therefore excluded automatically, and an unapplied one is retried. The
        # ledger upsert is ON CONFLICT DO NOTHING, so re-ledgering is a no-op.
        ledgered = already_done()
        retry = sum(1 for c in changes if c["article_id"] in ledgered)
        print(f"\nledger holds {len(ledgered)} row(s) from previous runs")
        print(f"{len(changes)} row(s) still need applying"
              + (f", of which {retry} were ledgered but never applied "
                 f"(rolled-back chunk being retried)" if retry else ""))

    if not args.apply:
        print("\nDRY RUN. Nothing written. Re-run with --apply to execute.")
        return

    run_id = str(uuid.uuid4())
    print(f"\n=== APPLYING run_id={run_id} ===")
    print(f"{len(changes)} rows, batch={args.batch}. Ctrl-C is safe: every row is "
          f"ledgered before it is updated.")
    applied, failed = apply_changes(changes, run_id, args.batch)
    print(f"\nDONE. applied={applied} failed={failed} run_id={run_id}")
    print("Verify with sql/0029 section 3. Reverse with section 2 using that run_id.")


if __name__ == "__main__":
    main()
