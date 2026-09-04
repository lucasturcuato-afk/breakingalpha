"""Selection logic for the tiered EDGAR submissions poll.

Deterministic and offline: no network, no Supabase. Covers the pure shard
math plus get_poll_ciks wired to a fake Supabase client, which is where the
hot/tail union and the "tail CIKs are now reachable" guarantee live.
"""
from __future__ import annotations

import os
import unittest
from datetime import datetime, timezone
from unittest import mock

from backend.edgar import submissions as S


def entry(cik: int) -> dict:
    return {
        "cik": cik,
        "ticker": f"T{cik}",
        "company_id": f"id-{cik}",
        "company_name": f"Co {cik}",
    }


class TestTailSlot(unittest.TestCase):
    def test_slot_is_hour_of_day_at_24_shards(self):
        for hour in range(24):
            now = datetime(2026, 7, 27, hour, 0, tzinfo=timezone.utc)  # a Monday
            self.assertEqual(S.tail_slot(now, 24), hour)

    def test_slot_walks_the_weekly_grid_for_non_divisors(self):
        # 7 shards over a weekly hour grid must not pin to one bucket.
        slots = {
            S.tail_slot(datetime(2026, 7, 27, h, tzinfo=timezone.utc), 7)
            for h in range(24)
        }
        self.assertEqual(slots, set(range(7)))

    def test_zero_shards_is_slot_zero(self):
        self.assertEqual(S.tail_slot(datetime(2026, 7, 27, 5, tzinfo=timezone.utc), 0), 0)


class TestSelectTailCiks(unittest.TestCase):
    def test_shards_partition_the_candidates_exactly_once(self):
        candidates = [entry(c) for c in range(1000, 1800)]
        seen: list[int] = []
        for slot in range(24):
            picked = S.select_tail_ciks(
                candidates, slot=slot, shards=24, max_per_run=0
            )
            seen.extend(e["cik"] for e in picked)
        self.assertEqual(sorted(seen), sorted(e["cik"] for e in candidates))
        self.assertEqual(len(seen), len(set(seen)))  # no CIK in two shards

    def test_selection_is_cik_modulo_slot(self):
        candidates = [entry(c) for c in (100, 101, 124, 125, 148)]
        picked = S.select_tail_ciks(candidates, slot=4, shards=24, max_per_run=0)
        self.assertEqual([e["cik"] for e in picked], [100, 124, 148])

    def test_deterministic_ordering(self):
        candidates = [entry(c) for c in (148, 100, 124)]
        picked = S.select_tail_ciks(candidates, slot=4, shards=24, max_per_run=0)
        self.assertEqual([e["cik"] for e in picked], [100, 124, 148])

    def test_cap_truncates_and_rotation_prevents_permanent_starvation(self):
        candidates = [entry(c) for c in range(0, 240, 24)]  # 10 CIKs, all slot 0
        day1 = S.select_tail_ciks(
            candidates, slot=0, shards=24, max_per_run=3, rotation=0
        )
        self.assertEqual([e["cik"] for e in day1], [0, 24, 48])
        day2 = S.select_tail_ciks(
            candidates, slot=0, shards=24, max_per_run=3, rotation=3
        )
        self.assertEqual([e["cik"] for e in day2], [72, 96, 120])
        # Every CIK is reachable within ceil(10/3) rotations, none is starved.
        covered: set[int] = set()
        for rot in range(0, 12, 3):
            covered.update(
                e["cik"]
                for e in S.select_tail_ciks(
                    candidates, slot=0, shards=24, max_per_run=3, rotation=rot
                )
            )
        self.assertEqual(covered, {e["cik"] for e in candidates})

    def test_zero_shards_and_empty_input_are_safe(self):
        self.assertEqual(S.select_tail_ciks([entry(1)], slot=0, shards=0, max_per_run=5), [])
        self.assertEqual(S.select_tail_ciks([], slot=0, shards=24, max_per_run=5), [])


