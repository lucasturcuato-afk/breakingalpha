-- =====================================================================
-- 0029_rehome_stranded_identity.sql
--
--   *** PROPOSAL. NOT APPLIED. DO NOT RUN AS ONE SCRIPT. ***
--   *** Nothing in this file has been executed against any database. ***
--
-- Re-homes SEC identity onto the company rows that should have carried it.
--
-- WHAT HAPPENED. Entity resolution matched INTERIOR SUBSTRINGS and minted
-- fragment rows: "Ola" from coca-cOLA, "GHO" from westinGHOuse, "Hark" from
-- sHARKninja, "Acer" from mACERich, "ABC" from lABCorp, "Ely" from ardELYx,
-- "LIC" from repubLIC services. The ticker backfill stamped real identity onto
-- those fragments because they matched first, and facts and filings were then
-- ingested under those CIKs. The fragments were later stripped of their
-- identifiers. Nothing re-homed the identity, because
-- backend/edgar/cik_mapping.py::_update_companies_sec_cik JOINS ON TICKER
-- (it does `if not ticker: continue` at line 165) and the correct rows carry
-- no ticker.
--
-- WHY THE STAMP IS SUFFICIENT. Company Intel reads facts, filings and insider
-- rows by CIK, not by company_id:
--   src/lib/financial-facts.ts:514   .from("financial_facts_latest").eq("cik", res.cik)
--   src/lib/sec-filings.ts:365       .eq("cik", res.cik)  (company_id only as fallback)
-- and `res.cik` comes from resolveCompanyCik, which reads companies.sec_cik.
-- So setting companies.sec_cik on the correct row fills the page immediately.
-- The dependent rows' company_id is NOT on the read path and is NOT touched
-- here. See the "FOUR STORES" note at the bottom for what still disagrees.
--
-- WHY BOTH COLUMNS. `cik NOT NULL AND ticker IS NULL` is 0 in prod and is
-- load-bearing: src/lib/sec-filings.ts:122 relies on "every CIK-bearing
-- companies row carries a ticker". Every block writes BOTH columns so the
-- invariant survives. A block that wrote only sec_cik would break it.
--
-- CONSTRAINT DIRECTION ANALYSIS (companies carries four unique things;
-- enumerated in backend/company_conflict.py from pg_constraint AND pg_indexes):
--   companies_name_key         UNIQUE (name)
--       `name` is never written here. Cannot fire.
--   companies_name_no_junk     CHECK (lower(trim(name)) NOT IN (7 media names))
--       `name` is never written here. Cannot fire. No target name is listed.
--   companies_name_norm_unique UNIQUE (lower(btrim(name))) WHERE sec_cik IS NULL
--       The stamp moves the row OUT of this partial index (sec_cik goes
--       NULL -> NOT NULL). LEAVING an index cannot raise. Verified separately
--       that no other row shares lower(btrim(name)) with any target, so the
--       slot each row vacates was not shared.
--   companies_sec_cik_unique   UNIQUE (sec_cik) WHERE sec_cik IS NOT NULL
--       *** THE STAMP ENTERS THIS INDEX. THIS IS THE ONE THAT CAN RAISE
--       23505 AND ABORT A HAND-APPLIED BLOCK MID-RUN. *** Verified at
--       analysis time that no other row holds any of the 20 CIKs, that no
--       CIK appears twice in this plan, and that no row is targeted twice.
--       Verification is NOT trusted at apply time: every block re-checks it
--       in its own guard, because prod drifts hourly and the daily pipeline
--       can mint a holder between analysis and application.
--
-- HOW TO APPLY. One block at a time, in order, reading the read-back after
-- each. Every block is its own transaction and is independent of the others,
-- so stopping after any block leaves a consistent database. Re-running an
-- applied block is a NO-OP that raises a notice. Running a block against a
-- row that has drifted RAISES and rolls back that block only.
-- =====================================================================


-- =====================================================================
-- BLOCK 00  -- PRE-FLIGHT. Read-only. Changes nothing. Run it first.
--
-- Asserts the four constraints are actually in force with the shapes this
-- file assumes, and asserts that user_claims, morning_brief_calls and
-- output_grades cannot be reached from a companies UPDATE.
-- =====================================================================
BEGIN;

-- 00a. The four unique things. A partial unique index carries no pg_constraint
-- row, so read pg_indexes too or two of the four report as absent.
SELECT 'constraint' AS kind, conname AS name, pg_get_constraintdef(oid) AS def
  FROM pg_constraint WHERE conrelid = 'public.companies'::regclass
UNION ALL
SELECT 'index', indexname, indexdef
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'companies'
ORDER BY 1, 2;

-- 00b. NOTHING TOUCHES user_claims / morning_brief_calls / output_grades.
-- Read live rather than assumed. Expect ZERO rows from all three queries.
--
-- (i) no foreign key from any of the three to companies
SELECT c.conrelid::regclass AS child, c.conname, pg_get_constraintdef(c.oid)
  FROM pg_constraint c
 WHERE c.contype = 'f'
   AND c.conrelid IN ('public.user_claims'::regclass,
                      'public.morning_brief_calls'::regclass,
                      'public.output_grades'::regclass)
   AND c.confrelid = 'public.companies'::regclass;

-- (ii) no column in any of the three named like a company id / name
SELECT table_name, column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('user_claims','morning_brief_calls','output_grades')
   AND (column_name LIKE '%company%' OR column_name = 'name');

-- (iii) no trigger on companies that could write to any of the three
SELECT tgname, pg_get_triggerdef(oid)
  FROM pg_trigger
 WHERE tgrelid = 'public.companies'::regclass AND NOT tgisinternal;

-- 00c. The load-bearing invariant, BEFORE. Expect the third to be 0.
SELECT count(*) FILTER (WHERE ticker IS NOT NULL)                        AS with_ticker,
       count(*) FILTER (WHERE sec_cik IS NOT NULL)                       AS with_cik,
       count(*) FILTER (WHERE sec_cik IS NOT NULL AND ticker IS NULL)    AS cik_without_ticker
  FROM public.companies;

COMMIT;


-- =====================================================================
-- BLOCK 01  -- THE JOURNAL. Idempotent. Creates nothing that exists.
--
-- WHY THIS SHAPE, AND WHY IT IS NOT EXACTLY THE MERGE'S SHAPE.
--
-- `norm_v2.moved_row` DOES NOT EXIST IN PROD. It is named only inside a
-- comment in sql/proposals/0020_normalize_lookup_key_v2.sql (phase 8d), a
-- file whose own header says "PROPOSAL. NOT APPLIED", as the four-column
-- signature `moved_row(table_name, row_id, from_company_id, to_company_id)`
-- that phase 6 WOULD have to write for rollback to be exact. There is no
-- table, no schema, and no prior row to match. PostgREST exposes only
-- `public` and `graphql_public`, so this file cannot prove `norm_v2` is
-- absent, only that nothing has ever created it in this repo; CREATE ... IF
-- NOT EXISTS below is written so that either answer is safe.
--
-- The merge's four columns are kept VERBATIM as the spine so one reversal
-- procedure covers both operations. They are kept even though this operation
-- never populates from_company_id / to_company_id, because a reversal
-- procedure that has to handle two different column sets is two procedures.
--
-- What is ADDED, and why the merge shape alone is not enough: a merge moves a
-- dependent row BETWEEN companies, so from/to company ids fully describe it.
-- This operation moves NO ROW. It changes two columns ON a companies row. The
-- four columns cannot express that, so `before` / `after` jsonb carry the
-- column values. The dispatch for a reversal is then one rule:
--     to_company_id IS NOT NULL  -> repoint the dependent (merge)
--     to_company_id IS NULL      -> restore `before` onto row_id (this file)
-- =====================================================================
BEGIN;

CREATE SCHEMA IF NOT EXISTS norm_v2;

CREATE TABLE IF NOT EXISTS norm_v2.moved_row (
  id               bigserial PRIMARY KEY,
  -- the merge's four, verbatim
  table_name       text        NOT NULL,
  row_id           uuid        NOT NULL,
  from_company_id  uuid,
  to_company_id    uuid,
  -- what an identity stamp needs and a repoint does not
  op               text        NOT NULL,
  before           jsonb,
  after            jsonb,
  note             text,
  ran_at           timestamptz NOT NULL DEFAULT now(),
  ran_by           text        NOT NULL DEFAULT current_user
);

COMMENT ON TABLE norm_v2.moved_row IS
  'Reversal journal. One row per mutation. Two ops share it so one reversal '
  'procedure covers both: op=''repoint'' (the 0020 merge moving a dependent '
  'between companies, uses from/to_company_id) and op=''stamp_identity'' '
  '(0029 re-homing sec_cik + ticker onto a companies row, uses before/after). '
  'Dispatch on to_company_id IS NULL.';

-- One journal row per (op, row, table). Makes a re-applied block a no-op in
-- the journal too, instead of writing a second row whose `before` is the
-- ALREADY-STAMPED state, which would make the rollback restore the wrong
-- thing. This is the failure the index exists to prevent.
CREATE UNIQUE INDEX IF NOT EXISTS moved_row_stamp_once
    ON norm_v2.moved_row (table_name, row_id, op)
 WHERE op = 'stamp_identity';

COMMIT;


-- ---------------------------------------------------------------------
-- BLOCK 02  cik 1507605  ->  MARA
--   SEC: MARA Holdings, Inc.  (Nasdaq: MARA)
--   This CIK carries validated XBRL facts and filings (10-Q, 4, 8-K) plus insider transactions
--   that no company row claims. The receiving row is a real, mention-carrying
--   company row and it currently holds ticker NULL and sec_cik NULL.
--   financial_facts.company_id under this CIK today: NULL on every row
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := '1e3d53ae-f9f3-4ab8-a1c5-3c118d9280d8'::uuid;
  v_cik     bigint := 1507605;
  v_ticker  text := 'MARA';
  v_name    text := 'MARA';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_dupe    int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 02: row % is gone. REFUSING.', v_id;
  END IF;

  -- Pinned to id AND to every current value this block assumes.
  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 02: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  -- Already applied -> NO-OP, not an error. Re-running the file is safe.
  IF r.sec_cik = v_cik AND r.ticker = v_ticker THEN
    RAISE NOTICE 'BLOCK 02: already applied to % (cik %, ticker %). No-op.', v_name, v_cik, v_ticker;
    RETURN;
  END IF;

  -- Any other prior state is drift, and drift refuses.
  IF r.sec_cik IS NOT NULL OR r.ticker IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 02: % already carries ticker=% cik=%. This is shape B, not shape A. REFUSING.',
      v_name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_sec_cik_unique. THE ONLY CHECK THAT CAN ABORT THE
  -- STATEMENT ON CONFLICT. Re-checked here, not trusted from analysis time.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik AND id <> v_id;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 02: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort. It is still fatal to
  -- correctness: resolveCompanyCik step 2 matches ticker FIRST
  -- (src/lib/sec-filings.ts:299) and a second holder would misroute the page.
  SELECT count(*) INTO v_dupe FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_dupe > 0 THEN
    RAISE EXCEPTION 'BLOCK 02: ticker % already on % other row(s). REFUSING.', v_ticker, v_dupe;
  END IF;

  INSERT INTO norm_v2.moved_row (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'stamp_identity',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', v_ticker, 'sec_cik', v_cik),
          format('0029 block 02: re-home %s onto %s', v_cik, v_name));

  UPDATE public.companies
     SET ticker = v_ticker, sec_cik = v_cik
   WHERE id = v_id AND name = v_name AND ticker IS NULL AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 02: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. Expect exactly one row: MARA / MARA / 1507605, and facts_visible
