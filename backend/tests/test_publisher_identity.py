"""
Publisher identity and structural figure observation.

The load-bearing test here is
TestIdentityNeverInventsAnOutlet::test_google_news_feed_name_is_never_an_identity.
Everything that counts "distinct sources" downstream is only honest if a feed
name can never masquerade as a publisher; that is the artifact that made ten
ticker feeds read as ten independent outlets.
"""

from __future__ import annotations

import pytest

from backend.publishers import (
    attribution_identity,
    extract_publisher,
    is_syndicator,
    normalize_domain,
    publisher_from_title_suffix,
)
from backend.figures import (
    KIND_MONEY,
    KIND_PERCENT,
    compare_figures,
    extract_figures,
    figures_diverge,
)


class TestNormalizeDomain:
    def test_strips_scheme_and_www(self):
        assert normalize_domain("https://www.benzinga.com/some/path") == "benzinga.com"

    def test_accepts_bare_host(self):
        assert normalize_domain("seekingalpha.com") == "seekingalpha.com"

    def test_strips_port_and_credentials(self):
        assert normalize_domain("https://user@example.com:8443/x") == "example.com"

    @pytest.mark.parametrize("bad", [None, "", "   ", 42, {}])
    def test_junk_returns_none(self, bad):
        assert normalize_domain(bad) is None


class TestExtractPublisher:
    def test_reads_the_rss_source_element(self):
        entry = {"source": {"title": "Benzinga", "href": "https://www.benzinga.com"}}
        assert extract_publisher(entry) == ("Benzinga", "benzinga.com")

    def test_missing_source_element_yields_unknown_not_a_guess(self):
        assert extract_publisher({"title": "Some headline"}) == (None, None)

    def test_never_raises_on_junk(self):
        for junk in (None, 0, "string-entry", []):
            assert extract_publisher(junk) == (None, None)


class TestPublisherFromTitleSuffix:
    def test_recovers_the_stripped_suffix(self):
        title = "Musk Praises Vera Rubin Platform on SpaceX Earnings Call - Benzinga"
        assert publisher_from_title_suffix(title) == "Benzinga"

    def test_hyphenated_headline_is_not_a_publisher(self):
        # The failure this guards: treating a compound word as an outlet.
        assert publisher_from_title_suffix("A Cash-and-Stock Deal Closes") is None

    def test_long_tail_segment_is_rejected(self):
        title = "Headline - and then a much longer trailing clause that is prose"
        assert publisher_from_title_suffix(title) is None


class TestIdentityNeverInventsAnOutlet:
    def test_google_news_feed_name_is_never_an_identity(self):
        # THE load-bearing property. 819 of these feed names exist; treating
        # them as outlets is what inflated breadth scoring.
        for ticker in ("AMD", "NVDA", "ABNB", "BKR"):
            assert attribution_identity(None, None, f"Google News ({ticker})") is None

    def test_real_publisher_wins_over_feed_name(self):
        assert attribution_identity("Benzinga", "benzinga.com",
                                    "Google News (AMD)") == "Benzinga"

    def test_domain_is_used_when_publisher_name_is_absent(self):
        assert attribution_identity(None, "https://www.reuters.com",
                                    "Google News (AMD)") == "reuters.com"

    def test_named_feed_source_is_an_acceptable_fallback(self):
        assert attribution_identity(None, None, "TechCrunch") == "TechCrunch"


class TestSyndicator:
    @pytest.mark.parametrize("domain", ["news.google.com", "finance.yahoo.com",
                                        "finnhub.io", "msn.com"])
    def test_known_syndicator_domains(self, domain):
        assert is_syndicator(None, domain, None) is True

    def test_feed_name_fallback_covers_legacy_rows(self):
        assert is_syndicator(None, None, "Google News (TSLA)") is True
        assert is_syndicator(None, None, "Yahoo") is True

    def test_ordinary_outlet_is_not_a_syndicator(self):
        assert is_syndicator("TechCrunch", "techcrunch.com", "TechCrunch") is False


class TestExtractFigures:
    def test_money_scales(self):
        figs = {f.raw: f.value for f in extract_figures("raised $4.2B after a $900 fee")}
        assert figs["$4.2B"] == pytest.approx(4.2e9)
        assert figs["$900"] == pytest.approx(900.0)

    def test_written_scale_words(self):
        (fig,) = extract_figures("a $1.5 billion deal")
        assert fig.kind == KIND_MONEY
        assert fig.value == pytest.approx(1.5e9)

    def test_percent(self):
        vals = sorted(f.value for f in extract_figures("up 12% and 3.5 percent"))
        assert vals == pytest.approx([3.5, 12.0])

    def test_deduplicates_repeats(self):
        assert len(extract_figures("$4.2B ... still $4.2B")) == 1

    @pytest.mark.parametrize("junk", [None, "", 7, []])
    def test_junk_returns_empty(self, junk):
        assert extract_figures(junk) == []


class TestFigureDivergence:
    def test_rounding_is_not_divergence(self):
        assert figures_diverge(KIND_MONEY, 4.2e9, 4.15e9) is False
        assert figures_diverge(KIND_PERCENT, 12.0, 12.4) is False

    def test_real_difference_is_divergence(self):
        assert figures_diverge(KIND_MONEY, 4.2e9, 6.0e9) is True
        assert figures_diverge(KIND_PERCENT, 12.0, 18.0) is True


class TestCompareFigures:
    def test_single_member_yields_nothing(self):
        assert compare_figures([{"id": "a", "label": "A", "text": "$4B"}]) == []

    def test_exclusive_figure_is_flagged(self):
        findings = compare_figures([
            {"id": "a", "label": "Reuters", "text": "Acme guides to $4.2B"},
            {"id": "b", "label": "AP", "text": "Acme issues guidance"},
        ])
        assert [f.kind for f in findings] == ["exclusive"]
        assert findings[0].members[0]["label"] == "Reuters"

    def test_divergence_is_flagged_and_carries_raw_strings(self):
        findings = compare_figures([
            {"id": "a", "label": "Reuters", "text": "guides to $4.2B"},
            {"id": "b", "label": "AP", "text": "guides to $6.0B"},
        ])
        assert [f.kind for f in findings] == ["divergence"]
        raws = {m["figures"][0]["raw"] for m in findings[0].members}
        assert raws == {"$4.2B", "$6.0B"}

    def test_divergence_detail_states_it_is_observation_only(self):
        findings = compare_figures([
            {"id": "a", "label": "A", "text": "$4.2B"},
            {"id": "b", "label": "B", "text": "$99B"},
        ])
        # No consumer may read this as an accuracy verdict.
        assert "Observation only" in findings[0].detail

    def test_agreeing_figures_produce_no_finding(self):
        assert compare_figures([
            {"id": "a", "label": "A", "text": "$4.2B"},
            {"id": "b", "label": "B", "text": "$4.2B"},
        ]) == []
