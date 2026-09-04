"""Self-healing EDGAR tail-shard catch-up.

Offline and deterministic: no network, no Supabase, no secrets.

Every test here is written against a SEAM rather than a symptom, because this
repo has shipped three tests whose fingerprint was incidental to what they
claimed to prove. Where a test names a mechanism ("calls the real selector once
per shard", "never reads pipeline_runs"), it asserts that mechanism directly by
counting calls or recording table names, not by reading a number the mechanism
happens to produce.
"""
from __future__ import annotations

import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

from backend import ingest_sec
from backend.edgar import shard_coverage as SC
from backend.edgar import submissions as S

UTC = timezone.utc


def entry(cik: int) -> dict:
    return {
        "cik": cik,
        "ticker": f"T{cik}",
        "company_id": f"id-{cik}",
        "company_name": f"Co {cik}",
    }


class RecordingClient:
    """Fake Supabase that records every table it is asked for.

    Deliberately records TABLE NAMES rather than returning canned data only:
    the seam test needs to prove which tables the planner touched, and a fake
    that answers without remembering cannot prove a negative.
    """

    def __init__(self, coverage_rows=None, count_override=None):
        self.coverage_rows = list(coverage_rows or [])
        self.count_override = count_override
        self.tables_read: list[str] = []
        self.upserts: list[dict] = []

    def table(self, name):
        self.tables_read.append(name)
        return _Query(self, name)


class _Query:
    def __init__(self, client, name):
        self.client = client
        self.name = name
        self._filters = {}

    def select(self, *_a, **_kw):
        self._count = _kw.get("count")
        return self

    def eq(self, col, val):
        self._filters[col] = val
        return self

    def order(self, *_a, **_kw):
        return self

    def limit(self, *_a, **_kw):
        return self

    def upsert(self, payload, **_kw):
        self._payload = payload
        return self

    def execute(self):
        if hasattr(self, "_payload"):
            self.client.upserts.append(self._payload)
            return mock.Mock(data=[self._payload], count=None)
        rows = [
            r for r in self.client.coverage_rows
            if r.get("shards") == self._filters.get("shards")
        ]
        count = (
            self.client.count_override
            if self.client.count_override is not None
            else len(rows)
        )
        return mock.Mock(data=rows, count=count)


def covrow(shard, when, *, shards=24, source="execution_time"):
    return {
        "shards": shards,
        "shard": shard,
        "covered_at": when.isoformat(),
        "slot_source": source,
    }