class TestEnvKnobs(unittest.TestCase):
    def test_int_knob_falls_back_on_junk_and_negatives(self):
        with mock.patch.dict(os.environ, {"X_KNOB": "not-a-number"}):
            self.assertEqual(S._env_int("X_KNOB", 24), 24)
        with mock.patch.dict(os.environ, {"X_KNOB": "-5"}):
            self.assertEqual(S._env_int("X_KNOB", 24), 24)
        with mock.patch.dict(os.environ, {"X_KNOB": "  7 "}):
            self.assertEqual(S._env_int("X_KNOB", 24), 7)
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(S._env_int("X_KNOB", 24), 24)

    def test_flag_knob(self):
        for raw, expected in [("0", False), ("false", False), ("off", False),
                              ("1", True), ("yes", True), ("", True)]:
            with mock.patch.dict(os.environ, {"X_FLAG": raw}):
                self.assertEqual(S._env_flag("X_FLAG", True), expected, raw)


class TestGetPollCiks(unittest.TestCase):
    """get_poll_ciks against fakes: hot set preserved, tail now reachable."""

    HOT = [entry(c) for c in (10, 11, 12)]
    UNIVERSE = [entry(c) for c in (10, 11, 12, 100, 101, 124, 125, 148)]

    def _run(self, *, now, env=None):
        env = env or {}
        with mock.patch.dict(os.environ, env, clear=False), \
             mock.patch.object(S, "get_watchlist_ciks", return_value=list(self.HOT)), \
             mock.patch.object(S, "get_recent_filer_ciks", return_value=[]), \
             mock.patch.object(S, "get_xbrl_ciks", return_value=list(self.UNIVERSE)):
            return S.get_poll_ciks(object(), now=now)

    def test_tail_ciks_excluded_by_the_old_cap_are_now_reachable(self):
        # 100/124/148 were outside the old hot set and could never be polled.
        reached: set[int] = set()
        for hour in range(24):
            now = datetime(2026, 7, 27, hour, tzinfo=timezone.utc)
            reached.update(e["cik"] for e in self._run(now=now))
        self.assertEqual(reached, {e["cik"] for e in self.UNIVERSE})

    def test_hot_set_is_polled_every_single_run(self):
        for hour in range(24):
            now = datetime(2026, 7, 27, hour, tzinfo=timezone.utc)
            ciks = [e["cik"] for e in self._run(now=now)]
            self.assertTrue({10, 11, 12}.issubset(set(ciks)), hour)

    def test_no_duplicate_ciks_in_a_run(self):
        for hour in range(24):
            now = datetime(2026, 7, 27, hour, tzinfo=timezone.utc)
            ciks = [e["cik"] for e in self._run(now=now)]
            self.assertEqual(len(ciks), len(set(ciks)), hour)

    def test_hot_ciks_are_never_re_added_as_tail(self):
        now = datetime(2026, 7, 27, 10, tzinfo=timezone.utc)  # slot 10, cik 10 matches
        ciks = [e["cik"] for e in self._run(now=now)]
        self.assertEqual(ciks.count(10), 1)

    def test_disabling_the_tail_restores_hot_only_behavior(self):
        now = datetime(2026, 7, 27, 4, tzinfo=timezone.utc)
        off = self._run(now=now, env={"EDGAR_POLL_TAIL_ENABLED": "0"})
        self.assertEqual([e["cik"] for e in off], [10, 11, 12])
        zero = self._run(now=now, env={"EDGAR_POLL_TAIL_SHARDS": "0"})
        self.assertEqual([e["cik"] for e in zero], [10, 11, 12])

    def test_recent_filers_join_the_hot_set_without_duplicating(self):
        now = datetime(2026, 7, 27, 4, tzinfo=timezone.utc)
        with mock.patch.object(S, "get_watchlist_ciks", return_value=list(self.HOT)), \
             mock.patch.object(
                 S, "get_recent_filer_ciks", return_value=[entry(12), entry(101)]
             ), \
             mock.patch.object(S, "get_xbrl_ciks", return_value=list(self.UNIVERSE)):
            ciks = [e["cik"] for e in S.get_poll_ciks(object(), now=now)]
        self.assertEqual(ciks.count(12), 1)
        self.assertEqual(ciks.count(101), 1)
        self.assertTrue({10, 11, 12, 101}.issubset(set(ciks)))
        # 101 is hot now, so it must not also appear via its tail shard (slot 5).
        with mock.patch.object(S, "get_watchlist_ciks", return_value=list(self.HOT)), \
             mock.patch.object(
                 S, "get_recent_filer_ciks", return_value=[entry(101)]
             ), \
             mock.patch.object(S, "get_xbrl_ciks", return_value=list(self.UNIVERSE)):
            slot5 = [
                e["cik"]
                for e in S.get_poll_ciks(
                    object(), now=datetime(2026, 7, 27, 5, tzinfo=timezone.utc)
                )
            ]
        self.assertEqual(slot5.count(101), 1)


