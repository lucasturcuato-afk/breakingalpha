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
import re
import sys
import unittest
from unittest import mock

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
        """0.15 s is 400 calls/min against a measured 10 to 11 per 52 s. A lane
        D that ships everything else but keeps that pacing still cannot run.

        The literal 0.15, not wikidata._REQUEST_DELAY. This used to read the
        live constant, which silently made the test depend on lane D NOT having
        landed: lane D (#630) redefines _REQUEST_DELAY as
        _RATE_WINDOW_SECONDS / _MAX_CALLS_PER_WINDOW = 6.0 s, which CLEARS the
        5.2 s requirement, so the refusal correctly stops being raised and this
        test failed for a reason that was not a defect. What the test is about
        is the too-fast pacing value, so it names it."""
        contract = dict(LANE_D_SHIPPED, min_interval_s=0.15)
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


# ---------------------------------------------------------------------------
# 5. THE CROSS-LANE STATUS VOCABULARY. no_result IS NOT absent.
# ---------------------------------------------------------------------------
# Lane D emits ('ok', 'no_result', 'failed'). This module reasons in
# ('ok', 'absent', 'error', 'unknown'). Four words, three words, and the
# plausible-looking mapping of the middle one is the one that destroys data.
class StatusVocabularyTest(unittest.TestCase):

    def test_no_result_never_maps_to_absent(self):
        """The single most important mapping in the module. `absent` blanks
        wikidata_description; lane D's `no_result` is a LABEL-CHECK miss, which
        is not a proven absence, so mapping it to `absent` would write a
        fabricated negative over rows that hold a correct description."""
        self.assertEqual(R.map_fetch_status("no_result"), R.FETCH_STATUS_UNKNOWN)
        self.assertNotEqual(R.map_fetch_status("no_result"), R.FETCH_STATUS_ABSENT)

    def test_lane_d_vocabulary_translates(self):
        self.assertEqual(R.map_fetch_status("ok"), R.FETCH_STATUS_OK)
        self.assertEqual(R.map_fetch_status("failed"), R.FETCH_STATUS_ERROR)

    def test_this_modules_own_vocabulary_passes_through(self):
        for status in (R.FETCH_STATUS_OK, R.FETCH_STATUS_ABSENT,
                       R.FETCH_STATUS_ERROR, R.FETCH_STATUS_UNKNOWN):
            self.assertEqual(R.map_fetch_status(status), status)

    def test_an_unrecognised_status_raises_rather_than_guessing(self):
        for bogus in ("throttled", "", None, 429):
            with self.assertRaises(ValueError):
                R.map_fetch_status(bogus)

    def test_only_absent_may_produce_absent(self):
        """Enforced at import too. Restated here so the reason is testable: if a
        later lane tidies a new status word into this table, it must not be
        allowed to reach the one branch that clears a description."""
        sources = {k for k, v in R.FETCHER_STATUS_MAP.items()
                   if v == R.FETCH_STATUS_ABSENT}
        self.assertEqual(sources, {R.FETCH_STATUS_ABSENT})

    def test_a_no_result_does_not_blank_a_good_row(self):
        """End to end through run_rebuild with lane D's raw words. The row is a
        real one from the live cache: 'Allianz SE' carries a correct description
        and is_company=True, and 2,690 live rows are in that shape."""
        good = _row("Allianz SE",
                    "european multinational insurance and financial services corporation",
                    True, "legacy", R.FETCH_STATUS_UNKNOWN)
        cache = _FakeCache([good])
        before = cache.snapshot()["Allianz SE"]
        items = R.plan(list(cache.rows.values()), CURRENT)
        counts = R.run_rebuild(items, CURRENT,
                               fetch_fn=lambda n: ("no_result", None),
                               write_fn=cache.write, now_fn=lambda: NOW)
        after = cache.rows["Allianz SE"]
        self.assertEqual(after["wikidata_description"], before["wikidata_description"])
        self.assertIs(after["is_company"], before["is_company"])
        self.assertEqual(counts["refetched_unknown"], 1)
        self.assertEqual(counts["refetched_absent"], 0)
        # And it stays in the work set rather than being wrongly settled.
        self.assertEqual(len(R.plan(list(cache.rows.values()), CURRENT)), 1)

    def test_a_failed_does_not_blank_a_good_row(self):
        good = _row("Allianz SE", "european multinational insurance company",
                    True, "legacy", R.FETCH_STATUS_UNKNOWN)
        cache = _FakeCache([good])
        counts = R.run_rebuild(R.plan(list(cache.rows.values()), CURRENT), CURRENT,
                               fetch_fn=lambda n: ("failed", None),
                               write_fn=cache.write, now_fn=lambda: NOW)
        self.assertEqual(counts["fetch_errors"], 1)
        self.assertEqual(cache.rows["Allianz SE"]["wikidata_description"],
                         "european multinational insurance company")

    def test_the_unknown_payload_carries_only_status_and_attempt_time(self):
        payload = R.build_update(_row(), R.WORK_REFETCH, CURRENT,
                                 outcome=R.FETCH_STATUS_UNKNOWN, now=NOW)
        self.assertEqual(set(payload), {"fetch_status", "last_refetch_at"})
        self.assertEqual(payload["fetch_status"], R.FETCH_STATUS_UNKNOWN)

    def test_absent_is_the_one_outcome_that_may_clear_a_description(self):
        """Documented, not accidental. The module header used to claim a row is
        NEVER blanked, which was false as stated. This is the true scope."""
        payload = R.build_update(_row(), R.WORK_REFETCH, CURRENT,
                                 outcome=R.FETCH_STATUS_ABSENT, now=NOW)
        self.assertIsNone(payload["wikidata_description"])

    def test_a_non_ok_outcome_cannot_smuggle_a_description_through(self):
        cache = _FakeCache([_row("Acme", "an american company", True, "legacy",
                                 R.FETCH_STATUS_UNKNOWN)])
        R.run_rebuild(R.plan(list(cache.rows.values()), CURRENT), CURRENT,
                      fetch_fn=lambda n: ("failed", "a description that is not an answer"),
                      write_fn=cache.write, now_fn=lambda: NOW)
        self.assertEqual(cache.rows["Acme"]["wikidata_description"], "an american company")


