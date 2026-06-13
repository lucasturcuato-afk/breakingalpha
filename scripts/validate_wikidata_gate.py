"""Offline validation harness for the Wikidata gate fix (changes 1 and 2).

READ-ONLY. SELECTs only; no writes, no cache mutation, no ingest. Makes live
Wikidata wbsearchentities calls (limit=1, rate-limited) to re-fetch each sampled
name's current description, then runs the OLD gate vs the NEW gate and reports:
  - recall recovery: percent of 50 indexed names cached NULL/FALSE the NEW gate keeps
  - keep-precision retention: percent of 50 cached-TRUE names the NEW gate still keeps
  - false-keep exposure: the non-indexed cached-NULL names the NEW gate now keeps
  - keep-all delta: how many MORE non-indexed NULLs would keep under NONE_KEEP_MODE
    = keep_all (the cost of loosening)

Run: python scripts/validate_wikidata_gate.py
"""

import os
import random
import sys

from dotenv import load_dotenv
from supabase import create_client

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
import wikidata  # noqa: E402

load_dotenv()
load_dotenv(".env.local")
URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
if not URL or not KEY:
    print("Missing SUPABASE_URL / key. Aborting (read-only, nothing done).")
    sys.exit(1)
sb = create_client(URL, KEY)

N = 50
norm = wikidata._normalize_company_name

# OLD gate: original combined drop list, drop tested before keep, None drops.
_OLD_DROP = wikidata._HARD_DROP_DESCRIPTION_KEYWORDS + wikidata._SOFT_DROP_DESCRIPTION_KEYWORDS


def old_classify(desc, name):
    if desc is None:
        low = name.lower()
        for sub in wikidata._NO_RESULT_DROP_SUBSTRINGS:
            if sub in low:
                return False
        return None
    for kw in _OLD_DROP:
        if kw in desc:
            return False
    for kw in wikidata._KEEP_DESCRIPTION_KEYWORDS:
        if kw in desc:
            return True
    return None


def old_keep(desc, name):
    return old_classify(desc, name) is True  # None drops


def new_verdict(desc, name):
    return wikidata._classify(desc, name)  # new HARD -> KEEP -> SOFT -> None


def new_keep_indexed_only(desc, name, indexed):
    v = new_verdict(desc, name)
    if v is True:
        return True
    if v is False:
        return False
    return norm(name) in indexed  # None: keep only indexed


def new_keep_all(desc, name):
    v = new_verdict(desc, name)
    return True if v is None else (v is True)


def _paged(table, select, flt=None, cap=4000):
    out, page, size = [], 0, 1000
    while len(out) < cap:
        q = sb.table(table).select(select).order("name")
        if flt:
            q = flt(q)
        rows = (q.range(page * size, page * size + size - 1).execute().data) or []
        out.extend(rows)
        if len(rows) < size:
            break
        page += 1
    return out


print("Loading indexed company names and cache samples (read-only)...")
indexed = {norm(r["name"]) for r in _paged("companies", "name") if r.get("name")}
print(f"  indexed normalized names: {len(indexed)}")

# Cache rows by verdict.
null_rows = _paged("wikidata_entity_cache", "name,is_company",
                   lambda q: q.is_("is_company", "null"), cap=4000)
false_rows = _paged("wikidata_entity_cache", "name,is_company",
                    lambda q: q.eq("is_company", False), cap=4000)
true_rows = _paged("wikidata_entity_cache", "name,is_company",
                   lambda q: q.eq("is_company", True), cap=4000)

null_false_names = [r["name"] for r in (null_rows + false_rows) if r.get("name")]
indexed_nullfalse = [n for n in null_false_names if norm(n) in indexed]
nonindexed_null = [r["name"] for r in null_rows if r.get("name") and norm(r["name"]) not in indexed]
true_names = [r["name"] for r in true_rows if r.get("name")]

random.shuffle(indexed_nullfalse)
random.shuffle(nonindexed_null)
random.shuffle(true_names)
sample_A = indexed_nullfalse[:N]   # indexed, cached null/false (false drops)
sample_B = nonindexed_null[:N]     # non-indexed, cached null
sample_C = true_names[:N]          # cached true

print(f"  sample A (indexed null/false): {len(sample_A)}")
print(f"  sample B (non-indexed null):   {len(sample_B)}")
print(f"  sample C (cached true):        {len(sample_C)}")
print("Re-fetching live Wikidata descriptions (limit=1, rate-limited)...")


import time as _t  # noqa: E402

import requests as _rq  # noqa: E402

# Respectful fetch: Wikidata throttles bursts. Pace at ~1 per 1.2s with a backoff
# retry on HTTP 429 so the sampled descriptions are real, not 429-induced None.
_PACE = 1.2


def live_desc(name):
    for attempt in range(3):
        try:
            resp = _rq.get(
                wikidata.WIKIDATA_API,
                params={"action": "wbsearchentities", "search": name,
                        "language": "en", "format": "json", "limit": 1},
                timeout=10,
                headers={"User-Agent": wikidata._USER_AGENT},
            )
            if resp.status_code == 429:
                _t.sleep(3 * (attempt + 1))
                continue
            resp.raise_for_status()
            results = resp.json().get("search", [])
            if not results:
                return None
            return (results[0].get("description") or "").lower().strip()
        except Exception:
            _t.sleep(2 * (attempt + 1))
    return None  # exhausted retries; treat as no-result


def fetch_all(names):
    out = {}
    for nm in names:
        out[nm] = live_desc(nm)
        _t.sleep(_PACE)
    return out


descs = {}
for s in (sample_A, sample_B, sample_C):
    descs.update(fetch_all([n for n in s if n not in descs]))

# A: recall recovery
a_new_keep = sum(1 for n in sample_A if new_keep_indexed_only(descs.get(n), n, indexed))
# C: keep-precision retention
c_new_keep = sum(1 for n in sample_C if new_keep_indexed_only(descs.get(n), n, indexed))
c_old_keep = sum(1 for n in sample_C if old_keep(descs.get(n), n))
# B: false-keep exposure (indexed_only) + keep-all delta
b_new_keep = [n for n in sample_B if new_keep_indexed_only(descs.get(n), n, indexed)]
b_keepall = [n for n in sample_B if new_keep_all(descs.get(n), n)]
b_delta = len(b_keepall) - len(b_new_keep)

print()
print("=" * 64)
print("RESULTS (OLD gate vs NEW gate)")
print("=" * 64)
print(f"recall recovery  (A indexed null/false NEW keeps): "
      f"{a_new_keep}/{len(sample_A)} = {100*a_new_keep/max(len(sample_A),1):.0f}%  "
      f"(OLD kept 0 of these by definition: all were cached null/false = drop)")
print(f"keep-precision   (C cached-true still kept by NEW): "
      f"{c_new_keep}/{len(sample_C)} = {100*c_new_keep/max(len(sample_C),1):.0f}%  "
      f"(OLD kept {c_old_keep}/{len(sample_C)})")
print(f"false-keep expose (B non-indexed null NEW keeps under indexed_only): "
      f"{len(b_new_keep)}/{len(sample_B)}")
for n in b_new_keep:
    print(f"    KEEP? {n!r}  desc={ (descs.get(n) or 'no result')[:60] }")
print(f"keep-all delta   (extra B kept if NONE_KEEP_MODE=keep_all): +{b_delta} "
      f"({len(b_keepall)}/{len(sample_B)} total under keep_all)")
print("=" * 64)
print("No writes performed. Cache untouched.")
