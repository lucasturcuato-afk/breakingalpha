"""XBRL financial-fact extraction from the SEC Company Facts API.

Pulls data.sec.gov/api/xbrl/companyfacts/CIK##########.json and extracts the
v1 line-item set with full provenance, applying the correctness rules proven
by the WD-XBRL spike (docs/xbrl-financial-facts-spec.md):

  * Tag resolution: union all candidate tags per metric, resolve each period
    to the issuer's CURRENTLY ACTIVE tag (latest max period_end), never
    first-tag-wins. (NVDA migrated revenue tags; first-tag-wins returned a
    4-year-stale value and a 570% gross margin.)
  * Period context: instant facts (balance sheet) are stored with
    period_start == period_end; duration facts keep their true span.
  * YTD cash flow: 10-Q cash-flow facts are cumulative YTD. Discrete quarters
    are derived by differencing consecutive YTD values (and FY minus 9-month
    YTD for Q4), emitted as is_derived rows that cite the minuend filing.
  * Fiscal vs calendar: issuer fiscal labels (fy/fp) are stored alongside the
    actual period dates and the SEC calendar frame; fy != calendar year.
  * Every fact is keyed by source accession so restatements are preserved.

Read side note: facts here are UNVALIDATED. backend/edgar/xbrl_validation.py
assigns validation_status; only 'validated' facts may surface in the product.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Callable, Optional

from backend.edgar.client import sec_get

logger = logging.getLogger(__name__)

# Forms whose facts we trust for structured financials. 8-K earnings exhibits
# are inconsistently tagged; periodic reports (+ amendments) only for v1.
XBRL_FORMS = {"10-K", "10-Q", "10-K/A", "10-Q/A"}

# v1 metric map: metric_key -> (period kind, ordered candidate us-gaap tags).
# Order is a tie-break only; period-aware resolution does the real work.
# Tag variants observed in the spike are annotated.
XBRL_CONCEPTS: list[tuple[str, str, list[str]]] = [
    ("revenue", "duration", [
        "RevenueFromContractWithCustomerExcludingAssessedTax",  # AAPL, DDOG, SNOW
        "Revenues",                                             # NVDA (post-migration)
        "RevenueFromContractWithCustomerIncludingAssessedTax",  # CRWD
        "SalesRevenueNet",                                      # pre-ASC-606 filers
    ]),
    ("cost_of_revenue", "duration", [
        "CostOfRevenue",                 # NVDA
        "CostOfGoodsAndServicesSold",    # AAPL, CRWD, DDOG, SNOW
    ]),
    ("gross_profit", "duration", ["GrossProfit"]),
    ("operating_income", "duration", ["OperatingIncomeLoss"]),
    ("net_income", "duration", ["NetIncomeLoss"]),
    ("eps_basic", "duration", ["EarningsPerShareBasic"]),
    ("eps_diluted", "duration", ["EarningsPerShareDiluted"]),
    ("shares_basic", "duration", ["WeightedAverageNumberOfSharesOutstandingBasic"]),
    ("shares_diluted", "duration", ["WeightedAverageNumberOfDilutedSharesOutstanding"]),
    ("operating_cash_flow", "duration", [
        "NetCashProvidedByUsedInOperatingActivities",
        "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ]),
    ("total_assets", "instant", ["Assets"]),
    ("total_liabilities", "instant", ["Liabilities"]),
    ("stockholders_equity", "instant", [
        "StockholdersEquity",
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",  # SNOW 10-Q
    ]),
    # auxiliary: lets the balance-sheet tie-out reconcile parent-only equity
    # (Assets = Liabilities + ParentEquity + NCI, e.g. RTX)
    ("minority_interest", "instant", ["MinorityInterest"]),
    ("cash_and_equivalents", "instant", ["CashAndCashEquivalentsAtCarryingValue"]),
]

# Discrete fiscal quarters are ~91 days; spans outside this band are not a
# quarter (13/14-week retail calendars and 53-week years stay inside it).
QUARTER_SPAN_MIN_DAYS = 60
QUARTER_SPAN_MAX_DAYS = 120


def fetch_company_facts(cik: int) -> Optional[dict]:
    """Fetch the full Company Facts JSON for a CIK. None on failure."""
    padded = str(cik).zfill(10)
    resp = sec_get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{padded}.json")
    if not resp:
        return None
    try:
        return resp.json()
    except Exception as e:
        logger.error("[xbrl] companyfacts parse failed for CIK %d: %s", cik, e)
        return None


def fetch_company_concept(cik: int, taxonomy: str, tag: str) -> Optional[dict]:
    """Fetch the single-concept endpoint (used as a cross-check oracle)."""
    padded = str(cik).zfill(10)
    url = f"https://data.sec.gov/api/xbrl/companyconcept/CIK{padded}/{taxonomy}/{tag}.json"
    resp = sec_get(url)
    if not resp:
        return None
    try:
        return resp.json()
    except Exception as e:
        logger.error("[xbrl] companyconcept parse failed for %s: %s", tag, e)
        return None


def build_filing_url(cik: int, accession_number: str) -> str:
    """EDGAR filing index URL for provenance links."""
    accn = (accession_number or "").replace("-", "")
    return f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accn}/"


def _raw_facts_for_tag(us_gaap: dict, tag: str, kind: str) -> list[dict]:
    """Flatten one concept's units block into raw fact dicts, form-filtered."""
    out = []
    for unit, facts in us_gaap.get(tag, {}).get("units", {}).items():
        for f in facts:
            if f.get("form") not in XBRL_FORMS:
                continue
            has_start = "start" in f
            if kind == "instant" and has_start:
                continue
            if kind == "duration" and not has_start:
                continue
            if f.get("val") is None or not f.get("end"):
                continue
            out.append({
                "tag": tag,
                "unit": unit,
                "val": f["val"],
                "start": f.get("start"),
                "end": f["end"],
                "accn": f.get("accn"),
                "fy": f.get("fy"),
                "fp": f.get("fp"),
                "form": f.get("form"),
                "filed": f.get("filed"),
                "frame": f.get("frame"),
            })
    return out


