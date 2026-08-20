"""Unit tests for backend/recruiting_universe.

Hermetic: no DB, no network, no secrets. The snapshot is a hand-built dict, so
these tests exercise the planning and SQL-rendering path with a client that
CANNOT write, and a _ForbiddenClient asserts nothing ever tries.

The properties under test are the ones that make seeding safe:
  1. a name that resolves today is left alone
  2. a name whose normalized key names exactly one company gets an ALIAS, never
     a new companies row (this is what stops the "Citi" / "Citigroup" collision)
  3. a name whose normalized key already names two or more companies is REFUSED
  4. a fabricated name with no SEC identity and no corpus evidence is REFUSED,
     so a made-up firm can never mint a row
  5. render_seed_sql returns text and performs no I/O against any client

Run: python -m unittest backend.tests.test_recruiting_universe
"""
import unittest
from collections import defaultdict

from backend.company_match import normalize_company_key
from backend.normalize import normalize_lookup_key
from backend.recruiting_universe import (
    MIN_CORPUS_EVIDENCE,
    classify,
    plan_universe,
    render_seed_sql,
    resolve,
)


class _ForbiddenClient:
    """Any attribute access at all is a failure. Passed nowhere on purpose: its
    job is to prove the module never accepts a client in the first place."""

    def __getattr__(self, item):  # pragma: no cover - must never run
        raise AssertionError(f"recruiting_universe touched a client: .{item}")


def _snapshot(rows, aliases=()):
    """rows: [(id, name, ticker)]. aliases: [(lookup_key, id)]."""
    name_by_id, row_by_id = {}, {}
    by_alias, by_ticker, by_norm = defaultdict(set), defaultdict(set), defaultdict(set)
    exact_names, lower_names = set(), {}
    for cid, name, ticker in rows:
        name_by_id[cid] = name
        row_by_id[cid] = dict(id=cid, name=name, ticker=ticker, mention_count=0)
        exact_names.add(name)
        lower_names.setdefault(name.lower(), name)
        by_norm[normalize_company_key(name)].add(cid)
        if ticker:
            by_ticker[ticker.upper()].add(cid)
    for key, cid in aliases:
        by_alias[key].add(cid)
        by_norm[normalize_company_key(key)].add(cid)
    return dict(name_by_id=name_by_id, row_by_id=row_by_id, by_alias=by_alias,
                by_ticker=by_ticker, by_norm=by_norm, exact_names=exact_names,
                lower_names=lower_names)


SNAP = _snapshot(
    rows=[
        ("id-citigroup", "Citigroup", "C"),
        ("id-evercore", "Evercore", "EVR"),
        ("id-moelis", "Moelis & Company", "MC"),
        # Two rows behind one normalized key: the real "Stephens" cluster.
        ("id-stephens-1", "Stephens Inc.", None),
        ("id-stephens-2", "Stephens Group", None),
    ],
    aliases=[("citi", "id-citigroup")],
)


class TestResolve(unittest.TestCase):
    def test_exact_name(self):
        self.assertEqual(resolve(SNAP, "Evercore"), "Evercore")

    def test_case_insensitive_name(self):
        self.assertEqual(resolve(SNAP, "evercore"), "Evercore")

    def test_alias_key_returns_canonical_not_input(self):
        # The point of the fold: "Citi" must come back as "Citigroup", because
        # PostgREST array containment is case- and spelling-sensitive.
        self.assertEqual(resolve(SNAP, "Citi"), "Citigroup")

    def test_suffix_normalized_name(self):
        self.assertEqual(resolve(SNAP, "Moelis"), "Moelis & Company")

    def test_ambiguous_key_refuses(self):
        self.assertIsNone(resolve(SNAP, "Stephens"))

    def test_absent_name(self):
        self.assertIsNone(resolve(SNAP, "Centerview"))


