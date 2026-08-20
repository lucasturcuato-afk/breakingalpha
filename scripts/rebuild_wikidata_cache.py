"""Rebuild wikidata_entity_cache. Resumable, paced, refuses to run out of order.

THE ORDER IS C, THEN D, THEN E. This script is lane E and it runs LAST.
  Lane C, resolver widening and index merge, deploys first, because this rebuild
  recovers names the entity gate drops today and every recovery goes through
  resolve_entity. Without the widened resolver about 60% of them become
  duplicate companies rows.
  Lane D, the 429 fetch fix, deploys second, because rebuilding into a throttled
  fetcher re-poisons the cache with the same NULLs, at scale, and burns the
  budget doing it.
  Lane E runs third. The preconditions below enforce that in code.

DEFAULT IS --dry-run. Running this with no arguments performs zero writes and
zero Wikidata calls; it reads the cache, prints the work set and the projected
wall clock, and exits. You have to ask for a write.

USAGE
  python scripts/rebuild_wikidata_cache.py                      # dry run, safe
  python scripts/rebuild_wikidata_cache.py --mode reclassify --yes
  python scripts/rebuild_wikidata_cache.py --mode refetch --yes --max-calls 500

RESUMABILITY. There is no cursor file. The work set is defined by the rows' own
columns, and a rewritten row stamps the current classifier version and leaves
the set, so re-running simply continues. Kill this at any point and the cache
holds N fully correct rows and the rest exactly as they were. A fetch error
writes only fetch_status and last_refetch_at, so an interrupted or throttled run
can never blank a good row.
"""

import argparse
import os
import subprocess
import sys
import time

from dotenv import load_dotenv
from supabase import create_client

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from backend import entity_resolver, wikidata  # noqa: E402
from backend import wikidata_cache_rebuild as R  # noqa: E402


def _client():
    load_dotenv()
    load_dotenv(".env.local")
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        print("Missing SUPABASE_URL / key. Aborting, nothing done.")
        sys.exit(2)
    return create_client(url, key)


def _paged(sb, table, columns, key_col, cap=400000):
    """Keyset pagination on `key_col`, not .range() offsets.

    articles has ~180k rows and a deep OFFSET scan hits the PostgREST statement
    timeout (57014). Keyset paging is O(page) instead of O(offset) and it is
    also stable under concurrent inserts, which matters for a job that can run
    for hours.
    """
    select = columns if key_col in columns or columns == "*" else f"{key_col},{columns}"
    out, cursor, size = [], None, 1000
    while len(out) < cap:
        q = sb.table(table).select(select).order(key_col).limit(size)
        if cursor is not None:
            q = q.gt(key_col, cursor)
        rows = q.execute().data or []
        if not rows:
            break
        out.extend(rows)
        cursor = rows[-1][key_col]
        if len(rows) < size:
            break
    return out


def _hot_names(sb):
    """Usage weight per name: how often it is an articles.primary_company.

    15,561 of the 16,632 distinct primary_company values are in this cache and
    11,907 of those need a refetch, so ordering the refetch queue by this
    front-loads essentially all of the user-visible value.
    """
    weights = {}
    for row in _paged(sb, "articles", "primary_company", "id"):
        name = row.get("primary_company")
        if name:
            weights[name] = weights.get(name, 0) + 1
    return weights


def _verify_merged_sha(sha):
    """True only if `sha` is an ancestor of origin/main, i.e. actually merged.

    This is what makes --lane-c-sha an attestation you cannot fake by typing a
    plausible-looking hex string.
    """
    try:
        subprocess.run(["git", "rev-parse", "--verify", f"{sha}^{{commit}}"],
                       check=True, capture_output=True, timeout=30)
        subprocess.run(["git", "merge-base", "--is-ancestor", sha, "origin/main"],
                       check=True, capture_output=True, timeout=30)
        return True
    except Exception as ex:
        print(f"  --lane-c-sha {sha!r} is not a commit merged into origin/main: {ex}")
        return False


