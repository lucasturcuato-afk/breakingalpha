"""SEC submissions API client. Polls per-CIK for new filings."""
from __future__ import annotations

import logging
import os
import re
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from supabase import Client

from backend.edgar import shard_coverage
from backend.edgar.client import sec_get
from backend.edgar.constants import FILING_LOOKBACK_DAYS

logger = logging.getLogger(__name__)


# --- Poll tiering -----------------------------------------------------------
# The hourly EDGAR poll used to hard-cap at the top 200 companies by
# mention_count (plus the watchlist), which left 580 of the 792 CIK-bearing
# companies permanently unpolled. Uncapping outright is not safe: a first run
# over the tail sees every filing inside FILING_LOOKBACK_DAYS as new, measured
# at ~5.6 filings per tail CIK, and each new filing costs another SEC fetch
# plus (for 8-Ks) a Gemini summarize. That blows the 20 minute job timeout.
#
# So coverage widens by TIERING instead:
#   HOT  polled every run: watchlist CIKs, top-N by mention_count, and
#        companies that filed recently (they are the ones likely to file again)
#   TAIL sharded across runs: cik %% EDGAR_POLL_TAIL_SHARDS == slot, where slot
#        is derived from the run's UTC weekday+hour. With the default of 24
#        shards on an hourly cron, every tail CIK is polled once per day, well
#        inside the FILING_LOOKBACK_DAYS=14 window, so nothing is missed.
#
# Every knob is env-overridable. Defaults preserve the existing hot behavior.
DEFAULT_HOT_MENTION_LIMIT = 200
DEFAULT_HOT_RECENT_FILING_DAYS = 7
DEFAULT_HOT_RECENT_LIMIT = 150
DEFAULT_TAIL_SHARDS = 24
DEFAULT_TAIL_MAX_PER_RUN = 60


def _env_int(name: str, default: int) -> int:
    """Read a non-negative int from env, falling back to default on junk."""
    raw = os.environ.get(name)
    if raw is None or not str(raw).strip():
        return default
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        logger.warning("[edgar] %s=%r is not an int, using %d", name, raw, default)
        return default
    if value < 0:
        logger.warning("[edgar] %s=%d is negative, using %d", name, value, default)
        return default
    return value


def _env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or not str(raw).strip():
        return default
    return str(raw).strip().lower() not in {"0", "false", "no", "off"}


def tail_slot(now: datetime, shards: int) -> int:
    """Which tail shard a run SCHEDULED for `now` (UTC) owns. Pure, no I/O.

    Slot walks the weekly hour grid so shard counts that do not divide 24
    still rotate through the whole tail instead of pinning to one bucket.

    `now` must be the moment the run was SCHEDULED for, not the moment it
    executes. Callers get that from scheduled_moment(); see the note above it
    for why the two are not interchangeable.
    """
    if shards <= 0:
        return 0
    return (now.weekday() * 24 + now.hour) % shards


# --- Scheduled time vs execution time --------------------------------------
# tail_slot must be fed the hour a run was SCHEDULED for. It used to be fed
# datetime.now(), which is the hour the run EXECUTES in, and at the default of
# 24 shards the slot expression reduces to exactly that hour. So a run
# scheduled for 00:00 that starts at 01:15 claimed slot 1, polled shard 1 a
# second time that day, and left shard 0 unpolled. The shift is silent: the run
# succeeds, the log names a shard, and the abandoned shard is only visible as a
# CIK that has not been looked at in weeks.
#
# No clock-only heuristic recovers the intended hour, because scheduler delay
# is ONE-SIGNED. A run is late, never early. Flooring execution time (the old
# behavior) is right for any delay under one period and wrong past it. Rounding
# to the NEAREST boundary is strictly worse, not better: it breaks every delay
# over half a period, including ones flooring got right. The intended hour has
# to be STAMPED by whoever scheduled the run, so it is threaded in as a value.
#
# Where the stamp comes from, per trigger:
#   workflow_dispatch  the `scheduled_hour` input, forwarded to
#                      ingest_sec.py as --scheduled-hour. This is the only
#                      trigger that can carry it exactly.
#   manual/local       --scheduled-hour, or EDGAR_SCHEDULED_HOUR in the env.
#   GitHub `schedule`  NOTHING. The schedule event payload carries the cron
#                      EXPRESSION (github.event.schedule, e.g. "0 * * * *"),
#                      which says "every hour" and cannot say WHICH hour. There
#                      is no intended-timestamp field. Unstamped runs therefore
#                      fall back to execution time, which is the pre-existing
#                      behavior and no worse than it was.
SCHEDULED_HOUR_ENV = "EDGAR_SCHEDULED_HOUR"
# A stamp is anchored to the execution date. Allow a little slack for a run
# that starts marginally before its own boundary (clock skew) before deciding
# the stamp must belong to the previous day.
SCHEDULED_HOUR_SKEW = timedelta(minutes=5)


