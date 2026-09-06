"""Run the EDGAR CIK reconciliation against prod. READ ONLY, never writes.

    python tools/edgar_cik_reconcile.py                 # human report, exit 0/1/2
    python tools/edgar_cik_reconcile.py --json out.json # machine report as well
    python tools/edgar_cik_reconcile.py --dump raw.json # save the raw reads
    python tools/edgar_cik_reconcile.py --replay raw.json  # classify a dump, no network

EXIT CODES. Copied deliberately from scripts/invariants.mjs, including its
warning:

    0  clean
    1  findings, see the report
    2  COULD NOT RUN. NEVER TREAT AS A PASS.

Two is the whole point of this file. The defect this check exists to catch
produced `status = success` and `errors = 0` while shards went unpolled for 28
days, because the run counted caught exceptions rather than asking whether the
data was right afterwards. A reconciliation that answered "zero orphans"
because its read returned an empty page would be the identical failure wearing
this check's badge. So every read is bounded by an assertion that would have to
hold for the answer to mean anything, and a violated assertion exits 2 rather
than reporting a clean universe.

READ STRATEGY, and why it is not the obvious one.

`financial_facts` is over a million rows. Three approaches were measured
against prod on 2026-09-06 before this one was written:

  * `Prefer: count=exact` on the table            -> HTTP 500, SQLSTATE 57014
  * an offset walk of the table                   -> HTTP 500
  * one probe with `cik=not.in.(<794 CIKs>)`      -> HTTP 500, SQLSTATE 57014
    (the anti-join defeats the index skip, so it plans a scan of the table)

What does work is a keyset skip-scan, one index probe per DISTINCT value:
ask for the smallest `cik` strictly greater than the last one seen, repeat
until empty. It rides `financial_facts_cik_metric_period_idx (cik, ...)`, so
each probe is an index seek regardless of how many rows sit under that CIK.
Measured: 799 distinct CIKs in 66s. It never uses OFFSET and never reads a
page whose length could be mistaken for a total.

`sec_filings` is small enough that the anti-join DOES complete there, so it is
run as well and its answer must agree with the skip-scan's. Two independent
reads of the same fact are the cheapest truncation canary available.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO not in sys.path:
    sys.path.insert(0, REPO)

from backend.edgar.cik_reconcile import (  # noqa: E402
    ReconcileInputError,
    classify,
    render,
)

EXPECTATIONS = os.path.join(REPO, "backend", "edgar", "cik_expectations.json")

EXIT_CLEAN, EXIT_FINDINGS, EXIT_COULD_NOT_RUN = 0, 1, 2

#: A non-advancing skip-scan would loop forever. The guard has to sit at a
#: number no legitimate universe reaches rather than near today's, so that
#: ordinary growth can never trip it. SEC has issued on the order of a million
#: CIKs in total and we poll a four-figure subset.
RUNAWAY_CIKS = 200_000


class CouldNotRun(RuntimeError):
    """Any condition under which a clean verdict would be meaningless."""


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

def _client():
    from dotenv import load_dotenv
    load_dotenv(os.path.join(REPO, "backend", ".env"))
    load_dotenv(os.path.join(REPO, ".env.local"))
    from supabase import create_client
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise CouldNotRun(
            "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. Exiting 2 "
            "rather than 0: a check with no credentials has not found nothing, "
            "it has looked at nothing."
        )
    return create_client(url, key)


def skip_scan_distinct(sb, table: str, col: str = "cik") -> list[int]:
    """Every distinct value of `col`, one index probe each. No OFFSET, ever."""
    out: list[int] = []
    last = None
    while True:
        q = sb.table(table).select(col).order(col).limit(1)
        if last is not None:
            q = q.gt(col, last)
        rows = q.execute().data or []
        if not rows:
            break
        last = rows[0][col]
        out.append(last)
        if len(out) > RUNAWAY_CIKS:
            raise CouldNotRun(
                f"{table}.{col} skip-scan passed {RUNAWAY_CIKS} distinct values. "
                f"That is not a universe, that is a non-advancing loop."
            )
    return out


def assert_scan_is_whole(sb, table: str, scanned: list[int], col: str = "cik") -> None:
    """The scan's endpoints must equal independently-read endpoints.

    This is the assertion that turns a silently truncated read into a red run.
    A skip-scan that stops early still returns a sorted, non-empty, entirely
    plausible list; the only thing wrong with it is the part that is missing,
    and nothing about the list itself says so. Reading the true min and max by
    a different query and demanding they match is what makes truncation loud.
    """
    if not scanned:
        raise CouldNotRun(f"{table}.{col} skip-scan returned nothing at all")
    lo = (sb.table(table).select(col).order(col).limit(1).execute().data or [])
    hi = (sb.table(table).select(col).order(col, desc=True).limit(1).execute().data or [])
    if not lo or not hi:
        raise CouldNotRun(f"{table}.{col} endpoint read came back empty")
    if lo[0][col] != scanned[0] or hi[0][col] != scanned[-1]:
        raise CouldNotRun(
            f"{table}.{col} skip-scan spans {scanned[0]}..{scanned[-1]} but the "
            f"table spans {lo[0][col]}..{hi[0][col]}. The scan is truncated; a "
            f"verdict built on it would understate the finding."
        )


def paginate(sb, table: str, cols: str, order_col: str = "id", page: int = 1000) -> list[dict]:
    """Keyset pagination on a unique column. A bare .execute() caps at 1000."""
    rows: list[dict] = []
    last = None
    while True:
        q = sb.table(table).select(cols).order(order_col).limit(page)
        if last is not None:
            q = q.gt(order_col, last)
        got = q.execute().data or []
        rows.extend(got)
        if len(got) < page:
            break
        last = got[-1][order_col]
    return rows


def exact_count(sb, table: str, cik: int) -> int:
    r = sb.table(table).select("cik", count="exact").eq("cik", cik).limit(1).execute()
    if r.count is None:
        raise CouldNotRun(f"count=exact on {table} for cik {cik} returned no count")
    return int(r.count)


def read_prod(sb, *, log=print) -> dict:
    t0 = time.time()

    companies = paginate(sb, "companies", "id,name,ticker,sec_cik")
    total = sb.table("companies").select("id", count="exact").limit(1).execute().count
    if total is None:
        raise CouldNotRun("count=exact on companies returned no count")
    if len(companies) != total:
        raise CouldNotRun(
            f"read {len(companies)} companies rows but count=exact says {total}. "
            f"The pagination is short; every 'unclaimed' verdict below it would "
            f"be an artefact of the rows we failed to read."
        )
    log(f"  companies: {len(companies)} rows, agrees with count=exact")

    fact_ciks = skip_scan_distinct(sb, "financial_facts")
    assert_scan_is_whole(sb, "financial_facts", fact_ciks)
    log(f"  financial_facts: {len(fact_ciks)} distinct CIKs ({time.time()-t0:.0f}s)")

    filing_ciks = skip_scan_distinct(sb, "sec_filings")
    assert_scan_is_whole(sb, "sec_filings", filing_ciks)
    log(f"  sec_filings: {len(filing_ciks)} distinct CIKs ({time.time()-t0:.0f}s)")

    claimed = sorted({int(c["sec_cik"]) for c in companies if c.get("sec_cik") is not None})

    # Independent second read of the same fact, by a different query plan.
    # sec_filings is small enough that the anti-join completes; financial_facts
    # is not, which is why only this one gets the corroboration.
    cross = _antijoin_unclaimed(sb, "sec_filings", claimed)
    expected = sorted(set(filing_ciks) - set(claimed))
    if cross is not None and cross != expected:
        raise CouldNotRun(
            "the sec_filings skip-scan and the sec_filings anti-join disagree "
            f"about which CIKs are unclaimed ({len(expected)} vs {len(cross)}). "
            "One of the two reads is truncated and there is no way to tell which."
        )
    log("  sec_filings anti-join corroborates the skip-scan")

    unclaimed = sorted((set(fact_ciks) | set(filing_ciks)) - set(claimed))
    reverse = [c for c in claimed if c not in set(fact_ciks)]

    fact_counts, filing_counts, pointers = {}, {}, {}
    for cik in unclaimed:
        fact_counts[cik] = exact_count(sb, "financial_facts", cik)
        filing_counts[cik] = exact_count(sb, "sec_filings", cik)
        rows = (
            sb.table("financial_facts").select("company_id")
            .eq("cik", cik).limit(1000).execute().data or []
        )
        pointers[cik] = sorted({r["company_id"] for r in rows if r.get("company_id")})
    for cik in reverse:
        filing_counts[cik] = exact_count(sb, "sec_filings", cik)
    log(f"  measured {len(unclaimed)} unclaimed and {len(reverse)} fact-less CIKs "
        f"({time.time()-t0:.0f}s)")

    registrants = {
        int(r["cik"]): r
        for r in paginate(sb, "cik_tickers", "cik,ticker,company_name", order_col="cik")
    }

    return {
        "fact_ciks": fact_ciks,
        "filing_ciks": filing_ciks,
        "fact_counts": fact_counts,
        "filing_counts": filing_counts,
        "companies": companies,
        "fact_pointers": pointers,
        "registrants": registrants,
        "read_seconds": round(time.time() - t0, 1),
    }


def _antijoin_unclaimed(sb, table: str, claimed: list[int]):
    """Skip-scan `table` for CIKs outside `claimed`, or None if the plan dies.

    Returning None on failure rather than raising is deliberate: this read is a
    corroboration, not a source. Losing it costs a cross-check, and a check
    that refuses to run at all because its optional second opinion timed out is
    a check that gets removed.
    """
    out: list[int] = []
    last = None
    try:
        while True:
            q = sb.table(table).select("cik").order("cik").limit(1).not_.in_("cik", claimed)
            if last is not None:
                q = q.gt("cik", last)
            rows = q.execute().data or []
            if not rows:
                break
            last = rows[0]["cik"]
            out.append(last)
            if len(out) > RUNAWAY_CIKS:
                return None
    except Exception:
        return None
    return out


# ---------------------------------------------------------------------------
# Shell
# ---------------------------------------------------------------------------

def load_expectations(path: str = EXPECTATIONS) -> dict:
    if not os.path.exists(path):
        raise CouldNotRun(
            f"{path} is missing. Its absence would silently un-suppress every "
            f"reviewed exemption and flood the report, so it is a hard error."
        )
    with open(path) as fh:
        return json.load(fh)


def _to_report(raw: dict, expectations: dict) -> dict:
    return classify(
        fact_ciks=set(raw["fact_ciks"]),
        filing_ciks=set(raw["filing_ciks"]),
        fact_counts={int(k): v for k, v in raw["fact_counts"].items()},
        filing_counts={int(k): v for k, v in raw["filing_counts"].items()},
        companies=raw["companies"],
        fact_pointers={int(k): v for k, v in raw["fact_pointers"].items()},
        registrants={int(k): v for k, v in raw["registrants"].items()},
        expectations=expectations,
    )


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--json", metavar="PATH", help="write the machine report here")
    ap.add_argument("--dump", metavar="PATH", help="write the raw reads here")
    ap.add_argument("--replay", metavar="PATH", help="classify a dump, no network")
    ap.add_argument("--quiet", action="store_true", help="suppress progress lines")
    args = ap.parse_args(argv)

    log = (lambda *a, **k: None) if args.quiet else print

    try:
        expectations = load_expectations()
        if args.replay:
            with open(args.replay) as fh:
                raw = json.load(fh)
            log(f"replaying {args.replay}")
        else:
            log("reading prod, SELECT only")
            raw = read_prod(_client(), log=log)
            if args.dump:
                with open(args.dump, "w") as fh:
                    json.dump(raw, fh)
                log(f"wrote {args.dump}")
        report = _to_report(raw, expectations)
    except (CouldNotRun, ReconcileInputError) as e:
        sys.stderr.write(f"COULD NOT RUN: {e}\n")
        _summary(f"## EDGAR CIK reconciliation\n\n**COULD NOT RUN.** {e}\n\n"
                 "This is a failure, not a pass. Nothing was verified.\n")
        return EXIT_COULD_NOT_RUN
    except Exception as e:  # noqa: BLE001 - any unexpected read failure is still not a pass
        sys.stderr.write(f"COULD NOT RUN: unexpected {type(e).__name__}: {e}\n")
        _summary(f"## EDGAR CIK reconciliation\n\n**COULD NOT RUN.** "
                 f"unexpected {type(e).__name__}: {e}\n")
        return EXIT_COULD_NOT_RUN

    body = render(report)
    print(body)
    if args.json:
        with open(args.json, "w") as fh:
            json.dump(report, fh, indent=1)
    _summary(body)
    return EXIT_FINDINGS if report["alarm"] else EXIT_CLEAN


def _summary(markdown: str) -> None:
    """Append to the GitHub job summary when there is one.

    This is the half that makes a GREEN ingest run stop implying health. The
    run can still be green; what it can no longer do is say nothing about
    whether every CIK it wrote has a home.
    """
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    try:
        with open(path, "a") as fh:
            fh.write(markdown + "\n")
    except OSError:
        pass


if __name__ == "__main__":
    sys.exit(main())
