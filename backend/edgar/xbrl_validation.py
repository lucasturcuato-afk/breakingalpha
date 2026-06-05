"""Runtime validation gate for extracted XBRL financial facts.

Every fact leaves this module with validation_status 'validated' or
'quarantined' (+ validation_reason). The product is fail-closed: the
financial_facts_latest view and every read path expose ONLY validated facts;
quarantined facts are stored for review and never surfaced.

The battery (deliberately high-value, NOT an accounting-rules engine):

  Tie-outs (per period, on the latest-filed value):
    * gross_profit == revenue - cost_of_revenue
    * total_assets == total_liabilities + stockholders_equity
    * eps ~= net_income / weighted shares (loose: NI-to-common adjustments
      like preferred dividends / NCI are not modeled; this catches scale and
      sign errors, not penny rounding)
    * derived discrete OCF quarters roll up to the fiscal-year total

  Bounds:
    * revenue >= 0
    * gross margin within (-100%, 100%] (the spike's 570% failure mode)
    * discrete-quarter revenue QoQ jump > 10x (on a >= $10M base) is flagged
    * |EPS| > $100k/share (catches unit errors; Berkshire-A is ~$60k)

  Cross-endpoint reconciliation (network, injectable):
    * every reported fact must match the Company Concept endpoint TO THE
      DOLLAR (same dataset, different API path: catches our own parse bugs)

Tolerances: filers report in round thousands and the spike tied out to the
dollar, so tie-out slack is rounding-scale (max($2M, 0.5%)), the balance-sheet
equation gets 1% for noncontrolling-interest gaps, and the EPS check is
intentionally loose (max($0.05, 10%)).

A failed check quarantines EVERY accession of the affected metric+period
(fail-closed: a broken tie-out doesn't say which side is wrong).
"""
from __future__ import annotations

import logging
from typing import Optional

from backend.edgar.xbrl_facts import ConceptFetcher, fetch_company_concept

logger = logging.getLogger(__name__)

VALIDATED = "validated"
QUARANTINED = "quarantined"

# --- tolerances -------------------------------------------------------------
TIE_ABS_USD = 2_000_000          # rounding slack on USD tie-outs
TIE_REL = 0.005                  # 0.5%
BALANCE_REL = 0.01               # NCI / equity-variant slack
EPS_ABS = 0.05
EPS_REL = 0.10
CF_ROLL_ABS_USD = 5_000_000
CF_ROLL_REL = 0.01
QOQ_JUMP_RATIO = 10.0
QOQ_MIN_BASE_USD = 10_000_000
EPS_MAGNITUDE_MAX = 100_000.0


def _close(a: float, b: float, *, abs_tol: float, rel_tol: float) -> bool:
    return abs(a - b) <= max(abs_tol, rel_tol * max(abs(a), abs(b)))


def _quarantine(fact: dict, reason: str) -> None:
    fact["validation_status"] = QUARANTINED
    existing = fact.get("validation_reason")
    if existing:
        if reason not in existing:
            fact["validation_reason"] = f"{existing}; {reason}"
    else:
        fact["validation_reason"] = reason


def _index(facts: list[dict]) -> dict[tuple, list[dict]]:
    """metric+period -> every accession of that fact (incl. derived)."""
    idx: dict[tuple, list[dict]] = {}
    for f in facts:
        k = (f["metric_key"], f["period_start"], f["period_end"])
        idx.setdefault(k, []).append(f)
    return idx


def _current(facts: list[dict]) -> dict[tuple, dict]:
    """metric+period -> latest-filed fact (the restatement-aware value)."""
    cur: dict[tuple, dict] = {}
    for f in facts:
        k = (f["metric_key"], f["period_start"], f["period_end"])
        prev = cur.get(k)
        if prev is None or (f["filed_date"] or "") > (prev["filed_date"] or ""):
            cur[k] = f
    return cur


def _quarantine_period(idx, metric_key, ps, pe, reason) -> None:
    for f in idx.get((metric_key, ps, pe), []):
        _quarantine(f, reason)