-- greater than zero, which is the whole point of the block.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings s     WHERE s.cik = c.sec_cik) AS filings_visible
  FROM public.companies c
 WHERE c.id = '1e3d53ae-f9f3-4ab8-a1c5-3c118d9280d8'::uuid;

COMMIT;

-- ROLLBACK for block 02 only. Pinned to the journalled before-state, so it
-- refuses if anything else has since written the row.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker  = (j.before->>'ticker'),
--        sec_cik = (j.before->>'sec_cik')::bigint
--   FROM norm_v2.moved_row j
--  WHERE j.table_name = 'public.companies' AND j.op = 'stamp_identity'
--    AND j.row_id = '1e3d53ae-f9f3-4ab8-a1c5-3c118d9280d8'::uuid AND c.id = j.row_id
--    AND c.ticker = (j.after->>'ticker') AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.moved_row
--  WHERE table_name = 'public.companies' AND op = 'stamp_identity' AND row_id = '1e3d53ae-f9f3-4ab8-a1c5-3c118d9280d8'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 03  cik 49196  ->  Huntington Bancshares
--   SEC: HUNTINGTON BANCSHARES INC /MD/  (Nasdaq: HBAN)
--        SEC also lists HBANZ, HBANL, HBANM, HBANP; those are preferreds/warrants, common stock is HBAN
--   This CIK carries validated XBRL facts and filings (10-Q, 4, 8-K, 8-K/A) plus insider transactions
--   that no company row claims. The receiving row is a real, mention-carrying
--   company row and it currently holds ticker NULL and sec_cik NULL.
--   financial_facts.company_id under this CIK today: NULL on every row
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := '7361687b-ee93-4cef-b71d-7bf76fc634ca'::uuid;
  v_cik     bigint := 49196;
  v_ticker  text := 'HBAN';
  v_name    text := 'Huntington Bancshares';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_dupe    int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 03: row % is gone. REFUSING.', v_id;
  END IF;

  -- Pinned to id AND to every current value this block assumes.
  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 03: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  -- Already applied -> NO-OP, not an error. Re-running the file is safe.
  IF r.sec_cik = v_cik AND r.ticker = v_ticker THEN
    RAISE NOTICE 'BLOCK 03: already applied to % (cik %, ticker %). No-op.', v_name, v_cik, v_ticker;
    RETURN;
  END IF;

  -- Any other prior state is drift, and drift refuses.
  IF r.sec_cik IS NOT NULL OR r.ticker IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 03: % already carries ticker=% cik=%. This is shape B, not shape A. REFUSING.',
      v_name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_sec_cik_unique. THE ONLY CHECK THAT CAN ABORT THE
  -- STATEMENT ON CONFLICT. Re-checked here, not trusted from analysis time.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik AND id <> v_id;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 03: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort. It is still fatal to
  -- correctness: resolveCompanyCik step 2 matches ticker FIRST
  -- (src/lib/sec-filings.ts:299) and a second holder would misroute the page.
  SELECT count(*) INTO v_dupe FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_dupe > 0 THEN
    RAISE EXCEPTION 'BLOCK 03: ticker % already on % other row(s). REFUSING.', v_ticker, v_dupe;
  END IF;

  INSERT INTO norm_v2.moved_row (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'stamp_identity',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', v_ticker, 'sec_cik', v_cik),
          format('0029 block 03: re-home %s onto %s', v_cik, v_name));

  UPDATE public.companies
     SET ticker = v_ticker, sec_cik = v_cik
   WHERE id = v_id AND name = v_name AND ticker IS NULL AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 03: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. Expect exactly one row: Huntington Bancshares / HBAN / 49196, and facts_visible
-- greater than zero, which is the whole point of the block.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings s     WHERE s.cik = c.sec_cik) AS filings_visible
  FROM public.companies c
 WHERE c.id = '7361687b-ee93-4cef-b71d-7bf76fc634ca'::uuid;

COMMIT;

-- ROLLBACK for block 03 only. Pinned to the journalled before-state, so it
-- refuses if anything else has since written the row.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker  = (j.before->>'ticker'),
--        sec_cik = (j.before->>'sec_cik')::bigint
--   FROM norm_v2.moved_row j
--  WHERE j.table_name = 'public.companies' AND j.op = 'stamp_identity'
--    AND j.row_id = '7361687b-ee93-4cef-b71d-7bf76fc634ca'::uuid AND c.id = j.row_id
--    AND c.ticker = (j.after->>'ticker') AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.moved_row
--  WHERE table_name = 'public.companies' AND op = 'stamp_identity' AND row_id = '7361687b-ee93-4cef-b71d-7bf76fc634ca'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 04  cik 1324404  ->  CF Industries
--   SEC: CF Industries Holdings, Inc.  (NYSE: CF)
--   This CIK carries validated XBRL facts and filings (10-Q, 8-K)
--   that no company row claims. The receiving row is a real, mention-carrying
--   company row and it currently holds ticker NULL and sec_cik NULL.
--   financial_facts.company_id under this CIK today: NULL on every row
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := 'a0e35816-7939-4d7e-98f6-67240695af86'::uuid;
  v_cik     bigint := 1324404;
  v_ticker  text := 'CF';
  v_name    text := 'CF Industries';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_dupe    int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 04: row % is gone. REFUSING.', v_id;
  END IF;

  -- Pinned to id AND to every current value this block assumes.
  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 04: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  -- Already applied -> NO-OP, not an error. Re-running the file is safe.
  IF r.sec_cik = v_cik AND r.ticker = v_ticker THEN
    RAISE NOTICE 'BLOCK 04: already applied to % (cik %, ticker %). No-op.', v_name, v_cik, v_ticker;
    RETURN;
  END IF;

  -- Any other prior state is drift, and drift refuses.
  IF r.sec_cik IS NOT NULL OR r.ticker IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 04: % already carries ticker=% cik=%. This is shape B, not shape A. REFUSING.',
      v_name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_sec_cik_unique. THE ONLY CHECK THAT CAN ABORT THE
  -- STATEMENT ON CONFLICT. Re-checked here, not trusted from analysis time.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik AND id <> v_id;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 04: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort. It is still fatal to
  -- correctness: resolveCompanyCik step 2 matches ticker FIRST
  -- (src/lib/sec-filings.ts:299) and a second holder would misroute the page.
  SELECT count(*) INTO v_dupe FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_dupe > 0 THEN
    RAISE EXCEPTION 'BLOCK 04: ticker % already on % other row(s). REFUSING.', v_ticker, v_dupe;
  END IF;

  INSERT INTO norm_v2.moved_row (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'stamp_identity',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', v_ticker, 'sec_cik', v_cik),
          format('0029 block 04: re-home %s onto %s', v_cik, v_name));

  UPDATE public.companies
     SET ticker = v_ticker, sec_cik = v_cik
   WHERE id = v_id AND name = v_name AND ticker IS NULL AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 04: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. Expect exactly one row: CF Industries / CF / 1324404, and facts_visible
-- greater than zero, which is the whole point of the block.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings s     WHERE s.cik = c.sec_cik) AS filings_visible
  FROM public.companies c
 WHERE c.id = 'a0e35816-7939-4d7e-98f6-67240695af86'::uuid;

COMMIT;

-- ROLLBACK for block 04 only. Pinned to the journalled before-state, so it
-- refuses if anything else has since written the row.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker  = (j.before->>'ticker'),
--        sec_cik = (j.before->>'sec_cik')::bigint
--   FROM norm_v2.moved_row j
--  WHERE j.table_name = 'public.companies' AND j.op = 'stamp_identity'
--    AND j.row_id = 'a0e35816-7939-4d7e-98f6-67240695af86'::uuid AND c.id = j.row_id
--    AND c.ticker = (j.after->>'ticker') AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.moved_row
--  WHERE table_name = 'public.companies' AND op = 'stamp_identity' AND row_id = 'a0e35816-7939-4d7e-98f6-67240695af86'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 05  cik 1628171  ->  Revolution Medicines
--   SEC: Revolution Medicines, Inc.  (Nasdaq: RVMD)
--        SEC also lists RVMDW; those are preferreds/warrants, common stock is RVMD
--   This CIK carries validated XBRL facts and filings (10-Q, 4, 8-K) plus insider transactions
--   that no company row claims. The receiving row is a real, mention-carrying
--   company row and it currently holds ticker NULL and sec_cik NULL.
--   financial_facts.company_id under this CIK today: the fragment row 'Revolut'
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := 'd99e526f-da24-4a6c-bfd6-d2abe302a1d9'::uuid;
  v_cik     bigint := 1628171;
  v_ticker  text := 'RVMD';
  v_name    text := 'Revolution Medicines';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_dupe    int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 05: row % is gone. REFUSING.', v_id;
  END IF;

  -- Pinned to id AND to every current value this block assumes.
  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 05: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  -- Already applied -> NO-OP, not an error. Re-running the file is safe.
  IF r.sec_cik = v_cik AND r.ticker = v_ticker THEN
    RAISE NOTICE 'BLOCK 05: already applied to % (cik %, ticker %). No-op.', v_name, v_cik, v_ticker;
    RETURN;
  END IF;

  -- Any other prior state is drift, and drift refuses.
  IF r.sec_cik IS NOT NULL OR r.ticker IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 05: % already carries ticker=% cik=%. This is shape B, not shape A. REFUSING.',
      v_name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_sec_cik_unique. THE ONLY CHECK THAT CAN ABORT THE
  -- STATEMENT ON CONFLICT. Re-checked here, not trusted from analysis time.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik AND id <> v_id;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 05: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort. It is still fatal to
  -- correctness: resolveCompanyCik step 2 matches ticker FIRST
  -- (src/lib/sec-filings.ts:299) and a second holder would misroute the page.
  SELECT count(*) INTO v_dupe FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_dupe > 0 THEN
    RAISE EXCEPTION 'BLOCK 05: ticker % already on % other row(s). REFUSING.', v_ticker, v_dupe;
  END IF;

  INSERT INTO norm_v2.moved_row (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'stamp_identity',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', v_ticker, 'sec_cik', v_cik),
          format('0029 block 05: re-home %s onto %s', v_cik, v_name));

  UPDATE public.companies
     SET ticker = v_ticker, sec_cik = v_cik
   WHERE id = v_id AND name = v_name AND ticker IS NULL AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 05: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. Expect exactly one row: Revolution Medicines / RVMD / 1628171, and facts_visible
