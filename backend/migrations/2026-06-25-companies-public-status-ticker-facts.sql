-- UNAPPLIED, requires Noah. DO NOT APPLY autonomously.
--
-- D7 (backend): persist authoritative public/private status + ticker facts into
-- the companies entity store so synthesize can read them from the DB instead of
-- the small in-code _ENTITY_FACT_STATUS map. v1 of D7 ships WITHOUT this
-- migration (it injects the fact line from finnhub_helper.HARD_TICKER_OVERRIDES
-- plus the in-code status map); this migration is the forward path for a
-- read-from-DB version.
--
-- Why this is gated on a human: it adds columns to companies (a high-traffic
-- entity table) and seeds a fact row. Agents never apply migrations or write the
-- prod DB. Review the column names against the TS entity reader before applying.
--
-- Rollback: drop the two columns.
--   ALTER TABLE public.companies DROP COLUMN IF EXISTS is_public;
--   ALTER TABLE public.companies DROP COLUMN IF EXISTS exchange;

BEGIN;

ALTER TABLE public.companies
    ADD COLUMN IF NOT EXISTS is_public boolean,
    ADD COLUMN IF NOT EXISTS exchange  text;

COMMENT ON COLUMN public.companies.is_public IS
    'Authoritative public/private status. TRUE = publicly traded. NULL = unknown.';
COMMENT ON COLUMN public.companies.exchange IS
    'Primary listing exchange for public companies (e.g. NASDAQ, NYSE).';

-- Seed the known fast-changing fact this migration exists for: SpaceX went
-- public on 2026-06-12 (NASDAQ: SPCX). Matched case-insensitively on name.
UPDATE public.companies
   SET is_public = TRUE,
       exchange  = 'NASDAQ',
       ticker    = COALESCE(NULLIF(ticker, ''), 'SPCX'),
       last_updated = now()
 WHERE lower(name) = 'spacex';

COMMIT;