# ---------------------------------------------------------------------------
# Pure staleness / due-slot math
# ---------------------------------------------------------------------------
class TestDueSlots(unittest.TestCase):
    NOW = datetime(2026, 7, 27, 12, 0, tzinfo=UTC)  # Monday, slot 12 at 24 shards

    def test_a_slot_with_no_ledger_row_is_stale_not_fresh(self):
        # The whole failure mode is an absent record read as "nothing to do".
        self.assertEqual(SC.staleness(5, {}, self.NOW), SC.NEVER_COVERED)

    def test_fresh_slots_are_not_due(self):
        fresh = {s: self.NOW - timedelta(hours=2) for s in range(24)}
        self.assertEqual(
            SC.due_slots(
                slot_at=self.NOW, shards=24, current_slot=12,
                last_covered=fresh, max_catchup=3,
            ),
            [],
        )

    def test_the_current_slot_is_never_offered_as_catchup(self):
        # This run covers slot 12 anyway; offering it would double-poll it and
        # burn a catch-up budget slot that a genuinely stale shard needs.
        stale = {}  # everything stale
        due = SC.due_slots(
            slot_at=self.NOW, shards=24, current_slot=12,
            last_covered=stale, max_catchup=24,
        )
        self.assertNotIn(12, due)
        self.assertEqual(len(due), 23)

    def test_oldest_shard_is_served_first_not_the_freshest(self):
        # The binding deadline is FILING_LOOKBACK_DAYS. Serving freshest-first
        # would let the oldest shard walk off that cliff while looking busy.
        cov = {
            1: self.NOW - timedelta(days=9),
            2: self.NOW - timedelta(days=2),
            3: self.NOW - timedelta(days=5),
        }
        cov.update({s: self.NOW for s in range(24) if s not in cov})
        due = SC.due_slots(
            slot_at=self.NOW, shards=24, current_slot=12,
            last_covered=cov, max_catchup=2,
        )
        self.assertEqual(due, [1, 3])

    def test_never_covered_outranks_every_covered_shard(self):
        cov = {s: self.NOW for s in range(24)}
        del cov[7]  # 7 has no row at all
        cov[4] = self.NOW - timedelta(days=30)
        due = SC.due_slots(
            slot_at=self.NOW, shards=24, current_slot=12,
            last_covered=cov, max_catchup=1,
        )
        self.assertEqual(due, [7])

    def test_ordering_is_deterministic_on_ties(self):
        cov = {s: self.NOW for s in range(24)}
        for s in (3, 9, 20):
            cov[s] = self.NOW - timedelta(days=4)
        for _ in range(5):
            self.assertEqual(
                SC.due_slots(
                    slot_at=self.NOW, shards=24, current_slot=12,
                    last_covered=cov, max_catchup=3,
                ),
                [3, 9, 20],
            )

    def test_budget_bounds_the_work(self):
        due = SC.due_slots(
            slot_at=self.NOW, shards=24, current_slot=12,
            last_covered={}, max_catchup=3,
        )
        self.assertEqual(len(due), 3)

    def test_zero_budget_and_zero_shards_are_safe(self):
        self.assertEqual(
            SC.due_slots(slot_at=self.NOW, shards=24, current_slot=0,
                         last_covered={}, max_catchup=0), []
        )
        self.assertEqual(
            SC.due_slots(slot_at=self.NOW, shards=0, current_slot=0,
                         last_covered={}, max_catchup=3), []
        )


class TestReplayMoment(unittest.TestCase):
    def test_replay_moment_maps_back_to_the_requested_slot(self):
        slot_at = datetime(2026, 7, 27, 12, 30, tzinfo=UTC)
        for slot in range(24):
            m = SC.replay_moment(
                slot_at=slot_at, shards=24, slot=slot, slot_of=S.tail_slot
            )
            self.assertIsNotNone(m, slot)
            # The seam: the moment must satisfy the REAL slot function.
            self.assertEqual(S.tail_slot(m, 24), slot)
            self.assertLessEqual(m, slot_at)

    def test_replay_moment_is_the_most_recent_match(self):
        slot_at = datetime(2026, 7, 27, 12, 30, tzinfo=UTC)
        m = SC.replay_moment(slot_at=slot_at, shards=24, slot=11, slot_of=S.tail_slot)
        self.assertEqual(m, datetime(2026, 7, 27, 11, 0, tzinfo=UTC))


class TestStaleBeyond(unittest.TestCase):
    NOW = datetime(2026, 7, 27, 12, 0, tzinfo=UTC)

    def test_only_shards_past_the_limit_are_reported(self):
        cov = {0: self.NOW - timedelta(days=8), 1: self.NOW - timedelta(days=1)}
        stale = SC.stale_beyond(
            slot_at=self.NOW, shards=2, last_covered=cov, limit=timedelta(days=7)
        )
        self.assertEqual(stale, [(0, 8.0)])

    def test_a_cold_ledger_raises_no_alarm(self):
        # Day one. Every slot is unknown, catch-up heals them in hours, and a
        # red job here would be noise for a self-correcting condition.
        self.assertEqual(
            SC.stale_beyond(
                slot_at=self.NOW, shards=24, last_covered={},
                limit=timedelta(days=7),
            ),
            [],
        )

    def test_a_young_ledger_does_not_alarm_on_a_slot_it_has_not_reached_yet(self):
        cov = {s: self.NOW - timedelta(hours=3) for s in range(20)}
        self.assertEqual(
            SC.stale_beyond(
                slot_at=self.NOW, shards=24, last_covered=cov,
                limit=timedelta(days=7),
            ),
            [],
        )

    def test_an_old_ledger_DOES_alarm_on_a_slot_still_missing_from_it(self):
        # Closes the hole the grace period opens: if the ledger has been alive
        # longer than the alert window and a slot is still absent, catch-up has
        # had hundreds of runs to reach it and has not.
        cov = {s: self.NOW - timedelta(days=9) for s in range(23)}
        stale = SC.stale_beyond(
            slot_at=self.NOW, shards=24, last_covered=cov, limit=timedelta(days=7)
        )
        self.assertIn((23, None), stale)

    def test_unknown_days_is_never_a_fabricated_number(self):
        cov = {s: self.NOW - timedelta(days=9) for s in range(23)}
        stale = dict(
            SC.stale_beyond(
                slot_at=self.NOW, shards=24, last_covered=cov,
                limit=timedelta(days=7),
            )
        )
        self.assertIsNone(stale[23])
        self.assertEqual(stale[0], 9.0)


