"""
wikidata_cache_rebuild.py: TTL and invalidation for `wikidata_entity_cache`.

WHAT WAS BROKEN
---------------
`wikidata_entity_cache` had no TTL and no invalidation. Confirmed by query, not
by absence: the oldest surviving row is 2026-04-12 and is still present 130 days
later, every name has exactly one row (24,537 names, 24,537 rows, zero
duplicates), the read path in backend/wikidata.py selects
`is_company, wikidata_description` with no `checked_at` predicate, and the only
DELETE in the repo is commented out in
supabase/migrations/20260503235800_w2a_wikidata_cleanup.sql, which says so.

Measured consequence. `Coinbase` has been cached `is_company = False` since
2026-04-13 under the description "american company that operates a
cryptocurrency exchange platform". Today's `_classify` returns True on that
exact string. PR #358 shipped the HARD/SOFT split on 2026-06-13 to fix that
case; it has been inert in production for 68 days, because `is_valid_company`
returns from the cache branch without re-classifying. Same for
`Coinbase Global` and `Bitcoin Depot`. Any future classifier fix, PR #627
included, is dead on arrival across all 24,537 rows for the same reason.

WHAT THIS MODULE IS
-------------------
The invalidation mechanism, in two tiers, plus the preconditions that stop it
running in the wrong order.

  TIER 1  RECLASSIFY.  Zero network calls. Re-runs `_classify` over the
          description already stored on the row. This is the tier that makes a
          classifier fix actually reach production. Measured against today's
          main: 5 rows flip (Coinbase, Coinbase Global, Bitcoin Depot, Hut 8
          Mining, Simon Property). Measured against PR #627's classifier: 38.
          5,805 rows carry a description, so the whole tier is a handful of
          batched UPDATEs and finishes in under a minute.

  TIER 2  REFETCH.  One paced Wikidata call per row. This is the tier the
          18,732 NULL-description rows need, and it is the expensive one.

WHY THE ROWS ARE EXPIRED AND NOT PURGED
---------------------------------------
Purging the NULL rows is the one option that can leave the cache worse than it
started, so it is rejected. A purged row is a cache MISS, and a miss on the
current code path calls Wikidata inline inside the ingest hot loop at
`_REQUEST_DELAY = 0.15` seconds. That is the exact pacing that produced the
poison in the first place: 400 calls/min against a measured anonymous budget of
10 to 11 calls per 52 seconds. Purging therefore converts a poisoned cache into
an unpaced live-fetch storm on the ingest critical path, and between the purge
and the refill those names have no verdict at all.

Expiring instead is strictly monotonic. The row keeps its current verdict and
keeps serving it, so ingest behavior never gets worse. The rebuilder picks the
row up out of band. If the rebuilder never runs, we are exactly where we are
today. That is the property purge does not have.

INTERRUPTION SAFETY
-------------------
1. One row per write, committed immediately. There is no batch that can be half
   applied, so a dead process leaves N fully correct rows and 24,537 - N
   untouched rows. No row is ever in an intermediate state.
2. Resume by query, not by cursor. The work set is defined by the row's own
   columns. A rewritten row stamps the current classifier version and leaves the
   set, so re-running simply continues. There is no offset to lose and no
   checkpoint file to corrupt.
3. A row is NEVER blanked BY A NON-ANSWER. The earlier wording here was "a row
   is never blanked", full stop, and that was false: the `absent` branch of
   build_update writes `wikidata_description = None` by design. The accurate
   claim, and the one the code enforces, is narrower.

   On a fetch error, and on any outcome that is not an answer, the update
   touches only `fetch_status` and `last_refetch_at`; `wikidata_description`,
   `is_company` and `classifier_version` are left exactly as they were. So a
   rebuild that dies halfway, or one that runs into a throttled endpoint, cannot
   convert good rows into NULL rows. That is precisely the failure the current
   `is_valid_company` write path has, since it upserts `description=None` on
   error, which is how the poison got in.

   Exactly one outcome may clear a description: `absent`, meaning Wikidata was
   reached and positively has no entry. Nothing in this repo can currently
   produce it. In particular lane D's `no_result` is a LABEL-CHECK miss, not a
   proven absence, so it maps to `unknown` and is non-destructive. See
   FETCHER_STATUS_MAP, where that mapping is enforced at import.

Worst case of a half-dead rebuild equals the starting state.

READ PATH IS DELIBERATELY UNTOUCHED
-----------------------------------
`is_valid_company` is not modified. The rebuild corrects `is_company` in place,
and the gate then serves the corrected value through code that already exists.
Nothing in the ingest hot path changes, so this cannot regress ingest. It also
means read-time staleness must never trigger an inline fetch: the rebuild is
out of band, always. A miss-driven inline fetch is the storm, not the fix.

MIGRATION
---------
supabase/migrations/20260820120000_le_wikidata_cache_staleness.sql adds the
three columns this module reads. It is a FILE ONLY and must NEVER be applied by
an agent. Until it is applied by a human, only `--dry-run` is meaningful.
"""

