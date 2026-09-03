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
import importlib
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


def _symbol_is_importable(spec):
    """True if `spec`, written 'module:attribute', resolves in the running tree.

    This is the escape hatch that keeps --lane-c-sha useful. The default
    capability probe looks for company_match.token_fold_candidates, which is
    where lane C's widening lives today. If lane C ships it somewhere else, the
    operator names the new marker and it is verified the same way: by importing
    it here, in the process that is about to do the writing. Still a property of
    the deployed tree, still not a hex string.
    """
    module_name, _, attr = str(spec).partition(":")
    if not module_name or not attr:
        print(f"  --lane-c-symbol {spec!r} is not in 'module:attribute' form")
        return False
    for candidate in (module_name, f"backend.{module_name}"):
        try:
            module = importlib.import_module(candidate)
        except ImportError:
            continue
        if getattr(module, attr, None) is not None:
            print(f"  named capability {candidate}.{attr} resolves in the running tree")
            return True
        print(f"  imported {candidate} but it has no attribute {attr!r}")
        return False
    print(f"  --lane-c-symbol {spec!r}: cannot import {module_name!r}")
    return False


def _verify_lane_c_attestation(sha, symbol=None):
    """Verify that lane C's capability is in the tree this process is running.

    THIS REPLACED AN ANCESTRY CHECK THAT PROVED NOTHING. The previous version
    asked only `git merge-base --is-ancestor <sha> origin/main`, and every
    commit in the repository's history satisfies that. Reproduced on 2026-08-31:
    the repository ROOT commit 1578cc03 returned GATES PASSED, while lane C's
    actual tip cba3198b was REJECTED, because it is correctly not merged yet.
    All 1,151 commits reachable from origin/main passed. The docstring called it
    "an attestation you cannot fake"; it was an attestation that could not fail.

    The reason it proved nothing is that it tested a proxy. Ancestry of a remote
    branch is not the question. The question is whether the code about to run
    can resolve a recovered name onto an existing company instead of minting a
    duplicate, and a commit hash cannot answer that.

    So this checks the thing itself, in two parts, BOTH required:

      CAPABILITY, the part that actually discriminates. The imported modules
        must expose lane C's widened resolution surface, via
        entity_resolver.resolver_contract(). This is a property of the deployed
        tree. It cannot be satisfied by typing a hex string, and it cannot be
        satisfied by a commit that exists somewhere but is not in this checkout.

      IDENTITY, the audit record. `sha` must name a real commit that is an
        ancestor of HEAD, i.e. of the code this process actually imported. Not
        origin/main: a commit can be on the remote and absent from the tree
        running here, and the tree running here is what will do the writes.

    Why the override still exists at all, given the capability check: lane C
    ships its widening in backend/company_match.py and does not touch
    entity_resolver.py, so it can perfectly well land without anything updating
    a contract dict. This flag is the operator saying "the dict is stale, the
    capability is real, and here is the commit". The capability check is what
    makes that claim verifiable instead of polite.
    """
    ok = True

    contract = _resolver_contract()
    missing = [k for k in ("widened", "index_merged") if contract.get(k) is not True]
    if not missing:
        print(f"  capability present in the running tree: resolver_contract() = {contract!r}")
    elif symbol and _symbol_is_importable(symbol):
        print("  default probe found nothing, but the named capability resolves")
    else:
        print(f"  --lane-c-sha REJECTED: the running tree does not expose lane C's "
              f"capability. resolver_contract() = {contract!r}; missing {missing}.")
        print("  A commit hash cannot substitute for the code being present. Deploy "
              "lane C, then attest it, naming the marker with --lane-c-symbol "
              "module:attribute if it shipped somewhere the default probe cannot see.")
        ok = False

    try:
        subprocess.run(["git", "rev-parse", "--verify", f"{sha}^{{commit}}"],
                       check=True, capture_output=True, timeout=30)
        subprocess.run(["git", "merge-base", "--is-ancestor", sha, "HEAD"],
                       check=True, capture_output=True, timeout=30)
        print(f"  attested commit {sha!r} is an ancestor of HEAD")
    except Exception as ex:
        print(f"  --lane-c-sha {sha!r} is not a commit contained in HEAD: {ex}")
        ok = False

    return ok


def _resolver_contract():
    """Lane C's contract, preferring the live probe over the module snapshot."""
    probe = getattr(entity_resolver, "resolver_contract", None)
    if callable(probe):
        return probe()
    return getattr(entity_resolver, "RESOLVER_CONTRACT", None) or {}


def _fetch_contract():
    """Lane D's contract, preferring the live probe over the module snapshot.

    The snapshot is evaluated at the bottom of wikidata.py so it sees the whole
    module, but calling the probe removes any dependence on where a future merge
    happens to place that assignment.
    """
    probe = getattr(wikidata, "fetch_contract", None)
    if callable(probe):
        return probe()
    return getattr(wikidata, "FETCH_CONTRACT", None) or {}


def _paced_fetch(name):
    """Adapter onto whatever lane D lands. Returns (status, description).

    The status is returned in the FETCHER's own words. run_rebuild translates it
    through R.map_fetch_status, which is the one place that decides what a word
    means, and in particular the one place that refuses to turn a label-check
    miss into a row-blanking `absent`. This function must not translate.

    The first cut of this called wikidata.fetch_wikidata_description_detailed,
    a name lane D does not define and never did; lane D exposes
    _lookup_wikidata(name) -> (status, description) instead. So the moment the
    preconditions finally passed, tier 2 would have died on an AttributeError at
    the first row. Both spellings are accepted now, real one first.

    This script never reaches here unless the fetch contract reports
    reports_http_status, which means the fetcher distinguishes a 429 from an
    answered miss. Until then the precondition check refuses.
    """
    lookup = getattr(wikidata, "_lookup_wikidata", None)
    if callable(lookup):
        result = lookup(name)
        return result[0], result[1]

    fetch_detail = getattr(wikidata, "fetch_wikidata_description_detailed", None)
    if callable(fetch_detail):
        return fetch_detail(name)

    raise R.PreconditionFailure(
        "The fetch contract reports reports_http_status, but backend/wikidata.py "
        "exposes neither _lookup_wikidata(name) -> (status, description) nor "
        "fetch_wikidata_description_detailed(name) -> (status, description). "
        "The contract and the module disagree; do not write with it."
    )


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
    ap.add_argument("--lane-c-symbol", default=None, metavar="MODULE:ATTR",
                    help="name the symbol that carries lane C's capability, if it "
                         "shipped somewhere the default probe cannot see. Verified "
                         "by importing it. Only meaningful with --lane-c-sha.")
    ap.add_argument("--lane-c-sha", default=None,
                    help="attest lane C shipped under a different marker. Verified "
                         "against the RUNNING TREE: the resolver capability must "
                         "actually be importable, and the sha must be an ancestor of "
                         "HEAD. A sha alone proves nothing and is rejected. There is "
                         "no equivalent for lane D, on purpose.")
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

    lane_c_ok = bool(args.lane_c_sha) and _verify_lane_c_attestation(
        args.lane_c_sha, symbol=args.lane_c_symbol)
    try:
        for line in R.check_preconditions(
            mode,
            resolver_contract=_resolver_contract(),
            fetch_contract=_fetch_contract(),
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