# ---------------------------------------------------------------------------
# 6. THE CONTRACTS DESCRIBE THE CODE, NOT A MEMO ABOUT THE CODE.
# ---------------------------------------------------------------------------
class DerivedContractTest(unittest.TestCase):

    def test_fetch_contract_is_honest_about_todays_broken_fetcher(self):
        contract = wikidata.fetch_contract()
        self.assertEqual(contract["version"], 1)
        self.assertFalse(contract["honors_retry_after"])
        self.assertFalse(contract["reports_http_status"])

    def test_fetch_contract_self_heals_when_a_paced_fetcher_is_present(self):
        """The defect this replaces: both dicts read version 1 after C then D
        then E, because neither C nor D updates them, so --mode refetch refused
        permanently with no override. Worse, honors_retry_after=False and
        reports_http_status=False were then FACTUALLY WRONG about the merged
        fetcher. Deriving the values removes the need for anyone to remember.

        Simulated by injecting exactly the names lane D (#630) defines."""
        with mock.patch.dict(wikidata.__dict__, {
            "_lookup_wikidata": lambda name: ("ok", "x"),
            "STATUS_OK": "ok",
            "STATUS_NO_RESULT": "no_result",
            "STATUS_FAILED": "failed",
            "_parse_retry_after": lambda v: None,
            "_sleep_before_retry": lambda *a: True,
            "_REQUEST_DELAY": 6.0,
        }):
            contract = wikidata.fetch_contract()
        self.assertEqual(contract["version"], 2)
        self.assertTrue(contract["honors_retry_after"])
        self.assertTrue(contract["reports_http_status"])
        self.assertEqual(contract["min_interval_s"], 6.0)
        # And that contract clears the refetch gate with no hand edit anywhere.
        passed = R.check_preconditions(R.MODE_REFETCH, resolver_contract=LANE_C_SHIPPED,
                                       fetch_contract=contract)
        self.assertTrue(any("LANE_D" in p for p in passed))

    def test_resolver_contract_is_honest_about_todays_tree(self):
        from backend import entity_resolver
        contract = entity_resolver.resolver_contract()
        self.assertEqual(contract["version"], 1)
        self.assertFalse(contract["widened"])
        self.assertFalse(contract["index_merged"])

    def test_resolver_contract_self_heals_when_lane_c_is_importable(self):
        """Lane C (#633) ships its widening in backend/company_match.py and does
        not touch entity_resolver.py at all, so a hand-written dict in that file
        would have gone on reporting widened=False forever."""
        from backend import entity_resolver
        fake = mock.Mock()
        fake.token_fold_candidates = lambda *a: set()
        fake.index_tokens = lambda *a: None
        with mock.patch.dict(sys.modules, {"company_match": fake}):
            contract = entity_resolver.resolver_contract()
        self.assertEqual(contract["version"], 2)
        self.assertTrue(contract["widened"])
        self.assertTrue(contract["index_merged"])