import datetime as _dt
from collections import namedtuple

try:
    import wikidata  # cron context: cwd=backend/
except ImportError:
    from backend import wikidata  # test/dev context: cwd=repo-root


CACHE_TABLE = "wikidata_entity_cache"

# MEASURED anonymous wbsearchentities budget: 10 to 11 calls per ~52 seconds.
# The conservative (slower) end is used, so the pacing derived from it is safe
# at either measurement. A live paced probe of 10 calls at this interval on
# 2026-08-20 returned HTTP 200 ten times out of ten, zero 429s.
MEASURED_CALLS_PER_WINDOW = 10
MEASURED_WINDOW_S = 52.0
REQUIRED_MIN_INTERVAL_S = MEASURED_WINDOW_S / MEASURED_CALLS_PER_WINDOW  # 5.2

# Fetch outcome vocabulary. Today the fetcher collapses all of these into one
# `None`, which is the root defect: a 429 and a genuine "no such entity" are
# stored identically and forever.
FETCH_STATUS_OK = "ok"            # Wikidata returned a description
FETCH_STATUS_ABSENT = "absent"    # Wikidata answered, and has no entry. A real negative.
FETCH_STATUS_ERROR = "error"      # transport, 429 or 5xx. NOT an answer. Do not trust.
FETCH_STATUS_UNKNOWN = "unknown"  # legacy row, written before we recorded status

# ---------------------------------------------------------------------------
# CROSS-LANE VOCABULARY BRIDGE
# ---------------------------------------------------------------------------
# This module reasons in four words. Lane D's fetcher emits three DIFFERENT
# words: ('ok', 'no_result', 'failed'). They are not the same vocabulary and the
# translation is not cosmetic, because one plausible-looking mapping silently
# writes the exact fabrication this whole design exists to prevent.
#
# THE TRAP. `no_result` reads like `absent`, and mapping it there is the obvious
# thing to do. It is wrong. Lane D returns `no_result` when its LABEL CHECK
# rejected every result it got back, which happens when Wikidata does hold an
# entity for the name but under a label the check does not accept. That is not
# "Wikidata has no entry", it is "we did not recognise what Wikidata sent". The
# `absent` branch of build_update writes `wikidata_description = None`, so
# mapping no_result -> absent takes a live, correct row such as
#   'Allianz SE' / 'european multinational insurance and financial services
#   corporation' / is_company=True
# and rewrites it to None / None on every label-check miss. 2,690 rows in the
# live cache currently hold a description with is_company=True and are eligible
# for exactly that. Blanking them is strictly worse than never running.
#
# So `no_result` maps to `unknown`: honest, non-destructive, and it leaves the
# row in the work set to be retried. The cost is that a name Wikidata genuinely
# has no entry for is retried on every pass rather than being settled once. That
# is the right side to be wrong on, and it is the side that cannot fabricate.
#
# `absent` stays in the vocabulary because it is the correct label for a fetcher
# that can positively prove absence. No fetcher in this repo can, so nothing
# currently maps onto it, and the invariant below keeps it that way.
FETCHER_STATUS_MAP = {
    # lane D's vocabulary
    "ok": FETCH_STATUS_OK,
    "no_result": FETCH_STATUS_UNKNOWN,
    "failed": FETCH_STATUS_ERROR,
    # this module's own vocabulary, so a fetcher already speaking it passes through
    FETCH_STATUS_OK: FETCH_STATUS_OK,
    FETCH_STATUS_ABSENT: FETCH_STATUS_ABSENT,
    FETCH_STATUS_ERROR: FETCH_STATUS_ERROR,
    FETCH_STATUS_UNKNOWN: FETCH_STATUS_UNKNOWN,
}

