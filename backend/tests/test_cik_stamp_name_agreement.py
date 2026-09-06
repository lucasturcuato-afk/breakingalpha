"""companies.sec_cik must not be stamped from a bare ticker join.

Regression cover for three defects found in prod on 2026-08-31:

  1. SILENT TRUNCATION. _update_companies_sec_cik read cik_tickers with a
     bare .execute(), which PostgREST caps at 1000 rows with no error. The
     table holds 11,072, so the job saw 9 percent of it, matched nothing it
     had not already matched, and reported companies_updated=0 as a success
     on every hourly run.
  2. LAST-WRITE-WINS on duplicate tickers, which resolved XOM to
     'ExxonMobil Holdings Corp' instead of 'EXXON MOBIL CORP'.
  3. NO NAME CHECK and NO EXISTENCE GUARD, while the mint-time twin
     (entity_resolver.populate_sec_cik_for_mint) had the existence guard.
     Same column, two policies.

Every write path here runs against a FAKE CLIENT. No database is touched.
"""
from __future__ import annotations

import unittest

from backend.edgar.cik_mapping import (
    _build_ticker_index,
    _page_all,
    _update_companies_sec_cik,
)
from backend.edgar.name_agreement import names_agree
from backend.finnhub_helper import _pick_us_primary


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, parent, table):
        self.p, self.t = parent, table
        self.filters = []
        self.lo, self.hi = None, None
        self.op = "select"
        self.payload = None

    def select(self, *_a, **_k):
        self.op = "select"
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def order(self, *_a, **_k):
        return self

    def range(self, lo, hi):
        self.lo, self.hi = lo, hi
        return self

    def eq(self, col, val):
        self.filters.append((col, val))
        return self

    def execute(self):
        if self.op == "update":
            self.p.writes.append((self.t, self.payload, list(self.filters)))
            return _Resp([])
        rows = list(self.p.tables.get(self.t, []))
        for col, val in self.filters:
            rows = [r for r in rows if r.get(col) == val]
        self.p.reads.append((self.t, self.lo, self.hi))
        if self.lo is None:
            # PostgREST's DEFAULT MAX-ROWS CAP, silent by design.
            return _Resp(rows[: self.p.cap])
        return _Resp(rows[self.lo : self.hi + 1])


class FakeSB:
    """Offline supabase-py shim with PostgREST's silent 1000-row cap."""

    def __init__(self, tables, cap=1000):
        self.tables, self.cap = tables, cap
        self.writes, self.reads = [], []

    def table(self, name):
        return _Query(self, name)


def _mapping(cik, ticker, name):
    return {"cik": cik, "ticker": ticker, "company_name": name}


class PaginationTests(unittest.TestCase):
    def test_page_all_reads_past_the_silent_1000_row_cap(self):
        rows = [_mapping(i, f"T{i}", f"Co {i}") for i in range(1, 11073)]
        sb = FakeSB({"cik_tickers": rows})
        got = _page_all(sb, "cik_tickers", "cik, ticker, company_name", "cik")
        self.assertEqual(len(got), 11072)

    def test_bare_execute_would_have_returned_only_the_cap(self):
        """Pins the defect itself, so a regression is visible as a diff."""
        rows = [_mapping(i, f"T{i}", f"Co {i}") for i in range(1, 11073)]
        sb = FakeSB({"cik_tickers": rows})
        self.assertEqual(len(sb.table("cik_tickers").select("*").execute().data), 1000)


class DuplicateTickerTests(unittest.TestCase):
    def test_duplicate_ticker_resolves_to_smallest_cik(self):
        idx = _build_ticker_index([
            _mapping(34088, "XOM", "EXXON MOBIL CORP"),
            _mapping(2115436, "XOM", "ExxonMobil Holdings Corp"),
        ])
        self.assertEqual(idx["XOM"], (34088, "EXXON MOBIL CORP"))

    def test_matches_entity_resolver_rule_on_paramount(self):
        idx = _build_ticker_index([
            _mapping(1826011, "PARA", "Banzai International, Inc."),
            _mapping(813828, "PARA", "Paramount Global"),
        ])
        self.assertEqual(idx["PARA"][0], 813828)


