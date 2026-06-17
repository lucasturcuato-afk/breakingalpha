"""Unit tests for the deterministic filter-step logic in backend/ingest.py.

Scope: the three areas called out for coverage that the existing suite does not
already exercise.
  1. Ticker lookup / resolution for the Google News per-ticker feeds
     (_load_ticker_company_names, _build_gnews_url).
  2. Gemini response PARSING / fallback in filter_article (the json.loads path,
     markdown-fence stripping, and drop-to-None on malformed/empty output).
     The 429 backoff path is already covered by test_filter_backoff.py; this
     file covers the parse variants it does not.
  3. Pure parse helpers the filter consumes (validate_tags,
     extract_company_names), plus _filter_article_with_retry semantics and the
     filter_articles empty/single orchestration.

Already covered elsewhere (NOT duplicated here):
  - _sec_bypass_decision / _apply_filter_with_sec_bypass -> test_sec_bypass.py
  - partition_unseen_articles                            -> test_dedup_before_filter.py
  - is_blocked_entity / _clean_companies                 -> test_outlet_blocklist.py
  - filter_article 429 backoff / filter_articles align   -> test_filter_backoff.py

OVERNIGHT SAFETY (env override, not setdefault): every credential-bearing env
var ingest reads at import is OVERWRITTEN with an obvious dummy BEFORE importing
ingest. setdefault (used by the older tests) would silently reuse a real key
already present in the shell; override guarantees no real secret is ever loaded
into this run. ingest builds its Supabase + Gemini clients at module scope, but
neither makes a network call at construction, so dummy creds import cleanly. No
test makes a real network call; the Gemini and Supabase clients are mocked.

Runs under pytest (verify-py) and `python -m unittest backend.tests.test_ingest`.
"""

import json
import os
import sys
import unittest
from unittest.mock import patch

# Hard override (NOT setdefault) so a real key in the shell can never leak in.
# Credential-bearing vars read at import across ingest + watchlist + supabase_client.
for _k, _v in {
    "GEMINI_API_KEY": "dummy-gemini-key-not-used",
    "SUPABASE_URL": "http://localhost:54321",
    "SUPABASE_SERVICE_ROLE_KEY": "dummy-service-role-not-used",
    "SUPABASE_ANON_KEY": "dummy-anon-not-used",
    "NEWS_API_KEY": "dummy-news-key-not-used",
    "FINNHUB_API_KEY": "dummy-finnhub-key-not-used",
    # Non-secret tuning vars, read at import. Pinned for deterministic tests:
    # cap retries, effectively disable the wall-clock budget, small worker pool.
    "FILTER_MAX_RATE_RETRIES": "2",
    "FILTER_PHASE_BUDGET_SEC": "100000",
    "FILTER_PARALLEL_WORKERS": "2",
}.items():
    os.environ[_k] = _v

# Mirror the other ingest tests: put backend/ on sys.path so the bare sibling
# imports (`from watchlist import ...`) resolve under both pytest and unittest.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import ingest  # noqa: E402


class _FakeResponse:
    """Minimal stand-in for a google-genai response. Only .text is read by the
    filter parser; no usage_metadata so _accumulate_filter_usage no-ops."""

    def __init__(self, text):
        self.text = text


