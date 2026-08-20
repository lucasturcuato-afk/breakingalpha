"""
Unit tests for the wikidata_entity_cache TTL and invalidation mechanism.

Offline. No network, no Supabase, no Gemini. Every fetch is an injected fake.

The four things these have to prove, because each maps to a way the cache has
already failed or could fail:

  1. a stale-by-version row is recognised. This is the Coinbase failure: PR #358
     shipped the fix on 2026-06-13 and it has been inert for 68 days because
     is_valid_company returns from the cache branch without re-classifying.
  2. a NULL-description row is recognised. 18,732 of 24,537 live rows (76.34%)
     are NULL because the fetcher swallowed HTTP 429 and stored the result
     permanently.
  3. resumability. A rebuild that dies halfway must not leave the cache worse
     than it started.
  4. the wrong-order refusal. C, then D, then E.
"""
import datetime as dt
import unittest

from backend import wikidata
from backend import wikidata_cache_rebuild as R

NOW = dt.datetime(2026, 8, 20, 12, 0, 0, tzinfo=dt.timezone.utc)
CURRENT = "v1-currentclassifier"


def _row(name="Acme", description="an american company", is_company=True,
         classifier_version=CURRENT, fetch_status=R.FETCH_STATUS_OK,
         checked_at="2026-08-01T00:00:00+00:00", last_refetch_at=None):
    return {
        "name": name,
        "wikidata_description": description,
        "is_company": is_company,
        "classifier_version": classifier_version,
        "fetch_status": fetch_status,
        "checked_at": checked_at,
        "last_refetch_at": last_refetch_at,
    }


# ---------------------------------------------------------------------------
# 1. STALE BY CLASSIFIER VERSION
# ---------------------------------------------------------------------------
class StaleByVersionTest(unittest.TestCase):

    def test_row_stamped_by_an_older_classifier_is_stale(self):
        row = _row(classifier_version="v1-oldclassifier")
        self.assertEqual(R.row_work(row, CURRENT, now=NOW), R.WORK_RECLASSIFY)

    def test_row_stamped_by_the_current_classifier_needs_nothing(self):
        row = _row(classifier_version=CURRENT)
        self.assertIs(R.row_work(row, CURRENT, now=NOW), R.WORK_NONE)

    def test_legacy_stamp_is_stale(self):
        row = _row(classifier_version=R.LEGACY_CLASSIFIER_VERSION)
        self.assertEqual(R.row_work(row, CURRENT, now=NOW), R.WORK_RECLASSIFY)

    def test_missing_stamp_is_treated_as_legacy_and_is_stale(self):
        row = _row(classifier_version=None)
        self.assertEqual(R.row_work(row, CURRENT, now=NOW), R.WORK_RECLASSIFY)

    def test_reclassify_needs_zero_network_and_rewrites_the_verdict(self):
        """The live Coinbase row, verbatim. Cached False on 2026-04-13; today's
        classifier returns True on that exact description."""
        row = _row(name="Coinbase", is_company=False,
                   description="american company that operates a cryptocurrency "
                               "exchange platform",
                   classifier_version=R.LEGACY_CLASSIFIER_VERSION,
                   checked_at="2026-04-13T00:01:09+00:00")
        self.assertEqual(R.row_work(row, CURRENT, now=NOW), R.WORK_RECLASSIFY)
        payload = R.build_update(row, R.WORK_RECLASSIFY, CURRENT, now=NOW)
        self.assertIs(payload["is_company"], True)
        self.assertEqual(payload["classifier_version"], CURRENT)

    def test_reclassify_does_not_advance_checked_at(self):
        """checked_at means 'when we last asked Wikidata'. A local re-classify
        did not ask, so it must not fake freshness."""
        payload = R.build_update(_row(classifier_version="old"), R.WORK_RECLASSIFY,
                                 CURRENT, now=NOW)
        self.assertNotIn("checked_at", payload)
        self.assertNotIn("last_refetch_at", payload)
        self.assertNotIn("wikidata_description", payload)

    def test_classifier_version_is_stable_across_calls(self):
        self.assertEqual(wikidata.classifier_version(), wikidata.classifier_version())
        self.assertTrue(wikidata.classifier_version().startswith(
            f"v{wikidata.CLASSIFIER_EPOCH}-"))

    def test_changing_a_keyword_list_changes_the_version(self):
        """Without this, every future classifier fix repeats the Coinbase failure."""
        original = list(wikidata._KEEP_DESCRIPTION_KEYWORDS)
        cached = wikidata._CLASSIFIER_VERSION_CACHE
        try:
            wikidata._CLASSIFIER_VERSION_CACHE = None
            before = wikidata.classifier_version()
            wikidata._KEEP_DESCRIPTION_KEYWORDS.append("cryptocurrency exchange")
            wikidata._CLASSIFIER_VERSION_CACHE = None
            after = wikidata.classifier_version()
            self.assertNotEqual(before, after)
        finally:
            wikidata._KEEP_DESCRIPTION_KEYWORDS[:] = original
            wikidata._CLASSIFIER_VERSION_CACHE = cached

    def test_epoch_bump_changes_the_version(self):
        original = wikidata.CLASSIFIER_EPOCH
        cached = wikidata._CLASSIFIER_VERSION_CACHE
        try:
            wikidata._CLASSIFIER_VERSION_CACHE = None
            before = wikidata.classifier_version()
            wikidata.CLASSIFIER_EPOCH = original + 1
            wikidata._CLASSIFIER_VERSION_CACHE = None
            self.assertNotEqual(before, wikidata.classifier_version())
        finally:
            wikidata.CLASSIFIER_EPOCH = original
            wikidata._CLASSIFIER_VERSION_CACHE = cached

    def test_logic_fingerprint_is_available(self):
        """A sentinel here would mean structural classifier changes go undetected."""
        self.assertNotEqual(wikidata._classify_logic_fingerprint(), "unavailable")