class NameAgreementTests(unittest.TestCase):
    def test_fails_open_without_an_authority_name(self):
        for absent in (None, "", "   "):
            agrees, why = names_agree("Anything", absent)
            self.assertTrue(agrees, why)
            self.assertIn("fail-open", why)

    def test_blocks_the_named_prod_cross_wires(self):
        for ours, registrant in [
            ("Ola", "COCA COLA CO"),
            ("Vanguard", "AMERICAN VANGUARD CORP"),
            ("Gett", "Rigetti Computing, Inc."),
            ("AXT Inc.", "BAXTER INTERNATIONAL INC"),
            ("Fidelity", "Fidelity National Information Services, Inc."),
            ("BYD", "BOYD GAMING CORP"),
            ("CSL", "CARLISLE COMPANIES INC"),
            ("AWS", "Jaws Mustang Acquisition Corp"),
        ]:
            self.assertFalse(names_agree(ours, registrant)[0], f"{ours} / {registrant}")

    def test_admits_the_rows_a_fail_closed_gate_would_have_blanked(self):
        for ours, registrant in [
            ("Electronic Arts", "ELECTRONIC ARTS INC"),
            ("Chart Industries", "CHART INDUSTRIES INC"),
            ("Twist Bioscience Corp", "Twist Bioscience Corp"),
            ("Apple", "Apple Inc."),
            ("Alight, Inc.", "Alight, Inc. / Delaware"),
        ]:
            self.assertTrue(names_agree(ours, registrant)[0], f"{ours} / {registrant}")


class UpdateCompaniesTests(unittest.TestCase):
    def _run(self, companies, mappings, cap=1000):
        sb = FakeSB({"companies": companies, "cik_tickers": mappings}, cap=cap)
        return sb, _update_companies_sec_cik(sb)

    def test_stamps_a_clean_match(self):
        sb, stats = self._run(
            [{"id": "c1", "name": "Apple", "ticker": "AAPL", "sec_cik": None}],
            [_mapping(320193, "AAPL", "Apple Inc.")],
        )
        self.assertEqual(stats["updated"], 1)
        self.assertEqual(sb.writes, [("companies", {"sec_cik": 320193}, [("id", "c1")])])

    def test_name_gate_blocks_the_ola_coca_cola_stamp(self):
        sb, stats = self._run(
            [{"id": "c1", "name": "Ola", "ticker": "KO", "sec_cik": None}],
            [_mapping(21344, "KO", "COCA COLA CO")],
        )
        self.assertEqual(stats["blocked_name"], 1)
        self.assertEqual(stats["updated"], 0)
        self.assertEqual(sb.writes, [], "no write may reach the database")

    def test_gate_never_clears_an_existing_cik(self):
        sb, stats = self._run(
            [{"id": "c1", "name": "Exxon", "ticker": "XOM", "sec_cik": 34088}],
            [
                _mapping(34088, "XOM", "EXXON MOBIL CORP"),
                _mapping(2115436, "XOM", "ExxonMobil Holdings Corp"),
            ],
        )
        self.assertEqual(sb.writes, [])
        self.assertEqual(stats["updated"], 0)

    def test_existence_guard_refuses_a_second_holder(self):
        sb, stats = self._run(
            [
                {"id": "held", "name": "Apple Inc.", "ticker": "AAPL", "sec_cik": 320193},
                {"id": "dupe", "name": "Apple", "ticker": "AAPL", "sec_cik": None},
            ],
            [_mapping(320193, "AAPL", "Apple Inc.")],
        )
        self.assertEqual(stats["blocked_holder"], 1)
        self.assertEqual(sb.writes, [])

    def test_fails_open_when_cik_tickers_has_no_registrant_name(self):
        sb, stats = self._run(
            [{"id": "c1", "name": "Whatever Holdings", "ticker": "WAT", "sec_cik": None}],
            [{"cik": 999, "ticker": "WAT", "company_name": None}],
        )
        self.assertEqual(stats["updated"], 1, "staleness must not block a write")

    def test_reads_every_page_so_a_late_ticker_is_still_matched(self):
        """The prod failure: the target ticker sat past row 1000."""
        mappings = [_mapping(i, f"T{i}", f"Co {i}") for i in range(1, 11073)]
        mappings.append(_mapping(320193, "AAPL", "Apple Inc."))
        sb, stats = self._run(
            [{"id": "c1", "name": "Apple", "ticker": "AAPL", "sec_cik": None}],
            mappings,
        )
        self.assertEqual(stats["updated"], 1)


