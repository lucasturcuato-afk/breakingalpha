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
    builder exposes before .is_(...).

    UPDATED 2026-09-03 for the row-cap fix. `_load_ticker_company_names` no
    longer calls a bare .execute(); it goes through ingest._fetch_all_rows,
    which takes a `count="exact"` head and then pages with .order().range().
    This stub therefore has to answer .count and honour a range, or the count
    assertion in the helper sees `expected=None` and (correctly) refuses the
    read. Row-cap behaviour itself is covered in test_row_cap_reads.py; this
    stub stays deliberately simple and never truncates.
    """

    def __init__(self, data):
        self._data = data
        self._count_mode = None
        self._lo = 0
        self._hi = None

    def table(self, *_a, **_k):
        return self

    def select(self, *_a, count=None, **_k):
        self._count_mode = count
        self._lo, self._hi = 0, None
        return self

    @property
    def not_(self):
        return self

    def is_(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def range(self, lo, hi):
        self._lo, self._hi = lo, hi
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        count = len(self._data) if self._count_mode == "exact" else None
        hi = len(self._data) if self._hi is None else self._hi + 1
        return type("Resp", (), {"data": self._data[self._lo:hi], "count": count})()


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
# 3d-bis. Blocklist precision: word-boundary + per-field matching (new mode).
# These pin the FIX, not the legacy behavior. They are additive: every test in
# IngestBlocklistTest above still passes unchanged under the default shadow mode
# (which actively blocks on the legacy decision).
# ---------------------------------------------------------------------------
class IngestBlocklistPrecisionTest(unittest.TestCase):
    # --- helper-level, mode-independent: legacy over-matches, new does not -----

    def test_substring_in_word_legacy_overblocks(self):
        # "refiling deadline" contains "filing deadline" as a substring of a word.
        self.assertEqual(
            ingest._legacy_blocklist_phrase("Acme completes refiling deadline", ""),
            "filing deadline",
        )

    def test_substring_in_word_new_passes(self):
        self.assertIsNone(
            ingest._new_blocklist_phrase("Acme completes refiling deadline", "")
        )

    def test_gloss_recovery_substring_legacy_vs_new(self):
        # "gloss recovery" embeds "loss recovery"; legacy blocks, new does not.
        self.assertEqual(
            ingest._legacy_blocklist_phrase("New lip gloss recovery line", ""),
            "loss recovery",
        )
        self.assertIsNone(ingest._new_blocklist_phrase("New lip gloss recovery line", ""))

    def test_seam_phantom_legacy_vs_new(self):
        # Neither field contains "lead plaintiff"; the title+summary seam fabricates
        # it. Legacy blocks across the seam; new (per-field) does not.
        title, summary = "Acme takes commanding lead", "Plaintiff dropped from case"
        self.assertEqual(ingest._legacy_blocklist_phrase(title, summary), "lead plaintiff")
        self.assertIsNone(ingest._new_blocklist_phrase(title, summary))

    # --- integration via matches_ingest_blocklist in explicit modes -----------

    def test_new_mode_passes_substring_in_word(self):
        art = {"title": "Acme completes refiling deadline", "summary": ""}
        with patch.object(ingest, "_INGEST_BLOCKLIST_MODE", "new"):
            self.assertFalse(ingest.matches_ingest_blocklist(art))

    def test_new_mode_passes_seam_phantom(self):
        art = {"title": "Acme takes commanding lead", "summary": "Plaintiff dropped from case"}
        with patch.object(ingest, "_INGEST_BLOCKLIST_MODE", "new"):
            self.assertFalse(ingest.matches_ingest_blocklist(art))

    def test_new_mode_blocks_real_phrase_in_title(self):
        art = {"title": "Securities class action filed against Acme", "summary": ""}
        with patch.object(ingest, "_INGEST_BLOCKLIST_MODE", "new"):
            self.assertTrue(ingest.matches_ingest_blocklist(art))

    def test_new_mode_blocks_real_phrase_in_summary_only(self):
        art = {"title": "Acme update", "summary": "A securities class action was filed today"}
        with patch.object(ingest, "_INGEST_BLOCKLIST_MODE", "new"):
            self.assertTrue(ingest.matches_ingest_blocklist(art))

    def test_new_mode_is_case_insensitive(self):
        art = {"title": "LEAD PLAINTIFF DEADLINE APPROACHING", "summary": ""}
        with patch.object(ingest, "_INGEST_BLOCKLIST_MODE", "new"):
            self.assertTrue(ingest.matches_ingest_blocklist(art))

    def test_every_phrase_is_a_true_positive_under_new(self):
        # Each phrase in the PRUNED set (the set the new matcher actually uses),
        # embedded contiguously in one field, still blocks and reports itself.
        for phrase in ingest._INGEST_KEYWORD_BLOCKLIST_PRUNED:
            title = f"Firm release: {phrase} per the latest update."
            self.assertEqual(
                ingest._new_blocklist_phrase(title, ""),
                phrase,
                msg=f"new matcher failed to catch contiguous phrase {phrase!r}",
            )

    # --- shadow (default) is prod-safe: active decision stays legacy ----------

    def test_shadow_default_still_blocks_seam_like_legacy(self):
        # Under the default shadow mode the seam phantom is STILL blocked (active
        # decision is legacy), proving a deploy changes no production behavior.
        self.assertEqual(ingest._INGEST_BLOCKLIST_MODE, "shadow")
        art = {"title": "Acme takes commanding lead", "summary": "Plaintiff dropped from case"}
        self.assertTrue(ingest.matches_ingest_blocklist(art))

    def test_legacy_mode_blocks_seam(self):
        art = {"title": "Acme takes commanding lead", "summary": "Plaintiff dropped from case"}
        with patch.object(ingest, "_INGEST_BLOCKLIST_MODE", "legacy"):
            self.assertTrue(ingest.matches_ingest_blocklist(art))


# ---------------------------------------------------------------------------
# 3d-ter. Blocklist phrase pruning (over-broad phrases removed/tightened).
# Attribution: #379 skip-log replay, 14 pipeline runs / 99 unique blocked titles,
# solo-match analysis. "new" mode uses the pruned set; "shadow" (default) keeps
# the current set active so a deploy changes nothing and each divergence is an
# article the pruning rescues.
# ---------------------------------------------------------------------------
class IngestBlocklistPruningTest(unittest.TestCase):
    def test_removed_and_tightened_phrases(self):
        pruned = ingest._INGEST_KEYWORD_BLOCKLIST_PRUNED
        # Removed / tightened out of the new set...
        self.assertNotIn("filing deadline", pruned)
        self.assertNotIn("loss recovery", pruned)
        self.assertNotIn("announces investigation into", pruned)
        self.assertIn("announces investigation into fairness", pruned)
        # ...but the current (legacy) set still carries them, so shadow is neutral.
        self.assertIn("filing deadline", ingest._INGEST_KEYWORD_BLOCKLIST)
        self.assertIn("loss recovery", ingest._INGEST_KEYWORD_BLOCKLIST)
        self.assertIn("announces investigation into", ingest._INGEST_KEYWORD_BLOCKLIST)

    def test_new_is_subset_of_legacy_so_newly_blocked_is_zero(self):
        # Every pruned phrase contiguous in a field is also caught by legacy.
        for phrase in ingest._INGEST_KEYWORD_BLOCKLIST_PRUNED:
            self.assertIsNotNone(
                ingest._legacy_blocklist_phrase(f"News: {phrase} reported.", ""),
                msg=f"legacy must also catch {phrase!r} (subset guarantee)",
            )

    # filing deadline: REMOVED (the only solo match was the AMC-style legit story)
    def test_legit_sec_filing_deadline_passes_under_new(self):
        art = {"title": "A warrant accounting issue pushes AMC Robotics past its SEC filing deadline",
               "summary": "The restatement delayed the quarterly report."}
        with patch.object(ingest, "_INGEST_BLOCKLIST_MODE", "new"):
            self.assertFalse(ingest.matches_ingest_blocklist(art))

    def test_legit_sec_filing_deadline_still_blocked_under_default_shadow(self):
        # Deploy-neutral: default shadow still actively blocks via the legacy set.
        self.assertEqual(ingest._INGEST_BLOCKLIST_MODE, "shadow")
        art = {"title": "A warrant accounting issue pushes AMC Robotics past its SEC filing deadline",
               "summary": ""}
        self.assertTrue(ingest.matches_ingest_blocklist(art))

    # loss recovery: REMOVED (0 fires in the retained universe)
    def test_legit_loss_recovery_passes_under_new(self):
        art = {"title": "Insurer reports strong loss recovery on catastrophe claims", "summary": ""}
        with patch.object(ingest, "_INGEST_BLOCKLIST_MODE", "new"):
            self.assertFalse(ingest.matches_ingest_blocklist(art))

    # announces investigation into: TIGHTENED to require "fairness"
    def test_legit_corporate_investigation_disclosure_passes_under_new(self):
        art = {"title": "Acme Corp announces investigation into data breach", "summary": ""}
        with patch.object(ingest, "_INGEST_BLOCKLIST_MODE", "new"):
            self.assertFalse(ingest.matches_ingest_blocklist(art))

    def test_law_firm_fairness_investigation_still_blocked_under_new(self):
        art = {"title": "Kaskela Law Firm Announces Investigation into Fairness of European Wax Center",
               "summary": ""}
        with patch.object(ingest, "_INGEST_BLOCKLIST_MODE", "new"):
            self.assertTrue(ingest.matches_ingest_blocklist(art))

    # surviving phrases still catch representative real spam under new
    def test_representative_lawsuit_spam_still_blocked_under_new(self):
        for title in (
            "GLOB Shareholder Alert: Globant S.A. Securities Class Action Lawsuit",
            "The Gross Law Firm Reminds Shareholders of a Lead Plaintiff Deadline of August 7",
            "Rosen Law Firm Encourages TruBridge Investors to Inquire About Securities Class Action",
        ):
            with patch.object(ingest, "_INGEST_BLOCKLIST_MODE", "new"):
                self.assertTrue(
                    ingest.matches_ingest_blocklist({"title": title, "summary": ""}),
                    msg=f"spam should still block under new: {title!r}",
                )


# ---------------------------------------------------------------------------
# 3d-quater. Plural / inflection tolerance under "new".
# The word-boundary matcher must still catch the plural spam form (the bare \b
# let "class action lawsuits" evade "class action lawsuit"), while keeping the
# leading \b so the substring-in-word fix holds.
# ---------------------------------------------------------------------------
class IngestBlocklistInflectionTest(unittest.TestCase):
    # (phrase as listed, singular surface form, plural surface form)
    AFFECTED = (
        ("securities class action", "securities class action", "securities class actions"),
        ("class action lawsuit", "class action lawsuit", "class action lawsuits"),
        ("shareholder lawsuit", "shareholder lawsuit", "shareholder lawsuits"),
        ("lead plaintiff deadline", "lead plaintiff deadline", "lead plaintiff deadlines"),
        ("lead plaintiff", "lead plaintiff", "lead plaintiffs"),
        ("securities fraud investigation", "securities fraud investigation",
         "securities fraud investigations"),
    )

    def test_singular_and_plural_both_block_under_new(self):
        for canonical, singular, plural in self.AFFECTED:
            self.assertIn(canonical, ingest._INGEST_KEYWORD_BLOCKLIST_PRUNED)
            for form in (singular, plural):
                self.assertIsNotNone(
                    ingest._new_blocklist_phrase(f"Stock alert: {form} filed today", ""),
                    msg=f"new matcher must block {form!r}",
                )

    def test_plural_phrase_reports_canonical_phrase(self):
        # The function returns the canonical tuple phrase, not the matched surface.
        self.assertEqual(
            ingest._new_blocklist_phrase("New class action lawsuits filed", ""),
            "class action lawsuit",
        )

    def test_leading_boundary_preserved_no_substring_in_word(self):
        # The plural "s?" must NOT relax the LEADING boundary: a phrase inside a
        # larger leading word still does not match.
        self.assertIsNone(
            ingest._new_blocklist_phrase("A subclass action lawsuit framework", "")
        )

    def test_trailing_boundary_not_overgreedy(self):
        # "s?" tolerates only a single trailing plural s, then a boundary; it must
        # not match a longer different word ("lawsuited", "investigationary").
        self.assertIsNone(ingest._new_blocklist_phrase("class action lawsuited nonsense", ""))
        self.assertIsNone(
            ingest._new_blocklist_phrase("securities fraud investigationary memo", "")
        )

    def test_plural_spam_blocks_under_new_real_form(self):
        art = {"title": "Zillow faces multiple securities class actions and shareholder lawsuits",
               "summary": ""}
        with patch.object(ingest, "_INGEST_BLOCKLIST_MODE", "new"):
            self.assertTrue(ingest.matches_ingest_blocklist(art))


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