# ---------------------------------------------------------------------------
# 2. NULL DESCRIPTION ROWS, THE POISONED 76.34%
# ---------------------------------------------------------------------------
class NullDescriptionTest(unittest.TestCase):

    def test_unknown_status_needs_a_refetch(self):
        row = _row(description=None, is_company=None,
                   fetch_status=R.FETCH_STATUS_UNKNOWN)
        self.assertEqual(R.row_work(row, CURRENT, now=NOW), R.WORK_REFETCH)

    def test_error_status_needs_a_refetch_even_with_a_description(self):
        row = _row(fetch_status=R.FETCH_STATUS_ERROR)
        self.assertEqual(R.row_work(row, CURRENT, now=NOW), R.WORK_REFETCH)

    def test_null_description_without_a_positive_absent_needs_a_refetch(self):
        row = _row(description=None, fetch_status=None)
        self.assertEqual(R.row_work(row, CURRENT, now=NOW), R.WORK_REFETCH)

    def test_a_genuine_absent_is_a_real_answer_and_is_not_refetched(self):
        row = _row(description=None, is_company=None,
                   fetch_status=R.FETCH_STATUS_ABSENT)
        self.assertIs(R.row_work(row, CURRENT, now=NOW), R.WORK_NONE)

    def test_refetch_dominates_a_version_mismatch(self):
        row = _row(description=None, fetch_status=R.FETCH_STATUS_UNKNOWN,
                   classifier_version="v1-old")
        self.assertEqual(R.row_work(row, CURRENT, now=NOW), R.WORK_REFETCH)

    def test_pre_migration_rows_project_onto_the_migration_backfill(self):
        """A live row today has none of the three new columns. The dry run must
        still separate the 5,529 rows that hold a description from the 19,008
        that do not, or the projected cost is meaningless."""
        with_desc = R._backfill_view({"name": "Tata Consultancy Services",
                                      "wikidata_description": "it consulting company",
                                      "is_company": True,
                                      "checked_at": "2026-04-12T23:35:29+00:00"})
        self.assertEqual(with_desc["fetch_status"], R.FETCH_STATUS_OK)
        self.assertEqual(with_desc["classifier_version"], R.LEGACY_CLASSIFIER_VERSION)

        without = R._backfill_view({"name": "Constellium SE",
                                    "wikidata_description": None, "is_company": None,
                                    "checked_at": "2026-06-02T03:33:13+00:00"})
        self.assertEqual(without["fetch_status"], R.FETCH_STATUS_UNKNOWN)

        empty = R._backfill_view({"name": "Whatever", "wikidata_description": "",
                                  "is_company": None,
                                  "checked_at": "2026-06-02T03:33:13+00:00"})
        self.assertEqual(empty["fetch_status"], R.FETCH_STATUS_UNKNOWN)

    def test_backfill_view_never_overwrites_real_columns(self):
        row = _row(classifier_version="v9-real", fetch_status=R.FETCH_STATUS_ABSENT)
        self.assertEqual(R._backfill_view(row), row)

    def test_ttl_expires_a_trusted_but_ancient_description(self):
        """The cached top hit for GM is 'sovereign state in west africa'.
        Descriptions go stale, so trusted rows still age out."""
        old = _row(name="GM", description="sovereign state in west africa",
                   is_company=False, checked_at="2026-01-01T00:00:00+00:00")
        self.assertEqual(R.row_work(old, CURRENT, max_age_days=180, now=NOW),
                         R.WORK_REFETCH)
        self.assertIs(R.row_work(old, CURRENT, max_age_days=0, now=NOW), R.WORK_NONE)

    def test_ttl_uses_last_refetch_at_when_present(self):
        row = _row(checked_at="2026-01-01T00:00:00+00:00",
                   last_refetch_at="2026-08-19T00:00:00+00:00")
        self.assertIs(R.row_work(row, CURRENT, max_age_days=180, now=NOW), R.WORK_NONE)