def parse_scheduled_hour(raw: Optional[object]) -> Optional[int]:
    """The UTC hour a run was scheduled for, from a stamped marker. Pure, no I/O.

    Accepts either a bare hour ("0".."23") or a full ISO-8601 timestamp, so a
    scheduler that can only send a constant string and one that can template a
    timestamp both work with no code change. Returns None for anything
    unusable, which means "no stamp, fall back to execution time".
    """
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None

    # Timestamp form first. Only attempt it when the text actually looks like a
    # timestamp, so a bare "-5" is not mistaken for one.
    if len(text) > 2 and any(ch in text for ch in "-T:"):
        try:
            moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            moment = None
        if moment is not None:
            if moment.tzinfo is not None:
                moment = moment.astimezone(timezone.utc)
            return moment.hour

    try:
        hour = int(text)
    except (TypeError, ValueError):
        logger.warning(
            "[edgar] scheduled hour %r is neither an hour nor a timestamp, "
            "falling back to execution time", raw,
        )
        return None
    if not 0 <= hour <= 23:
        logger.warning(
            "[edgar] scheduled hour %d is outside 0-23, falling back to "
            "execution time", hour,
        )
        return None
    return hour


def scheduled_moment(now: datetime, hour: Optional[int]) -> datetime:
    """The instant a run was scheduled for, given when it executed. Pure, no I/O.

    `hour` is a stamped UTC hour or None. None returns `now` unchanged, which
    is exactly the old behavior, so an unstamped run is no worse off than
    before. A stamped hour is anchored to the execution DATE and stepped back a
    day when it reads as the future, because a run is late and never early:
    a run stamped 23 that starts at 00:20 belongs to the previous day, and the
    weekday term in tail_slot only cancels out when shards divides 24.
    """
    if hour is None:
        return now
    moment = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if moment - now > SCHEDULED_HOUR_SKEW:
        moment -= timedelta(days=1)
    return moment


def select_tail_ciks(
    candidates: list[dict],
    *,
    slot: int,
    shards: int,
    max_per_run: int,
    rotation: int = 0,
) -> list[dict]:
    """Pick this run's tail shard from the un-hot CIKs. Pure, no I/O.

    Selection is `cik % shards == slot`, ordered by cik for determinism. If the
    bucket overflows max_per_run the window is ROTATED by `rotation` before
    truncating, so an oversized bucket starves its high CIKs for a day rather
    than forever.
    """
    if shards <= 0 or not candidates:
        return []
    slot %= shards
    picked = sorted(
        (c for c in candidates if c["cik"] % shards == slot),
        key=lambda c: c["cik"],
    )
    if max_per_run and len(picked) > max_per_run:
        offset = rotation % len(picked)
        picked = (picked[offset:] + picked[:offset])[:max_per_run]
        logger.warning(
            "[edgar] tail shard %d has %d CIKs, capped to %d (rotation offset %d)",
            slot, len(candidates), max_per_run, offset,
        )
    return picked


