"""Hermetic tests for the EDGAR CIK reconciliation. No DB, no network.

Every fixture below is a REAL shape measured against prod on 2026-09-06, with
the identities kept because they are what makes the cases legible. The four
that matter:

  cik 5981   AMERICAN VANGUARD CORP. Its facts point at a live row named
             "Vanguard" whose sec_cik is NULL. That row's name DISAGREES with
             the registrant, which is precisely why the CIK was cleared off it.
             Re-stamping it would restore the wrong identity the clear removed.
  cik 46765  Helmerich & Payne. Same shape, pointing at a row named "HP Inc.".
             backend/tests/test_cik_stamp_name_agreement.py already asserts
             names_agree("HP Inc.", "Helmerich & Payne, Inc.") is False, so
             this module and the write gate agree by construction.
  cik 103379 V F CORP. Facts exist and carry NO company_id, because the row was
             deleted and financial_facts.company_id is ON DELETE SET NULL.
  cik 1067839 INVESCO QQQ TRUST. A unit investment trust. It legitimately has
             no companies row and must never be alarmed on.

Run: python -m pytest backend/tests/test_cik_reconcile.py
"""
import json
import os
import unittest

from backend.edgar.cik_reconcile import (
    FILINGS_ONLY,
    RECEIVER_CANDIDATES,
    RECEIVER_EXACT,
    RECEIVER_NO_IDENTITY,
    RECEIVER_NONE,
    SAFE_POINTER,
    UNBOUND,
    WRONG_POINTER,
    ReconcileInputError,
    classify,
    find_receivers,
    render,
)
from backend.edgar.cik_reconcile import _index_by_token

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXPECTATIONS = os.path.join(REPO, "backend", "edgar", "cik_expectations.json")

WRONG_NAMED = {"id": "row-vanguard", "name": "Vanguard", "ticker": None, "sec_cik": None}
RIGHT_NAMED = {"id": "row-amvan", "name": "American Vanguard", "ticker": None, "sec_cik": None}
HP_WRONG = {"id": "row-hpinc", "name": "HP Inc.", "ticker": None, "sec_cik": None}
HP_RIGHT = {"id": "row-hp", "name": "Helmerich & Payne", "ticker": None, "sec_cik": None}
HEALTHY = {"id": "row-aapl", "name": "Apple", "ticker": "AAPL", "sec_cik": 320193}

REGISTRANTS = {
    5981: {"cik": 5981, "ticker": "AVD", "company_name": "AMERICAN VANGUARD CORP"},
    46765: {"cik": 46765, "ticker": "HP", "company_name": "Helmerich & Payne, Inc."},
    103379: {"cik": 103379, "ticker": "VFC", "company_name": "V F CORP"},
    320193: {"cik": 320193, "ticker": "AAPL", "company_name": "Apple Inc."},
    1067839: {"cik": 1067839, "ticker": "QQQ",
              "company_name": "INVESCO QQQ TRUST, SERIES 1"},
}


def run(**over):
    base = dict(
        fact_ciks={320193},
        filing_ciks={320193},
        fact_counts={},
        filing_counts={},
        companies=[HEALTHY],
        fact_pointers={},
        registrants=REGISTRANTS,
        expectations={},
    )
    base.update(over)
    return classify(**base)