# ---------------------------------------------------------------------------
# 3. RESUMABILITY AND INTERRUPTION SAFETY
# ---------------------------------------------------------------------------
class _FakeCache:
    """In-memory stand-in for the table. Records every write."""

    def __init__(self, rows):
        self.rows = {r["name"]: dict(r) for r in rows}
        self.writes = []
        self.fail_on = set()

    def write(self, name, payload):
        if name in self.fail_on:
            raise RuntimeError("simulated PostgREST failure")
        self.writes.append((name, dict(payload)))
        self.rows[name].update(payload)

    def snapshot(self):
        return {n: dict(r) for n, r in self.rows.items()}


class ResumabilityTest(unittest.TestCase):

    def _cache(self):
        return _FakeCache([
            _row("Alpha", None, None, "legacy", R.FETCH_STATUS_UNKNOWN),
            _row("Bravo", None, None, "legacy", R.FETCH_STATUS_UNKNOWN),
            _row("Charlie", None, None, "legacy", R.FETCH_STATUS_UNKNOWN),
            _row("Delta", None, None, "legacy", R.FETCH_STATUS_UNKNOWN),
        ])

    def test_a_run_stopped_by_the_call_cap_resumes_and_completes(self):
        cache = self._cache()

        def fetch(name):
            return R.FETCH_STATUS_OK, f"{name} is an american company"

        first = R.plan(list(cache.rows.values()), CURRENT)
        self.assertEqual(len(first), 4)
        c1 = R.run_rebuild(first, CURRENT, fetch_fn=fetch, write_fn=cache.write,
                           max_calls=2, now_fn=lambda: NOW)
        self.assertEqual(c1["calls"], 2)
        self.assertEqual(c1["refetched_ok"], 2)
        self.assertEqual(c1["skipped_cap"], 2)

        # Resume purely from the rows. No cursor was carried across.
        second = R.plan(list(cache.rows.values()), CURRENT)
        self.assertEqual(len(second), 2)
        c2 = R.run_rebuild(second, CURRENT, fetch_fn=fetch, write_fn=cache.write,
                           now_fn=lambda: NOW)
        self.assertEqual(c2["refetched_ok"], 2)

        # Third pass has nothing left to do.
        self.assertEqual(R.plan(list(cache.rows.values()), CURRENT), [])

    def test_the_resume_set_shrinks_monotonically(self):
        cache = self._cache()
        sizes = []
        for _ in range(4):
            todo = R.plan(list(cache.rows.values()), CURRENT)
            sizes.append(len(todo))
            if not todo:
                break
            R.run_rebuild(todo, CURRENT,
                          fetch_fn=lambda n: (R.FETCH_STATUS_OK, "an american company"),
                          write_fn=cache.write, max_calls=1, now_fn=lambda: NOW)
        self.assertEqual(sizes, [4, 3, 2, 1])

    def test_a_fetch_error_never_blanks_a_good_row(self):
        """The single most important interruption guarantee. This is exactly the
        failure the current is_valid_company write path has: it upserts
        description=None on error, which is how 18,732 rows got poisoned."""
        cache = _FakeCache([_row("Coinbase",
                                 "american company that operates a cryptocurrency "
                                 "exchange platform",
                                 False, "legacy", R.FETCH_STATUS_ERROR)])
        before = cache.snapshot()
        items = R.plan(list(cache.rows.values()), CURRENT)
        counts = R.run_rebuild(items, CURRENT,
                               fetch_fn=lambda n: (R.FETCH_STATUS_ERROR, None),
                               write_fn=cache.write, now_fn=lambda: NOW)
        self.assertEqual(counts["fetch_errors"], 1)
        after = cache.rows["Coinbase"]
        self.assertEqual(after["wikidata_description"],
                         before["Coinbase"]["wikidata_description"])
        self.assertIs(after["is_company"], before["Coinbase"]["is_company"])
        self.assertEqual(after["classifier_version"], R.LEGACY_CLASSIFIER_VERSION)
        # And it stays in the work set, so the next run retries it.
        self.assertEqual(len(R.plan(list(cache.rows.values()), CURRENT)), 1)

    def test_the_error_payload_carries_only_status_and_attempt_time(self):
        payload = R.build_update(_row(), R.WORK_REFETCH, CURRENT,
                                 outcome=R.FETCH_STATUS_ERROR, now=NOW)
        self.assertEqual(set(payload), {"fetch_status", "last_refetch_at"})

    def test_a_write_failure_does_not_abort_the_run(self):
        cache = self._cache()
        cache.fail_on = {"Bravo"}
        items = R.plan(list(cache.rows.values()), CURRENT)
        counts = R.run_rebuild(items, CURRENT,
                               fetch_fn=lambda n: (R.FETCH_STATUS_OK, "an american company"),
                               write_fn=cache.write, now_fn=lambda: NOW)
        self.assertEqual(counts["write_errors"], 1)
        self.assertEqual(counts["refetched_ok"], 3)
        self.assertEqual(len(R.plan(list(cache.rows.values()), CURRENT)), 1)

    def test_plan_order_is_deterministic_so_a_restart_replays_it(self):
        rows = [_row(n, None, None, "legacy", R.FETCH_STATUS_UNKNOWN)
                for n in ("Zulu", "Alpha", "Mike")]
        a = [it.name for it in R.plan(rows, CURRENT)]
        b = [it.name for it in R.plan(list(reversed(rows)), CURRENT)]
        self.assertEqual(a, b)

    def test_free_tier_1_sorts_ahead_of_paid_tier_2(self):
        rows = [
            _row("NeedsFetch", None, None, "legacy", R.FETCH_STATUS_UNKNOWN),
            _row("NeedsReclassify", "an american company", False, "legacy",
                 R.FETCH_STATUS_OK),
        ]
        items = R.plan(rows, CURRENT)
        self.assertEqual([it.work for it in items],
                         [R.WORK_RECLASSIFY, R.WORK_REFETCH])

    def test_hot_names_are_refetched_first(self):
        rows = [_row(n, None, None, "legacy", R.FETCH_STATUS_UNKNOWN)
                for n in ("Aardvark", "Coinbase", "Zebra")]
        items = R.plan(rows, CURRENT, hot_names={"Coinbase": 202, "Zebra": 5})
        self.assertEqual([it.name for it in items], ["Coinbase", "Zebra", "Aardvark"])

    def test_no_row_is_written_more_than_once_per_pass(self):
        cache = self._cache()
        items = R.plan(list(cache.rows.values()), CURRENT)
        R.run_rebuild(items, CURRENT,
                      fetch_fn=lambda n: (R.FETCH_STATUS_OK, "an american company"),
                      write_fn=cache.write, now_fn=lambda: NOW)
        names = [n for n, _ in cache.writes]
        self.assertEqual(len(names), len(set(names)))


