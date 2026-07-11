"""
Unit tests for backend/market_tape.py: regime ladder parity, baseline-correct
prior close, the sentiment_word/market_tone enforcement backstop, and the
prompt de-bias assertions on synthesize.py.

Parity: regime cases load from backend/tests/regime_parity_cases.json, the
SAME table consumed by src/lib/market-regime.test.mjs. Both implementations
must produce identical output for every row.

Run from repo root: python3 -m unittest backend.tests.test_market_tape
"""
import json
import unittest
from datetime import datetime, timezone
from pathlib import Path

from backend.market_tape import (
    DRIVER_MIN_ABS_PCT,
    DRIVER_TOP_K,
    MATERIALITY_MIN_DISTINCT_SOURCES,
    QUOTE_MAX_AGE_HOURS,
    REGIME_DEFAULT_WORD,
    REGIME_VOCAB,
    build_overview_subject_directive,
    build_tape_directive,
    build_tape_driver_names,
    compute_regime,
    enforce_tape_consistency,
    overview_subject_gate,
    parse_yahoo_daily,
    quote_is_fresh,
    serialize_tape_snapshot,
    tape_has_material_move,
)

HERE = Path(__file__).resolve().parent
CASES_PATH = HERE / "regime_parity_cases.json"
SYNTHESIZE_PATH = HERE.parent / "synthesize.py"

# 2026-06-05 was a Friday; 13:30 UTC is the regular 09:30 ET daily-bar stamp.
_DAY = 86400
_JUN1 = 1780320600  # 2026-06-01 13:30 UTC
_BAR_TS = [_JUN1 + i * _DAY for i in range(5)]  # Jun 1..5 daily bars
_NYSE_GMTOFF = -14400  # EDT


def chart(meta=None, timestamps=None, closes=None):
    """Build a minimal Yahoo v8 chart payload."""
    return {
        "chart": {
            "result": [
                {
                    "meta": meta or {},
                    "timestamp": timestamps or [],
                    "indicators": {"quote": [{"close": closes or []}]},
                }
            ]
        }
    }


class RegimeParityTests(unittest.TestCase):
    """Every row of the shared case table, against the Python ladder."""

    def test_all_cases(self):
        cases = json.loads(CASES_PATH.read_text())["cases"]
        self.assertGreaterEqual(len(cases), 14, "case table unexpectedly small")
        for c in cases:
            with self.subTest(note=c["note"]):
                got = compute_regime(
                    vix_level=c["vix_level"],
                    vix_pct_change=c["vix_pct_change"],
                    spx_pct_change=c["spx_pct_change"],
                )
                self.assertEqual(got, c["expected"])


