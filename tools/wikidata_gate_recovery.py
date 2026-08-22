"""Measure how much of the Wikidata-gate article loss the READ-ONLY primary
fold recovers WITHOUT CREATING A SINGLE ROW.

STRICTLY READ-ONLY. SELECTs only. Never writes, never calls Gemini, never calls
Wikidata, never calls entity_resolver.resolve_entity (so it cannot mint a
company row or an alias row).

WHAT THE GATE LOSS IS
---------------------
backend/wikidata.is_valid_company drops an extracted company when the classifier
says "not a company" (is_company = false) or when it says "ambiguous"
(is_company = null) and NONE_KEEP_MODE = "indexed_only" cannot find the name in
the indexed set. A dropped name never reaches articles.companies[], so the
article does not appear on that company's page.

An article is counted as LOST when, in the window,
  - primary_company is non-empty, and
  - primary_company is NOT in articles.companies[], and
  - wikidata_entity_cache holds a verdict for that exact name (so the gate did
    run on it), and
  - replaying _resolve_keep against that cached verdict returns drop.

WHY THIS IS THE ZERO-WRITE PATH
-------------------------------
There are two ways to put a gate-dropped company back on the article:

  (a) widen the GATE so the name is admitted. The admitted name then flows into
      _resolve_company_entity -> entity_resolver.resolve_entity, whose miss path
      INSERTS a companies row and an aliases row. Recovering "Truist Financial"
      that way MINTS A DUPLICATE of the indexed "Truist" [TFC, cik 92230],
      because resolve_entity keys on normalize_lookup_key v1, which does not
      bridge the extra token. This tool does not measure that path, and this
      lane deliberately does not touch the gate.

  (b) widen the read-only PRIMARY FOLD. _resolve_primary_to_canonical never
      calls resolve_entity; it resolves the name against a snapshot of the
      existing index and appends the CANONICAL name already in the index.
      Zero INSERTs, of any kind, into any table. That is what this measures.

Usage:
    python tools/wikidata_gate_recovery.py --cache /tmp/gate.jsonl
    python tools/wikidata_gate_recovery.py --cache /tmp/gate.jsonl --audit
    python tools/wikidata_gate_recovery.py --cache /tmp/gate.jsonl --split
"""

import argparse
import json
import os
import random
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(".env.local")
if "SUPABASE_URL" not in os.environ and "NEXT_PUBLIC_SUPABASE_URL" in os.environ:
    os.environ["SUPABASE_URL"] = os.environ["NEXT_PUBLIC_SUPABASE_URL"]

from supabase import create_client  # noqa: E402

import wikidata  # noqa: E402
from company_match import (  # noqa: E402
    company_key_tokens,
    index_tokens,
    looks_like_ticker,
    normalize_company_key,
    token_fold_candidates,
)
from normalize import normalize_lookup_key  # noqa: E402

PAGE = 1000
WINDOW_START = "2026-07-14"
WINDOW_END = "2026-08-19"   # exclusive

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])


def _page_all(table, columns, order_col="id"):
    """Keyset-paginate a whole table. Keyset, not .range(): articles is ~180k
    rows and LIMIT/OFFSET is O(offset) per page. A COUNT over articles times the
    statement out entirely, which is why nothing here asks for one."""
    out, cursor = [], None
    while True:
        q = sb.table(table).select(columns).order(order_col).limit(PAGE)
        if cursor is not None:
            q = q.gt(order_col, cursor)
        rows = q.execute().data or []
        out.extend(rows)
        if len(rows) < PAGE:
            return out
        cursor = rows[-1][order_col]


