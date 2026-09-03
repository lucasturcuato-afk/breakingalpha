#!/usr/bin/env python3
"""Repair articles.companies[] entries authored by the BARE-TICKER fold.

WHY THIS EXISTS, AND WHY IT IS NOT tools/repair_articles_companies.py.

backend/ingest.py `_resolve_primary_to_canonical` resolves primary_company
through six surfaces. Surface 4 is `companies.ticker`: a primary_company that
is a bare exchange symbol ("RVMD") is folded onto whatever single company row
happens to hold that symbol, and `_fold_primary_into_companies` APPENDS that
row's canonical name to articles.companies[].

When a company row held a WRONG ticker, every article carrying that symbol as
primary_company got that row's name stamped into its companies[]. Clearing the
wrong ticker later fixed the fold going forward and did nothing to the tags
already written. They are a frozen artifact of the old stamp.

The live effect, measured 2026-09-02: `Revolut` (ticker NULL, sec_cik NULL)
carries 71 tagged articles, 55 of which have primary_company 'RVMD'. Their
titles read "RVMD Maintained by Oppenheimer" and "Oral Investigational Medicine
for Pancreatic Cancer Is Accepted for FDA Review". Revolut's company page
renders Revolution Medicines' news. That is the defect.

WHY #802's MACHINERY DOES NOT FIT. tools/repair_articles_companies.py is driven
by public.norm_v2_merge_map(), which returns loser_name -> survivor_name for
clusters the norm_v2 merge actually collapsed. Its planner says so in terms
that leave no room:

    SCOPE, AND IT IS ABSOLUTE. The ONLY names this touches are keys of `m`, the
    merge map. A name absent from `m` is never swapped, never removed, never
    read for anything but equality.

'Revolut' is not a merge loser. It is a live, present, correct companies row
that a fold pointed at the wrong articles. There is no (loser, survivor) pair
to express this with, and norm_v2_merge_map() cannot produce one. The APPLY
path is reused (see below); the MAP is a different question and needs a
different answer.

#802 HAS ALREADY RUN ON PROD and the two populations are provably disjoint.
public.articles_companies_repair holds 14,182 rows over three runs
(14e411f7 14,034, b502b663 126, 82b9f14d 22), 14,117 swap and 65 remove.
Intersected against the 43 names this tool repairs: ZERO, in loser_name and in
survivor_name alike. Nothing here re-does or undoes anything #802 did.

One guarantee of #802's that this tool CANNOT inherit: its `remove` branch
fires only when the survivor is already in the array, so it can never strand an
article with an empty companies[]. This repair has no survivor for 42 of its 43
tickers, so it strands by construction. That is answered on its own terms in
the REMOVE ONLY note below, not by copying #802's shape.

WHAT DRIVES THIS INSTEAD. public.articles_companies_backfill, the ledger
tools/backfill_primary_fold.py wrote on 2026-08-17, records every fold it
performed as (primary_company, resolved_name). Rows whose primary_company
matches the bare-ticker shape are ATTESTED ticker folds: recorded evidence,
not inference. 30,707 ledger rows yield 8,743 ticker folds over 725 distinct
(ticker, name) pairs.

Most of those 725 are CORRECT and must survive untouched. Three filters
separate the wrong ones, and every one of them is a refusal:

  row-still-holds-ticker   The named row still carries that ticker, so the fold
                           was right and still is. 606 pairs, including
                           HPQ -> 'HP Inc'.
  name-surface-reaches-it  Surfaces 1,2,3,5,6 recomputed against today's data
                           reach the same name WITHOUT the ticker surface, so
                           the fold was NAME-driven, not ticker-driven. 60
                           pairs, including HP -> 'HP Inc', which resolves
                           through the ALIAS surface (an aliases row with
                           lookup_key 'hp'). Note it is NOT the normalize
                           surface: three rows share the key 'hp' ('HP Inc',
                           'HP Inc.', 'HP, Inc.'), so surface 5 refuses on
                           ambiguity and only surface 3 answers. A guard
                           written against normalize alone would read that
                           refusal as "no name surface reaches it" and mark the
                           pair contaminated. THIS IS THE OVER-REACH GUARD.
                           Without it the repair strips a correct 187-article
                           pool off a real company page.
  name-not-in-companies    The name is not a companies row at all. That is the
                           25,554-article extractor-orphan population sql/0035
                           section 4b describes. Different defect, no fix here.

What survives all three is a fold that could ONLY have come from surface 4 with
a ticker that is now gone: 43 pairs, 429 ledger rows.

WHY THE PAIR SET IS APPLIED BEYOND THE LEDGER. The fold is deterministic in the
company table, not in the article. If 'RVMD' resolved to 'Revolut' during the
backfill, it resolved to 'Revolut' for every live ingest in the same window.
The ledger only covers rows the BACKFILL rewrote; articles ingested afterwards
carry the identical stamp with no ledger row. So the pair set is derived from
the ledger and then applied to every article whose primary_company equals that
ticker. Measured: 465 articles, 429 ledger-attested and 36 live-ingest.

REMOVE ONLY, DELIBERATELY, AND IT STRANDS 456 OF 465 ROWS. Removing the stale
name usually empties companies[], because on 456 of these articles the wrongly
folded name is the ONLY element. That is faced rather than hidden:

  - It is opportunity cost, not breakage. 49,660 articles, 24.8% of the corpus,
    already sit at companies = '{}' before this runs (counted directly over a
    199,960-row snapshot of the table, since count(*) on articles times out).
    An article with no company tag is an ordinary, already-handled state.
  - Repointing is arithmetically unavailable for almost all of it. 42 of the 43
    tickers resolve to NO companies row at all today, so there is nothing to
    move those articles to. Exactly one pair has a live target: BAX ->
    'AXT Inc.', where BAX resolves to 'BAXTER INTERNATIONAL', 15 articles.
  - That one pair is REPORTED on every dry run and NOT applied. Removing a
    false tag asserts nothing; adding a true one is still an assertion, and the
    two deserve separate review. See sql/0036 section 5a.

So the trade is: 465 false associations removed, 0 true associations removed,
15 true associations left on the table for a human to rule on.

REUSES public.apply_companies_backfill(jsonb) rather than adding a third apply
path. That function sets companies = after where companies = before and does
not care what motivated the change. It already carries the drift guard, the
180s statement_timeout added after the 2026-08-17 live failure, and the grants.

SHAPE, same as the two tools before it:
  - keyset scan on articles.id, never OFFSET
  - the pair set is rebuilt from the DATABASE on every run, never from a cache,
    so a stale map cannot drive a write
  - a ledger row per (article, name) written BEFORE the array changes
  - a drift guard: a row whose companies[] no longer equals the planned
    `before` is skipped, not overwritten
  - a failing chunk halves and retries down to single rows

USAGE
    python tools/repair_ticker_fold_tags.py                  # dry run, default
    python tools/repair_ticker_fold_tags.py --json plan.json
    python tools/repair_ticker_fold_tags.py --apply --batch 200
    python tools/repair_ticker_fold_tags.py --apply --resume

Reads articles, companies, aliases and the backfill ledger. Writes
articles.companies and the ticker-fold repair ledger, and ONLY under --apply.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import uuid
from collections import Counter, defaultdict

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, os.path.join(_ROOT, "backend"))

from company_match import (  # noqa: E402
    company_key_tokens,
    guarded_fold_candidates,
    index_tokens,
    looks_like_ticker,
    normalize_company_key,
    normalize_lookup_key,
    token_fold_candidates,
)

LEDGER = "articles_ticker_fold_repair"
BACKFILL_LEDGER = "articles_companies_backfill"
APPLY_RPC = "apply_companies_backfill"
PAGE = 1000

#: The shape test for a bare exchange symbol. Kept identical to
#: company_match._TICKER_RE by construction: looks_like_ticker IS that regex,
#: and test_repair_ticker_fold_tags asserts the two agree on a corpus so this
#: comment cannot quietly become false.
TICKER_SHAPE = looks_like_ticker

#: Why a pair was spared. Every value is a REFUSAL to touch something.
KEEP_ROW_HOLDS_TICKER = "row-still-holds-ticker"
KEEP_NAME_SURFACE = "name-surface-reaches-it"
KEEP_NOT_A_COMPANY = "name-not-in-companies"


# ---------------------------------------------------------------------------
# Client. Built lazily so the pure planning functions can be imported and
# tested with no credentials and no network, which is the whole test surface.
# ---------------------------------------------------------------------------
def _client():
    from dotenv import load_dotenv
    from supabase import create_client

    load_dotenv(os.path.join(_ROOT, "backend", ".env"))
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.")
    return create_client(url, key)


# ---------------------------------------------------------------------------
# Paged reads.
#
# PostgREST caps EVERY response at db-max-rows (1000 here) and does NOT error
# when it truncates. That silence has produced a wrong result in this codebase
# four times. Both helpers below are immune, by different means, and neither
# uses count=exact on `articles`: that specific query times out with SQLSTATE
# 57014 and must never be attempted.
# ---------------------------------------------------------------------------
def _fetch_all_table(sb, table: str, cols: str, order_col: str = "id") -> list:
    """Every row of a table, with a server-side count assertion.

    Safe on companies, aliases and the ledgers. NOT used on articles.
    """
    try:
        head = sb.table(table).select(cols, count="exact").limit(1).execute()
    except Exception as ex:
        sys.exit(f"could not read {table}: {ex}")
    expected = head.count
    if expected is None:
        sys.exit(f"{table} returned no exact count; refusing to read it unverified.")
    rows, page = [], 0
    while len(rows) < expected:
        r = (sb.table(table).select(cols).order(order_col)
             .range(page * PAGE, page * PAGE + PAGE - 1).execute())
        if not r.data:
            break
        rows += r.data
        page += 1
    if len(rows) != expected:
        sys.exit(f"TRUNCATED READ: {table} reports {expected} rows, fetched "
                 f"{len(rows)}. Refusing to continue on a partial result.")
    return rows


def scan_ticker_articles(sb, limit: int = 0) -> list:
    """Keyset scan of articles whose primary_company is a bare ticker.

    EXEMPT from the count assertion the other reads carry, and deliberately:
    the exact count that assertion needs is the very query that times out on
    this table. Keyset is safe for a different reason. Each page asks for PAGE
    rows and continues from the last id seen, so a capped response is
    indistinguishable from a full one and the walk simply continues.
    Truncation cannot silently end it.

    The regex is applied SERVER SIDE so this reads ~18.7k rows instead of the
    whole ~198k table. It is the same shape company_match._TICKER_RE tests, and
    every row is re-checked in Python by looks_like_ticker before it is planned,
    so a server/client regex disagreement can only ever read too much, never
    plan too much.

    A PAGE THAT TIMES OUT IS HALVED, NOT ABANDONED. There is no index on
    primary_company that a regex can use, so each page is a filtered scan whose
    cost varies with how far apart the matching ids fall. Observed live on
    2026-09-02: a 1000-row page died on 57014 mid-walk while the identical query
    at the same offset succeeded on retry. Retrying the SAME page is a coin
    flip; asking for fewer rows is not, because the work per page falls with it.
    A page that fails at size 1 is a genuine error and is raised, because
    silently skipping it would drop articles from the plan and report success.
    """
    rows, last, t0, pages = [], None, time.time(), 0
    while True:
        size, data = PAGE, None
        while True:
            q = (sb.table("articles").select("id,primary_company,companies")
                 .filter("primary_company", "match", r"^[A-Z]{1,5}(\.[A-Z])?$")
                 .order("id").limit(size))
            if last:
                q = q.gt("id", last)
            try:
                data = q.execute().data
                break
            except Exception as ex:
                if size == 1:
                    raise
                size = max(1, size // 2)
                print(f"    scan page failed, retrying at limit {size}: {str(ex)[:90]}")
        if not data:
            break
        rows += data
        last = data[-1]["id"]
        pages += 1
        if pages % 10 == 0:
            print(f"  scan: {len(rows)} rows, {time.time() - t0:.0f}s")
        if limit and len(rows) >= limit:
            rows = rows[:limit]
            break
        # Short page ends the walk ONLY at full size. A short page produced by a
        # halved retry means the timeout shrank the request, not that the table
        # is exhausted, and stopping there would silently truncate the plan.
        if len(data) < size and size == PAGE:
            break
    el = time.time() - t0
    print(f"  scan: {len(rows)} bare-ticker articles in {el:.1f}s")
    return rows


# ---------------------------------------------------------------------------
# The resolution index, mirroring ingest._load_entity_snapshot.
#
# Built TWICE: once with the ticker surface and once without. The difference
# between the two answers is the entire discriminator this tool rests on.
# ---------------------------------------------------------------------------
def build_index(companies: list, aliases: list, with_ticker: bool = True) -> dict:
    idx = {"name_by_id": {}, "by_alias": defaultdict(set), "by_ticker": defaultdict(set),
           "by_norm": defaultdict(set), "exact_names": set(), "lower_names": {},
           "by_name_tokens": {}, "by_token_prefix": {}}
    for r in companies:
        cid, name = r.get("id"), (r.get("name") or "").strip()
        if not cid or not name:
            continue
        idx["name_by_id"][cid] = name
        idx["exact_names"].add(name)
        idx["lower_names"].setdefault(name.lower(), name)
        idx["by_norm"][normalize_company_key(name)].add(cid)
        index_tokens(idx["by_name_tokens"], idx["by_token_prefix"],
                     company_key_tokens(name), cid, from_name=True)
        t = (r.get("ticker") or "").strip().upper()
        if t and with_ticker:
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


def _unique(idx: dict, ids) -> str | None:
    """The canonical name when `ids` names exactly one company, else None.

    The ambiguity guard, copied in behavior from ingest._unique_company_name:
    two companies behind one key means we cannot say which one, and a wrong
    fold is worse than a miss.
    """
    if not ids or len(ids) != 1:
        return None
    return idx["name_by_id"].get(next(iter(ids)))


def resolve(idx: dict, name: str, use_ticker: bool = True) -> str | None:
    """Mirrors ingest._resolve_primary_to_canonical surfaces 1 to 6.

    use_ticker=False omits surface 4, which is how this tool asks the question
    "would the NAME surfaces alone have produced this fold?". A yes means the
    fold was never ticker-driven and must not be touched.

    Surfaces 1 and 2 read the index rather than issuing live queries. ingest
    keeps them live so a company minted earlier in the same run is visible;
    this tool has no such run, and the index IS the current table.
    """
    if name in idx["exact_names"]:
        return name
    c = idx["lower_names"].get(name.lower())
    if c:
        return c
    c = _unique(idx, idx["by_alias"].get(normalize_lookup_key(name)))
    if c:
        return c
    if use_ticker and looks_like_ticker(name):
        c = _unique(idx, idx["by_ticker"].get(name.strip().upper()))
        if c:
            return c
    norm_ids = idx["by_norm"].get(normalize_company_key(name))
    c = _unique(idx, norm_ids)
    if c:
        return c
    # Surface 6 may CONFIRM a surface 5 refusal but never OVERRULE it. See the
    # long note in ingest._resolve_primary_to_canonical for the four false
    # folds that motivated guarded_fold_candidates.
    return _unique(idx, guarded_fold_candidates(norm_ids, token_fold_candidates(
        idx["by_name_tokens"], idx["by_token_prefix"], name)))


# ---------------------------------------------------------------------------
# Pair derivation
# ---------------------------------------------------------------------------
def attested_ticker_folds(backfill_rows: list) -> Counter:
    """(bare ticker, resolved name) -> how many ledger rows attest it.

    RECORDED EVIDENCE, not inference. Every row here is one the backfill tool
    wrote and logged. A pair absent from this Counter is never considered, so
    the tool cannot invent a fold that never happened.
    """
    out = Counter()
    for r in backfill_rows:
        p = (r.get("primary_company") or "").strip()
        n = r.get("resolved_name")
        if p and n and looks_like_ticker(p):
            out[(p, n)] += 1
    return out


def classify_pairs(attested: Counter, ticker_of_name: dict, idx_name_only: dict):
    """Split attested ticker folds into (contaminated, kept).

    A pair is CONTAMINATED only when all three refusals decline to fire, which
    leaves exactly one explanation for it: surface 4 matched a ticker that the
    named row no longer holds. Returns (dict pair -> count, dict pair -> (count,
    [reasons])).

    THIS IS THE OVER-REACH BOUNDARY AND IT IS DELIBERATELY CONSERVATIVE. Every
    branch below can only SPARE a pair. There is no branch that adds one, and
    no argument to this function or flag on this tool widens `attested`.
    """
    contaminated, kept = {}, {}
    for (p, n), k in attested.items():
        reasons = []
        if n not in ticker_of_name:
            reasons.append(KEEP_NOT_A_COMPANY)
        elif ticker_of_name[n] == p:
            reasons.append(KEEP_ROW_HOLDS_TICKER)
        if resolve(idx_name_only, p, use_ticker=False) == n:
            reasons.append(KEEP_NAME_SURFACE)
        if reasons:
            kept[(p, n)] = (k, reasons)
        else:
            contaminated[(p, n)] = k
    return contaminated, kept


def plan(articles: list, contaminated: dict, done: set | None = None) -> list:
    """One change per article: drop every contaminated name it carries.

    SCOPE, AND IT IS ABSOLUTE. A name is removed only when the pair (this
    article's primary_company, that name) is a key of `contaminated`. The
    article's primary_company must match EXACTLY. A name that appears in
    companies[] for any other reason, on any other article, is never read for
    anything but equality. That is what keeps 'ARK Invest' on the COIN, PYPL,
    OKLO and TSMC articles where the extractor legitimately put it, while
    still removing it from the two PNNT articles where the ticker fold did.

    Order is preserved and nothing is sorted, deduplicated or appended. An
    article that needs no change is never rewritten.
    """
    changes = []
    for a in articles:
        p = (a.get("primary_company") or "").strip()
        if not p or not looks_like_ticker(p):
            continue
        cur = a.get("companies") or []
        hits = [n for n in cur if (p, n) in contaminated]
        if not hits:
            continue
        if done:
            hits = [n for n in hits if (a["id"], n) not in done]
            if not hits:
                continue
        after = [x for x in cur if x not in hits]
        if after == cur:
            continue
        changes.append({"id": a["id"], "primary": p, "before": cur,
                        "after": after, "losers": hits})
    return changes


# ---------------------------------------------------------------------------
# Apply
# ---------------------------------------------------------------------------
def _rpc_apply(sb, chunk: list) -> dict:
    payload = [{"id": c["id"], "before": c["before"], "after": c["after"]} for c in chunk]
    res = sb.rpc(APPLY_RPC, {"p_rows": payload}).execute()
    return res.data if isinstance(res.data, dict) else json.loads(res.data)


def _apply_with_split(sb, chunk: list, depth: int = 0):
    """Halve a failing chunk and retry, down to a single row.

    The failure this exists for is 57014, a statement timeout, and it is a
    SPIKE rather than a function of size: the cost of flushing the GIN pending
    list on idx_articles_companies lands on whichever statement fills it. The
    right answer to a failing batch is a smaller statement, not a retry of the
    same one. Returns (applied, drifted, failed_ids).
    """
    if not chunk:
        return 0, 0, []
    try:
        out = _rpc_apply(sb, chunk)
        return int(out.get("applied", 0)), int(out.get("skipped_drift", 0)), []
    except Exception as ex:
        if len(chunk) == 1:
            print(f"    ! row {chunk[0]['id']} failed: {str(ex)[:140]}")
            return 0, 0, [chunk[0]["id"]]
        mid = len(chunk) // 2
        print(f"    split {len(chunk)} -> {mid}+{len(chunk) - mid} at depth "
              f"{depth}: {str(ex)[:90]}")
        a_ok, a_dr, a_bad = _apply_with_split(sb, chunk[:mid], depth + 1)
        b_ok, b_dr, b_bad = _apply_with_split(sb, chunk[mid:], depth + 1)
        return a_ok + b_ok, a_dr + b_dr, a_bad + b_bad


def apply_changes(sb, changes: list, run_id: str, batch: int):
    """Ledger FIRST, then the array.

    If the process dies between the two, the ledger holds a row describing a
    change that did not happen. That is recoverable: the reversal is guarded on
    companies = companies_after, so a row that was never applied is skipped.
    The other order loses the before-image of a row that WAS changed, which is
    not recoverable.
    """
    applied = drifted = failed = 0
    t0 = time.time()
    for i in range(0, len(changes), batch):
        chunk = changes[i:i + batch]
        ledger = []
        for c in chunk:
            for n in c["losers"]:
                ledger.append({
                    "run_id": run_id, "article_id": c["id"],
                    "ticker": c["primary"], "loser_name": n,
                    "companies_before": c["before"], "companies_after": c["after"],
                })
        try:
            sb.table(LEDGER).upsert(
                ledger, on_conflict="run_id,article_id,loser_name",
                ignore_duplicates=True,
            ).execute()
        except Exception as ex:
            sys.exit(f"ledger write failed at chunk {i // batch}: {ex}\n"
                     "Stopping BEFORE touching articles. Nothing in this chunk changed.")
        ok, dr, bad = _apply_with_split(sb, chunk)
        applied += ok
        drifted += dr
        failed += len(bad)
        el = time.time() - t0
        rate = applied / max(el, .001)
        print(f"  batch {i // batch + 1}/{(len(changes) + batch - 1) // batch}: "
              f"applied {applied}, drift {drifted}, failed {failed}, {rate:.0f}/s")
    return applied, drifted, failed


def already_done(sb) -> set:
    """(article_id, loser_name) pairs already in the ledger, for --resume."""
    rows = _fetch_all_table(sb, LEDGER, "article_id,loser_name")
    return {(x["article_id"], x["loser_name"]) for x in rows}


# ---------------------------------------------------------------------------
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--apply", action="store_true", help="WRITE. Default is a dry run.")
    ap.add_argument("--batch", type=int, default=200)
    ap.add_argument("--limit", type=int, default=0, help="stop after N articles (smoke)")
    ap.add_argument("--resume", action="store_true",
                    help="skip (article, name) pairs already in the ledger")
    ap.add_argument("--json", metavar="PATH", help="write the plan as JSON")
    args = ap.parse_args(argv)

    sb = _client()

    print("loading companies and aliases...")
    companies = _fetch_all_table(sb, "companies", "id,name,ticker")
    aliases = _fetch_all_table(sb, "aliases", "id,lookup_key,canonical_id")
    print(f"  {len(companies)} companies, {len(aliases)} aliases")

    ticker_of_name = {}
    for r in companies:
        n = (r.get("name") or "").strip()
        if n:
            ticker_of_name.setdefault(n, (r.get("ticker") or "").strip().upper() or None)

    idx_full = build_index(companies, aliases, with_ticker=True)
    idx_name = build_index(companies, aliases, with_ticker=False)

    print(f"reading {BACKFILL_LEDGER}...")
    backfill = _fetch_all_table(sb, BACKFILL_LEDGER,
                                "id,article_id,primary_company,resolved_name")
    attested = attested_ticker_folds(backfill)
    print(f"  {len(backfill)} ledger rows, {sum(attested.values())} bare-ticker folds, "
          f"{len(attested)} distinct (ticker, name) pairs")

    contaminated, kept = classify_pairs(attested, ticker_of_name, idx_name)
    if not contaminated:
        print("\nNo contaminated pairs. Either the repair has already run or every "
              "attested ticker fold is still correct. Nothing to do.")
        return 0

    reasons = Counter(r for v in kept.values() for r in v[1])
    print(f"\nPAIR CLASSIFICATION")
    print(f"  KEPT         : {len(kept)} pairs / {sum(v[0] for v in kept.values())} ledger rows")
    for r, c in reasons.most_common():
        print(f"      {r:<24} {c} pairs")
    print(f"  CONTAMINATED : {len(contaminated)} pairs / {sum(contaminated.values())} ledger rows")

    print("scanning articles...")
    articles = scan_ticker_articles(sb, args.limit)

    done = already_done(sb) if args.resume else None
    if done is not None:
        print(f"  --resume: {len(done)} (article, name) pairs already in the ledger")

    changes = plan(articles, contaminated, done)
    per_pair = Counter()
    for c in changes:
        for n in c["losers"]:
            per_pair[(c["primary"], n)] += 1

    print(f"\nPLAN")
    print(f"  articles to rewrite : {len(changes)}")
    print(f"  ledger rows         : {sum(len(c['losers']) for c in changes)}")
    print(f"  pairs firing        : {len(per_pair)} of {len(contaminated)}")
    print(f"  left with empty []  : {sum(1 for c in changes if not c['after'])}")
    for (p, n), k in per_pair.most_common(20):
        print(f"      {p:<6} -> {n:<32} {k:4d} articles")

    swaps = {}
    for (p, n) in per_pair:
        t = resolve(idx_full, p, use_ticker=True)
        if t and t != n:
            swaps[(p, n)] = t
    if swaps:
        print(f"\n  SWAP TARGETS AVAILABLE BUT NOT APPLIED: {len(swaps)} pair(s). The "
              f"ticker\n  resolves to a live company today, so these articles could be "
              f"re-pointed\n  rather than only untagged. Reported, never written. See "
              f"sql/0036 section 5.")
        for (p, n), t in swaps.items():
            print(f"      {p:<6} {n!r} -> {t!r} ({per_pair[(p, n)]} articles)")

    if args.json:
        json.dump(changes, open(args.json, "w"))
        print(f"\nwrote {args.json}")

    if not args.apply:
        print("\nDRY RUN. Nothing written. Re-run with --apply to write.")
        return 0

    run_id = str(uuid.uuid4())
    print(f"\nAPPLYING. run_id = {run_id}")
    print(f"Reverse this run with sql/0036 section 4 using that uuid.\n")
    applied, drifted, failed = apply_changes(sb, changes, run_id, args.batch)
    print(f"\nDONE. applied {applied}, skipped-drift {drifted}, failed {failed}")
    print(f"run_id = {run_id}")
    if drifted:
        print("  drift means the pipeline changed those rows after the plan was "
              "built; re-run with --resume to re-plan them.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