# ---------------------------------------------------------------------------
# The cap during catch-up. THE central correctness question.
# ---------------------------------------------------------------------------
class TestCapIsPerShardNotAcrossTheUnion(unittest.TestCase):
    """max_per_run caps ONE slot's picked list.

    Calling select_tail_ciks once per missed slot gives one cap per shard.
    Unioning the slots first and calling once would apply a single cap to every
    shard at once and silently drop the remainder, which is the 1000-row
    truncation class in a different costume.
    """

    # 4 shards, 50 candidates each = 200 total, cap 60.
    # Per shard: 50 < 60, nothing truncated.
    # Across the union: 200 > 60, so a unioned call loses 140 CIKs.
    UNIVERSE = [entry(c) for c in range(1000, 1200)]

    def _plan(self, *, now, env):
        client = RecordingClient(coverage_rows=[])
        with mock.patch.dict(os.environ, env, clear=False), \
             mock.patch.object(S, "get_watchlist_ciks", return_value=[]), \
             mock.patch.object(S, "get_recent_filer_ciks", return_value=[]), \
             mock.patch.object(S, "get_xbrl_ciks", return_value=list(self.UNIVERSE)):
            return S.plan_poll(client, now=now), client

    def test_the_real_selector_is_called_once_per_shard(self):
        env = {
            "EDGAR_POLL_TAIL_SHARDS": "4",
            "EDGAR_POLL_TAIL_MAX_PER_RUN": "60",
            "EDGAR_CATCHUP_MAX_SHARDS": "3",
        }
        now = datetime(2026, 7, 27, 12, tzinfo=UTC)
        real = S.select_tail_ciks
        calls = []

        def spy(candidates, **kw):
            calls.append(kw)
            return real(candidates, **kw)

        with mock.patch.object(S, "select_tail_ciks", side_effect=spy):
            plan, _ = self._plan(now=now, env=env)

        # Mechanism, not symptom: one call, one slot, four distinct slots.
        self.assertEqual(len(calls), 4)
        self.assertEqual(len(plan.groups), 4)
        self.assertEqual(sorted(c["slot"] for c in calls), [0, 1, 2, 3])
        for c in calls:
            self.assertEqual(c["max_per_run"], 60)

    def test_no_shard_is_truncated_and_the_union_exceeds_the_cap(self):
        env = {
            "EDGAR_POLL_TAIL_SHARDS": "4",
            "EDGAR_POLL_TAIL_MAX_PER_RUN": "60",
            "EDGAR_CATCHUP_MAX_SHARDS": "3",
        }
        plan, _ = self._plan(now=datetime(2026, 7, 27, 12, tzinfo=UTC), env=env)

        total = sum(len(g.entries) for g in plan.groups)
        # Each shard intact...
        for g in plan.groups:
            self.assertEqual(len(g.entries), 50, f"shard {g.slot} was truncated")
        # ...and the union is larger than the cap, which is exactly the number
        # a single unioned call would have returned instead.
        self.assertEqual(total, 200)
        self.assertGreater(total, 60)

    def test_every_selected_cik_belongs_to_its_own_shard(self):
        env = {"EDGAR_POLL_TAIL_SHARDS": "4", "EDGAR_CATCHUP_MAX_SHARDS": "3"}
        plan, _ = self._plan(now=datetime(2026, 7, 27, 12, tzinfo=UTC), env=env)
        for g in plan.groups:
            for e in g.entries:
                self.assertEqual(e["cik"] % 4, g.slot)

    def test_no_cik_is_polled_twice_across_shards(self):
        env = {"EDGAR_POLL_TAIL_SHARDS": "4", "EDGAR_CATCHUP_MAX_SHARDS": "3"}
        plan, _ = self._plan(now=datetime(2026, 7, 27, 12, tzinfo=UTC), env=env)
        flat = [e["cik"] for e in plan.entries]
        self.assertEqual(len(flat), len(set(flat)))