class TestTheStrandingItExistsToCatch(unittest.TestCase):
    def test_cleared_identity_with_no_rehome_is_reported_by_cik(self):
        """The whole point. A CIK owning facts that no row claims must be NAMED."""
        r = run(
            fact_ciks={320193, 5981},
            fact_counts={5981: 2997},
            filing_counts={5981: 9},
            companies=[HEALTHY, WRONG_NAMED, RIGHT_NAMED],
            fact_pointers={5981: ["row-vanguard"]},
        )
        hits = r["unclaimed"][WRONG_POINTER]
        self.assertEqual([h["cik"] for h in hits], [5981])
        self.assertEqual(hits[0]["facts"], 2997)
        self.assertEqual(hits[0]["filings"], 9)
        self.assertTrue(r["alarm"])

    def test_the_wrongly_named_pointer_is_never_offered_as_the_receiver(self):
        """The clear was CORRECT. Nominating the row it cleared undoes it.

        This is the assertion that keeps the check from proposing the original
        defect as its own fix. "Vanguard" is where American Vanguard's CIK used
        to live and must not be where the check sends it back to.
        """
        r = run(
            fact_ciks={320193, 5981},
            fact_counts={5981: 2997},
            filing_counts={5981: 9},
            companies=[HEALTHY, WRONG_NAMED, RIGHT_NAMED],
            fact_pointers={5981: ["row-vanguard"]},
        )
        hit = r["unclaimed"][WRONG_POINTER][0]
        self.assertEqual(hit["pointer"]["name"], "Vanguard")
        self.assertFalse(hit["pointer"]["names_agree"])
        self.assertEqual(hit["receiver_verdict"], RECEIVER_EXACT)
        self.assertEqual(hit["receivers"][0]["name"], "American Vanguard")
        self.assertNotIn(WRONG_NAMED["id"], [rc["id"] for rc in hit["receivers"]])

    def test_hp_inc_is_not_a_receiver_for_helmerich_and_payne(self):
        r = run(
            fact_ciks={320193, 46765},
            fact_counts={46765: 3302},
            filing_counts={46765: 4},
            companies=[HEALTHY, HP_WRONG, HP_RIGHT],
            fact_pointers={46765: ["row-hpinc"]},
        )
        hit = r["unclaimed"][WRONG_POINTER][0]
        self.assertEqual([rc["id"] for rc in hit["receivers"]], ["row-hp"])

    def test_deleted_row_leaves_facts_unbound_and_still_alarms(self):
        """company_id is ON DELETE SET NULL, so a merge leaves a NULL pointer."""
        r = run(
            fact_ciks={320193, 103379},
            fact_counts={103379: 3087},
            filing_counts={103379: 12},
            companies=[HEALTHY],
            fact_pointers={103379: []},
        )
        self.assertEqual([h["cik"] for h in r["unclaimed"][UNBOUND]], [103379])
        self.assertTrue(r["alarm"])

    def test_a_dangling_pointer_counts_as_unbound_not_as_a_clear(self):
        r = run(
            fact_ciks={320193, 103379},
            fact_counts={103379: 3087},
            filing_counts={103379: 12},
            companies=[HEALTHY],
            fact_pointers={103379: ["row-that-no-longer-exists"]},
        )
        self.assertEqual([h["cik"] for h in r["unclaimed"][UNBOUND]], [103379])

    def test_an_uncheckable_pointer_is_never_called_safe(self):
        """The fail-open leak, found by mutation and not by reading.

        `names_agree` FAILS OPEN when there is no authority name, which is
        correct for a write gate whose cost model is "a rejection costs a
        missing identifier, never a wrong one". Here the same True means
        NOTHING WAS CHECKED, and SAFE_POINTER's whole meaning is "the name
        checks out, stamp the CIK back onto this row". Letting a no-authority
        verdict reach that bucket turns silence into an instruction.

        cik_tickers only lists CIKs SEC publishes with a ticker, so a delisted
        or fund CIK reaches this path in production, not just in a test.
        """
        r = run(
            fact_ciks={320193, 999001},
            fact_counts={999001: 500},
            filing_counts={999001: 1},
            companies=[HEALTHY, WRONG_NAMED],
            fact_pointers={999001: ["row-vanguard"]},
            registrants={},  # SEC lists no ticker for it, so no authority name
        )
        self.assertEqual(r["unclaimed"][SAFE_POINTER], [])
        hit = r["unclaimed"][WRONG_POINTER][0]
        self.assertEqual(hit["cik"], 999001)
        self.assertFalse(hit["pointer"]["names_agree"])
        self.assertIn("fail-open", hit["pointer"]["why"])
        self.assertIn("fail-open", render(r))

    def test_an_agreeing_pointer_is_a_separate_and_benign_bucket(self):
        """A row that merely lost its CIK is directly fixable and must not be
        reported next to the wrong-identity case, which is not."""
        r = run(
            fact_ciks={320193, 5981},
            fact_counts={5981: 2997},
            filing_counts={5981: 9},
            companies=[HEALTHY, RIGHT_NAMED],
            fact_pointers={5981: ["row-amvan"]},
        )
        self.assertEqual(r["unclaimed"][WRONG_POINTER], [])
        self.assertEqual([h["cik"] for h in r["unclaimed"][SAFE_POINTER]], [5981])


