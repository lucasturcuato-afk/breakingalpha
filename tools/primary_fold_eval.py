"""Measure the primary_company fold gap, before and after the resolution change.

STRICTLY READ-ONLY. Issues SELECTs only. Never writes, never calls Gemini,
never calls resolve_entity (so it cannot mint a company).

Replicates the methodology of scratch/A-primary-company-fold-failure.md section
4 so the after-number is comparable to its measured 12.9%:

  - take the distinct type='ticker' watchlist identifiers
  - map each to an indexed company via companies.ticker
  - over ALL article rows, count
      (a) rows a .contains("companies", [name]) query returns, which is the
          exact case-SENSITIVE containment PostgREST performs, and
      (b) rows that are about that company but which (a) does not return.

THREE denominators are reported, because the diagnosis does not pin its own
precisely enough to reproduce from one definition. Its section 3 describes
normalization as "lowercase + punctuation-strip + legal-suffix-strip", while its
caveat 2 says ticker-form and near-miss primaries were NOT counted. Those two
statements imply different pools, so all three are measured and labelled:

  STRICT      (b) counts only rows whose primary_company equals the canonical
              name under v1 normalization (NFKC + lowercase). Narrowest reading.

  NORMALIZED  (b) uses the v2 key (punctuation + legal-suffix folding) on NAMES
              only: no ticker surface, no alias surface. This is the closest
              reconstruction of the diagnosis's 12.9%, and the number to compare
              against it.

  REACHABLE   (b) counts every row any new surface can reach, using an oracle
              that deliberately does NOT require uniqueness. An after-miss here
              therefore means the ambiguity guard refused to fold a reachable
              row, which is the cost of failing closed rather than the gap.

Rows no surface can reach are reported separately under `residual`: that is the
cluster-6 population, and no matching change can close it.

Usage:
    python tools/primary_fold_eval.py --cache /tmp/scan.jsonl   # full report
    python tools/primary_fold_eval.py --cache /tmp/scan.jsonl --suffix-audit
    python tools/primary_fold_eval.py --why "Coca-Cola"         # one name
    python tools/primary_fold_eval.py --limit 20000             # quick smoke
"""

import argparse
import json
import os
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

from company_match import (  # noqa: E402
    BASE_SUFFIXES,
    EXTRA_SUFFIXES,
    company_key_tokens,
    guarded_fold_candidates,
    index_tokens,
    looks_like_ticker,
    normalize_company_key,
    token_fold_candidates,
)
from normalize import normalize_lookup_key  # noqa: E402

PAGE = 1000

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])