def shard_member_count(candidates: list[dict], *, slot: int, shards: int) -> int:
    """How many candidates belong to `slot`, BEFORE any cap. Pure, no I/O.

    The denominator select_tail_ciks does not report. Its return is the capped
    list, so len() of it says what the run took and cannot say what the shard
    holds. Coverage needs both: polled == selected proves the run finished its
    own list, and selected == members is what proves that list was the shard.
    The membership rule is the same one expression as in select_tail_ciks and
    is not a second definition of it.
    """
    if shards <= 0 or not candidates:
        return 0
    slot %= shards
    return sum(1 for c in candidates if c["cik"] % shards == slot)


# PostgREST answers at most PAGE_SIZE rows and does NOT error when it
# truncates, so a bare .execute() on a table that can outgrow one page returns
# a prefix that is indistinguishable from a complete answer.
PAGE_SIZE = 1000
# A .in_() list travels in the URL query string, so a long watchlist has to be
# asked for in chunks or the request outgrows the server's URL limit.
IN_CHUNK = 150


def _paged_rows(build, *, page_size: int = PAGE_SIZE) -> list[dict]:
    """Walk a PostgREST select in pages. `build(offset, limit)` returns a query.

    Every read here that has no .single() and no bounding filter goes through
    this, because the server cap is silent. The loop stops on a SHORT page,
    which is the one stopping condition that stays correct whether or not the
    server cap happens to equal page_size.
    """
    rows: list[dict] = []
    offset = 0
    while True:
        page = build(offset, page_size).execute().data or []
        rows.extend(page)
        if len(page) < page_size:
            return rows
        offset += page_size


def _company_ids_by_cik(sb: Client, ciks: list[int]) -> dict[int, str]:
    """Map sec_cik -> companies.id in chunked, paged reads.

    Replaces an N+1: this used to be one .eq("sec_cik", cik).limit(1) per
    matched CIK, so the poll opened with one round trip per watchlist CIK
    before it fetched a single filing. Ordering on id makes the winner
    deterministic when two company rows share a cik; the per-CIK .limit(1) it
    replaces took whichever row the server happened to return first.
    """
    mapping: dict[int, str] = {}
    for i in range(0, len(ciks), IN_CHUNK):
        chunk = ciks[i:i + IN_CHUNK]
        rows = _paged_rows(
            lambda off, lim, _c=chunk: sb.table("companies")
            .select("id, sec_cik")
            .in_("sec_cik", _c)
            .order("id")
            .range(off, off + lim - 1)
        )
        for row in rows:
            mapping.setdefault(row["sec_cik"], row["id"])
    return mapping


def get_watchlist_ciks(sb: Client) -> list[dict]:
    """
    Returns list of {cik, ticker, company_id, company_name} for distinct CIKs
    from the watchlist + high-mention companies with CIKs.
    """
    seen_ciks: set[int] = set()
    results = []

    # Watchlist CIKs. Paged: this read decides which CIKs get polled at all, so
    # a silent truncation here drops companies out of the poll entirely.
    watchlist = _paged_rows(
        lambda off, lim: sb.table("watchlist")
        .select("identifier, type")
        .order("id")
        .range(off, off + lim - 1)
    )
    tickers = sorted({
        w["identifier"].upper()
        for w in watchlist
        if w.get("type") == "ticker" and w.get("identifier")
    })

    if tickers:
        # Chunked and paged. Ordered by cik so the resulting poll order is
        # deterministic; it was whatever the server returned, which matters
        # because --max-ciks truncates this list.
        ct: list[dict] = []
        for i in range(0, len(tickers), IN_CHUNK):
            chunk = tickers[i:i + IN_CHUNK]
            ct.extend(_paged_rows(
                lambda off, lim, _c=chunk: sb.table("cik_tickers")
                .select("cik, ticker, company_name")
                .in_("ticker", _c)
                .order("cik")
                .range(off, off + lim - 1)
            ))

        distinct_ciks = sorted({row["cik"] for row in ct})
        company_ids = _company_ids_by_cik(sb, distinct_ciks)
        for row in ct:
            if row["cik"] not in seen_ciks:
                seen_ciks.add(row["cik"])
                results.append({
                    "cik": row["cik"],
                    "ticker": row["ticker"],
                    "company_id": company_ids.get(row["cik"]),
                    "company_name": row["company_name"],
                })

    # Top-mention companies with CIKs. Was a hardcoded 200; now the explicit
    # EDGAR_POLL_HOT_MENTION_LIMIT knob, defaulting to the same 200.
    hot_limit = _env_int("EDGAR_POLL_HOT_MENTION_LIMIT", DEFAULT_HOT_MENTION_LIMIT)
    top_companies = (
        sb.table("companies")
        .select("id, ticker, sec_cik, name")
        .not_.is_("sec_cik", "null")
        .order("mention_count", desc=True)
        .limit(hot_limit)
        .execute()
        .data or []
    )
    for c in top_companies:
        if c["sec_cik"] not in seen_ciks:
            seen_ciks.add(c["sec_cik"])
            results.append({
                "cik": c["sec_cik"],
                "ticker": (c.get("ticker") or "").upper(),
                "company_id": c["id"],
                "company_name": c["name"],
            })

    logger.info("[edgar] %d CIKs to poll (watchlist + top-mention)", len(results))
    return results