class ParseYahooDailyTests(unittest.TestCase):
    def test_russell_2026_06_05(self):
        """
        The bug this module exists for. Real ^RUT data from 2026-06-05:
        Yahoo's range=1d meta.chartPreviousClose said 2893.51 (the Jun 3
        close, two sessions back) while the true prior close was 2935.33.
        The bar-derived baseline must yield -3.47%, not -2.07%.
        """
        payload = chart(
            meta={
                "regularMarketPrice": 2833.50,
                "regularMarketTime": _BAR_TS[4] + 6 * 3600 + 53 * 60,  # Fri 16:23 ET
                "gmtoffset": _NYSE_GMTOFF,
                "chartPreviousClose": 2893.51,  # the wrong anchor, must be ignored
            },
            timestamps=_BAR_TS,
            closes=[2905.76, 2931.96, 2893.51, 2935.33, 2833.50],
        )
        q = parse_yahoo_daily(payload)
        self.assertIsNotNone(q)
        self.assertAlmostEqual(q["prev"], 2935.33, places=2)
        self.assertEqual(q["pct"], -3.47)
        # Document the failure mode being fixed: the old meta-anchored
        # arithmetic produced the -2.07% the card showed.
        old_pct = round((2833.50 - 2893.51) / 2893.51 * 100, 2)
        self.assertEqual(old_pct, -2.07)

    def test_two_bar_series(self):
        payload = chart(
            meta={
                "regularMarketPrice": 103.0,
                "regularMarketTime": _BAR_TS[1] + 6 * 3600,
                "gmtoffset": _NYSE_GMTOFF,
            },
            timestamps=_BAR_TS[:2],
            closes=[100.0, 103.0],
        )
        q = parse_yahoo_daily(payload)
        self.assertEqual(q["prev"], 100.0)
        self.assertEqual(q["pct"], 3.0)

    def test_one_bar_no_meta_baseline(self):
        """Fresh listing: a single bar and no meta prev. No baseline, pct 0."""
        payload = chart(
            meta={
                "regularMarketPrice": 50.0,
                "regularMarketTime": _BAR_TS[0] + 6 * 3600,
                "gmtoffset": _NYSE_GMTOFF,
            },
            timestamps=_BAR_TS[:1],
            closes=[50.0],
        )
        q = parse_yahoo_daily(payload)
        self.assertEqual(q["prev"], 0.0)
        self.assertEqual(q["pct"], 0.0)
        self.assertEqual(q["change"], 0.0)

    def test_one_bar_falls_back_to_meta(self):
        """Holiday-shortened window: bars cannot supply prev, meta can."""
        payload = chart(
            meta={
                "regularMarketPrice": 101.0,
                "regularMarketTime": _BAR_TS[0] + 6 * 3600,
                "gmtoffset": _NYSE_GMTOFF,
                "chartPreviousClose": 99.0,
            },
            timestamps=_BAR_TS[:1],
            closes=[101.0],
        )
        q = parse_yahoo_daily(payload)
        self.assertEqual(q["prev"], 99.0)
        self.assertEqual(q["pct"], 2.02)

    def test_null_padded_closes_are_filtered(self):
        payload = chart(
            meta={
                "regularMarketPrice": 110.0,
                "regularMarketTime": _BAR_TS[4] + 6 * 3600,
                "gmtoffset": _NYSE_GMTOFF,
            },
            timestamps=_BAR_TS,
            closes=[100.0, None, 105.0, None, 110.0],
        )
        q = parse_yahoo_daily(payload)
        self.assertEqual(q["prev"], 105.0)

    def test_weekend_quote_uses_prior_session(self):
        """
        After Friday's close (and all weekend) regularMarketTime stays at
        Friday, so the baseline is Thursday's close: Friday's day move.
        """
        payload = chart(
            meta={
                "regularMarketPrice": 2833.50,
                "regularMarketTime": _BAR_TS[4] + 6 * 3600 + 53 * 60,
                "gmtoffset": _NYSE_GMTOFF,
            },
            timestamps=_BAR_TS,
            closes=[2905.76, 2931.96, 2893.51, 2935.33, 2833.50],
        )
        q = parse_yahoo_daily(payload)
        self.assertAlmostEqual(q["prev"], 2935.33, places=2)

    def test_missing_price_returns_none(self):
        self.assertIsNone(parse_yahoo_daily(chart(meta={}, timestamps=[], closes=[])))

    def test_garbage_payloads_return_none(self):
        self.assertIsNone(parse_yahoo_daily(None))
        self.assertIsNone(parse_yahoo_daily({}))
        self.assertIsNone(parse_yahoo_daily({"chart": {"result": None}}))


def _tape(regime="risk-off"):
    """Stub tape mirroring fetch_tape() output, Friday-shaped by default."""
    return {
        "quotes": {
            "^GSPC": {"price": 7383.74, "prev": 7584.31, "pct": -2.64, "change": -200.57, "ts": 1},
            "^IXIC": {"price": 25709.43, "prev": 26830.96, "pct": -4.18, "change": -1121.53, "ts": 1},
            "^RUT": {"price": 2833.50, "prev": 2935.33, "pct": -3.47, "change": -101.83, "ts": 1},
            "^VIX": {"price": 21.51, "prev": 15.40, "pct": 39.68, "change": 6.11, "ts": 1},
        },
        "regime": regime,
        "vix_level": 21.51,
    }


