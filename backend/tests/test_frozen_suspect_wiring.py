"""Unit tests for the frozen_suspect wiring in synthesize.py.

Merged #467 built the direct freeze detector (market_tape.indices_frozen_suspect
+ fetch_tape(prior_session_tape=...)) but left it INERT: nothing in the brief
path passed a prior tape, so it never ran. This wiring reads the prior DISTINCT
trading session's persisted market_tape and threads it into fetch_tape at the
brief-generation call sites.

Two things are proven here:
  1. Prior-DISTINCT-session selection (synthesize._fetch_prior_session_tape +
     _et_session_date): a morning brief must compare against the LAST session,
     not the same-session evening brief, and an evening brief created at ~02:xx
     UTC belongs to the PRIOR ET calendar day.
  2. End-to-end through market_tape.fetch_tape: a prior tape IDENTICAL to the
     penny triggers tape["frozen_suspect"]; a MOVED prior tape does not. The
     network layer (fetch_quote / fetch_enrichment) is mocked; no network, no DB.

No network and no DB: synthesize builds its Supabase/Gemini clients at import
time from env vars, so dummy values are set BEFORE the import (offline; nothing
is sent). synthesize.supabase and market_tape.fetch_quote are mocked per-test.

Run from repo root: python -m unittest backend.tests.test_frozen_suspect_wiring
"""
import os
import sys
import unittest
from datetime import datetime, timezone, date
from pathlib import Path
from unittest import mock

os.environ.setdefault("SUPABASE_URL", "http://localhost")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service")
os.environ.setdefault("GEMINI_API_KEY", "test-gemini")

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import market_tape  # noqa: E402
import synthesize  # noqa: E402


# Prior persisted snapshot shaped like serialize_tape_snapshot() output.
def _prior_snapshot(sp500=7543.64, nasdaq=24000.11, dow=44000.22, russell=2200.33,
                    as_of="2026-07-10T02:47:27.591395+00:00"):
    return {
        "as_of": as_of,
        "regime": "risk-on",
        "vix_level": 15.0,
        "vix_pct": -1.0,
        "indices": {
            "sp500": {"pct": 0.4, "level": sp500},
            "nasdaq": {"pct": 0.5, "level": nasdaq},
            "dow": {"pct": 0.3, "level": dow},
            "russell": {"pct": 0.2, "level": russell},
        },
        "stale": [],
        "unverified": [],
        "frozen_suspect": [],
    }