# ---------------------------------------------------------------------------
# 7. THE CLASSIFIER FINGERPRINT HAS NO HOLES.
# ---------------------------------------------------------------------------
class ClassifierFingerprintTest(unittest.TestCase):
    """PR #627 added three verdict-determining constants and none of them were
    in classifier_version()'s parts list. Proved before the fix: deleting
    "country" from _SOVEREIGNTY_DROP_KEYWORDS flipped
    _classify("country in central europe", "RH") from None to False while the
    stamp stayed v1-5af314f88f0a343c, so all 25,731 cache rows would have gone
    on serving the old verdict with nothing to notice.

    The AST fingerprint does not cover these: it hashes the parsed body of
    _classify, which references the names but does not contain their values."""

    def _stamp_with(self, **overrides):
        with mock.patch.dict(wikidata.__dict__, overrides):
            wikidata._CLASSIFIER_VERSION_CACHE = None
            try:
                return wikidata.classifier_version()
            finally:
                wikidata._CLASSIFIER_VERSION_CACHE = None

    def test_editing_the_sovereignty_keywords_moves_the_stamp(self):
        base = self._stamp_with()
        moved = self._stamp_with(
            _SOVEREIGNTY_DROP_KEYWORDS=frozenset({"sovereign state", "nation state"}))
        self.assertNotEqual(base, moved)

    def test_the_sovereignty_edit_really_does_change_a_verdict(self):
        """Guards the test above against being vacuous."""
        self.assertIsNone(wikidata._classify("country in central europe", "RH"))
        with mock.patch.dict(wikidata.__dict__, {
                "_SOVEREIGNTY_DROP_KEYWORDS": frozenset({"sovereign state"})}):
            self.assertIs(wikidata._classify("country in central europe", "RH"), False)

    def test_editing_the_hard_drop_patterns_moves_the_stamp(self):
        base = self._stamp_with()
        moved = self._stamp_with(
            _HARD_DROP_DESCRIPTION_PATTERNS=[re.compile(r"^humans?\b")])
        self.assertNotEqual(base, moved)

    def test_editing_the_ticker_shape_moves_the_stamp(self):
        base = self._stamp_with()
        moved = self._stamp_with(_TICKER_SHAPED_NAME_RE=re.compile(r"^[A-Z]{1,4}$"))
        self.assertNotEqual(base, moved)

    def test_the_stamp_is_stable_across_calls_and_set_ordering(self):
        """A frozenset's iteration order is not guaranteed, so the sovereignty
        keywords are sorted before hashing. Same members, different insertion
        order, same stamp."""
        base = self._stamp_with()
        reordered = self._stamp_with(_SOVEREIGNTY_DROP_KEYWORDS=frozenset(
            ["nation state", "country", "sovereign state"]))
        self.assertEqual(base, reordered)


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
