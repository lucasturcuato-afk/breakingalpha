"""Form ADV Part 1 firm-roster parser (SEC IA FOIA download).

WHAT THIS READS
---------------
The SEC publishes a monthly zip containing exactly one CSV, the
"IA_SEC_-_FIRM_ROSTER_FOIA_DOWNLOAD" extract of every SEC-registered investment
adviser's current Form ADV Part 1. Measured on ia060126_0.zip: 16,876 rows,
448 columns, one row per firm, keyed on 'Organization CRD#' (16,876 distinct,
zero blank).

THE FIGURE
----------
Item 5.F(2)(c), column '5F(2)(c)', is Regulatory Assets Under Management, total.
It is populated on 16,876 of 16,876 rows and parses as a number on all of them.
605 of those report EXACTLY ZERO, which is a filed answer and not a missing one,
so `has_raum_figure` distinguishes the two rather than letting a $0 firm render
as if it had disclosed a book.

The roster's own arithmetic 5F(2)(a) + 5F(2)(b) == 5F(2)(c) (discretionary plus
non-discretionary equals total) was verified to hold exactly on the sampled
rows; the parser stores all three rather than deriving any of them.

Values arrive as right-padded, comma-grouped strings ("  429,694,491,042.00").
They are FULL DOLLARS. Nothing here rescales them.

STALENESS
---------
'Latest ADV Filing Date' is the adviser's own most recent filing, MM/DD/YYYY.
On the measured roster 16,345 of 16,876 fell in the current year, but 57 are
2024 or older. RAUM is an annual disclosure and every read path is expected to
render the figure with this date beside it.

EXEMPT REPORTING ADVISERS ARE NOT PARSED HERE. The companion ia*-exempt roster
has 171 columns and NO Item 5 columns whatsoever: no RAUM, no employee counts,
no client counts. There is no figure to carry, so an ERA supplies no pillar and
this module refuses the file rather than emitting rows with a null figure.
"""
from __future__ import annotations

import csv
import io
import re
import zipfile
from dataclasses import dataclass
from datetime import date, datetime
from typing import Iterator, Optional

CRD_COL = "Organization CRD#"
PRIMARY_NAME_COL = "Primary Business Name"
LEGAL_NAME_COL = "Legal Name"
FILED_COL = "Latest ADV Filing Date"
STATUS_COL = "SEC Current Status"

RAUM_TOTAL_COL = "5F(2)(c)"
RAUM_DISCRETIONARY_COL = "5F(2)(a)"
RAUM_NON_DISCRETIONARY_COL = "5F(2)(b)"
ACCOUNTS_TOTAL_COL = "5F(2)(f)"

# Every column the parser needs. Absence of any one of them means the file is
# not the Part 1 roster (most likely it is the exempt roster, which has none of
# the 5F columns), and the parser must say so instead of emitting empty rows.
REQUIRED_COLUMNS = (
    CRD_COL,
    PRIMARY_NAME_COL,
    RAUM_TOTAL_COL,
    RAUM_DISCRETIONARY_COL,
    RAUM_NON_DISCRETIONARY_COL,
)

# The FOIA extract is not UTF-8; it carries Latin-1 accented firm names.
ROSTER_ENCODING = "latin-1"


class AdvRosterError(ValueError):
    """The supplied file is not a parseable Form ADV Part 1 firm roster."""


@dataclass(frozen=True)
class AdviserRecord:
    """One SEC-registered adviser, as filed."""

    crd: int
    primary_business_name: str
    legal_name: Optional[str]
    raum_total_usd: Optional[float]
    raum_discretionary_usd: Optional[float]
    raum_non_discretionary_usd: Optional[float]
    raum_total_accounts: Optional[int]
    raum_reported_at: Optional[date]
    sec_status: Optional[str]

    @property
    def has_raum_figure(self) -> bool:
        """TRUE only when the adviser disclosed a POSITIVE book.

        A filed 0.00 is a real answer and it is kept on the record, but it is
        not a number worth putting on a company page, so it does not count as a
        figure. 605 of 16,876 roster rows are in this state.
        """
        return self.raum_total_usd is not None and self.raum_total_usd > 0


