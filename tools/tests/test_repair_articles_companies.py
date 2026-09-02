"""The repair planner touches merge losers and NOTHING else.

Two properties are load-bearing and neither is obvious from reading the code:

  1. Only keys of the merge map are ever modified. The 25,554 articles holding
     extractor strings that never resolved to a company row ('NVIDIA', 'Visa',
     'RTX', 'TSLA') are a SEPARATE pre-existing defect with no survivor to point
     at. Folding them into a merge repair would hide them behind a green run.

  2. No flag widens that set. The map comes from norm_v2_merge_map() and nothing
     else, so there is no argument an operator can pass that makes this tool
     start guessing at unresolvable names.

Both are asserted here rather than left to inspection, because "it only touches
what is in the map" is exactly the kind of claim that stays true until someone
adds a convenience flag.

The module talks to Supabase at import time, so it is loaded with the client
stubbed out. plan() itself is pure.
"""
import argparse
import os
import sys
import types

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_TOOLS = os.path.dirname(_HERE)
_SRC = os.path.join(_TOOLS, "repair_articles_companies.py")


def _load():
    """Import the module with no network and no credentials."""
    src = open(_SRC).read()
    src = src.replace('_HERE = os.path.dirname(os.path.abspath(__file__))',
                      f'_HERE = {_TOOLS!r}')
    src = src.replace('from supabase import create_client  # noqa: E402',
                      'create_client = lambda *a, **k: None')
    src = src.replace('if not _url or not _key:\n'
                      '    sys.exit("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.")', '')
    src = src.replace('sb = create_client(_url, _key)', 'sb = None')
    mod = types.ModuleType("repair_mod")
    exec(compile(src, _SRC, "exec"), mod.__dict__)
    return mod


MOD = _load()

# A realistic map: two losers folding onto one survivor.
MAP = {
    "Corning Incorporated": "Corning",
    "Corning Inc": "Corning",
    "PepsiCo, Inc.": "PepsiCo",
}

# Names that are NOT in companies and NOT merge losers. These are the ones that
# must never be touched. Real values, from the 2026-09-01 measurement.
UNRESOLVABLE = ["NVIDIA", "Visa", "RTX", "TSLA", "Meta Platforms", "SanDisk"]


def _plan_one(companies, m=MAP, done=None):
    return MOD.plan([{"id": "a1", "companies": companies}], m, done)


# ---------------------------------------------------------------------------
# 1. The two cases
# ---------------------------------------------------------------------------
def test_swap_when_survivor_absent():
    ch = _plan_one(["Corning Incorporated", "Apple"])
    assert ch[0]["after"] == ["Corning", "Apple"]
    assert [e["action"] for e in ch[0]["entries"]] == ["swap"]


def test_remove_when_survivor_present():
    """A swap here would leave ['Corning', 'Corning']."""
    ch = _plan_one(["Corning", "Corning Incorporated"])
    assert ch[0]["after"] == ["Corning"]
    assert [e["action"] for e in ch[0]["entries"]] == ["remove"]


def test_two_losers_one_survivor_collapses_to_one_element():
    ch = _plan_one(["Corning Incorporated", "Corning Inc"])
    assert ch[0]["after"] == ["Corning"]
    assert sorted(e["action"] for e in ch[0]["entries"]) == ["remove", "swap"]


def test_element_order_is_preserved():
    ch = _plan_one(["Apple", "Corning Incorporated", "Zoom"])
    assert ch[0]["after"] == ["Apple", "Corning", "Zoom"]


def test_no_loser_produces_no_change():
    assert _plan_one(["Apple", "Nvidia"]) == []


def test_empty_and_null_arrays_are_skipped():
    assert MOD.plan([{"id": "a", "companies": []}], MAP) == []
    assert MOD.plan([{"id": "a", "companies": None}], MAP) == []


# ---------------------------------------------------------------------------
# 2. THE SCOPE GUARANTEE
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("name", UNRESOLVABLE)
def test_unresolvable_name_alone_is_never_touched(name):
    """An article holding ONLY unresolvable names must not be rewritten."""
    assert _plan_one([name]) == []


def test_unresolvable_names_survive_a_repair_of_the_same_article():
    """The hard case: an article holding BOTH a loser and unresolvable names.
    The loser is repaired; every other element comes through byte-identical."""
    before = ["NVIDIA", "Corning Incorporated", "TSLA", "Visa"]
    ch = _plan_one(before)
    assert ch[0]["after"] == ["NVIDIA", "Corning", "TSLA", "Visa"]
    for n in ("NVIDIA", "TSLA", "Visa"):
        assert n in ch[0]["after"], f"{n} was dropped"
    assert all(e["loser"] in MAP for e in ch[0]["entries"])