# ---------------------------------------------------------------------------
# The seam: two paths to "which shard was covered", only one of them trusted.
# ---------------------------------------------------------------------------
class TestForwardRecordIsTheOnlyCoverageSource(unittest.TestCase):
    UNIVERSE = [entry(c) for c in range(1000, 1100)]

    def _plan(self, *, now, coverage_rows, env=None, scheduled_hour=None):
        client = RecordingClient(coverage_rows=coverage_rows)
        with mock.patch.dict(os.environ, env or {}, clear=False), \
             mock.patch.object(S, "get_watchlist_ciks", return_value=[]), \
             mock.patch.object(S, "get_recent_filer_ciks", return_value=[]), \
             mock.patch.object(S, "get_xbrl_ciks", return_value=list(self.UNIVERSE)):
            return S.plan_poll(client, now=now, scheduled_hour=scheduled_hour), client

    def test_planning_never_reads_pipeline_runs(self):
        """pipeline_runs.started_at.hour is written by a DIFFERENT path.

        It is a faithful slot record only while shards==24 and nothing stamps
        scheduled_hour. Reading it to seed coverage would mark shards covered
        that a stamped run never polled, and the skip would be permanent and
        silent. The planner must touch the ledger and nothing else.
        """
        _, client = self._plan(
            now=datetime(2026, 7, 27, 12, tzinfo=UTC), coverage_rows=[]
        )
        self.assertIn(SC.TABLE, client.tables_read)
        self.assertNotIn("pipeline_runs", client.tables_read)
        self.assertNotIn("sec_filings", client.tables_read)

    def test_an_empty_ledger_means_unknown_not_covered(self):
        plan, _ = self._plan(
            now=datetime(2026, 7, 27, 12, tzinfo=UTC), coverage_rows=[],
            env={"EDGAR_CATCHUP_MAX_SHARDS": "3"},
        )
        catchup = [g.slot for g in plan.groups if g.run_kind == "catchup"]
        self.assertEqual(len(catchup), 3)
        self.assertEqual(plan.backlog and len(plan.backlog), 23)

    def test_the_stamping_seam_does_not_silently_skip_a_shard(self):
        """The dangerous moment: an external scheduler starts stamping.

        Execution hour and stamped hour diverge, so a proxy built on
        started_at.hour would from here on record the WRONG shard. The ledger
        records the slot that was actually selected, whatever chose it, so the
        flip changes nothing about what is known to be covered.
        """
        now = datetime(2026, 7, 27, 1, 15, tzinfo=UTC)  # runner is late

        unstamped, _ = self._plan(now=now, coverage_rows=[])
        stamped, _ = self._plan(now=now, coverage_rows=[], scheduled_hour="0")

        # Same execution moment, different slot. This is the divergence.
        self.assertEqual(unstamped.groups[0].slot, 1)
        self.assertEqual(stamped.groups[0].slot, 0)
        # And each names its own writer, so the rows are never confused.
        self.assertEqual(unstamped.slot_source, "execution_time")
        self.assertEqual(stamped.slot_source, "stamped")

    def test_coverage_written_before_the_flip_still_counts_after_it(self):
        # Shard 0 covered an hour ago by an unstamped run. A stamped run now
        # must see it as covered: the row records the shard polled, and that
        # fact does not change when the scheduler does.
        now = datetime(2026, 7, 27, 12, tzinfo=UTC)
        rows = [
            covrow(s, now - timedelta(minutes=30), source="execution_time")
            for s in range(24)
        ]
        plan, _ = self._plan(
            now=now, coverage_rows=rows, scheduled_hour="12",
            env={"EDGAR_CATCHUP_MAX_SHARDS": "3"},
        )
        self.assertEqual([g.run_kind for g in plan.groups], ["current"])
        self.assertEqual(plan.backlog, [])

    def test_rows_written_under_a_different_shard_count_are_not_read(self):
        # "Shard 7 of 24" and "shard 7 of 12" are different sets of CIKs.
        now = datetime(2026, 7, 27, 12, tzinfo=UTC)
        rows = [covrow(s, now, shards=12) for s in range(12)]
        plan, _ = self._plan(
            now=now, coverage_rows=rows, env={"EDGAR_CATCHUP_MAX_SHARDS": "3"}
        )
        self.assertEqual(
            len([g for g in plan.groups if g.run_kind == "catchup"]), 3
        )

    def test_an_unreadable_ledger_degrades_to_the_old_behavior_loudly(self):
        class Broken(RecordingClient):
            def table(self, name):
                raise RuntimeError("ledger down")

        with mock.patch.object(S, "get_watchlist_ciks", return_value=[]), \
             mock.patch.object(S, "get_recent_filer_ciks", return_value=[]), \
             mock.patch.object(S, "get_xbrl_ciks", return_value=list(self.UNIVERSE)), \
             self.assertLogs("backend.edgar.submissions", level="ERROR") as logs:
            plan = S.plan_poll(Broken(), now=datetime(2026, 7, 27, 12, tzinfo=UTC))

        self.assertEqual([g.run_kind for g in plan.groups], ["current"])
        self.assertTrue(any("coverage unavailable" in m for m in logs.output))


