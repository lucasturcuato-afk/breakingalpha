"""SEC company reconciliation for Company Intel (REVIEW-ONLY, never writes DB).

Broader companion to backfill_sec_ciks.py. That script handles ONE direction
(companies that already have a ticker but no sec_cik). This one reconciles the
whole companies table against SEC's company_tickers.json in both directions and
reuses that script's normalization + name-agreement primitives (imported, not
duplicated):

  Phase A  existing companies MISSING ticker or sec_cik that match an SEC entry.
           Match dimensions, in confidence order:
             - exact ticker (normalized) to a single SEC CIK, name agrees  HIGH
             - exact sec_cik already present, backfill the ticker           HIGH
             - exact normalized-name equality to a UNIQUE SEC entry         HIGH
                 (this is the PTC case: "PTC Inc" -> norm "ptc" -> SEC PTC Inc)
             - fuzzy name (ratio >= threshold, not exact) or an ambiguous
               name/ticker match                                            MEDIUM
           HIGH is auto-backfillable (UPDATE emitted); MEDIUM is flagged for
           manual review and NEVER auto-applied.

  Phase B  SEC entries with NO DB match by ticker, CIK, or normalized name.
           This is the universe-expansion count (companies SEC knows that we do
           not), reported with a sample. No action emitted.

  Collisions  one SEC entry matched by 2+ DB companies (many-to-one), e.g. an
              already-populated "PTC" plus uncovered "PTC Inc" / "PTC Inc.".
              Flagged: backfilling would create duplicate-ticker rows, so a
              dedup decision belongs to a human.

  Ambiguous   one DB company matching 2+ distinct SEC entries (ticker spread
              across CIKs, or a normalized name shared by multiple filers).
              Flagged, never backfilled.

Outputs (artifacts only; this script NEVER writes to the database):
  backend/migrations/2026-06-21-sec-ticker-reconcile-phase-a.sql
      HIGH-confidence Phase A backfills, idempotent, guarded on the column being
      NULL. Apply manually after review. Collision rows are emitted but tagged.
  backend/migrations/2026-06-21-sec-ticker-reconcile-report.md
      per-bucket counts, samples, full collision and ambiguous tables.

Reads: companies via the Supabase REST client (SELECT only, paged) OR, for an
offline dry run, a JSON array file via --companies-json. SEC fetch reuses
backend.edgar.client.sec_get (mandatory User-Agent + pacing).

Usage:
  cd <repo root>
  set -a && source .env.local && set +a && export SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
  .venv/bin/python -m backend.scripts.reconcile_sec_companies --dry-run

ASCII only. No em-dashes.
"""
from __future__ import annotations

import argparse
import difflib
import json
import os
import sys
from collections import defaultdict

from backend.edgar.client import sec_get
from backend.scripts.backfill_sec_ciks import (
    COMPANY_TICKERS_URL,
    RATIO_THRESHOLD,
    norm_name,
    norm_ticker,
)

PHASE_A_SQL_PATH = "backend/migrations/2026-06-21-sec-ticker-reconcile-phase-a.sql"
REPORT_PATH = "backend/migrations/2026-06-21-sec-ticker-reconcile-report.md"


# --- SEC side ---------------------------------------------------------------

def build_sec_indexes():
    """Return (by_ticker, by_cik, by_name, all_entries).

    by_ticker: norm ticker -> list[(cik, raw, title)]
    by_cik:    cik         -> list[(raw, title)]
    by_name:   norm name   -> list[(cik, raw, title)]
    all_entries: list[(cik, raw, title)]
    """
    resp = sec_get(COMPANY_TICKERS_URL)
    if not resp:
        sys.exit("company_tickers.json fetch failed (check SEC_USER_AGENT)")
    by_ticker = defaultdict(list)
    by_cik = defaultdict(list)
    by_name = defaultdict(list)
    all_entries = []
    for row in resp.json().values():
        if not row.get("ticker") or not row.get("cik_str"):
            continue
        cik, raw, title = int(row["cik_str"]), row["ticker"], row["title"]
        by_ticker[norm_ticker(raw)].append((cik, raw, title))
        by_cik[cik].append((raw, title))
        by_name[norm_name(title)].append((cik, raw, title))
        all_entries.append((cik, raw, title))
    return by_ticker, by_cik, by_name, all_entries


# --- DB side ----------------------------------------------------------------

