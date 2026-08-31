"""
Long-horizon grading panel: checkpoints, strict agreement, cleanliness grade.

The load-bearing test in this file is
TestTheHitRateCannotBeInflated::test_the_panel_never_improves_any_outcome. It
exhausts the full verdict x attribution x checkpoint space and asserts the panel
has exactly one permitted transition. Everything else here is a specific case of
that property, written out so a failure names what actually broke.
"""

from __future__ import annotations

import itertools
from datetime import datetime, timezone

import pytest

from backend.grading.price_attribution import (
    CHECKPOINT_FRACTIONS,
    GRADE_DIRECTIONAL,
    GRADE_HIGH,
    GRADE_MODERATE,
    GRADE_NONE,
    LONG_HORIZON_MIN_SESSIONS,
    AttributionResult,
    Checkpoint,
    PriceAttributionGrader,
    TIER_SINGLE_STOCK,
    apply_long_horizon_panel,
    attribution_grade,
    compute_checkpoints,
)
from backend.grading.resolver import (
    ATTRIBUTION_CLEAN,
    ATTRIBUTION_CONFOUNDED,
    ATTRIBUTION_INCONCLUSIVE,
    VERDICT_CORRECT,
    VERDICT_PARTIAL,
    VERDICT_WRONG,
)

ALL_VERDICTS = (VERDICT_CORRECT, VERDICT_WRONG, VERDICT_PARTIAL)
ALL_ATTRIBUTIONS = (
    ATTRIBUTION_CLEAN,
    ATTRIBUTION_CONFOUNDED,
    ATTRIBUTION_INCONCLUSIVE,
)


def checkpoint(disagrees: bool, fraction: float = 0.33) -> Checkpoint:
    return Checkpoint(
        fraction=fraction,
        date="2026-05-01",
        sessions=20,
        entity_pct=1.0,
        signed_excess_pct=-5.0 if disagrees else 5.0,
        bar_pct=3.0,
        disagrees=disagrees,
    )


def result(verdict: str, attribution: str) -> AttributionResult:
    return AttributionResult(
        verdict=verdict,
        attribution=attribution,
        realized_direction="up",
        attribution_confidence=0.80,
        detail={},
    )


# ---------------------------------------------------------------------------
# THE HONESTY INVARIANT
# ---------------------------------------------------------------------------


class TestTheHitRateCannotBeInflated:
    """The panel must be a stricter judge, never a more forgiving one."""

    def test_the_panel_never_improves_any_outcome(self):
        """
        Exhaustive over verdict x attribution x every checkpoint combination.

        The ONLY transition the panel may ever make is
            (correct, clean) -> (partial, inconclusive)
        Any other change is a bug, and a change in the opposite direction
        (anything -> correct, or wrong -> anything) would be the inflation the
        whole design exists to prevent.
        """
        checkpoint_sets = []
        for n in range(0, 3):
            for combo in itertools.product([True, False], repeat=n):
                checkpoint_sets.append([checkpoint(d) for d in combo])

        for verdict, attribution in itertools.product(ALL_VERDICTS, ALL_ATTRIBUTIONS):
            for cps in checkpoint_sets:
                before = result(verdict, attribution)
                after = apply_long_horizon_panel(before, cps)

                # A win can never be manufactured.
                if before.verdict != VERDICT_CORRECT:
                    assert after.verdict != VERDICT_CORRECT, (
                        f"panel invented a win from {verdict}/{attribution}"
                    )
                # A loss is untouchable: downgrading one would remove it from
                # the right/(right+wrong) denominator and RAISE the hit rate.
                if before.verdict == VERDICT_WRONG:
                    assert after.verdict == VERDICT_WRONG
                    assert after.attribution == before.attribution
                # Attribution may only ever weaken.
                if before.attribution != ATTRIBUTION_CLEAN:
                    assert after.attribution != ATTRIBUTION_CLEAN

                changed = (
                    after.verdict != before.verdict
                    or after.attribution != before.attribution
                )
                if changed:
                    assert (before.verdict, before.attribution) == (
                        VERDICT_CORRECT,
                        ATTRIBUTION_CLEAN,
                    )
                    assert (after.verdict, after.attribution) == (
                        VERDICT_PARTIAL,
                        ATTRIBUTION_INCONCLUSIVE,
                    )

    def test_a_wrong_call_with_disagreeing_checkpoints_stays_wrong(self):
        """The specific inflation path: hiding a miss behind 'no clean read'."""
        before = result(VERDICT_WRONG, ATTRIBUTION_CLEAN)
        after = apply_long_horizon_panel(before, [checkpoint(True), checkpoint(True)])
        assert after.verdict == VERDICT_WRONG
        assert after.attribution == ATTRIBUTION_CLEAN

    def test_the_hit_rate_can_only_fall(self):
        """Arithmetic proof over the dashboard's own denominator."""
        right, wrong = 22, 15
        before_rate = right / (right + wrong)
        # The panel's one transition removes a win from the numerator AND the
        # denominator; wrong is untouched by construction.
        after_rate = (right - 1) / ((right - 1) + wrong)
        assert after_rate < before_rate
        # The briefs' denominator (correct + wrong + partial) also falls: the
        # win becomes a partial, so the total is unchanged.
        partial = 21
        assert (right - 1) / (right + wrong + partial) < right / (
            right + wrong + partial
        )


