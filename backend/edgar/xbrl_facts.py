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
# 20-F (foreign private issuers, e.g. ASML) and 40-F (Canadian MJDS filers) are
# the annual reports of foreign large-caps that file us-gaap companyfacts; they
# carry fp=FY and ~365d duration spans, so the period/fiscal logic treats them
# exactly like a 10-K. Their interim equivalent is the 6-K, which (like the
# 8-K) is furnished and inconsistently tagged, so it is deliberately excluded;
# foreign filers therefore yield annual-only facts (no 10-Q-style YTD quarters).
# Amendments (/A) are included for the same reason as 10-K/A: ASML's real
# companyfacts carries 20-F/A restatements that the accession-keyed history
# must preserve.
XBRL_FORMS = {"10-K", "10-Q", "10-K/A", "10-Q/A",
              "20-F", "20-F/A", "40-F", "40-F/A"}

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
    # mezzanine (temporary) equity sits between liabilities and equity:
    # redeemable preferred / redeemable NCI (WDC, MicroStrategy, ...)
    ("temporary_equity", "instant", [
        "TemporaryEquityCarryingAmountIncludingPortionAttributableToNoncontrollingInterest",
        "TemporaryEquityCarryingAmountAttributableToParent",
    ]),
    ("redeemable_noncontrolling_interest", "instant", [
        "RedeemableNoncontrollingInterestEquityCarryingAmount",
    ]),
    # EPS numerator: reported EPS is on net income available to COMMON
    # (NetIncomeLoss minus preferred dividends minus NCI). Most affected
    # issuers tag it directly (WDC, Boeing, KKR RE, MicroStrategy).
    ("ni_available_to_common_basic", "duration", [
        "NetIncomeLossAvailableToCommonStockholdersBasic",
    ]),
    ("ni_available_to_common_diluted", "duration", [
        "NetIncomeLossAvailableToCommonStockholdersDiluted",
    ]),
    ("preferred_dividends", "duration", [
        "PreferredStockDividendsIncomeStatementImpact",
        "PreferredStockDividendsAndOtherAdjustments",
        "DividendsPreferredStock",
    ]),
    ("cash_and_equivalents", "instant", ["CashAndCashEquivalentsAtCarryingValue"]),
]

# Discrete fiscal quarters are ~91 days; spans outside this band are not a
# quarter (13/14-week retail calendars and 53-week years stay inside it).
QUARTER_SPAN_MIN_DAYS = 60
QUARTER_SPAN_MAX_DAYS = 120

# Duration-span bands (days) for period classification. 53-week years and
# 14-week quarters stay inside their band.
FY_SPAN = (330, 400)
QTR_SPAN = (QUARTER_SPAN_MIN_DAYS, QUARTER_SPAN_MAX_DAYS)
H1_SPAN = (150, 215)     # 6-month cumulative (10-Q Q2 YTD)
M9_SPAN = (240, 310)     # 9-month cumulative (10-Q Q3 YTD)

# An original 10-K is accepted/filed within this many days of its fiscal year
# end; comparative re-reports in later filings are filed far outside it.
ORIGINAL_FILING_MAX_LAG_DAYS = 200


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


# Statement-total concepts vs their component/subtotal concepts, broadest
# first. Filers can tag BOTH for the same period (Cheniere FY2025: Revenues
# 19,976M is the income-statement total; RevenueFromContractWithCustomer...
# 19,464M is only the ASC-606 contract portion). For these families the
# period winner must be the BROADEST tag reporting that period; the global
# activity rank below was set for tag MIGRATION (NVDA) and picks wrong here.
BREADTH_PRIORITY: dict[str, list[str]] = {
    "revenue": [
        "Revenues",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "SalesRevenueNet",
    ],
    "cost_of_revenue": [
        "CostOfRevenue",
        "CostOfGoodsAndServicesSold",
    ],
}

# Divergence tolerance for the dual-tag quarantine annotation (rounding-scale,
# mirrors the gate's tie-out slack).
DUAL_TAG_ABS_USD = 2_000_000
DUAL_TAG_REL = 0.005