if __name__ == "__main__":
    unittest.main()


class MatcherCorrectionTests(unittest.TestCase):
    """Cases the first revision of the matcher got wrong. Each one is a real
    prod row or a shape measured against live Finnhub /search."""

    def test_two_letter_acronym_floor_blocks_hp(self):
        # 'HP Inc.' vs 'Helmerich & Payne, Inc.' matches on the {h, p}
        # initials and is a real prod cross-wire: companies.ticker HP,
        # sec_cik 46765, which is Helmerich & Payne. HP Inc. is HPQ / 47217.
        self.assertFalse(names_agree("HP Inc.", "Helmerich & Payne, Inc.")[0])

    def test_three_letter_acronyms_still_match(self):
        for ours, authority in [
            ("AMD", "ADVANCED MICRO DEVICES INC"),
            ("IBM", "INTERNATIONAL BUSINESS MACHINES CORP"),
            ("UPS", "UNITED PARCEL SERVICE INC"),
        ]:
            self.assertTrue(names_agree(ours, authority)[0], f"{ours}/{authority}")

    def test_weak_tokens_survive_into_the_acronym_test(self):
        # 'international' is dropped for set comparison but MUST be kept for
        # the acronym test, or INTERNATIONAL BUSINESS MACHINES loses its I
        # and IBM stops matching itself.
        self.assertTrue(names_agree("IBM", "International Business Machines")[0])

    def test_bounded_head_prefix_accepts_a_single_extra_token(self):
        for ours, authority in [
            ("Coinbase", "Coinbase Global, Inc."),
            ("Amazon", "AMAZON COM INC"),
            ("Chime", "Chime Financial, Inc."),
            ("Lyra", "Lyra Therapeutics, Inc."),
            ("Huron", "Huron Consulting Group Inc."),
        ]:
            self.assertTrue(names_agree(ours, authority)[0], f"{ours}/{authority}")

    def test_bounded_head_prefix_rejects_more_than_one_extra_token(self):
        # The bound is the only thing separating these from the cases above.
        for ours, authority in [
            ("Fidelity", "Fidelity National Information Services, Inc."),
            ("BNY", "BNY MELLON STRATEGIC MUNICIPALS, INC."),
            ("xAI", "XAI Floating Rate & Alternative Income Trust"),
            ("Bain", "Bain Capital Specialty Finance, Inc."),
        ]:
            self.assertFalse(names_agree(ours, authority)[0], f"{ours}/{authority}")

    def test_head_position_is_load_bearing(self):
        # 'Vanguard' is a one-extra-token INTERIOR match of 'AMERICAN
        # VANGUARD CORP'. Only the leading-position requirement rejects it,
        # which is why the rule cannot be relaxed to "appears anywhere".
        self.assertFalse(names_agree("Vanguard", "AMERICAN VANGUARD CORP")[0])

    def test_head_prefix_runs_on_raw_tokens(self):
        # 'Urban Company' reduces to ['urban'] once 'company' is stripped as
        # a legal form, which makes it a +1 head prefix of URBAN OUTFITTERS.
        # Urban Company is an Indian home-services firm. On raw tokens the
        # second position disagrees and the rule declines.
        self.assertFalse(names_agree("Urban Company", "URBAN OUTFITTERS INC")[0])

    def test_single_character_debris_is_not_identity(self):
        # Stripping the dots out of 'S.A.' and 'N.V.' leaves loose letters
        # that the other side cannot match. All three are real prod rows.
        for ours, authority in [
            ("Globant", "Globant S.A."),
            ("Spotify", "Spotify Technology S.A."),
            ("Nebius", "Nebius Group N.V."),
        ]:
            self.assertTrue(names_agree(ours, authority)[0], f"{ours}/{authority}")

    def test_renames_are_rejected_and_that_is_the_cheap_direction(self):
        # No string matcher can connect these. The gate never clears an
        # existing sec_cik, so the cost is a missing stamp on a re-run, not a
        # wrong one. Recovering them needs an alias, not a looser matcher.
        for ours, authority in [
            ("Raytheon", "RTX Corp"),
            ("Disney", "Walt Disney Co"),
            ("SpaceX", "SPACE EXPLORATION TECHNOLOGIES CORP"),
        ]:
            self.assertFalse(names_agree(ours, authority)[0], f"{ours}/{authority}")


