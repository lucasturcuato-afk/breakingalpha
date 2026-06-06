"""SEC CIK backfill for Company Intel companies (REVIEW-ONLY, never writes DB).

~414 companies have a ticker but no sec_cik and are potentially resolvable
from SEC's company_tickers.json. The risk is FALSE-POSITIVE CIKs: our ticker
column contains Finnhub-derived and extraction-noise tickers ("BCG", "AXIN",
"IPO-ELLT") that can coincidentally match an unrelated US filer. So every
ticker hit is NAME-VERIFIED against the SEC company title and bucketed:

  B1 clean        exact normalized-ticker hit, single-ticker CIK, name agrees
  B2 share-class  same, but the CIK lists sibling class tickers (BRK.A/BRK.B);
                  apply-ready when the name agrees; class noted
  B3 suspect      ticker matched a US filer but the SEC title DISAGREES with
                  our name (or the normalized ticker is ambiguous across
                  CIKs). NEVER auto-included; listed for human adjudication.
  B4 unmatched    ticker absent from company_tickers.json (foreign, private,
                  delisted, or junk). Expected and fine.

Name agreement (stated threshold, see _names_agree):
  difflib.SequenceMatcher ratio >= 0.60 on suffix-stripped lowercase names.
  Token containment below that ratio is NOT apply-ready (affiliate-entity
  risk: "Bain Capital" is contained in "Bain Capital Specialty Finance" but
  is a different company); such hits land in B3 for adjudication.

Outputs (artifacts only; this script NEVER writes to the database):
  backend/migrations/2026-06-04-sec-cik-backfill.sql        B1+B2 idempotent
      UPDATE ... SET sec_cik = <cik> WHERE id = <id> AND sec_cik IS NULL
  backend/migrations/2026-06-04-sec-cik-backfill-report.md  per-bucket counts,
      the full B3 adjudication table, B4 list

SEC fetch reuses backend.edgar.client.sec_get (mandatory User-Agent + 5 req/s
pacing); raw header-less requests.get gets 403'd by the SEC.

Usage:
  cd <repo root>
  set -a && source .env.local && set +a && export SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
  .venv/bin/python -m backend.scripts.backfill_sec_ciks --dry-run

ASCII only. No em-dashes.
"""
from __future__ import annotations

import argparse
import difflib
import os
import re
import sys
from collections import defaultdict

from supabase import create_client

from backend.edgar.client import sec_get

COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SQL_PATH = "backend/migrations/2026-06-04-sec-cik-backfill.sql"
REPORT_PATH = "backend/migrations/2026-06-04-sec-cik-backfill-report.md"

RATIO_THRESHOLD = 0.60

# legal/structural suffixes that carry no identity signal
_SUFFIXES = {
    "inc", "incorporated", "corp", "corporation", "co", "company", "ltd",
    "limited", "plc", "llc", "lp", "sa", "nv", "ag", "se", "ab", "as", "spa",
    "holdings", "holding", "group", "the", "trust", "companies", "intl",
    "international",
}


def norm_ticker(t: str) -> str:
    """Uppercase and unify class separators so BRK.B == BRK-B."""
    return (t or "").strip().upper().replace("-", ".")


def norm_name(n: str) -> str:
    n = re.sub(r"[^a-z0-9 ]", " ", (n or "").lower())
    tokens = [t for t in n.split() if t and t not in _SUFFIXES]
    return " ".join(tokens)


def _names_agree(ours: str, sec_title: str) -> tuple[bool, float, bool]:
    """(agrees, ratio, containment). Apply-ready requires ratio >= threshold;
    containment below the ratio threshold is NOT apply-ready: it admits
    affiliate-entity false positives ("Bain Capital" is contained in "Bain
    Capital Specialty Finance" but is a different company; same for
    "Del Monte" vs "Fresh Del Monte Produce"). Containment-only hits are
    routed to B3 for human adjudication."""
    a, b = norm_name(ours), norm_name(sec_title)
    if not a or not b:
        return False, 0.0, False
    ratio = difflib.SequenceMatcher(None, a, b).ratio()
    ta, tb = a.split(), b.split()
    short, long_ = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    containment = len(short) >= 2 and all(t in long_ for t in short)
    return ratio >= RATIO_THRESHOLD, ratio, containment