def get_recent_filer_ciks(sb: Client) -> list[dict]:
    """CIKs that filed inside the recent window, as a hot tier.

    A company that just filed is the one most likely to file again, so it
    stays on the every-run poll even if its mention_count is low and its tail
    shard is not up today. Bounded by EDGAR_POLL_HOT_RECENT_LIMIT so the hot
    set cannot creep toward the full universe once the tail starts producing
    filings.
    """
    days = _env_int("EDGAR_POLL_HOT_RECENT_FILING_DAYS", DEFAULT_HOT_RECENT_FILING_DAYS)
    limit = _env_int("EDGAR_POLL_HOT_RECENT_LIMIT", DEFAULT_HOT_RECENT_LIMIT)
    if days <= 0 or limit <= 0:
        return []

    cutoff = (date.today() - timedelta(days=days)).isoformat()
    rows = (
        sb.table("sec_filings")
        .select("company_id")
        .gte("filing_date", cutoff)
        .not_.is_("company_id", "null")
        .order("filing_date", desc=True)
        .limit(1000)
        .execute()
        .data or []
    )
    # Preserve recency order while de-duplicating, then bound.
    company_ids: list = []
    seen_ids = set()
    for r in rows:
        cid = r.get("company_id")
        if cid and cid not in seen_ids:
            seen_ids.add(cid)
            company_ids.append(cid)
    company_ids = company_ids[:limit]
    if not company_ids:
        return []

    comps = (
        sb.table("companies")
        .select("id, ticker, sec_cik, name")
        .in_("id", company_ids)
        .not_.is_("sec_cik", "null")
        .execute()
        .data or []
    )
    return [
        {
            "cik": c["sec_cik"],
            "ticker": (c.get("ticker") or "").upper(),
            "company_id": c["id"],
            "company_name": c["name"],
        }
        for c in comps
    ]


# --- Catch-up sizing --------------------------------------------------------
# How many STALE shards a run may replay on top of its own. The job timeout is
# 20 minutes and the SEC client paces at 5 req/sec, so the budget is set in
# shards rather than time: measured tail shards run 14 to 33 CIKs on a mean of
# 21.3, so three replayed shards add roughly 64 CIK fetches to a run that
# already polls the hot set plus its own shard. That is well inside the budget
# a normal run already fits in, and it is deliberately conservative because a
# new filing costs a second SEC fetch and, for an 8-K, a Gemini summarize.
DEFAULT_CATCHUP_MAX_SHARDS = 3
# Staleness past which a shard is shouted about rather than quietly retried.
# Filings older than FILING_LOOKBACK_DAYS are dropped by filter_new_filings, so
# a shard stale for half that window is on a clock toward permanent data loss
# and wants a human, not another quiet retry.
DEFAULT_CATCHUP_ALERT_DAYS = FILING_LOOKBACK_DAYS / 2