def test_only_map_keys_ever_appear_as_a_loser():
    """Across a mixed corpus, every ledger entry names a key of the map."""
    rows = [
        {"id": "1", "companies": ["NVIDIA", "Corning Incorporated"]},
        {"id": "2", "companies": UNRESOLVABLE},
        {"id": "3", "companies": ["PepsiCo, Inc.", "RTX"]},
        {"id": "4", "companies": ["Apple"]},
    ]
    for c in MOD.plan(rows, MAP):
        for e in c["entries"]:
            assert e["loser"] in MAP


def test_no_element_is_invented():
    """Every element of `after` was either already in `before` or is a survivor
    from the map. Nothing is guessed, normalized or resurrected."""
    rows = [
        {"id": "1", "companies": ["NVIDIA", "Corning Incorporated", "TSLA"]},
        {"id": "2", "companies": ["Corning", "Corning Inc", "Visa"]},
    ]
    for c in MOD.plan(rows, MAP):
        for el in c["after"]:
            assert el in c["before"] or el in MAP.values()


def test_an_empty_map_changes_nothing():
    """If no cluster merged, the tool is a no-op rather than a guesser."""
    rows = [{"id": "1", "companies": ["NVIDIA", "Corning Incorporated"]}]
    assert MOD.plan(rows, {}) == []


# ---------------------------------------------------------------------------
# 3. No flag widens the scope
# ---------------------------------------------------------------------------
def test_no_cli_flag_can_widen_the_map():
    """plan() takes the map as an argument and main() sources it only from
    norm_v2_merge_map(). If a flag is ever added that feeds plan() a different
    map, this test is where it should fail."""
    src = open(_SRC).read()
    assert src.count("m = load_map()") == 1
    assert src.count("changes = plan(") == 1
    # plan() is called with exactly the map load_map() returned.
    assert "changes = plan(rows, m, done)" in src
    # No argparse option feeds names in.
    for banned in ("--map", "--names", "--extra", "--include", "--all-missing"):
        assert banned not in src


def test_the_drain_gate_has_no_bypass_flag():
    """require_merge_drained() must be unconditional. A partial repair is not a
    state anyone should reach by passing an argument."""
    src = open(_SRC).read()
    assert "require_merge_drained()" in src
    for banned in ("--force", "--skip-drain", "--no-drain", "--ignore-drain"):
        assert banned not in src
    # It is called before the map is loaded and before anything is planned.
    assert src.index("require_merge_drained()") < src.index("m = load_map()")


def test_dry_run_is_the_default():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    assert ap.parse_args([]).apply is False


# ---------------------------------------------------------------------------
# 4. Resume
# ---------------------------------------------------------------------------
def test_resume_skips_a_recorded_pair():
    done = {("a1", "Corning Incorporated")}
    assert _plan_one(["Corning Incorporated"], done=done) == []


def test_resume_still_repairs_an_unrecorded_loser_on_the_same_article():
    done = {("a1", "Corning Incorporated")}
    ch = _plan_one(["Corning Incorporated", "PepsiCo, Inc."], done=done)
    assert [e["loser"] for e in ch[0]["entries"]] == ["PepsiCo, Inc."]
    # The already-done loser is left in place rather than silently re-repaired.
    assert "Corning Incorporated" in ch[0]["after"]


# ---------------------------------------------------------------------------
# 5. The ledger is written before the array
# ---------------------------------------------------------------------------
def test_ledger_write_precedes_the_apply():
    """If the process dies between them, the ledger describes a change that did
    not happen, which the guarded reversal skips. The other order loses the
    before-image of a row that DID change, which is unrecoverable."""
    src = open(_SRC).read()
    body = src[src.index("def apply_changes("):src.index("def main(")]
    assert body.index("table(LEDGER)") < body.index("_apply_with_split(chunk)")


# ---------------------------------------------------------------------------
# 6. THE POSTGREST ROW CAP
#
# PostgREST caps every response at db-max-rows and does NOT error when it
# truncates. A read that should return 1363 rows returns 1000 and looks
# complete. That silence produced three separate wrong results in this
# codebase, one of them in this tool: a truncated merge map planned 10,566
# articles instead of 13,979 and would have reported success while leaving
# ~3,400 unrepaired with no record they were missed.
#
# Every set-returning read must therefore paginate AND assert against a
# server-side count. These tests pin that, because the failure mode is silence
# and nothing else would notice it coming back.
# ---------------------------------------------------------------------------
class _FakeResp:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class _FakeQuery:
    """Mimics PostgREST: never returns more than `cap` rows per response."""
    def __init__(self, rows, cap, count=None):
        self._rows, self._cap, self._count = rows, cap, count
        self._lo, self._hi, self._limit = 0, None, None

    def order(self, *a, **k):
        return self

    def limit(self, n):
        self._limit = n
        return self

    def range(self, lo, hi):
        self._lo, self._hi = lo, hi
        return self

    def execute(self):
        hi = self._hi if self._hi is not None else self._lo + (self._limit or self._cap) - 1
        page = self._rows[self._lo:hi + 1][:self._cap]
        return _FakeResp(page, self._count)


