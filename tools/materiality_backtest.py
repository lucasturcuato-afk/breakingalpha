"""
Offline labeled-day backtest for the PR1 tape-aware materiality lead ranker.

WHY: the materiality re-rank (impact_ranking.compute_materiality_lead) ships
SHADOW-first and cannot go active until it agrees with Noah's ratified read on a
run of labeled days. This harness is that grader. It is built now and grades as
labels accrue: each newly-ratified row in the labels CSV is picked up
automatically once its frozen candidate-pool fixture exists.

WHAT IT DOES (fully offline, NO prod, NO Gemini, NO network):
  1. Reads the ratified rows from backend/tests/fixtures/pr1_materiality_labels.csv
     (NOAH_RATIFIED_mode non-empty AND a recorded tape on the row; null-tape and
     unratified rows are SKIPPED, exactly as the CSV header instructs).
  2. For each ratified day, loads that day's PERSISTED tape from the CSV row and a
     FROZEN candidate pool from backend/tests/fixtures/materiality_pools/<date>.json.
  3. Runs the tape-blind base ranker (compute_lead) and the tape-aware materiality
     ranker (compute_materiality_lead) over the frozen pool + persisted tape.
  4. Classifies each ranker's lead as mode A (market-wide) or mode B (single-name /
     deal) and compares against NOAH_RATIFIED_mode.
  5. KEYSTONE: on the ratified 2026-06-30 evening row the materiality ranker must
     NOT lead with the single Rocket Lab deal (it must land market-wide, mode A).

Prints per-day agreement and exits non-zero if the keystone fails or any ratified
day with a pool fixture is mis-graded. With only 1-2 ratified days this is
INDICATIVE, not conclusive; that is stated in the output.

USAGE (from repo root, no env, no secrets):
    python tools/materiality_backtest.py

A row that is ratified but has no pool fixture yet is reported as PENDING-POOL and
does not fail the run (add its fixture to grade it). Reconstructing a frozen pool
from prod is a deliberate manual step (prod-read is out of scope for this harness).
"""
import csv
import datetime as dt
import json
import os
import sys

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_BACKEND = os.path.join(_REPO, "backend")
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import impact_ranking as ir  # noqa: E402

LABELS_CSV = os.path.join(_BACKEND, "tests", "fixtures", "pr1_materiality_labels.csv")
POOLS_DIR = os.path.join(_BACKEND, "tests", "fixtures", "materiality_pools")

# Session gen-time (UTC) used to age the frozen pool's articles. Morning briefs
# generate pre-open (~13:45 UTC); evening after the close (~22:30 UTC).
_SESSION_NOW = {"morning": (13, 45), "evening": (22, 30)}


def _f(v):
    """Parse a signed percent like '+1.18' or '-4.13%' or '17.65 (-4.13%)'. The
    VIX cell is 'level (pct)'; callers pass the piece they want."""
    if v is None:
        return None
    s = str(v).strip().replace("%", "").replace("+", "")
    try:
        return float(s)
    except ValueError:
        return None


def parse_vix_cell(cell):
    """'17.65 (-4.13%)' -> (level 17.65, pct -4.13). Missing pieces -> None."""
    cell = str(cell or "")
    level = _f(cell.split("(")[0]) if cell else None
    pct = None
    if "(" in cell and ")" in cell:
        pct = _f(cell[cell.index("(") + 1:cell.index(")")])
    return level, pct


def row_has_tape(row):
    """Inherit the CSV's tape filter: a usable recorded tape needs at least the
    S&P percent and a VIX cell. All rows in this CSV are >= 2026-06-30 and carry a
    recorded tape; pre-2026-06-30 briefs (no tape) are excluded upstream."""
    return _f(row.get("sp_pct")) is not None and bool(str(row.get("vix") or "").strip())


def tape_from_row(row):
    """Build a live-shaped tape dict from the persisted CSV tape columns."""
    vix_level, vix_pct = parse_vix_cell(row.get("vix"))
    quotes = {
        "^GSPC": {"pct": _f(row.get("sp_pct"))},
        "^IXIC": {"pct": _f(row.get("nasdaq_pct"))},
        "^DJI": {"pct": _f(row.get("dow_pct"))},
        "^RUT": {"pct": _f(row.get("russell_pct"))},
        "^VIX": {"pct": vix_pct, "price": vix_level},
    }
    return {"quotes": quotes, "vix_level": vix_level}


def session_now(date_session):
    """date_session like '2026-06-30 evening' -> a UTC datetime at the session's
    gen hour."""
    date_str, _, sess = date_session.partition(" ")
    y, m, d = (int(x) for x in date_str.split("-"))
    hh, mm = _SESSION_NOW.get(sess.strip().lower(), (14, 30))
    return dt.datetime(y, m, d, hh, mm, tzinfo=dt.timezone.utc)


def pool_fixture_path(date_session):
    slug = date_session.strip().replace(" ", "_")
    return os.path.join(POOLS_DIR, f"{slug}.json")


def load_pool(date_session, now):
    """Load the frozen candidate pool for a day, aging each article to real
    timestamps relative to `now`. Returns (pool, mega_deal_urls, name_session_pct)
    or None when no fixture exists yet."""
    path = pool_fixture_path(date_session)
    if not os.path.exists(path):
        return None
    with open(path) as fh:
        spec = json.load(fh)
    pool = []
    for a in spec.get("pool", []):
        hrs = float(a.get("hours_ago", 4))
        ts = (now - dt.timedelta(hours=hrs)).isoformat()
        pool.append({
            "title": a.get("title", ""), "summary": a.get("summary", ""),
            "source": a.get("source", ""), "relevance_score": a.get("relevance_score", 8),
            "companies": a.get("companies", []), "url": a.get("url", ""),
            "deal_type": a.get("deal_type"), "published_at": ts, "ingested_at": ts,
        })
    return (pool, set(spec.get("mega_deal_urls", [])),
            spec.get("name_session_pct", {}))