class TestLedgerReadIsNotTakenOnFaith(unittest.TestCase):
    def test_a_short_read_against_an_exact_count_is_refused(self):
        # A response length is never a total. Four wrong numbers in this
        # codebase came from exactly this.
        client = RecordingClient(
            coverage_rows=[covrow(0, datetime(2026, 7, 27, tzinfo=UTC))],
            count_override=24,
        )
        with self.assertRaises(RuntimeError) as ctx:
            SC.read_coverage(client, shards=24)
        self.assertIn("truncated", str(ctx.exception))

    def test_a_matching_read_is_parsed_into_aware_datetimes(self):
        when = datetime(2026, 7, 27, 5, tzinfo=UTC)
        client = RecordingClient(coverage_rows=[covrow(3, when)])
        got = SC.read_coverage(client, shards=24)
        self.assertEqual(set(got), {3})
        self.assertIsNotNone(got[3].tzinfo)
        self.assertEqual(got[3], when)


# ---------------------------------------------------------------------------
# Completion asserted against the diff, not against a row-level error count.
# ---------------------------------------------------------------------------
class TestCoverageRequiresACompleteShard(unittest.TestCase):
    def test_a_half_polled_shard_is_refused_by_the_recorder(self):
        client = RecordingClient()
        with self.assertLogs("backend.edgar.shard_coverage", level="WARNING"):
            ok = SC.record_coverage(
                client, shards=24, shard=5,
                covered_at=datetime(2026, 7, 27, 5, tzinfo=UTC),
                slot_source="stamped", run_kind="catchup",
                ciks_selected=20, ciks_polled=19,
            )
        self.assertFalse(ok)
        self.assertEqual(client.upserts, [])

    def test_a_complete_shard_is_written_with_both_counts(self):
        client = RecordingClient()
        ok = SC.record_coverage(
            client, shards=24, shard=5,
            covered_at=datetime(2026, 7, 27, 5, tzinfo=UTC),
            slot_source="stamped", run_kind="catchup",
            ciks_selected=20, ciks_polled=20,
        )
        self.assertTrue(ok)
        self.assertEqual(len(client.upserts), 1)
        row = client.upserts[0]
        self.assertEqual(row["shard"], 5)
        self.assertEqual(row["shards"], 24)
        self.assertEqual(row["slot_source"], "stamped")
        self.assertEqual(row["ciks_selected"], row["ciks_polled"])