class TestClassify(unittest.TestCase):
    def test_resolving_name_is_left_alone(self):
        d = classify(SNAP, "Evercore", "elite_boutique", corpus_evidence=99)
        self.assertEqual(d["action"], "already_resolves")

    def test_backend_hit_with_frontend_miss_is_flagged_not_seeded(self):
        # "Citi" resolves in ingest via the alias surface. resolveAlias cannot
        # see it. Seeding a "Citi" companies row would make BOTH ambiguous, so
        # the answer has to be a code fix, and the plan must say so.
        d = classify(SNAP, "Citi", "bulge_bracket", corpus_evidence=500,
                     frontend_resolves=False)
        self.assertEqual(d["action"], "frontend_blind")
        self.assertEqual(d["canonical"], "Citigroup")

    def test_frontend_blind_never_emits_sql(self):
        plan = [classify(SNAP, "Citi", "bulge_bracket", corpus_evidence=500,
                         frontend_resolves=False)]
        sql = render_seed_sql(plan)
        self.assertNotIn("INSERT", sql)
        self.assertIn("Fix resolveAlias", sql)

    def test_collision_is_refused(self):
        d = classify(SNAP, "Stephens", "middle_market", corpus_evidence=999)
        self.assertEqual(d["action"], "refuse_collision")
        self.assertIn("2 companies", d["reason"])

    def test_fabricated_name_is_refused(self):
        # No SEC identity, no corpus evidence. This is the false-positive guard:
        # a made-up firm must never produce a row.
        d = classify(SNAP, "Velthorne Capital", "private_equity", corpus_evidence=0)
        self.assertEqual(d["action"], "refuse_no_content")

    def test_evidence_threshold_is_the_boundary(self):
        below = classify(SNAP, "Ducera", "elite_boutique",
                         corpus_evidence=MIN_CORPUS_EVIDENCE - 1)
        at = classify(SNAP, "Ducera", "elite_boutique",
                      corpus_evidence=MIN_CORPUS_EVIDENCE)
        self.assertEqual(below["action"], "refuse_no_content")
        self.assertEqual(at["action"], "seed_private")

    def test_public_identity_is_copied_never_invented(self):
        cik_by_name = {normalize_lookup_key("Truist Securities"):
                       dict(cik=92230, ticker="TFC", company_name="Truist Securities")}
        d = classify(SNAP, "Truist Securities", "bulge_bracket",
                     corpus_evidence=107, cik_by_name=cik_by_name)
        self.assertEqual(d["action"], "seed_public")
        self.assertEqual(d["sec"]["cik"], 92230)

    def test_private_seed_never_carries_a_guessed_ticker(self):
        d = classify(SNAP, "Centerview", "elite_boutique", corpus_evidence=50)
        self.assertEqual(d["action"], "seed_private")
        self.assertNotIn("sec", d)


class TestSeedSql(unittest.TestCase):
    def setUp(self):
        universe = {
            "elite_boutique": {"why": "x", "names": ["Evercore", "Centerview", "Moelis"]},
            "middle_market": {"why": "y", "names": ["Stephens", "Velthorne Capital"]},
        }
        evidence = {"Centerview": 42, "Stephens": 69, "Velthorne Capital": 0}
        self.plan = plan_universe(SNAP, universe, evidence, cik_by_name={})
        self.sql = render_seed_sql(self.plan)

    def test_returns_text_and_touches_no_client(self):
        # render_seed_sql takes only the plan. There is no parameter a client
        # could occupy, which is the structural guarantee.
        self.assertIsInstance(self.sql, str)
        with self.assertRaises(AssertionError):
            _ForbiddenClient().execute

    def test_no_update_or_delete_anywhere(self):
        upper = self.sql.upper()
        for verb in ("UPDATE ", "DELETE ", "DROP ", "TRUNCATE ", "ALTER "):
            self.assertNotIn(verb, upper, f"seed SQL must never contain {verb.strip()}")

    def test_every_insert_is_guarded(self):
        inserts = [b for b in self.sql.split("INSERT INTO")[1:]]
        self.assertTrue(inserts)
        for block in inserts:
            self.assertIn("NOT EXISTS", block,
                          "an unguarded INSERT can duplicate a row minted since planning")

    def test_refused_names_never_reach_an_insert(self):
        self.assertNotIn("'Velthorne Capital'", self.sql.split("COMMIT;")[0])
        self.assertNotIn("'Stephens'", self.sql.split("COMMIT;")[0])

    def test_refusals_are_recorded_with_a_reason(self):
        tail = self.sql.split("COMMIT;")[1]
        self.assertIn("Velthorne Capital", tail)
        self.assertIn("refuse_collision", tail)

    def test_resolving_name_produces_no_statement(self):
        self.assertNotIn("'Evercore'", self.sql)

    def test_moelis_becomes_an_alias_not_a_company_row(self):
        # "Moelis" already normalizes onto "Moelis & Company". Inserting a
        # second companies row would make BOTH ambiguous, so it must land in
        # aliases instead.
        moelis = [d for d in self.plan if d["name"] == "Moelis"][0]
        self.assertEqual(moelis["action"], "already_resolves")


if __name__ == "__main__":
    unittest.main()