def _resolve_metric(us_gaap: dict, metric_key: str, kind: str,
                    candidates: list[str]) -> list[dict]:
    """
    Resolve one metric across its candidate tags.

    Default rule: for each distinct period, the candidate whose own facts
    reach the latest period_end overall wins (the issuer's currently active
    tag, for tag MIGRATIONS like NVDA), tie-broken by candidate order.

    Breadth families (BREADTH_PRIORITY): per period, the BROADEST tag
    reporting that period wins (Revenues is the statement total by
    definition); narrower contract/component tags fill only the periods the
    total does not cover. Per-period, so migration histories stay intact.

    All accessions for the winning tag+period are kept (restatement history).
    Belt-and-suspenders: any emitted breadth-family fact whose period is ALSO
    reported by a BROADER tag with a diverging value is annotated
    dual_tag_conflict for the validation gate to quarantine (unreachable when
    selection is correct; armor against regressions).
    """
    per_tag: dict[str, list[dict]] = {}
    for tag in candidates:
        facts = _raw_facts_for_tag(us_gaap, tag, kind)
        if facts:
            per_tag[tag] = facts
    if not per_tag:
        return []

    breadth = BREADTH_PRIORITY.get(metric_key)
    chosen: dict[tuple, str] = {}  # period key -> winning tag
    if breadth:
        rank = {t: i for i, t in enumerate(breadth)}
        for tag, facts in per_tag.items():
            for f in facts:
                k = _period_key(kind, f)
                cur = chosen.get(k)
                if cur is None or rank.get(tag, len(breadth)) < rank.get(cur, len(breadth)):
                    chosen[k] = tag
    else:
        # Activity rank: latest end date per tag; candidate order breaks ties.
        def activity(tag: str) -> tuple:
            latest = max(f["end"] for f in per_tag[tag])
            return (latest, -candidates.index(tag))

        for tag in sorted(per_tag, key=activity, reverse=True):
            for f in per_tag[tag]:
                chosen.setdefault(_period_key(kind, f), tag)

    out = []
    for tag, facts in per_tag.items():
        for f in facts:
            if chosen[_period_key(kind, f)] == tag:
                row = _to_fact_row(metric_key, kind, f)
                if breadth:
                    conflict = _broader_divergence(
                        per_tag, breadth, tag, kind, f)
                    if conflict:
                        row["dual_tag_conflict"] = conflict
                out.append(row)
    return out


def _broader_divergence(per_tag: dict, breadth: list[str], chosen_tag: str,
                        kind: str, f: dict) -> Optional[str]:
    """A BROADER family member reports the same period with a diverging value:
    the published fact would understate the statement total. Returns the
    quarantine reason, or None."""
    rank = {t: i for i, t in enumerate(breadth)}
    k = _period_key(kind, f)
    for tag in breadth:
        if rank[tag] >= rank.get(chosen_tag, len(breadth)):
            break
        for g in per_tag.get(tag, []):
            if _period_key(kind, g) != k:
                continue
            diff = abs(g["val"] - f["val"])
            if diff > max(DUAL_TAG_ABS_USD, DUAL_TAG_REL * max(abs(g["val"]), abs(f["val"]))):
                return (f"dual_tag_divergence: {tag}={g['val']:.0f} vs "
                        f"{chosen_tag}={f['val']:.0f} for {f['end']}")
    return None


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


# ---------------------------------------------------------------------------
# Fiscal labeling: fiscal_year/fiscal_period describe each fact's OWN period,
# never the filing it came from.
#
# SEC fy/fp are the FILING's fiscal context. Because value selection keeps the
# latest-filed instance of each period (correct for restatements), carrying
# fy/fp through would mislabel every comparative: Apple's true-FY2024 revenue
# re-reported in the FY2025 10-K arrives with fy=2025, and a 6-month YTD and
# the discrete quarter sharing its end date both arrive as "Q2". Instead we
# infer the issuer's fiscal calendar from its annual facts and label every
# period by its own dates. Filing provenance stays in accession_number / form
# / filed_date.
# ---------------------------------------------------------------------------

BOUNDARY_JITTER_DAYS = 10   # period boundaries re-tagged +/- a few days across filings
WINDOW_OVERLAP_MAX_DAYS = 30  # real fiscal windows tile; more overlap = spurious

# An anchor (SEC fy on the original 10-K) more than 1 off the calendar year of
# its own period end is metadata corruption (observed: fy=2027 on Seagate's
# FY2025; fy=2005-2009 on modern GS/MS/103379/1083301/748268 periods).
ANCHOR_MAX_CALENDAR_DRIFT = 1


def _d(iso: str) -> date:
    return date.fromisoformat(iso)


