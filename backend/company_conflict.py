"""Lost-race (23505) recovery for INSERTs into `companies`.

WHY THIS EXISTS
---------------
`companies` carries FOUR unique things and only ONE of them is a plain column.
Enumerated 2026-09-01 from pg_constraint AND pg_indexes, recorded verbatim in
sql/proposals/0020b_norm_v2_revised_phases.sql (the CONSTRAINT AUDIT block):

    companies_name_key          UNIQUE (name)
    companies_name_norm_unique  UNIQUE (lower(btrim(name))) WHERE sec_cik IS NULL
    companies_sec_cik_unique    UNIQUE (sec_cik)            WHERE sec_cik IS NOT NULL
    companies_name_no_junk      CHECK (...)

The middle two are PARTIAL UNIQUE INDEXES. A partial index carries no
pg_constraint row, so any audit that reads pg_constraint alone reports both as
absent. Read pg_indexes.

Every live INSERT path writes sec_cik NULL, so a freshly minted row is INSIDE
companies_name_norm_unique. A 23505 raised by that index names a row whose
`name` differs from ours in case or in surrounding whitespace. Recovering with
`.eq("name", name)` therefore finds NOTHING, and a handler that reads "found
nothing" as "no such company" has converted a loud throw into a silent wrong
answer. That is the single failure this module exists to prevent.

THIS MODULE NORMALIZES NOTHING, ON PURPOSE
------------------------------------------
The repo has two name normalizers: `normalize.normalize_lookup_key` (v1, the
alias WRITE key) and `company_match.normalize_company_key` (v2, read-only).
Which one is canonical is an open decision. Neither appears below.

The index expression is `lower(btrim(name))`, which is neither v1 nor v2.
Reproducing it here would be a THIRD definition of "same name", and a third
definition that disagrees with the index on any Unicode edge case turns a
recovery into a miss. So every comparison below is evaluated BY POSTGRES:
`ilike` performs the case fold against the stored value, `.is_("sec_cik",
"null")` evaluates the index predicate, and the only thing Python does to the
needle is `.strip()`, which stands in for btrim on the value we send rather
than on the value stored.

The handler is therefore correct under v1, under v2, and under neither. If one
of them is later declared canonical, nothing here needs to change.

WHAT IT DOES WHEN THE WINNING ROW IS ITSELF A DUPLICATE
-------------------------------------------------------
It resolves to the winning row and does not look at any other row. It never
ranks, never prefers the row that carries a ticker or a CIK, and never merges.
Live example: "ExxonMobil" (no ticker, no CIK) and "Exxon" (XOM, CIK 34088) are
two rows for one company. An INSERT of "ExxonMobil" that loses the race
resolves to the "ExxonMobil" row, NOT to "Exxon".

That is correct for a lost race specifically, as distinct from a merge:

  - A 23505 names exactly one conflicting tuple. The contract of a lost-race
    handler is "return the row my INSERT would have become". The conflicting
    row IS that row, by the database's own definition of identity. Any other
    row is a different company as far as this code can prove.

  - Redirecting to a "better" row is a MERGE, and a merge here has no defensible
    default. For the Exxon cluster the higher-traffic row is the one WITHOUT
    identifiers, so "prefer the row with a CIK" demotes the busier row; "prefer
    the busier row" throws the CIK away. Both rules are arguable, which is
    exactly why the choice belongs to a merge policy and not to an exception
    handler.

  - A real merge must repoint company_mentions, financial_facts, sec_filings,
    insider_transactions, aliases and resolution_log, and fold mention_count and
    key_themes, inside ONE transaction. supabase-py exposes no BEGIN/COMMIT (see
    the module docstring of entity_resolver.py), so a merge attempted from here
    is a partial merge on any failure. norm_v2.merge_cluster in
    sql/proposals/0020b_norm_v2_revised_phases.sql is the machinery for that,
    hand-applied.

So recovery is IDENTITY-PRESERVING and MERGE-NEUTRAL: it converges two
concurrent writers onto one row, never two different rows onto one. It performs
ZERO writes to `companies`, so it cannot make an existing duplicate worse. The
duplicate stays a duplicate; fixing that is a separate, hand-applied job.

One consequence worth stating out loud: when the conflict comes from
companies_name_norm_unique rather than companies_name_key, the row we resolve to
has a DIFFERENT name string than the one we tried to insert. That is still
identity-preserving, because the database declared the two names to be one key.
We honour the index's identity rule; we do not invent one.

HOW A RECOVERY IS NOTICED
-------------------------
Every recovery prints one line with the stable prefix `[companies:23505]` naming
the index that fired and the probe that recovered, and bumps a counter readable
via `recovery_counts()`. The two rates mean different things and are therefore
counted separately:

  - a `companies_name_key` recovery is genuine write concurrency;
  - a `companies_name_norm_unique` recovery is a near-duplicate SPELLING being
    blocked, which is duplicate pressure, not concurrency. A rise in that
    counter is the signal that name variants are arriving faster than the alias
    table is absorbing them.

A recovery that finds nothing raises CompanyConflictUnresolved rather than
returning None. A None would be read as "no such company" by every caller here,
which is precisely the silent failure described above.
"""