-- greater than zero, which is the whole point of the block.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings s     WHERE s.cik = c.sec_cik) AS filings_visible
  FROM public.companies c
 WHERE c.id = 'd99e526f-da24-4a6c-bfd6-d2abe302a1d9'::uuid;

COMMIT;

-- ROLLBACK for block 05 only. Pinned to the journalled before-state, so it
-- refuses if anything else has since written the row.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker  = (j.before->>'ticker'),
--        sec_cik = (j.before->>'sec_cik')::bigint
--   FROM norm_v2.moved_row j
--  WHERE j.table_name = 'public.companies' AND j.op = 'stamp_identity'
--    AND j.row_id = 'd99e526f-da24-4a6c-bfd6-d2abe302a1d9'::uuid AND c.id = j.row_id
--    AND c.ticker = (j.after->>'ticker') AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.moved_row
--  WHERE table_name = 'public.companies' AND op = 'stamp_identity' AND row_id = 'd99e526f-da24-4a6c-bfd6-d2abe302a1d9'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 06  cik 887936  ->  FTI Consulting
--   SEC: FTI CONSULTING, INC  (NYSE: FCN)
--   This CIK carries validated XBRL facts and filings (10-Q, 8-K)
--   that no company row claims. The receiving row is a real, mention-carrying
--   company row and it currently holds ticker NULL and sec_cik NULL.
--   financial_facts.company_id under this CIK today: the fragment row 'LTi'
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := '86418122-85a6-4f9a-a6d1-6e7dab5684fd'::uuid;
  v_cik     bigint := 887936;
  v_ticker  text := 'FCN';
  v_name    text := 'FTI Consulting';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_dupe    int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 06: row % is gone. REFUSING.', v_id;
  END IF;

  -- Pinned to id AND to every current value this block assumes.
  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 06: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  -- Already applied -> NO-OP, not an error. Re-running the file is safe.
  IF r.sec_cik = v_cik AND r.ticker = v_ticker THEN
    RAISE NOTICE 'BLOCK 06: already applied to % (cik %, ticker %). No-op.', v_name, v_cik, v_ticker;
    RETURN;
  END IF;

  -- Any other prior state is drift, and drift refuses.
  IF r.sec_cik IS NOT NULL OR r.ticker IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 06: % already carries ticker=% cik=%. This is shape B, not shape A. REFUSING.',
      v_name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_sec_cik_unique. THE ONLY CHECK THAT CAN ABORT THE
  -- STATEMENT ON CONFLICT. Re-checked here, not trusted from analysis time.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik AND id <> v_id;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 06: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort. It is still fatal to
  -- correctness: resolveCompanyCik step 2 matches ticker FIRST
  -- (src/lib/sec-filings.ts:299) and a second holder would misroute the page.
  SELECT count(*) INTO v_dupe FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_dupe > 0 THEN
    RAISE EXCEPTION 'BLOCK 06: ticker % already on % other row(s). REFUSING.', v_ticker, v_dupe;
  END IF;

  INSERT INTO norm_v2.moved_row (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'stamp_identity',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', v_ticker, 'sec_cik', v_cik),
          format('0029 block 06: re-home %s onto %s', v_cik, v_name));

  UPDATE public.companies
     SET ticker = v_ticker, sec_cik = v_cik
   WHERE id = v_id AND name = v_name AND ticker IS NULL AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 06: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. Expect exactly one row: FTI Consulting / FCN / 887936, and facts_visible
-- greater than zero, which is the whole point of the block.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings s     WHERE s.cik = c.sec_cik) AS filings_visible
  FROM public.companies c
 WHERE c.id = '86418122-85a6-4f9a-a6d1-6e7dab5684fd'::uuid;

COMMIT;

-- ROLLBACK for block 06 only. Pinned to the journalled before-state, so it
-- refuses if anything else has since written the row.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker  = (j.before->>'ticker'),
--        sec_cik = (j.before->>'sec_cik')::bigint
--   FROM norm_v2.moved_row j
--  WHERE j.table_name = 'public.companies' AND j.op = 'stamp_identity'
--    AND j.row_id = '86418122-85a6-4f9a-a6d1-6e7dab5684fd'::uuid AND c.id = j.row_id
--    AND c.ticker = (j.after->>'ticker') AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.moved_row
--  WHERE table_name = 'public.companies' AND op = 'stamp_identity' AND row_id = '86418122-85a6-4f9a-a6d1-6e7dab5684fd'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 07  cik 93556  ->  Stanley Black & Decker
--   SEC: STANLEY BLACK & DECKER, INC.  (NYSE: SWK)
--   This CIK carries validated XBRL facts and filings (10-Q, 8-K)
--   that no company row claims. The receiving row is a real, mention-carrying
--   company row and it currently holds ticker NULL and sec_cik NULL.
--   financial_facts.company_id under this CIK today: NULL on every row
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := 'fd1351a0-d811-48a5-9f3c-fd01b1dde8ab'::uuid;
  v_cik     bigint := 93556;
  v_ticker  text := 'SWK';
  v_name    text := 'Stanley Black & Decker';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_dupe    int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 07: row % is gone. REFUSING.', v_id;
  END IF;

  -- Pinned to id AND to every current value this block assumes.
  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 07: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  -- Already applied -> NO-OP, not an error. Re-running the file is safe.
  IF r.sec_cik = v_cik AND r.ticker = v_ticker THEN
    RAISE NOTICE 'BLOCK 07: already applied to % (cik %, ticker %). No-op.', v_name, v_cik, v_ticker;
    RETURN;
  END IF;

  -- Any other prior state is drift, and drift refuses.
  IF r.sec_cik IS NOT NULL OR r.ticker IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 07: % already carries ticker=% cik=%. This is shape B, not shape A. REFUSING.',
      v_name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_sec_cik_unique. THE ONLY CHECK THAT CAN ABORT THE
  -- STATEMENT ON CONFLICT. Re-checked here, not trusted from analysis time.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik AND id <> v_id;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 07: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort. It is still fatal to
  -- correctness: resolveCompanyCik step 2 matches ticker FIRST
  -- (src/lib/sec-filings.ts:299) and a second holder would misroute the page.
  SELECT count(*) INTO v_dupe FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_dupe > 0 THEN
    RAISE EXCEPTION 'BLOCK 07: ticker % already on % other row(s). REFUSING.', v_ticker, v_dupe;
  END IF;

  INSERT INTO norm_v2.moved_row (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'stamp_identity',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', v_ticker, 'sec_cik', v_cik),
          format('0029 block 07: re-home %s onto %s', v_cik, v_name));

  UPDATE public.companies
     SET ticker = v_ticker, sec_cik = v_cik
   WHERE id = v_id AND name = v_name AND ticker IS NULL AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 07: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. Expect exactly one row: Stanley Black & Decker / SWK / 93556, and facts_visible
-- greater than zero, which is the whole point of the block.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings s     WHERE s.cik = c.sec_cik) AS filings_visible
  FROM public.companies c
 WHERE c.id = 'fd1351a0-d811-48a5-9f3c-fd01b1dde8ab'::uuid;

COMMIT;

-- ROLLBACK for block 07 only. Pinned to the journalled before-state, so it
-- refuses if anything else has since written the row.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker  = (j.before->>'ticker'),
--        sec_cik = (j.before->>'sec_cik')::bigint
--   FROM norm_v2.moved_row j
--  WHERE j.table_name = 'public.companies' AND j.op = 'stamp_identity'
--    AND j.row_id = 'fd1351a0-d811-48a5-9f3c-fd01b1dde8ab'::uuid AND c.id = j.row_id
--    AND c.ticker = (j.after->>'ticker') AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.moved_row
--  WHERE table_name = 'public.companies' AND op = 'stamp_identity' AND row_id = 'fd1351a0-d811-48a5-9f3c-fd01b1dde8ab'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 08  cik 920148  ->  Labcorp
--   SEC: LABCORP HOLDINGS INC.  (NYSE: LH)
--   This CIK carries validated XBRL facts and filings (10-Q, 4, 8-K) plus insider transactions
--   that no company row claims. The receiving row is a real, mention-carrying
--   company row and it currently holds ticker NULL and sec_cik NULL.
--   financial_facts.company_id under this CIK today: the fragment row 'ABC'
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := '79966435-d6b9-4fc8-9db9-33f45b58b9c9'::uuid;
  v_cik     bigint := 920148;
  v_ticker  text := 'LH';
  v_name    text := 'Labcorp';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_dupe    int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 08: row % is gone. REFUSING.', v_id;
  END IF;

  -- Pinned to id AND to every current value this block assumes.
  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 08: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  -- Already applied -> NO-OP, not an error. Re-running the file is safe.
  IF r.sec_cik = v_cik AND r.ticker = v_ticker THEN
    RAISE NOTICE 'BLOCK 08: already applied to % (cik %, ticker %). No-op.', v_name, v_cik, v_ticker;
    RETURN;
  END IF;

  -- Any other prior state is drift, and drift refuses.
  IF r.sec_cik IS NOT NULL OR r.ticker IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 08: % already carries ticker=% cik=%. This is shape B, not shape A. REFUSING.',
      v_name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_sec_cik_unique. THE ONLY CHECK THAT CAN ABORT THE
  -- STATEMENT ON CONFLICT. Re-checked here, not trusted from analysis time.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik AND id <> v_id;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 08: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort. It is still fatal to
  -- correctness: resolveCompanyCik step 2 matches ticker FIRST
  -- (src/lib/sec-filings.ts:299) and a second holder would misroute the page.
  SELECT count(*) INTO v_dupe FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_dupe > 0 THEN
    RAISE EXCEPTION 'BLOCK 08: ticker % already on % other row(s). REFUSING.', v_ticker, v_dupe;
  END IF;

  INSERT INTO norm_v2.moved_row (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'stamp_identity',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', v_ticker, 'sec_cik', v_cik),
          format('0029 block 08: re-home %s onto %s', v_cik, v_name));

  UPDATE public.companies
     SET ticker = v_ticker, sec_cik = v_cik
   WHERE id = v_id AND name = v_name AND ticker IS NULL AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 08: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. Expect exactly one row: Labcorp / LH / 920148, and facts_visible