def _paced_fetch(name):
    """Adapter onto whatever lane D lands. Returns (fetch_status, description).

    Deliberately thin. This script never reaches here unless
    wikidata.FETCH_CONTRACT reports reports_http_status, which means lane D's
    fetcher distinguishes a 429 from a genuine absence. Until then the
    precondition check refuses and this function is unreachable.
    """
    fetch_detail = getattr(wikidata, "fetch_wikidata_description_detailed", None)
    if fetch_detail is None:
        raise R.PreconditionFailure(
            "wikidata.FETCH_CONTRACT claims reports_http_status, but the module "
            "exposes no fetch_wikidata_description_detailed(name) -> (status, description). "
            "Lane D must ship both together."
        )
    return fetch_detail(name)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=[R.MODE_DRY_RUN, R.MODE_RECLASSIFY, R.MODE_REFETCH],
                    default=R.MODE_DRY_RUN,
                    help="dry_run (default, zero writes), reclassify (tier 1, zero "
                         "network), refetch (tier 2, paced network calls)")
    ap.add_argument("--yes", action="store_true",
                    help="required for any write. Without it every mode is a dry run.")
    ap.add_argument("--limit", type=int, default=None, help="cap the planned work set")
    ap.add_argument("--max-calls", type=int, default=None,
                    help="hard cap on outbound Wikidata calls for this invocation")
    ap.add_argument("--max-age-days", type=int, default=R.DEFAULT_MAX_AGE_DAYS,
                    help=f"TTL on trusted descriptions (default {R.DEFAULT_MAX_AGE_DAYS}; "
                         "0 disables the age sweep and leaves only version invalidation)")
    ap.add_argument("--lane-c-sha", default=None,
                    help="attest lane C shipped under a different marker. Verified as a "
                         "merged ancestor of origin/main. There is no equivalent for "
                         "lane D, on purpose.")
    args = ap.parse_args(argv)

    mode = args.mode
    if mode != R.MODE_DRY_RUN and not args.yes:
        print(f"--mode {mode} without --yes. Downgrading to a dry run.\n")
        mode = R.MODE_DRY_RUN

    current = wikidata.classifier_version()
    print("=" * 72)
    print("wikidata_entity_cache rebuild")
    print(f"  mode                {mode}")
    print(f"  classifier version  {current}")
    print(f"  pacing floor        {R.REQUIRED_MIN_INTERVAL_S:.2f} s/call "
          f"({R.MEASURED_CALLS_PER_WINDOW} calls / {R.MEASURED_WINDOW_S:.0f} s measured)")
    print("=" * 72)

    lane_c_ok = bool(args.lane_c_sha) and _verify_merged_sha(args.lane_c_sha)
    try:
        for line in R.check_preconditions(
            mode,
            resolver_contract=getattr(entity_resolver, "RESOLVER_CONTRACT", None),
            fetch_contract=getattr(wikidata, "FETCH_CONTRACT", None),
            lane_c_sha_verified=lane_c_ok,
        ):
            print(f"  PASS  {line}")
    except R.PreconditionFailure as ex:
        print("\nREFUSING TO RUN.\n")
        print(ex)
        return 3
    print()

    sb = _client()
    print("Reading the cache (SELECT only)...")
    rows = _paged(sb, R.CACHE_TABLE, "*", "name")
    print(f"  {len(rows)} rows")
    print("Reading articles.primary_company for the priority order (SELECT only)...")
    hot = _hot_names(sb)
    print(f"  {len(hot)} distinct primary_company names")

    items = R.plan(rows, current, hot_names=hot, max_age_days=args.max_age_days,
                   limit=args.limit)
    summary = R.summarize(items)
    print()
    print("WORK SET")
    print(f"  tier 1 reclassify (zero network)  {summary['reclassify']}")
    print(f"  tier 2 refetch    (one call each) {summary['refetch']}")
    print(f"  total                             {summary['total']}")
    print(f"  projected network wall clock      {summary['network_wall_clock']}")
    hot_refetch = sum(1 for it in items if it.work == R.WORK_REFETCH and it.priority > 0)
    print(f"  of the refetches, used as primary_company: {hot_refetch} "
          f"({R.format_wall_clock(R.estimate_seconds(hot_refetch))}), and they run first")

    if mode == R.MODE_DRY_RUN:
        print("\nDRY RUN. No writes, no Wikidata calls. Nothing was changed.")
        return 0

    if mode == R.MODE_RECLASSIFY:
        items = [it for it in items if it.work == R.WORK_RECLASSIFY]
        print(f"\nTIER 1 only: {len(items)} rows, zero Wikidata calls.")

    def write_fn(name, payload):
        sb.table(R.CACHE_TABLE).update(payload).eq("name", name).execute()

    done = {"n": 0}

    def on_progress(item, counts):
        done["n"] += 1
        if done["n"] % 100 == 0 or done["n"] == len(items):
            print(f"  {done['n']}/{len(items)}  {counts}")

    started = time.time()
    counts = R.run_rebuild(
        items, current,
        fetch_fn=_paced_fetch,
        write_fn=write_fn,
        sleep_fn=time.sleep,
        interval_s=R.REQUIRED_MIN_INTERVAL_S,
        max_calls=args.max_calls,
        on_progress=on_progress,
    )
    print(f"\nDone in {(time.time() - started) / 60:.1f} min: {counts}")
    print("Re-run this command to continue. The work set is derived from the rows "
          "themselves, so it resumes where it stopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