import sys as _sys
from typing import Optional

# ONE module object under BOTH import paths.
#
# This backend uses a dual-path import convention (cron runs with cwd=backend/,
# tests and dev with cwd=repo-root), so `company_conflict` and
# `backend.company_conflict` normally load as two SEPARATE module objects with
# two separate copies of every class in them. That is harmless for the function
# imports the rest of the backend does, and it is NOT harmless here: this module
# exports an EXCEPTION, and `except CompanyConflictUnresolved` compares class
# IDENTITY. Under two module objects, the class raised by the resolver is not
# the class the caller is catching, and the except clause silently does not
# match. Caught by a test on the first run of it.
#
# Aliasing in sys.modules makes the second import find the first module instead
# of executing this file again. setdefault, not assignment, so whichever path
# loaded first stays the canonical one.
_sys.modules.setdefault("company_conflict", _sys.modules[__name__])
_sys.modules.setdefault("backend.company_conflict", _sys.modules[__name__])

#: SQLSTATE for unique_violation.
UNIQUE_VIOLATION = "23505"

#: Probe names. Kept as constants so the ladder can be asserted in tests rather
#: than described in a comment nobody re-reads.
PROBE_EXACT_NAME = "exact_name"
PROBE_NORM_NAME_CIK_NULL = "norm_name_cik_null"
PROBE_NORM_NAME_ANY = "norm_name_any"
PROBE_SEC_CIK = "sec_cik"

#: The full ladder, in the order it is attempted when the error names no index.
#:
#: PROBE_NORM_NAME_ANY exists for the constraint-widening PR that follows this
#: one. Today companies_name_norm_unique is partial on `sec_cik IS NULL`, and
#: PROBE_NORM_NAME_CIK_NULL matches that predicate exactly. If the predicate is
#: dropped, PROBE_NORM_NAME_CIK_NULL becomes too narrow and PROBE_NORM_NAME_ANY
#: catches what it misses. Running both means this handler does not need to know
#: which shape is in force, which is the whole point of landing it FIRST.
PROBE_LADDER = (
    PROBE_EXACT_NAME,
    PROBE_NORM_NAME_CIK_NULL,
    PROBE_NORM_NAME_ANY,
    PROBE_SEC_CIK,
)

#: Index name -> the probe to try FIRST when the error names that index. A hint,
#: never a restriction: if the hinted probe misses, the rest of the ladder still
#: runs. PostgREST including the index name in `message` is convenient, not
#: load-bearing.
INDEX_PROBE_HINT = {
    "companies_name_key": PROBE_EXACT_NAME,
    "companies_name_norm_unique": PROBE_NORM_NAME_CIK_NULL,
    "companies_sec_cik_unique": PROBE_SEC_CIK,
}

_LOG_PREFIX = "[companies:23505]"