-- greater than zero, which is the whole point of the block.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings s     WHERE s.cik = c.sec_cik) AS filings_visible
  FROM public.companies c
 WHERE c.id = '79966435-d6b9-4fc8-9db9-33f45b58b9c9'::uuid;

COMMIT;

-- ROLLBACK for block 08 only. Pinned to the journalled before-state, so it
-- refuses if anything else has since written the row.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker  = (j.before->>'ticker'),
--        sec_cik = (j.before->>'sec_cik')::bigint
--   FROM norm_v2.moved_row j
--  WHERE j.table_name = 'public.companies' AND j.op = 'stamp_identity'
--    AND j.row_id = '79966435-d6b9-4fc8-9db9-33f45b58b9c9'::uuid AND c.id = j.row_id
--    AND c.ticker = (j.after->>'ticker') AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.moved_row
--  WHERE table_name = 'public.companies' AND op = 'stamp_identity' AND row_id = '79966435-d6b9-4fc8-9db9-33f45b58b9c9'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 09  cik 733269  ->  LiveRamp
--   SEC: LiveRamp Holdings, Inc.  (NYSE: RAMP)
--   This CIK carries validated XBRL facts and filings (10-Q, 8-K)
--   that no company row claims. The receiving row is a real, mention-carrying
--   company row and it currently holds ticker NULL and sec_cik NULL.
--   financial_facts.company_id under this CIK today: the fragment row 'Ramp'
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := '3778ec3b-adf7-4547-b0a8-9898ee18692d'::uuid;
  v_cik     bigint := 733269;
  v_ticker  text := 'RAMP';
  v_name    text := 'LiveRamp';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_dupe    int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 09: row % is gone. REFUSING.', v_id;
  END IF;

  -- Pinned to id AND to every current value this block assumes.
  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 09: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  -- Already applied -> NO-OP, not an error. Re-running the file is safe.
  IF r.sec_cik = v_cik AND r.ticker = v_ticker THEN
    RAISE NOTICE 'BLOCK 09: already applied to % (cik %, ticker %). No-op.', v_name, v_cik, v_ticker;
    RETURN;
  END IF;

  -- Any other prior state is drift, and drift refuses.
  IF r.sec_cik IS NOT NULL OR r.ticker IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 09: % already carries ticker=% cik=%. This is shape B, not shape A. REFUSING.',
      v_name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_sec_cik_unique. THE ONLY CHECK THAT CAN ABORT THE
  -- STATEMENT ON CONFLICT. Re-checked here, not trusted from analysis time.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik AND id <> v_id;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 09: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort. It is still fatal to
  -- correctness: resolveCompanyCik step 2 matches ticker FIRST
  -- (src/lib/sec-filings.ts:299) and a second holder would misroute the page.
  SELECT count(*) INTO v_dupe FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_dupe > 0 THEN
    RAISE EXCEPTION 'BLOCK 09: ticker % already on % other row(s). REFUSING.', v_ticker, v_dupe;
  END IF;

  INSERT INTO norm_v2.moved_row (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'stamp_identity',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', v_ticker, 'sec_cik', v_cik),
          format('0029 block 09: re-home %s onto %s', v_cik, v_name));

  UPDATE public.companies
     SET ticker = v_ticker, sec_cik = v_cik
   WHERE id = v_id AND name = v_name AND ticker IS NULL AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 09: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. Expect exactly one row: LiveRamp / RAMP / 733269, and facts_visible
-- greater than zero, which is the whole point of the block.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings s     WHERE s.cik = c.sec_cik) AS filings_visible
  FROM public.companies c
 WHERE c.id = '3778ec3b-adf7-4547-b0a8-9898ee18692d'::uuid;

COMMIT;

-- ROLLBACK for block 09 only. Pinned to the journalled before-state, so it
-- refuses if anything else has since written the row.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker  = (j.before->>'ticker'),
--        sec_cik = (j.before->>'sec_cik')::bigint
--   FROM norm_v2.moved_row j
--  WHERE j.table_name = 'public.companies' AND j.op = 'stamp_identity'
--    AND j.row_id = '3778ec3b-adf7-4547-b0a8-9898ee18692d'::uuid AND c.id = j.row_id
--    AND c.ticker = (j.after->>'ticker') AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.moved_row
--  WHERE table_name = 'public.companies' AND op = 'stamp_identity' AND row_id = '3778ec3b-adf7-4547-b0a8-9898ee18692d'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 10  cik 1583107  ->  Theravance Biopharma
--   SEC: Theravance Biopharma, Inc.  (Nasdaq: TBPH)
--   This CIK carries validated XBRL facts and filings (10-Q, 8-K)
--   that no company row claims. The receiving row is a real, mention-carrying
--   company row and it currently holds ticker NULL and sec_cik NULL.
--   financial_facts.company_id under this CIK today: the fragment row 'Avance'
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := 'e2fc418e-e6bd-42e0-a5d9-9e863fa98740'::uuid;
  v_cik     bigint := 1583107;
  v_ticker  text := 'TBPH';
  v_name    text := 'Theravance Biopharma';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_dupe    int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 10: row % is gone. REFUSING.', v_id;
  END IF;

  -- Pinned to id AND to every current value this block assumes.
  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 10: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  -- Already applied -> NO-OP, not an error. Re-running the file is safe.
  IF r.sec_cik = v_cik AND r.ticker = v_ticker THEN
    RAISE NOTICE 'BLOCK 10: already applied to % (cik %, ticker %). No-op.', v_name, v_cik, v_ticker;
    RETURN;
  END IF;

  -- Any other prior state is drift, and drift refuses.
  IF r.sec_cik IS NOT NULL OR r.ticker IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 10: % already carries ticker=% cik=%. This is shape B, not shape A. REFUSING.',
      v_name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_sec_cik_unique. THE ONLY CHECK THAT CAN ABORT THE
  -- STATEMENT ON CONFLICT. Re-checked here, not trusted from analysis time.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik AND id <> v_id;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 10: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort. It is still fatal to
  -- correctness: resolveCompanyCik step 2 matches ticker FIRST
  -- (src/lib/sec-filings.ts:299) and a second holder would misroute the page.
  SELECT count(*) INTO v_dupe FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_dupe > 0 THEN
    RAISE EXCEPTION 'BLOCK 10: ticker % already on % other row(s). REFUSING.', v_ticker, v_dupe;
  END IF;

  INSERT INTO norm_v2.moved_row (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'stamp_identity',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', v_ticker, 'sec_cik', v_cik),
          format('0029 block 10: re-home %s onto %s', v_cik, v_name));

  UPDATE public.companies
     SET ticker = v_ticker, sec_cik = v_cik
   WHERE id = v_id AND name = v_name AND ticker IS NULL AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 10: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. Expect exactly one row: Theravance Biopharma / TBPH / 1583107, and facts_visible
-- greater than zero, which is the whole point of the block.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings s     WHERE s.cik = c.sec_cik) AS filings_visible
  FROM public.companies c
 WHERE c.id = 'e2fc418e-e6bd-42e0-a5d9-9e863fa98740'::uuid;

COMMIT;

-- ROLLBACK for block 10 only. Pinned to the journalled before-state, so it
-- refuses if anything else has since written the row.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker  = (j.before->>'ticker'),
--        sec_cik = (j.before->>'sec_cik')::bigint
--   FROM norm_v2.moved_row j
--  WHERE j.table_name = 'public.companies' AND j.op = 'stamp_identity'
--    AND j.row_id = 'e2fc418e-e6bd-42e0-a5d9-9e863fa98740'::uuid AND c.id = j.row_id
--    AND c.ticker = (j.after->>'ticker') AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.moved_row
--  WHERE table_name = 'public.companies' AND op = 'stamp_identity' AND row_id = 'e2fc418e-e6bd-42e0-a5d9-9e863fa98740'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 11  cik 882095  ->  Gilead Sciences
--   SEC: GILEAD SCIENCES, INC.  (Nasdaq: GILD)
--   This CIK carries validated XBRL facts and filings (10-Q, 4, 8-K) plus insider transactions
--   that no company row claims. The receiving row is a real, mention-carrying
--   company row and it currently holds ticker NULL and sec_cik NULL.
--   financial_facts.company_id under this CIK today: the fragment row 'Science Corp.'
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := '95d22579-53d8-476f-83c4-5db780830a0d'::uuid;
  v_cik     bigint := 882095;
  v_ticker  text := 'GILD';
  v_name    text := 'Gilead Sciences';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_dupe    int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 11: row % is gone. REFUSING.', v_id;
  END IF;

  -- Pinned to id AND to every current value this block assumes.
  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 11: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  -- Already applied -> NO-OP, not an error. Re-running the file is safe.
  IF r.sec_cik = v_cik AND r.ticker = v_ticker THEN
    RAISE NOTICE 'BLOCK 11: already applied to % (cik %, ticker %). No-op.', v_name, v_cik, v_ticker;
    RETURN;
  END IF;

  -- Any other prior state is drift, and drift refuses.
  IF r.sec_cik IS NOT NULL OR r.ticker IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 11: % already carries ticker=% cik=%. This is shape B, not shape A. REFUSING.',
      v_name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_sec_cik_unique. THE ONLY CHECK THAT CAN ABORT THE
  -- STATEMENT ON CONFLICT. Re-checked here, not trusted from analysis time.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik AND id <> v_id;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 11: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort. It is still fatal to
  -- correctness: resolveCompanyCik step 2 matches ticker FIRST
  -- (src/lib/sec-filings.ts:299) and a second holder would misroute the page.
  SELECT count(*) INTO v_dupe FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_dupe > 0 THEN
    RAISE EXCEPTION 'BLOCK 11: ticker % already on % other row(s). REFUSING.', v_ticker, v_dupe;
  END IF;

  INSERT INTO norm_v2.moved_row (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'stamp_identity',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', v_ticker, 'sec_cik', v_cik),
          format('0029 block 11: re-home %s onto %s', v_cik, v_name));

  UPDATE public.companies
     SET ticker = v_ticker, sec_cik = v_cik
   WHERE id = v_id AND name = v_name AND ticker IS NULL AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 11: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. Expect exactly one row: Gilead Sciences / GILD / 882095, and facts_visible
