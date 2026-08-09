"""Deterministic ordering on the saturated relevance_score column.

WHY THIS EXISTS. relevance_score is saturated: ~23% of stored articles sit at
exactly 10, and every ranking query's LIMIT is consumed entirely from inside
that tie (measured: Top Stories 24 slots against 1,632 tied rows; the synthesis
pool 60 against 556; the story rail 28 against 2,189; the observe pool 60
against 673). The column therefore contributes NO ordering information to any of
them -- the tiebreak keys decide the whole result.

Where a unique final key was missing, two runs reading identical data could
return different rows in a different order. That is the failure this file pins.

Two kinds of coverage here, and the difference is deliberate:

  BEHAVIOURAL -- lead_preselect's three in-memory sorts are pure functions, so
  they are exercised for real: shuffle the input, assert the winner never moves.

  SOURCE-LEVEL -- the four PostgREST queries order server-side and the
  supabase-py builder exposes no way to inspect the request it will send
  (no .params, no accessible query state), so those are pinned by asserting the
  .order(...) key sequence in the source. That is weaker than a behavioural
  test and is labelled as such rather than dressed up as one.
"""

from __future__ import annotations

import ast
import os
import random
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

os.environ.setdefault("GEMINI_API_KEY", "dummy-key-not-used")
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_ANON_KEY", "dummy-anon-not-used")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "dummy-service-role-not-used")

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from lead_preselect import (  # noqa: E402
    FALLBACK_MAX_AGE_HOURS,
    MACRO_GEO_MIN_SCORE,
    _pick_geopolitical,
    _pick_macro,
)

NOW = datetime(2026, 8, 8, 12, 0, tzinfo=timezone.utc)

#: The order every ranking query must emit, in sequence.
EXPECTED_KEYS = ["relevance_score", "ingested_at", "published_at", "id"]


def _article(aid: str, deal_type: str, score: int, age_hours: float) -> dict:
    published = (NOW - timedelta(hours=age_hours)).isoformat()
    return {
        "id": aid,
        "deal_type": deal_type,
        "relevance_score": score,
        "published_at": published,
        "ingested_at": published,
        "title": f"headline {aid}",
        "industry_verticals": ["Technology"],
    }


def _tied_pool(deal_type: str, n: int = 12) -> list[dict]:
    """n articles that tie on BOTH existing sort keys: identical score, identical
    age. Before the fix the winner was whichever the incoming list happened to
    put first."""
    return [
        _article(f"id-{i:02d}", deal_type, MACRO_GEO_MIN_SCORE + 1, 3.0)
        for i in range(n)
    ]


# ---------------------------------------------------------------------------
# BEHAVIOURAL: the in-memory sorts
# ---------------------------------------------------------------------------

class TestInMemorySortsAreShuffleInvariant:
    """THE load-bearing tests. Same input SET, different input ORDER, same winner."""

    @pytest.mark.parametrize("picker,deal_type", [
        (_pick_macro, "Macro"),
        (_pick_geopolitical, "Geopolitical"),
    ])
    def test_winner_is_identical_across_shuffles(self, picker, deal_type):
        pool = _tied_pool(deal_type)
        rng = random.Random(1234)

        baseline = picker(list(pool), NOW)
        assert baseline is not None

        for _ in range(25):
            shuffled = list(pool)
            rng.shuffle(shuffled)
            assert picker(shuffled, NOW)["id"] == baseline["id"]

    @pytest.mark.parametrize("picker,deal_type", [
        (_pick_macro, "Macro"),
        (_pick_geopolitical, "Geopolitical"),
    ])
    def test_running_twice_on_the_same_list_agrees(self, picker, deal_type):
        pool = _tied_pool(deal_type)
        assert picker(list(pool), NOW)["id"] == picker(list(pool), NOW)["id"]

    def test_the_tiebreak_is_id_not_list_position(self, picker=_pick_macro):
        """With score and age tied, the lowest id must win -- reversing the input
        must not change the answer."""
        pool = _tied_pool("Macro")
        forward = picker(list(pool), NOW)["id"]
        backward = picker(list(reversed(pool)), NOW)["id"]
        assert forward == backward == min(a["id"] for a in pool)

    def test_a_real_score_edge_still_beats_the_tiebreak(self):
        """The id key must only ever act INSIDE a tie. A higher score wins even
        when its id sorts last."""
        pool = _tied_pool("Macro")
        pool.append(_article("zz-last", "Macro", 10, 3.0))
        assert _pick_macro(pool, NOW)["id"] == "zz-last"

    def test_freshness_still_outranks_id(self):
        """Age is checked before id, so the fresher of two equal scores wins
        regardless of id ordering."""
        pool = [
            _article("aaa", "Macro", 9, 20.0),   # lowest id, but stale
            _article("zzz", "Macro", 9, 1.0),    # highest id, but fresh
        ]
        assert _pick_macro(pool, NOW)["id"] == "zzz"

    def test_age_filter_is_unaffected(self):
        """Nothing above should have widened the eligibility window."""
        stale = [_article("a", "Macro", 10, FALLBACK_MAX_AGE_HOURS + 5)]
        assert _pick_macro(stale, NOW) is None