def _periods_of(cur: dict[tuple, dict], metric_key: str) -> dict[tuple, dict]:
    return {(ps, pe): f for (mk, ps, pe), f in cur.items() if mk == metric_key}


# --- the battery ------------------------------------------------------------

def _check_gross_profit_tie(idx, cur) -> None:
    rev = _periods_of(cur, "revenue")
    cor = _periods_of(cur, "cost_of_revenue")
    gp = _periods_of(cur, "gross_profit")
    for period in rev.keys() & cor.keys() & gp.keys():
        implied = rev[period]["value"] - cor[period]["value"]
        if not _close(implied, gp[period]["value"],
                      abs_tol=TIE_ABS_USD, rel_tol=TIE_REL):
            reason = (f"tieout_gross_profit: rev-cor={implied:.0f} "
                      f"!= gp={gp[period]['value']:.0f}")
            for mk in ("revenue", "cost_of_revenue", "gross_profit"):
                _quarantine_period(idx, mk, period[0], period[1], reason)


def _check_balance_equation(idx, cur) -> None:
    """Assets == Liabilities + Equity, completed for GAAP balance-sheet
    slices that sit OUTSIDE both L and E: noncontrolling interests (when the
    resolved equity tag is parent-only, e.g. RTX) and temporary/mezzanine
    equity (redeemable preferred / redeemable NCI, e.g. WDC, MicroStrategy).
    Each reported slice is an optional adder; the identity passes if ANY
    subset ties at rounding tolerance. Tolerances are unchanged - this
    completes the identity, it does not loosen it."""
    from itertools import combinations

    assets = _periods_of(cur, "total_assets")
    liab = _periods_of(cur, "total_liabilities")
    eq = _periods_of(cur, "stockholders_equity")
    adder_metrics = ("minority_interest", "temporary_equity",
                     "redeemable_noncontrolling_interest")
    adders = {m: _periods_of(cur, m) for m in adder_metrics}
    for period in assets.keys() & liab.keys() & eq.keys():
        lhs = assets[period]["value"]
        base = liab[period]["value"] + eq[period]["value"]
        present = [adders[m][period]["value"]
                   for m in adder_metrics if period in adders[m]]
        candidates = [base]
        for r in range(1, len(present) + 1):
            for combo in combinations(present, r):
                candidates.append(base + sum(combo))
        if not any(_close(lhs, c, abs_tol=TIE_ABS_USD, rel_tol=BALANCE_REL)
                   for c in candidates):
            reason = (f"tieout_balance_sheet: assets={lhs:.0f} "
                      f"!= liab+equity(+nci/tempeq)="
                      f"{[f'{c:.0f}' for c in sorted(set(candidates))]}")
            for mk in ("total_assets", "total_liabilities", "stockholders_equity"):
                _quarantine_period(idx, mk, period[0], period[1], reason)


def _check_eps(idx, cur) -> None:
    """Reported EPS is on net income available to COMMON. Numerator priority:
    1. the directly tagged NetIncomeLossAvailableToCommonStockholders*
    2. NetIncomeLoss minus preferred dividends (when tagged)
    3. NetIncomeLoss (issuers without preferred/NCI adjustments)
    Tolerances unchanged - correct identity, not looser bounds."""
    for eps_key, shares_key, common_key in (
            ("eps_basic", "shares_basic", "ni_available_to_common_basic"),
            ("eps_diluted", "shares_diluted", "ni_available_to_common_diluted")):
        eps = _periods_of(cur, eps_key)
        ni = _periods_of(cur, "net_income")
        ni_common = _periods_of(cur, common_key)
        pref = _periods_of(cur, "preferred_dividends")
        shares = _periods_of(cur, shares_key)
        for period in eps.keys() & shares.keys():
            n = shares[period]["value"]
            if not n:
                continue
            if period in ni_common:
                numerator, basis = ni_common[period]["value"], "ni_common"
            elif period in ni and period in pref:
                numerator = ni[period]["value"] - pref[period]["value"]
                basis = "ni-pref_div"
            elif period in ni:
                numerator, basis = ni[period]["value"], "ni"
            else:
                continue
            implied = numerator / n
            if not _close(implied, eps[period]["value"],
                          abs_tol=EPS_ABS, rel_tol=EPS_REL):
                _quarantine_period(
                    idx, eps_key, period[0], period[1],
                    f"tieout_eps: {basis}/shares={implied:.2f} "
                    f"!= {eps_key}={eps[period]['value']:.2f}",
                )


