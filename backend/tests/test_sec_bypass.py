"""
Unit tests for the deterministic SEC bypass in backend/ingest.py:
  - _sec_bypass_decision: EDGAR title regex parse (filer/CIK), the item->relevance
    map, deal_type map, and the ~3% non-matching fallback (returns None -> LLM).
  - _apply_filter_with_sec_bypass: split SEC vs non-SEC, call the LLM only on the
    remainder, and merge back BY INDEX so results stay aligned with `fresh`.

NO Gemini / DB calls: _sec_bypass_decision is pure; the routing test passes a
stub filter_fn that records what it received.

Run from the repo root:
    python -m unittest backend.tests.test_sec_bypass
"""
import os
import sys
import unittest

os.environ.setdefault("GEMINI_API_KEY", "dummy-key-not-used")
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_ANON_KEY", "dummy-anon-not-used")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import ingest  # noqa: E402


def _sec(title, summary="", source=None):
    form = title.split(" - ")[0] if " - " in title else "8-K"
    return {"title": title, "summary": summary,
            "source": source or f"SEC {form}", "url": "u", "published_at": "p",
            "content_type": "full_text"}


class SecDecisionTest(unittest.TestCase):

    def test_10q_parsed_and_scored(self):
        d = ingest._sec_bypass_decision(_sec(
            "10-Q - Hewlett Packard Enterprise Co (0001645590) (Filer)"))
        self.assertIsNotNone(d)
        self.assertEqual(d["primary_company"], "Hewlett Packard Enterprise Co")
        self.assertEqual(d["companies"], [])
        self.assertEqual(d["sentiment"], "neutral")
        self.assertEqual(d["relevance_score"], 8)          # 10-Q -> 8
        self.assertEqual(d["deal_type"], "Earnings")
        self.assertTrue(d["relevant"])

    def test_8k_material_item_scores_8(self):
        d = ingest._sec_bypass_decision(_sec(
            "8-K - MUELLER INDUSTRIES INC (0000089439) (Filer)",
            "Filed: 2026-06-02 Item 8.01: Other Events Item 1.01: Material Agreement"))
        self.assertEqual(d["relevance_score"], 8)          # 1.01 is material
        self.assertEqual(d["deal_type"], "Other")          # no 2.02
        self.assertEqual(d["primary_company"], "MUELLER INDUSTRIES INC")

    def test_8k_routine_only_scores_6(self):
        d = ingest._sec_bypass_decision(_sec(
            "8-K - Federal Home Loan Bank of Chicago (0001331451) (Filer)",
            "Filed: 2026-06-02 Item 9.01: Financial Statements and Exhibits"))
        self.assertEqual(d["relevance_score"], 6)          # 9.01 routine only
        self.assertEqual(d["deal_type"], "Other")

    def test_8k_item_202_is_earnings(self):
        d = ingest._sec_bypass_decision(_sec(
            "8-K - Acme Corp (0000000123) (Filer)",
            "Item 2.02: Results of Operations and Financial Condition"))
        self.assertEqual(d["relevance_score"], 8)          # 2.02 is material
        self.assertEqual(d["deal_type"], "Earnings")

    def test_8k_no_items_stays_at_gate(self):
        d = ingest._sec_bypass_decision(_sec(
            "8-K - Some Filer Inc (0000000999) (Filer)", "Filed: 2026-06-02 (no items)"))
        self.assertEqual(d["relevance_score"], 6)          # >=6, coverage-neutral
        self.assertEqual(d["deal_type"], "Other")

    def test_every_sec_decision_is_above_gate(self):
        for t, s in [
            ("10-Q - X (0000000001) (Filer)", ""),
            ("8-K - Y (0000000002) (Filer)", "Item 7.01: Reg FD"),
            ("8-K - Z (0000000003) (Filer)", "Item 5.02: Departure"),
        ]:
            self.assertGreaterEqual(ingest._sec_bypass_decision(_sec(t, s))["relevance_score"], 6)

    def test_non_matching_titles_fall_back(self):
        # amendments / variant forms -> None -> normal LLM filter (never pinned)
        for t in [
            "8-K/A - MEDICAL EXERCISE INC. (0002001249) (Filer)",
            "10-Q/A - SunPower Inc. (0001838987) (Filer)",
            "8-K12B - Digimarc Parent, Inc. (0002119322) (Filer)",
            "Some weird SEC headline without the pattern",
        ]:
            self.assertIsNone(ingest._sec_bypass_decision(_sec(t, source="SEC 8-K")))

    def test_non_sec_source_returns_none(self):
        a = {"title": "8-K - Acme (0000000123) (Filer)", "summary": "",
             "source": "Yahoo", "url": "u", "published_at": "p"}
        self.assertIsNone(ingest._sec_bypass_decision(a))  # source not "SEC ..."


class RoutingTest(unittest.TestCase):

    def test_split_merge_by_index(self):
        seen = {}

        def stub_filter(arts):
            # record what the LLM received; return a marker result per article
            seen["arts"] = list(arts)
            return [{"relevant": True, "relevance_score": 7, "_via": "llm",
                     "primary_company": a["title"]} for a in arts]

        fresh = [
            {"title": "Apple earnings beat", "summary": "", "source": "Yahoo", "url": "1", "published_at": "p"},
            _sec("10-Q - HPE Co (0001645590) (Filer)"),
            {"title": "M&A: X buys Y", "summary": "", "source": "Reuters", "url": "2", "published_at": "p"},
            _sec("8-K - FHLB Chicago (0001331451) (Filer)", "Item 9.01: Exhibits"),
            _sec("8-K/A - Amend Co (0000000777) (Filer)", source="SEC 8-K"),  # falls back to LLM
        ]
        results, n_sec, n_llm = ingest._apply_filter_with_sec_bypass(fresh, stub_filter)

        # 2 SEC pinned (the matching 10-Q + 8-K), 3 to the LLM (2 non-SEC + 1 amendment)
        self.assertEqual(n_sec, 2)
        self.assertEqual(n_llm, 3)
        self.assertEqual(len(seen["arts"]), 3)
        self.assertNotIn("10-Q - HPE Co (0001645590) (Filer)", [a["title"] for a in seen["arts"]])
        self.assertIn("8-K/A - Amend Co (0000000777) (Filer)", [a["title"] for a in seen["arts"]])

        # results aligned with fresh by index
        self.assertEqual(len(results), len(fresh))
        self.assertEqual(results[0]["_via"], "llm")                       # Apple -> LLM
        self.assertEqual(results[1]["primary_company"], "HPE Co")        # SEC pinned
        self.assertNotIn("_via", results[1])                             # deterministic, not LLM
        self.assertEqual(results[1]["relevance_score"], 8)
        self.assertEqual(results[2]["_via"], "llm")                       # M&A -> LLM
        self.assertEqual(results[3]["relevance_score"], 6)               # SEC 8-K routine
        self.assertEqual(results[4]["_via"], "llm")                       # amendment -> LLM


if __name__ == "__main__":
    unittest.main()