class TestRuntimeBudget(unittest.TestCase):
    """Guard the sizing assumption the tier defaults were chosen against."""

    def test_default_shards_keep_the_per_run_tail_small(self):
        tail_candidates = 580  # measured: 792 CIK-bearing minus 212 hot
        per_run = tail_candidates / S.DEFAULT_TAIL_SHARDS
        self.assertLess(per_run, S.DEFAULT_TAIL_MAX_PER_RUN)
        # Full universe covered at least daily, inside FILING_LOOKBACK_DAYS.
        self.assertLessEqual(S.DEFAULT_TAIL_SHARDS, 24)


class TestParseScheduledHour(unittest.TestCase):
    """The stamp parser. Pure, and it must never raise on junk."""

    def test_bare_hour(self):
        for raw, expected in [("0", 0), ("7", 7), ("07", 7), (" 23 ", 23), (13, 13)]:
            self.assertEqual(S.parse_scheduled_hour(raw), expected, raw)

    def test_iso_timestamp_is_read_in_utc(self):
        self.assertEqual(S.parse_scheduled_hour("2026-09-03T00:00:00Z"), 0)
        self.assertEqual(S.parse_scheduled_hour("2026-09-03T17:00:00+00:00"), 17)
        # A non-UTC offset is converted, not truncated: 22:00-05:00 is 03:00Z.
        self.assertEqual(S.parse_scheduled_hour("2026-09-03T22:00:00-05:00"), 3)

    def test_unusable_input_is_none_and_never_raises(self):
        for raw in [None, "", "   ", "abc", "-5", "24", "99", "not-a-time",
                    "2026-13-45T99:99:99Z", []]:
            self.assertIsNone(S.parse_scheduled_hour(raw), raw)


class TestScheduledMoment(unittest.TestCase):
    """Anchoring a stamped hour onto the execution date. Pure."""

    def test_no_stamp_returns_execution_time_unchanged(self):
        now = datetime(2026, 9, 3, 1, 15, tzinfo=timezone.utc)
        self.assertIs(S.scheduled_moment(now, None), now)

    def test_stamp_earlier_than_execution_anchors_to_the_same_day(self):
        now = datetime(2026, 9, 3, 1, 15, tzinfo=timezone.utc)
        self.assertEqual(
            S.scheduled_moment(now, 0),
            datetime(2026, 9, 3, 0, 0, tzinfo=timezone.utc),
        )

    def test_stamp_in_the_future_steps_back_a_day(self):
        # The 23:00 run started at 00:20 the next day. It belongs to the 3rd.
        now = datetime(2026, 9, 4, 0, 20, tzinfo=timezone.utc)
        self.assertEqual(
            S.scheduled_moment(now, 23),
            datetime(2026, 9, 3, 23, 0, tzinfo=timezone.utc),
        )

    def test_small_clock_skew_does_not_step_back_a_day(self):
        # Started 2 minutes before its own boundary. Still today's run.
        now = datetime(2026, 9, 3, 4, 58, tzinfo=timezone.utc)
        self.assertEqual(
            S.scheduled_moment(now, 5),
            datetime(2026, 9, 3, 5, 0, tzinfo=timezone.utc),
        )


