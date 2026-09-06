"""Reconcile the EDGAR CIK universe against the companies table, both ways.

WHY THIS EXISTS
---------------
`companies.sec_cik` is the ONLY thing that makes SEC data reachable. Two
independent code paths depend on it and neither has a fallback:

  * `edgar.submissions.get_xbrl_ciks` builds the daily XBRL poll list from
    `companies WHERE sec_cik IS NOT NULL`. A CIK not on that list is never
    refreshed again.
  * `src/lib/financial-facts.ts` reads `financial_facts_latest` with
    `.eq("cik", res.cik)` where `res.cik` came from `companies.sec_cik`. There
    is no `company_id` fallback on that path (the Filings tab has one; the
    Financials tab does not).

So clearing `sec_cik` from a row does two things at once, both silent: the
facts already stored under that CIK become unreachable by every product
surface, and the CIK drops out of the refresh universe so it also stops
growing. Nothing in the pipeline notices. The facts are still there, still
`validation_status = 'validated'`, still counted in every table size. The only
symptom is an empty Financials tab on a page nobody happened to open.

That is exactly what happened. A hand-applied repair correctly cleared
`ticker` AND `sec_cik` from rows carrying WRONG identity (a row named
"Vanguard" holding American Vanguard's CIK, a row named "HP Inc." holding
Helmerich & Payne's). THE CLEARS WERE RIGHT. What was missing is that nothing
re-homed the CIKs onto correctly-named rows afterwards, and nothing looked.
The CIKs sat unreachable for weeks and were found by a human clicking around.

ONE QUERY would have caught it on day one: CIKs in `financial_facts` with no
claiming `companies` row. It was never run because nobody thought to run it.
This module makes it something that runs on its own.

WHAT IT REFUSES TO DO
---------------------
It never writes. It never proposes a re-home it cannot justify by name. The
gate for "this row could take this CIK" is `names_agree`, the SAME gate that
governs every real write to `sec_cik` (edgar.cik_mapping,
entity_resolver.populate_sec_cik_for_mint). Reusing it means this module can
never nominate a receiver that the write path would then refuse, and can never
nominate the wrongly-named row the repair deliberately cleared.

Note the direction of that reuse. `names_agree` FAILS OPEN by design: with no
authority name to check against it allows the write, because its cost model is
"a rejection costs a missing identifier, never a wrong one". That default is
correct for a write gate and WRONG here. A fail-open verdict as a receiver
nomination would name an arbitrary row as the home for someone else's
financial history. `_agrees_on_identity` below therefore accepts only verdicts
that come from real token evidence, and drops every fail-open one.

THE CORE IS PURE
----------------
`classify` takes plain dicts and returns a plain dict. No network, no client,
no clock, no environment. Every judgement this module makes is testable
without a database, which is the only reason the tests can be hermetic.
`tools/edgar_cik_reconcile.py` is the I/O shell that feeds it.
"""
from __future__ import annotations

from typing import Any, Iterable, Optional

from backend.edgar.name_agreement import names_agree, normalize_tokens

# ---------------------------------------------------------------------------
# Buckets. The separation IS the feature: a check that reports one
# undifferentiated pile of "unclaimed CIKs" gets muted the first week, because
# the class that must never be silenced and the class that is fine sit in the
# same number.
# ---------------------------------------------------------------------------

#: Facts exist. They carry a company_id. That row is still alive, its sec_cik
#: is NULL, and its name does NOT verifiably agree with the SEC registrant,
#: either because it disagrees or because there is no registrant name to check
#: against. This is the signature of a deliberate identity clear that was never
#: followed by a re-home. The pointer is a record of the OLD owner and must not
#: be treated as a re-home target.
#:
#: The unverifiable case lands HERE rather than in SAFE_POINTER on purpose.
#: `names_agree` fails open with no authority, and SAFE_POINTER's meaning is
#: "the name checks out, stamp the CIK back onto this row". Letting a
#: no-authority verdict reach that bucket turns "nothing was checked" into an
#: instruction to restore an identity nobody verified.
WRONG_POINTER = "orphaned_facts_wrong_pointer"

#: Facts exist and carry NO company_id at all. `financial_facts.company_id` is
#: ON DELETE SET NULL, so this is what a deleted or merged-away company row
#: leaves behind: a live orphan `cik` and a nulled pointer.
UNBOUND = "orphaned_facts_unbound"