-- greater than zero, which is the whole point of the block.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings s     WHERE s.cik = c.sec_cik) AS filings_visible
  FROM public.companies c
 WHERE c.id = '95d22579-53d8-476f-83c4-5db780830a0d'::uuid;

COMMIT;

-- ROLLBACK for block 11 only. Pinned to the journalled before-state, so it
-- refuses if anything else has since written the row.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker  = (j.before->>'ticker'),
--        sec_cik = (j.before->>'sec_cik')::bigint
--   FROM norm_v2.moved_row j
--  WHERE j.table_name = 'public.companies' AND j.op = 'stamp_identity'
--    AND j.row_id = '95d22579-53d8-476f-83c4-5db780830a0d'::uuid AND c.id = j.row_id
--    AND c.ticker = (j.after->>'ticker') AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.moved_row
--  WHERE table_name = 'public.companies' AND op = 'stamp_identity' AND row_id = '95d22579-53d8-476f-83c4-5db780830a0d'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 12  cik 1857816  ->  GigaCloud Technology
--   SEC: GigaCloud Technology Inc  (Nasdaq: GCT)
--   This CIK carries validated XBRL facts and filings (10-Q, 4, 8-K) plus insider transactions
--   that no company row claims. The receiving row is a real, mention-carrying
--   company row and it currently holds ticker NULL and sec_cik NULL.
--   financial_facts.company_id under this CIK today: the fragment row 'GAC'
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := '6b648f58-a4ab-4e2c-8174-1c801ff683c7'::uuid;
  v_cik     bigint := 1857816;
  v_ticker  text := 'GCT';
  v_name    text := 'GigaCloud Technology';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_dupe    int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 12: row % is gone. REFUSING.', v_id;
  END IF;

  -- Pinned to id AND to every current value this block assumes.
  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 12: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  -- Already applied -> NO-OP, not an error. Re-running the file is safe.
  IF r.sec_cik = v_cik AND r.ticker = v_ticker THEN
    RAISE NOTICE 'BLOCK 12: already applied to % (cik %, ticker %). No-op.', v_name, v_cik, v_ticker;
    RETURN;
  END IF;

  -- Any other prior state is drift, and drift refuses.
  IF r.sec_cik IS NOT NULL OR r.ticker IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 12: % already carries ticker=% cik=%. This is shape B, not shape A. REFUSING.',
      v_name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_sec_cik_unique. THE ONLY CHECK THAT CAN ABORT THE
  -- STATEMENT ON CONFLICT. Re-checked here, not trusted from analysis time.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik AND id <> v_id;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 12: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort. It is still fatal to
  -- correctness: resolveCompanyCik step 2 matches ticker FIRST
  -- (src/lib/sec-filings.ts:299) and a second holder would misroute the page.
  SELECT count(*) INTO v_dupe FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_dupe > 0 THEN
    RAISE EXCEPTION 'BLOCK 12: ticker % already on % other row(s). REFUSING.', v_ticker, v_dupe;
  END IF;

  INSERT INTO norm_v2.moved_row (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'stamp_identity',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', v_ticker, 'sec_cik', v_cik),
          format('0029 block 12: re-home %s onto %s', v_cik, v_name));

  UPDATE public.companies
     SET ticker = v_ticker, sec_cik = v_cik
   WHERE id = v_id AND name = v_name AND ticker IS NULL AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 12: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. Expect exactly one row: GigaCloud Technology / GCT / 1857816, and facts_visible
-- greater than zero, which is the whole point of the block.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings s     WHERE s.cik = c.sec_cik) AS filings_visible
  FROM public.companies c
 WHERE c.id = '6b648f58-a4ab-4e2c-8174-1c801ff683c7'::uuid;

COMMIT;

-- ROLLBACK for block 12 only. Pinned to the journalled before-state, so it
-- refuses if anything else has since written the row.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker  = (j.before->>'ticker'),
--        sec_cik = (j.before->>'sec_cik')::bigint
--   FROM norm_v2.moved_row j
--  WHERE j.table_name = 'public.companies' AND j.op = 'stamp_identity'
--    AND j.row_id = '6b648f58-a4ab-4e2c-8174-1c801ff683c7'::uuid AND c.id = j.row_id
--    AND c.ticker = (j.after->>'ticker') AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.moved_row
--  WHERE table_name = 'public.companies' AND op = 'stamp_identity' AND row_id = '6b648f58-a4ab-4e2c-8174-1c801ff683c7'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 13  cik 69633  ->  NAPCO SECURITY TECHNOLOGIES
--   SEC: NAPCO SECURITY TECHNOLOGIES, INC  (Nasdaq: NSSC)
--   This CIK carries validated XBRL facts and filings (10-K, 4, 8-K) plus insider transactions
--   that no company row claims. The receiving row is a real, mention-carrying
--   company row and it currently holds ticker NULL and sec_cik NULL.
--   financial_facts.company_id under this CIK today: the fragment row 'APCO'
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := '8b2aa808-1675-4ac0-a7e8-2812321d068a'::uuid;
  v_cik     bigint := 69633;
  v_ticker  text := 'NSSC';
  v_name    text := 'NAPCO SECURITY TECHNOLOGIES';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_dupe    int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 13: row % is gone. REFUSING.', v_id;
  END IF;

  -- Pinned to id AND to every current value this block assumes.
  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 13: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  -- Already applied -> NO-OP, not an error. Re-running the file is safe.
  IF r.sec_cik = v_cik AND r.ticker = v_ticker THEN
    RAISE NOTICE 'BLOCK 13: already applied to % (cik %, ticker %). No-op.', v_name, v_cik, v_ticker;
    RETURN;
  END IF;

  -- Any other prior state is drift, and drift refuses.
  IF r.sec_cik IS NOT NULL OR r.ticker IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 13: % already carries ticker=% cik=%. This is shape B, not shape A. REFUSING.',
      v_name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_sec_cik_unique. THE ONLY CHECK THAT CAN ABORT THE
  -- STATEMENT ON CONFLICT. Re-checked here, not trusted from analysis time.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik AND id <> v_id;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 13: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort. It is still fatal to
  -- correctness: resolveCompanyCik step 2 matches ticker FIRST
  -- (src/lib/sec-filings.ts:299) and a second holder would misroute the page.
  SELECT count(*) INTO v_dupe FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_dupe > 0 THEN
    RAISE EXCEPTION 'BLOCK 13: ticker % already on % other row(s). REFUSING.', v_ticker, v_dupe;
  END IF;

  INSERT INTO norm_v2.moved_row (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'stamp_identity',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', v_ticker, 'sec_cik', v_cik),
          format('0029 block 13: re-home %s onto %s', v_cik, v_name));

  UPDATE public.companies
     SET ticker = v_ticker, sec_cik = v_cik
   WHERE id = v_id AND name = v_name AND ticker IS NULL AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 13: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. Expect exactly one row: NAPCO SECURITY TECHNOLOGIES / NSSC / 69633, and facts_visible
-- greater than zero, which is the whole point of the block.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings s     WHERE s.cik = c.sec_cik) AS filings_visible
  FROM public.companies c
 WHERE c.id = '8b2aa808-1675-4ac0-a7e8-2812321d068a'::uuid;

COMMIT;

-- ROLLBACK for block 13 only. Pinned to the journalled before-state, so it
-- refuses if anything else has since written the row.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker  = (j.before->>'ticker'),
--        sec_cik = (j.before->>'sec_cik')::bigint
--   FROM norm_v2.moved_row j
--  WHERE j.table_name = 'public.companies' AND j.op = 'stamp_identity'
--    AND j.row_id = '8b2aa808-1675-4ac0-a7e8-2812321d068a'::uuid AND c.id = j.row_id
--    AND c.ticker = (j.after->>'ticker') AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.moved_row
--  WHERE table_name = 'public.companies' AND op = 'stamp_identity' AND row_id = '8b2aa808-1675-4ac0-a7e8-2812321d068a'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 14  cik 943452  ->  Westinghouse Air Brake Technologies
--   SEC: WESTINGHOUSE AIR BRAKE TECHNOLOGIES CORP  (NYSE: WAB)
--   This CIK carries validated XBRL facts and filings (10-Q, 4, 8-K) plus insider transactions
--   that no company row claims. The receiving row is a real, mention-carrying
--   company row and it currently holds ticker NULL and sec_cik NULL.
--   financial_facts.company_id under this CIK today: the fragment row 'GHO'
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := '12a3866a-b5da-4ed9-874f-9ed6e6b29932'::uuid;
  v_cik     bigint := 943452;
  v_ticker  text := 'WAB';
  v_name    text := 'Westinghouse Air Brake Technologies';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_dupe    int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 14: row % is gone. REFUSING.', v_id;
  END IF;

  -- Pinned to id AND to every current value this block assumes.
  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 14: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  -- Already applied -> NO-OP, not an error. Re-running the file is safe.
  IF r.sec_cik = v_cik AND r.ticker = v_ticker THEN
    RAISE NOTICE 'BLOCK 14: already applied to % (cik %, ticker %). No-op.', v_name, v_cik, v_ticker;
    RETURN;
  END IF;

  -- Any other prior state is drift, and drift refuses.
  IF r.sec_cik IS NOT NULL OR r.ticker IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 14: % already carries ticker=% cik=%. This is shape B, not shape A. REFUSING.',
      v_name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_sec_cik_unique. THE ONLY CHECK THAT CAN ABORT THE
  -- STATEMENT ON CONFLICT. Re-checked here, not trusted from analysis time.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik AND id <> v_id;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 14: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort. It is still fatal to
  -- correctness: resolveCompanyCik step 2 matches ticker FIRST
  -- (src/lib/sec-filings.ts:299) and a second holder would misroute the page.
  SELECT count(*) INTO v_dupe FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_dupe > 0 THEN
    RAISE EXCEPTION 'BLOCK 14: ticker % already on % other row(s). REFUSING.', v_ticker, v_dupe;
  END IF;

  INSERT INTO norm_v2.moved_row (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'stamp_identity',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', v_ticker, 'sec_cik', v_cik),
          format('0029 block 14: re-home %s onto %s', v_cik, v_name));

  UPDATE public.companies
     SET ticker = v_ticker, sec_cik = v_cik
   WHERE id = v_id AND name = v_name AND ticker IS NULL AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 14: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. Expect exactly one row: Westinghouse Air Brake Technologies / WAB / 943452, and facts_visible