# --- B3 token-set triage -----------------------------------------------------
# The 0.60 difflib ratio is length-sensitive: it lumps true matches that only
# differ by legal boilerplate ("Alight, Inc." vs "Alight, Inc. / Delaware")
# with affiliates ("Bain Capital" vs "Bain Capital Specialty Finance") and
# pure ticker collisions ("Stran" vs "Astrana Health"). Significant-token
# sets separate the three.

B3_STOPWORDS = _SUFFIXES | {
    "and", "of", "class", "common", "stock", "fund", "trust",
}

# extra-descriptor tokens that signal a DIFFERENT legal entity sharing the
# brand (BDC/SPAC/fund affiliates): used only for the keep/reject SUGGESTION
AFFILIATE_MARKERS = {
    "specialty", "finance", "financial", "acquisition", "acquisitions",
    "spac", "partners", "insurance", "bancorp", "capital", "income",
    "convertible", "investment", "investments",
}


def significant_tokens(name: str) -> set[str]:
    """Lowercase, drop a trailing '/ <state>' qualifier, strip punctuation,
    remove corporate/legal-form stopwords. What remains is identity."""
    n = re.sub(r"/.*$", " ", (name or "").lower())  # 'Alight, Inc. / Delaware'
    n = re.sub(r"[^a-z0-9 ]", " ", n)
    return {t for t in n.split() if t and t not in B3_STOPWORDS}


def _b3_suggestion(ours: set, sec: set) -> tuple[str, str]:
    shared = ours & sec
    extras = (ours | sec) - shared
    if len(shared) == 1 and len(extras) >= 1:
        return "reject", "single shared brand token only"
    if ours <= sec or sec <= ours:
        if extras & AFFILIATE_MARKERS:
            return "reject", "extra descriptors look like an affiliate entity"
        if len(extras) <= 1:
            return "keep", "one side adds at most one non-affiliate token"
        return "reject", "two or more extra descriptors"
    return "reject", "both sides carry tokens the other lacks"


def classify_b3(b3: list[dict]) -> tuple[list, list, list]:
    """Split B3 into A (token sets equal), B (overlap, needs judgment),
    C (zero overlap, pure ticker collision). Multi-CIK-ambiguous rows are
    capped at B even when a candidate's tokens match exactly."""
    b3a, b3b, b3c = [], [], []
    for r in b3:
        ours = significant_tokens(r["name"])
        best = None
        for cik, raw, title in r["candidates"]:
            sec = significant_tokens(title)
            overlap = len(ours & sec)
            cand = {"cik": cik, "sec_ticker": raw, "sec_title": title,
                    "sec_tokens": sec, "overlap": overlap,
                    "equal": bool(ours) and ours == sec}
            if best is None or (cand["equal"], cand["overlap"]) > (best["equal"], best["overlap"]):
                best = cand
        ambiguous = len({c for c, _, _ in r["candidates"]}) > 1
        row = {**r, **best, "our_tokens": ours}
        if best["equal"] and not ambiguous:
            b3a.append(row)
        elif best["overlap"] > 0:
            sug, why = _b3_suggestion(ours, best["sec_tokens"])
            if ambiguous:
                sug, why = "reject", "ticker ambiguous across CIKs"
            b3b.append({**row, "suggestion": sug, "why": why})
        else:
            b3c.append(row)
    return b3a, b3b, b3c


def fetch_sec_tickers() -> tuple[dict, dict]:
    """normalized ticker -> (cik, raw ticker, title); cik -> [raw tickers]."""
    resp = sec_get(COMPANY_TICKERS_URL)
    if not resp:
        sys.exit("company_tickers.json fetch failed (check SEC_USER_AGENT)")
    by_ticker: dict[str, list] = defaultdict(list)
    by_cik: dict[int, list] = defaultdict(list)
    for row in resp.json().values():
        if not row.get("ticker") or not row.get("cik_str"):
            continue
        cik, raw, title = int(row["cik_str"]), row["ticker"], row["title"]
        by_ticker[norm_ticker(raw)].append((cik, raw, title))
        by_cik[cik].append(raw)
    return by_ticker, by_cik


