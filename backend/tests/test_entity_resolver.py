"""
Unit tests for backend/entity_resolver.register_entity.
See docs/w2-a-entity-resolution-design.md section 5 for spec.

Mocking approach: a tiny FakeSupabase class records every .table().*
chain into a structured call log. We verify the function emits the
correct sequence of operations against the right tables. We do NOT
exercise the real Postgres; transaction ordering across the
companies/aliases/resolution_log boundary is documented at the top of
entity_resolver.py and verified by code inspection rather than mocks.
"""
import os
import unittest
from unittest.mock import MagicMock

# Disable W2-C ticker population for unit tests. The new ticker fetch
# inside _try_insert_canonical does an outbound Finnhub HTTP call and
# (on success) issues an additional companies.update that the existing
# call-log assertions are not expecting. The env-var bypass keeps the
# branch-logic tests focused on resolver behavior; the ticker fetch
# itself is exercised by backend/finnhub_helper.py at integration time.
os.environ["DISABLE_TICKER_POPULATION"] = "1"

from backend import entity_resolver as _entity_resolver
from backend.entity_resolver import (
    register_entity,
    resolve_entity,
    increment_mention_counts,
)

#: backend/ is on sys.path under pytest (see conftest), so entity_resolver's
#: dual-path import binds the BARE `entity_ladder` module. Importing
#: `backend.entity_ladder` here would create a SECOND module object with its
#: own snapshot cache, and resetting that one would leave the resolver's cache
#: stale across tests. Bind to whatever the resolver actually resolved.
entity_ladder = _entity_resolver.entity_ladder


class _FakeQuery:
    """
    Records the chain of supabase-py operations and returns canned data.

    Each call appends to the parent FakeSupabase's call log, so tests
    can assert on the exact sequence of (table, op, args) tuples.
    """

    def __init__(self, parent, table_name):
        self.parent = parent
        self.table_name = table_name
        self.op = None
        self.payload = None
        self.filters = []

    def select(self, columns):
        self.op = "select"
        self.payload = columns
        return self

    def insert(self, payload):
        self.op = "insert"
        self.payload = payload
        return self

    def update(self, payload):
        self.op = "update"
        self.payload = payload
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def in_(self, column, values):
        self.filters.append((column, tuple(values)))
        return self

    # The resolution ladder reads through these. They existed on the real
    # client all along; the fake did not have them, so before they were added
    # every ladder call raised AttributeError, got swallowed by the
    # fail-closed handler, and the resolver minted. The tests passed for the
    # wrong reason. Anything asserting that the ladder RESOLVED needs these.
    def ilike(self, column, value):
        self.filters.append((column, value))
        return self

    def limit(self, n):
        return self

    def order(self, *a, **k):
        return self

    def range(self, lo, hi):
        self.filters.append(("range", (lo, hi)))
        return self

    def execute(self):
        # Record the call BEFORE resolving the response so tests can
        # observe attempts even when the mock raises (e.g., simulated
        # unique-violation on companies INSERT).
        self.parent.calls.append(
            {
                "table": self.table_name,
                "op": self.op,
                "payload": self.payload,
                "filters": list(self.filters),
            }
        )
        data = self.parent._next_response(
            table=self.table_name, op=self.op, filters=tuple(self.filters),
            columns=self.payload if self.op == "select" else None,
        )
        resp = MagicMock()
        resp.data = data
        return resp


#: The exact column shapes the RESOLUTION LADDER reads, and nothing else does.
#:
#: The response queue is keyed on (table, op), which was unambiguous while
#: resolve_entity issued one SELECT per table. The ladder adds three more
#: reads, and they were silently draining responses queued for the resolver:
#: the race test queued a companies row for _touch_existing and the ladder's
#: name lookup ate it, resolved to it, and never minted. So ladder-shaped
#: SELECTs default to EMPTY and are only answered when a test opts in with
#: queue_ladder().
_LADDER_SELECTS = {
    ("companies", "id"),
    ("companies", "id, name, ticker, sec_cik, mention_count"),
    ("aliases", "lookup_key, canonical_id"),
}