# ---------------------------------------------------------------------------
# Index, mirroring ingest._load_entity_snapshot
# ---------------------------------------------------------------------------
def build_index(companies, aliases):
    idx = {
        "name_by_id": {}, "meta_by_id": {}, "by_alias": defaultdict(set),
        "by_ticker": defaultdict(set), "by_norm": defaultdict(set),
        "exact_names": set(), "lower_names": {},
        "by_name_tokens": {}, "by_token_prefix": {},
    }
    for r in companies:
        cid, name = r.get("id"), (r.get("name") or "").strip()
        if not cid or not name:
            continue
        idx["name_by_id"][cid] = name
        idx["meta_by_id"][cid] = (r.get("ticker"), r.get("sec_cik"), r.get("mention_count"))
        idx["exact_names"].add(name)
        idx["lower_names"].setdefault(name.lower(), name)
        idx["by_norm"][normalize_company_key(name)].add(cid)
        index_tokens(idx["by_name_tokens"], idx["by_token_prefix"],
                     company_key_tokens(name), cid, from_name=True)
        t = (r.get("ticker") or "").strip().upper()
        if t:
            idx["by_ticker"][t].add(cid)
    for r in aliases:
        key, cid = (r.get("lookup_key") or "").strip(), r.get("canonical_id")
        if not key or cid not in idx["name_by_id"]:
            continue
        idx["by_alias"][key].add(cid)
        idx["by_norm"][normalize_company_key(key)].add(cid)
        index_tokens(idx["by_name_tokens"], idx["by_token_prefix"],
                     company_key_tokens(key), cid, from_name=False)
    return idx


def _unique(idx, ids):
    if not ids or len(ids) != 1:
        return None
    return idx["name_by_id"].get(next(iter(ids)))


def resolve_existing(idx, name):
    """Steps 1-5 of ingest._resolve_primary_to_canonical: the surfaces that
    already shipped. No token fold."""
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
    return _unique(idx, idx["by_norm"].get(normalize_company_key(name)))


def resolve_widened(idx, name, guard_step_five_refusals=True):
    """Steps 1-6: adds the leading-token fold. Mirrors the shipped resolver,
    ambiguity guard included.

    THE GUARD. `_unique` yields None both when the candidate set is EMPTY and
    when it holds more than one id, so `resolve_existing(...) is None` cannot
    tell "step 5 found nothing" from "step 5 refused because it was
    ambiguous". Chaining the fold off that None let surface 6 pick, by a weaker
    relationship, a company surface 5 had already declined to choose between:
    'Southern Co.' -> 'Southern Tooling, Inc.', 'DOMINOS PIZZA INC' ->
    "Domino's Pizza China", "Domino's Pizza Group" -> "Domino's Pizza China",
    'Aecon' -> 'Aecon Utilities'.

    `guard_step_five_refusals=False` reproduces the pre-guard behavior, so the
    cost of the guard can be measured on the same read rather than argued.
    """
    canonical = resolve_existing(idx, name)
    if canonical:
        return canonical
    if guard_step_five_refusals and idx["by_norm"].get(normalize_company_key(name)):
        return None
    return _unique(idx, token_fold_candidates(
        idx["by_name_tokens"], idx["by_token_prefix"], name))


# ---------------------------------------------------------------------------
# The loss population
# ---------------------------------------------------------------------------
def gate_verdict_is_drop(name, cache_row, indexed_names):
    """Replay backend.wikidata._resolve_keep against the CACHED verdict.

    Returns True when the gate drops the name. A name with no cache row is not
    counted at all: we cannot prove the gate ever ran on it.
    """
    if cache_row is None:
        return False
    is_co = cache_row.get("is_company")
    if is_co is True:
        return False
    if is_co is False:
        return True
    wikidata._INDEXED_NAMES_CACHE = indexed_names
    return not wikidata._name_is_indexed_company(name, None)


