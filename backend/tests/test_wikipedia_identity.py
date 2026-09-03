"""
Tests for the Wikipedia IDENTITY guard and the verbatim rule.

OFFLINE AND DETERMINISTIC. Every page in
`fixtures/wikipedia_identity_landings.json` was recorded from a live
en.wikipedia.org / www.wikidata.org run, so these assertions are made against
what the API actually returned rather than against invented data, and they make
zero network calls. `backend/data/wikidata_class_verdicts.json` carries the
resolved P279 class graph from the same run.

THE TWO PROPERTIES UNDER TEST
-----------------------------
1. THE GUARD. Not one of the 20 naive Wikidata-sitelink landings that the
   302-name census hand-adjudicated as WRONG may reach the `accept` verdict.
   That set is the whole reason the guard exists: without it, /company/vanguard
   renders a 1981 arcade game and /company/cummins renders a surname list.

2. THE VERBATIM RULE. Nothing between the fetched extract and the storage
   payload may shorten, pad, ellipsise or otherwise modify the paragraph. A
   modified paragraph is Adapted Material under CC BY-SA 4.0 section 1(a) and
   would fire the ShareAlike condition in section 3(b) on Signalera's own prose.

Run:  .venv/bin/python -m unittest backend.tests.test_wikipedia_identity -v
"""

import json
import os
import unittest

from backend.wikipedia_identity import (
    Adjudication,
    ClassGraph,
    PageFetch,
    adjudicate,
    assert_verbatim,
    description_names_a_commercial_organisation,
    first_paragraph,
    name_in_lead,
    storage_payload,
    surname_or_disambiguation,
    VerbatimViolation,
)

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, "fixtures", "wikipedia_identity_landings.json")
CLASS_CACHE = os.path.join(os.path.dirname(HERE), "data", "wikidata_class_verdicts.json")

with open(FIXTURE, encoding="utf-8") as _f:
    LANDINGS = json.load(_f)
with open(CLASS_CACHE, encoding="utf-8") as _f:
    GRAPH = ClassGraph(json.load(_f))

# The 20 names whose naive Wikidata sitelink landed on the wrong entity in the
# 302-name census. 7.1 percent of the 280 names that carried a QID.
KNOWN_WRONG = [
    "Cummins", "Schlumberger", "Harvey", "Ledger", "Pilot", "Uzum",
    "Perplexity", "Zip", "Needham", "Coherent", "Macquarie", "Slash",
    "Edward Jones", "Granola", "Vanguard", "Jane Street", "Udaan",
    "Pershing Square", "Walt Disney", "Tapestry",
]


def run(bucket: str, name: str) -> Adjudication:
    row = LANDINGS[bucket][name]
    return adjudicate(name, PageFetch(**row["page"]), row["p31"], GRAPH)