def _check_cash_flow_roll(idx, cur) -> None:
    """Derived discrete quarters of one fiscal year must sum to the FY total."""
    ocf = _periods_of(cur, "operating_cash_flow")
    # FY totals: duration spanning ~a year
    for (fy_ps, fy_pe), fy_fact in ocf.items():
        if fy_fact["is_derived"] or not _is_annual_span(fy_ps, fy_pe) \
                or fy_fact.get("fiscal_period") == "TTM":
            continue
        pieces = [
            f for (ps, pe), f in ocf.items()
            if fy_ps <= ps and pe <= fy_pe and (ps, pe) != (fy_ps, fy_pe)
            and (f["is_derived"] or _is_quarter_span(ps, pe))
        ]
        # only meaningful when the year is fully covered by 4 discrete pieces
        if len(pieces) != 4:
            continue
        total = sum(f["value"] for f in pieces)
        if not _close(total, fy_fact["value"],
                      abs_tol=CF_ROLL_ABS_USD, rel_tol=CF_ROLL_REL):
            reason = (f"tieout_cf_roll: sum(quarters)={total:.0f} "
                      f"!= fy={fy_fact['value']:.0f}")
            for f in pieces:
                if f["is_derived"]:
                    _quarantine(f, reason)


def _is_quarter_span(ps: str, pe: str) -> bool:
    return _span(ps, pe) is not None and 60 <= _span(ps, pe) <= 120


def _is_annual_span(ps: str, pe: str) -> bool:
    return _span(ps, pe) is not None and 330 <= _span(ps, pe) <= 400


def _span(ps: str, pe: str) -> Optional[int]:
    from datetime import date
    try:
        return (date.fromisoformat(pe) - date.fromisoformat(ps)).days
    except (ValueError, TypeError):
        return None


def _check_bounds(idx, cur) -> None:
    # revenue >= 0
    for (ps, pe), f in _periods_of(cur, "revenue").items():
        if f["value"] < 0:
            _quarantine_period(idx, "revenue", ps, pe,
                               f"bounds_negative_revenue: {f['value']:.0f}")

    # gross margin plausibility (the 570% failure mode)
    rev = _periods_of(cur, "revenue")
    gp = _periods_of(cur, "gross_profit")
    for period in rev.keys() & gp.keys():
        r = rev[period]["value"]
        if r <= 0:
            continue
        gm = gp[period]["value"] / r
        if gm > 1.001 or gm < -1.0:
            reason = f"bounds_gross_margin: {gm * 100:.1f}%"
            _quarantine_period(idx, "revenue", period[0], period[1], reason)
            _quarantine_period(idx, "gross_profit", period[0], period[1], reason)

    # implausible discrete-quarter revenue jumps
    quarters = sorted(
        (f for (ps, pe), f in rev.items() if _is_quarter_span(ps, pe)),
        key=lambda f: f["period_end"],
    )
    for prev, nxt in zip(quarters, quarters[1:]):
        if abs(prev["value"]) < QOQ_MIN_BASE_USD:
            continue
        if abs(nxt["value"]) > abs(prev["value"]) * QOQ_JUMP_RATIO:
            _quarantine_period(
                idx, "revenue", nxt["period_start"], nxt["period_end"],
                f"bounds_qoq_jump: {prev['value']:.0f} -> {nxt['value']:.0f}",
            )

    # EPS magnitude (unit errors)
    for eps_key in ("eps_basic", "eps_diluted"):
        for (ps, pe), f in _periods_of(cur, eps_key).items():
            if abs(f["value"]) > EPS_MAGNITUDE_MAX:
                _quarantine_period(idx, eps_key, ps, pe,
                                   f"bounds_eps_magnitude: {f['value']:.2f}")