-- greater than zero, which is the whole point of the block.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings s     WHERE s.cik = c.sec_cik) AS filings_visible
  FROM public.companies c
 WHERE c.id = '12a3866a-b5da-4ed9-874f-9ed6e6b29932'::uuid;

COMMIT;

-- ROLLBACK for block 14 only. Pinned to the journalled before-state, so it
-- refuses if anything else has since written the row.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker  = (j.before->>'ticker'),
--        sec_cik = (j.before->>'sec_cik')::bigint
--   FROM norm_v2.moved_row j
--  WHERE j.table_name = 'public.companies' AND j.op = 'stamp_identity'
--    AND j.row_id = '12a3866a-b5da-4ed9-874f-9ed6e6b29932'::uuid AND c.id = j.row_id
--    AND c.ticker = (j.after->>'ticker') AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.moved_row
--  WHERE table_name = 'public.companies' AND op = 'stamp_identity' AND row_id = '12a3866a-b5da-4ed9-874f-9ed6e6b29932'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 15  cik 1802255  ->  Guardian Pharmacy Services
--   SEC: Guardian Pharmacy Services, Inc.  (NYSE: GRDN)
--   This CIK carries validated XBRL facts and filings (10-Q, 8-K)
--   that no company row claims. The receiving row is a real, mention-carrying
--   company row and it currently holds ticker NULL and sec_cik NULL.
--   financial_facts.company_id under this CIK today: the fragment row 'Ardian'
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := 'd8487ec2-464b-4796-89f2-8cc345949e66'::uuid;
  v_cik     bigint := 1802255;
  v_ticker  text := 'GRDN';
  v_name    text := 'Guardian Pharmacy Services';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_dupe    int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 15: row % is gone. REFUSING.', v_id;
  END IF;

  -- Pinned to id AND to every current value this block assumes.
  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 15: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  -- Already applied -> NO-OP, not an error. Re-running the file is safe.
  IF r.sec_cik = v_cik AND r.ticker = v_ticker THEN
    RAISE NOTICE 'BLOCK 15: already applied to % (cik %, ticker %). No-op.', v_name, v_cik, v_ticker;
    RETURN;
  END IF;

  -- Any other prior state is drift, and drift refuses.
  IF r.sec_cik IS NOT NULL OR r.ticker IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 15: % already carries ticker=% cik=%. This is shape B, not shape A. REFUSING.',
      v_name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_sec_cik_unique. THE ONLY CHECK THAT CAN ABORT THE
  -- STATEMENT ON CONFLICT. Re-checked here, not trusted from analysis time.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik AND id <> v_id;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 15: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort. It is still fatal to
  -- correctness: resolveCompanyCik step 2 matches ticker FIRST
  -- (src/lib/sec-filings.ts:299) and a second holder would misroute the page.
  SELECT count(*) INTO v_dupe FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_dupe > 0 THEN
    RAISE EXCEPTION 'BLOCK 15: ticker % already on % other row(s). REFUSING.', v_ticker, v_dupe;
  END IF;

  INSERT INTO norm_v2.moved_row (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'stamp_identity',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', v_ticker, 'sec_cik', v_cik),
          format('0029 block 15: re-home %s onto %s', v_cik, v_name));

  UPDATE public.companies
     SET ticker = v_ticker, sec_cik = v_cik
   WHERE id = v_id AND name = v_name AND ticker IS NULL AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 15: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. Expect exactly one row: Guardian Pharmacy Services / GRDN / 1802255, and facts_visible
-- greater than zero, which is the whole point of the block.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings s     WHERE s.cik = c.sec_cik) AS filings_visible
  FROM public.companies c
 WHERE c.id = 'd8487ec2-464b-4796-89f2-8cc345949e66'::uuid;

COMMIT;

-- ROLLBACK for block 15 only. Pinned to the journalled before-state, so it
-- refuses if anything else has since written the row.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker  = (j.before->>'ticker'),
--        sec_cik = (j.before->>'sec_cik')::bigint
--   FROM norm_v2.moved_row j
--  WHERE j.table_name = 'public.companies' AND j.op = 'stamp_identity'
--    AND j.row_id = 'd8487ec2-464b-4796-89f2-8cc345949e66'::uuid AND c.id = j.row_id
--    AND c.ticker = (j.after->>'ticker') AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.moved_row
--  WHERE table_name = 'public.companies' AND op = 'stamp_identity' AND row_id = 'd8487ec2-464b-4796-89f2-8cc345949e66'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 16  cik 1636519  ->  Madison Square Garden Sports
--   SEC: Madison Square Garden Sports Corp.  (NYSE: MSGS)
--   This CIK carries validated XBRL facts and filings (10-K, 8-K)
--   that no company row claims. The receiving row is a real, mention-carrying
--   company row and it currently holds ticker NULL and sec_cik NULL.
--   financial_facts.company_id under this CIK today: NULL on every row
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := '99b68749-3deb-46c5-8fa0-908589c9f51a'::uuid;
  v_cik     bigint := 1636519;
  v_ticker  text := 'MSGS';
  v_name    text := 'Madison Square Garden Sports';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_dupe    int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 16: row % is gone. REFUSING.', v_id;
  END IF;

  -- Pinned to id AND to every current value this block assumes.
  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 16: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  -- Already applied -> NO-OP, not an error. Re-running the file is safe.
  IF r.sec_cik = v_cik AND r.ticker = v_ticker THEN
    RAISE NOTICE 'BLOCK 16: already applied to % (cik %, ticker %). No-op.', v_name, v_cik, v_ticker;
    RETURN;
  END IF;

  -- Any other prior state is drift, and drift refuses.
  IF r.sec_cik IS NOT NULL OR r.ticker IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 16: % already carries ticker=% cik=%. This is shape B, not shape A. REFUSING.',
      v_name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_sec_cik_unique. THE ONLY CHECK THAT CAN ABORT THE
  -- STATEMENT ON CONFLICT. Re-checked here, not trusted from analysis time.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik AND id <> v_id;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 16: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort. It is still fatal to
  -- correctness: resolveCompanyCik step 2 matches ticker FIRST
  -- (src/lib/sec-filings.ts:299) and a second holder would misroute the page.
  SELECT count(*) INTO v_dupe FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_dupe > 0 THEN
    RAISE EXCEPTION 'BLOCK 16: ticker % already on % other row(s). REFUSING.', v_ticker, v_dupe;
  END IF;

  INSERT INTO norm_v2.moved_row (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'stamp_identity',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', v_ticker, 'sec_cik', v_cik),
          format('0029 block 16: re-home %s onto %s', v_cik, v_name));

  UPDATE public.companies
     SET ticker = v_ticker, sec_cik = v_cik
   WHERE id = v_id AND name = v_name AND ticker IS NULL AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 16: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. Expect exactly one row: Madison Square Garden Sports / MSGS / 1636519, and facts_visible
-- greater than zero, which is the whole point of the block.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings s     WHERE s.cik = c.sec_cik) AS filings_visible
  FROM public.companies c
 WHERE c.id = '99b68749-3deb-46c5-8fa0-908589c9f51a'::uuid;

COMMIT;

-- ROLLBACK for block 16 only. Pinned to the journalled before-state, so it
-- refuses if anything else has since written the row.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker  = (j.before->>'ticker'),
--        sec_cik = (j.before->>'sec_cik')::bigint
--   FROM norm_v2.moved_row j
--  WHERE j.table_name = 'public.companies' AND j.op = 'stamp_identity'
--    AND j.row_id = '99b68749-3deb-46c5-8fa0-908589c9f51a'::uuid AND c.id = j.row_id
--    AND c.ticker = (j.after->>'ticker') AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.moved_row
--  WHERE table_name = 'public.companies' AND op = 'stamp_identity' AND row_id = '99b68749-3deb-46c5-8fa0-908589c9f51a'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 17  cik 21344  ->  The Coca-Cola Company
--   SEC: COCA COLA CO  (NYSE: KO)
--   This CIK carries validated XBRL facts and filings (10-Q, 4, 8-K) plus insider transactions
--   that no company row claims. The receiving row is a real, mention-carrying
--   company row and it currently holds ticker NULL and sec_cik NULL.
--   financial_facts.company_id under this CIK today: the fragment row 'Ola'
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := 'f1637f00-e16b-4b3d-8848-2f0bc13e89ab'::uuid;
  v_cik     bigint := 21344;
  v_ticker  text := 'KO';
  v_name    text := 'The Coca-Cola Company';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_dupe    int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 17: row % is gone. REFUSING.', v_id;
  END IF;

  -- Pinned to id AND to every current value this block assumes.
  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 17: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  -- Already applied -> NO-OP, not an error. Re-running the file is safe.
  IF r.sec_cik = v_cik AND r.ticker = v_ticker THEN
    RAISE NOTICE 'BLOCK 17: already applied to % (cik %, ticker %). No-op.', v_name, v_cik, v_ticker;
    RETURN;
  END IF;

  -- Any other prior state is drift, and drift refuses.
  IF r.sec_cik IS NOT NULL OR r.ticker IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 17: % already carries ticker=% cik=%. This is shape B, not shape A. REFUSING.',
      v_name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_sec_cik_unique. THE ONLY CHECK THAT CAN ABORT THE
  -- STATEMENT ON CONFLICT. Re-checked here, not trusted from analysis time.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik AND id <> v_id;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 17: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort. It is still fatal to
  -- correctness: resolveCompanyCik step 2 matches ticker FIRST
  -- (src/lib/sec-filings.ts:299) and a second holder would misroute the page.
  SELECT count(*) INTO v_dupe FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_dupe > 0 THEN
    RAISE EXCEPTION 'BLOCK 17: ticker % already on % other row(s). REFUSING.', v_ticker, v_dupe;
  END IF;

  INSERT INTO norm_v2.moved_row (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'stamp_identity',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', v_ticker, 'sec_cik', v_cik),
          format('0029 block 17: re-home %s onto %s', v_cik, v_name));

  UPDATE public.companies
     SET ticker = v_ticker, sec_cik = v_cik
   WHERE id = v_id AND name = v_name AND ticker IS NULL AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 17: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. Expect exactly one row: The Coca-Cola Company / KO / 21344, and facts_visible
