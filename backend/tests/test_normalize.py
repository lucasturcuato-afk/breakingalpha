"""Unit tests for backend/normalize.py - see docs/w2-a-entity-resolution-design.md section 6."""
import unittest

from backend.normalize import normalize_lookup_key


class NormalizeLookupKeyTests(unittest.TestCase):
    """Fixtures must stay synchronized with src/lib/normalize.test.mjs."""

    def test_basic_lowercase(self):
        self.assertEqual(normalize_lookup_key("NVIDIA"), "nvidia")

    def test_already_lowercase(self):
        # NVIDIA / Nvidia / NVIDIA Corp shows the normalizer alone does NOT
        # solve dedup. Same key for first two, distinct for the third
        # (suffix is signal). Alias mapping handles the cross-form merge.
        self.assertEqual(normalize_lookup_key("Nvidia"), "nvidia")
        self.assertEqual(normalize_lookup_key("NVIDIA Corp"), "nvidia corp")

    def test_trademark_strip(self):
        # TM (\u2122) decomposes to "TM" under NFKC and would concatenate.
        # Stripping first prevents permagtm.
        self.assertEqual(normalize_lookup_key("Permag\u2122"), "permag")

    def test_registered_strip(self):
        self.assertEqual(normalize_lookup_key("Apple\u00ae"), "apple")

    def test_copyright_strip(self):
        self.assertEqual(normalize_lookup_key("Acme\u00a9"), "acme")

    def test_curly_apostrophe_folded(self):
        self.assertEqual(
            normalize_lookup_key("Moody\u2019s Analytics"),
            "moody's analytics",
        )

    def test_straight_apostrophe_already(self):
        self.assertEqual(
            normalize_lookup_key("Moody's Analytics"),
            "moody's analytics",
        )

    def test_whitespace_strip(self):
        self.assertEqual(normalize_lookup_key("  Tesla  "), "tesla")

    def test_accents_preserved_societe(self):
        # Accents are intentionally preserved (V1 limitation:
        # Societe-with-accent vs Societe-without-accent will not match).
        self.assertEqual(
            normalize_lookup_key("Soci\u00e9t\u00e9 G\u00e9n\u00e9rale"),
            "soci\u00e9t\u00e9 g\u00e9n\u00e9rale",
        )

    def test_accents_preserved_estee(self):
        self.assertEqual(
            normalize_lookup_key("Est\u00e9e Lauder"),
            "est\u00e9e lauder",
        )

    def test_typo_passes_through(self):
        # Normalizer is mechanical, not corrective. APPL stays APPL.
        # Backfill maps it to AAPL's canonical_id at the alias layer.
        self.assertEqual(normalize_lookup_key("APPL"), "appl")

    def test_empty_string(self):
        self.assertEqual(normalize_lookup_key(""), "")


if __name__ == "__main__":
    unittest.main()