def classify_mode(lead_result):
    """Map a ranker result to the CSV mode taxonomy: A = market-wide, B =
    single-name / deal owns the read."""
    if not lead_result:
        return None
    key = lead_result.get("cluster_key", "")
    title = str(lead_result.get("article", {}).get("title") or "").lower()
    return "A" if ir._is_market_wide_cluster(key, title) else "B"


def read_ratified_rows():
    rows = []
    with open(LABELS_CSV, newline="") as fh:
        reader = csv.DictReader(r for r in fh if not r.lstrip().startswith("#"))
        for row in reader:
            ratified = (row.get("NOAH_RATIFIED_mode") or "").strip()
            if not ratified:
                continue  # unratified -> skip
            if not row_has_tape(row):
                continue  # null-tape -> skip
            rows.append(row)
    return rows


def grade_row(row):
    date_session = (row.get("date_session") or "").strip()
    now = session_now(date_session)
    tape = tape_from_row(row)
    loaded = load_pool(date_session, now)
    ratified_mode = (row.get("NOAH_RATIFIED_mode") or "").strip().upper()
    if loaded is None:
        return {"date": date_session, "status": "PENDING-POOL",
                "ratified_mode": ratified_mode}
    pool, mega, name_moves = loaded
    base = ir.compute_lead(pool, now, mega_deal_urls=mega)
    mat = ir.compute_materiality_lead(pool, now, tape=tape, name_session_pct=name_moves,
                                      mega_deal_urls=mega)
    base_title = str((base or {}).get("article", {}).get("title") or "")
    mat_title = str((mat or {}).get("article", {}).get("title") or "")
    mat_mode = classify_mode(mat)
    return {
        "date": date_session, "status": "GRADED",
        "ratified_mode": ratified_mode, "materiality_mode": mat_mode,
        "agrees": mat_mode == ratified_mode,
        "base_lead": base_title, "materiality_lead": mat_title,
        "diverged_from_base": bool((mat or {}).get("diverged_from_base")),
        "materiality_reasons": (mat or {}).get("materiality_reasons", []),
    }


# Keystone: the ratified 06-30 evening row must NOT lead with the single Rocket
# Lab deal under the materiality ranker.
KEYSTONE_DATE = "2026-06-30 evening"


def check_keystone(graded):
    for g in graded:
        if g["date"] == KEYSTONE_DATE and g["status"] == "GRADED":
            lead = g["materiality_lead"].lower()
            ok = "rocket lab" not in lead and g["materiality_mode"] == "A"
            return ok, g
    return None, None


def main():
    rows = read_ratified_rows()
    graded = [grade_row(r) for r in rows]

    print("=" * 74)
    print("PR1 materiality backtest — labeled-day agreement (offline, no prod)")
    print("=" * 74)
    gradeable = [g for g in graded if g["status"] == "GRADED"]
    pending = [g for g in graded if g["status"] == "PENDING-POOL"]

    for g in graded:
        if g["status"] == "PENDING-POOL":
            print(f"  · {g['date']:<24} PENDING-POOL (ratified={g['ratified_mode']}, "
                  f"no frozen-pool fixture yet — add one to grade)")
            continue
        mark = "AGREE" if g["agrees"] else "DISAGREE"
        print(f"  {'✓' if g['agrees'] else '✗'} {g['date']:<24} "
              f"ratified={g['ratified_mode']} materiality={g['materiality_mode']} [{mark}]")
        print(f"        base lead        : {g['base_lead'][:66]}")
        print(f"        materiality lead : {g['materiality_lead'][:66]} "
              f"(diverged={g['diverged_from_base']})")
        if g["materiality_reasons"]:
            print(f"        why              : {'; '.join(g['materiality_reasons'])}")

    n = len(gradeable)
    agree = sum(1 for g in gradeable if g["agrees"])
    print("-" * 74)
    if n:
        print(f"  Agreement: {agree}/{n} ratified day(s) with a pool fixture "
              f"({100.0 * agree / n:.0f}%)")
    else:
        print("  Agreement: no ratified day has a pool fixture yet")
    if pending:
        print(f"  Pending pool fixtures: {len(pending)} ratified day(s) awaiting a frozen pool")
    print("  NOTE: with only 1-2 ratified days this is INDICATIVE, not conclusive. "
          "Go-live gate = agreement on ~8-10 ratified days (see RUN_REPORT_PR1.md).")

    ok, kg = check_keystone(graded)
    print("-" * 74)
    if ok is None:
        print(f"  KEYSTONE ({KEYSTONE_DATE}): NOT GRADED (missing row or pool fixture) — FAIL")
        return 1
    if ok:
        print(f"  KEYSTONE ({KEYSTONE_DATE}): PASS — materiality does NOT lead Rocket Lab; "
              f"lands market-wide (mode A). lead='{kg['materiality_lead'][:50]}'")
    else:
        print(f"  KEYSTONE ({KEYSTONE_DATE}): FAIL — materiality lead='{kg['materiality_lead'][:60]}' "
              f"mode={kg['materiality_mode']}")
        return 1
    # Fail the run if any graded ratified day disagrees (keeps the gate honest as
    # labels accrue). With the current single ratified day this equals the keystone.
    if n and agree != n:
        print(f"  RESULT: FAIL — {n - agree} ratified day(s) disagree")
        return 1
    print("  RESULT: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
