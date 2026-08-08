"""Deterministic tests for the claim-evidence matcher and daily pass.

Pure logic + a fake Supabase client. No network, no secrets, no model.
Run from repo root: python -m unittest backend.tests.test_claim_evidence
"""
import os
import sys
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
_REPO = os.path.dirname(_BACKEND)
for _p in (_BACKEND, _REPO):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from grading import claim_evidence as ce  # noqa: E402

TODAY = "2026-08-08"


def _claim(**kw):
    base = {
        "id": "claim-1",
        "claim_type": "ticker",
        "target_symbol": "ONTO",
        "expected_direction": "bullish",
        "evidence_entities": ["Onto Innovations", "ONTO"],
    }
    base.update(kw)
    return base


def _article(**kw):
    base = {
        "id": "art-1",
        "companies": ["ONTO"],
        "primary_company": "ONTO",
        "sector": "Technology",
        "sentiment": "bullish",
        "relevance_score": 7,
        "published_at": "2026-08-07T12:00:00+00:00",
    }
    base.update(kw)
    return base


class MatcherTests(unittest.TestCase):
    def test_agreeing_sentiment_plus_subject_records_supporting(self):
        rows = ce.match_articles_to_claim(_claim(), [_article(sentiment="bullish")], TODAY)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["stance"], "support")
        self.assertEqual(rows[0]["article_sentiment"], "bullish")
        self.assertEqual(rows[0]["claim_direction"], "bullish")
        self.assertEqual(rows[0]["match_basis"], "ticker")

    def test_opposing_sentiment_records_challenging(self):
        rows = ce.match_articles_to_claim(_claim(), [_article(sentiment="bearish")], TODAY)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["stance"], "challenge")

    def test_neutral_sentiment_records_nothing(self):
        rows = ce.match_articles_to_claim(_claim(), [_article(sentiment="neutral")], TODAY)
        self.assertEqual(rows, [])

    def test_unrelated_subject_records_nothing(self):
        art = _article(companies=["AAPL"], primary_company="AAPL")
        self.assertEqual(ce.match_articles_to_claim(_claim(), [art], TODAY), [])

    def test_same_story_twice_records_once(self):
        art = _article(id="dup")
        rows = ce.match_articles_to_claim(_claim(), [art, dict(art)], TODAY)
        self.assertEqual(len(rows), 1)

    def test_sector_claim_maps_etf_to_sector_label(self):
        claim = _claim(claim_type="sector", target_symbol="XLE", expected_direction="bearish", evidence_entities=["XLE"])
        art = _article(companies=[], primary_company="Exxon", sector="Energy & Oil/Gas", sentiment="bearish")
        rows = ce.match_articles_to_claim(claim, [art], TODAY)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["stance"], "support")  # bearish story agrees with bearish claim
        self.assertEqual(rows[0]["match_basis"], "sector")

    def test_index_and_aggregate_claims_never_match(self):
        for ct in ("index", "aggregate", "other"):
            claim = _claim(claim_type=ct, target_symbol="SPY")
            self.assertEqual(ce.match_articles_to_claim(claim, [_article()], TODAY), [])

    def test_neutral_claim_direction_records_nothing(self):
        rows = ce.match_articles_to_claim(_claim(expected_direction="neutral"), [_article()], TODAY)
        self.assertEqual(rows, [])

    def test_malformed_article_does_not_raise(self):
        # missing id, missing sentiment, None companies: skipped, never raises
        bad = [{"companies": None}, {"id": None}, {"id": "x"}]
        self.assertEqual(ce.match_articles_to_claim(_claim(), bad, TODAY), [])


class _FakeQuery:
    def __init__(self, data):
        self._data = data

    def _self(self, *a, **k):
        return self

    select = eq = neq = lte = gte = contains = order = limit = _self

    def execute(self):
        return type("R", (), {"data": self._data})()


class _FakeSB:
    """Routes table reads by name; captures the claim_evidence upsert."""

    def __init__(self, claims=None, articles=None):
        self._claims = claims or []
        self._articles = articles or []
        self.upserts = []
        self.tables_touched = []

    def table(self, name):
        self.tables_touched.append(name)
        if name == "user_claims":
            return _FakeQuery(self._claims)
        if name == "articles":
            return _FakeQuery(self._articles)
        if name == "claim_evidence":
            sb = self

            class _Upsertable(_FakeQuery):
                def upsert(self, rows, on_conflict=None, ignore_duplicates=None):
                    sb.upserts.append(
                        {"rows": rows, "on_conflict": on_conflict, "ignore_duplicates": ignore_duplicates}
                    )
                    return _FakeQuery(rows)

            return _Upsertable([])
        return _FakeQuery([])


class _RaisingSB:
    def table(self, *_a, **_k):
        raise RuntimeError("db down")


class PassTests(unittest.TestCase):
    def test_flag_off_writes_zero_and_touches_no_table(self):
        spy = _FakeSB(claims=[_claim(resolution_window_start="2026-08-01", resolution_window_end="2026-09-01", status="open")])
        summary = ce.run(sb=spy, env={"EVIDENCE_LEDGER_MODE": "off"})
        self.assertEqual(summary["mode"], "off")
        self.assertEqual(summary["written"], 0)
        self.assertEqual(spy.tables_touched, [])  # grading path byte-identical: DB untouched

    def test_unknown_flag_is_off(self):
        self.assertEqual(ce.evidence_ledger_mode({"EVIDENCE_LEDGER_MODE": "banana"}), "off")
        self.assertEqual(ce.evidence_ledger_mode({}), "off")

    def test_active_upserts_with_dedup_constraint(self):
        claim = _claim(resolution_window_start="2026-08-01", resolution_window_end="2026-09-01", status="open")
        sb = _FakeSB(claims=[claim])
        fetch = lambda _sb, **_k: [_article(sentiment="bullish")]
        summary = ce.run(sb=sb, env={"EVIDENCE_LEDGER_MODE": "active"}, fetch_fn=fetch)
        self.assertEqual(summary["written"], 1)
        self.assertEqual(len(sb.upserts), 1)
        # Idempotency is enforced by the table constraint, not convention:
        self.assertEqual(sb.upserts[0]["on_conflict"], "claim_id,article_id")
        self.assertTrue(sb.upserts[0]["ignore_duplicates"])

    def test_shadow_matches_but_writes_nothing(self):
        claim = _claim(resolution_window_start="2026-08-01", resolution_window_end="2026-09-01", status="open")
        sb = _FakeSB(claims=[claim])
        fetch = lambda _sb, **_k: [_article(sentiment="bullish")]
        summary = ce.run(sb=sb, env={"EVIDENCE_LEDGER_MODE": "shadow"}, fetch_fn=fetch)
        self.assertEqual(summary["matched"], 1)
        self.assertEqual(summary["written"], 0)
        self.assertEqual(sb.upserts, [])

    def test_matcher_exception_does_not_raise_into_caller(self):
        # active mode with a DB that raises on every call: run() must fail-open.
        summary = ce.run(sb=_RaisingSB(), env={"EVIDENCE_LEDGER_MODE": "active"})
        self.assertEqual(summary["written"], 0)
        self.assertIn("error", summary)


if __name__ == "__main__":
    unittest.main()