def fetch_companies(sb) -> list[dict]:
    """All companies (paged; REST reads only). id, name, ticker, sec_cik."""
    out, page, page_size = [], 0, 1000
    while True:
        rows = (
            sb.table("companies")
            .select("id, name, ticker, sec_cik")
            .order("id")
            .range(page * page_size, (page + 1) * page_size - 1)
            .execute()
            .data or []
        )
        out.extend(rows)
        if len(rows) < page_size:
            return out
        page += 1


def load_companies(args) -> list[dict]:
    if args.companies_json:
        with open(args.companies_json) as f:
            return json.load(f)
    from supabase import create_client
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    return fetch_companies(sb)


# --- Reconciliation ---------------------------------------------------------

def _ratio(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, norm_name(a), norm_name(b)).ratio()


def reconcile(companies, by_ticker, by_cik, by_name, all_entries):
    """Return buckets:
      phase_a_high   : missing ticker/cik, unambiguous exact match -> backfill
      phase_a_medium : missing ticker/cik, fuzzy or ambiguous -> flag
      collisions     : sec entry -> [db companies] where >1 db company matches
      ambiguous      : db company matched 2+ distinct sec entries
      matched_sec_keys : set of (cik) SEC entries covered by ANY db company
    """
    phase_a_high, phase_a_medium, ambiguous = [], [], []
    sec_to_dbs = defaultdict(list)  # cik -> list of (company, how)
    matched_ciks = set()

    for c in companies:
        nt = norm_ticker(c.get("ticker") or "") if c.get("ticker") else ""
        cik = c.get("sec_cik")
        nn = norm_name(c.get("name") or "")
        missing = (not c.get("ticker")) or (cik is None)

        # Collect distinct SEC entries this company matches, with the dimension.
        cand_ciks = set()
        match_dim = {}  # cik -> dimension label (best wins later)

        def add(entry, dim):
            ecik = entry[0]
            cand_ciks.add(ecik)
            # keep the strongest dimension seen for this cik
            order = {"cik": 3, "ticker": 2, "name": 1}
            if ecik not in match_dim or order[dim] > order[match_dim[ecik][0]]:
                match_dim[ecik] = (dim, entry)

        if cik is not None and cik in by_cik:
            raw, title = by_cik[cik][0]
            add((cik, raw, title), "cik")
        if nt and nt in by_ticker:
            for e in by_ticker[nt]:
                add(e, "ticker")
        if nn and nn in by_name:
            for e in by_name[nn]:
                add(e, "name")

        if not cand_ciks:
            continue  # no SEC match at all

        # Record coverage + collision membership for every matched SEC entry.
        for ec in cand_ciks:
            matched_ciks.add(ec)
            sec_to_dbs[ec].append(c)

        # A company matching 2+ distinct SEC CIKs is ambiguous.
        if len(cand_ciks) > 1:
            ambiguous.append({
                "company": c,
                "candidates": [match_dim[ec][1] for ec in sorted(cand_ciks)],
            })
            continue

        # Single SEC entry matched.
        ec = next(iter(cand_ciks))
        dim, entry = match_dim[ec]
        ecik, eraw, etitle = entry
        if not missing:
            continue  # already populated; only counts toward coverage/collision

        ratio = _ratio(c.get("name") or "", etitle)
        # HIGH confidence dimensions: exact cik, exact ticker (name must agree),
        # or exact normalized-name equality (already unique here since one cik).
        name_equal = nn != "" and nn == norm_name(etitle)
        high = False
        if dim == "cik":
            high = True
        elif dim == "ticker":
            high = ratio >= RATIO_THRESHOLD  # ticker hit, name-verified
        elif dim == "name":
            high = name_equal  # exact normalized-name equality, unique cik

        rec = {
            "company": c, "dim": dim, "cik": ecik, "sec_ticker": eraw,
            "sec_title": etitle, "ratio": ratio,
            "fill_ticker": (not c.get("ticker")),
            "fill_cik": (cik is None),
        }
        (phase_a_high if high else phase_a_medium).append(rec)

    collisions = {ec: dbs for ec, dbs in sec_to_dbs.items() if len(dbs) > 1}
    new_universe = [e for e in all_entries if e[0] not in matched_ciks]
    return phase_a_high, phase_a_medium, collisions, ambiguous, new_universe


# --- Artifacts --------------------------------------------------------------

