"""Form 13F filer-identity parser.

WHAT A 13F ROW MEANS, AND WHAT IT DOES NOT
------------------------------------------
An institutional investment manager exercising discretion over $100,000,000 or
more of section 13(f) securities must file Form 13F quarterly. So the existence
of a 13F-HR filing is a disclosed fact about size, which is why it is admitted
as a NUMBERS artifact at all.

It is an EXISTENCE FLAG, not a figure. This module extracts filer identity only:
CIK, name, which 13F forms the filer has on record, and the last filing date. It
reads no holdings and stores no position values.

13F-NT IS NOT 13F-HR. A "notice" filing states that the manager's holdings are
reported on ANOTHER manager's report; it carries no holdings of its own and
discloses no size. Measured over the on-disk EDGAR submissions index (983,019
entities): 16,161 entities have filed at least one 13F-HR, 5,567 have filed at
least one 13F-NT, and 4,041 of those have filed ONLY notices. An NT-only filer
gets a row with notice_only=true and files_13f_hr=false, so the exclusion is on
the record and auditable rather than invisible.

SOURCE
------
backend/edgar/submissions.py fetches EDGAR submissions per CIK at runtime. For a
one-shot registry build over the whole filer population that would be ~1M
requests, which is not a reasonable thing to do to EDGAR. This module instead
reads a pre-built newline-delimited JSON index of EDGAR submissions, one object
per entity, carrying a `forms_set` of every form type the entity has filed. The
index is built once and reused; this parser makes no network requests at all.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Iterable, Iterator, Optional

HR_PREFIX = "13F-HR"
NT_PREFIX = "13F-NT"

# A 13F-HR is a QUARTERLY obligation, so a manager that still meets the $100M
# threshold files roughly every 90 days. A filer whose last filing is years old
# has either dropped below the threshold or wound up, and its existence flag is
# then a statement about the past, not about size today.
#
# This guard is not hypothetical. Measured over the on-disk index, the matcher's
# own output included managers whose last 13F-HR was filed in 2006, 2009, 2014
# and 2017. Six missed quarters is generous and still excludes every one of them.
STALE_AFTER_DAYS = 550


@dataclass(frozen=True)
class ManagerRecord:
    """One Form 13F filer identity."""

    cik: int
    filer_name: str
    forms: tuple[str, ...]
    files_13f_hr: bool
    notice_only: bool
    last_filing_date: Optional[date]
    former_names: tuple[str, ...] = field(default=())

    @property
    def supplies_numbers(self) -> bool:
        """Only a holdings report discloses size. A notice discloses nothing.

        This is the FORM test alone. A caller crediting the numbers pillar must
        also apply `is_current`, because a holdings report filed in 2006 says
        nothing about the manager's size now.
        """
        return self.files_13f_hr

    def is_current(self, as_of: date, max_age_days: int = STALE_AFTER_DAYS) -> bool:
        """TRUE when the last 13F filing is recent enough to describe today.

        A filer with NO recorded filing date fails: an undated flag cannot be
        shown to a reader with an as-of, and a size claim with no as-of is the
        thing this whole module is trying not to ship.
        """
        if self.last_filing_date is None:
            return False
        return (as_of - self.last_filing_date).days <= max_age_days


def parse_iso_date(raw: Optional[str]) -> Optional[date]:
    """'2026-03-03' -> date(2026, 3, 3). Blank/garbage -> None."""
    if not raw:
        return None
    try:
        return datetime.strptime(raw.strip()[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def classify_forms(forms: Iterable[str]) -> tuple[tuple[str, ...], bool, bool]:
    """Split a filer's form set into (13F forms, files_13f_hr, notice_only).

    Amendments count. '13F-HR/A' is an amended holdings report and still
    discloses holdings, so a filer whose only holdings filing is an amendment is
    a holdings filer. Matching is by prefix for exactly that reason.
    """
    f13 = tuple(sorted({f.strip() for f in forms if f and f.strip().startswith("13F-")}))
    has_hr = any(f.startswith(HR_PREFIX) for f in f13)
    has_nt = any(f.startswith(NT_PREFIX) for f in f13)
    return f13, has_hr, (has_nt and not has_hr)


def record_from_submission(entry: dict) -> Optional[ManagerRecord]:
    """Build a ManagerRecord from one submissions-index object, or None.

    Returns None for an entity with no 13F form of any kind: the registry is a
    filer list, not a copy of EDGAR.
    """
    cik = entry.get("cik")
    if not isinstance(cik, int):
        try:
            cik = int(str(cik).strip())
        except (TypeError, ValueError):
            return None
    name = (entry.get("name") or "").strip()
    if not name:
        return None
    forms, has_hr, notice_only = classify_forms(entry.get("forms_set") or [])
    if not forms:
        return None
    former = tuple(
        n.strip() for n in (entry.get("formerNames") or []) if isinstance(n, str) and n.strip()
    )
    return ManagerRecord(
        cik=cik,
        filer_name=name,
        forms=forms,
        files_13f_hr=has_hr,
        notice_only=notice_only,
        last_filing_date=parse_iso_date(entry.get("last_filing")),
        former_names=former,
    )


def iter_managers(lines: Iterable[str]) -> Iterator[ManagerRecord]:
    """Stream ManagerRecords out of a newline-delimited submissions index.

    The index is ~285MB, so it is streamed rather than loaded. A line that is
    not valid JSON is skipped: a single corrupt line must not lose the other
    983,018.
    """
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        record = record_from_submission(entry)
        if record is not None:
            yield record


def load_managers(index_path: str) -> list[ManagerRecord]:
    """Read every 13F filer identity out of the on-disk submissions index."""
    with open(index_path, "r", encoding="utf-8") as fh:
        return list(iter_managers(fh))
