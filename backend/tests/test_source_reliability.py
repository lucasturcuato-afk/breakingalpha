"""
Part 1: outcome-based source reliability, and Part 2 cluster assembly.

Two load-bearing properties:

  TestSmallSamplesCannotOutrank::test_one_for_one_never_beats_a_large_sample
      The exact failure in the shipped source_credibility table, where three
      sources sat at a perfect 1.0 on a single thesis each and the UI sorted by
      that number. Wilson shrinkage has to make that impossible.

  TestNoAccuracyBelowTheBar::test_accuracy_is_null_below_min_reportable_n
      A NULL is the honest output for a 1-outcome source. If a number leaks out
      below the bar, someone will rank on it.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.source_reliability import (
    CONFIDENCE_HIGH,
    CONFIDENCE_INSUFFICIENT,
    CONFIDENCE_LOW,
    CONFIDENCE_MODERATE,
    MIN_REPORTABLE_N,
    READY_FOR_WEIGHTING_N,
    aggregate,
    article_matches_call,
    confidence_label,
    resolve_sector_etf,
    wilson_lower_bound,
)
from backend.cross_source import build_clusters, split_by_time_gap


class TestWilson:
    def test_zero_sample_is_none(self):
        assert wilson_lower_bound(0, 0) is None

    def test_perfect_small_sample_is_heavily_shrunk(self):
        assert wilson_lower_bound(1, 1) < 0.25

    def test_large_sample_stays_near_the_point_estimate(self):
        assert wilson_lower_bound(140, 200) == pytest.approx(0.63, abs=0.03)


class TestSmallSamplesCannotOutrank:
    def test_one_for_one_never_beats_a_large_sample(self):
        # THE property. Raw accuracy says 1.0 > 0.70; the bound must invert it.
        assert wilson_lower_bound(1, 1) < wilson_lower_bound(140, 200)


class TestConfidenceLabel:
    @pytest.mark.parametrize("n,expected", [
        (0, CONFIDENCE_INSUFFICIENT),
        (9, CONFIDENCE_INSUFFICIENT),
        (10, CONFIDENCE_LOW),
        (29, CONFIDENCE_LOW),
        (30, CONFIDENCE_MODERATE),
        (99, CONFIDENCE_MODERATE),
        (100, CONFIDENCE_HIGH),
    ])
    def test_bands(self, n, expected):
        assert confidence_label(n) == expected


class TestResolveSectorEtf:
    @pytest.mark.parametrize("label,etf", [
        ("Energy & Oil/Gas", "XLE"),
        ("Healthcare & Biotech", "XLV"),
        ("Financial Services", "XLF"),
        ("Industrials & Manufacturing", "XLI"),
        ("Technology", "XLK"),
        ("XLE", "XLE"),
    ])
    def test_compound_labels_resolve(self, label, etf):
        assert resolve_sector_etf(label) == etf

    def test_unmappable_label_returns_none_rather_than_guessing(self):
        assert resolve_sector_etf("Aerospace & Defense") is None

    def test_ambiguous_compound_refuses_to_pick_a_side(self):
        # A wrong sector match silently credits outlets that never covered it.
        assert resolve_sector_etf("Energy & Technology") is None


class TestArticleMatchesCall:
    def test_sector_call_matches_via_etf_space(self):
        call = {"claim_type": "sector", "target_symbol": "XLE"}
        assert article_matches_call({"sector": "Energy & Oil/Gas"}, call) is True
        assert article_matches_call({"sector": "Technology"}, call) is False

    def test_ticker_call_matches_standalone_token(self):
        call = {"claim_type": "ticker", "target_symbol": "GSK"}
        assert article_matches_call({"primary_company": "GSK"}, call) is True

    def test_ticker_does_not_match_inside_a_word(self):
        # "AI" must not match "said".
        call = {"claim_type": "ticker", "target_symbol": "AI"}
        assert article_matches_call({"title": "He said nothing"}, call) is False

    def test_ticker_matches_via_company_name_map(self):
        call = {"claim_type": "ticker", "target_symbol": "UNH"}
        art = {"primary_company": "UnitedHealth Group"}
        assert article_matches_call(art, call, {"UNH": "UnitedHealth Group"}) is True


def _fixture(verdicts):
    """Build the four lookup maps for `aggregate` from a list of verdicts."""
    outcomes, calls, briefs, articles = [], {}, {}, {}
    for i, verdict in enumerate(verdicts):
        cid, bid, aid = f"c{i}", f"b{i}", f"a{i}"
        outcomes.append({"call_id": cid, "verdict": verdict,
                         "attribution": "clean", "graded_at": "2026-08-01T00:00:00Z"})
        calls[cid] = {"id": cid, "brief_id": bid, "target_symbol": "GSK",
                      "claim_type": "ticker"}
        briefs[bid] = {"id": bid, "story_rail_ids": [aid]}
        articles[aid] = {"id": aid, "source": "TechCrunch",
                         "publisher": "TechCrunch", "publisher_domain": "techcrunch.com",
                         "primary_company": "GSK", "companies": [], "sector": "Healthcare"}
    return outcomes, calls, briefs, articles


class TestNoAccuracyBelowTheBar:
    def test_accuracy_is_null_below_min_reportable_n(self):
        rows, _ = aggregate(*_fixture(["correct"]))
        assert rows[0]["n_clean_outcomes"] == 1
        assert rows[0]["accuracy"] is None
        assert rows[0]["wilson_lower_95"] is None
        assert rows[0]["confidence"] == CONFIDENCE_INSUFFICIENT

    def test_accuracy_appears_once_the_bar_is_cleared(self):
        rows, _ = aggregate(*_fixture(["correct"] * MIN_REPORTABLE_N))
        assert rows[0]["accuracy"] == pytest.approx(1.0)
        assert rows[0]["wilson_lower_95"] is not None
        assert rows[0]["confidence"] == CONFIDENCE_LOW

    def test_ready_for_weighting_requires_the_higher_bar(self):
        rows, _ = aggregate(*_fixture(["correct"] * (READY_FOR_WEIGHTING_N - 1)))
        assert rows[0]["ready_for_weighting"] is False
        rows, _ = aggregate(*_fixture(["correct"] * READY_FOR_WEIGHTING_N))
        assert rows[0]["ready_for_weighting"] is True


class TestAggregateSemantics:
    def test_wrong_and_correct_are_counted_separately(self):
        rows, _ = aggregate(*_fixture(["correct", "wrong", "wrong"]))
        assert (rows[0]["n_correct"], rows[0]["n_wrong"]) == (1, 2)
        assert rows[0]["n_clean_outcomes"] == 3

    def test_non_clean_attribution_is_excluded_entirely(self):
        outcomes, calls, briefs, articles = _fixture(["correct"])
        outcomes[0]["attribution"] = "confounded"
        rows, stats = aggregate(outcomes, calls, briefs, articles)
        assert rows == []

    def test_partial_verdict_is_excluded_not_parked_in_a_denominator(self):
        # The source_credibility bug: inconclusive sat in the denominator, so
        # unresolved looked identical to wrong.
        outcomes, calls, briefs, articles = _fixture(["correct"])
        outcomes[0]["verdict"] = "partial"
        rows, _ = aggregate(outcomes, calls, briefs, articles)
        assert rows == []

    def test_index_claims_are_not_attributed_to_outlets(self):
        outcomes, calls, briefs, articles = _fixture(["correct"])
        calls["c0"]["claim_type"] = "index"
        rows, stats = aggregate(outcomes, calls, briefs, articles)
        assert rows == []
        assert stats["skipped_claim_type"] == 1

    def test_credit_is_diluted_across_co_covering_identities(self):
        outcomes, calls, briefs, articles = _fixture(["correct"])
        briefs["b0"]["story_rail_ids"] = ["a0", "a1"]
        articles["a1"] = {"id": "a1", "source": "Axios", "publisher": "Axios",
                          "publisher_domain": "axios.com", "primary_company": "GSK",
                          "companies": [], "sector": "Healthcare"}
        rows, _ = aggregate(outcomes, calls, briefs, articles)
        assert len(rows) == 2
        assert all(r["credit_weight"] == pytest.approx(0.5) for r in rows)

    def test_a_google_news_only_call_attributes_to_nobody(self):
        outcomes, calls, briefs, articles = _fixture(["correct"])
        articles["a0"].update({"publisher": None, "publisher_domain": None,
                               "source": "Google News (GSK)"})
        rows, stats = aggregate(outcomes, calls, briefs, articles)
        assert rows == []
        assert stats["skipped_no_identity"] == 1


def _article(aid, publisher, when, title="Acme beats on revenue", **kw):
    row = {
        "id": aid,
        "title": title,
        "summary": "",
        "companies": ["Acme"],
        "sector": "Technology",
        "published_at": when.isoformat(),
        "ingested_at": when.isoformat(),
        "publisher": publisher,
        "publisher_domain": f"{(publisher or 'x').lower().replace(' ', '')}.com",
        "source": publisher,
    }
    row.update(kw)
    return row


BASE = datetime(2026, 8, 5, 12, 0, tzinfo=timezone.utc)


class TestTimeGapSplit:
    def test_overnight_echo_stays_with_its_lead(self):
        # A calendar-day bucket would wrongly split these two.
        items = [{"published_at": BASE.replace(hour=23).isoformat()},
                 {"published_at": (BASE.replace(hour=23) + timedelta(hours=2)).isoformat()}]
        assert len(split_by_time_gap(items)) == 1

    def test_a_multi_day_topic_splits_into_instances(self):
        items = [{"published_at": BASE.isoformat()},
                 {"published_at": (BASE + timedelta(days=3)).isoformat()}]
        assert len(split_by_time_gap(items)) == 2

    def test_undated_items_are_kept_not_dropped(self):
        items = [{"published_at": BASE.isoformat()}, {"published_at": None}]
        groups = split_by_time_gap(items)
        assert sum(len(g) for g in groups) == 2


class TestBuildClusters:
    def test_two_publishers_on_one_event_form_a_cluster(self):
        arts = [_article("1", "Reuters", BASE),
                _article("2", "Axios", BASE + timedelta(minutes=30))]
        (cluster,) = build_clusters(arts)
        assert cluster["distinct_identities"] == 2
        assert cluster["lead_identity"] == "Reuters"
        assert [m["role"] for m in cluster["members"]] == ["lead", "echo"]
        assert cluster["members"][1]["lag_minutes"] == pytest.approx(30.0)

    def test_single_publisher_is_not_cross_source(self):
        arts = [_article("1", "Reuters", BASE),
                _article("2", "Reuters", BASE + timedelta(minutes=5))]
        assert build_clusters(arts) == []

    def test_google_news_feeds_do_not_manufacture_breadth(self):
        # Ten ticker feeds are not ten outlets. This is the false-breadth
        # artifact measured in production (co:bank of america corp:stock had
        # 10 articles and 10 "sources", all Google News feeds).
        arts = [
            _article(str(i), None, BASE + timedelta(minutes=i),
                     publisher_domain=None, source=f"Google News ({t})")
            for i, t in enumerate(["ABNB", "BKR", "DVN", "EQIX"])
        ]
        assert build_clusters(arts) == []

    def test_tied_first_timestamp_refuses_to_name_a_lead(self):
        arts = [_article("1", "Reuters", BASE), _article("2", "Axios", BASE)]
        (cluster,) = build_clusters(arts)
        assert cluster["tied_lead"] is True
        assert cluster["lead_identity"] is None
        assert all(m["role"] == "lead_tied" for m in cluster["members"])

    def test_every_cluster_is_marked_observation_only(self):
        arts = [_article("1", "Reuters", BASE),
                _article("2", "Axios", BASE + timedelta(minutes=10))]
        assert build_clusters(arts)[0]["observation_only"] is True

    def test_syndicator_member_is_flagged(self):
        arts = [_article("1", "Reuters", BASE),
                _article("2", "Yahoo", BASE + timedelta(minutes=10),
                         publisher_domain="finance.yahoo.com")]
        (cluster,) = build_clusters(arts)
        flags = {m["identity"]: m["is_syndicator"] for m in cluster["members"]}
        assert flags == {"Reuters": False, "Yahoo": True}
        assert cluster["distinct_non_syndicators"] == 1