#: Facts exist, the pointer is live, its sec_cik is NULL, and its name AGREES
#: with the registrant. Benign and directly fixable: that row is the receiver.
#: Kept apart from WRONG_POINTER so the two are never reported as one number.
SAFE_POINTER = "orphaned_facts_safe_pointer"

#: No facts, only filings. Nothing is unreachable because nothing was ever
#: stored. This is where the legitimately-unclaimed entities live: ETFs, trusts,
#: holdco shells, predecessor CIKs of merged registrants. Warn, never alarm.
FILINGS_ONLY = "unclaimed_filings_only"

#: Buckets whose members own stored facts that no product surface can reach.
#: These are the alarm.
FACT_OWNING_BUCKETS = (WRONG_POINTER, UNBOUND, SAFE_POINTER)


class ReconcileInputError(ValueError):
    """A read came back in a shape that cannot be reconciled.

    Raised rather than returned so it can never be mistaken for a clean
    verdict. Every caller must surface it as COULD NOT RUN, not as zero
    findings.
    """


# ---------------------------------------------------------------------------
# Receiver search
# ---------------------------------------------------------------------------

def _agrees_on_identity(our_name: str, registrant: str) -> tuple[bool, str]:
    """names_agree, minus its fail-open verdicts.

    A fail-open True means "no evidence either way", which is an acceptable
    answer for a write gate and an unacceptable one for a nomination. Here it
    becomes False with the reason preserved, so a reader can see WHY a row was
    not nominated rather than seeing it silently absent.
    """
    ok, reason = names_agree(our_name, registrant)
    if ok and reason.startswith("fail-open"):
        return False, f"rejected {reason}"
    return ok, reason


def _index_by_token(rows: Iterable[dict]) -> dict[str, list[dict]]:
    """token -> rows carrying it, over identity tokens only.

    Purely a prefilter. Two names that share no identity token cannot agree
    under any of names_agree's rules except the fail-open ones, and those are
    rejected above. Without it the search is every unclaimed CIK against every
    CIK-less company row, which is quadratic in two numbers that both grow.
    """
    idx: dict[str, list[dict]] = {}
    for r in rows:
        for tok in normalize_tokens(r.get("name") or ""):
            idx.setdefault(tok, []).append(r)
    return idx


#: The receiving row is EXACT: its identity tokens are the registrant's, so
#: there is nothing left to judge. This is the only verdict strong enough to
#: read as a nomination.
RECEIVER_EXACT = "exact"
#: Something agreed, on weaker evidence than equality. Listed WITH the evidence
#: for a human to judge. Never a nomination.
RECEIVER_CANDIDATES = "candidates"
#: Nothing agreed. A correctly-named row has to be created before the CIK has
#: anywhere to go.
RECEIVER_NONE = "none"
#: The registrant name carries no identity tokens to search on ("V F CORP" is
#: two initials and a legal suffix). Refusing to search beats guessing.
RECEIVER_NO_IDENTITY = "no-identity"


