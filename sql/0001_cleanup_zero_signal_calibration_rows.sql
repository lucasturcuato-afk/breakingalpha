-- Signalera — remove zero-signal garbage rows from pattern_library and
-- source_credibility so the Track Record UI renders honest empty states.
--
-- Run ONCE in the Supabase SQL editor after the backend gate ships.
-- Safe to re-run (idempotent).

-- Pattern library: delete rows where no thesis resolved confirmed or invalidated
delete from pattern_library
where coalesce(n_confirmed, 0) + coalesce(n_invalidated, 0) = 0;

-- Source credibility: same gate
delete from source_credibility
where coalesce(n_confirmed, 0) + coalesce(n_invalidated, 0) = 0;