class TestItDoesNotCryWolf(unittest.TestCase):
    def test_a_reviewed_no_row_cik_is_listed_but_never_alarmed_on(self):
        r = run(
            fact_ciks={320193},
            filing_ciks={320193, 1067839},
            filing_counts={1067839: 2},
            fact_counts={},
            expectations={"no_company_row": [
                {"cik": 1067839, "reason": "unit investment trust",
                 "reviewed_on": "2026-09-06"}]},
        )
        self.assertEqual(r["unclaimed"][FILINGS_ONLY], [])
        self.assertEqual([h["cik"] for h in r["unclaimed"]["suppressed"]], [1067839])
        self.assertFalse(r["alarm"])

    def test_filings_without_facts_warn_but_do_not_alarm(self):
        """Nothing is unreachable when nothing was stored. This is the bucket
        the legitimately-unclaimed entities land in, so alarming on it is how
        the check would get muted."""
        r = run(
            fact_ciks={320193},
            filing_ciks={320193, 1067839},
            filing_counts={1067839: 2},
        )
        self.assertEqual([h["cik"] for h in r["unclaimed"][FILINGS_ONLY]], [1067839])
        self.assertFalse(r["alarm"])
        self.assertTrue(r["warnings"])

    def test_a_claimed_cik_owning_facts_is_never_a_coverage_gap(self):
        """Membership and count are separate inputs precisely so that a CIK
        present in fact_ciks but absent from fact_counts cannot read as zero."""
        r = run(fact_ciks={320193}, fact_counts={})
        self.assertEqual(r["no_facts"]["unexplained"], [])
        self.assertFalse(r["alarm"])


class TestTheReverseDirection(unittest.TestCase):
    def test_a_claiming_row_with_no_facts_is_reported(self):
        row = {"id": "row-dt", "name": "Deutsche Telekom AG",
               "ticker": "DTEGY", "sec_cik": 946770}
        r = run(companies=[HEALTHY, row], filing_counts={946770: 0})
        self.assertEqual([h["cik"] for h in r["no_facts"]["unexplained"]], [946770])
        self.assertTrue(r["alarm"])

    def test_a_reviewed_no_facts_cik_moves_out_of_the_alarm(self):
        row = {"id": "row-dt", "name": "Deutsche Telekom AG",
               "ticker": "DTEGY", "sec_cik": 946770}
        r = run(
            companies=[HEALTHY, row],
            filing_counts={946770: 0},
            expectations={"no_facts": [
                {"cik": 946770, "reason": "20-F filer under IFRS",
                 "reviewed_on": "2026-09-06"}]},
        )
        self.assertEqual(r["no_facts"]["unexplained"], [])
        self.assertEqual([h["cik"] for h in r["no_facts"]["expected"]], [946770])
        self.assertFalse(r["alarm"])