def fetch_targets(sb) -> list[dict]:
    """All companies with a ticker and no sec_cik (paged; REST reads only)."""
    out, page, page_size = [], 0, 1000
    while True:
        rows = (
            sb.table("companies")
            .select("id, name, ticker")
            .not_.is_("ticker", "null")
            .is_("sec_cik", "null")
            .order("id")
            .range(page * page_size, (page + 1) * page_size - 1)
            .execute()
            .data or []
        )
        out.extend(rows)
        if len(rows) < page_size:
            return out
        page += 1


def bucket(targets, by_ticker, by_cik):
    b1, b2, b3, b4 = [], [], [], []
    for c in targets:
        nt = norm_ticker(c["ticker"])
        hits = by_ticker.get(nt, [])
        if not hits:
            b4.append(c)
            continue
        ciks = {h[0] for h in hits}
        if len(ciks) > 1:
            b3.append({**c, "reason": "ambiguous ticker across CIKs",
                       "candidates": hits, "ratio": 0.0})
            continue
        cik, raw, title = hits[0]
        agree, ratio, containment = _names_agree(c["name"], title)
        siblings = sorted(by_cik[cik])
        entry = {**c, "cik": cik, "sec_ticker": raw, "sec_title": title,
                 "ratio": ratio, "siblings": siblings}
        if not agree:
            reason = ("name contained in SEC title but below ratio threshold "
                      "(affiliate-entity risk)" if containment
                      else "SEC title disagrees with our name")
            b3.append({**c, "reason": reason, "candidates": hits,
                       "ratio": ratio})
        elif len(siblings) > 1:
            b2.append(entry)
        else:
            b1.append(entry)
    return b1, b2, b3, b4


