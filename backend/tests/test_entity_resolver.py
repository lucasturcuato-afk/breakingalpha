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

from backend.entity_resolver import (
    register_entity,
    resolve_entity,
    increment_mention_counts,
)


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

    # company_conflict's probe ladder uses ilike / is_ / limit. Tagged filter
    # names ("ilike:name") so a test can tell an exact-name probe from a
    # case-insensitive one; an untagged (column, value) pair stays an .eq(),
    # which every pre-existing assertion in this file relies on.
    def ilike(self, column, pattern):
        self.filters.append((f"ilike:{column}", pattern))
        return self

    def is_(self, column, value):
        self.filters.append((f"is:{column}", value))
        return self

    def limit(self, n):
        self.limit_n = n
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
            table=self.table_name, op=self.op, filters=tuple(self.filters)
        )
        resp = MagicMock()
        resp.data = data
        return resp


class FakeSupabase:
    """
    Minimal supabase-py shim. Tests pre-load responses via .queue() and
    inspect .calls afterwards.
    """

    def __init__(self):
        self.calls = []
        # responses keyed by (table, op); each entry is a list popped FIFO.
        self._responses = {}
        # How many further companies.insert calls raise a unique-violation.
        self._raise_unique_on_companies_insert = 0

    def queue(self, table, op, data, *, filters=None):
        """Queue one canned response.

        `filters`, when given, is a list of (column, value) pairs the call must
        carry for this entry to be used. Without it the entry matches any call,
        which is what every pre-existing test in this file expects. The probe
        ladder in company_conflict issues several companies-SELECTs in a row
        that differ only in their filters, so FIFO alone cannot address them.
        """
        key = (table, op)
        self._responses.setdefault(key, []).append((filters, data))

    def raise_unique_on_companies_insert(self, index_name=None, times=1):
        """Arm the next `times` companies.insert calls to raise a unique
        violation.

        `index_name` names the index in the message the way Postgres does, so a
        test can drive company_conflict's index hint. Default None keeps the
        original bare message, which is the shape a client that loses the index
        name produces.
        """
        self._raise_unique_on_companies_insert = times
        self._unique_index_name = index_name

    def _unique_exc(self):
        name = getattr(self, "_unique_index_name", None)
        if name:
            exc = Exception(
                f'duplicate key value violates unique constraint "{name}"'
            )
            exc.code = "23505"
            exc.message = (
                f'duplicate key value violates unique constraint "{name}"'
            )
            return exc
        return Exception("duplicate key value violates unique constraint")

    def _next_response(self, *, table, op, filters):
        if (
            table == "companies"
            and op == "insert"
            and self._raise_unique_on_companies_insert
        ):
            self._raise_unique_on_companies_insert -= 1
            raise self._unique_exc()
        queue = self._responses.get((table, op), [])
        for i, (want_filters, data) in enumerate(queue):
            if want_filters is None or list(want_filters) == list(filters):
                queue.pop(i)
                return data
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


class RegisterEntityTests(unittest.TestCase):
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
        # Two alias-select calls (one per attempt).
        self.assertEqual(len(sb.calls_to("aliases", "select")), 2)
        # No alias INSERT on the recovery path; the winner already
        # wrote the alias row.
        self.assertEqual(len(sb.calls_to("aliases", "insert")), 0)

    def test_retry_cap_recovers_a_name_the_exact_name_select_could_not_see(self):
        """The lost-race path that used to raise while the row existed.

        Three attempts all lose to companies_name_norm_unique, which is
        UNIQUE(lower(btrim(name))) and therefore names a row spelled
        "ExxonMobil" when we tried to insert "EXXONMOBIL". The old recovery was
        `.eq("name", "EXXONMOBIL")`, which returns zero rows against that
        winner, and resolve_entity raised. It now resolves through the probe
        ladder in company_conflict.

        This is not only a hot-race path. A canonical whose alias INSERT failed
        is permanently invisible to step 2, so every call for that name landed
        here and threw.
        """
        sb = FakeSupabase()
        for _ in range(3):
            sb.queue("aliases", "select", [])
        sb.raise_unique_on_companies_insert(
            index_name="companies_name_norm_unique", times=3
        )
        # The exact-name probe is NOT queued: the fake returns [] for an
        # unmatched select, which is what the real table does for this needle.
        sb.queue(
            "companies",
            "select",
            [{"id": "winner-id", "name": "ExxonMobil"}],
            filters=[("ilike:name", "EXXONMOBIL"), ("is:sec_cik", "null")],
        )

        result = resolve_entity("EXXONMOBIL", sb)

        self.assertEqual(result["canonical_id"], "winner-id")
        # alias_id is None: the canonical resolved, the specific alias row did
        # not, and the recovery deliberately writes nothing.
        self.assertIsNone(result["alias_id"])
        self.assertEqual(len(sb.calls_to("companies", "insert")), 3)
        self.assertEqual(len(sb.calls_to("companies", "update")), 0)
        self.assertEqual(len(sb.calls_to("aliases", "insert")), 0)

    def test_retry_cap_raises_when_no_probe_finds_the_row(self):
        """A recovery that finds nothing must be loud.

        Returning a canonical of None here would be read as "no such company"
        by _resolve_company_entity in ingest.py, which is the silent wrong
        answer the whole change exists to prevent.
        """
        from backend.company_conflict import CompanyConflictUnresolved

        sb = FakeSupabase()
        for _ in range(3):
            sb.queue("aliases", "select", [])
        sb.raise_unique_on_companies_insert(
            index_name="companies_name_norm_unique", times=3
        )
        with self.assertRaises(CompanyConflictUnresolved):
            resolve_entity("Nowhere Corp", sb)

    def test_a_non_unique_insert_error_still_propagates(self):
        """The old classifier matched the substring "conflict", broad enough to
        turn a serialization failure into a benign race. SQLSTATE decides."""
        sb = FakeSupabase()
        sb.queue("aliases", "select", [])
        exc = Exception("could not serialize access due to conflict")
        exc.code = "40001"
        sb._raise_unique_on_companies_insert = 1
        sb._unique_exc = lambda: exc
        with self.assertRaises(Exception) as ctx:
            resolve_entity("Serializable Co", sb)
        self.assertIs(ctx.exception, exc)

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


class DecoupledCountingTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