def _overlap_days(a: dict, b: dict) -> int:
    lo = max(a["start"], b["start"])
    hi = min(a["end"], b["end"])
    return (_d(hi) - _d(lo)).days + 1 if lo <= hi else 0


def _fiscal_windows(facts: list[dict]) -> list[dict]:
    """
    Issuer fiscal years as [{start, end, fy}], inferred from annual (~365d)
    duration facts, hardened against real-world tagging noise:

      * anchor sanity: the fiscal-year NUMBER comes from the ORIGINAL 10-K
        (earliest instance filed within ~200d of period end, fp=FY) but is
        REJECTED when >1 off the calendar year of the period end (corrupt
        SEC metadata: STX fy=2027 on FY2025, GS-era fy=2005 on 2008 periods)
      * jitter merge: windows whose ends differ by <=10d are one fiscal year
        tagged with inconsistent boundaries (GS 2008-11-28 vs 2008-11-30);
        prefer the anchored variant, then fy == calendar year of end
      * overlap drop: real fiscal windows tile; unanchored windows that
        overlap a kept window by >30d are spurious (Amazon tags rolling
        trailing-12-month spans in every 10-Q - each looked like a "year")
      * sequence repair: adjacent windows must number +1; when they don't,
        renumber the side whose fy deviates from the company's modal
        (fy - calendar_year) offset, so off-by-one anchors (GS fy=2006 on
        FY2007) heal while New-Year-straddling 52/53-week years survive
      * neighbor fill + calendar fallback for anything still unnumbered

    NOTE: reads the SEC fy/fp still present on freshly extracted rows; must
    run before labels are overwritten.
    """
    annuals: dict[tuple, list[dict]] = {}
    for f in facts:
        if f["is_derived"] or f["period_type"] != "duration":
            continue
        if FY_SPAN[0] <= _span_days(f) <= FY_SPAN[1]:
            annuals.setdefault((f["period_start"], f["period_end"]), []).append(f)

    raw = []
    for (ps, pe), group in sorted(annuals.items(), key=lambda kv: kv[0][1]):
        anchor = None
        for g in sorted(group, key=lambda g: g["filed_date"] or "9999-12-31"):
            if g.get("fiscal_period") != "FY" or not g.get("fiscal_year") \
                    or not g.get("filed_date"):
                continue
            try:
                lag = (_d(g["filed_date"]) - _d(pe)).days
            except (ValueError, TypeError):
                continue
            if 0 <= lag <= ORIGINAL_FILING_MAX_LAG_DAYS \
                    and abs(g["fiscal_year"] - _d(pe).year) <= ANCHOR_MAX_CALENDAR_DRIFT:
                anchor = g["fiscal_year"]
                break
        raw.append({"start": ps, "end": pe, "fy": anchor})
    if not raw:
        return []

    # jitter merge (same fiscal year, boundary variants)
    def quality(w):
        return (w["fy"] is not None,
                w["fy"] == _d(w["end"]).year if w["fy"] is not None else False)

    merged: list[dict] = []
    for w in raw:  # already sorted by end
        if merged and (_d(w["end"]) - _d(merged[-1]["end"])).days <= BOUNDARY_JITTER_DAYS:
            # on equal quality keep the LATER end (w), so the sibling
            # variant's facts still fall inside the merged window
            if quality(w) >= quality(merged[-1]):
                merged[-1] = w
            continue
        merged.append(w)

    # overlap drop: anchored windows are fixed; unanchored ones must tile.
    # Among unanchored, prefer those whose end matches the anchored windows'
    # month/day pattern (real years share the issuer's FYE; rolling TTM ends
    # at other quarter-ends).
    anchored = [w for w in merged if w["fy"] is not None]
    anchored_ends = {w["end"][5:] for w in anchored}

    def fye_like(w):
        if not anchored_ends:
            return True
        e = _d(w["end"])
        for md in anchored_ends:
            month, day = int(md[:2]), int(md[3:])
            for yr in (e.year - 1, e.year, e.year + 1):
                try:
                    cand = date(yr, month, day)
                except ValueError:
                    continue
                if abs((e - cand).days) <= BOUNDARY_JITTER_DAYS:
                    return True
        return False

    kept = list(anchored)
    for w in sorted((w for w in merged if w["fy"] is None),
                    key=lambda w: (not fye_like(w), w["end"])):
        if any(_overlap_days(w, k) > WINDOW_OVERLAP_MAX_DAYS for k in kept):
            continue
        kept.append(w)
    windows = sorted(kept, key=lambda w: w["end"])

    # neighbor fill
    for i in range(1, len(windows)):
        if windows[i]["fy"] is None and windows[i - 1]["fy"] is not None:
            windows[i]["fy"] = windows[i - 1]["fy"] + 1
    for i in range(len(windows) - 2, -1, -1):
        if windows[i]["fy"] is None and windows[i + 1]["fy"] is not None:
            windows[i]["fy"] = windows[i + 1]["fy"] - 1
    for w in windows:
        if w["fy"] is None:
            w["fy"] = _d(w["end"]).year

    # sequence repair: adjacent fiscal years (ends < ~500d apart) number +1.
    # Iterated to convergence: SEC switched its fy-derivation convention
    # around 2015 (start-year -> end-year), so Jan-FYE retailers (WMT et al)
    # carry a whole ERA of off-by-one anchors that must cascade, not just the
    # single pair at the era boundary.
    offsets = [w["fy"] - _d(w["end"]).year for w in windows]
    modal = max(set(offsets), key=offsets.count) if offsets else 0
    for _ in range(len(windows)):
        changed = False
        for i in range(len(windows) - 1):
            a, b = windows[i], windows[i + 1]
            if (_d(b["end"]) - _d(a["end"])).days >= 500:
                continue  # true coverage gap (e.g. missing early-XBRL year)
            if b["fy"] - a["fy"] == 1:
                continue
            if a["fy"] - _d(a["end"]).year != modal:
                a["fy"], changed = b["fy"] - 1, True
            elif b["fy"] - _d(b["end"]).year != modal:
                b["fy"], changed = a["fy"] + 1, True
        if not changed:
            break
    return windows


