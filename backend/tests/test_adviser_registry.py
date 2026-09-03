"""Tests for the ADV Part 1 / Form 13F adviser-registry ingest.

Every write path is exercised against a FAKE CLIENT. Nothing here touches a
network or a database, by construction: FakeSupabase records the calls it is
given and returns canned rows.

Run:
    python -m pytest backend/tests/test_adviser_registry.py
    python -m unittest backend.tests.test_adviser_registry
"""
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile
from datetime import date

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(os.path.dirname(_HERE))
for _p in (_REPO, os.path.dirname(_HERE)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from backend import ingest_adviser_registry as job              # noqa: E402
from backend.registry import adv_part1, form_13f, match          # noqa: E402


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------
class FakeQuery:
    """Records the chained PostgREST calls and answers from canned data."""

    def __init__(self, client, table):
        self.client = client
        self.table = table
        self._gt = None
        self._limit = None

    def select(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, n):
        self._limit = n
        return self

    def gt(self, _col, value):
        self._gt = value
        return self

    def upsert(self, rows, on_conflict=None):
        self.client.upserts.append((self.table, list(rows), on_conflict))
        self._payload = list(rows)
        return self

    def execute(self):
        if hasattr(self, "_payload"):
            return FakeResult(self._payload)
        rows = self.client.tables.get(self.table, [])
        if self._gt is not None:
            rows = [r for r in rows if r["id"] > self._gt]
        if self._limit is not None:
            rows = rows[: self._limit]
        return FakeResult(rows)


class FakeResult:
    def __init__(self, data):
        self.data = data


class FakeSupabase:
    """A Supabase client that cannot reach anything. Writes go to a list."""

    def __init__(self, tables=None):
        self.tables = tables or {}
        self.upserts = []

    def table(self, name):
        return FakeQuery(self, name)

    def upserted(self, table):
        return [row for t, rows, _ in self.upserts if t == table for row in rows]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
ADV_HEADER = [
    "Organization CRD#", "Primary Business Name", "Legal Name",
    "Latest ADV Filing Date", "SEC Current Status",
    "5F(2)(a)", "5F(2)(b)", "5F(2)(c)", "5F(2)(f)",
]

ADV_ROWS = [
    # exact-name adviser with a real book
    ["157041", "THOMA BRAVO", "THOMA BRAVO, L.P.", "05/11/2026", "Approved",
     "  182,900,000,000.00", "0.00", "  182,900,000,000.00", "42.00"],
    # broker-dealer that files ADV but reports ZERO RAUM
    ["16360", "NEEDHAM & COMPANY, LLC", "NEEDHAM & COMPANY, LLC", "03/19/2026",
     "Approved", "0.00", "0.00", "0.00", "0.00"],
    # affiliate-shaped name under a much larger group
    ["105455", "BNP PARIBAS ASSET MANAGEMENT USA, INC.", "", "05/12/2026",
     "Approved", "  48,400,000,000.00", "0.00", "  48,400,000,000.00", "7.00"],
    # unrelated firm that shares a first word with a startup
    ["310936", "MERCOR INVESTMENT GROUP", "", "01/09/2026", "Approved",
     "41,633,589.00", "0.00", "41,633,589.00", "3.00"],
]


def write_adv_zip(path, header=ADV_HEADER, rows=ADV_ROWS):
    buf = io.StringIO()
    buf.write(",".join(f'"{c}"' for c in header) + "\n")
    for row in rows:
        buf.write(",".join(f'"{c}"' for c in row) + "\n")
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("IA_SEC_-_FIRM_ROSTER_FOIA_DOWNLOAD_-_1.CSV",
                         buf.getvalue().encode("latin-1"))
    return path


SUBMISSIONS = [
    {"cik": 1103804, "name": "THOMA BRAVO, L.P.", "forms_set": ["13F-HR", "13F-HR/A"],
     "last_filing": "2026-08-14", "formerNames": []},
    # notice-only filer: no holdings, must never credit
    {"cik": 700001, "name": "NOTICE ONLY PARTNERS LLC", "forms_set": ["13F-NT"],
     "last_filing": "2026-08-14", "formerNames": []},
    # holdings filer that stopped filing 20 years ago
    {"cik": 1315705, "name": "B CAPITAL ADVISORS, LP", "forms_set": ["13F-HR"],
     "last_filing": "2006-05-15", "formerNames": []},
    # not a 13F filer at all
    {"cik": 320193, "name": "Apple Inc.", "forms_set": ["10-K", "10-Q"],
     "last_filing": "2026-08-01", "formerNames": []},
]


def write_submissions(path, entries=SUBMISSIONS):
    with open(path, "w", encoding="utf-8") as fh:
        for entry in entries:
            fh.write(json.dumps(entry) + "\n")
    return path


COMPANIES = [
    {"id": "aaa", "name": "Thoma Bravo"},
    {"id": "bbb", "name": "Needham"},
    {"id": "ccc", "name": "BNP Paribas"},
    {"id": "ddd", "name": "Mercor"},
    {"id": "eee", "name": "B Capital"},
]


# ---------------------------------------------------------------------------
# ADV Part 1 parser
# ---------------------------------------------------------------------------
class AdvParserTest(unittest.TestCase):
    def test_parses_money_as_full_dollars_unrescaled(self):
        self.assertEqual(adv_part1.parse_money("  429,694,491,042.00"), 429694491042.0)
        self.assertEqual(adv_part1.parse_money("$1,000.50"), 1000.5)
        self.assertEqual(adv_part1.parse_money("(250.00)"), -250.0)
        self.assertIsNone(adv_part1.parse_money("   "))
        self.assertIsNone(adv_part1.parse_money("N/A"))
        self.assertIsNone(adv_part1.parse_money(None))

    def test_parses_filing_date_and_crd(self):
        self.assertEqual(adv_part1.parse_filing_date("05/11/2026"), date(2026, 5, 11))
        self.assertIsNone(adv_part1.parse_filing_date("2026-05-11"))
        self.assertEqual(adv_part1.parse_crd(" 79 "), 79)
        self.assertIsNone(adv_part1.parse_crd("79A"))
        self.assertIsNone(adv_part1.parse_crd(""))

    def test_zero_raum_is_stored_but_is_not_a_figure(self):
        with tempfile.TemporaryDirectory() as tmp:
            recs = adv_part1.load_roster_zip(write_adv_zip(os.path.join(tmp, "adv.zip")))
        by_crd = {r.crd: r for r in recs}
        needham = by_crd[16360]
        self.assertEqual(needham.raum_total_usd, 0.0)
        self.assertFalse(
            needham.has_raum_figure,
            "a filed RAUM of 0.00 must not count as a disclosed figure",
        )
        self.assertTrue(by_crd[157041].has_raum_figure)

    def test_exempt_roster_shape_is_refused(self):
        """The ERA roster has no Item 5 columns, so it carries no RAUM at all."""
        era_header = ["Organization CRD#", "Primary Business Name", "Legal Name"]
        with tempfile.TemporaryDirectory() as tmp:
            path = write_adv_zip(
                os.path.join(tmp, "era.zip"), header=era_header, rows=[["1", "X", "X"]]
            )
            with self.assertRaises(adv_part1.AdvRosterError) as ctx:
                adv_part1.load_roster_zip(path)
        self.assertIn("5F(2)(c)", str(ctx.exception))


# ---------------------------------------------------------------------------
# Form 13F parser
# ---------------------------------------------------------------------------
class Form13FParserTest(unittest.TestCase):
    def test_amended_holdings_report_still_counts_as_holdings(self):
        forms, has_hr, notice_only = form_13f.classify_forms(["13F-HR/A"])
        self.assertEqual(forms, ("13F-HR/A",))
        self.assertTrue(has_hr)
        self.assertFalse(notice_only)

    def test_notice_only_filer_supplies_nothing(self):
        rec = form_13f.record_from_submission(SUBMISSIONS[1])
        self.assertTrue(rec.notice_only)
        self.assertFalse(rec.files_13f_hr)
        self.assertFalse(
            rec.supplies_numbers,
            "a 13F-NT carries no holdings and discloses no size",
        )

    def test_notice_alongside_holdings_is_not_notice_only(self):
        _, has_hr, notice_only = form_13f.classify_forms(["13F-NT", "13F-HR"])
        self.assertTrue(has_hr)
        self.assertFalse(notice_only)

    def test_non_13f_entity_is_skipped_entirely(self):
        self.assertIsNone(form_13f.record_from_submission(SUBMISSIONS[3]))

    def test_stale_filer_is_not_current(self):
        rec = form_13f.record_from_submission(SUBMISSIONS[2])
        self.assertTrue(rec.supplies_numbers)
        self.assertFalse(rec.is_current(date(2026, 9, 2)))
        live = form_13f.record_from_submission(SUBMISSIONS[0])
        self.assertTrue(live.is_current(date(2026, 9, 2)))

    def test_undated_filer_is_not_current(self):
        rec = form_13f.record_from_submission(
            {"cik": 1, "name": "NO DATE LLC", "forms_set": ["13F-HR"], "last_filing": None}
        )
        self.assertFalse(
            rec.is_current(date(2026, 9, 2)),
            "a size claim with no as-of date must not be shown",
        )

    def test_corrupt_line_does_not_lose_the_rest(self):
        lines = ["{not json", json.dumps(SUBMISSIONS[0]), "", json.dumps(SUBMISSIONS[1])]
        recs = list(form_13f.iter_managers(lines))
        self.assertEqual([r.cik for r in recs], [1103804, 700001])


# ---------------------------------------------------------------------------
# Matcher
# ---------------------------------------------------------------------------
class MatcherTest(unittest.TestCase):
    def test_tiers(self):
        self.assertEqual(match.match_tier("Thoma Bravo", "THOMA BRAVO"), "exact")
        self.assertEqual(match.match_tier("Needham", "NEEDHAM & COMPANY, LLC"), "core")
        self.assertEqual(match.match_tier("Vanguard", "VANGUARD GROUP INC"), "core")
        self.assertEqual(
            match.match_tier("BNP Paribas", "BNP PARIBAS ASSET MANAGEMENT USA, INC."), "prefix"
        )
        self.assertIsNone(match.match_tier("Stripe", "THOMA BRAVO"))

    def test_prefix_needs_a_word_boundary(self):
        """'Cohere' must not prefix-match 'COHEREN CAPITAL' on raw characters."""
        self.assertIsNone(match.match_tier("Cohere", "COHEREN CAPITAL LLC"))

    def test_short_names_are_not_prefix_matched(self):
        self.assertIsNone(match.match_tier("ARK", "ARK ROYAL ADVISORS LLC"))

    def test_ambiguity_guard_counts_firms_not_name_strings(self):
        """One CRD supplying two identical names is one firm, not two."""
        registry = [(1, "EATON VANCE MANAGEMENT"), (1, "EATON VANCE MANAGEMENT"),
                    (2, "EATON VANCE ADVISERS INTERNATIONAL LTD."),
                    (2, "EATON VANCE ADVISERS INTERNATIONAL LTD.")]
        links = match.link_companies(
            [{"id": "x", "name": "Eaton Vance"}], registry, overrides={}
        )
        self.assertEqual(len(links), 1)
        self.assertEqual(links[0].tier, "prefix")

    def test_ambiguity_guard_drops_a_crowded_prefix(self):
        registry = [(i, f"MACQUARIE ENTITY {i} LLC") for i in range(1, 8)]
        links = match.link_companies(
            [{"id": "x", "name": "Macquarie"}], registry, overrides={}
        )
        self.assertEqual(links, [], "seven affiliates identify nothing")

    def test_exact_hit_survives_a_crowded_field(self):
        registry = [(0, "MACQUARIE")] + [(i, f"MACQUARIE ENTITY {i} LLC") for i in range(1, 8)]
        links = match.link_companies(
            [{"id": "x", "name": "Macquarie"}], registry, overrides={}
        )
        self.assertEqual([(l.tier, l.registry_key) for l in links], [("exact", 0)])

    def test_best_tier_wins_then_shortest_name(self):
        registry = [(1, "SUMMIT PARTNERS GROWTH EQUITY FUND LLC"), (2, "SUMMIT PARTNERS, L.P.")]
        links = match.link_companies(
            [{"id": "x", "name": "Summit Partners"}], registry, overrides={}
        )
        self.assertEqual([(l.tier, l.registry_key) for l in links], [("core", 2)])

    def test_blocked_override_wins_over_a_real_match(self):
        registry = [(310936, "MERCOR INVESTMENT GROUP")]
        rule = {"mercor": match.LinkOverride(blocked=True, crd=None, cik=None, reason="unrelated")}
        self.assertEqual(
            match.link_companies([{"id": "x", "name": "Mercor"}], registry, overrides=rule), []
        )

    def test_confirmed_override_forces_the_link(self):
        registry = [(11, "SOME OTHER FIRM LLC"), (79, "J.P. MORGAN SECURITIES LLC")]
        key = match.normalize("J.P. Morgan")
        self.assertEqual(key, "jp morgan")
        rule = {key: match.LinkOverride(blocked=False, crd=79, cik=None, reason="human")}
        links = match.link_companies(
            [{"id": "x", "name": "J.P. Morgan"}], registry, overrides=rule
        )
        self.assertEqual([(l.registry_key, l.tier, l.confirmed) for l in links],
                         [(79, "exact", True)])

    def test_shipped_override_file_is_wellformed(self):
        overrides = match.load_overrides()
        self.assertTrue(overrides, "backend/data/adviser_link_overrides.json must be readable")
        for key, rule in overrides.items():
            self.assertEqual(key, match.normalize(key), "keys must be pre-normalized")
            self.assertTrue(rule.reason, f"{key} carries no adjudication reason")


# ---------------------------------------------------------------------------
# Ingest job, entirely against the fake client
# ---------------------------------------------------------------------------
class IngestJobTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.adv_zip = write_adv_zip(os.path.join(self.tmp.name, "adv.zip"))
        self.subs = write_submissions(os.path.join(self.tmp.name, "subs.jsonl"))
        self.addCleanup(self.tmp.cleanup)

    def _run(self, sb, **kw):
        return job.run(
            adv_zip=self.adv_zip,
            submissions_index=self.subs,
            sb=sb,
            as_of=date(2026, 9, 2),
            **kw,
        )

    def test_dry_run_writes_nothing(self):
        sb = FakeSupabase({"companies": COMPANIES})
        stats = self._run(sb, dry_run=True)
        self.assertEqual(sb.upserts, [], "--dry-run must not issue a single write")
        self.assertEqual(stats["advisers_parsed"], 4)
        self.assertEqual(stats["managers_parsed"], 3)

    def test_wholesale_ingest_writes_every_registry_row(self):
        sb = FakeSupabase({"companies": COMPANIES})
        stats = self._run(sb)
        advisers = sb.upserted(job.ADVISER_TABLE)
        managers = sb.upserted(job.MANAGER_TABLE)
        self.assertEqual(len(advisers), 4)
        self.assertEqual(len(managers), 3, "13F-NT and stale filers are still STORED")
        self.assertEqual(stats["adviser_rows_upserted"], 4)
        self.assertEqual(stats["manager_rows_upserted"], 3)
        tables = {t for t, _, _ in sb.upserts}
        self.assertEqual(tables, {job.ADVISER_TABLE, job.MANAGER_TABLE})

    def test_upsert_targets_the_natural_key(self):
        sb = FakeSupabase({"companies": COMPANIES})
        self._run(sb)
        conflicts = {t: c for t, _, c in sb.upserts}
        self.assertEqual(conflicts[job.ADVISER_TABLE], "crd")
        self.assertEqual(conflicts[job.MANAGER_TABLE], "cik")

    def test_unlinked_registry_rows_carry_a_null_company(self):
        sb = FakeSupabase({"companies": COMPANIES})
        self._run(sb)
        by_crd = {r["crd"]: r for r in sb.upserted(job.ADVISER_TABLE)}
        self.assertEqual(by_crd[157041]["company_id"], "aaa")
        self.assertEqual(by_crd[157041]["match_tier"], "exact")
        # BNP Paribas Asset Management USA is an affiliate, not the group. It is
        # LINKED and recorded at the prefix tier rather than dropped: the tier is
        # the honest answer, and a read path can decide what to do with it.
        self.assertEqual(by_crd[105455]["company_id"], "ccc")
        self.assertEqual(by_crd[105455]["match_tier"], "prefix")
        # Adjudicated-unrelated rows are stored with no link and no tier.
        for crd in (310936, 16360):
            self.assertIsNone(by_crd[crd]["company_id"])
            self.assertIsNone(by_crd[crd]["match_tier"])
            self.assertFalse(by_crd[crd]["match_confirmed"])

    def test_raum_is_written_in_full_dollars_with_its_as_of_date(self):
        sb = FakeSupabase({"companies": COMPANIES})
        self._run(sb)
        row = {r["crd"]: r for r in sb.upserted(job.ADVISER_TABLE)}[157041]
        self.assertEqual(row["raum_total_usd"], 182900000000.0)
        self.assertEqual(row["raum_reported_at"], "2026-05-11")

    def test_zero_raum_does_not_credit_a_company(self):
        sb = FakeSupabase({"companies": COMPANIES})
        stats = self._run(sb)
        needham = {r["crd"]: r for r in sb.upserted(job.ADVISER_TABLE)}[16360]
        self.assertEqual(needham["raum_total_usd"], 0.0)
        self.assertEqual(
            stats["companies_credited_adv"], 2,
            "Thoma Bravo and BNP Paribas credit; Needham (0.00) and Mercor (blocked) do not",
        )

    def test_notice_only_and_stale_filers_do_not_credit(self):
        sb = FakeSupabase({"companies": COMPANIES})
        stats = self._run(sb)
        self.assertEqual(stats["managers_notice_only"], 1)
        self.assertEqual(
            stats["companies_credited_13f"], 1,
            "only Thoma Bravo; B Capital last filed in 2006 and the NT filer holds nothing",
        )

    def test_notice_only_filer_is_never_offered_to_the_matcher(self):
        sb = FakeSupabase({"companies": COMPANIES})
        self._run(sb)
        rows = {r["cik"]: r for r in sb.upserted(job.MANAGER_TABLE)}
        self.assertTrue(rows[700001]["notice_only"])
        self.assertFalse(rows[700001]["files_13f_hr"])
        self.assertIsNone(rows[700001]["company_id"])

    def test_blocked_override_keeps_the_row_and_drops_the_link(self):
        sb = FakeSupabase({"companies": COMPANIES})
        self._run(sb)
        mercor = {r["crd"]: r for r in sb.upserted(job.ADVISER_TABLE)}[310936]
        self.assertIsNone(mercor["company_id"], "Mercor is adjudicated unrelated")
        self.assertEqual(mercor["raum_total_usd"], 41633589.0, "the row is still stored")

    def test_company_read_is_paginated_past_the_postgrest_cap(self):
        """A bare select truncates at 1,000 rows and says nothing about it."""
        many = [{"id": f"{i:05d}", "name": f"Company {i}"} for i in range(2500)]
        sb = FakeSupabase({"companies": many})
        stats = self._run(sb)
        self.assertEqual(stats["companies_read"], 2500)

    def test_union_is_not_the_sum(self):
        sb = FakeSupabase({"companies": COMPANIES})
        stats = self._run(sb)
        self.assertEqual(stats["companies_credited_union"], 2)
        self.assertLess(
            stats["companies_credited_union"],
            stats["companies_credited_adv"] + stats["companies_credited_13f"],
        )


# ---------------------------------------------------------------------------
# Filed-name relation: the shared oracle
# ---------------------------------------------------------------------------
FILED_NAME_FIXTURE = os.path.join(_HERE, "fixtures", "filed_name_relations.json")


class FiledNameRelationTest(unittest.TestCase):
    """The Python half of a rule that is stated twice.

    src/lib/adviser-registry.ts carries the same four verdicts, and
    src/lib/adviser-registry.test.ts asserts against THIS SAME FILE. The
    verdicts in it are hand-written from the SEC filings, so neither
    implementation is grading its own homework and a drift on either side goes
    red on the other.
    """

    def setUp(self):
        with open(FILED_NAME_FIXTURE, "r", encoding="utf-8") as fh:
            self.cases = json.load(fh)["cases"]

    def test_the_oracle_covers_every_verdict(self):
        seen = {c["relation"] for c in self.cases}
        self.assertEqual(
            seen,
            {match.RELATION_SINGLE, match.RELATION_SAME,
             match.RELATION_UNIT, match.RELATION_OTHER},
            "a fixture that never exercises a verdict cannot catch a drift in it",
        )
        self.assertTrue(any(c["jurisdiction_scoped"] for c in self.cases))
        self.assertTrue(any(not c["jurisdiction_scoped"] for c in self.cases))

    def test_every_hand_written_verdict_holds(self):
        for case in self.cases:
            shown, other = case["shown"], case["other"]
            with self.subTest(shown=shown, other=other):
                self.assertEqual(
                    match.name_relation(shown, other), case["relation"], case["note"]
                )
                self.assertEqual(
                    match.is_jurisdiction_scoped(shown, other),
                    case["jurisdiction_scoped"],
                    case["note"],
                )

    def test_jurisdiction_is_directional(self):
        """A printed name that already says AUSTRALIA hides nothing."""
        self.assertTrue(
            match.is_jurisdiction_scoped("ARDIAN", "ARDIAN US LLC")
        )
        self.assertFalse(
            match.is_jurisdiction_scoped("ARDIAN US LLC", "ARDIAN")
        )

    def test_generic_words_are_not_reused_here(self):
        """GENERIC_WORDS drops 'us' and 'america'; this rule must not.

        Reusing the matcher's core_tokens would fold ARDIAN US LLC into ARDIAN
        and silently classify the defect as benign, which is how the original
        discard survived review.
        """
        self.assertIn("us", match.GENERIC_WORDS)
        self.assertEqual(match.core_tokens("ARDIAN US LLC"), ("ardian",))
        self.assertEqual(match.filed_tokens("ARDIAN US LLC"), ("ardian", "us"))


# ---------------------------------------------------------------------------
# The two suppressions, end to end through the job
# ---------------------------------------------------------------------------
SLICE_ADV_ROWS = [
    # legal name scopes the business name to a territory: a group-level page
    # would print the group name over a Canadian book
    ["105618", "INVESCO", "INVESCO CANADA LTD.", "06/01/2026", "Approved",
     "  19,870,000,000.00", "0.00", "  19,870,000,000.00", "11.00"],
    # same firm, adviser entity, no territory named: this one must survive
    ["157041", "THOMA BRAVO", "THOMA BRAVO, L.P.", "05/11/2026", "Approved",
     "  182,900,000,000.00", "0.00", "  182,900,000,000.00", "42.00"],
]

SLICE_SUBMISSIONS = [
    # linked through a FORMER name; the current filer is a different firm
    {"cik": 936468, "name": "LOCKHEED MARTIN INVESTMENT MANAGEMENT CO",
     "forms_set": ["13F-HR"], "last_filing": "2026-08-14",
     "formerNames": ["MARTIN MARIETTA CORP /MD/"]},
    # linked through a former name that is a RESPELLING: must survive
    {"cik": 1527166, "name": "Carlyle Group Inc.", "forms_set": ["13F-HR"],
     "last_filing": "2026-08-14", "formerNames": ["Carlyle Group L.P."]},
]

SLICE_COMPANIES = [
    {"id": "inv", "name": "Invesco"},
    {"id": "tb", "name": "Thoma Bravo"},
    {"id": "mm", "name": "Martin Marietta Corp"},
    {"id": "cg", "name": "Carlyle Group"},
]


class FiledNameSuppressionTest(unittest.TestCase):
    """The job's coverage report must describe what the page will draw."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.adv_zip = write_adv_zip(
            os.path.join(self.tmp.name, "adv.zip"), rows=SLICE_ADV_ROWS
        )
        self.subs = write_submissions(
            os.path.join(self.tmp.name, "subs.jsonl"), entries=SLICE_SUBMISSIONS
        )

    def _run(self, **kw):
        sb = FakeSupabase({"companies": SLICE_COMPANIES})
        stats = job.run(
            adv_zip=self.adv_zip,
            submissions_index=self.subs,
            sb=sb,
            as_of=date(2026, 9, 2),
            **kw,
        )
        return sb, stats

    def test_both_rows_are_linked_and_stored_either_way(self):
        """Suppression is a RENDER decision. The row and its link still exist."""
        sb, _ = self._run()
        by_crd = {r["crd"]: r for r in sb.upserted(job.ADVISER_TABLE)}
        self.assertEqual(by_crd[105618]["company_id"], "inv")
        self.assertEqual(by_crd[105618]["legal_name"], "INVESCO CANADA LTD.")
        self.assertEqual(by_crd[105618]["raum_total_usd"], 19870000000.0)

    def test_the_matched_name_is_recorded_on_both_tables(self):
        sb, _ = self._run()
        by_crd = {r["crd"]: r for r in sb.upserted(job.ADVISER_TABLE)}
        self.assertEqual(by_crd[105618]["matched_name"], "INVESCO")
        by_cik = {r["cik"]: r for r in sb.upserted(job.MANAGER_TABLE)}
        self.assertEqual(
            by_cik[936468]["matched_name"], "MARTIN MARIETTA CORP /MD/",
            "the link was won by a FORMER name and the row has to say so",
        )

    def test_a_territorial_slice_does_not_credit_the_adv_pillar(self):
        _, stats = self._run()
        self.assertEqual(stats["adv_suppressed_territorial_slice"], 1)
        self.assertEqual(
            stats["companies_credited_adv"], 1,
            "Thoma Bravo credits; Invesco Canada is a slice of the group",
        )

    def test_an_unattributable_filer_does_not_credit_the_13f_pillar(self):
        _, stats = self._run()
        self.assertEqual(stats["mgr_suppressed_unattributable_name"], 1)
        self.assertEqual(
            stats["companies_credited_13f"], 1,
            "Carlyle is a respelling and credits; Martin Marietta -> Lockheed does not",
        )

    def test_a_confirmed_link_overrides_both_suppressions(self):
        """Adjudication is the escape hatch, and it is the one that exists."""
        confirmed = {
            match.normalize("Invesco"): match.LinkOverride(
                blocked=False, crd=105618, cik=None, reason="test"
            ),
            match.normalize("Martin Marietta Corp"): match.LinkOverride(
                blocked=False, crd=None, cik=936468, reason="test"
            ),
        }
        original = job.load_overrides
        job.load_overrides = lambda *a, **k: confirmed
        try:
            _, stats = self._run()
        finally:
            job.load_overrides = original
        self.assertEqual(stats["adv_suppressed_territorial_slice"], 0)
        self.assertEqual(stats["mgr_suppressed_unattributable_name"], 0)
        self.assertEqual(stats["companies_credited_adv"], 2)
        self.assertEqual(stats["companies_credited_13f"], 2)


if __name__ == "__main__":
    unittest.main()