def load(args):
    if args.cache and os.path.exists(args.cache):
        print(f"loading cached scan from {args.cache}...", flush=True)
        with open(args.cache) as fh:
            blob = json.load(fh)
        return blob["companies"], blob["aliases"], blob["wdc"], blob["articles"]

    print("loading companies / aliases / wikidata cache...", flush=True)
    companies = _page_all("companies", "id, name, ticker, sec_cik, mention_count")
    aliases = _page_all("aliases", "lookup_key, canonical_id", order_col="lookup_key")
    wdc = _page_all("wikidata_entity_cache", "name, is_company", order_col="name")
    print(f"  companies={len(companies)} aliases={len(aliases)} wikidata_cache={len(wdc)}")

    print("scanning articles (full table, keyset)...", flush=True)
    articles, cursor, seen = [], None, 0
    while True:
        q = (sb.table("articles").select("id, ingested_at, primary_company, companies")
             .order("id").limit(PAGE))
        if cursor is not None:
            q = q.gt("id", cursor)
        batch = q.execute().data or []
        articles.extend(batch)
        seen += len(batch)
        if seen % 40000 < PAGE:
            print(f"  {seen} rows...", flush=True)
        if len(batch) < PAGE:
            break
        cursor = batch[-1]["id"]
    print(f"  {len(articles)} article rows")

    if args.cache:
        with open(args.cache, "w") as fh:
            json.dump({"companies": companies, "aliases": aliases,
                       "wdc": wdc, "articles": articles}, fh)
        print(f"  cached to {args.cache}")
    return companies, aliases, wdc, articles


def gate_loss(articles, wdc, companies, lo, hi):
    """name -> article count, for articles the gate cost us inside [lo, hi)."""
    cache = {r["name"]: r for r in wdc}
    indexed = {wikidata._normalize_company_name(c.get("name")) for c in companies}
    indexed.discard("")
    loss = defaultdict(int)
    for a in articles:
        ts = a.get("ingested_at") or ""
        if not (lo <= ts[:10] < hi):
            continue
        primary = (a.get("primary_company") or "").strip()
        if not primary:
            continue
        if primary in (a.get("companies") or []):
            continue
        if gate_verdict_is_drop(primary, cache.get(primary), indexed):
            loss[primary] += 1
    return loss


def report(idx, loss, label, guard=True):
    total = sum(loss.values())
    existing = {n: resolve_existing(idx, n) for n in loss}
    added, unguarded_added = {}, {}
    for n in loss:
        if existing[n]:
            continue
        w = resolve_widened(idx, n, guard_step_five_refusals=guard)
        if w:
            added[n] = w
        u = resolve_widened(idx, n, guard_step_five_refusals=False)
        if u:
            unguarded_added[n] = u
    n_existing = sum(loss[n] for n, c in existing.items() if c)
    n_added = sum(loss[n] for n in added)
    n_unguarded = sum(loss[n] for n in unguarded_added)
    print(f"\n=== {label} ===")
    print(f"gate loss                  : {total} articles over {len(loss)} names")
    print(f"recovered, surfaces 1-5    : {n_existing} "
          f"({n_existing / total * 100:.1f}% of loss) over "
          f"{sum(1 for c in existing.values() if c)} names")
    print(f"recovered, +token fold     : {n_added} "
          f"({n_added / total * 100:.1f}% of loss) over {len(added)} names")
    print(f"ZERO-WRITE RECOVERY TOTAL  : {n_existing + n_added} "
          f"({(n_existing + n_added) / total * 100:.1f}% of loss)")
    print(f"still unrecoverable        : {total - n_existing - n_added} "
          f"({(total - n_existing - n_added) / total * 100:.1f}% of loss)")
    if guard:
        dropped = {n: unguarded_added[n] for n in unguarded_added if n not in added}
        print(f"COST OF THE AMBIGUITY GUARD: {n_unguarded - n_added} articles "
              f"({(n_unguarded - n_added) / total * 100:.1f}% of loss) over "
              f"{len(dropped)} names no longer folded")
        print(f"  unguarded would have been: {n_existing + n_unguarded} "
              f"({(n_existing + n_unguarded) / total * 100:.1f}% of loss)")
        for n, c in sorted(dropped.items(), key=lambda kv: -loss[kv[0]])[:15]:
            print(f"    {loss[n]:>4}  {n[:44]:<44} would have folded to -> {c[:36]}")
    return added