class TestTheExemptionListCannotRot(unittest.TestCase):
    def test_an_exemption_is_reported_spent_once_the_cik_owns_facts(self):
        row = {"id": "row-dt", "name": "Deutsche Telekom AG",
               "ticker": "DTEGY", "sec_cik": 946770}
        r = run(
            fact_ciks={320193, 946770},
            companies=[HEALTHY, row],
            expectations={"no_facts": [
                {"cik": 946770, "reason": "20-F filer under IFRS",
                 "reviewed_on": "2026-09-06"}]},
        )
        self.assertEqual([s["cik"] for s in r["stale_expectations"]], [946770])

    def test_an_exemption_is_reported_spent_once_a_row_claims_the_cik(self):
        row = {"id": "row-qqq", "name": "Invesco QQQ", "ticker": "QQQ",
               "sec_cik": 1067839}
        r = run(
            fact_ciks={320193, 1067839},
            filing_ciks={320193, 1067839},
            companies=[HEALTHY, row],
            expectations={"no_company_row": [
                {"cik": 1067839, "reason": "unit investment trust",
                 "reviewed_on": "2026-09-06"}]},
        )
        self.assertEqual([s["cik"] for s in r["stale_expectations"]], [1067839])

    def test_the_shipped_expectations_file_parses_and_is_fully_evidenced(self):
        with open(EXPECTATIONS) as fh:
            exp = json.load(fh)
        entries = exp.get("no_company_row", []) + exp.get("no_facts", [])
        self.assertTrue(entries)
        for e in entries:
            self.assertIsInstance(e["cik"], int, e)
            self.assertTrue(e.get("reason", "").strip(), e)
            self.assertTrue(e.get("reviewed_on", "").strip(), e)
            self.assertIn("forms", e, f"cik {e['cik']} carries no evidence")


class TestAReadFailureIsNeverACleanVerdict(unittest.TestCase):
    """Every guard here is pinned by MESSAGE, not by exception type.

    Found by mutation. Deleting the empty-companies guard left
    `assertRaises(ReconcileInputError)` green, because with no companies rows
    the fixture's own CIK becomes unclaimed and trips the MISSING-COUNT guard
    instead. The test passed while the thing it names was gone. Asserting on
    the type alone lets any sibling guard stand in for the one under test.
    """

    def test_empty_companies_raises_rather_than_reporting_clean(self):
        with self.assertRaisesRegex(ReconcileInputError, "companies came back empty"):
            run(companies=[])

    def test_empty_fact_universe_raises_rather_than_reporting_clean(self):
        with self.assertRaisesRegex(
            ReconcileInputError, "no financial_facts CIKs were read"
        ):
            run(fact_ciks=set())

    def test_an_unclaimed_fact_owner_without_a_count_raises(self):
        with self.assertRaisesRegex(
            ReconcileInputError, "no exact fact count was supplied"
        ):
            run(fact_ciks={320193, 5981}, fact_counts={}, filing_counts={5981: 9},
                fact_pointers={5981: []})