def _period_key(kind: str, f: dict) -> tuple:
    start = f["start"] if kind == "duration" else f["end"]
    return (start, f["end"], f["unit"])


def _resolve_metric(us_gaap: dict, metric_key: str, kind: str,
                    candidates: list[str]) -> list[dict]:
    """
    Resolve one metric across its candidate tags.

    For each distinct period, exactly one tag wins: the candidate whose own
    facts reach the latest period_end overall (the issuer's currently active
    tag), tie-broken by candidate order. All accessions for the winning
    tag+period are kept (restatement history).
    """
    per_tag: dict[str, list[dict]] = {}
    for tag in candidates:
        facts = _raw_facts_for_tag(us_gaap, tag, kind)
        if facts:
            per_tag[tag] = facts
    if not per_tag:
        return []

    # Activity rank: latest end date seen under each tag; candidate order breaks ties.
    def activity(tag: str) -> tuple:
        latest = max(f["end"] for f in per_tag[tag])
        return (latest, -candidates.index(tag))

    ranked = sorted(per_tag, key=activity, reverse=True)

    chosen: dict[tuple, str] = {}  # period key -> winning tag
    for tag in ranked:
        for f in per_tag[tag]:
            chosen.setdefault(_period_key(kind, f), tag)

    out = []
    for tag, facts in per_tag.items():
        for f in facts:
            if chosen[_period_key(kind, f)] == tag:
                out.append(_to_fact_row(metric_key, kind, f))
    return out


def _to_fact_row(metric_key: str, kind: str, f: dict) -> dict:
    return {
        "metric_key": metric_key,
        "taxonomy": "us-gaap",
        "concept_tag": f["tag"],
        "value": f["val"],
        "unit": f["unit"],
        "period_type": kind,
        # instant facts: start == end (uniform NOT NULL key for upserts)
        "period_start": f["start"] if kind == "duration" else f["end"],
        "period_end": f["end"],
        "fiscal_year": f["fy"],
        "fiscal_period": f["fp"],
        "sec_frame": f["frame"],
        "form": f["form"],
        "filed_date": f["filed"],
        "accession_number": f["accn"],
        "is_derived": False,
        "derivation": None,
    }


def _span_days(fact: dict) -> int:
    try:
        return (date.fromisoformat(fact["period_end"])
                - date.fromisoformat(fact["period_start"])).days
    except (ValueError, TypeError):
        return -1


def _latest_filed_per_period(facts: list[dict]) -> dict[tuple, dict]:
    """Current value per period: max filed_date wins (restatement-aware)."""
    current: dict[tuple, dict] = {}
    for f in facts:
        k = (f["period_start"], f["period_end"], f["unit"])
        cur = current.get(k)
        if cur is None or (f["filed_date"] or "") > (cur["filed_date"] or ""):
            current[k] = f
    return current


def derive_discrete_cash_flow(ocf_facts: list[dict]) -> list[dict]:
    """
    Derive discrete-quarter operating cash flow from cumulative YTD facts.

    10-Q cash-flow statements report YTD only (spike: AAPL Q2 OCF span was 6
    months, CRWD Q3 span 9 months, frame=-). Facts sharing a period_start
    belong to one fiscal year; sorted by period_end, consecutive diffs yield
    the discrete quarters (the 10-K annual fact, sharing the start, yields Q4).
    The first fact in a group is already discrete iff its span is one quarter.

    Derived rows cite the minuend filing (accession/form/filed/fiscal labels)
    and carry is_derived=True, derivation='ytd_diff'. sec_frame is left None:
    the SEC frame belongs to reported facts, not computed ones.
    """
    current = _latest_filed_per_period(ocf_facts)

    groups: dict[tuple, list[dict]] = {}
    for f in current.values():
        groups.setdefault((f["period_start"], f["unit"]), []).append(f)

    derived = []
    for (_start, _unit), facts in groups.items():
        facts.sort(key=lambda f: f["period_end"])
        for prev, cur in zip(facts, facts[1:]):
            try:
                d_start = date.fromisoformat(prev["period_end"]) + timedelta(days=1)
                span = (date.fromisoformat(cur["period_end"]) - d_start).days + 1
            except (ValueError, TypeError):
                continue
            if not (QUARTER_SPAN_MIN_DAYS <= span <= QUARTER_SPAN_MAX_DAYS):
                logger.warning(
                    "[xbrl] skipping ytd diff with non-quarter span %dd (%s -> %s)",
                    span, prev["period_end"], cur["period_end"],
                )
                continue
            derived.append({
                **cur,
                "value": cur["value"] - prev["value"],
                "period_start": d_start.isoformat(),
                "sec_frame": None,
                "is_derived": True,
                "derivation": (
                    f"ytd_diff: {cur['accession_number']}"
                    f"[{cur['period_start']}->{cur['period_end']}]"
                    f" - {prev['accession_number']}"
                    f"[{prev['period_start']}->{prev['period_end']}]"
                ),
            })
    return derived