class FakeSupabase:
    """
    Minimal supabase-py shim. Tests pre-load responses via .queue() and
    inspect .calls afterwards.
    """

    def __init__(self):
        self.calls = []
        # responses keyed by (table, op); each entry is a list popped FIFO.
        self._responses = {}
        # If True, the next companies.insert raises a unique-violation.
        self._raise_unique_on_companies_insert = False

    def queue(self, table, op, data, *, filters=None):
        key = (table, op)
        self._responses.setdefault(key, []).append(data)

    def queue_ladder(self, table, columns, data):
        """Answer one ladder-shaped SELECT. See _LADDER_SELECTS."""
        self._responses.setdefault((table, "select", columns), []).append(data)

    def raise_unique_on_companies_insert(self):
        self._raise_unique_on_companies_insert = True

    def _next_response(self, *, table, op, filters, columns=None):
        if (
            table == "companies"
            and op == "insert"
            and self._raise_unique_on_companies_insert
        ):
            self._raise_unique_on_companies_insert = False
            raise Exception("duplicate key value violates unique constraint")
        if op == "select" and (table, columns) in _LADDER_SELECTS:
            keyed = self._responses.get((table, op, columns), [])
            return keyed.pop(0) if keyed else []
        queue = self._responses.get((table, op), [])
        if queue:
            return queue.pop(0)
        # Default empty for inserts/updates without a queued response.
        return [] if op in ("select", "insert") else None

    def table(self, name):
        return _FakeQuery(self, name)

    # Convenience filters for assertions ----------------------------------
    def calls_to(self, table, op=None):
        return [
            c
            for c in self.calls
            if c["table"] == table and (op is None or c["op"] == op)
        ]


class _LadderIsolatedTestCase(unittest.TestCase):
    """The entity-ladder snapshot is a process-global cache. Every test builds
    its own fake client, so the snapshot has to be dropped between them or the
    second test resolves against the first one's table."""

    def setUp(self):
        entity_ladder.reset_snapshot()

    def tearDown(self):
        entity_ladder.reset_snapshot()


