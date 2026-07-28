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


if __name__ == "__main__":
    unittest.main()