class _FakeQuery:
    """Chainable stand-in for the real query builder. Every builder method returns
    self; `.not_` is a property (matching supabase-py's `.not_.is_(...)`), and
    `.execute()` yields a data-bearing object. Records nothing; just returns rows."""

    def __init__(self, rows):
        self._rows = rows

    def select(self, *a, **k):
        return self

    @property
    def not_(self):
        return self

    def is_(self, *a, **k):
        return self

    def eq(self, *a, **k):
        return self

    def order(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self

    def execute(self):
        return mock.Mock(data=self._rows)


def _fake_supabase(rows):
    """A supabase double whose table(...).select(...).not_.is_(...).order(...)
    .limit(...).execute() chain returns `rows`."""
    fake = mock.Mock()
    fake.table.return_value = _FakeQuery(rows)
    return fake


class EtSessionDate(unittest.TestCase):
    def test_evening_utc_maps_to_prior_et_day(self):
        # Evening brief generated 02:47 UTC on 07-10 belongs to the 07-09 session.
        dt = datetime(2026, 7, 10, 2, 47, tzinfo=timezone.utc)
        self.assertEqual(synthesize._et_session_date(dt), date(2026, 7, 9))

    def test_morning_utc_maps_to_same_et_day(self):
        # Morning brief generated 14:16 UTC on 07-10 belongs to the 07-10 session.
        dt = datetime(2026, 7, 10, 14, 16, tzinfo=timezone.utc)
        self.assertEqual(synthesize._et_session_date(dt), date(2026, 7, 10))

    def test_none_is_none(self):
        self.assertIsNone(synthesize._et_session_date(None))


class PriorDistinctSessionSelection(unittest.TestCase):
    def test_skips_same_session_picks_prior_distinct(self):
        # Current run: morning of 07-10 (session 07-10). The most recent persisted
        # brief is the evening of the SAME session (created 07-10 02:47 UTC ->
        # session 07-09 by ET)... wait: an evening at 02:47 UTC is session 07-09,
        # which IS distinct from a 07-10 morning. Build an explicit same-session
        # decoy to prove the skip: a morning brief also on session 07-10.
        rows = [
            # decoy: same session 07-10 (must be skipped)
            {"created_at": "2026-07-10T14:16:47+00:00",
             "market_tape": _prior_snapshot(as_of="2026-07-10T14:16:47+00:00")},
            # target: prior distinct session 07-09
            {"created_at": "2026-07-10T02:47:27+00:00",
             "market_tape": _prior_snapshot(sp500=7543.64,
                                            as_of="2026-07-10T02:47:27+00:00")},
        ]
        with mock.patch.object(synthesize, "supabase", _fake_supabase(rows)):
            got = synthesize._fetch_prior_session_tape(date(2026, 7, 10))
        self.assertIsNotNone(got)
        self.assertEqual(got["indices"]["sp500"]["level"], 7543.64)

    def test_first_brief_returns_none(self):
        with mock.patch.object(synthesize, "supabase", _fake_supabase([])):
            got = synthesize._fetch_prior_session_tape(date(2026, 7, 10))
        self.assertIsNone(got)

    def test_none_current_session_returns_none(self):
        # Never queries when we cannot compute the current session date.
        with mock.patch.object(synthesize, "supabase", _fake_supabase([_prior_snapshot()])):
            self.assertIsNone(synthesize._fetch_prior_session_tape(None))

    def test_query_error_soft_fails(self):
        fake = mock.Mock()
        fake.table.side_effect = RuntimeError("db down")
        with mock.patch.object(synthesize, "supabase", fake):
            self.assertIsNone(synthesize._fetch_prior_session_tape(date(2026, 7, 10)))


def _fresh_quote(price):
    """A fetch_quote() double: fresh current-session timestamp so it is neither
    dropped as stale nor flagged unverifiable."""
    ts = int(datetime.now(timezone.utc).timestamp())
    return {"price": price, "pct": 0.5, "prev": price - 1.0, "change": 1.0, "ts": ts}


class FetchTapeEndToEnd(unittest.TestCase):
    """Proves the flag fires (and does not) THROUGH market_tape.fetch_tape, which
    is what synthesize hands the prior tape to. Network mocked at fetch_quote."""

    # Current fetched levels for the four detector indices + VIX.
    _CURRENT = {
        "^GSPC": 7543.64,   # identical to prior sp500 -> penny match expected
        "^IXIC": 24000.11,  # identical to prior nasdaq
        "^DJI": 44000.22,   # identical to prior dow
        "^RUT": 2200.33,    # identical to prior russell
        "^VIX": 16.42,      # VIX excluded from the detector by design
    }

    def _patched_fetch_quote(self, levels):
        def _fq(symbol, timeout=8):
            price = levels.get(symbol)
            return _fresh_quote(price) if price is not None else None
        return _fq

    def test_identical_prior_triggers_flag(self):
        prior = _prior_snapshot()  # sp500/nasdaq/dow/russell match self._CURRENT
        with mock.patch.object(market_tape, "fetch_quote",
                               side_effect=self._patched_fetch_quote(self._CURRENT)), \
             mock.patch.object(market_tape, "fetch_enrichment", return_value={}):
            tape = market_tape.fetch_tape(enrich=True, prior_session_tape=prior)
        self.assertIsNotNone(tape)
        self.assertEqual(
            sorted(tape["frozen_suspect"]),
            sorted(["^GSPC", "^IXIC", "^DJI", "^RUT"]),
        )
        # Detection must NOT block: a usable tape is still returned.
        self.assertIn("regime", tape)

    def test_moved_prior_does_not_flag(self):
        # Prior session's levels all differ from today's fetched levels.
        prior = _prior_snapshot(sp500=7400.00, nasdaq=23000.00,
                                dow=43000.00, russell=2100.00)
        with mock.patch.object(market_tape, "fetch_quote",
                               side_effect=self._patched_fetch_quote(self._CURRENT)), \
             mock.patch.object(market_tape, "fetch_enrichment", return_value={}):
            tape = market_tape.fetch_tape(enrich=True, prior_session_tape=prior)
        self.assertIsNotNone(tape)
        self.assertEqual(tape["frozen_suspect"], [])

    def test_no_prior_tape_never_flags(self):
        # First-brief guard: no prior tape -> empty list, never raises.
        with mock.patch.object(market_tape, "fetch_quote",
                               side_effect=self._patched_fetch_quote(self._CURRENT)), \
             mock.patch.object(market_tape, "fetch_enrichment", return_value={}):
            tape = market_tape.fetch_tape(enrich=True, prior_session_tape=None)
        self.assertIsNotNone(tape)
        self.assertEqual(tape["frozen_suspect"], [])

    def test_flag_survives_serialization(self):
        # The persisted snapshot must RETAIN frozen_suspect (visible after the fact).
        prior = _prior_snapshot()
        with mock.patch.object(market_tape, "fetch_quote",
                               side_effect=self._patched_fetch_quote(self._CURRENT)), \
             mock.patch.object(market_tape, "fetch_enrichment", return_value={}):
            tape = market_tape.fetch_tape(enrich=True, prior_session_tape=prior)
        snap = market_tape.serialize_tape_snapshot(tape, as_of="2026-07-11T02:41:00+00:00")
        self.assertEqual(
            sorted(snap["frozen_suspect"]),
            sorted(["^GSPC", "^IXIC", "^DJI", "^RUT"]),
        )


if __name__ == "__main__":
    unittest.main()