# Load-bearing invariant, enforced at import rather than left to review: the
# only key allowed to produce a row-blanking `absent` is `absent` itself. If a
# later lane adds a status word and maps it here out of tidiness, this raises on
# import instead of blanking rows in production.
_ABSENT_SOURCES = {k for k, v in FETCHER_STATUS_MAP.items() if v == FETCH_STATUS_ABSENT}
if _ABSENT_SOURCES != {FETCH_STATUS_ABSENT}:
    raise RuntimeError(
        "FETCHER_STATUS_MAP maps a non-absent status onto FETCH_STATUS_ABSENT: "
        f"{sorted(_ABSENT_SOURCES)}. `absent` blanks wikidata_description, so it "
        "may only come from a fetcher that positively proved absence."
    )


def map_fetch_status(status):
    """Translate a fetcher's status word into this module's vocabulary.

    Raises ValueError on anything unrecognised rather than guessing. A status
    this module has never seen is not evidence of anything, and the one guess
    available (treat it as absence) is the destructive one.
    """
    try:
        return FETCHER_STATUS_MAP[status]
    except (KeyError, TypeError):
        raise ValueError(
            f"unrecognised fetch status {status!r}. Known: "
            f"{sorted(k for k in FETCHER_STATUS_MAP if isinstance(k, str))}. "
            "Add it to FETCHER_STATUS_MAP deliberately; it must not map to "
            f"{FETCH_STATUS_ABSENT!r} unless the fetcher proved absence."
        ) from None

# Every pre-existing row backfills to this. We cannot retroactively separate a
# 429 from a genuine absence in the 18,732 NULL rows, and pretending we can
# would be a fabrication, so "unknown" is the honest label and it means
# "needs re-fetch".
LEGACY_CLASSIFIER_VERSION = "legacy"

# TTL on descriptions that we DO trust. Wikidata descriptions change: the cached
# top hit for `GM` is "sovereign state in west africa" and today's is the
# automaker. 180 days is chosen so the TTL adds zero work today (the oldest row
# is 130 days old) and starts sweeping in 50 days, which prevents the next
# 130-day staleness without manufacturing 24,537 calls of work on merge day.
DEFAULT_MAX_AGE_DAYS = 180

WORK_REFETCH = "refetch"        # tier 2, one network call
WORK_RECLASSIFY = "reclassify"  # tier 1, zero network calls
WORK_NONE = None

MODE_DRY_RUN = "dry_run"
MODE_RECLASSIFY = "reclassify"
MODE_REFETCH = "refetch"

WorkItem = namedtuple("WorkItem", "name work priority row")


class PreconditionFailure(Exception):
    """Raised when the rebuild is asked to run out of order. See check_preconditions."""


def _parse_ts(value):
    """Parse a Postgres timestamptz string into an aware datetime, or None."""
    if value is None:
        return None
    if isinstance(value, _dt.datetime):
        return value if value.tzinfo else value.replace(tzinfo=_dt.timezone.utc)
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = _dt.datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=_dt.timezone.utc)