# ---------------------------------------------------------------------------
# SOURCE-LEVEL: the PostgREST queries
# ---------------------------------------------------------------------------

def _order_keys_after(source: str, anchor: str, window: int = 1400) -> list[str]:
    """Return the .order() column names appearing after `anchor`, in order.

    Comment lines are stripped first: every site carries an explanatory comment
    that names the sort keys, and matching those would make the assertion pass
    on prose rather than on code.
    """
    idx = source.index(anchor)
    chunk = source[idx: idx + window]
    code = "\n".join(
        ln for ln in chunk.splitlines() if not ln.lstrip().startswith("#")
    )
    code = code.split(".execute()")[0]
    return re.findall(r'\.order\(\s*["\'](\w+)["\']', code)


@pytest.mark.parametrize("module,anchor,label", [
    ("synthesize.py", 'wide_publish_cutoff)\\', "synthesis pool 7-day fallback"),
    ("observe.py", '.gte("published_at", publish_cutoff)', "observe / run_articles pool"),
])
def test_query_emits_the_full_four_key_order(module, anchor, label):
    source = (BACKEND / module).read_text(encoding="utf-8")
    assert _order_keys_after(source, anchor) == EXPECTED_KEYS, label


def test_story_rail_query_ends_on_a_unique_key():
    """The rail already had relevance_score + published_at. Measured over a
    7-day window, 428 rows share a (score 10, published_at) pair with another
    row and the worst pair holds 10 rows, so published_at is not sufficient."""
    source = (BACKEND / "story_rail.py").read_text(encoding="utf-8")
    keys = _order_keys_after(source, '.gte("published_at", cutoff)')
    assert keys == ["relevance_score", "published_at", "id"]
    assert keys[-1] == "id", "the final key must be unique or ordering is arbitrary"


def test_synthesis_primary_query_still_has_its_order():
    """Landed in #556. Pinned so a later edit cannot silently drop it.

    Anchored on the comment that names the index, because
    `.gte("published_at", publish_cutoff)` also appears in _fetch_driver_pool
    higher up the module and would match that query instead."""
    source = (BACKEND / "synthesize.py").read_text(encoding="utf-8")
    assert _order_keys_after(source, "idx_articles_top_stories index backs") == EXPECTED_KEYS


def test_driver_pool_ordering_is_recorded_as_out_of_scope():
    """_fetch_driver_pool orders on relevance_score + published_at with no unique
    final key. It is NOT part of this change: it is a narrow pool (deal_type IN
    DRIVER_DEAL_TYPES AND relevance_score >= DRIVER_MIN_SCORE), so its tie is far
    smaller than the four sites fixed here. Asserted so the gap stays visible and
    a future reader does not assume this file covered it."""
    source = (BACKEND / "synthesize.py").read_text(encoding="utf-8")
    keys = _order_keys_after(source, '.in_("deal_type", list(DRIVER_DEAL_TYPES))')
    assert keys == ["relevance_score", "published_at"], (
        "driver pool ordering changed; decide deliberately whether it needs id ASC"
    )


def test_observe_pool_filters_on_published_at_like_synthesis_does():
    """observe.py claims to mirror synthesize.py. It has to actually do it, or
    run_articles records a selection synthesis never saw."""
    source = (BACKEND / "observe.py").read_text(encoding="utf-8")
    code = "\n".join(
        ln for ln in source.splitlines() if not ln.lstrip().startswith("#")
    )
    assert 'gte("ingested_at", cutoff)' in code
    assert 'gte("published_at", publish_cutoff)' in code


# ---------------------------------------------------------------------------
# The comparator itself
# ---------------------------------------------------------------------------

class TestFourKeyOrderIsTotal:
    def test_no_two_rows_can_tie_when_ids_are_unique(self):
        """A total order is the whole point: with a unique final key, no two
        rows can compare equal, so the DB has no freedom to reorder them."""
        rows = [
            {"relevance_score": 10, "ingested_at": "2026-08-08T10:00:00+00:00",
             "published_at": "2026-08-08T09:00:00+00:00", "id": f"id-{i}"}
            for i in range(50)
        ]

        def key(r):
            return (-r["relevance_score"], r["ingested_at"], r["published_at"], r["id"])

        keys = [key(r) for r in rows]
        assert len(set(keys)) == len(keys)

    def test_modules_still_parse(self):
        for module in ("synthesize.py", "observe.py", "story_rail.py",
                       "lead_preselect.py"):
            path = BACKEND / module
            ast.parse(path.read_text(encoding="utf-8"), str(path))