def _check_cross_endpoint(facts: list[dict], cik: int,
                          concept_fetcher: ConceptFetcher) -> None:
    """
    Reported facts must match the Company Concept endpoint to the dollar.
    Derived facts are skipped (their inputs are reconciled instead).
    """
    tags = sorted({
        (f["taxonomy"], f["concept_tag"]) for f in facts if not f["is_derived"]
    })
    oracle: dict[tuple, set] = {}
    failed_fetch: set[tuple] = set()
    for taxonomy, tag in tags:
        doc = concept_fetcher(cik, taxonomy, tag)
        if not doc:
            failed_fetch.add((taxonomy, tag))
            continue
        for unit, unit_facts in doc.get("units", {}).items():
            for f in unit_facts:
                key = (tag, unit, f.get("start"), f.get("end"), f.get("accn"))
                oracle.setdefault(key, set()).add(f.get("val"))

    for f in facts:
        if f["is_derived"]:
            continue
        if (f["taxonomy"], f["concept_tag"]) in failed_fetch:
            # fail closed: cannot reconcile -> do not publish
            _quarantine(f, "cross_endpoint_unavailable")
            continue
        start = f["period_start"] if f["period_type"] == "duration" else None
        key = (f["concept_tag"], f["unit"], start, f["period_end"],
               f["accession_number"])
        vals = oracle.get(key)
        if not vals or f["value"] not in vals:
            _quarantine(
                f,
                f"cross_endpoint_mismatch: companyconcept={sorted(vals) if vals else 'missing'} "
                f"companyfacts={f['value']}",
            )


# --- entry point ------------------------------------------------------------

def validate_facts(
    facts: list[dict],
    cik: int,
    *,
    concept_fetcher: Optional[ConceptFetcher] = fetch_company_concept,
) -> dict:
    """
    Assign validation_status/validation_reason to every fact IN PLACE and
    return a summary. Pass concept_fetcher=None to skip the (network)
    cross-endpoint check, e.g. in offline unit tests; the production ingest
    must leave it enabled.
    """
    for f in facts:
        f["validation_status"] = VALIDATED
        f["validation_reason"] = None

    # Rolling trailing-12-month figures are stored (so upserts overwrite any
    # previously mislabeled row) but never published: quarantine on sight.
    for f in facts:
        if f.get("fiscal_period") == "TTM":
            _quarantine(f, "ttm_not_published: rolling twelve-month figure")

    # Dual-tag divergence (Cheniere class): a BROADER family concept (e.g.
    # us-gaap:Revenues, the statement total) reported the same period with a
    # diverging value, so publishing this narrower fact would understate the
    # total. Extraction annotates (see _broader_divergence); fail closed.
    for f in facts:
        if f.get("dual_tag_conflict"):
            _quarantine(f, f["dual_tag_conflict"])

    idx = _index(facts)
    cur = _current(facts)

    _check_gross_profit_tie(idx, cur)
    _check_balance_equation(idx, cur)
    _check_eps(idx, cur)
    _check_cash_flow_roll(idx, cur)
    _check_bounds(idx, cur)
    if concept_fetcher is not None:
        _check_cross_endpoint(facts, cik, concept_fetcher)

    quarantined = [f for f in facts if f["validation_status"] == QUARANTINED]
    summary = {
        "total": len(facts),
        "validated": len(facts) - len(quarantined),
        "quarantined": len(quarantined),
        "reasons": sorted({
            (f["validation_reason"] or "").split(":")[0]
            for f in quarantined
        }),
    }
    if quarantined:
        logger.warning("[xbrl] cik=%d quarantined %d/%d facts (%s)",
                       cik, len(quarantined), len(facts), summary["reasons"])
    return summary


def validated_only(facts: list[dict]) -> list[dict]:
    """The ONLY sanctioned way to read facts for publication (fail-closed)."""
    return [f for f in facts if f.get("validation_status") == VALIDATED]
