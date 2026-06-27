"""Unit tests for the D8 section-entity validator's _org_supported (#422 review fix).

The shipped #422 head-token fallback deemed a multi-word org supported when its
FIRST word appeared anywhere in the corpus. "Texas Pacific Land" was therefore
treated as supported because "texas" appears in "West Texas", so the exact
hallucination D8 must catch slipped through. The fix requires a distinctive
prefix match (>=2-token prefix, or a non-generic single first word), so a common
geographic/generic head can no longer vouch for the phrase.

No network, no DB: synthesize.py builds its Supabase + Gemini clients at import
time from env vars, so dummy values are set BEFORE the import (construction is
offline; nothing is sent). Same pattern as test_brief_synth_retry.py.

Run from repo root: python -m unittest backend.tests.test_org_supported_d8
"""
import os
import sys
import unittest
from pathlib import Path

os.environ.setdefault("SUPABASE_URL", "http://localhost")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service")
os.environ.setdefault("GEMINI_API_KEY", "test-gemini")

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import synthesize  # noqa: E402


class OrgSupportedD8(unittest.TestCase):
    def test_generic_head_does_not_vouch_for_hallucinated_org(self):
        # The shipped bug: "texas" present in the corpus ("West Texas") made
        # "Texas Pacific Land" look supported. It must now be flagged unsupported.
        corpus = "crude prices firmed as west texas intermediate rose on the day."
        allowed = set()
        self.assertFalse(
            synthesize._org_supported("texas pacific land", corpus, allowed),
            "a generic/geographic first word must not support a multi-word org",
        )

    def test_unsupported_org_absent_entirely_is_flagged(self):
        corpus = "the market rallied on chip strength and broad tech demand."
        self.assertFalse(
            synthesize._org_supported("texas pacific land", corpus, set()),
            "an org absent from corpus and roster must be unsupported",
        )

    def test_real_org_slightly_different_than_corpus_still_supported(self):
        # Avoid over-flagging: a real org named slightly differently than the
        # corpus (corpus has the two-word prefix) must remain supported.
        corpus = "abbvie agreed to acquire apogee therapeutics for $10.9 billion."
        self.assertTrue(
            synthesize._org_supported("abbvie therapeutics", corpus, set()),
            "a >=2-token corpus prefix (abbvie therapeutics) must support the org",
        )

    def test_distinctive_single_head_still_supports(self):
        # A non-generic distinctive first word present in the corpus still vouches
        # (e.g. "Qualcomm" -> "Qualcomm Incorporated"). Not over-restrictive.
        corpus = "qualcomm agreed to buy modular for $4 billion."
        self.assertTrue(
            synthesize._org_supported("qualcomm incorporated", corpus, set()),
            "a distinctive single head present in corpus must still support",
        )

    def test_roster_match_is_supported(self):
        self.assertTrue(
            synthesize._org_supported("texas pacific land", "", {"texas pacific land"}),
            "an org on the resolved-company roster is supported",
        )

    def test_exact_corpus_phrase_supported(self):
        corpus = "texas pacific land trust raised its dividend."
        self.assertTrue(
            synthesize._org_supported("texas pacific land", corpus, set()),
            "the full phrase present in the corpus is supported",
        )


if __name__ == "__main__":
    unittest.main()