def parse_money(raw: Optional[str]) -> Optional[float]:
    """'  429,694,491,042.00' -> 429694491042.0. Blank/garbage -> None.

    Leading '$' and thousands separators are stripped; a parenthesised value is
    read as negative, which is the convention the extract inherits even though
    no RAUM row has ever used it. Nothing is rescaled: the result is full
    dollars, exactly as filed.
    """
    if raw is None:
        return None
    s = raw.strip().replace(",", "").replace("$", "")
    if not s:
        return None
    negative = s.startswith("(") and s.endswith(")")
    if negative:
        s = s[1:-1]
    try:
        value = float(s)
    except ValueError:
        return None
    return -value if negative else value


def parse_count(raw: Optional[str]) -> Optional[int]:
    """Account counts are whole numbers written like money ('1,234.00')."""
    value = parse_money(raw)
    if value is None:
        return None
    return int(value)


def parse_filing_date(raw: Optional[str]) -> Optional[date]:
    """'05/11/2026' -> date(2026, 5, 11). Blank/garbage -> None."""
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    try:
        return datetime.strptime(s, "%m/%d/%Y").date()
    except ValueError:
        return None


def parse_crd(raw: Optional[str]) -> Optional[int]:
    """CRD numbers arrive as bare digit strings. Anything else is not a CRD."""
    if raw is None:
        return None
    s = raw.strip()
    if not re.fullmatch(r"\d+", s):
        return None
    return int(s)


def _record_from_row(row: dict) -> Optional[AdviserRecord]:
    crd = parse_crd(row.get(CRD_COL))
    if crd is None:
        return None
    primary = (row.get(PRIMARY_NAME_COL) or "").strip()
    if not primary:
        return None
    legal = (row.get(LEGAL_NAME_COL) or "").strip() or None
    status = (row.get(STATUS_COL) or "").strip() or None
    return AdviserRecord(
        crd=crd,
        primary_business_name=primary,
        legal_name=legal,
        raum_total_usd=parse_money(row.get(RAUM_TOTAL_COL)),
        raum_discretionary_usd=parse_money(row.get(RAUM_DISCRETIONARY_COL)),
        raum_non_discretionary_usd=parse_money(row.get(RAUM_NON_DISCRETIONARY_COL)),
        raum_total_accounts=parse_count(row.get(ACCOUNTS_TOTAL_COL)),
        raum_reported_at=parse_filing_date(row.get(FILED_COL)),
        sec_status=status,
    )


def iter_roster_rows(text_stream) -> Iterator[AdviserRecord]:
    """Yield AdviserRecords from an already-decoded roster CSV stream.

    Raises AdvRosterError when the header is missing any required column, which
    is how the exempt roster (171 columns, no Item 5) is rejected.
    """
    reader = csv.DictReader(text_stream)
    header = reader.fieldnames or []
    missing = [c for c in REQUIRED_COLUMNS if c not in header]
    if missing:
        raise AdvRosterError(
            "not a Form ADV Part 1 firm roster: missing column(s) "
            + ", ".join(repr(c) for c in missing)
            + f" (header has {len(header)} columns). The exempt-reporting-adviser "
            "roster has no Item 5 columns at all and carries no RAUM, so it "
            "cannot supply the numbers pillar."
        )
    for row in reader:
        record = _record_from_row(row)
        if record is not None:
            yield record


def load_roster_zip(zip_path: str) -> list[AdviserRecord]:
    """Read the single CSV out of the SEC roster zip and parse every row.

    The zip is expected to hold exactly one .CSV member; more than one means the
    SEC changed the packaging and the caller must look rather than guess.
    """
    with zipfile.ZipFile(zip_path) as archive:
        members = [n for n in archive.namelist() if n.upper().endswith(".CSV")]
        if len(members) != 1:
            raise AdvRosterError(
                f"expected exactly one CSV in {zip_path}, found {len(members)}: {members}"
            )
        with archive.open(members[0]) as raw:
            stream = io.TextIOWrapper(raw, encoding=ROSTER_ENCODING, newline="")
            return list(iter_roster_rows(stream))
