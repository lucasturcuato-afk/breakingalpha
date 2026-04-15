-- Clean up test/garbage entries from watchlist.
-- Run once in Supabase SQL Editor.

-- Remove known junk identifiers
DELETE FROM watchlist
WHERE identifier IN (
  'asdfasdf',
  'asdfsaff',
  'xyzgarbage123',
  'test',
  'Test',
  'TEST',
  'asdf',
  'qwerty',
  'foo',
  'bar'
);

-- Remove entries where identifier is a single character and type is ticker or company
-- (single-char entries are almost always test data or mistakes)
DELETE FROM watchlist
WHERE length(identifier) < 2
  AND type IN ('ticker', 'company');

-- Remove entries where identifier is all lowercase with no spaces and not in the
-- known ticker list (heuristic for random garbage strings)
-- Uncomment and adjust as needed:
-- DELETE FROM watchlist
-- WHERE type = 'company'
--   AND identifier = lower(identifier)   -- all lowercase
--   AND identifier NOT LIKE '% %'        -- no spaces (single word)
--   AND length(identifier) < 5           -- short (less likely to be a real company)
--   AND identifier NOT IN ('uber', 'lyft', 'zoom'); -- exclude known lowercase exceptions