class TestReceiverSearch(unittest.TestCase):
    def test_an_unknown_registrant_nominates_nobody(self):
        """names_agree FAILS OPEN with no authority name, so an unguarded
        search would return True for every row and hand someone else's
        financial history to whichever one sorted first."""
        idx = _index_by_token([WRONG_NAMED, RIGHT_NAMED, HP_RIGHT])
        for missing in (None, "", "   "):
            recs, verdict = find_receivers(missing, idx)
            self.assertEqual(recs, [])
            self.assertEqual(verdict, RECEIVER_NO_IDENTITY)

    def test_a_registrant_of_initials_only_refuses_to_search(self):
        """Measured on prod: cik 103379 is 'V F CORP'. Two initials and a legal
        suffix leave no identity tokens, so there is nothing to search on and
        every answer would be a guess."""
        idx = _index_by_token([WRONG_NAMED, RIGHT_NAMED, HP_RIGHT])
        recs, verdict = find_receivers("V F CORP", idx)
        self.assertEqual(recs, [])
        self.assertEqual(verdict, RECEIVER_NO_IDENTITY)

    def test_a_row_with_no_identity_tokens_is_not_a_receiver(self):
        """Same fail-open hazard from the other side: a row named only of legal
        suffixes agrees with everything and must be rejected."""
        junk = {"id": "row-junk", "name": "Inc", "ticker": None, "sec_cik": None}
        idx = _index_by_token([junk])
        recs, verdict = find_receivers("AMERICAN VANGUARD CORP", idx)
        self.assertEqual(recs, [])
        self.assertEqual(verdict, RECEIVER_NONE)

    def test_a_generic_descriptor_row_is_never_reported_as_the_receiver(self):
        """Measured on prod: cik 1631596, KKR Real Estate Finance Trust, agreed
        with a row named 'Real estate company' under the subset rule. Two
        generic words are not an identity, and reporting that row as THE
        receiver would read as a proposal to hand KKR's financials to it."""
        junk = {"id": "row-generic", "name": "Real estate company",
                "ticker": None, "sec_cik": None}
        idx = _index_by_token([junk])
        recs, verdict = find_receivers("KKR Real Estate Finance Trust Inc.", idx)
        self.assertEqual(verdict, RECEIVER_CANDIDATES)
        self.assertNotEqual(verdict, RECEIVER_EXACT)
        self.assertEqual(recs[0]["strength"], "weak")

    def test_a_ratio_rhyme_is_never_reported_as_the_receiver(self):
        """Measured on prod: 'MAGNACHIP SEMICONDUCTOR Corp' matched 'Nexchip
        Semiconductor' at ratio 0.88, on a shared industry word."""
        rhyme = {"id": "row-nexchip", "name": "Nexchip Semiconductor",
                 "ticker": None, "sec_cik": None}
        idx = _index_by_token([rhyme])
        recs, verdict = find_receivers("MAGNACHIP SEMICONDUCTOR Corp", idx)
        self.assertEqual(verdict, RECEIVER_CANDIDATES)
        self.assertEqual(recs[0]["strength"], "weak")

    def test_an_exact_row_outranks_a_weak_one_and_is_reported_first(self):
        rhyme = {"id": "row-nexchip", "name": "Nexchip Semiconductor",
                 "ticker": None, "sec_cik": None}
        good = {"id": "row-magna", "name": "MagnaChip Semiconductor",
                "ticker": None, "sec_cik": None}
        idx = _index_by_token([rhyme, good])
        recs, verdict = find_receivers("MAGNACHIP SEMICONDUCTOR Corp", idx)
        self.assertEqual(verdict, RECEIVER_EXACT)
        self.assertEqual(recs[0]["id"], "row-magna")

    def test_two_equally_exact_rows_are_both_reported(self):
        dupe = {"id": "row-amvan-2", "name": "American  Vanguard",
                "ticker": None, "sec_cik": None}
        idx = _index_by_token([RIGHT_NAMED, dupe])
        recs, verdict = find_receivers("AMERICAN VANGUARD CORP", idx)
        self.assertEqual(verdict, RECEIVER_EXACT)
        self.assertEqual(len(recs), 2)

    def test_a_row_that_already_holds_a_cik_is_not_a_candidate(self):
        """Receivers come from the CIK-less rows only. companies_sec_cik_unique
        is a partial UNIQUE index, so stamping a second CIK onto a row that has
        one would be refused by the database anyway."""
        r = run(
            fact_ciks={320193, 5981},
            fact_counts={5981: 2997},
            filing_counts={5981: 9},
            companies=[HEALTHY, WRONG_NAMED,
                       dict(RIGHT_NAMED, sec_cik=999999)],
            fact_pointers={5981: ["row-vanguard"]},
        )
        self.assertEqual(
            r["unclaimed"][WRONG_POINTER][0]["receiver_verdict"], RECEIVER_NONE
        )


class TestTheReportNamesThings(unittest.TestCase):
    def test_render_prints_every_stranded_cik_not_just_a_count(self):
        r = run(
            fact_ciks={320193, 5981, 103379},
            fact_counts={5981: 2997, 103379: 3087},
            filing_counts={5981: 9, 103379: 12},
            companies=[HEALTHY, WRONG_NAMED, RIGHT_NAMED],
            fact_pointers={5981: ["row-vanguard"], 103379: []},
        )
        out = render(r)
        self.assertIn("5981", out)
        self.assertIn("103379", out)
        self.assertIn("2997", out)
        self.assertIn("American Vanguard", out)
        self.assertIn("ALARM", out)

    def test_render_says_clean_when_it_is(self):
        self.assertIn("Clean", render(run()))


if __name__ == "__main__":
    unittest.main()