def emit_phase_a_sql(phase_a_high, collisions):
    collision_ciks = set(collisions.keys())
    lines = [
        "-- SEC ticker/CIK reconciliation, Phase A (REVIEW-ONLY; apply manually).",
        "-- Generated by backend/scripts/reconcile_sec_companies.py.",
        "-- HIGH-confidence backfills only: exact ticker (name-verified), exact",
        "-- CIK, or exact normalized-name equality to a unique SEC entry.",
        "-- Idempotent: each SET is guarded on the target column being NULL.",
        "-- Rows tagged COLLISION map to an SEC entry that ANOTHER company also",
        "-- matches (e.g. an already-populated row); applying them creates a",
        "-- duplicate ticker. Adjudicate (likely dedup) before running those.",
        "",
        "BEGIN;",
        "",
    ]
    for r in sorted(phase_a_high, key=lambda r: (r["sec_ticker"] or "")):
        c = r["company"]
        sets, guards = [], []
        if r["fill_ticker"]:
            sets.append(f"ticker = '{r['sec_ticker']}'")
            guards.append("ticker IS NULL")
        if r["fill_cik"]:
            sets.append(f"sec_cik = {r['cik']}")
            guards.append("sec_cik IS NULL")
        if not sets:
            continue
        tag = "  -- COLLISION" if r["cik"] in collision_ciks else ""
        name = (c["name"] or "").replace("'", "''")
        title = (r["sec_title"] or "").replace("'", "''")
        lines.append(
            f"UPDATE companies SET {', '.join(sets)} "
            f"WHERE id = '{c['id']}' AND {' AND '.join(guards)};"
            f"  -- {r['sec_ticker']} {name!r} -> {title!r} "
            f"(via {r['dim']}, ratio {r['ratio']:.2f}){tag}"
        )
    lines += ["", "COMMIT;", ""]
    with open(PHASE_A_SQL_PATH, "w") as f:
        f.write("\n".join(lines))


def _sample(rows, n=5):
    return rows[:n]


def emit_report(phase_a_high, phase_a_medium, collisions, ambiguous,
                new_universe, n_companies, n_sec):
    rep = [
        "# SEC company reconciliation report (2026-06-21)",
        "",
        f"Companies scanned: {n_companies}. SEC company_tickers.json entries: {n_sec}.",
        f"Name ratio threshold (fuzzy/MEDIUM): {RATIO_THRESHOLD}.",
        "",
        "| bucket | count | disposition |",
        "|---|---|---|",
        f"| Phase A HIGH (auto-backfillable) | {len(phase_a_high)} | in phase-a.sql, apply after review |",
        f"| Phase A MEDIUM (manual review) | {len(phase_a_medium)} | flagged, NOT in sql |",
        f"| New-universe SEC companies | {len(new_universe)} | exact-match-only UPPER BOUND, no action |",
        f"| Many-to-one collisions | {len(collisions)} | flagged, adjudicate (dedup) |",
        f"| Ambiguous (db -> 2+ SEC) | {len(ambiguous)} | flagged, never backfilled |",
        "",
        "## Phase A HIGH (sample)",
        "",
        "| sec_ticker | our name | SEC title | via | fills | CIK |",
        "|---|---|---|---|---|---|",
    ]
    for r in _sample(sorted(phase_a_high, key=lambda r: r["sec_ticker"] or "")):
        fills = "+".join([x for x, on in (("ticker", r["fill_ticker"]),
                                          ("cik", r["fill_cik"])) if on])
        rep.append(f"| {r['sec_ticker']} | {r['company']['name']} | {r['sec_title']} "
                   f"| {r['dim']} | {fills} | {r['cik']} |")

    rep += ["", "## Phase A MEDIUM (sample, manual review)", "",
            "| our name | SEC title | via | ratio | CIK |", "|---|---|---|---|---|"]
    for r in _sample(sorted(phase_a_medium, key=lambda r: -r["ratio"])):
        rep.append(f"| {r['company']['name']} | {r['sec_title']} | {r['dim']} "
                   f"| {r['ratio']:.2f} | {r['cik']} |")

    rep += ["", "## New-universe SEC companies (sample)", "",
            "CAVEAT: this is an UPPER BOUND. An SEC entry counts as new-universe "
            "only when NO DB company matches it by exact ticker, exact CIK, or "
            "exact normalized-name equality. No fuzzy matching is applied here, so "
            "companies present under a non-normalized-equal name with no ticker "
            "(e.g. P&G, Home Depot below) are overcounted as new. Treat the count "
            "as a ceiling on the expansion opportunity, not an exact figure.", "",
            "| sec_ticker | SEC title | CIK |", "|---|---|---|"]
    for cik, raw, title in _sample(new_universe):
        rep.append(f"| {raw} | {title} | {cik} |")

    rep += ["", "## Many-to-one collisions (sample)", "",
            "SEC entry matched by 2+ DB companies (applying backfills would create "
            "duplicate tickers; dedup decision is human).", "",
            "| CIK | DB companies (name / ticker / cik) |", "|---|---|"]
    for cik, dbs in _sample(list(collisions.items())):
        names = "; ".join(f"{d['name']} (t={d.get('ticker')}, cik={d.get('sec_cik')})"
                          for d in dbs)
        rep.append(f"| {cik} | {names} |")

    rep += ["", "## Ambiguous (sample)", "",
            "| our name | candidate SEC titles |", "|---|---|"]
    for a in _sample(ambiguous):
        cands = "; ".join(f"{t} (CIK {c})" for c, _, t in a["candidates"])
        rep.append(f"| {a['company']['name']} | {cands} |")
    rep.append("")
    with open(REPORT_PATH, "w") as f:
        f.write("\n".join(rep))