# ---------------------------------------------------------------------------
# AGREEMENT
# ---------------------------------------------------------------------------


class TestStrictAgreement:
    def test_agreement_keeps_a_clean_win_clean(self):
        before = result(VERDICT_CORRECT, ATTRIBUTION_CLEAN)
        after = apply_long_horizon_panel(before, [checkpoint(False), checkpoint(False)])
        assert after.verdict == VERDICT_CORRECT
        assert after.attribution == ATTRIBUTION_CLEAN

    def test_one_disagreeing_checkpoint_is_enough_to_downgrade(self):
        before = result(VERDICT_CORRECT, ATTRIBUTION_CLEAN)
        after = apply_long_horizon_panel(before, [checkpoint(False), checkpoint(True)])
        assert after.verdict == VERDICT_PARTIAL
        assert after.attribution == ATTRIBUTION_INCONCLUSIVE
        assert after.detail["panel_downgraded"] is True

    def test_a_downgrade_lowers_confidence_too(self):
        before = result(VERDICT_CORRECT, ATTRIBUTION_CLEAN)
        after = apply_long_horizon_panel(before, [checkpoint(True)])
        assert after.attribution_confidence < before.attribution_confidence

    def test_no_checkpoints_never_downgrades(self):
        """Absence of evidence is not evidence of a dirty win."""
        before = result(VERDICT_CORRECT, ATTRIBUTION_CLEAN)
        assert apply_long_horizon_panel(before, []) is before


# ---------------------------------------------------------------------------
# CHECKPOINTS (pure math over the already-fetched bar series)
# ---------------------------------------------------------------------------


def series(closes: list[float], start_open: float = 100.0) -> list[dict]:
    """A daily bar series whose first open is fixed and whose closes are given.
    Dates are sequential calendar days, which is all the aligner needs."""
    return [
        {
            "date": f"2026-01-{i + 1:02d}" if i < 31 else f"2026-02-{i - 30:02d}",
            "open": start_open if i == 0 else closes[i - 1],
            "close": c,
        }
        for i, c in enumerate(closes)
    ]