class TestWholeCikFailureIsVisible(unittest.TestCase):
    """A CIK whose fetch returns None never touched stats["errors"].

    That is how a previous EDGAR backfill skipped five whole CIKs behind a
    swallowed `except: continue`. The shard diff is what makes it visible.
    """

    def _stats(self):
        return {
            "ciks_polled": 0, "filings_8k_new": 0, "filings_4_new": 0,
            "filings_periodic_new": 0, "transactions_recorded": 0,
            "outputs_recorded": 0, "filings_8k_resummarized": 0,
            "resummarize_failed": 0, "errors": 0,
            "shards_targeted": 0, "shards_covered": 0, "shards_incomplete": [],
            "shards_backlog": 0, "shards_past_alert": [], "catchup_slots": [],
            "slot_source": None,
        }

    def test_a_none_fetch_is_absent_from_the_polled_set_and_not_an_error(self):
        entries = [entry(c) for c in (10, 11, 12)]
        stats = self._stats()
        with mock.patch.object(
            ingest_sec, "fetch_recent_filings",
            side_effect=lambda cik: None if cik == 11 else [],
        ):
            polled = ingest_sec._poll_entries(object(), entries, False, stats)
        self.assertEqual(polled, {10, 12})
        self.assertEqual(stats["ciks_polled"], 3)
        # The point: the error count says everything is fine.
        self.assertEqual(stats["errors"], 0)

    def test_an_empty_filings_list_still_counts_as_polled(self):
        # A shard that legitimately found nothing must not look like a failure,
        # or every quiet shard would be retried forever.
        stats = self._stats()
        with mock.patch.object(ingest_sec, "fetch_recent_filings", return_value=[]):
            polled = ingest_sec._poll_entries(object(), [entry(10)], False, stats)
        self.assertEqual(polled, {10})


# ---------------------------------------------------------------------------
# Failing loudly.
# ---------------------------------------------------------------------------
class TestRunStatusAndAlarm(unittest.TestCase):
    def test_clean_run_is_success(self):
        self.assertEqual(
            ingest_sec.run_status({"errors": 0, "shards_incomplete": []}), "success"
        )

    def test_an_incomplete_shard_demotes_the_run_to_partial(self):
        # Extends the existing errors>0 precedent rather than inventing one.
        self.assertEqual(
            ingest_sec.run_status({"errors": 0, "shards_incomplete": [7]}), "partial"
        )

    def test_row_level_errors_still_demote_the_run(self):
        self.assertEqual(
            ingest_sec.run_status({"errors": 2, "shards_incomplete": []}), "partial"
        )

    def test_a_single_incomplete_shard_does_not_turn_the_job_red(self):
        # It self-heals next run. Paging on it trains everyone to ignore red.
        self.assertFalse(
            ingest_sec.should_alarm(
                {"errors": 0, "shards_incomplete": [7], "shards_past_alert": []}
            )
        )

    def test_a_shard_stale_past_the_alert_threshold_turns_the_job_red(self):
        # This is the condition that already cost this pipeline data: past
        # FILING_LOOKBACK_DAYS the missed filings are unrecoverable.
        self.assertTrue(
            ingest_sec.should_alarm(
                {"errors": 0, "shards_incomplete": [], "shards_past_alert": [(0, 28.0)]}
            )
        )

    def test_the_alert_threshold_sits_inside_the_ingest_window(self):
        # A threshold at or past FILING_LOOKBACK_DAYS would only ever fire
        # after the data was already gone.
        from backend.edgar.constants import FILING_LOOKBACK_DAYS
        self.assertLess(S.DEFAULT_CATCHUP_ALERT_DAYS, FILING_LOOKBACK_DAYS)
        self.assertGreater(S.DEFAULT_CATCHUP_ALERT_DAYS, 0)