class TestDisambiguationGuard(unittest.TestCase):
    """Property 1. An empty page beats a wrong page."""

    def test_fixture_covers_every_known_wrong_entity(self):
        self.assertEqual(sorted(LANDINGS["naive"]), sorted(KNOWN_WRONG))
        self.assertEqual(len(KNOWN_WRONG), 20)

    def test_no_known_wrong_landing_is_ever_shipped(self):
        """The load-bearing assertion of the whole feature."""
        shipped = [n for n in KNOWN_WRONG if run("naive", n).verdict == "accept"]
        self.assertEqual(
            shipped, [],
            f"these wrong entities would have rendered on a company page: {shipped}",
        )

    def test_each_wrong_landing_names_a_reason(self):
        """A silent reject is a reject nobody can audit."""
        for name in KNOWN_WRONG:
            with self.subTest(name=name):
                self.assertTrue(run("naive", name).reasons, f"{name} rejected with no reason")

    def test_surname_pages_are_caught(self):
        for name in ["Cummins", "Schlumberger", "Harvey", "Ledger", "Pilot", "Uzum"]:
            with self.subTest(name=name):
                result = run("naive", name)
                self.assertEqual(result.verdict, "reject")
                self.assertTrue(any("S2_" in r or "S1_not_organisation" in r
                                    for r in result.reasons))

    def test_biography_pages_are_caught(self):
        """P31 human is an absolute veto: Walt Disney the man, Slash the musician."""
        for name in ["Walt Disney", "Slash", "Jane Street", "Edward Jones"]:
            with self.subTest(name=name):
                result = run("naive", name)
                self.assertEqual(result.verdict, "reject")
                self.assertEqual(result.p31_class, "reject")

    def test_video_games_are_caught(self):
        for name in ["Vanguard", "Perplexity"]:
            with self.subTest(name=name):
                self.assertEqual(run("naive", name).verdict, "reject")

    def test_places_are_caught(self):
        """`Needham, Massachusetts` is the case a plain reachability test ships.

        Wikidata models a New England town as reaching `organization` at 5 hops
        while reaching `human settlement` at 2, so the class check has to be
        closest-root rather than reachable-root.
        """
        for name in ["Needham", "Pershing Square", "Macquarie"]:
            with self.subTest(name=name):
                self.assertEqual(run("naive", name).verdict, "reject")

    def test_the_right_article_is_still_accepted(self):
        """The guard must not be a blanket reject: coverage is the other half."""
        recoverable = ["Cummins", "Schlumberger", "Uzum", "Perplexity", "Zip",
                       "Coherent", "Macquarie", "Slash", "Edward Jones",
                       "Vanguard", "Jane Street", "Pershing Square",
                       "Walt Disney", "Tapestry"]
        for name in recoverable:
            with self.subTest(name=name):
                result = run("correct", name)
                self.assertEqual(result.verdict, "accept", f"{name}: {result.reasons}")
                self.assertTrue(result.clears_floor)

    def test_renaissance_the_historical_period_is_not_a_company(self):
        """Regression. This shipped on S1 alone before S4 existed.

        Wikidata makes `cultural movement` a subclass of organisation, so the
        European Renaissance classified as a firm, its lead contains the typed
        name, and it is not a disambiguation page. Three signals passed. The
        Wikidata short description, "cultural movement that spanned the period
        ...", is what refuses it.
        """
        result = run("correct", "Renaissance")
        self.assertNotEqual(result.verdict, "accept")

    def test_other_fresh_adversarial_landings(self):
        """Apollo the Greek god and Citadel the fortress, held; two real firms, shipped."""
        for name in ["Apollo", "Citadel"]:
            with self.subTest(name=name):
                self.assertNotEqual(run("correct", name).verdict, "accept")
        for name in ["Lazard", "Cohere"]:
            with self.subTest(name=name):
                self.assertEqual(run("correct", name).verdict, "accept")


class TestSignalsInIsolation(unittest.TestCase):
    def test_s2_pageprop(self):
        fired, reason = surname_or_disambiguation(
            is_disambig_pageprop=True, short_description="", lead_text="Foo Ltd is a firm.")
        self.assertTrue(fired)
        self.assertIn("pageprops", reason)

    def test_s2_lead_text(self):
        fired, _ = surname_or_disambiguation(
            is_disambig_pageprop=False, short_description="",
            lead_text="Vanguard may refer to:")
        self.assertTrue(fired)

    def test_s2_passes_a_real_company(self):
        fired, _ = surname_or_disambiguation(
            is_disambig_pageprop=False, short_description="American investment firm",
            lead_text="Cinven Limited is a global private equity firm founded in 1977.")
        self.assertFalse(fired)

    def test_s3_strips_the_legal_suffix_on_the_typed_name(self):
        """`Cinven` must match a lead that opens `Cinven Limited is ...`."""
        in_window, _ = name_in_lead("Cinven", "Cinven Limited is a global private equity firm.")
        self.assertTrue(in_window)

    def test_s3_folds_the_ampersand(self):
        in_window, _ = name_in_lead(
            "Rothschild & Co", "Rothschild and Co SCA is a multinational investor.")
        self.assertTrue(in_window)

    def test_s3_catches_parent_substitution(self):
        """`BofA Securities` landing on the `Bank of America` article."""
        in_window, in_para = name_in_lead(
            "BofA Securities",
            "Bank of America is an American multinational investment bank and "
            "financial services holding company headquartered in Charlotte.")
        self.assertFalse(in_window)
        self.assertFalse(in_para)

    def test_s4_accepts_commercial_descriptions(self):
        for desc in ["American investment firm", "Canadian artificial intelligence company",
                     "British alternative investment manager", "international law firm",
                     "American hedge fund", "multinational bank"]:
            with self.subTest(desc=desc):
                self.assertTrue(description_names_a_commercial_organisation(desc)[0])

    def test_s4_refuses_non_commercial_descriptions(self):
        for desc in ["cultural movement that spanned the period", "1981 video game",
                     "family name", "god in Greek and later Roman mythology",
                     "red supergiant star", "town in Norfolk County, Massachusetts",
                     "subway station in Los Angeles", "type of fortress protecting a town",
                     # The Forterra class: an organisation, but not a firm. Measured
                     # on a 120-row production dry run against a row whose own
                     # sector is "Aerospace & Defense".
                     "land conservation, stewardship and community building "
                     "organization in Seattle, USA"]:
            with self.subTest(desc=desc):
                self.assertFalse(description_names_a_commercial_organisation(desc)[0])

    def test_s4_treats_an_absent_description_as_not_proven(self):
        """Absent is not a pass. 0 of 238 census positives had an empty one."""
        self.assertFalse(description_names_a_commercial_organisation("")[0])
        self.assertFalse(description_names_a_commercial_organisation(None)[0])