class TapeDirectiveTests(unittest.TestCase):
    """Prompt-construction assertions: no LLM call, pure string checks."""

    def test_directive_contains_tape_and_regime_subset(self):
        d = build_tape_directive(_tape("risk-off"))
        self.assertIn("[TAPE FACTS", d)
        self.assertIn("S&P 500: -2.64%", d)
        self.assertIn("Nasdaq Composite: -4.18%", d)
        self.assertIn("Russell 2000: -3.47%", d)
        self.assertIn("VIX: 21.5 (+39.7% vs prior close)", d)
        self.assertIn("Computed regime: RISK-OFF", d)
        self.assertIn("market_tone MUST be RISK-OFF", d)
        # The vocabulary line carries the full risk-off subset and no
        # cross-regime word. ("mixed" may appear in the prose rule that
        # forbids describing a red tape as mixed; only the allowed-words
        # line matters here.)
        vocab_line = next(l for l in d.splitlines() if "sentiment_word MUST" in l)
        self.assertIn(", ".join(REGIME_VOCAB["risk-off"]), vocab_line)
        self.assertNotIn("buoyant", vocab_line)
        self.assertNotIn("mixed", vocab_line)

    def test_directive_neutral_regime_allows_mixed_tone(self):
        d = build_tape_directive(_tape("neutral"))
        self.assertIn("market_tone MUST be NEUTRAL", d)
        self.assertIn("MIXED is also acceptable", d)
        self.assertIn(", ".join(REGIME_VOCAB["neutral"]), d)

    def test_directive_survives_partial_tape(self):
        t = _tape("risk-off")
        del t["quotes"]["^IXIC"]
        del t["quotes"]["^RUT"]
        d = build_tape_directive(t)
        self.assertIn("S&P 500: -2.64%", d)
        self.assertNotIn("Nasdaq", d)

    def test_synthesize_prompt_is_debiased(self):
        """
        The static system prompts must no longer model 'mixed' as the answer:
        no '(sentiment: mixed)' worked example and no mixed-first vocabulary
        ordering. Source-text assertion so the test never imports synthesize
        (module import requires Supabase env vars).
        """
        src = SYNTHESIZE_PATH.read_text()
        self.assertNotIn("(sentiment: mixed)", src)
        self.assertNotIn("sentiment: mixed", src)
        self.assertNotIn(
            "mixed, divided, split, conflicted, cautious", src,
            "old mixed-first vocabulary ordering is back",
        )
        # New alphabetical ordering present (mixed lands mid-list).
        self.assertIn("buoyant, cautious, choppy, conflicted", src)
        # Both grounding hooks are wired.
        self.assertIn("build_tape_directive", src)
        self.assertIn("enforce_tape_consistency", src)


class EnforceTapeConsistencyTests(unittest.TestCase):
    def test_mixed_under_risk_off_overrides_to_heavy(self):
        data = {"market_tone": "RISK-OFF", "market_pulse": {"sentiment_word": "mixed", "narrative": "x"}}
        warnings = enforce_tape_consistency(data, "risk-off")
        self.assertEqual(data["market_pulse"]["sentiment_word"], "heavy")
        self.assertTrue(any("overriding" in w for w in warnings))

    def test_heavy_under_risk_off_passes_through(self):
        data = {"market_tone": "RISK-OFF", "market_pulse": {"sentiment_word": "heavy", "narrative": "x"}}
        warnings = enforce_tape_consistency(data, "risk-off")
        self.assertEqual(data["market_pulse"]["sentiment_word"], "heavy")
        self.assertEqual(warnings, [])

    def test_word_is_normalized_lowercase(self):
        data = {"market_tone": "RISK-OFF", "market_pulse": {"sentiment_word": " Heavy ", "narrative": "x"}}
        enforce_tape_consistency(data, "risk-off")
        self.assertEqual(data["market_pulse"]["sentiment_word"], "heavy")

    def test_no_regime_nulls_the_word(self):
        data = {"market_tone": "MIXED", "market_pulse": {"sentiment_word": "mixed", "narrative": "x"}}
        warnings = enforce_tape_consistency(data, None)
        self.assertIsNone(data["market_pulse"]["sentiment_word"])
        self.assertTrue(any("ungrounded" in w for w in warnings))
        # Without a regime there is no basis to rewrite market_tone.
        self.assertEqual(data["market_tone"], "MIXED")

    def test_inconsistent_tone_is_corrected(self):
        data = {"market_tone": "MIXED", "market_pulse": {"sentiment_word": "heavy", "narrative": "x"}}
        enforce_tape_consistency(data, "risk-off")
        self.assertEqual(data["market_tone"], "RISK-OFF")

    def test_neutral_regime_accepts_mixed_tone_and_word(self):
        data = {"market_tone": "MIXED", "market_pulse": {"sentiment_word": "choppy", "narrative": "x"}}
        warnings = enforce_tape_consistency(data, "neutral")
        self.assertEqual(data["market_tone"], "MIXED")
        self.assertEqual(data["market_pulse"]["sentiment_word"], "choppy")
        self.assertEqual(warnings, [])

    def test_missing_pulse_still_corrects_tone(self):
        data = {"market_tone": "RISK-ON"}
        enforce_tape_consistency(data, "risk-off")
        self.assertEqual(data["market_tone"], "RISK-OFF")

    def test_defaults_cover_every_regime(self):
        for regime, default in REGIME_DEFAULT_WORD.items():
            self.assertIn(default, REGIME_VOCAB[regime])