class TestLateRunPollsItsOwnShard(unittest.TestCase):
    """THE defect. A run must poll the shard it was SCHEDULED for.

    tail_slot used to be fed datetime.now(), so at 24 shards the slot WAS the
    execution hour. A run scheduled for 00:00 that started at 01:15 polled
    shard 1 twice that day and left shard 0 untouched, silently.

    These assert the seam (which CIKs get_poll_ciks returns) rather than the
    slot integer, because the slot is an internal and the returned CIK list is
    what the poll actually consumes.
    """

    # 2400 % 24 == 0, so 2400..2424 populates EVERY slot and slot 0 twice.
    # A universe with empty slots would let these assertions pass by comparing
    # one empty list against another.
    UNIVERSE = [entry(c) for c in range(2400, 2425)]
    LATE = datetime(2026, 9, 3, 1, 15, tzinfo=timezone.utc)

    def _run(self, *, now, scheduled_hour=None, env=None, universe=None):
        universe = self.UNIVERSE if universe is None else universe
        with mock.patch.dict(os.environ, env or {}, clear=False), \
             mock.patch.object(S, "get_watchlist_ciks", return_value=[]), \
             mock.patch.object(S, "get_recent_filer_ciks", return_value=[]), \
             mock.patch.object(S, "get_xbrl_ciks", return_value=list(universe)):
            return [
                e["cik"]
                for e in S.get_poll_ciks(object(), now=now, scheduled_hour=scheduled_hour)
            ]

    def test_a_late_run_polls_the_shard_it_was_scheduled_for(self):
        # Scheduled 00:00, executing 01:15. Must poll shard 0, NOT shard 1.
        polled = self._run(now=self.LATE, scheduled_hour="0")
        self.assertEqual(polled, [2400, 2424])
        self.assertNotIn(2401, polled)

    def test_an_unstamped_late_run_still_uses_execution_time(self):
        # Documented fallback, not an aspiration: with no stamp there is
        # nothing to recover the intended hour from, so behavior is unchanged.
        self.assertEqual(self._run(now=self.LATE), [2401])

    def test_the_stamp_beats_execution_time_for_every_hour(self):
        # Execution pinned to one hour; the shard must follow the stamp alone.
        executing_at = datetime(2026, 9, 3, 1, 15, tzinfo=timezone.utc)
        for hour in range(24):
            with self.subTest(scheduled_hour=hour):
                stamped = self._run(now=executing_at, scheduled_hour=str(hour))
                unstamped_at_that_hour = self._run(
                    now=executing_at.replace(hour=hour)
                )
                self.assertNotEqual(stamped, [], "empty slot proves nothing")
                self.assertEqual(stamped, unstamped_at_that_hour)

    def test_an_iso_stamp_works_as_well_as_a_bare_hour(self):
        self.assertEqual(
            self._run(now=self.LATE, scheduled_hour="2026-09-03T00:00:00Z"),
            [2400, 2424],
        )

    def test_env_supplies_the_stamp_when_no_argument_is_passed(self):
        polled = self._run(now=self.LATE, env={S.SCHEDULED_HOUR_ENV: "0"})
        self.assertEqual(polled, [2400, 2424])

    def test_an_explicit_argument_beats_the_env(self):
        polled = self._run(
            now=self.LATE, scheduled_hour="0", env={S.SCHEDULED_HOUR_ENV: "1"}
        )
        self.assertEqual(polled, [2400, 2424])

    def test_junk_stamp_degrades_to_execution_time_rather_than_crashing(self):
        self.assertEqual(
            self._run(now=self.LATE, scheduled_hour="tomorrow-ish"), [2401]
        )

    def test_midnight_crossing_delay_keeps_the_scheduled_weekday(self):
        # shards=7 is the case where tail_slot's weekday term does NOT cancel,
        # so a stamp anchored to the wrong DAY would pick the wrong shard.
        # 7000 % 7 == 0, so 7000..7006 fills every one of the 7 slots.
        universe = [entry(c) for c in range(7000, 7007)]
        scheduled = datetime(2026, 9, 3, 23, 0, tzinfo=timezone.utc)
        executing = datetime(2026, 9, 4, 0, 20, tzinfo=timezone.utc)
        env = {"EDGAR_POLL_TAIL_SHARDS": "7"}
        late = self._run(
            now=executing, scheduled_hour="23", env=env, universe=universe
        )
        punctual = self._run(now=scheduled, env=env, universe=universe)
        self.assertEqual(len(punctual), 1, "fixture must populate every slot")
        self.assertEqual(late, punctual)

    def test_the_rotation_key_follows_the_scheduled_moment(self):
        # An oversized shard rotates by day to avoid permanent starvation. Two
        # runs claiming the same scheduled slot must select the SAME window,
        # even when one of them slipped past midnight to execute.
        universe = [entry(c) for c in range(2400, 2400 + 24 * 8, 24)]  # all slot 0
        env = {"EDGAR_POLL_TAIL_MAX_PER_RUN": "3"}

        def go(now, scheduled_hour):
            with mock.patch.dict(os.environ, env, clear=False), \
                 mock.patch.object(S, "get_watchlist_ciks", return_value=[]), \
                 mock.patch.object(S, "get_recent_filer_ciks", return_value=[]), \
                 mock.patch.object(S, "get_xbrl_ciks", return_value=list(universe)):
                return [
                    e["cik"] for e in S.get_poll_ciks(
                        object(), now=now, scheduled_hour=scheduled_hour
                    )
                ]

        punctual = go(datetime(2026, 9, 3, 0, 0, tzinfo=timezone.utc), "0")
        slipped = go(datetime(2026, 9, 3, 1, 40, tzinfo=timezone.utc), "0")
        self.assertEqual(punctual, slipped)
        self.assertEqual(len(punctual), 3)

    def test_tail_slot_reads_no_environment(self):
        # It is documented "Pure, no I/O" and is imported elsewhere. A poisoned
        # env must not move its answer; the stamp is threaded in, never read.
        moment = datetime(2026, 9, 3, 5, 0, tzinfo=timezone.utc)
        with mock.patch.dict(
            os.environ,
            {S.SCHEDULED_HOUR_ENV: "19", "EDGAR_POLL_TAIL_SHARDS": "7"},
            clear=False,
        ):
            self.assertEqual(S.tail_slot(moment, 24), 5)