def _page_all(table, columns, order_col="id", **eq):
    """Keyset-paginate a whole table. Keyset, not .range(): articles is ~169k
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


# ---------------------------------------------------------------------------
# Entity index, mirroring ingest._load_entity_snapshot
# ---------------------------------------------------------------------------
def build_index():
    companies = _page_all("companies", "id, name, ticker")
    aliases = _page_all("aliases", "lookup_key, canonical_id", order_col="lookup_key")

    name_by_id, by_alias, by_ticker, by_norm = {}, defaultdict(set), defaultdict(set), defaultdict(set)
    exact_names, lower_names = set(), {}
    by_name_tokens, by_token_prefix = {}, {}

    for r in companies:
        cid, name = r.get("id"), (r.get("name") or "").strip()
        if not cid or not name:
            continue
        name_by_id[cid] = name
        exact_names.add(name)
        lower_names.setdefault(name.lower(), name)
        by_norm[normalize_company_key(name)].add(cid)
        index_tokens(by_name_tokens, by_token_prefix, company_key_tokens(name), cid, from_name=True)
        t = (r.get("ticker") or "").strip().upper()
        if t:
            by_ticker[t].add(cid)

    for r in aliases:
        key, cid = (r.get("lookup_key") or "").strip(), r.get("canonical_id")
        if not key or cid not in name_by_id:
            continue
        by_alias[key].add(cid)
        by_norm[normalize_company_key(key)].add(cid)
        index_tokens(by_name_tokens, by_token_prefix, company_key_tokens(key), cid, from_name=False)

    return {
        "name_by_id": name_by_id, "by_alias": by_alias, "by_ticker": by_ticker,
        "by_norm": by_norm, "exact_names": exact_names, "lower_names": lower_names,
        "by_name_tokens": by_name_tokens, "by_token_prefix": by_token_prefix,
    }


def _unique(idx, ids):
    if not ids or len(ids) != 1:
        return None
    return idx["name_by_id"].get(next(iter(ids)))


def resolve_before(idx, name):
    """The OLD gate: exact name, else case-insensitive name. Returned the raw
    string, which is why a case difference still failed .contains."""
    if name in idx["exact_names"]:
        return name
    return name if name.lower() in idx["lower_names"] else None


def resolve_after(idx, name):
    """The NEW gate: same first two steps, then alias, ticker, normalized, then
    the leading-token fold. Mirrors ingest._resolve_primary_to_canonical step
    for step, AMBIGUITY GUARD INCLUDED. Returns the CANONICAL name.

    The guard is not decoration here. `tools/backfill_primary_fold.py` imports
    this function and calls it to decide what `--apply` WRITES into
    articles.companies[]. A version of it that resolves differently from the
    live pipeline writes rows the pipeline would never have written, and the
    divergence is invisible because both sides look reasonable in isolation.
    That is exactly what happened: the guard landed in ingest and in
    tools/wikidata_gate_recovery.py and was missed here, and the two resolvers
    then disagreed on 14 strings over 105 of 196,056 rows, every one of the
    four measured false folds among them.
    """
    if name in idx["exact_names"]:
        return name
    canonical = idx["lower_names"].get(name.lower())
    if canonical:
        return canonical
    canonical = _unique(idx, idx["by_alias"].get(normalize_lookup_key(name)))
    if canonical:
        return canonical
    if looks_like_ticker(name):
        canonical = _unique(idx, idx["by_ticker"].get(name.strip().upper()))
        if canonical:
            return canonical
    norm_ids = idx["by_norm"].get(normalize_company_key(name))
    canonical = _unique(idx, norm_ids)
    if canonical:
        return canonical
    return _unique(idx, guarded_fold_candidates(norm_ids, token_fold_candidates(
        idx["by_name_tokens"], idx["by_token_prefix"], name)))


def oracle_candidates(idx, name):
    """Every company `name` could plausibly denote, WITHOUT the uniqueness
    requirement the gate enforces.

    This is deliberately more generous than resolve_after, and it must stay
    independent of it: if the "true pool" were defined by the resolver under
    test, the after-number would be 100% by construction. Because this returns
    ambiguous candidates too, rows the gate refuses to fold (two companies
    behind one key) correctly remain counted as missed after the change.
    """
    ids = set()
    if name in idx["exact_names"]:
        return {name}
    canonical = idx["lower_names"].get(name.lower())
    if canonical:
        return {canonical}
    ids |= idx["by_alias"].get(normalize_lookup_key(name), set())
    if looks_like_ticker(name):
        ids |= idx["by_ticker"].get(name.strip().upper(), set())
    ids |= idx["by_norm"].get(normalize_company_key(name), set())
    ids |= token_fold_candidates(idx["by_name_tokens"], idx["by_token_prefix"], name)
    return {idx["name_by_id"][i] for i in ids if i in idx["name_by_id"]}


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="stop after N articles (smoke)")
    ap.add_argument("--suffix-audit", action="store_true")
    ap.add_argument("--cache", default="", help="path to cache the article scan (JSON lines)")
    ap.add_argument("--why", default="", help="explain how one primary_company resolves")
    args = ap.parse_args()

    print("loading entity index...", flush=True)
    idx = build_index()
    print(f"  companies={len(idx['name_by_id'])} alias_keys={len(idx['by_alias'])} "
          f"tickers={len(idx['by_ticker'])} norm_keys={len(idx['by_norm'])}")

    print("loading watchlist tickers...", flush=True)
    wl = _page_all("watchlist", "identifier", order_col="identifier", type="ticker")
    tickers = sorted({(r["identifier"] or "").strip().upper() for r in wl if r.get("identifier")})
    resolving = {t: _unique(idx, idx["by_ticker"].get(t)) for t in tickers}
    tracked = {t: n for t, n in resolving.items() if n}
    print(f"  {len(tickers)} watchlist tickers, {len(tracked)} resolve to a company, "
          f"{len(tickers) - len(tracked)} do not")

    if args.why:
        return explain(idx, args.why)

    if args.cache and os.path.exists(args.cache):
        print(f"loading cached scan from {args.cache}...", flush=True)
        with open(args.cache) as fh:
            rows = [json.loads(line) for line in fh]
        print(f"  {len(rows)} article rows (cached)")
        return analyze(idx, tracked, rows, args)

    print("scanning articles (this reads the full table)...", flush=True)
    rows, cursor, seen = [], None, 0
    while True:
        q = (sb.table("articles").select("id, companies, primary_company")
             .order("id").limit(PAGE))
        if cursor is not None:
            q = q.gt("id", cursor)
        batch = q.execute().data or []
        rows.extend(batch)
        seen += len(batch)
        if seen % 20000 < PAGE:
            print(f"  {seen} rows...", flush=True)
        if len(batch) < PAGE or (args.limit and seen >= args.limit):
            break
        cursor = batch[-1]["id"]
    print(f"  {len(rows)} article rows")

    if args.cache:
        with open(args.cache, "w") as fh:
            for r in rows:
                fh.write(json.dumps(r) + "\n")
        print(f"  cached to {args.cache}")

    return analyze(idx, tracked, rows, args)


def explain(idx, name):
    """Why does one primary_company resolve, or not? Used to check surprises in
    the residual rather than guessing at them."""
    print(f"\nname                : {name!r}")
    print(f"v1 key              : {normalize_lookup_key(name)!r}")
    print(f"v2 key              : {normalize_company_key(name)!r}")
    print(f"exact name hit      : {name in idx['exact_names']}")
    print(f"case-insensitive    : {idx['lower_names'].get(name.lower())!r}")
    for label, key, table in (
        ("alias", normalize_lookup_key(name), "by_alias"),
        ("ticker", name.strip().upper(), "by_ticker"),
        ("normalized", normalize_company_key(name), "by_norm"),
    ):
        ids = idx[table].get(key, set())
        names = sorted(idx["name_by_id"].get(i, "?") for i in ids)
        print(f"{label:<20}: {len(ids)} hit(s) {names[:6]}")
    print(f"RESOLVES TO         : {resolve_after(idx, name)!r}")


def analyze(idx, tracked, rows, args):
    if args.suffix_audit:
        return suffix_audit(idx, rows)

    # Per-company tallies.
    hit = defaultdict(int)          # (a) .contains returns it today
    strict_miss = defaultdict(int)  # (b) v1-exact pool
    norm_miss = defaultdict(int)    # (b) v2-normalized name pool
    wide_miss = defaultdict(int)    # (b) every reachable surface
    after_miss_strict = defaultdict(int)
    after_miss_norm = defaultdict(int)
    after_miss_wide = defaultdict(int)

    canonical_to_ticker = {}
    for t, n in tracked.items():
        canonical_to_ticker.setdefault(n, t)

    # STRICT pool key: v1 normalization only (NFKC + lowercase). Deliberately
    # NOT normalize_company_key: the diagnosis's caveat 2 records that its pool
    # excluded ticker-form and near-miss primaries, so using the suffix-folding
    # key here would silently widen the denominator and break comparability
    # with its 12.9%.
    strict_key_to_canonical = {
        normalize_lookup_key(n): n for n in canonical_to_ticker
    }
    # NORMALIZED pool: name-normalization only, no ticker surface and no alias
    # surface. This is the reconstruction of the diagnosis's own pool: its
    # section 3 describes normalization as "lowercase + punctuation-strip +
    # legal-suffix-strip", while its caveat 2 excludes ticker-form primaries.
    # Only a canonical name that is UNIQUE under the v2 key is used, so this
    # cannot silently absorb the ambiguous cases.
    norm_key_counts = defaultdict(int)
    for n in canonical_to_ticker:
        norm_key_counts[normalize_company_key(n)] += 1
    norm_key_to_canonical = {
        normalize_company_key(n): n for n in canonical_to_ticker
        if norm_key_counts[normalize_company_key(n)] == 1
    }
    tracked_names = set(canonical_to_ticker)

    for r in rows:
        present = set(r.get("companies") or [])
        primary = (r.get("primary_company") or "").strip()

        for name in tracked_names:
            if name in present:
                hit[name] += 1

        if not primary:
            continue

        after_name = resolve_after(idx, primary)

        strict_target = strict_key_to_canonical.get(normalize_lookup_key(primary))
        if strict_target and strict_target not in present:
            strict_miss[strict_target] += 1
            # After the change the fold appends the canonical name, so the row
            # is still missing only if resolution does not reach that company.
            if after_name != strict_target:
                after_miss_strict[strict_target] += 1

        norm_target = norm_key_to_canonical.get(normalize_company_key(primary))
        if norm_target and norm_target not in present:
            norm_miss[norm_target] += 1
            if after_name != norm_target:
                after_miss_norm[norm_target] += 1

        for wide_target in oracle_candidates(idx, primary) & tracked_names:
            if wide_target in present:
                continue
            wide_miss[wide_target] += 1
            if after_name != wide_target:
                after_miss_wide[wide_target] += 1

    def report(label, miss, after):
        tot_hit = sum(hit[n] for n in canonical_to_ticker)
        tot_miss = sum(miss.values())
        tot_after = sum(after.values())
        pool = tot_hit + tot_miss
        print(f"\n=== {label} ===")
        print(f"companies[] returns : {tot_hit}")
        print(f"missed BEFORE       : {tot_miss}   ({tot_miss / pool * 100:.1f}% of {pool})")
        print(f"missed AFTER        : {tot_after}   ({tot_after / pool * 100:.1f}% of {pool})")
        if tot_miss:
            print(f"recovered           : {tot_miss - tot_after} "
                  f"({(tot_miss - tot_after) / tot_miss * 100:.1f}% of the gap)")
        worst = sorted(canonical_to_ticker, key=lambda n: -miss[n])[:12]
        print(f"\n{'ticker':<7} {'company':<28} {'hit':>6} {'miss':>6} {'after':>6} "
              f"{'before%':>8} {'after%':>8}")
        for n in worst:
            if not miss[n]:
                continue
            p = hit[n] + miss[n]
            print(f"{canonical_to_ticker[n]:<7} {n[:28]:<28} {hit[n]:>6} {miss[n]:>6} "
                  f"{after[n]:>6} {miss[n] / p * 100:>7.1f}% {after[n] / p * 100:>7.1f}%")

    report("STRICT pool (v1 lowercase-exact primary -> canonical name only)",
           strict_miss, after_miss_strict)
    report("NORMALIZED pool (v2 name-normalization, no ticker/alias surface) "
           "- closest reconstruction of the diagnosis's 12.9%",
           norm_miss, after_miss_norm)
    # Not "the true gap": the oracle only claims rows the new surfaces can
    # reach, so an after-miss here means the ambiguity guard refused to fold a
    # reachable row. That is precisely the cost of failing closed. The rows no
    # surface can reach are reported separately, under residual.
    report("REACHABLE pool (ticker + alias + near-miss); after-miss = ambiguity-guard cost",
           wide_miss, after_miss_wide)

    unresolved_residual(idx, rows)


def unresolved_residual(idx, rows):
    """What the change does NOT fix, and why: the cluster-6 population."""
    counts = defaultdict(int)
    for r in rows:
        primary = (r.get("primary_company") or "").strip()
        if not primary:
            continue
        if primary in (r.get("companies") or []):
            continue
        if resolve_after(idx, primary) is None:
            counts[primary] += 1
    total = sum(counts.values())
    print(f"\n=== residual: primary_company still unresolvable after the change ===")
    print(f"{total} rows over {len(counts)} distinct names")
    print("top 15 (these need an index entry to exist at all, i.e. a mint path):")
    for name, n in sorted(counts.items(), key=lambda kv: -kv[1])[:15]:
        print(f"  {n:>5}  {name}")


def suffix_audit(idx, rows):
    """What each EXTRA suffix actually buys, so the divergence from 0020 is
    earned rather than assumed."""
    primaries = defaultdict(int)
    for r in rows:
        p = (r.get("primary_company") or "").strip()
        if p and p not in (r.get("companies") or []):
            primaries[p] += 1

    import re as _re

    import company_match

    original = company_match._SUFFIX_RE
    try:
        def resolved_count(suffixes):
            company_match._SUFFIX_RE = _re.compile(r"\s+(" + "|".join(suffixes) + r")$")
            local = build_index()   # normalized keys depend on the rule
            resolved = ambiguous = 0
            for p, n in primaries.items():
                if resolve_after(local, p):
                    resolved += n
                elif len(oracle_candidates(local, p)) > 1:
                    ambiguous += n
            return resolved, ambiguous

        base_n, base_amb = resolved_count(BASE_SUFFIXES)
        print(f"\nBASE only (0020 parity): {base_n} rows resolve, {base_amb} blocked as ambiguous")
        print("each EXTRA suffix, added to BASE alone:")
        for extra in EXTRA_SUFFIXES:
            n, amb = resolved_count(BASE_SUFFIXES + (extra,))
            verdict = "keep" if n > base_n else "DROP, buys nothing"
            print(f"  +{extra:<6} {n - base_n:>+6} rows  "
                  f"{amb - base_amb:>+5} newly ambiguous   {verdict}")
        all_n, all_amb = resolved_count(BASE_SUFFIXES + EXTRA_SUFFIXES)
        print(f"BASE + all EXTRA: {all_n} rows ({all_n - base_n:+} vs base), "
              f"{all_amb} ambiguous ({all_amb - base_amb:+})")
    finally:
        company_match._SUFFIX_RE = original


if __name__ == "__main__":
    main()