# ---------------------------------------------------------------------------
# 4. THE WRONG ORDER REFUSAL. C, THEN D, THEN E.
# ---------------------------------------------------------------------------
LANE_C_SHIPPED = {"version": 2, "widened": True, "index_merged": True}
LANE_D_SHIPPED = {"version": 2, "min_interval_s": 5.2,
                  "honors_retry_after": True, "reports_http_status": True}


class WrongOrderRefusalTest(unittest.TestCase):

    def test_todays_repo_state_refuses_a_refetch(self):
        """The contracts as they actually stand on this branch. If this ever
        stops raising without lanes C and D landing, the gate is broken."""
        from backend import entity_resolver
        with self.assertRaises(R.PreconditionFailure):
            R.check_preconditions(R.MODE_REFETCH,
                                  resolver_contract=entity_resolver.RESOLVER_CONTRACT,
                                  fetch_contract=wikidata.FETCH_CONTRACT)

    def test_todays_repo_state_refuses_a_reclassify(self):
        from backend import entity_resolver
        with self.assertRaises(R.PreconditionFailure) as ctx:
            R.check_preconditions(R.MODE_RECLASSIFY,
                                  resolver_contract=entity_resolver.RESOLVER_CONTRACT,
                                  fetch_contract=wikidata.FETCH_CONTRACT)
        self.assertIn("LANE C IS NOT DEPLOYED", str(ctx.exception))

    def test_lane_d_alone_is_not_enough_c_comes_first(self):
        with self.assertRaises(R.PreconditionFailure) as ctx:
            R.check_preconditions(R.MODE_REFETCH,
                                  resolver_contract={"version": 1, "widened": False,
                                                     "index_merged": False},
                                  fetch_contract=LANE_D_SHIPPED)
        self.assertIn("LANE C IS NOT DEPLOYED", str(ctx.exception))
        self.assertIn("duplicate companies rows", str(ctx.exception))

    def test_lane_c_alone_is_not_enough_for_a_refetch(self):
        with self.assertRaises(R.PreconditionFailure) as ctx:
            R.check_preconditions(R.MODE_REFETCH,
                                  resolver_contract=LANE_C_SHIPPED,
                                  fetch_contract=wikidata.FETCH_CONTRACT)
        self.assertIn("LANE D IS NOT DEPLOYED", str(ctx.exception))
        self.assertIn("NO OVERRIDE", str(ctx.exception))

    def test_lane_c_alone_is_enough_for_a_zero_network_reclassify(self):
        passed = R.check_preconditions(R.MODE_RECLASSIFY,
                                       resolver_contract=LANE_C_SHIPPED,
                                       fetch_contract=wikidata.FETCH_CONTRACT)
        self.assertTrue(any("LANE_C" in p for p in passed))

    def test_a_merged_lane_c_sha_attests_lane_c_but_never_lane_d(self):
        passed = R.check_preconditions(R.MODE_RECLASSIFY, resolver_contract=None,
                                       lane_c_sha_verified=True)
        self.assertTrue(any("attested" in p for p in passed))
        with self.assertRaises(R.PreconditionFailure) as ctx:
            R.check_preconditions(R.MODE_REFETCH, resolver_contract=None,
                                  fetch_contract=wikidata.FETCH_CONTRACT,
                                  lane_c_sha_verified=True)
        self.assertIn("LANE D IS NOT DEPLOYED", str(ctx.exception))

    def test_a_fetcher_that_hides_http_status_is_refused(self):
        """Without this the rebuild would rewrite 'unknown' as 'absent', turning
        'we do not know' into a fabricated negative across 18,732 rows."""
        contract = dict(LANE_D_SHIPPED, reports_http_status=False)
        with self.assertRaises(R.PreconditionFailure) as ctx:
            R.check_preconditions(R.MODE_REFETCH, resolver_contract=LANE_C_SHIPPED,
                                  fetch_contract=contract)
        self.assertIn("reports_http_status is not True", str(ctx.exception))

    def test_a_fetcher_that_ignores_retry_after_is_refused(self):
        contract = dict(LANE_D_SHIPPED, honors_retry_after=False)
        with self.assertRaises(R.PreconditionFailure):
            R.check_preconditions(R.MODE_REFETCH, resolver_contract=LANE_C_SHIPPED,
                                  fetch_contract=contract)

    def test_pacing_below_the_measured_budget_is_refused(self):
        """The current 0.15 s is 400 calls/min against a measured 10 to 11 per
        52 s. A lane D that ships everything else but keeps that pacing still
        cannot run."""
        contract = dict(LANE_D_SHIPPED, min_interval_s=wikidata._REQUEST_DELAY)
        with self.assertRaises(R.PreconditionFailure) as ctx:
            R.check_preconditions(R.MODE_REFETCH, resolver_contract=LANE_C_SHIPPED,
                                  fetch_contract=contract)
        self.assertIn("PACING BELOW THE MEASURED BUDGET", str(ctx.exception))

    def test_both_lanes_shipped_passes(self):
        passed = R.check_preconditions(R.MODE_REFETCH, resolver_contract=LANE_C_SHIPPED,
                                       fetch_contract=LANE_D_SHIPPED)
        self.assertTrue(any("LANE_C" in p for p in passed))
        self.assertTrue(any("LANE_D" in p for p in passed))
        self.assertTrue(any("PACING" in p for p in passed))

    def test_a_dry_run_needs_no_lanes_at_all(self):
        self.assertTrue(R.check_preconditions(R.MODE_DRY_RUN))

    def test_the_required_interval_matches_the_measured_budget(self):
        self.assertAlmostEqual(R.REQUIRED_MIN_INTERVAL_S, 5.2, places=4)


class CostEstimateTest(unittest.TestCase):

    def test_full_rebuild_wall_clock(self):
        """24,537 rows at 10 calls per 52 s is 35.44 hours, not 37."""
        self.assertAlmostEqual(R.estimate_seconds(24537) / 3600.0, 35.44, places=2)

    def test_null_only_rebuild_wall_clock(self):
        """19,008 unknown-status rows (18,732 NULL plus 276 empty string)."""
        self.assertAlmostEqual(R.estimate_seconds(19008) / 3600.0, 27.46, places=2)

    def test_prioritised_rebuild_wall_clock(self):
        """11,907 rows needing a refetch that are used as articles.primary_company.
        Measured by scripts/rebuild_wikidata_cache.py --dry-run on 2026-08-20."""
        self.assertAlmostEqual(R.estimate_seconds(11907) / 3600.0, 17.20, places=2)

    def test_tier_1_costs_no_network_time(self):
        items = R.plan([_row("A", "an american company", False, "legacy",
                             R.FETCH_STATUS_OK)], CURRENT)
        self.assertEqual(R.summarize(items)["network_seconds"], 0)


if __name__ == "__main__":
    unittest.main()