class ShardGroup:
    """One shard's worth of tail CIKs, and whether the run finished it.

    Carries the identity needed to record coverage (slot, shards, the moment it
    was selected for, what chose it) next to the CIK set, so completion is
    asserted against the diff between what was selected and what was polled
    rather than against a row-level error count. A whole-CIK fetch failure is
    invisible in an error count; it is not invisible in this diff.
    """

    __slots__ = ("slot", "shards", "moment", "run_kind", "entries", "members")

    def __init__(self, *, slot, shards, moment, run_kind, entries, members=None):
        self.slot = slot
        self.shards = shards
        self.moment = moment
        self.run_kind = run_kind
        self.entries = entries
        # Full membership before the per-run cap. Defaults to the entry count,
        # which is correct whenever the cap did not bind.
        self.members = len(entries) if members is None else members

    @property
    def truncated(self) -> bool:
        """True when the per-run cap held this group short of its shard."""
        return len(self.entries) < self.members

    @property
    def ciks(self) -> set[int]:
        return {e["cik"] for e in self.entries}

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return (
            f"ShardGroup(slot={self.slot}, shards={self.shards}, "
            f"run_kind={self.run_kind!r}, ciks={len(self.entries)}"
            f"/{self.members})"
        )


class PollPlan:
    """What a run intends to poll, split so coverage can be recorded per shard."""

    __slots__ = ("hot", "groups", "slot_source", "slot_at", "now", "backlog", "stale")

    def __init__(self, *, hot, groups, slot_source, slot_at, now, backlog, stale):
        self.hot = hot
        self.groups = groups
        self.slot_source = slot_source
        self.slot_at = slot_at
        self.now = now
        self.backlog = backlog
        self.stale = stale

    @property
    def entries(self) -> list[dict]:
        """The flat poll list, hot first then each shard in order."""
        out = list(self.hot)
        for g in self.groups:
            out.extend(g.entries)
        return out