class FinnhubAuthorGateTests(unittest.TestCase):
    """The gate on the write that AUTHORS a cross-wire.

    finnhub_helper._pick_us_primary took the first accepted /search candidate
    with no name check. Against live /search on 2026-09-01 that reproduced 10
    of the 12 named prod cross-wires exactly.
    """

    @staticmethod
    def _c(symbol, description, type_="Common Stock"):
        return {
            "symbol": symbol,
            "displaySymbol": symbol,
            "description": description,
            "type": type_,
        }

    def test_ungated_call_still_takes_rank_one(self):
        res = [self._c("KO", "Coca-Cola Co")]
        self.assertEqual(_pick_us_primary(res), "KO")

    def test_gate_vetoes_the_named_cross_wires(self):
        for name, symbol, description in [
            ("Ola", "KO", "Coca-Cola Co"),
            ("Gett", "RGTI", "Rigetti Computing Inc"),
            ("CSL", "CSL", "CARLISLE COS INC"),
            ("Vanguard", "AVD", "American Vanguard Corp"),
            ("Fidelity", "FIS", "Fidelity National Information Services Inc"),
            ("LIC", "RSG", "Republic Services Inc"),
            ("GHO", "WAB", "Westinghouse Air Brake Technologies Corp"),
            ("Revolut", "RVMD", "Revolution Medicines Inc"),
            ("YC", "PAYX", "Paychex Inc"),
            ("Motive", "ORLY", "O'Reilly Automotive Inc"),
        ]:
            res = [self._c(symbol, description)]
            self.assertEqual(_pick_us_primary(res), symbol, f"{name} ungated")
            self.assertIsNone(
                _pick_us_primary(res, our_name=name), f"{name} gated"
            )

    def test_gate_passes_a_genuine_match(self):
        res = [self._c("KO", "Coca-Cola Co")]
        self.assertEqual(_pick_us_primary(res, our_name="Coca-Cola"), "KO")

    def test_gate_fails_open_without_a_description(self):
        res = [self._c("AAPL", None)]
        self.assertEqual(_pick_us_primary(res, our_name="Apple"), "AAPL")

    def test_gate_is_a_veto_not_a_rerank(self):
        # Rank 1 disagrees and a lower-ranked candidate agrees. A re-ranking
        # gate would return FDBC here. Measured on live /search, that is
        # exactly how 'Fidelity' lands on a Pennsylvania community bank:
        # a different wrong answer, which is not an improvement.
        res = [
            self._c("FIS", "Fidelity National Information Services Inc"),
            self._c("FDBC", "Fidelity D & D Bancorp Inc"),
        ]
        self.assertIsNone(_pick_us_primary(res, our_name="Fidelity"))