# --- Fake PostgREST, with the silent row cap ------------------------------


class FakeResp:
    def __init__(self, data):
        self.data = data


class _Not:
    def __init__(self, table):
        self._t = table

    def is_(self, col, _val):
        self._t._filters.append(("notnull", col, None))
        return self._t


class FakeTable:
    """A PostgREST table that truncates at SERVER_CAP without saying so.

    That silence is the entire point. A bare .execute() over more than one page
    has to come back short here exactly as it does in production, or a test
    written against this fake proves nothing about the cap.
    """

    SERVER_CAP = 1000

    def __init__(self, name, rows, log):
        self.name = name
        self.rows = rows
        self.log = log
        self._filters = []
        self._range = None
        self._limit = None
        self._order = []

    def select(self, _cols):
        return self

    def order(self, col, desc=False):
        self._order.append((col, desc))
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def in_(self, col, values):
        self._filters.append(("in", col, list(values)))
        return self

    def eq(self, col, value):
        self._filters.append(("eq", col, value))
        return self

    @property
    def not_(self):
        return _Not(self)

    def execute(self):
        rows = list(self.rows)
        for kind, col, val in self._filters:
            if kind == "in":
                rows = [r for r in rows if r.get(col) in set(val)]
            elif kind == "eq":
                rows = [r for r in rows if r.get(col) == val]
            elif kind == "notnull":
                rows = [r for r in rows if r.get(col) is not None]
        for col, desc in reversed(self._order):
            rows.sort(key=lambda r: r.get(col), reverse=desc)
        self.log.append({
            "table": self.name,
            "filters": list(self._filters),
            "range": self._range,
            "limit": self._limit,
            "matched": len(rows),
        })
        if self._range is not None:
            start, end = self._range
            rows = rows[start:end + 1]
        if self._limit is not None:
            rows = rows[:self._limit]
        # The cap applies LAST and is silent, same as the server.
        return FakeResp(rows[:self.SERVER_CAP])


class FakeClient:
    def __init__(self, tables):
        self.tables = tables
        self.log = []

    def table(self, name):
        return FakeTable(name, self.tables.get(name, []), self.log)