-- greater than zero, which is the whole point of the block.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings s     WHERE s.cik = c.sec_cik) AS filings_visible
  FROM public.companies c
 WHERE c.id = 'f1637f00-e16b-4b3d-8848-2f0bc13e89ab'::uuid;

COMMIT;

-- ROLLBACK for block 17 only. Pinned to the journalled before-state, so it
-- refuses if anything else has since written the row.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker  = (j.before->>'ticker'),
--        sec_cik = (j.before->>'sec_cik')::bigint
--   FROM norm_v2.moved_row j
--  WHERE j.table_name = 'public.companies' AND j.op = 'stamp_identity'
--    AND j.row_id = 'f1637f00-e16b-4b3d-8848-2f0bc13e89ab'::uuid AND c.id = j.row_id
--    AND c.ticker = (j.after->>'ticker') AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.moved_row
--  WHERE table_name = 'public.companies' AND op = 'stamp_identity' AND row_id = 'f1637f00-e16b-4b3d-8848-2f0bc13e89ab'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 18  cik 1383414  ->  PennantPark Investment
--   SEC: PENNANTPARK INVESTMENT CORP  (NYSE: PNNT)
--   This CIK carries validated XBRL facts and filings (10-Q, 8-K)
--   that no company row claims. The receiving row is a real, mention-carrying
--   company row and it currently holds ticker NULL and sec_cik NULL.
--   financial_facts.company_id under this CIK today: the fragment row 'ARK Invest'
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := '8372a5b6-06dd-45d8-867c-7c2cc3e53026'::uuid;
  v_cik     bigint := 1383414;
  v_ticker  text := 'PNNT';
  v_name    text := 'PennantPark Investment';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_dupe    int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 18: row % is gone. REFUSING.', v_id;
  END IF;

  -- Pinned to id AND to every current value this block assumes.
  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 18: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  -- Already applied -> NO-OP, not an error. Re-running the file is safe.
  IF r.sec_cik = v_cik AND r.ticker = v_ticker THEN
    RAISE NOTICE 'BLOCK 18: already applied to % (cik %, ticker %). No-op.', v_name, v_cik, v_ticker;
    RETURN;
  END IF;

  -- Any other prior state is drift, and drift refuses.
  IF r.sec_cik IS NOT NULL OR r.ticker IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 18: % already carries ticker=% cik=%. This is shape B, not shape A. REFUSING.',
      v_name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_sec_cik_unique. THE ONLY CHECK THAT CAN ABORT THE
  -- STATEMENT ON CONFLICT. Re-checked here, not trusted from analysis time.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik AND id <> v_id;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 18: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort. It is still fatal to
  -- correctness: resolveCompanyCik step 2 matches ticker FIRST
  -- (src/lib/sec-filings.ts:299) and a second holder would misroute the page.
  SELECT count(*) INTO v_dupe FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_dupe > 0 THEN
    RAISE EXCEPTION 'BLOCK 18: ticker % already on % other row(s). REFUSING.', v_ticker, v_dupe;
  END IF;

  INSERT INTO norm_v2.moved_row (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'stamp_identity',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', v_ticker, 'sec_cik', v_cik),
          format('0029 block 18: re-home %s onto %s', v_cik, v_name));

  UPDATE public.companies
     SET ticker = v_ticker, sec_cik = v_cik
   WHERE id = v_id AND name = v_name AND ticker IS NULL AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 18: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. Expect exactly one row: PennantPark Investment / PNNT / 1383414, and facts_visible
-- greater than zero, which is the whole point of the block.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings s     WHERE s.cik = c.sec_cik) AS filings_visible
  FROM public.companies c
 WHERE c.id = '8372a5b6-06dd-45d8-867c-7c2cc3e53026'::uuid;

COMMIT;

-- ROLLBACK for block 18 only. Pinned to the journalled before-state, so it
-- refuses if anything else has since written the row.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker  = (j.before->>'ticker'),
--        sec_cik = (j.before->>'sec_cik')::bigint
--   FROM norm_v2.moved_row j
--  WHERE j.table_name = 'public.companies' AND j.op = 'stamp_identity'
--    AND j.row_id = '8372a5b6-06dd-45d8-867c-7c2cc3e53026'::uuid AND c.id = j.row_id
--    AND c.ticker = (j.after->>'ticker') AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.moved_row
--  WHERE table_name = 'public.companies' AND op = 'stamp_identity' AND row_id = '8372a5b6-06dd-45d8-867c-7c2cc3e53026'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 19  cik 1164863  ->  ENPRO INDUSTRIES
--   SEC: Enpro Inc.  (NYSE: NPO)
--   This CIK carries validated XBRL facts and filings (10-Q, 8-K)
--   that no company row claims. The receiving row is a real, mention-carrying
--   company row and it currently holds ticker NULL and sec_cik NULL.
--   financial_facts.company_id under this CIK today: the fragment row 'NPR'
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := 'ca8c816c-06a7-49ab-9b1a-69d54219b654'::uuid;
  v_cik     bigint := 1164863;
  v_ticker  text := 'NPO';
  v_name    text := 'ENPRO INDUSTRIES';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_dupe    int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 19: row % is gone. REFUSING.', v_id;
  END IF;

  -- Pinned to id AND to every current value this block assumes.
  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 19: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  -- Already applied -> NO-OP, not an error. Re-running the file is safe.
  IF r.sec_cik = v_cik AND r.ticker = v_ticker THEN
    RAISE NOTICE 'BLOCK 19: already applied to % (cik %, ticker %). No-op.', v_name, v_cik, v_ticker;
    RETURN;
  END IF;

  -- Any other prior state is drift, and drift refuses.
  IF r.sec_cik IS NOT NULL OR r.ticker IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 19: % already carries ticker=% cik=%. This is shape B, not shape A. REFUSING.',
      v_name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_sec_cik_unique. THE ONLY CHECK THAT CAN ABORT THE
  -- STATEMENT ON CONFLICT. Re-checked here, not trusted from analysis time.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik AND id <> v_id;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 19: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort. It is still fatal to
  -- correctness: resolveCompanyCik step 2 matches ticker FIRST
  -- (src/lib/sec-filings.ts:299) and a second holder would misroute the page.
  SELECT count(*) INTO v_dupe FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_dupe > 0 THEN
    RAISE EXCEPTION 'BLOCK 19: ticker % already on % other row(s). REFUSING.', v_ticker, v_dupe;
  END IF;

  INSERT INTO norm_v2.moved_row (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'stamp_identity',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', v_ticker, 'sec_cik', v_cik),
          format('0029 block 19: re-home %s onto %s', v_cik, v_name));

  UPDATE public.companies
     SET ticker = v_ticker, sec_cik = v_cik
   WHERE id = v_id AND name = v_name AND ticker IS NULL AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 19: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. Expect exactly one row: ENPRO INDUSTRIES / NPO / 1164863, and facts_visible
-- greater than zero, which is the whole point of the block.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings s     WHERE s.cik = c.sec_cik) AS filings_visible
  FROM public.companies c
 WHERE c.id = 'ca8c816c-06a7-49ab-9b1a-69d54219b654'::uuid;

COMMIT;

-- ROLLBACK for block 19 only. Pinned to the journalled before-state, so it
-- refuses if anything else has since written the row.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker  = (j.before->>'ticker'),
--        sec_cik = (j.before->>'sec_cik')::bigint
--   FROM norm_v2.moved_row j
--  WHERE j.table_name = 'public.companies' AND j.op = 'stamp_identity'
--    AND j.row_id = 'ca8c816c-06a7-49ab-9b1a-69d54219b654'::uuid AND c.id = j.row_id
--    AND c.ticker = (j.after->>'ticker') AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.moved_row
--  WHERE table_name = 'public.companies' AND op = 'stamp_identity' AND row_id = 'ca8c816c-06a7-49ab-9b1a-69d54219b654'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 20  cik 1771515  ->  Grocery Outlet Holding Corp.
--   SEC: Grocery Outlet Holding Corp.  (Nasdaq: GO)
--   This CIK carries validated XBRL facts and filings (10-Q, 4, 8-K) plus insider transactions
--   that no company row claims. The receiving row is a real, mention-carrying
--   company row and it currently holds ticker NULL and sec_cik NULL.
--   financial_facts.company_id under this CIK today: the fragment row 'Go Inc.'
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := 'ac87b972-93e9-4419-b485-4d66034ff77f'::uuid;
  v_cik     bigint := 1771515;
  v_ticker  text := 'GO';
  v_name    text := 'Grocery Outlet Holding Corp.';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_dupe    int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 20: row % is gone. REFUSING.', v_id;
  END IF;

  -- Pinned to id AND to every current value this block assumes.
  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 20: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  -- Already applied -> NO-OP, not an error. Re-running the file is safe.
  IF r.sec_cik = v_cik AND r.ticker = v_ticker THEN
    RAISE NOTICE 'BLOCK 20: already applied to % (cik %, ticker %). No-op.', v_name, v_cik, v_ticker;
    RETURN;
  END IF;

  -- Any other prior state is drift, and drift refuses.
  IF r.sec_cik IS NOT NULL OR r.ticker IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 20: % already carries ticker=% cik=%. This is shape B, not shape A. REFUSING.',
      v_name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_sec_cik_unique. THE ONLY CHECK THAT CAN ABORT THE
  -- STATEMENT ON CONFLICT. Re-checked here, not trusted from analysis time.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik AND id <> v_id;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 20: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort. It is still fatal to
  -- correctness: resolveCompanyCik step 2 matches ticker FIRST
  -- (src/lib/sec-filings.ts:299) and a second holder would misroute the page.
  SELECT count(*) INTO v_dupe FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_dupe > 0 THEN
    RAISE EXCEPTION 'BLOCK 20: ticker % already on % other row(s). REFUSING.', v_ticker, v_dupe;
  END IF;

  INSERT INTO norm_v2.moved_row (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'stamp_identity',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', v_ticker, 'sec_cik', v_cik),
          format('0029 block 20: re-home %s onto %s', v_cik, v_name));

  UPDATE public.companies
     SET ticker = v_ticker, sec_cik = v_cik
   WHERE id = v_id AND name = v_name AND ticker IS NULL AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 20: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. Expect exactly one row: Grocery Outlet Holding Corp. / GO / 1771515, and facts_visible