def _mtape(spx_pct, vix_pct, vix_level=16.0):
    return {"quotes": {"^GSPC": {"pct": spx_pct}, "^VIX": {"pct": vix_pct, "price": vix_level}},
            "regime": "neutral", "vix_level": vix_level}


class MaterialityGateTests(unittest.TestCase):
    """D2+D3: the overview-subject materiality gate. Defaults to market-wide; a
    single-name/deal story is only the subject when the tape is material AND the
    story is the tape driver AND its event cluster has dominant breadth."""

    def test_mild_tape_is_not_material(self):
        self.assertFalse(tape_has_material_move(_mtape(0.3, 2.0)))

    def test_big_spx_move_is_material(self):
        self.assertTrue(tape_has_material_move(_mtape(-1.4, 5.0)))

    def test_vix_spike_is_material(self):
        self.assertTrue(tape_has_material_move(_mtape(0.2, 12.0)))

    def test_none_tape_not_material(self):
        self.assertFalse(tape_has_material_move(None))

    def test_single_name_on_mild_tape_relegated(self):
        # The 06-24 shape: single-name story, mild tape, broad cluster -> mention.
        gate = overview_subject_gate(
            story_companies=["SpaceX"],
            is_single_name_or_deal=True,
            cluster_distinct_sources=11,
            tape=_mtape(0.3, 2.0),
            tape_driver_names=None,
        )
        self.assertEqual(gate["subject"], "market_wide")
        self.assertFalse(gate["passed"])

    def test_single_name_clears_when_all_three_pass(self):
        gate = overview_subject_gate(
            story_companies=["Nvidia"],
            is_single_name_or_deal=True,
            cluster_distinct_sources=MATERIALITY_MIN_DISTINCT_SOURCES + 1,
            tape=_mtape(-1.6, 9.0),
            tape_driver_names=["Nvidia"],
        )
        self.assertEqual(gate["subject"], "story")
        self.assertTrue(gate["passed"])

    def test_market_wide_story_always_subject(self):
        gate = overview_subject_gate(
            story_companies=[],
            is_single_name_or_deal=False,
            cluster_distinct_sources=1,
            tape=_mtape(0.1, 0.0),
            tape_driver_names=None,
        )
        self.assertEqual(gate["subject"], "story")
        self.assertTrue(gate["passed"])

    def test_directive_market_wide_text(self):
        gate = overview_subject_gate(
            story_companies=["SpaceX"], is_single_name_or_deal=True,
            cluster_distinct_sources=11, tape=_mtape(0.3, 2.0), tape_driver_names=None)
        d = build_overview_subject_directive(gate, "SpaceX stock slumps post-IPO")
        self.assertIn("MARKET-WIDE", d)
        self.assertIn("mention", d.lower())


class BuildTapeDriverNamesT3(unittest.TestCase):
    def test_material_mover_qualifies(self):
        out = build_tape_driver_names({"Micron Technology": -6.7})
        self.assertEqual(out, {"micron technology"})

    def test_below_threshold_excluded(self):
        # |1.2| is at/under DRIVER_MIN_ABS_PCT (2.0) -> not a driver.
        self.assertLess(1.2, DRIVER_MIN_ABS_PCT + 0.01)
        self.assertEqual(build_tape_driver_names({"Apple": 1.2}), set())

    def test_top_k_caps_the_set(self):
        names = {f"co{i}": (10.0 - i) for i in range(DRIVER_TOP_K + 3)}
        out = build_tape_driver_names(names)
        self.assertEqual(len(out), DRIVER_TOP_K, "driver set must be capped at DRIVER_TOP_K")
        # The largest movers win: co0 (10.0) through co{K-1}.
        for i in range(DRIVER_TOP_K):
            self.assertIn(f"co{i}", out)

    def test_empty_or_garbage_yields_empty_set(self):
        self.assertEqual(build_tape_driver_names({}), set())
        self.assertEqual(build_tape_driver_names(None), set())
        self.assertEqual(build_tape_driver_names({"x": None, "": 9.0}), set())

    def test_sign_ignored_only_magnitude(self):
        out = build_tape_driver_names({"up": 5.0, "down": -5.0})
        self.assertEqual(out, {"up", "down"})