def _print_bucket(label, rows, fmt):
    print(f"\n{label}: {len(rows)}")
    for r in _sample(rows):
        print("  " + fmt(r))


def main() -> int:
    parser = argparse.ArgumentParser(description="SEC company reconciliation (review-only)")
    parser.add_argument("--dry-run", action="store_true", default=True,
                        help="default and only mode: emit artifacts, never write DB")
    parser.add_argument("--companies-json", default=None,
                        help="offline: read companies from a JSON array file instead of the DB")
    parser.add_argument("--live", action="store_true", help="intentionally not implemented")
    args = parser.parse_args()
    if args.live:
        print(f"live mode is intentionally not implemented: review and apply "
              f"{PHASE_A_SQL_PATH} manually.")
        return 2

    companies = load_companies(args)
    by_ticker, by_cik, by_name, all_entries = build_sec_indexes()
    high, medium, collisions, ambiguous, new_universe = reconcile(
        companies, by_ticker, by_cik, by_name, all_entries)
    emit_phase_a_sql(high, collisions)
    emit_report(high, medium, collisions, ambiguous, new_universe,
                len(companies), len(all_entries))

    print(f"companies={len(companies)}  sec_entries={len(all_entries)}")
    print(f"Phase A HIGH={len(high)}  MEDIUM={len(medium)}  "
          f"new_universe={len(new_universe)}  collisions={len(collisions)}  "
          f"ambiguous={len(ambiguous)}")
    _print_bucket("Phase A HIGH (auto-backfillable)", sorted(high, key=lambda r: r["sec_ticker"] or ""),
                  lambda r: f"{r['sec_ticker']:<8} {r['company']['name']!r} -> {r['sec_title']!r} "
                            f"(via {r['dim']}, fills {'ticker' if r['fill_ticker'] else ''}"
                            f"{'+cik' if r['fill_cik'] and r['fill_ticker'] else ('cik' if r['fill_cik'] else '')}, CIK {r['cik']})")
    _print_bucket("Phase A MEDIUM (manual review)", sorted(medium, key=lambda r: -r["ratio"]),
                  lambda r: f"{r['company']['name']!r} -> {r['sec_title']!r} (via {r['dim']}, ratio {r['ratio']:.2f})")
    _print_bucket("New-universe SEC companies", new_universe,
                  lambda e: f"{e[1]:<8} {e[2]!r} (CIK {e[0]})")
    _print_bucket("Many-to-one collisions", list(collisions.items()),
                  lambda kv: f"CIK {kv[0]}: " + "; ".join(f"{d['name']}(t={d.get('ticker')})" for d in kv[1]))
    _print_bucket("Ambiguous (db -> 2+ SEC)", ambiguous,
                  lambda a: f"{a['company']['name']!r}: " + "; ".join(t for _, _, t in a["candidates"]))

    # PTC confirmation line.
    ptc = [r for r in high if (r["sec_ticker"] or "").upper() == "PTC"]
    print(f"\nPTC in Phase A HIGH: {len(ptc)} row(s)")
    for r in ptc:
        print(f"  {r['company']['name']!r} -> ticker {r['sec_ticker']} CIK {r['cik']} (via {r['dim']})")

    print(f"\nwrote {PHASE_A_SQL_PATH} and {REPORT_PATH}; no DB writes performed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