def _backfill_view(row):
    """Project a PRE-migration row into its POST-migration shape.

    Mirrors the backfill in
    supabase/migrations/20260820120000_le_wikidata_cache_staleness.sql exactly,
    so `--dry-run` against today's schema reports the true post-migration work
    set instead of calling every single row a refetch. Columns that already
    exist are never overwritten, so this is a no-op once the migration lands.

    An empty-string description backfills to `unknown`, not `ok`: we cannot tell
    whether it came from a real entity with no English description or from a
    partial response, and 276 rows at the paced interval is 24 minutes of work,
    which is not worth guessing over.
    """
    if row.get("fetch_status") and row.get("classifier_version"):
        return row
    projected = dict(row)
    projected.setdefault("classifier_version", None)
    if not projected.get("classifier_version"):
        projected["classifier_version"] = LEGACY_CLASSIFIER_VERSION
    if not projected.get("fetch_status"):
        description = projected.get("wikidata_description")
        projected["fetch_status"] = (
            FETCH_STATUS_OK if description else FETCH_STATUS_UNKNOWN
        )
    return projected


def row_work(row, current_version, *, max_age_days=DEFAULT_MAX_AGE_DAYS, now=None):
    """Classify one cache row into the work it needs.

    Returns WORK_REFETCH (needs a network call), WORK_RECLASSIFY (local only) or
    WORK_NONE. Refetch dominates, because a refetch re-classifies as a side
    effect.

    A row needs a refetch when we do not have a description we are entitled to
    believe:
      * fetch_status is unknown or error, so the stored NULL is not an answer
      * the description is NULL and the status does not positively say `absent`
      * the row is older than the TTL
    A row needs a reclassify when the description is trustworthy but the verdict
    was produced by a different classifier.
    """
    status = row.get("fetch_status") or FETCH_STATUS_UNKNOWN
    description = row.get("wikidata_description")

    if status in (FETCH_STATUS_UNKNOWN, FETCH_STATUS_ERROR):
        return WORK_REFETCH
    if description is None and status != FETCH_STATUS_ABSENT:
        return WORK_REFETCH

    if max_age_days:
        now = now or _dt.datetime.now(_dt.timezone.utc)
        stamp = _parse_ts(row.get("last_refetch_at")) or _parse_ts(row.get("checked_at"))
        if stamp is None or (now - stamp).days >= max_age_days:
            return WORK_REFETCH

    if (row.get("classifier_version") or LEGACY_CLASSIFIER_VERSION) != current_version:
        return WORK_RECLASSIFY

    return WORK_NONE


def plan(rows, current_version, *, hot_names=None, max_age_days=DEFAULT_MAX_AGE_DAYS,
         now=None, limit=None):
    """Order the work set. Deterministic, so a restart resumes at the same place.

    `hot_names` maps a name to its usage weight (mention count as
    articles.primary_company). 15,561 of the 16,632 distinct primary_company
    values are in this cache and 11,907 of those need a refetch, so ordering by
    usage front-loads essentially all of the user-visible value: after one hour
    of tier 2 the ~692 most-mentioned names are done.

    Tier 1 always sorts ahead of tier 2. It is free and it is the tier that
    makes a classifier fix reach production.
    """
    hot_names = hot_names or {}
    items = []
    for raw in rows:
        row = _backfill_view(raw)
        work = row_work(row, current_version, max_age_days=max_age_days, now=now)
        if work is WORK_NONE:
            continue
        name = row.get("name") or ""
        items.append(WorkItem(name=name, work=work, priority=int(hot_names.get(name, 0)),
                              row=row))
    # Stable and total: tier first, then usage weight descending, then name.
    # The name tiebreak is what makes a restart replay the same order.
    items.sort(key=lambda it: (0 if it.work == WORK_RECLASSIFY else 1, -it.priority, it.name))
    return items[:limit] if limit else items