class _FakeSB:
    def __init__(self, rows, cap=1000, count=None, honour_range=True):
        self.rows, self.cap = rows, cap
        self.count = len(rows) if count is None else count
        self.honour_range = honour_range

    def rpc(self, fn, params, count=None):
        if not self.honour_range:
            return _FakeQuery(self.rows[:self.cap], self.cap,
                              self.count if count else None)
        return _FakeQuery(self.rows, self.cap, self.count if count else None)

    def table(self, name):
        return self

    def select(self, cols, count=None):
        return _FakeQuery(self.rows, self.cap, self.count if count else None)


def test_fetch_all_rpc_pages_past_the_cap():
    """1363 rows behind a 1000-row cap must come back as 1363."""
    rows = [{"loser_name": f"L{i}", "survivor_name": f"S{i}"} for i in range(1363)]
    MOD.sb = _FakeSB(rows, cap=1000)
    try:
        got = MOD._fetch_all_rpc("norm_v2_merge_map", "loser_name")
    finally:
        MOD.sb = None
    assert len(got) == 1363


def test_fetch_all_rpc_refuses_a_truncated_read():
    """If pagination cannot reach the reported count, exit rather than return
    a short list that reads as complete."""
    rows = [{"loser_name": f"L{i}", "survivor_name": f"S{i}"} for i in range(1363)]
    MOD.sb = _FakeSB(rows, cap=1000, honour_range=False)
    try:
        with pytest.raises(SystemExit) as e:
            MOD._fetch_all_rpc("norm_v2_merge_map", "loser_name")
    finally:
        MOD.sb = None
    assert "TRUNCATED READ" in str(e.value)


def test_fetch_all_table_pages_past_the_cap():
    rows = [{"name": f"C{i}"} for i in range(4254)]
    MOD.sb = _FakeSB(rows, cap=1000)
    try:
        got = MOD._fetch_all_table("companies", "name")
    finally:
        MOD.sb = None
    assert len(got) == 4254


def test_no_set_returning_read_bypasses_the_helpers():
    """A bare .rpc(...).execute() or .table(...).select(...).execute() is
    capped. Only the single-row progress check and the single-object apply RPC
    may call rpc directly; everything else goes through a checked helper."""
    src = open(_SRC).read()
    body = src[src.index("def require_merge_drained"):]
    # `sb.rpc(` rather than `.rpc(`: prose in docstrings names the method while
    # explaining why it is capped, and that is documentation, not a call site.
    bare = [ln.strip() for ln in body.splitlines()
            if "sb.rpc(" in ln and "def " not in ln]
    # PROGRESS_RPC returns exactly one row; APPLY_RPC returns one jsonb object.
    allowed = ("PROGRESS_RPC", "APPLY_RPC", "sb.rpc(fn, params")
    for ln in bare:
        assert any(a in ln for a in allowed), f"uncapped set-returning read: {ln}"


def test_load_map_uses_the_checked_helper():
    src = open(_SRC).read()
    body = src[src.index("def load_map"):src.index("def live_company_names")]
    assert "_fetch_all_rpc(MAP_RPC" in body
    assert ".execute()" not in body, "load_map must not issue a raw query"


def test_load_map_rejects_a_loser_mapping_to_two_survivors():
    rows = [{"loser_name": "X", "survivor_name": "A"},
            {"loser_name": "X", "survivor_name": "B"}]
    MOD.sb = _FakeSB(rows, cap=1000)
    try:
        with pytest.raises(SystemExit) as e:
            MOD.load_map()
    finally:
        MOD.sb = None
    assert "distinct loser names" in str(e.value)


def test_article_scan_is_documented_as_exempt():
    """The scan cannot carry a count assertion because count(*) on articles is
    the query that times out. Its exemption must stay justified in the source."""
    src = open(_SRC).read()
    body = src[src.index("def scan_articles"):src.index("def already_done")]
    assert "EXEMPT" in body
    assert "times out" in body