def audit(idx, loss, added, min_articles, tail_sample=0, seed=20260820):
    """Print the folds this change newly produces, for hand adjudication.

    Two samples, because they answer different questions.

    HEAD  every pair at or above `min_articles`. This carries most of the
          recovered volume, so it is the article-weighted picture. It is also
          the sample the stem denylist was derived from, which biases it
          OPTIMISTIC. Read it as a lower bound on the error rate.

    TAIL  a seeded random draw from the pairs BELOW `min_articles`. Nothing in
          the guard set was derived from a specific pair here, so this is the
          unbiased estimate.
    """
    print(f"\n=== AUDIT SAMPLE: every new fold with >= {min_articles} articles ===")
    name_to_id = {}
    for cid, nm in idx["name_by_id"].items():
        name_to_id.setdefault(nm, cid)
    rows = sorted(((loss[n], n, c) for n, c in added.items()), reverse=True)
    sample = [r for r in rows if r[0] >= min_articles]
    print(f"{len(sample)} of {len(rows)} pairs, {sum(r[0] for r in sample)} of "
          f"{sum(r[0] for r in rows)} articles "
          f"({sum(r[0] for r in sample) / max(1, sum(r[0] for r in rows)) * 100:.0f}% "
          f"of the added volume)")
    for n_art, name, canonical in sample:
        ticker, cik, mentions = idx["meta_by_id"].get(name_to_id.get(canonical), (None, None, None))
        print(f"{n_art:>4}  {name[:44]:<44} -> {canonical[:32]:<32} "
              f"[{ticker}] cik={cik} mentions={mentions}")

    if not tail_sample:
        return
    tail = [r for r in rows if r[0] < min_articles]
    rng = random.Random(seed)
    draw = sorted(rng.sample(tail, min(tail_sample, len(tail))), reverse=True)
    print(f"\n=== TAIL SAMPLE: {len(draw)} of {len(tail)} pairs below "
          f"{min_articles} articles, seed={seed} ===")
    print(f"{sum(r[0] for r in draw)} articles")
    for n_art, name, canonical in draw:
        ticker, cik, mentions = idx["meta_by_id"].get(name_to_id.get(canonical), (None, None, None))
        print(f"{n_art:>4}  {name[:44]:<44} -> {canonical[:32]:<32} "
              f"[{ticker}] cik={cik} mentions={mentions}")


def _ticker_agrees_with_name(ticker: str, name: str) -> bool:
    """Do the ticker's letters appear IN ORDER inside the name?

    ADBE in "Adobe", TSLA in "Tesla", MRK in "Merck", KO in "Coca-Cola". This is
    the cheap local test for "this row's name and this row's ticker describe the
    same company", and it needs no network and no name oracle.

    It is a SCREEN, not a verdict. It has known false alarms (AAPL against
    "Apple" needs two a's, MMM against "3M" needs three m's, TFC against
    "Truist" shares nothing), which is exactly why the output is a review list
    that a human confirms row by row, never an automatic rename.
    """
    key = "".join(ch for ch in (name or "").lower() if ch.isalnum())
    i = 0
    for ch in (ticker or "").lower():
        if not ch.isalnum():
            continue
        i = key.find(ch, i)
        if i < 0:
            return False
        i += 1
    return True