def build_update(row, work, current_version, *, outcome=None, description=None, now=None):
    """Return the PostgREST update payload for exactly one row.

    The non-destructive guarantee lives here, and it is narrower than "a row is
    never blanked". Precisely: a row is never blanked by an outcome that is not
    an answer. On FETCH_STATUS_ERROR and FETCH_STATUS_UNKNOWN the payload
    carries only the status and the attempt timestamp. It does not carry
    wikidata_description, is_company or classifier_version, so a throttled or
    dying rebuild cannot blank a good row, and the row stays in the work set for
    the next run.

    FETCH_STATUS_ABSENT does write a NULL description, deliberately, because it
    is an answer: Wikidata was reached and has no entry. That branch is the only
    one that can clear a description, and map_fetch_status guarantees nothing
    reaches it except a fetcher that positively proved absence.
    """
    now = now or _dt.datetime.now(_dt.timezone.utc)
    stamp = now.isoformat()
    name = row.get("name") or ""

    if work == WORK_RECLASSIFY:
        # No fetch happened, so checked_at is deliberately NOT touched.
        # checked_at means "when we last asked Wikidata", and we did not ask.
        return {
            "is_company": wikidata._classify(row.get("wikidata_description"), name),
            "classifier_version": current_version,
        }

    # Both non-answers take the same non-destructive shape. ERROR is "we never
    # reached Wikidata"; UNKNOWN is "Wikidata answered and we could not read the
    # answer as either a description or a proven absence", which is where lane
    # D's `no_result` lands. Neither is grounds for touching a stored verdict.
    if outcome in (FETCH_STATUS_ERROR, FETCH_STATUS_UNKNOWN):
        return {"fetch_status": outcome, "last_refetch_at": stamp}

    if outcome == FETCH_STATUS_OK:
        return {
            "wikidata_description": description,
            "is_company": wikidata._classify(description, name),
            "classifier_version": current_version,
            "fetch_status": FETCH_STATUS_OK,
            "last_refetch_at": stamp,
            "checked_at": stamp,
        }

    if outcome == FETCH_STATUS_ABSENT:
        return {
            "wikidata_description": None,
            "is_company": wikidata._classify(None, name),
            "classifier_version": current_version,
            "fetch_status": FETCH_STATUS_ABSENT,
            "last_refetch_at": stamp,
            "checked_at": stamp,
        }

    raise ValueError(f"unknown fetch outcome {outcome!r} for {name!r}")


def estimate_seconds(n_refetch, *, interval_s=REQUIRED_MIN_INTERVAL_S):
    """Wall clock for the network tier. Tier 1 is not counted; it is local."""
    return max(0, n_refetch) * interval_s


def format_wall_clock(seconds):
    hours = seconds / 3600.0
    return f"{hours:.2f} h ({seconds / 60.0:.0f} min)"


