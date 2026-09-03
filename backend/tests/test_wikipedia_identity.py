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

import inspect
import json
import os
import re
import unicodedata
import unittest

from backend.scripts import backfill_wikipedia_identity as runner
from backend.scripts.backfill_wikipedia_identity import build_parser, verbatim_gate
from backend import wikipedia_identity
from backend.wikipedia_identity import (
    Adjudication,
    ClassGraph,
    PageFetch,
    adjudicate,
    assert_verbatim,
    defining_clause,
    description_names_a_commercial_organisation,
    first_paragraph,
    list_header_reason,
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
        assert_verbatim(first_paragraph(self.LEAD), source_extract=self.LEAD)

    def test_assert_verbatim_rejects_a_slice(self):
        """CUT AT 79 AND 81, NOT AT 80, AND THE THREE ARE NOT INTERCHANGEABLE.

        This test used to cut at index 80 and passed for a reason that had
        nothing to do with what it claims. `self.LEAD[79]` is a space, so
        `para[:80]` carries trailing whitespace and the edge-whitespace rule
        fired. The containment rule it was written to exercise was never
        reached, and it accepted `para[:79]` and `para[:81]` in silence.
        """
        para = first_paragraph(self.LEAD)
        self.assertEqual(para[79], " ", "the accident this test was written around")
        for cut in (60, 79, 81, len(para) - 1):
            with self.subTest(cut=cut):
                self.assertEqual(para[:cut], para[:cut].strip(),
                                 "cut point must not land on whitespace, "
                                 "or this test proves the wrong rule again")
                with self.assertRaises(VerbatimViolation):
                    assert_verbatim(para[:cut], source_extract=para)

    def test_assert_verbatim_rejects_a_paragraph_compared_against_itself(self):
        """THE SHIPPED DEFECT, AS A TEST. `assert_verbatim(x, x)` was the call.

        Containment of a string in itself is unconditionally true, so the old
        rule passed every one of these. Paragraph equality does not: a rewrite
        and a truncation are not paragraphs of the real extract, whatever they
        are compared against.
        """
        para = first_paragraph(self.LEAD)
        # NFD needs a page that actually carries a composed character. Lazard's
        # captured extract does; the ASCII fixture above does not, and asserting
        # NFD against ASCII text would be an assertion that cannot fail.
        lazard = run("correct", "Lazard")
        self.assertNotEqual(unicodedata.normalize("NFD", lazard.paragraph),
                            lazard.paragraph, "fixture must be NFD-sensitive")
        for label, mutated, source in [
            ("truncation", para[:60], self.LEAD),
            ("model rewrite", "Cinven is a private equity firm.", self.LEAD),
            ("NBSP substitution", para.replace(" ", "\u00a0"), self.LEAD),
            ("whitespace collapse", " ".join(self.LEAD.split()), self.LEAD),
            ("NFD re-normalisation",
             unicodedata.normalize("NFD", lazard.paragraph), lazard.source_extract),
        ]:
            with self.subTest(mutation=label):
                with self.assertRaises(VerbatimViolation):
                    assert_verbatim(mutated, source_extract=source)

    def test_assert_verbatim_will_not_take_its_source_positionally(self):
        """Keyword-only, so the same-value-twice call cannot be typed by accident."""
        para = first_paragraph(self.LEAD)
        with self.assertRaises(TypeError):
            assert_verbatim(para, self.LEAD)  # type: ignore[misc]

    def test_assert_verbatim_rejects_an_ellipsis(self):
        para = first_paragraph(self.LEAD)
        with self.assertRaises(VerbatimViolation):
            assert_verbatim(para[:80] + "...", source_extract=para)
        with self.assertRaises(VerbatimViolation):
            assert_verbatim(para[:80] + "…", source_extract=para)

    def test_assert_verbatim_rejects_edge_whitespace(self):
        with self.assertRaises(VerbatimViolation):
            assert_verbatim("  " + first_paragraph(self.LEAD), source_extract=self.LEAD)

    def test_assert_verbatim_rejects_a_rewrite(self):
        with self.assertRaises(VerbatimViolation):
            assert_verbatim("Cinven is a PE firm.", source_extract=self.LEAD)

    def test_assert_verbatim_rejects_empty(self):
        with self.assertRaises(VerbatimViolation):
            assert_verbatim("", source_extract=self.LEAD)

    def test_assert_verbatim_rejects_an_empty_source_extract(self):
        """No extract is no evidence. It must not read as a pass."""
        with self.assertRaises(VerbatimViolation):
            assert_verbatim(first_paragraph(self.LEAD), source_extract="")

    def test_assert_verbatim_accepts_a_later_paragraph_of_the_same_extract(self):
        """The rule is paragraph alignment, not first-paragraph-only."""
        assert_verbatim("It has raised eight funds.", source_extract=self.LEAD)

    def test_adjudication_carries_the_extract_its_paragraph_came_from(self):
        """The missing field that made the runner's gate unwireable."""
        result = run("correct", "Vanguard")
        page = LANDINGS["correct"]["Vanguard"]["page"]
        self.assertEqual(result.source_extract, page["extract"])
        assert_verbatim(result.paragraph, source_extract=result.source_extract)

        # And on a page whose extract really does hold more than the stored
        # paragraph, the two are different strings. Vanguard's captured extract
        # separates its paragraphs with single newlines rather than blank
        # lines, so `first_paragraph` returns the whole lead there and the two
        # coincide; that is a property of the capture, not of the field.
        multi = PageFetch(
            requested_title="Tiny Co", resolved_title="Tiny Co", qid="Q1", revid=1,
            short_description="American company",
            extract=("Tiny Co is an American company founded in 1998 and based "
                     "in Delaware.\n\nIt was acquired in 2011."))
        graph = ClassGraph({"verdicts": {"Q4830453": "org"}, "labels": {}})
        second = adjudicate("Tiny Co", multi, ["Q4830453"], graph)
        self.assertEqual(second.source_extract, multi.extract)
        self.assertNotEqual(second.source_extract, second.paragraph)
        assert_verbatim(second.paragraph, source_extract=second.source_extract)

    def test_storage_payload_is_byte_identical_to_the_fetched_paragraph(self):
        result = run("correct", "Vanguard")
        self.assertEqual(result.verdict, "accept")
        payload = storage_payload(result, "2026-09-02T00:00:00+00:00")
        self.assertEqual(payload["description"], result.paragraph)
        self.assertEqual(len(payload["description"]), result.paragraph_chars)
        assert_verbatim(payload["description"], source_extract=result.source_extract)

    def test_storage_payload_refuses_a_paragraph_the_extract_does_not_contain(self):
        """THE GATE, AT THE ONLY CHOKEPOINT THAT MATTERS.

        `storage_payload()` reads both sides of the comparison off the one
        `Adjudication`, so no caller can hand it a paragraph as its own source.
        Every mutation below is a licence breach and every one of them reached
        the database under the previous call.
        """
        for label, mutate in [
            ("truncation", lambda p: p[:120]),
            ("ellipsis", lambda p: p[:120] + "..."),
            ("model rewrite", lambda p: "Vanguard is an American asset manager."),
            ("NBSP substitution", lambda p: p.replace(" ", "\u00a0")),
            ("whitespace collapse", lambda p: " ".join(p.split())),
        ]:
            with self.subTest(mutation=label):
                result = run("correct", "Vanguard")
                result.paragraph = mutate(result.paragraph)
                with self.assertRaises(VerbatimViolation):
                    storage_payload(result, "2026-09-02T00:00:00+00:00")

    def test_storage_payload_refuses_an_extract_from_a_different_page(self):
        """Right paragraph, wrong provenance, is still not a reproduction."""
        result = run("correct", "Vanguard")
        result.source_extract = run("correct", "Lazard").source_extract
        with self.assertRaises(VerbatimViolation):
            storage_payload(result, "2026-09-02T00:00:00+00:00")

    def test_the_runner_gate_compares_against_the_extract_and_not_itself(self):
        """The seam the backfill actually calls, not a hand-written copy of it.

        `verbatim_gate` is imported from the runner module. Reverting it to
        `assert_verbatim(result.paragraph, result.paragraph)` turns every
        subTest below green-to-red.
        """
        for label, mutate in [
            ("truncation", lambda p: p[:120]),
            ("model rewrite", lambda p: "Vanguard is an American asset manager."),
            ("NBSP substitution", lambda p: p.replace(" ", "\u00a0")),
        ]:
            with self.subTest(mutation=label):
                result = run("correct", "Vanguard")
                result.paragraph = mutate(result.paragraph)
                with self.assertRaises(VerbatimViolation):
                    verbatim_gate(result)

    def test_the_runner_gate_passes_an_untouched_row(self):
        """The other half: the gate must not be a blanket reject."""
        verbatim_gate(run("correct", "Vanguard"))

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


class TestS4ReadsTheLead(unittest.TestCase):
    """S4 recall and precision, pinned to pages captured from a live run.

    Every page in the `s4` fixture bucket was recorded with its pageid and
    revid from en.wikipedia.org during the measurement that produced these
    numbers. Measured on 500 FRESH production names, none of them from the
    302-name census S4's vocabulary was fitted to:

      S4 as shipped (description only)          admits 191 of 200, blocks 9
      S4 loosened (description or lead clause)  admits 193 of 200, blocks 7

    and the accept set grew by exactly two, both hand-adjudicated correct, with
    zero new wrong entities. The four names below were outside that sample and
    are the reason the loosening exists at all: every one is a real firm the
    shipped rule blocked.
    """

    def test_the_four_named_recall_cases_are_recovered(self):
        for name in ["OpenAI", "National Australia Bank", "Bugatti",
                     "Fiduciary Trust Company"]:
            with self.subTest(name=name):
                result = run("s4", name)
                self.assertEqual(result.verdict, "accept",
                                 f"{name}: {result.reasons}")

    def test_those_four_all_failed_on_the_short_description_alone(self):
        """The half of the claim that makes the other half worth anything.

        If these already passed on the description, reading the lead bought
        nothing and the loosening would be pure precision risk.
        """
        for name in ["OpenAI", "National Australia Bank", "Bugatti",
                     "Fiduciary Trust Company"]:
            with self.subTest(name=name):
                page = PageFetch(**LANDINGS["s4"][name]["page"])
                self.assertFalse(
                    description_names_a_commercial_organisation(page.short_description)[0],
                    f"{name} passes on the description alone, so it is not a recall case",
                )

    def test_an_absent_short_description_is_no_longer_an_automatic_hold(self):
        """`Oncolytics Biotech` carries no Wikidata description at all and its
        own first sentence says "is a biotech company"."""
        page = PageFetch(**LANDINGS["s4"]["Oncolytics Biotech"]["page"])
        self.assertEqual(page.short_description, "")
        self.assertEqual(run("s4", "Oncolytics Biotech").verdict, "accept")

    def test_a_product_noun_in_the_description_no_longer_blocks_the_firm(self):
        """`Expedia` is described as a "travel website"."""
        page = PageFetch(**LANDINGS["s4"]["Expedia"]["page"])
        self.assertEqual(page.short_description, "travel website")
        self.assertEqual(run("s4", "Expedia").verdict, "accept")

    def test_the_window_is_sentence_one_and_not_the_paragraph(self):
        """KBRA is THE reason. A Texas radio station on a row meaning Kroll
        Bond Rating Agency, clearing S1, S2 and S3. Its first sentence says
        "radio station"; "Cobra Broadcasting, LLC" is one sentence later."""
        page = PageFetch(**LANDINGS["s4"]["KBRA"]["page"])
        para = first_paragraph(page.extract)
        self.assertIn("LLC", para, "fixture must still carry the trap")
        self.assertNotIn("LLC", defining_clause(para))
        self.assertNotEqual(run("s4", "KBRA").verdict, "accept")

    def test_the_window_drops_the_relative_clause(self):
        """The Federal Open Market Committee is a committee, and the word
        "securities" in its lead is a thing it trades rather than a thing it
        is. On the full sentence it read as a commercial firm."""
        page = PageFetch(**LANDINGS["s4"]["Federal Open Market Committee"]["page"])
        para = first_paragraph(page.extract)
        self.assertIn("securities", para)
        self.assertNotIn("securities", defining_clause(para))
        self.assertNotEqual(run("s4", "Federal Open Market Committee").verdict, "accept")

    def test_a_sports_league_is_still_not_a_firm(self):
        self.assertNotEqual(run("s4", "Major League Baseball").verdict, "accept")

    def test_the_legal_suffix_does_not_end_the_sentence(self):
        """"Expedia Inc. is an American online travel agency" is one sentence.
        Splitting on the period after "Inc" throws the defining clause away."""
        clause = defining_clause(
            "Expedia Inc. is an American online travel agency owned by Expedia Group. "
            "It was founded in 1996.")
        self.assertIn("travel agency", clause)
        self.assertNotIn("founded in 1996", clause)

    def test_the_bar_is_still_commercial_and_not_merely_organisational(self):
        """The Forterra class. An organisation is not a firm, on either source."""
        self.assertFalse(description_names_a_commercial_organisation(
            "land conservation, stewardship and community building organization in Seattle",
            "Forterra, based in Seattle, Washington, US, is the state of Washington's "
            "largest land conservation, stewardship and community building organization "
            "dedicated solely to the region.",
        )[0])


class TestSetIndexStubs(unittest.TestCase):
    """The `Hyundai` defect: a set-index page written as prose.

    119 characters, so it clears the 74-character floor. P31 conglomerate, so
    S1 passes. No disambiguation pageprop, so S2 passed. Its own name in the
    first sentence, so S3 passes. Wikidata says "multinational conglomerate
    headquartered in Seoul", so S4 passes. Four signals, zero reasons, verdict
    `accept`, and what it ships is a sentence ending in a colon.
    """

    def test_hyundai_is_not_shipped(self):
        result = run("s4", "Hyundai")
        self.assertNotEqual(result.verdict, "accept",
                            f"set-index stub reached accept: {result.paragraph!r}")
        self.assertTrue(any("list_header" in r for r in result.reasons), result.reasons)

    def test_hyundai_passes_every_other_signal(self):
        """Named so the next reader knows no other signal can be asked to catch
        this. The page really is about a real conglomerate."""
        page = PageFetch(**LANDINGS["s4"]["Hyundai"]["page"])
        para = first_paragraph(page.extract)
        result = run("s4", "Hyundai")
        self.assertEqual(result.p31_class, "org")
        self.assertFalse(page.is_disambig_pageprop)
        self.assertTrue(name_in_lead("Hyundai", para)[0])
        self.assertGreaterEqual(len(para), 74)
        self.assertTrue(description_names_a_commercial_organisation(
            page.short_description, para)[0])

    def test_a_paragraph_ending_in_a_colon_is_a_list_header(self):
        self.assertTrue(list_header_reason("Worldpay is the name of two related companies:"))
        self.assertTrue(list_header_reason("Merck refers primarily to the German Merck "
                                           "family and three companies, including:"))

    def test_prose_is_not_a_list_header(self):
        self.assertEqual(list_header_reason(
            "Cinven Limited is a global private equity firm founded in 1977."), "")
        self.assertEqual(list_header_reason(""), "")


class TestRepairPassStaysOff(unittest.TestCase):
    """The candidate-title repair pass ships OFF and must stay off.

    Measured on a 63-name adversarial set: it recovered 46 held names and 14 to
    19 of those 46 were a DIFFERENT COMPANY SHARING THE NAME. `Apollo` to
    Apollo Education Group rather than Apollo Global Management, `Ares` to a
    firearms manufacturer rather than Ares Management, `Aurora` to an
    Australian LGBTQIA+ charity. Every one of them passed all four guard
    signals, because each really is an organisation whose lead contains the
    typed string. No string rule can see that class of error.

    These assertions run against the RUNNER'S OWN parser and the RUNNER'S OWN
    source, not against a restatement of them.
    """

    def test_the_repair_pass_is_off_by_default(self):
        args = build_parser().parse_args([])
        self.assertFalse(args.repair)
        self.assertFalse(args.apply, "the runner must also be dry-run by default")

    def test_the_search_rung_is_a_second_opt_in(self):
        signature = inspect.signature(wikipedia_identity.repair)
        self.assertIs(signature.parameters["use_search"].default, False)

    def test_no_environment_variable_can_enable_the_repair_pass(self):
        """An env-var switch is the shape that turns an off-by-default flag on
        in production without anyone typing it."""
        source = inspect.getsource(runner)
        reads = re.findall(r"os\.(?:environ\.get|getenv)\(\s*[\"']([A-Z0-9_]+)", source)
        self.assertEqual(
            sorted(set(reads)),
            ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"],
            "the runner reads an environment variable that is not a database credential",
        )

    def test_the_repair_call_is_gated_on_the_flag(self):
        """Pin the CALL, not the identifier. An import line satisfies a test
        that only greps for the name."""
        source = inspect.getsource(runner.main)
        self.assertIn("if args.repair:", source)
        gate = source.index("if args.repair:")
        call = source.index("repaired = repair(")
        self.assertLess(gate, call, "repair() is called outside the flag gate")


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
