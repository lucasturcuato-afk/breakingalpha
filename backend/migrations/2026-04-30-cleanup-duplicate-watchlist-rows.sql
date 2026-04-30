-- 2026-04-30-cleanup-duplicate-watchlist-rows.sql
--
-- One-time cleanup of duplicate watchlist rows for noahhanning03@gmail.com.
--
-- Scope: STRICTLY scoped to the single user noahhanning03@gmail.com. This
-- migration does not touch any other user's rows. The target user_id is
-- resolved dynamically from auth.users by email, and the script aborts if
-- the email is not found.
--
-- Strategy: For each (user_id, identifier, type) tuple, keep the most recent
-- row (ORDER BY created_at DESC, id DESC) and delete the rest. The watchlist
-- table's primary key `id` is a UUID, so we tie-break on created_at first
-- (newest wins) and fall back to the UUID `id` for stability.
--
-- Known duplicates / garbage rows being cleaned up for noahhanning03@gmail.com:
--   - BRK.B   x 3 copies   -> keep 1
--   - AAPL    x 2 copies   -> keep 1
--   - IONQ    x 3 copies   -> keep 1
--   - NVDA    x 2 copies   -> keep 1
--   - 'Afterquerey'                (typo, garbage entry)
--   - 'Technology'                 (sector string mistakenly stored as ticker)
--   - 'FINANCIAL SERVICES'         (sector string mistakenly stored as ticker)
--
-- NOTE: This migration does NOT prevent future duplicates. Future duplicate
-- prevention (a unique constraint or trigger on (user_id, identifier, type))
-- is tracked as separate post-launch work.
--
-- Run manually via the Supabase SQL Editor. Wrapped in a transaction so the
-- whole cleanup either applies or rolls back atomically.

BEGIN;

DO $$
DECLARE
  target_user_id UUID;
  deleted_dupes  INTEGER;
  deleted_junk   INTEGER;
BEGIN
  SELECT id
    INTO target_user_id
    FROM auth.users
   WHERE email = 'noahhanning03@gmail.com';

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'noahhanning03@gmail.com not found in auth.users';
  END IF;

  -- 1. Delete duplicate (user_id, identifier, type) rows, keeping the most
  --    recent per tuple.
  WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY user_id, identifier, type
             ORDER BY created_at DESC, id DESC
           ) AS rn
      FROM public.watchlist
     WHERE user_id = target_user_id
  )
  DELETE FROM public.watchlist
   WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

  GET DIAGNOSTICS deleted_dupes = ROW_COUNT;
  RAISE NOTICE 'Deleted % duplicate watchlist rows for noahhanning03@gmail.com', deleted_dupes;

  -- 2. Delete known garbage rows (typo + sector strings stored as tickers).
  --    Match is case-sensitive and exact -- only the listed strings.
  DELETE FROM public.watchlist
   WHERE user_id = target_user_id
     AND identifier IN ('Afterquerey', 'Technology', 'FINANCIAL SERVICES');

  GET DIAGNOSTICS deleted_junk = ROW_COUNT;
  RAISE NOTICE 'Deleted % garbage watchlist rows for noahhanning03@gmail.com', deleted_junk;
END $$;

-- 3. Verification: show remaining row count and any remaining duplicates.
--    The duplicates query should return zero rows.
SELECT COUNT(*) AS remaining_rows
  FROM public.watchlist
 WHERE user_id = (SELECT id FROM auth.users WHERE email = 'noahhanning03@gmail.com');

SELECT identifier, type, COUNT(*) AS dupe_count
  FROM public.watchlist
 WHERE user_id = (SELECT id FROM auth.users WHERE email = 'noahhanning03@gmail.com')
 GROUP BY identifier, type
HAVING COUNT(*) > 1;

COMMIT;
