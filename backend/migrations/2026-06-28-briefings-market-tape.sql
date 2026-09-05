-- APPLIED (verified live 2026-09-05: briefings.market_tape exists). The first
-- line read "UNAPPLIED, requires Noah" until then. Agents never apply DDL.
--
-- Persist the gen-time market tape on each briefing (v2 Gate 1 prerequisite).
-- fetch_tape() is computed every run but discarded after building the prompt
-- directive, so there is no record of what the index/VIX numbers were at
-- generation time, which blocks tuning the "did the market move" gate. This adds
-- a nullable JSONB column written from the already-computed tape_obj
-- (synthesize.py, serialized via market_tape.serialize_tape_snapshot).
--
-- ADDITIVE ONLY: nullable column, no change to any existing column or read
-- contract. src/app/api/briefing/route.ts selects * and spreads the row, so the
-- new key surfaces as briefing.market_tape (distinct from briefing.market_pulse);
-- the frontend does not read it, so this is harmless. No route edit required.
--
-- Forward-only: gen-time tape for PAST briefings is unrecoverable and is NOT
-- backfilled. Rows created before this column exists keep market_tape = NULL.
--
-- Rollback:
--   ALTER TABLE public.briefings DROP COLUMN IF EXISTS market_tape;

BEGIN;

ALTER TABLE public.briefings
    ADD COLUMN IF NOT EXISTS market_tape jsonb;

COMMENT ON COLUMN public.briefings.market_tape IS
    'Gen-time market tape snapshot (nullable): per-index pct + level (sp500, nasdaq, dow, russell), vix_level, vix_pct, regime, as_of. Written from market_tape.serialize_tape_snapshot. NULL when no tape (weekend / thin) or for rows created before this column existed. Forward-only, not backfilled.';

COMMIT;