def repair_candidates(idx, loss, max_name_chars, max_mentions):
    """The INDEX REPAIR half: rows that carry a CORRECT IDENTITY under a
    CORRUPTED NAME.

    Shape of the defect, measured live:

        indexed 'Ola'   [KO,  cik 21344]     is Coca-Cola      (coca-cOLA)
        indexed 'LIC'   [RSG, cik 1060391]   is Republic Services (repubLIC)
        indexed 'Excel' [HXL, cik 717605]    is Hexcel         (hEXCEL)
        indexed 'Hark'  [SN,  cik 1957132]   is SharkNinja     (sHARKninja)

    No normalization can bridge that. 'ola' is not a prefix, a suffix or a token
    of 'coca cola'; it is an interior fragment. Substring matching is far too
    loose to put in a resolver (it pairs "Howmet Aerospace" with the row named
    'Meta'), so the fix is not a matching rule at all. It is a NAME REPAIR on
    the index, reviewed row by row and delivered as a migration FILE.

    Screen: short name, low mention_count, has a ticker, and the ticker's letters
    do not appear in order inside the name.
    """
    print(f"\n=== INDEX REPAIR CANDIDATES ===")
    print(f"screen: has ticker, name <= {max_name_chars} chars, "
          f"mention_count <= {max_mentions}, ticker letters not in name order")
    rows = []
    for cid, name in idx["name_by_id"].items():
        ticker, cik, mentions = idx["meta_by_id"].get(cid, (None, None, None))
        if not ticker or len(name) > max_name_chars:
            continue
        if (mentions or 0) > max_mentions:
            continue
        if _ticker_agrees_with_name(ticker, name):
            continue
        rows.append((mentions or 0, name, ticker, cik))
    rows.sort()
    print(f"{len(rows)} suspect rows of {len(idx['name_by_id'])} companies")
    for mentions, name, ticker, cik in rows:
        print(f"  {name!r:<24} [{ticker}] cik={cik} mentions={mentions}")
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default="", help="path to cache the read (JSON)")
    ap.add_argument("--audit", action="store_true", help="dump the new folds for adjudication")
    ap.add_argument("--audit-min", type=int, default=5)
    ap.add_argument("--audit-tail", type=int, default=0,
                    help="also draw N random pairs from below --audit-min")
    ap.add_argument("--seed", type=int, default=20260820)
    ap.add_argument("--repair", action="store_true",
                    help="list the index rows whose NAME is corrupted but whose "
                         "ticker/cik identity is correct")
    ap.add_argument("--repair-max-name", type=int, default=8)
    ap.add_argument("--repair-max-mentions", type=int, default=8)
    ap.add_argument("--split", action="store_true",
                    help="dev/test split, so the guard denylist is not scored on "
                         "the slice it was derived from")
    ap.add_argument("--start", default=WINDOW_START)
    ap.add_argument("--end", default=WINDOW_END)
    ap.add_argument("--split-at", default="2026-08-05")
    args = ap.parse_args()

    companies, aliases, wdc, articles = load(args)
    idx = build_index(companies, aliases)
    print(f"index: {len(idx['name_by_id'])} companies, {len(idx['by_alias'])} alias keys, "
          f"{len(idx['by_name_tokens'])} name-token tuples, "
          f"{len(idx['by_token_prefix'])} token prefixes")

    if args.split:
        dev = gate_loss(articles, wdc, companies, args.start, args.split_at)
        test = gate_loss(articles, wdc, companies, args.split_at, args.end)
        dev_added = report(idx, dev, f"DEV  [{args.start}, {args.split_at}) - guards were tuned here")
        test_added = report(idx, test, f"TEST [{args.split_at}, {args.end}) - held out")
        unseen = {n: c for n, c in test_added.items() if n not in dev_added}
        n_unseen = sum(test[n] for n in unseen)
        print(f"\nHELD-OUT pairs never seen in DEV: {len(unseen)} pairs, {n_unseen} articles")
        if args.audit:
            audit(idx, test, unseen, args.audit_min, args.audit_tail, args.seed)
        return

    loss = gate_loss(articles, wdc, companies, args.start, args.end)
    added = report(idx, loss, f"WINDOW [{args.start}, {args.end}) on ingested_at")
    if args.audit:
        audit(idx, loss, added, args.audit_min, args.audit_tail, args.seed)
    if args.repair:
        repair_candidates(idx, loss, args.repair_max_name, args.repair_max_mentions)


if __name__ == "__main__":
    main()
