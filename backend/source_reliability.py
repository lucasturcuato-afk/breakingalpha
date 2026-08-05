"""
source_reliability.py - outcome-based source signal, built on the CLEAN grader.

WHY A NEW MODULE INSTEAD OF FIXING source_credibility.py
--------------------------------------------------------
`source_credibility.py` computes `win_rate = n_confirmed / n_theses` over
`theses.outcome`, which is a Gemini prose verdict. Measured against production:

    39 graded theses total
    28 inconclusive, 7 ungradable, 3 confirmed, 1 invalidated
    -> FOUR directional outcomes in the product's entire history

and the formula puts `inconclusive` and `ungradable` in the denominator while
computing `n_invalidated` and never using it, so being demonstrably WRONG and
being merely UNRESOLVED produce the identical score. 22 sources, none with 20+
outcomes, 21 of 22 below 5, three sitting at a perfect 1.0 on a single thesis.

Meanwhile `grading/price_attribution.py` already produces honest outcomes:
benchmark excess return against the sector ETF and SPY, with an explicit
clean / confounded / inconclusive attribution label and an `ungradable` verdict
when it cannot get an honest read. That grader fed nothing.

This module routes the signal to that grader. It reads ONLY outcomes where
`attribution = 'clean'` and the verdict is directional, so a source is credited
or debited only when the named entity actually moved beyond its benchmarks in
the predicted direction.

`source_credibility.py` is left running and untouched. Its table is still read
by `trend_mapper.py` as a cluster-strength multiplier. Removing that wiring is a
generation behaviour change and is deliberately NOT part of this pass.

NOT WIRED INTO GENERATION
-------------------------
Nothing imports this module except its own CLI and the read-only
`/api/source-reliability` route. It does not touch thesis generation, brief
synthesis, trend scoring, or any prompt. It exists to START ACCUMULATING an
honest signal. Do not wire it into generation until the sample bar below is met
by at least one identity.

ATTRIBUTION IS FAN-OUT, AND IT IS LABELLED AS SUCH
--------------------------------------------------
`morning_brief_calls` has no source column (columns: brief_date, brief_id,
claim_text, claim_type, confidence, created_at, expected_direction, id, is_lead,
resolve_on, target_symbol). A call is extracted from a brief, not from an
article, so there is NO clean single-source attribution available today.

What we can do defensibly is scope to the call's own subject: brief -> that
brief's story rail -> the articles in it that actually concern the call's
target. Every qualifying identity in that narrowed set shares the outcome. This
is still fan-out and it is recorded on every row as
`attribution_method = 'brief_rail_target_fanout'` so no reader can mistake it
for clean single-source attribution. Credit is also DILUTED 1/N across the
distinct identities on a call, so a story covered by six outlets does not hand
six full credits out for one resolved call.

Usage:
    python backend/source_reliability.py --dry-run     # compute + print, no writes
    python backend/source_reliability.py               # compute + upsert
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

try:
    from publishers import attribution_identity, is_syndicator
    from grading.benchmarks import sector_etf_for_label
except ImportError:  # imported as backend.source_reliability
    from backend.publishers import attribution_identity, is_syndicator
    from backend.grading.benchmarks import sector_etf_for_label


#: Only these verdicts move the signal. `partial` and `ungradable` are excluded
#: entirely rather than being parked in a denominator -- that denominator bug is
#: the whole reason this module exists.
DIRECTIONAL_VERDICTS = ("correct", "wrong")

#: Only cleanly attributed outcomes count. `confounded` means a benchmark moved
#: too, `inconclusive` means the bar was not cleared either way. Both are real
#: information, but neither says the source was right or wrong.
CLEAN_ATTRIBUTION = "clean"

#: An index call ("the S&P closes higher") is a claim about the market itself.
#: No news outlet owns that outcome, so index claims are excluded from
#: attribution rather than sprayed across whoever happened to be in the brief.
EXCLUDED_CLAIM_TYPES = frozenset({"index", "aggregate"})

#: Sample-size bands. Below MIN_REPORTABLE_N no accuracy figure is emitted at
#: all -- the row still exists and still reports its raw counts, but
#: `accuracy` and `wilson_lower_95` are NULL so no consumer can render a rate
#: that a single outcome would swing.
MIN_REPORTABLE_N = 10
LOW_CONFIDENCE_MAX_N = 29
MODERATE_CONFIDENCE_MAX_N = 99

CONFIDENCE_INSUFFICIENT = "insufficient"
CONFIDENCE_LOW = "low"
CONFIDENCE_MODERATE = "moderate"
CONFIDENCE_HIGH = "high"

#: The bar for this signal to be usable in any weighting decision. Documented
#: here so the number lives next to the code that would have to meet it.
READY_FOR_WEIGHTING_N = 30

ATTRIBUTION_METHOD = "brief_rail_target_fanout"

SOURCE_RELIABILITY_DDL_HINT = "sql/0025_cross_source_observation.sql"


def confidence_label(n: int) -> str:
    """Map a clean-outcome count to its sample-size band."""
    if n < MIN_REPORTABLE_N:
        return CONFIDENCE_INSUFFICIENT
    if n <= LOW_CONFIDENCE_MAX_N:
        return CONFIDENCE_LOW
    if n <= MODERATE_CONFIDENCE_MAX_N:
        return CONFIDENCE_MODERATE
    return CONFIDENCE_HIGH


def wilson_lower_bound(successes: int, n: int, z: float = 1.96) -> float | None:
    """Wilson score interval lower bound at ~95%.

    This is the shrinkage that makes small samples safe. A source at 1/1 gets a
    lower bound of ~0.05, not 1.0, so it can never outrank a source at 140/200
    (~0.63). Returns None for n <= 0.
    """
    if n <= 0:
        return None
    p = successes / n
    denom = 1.0 + (z * z) / n
    center = p + (z * z) / (2 * n)
    margin = z * math.sqrt((p * (1.0 - p) + (z * z) / (4 * n)) / n)
    return max(0.0, (center - margin) / denom)


def _norm(value) -> str:
    return str(value or "").strip().lower()


#: Separators used in this corpus's compound sector labels
#: ("Energy & Oil/Gas", "Healthcare & Biotech", "Industrials & Manufacturing").
_SECTOR_SPLIT = re.compile(r"[&/,]| and ")


def resolve_sector_etf(label) -> str | None:
    """Resolve an article's sector label to a sector ETF symbol.

    `benchmarks.sector_etf_for_label` does an exact lowercased dict lookup, and
    this corpus stores COMPOUND labels ("Energy & Oil/Gas") that are not keys.
    So: try the whole label, then each component. Every component that resolves
    must resolve to the SAME ETF -- an ambiguous compound returns None rather
    than picking a side, because a wrong sector match silently attributes a
    resolved call to outlets that never covered it.
    """
    if not label:
        return None
    direct = sector_etf_for_label(str(label))
    if direct:
        return direct

    # Components first ("Energy & Oil/Gas" -> energy, oil, gas), then bare word
    # tokens, because some labels carry no separator at all ("Financial
    # Services", where only the word "financial" is a map key).
    candidates: list[str] = []
    for part in _SECTOR_SPLIT.split(str(label)):
        part = part.strip()
        if part:
            candidates.append(part)
            candidates.extend(part.split())

    found: set[str] = set()
    for cand in candidates:
        etf = sector_etf_for_label(cand)
        if etf:
            found.add(etf)
    if len(found) == 1:
        return found.pop()
    return None


def article_matches_call(article: dict, call: dict,
                         ticker_names: dict | None = None) -> bool:
    """True when an article plausibly concerns the call's subject.

    Sector calls carry an ETF as `target_symbol` (XLE, XLK, ...), so BOTH sides
    are resolved into ETF space and compared there.

    Ticker calls match the symbol as a standalone token, or the company name
    resolved from `ticker_names` (the companies table), against the article's
    primary_company / companies / title.

    Anything we cannot tie to the call is excluded, keeping the fan-out scoped
    to the call's own subject rather than the whole brief.
    """
    claim_type = _norm(call.get("claim_type"))
    target = (call.get("target_symbol") or "").strip()
    if not target:
        return False

    if claim_type == "sector":
        want = sector_etf_for_label(target) or target.upper()
        got = resolve_sector_etf(article.get("sector"))
        return bool(got and got == want)

    haystack_parts = [
        _norm(article.get("primary_company")),
        _norm(article.get("title")),
    ]
    companies = article.get("companies")
    if isinstance(companies, str):
        try:
            companies = json.loads(companies)
        except Exception:
            companies = []
    if isinstance(companies, list):
        haystack_parts.extend(_norm(c) for c in companies)

    upper = target.upper()
    company_name = _norm((ticker_names or {}).get(upper))

    for part in haystack_parts:
        if not part:
            continue
        # Ticker as a standalone token, so "AI" does not match "said".
        if upper in [tok.strip(".,:;()[]'\"").upper() for tok in part.split()]:
            return True
        if company_name and company_name in part:
            return True
    return False


def aggregate(outcomes: list[dict], calls_by_id: dict, briefs_by_id: dict,
              articles_by_id: dict,
              ticker_names: dict | None = None) -> tuple[list[dict], dict]:
    """Build per-identity reliability rows from clean directional outcomes.

    Returns `(rows, stats)`. Pure: all IO happens in the caller, so this is
    directly testable with fixtures.
    """
    stats = {
        "outcomes_considered": len(outcomes),
        "outcomes_used": 0,
        "skipped_no_call": 0,
        "skipped_claim_type": 0,
        "skipped_no_brief": 0,
        "skipped_no_matching_article": 0,
        "skipped_no_identity": 0,
    }

    acc: dict[str, dict] = defaultdict(
        lambda: {
            "n_clean": 0,
            "n_correct": 0,
            "n_wrong": 0,
            "credit_weight": 0.0,
            "symbols": set(),
            "is_syndicator": False,
            "last_outcome_at": None,
        }
    )

    for o in outcomes:
        verdict = _norm(o.get("verdict"))
        if _norm(o.get("attribution")) != CLEAN_ATTRIBUTION:
            continue
        if verdict not in DIRECTIONAL_VERDICTS:
            continue

        call = calls_by_id.get(o.get("call_id"))
        if not call:
            stats["skipped_no_call"] += 1
            continue
        if _norm(call.get("claim_type")) in EXCLUDED_CLAIM_TYPES:
            stats["skipped_claim_type"] += 1
            continue

        brief = briefs_by_id.get(call.get("brief_id"))
        if not brief:
            stats["skipped_no_brief"] += 1
            continue

        rail = brief.get("story_rail_ids") or []
        if isinstance(rail, str):
            try:
                rail = json.loads(rail)
            except Exception:
                rail = []

        matched = []
        for aid in rail:
            art = articles_by_id.get(aid)
            if art and article_matches_call(art, call, ticker_names):
                matched.append(art)
        if not matched:
            stats["skipped_no_matching_article"] += 1
            continue

        identities: dict[str, dict] = {}
        for art in matched:
            ident = attribution_identity(
                art.get("publisher"), art.get("publisher_domain"), art.get("source")
            )
            if not ident:
                continue
            identities.setdefault(ident, art)

        if not identities:
            stats["skipped_no_identity"] += 1
            continue

        stats["outcomes_used"] += 1
        share = 1.0 / len(identities)
        graded_at = o.get("graded_at")

        for ident, art in identities.items():
            a = acc[ident]
            a["n_clean"] += 1
            if verdict == "correct":
                a["n_correct"] += 1
            else:
                a["n_wrong"] += 1
            a["credit_weight"] += share
            if call.get("target_symbol"):
                a["symbols"].add(str(call["target_symbol"]).upper())
            if is_syndicator(art.get("publisher"), art.get("publisher_domain"),
                             art.get("source")):
                a["is_syndicator"] = True
            if graded_at and (a["last_outcome_at"] is None
                              or str(graded_at) > str(a["last_outcome_at"])):
                a["last_outcome_at"] = graded_at

    now_iso = datetime.now(timezone.utc).isoformat()
    rows: list[dict] = []
    for ident, a in acc.items():
        n = a["n_clean"]
        label = confidence_label(n)
        reportable = n >= MIN_REPORTABLE_N
        rows.append({
            "identity": ident,
            "n_clean_outcomes": n,
            "n_correct": a["n_correct"],
            "n_wrong": a["n_wrong"],
            "credit_weight": round(a["credit_weight"], 4),
            "distinct_symbols": len(a["symbols"]),
            # Accuracy is withheld below the reportable bar ON PURPOSE. A NULL
            # here is the honest answer; a number would invite a reader to rank
            # on it.
            "accuracy": round(a["n_correct"] / n, 4) if (reportable and n) else None,
            "wilson_lower_95": (
                round(wilson_lower_bound(a["n_correct"], n), 4) if reportable else None
            ),
            "confidence": label,
            "is_syndicator": a["is_syndicator"],
            "ready_for_weighting": n >= READY_FOR_WEIGHTING_N,
            "attribution_method": ATTRIBUTION_METHOD,
            "last_outcome_at": a["last_outcome_at"],
            "updated_at": now_iso,
        })

    rows.sort(key=lambda r: (-r["n_clean_outcomes"], r["identity"]))
    return rows, stats


# ==========================================================================
# IO
# ==========================================================================

def _chunk(seq: list, size: int = 200):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def load_inputs(supabase) -> tuple[list[dict], dict, dict, dict, dict]:
    """Fetch the clean directional outcomes and everything needed to attribute
    them. Every query is bounded and keyed; nothing scans the articles table.

    Raises on query failure. A read that fails must NOT look like "no data".
    """
    resp = (
        supabase.table("morning_brief_call_outcomes")
        .select("call_id, verdict, attribution, graded_at")
        .eq("attribution", CLEAN_ATTRIBUTION)
        .in_("verdict", list(DIRECTIONAL_VERDICTS))
        .limit(5000)
        .execute()
    )
    outcomes = resp.data or []
    if not outcomes:
        return [], {}, {}, {}, {}

    call_ids = sorted({o["call_id"] for o in outcomes if o.get("call_id")})
    calls: list[dict] = []
    for chunk in _chunk(call_ids):
        r = (
            supabase.table("morning_brief_calls")
            .select("id, brief_id, target_symbol, claim_type, brief_date")
            .in_("id", chunk)
            .execute()
        )
        calls.extend(r.data or [])
    calls_by_id = {c["id"]: c for c in calls}

    brief_ids = sorted({c["brief_id"] for c in calls if c.get("brief_id")})
    briefs: list[dict] = []
    for chunk in _chunk(brief_ids):
        r = (
            supabase.table("briefings")
            .select("id, story_rail_ids")
            .in_("id", chunk)
            .execute()
        )
        briefs.extend(r.data or [])
    briefs_by_id = {b["id"]: b for b in briefs}

    article_ids: set = set()
    for b in briefs:
        rail = b.get("story_rail_ids") or []
        if isinstance(rail, str):
            try:
                rail = json.loads(rail)
            except Exception:
                rail = []
        article_ids.update(rail)

    # The publisher columns arrive with sql/0025. Probe once and fall back so
    # this job runs (and can be dry-run verified) before the migration is
    # applied. The fallback is NOT silent: it is logged, and without publisher
    # data every Google News row resolves to no identity and is skipped rather
    # than being attributed to a feed name.
    article_cols = ("id, source, publisher, publisher_domain, primary_company, "
                    "companies, sector, title")
    try:
        supabase.table("articles").select(article_cols).limit(1).execute()
    except Exception as e:
        if "publisher" not in str(e):
            raise
        article_cols = "id, source, primary_company, companies, sector, title"
        print("  [source_reliability] NOTE: articles.publisher missing "
              f"(apply {SOURCE_RELIABILITY_DDL_HINT}); running without publisher identity")

    articles: list[dict] = []
    for chunk in _chunk(sorted(article_ids)):
        r = (
            supabase.table("articles")
            .select(article_cols)
            .in_("id", chunk)
            .execute()
        )
        articles.extend(r.data or [])
    articles_by_id = {a["id"]: a for a in articles}

    # ticker -> company name, so a call on UNH can match an article whose
    # primary_company is "UnitedHealth Group". One bounded .in_() query.
    wanted = sorted({(c.get("target_symbol") or "").strip().upper()
                     for c in calls if c.get("target_symbol")})
    ticker_names: dict[str, str] = {}
    for chunk in _chunk(wanted):
        r = (
            supabase.table("companies")
            .select("ticker, name")
            .in_("ticker", chunk)
            .execute()
        )
        for row in r.data or []:
            t = (row.get("ticker") or "").strip().upper()
            n = (row.get("name") or "").strip()
            if t and n and t not in ticker_names:
                ticker_names[t] = n

    return outcomes, calls_by_id, briefs_by_id, articles_by_id, ticker_names


def upsert_rows(supabase, rows: list[dict]) -> int:
    if not rows:
        return 0
    supabase.table("source_reliability").upsert(rows, on_conflict="identity").execute()
    return len(rows)


def main(dry_run: bool = False) -> dict | None:
    try:
        from supabase_client import get_service_client
    except ImportError:
        from backend.supabase_client import get_service_client

    supabase = get_service_client()

    outcomes, calls, briefs, articles, ticker_names = load_inputs(supabase)
    rows, stats = aggregate(outcomes, calls, briefs, articles, ticker_names)

    reportable = [r for r in rows if r["confidence"] != CONFIDENCE_INSUFFICIENT]
    ready = [r for r in rows if r["ready_for_weighting"]]

    print(f"  [source_reliability] clean directional outcomes: {stats['outcomes_considered']}")
    print(f"  [source_reliability] attributed: {stats['outcomes_used']}  "
          f"skipped: no_call={stats['skipped_no_call']} "
          f"claim_type={stats['skipped_claim_type']} "
          f"no_brief={stats['skipped_no_brief']} "
          f"no_match={stats['skipped_no_matching_article']} "
          f"no_identity={stats['skipped_no_identity']}")
    print(f"  [source_reliability] identities: {len(rows)}  "
          f"reportable (n>={MIN_REPORTABLE_N}): {len(reportable)}  "
          f"ready for weighting (n>={READY_FOR_WEIGHTING_N}): {len(ready)}")

    for r in rows[:15]:
        acc = "n/a" if r["accuracy"] is None else f"{r['accuracy']:.2f}"
        wl = "n/a" if r["wilson_lower_95"] is None else f"{r['wilson_lower_95']:.2f}"
        print(f"    {r['identity'][:34]:36s} n={r['n_clean_outcomes']:3d} "
              f"({r['n_correct']}c/{r['n_wrong']}w) acc={acc:>5s} wilson={wl:>5s} "
              f"conf={r['confidence']:12s} synd={r['is_syndicator']}")

    if dry_run:
        print("  [source_reliability] DRY RUN - nothing written")
        return {"rows": len(rows), "stats": stats, "dry_run": True}

    written = upsert_rows(supabase, rows)
    print(f"  [source_reliability] upserted={written}")
    return {"rows": len(rows), "upserted": written, "stats": stats}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true",
                    help="compute and print without writing")
    args = ap.parse_args()
    try:
        main(dry_run=args.dry_run)
    except Exception as e:
        # Fail loud. A read failure must never be reported as an empty signal.
        print(f"  [source_reliability] FAILED: {type(e).__name__}: {e}", file=sys.stderr)
        raise