class RegisterEntityTests(_LadderIsolatedTestCase):
    # Step 5 (miss) ------------------------------------------------------
    def test_zero_rows_creates_canonical_and_alias(self):
        sb = FakeSupabase()
        # alias lookup returns empty
        sb.queue("aliases", "select", [])
        # companies insert returns the new row
        sb.queue("companies", "insert", [{"id": "uuid-new-001"}])
        # alias insert and resolution_log insert: leave default empty

        result = register_entity("Acme Holdings", sb)

        self.assertEqual(result, "uuid-new-001")

        companies_inserts = sb.calls_to("companies", "insert")
        self.assertEqual(len(companies_inserts), 1)
        self.assertEqual(companies_inserts[0]["payload"]["name"], "Acme Holdings")
        # New design: new rows start at 0; the bulk increment applies the tally.
        self.assertEqual(companies_inserts[0]["payload"]["mention_count"], 0)

        alias_inserts = sb.calls_to("aliases", "insert")
        self.assertEqual(len(alias_inserts), 1)
        self.assertEqual(alias_inserts[0]["payload"]["surface_form"], "Acme Holdings")
        self.assertEqual(alias_inserts[0]["payload"]["lookup_key"], "acme holdings")
        self.assertEqual(alias_inserts[0]["payload"]["canonical_id"], "uuid-new-001")
        self.assertEqual(alias_inserts[0]["payload"]["mention_count"], 0)

        log_inserts = sb.calls_to("resolution_log", "insert")
        self.assertEqual(len(log_inserts), 1)
        self.assertFalse(log_inserts[0]["payload"]["was_ambiguous"])
        self.assertEqual(log_inserts[0]["payload"]["candidate_canonical_ids"], [])
        self.assertEqual(
            log_inserts[0]["payload"]["resolved_canonical_id"], "uuid-new-001"
        )

    # Step 3 (hit-one) ---------------------------------------------------
    def test_one_row_touches_existing_without_counting(self):
        sb = FakeSupabase()
        # alias lookup returns exactly one row
        sb.queue(
            "aliases",
            "select",
            [{"id": "alias-1", "canonical_id": "uuid-existing", "mention_count": 7}],
        )
        # _touch_existing reads the canonical row (id, key_themes) before updating
        sb.queue(
            "companies",
            "select",
            [
                {
                    "id": "uuid-existing",
                    "mention_count": 42,
                    "key_themes": ["AI"],
                }
            ],
        )

        result = register_entity("Existing Corp", sb, themes=["chips"])

        self.assertEqual(result, "uuid-existing")

        # companies updated (themes + last_updated) but mention_count NOT touched
        # here -- counting is decoupled and applied in bulk.
        self.assertEqual(len(sb.calls_to("companies", "insert")), 0)
        company_updates = sb.calls_to("companies", "update")
        self.assertEqual(len(company_updates), 1)
        self.assertNotIn("mention_count", company_updates[0]["payload"])
        self.assertIn("last_updated", company_updates[0]["payload"])
        self.assertEqual(
            sorted(company_updates[0]["payload"]["key_themes"]),
            sorted(["AI", "chips"]),
        )

        # alias last_seen_at bumped, mention_count NOT touched here
        alias_updates = sb.calls_to("aliases", "update")
        self.assertEqual(len(alias_updates), 1)
        self.assertNotIn("mention_count", alias_updates[0]["payload"])
        self.assertIn("last_seen_at", alias_updates[0]["payload"])

        # No resolution_log write on the unambiguous-hit-one path. The
        # design doc section 5 step 3 does NOT call for a log write here
        # (only steps 4 and 5 do); we follow the spec exactly. The audit
        # trail captures only ambiguous resolutions and brand-new
        # canonicals, which is what V2 trigger analysis (section 10)
        # cares about.
        self.assertEqual(len(sb.calls_to("resolution_log", "insert")), 0)

    # Step 4 (hit-many, V1 tiebreak) -------------------------------------
    def test_multiple_rows_picks_highest_mention_count(self):
        sb = FakeSupabase()
        sb.queue(
            "aliases",
            "select",
            [
                {"id": "alias-a", "canonical_id": "canon-a", "mention_count": 5},
                {"id": "alias-b", "canonical_id": "canon-b", "mention_count": 100},
                {"id": "alias-c", "canonical_id": "canon-c", "mention_count": 30},
            ],
        )
        # _touch_existing reads canon-b
        sb.queue(
            "companies",
            "select",
            [{"id": "canon-b", "mention_count": 99, "key_themes": []}],
        )

        result = register_entity("Bridgewater", sb)

        # Tiebreaker UNCHANGED: highest aliases.mention_count (100) -> canon-b.
        self.assertEqual(result, "canon-b")

        # Update hit canon-b, not canon-a or canon-c
        company_updates = sb.calls_to("companies", "update")
        self.assertEqual(len(company_updates), 1)
        self.assertEqual(company_updates[0]["filters"], [("id", "canon-b")])

        # The chosen alias is touched (last_seen) but mention_count is NOT
        # incremented here -- decoupled to the bulk path.
        alias_updates = sb.calls_to("aliases", "update")
        self.assertEqual(len(alias_updates), 1)
        self.assertEqual(alias_updates[0]["filters"], [("id", "alias-b")])
        self.assertNotIn("mention_count", alias_updates[0]["payload"])

        # resolution_log: was_ambiguous=True, candidate list has all 3
        log_inserts = sb.calls_to("resolution_log", "insert")
        self.assertEqual(len(log_inserts), 1)
        log_payload = log_inserts[0]["payload"]
        self.assertTrue(log_payload["was_ambiguous"])
        self.assertEqual(log_payload["resolved_canonical_id"], "canon-b")
        self.assertEqual(
            sorted(log_payload["candidate_canonical_ids"]),
            sorted(["canon-a", "canon-b", "canon-c"]),
        )

    # Step 5 race recovery -----------------------------------------------
    def test_race_on_conflict_falls_back_to_select(self):
        sb = FakeSupabase()
        # First attempt: alias miss
        sb.queue("aliases", "select", [])
        # First attempt: companies insert raises unique violation (race)
        sb.raise_unique_on_companies_insert()
        # Second attempt (recursion): alias lookup now finds the winner's
        # alias row, which short-circuits to hit-one.
        sb.queue(
            "aliases",
            "select",
            [{"id": "alias-w", "canonical_id": "winner-id", "mention_count": 1}],
        )
        # _bump_existing reads winner canonical
        sb.queue(
            "companies",
            "select",
            [{"id": "winner-id", "mention_count": 1, "key_themes": []}],
        )

        result = register_entity("Race Co", sb)

        self.assertEqual(result, "winner-id")

        # Exactly one companies insert was attempted and it failed.
        # The recovery path went through hit-one, so we should see
        # a companies UPDATE (not another INSERT).
        self.assertEqual(len(sb.calls_to("companies", "insert")), 1)
        self.assertEqual(len(sb.calls_to("companies", "update")), 1)
        # Two STEP-2 alias-select calls, one per attempt. Filtered on the
        # column shape: the resolution ladder also reads the aliases table once
        # to build its snapshot, and that read is not a resolution attempt.
        step_two = [c for c in sb.calls_to("aliases", "select")
                    if c["payload"] == "id, canonical_id, mention_count"]
        self.assertEqual(len(step_two), 2)
        # No alias INSERT on the recovery path; the winner already
        # wrote the alias row.
        self.assertEqual(len(sb.calls_to("aliases", "insert")), 0)

    # Normalization parity -----------------------------------------------
    def test_normalization_parity(self):
        """
        register_entity("NVIDIA", sb) and register_entity("Nvidia", sb)
        must produce the SAME lookup_key passed to the alias lookup.
        Verified by inspecting the .eq("lookup_key", ...) filter on the
        first alias-select call of each invocation.
        """
        sb1 = FakeSupabase()
        sb1.queue("aliases", "select", [])
        sb1.queue("companies", "insert", [{"id": "uuid-nvda"}])
        register_entity("NVIDIA", sb1)
        first_lookup = sb1.calls_to("aliases", "select")[0]["filters"]
        self.assertEqual(first_lookup, [("lookup_key", "nvidia")])

        # Second call with different casing seeds the same lookup_key.
        # We simulate the cache-hit behavior (the seeded alias is now
        # present) by queuing an alias hit-one keyed to the same canonical.
        sb2 = FakeSupabase()
        sb2.queue(
            "aliases",
            "select",
            [{"id": "alias-nvda", "canonical_id": "uuid-nvda", "mention_count": 1}],
        )
        sb2.queue(
            "companies",
            "select",
            [{"id": "uuid-nvda", "mention_count": 1, "key_themes": []}],
        )
        result2 = register_entity("Nvidia", sb2)
        self.assertEqual(result2, "uuid-nvda")
        second_lookup = sb2.calls_to("aliases", "select")[0]["filters"]
        self.assertEqual(second_lookup, [("lookup_key", "nvidia")])

        # Identity check: both invocations resolved against identical keys.
        self.assertEqual(first_lookup, second_lookup)

    # Surface form preservation ------------------------------------------
    def test_surface_form_preserved(self):
        """
        When creating a new alias, the surface_form column must store the
        raw input verbatim (e.g., "Estee Lauder" with the original accents
        and casing), not the normalized lowercased form.
        """
        raw = "Estée Lauder"  # "Estee" with acute accent on first e
        sb = FakeSupabase()
        sb.queue("aliases", "select", [])
        sb.queue("companies", "insert", [{"id": "uuid-estee"}])

        register_entity(raw, sb)

        alias_inserts = sb.calls_to("aliases", "insert")
        self.assertEqual(len(alias_inserts), 1)
        self.assertEqual(alias_inserts[0]["payload"]["surface_form"], raw)
        # lookup_key is normalized (lowercased) but accents preserved per
        # design doc section 6.
        self.assertEqual(
            alias_inserts[0]["payload"]["lookup_key"], "estée lauder"
        )
        # And the companies row also uses the raw name (matches existing
        # upsert_company behavior in backend/ingest.py).
        companies_inserts = sb.calls_to("companies", "insert")
        self.assertEqual(companies_inserts[0]["payload"]["name"], raw)


