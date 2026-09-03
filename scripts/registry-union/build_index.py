"""Build src/lib/registry-union/union-index.json from the SEC bulk files.

READ-ONLY AND OFFLINE. Reads a local scratch directory of already-downloaded
SEC bulk files and writes exactly one artifact into the repo. It makes no
network request, touches no database, and is NOT part of `npm run build`. Run
it by hand when the SEC files are refreshed, then review the diff.

    SCRATCH=/path/to/sec-scratch python3 scripts/registry-union/build_index.py

The scratch directory must contain the union of free, enumerable SEC sources
already merged into one line-delimited registry (see the SOURCES block in
union-index.json for the exact URLs):

    out/registry.jsonl   one JSON object per CIK:
                         {cik, name, names[], tickers[], exchanges[], sicDesc,
                          entityType, state, last_filing, n_recent, in_form_d}

SCOPE, chosen on measurement rather than taste. Only exchange-listed
registrants are shipped. Measured against prod on 2026-09-02, exactly 790
distinct CIKs carry any pillar row at all (sec_filings 678, insider_
transactions 349, validated financial_facts 784). 768 of those 790 are
major-exchange registrants, 15 are OTC-only and 7 are unlisted. The unlisted /
Form D / Form ADV / broker-dealer tiers therefore cannot fill a pillar for
anyone, and they carry the great majority of the adjudicated identity errors,
so they are out.

THE LADDER RUNS HERE, ONCE. The shipped runtime is a map lookup plus the two
checks that depend on the typed side and so cannot be baked (legal-form
conflict, denylist). A key is emitted only when the ladder leaves exactly one
survivor. There is no "first accepted candidate" anywhere in this file.
"""
import json, collections, sys, os, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ukey import strong_key, weak_key, strip_marker

SCRATCH = os.environ.get("SCRATCH", "/Users/noahhanning/ci-tracks/te-scratch")
REPO    = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
HERE    = os.path.dirname(os.path.abspath(__file__))
OUT     = os.path.join(REPO, "src", "lib", "registry-union", "union-index.json")
ACTIVE_FROM = "2024-01-01"
MAJOR = {"NYSE", "Nasdaq", "CBOE", "NYSE American", "NYSE Arca"}

BRAND = json.load(open(os.path.join(HERE, "brand-parent.json")))
DENY  = {k for k in json.load(open(os.path.join(HERE, "deny-keys.json"))) if not k.startswith("_")}

REG = {}
for line in open(os.path.join(SCRATCH, "out", "registry.jsonl")):
    e = json.loads(line)
    REG[e["cik"]] = e
LISTED = {c: e for c, e in REG.items() if [x for x in e["exchanges"] if x]}
print(f"registry {len(REG)} entities, listed {len(LISTED)}")

def major(c):  return any(x in MAJOR for x in LISTED[c]["exchanges"] if x)
def active(c): return (LISTED[c].get("last_filing") or "") >= ACTIVE_FROM

# ---- indexes -------------------------------------------------------------
strong_cur = collections.defaultdict(set)   # key -> {cik}, CURRENT names only
weak_cur   = collections.defaultdict(set)   # key -> {cik}, >=2 tokens, match index
weak_all   = collections.defaultdict(set)   # key -> {cik}, contest index only
for c, e in LISTED.items():
    ks = strong_key(strip_marker(e["name"] or ""))
    if not ks:
        continue
    strong_cur[ks].add(c)
    kw = weak_key(strip_marker(e["name"] or ""))
    if kw:
        weak_all[kw].add(c)
        # A weak key of ONE token is not evidence. 'Insight Partners' and
        # 'INSIGHT ENTERPRISES INC' both collapse to 'insight', which is how an
        # earlier draft pointed a growth-equity firm at an IT reseller.
        if len(kw.split()) >= 2:
            weak_cur[kw].add(c)

# Every registrant in the FULL CIK space that has filed since ACTIVE_FROM, so a
# one-word answer can be checked against the whole 983k rather than the listed
# tier. Dormant predecessors (ACCENTURE LTD last filed 2009, TRAVELERS CORP
# 1994, ORACLE CORP cik 727632 2003) must not veto a live match, which is why
# the contest index is filtered on recency rather than on existence.
full_active = collections.defaultdict(set)
for c, e in REG.items():
    if (e.get("last_filing") or "") < ACTIVE_FROM:
        continue
    k = strong_key(e["name"] or "")
    if k:
        full_active[k].add(c)