def find_receivers(
    registrant: Optional[str],
    token_index: dict[str, list[dict]],
) -> tuple[list[dict], str]:
    """Rows that could take this CIK: (receivers, verdict).

    A receiver is a `companies` row with `sec_cik IS NULL` whose name agrees
    with the SEC registrant name on real token evidence.

    WHY EQUALITY IS GRADED SEPARATELY FROM EVERYTHING ELSE. `names_agree` is a
    VERIFIER: it is handed one pair, already joined on ticker, and asked
    whether they contradict each other. Used as a SEARCH over every CIK-less
    row it faces pairs its rules were never aimed at, and its looser paths let
    real nonsense through. Measured against prod on 2026-09-06:

      "KKR Real Estate Finance Trust Inc."  agreed with a row literally named
                                            "Real estate company", by the
                                            subset rule on {real, estate}
      "MAGNACHIP SEMICONDUCTOR Corp"        agreed with "Nexchip Semiconductor"
                                            at ratio 0.88, on a shared industry
                                            word and a rhyme

    Neither is a defect in `names_agree`; both are what a verifier does when
    you use it as a search. The fix is not to tighten the shared gate, which
    would start refusing correct WRITES elsewhere for no reason. It is to stop
    this module from claiming more than the evidence carries: token-set
    equality is reported as the receiver, and everything else is reported as
    candidates with the reason attached, for a person to settle.
    """
    if not registrant or not str(registrant).strip():
        return [], RECEIVER_NO_IDENTITY

    toks = normalize_tokens(registrant)
    if not toks:
        return [], RECEIVER_NO_IDENTITY

    seen: set[str] = set()
    candidates: list[dict] = []
    for tok in toks:
        for row in token_index.get(tok, ()):
            rid = row.get("id")
            if rid in seen:
                continue
            seen.add(rid)
            candidates.append(row)

    exact: list[dict] = []
    weak: list[dict] = []
    for row in candidates:
        name = row.get("name") or ""
        ok, reason = _agrees_on_identity(name, registrant)
        if not ok:
            continue
        hit = {
            "id": row.get("id"),
            "name": name,
            "ticker": row.get("ticker"),
            "why": reason,
        }
        if normalize_tokens(name) == toks:
            hit["strength"] = RECEIVER_EXACT
            exact.append(hit)
        else:
            hit["strength"] = "weak"
            weak.append(hit)

    exact.sort(key=lambda r: (r["name"] or "").lower())
    weak.sort(key=lambda r: (r["name"] or "").lower())

    if exact:
        return exact + weak, RECEIVER_EXACT
    if weak:
        return weak, RECEIVER_CANDIDATES
    return [], RECEIVER_NONE


# ---------------------------------------------------------------------------
# The classifier
# ---------------------------------------------------------------------------