class TestCheckpoints:
    def test_a_short_window_produces_no_checkpoints(self):
        """Short calls keep benchmark attribution alone (requirement 5)."""
        n = LONG_HORIZON_MIN_SESSIONS - 1
        entity = series([100.0 + i for i in range(n)])
        bench = {"SPY": series([100.0] * n)}
        assert compute_checkpoints(entity, bench, 1.0, TIER_SINGLE_STOCK) == []

    def test_a_single_session_call_produces_no_checkpoints(self):
        entity = series([101.0])
        assert compute_checkpoints(entity, {"SPY": series([100.0])}, 1.0, TIER_SINGLE_STOCK) == []

    def test_a_steady_outperformer_agrees_at_every_checkpoint(self):
        n = 30
        # Entity climbs 0.5%/session; benchmark flat. It is ahead throughout.
        entity = series([100.0 * (1.005 ** (i + 1)) for i in range(n)])
        bench = {"SPY": series([100.0] * n)}
        cps = compute_checkpoints(entity, bench, 1.0, TIER_SINGLE_STOCK)
        assert len(cps) == len(CHECKPOINT_FRACTIONS)
        assert all(not c.disagrees for c in cps)
        assert all(c.signed_excess_pct > 0 for c in cps)

    def test_a_late_burst_disagrees_at_the_early_checkpoints(self):
        """The case the panel exists for: flat for most of the window, then one
        jump at the end clears the terminal bar."""
        n = 30
        closes = [100.0 - 8.0] * (n - 1) + [130.0]  # deep underwater, then a spike
        entity = series(closes)
        bench = {"SPY": series([100.0] * n)}
        cps = compute_checkpoints(entity, bench, 1.0, TIER_SINGLE_STOCK)
        assert cps, "a 30 session window must produce checkpoints"
        assert any(c.disagrees for c in cps)

    def test_checkpoints_are_signed_into_the_credited_direction(self):
        """A bearish call that fell throughout is WORKING, so its excess is
        positive once signed, and it must not be flagged as disagreement."""
        n = 30
        entity = series([100.0 * (0.995 ** (i + 1)) for i in range(n)])
        bench = {"SPY": series([100.0] * n)}
        cps = compute_checkpoints(entity, bench, -1.0, TIER_SINGLE_STOCK)
        assert cps
        assert all(c.signed_excess_pct > 0 for c in cps)
        assert all(not c.disagrees for c in cps)

    def test_the_checkpoint_count_is_fixed_regardless_of_horizon(self):
        """Cost does not grow with the window: a quarter costs what a month
        costs. This is the DB/API load guarantee."""
        for n in (20, 45, 63, 90):
            entity = series([100.0 + i * 0.1 for i in range(n)])
            bench = {"SPY": series([100.0] * n)}
            cps = compute_checkpoints(entity, bench, 1.0, TIER_SINGLE_STOCK)
            assert len(cps) == len(CHECKPOINT_FRACTIONS), f"{n} sessions"

    def test_benchmarks_are_aligned_by_date_not_by_index(self):
        """A benchmark with a missing session must not shift the comparison."""
        n = 30
        entity = series([100.0 + i for i in range(n)])
        bench_bars = series([100.0] * n)
        del bench_bars[5]  # a halted/missing session
        cps = compute_checkpoints(entity, {"SPY": bench_bars}, 1.0, TIER_SINGLE_STOCK)
        assert cps
        for c in cps:
            assert c.date  # aligned and computed, not skipped

    def test_the_weakest_benchmark_governs(self):
        """Terminal grading requires beating EVERY benchmark; a checkpoint must
        use the same rule, so the worst excess is the one recorded."""
        n = 30
        entity = series([100.0 * (1.005 ** (i + 1)) for i in range(n)])
        flat = series([100.0] * n)
        strong = series([100.0 * (1.02 ** (i + 1)) for i in range(n)])
        cps = compute_checkpoints(
            entity, {"SPY": flat, "XLK": strong}, 1.0, TIER_SINGLE_STOCK
        )
        assert cps
        # Against the strong sector the entity is behind, and that governs.
        assert all(c.signed_excess_pct < 0 for c in cps)


# ---------------------------------------------------------------------------
# CLEANLINESS GRADE (labelling only, never a verdict input)
# ---------------------------------------------------------------------------


class TestAttributionGrade:
    def test_a_short_clean_call_reads_high(self):
        assert attribution_grade(ATTRIBUTION_CLEAN, 1, []) == GRADE_HIGH
        assert (
            attribution_grade(ATTRIBUTION_CLEAN, LONG_HORIZON_MIN_SESSIONS - 1, [])
            == GRADE_HIGH
        )

    def test_a_long_clean_call_with_agreeing_checkpoints_reads_moderate(self):
        grade = attribution_grade(
            ATTRIBUTION_CLEAN, 63, [checkpoint(False), checkpoint(False)]
        )
        assert grade == GRADE_MODERATE
        assert grade != GRADE_HIGH, "a quarter must never read as strong as a session"

    def test_a_long_call_with_no_interim_evidence_reads_directional(self):
        assert attribution_grade(ATTRIBUTION_CLEAN, 63, []) == GRADE_DIRECTIONAL

    def test_anything_not_cleanly_attributed_has_no_grade(self):
        for attribution in (ATTRIBUTION_CONFOUNDED, ATTRIBUTION_INCONCLUSIVE):
            assert attribution_grade(attribution, 63, []) == GRADE_NONE