#: (index_name, probe) -> count, for the run. Read with recovery_counts().
_RECOVERY_COUNTS: dict = {}


class CompanyConflictUnresolved(RuntimeError):
    """A 23505 fired but no probe could find the conflicting row.

    Raised, never returned. The database says a row exists and we could not
    find it, which means an index we do not model fired, or the row was deleted
    between the INSERT and the probe. Either way the caller must not proceed as
    though the company does not exist.
    """


def recovery_counts() -> dict:
    """Snapshot of (index_name, probe) -> count for this process."""
    return dict(_RECOVERY_COUNTS)


def reset_recovery_counts() -> None:
    """Clear the counters. Called per run so a long-lived process does not carry
    one run's rate into the next."""
    _RECOVERY_COUNTS.clear()


def format_recovery_summary() -> str:
    """One grep-able line summarising the run's recoveries, or a zero line."""
    if not _RECOVERY_COUNTS:
        return f"{_LOG_PREFIX} recoveries=0"
    parts = " ".join(
        f"{idx}/{probe}={n}"
        for (idx, probe), n in sorted(_RECOVERY_COUNTS.items())
    )
    total = sum(_RECOVERY_COUNTS.values())
    return f"{_LOG_PREFIX} recoveries={total} {parts}"


def is_unique_violation(exc) -> bool:
    """True when `exc` is a Postgres unique_violation.

    postgrest-py RAISES APIError on a non-2xx and puts the SQLSTATE in `.code`,
    so the code check is exact when it is available. The substring fallback is
    for test doubles and for any client layer that flattens the error into a
    bare Exception; it is deliberately second, because "unique" appearing in an
    unrelated message is how a real error gets swallowed as a race.
    """
    code = getattr(exc, "code", None)
    if isinstance(code, str) and code.strip() == UNIQUE_VIOLATION:
        return True
    if code is not None and not isinstance(code, str):
        # A client that reports a numeric or enum code and it is not 23505.
        # Do not fall through to substring matching; that would ignore an
        # authoritative answer in favour of a guess.
        return str(code).strip() == UNIQUE_VIOLATION
    blob = " ".join(
        str(getattr(exc, attr, "") or "")
        for attr in ("message", "details", "hint")
    )
    blob = f"{blob} {exc}".lower()
    return (
        UNIQUE_VIOLATION in blob
        or "duplicate key" in blob
        or "unique constraint" in blob
        or "unique violation" in blob
    )


def conflicting_index_name(exc) -> Optional[str]:
    """The index named in the error, when one of ours is named.

    Postgres writes `duplicate key value violates unique constraint "<name>"`
    and PostgREST passes it through in `message`. Matched against our known
    names only, so an unfamiliar index yields None and the full ladder runs.
    """
    blob = " ".join(
        str(getattr(exc, attr, "") or "")
        for attr in ("message", "details", "hint")
    )
    blob = f"{blob} {exc}"
    for index_name in INDEX_PROBE_HINT:
        if index_name in blob:
            return index_name
    return None


def escape_like(value: str) -> str:
    """Escape a needle for PostgREST `ilike`.

    Measured against the live REST API, read-only, 2026-09-04:
      * `*` IS a wildcard: PostgREST rewrites it to `%` before SQL sees it.
      * a literal `%` IS a wildcard, and so is `_`.
      * a backslash reaches SQL and escapes the next character (`exxo\\_`
        returns zero rows where `exxo_` returns one).
      * `ilike` does NOT trim: a needle with surrounding spaces matches nothing.

    So `\\`, `%` and `_` are escaped here. `*` CANNOT be: PostgREST rewrites it
    to `%` first, so `\\*` arrives as `\\%`, a literal percent, which is a
    different character than the one we wanted. A name containing `*` therefore
    OVER-matches. That is safe by construction, because a probe result is only
    accepted when it is exactly one row: a widened match returns more than one
    and is refused, and the true conflicting row is always inside a widened set
    because widening only adds. Under-matching would be the dangerous
    direction, and escaping the three characters above is what prevents it.
    """
    out = value.replace("\\", "\\\\")
    out = out.replace("%", "\\%")
    out = out.replace("_", "\\_")
    return out


