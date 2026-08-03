"""End-to-end proof that the falsifiability gate is applied in the real path.

The unit tests in test_call_falsifiability.py prove the gate's rules. This
proves the gate is actually reached by extract_and_persist_claims, that the rows
written to morning_brief_calls are the gated ones, and that a day where nothing
clears writes zero rows instead of inventing one.

The model response is the exact JSON shape that produced the five calls on
2026-07-27. No network and no DB: Gemini is mocked and the admin client is a
fake table that records what it was asked to insert.

Run from repo root: python -m unittest backend.tests.test_claims_gate_wiring
"""
import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

os.environ.setdefault("SUPABASE_URL", "http://localhost")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service")
os.environ.setdefault("GEMINI_API_KEY", "test-gemini")

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import synthesize  # noqa: E402

#: The five claims the model returned on 2026-07-27, verbatim.
TODAYS_MODEL_RESPONSE = json.dumps({
    "claims": [
        {
            "claim_text": "Oil prices will decline due to a pause in strikes between the U.S. and Iran.",
            "claim_type": "sector", "target_symbol": "XLE",
            "expected_direction": "bearish", "horizon_days": 0, "confidence": 0.8,
        },
        {
            "claim_text": "The Healthcare & Biotech sector will see continued M&A activity and consolidation.",
            "claim_type": "sector", "target_symbol": "XLV",
            "expected_direction": "bullish", "horizon_days": 21, "confidence": 0.75,
        },
        {
            "claim_text": ("Deviation from consensus on the PCE price index could trigger "
                           "significant shifts in risk appetite and sector-specific valuations."),
            "claim_type": "aggregate", "target_symbol": None,
            "expected_direction": "neutral", "horizon_days": 0, "confidence": 0.7,
        },
        {
            "claim_text": ("The healthcare services sector may face headwinds due to Ensign "
                           "Group's Q2 CY2026 sales being below analyst estimates."),
            "claim_type": "sector", "target_symbol": "XLV",
            "expected_direction": "bearish", "horizon_days": 0, "confidence": 0.7,
        },
        {
            "claim_text": ("A hawkish or dovish surprise from the FOMC rate decision will "
                           "directly impact rates and the curve."),
            "claim_type": "aggregate", "target_symbol": None,
            "expected_direction": "neutral", "horizon_days": 0, "confidence": 0.7,
        },
    ]
})

ALL_UNFALSIFIABLE_RESPONSE = json.dumps({
    "claims": [
        {
            "claim_text": "Watch for a reaction in risk appetite after the print.",
            "claim_type": "aggregate", "target_symbol": None,
            "expected_direction": "neutral", "horizon_days": 0, "confidence": 0.6,
        },
        {
            "claim_text": "The jobs number could move equities in either direction.",
            "claim_type": "index", "target_symbol": "SPY",
            "expected_direction": "bullish", "horizon_days": 0, "confidence": 0.6,
        },
    ]
})


class _FakeQuery:
    def __init__(self, table):
        self._table = table

    def delete(self):
        self._table.deletes += 1
        return self

    def eq(self, *_a, **_k):
        return self

    def insert(self, rows):
        self._table.inserted.append(rows)
        return self

    def execute(self):
        return mock.Mock(data=[])


class _FakeAdmin:
    def __init__(self):
        self.inserted = []
        self.deletes = 0

    def table(self, _name):
        return _FakeQuery(self)


class ClaimsGateWiring(unittest.TestCase):
    def _run(self, response):
        fake = _FakeAdmin()
        with mock.patch.object(synthesize, "gemini_generate", return_value=response), \
             mock.patch.object(synthesize, "supabase_admin", fake):
            n = synthesize.extract_and_persist_claims(
                brief_id="brief-test",
                brief_headline="Test brief",
                brief_summary="Test summary",
                brief_sections={},
            )
        return n, fake

    def test_todays_five_become_three_gradeable_rows(self):
        n, fake = self._run(TODAYS_MODEL_RESPONSE)
        self.assertEqual(3, n, "the two unfalsifiable conditionals must not be persisted")
        self.assertEqual(1, len(fake.inserted))
        rows = fake.inserted[0]
        self.assertEqual(3, len(rows))

        texts = [r["claim_text"] for r in rows]
        self.assertFalse(
            any("hawkish or dovish" in t for t in texts),
            "the FOMC conditional reached the database",
        )
        self.assertFalse(
            any("Deviation from consensus" in t for t in texts),
            "the PCE conditional reached the database",
        )

        for r in rows:
            self.assertIn(r["expected_direction"], ("bullish", "bearish"))
            self.assertTrue(r["target_symbol"])
            self.assertIsNotNone(r["resolve_on"])

        by_text = {r["claim_text"]: r for r in rows}
        ensign = next(r for t, r in by_text.items() if "Ensign" in t)
        oil = next(r for t, r in by_text.items() if "Oil prices" in t)
        ma = next(r for t, r in by_text.items() if "M&A" in t)

        # The read-through no longer resolves on the day it was made.
        self.assertGreater(ensign["resolve_on"], ensign["brief_date"])
        # A direct repricing event still does.
        self.assertEqual(oil["resolve_on"], oil["brief_date"])
        # The consolidation thesis keeps its three-week window.
        self.assertGreater(ma["resolve_on"], ma["brief_date"])

    def test_a_day_with_nothing_gradeable_writes_zero_rows(self):
        n, fake = self._run(ALL_UNFALSIFIABLE_RESPONSE)
        self.assertEqual(0, n)
        self.assertEqual([], fake.inserted, "nothing was fabricated to fill the slot")
        # The idempotent delete still runs so yesterday's calls are not left
        # standing as if they were today's.
        self.assertGreaterEqual(fake.deletes, 1)


if __name__ == "__main__":
    unittest.main()