def classify(
    *,
    fact_ciks: set[int],
    filing_ciks: set[int],
    fact_counts: dict[int, int],
    filing_counts: dict[int, int],
    companies: list[dict],
    fact_pointers: dict[int, list[Optional[str]]],
    registrants: dict[int, dict],
    expectations: Optional[dict] = None,
) -> dict[str, Any]:
    """Both directions of the CIK reconciliation. Pure.

    fact_ciks      EVERY distinct cik in financial_facts
    filing_ciks    EVERY distinct cik in sec_filings
    fact_counts    cik -> exact financial_facts row count. Required for every
                   unclaimed cik, optional elsewhere.
    filing_counts  cik -> exact sec_filings row count, same contract.
    companies      every companies row as {id, name, ticker, sec_cik}
    fact_pointers  cik -> the distinct company_id values its facts carry
    registrants    cik -> {company_name, ticker} from cik_tickers (SEC's own)
    expectations   the reviewed suppression list, see cik_expectations.json

    MEMBERSHIP AND COUNT ARE SEPARATE ARGUMENTS ON PURPOSE. Folding them into
    one cik -> count mapping makes an unmeasured CIK indistinguishable from a
    CIK with zero rows, and every consumer of that mapping then has to guess
    which it is holding. The reverse direction asks exactly "does this claiming
    CIK own any facts", so a 0 standing in for "not measured" would report a
    fully-covered company as a coverage gap. Reading a count as a membership
    test is the same mistake as reading a page length as a total.
    """
    if not isinstance(companies, list):
        raise ReconcileInputError("companies must be a list")
    fact_ciks = {int(c) for c in fact_ciks}
    filing_ciks = {int(c) for c in filing_ciks}
    if not companies:
        raise ReconcileInputError(
            "companies came back empty. Either the read failed or RLS hid every "
            "row. Both are COULD NOT RUN, never zero findings."
        )
    if not fact_ciks:
        raise ReconcileInputError(
            "no financial_facts CIKs were read. A reconciliation against an "
            "empty fact universe finds nothing by construction and would report "
            "clean. Treated as COULD NOT RUN."
        )

    exp = expectations or {}
    exp_no_row = {int(e["cik"]): e for e in exp.get("no_company_row", [])}
    exp_no_facts = {int(e["cik"]): e for e in exp.get("no_facts", [])}

    by_id = {c["id"]: c for c in companies if c.get("id")}
    claimed: dict[int, dict] = {}
    for c in companies:
        cik = c.get("sec_cik")
        if cik is None:
            continue
        claimed[int(cik)] = c

    unclaimed_rows = [c for c in companies if c.get("sec_cik") is None]
    token_index = _index_by_token(unclaimed_rows)

    # --- forward: EDGAR data no companies row claims --------------------
    forward_ciks = sorted(set(fact_ciks) | set(filing_ciks))
    buckets: dict[str, list[dict]] = {
        WRONG_POINTER: [],
        UNBOUND: [],
        SAFE_POINTER: [],
        FILINGS_ONLY: [],
    }
    suppressed_forward: list[dict] = []

    for cik in forward_ciks:
        if cik in claimed:
            continue
        if cik in fact_ciks and cik not in fact_counts:
            raise ReconcileInputError(
                f"cik {cik} is unclaimed and owns facts, but no exact fact count "
                f"was supplied. Reporting it without one would leave the reader "
                f"unable to tell a two-row orphan from a thousand-row one."
            )
        n_facts = int(fact_counts.get(cik, 0))
        n_filings = int(filing_counts.get(cik, 0))
        reg = registrants.get(cik) or {}
        reg_name = reg.get("company_name")

        pointers = [p for p in (fact_pointers.get(cik) or []) if p]
        pointer_info = None
        for pid in pointers:
            row = by_id.get(pid)
            if row is None:
                pointer_info = {"company_id": pid, "state": "dangling"}
                continue
            agrees, why = _agrees_on_identity(row.get("name") or "", reg_name or "")
            pointer_info = {
                "company_id": pid,
                "name": row.get("name"),
                "ticker": row.get("ticker"),
                "sec_cik": row.get("sec_cik"),
                "names_agree": agrees,
                "why": why,
                "state": "live",
            }
            if not agrees:
                # A disagreeing pointer is the informative one. Keep it and
                # stop, so a CIK whose facts carry several pointers reports the
                # wrong-identity one rather than whichever came back first.
                break

        receivers, verdict = find_receivers(reg_name, token_index)

        entry = {
            "cik": cik,
            "facts": n_facts,
            "filings": n_filings,
            "registrant": reg_name,
            "registrant_ticker": reg.get("ticker"),
            "pointer": pointer_info,
            "receivers": receivers,
            "receiver_verdict": verdict,
        }

        if n_facts == 0:
            entry["bucket"] = FILINGS_ONLY
        elif pointer_info is None:
            entry["bucket"] = UNBOUND
        elif pointer_info.get("state") == "dangling":
            entry["bucket"] = UNBOUND
        elif pointer_info.get("names_agree"):
            entry["bucket"] = SAFE_POINTER
        else:
            entry["bucket"] = WRONG_POINTER

        note = exp_no_row.get(cik)
        if note:
            entry["suppressed_by"] = note
            suppressed_forward.append(entry)
        else:
            buckets[entry["bucket"]].append(entry)

    # --- reverse: a companies row carrying a CIK that owns no facts -----
    unexplained: list[dict] = []
    expected: list[dict] = []
    for cik, row in sorted(claimed.items()):
        if cik in fact_ciks:
            continue
        reg = registrants.get(cik) or {}
        entry = {
            "cik": cik,
            "company_id": row.get("id"),
            "name": row.get("name"),
            "ticker": row.get("ticker"),
            "filings": int(filing_counts.get(cik, 0)),
            "registrant": reg.get("company_name"),
        }
        note = exp_no_facts.get(cik)
        if note:
            entry["expected_because"] = note.get("reason")
            entry["reviewed_on"] = note.get("reviewed_on")
            expected.append(entry)
        else:
            unexplained.append(entry)

    # --- the expectations file audits itself ---------------------------
    # An allowlist nobody re-reads becomes a blindfold. Every entry that is no
    # longer in the condition it excuses is reported so it gets deleted.
    stale: list[dict] = []
    for cik, note in sorted(exp_no_row.items()):
        if cik in claimed:
            stale.append({
                "cik": cik, "section": "no_company_row",
                "why": "a companies row now claims this CIK",
                "reason": note.get("reason"),
            })
        elif cik not in fact_ciks and cik not in filing_ciks:
            stale.append({
                "cik": cik, "section": "no_company_row",
                "why": "no facts and no filings carry this CIK any more",
                "reason": note.get("reason"),
            })
    for cik, note in sorted(exp_no_facts.items()):
        if cik not in claimed:
            stale.append({
                "cik": cik, "section": "no_facts",
                "why": "no companies row carries this CIK any more",
                "reason": note.get("reason"),
            })
        elif cik in fact_ciks:
            stale.append({
                "cik": cik, "section": "no_facts",
                "why": "this CIK now owns facts, so the exemption is spent",
                "reason": note.get("reason"),
            })

    alarm_reasons: list[str] = []
    for b in FACT_OWNING_BUCKETS:
        if buckets[b]:
            alarm_reasons.append(
                f"{len(buckets[b])} CIK(s) in {b}: they own stored financial "
                f"facts that no companies row claims, so no product surface can "
                f"reach them and no refresh will ever touch them again"
            )
    if unexplained:
        alarm_reasons.append(
            f"{len(unexplained)} companies row(s) carry a sec_cik that owns no "
            f"facts and are not on the reviewed no-facts list"
        )

    warnings: list[str] = []
    if buckets[FILINGS_ONLY]:
        warnings.append(
            f"{len(buckets[FILINGS_ONLY])} CIK(s) have filings but no facts and "
            f"no claiming row. Nothing is unreachable; this is coverage, not loss"
        )
    if stale:
        warnings.append(
            f"{len(stale)} entry(ies) in cik_expectations.json no longer describe "
            f"a live condition and should be deleted"
        )

    return {
        "universe": {
            "fact_ciks": len(fact_ciks),
            "filing_ciks": len(filing_ciks),
            "companies_rows": len(companies),
            "claimed_ciks": len(claimed),
            "cikless_rows": len(unclaimed_rows),
        },
        "unclaimed": {
            WRONG_POINTER: buckets[WRONG_POINTER],
            UNBOUND: buckets[UNBOUND],
            SAFE_POINTER: buckets[SAFE_POINTER],
            FILINGS_ONLY: buckets[FILINGS_ONLY],
            "suppressed": suppressed_forward,
        },
        "no_facts": {"unexplained": unexplained, "expected": expected},
        "stale_expectations": stale,
        "alarm": bool(alarm_reasons),
        "alarm_reasons": alarm_reasons,
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def render(report: dict[str, Any]) -> str:
    """Markdown, for a GitHub issue body and a job summary alike.

    Deliberately names every CIK. A check that reports a COUNT makes the reader
    go and find the rows, and the whole reason this class of defect survived is
    that nobody went and looked.
    """
    u = report["universe"]
    out: list[str] = []
    out.append("## EDGAR CIK reconciliation")
    out.append("")
    if report["alarm"]:
        out.append("**ALARM.** " + " Also: ".join(report["alarm_reasons"]) + ".")
    else:
        out.append("**Clean.** Every CIK that owns stored facts has a claiming "
                   "`companies` row, and every claiming row's CIK is accounted for.")
    for w in report.get("warnings", []):
        out.append("")
        out.append(f"> Warning: {w}.")
    out.append("")
    out.append(
        f"Scanned {u['fact_ciks']} distinct CIK(s) in `financial_facts`, "
        f"{u['filing_ciks']} in `sec_filings`, against {u['claimed_ciks']} "
        f"claiming `companies` row(s)."
    )

    titles = {
        WRONG_POINTER: (
            "Facts orphaned by an identity clear that was never re-homed",
            "Their facts still point at the row that used to hold the CIK, and "
            "that row's name does NOT verifiably agree with the SEC registrant. "
            "The `pointed at` column gives the row and the reason. Do NOT stamp "
            "the CIK back onto it. Re-home to the receiver, or mint a correctly "
            "named row if there is none.",
        ),
        UNBOUND: (
            "Facts orphaned by a deleted or merged-away row",
            "`financial_facts.company_id` is ON DELETE SET NULL, so these facts "
            "carry no pointer at all. The receiver, if any, is named below.",
        ),
        SAFE_POINTER: (
            "Facts whose pointed-at row agrees on name and simply lost its CIK",
            "Directly fixable: stamp the CIK back onto the row the facts already "
            "point at.",
        ),
        FILINGS_ONLY: (
            "CIKs with filings, no facts, and no claiming row",
            "Nothing is unreachable here, because nothing was stored. ETFs, "
            "trusts, holdco shells and predecessor CIKs live in this bucket. "
            "Add a reviewed entry to `cik_expectations.json` for any that is "
            "legitimately never going to have a row.",
        ),
    }

    for bucket, (title, why) in titles.items():
        rows = report["unclaimed"][bucket]
        if not rows:
            continue
        out.append("")
        out.append(f"### {title} ({len(rows)})")
        out.append("")
        out.append(why)
        out.append("")
        out.append(
            "| CIK | registrant | facts | filings | pointed at | receiving row |"
        )
        out.append("| --- | --- | --- | --- | --- | --- |")
        for r in rows:
            out.append(
                f"| `{r['cik']}` | {r.get('registrant') or 'unknown to cik_tickers'}"
                f" ({r.get('registrant_ticker') or '-'}) | {r['facts']} | "
                f"{r['filings']} | {_pointer_cell(r)} | {_receiver_cell(r)} |"
            )

    supp = report["unclaimed"]["suppressed"]
    if supp:
        out.append("")
        out.append(f"### Unclaimed and reviewed as legitimate ({len(supp)})")
        out.append("")
        out.append("Suppressed by `cik_expectations.json`. Listed, never alarmed on.")
        out.append("")
        out.append("| CIK | registrant | facts | filings | reason | reviewed |")
        out.append("| --- | --- | --- | --- | --- | --- |")
        for r in supp:
            note = r.get("suppressed_by") or {}
            out.append(
                f"| `{r['cik']}` | {r.get('registrant') or '-'} | {r['facts']} | "
                f"{r['filings']} | {note.get('reason', '-')} | "
                f"{note.get('reviewed_on', '-')} |"
            )

    unex = report["no_facts"]["unexplained"]
    out.append("")
    out.append(f"### Claiming rows whose CIK owns no facts ({len(unex)} unexplained, "
               f"{len(report['no_facts']['expected'])} reviewed)")
    out.append("")
    if unex:
        out.append(
            "Each of these is either a filer we have simply never polled, or a "
            "filer that publishes no us-gaap XBRL at all. Establish which, then "
            "either fix the coverage or record the exemption in "
            "`cik_expectations.json` with its reason."
        )
        out.append("")
        out.append("| CIK | our row | ticker | filings | registrant |")
        out.append("| --- | --- | --- | --- | --- |")
        for r in unex:
            out.append(
                f"| `{r['cik']}` | {r.get('name')} | {r.get('ticker') or '-'} | "
                f"{r['filings']} | {r.get('registrant') or '-'} |"
            )
    else:
        out.append("None unexplained. Every one is on the reviewed list.")

    stale = report["stale_expectations"]
    if stale:
        out.append("")
        out.append(f"### Spent entries in cik_expectations.json ({len(stale)})")
        out.append("")
        out.append("Delete these. An exemption that no longer describes anything "
                   "is a blindfold waiting to hide the next one.")
        out.append("")
        out.append("| CIK | section | why it is spent |")
        out.append("| --- | --- | --- |")
        for s in stale:
            out.append(f"| `{s['cik']}` | {s['section']} | {s['why']} |")

    return "\n".join(out)


def _pointer_cell(entry: dict) -> str:
    """The row the facts still point at, and WHY it was not accepted.

    The reason is printed rather than summarised because the two ways a pointer
    fails verification call for different work. "disagree" means the clear was
    right and a different row must take the CIK. "rejected fail-open: no
    authority name" means nothing was checked at all, because SEC does not list
    this CIK with a ticker, and someone has to establish the identity by hand.
    """
    p = entry.get("pointer")
    if not p:
        return "nothing, company_id is NULL on every fact"
    if p.get("state") == "dangling":
        return f"`{p.get('company_id')}`, a row that no longer exists"
    return f"`{p.get('name')}` ({p.get('why')})"


def _receiver_cell(entry: dict) -> str:
    verdict = entry.get("receiver_verdict")
    rec = entry.get("receivers") or []
    if verdict == RECEIVER_EXACT:
        first = rec[0]
        extra = "" if len(rec) == 1 else f" (+{len(rec) - 1} weaker)"
        return f"`{first['name']}` ({first.get('ticker') or 'no ticker'}){extra}"
    if verdict == RECEIVER_CANDIDATES:
        return "REVIEW, no exact match: " + ", ".join(
            f"`{r['name']}` ({r['why']})" for r in rec[:3]
        )
    if verdict == RECEIVER_NO_IDENTITY:
        return "cannot search: registrant name carries no identity tokens"
    return "none, a row must be created"