def _locate_window(pe_iso: str, windows: list[dict]) -> Optional[dict]:
    """Window containing the date; extrapolates beyond known annuals (e.g. the
    in-progress fiscal year: NVDA files Q1 FY2027 a year before any FY2027
    10-K exists)."""
    if not windows:
        return None
    for w in windows:
        if w["start"] <= pe_iso <= w["end"]:
            return w
    d = date.fromisoformat(pe_iso)
    # boundary jitter: a fact tagged to end a few days past its fiscal window
    # (e.g. 2008-11-30 vs a merged window ending 2008-11-28) still belongs to it
    for w in windows:
        if w["start"] <= pe_iso and \
                (d - date.fromisoformat(w["end"])).days <= BOUNDARY_JITTER_DAYS:
            return w
    # forward-extrapolate from the last window ENDING before this date: covers
    # both the in-progress fiscal year (prev = newest window) and mid-history
    # coverage gaps (prev = the window just before the missing year)
    prev = None
    for w in windows:
        if w["end"] < pe_iso:
            prev = w
    if prev is not None:
        length = (date.fromisoformat(prev["end"])
                  - date.fromisoformat(prev["start"])).days + 1
        start = date.fromisoformat(prev["end"]) + timedelta(days=1)
        fy = prev["fy"] + 1
        while True:
            end = start + timedelta(days=length - 1)
            if d <= end:
                return {"start": start.isoformat(), "end": end.isoformat(), "fy": fy}
            start, fy = end + timedelta(days=1), fy + 1
    # before the earliest known window: extrapolate backward
    first = windows[0]
    length = (date.fromisoformat(first["end"])
              - date.fromisoformat(first["start"])).days + 1
    end = date.fromisoformat(first["start"]) - timedelta(days=1)
    fy = first["fy"] - 1
    while True:
        start = end - timedelta(days=length - 1)
        if d >= start:
            return {"start": start.isoformat(), "end": end.isoformat(), "fy": fy}
        end, fy = start - timedelta(days=1), fy - 1


def _span_label(span: int, pos: int) -> Optional[str]:
    if FY_SPAN[0] <= span <= FY_SPAN[1]:
        return "FY"
    if QTR_SPAN[0] <= span <= QTR_SPAN[1]:
        return f"Q{pos}"
    if H1_SPAN[0] <= span <= H1_SPAN[1]:
        return "6M"
    if M9_SPAN[0] <= span <= M9_SPAN[1]:
        return "9M"
    return None  # odd span (e.g. FYE-transition stub): dates remain the truth