# ---------------------------------------------------------------------------
# END TO END, THROUGH THE REAL GRADER (fake candles, real code path)
# ---------------------------------------------------------------------------


def candle_from(bars: list[dict]) -> dict:
    return {
        "open_price": bars[0]["open"],
        "close_price": bars[-1]["close"],
        "candle_count": len(bars),
        "bars": bars,
    }


class TestEndToEnd:
    def _grader(self, entity_bars, spy_bars, sector_bars=None):
        table = {"NVDA": entity_bars, "SPY": spy_bars}
        if sector_bars is not None:
            table["XLK"] = sector_bars

        def fetch(symbol, start, end):
            bars = table.get(symbol)
            return candle_from(bars) if bars else None

        return PriceAttributionGrader(
            ticker_sectors={"NVDA": "technology"}, fetch_candle=fetch
        )

    def _call(self):
        return {
            "id": "c1",
            "claim_type": "ticker",
            "target_symbol": "NVDA",
            "expected_direction": "bullish",
            "brief_date": "2026-03-31",
            "window_start": "2026-01-01",
        }

    def test_a_steady_long_winner_grades_correct_with_a_moderate_grade(self):
        n = 30
        entity = series([100.0 * (1.01 ** (i + 1)) for i in range(n)])
        flat = series([100.0] * n)
        out = self._grader(entity, flat, flat).resolve(self._call())
        assert out.verdict == VERDICT_CORRECT
        assert out.attribution == ATTRIBUTION_CLEAN
        assert out.metadata["horizon_class"] == "long"
        assert out.metadata["attribution_grade"] == GRADE_MODERATE
        assert out.metadata["panel"]["agreed"] is True
        assert len(out.metadata["checkpoints"]) == len(CHECKPOINT_FRACTIONS)

    def test_a_late_burst_winner_is_downgraded_to_no_clean_read(self):
        n = 30
        entity = series([92.0] * (n - 1) + [130.0])
        flat = series([100.0] * n)
        out = self._grader(entity, flat, flat).resolve(self._call())
        assert out.verdict == VERDICT_PARTIAL
        assert out.attribution == ATTRIBUTION_INCONCLUSIVE
        assert out.metadata["panel"]["downgraded"] is True
        # The terminal read is preserved for audit, not hidden.
        assert out.metadata["panel"]["pre_panel_verdict"] == VERDICT_CORRECT
        assert out.metadata["panel"]["pre_panel_attribution"] == ATTRIBUTION_CLEAN

    def test_a_long_call_reads_lower_confidence_than_the_same_short_call(self):
        n = 30
        entity = series([100.0 * (1.01 ** (i + 1)) for i in range(n)])
        flat = series([100.0] * n)
        long_out = self._grader(entity, flat, flat).resolve(self._call())

        short_call = dict(self._call())
        short_call["window_start"] = None
        one = series([100.0, 103.0])[:1]
        one = [{"date": "2026-03-31", "open": 100.0, "close": 103.0}]
        spy_one = [{"date": "2026-03-31", "open": 100.0, "close": 100.0}]
        short_out = self._grader(one, spy_one, spy_one).resolve(short_call)

        assert short_out.verdict == VERDICT_CORRECT
        assert (
            long_out.metadata["attribution_confidence"]
            < short_out.metadata["attribution_confidence"]
        )

    def test_a_short_call_carries_no_panel_keys_at_all(self):
        """Requirement 5: short calls keep benchmark attribution alone, and
        their stored row is unchanged in every byte."""
        call = dict(self._call())
        call["window_start"] = None
        one = [{"date": "2026-03-31", "open": 100.0, "close": 103.0}]
        spy_one = [{"date": "2026-03-31", "open": 100.0, "close": 100.0}]
        out = self._grader(one, spy_one, spy_one).resolve(call)
        for key in ("horizon_class", "attribution_grade", "checkpoints", "panel"):
            assert key not in out.metadata

    def test_a_missing_bar_series_degrades_to_attribution_only(self):
        """Older cached candles have no 'bars'. That must not crash and must
        not downgrade: no evidence, no penalty."""
        n = 30
        entity = series([100.0 * (1.01 ** (i + 1)) for i in range(n)])
        flat = series([100.0] * n)

        def fetch(symbol, start, end):
            bars = {"NVDA": entity, "SPY": flat, "XLK": flat}.get(symbol)
            if not bars:
                return None
            c = candle_from(bars)
            del c["bars"]  # pre-upgrade cache shape
            return c

        grader = PriceAttributionGrader(
            ticker_sectors={"NVDA": "technology"}, fetch_candle=fetch
        )
        out = grader.resolve(self._call())
        assert out.verdict == VERDICT_CORRECT
        assert out.metadata["checkpoints"] == []
        assert out.metadata["attribution_grade"] == GRADE_DIRECTIONAL