class BoundedSubsetRule(unittest.TestCase):
    """The subset branch was unbounded while the head-prefix branch was not.

    Replayed against live Finnhub /search on 2026-09-06: 'Energy Capital'
    returns 'El Paso Energy Capital Trust I' at rank 1, the subset branch
    accepted it on two shared tokens, and EP PR C reached a companies row.
    Same shape the head-prefix bound was written to reject, on the branch that
    never got the bound.
    """

    def test_rejects_a_non_leading_subset_that_adds_more_than_one_token(self):
        # {energy, capital} is a subset of {el, paso, energy, capital, trust}
        # with 2 shared tokens. Unbounded, that is an accept.
        self.assertFalse(
            names_agree("Energy Capital", "El Paso Energy Capital Trust I")[0]
        )

    def test_still_accepts_a_leading_subset_however_much_is_added(self):
        # Position carries the claim when the bound cannot. Both pairs add TWO
        # identity tokens, so MAX_HEAD_PREFIX_EXTRA alone rejects them and only
        # the leading test lets them through. Taken from live registrant names.
        #
        # An earlier version of this test used a pair whose token sets turned
        # out to be EQUAL once 'holding' and 'corp' were stripped as weak and
        # legal forms, so it passed on the equality branch and never reached
        # the subset branch at all. It asserted True about code it never ran.
        for ours, authority in [
            ("Check Point", "CHECK POINT SOFTWARE TECHNOLOGIES LTD"),
            ("Kratos Defense", "KRATOS DEFENSE & SECURITY SOLUTIONS, INC."),
        ]:
            agrees, why = names_agree(ours, authority)
            self.assertTrue(agrees, f"{ours}/{authority}")
            self.assertTrue(
                why.startswith("subset"),
                f"{ours}/{authority} accepted by {why!r}, not the subset branch",
            )

    def test_still_accepts_a_bounded_subset_that_does_not_lead(self):
        # One extra identity token is inside the bound regardless of position.
        self.assertTrue(names_agree("Norwegian Cruise", "Norwegian Cruise Line")[0])

    def test_the_twenty_stamped_rows_are_unaffected(self):
        # Measured: of the CIK-bearing rows in prod, the ones the subset branch
        # accepted are all either leading or within the bound. The tightening
        # costs none of them. These are drawn from that set.
        for ours, authority in [
            ("Theravance Biopharma", "Theravance Biopharma, Inc."),
            ("PennantPark Investment", "PennantPark Investment Corp"),
            ("Guardian Pharmacy Services", "Guardian Pharmacy Services, Inc."),
        ]:
            self.assertTrue(names_agree(ours, authority)[0], f"{ours}/{authority}")


class IssuerSymbolShape(unittest.TestCase):
    """The US-primary filter looked for a PERIOD and never anticipated a SPACE.

    Finnhub returns {"type": "Common Stock", "symbol": "EP PR C",
    "displaySymbol": "EP PR C", "description": "El Paso Energy Capital Trust I"}.
    Typed Common Stock, no period, so it passed every filter and reached a
    companies row. It is preferred series C, not a company symbol.
    """

    @staticmethod
    def _c(sym, desc, type_="Common Stock"):
        return {"symbol": sym, "displaySymbol": sym, "description": desc, "type": type_}

    def test_rejects_a_preferred_share_designation(self):
        res = [self._c("EP PR C", "El Paso Energy Capital Trust I")]
        self.assertIsNone(_pick_us_primary(res, our_name=None))

    def test_rejects_the_same_shape_already_live_in_prod(self):
        # TRTN PR A sits on a CIK-bearing row today. Same shape, same gap.
        res = [self._c("TRTN PR A", "Triton International Ltd")]
        self.assertIsNone(_pick_us_primary(res, our_name=None))

    def test_rejects_a_pre_ipo_placeholder(self):
        # Four letters after a hyphen are not a share class.
        res = [self._c("IPO-ELLT", "Elliott Opportunity")]
        self.assertIsNone(_pick_us_primary(res, our_name=None))

    def test_keeps_both_spellings_of_a_real_class_share(self):
        # Some feeds write Moog Inc Class A as MOG-A and some as MOG.A.
        self.assertEqual(
            _pick_us_primary([self._c("MOG-A", "Moog Inc")], our_name=None), "MOG-A"
        )
        self.assertEqual(
            _pick_us_primary([self._c("BRK.B", "Berkshire Hathaway Inc")], our_name=None),
            "BRK.B",
        )

    def test_keeps_ordinary_symbols_of_every_length(self):
        for sym in ["KO", "MARA", "SSNLF", "V", "NCLH"]:
            self.assertEqual(
                _pick_us_primary([self._c(sym, "Some Issuer Inc")], our_name=None),
                sym,
                sym,
            )