def extract_financial_facts(cik: int, company_facts: dict) -> list[dict]:
    """
    Extract the full v1 fact history for one company.

    Returns UNVALIDATED fact rows (see xbrl_validation.validate_facts);
    includes raw facts for every metric plus derived discrete-quarter OCF.
    """
    us_gaap = (company_facts or {}).get("facts", {}).get("us-gaap", {})
    if not us_gaap:
        logger.warning("[xbrl] no us-gaap facts for CIK %d", cik)
        return []

    all_facts: list[dict] = []
    for metric_key, kind, candidates in XBRL_CONCEPTS:
        all_facts.extend(_resolve_metric(us_gaap, metric_key, kind, candidates))

    ocf = [f for f in all_facts if f["metric_key"] == "operating_cash_flow"]
    all_facts.extend(derive_discrete_cash_flow(ocf))

    for f in all_facts:
        f["cik"] = cik
        f["filing_url"] = build_filing_url(cik, f["accession_number"])
    return all_facts


# ---------------------------------------------------------------------------
# Restatement / tag-drift hooks (WD-XBRL F). Detection + logging only for v1;
# alerting is a fast-follow.
# ---------------------------------------------------------------------------

def detect_restatements(facts: list[dict]) -> list[dict]:
    """
    Same metric+period reported with different values across accessions.
    Company Facts carries originals and restatements side by side, so this
    works on the extracted set alone (no DB diff needed).
    """
    by_period: dict[tuple, list[dict]] = {}
    for f in facts:
        if f["is_derived"]:
            continue
        k = (f["metric_key"], f["period_type"], f["period_start"],
             f["period_end"], f["unit"])
        by_period.setdefault(k, []).append(f)

    out = []
    for k, group in by_period.items():
        if len({f["value"] for f in group}) > 1:
            group.sort(key=lambda f: f["filed_date"] or "")
            out.append({
                "metric_key": k[0],
                "period_start": k[2],
                "period_end": k[3],
                "values": [
                    {"value": f["value"], "accession_number": f["accession_number"],
                     "filed_date": f["filed_date"], "form": f["form"]}
                    for f in group
                ],
            })
    return out


def detect_tag_drift(facts: list[dict]) -> list[dict]:
    """Adjacent periods of one metric resolved from different concept tags."""
    groups: dict[tuple, list[dict]] = {}
    for f in facts:
        if f["is_derived"]:
            continue
        groups.setdefault(
            (f["metric_key"], f["period_type"], f["unit"]), []
        ).append(f)

    out = []
    for (metric_key, _ptype, _unit), group in groups.items():
        current = _latest_filed_per_period(group)
        seq = sorted(current.values(), key=lambda f: f["period_end"])
        for prev, cur in zip(seq, seq[1:]):
            if prev["concept_tag"] != cur["concept_tag"]:
                out.append({
                    "metric_key": metric_key,
                    "from_tag": prev["concept_tag"],
                    "to_tag": cur["concept_tag"],
                    "from_period_end": prev["period_end"],
                    "to_period_end": cur["period_end"],
                })
    return out


def log_hooks(cik: int, facts: list[dict]) -> dict:
    """Run both hooks, log findings, return counts for run stats."""
    restatements = detect_restatements(facts)
    drift = detect_tag_drift(facts)
    for r in restatements:
        logger.warning(
            "[xbrl] RESTATEMENT cik=%d %s %s->%s: %s",
            cik, r["metric_key"], r["period_start"], r["period_end"],
            [(v["value"], v["accession_number"]) for v in r["values"]],
        )
    for d in drift:
        logger.info(
            "[xbrl] TAG DRIFT cik=%d %s: %s (thru %s) -> %s (from %s)",
            cik, d["metric_key"], d["from_tag"], d["from_period_end"],
            d["to_tag"], d["to_period_end"],
        )
    return {"restatements": len(restatements), "tag_drift": len(drift)}


ConceptFetcher = Callable[[int, str, str], Optional[dict]]