def _rows(query) -> list:
    return query.execute().data or []


def _run_probe(*, supabase, probe: str, name: str, sec_cik, select: str) -> list:
    """Execute one probe. Returns the rows it found; the caller decides.

    Nothing in here computes a normalized name. `ilike` is Postgres doing the
    case fold against the stored value, and `.is_("sec_cik","null")` is Postgres
    evaluating the partial index's own predicate.
    """
    table = supabase.table("companies")
    if probe == PROBE_EXACT_NAME:
        return _rows(table.select(select).eq("name", name).limit(2))
    if probe == PROBE_NORM_NAME_CIK_NULL:
        needle = escape_like(name.strip())
        return _rows(
            table.select(select)
            .ilike("name", needle)
            .is_("sec_cik", "null")
            .limit(2)
        )
    if probe == PROBE_NORM_NAME_ANY:
        needle = escape_like(name.strip())
        return _rows(table.select(select).ilike("name", needle).limit(2))
    if probe == PROBE_SEC_CIK:
        if sec_cik is None:
            return []
        return _rows(table.select(select).eq("sec_cik", sec_cik).limit(2))
    raise ValueError(f"unknown probe {probe!r}")


def probe_order(index_name: Optional[str]) -> tuple:
    """The ladder, with the hinted probe moved to the front.

    Every probe still runs. The hint reorders; it never filters. A handler that
    trusted the hint to be exhaustive would break the day PostgREST stops
    echoing the index name, and it would break silently.
    """
    hint = INDEX_PROBE_HINT.get(index_name or "")
    if hint is None:
        return PROBE_LADDER
    return (hint,) + tuple(p for p in PROBE_LADDER if p != hint)


def resolve_conflicting_company(
    *,
    supabase,
    name: str,
    sec_cik=None,
    exc=None,
    select: str = "id, name, ticker, sec_cik",
) -> dict:
    """Find the row that won the race, or raise.

    Args:
        supabase: supabase-py client (or a test double with the same surface).
        name: the `name` the losing INSERT tried to write, verbatim.
        sec_cik: the sec_cik the losing INSERT carried, if any. Both live insert
            paths pass None; the argument exists so a future path that mints
            with a CIK is covered by companies_sec_cik_unique too.
        exc: the exception the INSERT raised, used only to read the index name.
        select: columns to return.

    Returns:
        The winning row as a dict, with two extra keys the caller may ignore:
        `_conflict_index` and `_conflict_probe`.

    Raises:
        CompanyConflictUnresolved: no probe found a row. Never returns None.
    """
    index_name = conflicting_index_name(exc) if exc is not None else None
    attempted = []
    for probe in probe_order(index_name):
        rows = _run_probe(
            supabase=supabase, probe=probe, name=name, sec_cik=sec_cik, select=select
        )
        attempted.append(f"{probe}:{len(rows)}")
        if len(rows) != 1:
            # 0 rows: this index is not the one that fired, or it fired on a row
            # this probe cannot see. More than 1: the needle widened (see
            # escape_like) and we refuse to guess which is the conflict.
            continue
        row = dict(rows[0])
        key = (index_name or "unknown", probe)
        _RECOVERY_COUNTS[key] = _RECOVERY_COUNTS.get(key, 0) + 1
        print(
            f"{_LOG_PREFIX} recovered name={name!r} index={index_name or 'unknown'} "
            f"probe={probe} winner_id={row.get('id')} winner_name={row.get('name')!r} "
            f"probes={','.join(attempted)}"
        )
        return row

    raise CompanyConflictUnresolved(
        f"{_LOG_PREFIX} UNRECOVERED name={name!r} sec_cik={sec_cik!r} "
        f"index={index_name or 'unknown'} probes={','.join(attempted)}: the "
        f"database reported a unique violation but no probe found the row. "
        f"Original error: {exc!r}"
    )