def narrow(cands):
    """The tie-break. Returns one cik or None. NEVER picks arbitrarily.
       1 exact match -> 2 major exchange over OTC -> 3 still filing -> 4 drop."""
    c = sorted(cands)
    if len(c) == 1: return c[0]
    m = [x for x in c if major(x)]
    if len(m) == 1: return m[0]
    if len(m) > 1: c = m
    f = [x for x in c if active(x)]
    return f[0] if len(f) == 1 else None

by_key, kinds, drop = {}, {}, collections.Counter()
for k, cks in strong_cur.items():
    if k in DENY: drop["deny"] += 1; continue
    w = narrow(cks)
    if w is None: drop["ambiguous_strong"] += 1; continue
    if len(k.split()) == 1:
        # G1, the one-word gate. This is where Vanguard-class answers are born.
        if not major(w):  drop["single_not_major"] += 1; continue
        if not active(w): drop["single_dormant"] += 1; continue
        if [c for c in weak_all.get(k, ()) if c != w]:    drop["single_weak_contest"] += 1; continue
        if [c for c in full_active.get(k, ()) if c != w]: drop["single_full_contest"] += 1; continue
    by_key[k] = w; kinds[k] = "s"
for k, cks in weak_cur.items():
    if k in by_key or k in DENY: continue
    w = narrow(cks)
    if w is None: drop["ambiguous_weak"] += 1; continue
    by_key[k] = w; kinds[k] = "w"
for k, c in BRAND.items():
    if int(c) not in LISTED: raise SystemExit(f"brand target {c} for {k!r} is not a listed registrant")
    by_key[k] = int(c); kinds[k] = "b"

used = sorted(set(by_key.values()))
art = {
 "schema": 1,
 "generated": datetime.date.today().isoformat(),
 "source": {
   "sec_company_tickers": "https://www.sec.gov/files/company_tickers.json",
   "sec_company_tickers_exchange": "https://www.sec.gov/files/company_tickers_exchange.json",
   "sec_submissions_bulk": "https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip (current + former names)",
   "sec_cik_lookup": "https://www.sec.gov/Archives/edgar/cik-lookup-data.txt",
   "form_d": "https://www.sec.gov/dera/data/form-d",
   "form_adv": "https://reports.adviserinfo.sec.gov/reports/CompilationReports",
   "wikidata": "brand -> listed parent, CC0, hand-verified per entry",
 },
 "scope": ("exchange-listed SEC registrants only. Measured on prod 2026-09-02, 790 distinct CIKs "
           "carry any pillar row and 768 of them are major-exchange registrants, 15 OTC-only, 7 "
           "unlisted, so the unlisted / Form D / Form ADV / broker-dealer tiers cannot fill a "
           "pillar for anyone and are excluded."),
 "counts": {"listed_registrants": len(LISTED), "entities_shipped": len(used), "keys": len(by_key),
            "strong": sum(1 for v in kinds.values() if v == "s"),
            "weak":   sum(1 for v in kinds.values() if v == "w"),
            "brand":  sum(1 for v in kinds.values() if v == "b"),
            "dropped": dict(drop)},
 "deny": sorted(DENY),
 # Shipped shape is [name, tickers, exchange]. `major` and `last_filing` are
 # build-time inputs to the ladder and the one-word gate; both decisions are
 # already baked into WHICH KEYS EXIST, so neither travels to the runtime.
 "entities": {str(c): [strip_marker(LISTED[c]["name"] or ""), LISTED[c]["tickers"][:4],
                       (LISTED[c]["exchanges"] or [None])[0] or ""] for c in used},
 "keys": {k: [by_key[k], kinds[k]] for k in sorted(by_key)},
}
json.dump(art, open(OUT, "w"), separators=(",", ":"))
print(json.dumps(art["counts"], indent=1))
print("wrote", OUT, os.path.getsize(OUT), "bytes")
