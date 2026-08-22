"""Measure whether the firms a finance student actually types resolve today.

STRICTLY READ-ONLY. Issues SELECTs only. Never writes, never calls Gemini,
never calls Exa, never calls resolve_entity (so it cannot mint a company).
`--emit-seed` writes a SQL PROPOSAL FILE to disk and nothing else; applying it
is a human decision.

The universe is `backend/data/recruiting_universe.json`, curated to the way a
student types a firm ("Evercore", "Centerview", "Jane Street") rather than the
way a filer registers. Resolution uses the project's own order, imported
behaviour-for-behaviour from `ingest._resolve_primary_to_canonical`.

TWO RATES ARE REPORTED, because they differ and only one is what a student
experiences:

  BACKEND   exact name -> case-insensitive name -> aliases.lookup_key ->
            companies.ticker -> suffix-normalized key. This is the ingest
            fold gate, and the widest surface in the project.

  FRONTEND  what `src/lib/data-access/aliasResolver.resolveAlias` actually does
            on /company/<slug>: companies.ticker for a bare 1-5 letter symbol,
            else a case-insensitive EXACT match on companies.name. It never
            reads the aliases table and never normalizes a suffix, so it is
            strictly narrower than the backend gate.

A name that "resolves" is not the same as a name that resolves CORRECTLY.
`--audit-identity` cross-checks every resolved row's ticker against
`cik_tickers` and reports the rows that land on a different SEC filer.

Usage:
    python tools/recruiting_universe_eval.py
    python tools/recruiting_universe_eval.py --audit-identity
    python tools/recruiting_universe_eval.py --cache /tmp/titles.jsonl
    python tools/recruiting_universe_eval.py --emit-seed sql/proposals/0030_seed.sql
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(".env.local")

# .env.local exposes the URL under the NEXT_PUBLIC_ name; backend code reads
# SUPABASE_URL. Bridge it here rather than mutating the file.
if "SUPABASE_URL" not in os.environ and "NEXT_PUBLIC_SUPABASE_URL" in os.environ:
    os.environ["SUPABASE_URL"] = os.environ["NEXT_PUBLIC_SUPABASE_URL"]

from supabase import create_client  # noqa: E402

from company_match import normalize_company_key  # noqa: E402
from normalize import normalize_lookup_key  # noqa: E402
from recruiting_universe import (  # noqa: E402
    MIN_CORPUS_EVIDENCE,
    load_universe,
    plan_universe,
    render_seed_sql,
    resolve,
)

PAGE = 1000
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

#: resolveAlias only treats a bare 1-5 letter symbol as a ticker. Wider shapes
#: fall through to the name match, which is why "BRK.B" never hits the ticker
#: surface on the frontend even though the backend's looks_like_ticker accepts it.
_FE_TICKER_RE = re.compile(r"^[A-Z]{1,5}$")


def _page_all(table, columns, order_col="id", **eq):
    """Keyset-paginate a whole table. Keyset, not .range(): articles is ~180k
    rows and LIMIT/OFFSET is O(offset) per page."""
    out, cursor = [], None
    while True:
        q = sb.table(table).select(columns).order(order_col).limit(PAGE)
        for k, v in eq.items():
            q = q.eq(k, v)
        if cursor is not None:
            q = q.gt(order_col, cursor)
        rows = q.execute().data or []
        out.extend(rows)
        if len(rows) < PAGE:
            return out
        cursor = rows[-1][order_col]


def build_snapshot():
    """Mirror of ingest._load_entity_snapshot / primary_fold_eval.build_index."""
    companies = _page_all("companies", "id, name, ticker, sec_cik, mention_count")
    aliases = _page_all("aliases", "lookup_key, canonical_id", order_col="lookup_key")

    name_by_id, row_by_id = {}, {}
    by_alias, by_ticker, by_norm = defaultdict(set), defaultdict(set), defaultdict(set)
    exact_names, lower_names = set(), {}

    for r in companies:
        cid, name = r.get("id"), (r.get("name") or "").strip()
        if not cid or not name:
            continue
        name_by_id[cid] = name
        row_by_id[cid] = r
        exact_names.add(name)
        lower_names.setdefault(name.lower(), name)
        by_norm[normalize_company_key(name)].add(cid)
        t = (r.get("ticker") or "").strip().upper()
        if t:
            by_ticker[t].add(cid)

    for r in aliases:
        key, cid = (r.get("lookup_key") or "").strip(), r.get("canonical_id")
        if not key or cid not in name_by_id:
            continue
        by_alias[key].add(cid)
        by_norm[normalize_company_key(key)].add(cid)

    return dict(name_by_id=name_by_id, row_by_id=row_by_id, by_alias=by_alias,
                by_ticker=by_ticker, by_norm=by_norm, exact_names=exact_names,
                lower_names=lower_names)


def resolve_frontend(snapshot, typed):
    """What resolveAlias() does. Deliberately narrower than resolve(): no alias
    table, no suffix normalization. Returns the canonical name or None."""
    up = typed.strip().upper()
    if _FE_TICKER_RE.match(up):
        ids = snapshot["by_ticker"].get(up)
        if ids:
            rows = [snapshot["row_by_id"][i] for i in ids]
            rows.sort(key=lambda r: (-(r.get("mention_count") or 0), r["id"]))
            return rows[0]["name"]
    return snapshot["lower_names"].get(typed.lower())


def corpus_evidence(titles_blob, name):
    """Whole-word title mentions. A word boundary matters: without it "Zip"
    matches "Zipline" and every seeded row looks justified."""
    pat = re.compile(r"(?<![A-Za-z0-9])" + re.escape(name.lower()) + r"(?![A-Za-z0-9])")
    return len(pat.findall(titles_blob))


def load_titles(cache):
    if cache and os.path.exists(cache):
        with open(cache) as fh:
            return [json.loads(line)["title"] or "" for line in fh]
    print("scanning article titles (one full read)...", flush=True)
    rows, cursor, seen = [], None, 0
    while True:
        q = sb.table("articles").select("id, title").order("id").limit(PAGE)
        if cursor is not None:
            q = q.gt("id", cursor)
        batch = q.execute().data or []
        rows.extend(batch)
        seen += len(batch)
        if seen % 50000 < PAGE:
            print(f"  {seen} rows...", flush=True)
        if len(batch) < PAGE:
            break
        cursor = batch[-1]["id"]
    if cache:
        with open(cache, "w") as fh:
            for r in rows:
                fh.write(json.dumps({"title": r.get("title")}) + "\n")
    return [r.get("title") or "" for r in rows]


def audit_identity(snapshot, plan):
    """A resolved name is not necessarily the RIGHT company. Cross-check every
    resolved row's ticker against cik_tickers and flag the ones that land on a
    filer whose name shares no content token with what the student typed."""
    ct = _page_all("cik_tickers", "cik, company_name, ticker", order_col="cik")
    by_tkr = {}
    for r in ct:
        t = (r.get("ticker") or "").strip().upper()
        if t:
            by_tkr.setdefault(t, r["company_name"])

    stop = {"the", "and", "of", "group", "holdings", "inc", "corp", "corporation",
            "co", "company", "llc", "ltd", "plc", "capital", "partners",
            "management", "international", "securities", "financial", "advisors",
            "associates", "consulting", "llp", "lp", "sa", "ag", "nv"}

    def toks(s):
        return {w for w in re.split(r"[^a-z0-9]+", (s or "").lower())
                if w and w not in stop and len(w) > 1}

    bad, unverifiable = [], []
    for d in plan:
        if d["action"] != "already_resolves":
            continue
        ids = [i for i, n in snapshot["name_by_id"].items() if n == d["canonical"]]
        if not ids:
            continue
        row = max((snapshot["row_by_id"][i] for i in ids),
                  key=lambda r: (r.get("mention_count") or 0))
        tkr = (row.get("ticker") or "").strip().upper()
        if not tkr:
            continue
        filer = by_tkr.get(tkr)
        if not filer:
            unverifiable.append((d["category"], d["name"], d["canonical"], tkr))
        elif not (toks(d["name"]) & toks(filer)):
            bad.append((d["category"], d["name"], d["canonical"], tkr, filer))

    print("\n=== identity audit: resolved names whose row is a DIFFERENT filer ===")
    print(f"{'category':<16} {'typed':<26} {'row':<24} {'tkr':<7} SEC filer behind that ticker")
    print("-" * 116)
    for c, n, b, t, f in bad:
        print(f"{c:<16} {n:<26} {b:<24} {t:<7} {f}")
    print(f"\n{len(bad)} hard mismatches, {len(unverifiable)} rows carry a ticker "
          f"absent from cik_tickers:")
    for c, n, b, t in unverifiable:
        print(f"    {c:<16} {n:<26} {b:<24} {t}")
    print("\nNOTE: this catches only HARD mismatches. A row that shares the word but "
          "\nnot the company (Vanguard -> AMERICAN VANGUARD CORP, Fidelity -> Fidelity "
          "\nNational Information Services) passes this test and is still wrong. Those "
          "\nneed a human read.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default="", help="path to cache the title scan")
    ap.add_argument("--audit-identity", action="store_true")
    ap.add_argument("--emit-seed", default="", help="write a SQL PROPOSAL to this path")
    args = ap.parse_args()

    print("building entity snapshot from prod (SELECT-only)...", flush=True)
    snap = build_snapshot()
    print(f"  companies={len(snap['name_by_id'])} alias_keys={len(snap['by_alias'])} "
          f"tickers={len(snap['by_ticker'])} norm_keys={len(snap['by_norm'])}")

    universe = load_universe()
    titles_blob = "\n".join(load_titles(args.cache)).lower()
    names = [n for b in universe.values() for n in b["names"]]
    evidence = {n: corpus_evidence(titles_blob, n) for n in names}

    ct = _page_all("cik_tickers", "cik, company_name, ticker", order_col="cik")
    cik_by_name = {}
    for r in ct:
        cik_by_name.setdefault(normalize_lookup_key(r.get("company_name") or ""), r)

    frontend_hits = {n for n in names if resolve_frontend(snap, n)}
    plan = plan_universe(snap, universe, evidence, cik_by_name, frontend_hits)

    print(f"\n{'category':<18} {'n':>4} {'backend':>15} {'frontend':>15}   why this category")
    print("-" * 118)
    tb = tf = tn = 0
    for cat, block in universe.items():
        ns = block["names"]
        hb = sum(1 for n in ns if resolve(snap, n))
        hf = sum(1 for n in ns if resolve_frontend(snap, n))
        tb += hb
        tf += hf
        tn += len(ns)
        print(f"{cat:<18} {len(ns):>4} {hb:>4}/{len(ns):<3}{hb/len(ns)*100:>6.1f}% "
              f"{hf:>4}/{len(ns):<3}{hf/len(ns)*100:>6.1f}%   {block['why'][:52]}")
    print("-" * 118)
    print(f"{'UNIVERSE TOTAL':<18} {tn:>4} {tb:>4}/{tn:<3}{tb/tn*100:>6.1f}% "
          f"{tf:>4}/{tn:<3}{tf/tn*100:>6.1f}%")

    counts = defaultdict(int)
    for d in plan:
        counts[d["action"]] += 1
    print("\n=== seed plan ===")
    for action in ("already_resolves", "frontend_blind", "seed_public",
                   "seed_private", "refuse_collision", "refuse_no_content"):
        print(f"  {action:<20} {counts[action]:>4}")
    print(f"\n  refuse_no_content is names with fewer than {MIN_CORPUS_EVIDENCE} corpus "
          f"mentions.\n  Seeding those buys a resolution statistic and an empty page.")

    for d in plan:
        if d["action"] == "refuse_collision":
            print(f"  COLLISION  {d['name']}: {d['reason']}")
    blind = [d for d in plan if d["action"] == "frontend_blind"]
    if blind:
        print("\n  frontend_blind: resolves in ingest, dead on /company/<slug>.")
        print("  No seed fixes these. resolveAlias needs the alias + normalized surface:")
        for d in blind:
            print(f"    {d['name']:<24} -> {d['canonical']}")

    if args.audit_identity:
        audit_identity(snap, plan)

    if args.emit_seed:
        sql = render_seed_sql(plan)
        with open(args.emit_seed, "w") as fh:
            fh.write(sql)
        print(f"\nwrote SQL PROPOSAL to {args.emit_seed}")
        print("HAND-APPLY ONLY. Nothing in this repo executes it.")


if __name__ == "__main__":
    main()