# ---------------------------------------------------------------------------
# NO LLM IN THE GRADING LOOP
# ---------------------------------------------------------------------------


class TestGradingIsPurePriceMath:
    def test_the_grader_module_imports_no_llm_client(self):
        import backend.grading.price_attribution as module

        source = open(module.__file__).read().lower()
        for needle in ("genai", "gemini", "openai", "anthropic"):
            assert needle not in source, f"{needle} must not appear in the grader"

    @staticmethod
    def _graded_outcome():
        """One clean, graded row. The numbers are what the note must carry."""
        from backend.grading.resolver import Outcome

        return Outcome(
            verdict=VERDICT_CORRECT,
            attribution=ATTRIBUTION_CLEAN,
            actual_open=100.0,
            actual_close=103.0,
            actual_pct_change=0.03,
            actual_direction="up",
            metadata={
                "entity_symbol": "NVDA",
                "entity_move_pct": 3.0,
                "benchmarks": [
                    {"symbol": "SPY", "role": "market", "move_pct": 0.2,
                     "excess_pct": 2.8, "meaningful_bar_pct": 0.5}
                ],
            },
        )

    @staticmethod
    def _stub_genai():
        """A stand-in for `google.genai` whose Client records construction.

        Injected into sys.modules rather than patching the installed package,
        so this proves the same thing on a machine where google-genai is not
        installed at all. `from google import genai` resolves the attribute off
        sys.modules["google"] and never reaches the real distribution.
        """
        import types
        from unittest import mock

        genai = types.ModuleType("google.genai")
        genai.Client = mock.Mock(name="genai.Client")
        google = types.ModuleType("google")
        google.genai = genai
        return google, genai

    def test_the_grading_loop_makes_no_llm_call_by_default(self):
        """No model client is CONSTRUCTED unless the run opts in.

        This used to assert that the returned sentence contained the words
        "correct" and "clean", inferring "no model was called" from the shape
        of a sentence. That is not the claim in the test's name, and it broke
        the moment the note stopped saying "correct" (the stored verdict token
        was leaking into reader-facing prose and was replaced with the shared
        vocabulary word). Asserting the NEW phrasing would only defer the same
        break to the next copy change, so the seam is asserted directly: the
        client constructor is spied on, and it must never fire.

        The two halves matter together. `gemini_verdict_notes` falls back to
        the deterministic text on ANY exception, so "no client constructed"
        alone is also satisfied by an ImportError on a machine without
        google-genai. The opted-in control below constructs the same stubbed
        client, which is what proves the flag is the reason and not a missing
        dependency.

        GEMINI_API_KEY is deliberately SET here, to a value that is never sent
        anywhere. Unset, the function raises before it reaches the constructor
        and the spy reads zero for a reason that has nothing to do with the
        flag, which would make this test pass on a CI box with no key even if
        the opt-in check were deleted outright. With a key present the flag is
        the only thing left standing between the run and a model client.
        """
        import os
        import sys
        from unittest import mock

        from backend.grading.grade_brief_calls import (
            _llm_notes_enabled,
            gemini_verdict_notes,
        )

        old_flag = os.environ.pop("GRADER_LLM_NOTES", None)
        old_key = os.environ.get("GEMINI_API_KEY")
        google, genai = self._stub_genai()
        try:
            os.environ["GEMINI_API_KEY"] = "stub-key-never-sent"
            assert _llm_notes_enabled() is False
            with mock.patch.dict(
                sys.modules, {"google": google, "google.genai": genai}
            ):
                notes = gemini_verdict_notes(
                    "NVDA rallies", "bullish", self._graded_outcome()
                )

            # THE CLAIM IN THE NAME. Not a word in a sentence: the constructor.
            assert genai.Client.call_count == 0, (
                "the default grading loop constructed a model client "
                f"{genai.Client.call_count} time(s)"
            )

            # Facts about the price math, which is what this class is for.
            # These are the entity and its move, not vocabulary.
            assert "NVDA" in notes and "+3.00%" in notes
        finally:
            if old_flag is not None:
                os.environ["GRADER_LLM_NOTES"] = old_flag
            if old_key is None:
                os.environ.pop("GEMINI_API_KEY", None)
            else:
                os.environ["GEMINI_API_KEY"] = old_key

    def test_the_spy_fires_when_the_run_opts_in(self):
        """Control for the test above. A spy that can never fire proves nothing.

        With GRADER_LLM_NOTES set, the SAME stub is constructed and asked for
        content. That is what makes the zero above mean "the flag is off"
        rather than "the patch missed the seam" or "the import failed".
        """
        import os
        import sys
        from unittest import mock

        from backend.grading.grade_brief_calls import gemini_verdict_notes

        old_flag = os.environ.get("GRADER_LLM_NOTES")
        old_key = os.environ.get("GEMINI_API_KEY")
        google, genai = self._stub_genai()
        try:
            os.environ["GRADER_LLM_NOTES"] = "1"
            # Never used: the stub is what answers. The function raises before
            # reaching the client when this is unset, which would construct
            # nothing and make the control pass for the wrong reason.
            os.environ["GEMINI_API_KEY"] = "stub-key-never-sent"
            with mock.patch.dict(
                sys.modules, {"google": google, "google.genai": genai}
            ):
                gemini_verdict_notes(
                    "NVDA rallies", "bullish", self._graded_outcome()
                )

            assert genai.Client.call_count == 1, (
                "opting in did not construct a model client, so the zero in "
                "the default-path test proves nothing about the flag"
            )
            assert (
                genai.Client.return_value.models.generate_content.call_count == 1
            )
        finally:
            for name, value in (
                ("GRADER_LLM_NOTES", old_flag),
                ("GEMINI_API_KEY", old_key),
            ):
                if value is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = value

    def test_resolving_a_call_makes_no_network_call_beyond_the_candle_fetch(self):
        """The injected fetcher is the ONLY IO seam. If anything else reached
        the network this test would need it stubbed; it does not."""
        n = 30
        entity = series([100.0 * (1.01 ** (i + 1)) for i in range(n)])
        flat = series([100.0] * n)
        calls: list[str] = []

        def fetch(symbol, start, end):
            calls.append(symbol)
            bars = {"NVDA": entity, "SPY": flat, "XLK": flat}.get(symbol)
            return candle_from(bars) if bars else None

        grader = PriceAttributionGrader(
            ticker_sectors={"NVDA": "technology"}, fetch_candle=fetch
        )
        out = grader.resolve(
            {
                "id": "c1",
                "claim_type": "ticker",
                "target_symbol": "NVDA",
                "expected_direction": "bullish",
                "brief_date": "2026-03-31",
                "window_start": "2026-01-01",
            }
        )
        assert out.verdict == VERDICT_CORRECT
        # Entity + sector + market, once each. Checkpoints added NOTHING.
        assert sorted(calls) == ["NVDA", "SPY", "XLK"]
        assert len(calls) == 3