def _label_period(f: dict, windows: list[dict]) -> tuple[Optional[int], Optional[str]]:
    """
    Alignment rules (WD-XBRL hardening): FY requires the period END aligned to
    the fiscal window's end; an annual-length span that is NOT aligned is a
    rolling trailing-twelve-month figure (Amazon tags TTM OCF in every 10-Q)
    and labels 'TTM' so extraction can exclude it from the published set.
    6M/9M (cumulative YTD) require the period START aligned to the fiscal
    year start; misaligned mid-year spans stay unlabeled (dates are truth).
    """
    pe = f["period_end"]
    w = _locate_window(pe, windows)
    d = date.fromisoformat(pe)
    if w is None:
        # no annual history at all: calendar fallback (cannot detect TTM)
        pos = (d.month - 1) // 3 + 1
        if f["period_type"] == "instant":
            return d.year, f"Q{pos}"
        return d.year, _span_label(_span_days(f), pos)
    wlen = (date.fromisoformat(w["end"])
            - date.fromisoformat(w["start"])).days + 1
    days_in = (d - date.fromisoformat(w["start"])).days + 1
    pos = min(4, max(1, round(days_in / (wlen / 4))))
    if f["period_type"] == "instant":
        # a fiscal-year-end balance is the FY balance sheet, not "Q4"
        return w["fy"], ("FY" if pos == 4 else f"Q{pos}")
    span = _span_days(f)
    label = _span_label(span, pos)
    if label == "FY":
        end_aligned = abs((d - date.fromisoformat(w["end"])).days) \
            <= BOUNDARY_JITTER_DAYS
        return w["fy"], ("FY" if end_aligned else "TTM")
    if label in ("6M", "9M"):
        start_aligned = abs((date.fromisoformat(f["period_start"])
                             - date.fromisoformat(w["start"])).days) \
            <= BOUNDARY_JITTER_DAYS
        return w["fy"], (label if start_aligned else None)
    return w["fy"], label


def assign_fiscal_labels(facts: list[dict]) -> None:
    """Overwrite fiscal_year/fiscal_period IN PLACE with period-derived
    labels: FY / Q1..Q4 (discrete) / 6M / 9M (cumulative YTD)."""
    windows = _fiscal_windows(facts)
    for f in facts:
        f["fiscal_year"], f["fiscal_period"] = _label_period(f, windows)


def extract_financial_facts(cik: int, company_facts: dict) -> list[dict]:
    """
    Extract the full v1 fact history for one company.

    Returns UNVALIDATED fact rows (see xbrl_validation.validate_facts);
    includes raw facts for every metric plus derived discrete-quarter OCF.
    fiscal_year/fiscal_period are period-derived labels (assign_fiscal_labels).
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

    # Dedup on the storage key (accession, tag, period, unit), REPORTED beats
    # DERIVED: some issuers (e.g. Celestica, Reddit) tag the discrete quarter
    # alongside YTD, so the ytd_diff row duplicates a reported fact from the
    # same filing and the batch upsert rejects the double-hit.
    by_key: dict[tuple, dict] = {}
    for f in sorted(all_facts, key=lambda f: f["is_derived"]):
        key = (f["accession_number"], f["concept_tag"],
               f["period_start"], f["period_end"], f["unit"])
        if key in by_key:
            if f["is_derived"] and by_key[key]["value"] != f["value"]:
                logger.warning(
                    "[xbrl] derived OCF %s disagrees with reported fact for %s: "
                    "%s vs %s", f["period_end"], key[0],
                    f["value"], by_key[key]["value"],
                )
            continue
        by_key[key] = f
    all_facts = list(by_key.values())

    # must come last: needs the raw SEC fy/fp for anchoring, then replaces them
    assign_fiscal_labels(all_facts)

    # Rolling trailing-12-month figures (Amazon tags TTM OCF in every 10-Q)
    # keep their honest 'TTM' label and are QUARANTINED by the validation
    # gate (reason ttm_not_published) instead of being dropped: writing them
    # lets the upsert overwrite any previously mislabeled row in place, while
    # the validated-only view still never publishes them.
    ttm = [f for f in all_facts if f["fiscal_period"] == "TTM"]
    if ttm:
        logger.info("[xbrl] CIK %d: %d TTM facts (kept, never published) (%s)",
                    cik, len(ttm),
                    sorted({f["metric_key"] for f in ttm}))

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