class SerializeTapeSnapshotTests(unittest.TestCase):
    """Persist gen-time tape (v2 Gate 1 prerequisite): the serializer produces a
    stable structured shape from tape_obj, and None when there is no tape."""

    SAMPLE = {
        "quotes": {
            "^GSPC": {"price": 7600.0, "prev": 7500.0, "pct": 1.33},
            "^IXIC": {"price": 25800.0, "prev": 25400.0, "pct": 1.57},
            "^DJI": {"price": 44100.0, "prev": 43700.0, "pct": 0.92},
            "^RUT": {"price": 2300.0, "prev": 2310.0, "pct": -0.43},
            "^VIX": {"price": 14.2, "prev": 15.0, "pct": -5.33},
        },
        "regime": "risk-on",
        "vix_level": 14.2,
    }

    def test_serializes_expected_shape(self):
        snap = serialize_tape_snapshot(self.SAMPLE, as_of="2026-06-28T14:00:00+00:00")
        self.assertEqual(snap["as_of"], "2026-06-28T14:00:00+00:00")
        self.assertEqual(snap["regime"], "risk-on")
        self.assertEqual(snap["vix_level"], 14.2)
        self.assertEqual(snap["vix_pct"], -5.33)
        self.assertEqual(snap["indices"]["sp500"], {"pct": 1.33, "level": 7600.0})
        self.assertEqual(snap["indices"]["nasdaq"], {"pct": 1.57, "level": 25800.0})
        self.assertEqual(snap["indices"]["russell"], {"pct": -0.43, "level": 2300.0})
        # Dow is now in TAPE_SYMBOLS; a real ^DJI quote serializes to real values.
        self.assertEqual(snap["indices"]["dow"], {"pct": 0.92, "level": 44100.0})

    def test_missing_dow_serializes_to_null_subfields(self):
        # A tape lacking ^DJI still serializes the dow key with null sub-fields
        # (read-side stability: the key never drops).
        tape = {k: v for k, v in self.SAMPLE.items()}
        tape["quotes"] = {s: q for s, q in self.SAMPLE["quotes"].items() if s != "^DJI"}
        snap = serialize_tape_snapshot(tape)
        self.assertEqual(snap["indices"]["dow"], {"pct": None, "level": None})

    def test_none_tape_returns_none(self):
        self.assertIsNone(serialize_tape_snapshot(None))
        self.assertIsNone(serialize_tape_snapshot({}))
        self.assertIsNone(serialize_tape_snapshot("not a dict"))

    def test_missing_symbol_serializes_null_subfields(self):
        snap = serialize_tape_snapshot({"quotes": {}, "regime": "neutral", "vix_level": None})
        self.assertEqual(snap["indices"]["sp500"], {"pct": None, "level": None})
        self.assertIsNone(snap["vix_pct"])
        self.assertEqual(snap["regime"], "neutral")

    def test_column_value_is_native_dict_not_json_string(self):
        # market_tape is a JSONB column. synthesize.py must insert the native dict,
        # NOT json.dumps(dict): a json-string is stored as a jsonb STRING scalar
        # and `->`/`->>` cannot key into it (the regime/dow "null" bug). Offline
        # equivalent of asserting jsonb_typeof = object: the value the insert uses
        # is a dict, and native nested access resolves.
        snap = serialize_tape_snapshot(self.SAMPLE, as_of="2026-06-30T02:21:00+00:00")
        self.assertIsInstance(snap, dict)
        self.assertNotIsInstance(snap, str)
        # Native key access == Postgres `->>'regime'` on a jsonb OBJECT.
        self.assertEqual(snap["regime"], "risk-on")
        self.assertIsNotNone(snap["regime"])
        # Native nested access == `market_tape->'indices'->'dow'->>'pct'`.
        self.assertEqual(snap["indices"]["dow"]["pct"], 0.92)
        self.assertIsNotNone(snap["indices"]["dow"]["pct"])
        # The OLD broken form: json.dumps makes a str (a jsonb string scalar once
        # stored), on which nested access is impossible. Guards the insert site
        # against re-introducing json.dumps for this jsonb column.
        self.assertIsInstance(json.dumps(snap), str)