class DecoupledCountingTests(_LadderIsolatedTestCase):
    """resolve_entity exposes (canonical_id, alias_id) and does not count;
    increment_mention_counts applies the per-mention tally in bulk."""

    def test_resolve_entity_returns_alias_id_hit_one(self):
        sb = FakeSupabase()
        sb.queue(
            "aliases", "select",
            [{"id": "alias-1", "canonical_id": "uuid-existing", "mention_count": 7}],
        )
        sb.queue("companies", "select",
                 [{"id": "uuid-existing", "key_themes": []}])
        res = resolve_entity("Existing Corp", sb)
        self.assertEqual(res["canonical_id"], "uuid-existing")
        self.assertEqual(res["alias_id"], "alias-1")
        # No mention_count anywhere in this path.
        for c in sb.calls_to("companies", "update") + sb.calls_to("aliases", "update"):
            self.assertNotIn("mention_count", c["payload"])

    def test_resolve_entity_returns_alias_id_miss(self):
        sb = FakeSupabase()
        sb.queue("aliases", "select", [])
        sb.queue("companies", "insert", [{"id": "uuid-new"}])
        sb.queue("aliases", "insert", [{"id": "alias-new"}])
        res = resolve_entity("Brand New Co", sb)
        self.assertEqual(res["canonical_id"], "uuid-new")
        self.assertEqual(res["alias_id"], "alias-new")
        self.assertEqual(sb.calls_to("companies", "insert")[0]["payload"]["mention_count"], 0)
        self.assertEqual(sb.calls_to("aliases", "insert")[0]["payload"]["mention_count"], 0)

    def test_increment_mention_counts_adds_delta_to_existing(self):
        sb = FakeSupabase()
        # bulk read of current counts
        sb.queue("companies", "select",
                 [{"id": "c1", "mention_count": 10}, {"id": "c2", "mention_count": 0}])
        increment_mention_counts(sb, "companies", {"c1": 5, "c2": 3})
        updates = {u["filters"][0][1]: u["payload"]["mention_count"]
                   for u in sb.calls_to("companies", "update")}
        # c1: 10 + 5 = 15 (existing); c2: 0 + 3 = 3 (new row inserted at 0 -> N)
        self.assertEqual(updates, {"c1": 15, "c2": 3})

    def test_increment_mention_counts_noop_on_empty(self):
        sb = FakeSupabase()
        increment_mention_counts(sb, "companies", {})
        increment_mention_counts(sb, "aliases", {"a1": 0})  # zero delta skipped
        self.assertEqual(len(sb.calls_to("companies", "update")), 0)
        self.assertEqual(len(sb.calls_to("aliases", "update")), 0)