-- greater than zero, which is the whole point of the block.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings s     WHERE s.cik = c.sec_cik) AS filings_visible
  FROM public.companies c
 WHERE c.id = 'ac87b972-93e9-4419-b485-4d66034ff77f'::uuid;

COMMIT;

-- ROLLBACK for block 20 only. Pinned to the journalled before-state, so it
-- refuses if anything else has since written the row.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker  = (j.before->>'ticker'),
--        sec_cik = (j.before->>'sec_cik')::bigint
--   FROM norm_v2.moved_row j
--  WHERE j.table_name = 'public.companies' AND j.op = 'stamp_identity'
--    AND j.row_id = 'ac87b972-93e9-4419-b485-4d66034ff77f'::uuid AND c.id = j.row_id
--    AND c.ticker = (j.after->>'ticker') AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.moved_row
--  WHERE table_name = 'public.companies' AND op = 'stamp_identity' AND row_id = 'ac87b972-93e9-4419-b485-4d66034ff77f'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 21  cik 1868159  ->  Lineage Logistics
--   SEC: Lineage, Inc.  (Nasdaq: LINE)
--   This CIK carries validated XBRL facts and filings (10-Q, 4, 8-K) plus insider transactions
--   that no company row claims. The receiving row is a real, mention-carrying
--   company row and it currently holds ticker NULL and sec_cik NULL.
--   financial_facts.company_id under this CIK today: the fragment row 'NEA'
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := '66079770-60ca-44ef-aaa2-b1491708c4fe'::uuid;
  v_cik     bigint := 1868159;
  v_ticker  text := 'LINE';
  v_name    text := 'Lineage Logistics';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_dupe    int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 21: row % is gone. REFUSING.', v_id;
  END IF;

  -- Pinned to id AND to every current value this block assumes.
  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 21: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  -- Already applied -> NO-OP, not an error. Re-running the file is safe.
  IF r.sec_cik = v_cik AND r.ticker = v_ticker THEN
    RAISE NOTICE 'BLOCK 21: already applied to % (cik %, ticker %). No-op.', v_name, v_cik, v_ticker;
    RETURN;
  END IF;

  -- Any other prior state is drift, and drift refuses.
  IF r.sec_cik IS NOT NULL OR r.ticker IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 21: % already carries ticker=% cik=%. This is shape B, not shape A. REFUSING.',
      v_name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_sec_cik_unique. THE ONLY CHECK THAT CAN ABORT THE
  -- STATEMENT ON CONFLICT. Re-checked here, not trusted from analysis time.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik AND id <> v_id;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 21: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort. It is still fatal to
  -- correctness: resolveCompanyCik step 2 matches ticker FIRST
  -- (src/lib/sec-filings.ts:299) and a second holder would misroute the page.
  SELECT count(*) INTO v_dupe FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_dupe > 0 THEN
    RAISE EXCEPTION 'BLOCK 21: ticker % already on % other row(s). REFUSING.', v_ticker, v_dupe;
  END IF;

  INSERT INTO norm_v2.moved_row (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'stamp_identity',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', v_ticker, 'sec_cik', v_cik),
          format('0029 block 21: re-home %s onto %s', v_cik, v_name));

  UPDATE public.companies
     SET ticker = v_ticker, sec_cik = v_cik
   WHERE id = v_id AND name = v_name AND ticker IS NULL AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 21: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. Expect exactly one row: Lineage Logistics / LINE / 1868159, and facts_visible
-- greater than zero, which is the whole point of the block.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings s     WHERE s.cik = c.sec_cik) AS filings_visible
  FROM public.companies c
 WHERE c.id = '66079770-60ca-44ef-aaa2-b1491708c4fe'::uuid;

COMMIT;

-- ROLLBACK for block 21 only. Pinned to the journalled before-state, so it
-- refuses if anything else has since written the row.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker  = (j.before->>'ticker'),
--        sec_cik = (j.before->>'sec_cik')::bigint
--   FROM norm_v2.moved_row j
--  WHERE j.table_name = 'public.companies' AND j.op = 'stamp_identity'
--    AND j.row_id = '66079770-60ca-44ef-aaa2-b1491708c4fe'::uuid AND c.id = j.row_id
--    AND c.ticker = (j.after->>'ticker') AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.moved_row
--  WHERE table_name = 'public.companies' AND op = 'stamp_identity' AND row_id = '66079770-60ca-44ef-aaa2-b1491708c4fe'::uuid;
-- COMMIT;

-- =====================================================================
-- BLOCK 22  -- POST-CHECK. Read-only. Run after the last block you applied.
-- =====================================================================
BEGIN;

-- 22a. The load-bearing invariant. cik_without_ticker MUST still be 0.
-- with_ticker and with_cik each rise by the number of blocks applied.
SELECT count(*) FILTER (WHERE ticker IS NOT NULL)                     AS with_ticker,
       count(*) FILTER (WHERE sec_cik IS NOT NULL)                    AS with_cik,
       count(*) FILTER (WHERE sec_cik IS NOT NULL AND ticker IS NULL) AS cik_without_ticker
  FROM public.companies;

-- 22b. Every stamped row, with what it can now see. facts_visible and
-- filings_visible must both be greater than zero on every row.
SELECT c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings s     WHERE s.cik = c.sec_cik) AS filings_visible
  FROM public.companies c
  JOIN norm_v2.moved_row j
    ON j.row_id = c.id AND j.table_name = 'public.companies' AND j.op = 'stamp_identity'
 ORDER BY c.mention_count DESC NULLS LAST;

-- 22c. No duplicate CIK holder anywhere. Expect zero rows.
SELECT sec_cik, count(*) FROM public.companies
 WHERE sec_cik IS NOT NULL GROUP BY sec_cik HAVING count(*) > 1;

-- 22d. No duplicate ticker holder anywhere. Expect zero rows. There is no
-- unique index behind this one, so it is the only thing that would catch it.
SELECT upper(btrim(ticker)) AS t, count(*) FROM public.companies
 WHERE ticker IS NOT NULL GROUP BY 1 HAVING count(*) > 1;

COMMIT;


-- =====================================================================
-- BLOCK 99  -- FULL ROLLBACK. Reverses every stamp this file applied.
--
-- Pinned to the journalled after-state on every row, so a row that something
-- else has written since is skipped rather than clobbered. Compare the
-- reported count against 22b before deleting the journal rows.
-- =====================================================================
-- BEGIN;
--
-- UPDATE public.companies c
--    SET ticker  = (j.before->>'ticker'),
--        sec_cik = (j.before->>'sec_cik')::bigint
--   FROM norm_v2.moved_row j
--  WHERE j.table_name = 'public.companies'
--    AND j.op = 'stamp_identity'
--    AND c.id = j.row_id
--    AND c.ticker  = (j.after->>'ticker')
--    AND c.sec_cik = (j.after->>'sec_cik')::bigint;
--
-- -- Read this BEFORE the delete. Any row listed here was NOT reversed
-- -- because something else wrote it after the stamp. Expect zero rows.
-- SELECT j.row_id, c.name, c.ticker, c.sec_cik, j.after
--   FROM norm_v2.moved_row j JOIN public.companies c ON c.id = j.row_id
--  WHERE j.table_name = 'public.companies' AND j.op = 'stamp_identity'
--    AND (c.ticker IS DISTINCT FROM (j.before->>'ticker')
--      OR c.sec_cik IS DISTINCT FROM (j.before->>'sec_cik')::bigint);
--
-- DELETE FROM norm_v2.moved_row
--  WHERE table_name = 'public.companies' AND op = 'stamp_identity';
--
-- COMMIT;


-- =====================================================================
-- FOUR STORES: WHAT AGREES AND WHAT DOES NOT, AFTER THESE BLOCKS
--
-- Identity lives in four places. Each block writes ONE of them.
--
-- 1. companies.sec_cik            WRITTEN. Now names the correct company.
-- 2. financial_facts.cik          UNCHANGED and now AGREES. It always held the
--                                 right CIK; nothing claimed it. The read path
--                                 joins on exactly this, so the page fills.
-- 3. sec_filings.cik              UNCHANGED and now AGREES, same reason.
--                                 sec_filings.company_id stays NULL on every
--                                 one of these rows. It DISAGREES, silently,
--                                 and it did before too. It is not on the read
--                                 path while a CIK resolves (sec-filings.ts:365
--                                 uses company_id only as the cik-null
--                                 fallback), so it does not block the fix. It
--                                 is still the writer recording that it cannot
--                                 resolve these filings, every single run.
-- 4. insider_transactions.cik     UNCHANGED and now AGREES. Note the column is
--                                 `cik`, NOT `issuer_cik`. Its company_id is
--                                 NULL on every row for these CIKs, same
--                                 status as sec_filings.
--
-- The one that OPENLY DISAGREES after these blocks is
-- financial_facts.company_id. On 15 of the 20 it still points at the FRAGMENT
-- row ("Ola" holds Coca-Cola's facts, "GHO" holds Wabtec's, "ABC" holds
-- Labcorp's); on the other 5 it is NULL. It is a RECEIPT of who owned the CIK
-- at ingest, which is how the detach was traced in the first place, so
-- OVERWRITING IT DESTROYS THE EVIDENCE. It is deliberately not touched here.
-- Repointing it is a separate decision and belongs with the 0020 merge, which
-- already owns the question of what to do with dependent rows.
--
-- WHAT THIS FILE DOES NOT FIX. The fragment rows still exist and still carry
-- their own mention counts. Duplicate rows beside several targets
-- ("Westinghouse Air Brake" beside "Westinghouse Air Brake Technologies",
-- "Theravance" beside "Theravance Biopharma", "GigaCloud" beside "GigaCloud
-- Technology", "Madison Square Garden Sports (MSGS)" beside "Madison Square
-- Garden Sports", "NAPCO SECURITY TECH" beside "NAPCO SECURITY TECHNOLOGIES")
-- are NOT stamped and will still render empty. They are duplicate-cluster
-- rows and they belong to sql/proposals/0020, not here. Stamping a second row
-- with the same CIK is exactly what companies_sec_cik_unique forbids.
-- =====================================================================