def emit_artifacts(b1, b2, b3, b4, n_targets):
    lines = [
        "-- SEC CIK backfill (REVIEW-ONLY; apply manually after adjudication).",
        "-- Generated by backend/scripts/backfill_sec_ciks.py on 2026-06-04.",
        "-- B1 (clean) + B2 (share-class) only; B3 suspects are EXCLUDED and",
        "-- listed in 2026-06-04-sec-cik-backfill-report.md for adjudication.",
        "-- Idempotent: only touches sec_cik and only where currently NULL.",
        "",
        "BEGIN;",
        "",
    ]
    for tag, rows in (("B1", b1), ("B2", b2)):
        lines.append(f"-- {tag}: {len(rows)} rows")
        for r in sorted(rows, key=lambda r: r["ticker"] or ""):
            cls = (f" classes={','.join(r['siblings'])}" if tag == "B2" else "")
            lines.append(
                f"UPDATE companies SET sec_cik = {r['cik']} "
                f"WHERE id = '{r['id']}' AND sec_cik IS NULL;"
                f"  -- {r['ticker']} {r['name']!r} -> {r['sec_title']!r}"
                f" (ratio {r['ratio']:.2f}){cls}"
            )
        lines.append("")

    b3a, b3b, b3c = classify_b3(b3)
    lines.append("-- B3-A: significant-token sets equal after stripping legal "
                 "suffixes, high-confidence same entity")
    lines.append(f"-- {len(b3a)} rows; keep or cut this block wholesale")
    for r in sorted(b3a, key=lambda r: r["ticker"] or ""):
        lines.append(
            f"UPDATE companies SET sec_cik = {r['cik']} "
            f"WHERE id = '{r['id']}' AND sec_cik IS NULL;"
            f"  -- {r['ticker']} {r['name']!r} -> {r['sec_title']!r}"
            f" (tokens: {' '.join(sorted(r['our_tokens']))})"
        )
    lines.append("")
    lines += ["COMMIT;", ""]
    with open(SQL_PATH, "w") as f:
        f.write("\n".join(lines))

    rep = [
        "# SEC CIK backfill match report (2026-06-04)",
        "",
        f"Targets: {n_targets} companies with ticker and no sec_cik.",
        f"Threshold: name ratio >= {RATIO_THRESHOLD} on suffix-stripped names.",
        "Containment-only hits (shorter name fully inside the SEC title but",
        "ratio below threshold) are routed to B3: affiliate-entity risk.",
        "",
        f"| bucket | count | disposition |",
        f"|---|---|---|",
        f"| B1 clean | {len(b1)} | in SQL, apply-ready |",
        f"| B2 share-class | {len(b2)} | in SQL, apply-ready (class noted) |",
        f"| B3-A token-equal | {len(b3a)} | in SQL (labeled block), high confidence |",
        f"| B3-B judgment | {len(b3b)} | decision table below |",
        f"| B3-C reject | {len(b3c)} | zero token overlap, pure ticker collision |",
        f"| B4 unmatched | {len(b4)} | expected (foreign/private/delisted) |",
        "",
        "B3 sub-classification: significant-token sets (lowercase, punctuation",
        "stripped, corporate/legal stopwords and trailing '/ state' qualifiers",
        "removed). A = sets equal. B = overlap but extra descriptor tokens on",
        "one side (affiliate / same-brand-different-entity risk). C = zero",
        "overlap (coincidental ticker).",
        "",
        "## B3-A: token sets equal (now in the SQL as a labeled block)",
        "",
        "| ticker | our name | SEC title | CIK |",
        "|---|---|---|---|",
    ]
    for r in sorted(b3a, key=lambda r: r["ticker"] or ""):
        rep.append(f"| {r['ticker']} | {r['name']} | {r['sec_title']} | {r['cik']} |")
    rep += [
        "",
        "## B3-B: needs judgment (our name | SEC title | shared | extra | suggestion)",
        "",
        "| ticker | our name | SEC title | shared tokens | extra tokens | suggestion | UPDATE (commented) |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in sorted(b3b, key=lambda r: r["ticker"] or ""):
        shared = " ".join(sorted(r["our_tokens"] & r["sec_tokens"])) or "-"
        extra = " ".join(sorted((r["our_tokens"] | r["sec_tokens"])
                                - (r["our_tokens"] & r["sec_tokens"]))) or "-"
        upd = (f"`-- UPDATE companies SET sec_cik = {r['cik']} "
               f"WHERE id = '{r['id']}' AND sec_cik IS NULL;`")
        rep.append(f"| {r['ticker']} | {r['name']} | {r['sec_title']} "
                   f"| {shared} | {extra} | {r['suggestion']}: {r['why']} | {upd} |")
    rep += [
        "",
        "## B3-C: rejected, zero significant-token overlap",
        "",
        "| ticker | our name | SEC title |",
        "|---|---|---|",
    ]
    for r in sorted(b3c, key=lambda r: r["ticker"] or ""):
        rep.append(f"| {r['ticker']} | {r['name']} | {r['sec_title']} |")
    rep += [
        "",
        "## B4 unmatched tickers",
        "",
        ", ".join(sorted({r['ticker'] for r in b4})) or "(none)",
        "",
    ]
    with open(REPORT_PATH, "w") as f:
        f.write("\n".join(rep))


def main() -> int:
    parser = argparse.ArgumentParser(description="SEC CIK backfill (review-only)")
    parser.add_argument("--dry-run", action="store_true", default=True,
                        help="default and only mode: emit artifacts, never write DB")
    parser.add_argument("--live", action="store_true",
                        help="intentionally not implemented")
    args = parser.parse_args()
    if args.live:
        print("live mode is intentionally not implemented: review and apply "
              f"{SQL_PATH} manually after adjudicating B3.")
        return 2

    sb = create_client(os.environ["SUPABASE_URL"],
                       os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    targets = fetch_targets(sb)
    by_ticker, by_cik = fetch_sec_tickers()
    b1, b2, b3, b4 = bucket(targets, by_ticker, by_cik)
    emit_artifacts(b1, b2, b3, b4, len(targets))
    print(f"targets={len(targets)}  B1={len(b1)}  B2={len(b2)}  "
          f"B3={len(b3)}  B4={len(b4)}")
    print(f"wrote {SQL_PATH} and {REPORT_PATH}; no DB writes performed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