# ---------------------------------------------------------------------------
# The resolution ladder: resolve_entity must exhaust every surface before it
# creates a company.
# ---------------------------------------------------------------------------
#: The three real prod rows for ONEOK, read 2026-08-31. One company, three rows,
#: and only the first carries identifiers. This shape is why the ladder exists.
ONEOK_ROWS = [
    {"id": "oke-anchor", "name": "Oneok", "ticker": "OKE",
     "sec_cik": 1039684, "mention_count": 84},
    {"id": "oke-dupe-1", "name": "ONEOK, Inc.", "ticker": None,
     "sec_cik": None, "mention_count": 70},
    {"id": "oke-dupe-2", "name": "ONEOK Inc", "ticker": None,
     "sec_cik": None, "mention_count": 4},
]

#: The `hp` bucket, also verbatim from prod. TWO carriers that DISAGREE: the row
#: named 'HP Inc.' carries Helmerich and Payne's ticker AND cik. Nothing here can
#: say which company an article meant, so the guard must refuse.
HP_ROWS = [
    {"id": "hp-q", "name": "HP Inc", "ticker": "HPQ",
     "sec_cik": 47217, "mention_count": 126},
    {"id": "hp-hnp", "name": "HP Inc.", "ticker": "HP",
     "sec_cik": 46765, "mention_count": 102},
    {"id": "hp-bare", "name": "HP, Inc.", "ticker": None,
     "sec_cik": None, "mention_count": 2},
]