class _FakeQuery:
    """Fluent Supabase query stub: every builder method returns self and
    execute() yields a canned .data payload. `not_` is the property the real
    builder exposes before .is_(...)."""

    def __init__(self, data):
        self._data = data

    def table(self, *_a, **_k):
        return self

    def select(self, *_a, **_k):
        return self

    @property
    def not_(self):
        return self

    def is_(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def execute(self):
        return type("Resp", (), {"data": self._data})()


# ---------------------------------------------------------------------------
# 1. Ticker lookup / resolution
# ---------------------------------------------------------------------------
class TickerLookupTest(unittest.TestCase):
    def setUp(self):
        # _TICKER_COMPANY_NAMES is a module-level cache populated on first call.
        # Clear it before and after each test so cases do not bleed into each other.
        ingest._TICKER_COMPANY_NAMES.clear()

    def tearDown(self):
        ingest._TICKER_COMPANY_NAMES.clear()

    def test_load_happy_normalizes_case_and_whitespace(self):
        rows = [{"ticker": " a ", "name": "  Agilent Technologies  "},
                {"ticker": "nvda", "name": "NVIDIA"}]
        with patch.object(ingest, "supabase", _FakeQuery(rows)):
            mapping = ingest._load_ticker_company_names()
        # ticker upper+strip, name strip
        self.assertEqual(mapping["A"], "Agilent Technologies")
        self.assertEqual(mapping["NVDA"], "NVIDIA")

    def test_load_miss_returns_empty(self):
        with patch.object(ingest, "supabase", _FakeQuery([])):
            self.assertEqual(ingest._load_ticker_company_names(), {})

    def test_load_skips_rows_missing_ticker_or_name(self):
        rows = [{"ticker": "", "name": "No Ticker"},
                {"ticker": "X", "name": ""},
                {"ticker": "F", "name": "Ford"}]
        with patch.object(ingest, "supabase", _FakeQuery(rows)):
            mapping = ingest._load_ticker_company_names()
        self.assertEqual(mapping, {"F": "Ford"})

    def test_load_is_cached_after_first_call(self):
        rows = [{"ticker": "F", "name": "Ford"}]
        fake = _FakeQuery(rows)
        with patch.object(ingest, "supabase", fake):
            ingest._load_ticker_company_names()
        # Second call with a DIFFERENT backing store must still return the cache.
        with patch.object(ingest, "supabase", _FakeQuery([{"ticker": "T", "name": "AT&T"}])):
            mapping = ingest._load_ticker_company_names()
        self.assertEqual(mapping, {"F": "Ford"})

    def test_load_exception_is_swallowed(self):
        class _Boom:
            def table(self, *_a, **_k):
                raise RuntimeError("db down")
        with patch.object(ingest, "supabase", _Boom()):
            self.assertEqual(ingest._load_ticker_company_names(), {})

    def test_build_url_ambiguous_ticker_appends_company_words(self):
        rows = [{"ticker": "A", "name": "Agilent Technologies Inc"}]
        with patch.object(ingest, "supabase", _FakeQuery(rows)):
            url = ingest._build_gnews_url("A")
        # ambiguous ticker -> first two company words injected for disambiguation
        self.assertIn("Agilent", url)
        self.assertIn("Technologies", url)
        self.assertNotIn("Inc", url)  # only first two words
        self.assertTrue(url.startswith(ingest.GNEWS_PREFIX))
        self.assertIn("stock", url)

    def test_build_url_ambiguous_ticker_no_company_match(self):
        # Ambiguous ticker, but the lookup has no entry -> ticker + stock only.
        with patch.object(ingest, "supabase", _FakeQuery([])):
            url = ingest._build_gnews_url("A")
        self.assertTrue(url.startswith(ingest.GNEWS_PREFIX))
        self.assertIn("stock", url)
        self.assertIn("A", url)

    def test_build_url_non_ambiguous_skips_lookup(self):
        # NVDA is not ambiguous; no company words appended even if present.
        rows = [{"ticker": "NVDA", "name": "NVIDIA Corp"}]
        with patch.object(ingest, "supabase", _FakeQuery(rows)):
            url = ingest._build_gnews_url("NVDA")
        self.assertIn("NVDA", url)
        self.assertNotIn("NVIDIA", url)

    def test_build_url_dotted_ticker_uses_plus(self):
        # BRK.B -> dot replaced with '+' in the query token.
        url = ingest._build_gnews_url("BRK.B")
        self.assertIn("BRK", url)
        self.assertIn("B", url)
        self.assertNotIn("BRK.B", url)


# ---------------------------------------------------------------------------
# 2. Gemini response parsing / fallback (filter_article)
# ---------------------------------------------------------------------------
_VALID_DECISION = {
    "relevant": True,
    "relevance_score": 8,
    "relevance_reason": "earnings beat",
    "industry_verticals": ["Technology"],
    "activity_types": ["Earnings & Results"],
    "companies": [{"name": "Acme", "entity_type": "company"}],
    "themes": ["ai"],
    "sentiment": "bullish",
    "sentiment_reason": "guidance raised",
    "deal_type": "Other",
    "primary_company": "Acme",
}

_ARTICLE = {"title": "Acme beats", "summary": "Acme reported a beat", "source": "MarketWatch Top"}


def _patch_gemini(text):
    """Patch the filter Gemini call to return a canned _FakeResponse(text)."""
    return patch.object(
        ingest.gemini_client.models, "generate_content",
        lambda *a, **k: _FakeResponse(text),
    )


class GeminiParseTest(unittest.TestCase):
    def test_valid_json_parsed(self):
        with _patch_gemini(json.dumps(_VALID_DECISION)):
            out = ingest.filter_article(_ARTICLE)
        self.assertEqual(out, _VALID_DECISION)

    def test_markdown_fenced_json_is_unwrapped(self):
        fenced = "```json\n" + json.dumps(_VALID_DECISION) + "\n```"
        with _patch_gemini(fenced):
            out = ingest.filter_article(_ARTICLE)
        self.assertEqual(out["relevance_score"], 8)
        self.assertEqual(out["primary_company"], "Acme")

    def test_malformed_json_falls_back_to_none(self):
        with _patch_gemini("{not valid json"):
            self.assertIsNone(ingest.filter_article(_ARTICLE))

    def test_empty_text_falls_back_to_none(self):
        with _patch_gemini(""):
            self.assertIsNone(ingest.filter_article(_ARTICLE))

    def test_none_text_falls_back_to_none(self):
        with _patch_gemini(None):
            self.assertIsNone(ingest.filter_article(_ARTICLE))

    def test_unexpected_schema_returned_verbatim(self):
        # filter_article does NOT re-validate against FilterDecision; the SDK
        # response_schema is the guard and it is mocked here. Valid JSON of an
        # unexpected shape therefore passes through unchanged. This documents
        # the seam: schema enforcement lives at the SDK boundary, not here.
        with _patch_gemini(json.dumps({"foo": "bar"})):
            out = ingest.filter_article(_ARTICLE)
        self.assertEqual(out, {"foo": "bar"})


# ---------------------------------------------------------------------------
# 3a. _filter_article_with_retry semantics
# ---------------------------------------------------------------------------
class FilterRetryTest(unittest.TestCase):
    def test_first_call_success_no_retry(self):
        calls = []

        def _fa(_article):
            calls.append(1)
            return {"relevant": True}
        with patch.object(ingest, "filter_article", _fa):
            out = ingest._filter_article_with_retry({"title": "t"})
        self.assertEqual(out, {"relevant": True})
        self.assertEqual(len(calls), 1)

    def test_retry_after_first_none(self):
        seq = [None, {"relevant": True}]
        with patch.object(ingest, "filter_article", lambda _a: seq.pop(0)):
            out = ingest._filter_article_with_retry({"title": "t"})
        self.assertEqual(out, {"relevant": True})

    def test_both_calls_none_drops(self):
        with patch.object(ingest, "filter_article", lambda _a: None):
            self.assertIsNone(ingest._filter_article_with_retry({"title": "t"}))


# ---------------------------------------------------------------------------
# 3b. filter_articles orchestration (empty / single / mixed-None alignment)
# ---------------------------------------------------------------------------
class FilterArticlesOrchestrationTest(unittest.TestCase):
    def test_empty_pool_returns_empty(self):
        # Must short-circuit with zero filter calls.
        with patch.object(ingest, "_filter_article_with_retry",
                          lambda _a: self.fail("should not be called")):
            self.assertEqual(ingest.filter_articles([]), [])

    def test_single_article_kept(self):
        with patch.object(ingest, "_filter_article_with_retry", lambda _a: {"ok": True}):
            self.assertEqual(ingest.filter_articles([{"title": "a"}]), [{"ok": True}])

    def test_results_index_aligned_with_none_for_drops(self):
        arts = [{"title": "a"}, {"title": "b"}, {"title": "c"}]

        def _retry(article):
            return None if article["title"] == "b" else {"t": article["title"]}
        with patch.object(ingest, "_filter_article_with_retry", _retry):
            out = ingest.filter_articles(arts)
        self.assertEqual(out, [{"t": "a"}, None, {"t": "c"}])


# ---------------------------------------------------------------------------
# 3c. Pure parse helpers
# ---------------------------------------------------------------------------
class ValidateTagsTest(unittest.TestCase):
    WL = ["Technology", "Healthcare & Biotech", "Financial Services", "Energy"]

    def test_single_valid(self):
        self.assertEqual(ingest.validate_tags(["Technology"], self.WL), ["Technology"])

    def test_multiple_valid_preserves_order(self):
        self.assertEqual(ingest.validate_tags(["Energy", "Technology"], self.WL),
                         ["Energy", "Technology"])

    def test_unknown_dropped(self):
        self.assertEqual(ingest.validate_tags(["Technology", "FakeIndustry"], self.WL),
                         ["Technology"])

    def test_csv_inside_one_element_is_split(self):
        self.assertEqual(
            ingest.validate_tags(["Technology, Healthcare & Biotech"], self.WL),
            ["Technology", "Healthcare & Biotech"])

    def test_bare_string_input(self):
        self.assertEqual(ingest.validate_tags("Technology", self.WL), ["Technology"])

    def test_caps_at_max_count(self):
        wl = ["A", "B", "C", "D"]
        self.assertEqual(ingest.validate_tags(["A", "B", "C", "D"], wl, max_count=2),
                         ["A", "B"])

    def test_case_sensitive_match(self):
        self.assertEqual(ingest.validate_tags(["technology"], self.WL), [])

    def test_dedupes_preserving_first_seen(self):
        self.assertEqual(ingest.validate_tags(["Technology", "Technology"], self.WL),
                         ["Technology"])

    def test_non_list_non_str_returns_empty(self):
        self.assertEqual(ingest.validate_tags(123, self.WL), [])

    def test_non_string_elements_skipped(self):
        self.assertEqual(ingest.validate_tags([123, "Technology"], self.WL), ["Technology"])


class ExtractCompanyNamesTest(unittest.TestCase):
    def test_new_format_company(self):
        self.assertEqual(
            ingest.extract_company_names([{"name": "Acme", "entity_type": "company"}]),
            ["Acme"])

    def test_new_format_drops_non_company(self):
        raw = [{"name": "USA", "entity_type": "country"},
               {"name": "Acme", "entity_type": "company"}]
        self.assertEqual(ingest.extract_company_names(raw), ["Acme"])

    def test_old_format_bare_strings(self):
        self.assertEqual(ingest.extract_company_names(["Acme", "Beta"]), ["Acme", "Beta"])

    def test_mixed_formats(self):
        raw = [{"name": "Acme", "entity_type": "company"}, "Beta"]
        self.assertEqual(ingest.extract_company_names(raw), ["Acme", "Beta"])

    def test_empty_list(self):
        self.assertEqual(ingest.extract_company_names([]), [])

    def test_whitespace_is_stripped(self):
        self.assertEqual(
            ingest.extract_company_names([{"name": "  Acme  ", "entity_type": "company"}]),
            ["Acme"])

    def test_missing_name_skipped(self):
        self.assertEqual(ingest.extract_company_names([{"entity_type": "company"}]), [])

    def test_non_string_non_dict_skipped(self):
        self.assertEqual(ingest.extract_company_names([123]), [])

    def test_blank_bare_string_skipped(self):
        self.assertEqual(ingest.extract_company_names(["   "]), [])


# ---------------------------------------------------------------------------
# 3d. Ingest keyword blocklist pre-filter (matches_ingest_blocklist)
# ---------------------------------------------------------------------------
class IngestBlocklistTest(unittest.TestCase):
    def test_blocked_phrase_in_title(self):
        art = {"title": "Lead plaintiff deadline approaching for Acme", "summary": ""}
        self.assertTrue(ingest.matches_ingest_blocklist(art))

    def test_blocked_phrase_in_summary_only(self):
        art = {"title": "Acme update", "summary": "A securities class action was filed today"}
        self.assertTrue(ingest.matches_ingest_blocklist(art))

    def test_case_insensitive_match(self):
        # The function lowercases title+summary before matching.
        art = {"title": "SECURITIES CLASS ACTION FILED", "summary": ""}
        self.assertTrue(ingest.matches_ingest_blocklist(art))

    def test_clean_article_not_blocked(self):
        art = {"title": "Acme reports record quarterly earnings", "summary": "Revenue up 20%"}
        self.assertFalse(ingest.matches_ingest_blocklist(art))

    def test_empty_strings_not_blocked(self):
        self.assertFalse(ingest.matches_ingest_blocklist({"title": "", "summary": ""}))

    def test_missing_keys_not_blocked(self):
        # .get(...) or "" guards both missing keys -> no crash, returns False.
        self.assertFalse(ingest.matches_ingest_blocklist({}))

    def test_whitespace_only_not_blocked(self):
        self.assertFalse(ingest.matches_ingest_blocklist({"title": "   ", "summary": "   "}))

    def test_multiple_keywords_present(self):
        art = {"title": "class action lawsuit announced", "summary": "lead plaintiff named"}
        self.assertTrue(ingest.matches_ingest_blocklist(art))

    def test_near_miss_words_do_not_match(self):
        # Blocklist phrases must appear contiguously; loose related words do not.
        art = {"title": "Market leaders gather", "summary": "to discuss quarterly earnings"}
        self.assertFalse(ingest.matches_ingest_blocklist(art))


# ---------------------------------------------------------------------------
# 3e. HTML stripping (strip_html)
# ---------------------------------------------------------------------------
class StripHtmlTest(unittest.TestCase):
    def test_tags_removed_and_whitespace_collapsed(self):
        self.assertEqual(ingest.strip_html("<p>Hello <b>world</b></p>"), "Hello world")

    def test_html_entities_decoded(self):
        self.assertEqual(ingest.strip_html("AT&amp;T &#038; more"), "AT&T & more")

    def test_bare_url_removed(self):
        self.assertEqual(ingest.strip_html("See https://example.com/x now"), "See now")

    def test_plain_text_passthrough(self):
        self.assertEqual(ingest.strip_html("Just plain text"), "Just plain text")

    def test_empty_string(self):
        self.assertEqual(ingest.strip_html(""), "")

    def test_falsy_none_returns_empty(self):
        # Falsy guard: None hits `if not text` and returns "".
        self.assertEqual(ingest.strip_html(None), "")

    def test_pe_hub_boilerplate_trailer_stripped(self):
        out = ingest.strip_html("Deal closes today. The post Deal X appeared first on PE Hub.")
        self.assertEqual(out, "Deal closes today.")


if __name__ == "__main__":
    unittest.main()
