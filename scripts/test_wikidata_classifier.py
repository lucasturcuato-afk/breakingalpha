"""Standalone tests for the Wikidata gate fix (changes 1 and 2). No test runner.

Run: python scripts/test_wikidata_classifier.py
Exits non-zero on any failure. No network, no DB: _classify is pure, and the
is_valid_company None-path test injects a fake supabase, a stubbed fetch, and a
small indexed-name set.
"""

import os
import sys
import types

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
import wikidata  # noqa: E402

_failures = []


def check(label, got, want):
    ok = got == want
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}: got {got!r} want {want!r}")
    if not ok:
        _failures.append(label)


print("== _classify (change 2: HARD -> KEEP -> SOFT -> None) ==")
# Kate-Bush-song style: a description with no keep, no hard, no soft keyword -> None.
check("snowflake song -> None",
      wikidata._classify("recording by kate bush from the 2011 album 50 words for snow", "Snowflake"),
      None)
# Coinbase: company word beats the soft "cryptocurrency".
check("coinbase company+crypto -> True",
      wikidata._classify("american company that operates a cryptocurrency exchange platform", "Coinbase"),
      True)
# Hard drop wins even if a keep word is present.
check("sovereign state -> False (hard)",
      wikidata._classify("sovereign state in the south caucasus region of eurasia", "Arm"),
      False)
check("sovereign state + company -> False (hard beats keep)",
      wikidata._classify("sovereign state company", "X"),
      False)
# Bare soft keyword, no company word -> drop.
check("bare cryptocurrency -> False (soft)",
      wikidata._classify("a decentralized cryptocurrency", "Bitcoin"),
      False)
# No-result path unchanged: a no-result-drop substring still drops; else None.
check("description None, benign name -> None",
      wikidata._classify(None, "Acme Widgets"),
      None)
check("description None, 'index' substring -> False",
      wikidata._classify(None, "S&P 500 index"),
      False)


print("== _resolve_keep (change 1: None policy) ==")
wikidata._INDEXED_NAMES_CACHE = {
    wikidata._normalize_company_name("Snowflake"),
    wikidata._normalize_company_name("Acme Robotics Inc."),
}
check("None + indexed -> keep", wikidata._resolve_keep(None, "Snowflake", None), True)
check("None + indexed (suffix-normalized) -> keep",
      wikidata._resolve_keep(None, "Acme Robotics", None), True)
check("None + not indexed -> drop", wikidata._resolve_keep(None, "Random Unknown Co", None), False)
check("True -> keep", wikidata._resolve_keep(True, "Whatever", None), True)
check("False -> drop", wikidata._resolve_keep(False, "Whatever", None), False)


print("== is_valid_company None-path end to end (injected indexed set) ==")


class _FakeSupabase:
    """Cache read returns empty (miss); upsert is a no-op."""
    def table(self, *_a):
        return self

    def select(self, *_a):
        return self

    def eq(self, *_a):
        return self

    def upsert(self, *_a):
        return self

    def execute(self):
        return types.SimpleNamespace(data=[])


# Avoid the real network and the rate-limit sleep. _fetch_wikidata_description is
# gone: is_valid_company now calls _lookup_wikidata, which returns a status as well
# as a description so a failed fetch can never be cached as a verdict.
wikidata._lookup_wikidata = lambda name: wikidata.WikidataLookup(
    wikidata.STATUS_OK, "recording by kate bush from the 2011 album")
wikidata.time.sleep = lambda *_a: None
wikidata._INDEXED_NAMES_CACHE = {wikidata._normalize_company_name("Snowflake")}

check("is_valid_company None + indexed -> True",
      wikidata.is_valid_company("Snowflake", _FakeSupabase()), True)
check("is_valid_company None + not indexed -> False",
      wikidata.is_valid_company("Totally Unknown Name", _FakeSupabase()), False)


print()
if _failures:
    print(f"FAILED: {len(_failures)} assertion(s): {_failures}")
    sys.exit(1)
print("ALL TESTS PASSED")