#: The `eqt` bucket. ONE carrier, so carrier counting alone would elect. But
#: 'EQT Holdings' is EQT Holdings Limited, the Australian company formerly named
#: Equity Trustees, and NOT EQT Corporation the US gas producer. The legal-form
#: condition is the one that catches this.
EQT_ROWS = [
    {"id": "eqt-corp", "name": "EQT", "ticker": "EQT",
     "sec_cik": 33213, "mention_count": 342},
    {"id": "eqt-holdings", "name": "EQT Holdings", "ticker": None,
     "sec_cik": None, "mention_count": 5},
    {"id": "eqt-holdings-ltd", "name": "EQT Holdings Ltd.", "ticker": None,
     "sec_cik": None, "mention_count": 1},
]


class ResolutionLadderTests(_LadderIsolatedTestCase):
    """resolve_entity had ONE lookup surface and minted on the first miss.

    Measured against prod on 2026-08-31 over 300 names from
    wikidata_entity_cache: 281 of 300 (93.7%) missed that single surface. The
    table shows the result: 828 normalized-key buckets hold more than one
    companies row, 2,239 of 5,610 rows (39.9%) sit in one, and 11,884 mentions
    are stranded on ticker-less duplicates.
    """

    @staticmethod
    def _sb(company_rows, alias_rows=(), alias_hit=()):
        sb = FakeSupabase()
        sb.queue("aliases", "select", list(alias_hit))   # step 2: the one old surface
        sb.queue_ladder("companies", "id, name, ticker, sec_cik, mention_count",
                        list(company_rows))
        sb.queue_ladder("aliases", "lookup_key, canonical_id", list(alias_rows))
        return sb

    # -- THE NEGATIVE CONTROL -------------------------------------------
    def test_a_novel_spelling_of_an_indexed_company_does_not_mint(self):
        """THIS IS THE FIX, and it fails on main.

        'ONEOK Incorporated' is not an alias key and is not any row's name, so
        the old resolver went straight to _try_insert_canonical and created a
        FOURTH ONEOK row. The normalized surface reaches all three existing
        rows; only one carries identifiers; so the ladder elects the anchor.
        """
        sb = self._sb(ONEOK_ROWS)
        result = resolve_entity("ONEOK Incorporated", sb)

        self.assertEqual(result["canonical_id"], "oke-anchor")
        self.assertEqual(len(sb.calls_to("companies", "insert")), 0)

    def test_the_ladder_teaches_the_alias_table_the_new_surface_form(self):
        """A ladder hit writes the alias, so the NEXT run resolves the same
        string at step 2 for the cost of one equality lookup rather than
        rebuilding the snapshot reasoning."""
        sb = self._sb(ONEOK_ROWS)
        resolve_entity("ONEOK Corp", sb)

        inserts = sb.calls_to("aliases", "insert")
        self.assertEqual(len(inserts), 1)
        self.assertEqual(inserts[0]["payload"]["surface_form"], "ONEOK Corp")
        # The stored key is still v1. The v2 key is a READ key and is never
        # written; see backend/company_match.py's module docstring.
        self.assertEqual(inserts[0]["payload"]["lookup_key"], "oneok corp")
        self.assertEqual(inserts[0]["payload"]["canonical_id"], "oke-anchor")

    def test_a_ladder_hit_is_logged_as_unambiguous(self):
        sb = self._sb(ONEOK_ROWS)
        resolve_entity("ONEOK Incorporated", sb)

        logs = sb.calls_to("resolution_log", "insert")
        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0]["payload"]["resolved_canonical_id"], "oke-anchor")
        self.assertFalse(logs[0]["payload"]["was_ambiguous"])

    def test_the_old_single_surface_still_wins_when_it_hits(self):
        """Step 2 is unchanged and still short-circuits, so the ladder costs
        nothing on the overwhelmingly common path."""
        sb = self._sb(ONEOK_ROWS,
                      alias_hit=[{"id": "a1", "canonical_id": "oke-anchor",
                                  "mention_count": 78}])
        sb.queue("companies", "select",
                 [{"id": "oke-anchor", "key_themes": []}])
        result = resolve_entity("Oneok", sb)

        self.assertEqual(result["alias_id"], "a1")
        # No alias INSERT: the alias already existed.
        self.assertEqual(len(sb.calls_to("aliases", "insert")), 0)

    # -- The guard still refuses where it must ---------------------------
    def test_two_carriers_that_disagree_still_refuse_and_the_name_mints(self):
        """The `hp` bucket. Electing here would put Helmerich and Payne's CIK
        behind a string that meant HP Inc, or the reverse. Minting a duplicate
        is the lesser harm: filled-and-wrong is worse than empty."""
        sb = self._sb(HP_ROWS)
        sb.queue("companies", "insert", [{"id": "hp-new"}])
        result = resolve_entity("HP Incorporated", sb)

        self.assertEqual(result["canonical_id"], "hp-new")
        self.assertEqual(len(sb.calls_to("companies", "insert")), 1)

    def test_a_distinguishing_suffix_refuses_even_with_one_carrier(self):
        """The `eqt` bucket. Carrier counting alone would elect EQT Corporation
        for an EQT Holdings string, which is a different company. 'Holdings' is
        not a legal form the way 'Inc' is."""
        sb = self._sb(EQT_ROWS)
        sb.queue("companies", "insert", [{"id": "eqt-new"}])
        result = resolve_entity("EQT Holdings Limited", sb)

        self.assertEqual(result["canonical_id"], "eqt-new")
        self.assertEqual(len(sb.calls_to("companies", "insert")), 1)

    def test_a_bucket_with_no_identifier_anchor_refuses(self):
        """Emerson Electric has three prod rows and not one ticker or CIK among
        them. There is nothing to elect, so it still mints."""
        rows = [
            {"id": "em1", "name": "Emerson Electric", "ticker": None,
             "sec_cik": None, "mention_count": 1},
            {"id": "em2", "name": "Emerson Electric Co.", "ticker": None,
             "sec_cik": None, "mention_count": 1},
        ]
        sb = self._sb(rows)
        sb.queue("companies", "insert", [{"id": "em-new"}])
        result = resolve_entity("Emerson Electric Company", sb)

        self.assertEqual(result["canonical_id"], "em-new")
        self.assertEqual(len(sb.calls_to("companies", "insert")), 1)

    # -- A real mint still behaves exactly as before ----------------------
    def test_a_genuinely_new_company_still_mints(self):
        sb = self._sb(ONEOK_ROWS)
        sb.queue("companies", "insert", [{"id": "brand-new"}])
        result = resolve_entity("Some Company Nobody Indexed", sb)

        self.assertEqual(result["canonical_id"], "brand-new")
        self.assertEqual(len(sb.calls_to("companies", "insert")), 1)

    def test_a_mint_becomes_visible_to_the_rest_of_the_run(self):
        """register_minted puts the new row on the EXACT surfaces, so a second
        occurrence of the same string in the same run resolves to it. Only the
        exact surfaces: see register_minted for why by_norm is left alone."""
        sb = self._sb(ONEOK_ROWS)
        sb.queue("companies", "insert", [{"id": "brand-new"}])
        resolve_entity("Some Company Nobody Indexed", sb)

        snap = entity_ladder._SNAPSHOT
        self.assertEqual(snap["name_by_id"]["brand-new"],
                         "Some Company Nobody Indexed")
        self.assertIn("brand-new",
                      snap["by_alias"]["some company nobody indexed"])
        # by_norm deliberately untouched: adding a mint there can turn a
        # one-member bucket into an ambiguous one mid-run, which would make the
        # run's output depend on article order.
        self.assertNotIn("brand-new",
                         snap["by_norm"].get("some company nobody indexed", set()))


if __name__ == "__main__":
    unittest.main()
