"""Which EDGAR tail shards are stale, and the ledger that records coverage.

The hourly poll covers one shard per run. Nothing recorded which shard, so a
run that never fired left its shard unpolled with no trace, and the only way to
notice was a CIK that had not been looked at in weeks.

This module holds two things and keeps them apart on purpose:

  PURE      due_slots / replay_moment / staleness math. No I/O, so the catch-up
            decision is testable without a database.
  LEDGER    read_coverage / record_coverage against edgar_shard_coverage.

WHAT THIS DELIBERATELY DOES NOT READ
pipeline_runs.started_at.hour is a faithful record of the shard actually polled
ONLY while the slot reduces to the execution hour, which needs shards == 24 and
no external stamp. It is written by a different path than the one that chooses
the shard, and it goes silently wrong the moment a scheduler starts stamping
scheduled_hour: started_at.hour then reports the hour the runner happened to
start in, while the run polled the stamped shard. Seeding coverage from it would
mark shards covered that were never polled, and the skip would be permanent and
invisible. So the ledger is the single writer and the single reader of "which
shard was covered", and an empty ledger means "nothing is known", not
"nothing was covered".
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

logger = logging.getLogger(__name__)

TABLE = "edgar_shard_coverage"


def parse_supabase_ts(value) -> Optional[datetime]:
    """Parse a Supabase timestamptz to an aware datetime, or None.

    The single definition in the backend. ingest_sec._parse_ts delegates here
    rather than keeping its own copy, because two functions parsing the same
    wire format is how they drift.
    """
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    s = str(value).strip().replace(" ", "T")
    # normalize a trailing "+00" offset to "+00:00" for fromisoformat
    if len(s) >= 3 and s[-3] in "+-" and s[-2:].isdigit():
        s = s + ":00"
    try:
        parsed = datetime.fromisoformat(s)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)

# A slot is due when its last coverage is older than one full turn of the shard
# wheel. At the default of 24 shards on an hourly cadence that is 24 hours.
SLOT_PERIOD = timedelta(hours=1)

# tail_slot walks a weekly hour grid, so every reachable slot recurs within one
# week. A shard count above this cannot be walked back to and is reported rather
# than silently skipped.
WEEK_HOURS = 7 * 24

# Never-covered slots sort ahead of every covered one. A real staleness can
# never reach this, so it is a safe sentinel rather than a magic comparison.
NEVER_COVERED = timedelta(days=36500)


def cycle_length(shards: int) -> timedelta:
    """How long one full turn of the shard wheel takes at hourly cadence."""
    if shards <= 0:
        return timedelta(0)
    return SLOT_PERIOD * shards


def staleness(
    slot: int, last_covered: dict[int, datetime], slot_at: datetime
) -> timedelta:
    """How long since `slot` was covered, as of `slot_at`. Pure, no I/O.

    A slot with no ledger row is NEVER_COVERED, not zero. Treating an absent
    row as fresh is how a coverage gap hides.
    """
    seen = last_covered.get(slot)
    if seen is None:
        return NEVER_COVERED
    gap = slot_at - seen
    return gap if gap > timedelta(0) else timedelta(0)


def due_slots(
    *,
    slot_at: datetime,
    shards: int,
    current_slot: int,
    last_covered: dict[int, datetime],
    max_catchup: int,
) -> list[int]:
    """Stale slots to replay this run, oldest first. Pure, no I/O.

    A slot is due when it has not been covered within one full cycle. The
    current slot is excluded because this run covers it anyway.

    Ordering is OLDEST FIRST, not newest. The binding deadline is
    FILING_LOOKBACK_DAYS: once a shard has been stale that long, the filings it
    missed fall outside the ingest window and are unrecoverable. Serving the
    freshest stale shard first would let the oldest one walk off that cliff.
    Ties break on slot number so the selection is deterministic.
    """
    if shards <= 0 or max_catchup <= 0:
        return []
    cycle = cycle_length(shards)
    candidates = [
        (staleness(s, last_covered, slot_at), s)
        for s in range(shards)
        if s != current_slot % shards
    ]
    due = [(age, s) for age, s in candidates if age > cycle]
    due.sort(key=lambda pair: (-pair[0].total_seconds(), pair[1]))
    return [s for _, s in due[:max_catchup]]


def stale_beyond(
    *,
    slot_at: datetime,
    shards: int,
    last_covered: dict[int, datetime],
    limit: timedelta,
) -> list[tuple[int, Optional[float]]]:
    """Slots whose staleness exceeds `limit`, as (slot, days) pairs. Pure.

    Drives the loud alarm, so it draws a line UNKNOWN is not the same as STALE.

    A slot with a row older than `limit` is stale: catch-up has been running
    and still could not reach it, and past FILING_LOOKBACK_DAYS the filings it
    missed are gone for good. That alarms.

    A slot with NO row is merely unknown. On a cold ledger every slot is
    unknown, and by construction catch-up covers them all within
    ceil(shards / budget) runs, so alarming there would turn the job red on the
    first deploy for a condition that heals itself in hours. It is reported
    with `days` of None, never a fabricated number.

    The hole that leaves is an unknown slot catch-up never actually reaches.
    That is closed by the ledger's own age: once the OLDEST row in the ledger
    is itself older than `limit`, the ledger has been alive far longer than a
    heal takes, and a slot still missing from it is being genuinely skipped.
    From that point unknown slots alarm too.
    """
    out: list[tuple[int, Optional[float]]] = []
    oldest = min(last_covered.values()) if last_covered else None
    unknown_alarms = oldest is not None and (slot_at - oldest) > limit
    for s in range(max(shards, 0)):
        if s not in last_covered:
            if unknown_alarms:
                out.append((s, None))
            continue
        age = slot_at - last_covered[s]
        if age > limit:
            out.append((s, round(age.total_seconds() / 86400, 2)))
    return out


def replay_moment(
    *, slot_at: datetime, shards: int, slot: int, slot_of
) -> Optional[datetime]:
    """The most recent moment at or before `slot_at` that owns `slot`. Pure.

    `slot_of(moment, shards)` is injected rather than imported so this module
    never has to know how a slot is derived; submissions.tail_slot is the only
    caller-supplied implementation and stays the single definition of shard
    membership.

    The returned moment is what gets fed back into the REAL selection function.
    Its only jobs are picking the shard and seeding the starvation rotation; it
    does NOT rewind what the SEC returns. fetch_recent_filings always answers
    with a CIK's current submissions, so replaying a missed hour polls that
    shard's CIKs NOW. That is why a gap of any length costs the same handful of
    runs to work through, and equally why nothing outside FILING_LOOKBACK_DAYS
    comes back.
    """
    if shards <= 0:
        return None
    for back in range(WEEK_HOURS):
        moment = (slot_at - timedelta(hours=back)).replace(
            minute=0, second=0, microsecond=0
        )
        if slot_of(moment, shards) == slot:
            return moment
    logger.warning(
        "[edgar] slot %d is unreachable within a week at %d shards", slot, shards
    )
    return None


def read_coverage(sb, *, shards: int) -> dict[int, datetime]:
    """Latest coverage per shard for THIS shard count. One bounded read.

    Bounded by construction: the table holds one row per (shards, shard), so
    the result cannot exceed `shards` rows. The count assertion is still made,
    because "small today" is not a property the server enforces and this repo
    has already shipped four wrong numbers to a silent 1000-row truncation.
    """
    resp = (
        sb.table(TABLE)
        .select("shard, covered_at", count="exact")
        .eq("shards", shards)
        .order("shard")
        .limit(max(shards, 1))
        .execute()
    )
    rows = resp.data or []
    total = getattr(resp, "count", None)
    if total is not None and len(rows) != total:
        raise RuntimeError(
            f"[edgar] shard coverage read truncated: {len(rows)} rows but "
            f"count says {total}. Refusing to plan a catch-up on a short read."
        )

    out: dict[int, datetime] = {}
    for row in rows:
        moment = parse_supabase_ts(row.get("covered_at"))
        if moment is None:
            continue
        out[int(row["shard"])] = moment
    return out


def record_coverage(
    sb,
    *,
    shards: int,
    shard: int,
    covered_at: datetime,
    slot_source: str,
    run_kind: str,
    ciks_selected: int,
    ciks_polled: int,
) -> bool:
    """Mark one shard covered. Returns True only if the ledger accepted it.

    Refuses locally when the shard was not fully polled, and the database
    refuses again via the complete constraint. Two gates on purpose: the local
    one keeps the reason in the log, the database one holds even if this
    function is bypassed or regresses.
    """
    if ciks_polled != ciks_selected:
        logger.warning(
            "[edgar] shard %d of %d NOT recorded: polled %d of %d selected CIKs. "
            "It stays stale and the next run retries it.",
            shard, shards, ciks_polled, ciks_selected,
        )
        return False
    try:
        sb.table(TABLE).upsert(
            {
                "shards": shards,
                "shard": shard,
                "covered_at": covered_at.isoformat(),
                "slot_source": slot_source,
                "run_kind": run_kind,
                "ciks_selected": ciks_selected,
                "ciks_polled": ciks_polled,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="shards,shard",
        ).execute()
        return True
    except Exception as e:
        logger.error(
            "[edgar] shard %d of %d coverage write failed: %s", shard, shards, e
        )
        return False