def plan_poll(
    sb: Client,
    *,
    now: Optional[datetime] = None,
    scheduled_hour: Optional[object] = None,
) -> PollPlan:
    """This run's poll: the hot set, this slot's shard, and any stale shards.

    The single implementation of what a run polls. get_poll_ciks delegates
    here, so there is one selection path and not two.

    Catch-up replays a stale slot by feeding its own moment back into the REAL
    select_tail_ciks. Shard membership is not reimplemented anywhere.

    TWO APPROXIMATIONS IN A REPLAY, both bounded:
      hot membership  the hot set is read as it is TODAY, not as it was at the
                      replayed hour. That cannot lose a CIK. A CIK that was
                      tail then and is hot now is polled as hot; one that was
                      hot then and is tail now is polled as tail. The only
                      unreachable case is a CIK deleted from companies
                      outright, which no selection could reach either.
      rotation        select_tail_ciks rotates an oversized bucket by the
                      moment's ordinal. The replayed moment supplies its own
                      ordinal, so a replay of an oversized shard picks a
                      possibly different subset than the original run would
                      have. It only bites when a shard exceeds max_per_run,
                      which measured shards do not, and when it does it
                      degrades to the starvation rotation the cap already has
                      rather than to a new failure mode.
    """
    now = now or datetime.now(timezone.utc)
    if scheduled_hour is None:
        scheduled_hour = os.environ.get(SCHEDULED_HOUR_ENV)
    parsed_hour = parse_scheduled_hour(scheduled_hour)
    # Named in the ledger so the two writers of "which shard was covered" are
    # distinguishable in the data instead of inferred from the shard count.
    slot_source = "stamped" if parsed_hour is not None else "execution_time"
    slot_at = scheduled_moment(now, parsed_hour)

    hot = get_watchlist_ciks(sb)
    seen = {e["cik"] for e in hot}
    for e in get_recent_filer_ciks(sb):
        if e["cik"] not in seen:
            seen.add(e["cik"])
            hot.append(e)

    shards = _env_int("EDGAR_POLL_TAIL_SHARDS", DEFAULT_TAIL_SHARDS)
    if not _env_flag("EDGAR_POLL_TAIL_ENABLED", True) or shards <= 0:
        logger.info("[edgar] tail sharding off, polling %d hot CIKs", len(hot))
        return PollPlan(
            hot=hot, groups=[], slot_source=slot_source, slot_at=slot_at,
            now=now, backlog=[], stale=[],
        )

    universe = get_xbrl_ciks(sb, log_prefix="edgar")
    candidates = [c for c in universe if c["cik"] not in seen]
    max_per_run = _env_int("EDGAR_POLL_TAIL_MAX_PER_RUN", DEFAULT_TAIL_MAX_PER_RUN)

    # slot_at, not now: both the shard and the starvation rotation key off the
    # SCHEDULED moment, so two runs claiming the same slot select identically.
    current = tail_slot(slot_at, shards)

    last_covered: dict[int, datetime] = {}
    ledger_born = None
    catchup_slots: list[int] = []
    stale: list = []
    if _env_flag("EDGAR_CATCHUP_ENABLED", True):
        try:
            view = shard_coverage.read_coverage(sb, shards=shards)
            last_covered, ledger_born = view.last_covered, view.born
            catchup_slots = shard_coverage.due_slots(
                slot_at=slot_at,
                shards=shards,
                current_slot=current,
                last_covered=last_covered,
                max_catchup=_env_int(
                    "EDGAR_CATCHUP_MAX_SHARDS", DEFAULT_CATCHUP_MAX_SHARDS
                ),
            )
            stale = shard_coverage.stale_beyond(
                slot_at=slot_at,
                shards=shards,
                last_covered=last_covered,
                limit=timedelta(days=_env_int(
                    "EDGAR_CATCHUP_ALERT_DAYS", int(DEFAULT_CATCHUP_ALERT_DAYS)
                )),
                # The ledger's own birth, not the oldest covered_at. A healthy
                # neighbour refreshes covered_at hourly and would suppress the
                # alarm on a slot that is never reached at all.
                ledger_born=ledger_born,
            )
        except Exception as e:
            # A ledger that cannot be read must not take the normal poll down,
            # but it must not be silent either: with no catch-up the run
            # degrades to exactly the pre-existing one-shard-per-run behavior.
            logger.error("[edgar] shard coverage unavailable, no catch-up: %s", e)
            last_covered, ledger_born, catchup_slots, stale = {}, None, [], []

    # The current slot first, then stale slots oldest-first. One
    # select_tail_ciks call PER SLOT, never one call over the union: max_per_run
    # caps a single slot's picked list, so a unioned call would apply one cap of
    # 60 to every shard at once and silently drop the remainder. Per slot, the
    # cap is per shard and measured shards (14 to 33) never reach it.
    groups: list[ShardGroup] = []
    for slot, moment, kind in _catchup_order(
        current, slot_at, catchup_slots, shards
    ):
        picked = select_tail_ciks(
            candidates,
            slot=slot,
            shards=shards,
            max_per_run=max_per_run,
            rotation=moment.toordinal(),
        )
        groups.append(ShardGroup(
            slot=slot, shards=shards, moment=moment, run_kind=kind, entries=picked,
            members=shard_member_count(candidates, slot=slot, shards=shards),
        ))

    # Measured at PLAN time, so it includes the shards this run is about to
    # cover. That is the useful reading: it is the depth of the hole as this
    # run found it, and comparing it across runs is how you see whether
    # catch-up is gaining or losing ground.
    backlog = [
        s for s in range(shards)
        if s != current % shards
        and shard_coverage.staleness(s, last_covered, slot_at)
        > shard_coverage.cycle_length(shards)
    ]

    tail_total = sum(len(g.entries) for g in groups)
    logger.info(
        "[edgar] polling %d CIKs: %d hot + %d tail across %d shard(s) "
        "(current shard %d of %d via %s, catch-up %s, backlog %d, "
        "%d tail candidates, scheduled %s, executing %s)",
        len(hot) + tail_total, len(hot), tail_total, len(groups),
        current, shards, slot_source, catchup_slots or "none", len(backlog),
        len(candidates), slot_at.isoformat(), now.isoformat(),
    )
    capped = [g.slot for g in groups if g.truncated]
    if capped:
        logger.warning(
            "[edgar] the per-run cap of %d truncated shard(s) %s. They are "
            "polled completely and recorded with truncated=true, which is NOT "
            "full coverage. Raise EDGAR_POLL_TAIL_MAX_PER_RUN or the shard "
            "count.",
            max_per_run, capped,
        )
    if stale:
        logger.error(
            "[edgar] %d shard(s) stale beyond the alert threshold and losing "
            "filings past the %d day ingest window: %s",
            len(stale), FILING_LOOKBACK_DAYS, stale,
        )

    return PollPlan(
        hot=hot, groups=groups, slot_source=slot_source, slot_at=slot_at,
        now=now, backlog=backlog, stale=stale,
    )