class TestHotPathIsPaged(unittest.TestCase):
    """get_watchlist_ciks must not lose rows to the silent 1000-row cap.

    The watchlist read decides which CIKs are polled AT ALL, so a truncation
    there drops companies out of EDGAR coverage with no error and no log line.
    """

    def _client(self, *, n_tickers, ciks_per_ticker=1, n_companies=5):
        tickers = ["T%05d" % i for i in range(n_tickers)]
        watchlist = [
            {"id": i, "identifier": t, "type": "ticker"}
            for i, t in enumerate(tickers)
        ]
        # Pad with non-ticker rows so they occupy early pages too.
        watchlist += [
            {"id": 10 ** 6 + i, "identifier": "sector-%d" % i, "type": "sector"}
            for i in range(50)
        ]
        cik_tickers, companies, cik = [], [], 5000
        for t in tickers:
            for _ in range(ciks_per_ticker):
                cik += 1
                cik_tickers.append(
                    {"cik": cik, "ticker": t, "company_name": "Co %d" % cik}
                )
                companies.append({
                    "id": "id-%d" % cik, "sec_cik": cik, "ticker": t,
                    "name": "Co %d" % cik, "mention_count": 0,
                })
        for j in range(n_companies):
            companies.append({
                "id": "hot-%d" % j, "sec_cik": 900000 + j, "ticker": "H%d" % j,
                "name": "Hot %d" % j, "mention_count": 1000 - j,
            })
        return FakeClient({
            "watchlist": watchlist,
            "cik_tickers": cik_tickers,
            "companies": companies,
        }), tickers, cik_tickers

    def test_a_watchlist_larger_than_one_page_is_read_whole(self):
        sb, tickers, cik_tickers = self._client(n_tickers=2500)
        self.assertGreater(len(tickers), FakeTable.SERVER_CAP)
        got = S.get_watchlist_ciks(sb)
        resolved = {e["cik"] for e in got}
        self.assertTrue(
            {r["cik"] for r in cik_tickers}.issubset(resolved),
            "CIKs from watchlist rows beyond the first page were dropped",
        )

    def test_the_watchlist_read_actually_pages(self):
        sb, _t, _ct = self._client(n_tickers=2500)
        S.get_watchlist_ciks(sb)
        wl_reads = [r for r in sb.log if r["table"] == "watchlist"]
        self.assertGreater(len(wl_reads), 1, "watchlist was read in one shot")
        self.assertTrue(
            all(r["range"] is not None for r in wl_reads),
            "a watchlist read went out with no .range(), so it can truncate",
        )

    def test_cik_tickers_beyond_one_page_within_a_single_chunk_is_read_whole(self):
        # 150 tickers per chunk * 8 CIKs each = 1200 rows for ONE chunk, so
        # chunking alone is not enough; the chunk itself has to be paged.
        sb, _t, cik_tickers = self._client(n_tickers=150, ciks_per_ticker=8)
        self.assertGreater(len(cik_tickers), FakeTable.SERVER_CAP)
        got = S.get_watchlist_ciks(sb)
        self.assertTrue(
            {r["cik"] for r in cik_tickers}.issubset({e["cik"] for e in got}),
            "cik_tickers rows past the cap were dropped inside one chunk",
        )

    def test_company_ids_are_resolved_for_every_matched_cik(self):
        sb, _t, cik_tickers = self._client(n_tickers=300)
        got = S.get_watchlist_ciks(sb)
        by_cik = {e["cik"]: e for e in got}
        for row in cik_tickers:
            self.assertEqual(
                by_cik[row["cik"]]["company_id"], "id-%d" % row["cik"],
                "cik %d lost its company_id" % row["cik"],
            )

    def test_company_lookup_is_batched_not_one_request_per_cik(self):
        # The N+1: this was one companies read per matched CIK, every run.
        # Assert the request count scales with CHUNKS, not with CIKs.
        counts = {}
        for n in (300, 600):
            sb, _t, _ct = self._client(n_tickers=n)
            S.get_watchlist_ciks(sb)
            reads = [r for r in sb.log if r["table"] == "companies"]
            counts[n] = len(reads)
            self.assertFalse(
                any(k == "eq" and c == "sec_cik" for r in reads for k, c, _v in r["filters"]),
                "a per-CIK .eq(sec_cik) lookup is still in the hot path",
            )
        expected_extra = (600 - 300) // S.IN_CHUNK
        self.assertEqual(
            counts[600] - counts[300], expected_extra,
            "companies reads grew with CIK count, so the N+1 is still there",
        )

    def test_no_unbounded_read_is_issued_on_the_hot_path(self):
        # The shape to grep for: a read with no .range(), no .limit() and no
        # narrowing filter. Every one of those can truncate in silence.
        sb, _t, _ct = self._client(n_tickers=2500)
        S.get_watchlist_ciks(sb)
        for read in sb.log:
            narrowed = any(k in ("in", "eq") for k, _c, _v in read["filters"])
            bounded = read["range"] is not None or read["limit"] is not None
            self.assertTrue(
                bounded or narrowed,
                "unbounded read on %s can silently truncate: %r"
                % (read["table"], read),
            )


if __name__ == "__main__":
    unittest.main()