# ---------------------------------------------------------------------------
# Convergence: how long a gap takes to heal.
# ---------------------------------------------------------------------------
class TestConvergence(unittest.TestCase):
    UNIVERSE = [entry(c) for c in range(1000, 1600)]

    def test_a_cold_ledger_heals_within_the_arithmetic_it_claims(self):
        """From nothing covered, budget B per run heals `shards` slots.

        Each run covers its own slot plus B stale ones, so the backlog falls by
        at least B per run and full coverage arrives in at most
        ceil(shards / B) runs. At 24 shards and B=3 that is 8 runs, which at an
        hourly cadence is 8 hours.
        """
        shards, budget = 24, 3
        ledger: dict[int, dict] = {}
        start = datetime(2026, 7, 27, 0, tzinfo=UTC)

        runs = 0
        for h in range(48):
            now = start + timedelta(hours=h)
            rows = list(ledger.values())
            client = RecordingClient(coverage_rows=rows)
            env = {
                "EDGAR_POLL_TAIL_SHARDS": str(shards),
                "EDGAR_CATCHUP_MAX_SHARDS": str(budget),
            }
            with mock.patch.dict(os.environ, env, clear=False), \
                 mock.patch.object(S, "get_watchlist_ciks", return_value=[]), \
                 mock.patch.object(S, "get_recent_filer_ciks", return_value=[]), \
                 mock.patch.object(S, "get_xbrl_ciks", return_value=list(self.UNIVERSE)):
                plan = S.plan_poll(client, now=now)
            runs += 1
            for g in plan.groups:
                ledger[g.slot] = covrow(g.slot, now, shards=shards)
            if len(ledger) == shards:
                break

        self.assertEqual(len(ledger), shards, "never reached full coverage")
        # ceil(24 / 3) = 8 runs. Run one covers its own slot plus 3, every run
        # after that lands on a slot an earlier catch-up already took, so it
        # adds exactly `budget`. 4 + 3k >= 24 gives k = 7, so 8 runs total.
        self.assertEqual(runs, -(-shards // budget))
        self.assertEqual(runs, 8)

    def test_a_run_covers_its_own_slot_plus_at_most_the_budget(self):
        env = {"EDGAR_POLL_TAIL_SHARDS": "24", "EDGAR_CATCHUP_MAX_SHARDS": "3"}
        client = RecordingClient(coverage_rows=[])
        with mock.patch.dict(os.environ, env, clear=False), \
             mock.patch.object(S, "get_watchlist_ciks", return_value=[]), \
             mock.patch.object(S, "get_recent_filer_ciks", return_value=[]), \
             mock.patch.object(S, "get_xbrl_ciks", return_value=list(self.UNIVERSE)):
            plan = S.plan_poll(client, now=datetime(2026, 7, 27, 12, tzinfo=UTC))
        self.assertEqual(len(plan.groups), 4)
        self.assertEqual(sum(g.run_kind == "current" for g in plan.groups), 1)


class TestResumability(unittest.TestCase):
    """Coverage is written per shard as it finishes, not once at the end."""

    ENV = {"SUPABASE_URL": "http://x", "SUPABASE_SERVICE_ROLE_KEY": "k"}

    def _plan(self, slots):
        moment = datetime(2026, 7, 27, 12, tzinfo=UTC)
        groups = [
            S.ShardGroup(
                slot=s, shards=24, moment=moment,
                run_kind="current" if i == 0 else "catchup",
                entries=[entry(1000 + s), entry(1024 + s)],
            )
            for i, s in enumerate(slots)
        ]
        return S.PollPlan(
            hot=[], groups=groups, slot_source="stamped", slot_at=moment,
            now=moment, backlog=[], stale=[],
        )

    def _run(self, *, fetch, plan):
        recorded = []

        def spy(_sb, **kw):
            recorded.append((kw["shard"], kw["ciks_polled"], kw["ciks_selected"]))
            return kw["ciks_polled"] == kw["ciks_selected"]

        with mock.patch.dict(os.environ, self.ENV, clear=False), \
             mock.patch.object(ingest_sec, "create_client", return_value=object()), \
             mock.patch.object(ingest_sec, "sync_cik_tickers", return_value={}), \
             mock.patch.object(ingest_sec, "plan_poll", return_value=plan), \
             mock.patch.object(ingest_sec, "resummarize_null_8k"), \
             mock.patch.object(ingest_sec, "fetch_recent_filings", side_effect=fetch), \
             mock.patch.object(
                 ingest_sec.shard_coverage, "record_coverage", side_effect=spy
             ):
            try:
                stats = ingest_sec.run(sync_ciks_first=False, dry_run=False)
            except RuntimeError:
                stats = None
        return recorded, stats

    def test_shards_finished_before_a_crash_are_already_recorded(self):
        plan = self._plan([12, 3, 4])
        # Blow up on the first CIK of the SECOND shard (slot 3 -> cik 1003).
        def fetch(cik):
            if cik == 1003:
                raise RuntimeError("runner killed")
            return []

        recorded, stats = self._run(fetch=fetch, plan=plan)
        self.assertIsNone(stats, "the crash should have propagated")
        # Shard 12 finished and is on the ledger; 3 and 4 are not.
        self.assertEqual([r[0] for r in recorded], [12])

    def test_a_shard_with_a_failed_cik_is_not_recorded_but_the_run_continues(self):
        plan = self._plan([12, 3, 4])
        # Slot 3's second CIK returns None: a whole-CIK fetch failure.
        def fetch(cik):
            return None if cik == 1027 else []

        recorded, stats = self._run(fetch=fetch, plan=plan)
        self.assertIsNotNone(stats)
        self.assertEqual(sorted(r[0] for r in recorded), [4, 12])
        self.assertEqual(stats["shards_incomplete"], [3])
        self.assertEqual(stats["shards_covered"], 2)
        self.assertEqual(stats["shards_targeted"], 3)
        # And it demotes the run, which is how anyone finds out.
        self.assertEqual(ingest_sec.run_status(stats), "partial")

    def test_max_ciks_truncation_records_no_coverage_at_all(self):
        # A shard sliced in half by a testing flag is not a covered shard.
        plan = self._plan([12, 3, 4])
        recorded, stats = self._run(fetch=lambda cik: [], plan=plan)
        self.assertEqual(len(recorded), 3)

        with mock.patch.dict(os.environ, self.ENV, clear=False), \
             mock.patch.object(ingest_sec, "create_client", return_value=object()), \
             mock.patch.object(ingest_sec, "plan_poll", return_value=plan), \
             mock.patch.object(ingest_sec, "resummarize_null_8k"), \
             mock.patch.object(ingest_sec, "fetch_recent_filings", return_value=[]), \
             mock.patch.object(
                 ingest_sec.shard_coverage, "record_coverage"
             ) as rec:
            stats = ingest_sec.run(sync_ciks_first=False, dry_run=False, max_ciks=2)
        rec.assert_not_called()
        self.assertEqual(stats["shards_targeted"], 0)


class TestBudgetSizing(unittest.TestCase):
    """Guard the sizing the catch-up default was chosen against."""

    def test_the_default_budget_keeps_a_catchup_run_inside_the_normal_shape(self):
        # Measured tail shards: 14 to 33 CIKs, mean 21.3, over 511 candidates.
        mean_shard, max_shard = 21.3, 33
        budget = S.DEFAULT_CATCHUP_MAX_SHARDS
        # Worst case added fetches, versus the hot set a run already does.
        self.assertLessEqual((budget + 1) * max_shard, 200)
        self.assertLess((budget + 1) * mean_shard, 120)

    def test_the_per_shard_cap_does_not_bind_at_measured_shard_sizes(self):
        self.assertGreater(S.DEFAULT_TAIL_MAX_PER_RUN, 33)


if __name__ == "__main__":
    unittest.main()