def _catchup_order(current, slot_at, catchup_slots, shards):
    """(slot, moment, run_kind) for every shard this run intends to cover."""
    out = [(current, slot_at, "current")]
    for slot in catchup_slots:
        moment = shard_coverage.replay_moment(
            slot_at=slot_at, shards=shards, slot=slot, slot_of=tail_slot
        )
        if moment is None:
            continue
        out.append((slot, moment, "catchup"))
    return out


def get_poll_ciks(
    sb: Client,
    *,
    now: Optional[datetime] = None,
    scheduled_hour: Optional[object] = None,
) -> list[dict]:
    """CIKs to poll this run: the full hot set plus this slot's tail shard.

    Thin wrapper over plan_poll, kept because it is the flat-list shape callers
    already use. plan_poll is the one that knows which shard each CIK came
    from, which is what recording coverage needs.
    """
    return plan_poll(sb, now=now, scheduled_hour=scheduled_hour).entries


def get_xbrl_ciks(sb: Client, *, log_prefix: str = "xbrl") -> list[dict]:
    """
    ALL companies with a sec_cik, for the daily XBRL financials refresh.
    Same {cik, ticker, company_id, company_name} shape as get_watchlist_ciks
    so the two resolvers are drop-in compatible.

    UNCAPPED on purpose. The daily XBRL refresh consumes it whole; the hourly
    EDGAR poll consumes it through get_poll_ciks, which shards it rather than
    walking all of it in one run. No watchlist union needed here: watchlist
    CIKs already carry sec_cik in companies (sync_cik_tickers maintains the
    column).

    Paged with .range(): PostgREST returns at most 1000 rows per request, so
    a single .execute() would silently truncate once the sec_cik universe
    outgrows one page. Secondary order on id keeps pages stable across
    mention_count ties.
    """
    seen: set[int] = set()
    results = []
    page, page_size = 0, 1000
    while True:
        rows = (
            sb.table("companies")
            .select("id, ticker, sec_cik, name")
            .not_.is_("sec_cik", "null")
            .order("mention_count", desc=True)
            .order("id")
            .range(page * page_size, (page + 1) * page_size - 1)
            .execute()
            .data or []
        )
        for c in rows:
            if c["sec_cik"] in seen:
                continue
            seen.add(c["sec_cik"])
            results.append({
                "cik": c["sec_cik"],
                "ticker": (c.get("ticker") or "").upper(),
                "company_id": c["id"],
                "company_name": c["name"],
            })
        if len(rows) < page_size:
            break
        page += 1

    logger.info("[%s] %d CIKs in the sec_cik universe", log_prefix, len(results))
    return results


