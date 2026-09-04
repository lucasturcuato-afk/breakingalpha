-- EDGAR tail-shard coverage ledger.
--
-- WHY THIS TABLE EXISTS
-- The hourly EDGAR poll shards the CIK tail across runs (cik % shards == slot).
-- Nothing recorded WHICH shard a run actually polled. pipeline_runs records
-- that a run happened: brief_type, started_at, status, selected_count and an
-- error_notes blob that is str(dict), a stringified Python dict with single
-- quotes. It has no shard column and the stats dict has no shard key, so there
-- was no forward record of coverage and no way to ask "which shards are stale".
--
-- The only retrospective signal was pipeline_runs.started_at.hour, which worked
-- solely because the pre-#826 code reduced the slot to the execution hour at
-- shards=24. That proxy is written by a DIFFERENT path than the selection it is
-- being used to describe, and it stops being the slot the moment an external
-- scheduler starts stamping scheduled_hour. Two paths to one fact with only one
-- guarded is the failure class this repo keeps hitting, so the proxy is not
-- built on. This table is the single writer of "which shard was covered".
--
-- WHY NOT A COLUMN ON pipeline_runs
-- pipeline_runs is shared by every brief_type. A shard column would be NULL for
-- all of them but EDGAR, and the question asked at read time is "what is the
-- latest coverage per shard", which wants one row per shard, not one row per
-- run. This table answers that in `shards` rows and never grows.
--
-- WHY THE CHECK CONSTRAINT IS THE POINT
-- A previous EDGAR backfill in this repo silently skipped five whole CIKs via a
-- swallowed `except: continue`, and a whole-CIK fetch failure is invisible in a
-- row-level error count. The lesson was to assert completion against the diff.
-- ciks_polled = ciks_selected is that assertion, enforced by the database: a
-- shard that did not finish what it took cannot be recorded, even if
-- application code regresses. The write is rejected, the shard stays stale, and
-- the next run retries it.
--
-- WHAT THAT CONSTRAINT ALONE DOES NOT CATCH, and why ciks_in_shard is here
-- ciks_selected is what the run TOOK, and select_tail_ciks caps it at
-- EDGAR_POLL_TAIL_MAX_PER_RUN. Comparing polled to selected therefore says the
-- run finished its own list; it says nothing about whether that list was the
-- whole shard. A shard larger than the cap is truncated, polled completely, and
-- would satisfy `ciks_polled = ciks_selected` while leaving members unpolled.
-- Measured membership sits close enough to the cap that one period of universe
-- growth crosses it, with no code change and no signal: a live condition rather
-- than a hypothetical. (Figures withheld per the public-repo rule; they are in
-- the private report.) ciks_in_shard records full membership, the range
-- constraint holds selected within it, and `truncated` is GENERATED from the
-- two so the rule cannot drift from a hand-maintained flag.
--
-- NOT APPLIED BY THE AUTHOR OF THIS FILE. Apply by hand.

create table if not exists public.edgar_shard_coverage (
  -- Part of the key: changing EDGAR_POLL_TAIL_SHARDS changes what "shard 7"
  -- means, so rows written under a different shard count are not comparable
  -- and must not be read as coverage for the new one.
  shards        smallint    not null,
  shard         smallint    not null,
  -- The SCHEDULED moment the slot was selected for, not the execution moment.
  covered_at    timestamptz not null,
  -- What decided the slot. 'stamped' means an external scheduler supplied
  -- scheduled_hour; 'execution_time' means it fell back to the clock. Recorded
  -- so the two writers are distinguishable in the data instead of inferred.
  slot_source   text        not null,
  -- 'current' is this run's own slot, 'catchup' is a replayed stale slot.
  run_kind      text        not null,
  -- Full membership of this shard, BEFORE the per-run cap. ciks_selected is
  -- what the run took from it; the two differ only when the cap truncated.
  ciks_in_shard integer     not null,
  ciks_selected integer     not null,
  ciks_polled   integer     not null,
  -- Derived, never written. A capped shard is polled completely and still is
  -- not a covered shard, and this is what makes the two distinguishable to any
  -- reader without re-deriving the cap rule.
  truncated     boolean     generated always as (ciks_selected < ciks_in_shard) stored,
  -- Set once on insert and never touched by the upsert, so it dates the LEDGER
  -- rather than the row. covered_at is refreshed every time a shard is polled,
  -- which is why it cannot answer "how long has this ledger been running": a
  -- healthy neighbour keeps min(covered_at) an hour old forever. The unknown
  -- alarm needs the ledger's own age, and this is it.
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  primary key (shards, shard),

  constraint edgar_shard_coverage_complete
    check (ciks_polled = ciks_selected),
  constraint edgar_shard_coverage_selected_within_shard
    check (ciks_selected <= ciks_in_shard),
  constraint edgar_shard_coverage_nonneg
    check (ciks_selected >= 0 and ciks_polled >= 0 and ciks_in_shard >= 0),
  constraint edgar_shard_coverage_slot_source
    check (slot_source in ('stamped', 'execution_time')),
  constraint edgar_shard_coverage_run_kind
    check (run_kind in ('current', 'catchup')),
  constraint edgar_shard_coverage_shard_in_range
    check (shard >= 0 and shard < shards)
);

comment on table public.edgar_shard_coverage is
  'Latest successful poll per EDGAR tail shard. One row per (shards, shard). '
  'Written only after every CIK the run SELECTED was polled. Check truncated '
  'to tell a fully covered shard from one the per-run cap held short.';

comment on column public.edgar_shard_coverage.covered_at is
  'Scheduled moment of the run that covered this shard, not execution time.';

comment on column public.edgar_shard_coverage.slot_source is
  'Which writer chose the slot: an external stamp, or the execution clock.';

comment on column public.edgar_shard_coverage.ciks_in_shard is
  'Full shard membership before the per-run cap. ciks_selected <= this.';

comment on column public.edgar_shard_coverage.truncated is
  'Generated. True when the per-run cap held this run short of full membership.';

comment on column public.edgar_shard_coverage.created_at is
  'When this (shards, shard) row was FIRST written. Never updated by the '
  'upsert, so min(created_at) dates the ledger generation and drives the '
  'unknown-slot alarm.';

-- Staleness lookup is "give me every row for the current shard count, newest
-- first". The primary key already covers (shards, shard); this serves the
-- ordering half.
create index if not exists edgar_shard_coverage_shards_covered_at_idx
  on public.edgar_shard_coverage (shards, covered_at);

-- Internal ops telemetry. RLS on with no policies: the service role bypasses
-- RLS and is the only writer or reader, anon and authenticated get nothing.
alter table public.edgar_shard_coverage enable row level security;