# ---------------------------------------------------------------------------
# SEQUENCING. C, THEN D, THEN E.
# ---------------------------------------------------------------------------
# This rebuild is lane E and it must run LAST.
#
#   LANE C, resolver widening and index merge, deploys FIRST. The rebuild
#   recovers names the entity gate is currently dropping, and every recovered
#   name goes through resolve_entity. Without the widened resolver, about 60% of
#   those recoveries land as duplicate companies rows.
#
#   LANE D, the 429 fetch fix, deploys SECOND. Rebuilding into a throttled
#   fetcher re-poisons the cache with exactly the same NULLs, at scale, and
#   burns the budget doing it.
#
#   LANE E, this rebuild, runs THIRD.
#
# The checks below make the wrong order structurally hard rather than a comment
# somebody skims. Each lane publishes a contract dict in its own module and this
# refuses to proceed until the contract says the lane shipped.
def check_preconditions(mode, *, resolver_contract=None, fetch_contract=None,
                        lane_c_sha_verified=False):
    """Return the list of satisfied gate names, or raise PreconditionFailure.

    Gate scope by mode:
      dry_run     no gates. Zero writes, zero fetches, always runnable.
      reclassify  LANE C only. Tier 1 makes no network call, but it does produce
                  recoveries that hit the resolver, so it needs the widened
                  resolver and nothing else.
      refetch     LANE C and LANE D and PACING.

    LANE C accepts a human attestation: --lane-c-sha. The CLI verifies it
    against the RUNNING TREE, not against a remote branch: lane C's resolution
    capability must be importable here, and the sha must be an ancestor of HEAD.
    An earlier version checked only ancestry of origin/main, which every commit
    in the repository satisfies, including the root commit. A sha on its own is
    now rejected.

    LANE D has NO override, on purpose. Without `reports_http_status` the
    fetcher cannot tell a 429 from a genuine absence, so the rebuild would
    rewrite `unknown` into `absent`, turning "we do not know" into a fabricated
    negative across up to 18,732 rows. That is a worse outcome than doing
    nothing, and an attestation cannot substitute for the fetcher actually
    reporting what happened.
    """
    if mode == MODE_DRY_RUN:
        return ["DRY_RUN: no gates, zero writes, zero fetches"]

    passed = []

    contract = resolver_contract or {}
    lane_c_ok = (contract.get("version", 0) >= 2
                 and contract.get("widened") is True
                 and contract.get("index_merged") is True)
    if lane_c_ok:
        passed.append(f"LANE_C: entity_resolver.RESOLVER_CONTRACT v{contract.get('version')}")
    elif lane_c_sha_verified:
        passed.append("LANE_C: attested by a merged --lane-c-sha")
    else:
        raise PreconditionFailure(
            "LANE C IS NOT DEPLOYED. Order is C, then D, then E.\n"
            f"  entity_resolver.RESOLVER_CONTRACT = {contract!r}\n"
            "  Needs version >= 2 with widened=True and index_merged=True.\n"
            "  Why: this rebuild recovers names the entity gate drops today, and\n"
            "  every recovery goes through resolve_entity. Without the widened\n"
            "  resolver and the merged index, about 60% of those recoveries land\n"
            "  as duplicate companies rows, which is harder to unwind than the\n"
            "  problem being fixed.\n"
            "  Override only if lane C shipped under a different marker:\n"
            "    --lane-c-sha <sha merged into origin/main>"
        )

    if mode == MODE_RECLASSIFY:
        passed.append("LANE_D: not required, tier 1 makes zero network calls")
        return passed

    fetch = fetch_contract or {}
    problems = []
    if fetch.get("version", 0) < 2:
        problems.append(f"version is {fetch.get('version')!r}, needs >= 2")
    if fetch.get("honors_retry_after") is not True:
        problems.append("honors_retry_after is not True")
    if fetch.get("reports_http_status") is not True:
        problems.append("reports_http_status is not True")
    if problems:
        raise PreconditionFailure(
            "LANE D IS NOT DEPLOYED. Order is C, then D, then E. NO OVERRIDE.\n"
            f"  wikidata.FETCH_CONTRACT = {fetch!r}\n"
            "  Failing: " + "; ".join(problems) + "\n"
            "  Why: rebuilding into a throttled fetcher re-poisons the cache with\n"
            "  exactly the same NULLs, at scale, and burns the budget doing it.\n"
            "  76.34% of rows are already NULL for this reason. Worse, without\n"
            "  reports_http_status a 429 is indistinguishable from a genuine\n"
            "  absence, so the rebuild would write a fabricated negative over up\n"
            "  to 18,732 rows. There is deliberately no flag to skip this."
        )
    passed.append(f"LANE_D: wikidata.FETCH_CONTRACT v{fetch.get('version')}")

    declared = fetch.get("min_interval_s")
    if declared is None or float(declared) < REQUIRED_MIN_INTERVAL_S:
        raise PreconditionFailure(
            "PACING BELOW THE MEASURED BUDGET. NO OVERRIDE.\n"
            f"  FETCH_CONTRACT['min_interval_s'] = {declared!r}\n"
            f"  Needs >= {REQUIRED_MIN_INTERVAL_S:.2f} s, from the measured budget of\n"
            f"  {MEASURED_CALLS_PER_WINDOW} calls per {MEASURED_WINDOW_S:.0f} s."
        )
    passed.append(f"PACING: {float(declared):.2f}s >= {REQUIRED_MIN_INTERVAL_S:.2f}s required")
    return passed