def fetch_recent_filings(cik: int) -> Optional[list[dict]]:
    """Fetch recent filings for a CIK from submissions API."""
    padded = str(cik).zfill(10)
    url = f"https://data.sec.gov/submissions/CIK{padded}.json"
    resp = sec_get(url)
    if not resp:
        return None

    try:
        data = resp.json()
        recent = data.get("filings", {}).get("recent", {})
        accession = recent.get("accessionNumber", [])
        forms = recent.get("form", [])
        dates = recent.get("filingDate", [])
        accept_dts = recent.get("acceptanceDateTime", [])
        items_list = recent.get("items", [])
        primary_docs = recent.get("primaryDocument", [])

        filings = []
        for i in range(len(accession)):
            raw_items = items_list[i] if i < len(items_list) else ""
            filings.append({
                "accession_number": accession[i],
                "form": forms[i] if i < len(forms) else None,
                "filing_date": dates[i] if i < len(dates) else None,
                "acceptance_dt": accept_dts[i] if i < len(accept_dts) else None,
                "items": [s.strip() for s in raw_items.split(",") if s.strip()] if raw_items else [],
                "primary_document": primary_docs[i] if i < len(primary_docs) else None,
            })
        return filings
    except Exception as e:
        logger.error("[edgar] parse failed for CIK %d: %s", cik, e)
        return None


def filter_new_filings(
    sb: Client, cik: int, filings: list[dict], forms_of_interest: list[str]
) -> list[dict]:
    """Filter to forms we care about, within lookback window, AND not already ingested."""
    cutoff = date.today() - timedelta(days=FILING_LOOKBACK_DAYS)

    # Step 1: form type filter
    of_interest = [f for f in filings if f.get("form") in forms_of_interest]
    if not of_interest:
        return []

    # Step 2: date filter — skip filings older than FILING_LOOKBACK_DAYS
    recent = []
    n_filtered_date = 0
    for f in of_interest:
        filing_date_str = f.get("filing_date")
        if filing_date_str:
            try:
                filing_date = date.fromisoformat(filing_date_str)
                if filing_date < cutoff:
                    n_filtered_date += 1
                    continue
            except (ValueError, TypeError):
                pass  # If date is unparseable, let it through
        recent.append(f)

    if not recent:
        if n_filtered_date:
            logger.info(
                "[edgar] CIK %d: %d total, %d skipped (older than %dd), 0 new",
                cik, len(of_interest), n_filtered_date, FILING_LOOKBACK_DAYS,
            )
        return []

    # Step 3: dedup against existing accession numbers
    accession_numbers = [f["accession_number"] for f in recent]
    existing = (
        sb.table("sec_filings")
        .select("accession_number")
        .in_("accession_number", accession_numbers)
        .execute()
        .data or []
    )
    existing_set = {row["accession_number"] for row in existing}

    result = [f for f in recent if f["accession_number"] not in existing_set]
    n_filtered_dedup = len(recent) - len(result)

    logger.info(
        "[edgar] CIK %d: %d total, %d skipped (older than %dd), %d skipped (already in DB), %d new",
        cik, len(of_interest), n_filtered_date, FILING_LOOKBACK_DAYS, n_filtered_dedup, len(result),
    )
    return result


def build_document_url(cik: int, accession_number: str, primary_doc: str) -> str:
    """Construct full URL for the primary filing document."""
    accession_no_dashes = accession_number.replace("-", "")
    return f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession_no_dashes}/{primary_doc}"


# Form 4 primaryDocument points at the XSL-rendered HTML viewer (e.g.
# "xslF345X06/wk-form4_X.xml"), which returns HTML, not parseable XML. The raw
# ownershipDocument XML sits in the same accession folder with the leading
# "xsl.../" path segment removed. Regex-guarded, so it is a no-op when no xsl
# prefix is present and cannot break filings that already point at raw XML.
_XSL_PREFIX_RE = re.compile(r"^xsl[^/]*/")


def build_form4_document_url(cik: int, accession_number: str, primary_doc: str) -> str:
    """Construct the raw Form 4 XML URL, stripping any XSL viewer path prefix."""
    raw_doc = _XSL_PREFIX_RE.sub("", primary_doc or "")
    return build_document_url(cik, accession_number, raw_doc)