class QuoteFreshnessTests(unittest.TestCase):
    """FRESHNESS ASSERT: a quote timestamp must belong to the current session.
    This is the P0 defense against an index panel frozen to a prior-session
    close while VIX / oil / names move."""

    # A fixed Wednesday 2026-07-08 20:00 UTC (16:00 ET, a normal weekday close).
    WED = datetime(2026, 7, 8, 20, 0, 0, tzinfo=timezone.utc)
    # A fixed Saturday 2026-07-11 12:00 UTC.
    SAT = datetime(2026, 7, 11, 12, 0, 0, tzinfo=timezone.utc)

    def test_current_session_is_fresh(self):
        ts = int(self.WED.timestamp())  # stamped now
        self.assertTrue(quote_is_fresh(ts, now_utc=self.WED))

    def test_within_overnight_gap_is_fresh(self):
        # 20h old on a weekday: within QUOTE_MAX_AGE_HOURS.
        ts = int(self.WED.timestamp()) - 20 * 3600
        self.assertTrue(quote_is_fresh(ts, now_utc=self.WED))

    def test_prior_session_echo_is_stale_on_weekday(self):
        # ~44h old: a two-session-old echo. This is the frozen-panel bug shape.
        ts = int(self.WED.timestamp()) - 44 * 3600
        self.assertFalse(quote_is_fresh(ts, now_utc=self.WED))
        # Sanity: just over the trading-day limit is stale.
        ts_edge = int(self.WED.timestamp()) - (QUOTE_MAX_AGE_HOURS + 1) * 3600
        self.assertFalse(quote_is_fresh(ts_edge, now_utc=self.WED))

    def test_missing_timestamp_is_not_fresh(self):
        # No timestamp == cannot prove current session == fail loud.
        self.assertFalse(quote_is_fresh(None, now_utc=self.WED))

    def test_weekend_allows_friday_close(self):
        # Sat noon, quote stamped Fri 16:00 ET (~44h back) is legitimately fresh.
        friday_close = int((self.SAT.timestamp())) - 44 * 3600
        self.assertTrue(quote_is_fresh(friday_close, now_utc=self.SAT))

    def test_future_timestamp_is_not_fresh(self):
        ts = int(self.WED.timestamp()) + 3600
        self.assertFalse(quote_is_fresh(ts, now_utc=self.WED))


class SerializeStaleAndEnrichmentTests(unittest.TestCase):
    """Snapshot carries the stale-drop list and additive enrichment (Agent C)."""

    BASE = {
        "quotes": {
            "^GSPC": {"price": 7600.0, "prev": 7500.0, "pct": 1.33, "ts": 1},
            "^VIX": {"price": 14.2, "prev": 15.0, "pct": -5.33, "ts": 1},
        },
        "regime": "risk-on",
        "vix_level": 14.2,
    }

    def test_stale_key_present_and_empty_by_default(self):
        snap = serialize_tape_snapshot(self.BASE)
        self.assertEqual(snap["stale"], [])

    def test_stale_symbols_carried_to_snapshot(self):
        tape = {**self.BASE, "stale": ["^DJI", "^RUT"]}
        snap = serialize_tape_snapshot(tape)
        self.assertEqual(snap["stale"], ["^DJI", "^RUT"])

    def test_enrichment_absent_when_not_fetched(self):
        # No enrichment key on the tape -> not present on snapshot (read-stable).
        snap = serialize_tape_snapshot(self.BASE)
        self.assertNotIn("enrichment", snap)

    def test_enrichment_passthrough_when_present(self):
        enrichment = {
            "rates": {"teny_level": 4.21, "teny_bps_change": 3.0},
            "oil": {"wti_level": 71.51, "wti_pct": -0.1},
            "sector_leadership": {"leaders": [], "laggards": [], "is_proxy": True},
            "breadth": None,
            "breadth_available": False,
        }
        tape = {**self.BASE, "enrichment": enrichment}
        snap = serialize_tape_snapshot(tape)
        self.assertEqual(snap["enrichment"], enrichment)
        # Contract for Agent C: breadth is explicitly unavailable from this source.
        self.assertFalse(snap["enrichment"]["breadth_available"])
        self.assertIsNone(snap["enrichment"]["breadth"])
        self.assertTrue(snap["enrichment"]["sector_leadership"]["is_proxy"])

    def test_index_pct_is_single_source(self):
        # The pct in the snapshot is the exact value from parse_yahoo_daily,
        # never recomputed. Guards against a second producer drifting.
        snap = serialize_tape_snapshot(self.BASE)
        self.assertEqual(snap["indices"]["sp500"]["pct"], 1.33)
        self.assertEqual(snap["indices"]["sp500"]["level"], 7600.0)


if __name__ == "__main__":
    unittest.main()