def run_rebuild(items, current_version, *, fetch_fn, write_fn, sleep_fn=None,
                interval_s=REQUIRED_MIN_INTERVAL_S, now_fn=None, max_calls=None,
                on_progress=None):
    """Execute a planned work set, one row at a time, committing as it goes.

    `fetch_fn(name)` must return `(outcome, description)`. The outcome may be
    one of this module's FETCH_STATUS_* values or one of lane D's status words;
    it is normalised through map_fetch_status here, which is the single choke
    point where a fetcher's vocabulary becomes this module's. Doing it here and
    not in the caller means no adapter can quietly invent an `absent`.
    fetch_fn is injected rather than imported so the tests run fully offline and
    so lane D owns the real implementation.

    `max_calls` is a hard cap on outbound Wikidata calls for one invocation.
    Reaching it stops the run cleanly; the untouched rows stay in the work set.

    Returns a counters dict. Every counter is derived from writes that actually
    happened, so a partial run reports what it really did.
    """
    sleep_fn = sleep_fn or (lambda _s: None)
    now_fn = now_fn or (lambda: _dt.datetime.now(_dt.timezone.utc))
    counts = {"reclassified": 0, "refetched_ok": 0, "refetched_absent": 0,
              "refetched_unknown": 0, "fetch_errors": 0, "calls": 0,
              "skipped_cap": 0, "write_errors": 0}
    first_call = True

    for item in items:
        if item.work == WORK_RECLASSIFY:
            payload = build_update(item.row, WORK_RECLASSIFY, current_version, now=now_fn())
            try:
                write_fn(item.name, payload)
                counts["reclassified"] += 1
            except Exception as ex:  # a write failure must not abort the run
                counts["write_errors"] += 1
                print(f"  cache write error [{item.name!r}]: {ex}")
            if on_progress:
                on_progress(item, counts)
            continue

        if max_calls is not None and counts["calls"] >= max_calls:
            counts["skipped_cap"] += 1
            continue

        # Pace BEFORE the call, never after, so an interruption cannot leave the
        # next run believing it already waited.
        if not first_call:
            sleep_fn(interval_s)
        first_call = False
        counts["calls"] += 1
        raw_outcome, description = fetch_fn(item.name)
        outcome = map_fetch_status(raw_outcome)
        if outcome != FETCH_STATUS_OK:
            # A non-OK outcome carries no description worth storing, and letting
            # one through would reopen the blanking path from the other side.
            description = None

        payload = build_update(item.row, WORK_REFETCH, current_version,
                               outcome=outcome, description=description, now=now_fn())
        try:
            write_fn(item.name, payload)
        except Exception as ex:
            counts["write_errors"] += 1
            print(f"  cache write error [{item.name!r}]: {ex}")
            if on_progress:
                on_progress(item, counts)
            continue

        if outcome == FETCH_STATUS_OK:
            counts["refetched_ok"] += 1
        elif outcome == FETCH_STATUS_ABSENT:
            counts["refetched_absent"] += 1
        elif outcome == FETCH_STATUS_UNKNOWN:
            counts["refetched_unknown"] += 1
        else:
            counts["fetch_errors"] += 1
        if on_progress:
            on_progress(item, counts)

    return counts


def summarize(items):
    """Counts and projected wall clock for a planned work set."""
    refetch = sum(1 for it in items if it.work == WORK_REFETCH)
    reclassify = sum(1 for it in items if it.work == WORK_RECLASSIFY)
    seconds = estimate_seconds(refetch)
    return {
        "total": len(items),
        "reclassify": reclassify,
        "refetch": refetch,
        "network_seconds": seconds,
        "network_wall_clock": format_wall_clock(seconds),
    }