class TestVerbatimRule(unittest.TestCase):
    """Property 2. The licence rule as a code path, not a policy note."""

    LEAD = (
        "Cinven Limited is a global private equity firm founded in 1977, with offices "
        "in nine international locations.\n\nIt has raised eight funds."
    )

    def test_first_paragraph_selects_and_does_not_shorten(self):
        para = first_paragraph(self.LEAD)
        self.assertIn(para, self.LEAD)
        self.assertTrue(para.endswith("locations."))
        self.assertNotIn("\n", para)

    def test_first_paragraph_has_no_length_cap(self):
        """A 4,000-character paragraph comes back at 4,000 characters."""
        long_para = "A" * 4000 + " Corp is a company."
        self.assertEqual(len(first_paragraph(long_para)), len(long_para))

    def test_assert_verbatim_accepts_an_untouched_paragraph(self):
        assert_verbatim(first_paragraph(self.LEAD), self.LEAD)

    def test_assert_verbatim_rejects_a_slice(self):
        para = first_paragraph(self.LEAD)
        with self.assertRaises(VerbatimViolation):
            assert_verbatim(para[:80], para)

    def test_assert_verbatim_rejects_an_ellipsis(self):
        para = first_paragraph(self.LEAD)
        with self.assertRaises(VerbatimViolation):
            assert_verbatim(para[:80] + "...", para)
        with self.assertRaises(VerbatimViolation):
            assert_verbatim(para[:80] + "…", para)

    def test_assert_verbatim_rejects_edge_whitespace(self):
        with self.assertRaises(VerbatimViolation):
            assert_verbatim("  " + first_paragraph(self.LEAD), self.LEAD)

    def test_assert_verbatim_rejects_a_rewrite(self):
        with self.assertRaises(VerbatimViolation):
            assert_verbatim("Cinven is a PE firm.", self.LEAD)

    def test_assert_verbatim_rejects_empty(self):
        with self.assertRaises(VerbatimViolation):
            assert_verbatim("", self.LEAD)

    def test_storage_payload_is_byte_identical_to_the_fetched_paragraph(self):
        result = run("correct", "Vanguard")
        self.assertEqual(result.verdict, "accept")
        payload = storage_payload(result, "2026-09-02T00:00:00+00:00")
        self.assertEqual(payload["description"], result.paragraph)
        self.assertEqual(len(payload["description"]), result.paragraph_chars)
        assert_verbatim(payload["description"], result.paragraph)

    def test_storage_payload_carries_every_attribution_field(self):
        """A paragraph with no source link cannot be rendered compliantly."""
        payload = storage_payload(run("correct", "Vanguard"),
                                  "2026-09-02T00:00:00+00:00")
        for field in ("description_source_url", "description_source_title",
                      "description_source_revid", "description_license",
                      "description_license_url", "description_fetched_at"):
            with self.subTest(field=field):
                self.assertTrue(payload[field], f"{field} is empty")
        self.assertEqual(payload["description_license"], "CC BY-SA 4.0")
        self.assertTrue(payload["description_source_url"].startswith(
            "https://en.wikipedia.org/wiki/"))

    def test_storage_payload_refuses_a_non_accept_verdict(self):
        held = run("naive", "Vanguard")
        self.assertNotEqual(held.verdict, "accept")
        with self.assertRaises(ValueError):
            storage_payload(held, "2026-09-02T00:00:00+00:00")

    def test_long_paragraphs_are_stored_whole(self):
        """The Walt Disney Company's lead is 3,270 characters and ships at 3,270."""
        result = run("correct", "Walt Disney")
        self.assertEqual(result.verdict, "accept")
        self.assertGreater(result.paragraph_chars, 1000)
        payload = storage_payload(result, "2026-09-02T00:00:00+00:00")
        self.assertEqual(len(payload["description"]), result.paragraph_chars)


class TestIdentityFloor(unittest.TestCase):
    def test_a_paragraph_below_the_floor_is_not_shipped(self):
        page = PageFetch(
            requested_title="Tiny Co", resolved_title="Tiny Co", qid="Q1", revid=1,
            short_description="American company", extract="Tiny Co is a company.")
        graph = ClassGraph({"verdicts": {"Q4830453": "org"}, "labels": {}})
        result = adjudicate("Tiny Co", page, ["Q4830453"], graph)
        self.assertLess(result.paragraph_chars, 74)
        self.assertFalse(result.clears_floor)
        self.assertNotEqual(result.verdict, "accept")


if __name__ == "__main__":
    unittest.main()
