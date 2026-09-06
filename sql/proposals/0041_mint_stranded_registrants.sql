-- =====================================================================
-- 0041_mint_stranded_registrants.sql
--
--   *** PROPOSAL. NOT APPLIED. DO NOT RUN AS ONE SCRIPT. ***
--   *** Nothing in this file has been executed against any database. ***
--
-- Gives twenty SEC registrants a `companies` row, so the facts and filings
-- already sitting under their CIKs stop being unreachable.
--
-- WHY 0041 AND NOT 0039. The numbering is forked across branches, so "the next
-- number" has to be read from every ref rather than from the working tree.
-- Enumerated with `git log --all --name-only -- sql/*`:
--     0038  sql/0038_company_facts.sql,
--           sql/0038_financial_facts_cik_period_end_idx.sql,
--           sql/proposals/0038_alias_repoint.sql,
--           sql/proposals/0038_duplicate_ticker_remediation.sql,
--           sql/proposals/0038_repoint_aliases_to_identifier_anchor.sql,
--           sql/proposals/0038b_alias_repoint_hold.sql
--     0039  sql/0039_companies_name_norm_unique_widen.sql,
--           sql/0039_thesis_notes_owner_policies.sql,
--           sql/proposals/0039_duplicate_bucket_remediation.sql
--     0040  sql/0040_match_content_embeddings_definer.sql
-- 0039 is taken three times and 0040 once, so 0041 IS THE FIRST FREE NUMBER
-- ON ANY REF. Taking 0039 would have collided with three live files that a
-- `ls sql/proposals/` on main does not show.
--
-- ============ READ THIS FIRST. THIS IS NOT 0029'S OPERATION. ============
--
-- 0029 re-homed twenty CIKs by STAMPING each one onto a company row that
-- ALREADY EXISTED under the registrant's own name and carried no identifier.
-- That operation is an UPDATE of two columns on an existing row.
--
-- *** FOR THESE TWENTY, NO SUCH ROW EXISTS. NOT ONE OF THE TWENTY. ***
--
-- Checked three ways before a line of this file was written:
--   (i)   the whole `companies` table read out under keyset pagination
--         (nine pages, every id distinct, the assembled count equal to the
--         `Prefer: count=exact` total, so this is not a truncated read);
--   (ii)  a per-registrant case-insensitive substring probe against prod for
--         each distinctive token: helmerich, renasant, macerich, ardelyx,
--         xometry, equillium, surrozen, sharkninja, accelerant, ziprecruiter,
--         magnachip, coastalsouth, reilly, "clean harbor", "republic
--         services", "american vanguard", "first keystone", falcon,
--         "fifth era", "new providence". EVERY ONE RETURNED ZERO ROWS;
--   (iii) the same twenty probes against `aliases.lookup_key`. ALSO ZERO.
--
-- So there is no row to stamp and no alias bridging to one. A file of twenty
-- 0029-style UPDATE blocks would have refused twenty times, or, worse, an
-- author who did not check the receivers would have stamped each CIK onto the
-- row that shows up under it in `financial_facts.company_id`. THAT ROW IS NOT
-- THE COMPANY. It is the row that HELD the CIK at ingest and was later
-- stripped of its identifiers, and on several of the twenty it is a real,
-- different, mention-carrying company:
--
--     cik 5981    AMERICAN VANGUARD CORP        receipt row 'Vanguard'
--     cik 46765   Helmerich & Payne, Inc.       receipt row 'HP Inc.'
--     cik 1325702 MAGNACHIP SEMICONDUCTOR Corp  receipt row 'Magna'
--     cik 1617553 ZIPRECRUITER, INC.            receipt row 'Zip Co'
--     cik 1746466 Equillium, Inc.               receipt row 'eQ Plc'
--     cik 1997350 Accelerant Holdings           receipt row 'Accel'
--     cik 2048948 New Providence Acquisition III receipt row 'Providence'
--
-- Stamping cik 46765 onto 'HP Inc.' would hand a DRILLING CONTRACTOR'S
-- financials to a page about the PC maker, whose real row already sits beside
-- it correctly at HPQ / cik 47217. Every one of the twenty receipt rows is
-- LEFT EXACTLY AS IT IS by this file.
--
-- WHAT THIS FILE DOES INSTEAD. Each block INSERTs ONE NEW `companies` row
-- carrying the registrant's name, its ticker and its CIK together, and
-- journals the mint. Nothing existing is updated, renamed, merged or deleted.
--
-- WHY THAT IS ENOUGH TO FILL THE PAGE. Company Intel reads facts, filings and
-- insider rows BY CIK, not by company_id:
--   src/lib/financial-facts.ts:512-514  .from("financial_facts_latest").eq("cik", res.cik)
--   src/lib/sec-filings.ts:365          .eq("cik", res.cik)  (company_id only as fallback)
-- and `res.cik` comes from resolveCompanyCik, which reads companies.sec_cik.
-- resolveCompanyCik reaches the new row two ways: step 2 on exact ticker, and
-- step 3 on exact name over the raw surface form AND its canonicalize()d form
-- (src/lib/sec-filings.ts, `surfaces` block). Both were read on origin/main.
--
-- AND THE COVERAGE IS ALREADY THERE. This is not a mint into an empty page.
-- Every one of the twenty registrants has articles in the corpus under its own
-- name, carried on `articles.primary_company`, while `articles.companies` on
-- the ones sampled is an EMPTY ARRAY. The names were never linked to a company
-- row because no company row carried the name. Each block quotes the surface
-- forms the corpus actually uses and picks the row name to match them, because
-- matchCompaniesByName uses ilike("name", n) WITH NO WILDCARDS: the match is
-- case-insensitive but the word sequence must be exact.
--
-- WHY BOTH COLUMNS, ALWAYS TOGETHER. `sec_cik IS NOT NULL AND ticker IS NULL`
-- is 0 in prod and is load-bearing: src/lib/sec-filings.ts:121-122 states that
-- "every CIK-bearing companies row carries a ticker while null-CIK name
-- duplicates do not", and the ticker branch of resolveCompanyCik relies on it.
-- Every INSERT writes name, ticker AND sec_cik in one statement, so the row is
-- never observable in the forbidden state.
--
-- ============== CONSTRAINT DIRECTION ANALYSIS, ALL FOUR ==============
-- `companies` carries four unique things (enumerated in
-- backend/company_conflict.py lines 9-12 from pg_constraint AND pg_indexes;
-- A PARTIAL UNIQUE INDEX CARRIES NO pg_constraint ROW, so an audit that reads
-- pg_constraint alone reports two of the four as absent):
--
--   companies_name_key         UNIQUE (name)
--       *** AN INSERT ENTERS THIS INDEX. IT CAN RAISE 23505. *** This is the
--       first structural difference from 0029, which never wrote `name`.
--       Verified at analysis time that no row carries any of the twenty names
--       under a case-insensitive exact match. Re-checked in every block.
--
--   companies_name_no_junk     CHECK (lower(trim(name)) NOT IN
--                              ('techcrunch','bloomberg','crunchbase',
--                               'youtube','federal reserve','pentagon','iran'))
--       Read verbatim from backend/migrations/
--       2026-04-30-companies-junk-name-constraint.sql line 69. *** AN INSERT
--       IS SUBJECT TO IT. *** None of the twenty names is in the list, so it
--       cannot fire, but it is now in scope where it was not for 0029.
--
--   companies_name_norm_unique UNIQUE (lower(btrim(name))) WHERE sec_cik IS NULL
--       Membership is keyed on `sec_cik IS NULL`. Every INSERT here writes
--       sec_cik NOT NULL IN THE SAME STATEMENT, so the new row is NEVER
--       INSIDE this index, not even briefly. It cannot fire. Note the
--       direction, which is easy to get backwards: WRITING a sec_cik keeps a
--       row OUT of this index and CLEARING one puts a row IN.
--
--   companies_sec_cik_unique   UNIQUE (sec_cik) WHERE sec_cik IS NOT NULL
--       *** AN INSERT ENTERS THIS INDEX TOO. IT CAN RAISE 23505. *** Verified
--       at analysis time that NO row holds ANY of the twenty CIKs, that no CIK
--       appears twice in this plan, and that no name appears twice. Re-checked
--       in every block, because prod drifts hourly and the daily pipeline can
--       mint a holder between analysis and application.
--
--   ticker                     NO UNIQUE INDEX AT ALL.
--       Cannot raise. Still fatal to correctness: resolveCompanyCik step 2
--       matches ticker FIRST, so a second holder would misroute the page.
--       Every block refuses if any row already carries its ticker. Verified at
--       analysis time that NONE of the twenty tickers is held by any row.
--
-- ONE MORE THING AN INSERT NEEDS AND AN UPDATE DOES NOT: every NOT NULL column
-- without a default must be supplied. The INSERT column list here is exactly
-- (id, name, ticker, sec_cik, mention_count), which is the live mint payload
-- in backend/entity_resolver.py:406-413 plus the two identity columns and a
-- pinned id. BLOCK 00g enumerates the NOT NULL-without-default columns live so
-- the operator can see before pasting whether that list is still sufficient.
--
-- WHY THE ID IS PINNED IN THE FILE RATHER THAN GENERATED. The journal's
-- idempotence guard is a unique index on (table_name, row_id, op). A mint with
-- gen_random_uuid() has NO STABLE row_id: a re-run would mint a SECOND row and
-- write a SECOND journal row, and the rollback could never find the first. So
-- every block declares its uuid as a literal, the block short-circuits to a
-- NOTICE when that id already exists, and the journal index actually guards.
-- This is the one place this file is strictly better than both models.
--
-- ================== HOW TO APPLY. READ THIS BEFORE PASTING. =================
--
-- THE SUPABASE SQL EDITOR WRAPS THE WHOLE PASTE IN ONE TRANSACTION AND IGNORES
-- INNER BEGIN/COMMIT. Proved on 0029: five separate blocks produced five
-- journal rows with identical now() to the microsecond. The consequences are
-- not cosmetic:
--
--   1. A BATCH IS ATOMIC. One block's RAISE EXCEPTION rolls back every other
--      block in the same paste, INCLUDING THEIR JOURNAL ROWS.
--   2. A READ-BACK INSIDE A PASTE IS NOT DURABLE. It shows uncommitted state.
--      It becomes true only when the paste as a whole commits.
--   3. BLOCK 01 IS DDL AND MUST BE ITS OWN PASTE, COMMITTED FIRST. It creates
--      the partial unique index that makes every later block idempotent in the
--      journal. If it shares a paste with a block that refuses, the index
--      rolls back too and the retry runs with no idempotence guard.
--   4. BLOCK 22 MUST BE ITS OWN PASTE, RUN AFTER. Inside the work paste it
--      would read uncommitted rows.
--
-- RECOMMENDED PASTE SEQUENCE. Each line is ONE paste, in order:
--      BLOCK 00                    (read-only pre-flight; read every result)
--      BLOCK 01                    (journal index; DDL; alone; commit it)
--      BLOCK 02 .. BLOCK 12        (BATCH 1, SHAPE N-A, eleven clean mints)
--      BLOCK 22                    (read-only, confirm)
--      BLOCK 13 .. BLOCK 20        (BATCH 2, SHAPE N-B, eight mints that sit
--                                   beside a real different company)
--      BLOCK 22                    (read-only, confirm)
--      BLOCK 21                    (BATCH 3, SHAPE N-C, cik 46765 ALONE)
--      BLOCK 22                    (read-only, confirm)
--
-- PASTE BLOCK 21 BY ITSELF. It is the named hazard and it carries a five-row
-- assertion over the HP cluster; if it refuses, you want to see that on its
-- own and not have it roll back eight other mints.
--
-- Pasting a single block at a time is also correct and is strictly safer. The
-- batches above are the largest groups whose members share one decision.
--
-- Re-running an applied block is a NO-OP that raises a notice. Running a block
-- whose preconditions have drifted RAISES and rolls back the paste it is in.
--
-- ===================== WHAT IS NOT IN THIS FILE =====================
-- No UPDATE, no DELETE, no rename, no merge, no ALTER of anything. The twenty
-- receipt rows, the HP cluster, the 'Consonance' predecessor shell, the BCG
-- and BCSF mis-stamps and every row named in 0029 and 0038 are untouched. The
-- working set is disjoint from both files: neither their row ids nor their
-- CIKs appear here, checked against both branches.
-- =====================================================================


-- =====================================================================
-- BLOCK 00  -- PRE-FLIGHT. Read-only. Changes nothing. Run it first.
--               Read every result before pasting BLOCK 01.
-- =====================================================================
BEGIN;

-- 00a. The four unique things, read live. A partial unique index carries no
-- pg_constraint row, so read pg_indexes too or two of the four report absent.
-- EXPECT: companies_name_key, companies_name_no_junk, companies_sec_cik_unique,
-- companies_name_norm_unique. EXPECT NO UNIQUE INDEX ON `ticker`.
SELECT 'constraint' AS kind, conname AS name, pg_get_constraintdef(oid) AS def
  FROM pg_constraint WHERE conrelid = 'public.companies'::regclass
UNION ALL
SELECT 'index', indexname, indexdef
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'companies'
ORDER BY 1, 2;

-- 00b. THE JOURNAL MUST ALREADY EXIST WITH THE SHAPE THIS FILE WRITES.
-- norm_v2 is NOT exposed through PostgREST (PGRST106, "Only the following
-- schemas are exposed: public, graphql_public"), so NOTHING ABOUT THE JOURNAL
-- COULD BE VERIFIED FROM THE APPLICATION SIDE while this file was written.
-- Its contents are asserted here and nowhere else. RAISES if it is wrong.
DO $$
DECLARE
  v_cols int;
BEGIN
  IF to_regclass('norm_v2.stamped_identity') IS NULL THEN
    RAISE EXCEPTION 'BLOCK 00: norm_v2.stamped_identity does not exist. Apply 0029 BLOCK 01 first. REFUSING.';
  END IF;
  SELECT count(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'norm_v2' AND table_name = 'stamped_identity'
     AND column_name IN ('id','table_name','row_id','op','before','after','note','ran_at','ran_by');
  IF v_cols <> 9 THEN
    RAISE EXCEPTION 'BLOCK 00: norm_v2.stamped_identity has % of the 9 expected columns. REFUSING.', v_cols;
  END IF;
END $$;

-- 00c. What the journal already holds, by op, and which indexes guard it.
-- 0029 wrote op 'stamp_identity'; 0038 wrote op 'clear_ticker'. This file
-- writes op 'mint_identity' and MUST NOT disturb either; see BLOCK 01.
-- EXPECT the two existing partial indexes stamped_identity_stamp_once and
-- stamped_identity_clear_once, and NOT YET stamped_identity_mint_once.
SELECT op, count(*) AS rows, min(ran_at) AS first_at, max(ran_at) AS last_at
  FROM norm_v2.stamped_identity
 GROUP BY op ORDER BY op;

SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'norm_v2' AND tablename = 'stamped_identity'
 ORDER BY indexname;

-- 00d. The load-bearing invariant, BEFORE. EXPECT cik_without_ticker = 0.
-- with_ticker and with_cik each rise by exactly the number of blocks applied.
SELECT count(*) FILTER (WHERE ticker IS NOT NULL)                     AS with_ticker,
       count(*) FILTER (WHERE sec_cik IS NOT NULL)                    AS with_cik,
       count(*) FILTER (WHERE sec_cik IS NOT NULL AND ticker IS NULL) AS cik_without_ticker,
       count(*)                                                       AS total_rows
  FROM public.companies;

-- 00e. *** THE WHOLE WORKING SET IN ONE QUERY. THE ONE TO READ CLOSELY. ***
-- EXPECT ZERO ROWS. Any row returned is a collision this file did not know
-- about, and the block that names it will refuse. A row returned under
-- `collision = name` with sec_cik NULL means someone has minted the name by
-- hand since analysis; that CIK is then a 0029-STYLE STAMP, NOT A MINT, and
-- the block for it must be rewritten before it is pasted.
WITH plan(cik, ticker, name) AS (VALUES
  (715072  ::bigint, 'RNST'  , 'Renasant'),
  (822818  ::bigint, 'CLH'   , 'Clean Harbors'),
  (898173  ::bigint, 'ORLY'  , 'O''Reilly Automotive'),
  (912242  ::bigint, 'MAC'   , 'Macerich'),
  (1060391 ::bigint, 'RSG'   , 'Republic Services'),
  (1297107 ::bigint, 'COSO'  , 'CoastalSouth Bancshares'),
  (1437402 ::bigint, 'ARDX'  , 'Ardelyx'),
  (1657573 ::bigint, 'XMTR'  , 'Xometry'),
  (1937987 ::bigint, 'FBYD'  , 'Falcon''s Beyond Global'),
  (1957132 ::bigint, 'SN'    , 'SharkNinja'),
  (2025401 ::bigint, 'FERA'  , 'Fifth Era Acquisition Corp I'),
  (5981    ::bigint, 'AVD'   , 'American Vanguard'),
  (737875  ::bigint, 'FKYS'  , 'First Keystone'),
  (1325702 ::bigint, 'MX'    , 'Magnachip'),
  (1617553 ::bigint, 'ZIP'   , 'ZipRecruiter'),
  (1746466 ::bigint, 'EQ'    , 'Equillium'),
  (1824893 ::bigint, 'SRZN'  , 'Surrozen'),
  (1997350 ::bigint, 'ARX'   , 'Accelerant Holdings'),
  (2048948 ::bigint, 'NPAC'  , 'New Providence Acquisition Corp. III'),
  (46765   ::bigint, 'HP'    , 'Helmerich & Payne')
)
SELECT 'name'    AS collision, p.cik, p.name AS wanted, c.id, c.name, c.ticker, c.sec_cik, c.mention_count
  FROM plan p JOIN public.companies c ON c.name ILIKE p.name
UNION ALL
SELECT 'sec_cik', p.cik, p.name, c.id, c.name, c.ticker, c.sec_cik, c.mention_count
  FROM plan p JOIN public.companies c ON c.sec_cik = p.cik
UNION ALL
SELECT 'ticker',  p.cik, p.name, c.id, c.name, c.ticker, c.sec_cik, c.mention_count
  FROM plan p JOIN public.companies c ON upper(btrim(c.ticker)) = upper(btrim(p.ticker))
ORDER BY 1, 2;

-- 00f. The twenty pinned ids must NOT already exist. EXPECT ZERO ROWS.
-- A row here means a block has already been applied, or the id has been reused.
SELECT c.id, c.name, c.ticker, c.sec_cik
  FROM public.companies c
 WHERE c.id IN (
   '215a7a1f-95a9-43bb-94ee-78c1b0802368'::uuid,
   '3c3493fb-2a89-46d8-b545-9d28f755e209'::uuid,
   '7897bd5c-6b2b-49fa-941d-b25fcd2585db'::uuid,
   '85ec04e7-275c-4a7e-b643-68e890280cbc'::uuid,
   'e327182f-bdae-4d16-ac77-c1bd54fc75be'::uuid,
   '6d11af3b-e9b0-4fea-aa2d-04114432c536'::uuid,
   '3d73dcb7-eab5-4540-bb00-fae0c4335214'::uuid,
   '9843f36d-df20-4bc3-a177-ebe64c6c1b77'::uuid,
   '689dd809-894f-4972-ad46-55a648573c6e'::uuid,
   '9d2125c4-75e0-47a0-b39a-61ff37da9def'::uuid,
   'ffa81146-a48a-4d44-9568-00db2da1cbcd'::uuid,
   'faf3b340-7628-4cef-8062-71f8e46077a0'::uuid,
   'e8bd9992-cb2b-4360-8822-9a41e45f87ec'::uuid,
   '79f9415e-4369-4125-9ab3-74a9a6ef8046'::uuid,
   '005f408f-008c-4ff0-9f29-0dba41fd6ca1'::uuid,
   'c345df7d-4e7b-4214-a699-5a81ed364cfa'::uuid,
   '0a9de60e-81df-4b05-ba61-64a66088b49c'::uuid,
   '52e4ea16-56ba-4ba3-8e1e-7f6b56db3ac7'::uuid,
   '5995f9dc-ad60-44e6-88ff-fd3918ee5fef'::uuid,
   '1c18dcf2-bc9c-4864-8794-98032f52eb5b'::uuid
 );

-- 00g. *** WHAT AN INSERT NEEDS AND AN UPDATE DOES NOT. *** Every column that
-- is NOT NULL and has NO DEFAULT must appear in the INSERT column list. This
-- file writes exactly (id, name, ticker, sec_cik, mention_count). EXPECT this
-- query to return only columns inside that list. IF IT RETURNS ANY OTHER
-- COLUMN, STOP: every block's INSERT will fail and the file needs editing.
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'companies'
   AND is_nullable = 'NO' AND column_default IS NULL
 ORDER BY ordinal_position;

-- 00h. Nothing this file writes can cascade. EXPECT zero triggers on
-- `companies`. The foreign keys listed point AT companies; an INSERT breaks
-- none of them, but the ROLLBACK IN BLOCK 99 DELETES A ROW, so read this list:
-- it is exactly the set of tables BLOCK 99 must find empty before it deletes.
SELECT tgname, pg_get_triggerdef(oid)
  FROM pg_trigger
 WHERE tgrelid = 'public.companies'::regclass AND NOT tgisinternal;

SELECT c.conrelid::regclass AS child_table, c.conname, pg_get_constraintdef(c.oid) AS def
  FROM pg_constraint c
 WHERE c.contype = 'f' AND c.confrelid = 'public.companies'::regclass
 ORDER BY 1;

-- 00i. What each CIK is holding today, unclaimed. facts, filings and insider
-- rows must all be reachable BY CIK the moment the row exists. Read this as
-- the BEFORE picture and compare it against BLOCK 22b afterwards.
WITH plan(cik) AS (VALUES
  (715072::bigint),
  (822818::bigint),
  (898173::bigint),
  (912242::bigint),
  (1060391::bigint),
  (1297107::bigint),
  (1437402::bigint),
  (1657573::bigint),
  (1937987::bigint),
  (1957132::bigint),
  (2025401::bigint),
  (5981::bigint),
  (737875::bigint),
  (1325702::bigint),
  (1617553::bigint),
  (1746466::bigint),
  (1824893::bigint),
  (1997350::bigint),
  (2048948::bigint),
  (46765::bigint)
)
SELECT p.cik,
       (SELECT count(*) FROM public.financial_facts      f WHERE f.cik = p.cik) AS facts,
       (SELECT count(*) FROM public.sec_filings          s WHERE s.cik = p.cik) AS filings,
       (SELECT count(*) FROM public.insider_transactions i WHERE i.cik = p.cik) AS insider,
       (SELECT count(DISTINCT f.company_id) FROM public.financial_facts f WHERE f.cik = p.cik) AS distinct_receipt_rows,
       (SELECT count(*) FROM public.companies c WHERE c.sec_cik = p.cik)        AS claiming_rows
  FROM plan p ORDER BY p.cik;

COMMIT;


-- =====================================================================
-- BLOCK 01  -- THE JOURNAL GUARD. Idempotent. DDL.
--               *** PASTE THIS ALONE AND COMMIT IT BEFORE ANY WORK BLOCK. ***
--
-- ===================== THE `op` DECISION, IN FULL =====================
--
-- THE QUESTION. norm_v2.stamped_identity already carries two partial unique
-- indexes on (table_name, row_id, op): stamped_identity_stamp_once WHERE
-- op = 'stamp_identity' (0029) and stamped_identity_clear_once WHERE
-- op = 'clear_ticker' (0038). This file neither stamps an existing row nor
-- clears a ticker: IT CREATES A ROW. Reusing either op would inherit an index
-- for free and name the operation falsely.
--
-- THE ANSWER: A THIRD OP, `mint_identity`, PLUS A THIRD PARTIAL UNIQUE INDEX.
-- Three reasons, and the second is decisive on its own.
--
--   1. The op is the only field that says what happened, and the three
--      reversals are genuinely different procedures:
--        stamp_identity  restore TWO columns from `before` onto a row
--        clear_ticker    restore ONE column from `before` onto a row
--        mint_identity   DELETE THE ROW
--      A journal whose op lies is not a record.
--
--   2. *** 0029's BLOCK 99 IS SCOPED BY op = 'stamp_identity' AND WOULD
--      DESTROY THESE ROWS. *** It runs
--        UPDATE public.companies SET ticker = (j.before->>'ticker'),
--               sec_cik = (j.before->>'sec_cik')::bigint
--          FROM norm_v2.stamped_identity j
--         WHERE j.op = 'stamp_identity' AND c.id = j.row_id AND ...
--      followed by DELETE ... WHERE op = 'stamp_identity'. A mint's `before`
--      is NULL, so that UPDATE would NULL OUT the identity of every row this
--      file created and then DELETE the only journal rows that record they
--      exist, leaving orphan named rows with no ticker, no CIK, no receipt
--      and nothing to find them by. That is strictly worse than 0038's case
--      and it settles the question by itself. Symmetrically, 0038's BLOCK 99
--      is scoped by 'clear_ticker' and cannot reach these rows either.
--
--   3. A new op with no index is strictly worse than either alternative,
--      because the index is what stops a second journal row from being
--      written for the same mint. So the index comes with it.
--
-- WHY PARTIAL AND NOT ONE UNCONDITIONAL UNIQUE ON (table_name, row_id, op).
-- Same reason 0038 gave: an unconditional index would read more simply but
-- creating it means DROPPING two live indexes that have already refused real
-- rows, and a CREATE UNIQUE INDEX over existing data can fail on rows nobody
-- has enumerated. Adding a third index beside two others cannot fail that way,
-- and the three are independent: none can refuse another's rows.
--
-- WHAT THE INDEX BUYS HERE SPECIFICALLY. Because every row_id in this file is
-- a PINNED LITERAL rather than gen_random_uuid(), the index is a real guard
-- and not decoration: re-running a block reaches the INSERT only if the
-- companies row was deleted without deleting its journal row, and in that one
-- case the index refuses the second journal row instead of writing a duplicate
-- `after` that BLOCK 99 would then try to delete twice.
-- =====================================================================
BEGIN;

-- Creates nothing that exists. Fails loudly if the table is absent, which
-- BLOCK 00b has already checked.
CREATE UNIQUE INDEX IF NOT EXISTS stamped_identity_mint_once
    ON norm_v2.stamped_identity (table_name, row_id, op)
 WHERE op = 'mint_identity';

COMMENT ON INDEX norm_v2.stamped_identity_mint_once IS
  'One journal row per (table, row) for op = ''mint_identity''. Sibling of '
  'stamped_identity_stamp_once and stamped_identity_clear_once and '
  'deliberately separate from both: a mint_identity reversal DELETES the row, '
  'while the other two restore columns onto a row that already existed. A '
  'mint_identity journal row has `before` IS NULL, and that is not a gap in '
  'the record: it IS the record. The row did not exist.';

-- Read it back. EXPECT all three indexes present.
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'norm_v2' AND tablename = 'stamped_identity'
 ORDER BY indexname;

COMMIT;


-- #####################################################################
-- ##  BATCH 1  --  SHAPE N-A. CLEAN MINT.
-- ##
-- ##  No `companies` row exists under the registrant's name, no row holds
-- ##  its ticker, no row holds its CIK, AND no neighbouring row carries a
-- ##  name a human could mistake for the registrant. The receipt row is a
-- ##  short token with a handful of mentions and names something else
-- ##  entirely.
-- ##
-- ##  ELEVEN BLOCKS, 02 to 12. Safe to paste as one batch.
-- #####################################################################

-- ---------------------------------------------------------------------
-- BLOCK 02  cik 715072   ->  MINT 'Renasant'  (RNST)   SHAPE N-A
--
--   SEC, quoted from https://data.sec.gov/submissions/CIK0000715072.json,
--   fetched with a real User-Agent and a 30s timeout (SEC 403s without one
--   and can hang silently):
--       "name": "RENASANT CORP"
--       "tickers": ["RNST"]   "exchanges": ["NYSE"]
--       "sicDescription": "State Commercial Banks"
--       "formerNames": ["PEOPLES HOLDING CO"]
--   company_tickers.json: cik_str 715072 -> ticker "RNST".
--
--   NO `companies` ROW EXISTS UNDER THIS NAME and no `aliases` row bridges
--   to one. This CIK's facts, filings and insider rows are reachable by CIK
--   the moment this row exists.
--
--   THE RECEIPT. financial_facts.company_id under cik 715072 points at the
--   row named 'NASA' (ffaebc39-65f4-4ef5-85de-3c8257dd2cfa), the row that held this
--   CIK at ingest and was later stripped of both identifiers. THAT ROW IS
--   NOT TOUCHED BY THIS BLOCK and its mention history is left intact. It is
--   the evidence of how the CIK was detached; overwriting it destroys that.
--
--   'Renasant' is the modal surface form in the corpus; 'Renasant
--   Corporation' and 'Renasant Corp' both canonicalize() to it.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid   := '215a7a1f-95a9-43bb-94ee-78c1b0802368'::uuid;
  v_cik     bigint := 715072;
  v_ticker  text   := 'RNST';
  v_name    text   := 'Renasant';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_n       int;
BEGIN
  -- ALREADY APPLIED -> NO-OP, not an error. The id is PINNED IN THIS FILE,
  -- not generated, so a re-run finds the row this block minted rather than
  -- minting a second one under a fresh uuid.
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF FOUND THEN
    IF r.name = v_name AND r.ticker = v_ticker AND r.sec_cik = v_cik THEN
      RAISE NOTICE 'BLOCK 02: already applied (% / % / %). No-op.', v_name, v_ticker, v_cik;
      RETURN;
    END IF;
    RAISE EXCEPTION 'BLOCK 02: id % exists but holds name=% ticker=% cik=%. Not this block''s row. REFUSING.',
      v_id, r.name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_name_key UNIQUE (name). CAN RAISE 23505.
  -- Checked case-insensitively rather than exactly, because a case variant
  -- would pass the index and still be a READ-PATH collision:
  -- matchCompaniesByName uses ilike("name", n).
  SELECT count(*) INTO v_n FROM public.companies WHERE name ILIKE v_name;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 02: % row(s) already carry the name % (case-insensitive). If such a row carries no sec_cik then this CIK is a 0029-STYLE STAMP, NOT A MINT, and this block must be rewritten. REFUSING.', v_n, v_name;
  END IF;

  -- ENTERING companies_sec_cik_unique. CAN RAISE 23505. Re-checked here,
  -- not trusted from analysis time: the daily pipeline stamps CIKs
  -- (backend/edgar/cik_mapping.py) and can mint a holder at any hour.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 02: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort the statement. It is
  -- still fatal to correctness: resolveCompanyCik step 2 matches ticker
  -- FIRST (src/lib/sec-filings.ts) and a second holder misroutes the page.
  SELECT count(*) INTO v_n FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 02: ticker % already on % row(s). REFUSING.', v_ticker, v_n;
  END IF;

  -- *** THE JOURNAL INSERT COMES BEFORE THE WRITE. ALWAYS. ***
  -- `before` IS NULL AND THAT IS DELIBERATE: it is not a missing value, it
  -- is the statement that THE ROW DID NOT EXIST, which is also the reversal
  -- instruction. BLOCK 99 keys on exactly that.
  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'mint_identity',
          NULL,
          jsonb_build_object('name', v_name, 'ticker', v_ticker, 'sec_cik', v_cik),
          format('0041 block 02: mint %s carrying %s / cik %s; no companies row existed under this name (receipt row NASA left untouched)', v_name, v_ticker, v_cik));

  INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count)
  VALUES (v_id, v_name, v_ticker, v_cik, 0);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'BLOCK 02: INSERT affected % rows, expected 1. REFUSING.', v_n;
  END IF;
END $$;

-- READ-BACK. EXPECT exactly one row: Renasant / RNST / 715072, with facts_visible and
-- filings_visible both greater than zero, which is the whole point of the
-- block. Durable only once this paste commits.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts      f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings          s WHERE s.cik = c.sec_cik) AS filings_visible,
       (SELECT count(*) FROM public.insider_transactions i WHERE i.cik = c.sec_cik) AS insider_visible
  FROM public.companies c
 WHERE c.id = '215a7a1f-95a9-43bb-94ee-78c1b0802368'::uuid;

COMMIT;

-- ROLLBACK for block 02 only. See BLOCK 99A for the general per-row form,
-- which also refuses when a child row has appeared. Use 99A in preference
-- to this; this is the shorthand for a mint reversed immediately.
-- BEGIN;
-- DELETE FROM public.companies c
--  USING norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'mint_identity'
--    AND j.row_id = '215a7a1f-95a9-43bb-94ee-78c1b0802368'::uuid AND c.id = j.row_id
--    AND j.before IS NULL
--    AND c.name    = (j.after->>'name')
--    AND c.ticker  = (j.after->>'ticker')
--    AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'mint_identity'
--    AND row_id = '215a7a1f-95a9-43bb-94ee-78c1b0802368'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 03  cik 822818   ->  MINT 'Clean Harbors'  (CLH)   SHAPE N-A
--
--   SEC, quoted from https://data.sec.gov/submissions/CIK0000822818.json,
--   fetched with a real User-Agent and a 30s timeout (SEC 403s without one
--   and can hang silently):
--       "name": "CLEAN HARBORS INC"
--       "tickers": ["CLH"]   "exchanges": ["NYSE"]
--       "sicDescription": "Hazardous Waste Management"
--       "formerNames": []
--   company_tickers.json: cik_str 822818 -> ticker "CLH".
--
--   NO `companies` ROW EXISTS UNDER THIS NAME and no `aliases` row bridges
--   to one. This CIK's facts, filings and insider rows are reachable by CIK
--   the moment this row exists.
--
--   THE RECEIPT. financial_facts.company_id under cik 822818 points at the
--   row named 'Arbor' (e3627810-14a1-4899-9b23-675d53d9e667), the row that held this
--   CIK at ingest and was later stripped of both identifiers. THAT ROW IS
--   NOT TOUCHED BY THIS BLOCK and its mention history is left intact. It is
--   the evidence of how the CIK was detached; overwriting it destroys that.
--
--   'Clean Harbors' is the modal surface form; 'Clean Harbors, Inc.'
--   canonicalize()s to it.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid   := '3c3493fb-2a89-46d8-b545-9d28f755e209'::uuid;
  v_cik     bigint := 822818;
  v_ticker  text   := 'CLH';
  v_name    text   := 'Clean Harbors';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_n       int;
BEGIN
  -- ALREADY APPLIED -> NO-OP, not an error. The id is PINNED IN THIS FILE,
  -- not generated, so a re-run finds the row this block minted rather than
  -- minting a second one under a fresh uuid.
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF FOUND THEN
    IF r.name = v_name AND r.ticker = v_ticker AND r.sec_cik = v_cik THEN
      RAISE NOTICE 'BLOCK 03: already applied (% / % / %). No-op.', v_name, v_ticker, v_cik;
      RETURN;
    END IF;
    RAISE EXCEPTION 'BLOCK 03: id % exists but holds name=% ticker=% cik=%. Not this block''s row. REFUSING.',
      v_id, r.name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_name_key UNIQUE (name). CAN RAISE 23505.
  -- Checked case-insensitively rather than exactly, because a case variant
  -- would pass the index and still be a READ-PATH collision:
  -- matchCompaniesByName uses ilike("name", n).
  SELECT count(*) INTO v_n FROM public.companies WHERE name ILIKE v_name;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 03: % row(s) already carry the name % (case-insensitive). If such a row carries no sec_cik then this CIK is a 0029-STYLE STAMP, NOT A MINT, and this block must be rewritten. REFUSING.', v_n, v_name;
  END IF;

  -- ENTERING companies_sec_cik_unique. CAN RAISE 23505. Re-checked here,
  -- not trusted from analysis time: the daily pipeline stamps CIKs
  -- (backend/edgar/cik_mapping.py) and can mint a holder at any hour.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 03: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort the statement. It is
  -- still fatal to correctness: resolveCompanyCik step 2 matches ticker
  -- FIRST (src/lib/sec-filings.ts) and a second holder misroutes the page.
  SELECT count(*) INTO v_n FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 03: ticker % already on % row(s). REFUSING.', v_ticker, v_n;
  END IF;

  -- *** THE JOURNAL INSERT COMES BEFORE THE WRITE. ALWAYS. ***
  -- `before` IS NULL AND THAT IS DELIBERATE: it is not a missing value, it
  -- is the statement that THE ROW DID NOT EXIST, which is also the reversal
  -- instruction. BLOCK 99 keys on exactly that.
  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'mint_identity',
          NULL,
          jsonb_build_object('name', v_name, 'ticker', v_ticker, 'sec_cik', v_cik),
          format('0041 block 03: mint %s carrying %s / cik %s; no companies row existed under this name (receipt row Arbor left untouched)', v_name, v_ticker, v_cik));

  INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count)
  VALUES (v_id, v_name, v_ticker, v_cik, 0);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'BLOCK 03: INSERT affected % rows, expected 1. REFUSING.', v_n;
  END IF;
END $$;

-- READ-BACK. EXPECT exactly one row: Clean Harbors / CLH / 822818, with facts_visible and
-- filings_visible both greater than zero, which is the whole point of the
-- block. Durable only once this paste commits.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts      f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings          s WHERE s.cik = c.sec_cik) AS filings_visible,
       (SELECT count(*) FROM public.insider_transactions i WHERE i.cik = c.sec_cik) AS insider_visible
  FROM public.companies c
 WHERE c.id = '3c3493fb-2a89-46d8-b545-9d28f755e209'::uuid;

COMMIT;

-- ROLLBACK for block 03 only. See BLOCK 99A for the general per-row form,
-- which also refuses when a child row has appeared. Use 99A in preference
-- to this; this is the shorthand for a mint reversed immediately.
-- BEGIN;
-- DELETE FROM public.companies c
--  USING norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'mint_identity'
--    AND j.row_id = '3c3493fb-2a89-46d8-b545-9d28f755e209'::uuid AND c.id = j.row_id
--    AND j.before IS NULL
--    AND c.name    = (j.after->>'name')
--    AND c.ticker  = (j.after->>'ticker')
--    AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'mint_identity'
--    AND row_id = '3c3493fb-2a89-46d8-b545-9d28f755e209'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 04  cik 898173   ->  MINT 'O'Reilly Automotive'  (ORLY)   SHAPE N-A
--
--   SEC, quoted from https://data.sec.gov/submissions/CIK0000898173.json,
--   fetched with a real User-Agent and a 30s timeout (SEC 403s without one
--   and can hang silently):
--       "name": "O REILLY AUTOMOTIVE INC"
--       "tickers": ["ORLY"]   "exchanges": ["Nasdaq"]
--       "sicDescription": "Retail-Auto & Home Supply Stores"
--       "formerNames": ["OREILLY AUTOMOTIVE INC"]
--   company_tickers.json: cik_str 898173 -> ticker "ORLY".
--
--   NO `companies` ROW EXISTS UNDER THIS NAME and no `aliases` row bridges
--   to one. This CIK's facts, filings and insider rows are reachable by CIK
--   the moment this row exists.
--
--   THE RECEIPT. financial_facts.company_id under cik 898173 points at the
--   row named 'Motive' (d57a75fc-319a-44da-81f2-788e495450c4), the row that held this
--   CIK at ingest and was later stripped of both identifiers. THAT ROW IS
--   NOT TOUCHED BY THIS BLOCK and its mention history is left intact. It is
--   the evidence of how the CIK was detached; overwriting it destroys that.
--
--   "O'Reilly Automotive, Inc." is the single most common surface form
--   and canonicalize()s to "O'Reilly Automotive", which is the chosen
--   name. NOTE the corpus also carries the TYPOGRAPHIC APOSTROPHE form
--   "O\u2019Reilly Automotive"; that string is a DIFFERENT string to
--   Postgres and will not ilike-match this row. Not fixed here.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid   := '7897bd5c-6b2b-49fa-941d-b25fcd2585db'::uuid;
  v_cik     bigint := 898173;
  v_ticker  text   := 'ORLY';
  v_name    text   := 'O''Reilly Automotive';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_n       int;
BEGIN
  -- ALREADY APPLIED -> NO-OP, not an error. The id is PINNED IN THIS FILE,
  -- not generated, so a re-run finds the row this block minted rather than
  -- minting a second one under a fresh uuid.
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF FOUND THEN
    IF r.name = v_name AND r.ticker = v_ticker AND r.sec_cik = v_cik THEN
      RAISE NOTICE 'BLOCK 04: already applied (% / % / %). No-op.', v_name, v_ticker, v_cik;
      RETURN;
    END IF;
    RAISE EXCEPTION 'BLOCK 04: id % exists but holds name=% ticker=% cik=%. Not this block''s row. REFUSING.',
      v_id, r.name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_name_key UNIQUE (name). CAN RAISE 23505.
  -- Checked case-insensitively rather than exactly, because a case variant
  -- would pass the index and still be a READ-PATH collision:
  -- matchCompaniesByName uses ilike("name", n).
  SELECT count(*) INTO v_n FROM public.companies WHERE name ILIKE v_name;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 04: % row(s) already carry the name % (case-insensitive). If such a row carries no sec_cik then this CIK is a 0029-STYLE STAMP, NOT A MINT, and this block must be rewritten. REFUSING.', v_n, v_name;
  END IF;

  -- ENTERING companies_sec_cik_unique. CAN RAISE 23505. Re-checked here,
  -- not trusted from analysis time: the daily pipeline stamps CIKs
  -- (backend/edgar/cik_mapping.py) and can mint a holder at any hour.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 04: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort the statement. It is
  -- still fatal to correctness: resolveCompanyCik step 2 matches ticker
  -- FIRST (src/lib/sec-filings.ts) and a second holder misroutes the page.
  SELECT count(*) INTO v_n FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 04: ticker % already on % row(s). REFUSING.', v_ticker, v_n;
  END IF;

  -- *** THE JOURNAL INSERT COMES BEFORE THE WRITE. ALWAYS. ***
  -- `before` IS NULL AND THAT IS DELIBERATE: it is not a missing value, it
  -- is the statement that THE ROW DID NOT EXIST, which is also the reversal
  -- instruction. BLOCK 99 keys on exactly that.
  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'mint_identity',
          NULL,
          jsonb_build_object('name', v_name, 'ticker', v_ticker, 'sec_cik', v_cik),
          format('0041 block 04: mint %s carrying %s / cik %s; no companies row existed under this name (receipt row Motive left untouched)', v_name, v_ticker, v_cik));

  INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count)
  VALUES (v_id, v_name, v_ticker, v_cik, 0);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'BLOCK 04: INSERT affected % rows, expected 1. REFUSING.', v_n;
  END IF;
END $$;

-- READ-BACK. EXPECT exactly one row: O'Reilly Automotive / ORLY / 898173, with facts_visible and
-- filings_visible both greater than zero, which is the whole point of the
-- block. Durable only once this paste commits.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts      f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings          s WHERE s.cik = c.sec_cik) AS filings_visible,
       (SELECT count(*) FROM public.insider_transactions i WHERE i.cik = c.sec_cik) AS insider_visible
  FROM public.companies c
 WHERE c.id = '7897bd5c-6b2b-49fa-941d-b25fcd2585db'::uuid;

COMMIT;

-- ROLLBACK for block 04 only. See BLOCK 99A for the general per-row form,
-- which also refuses when a child row has appeared. Use 99A in preference
-- to this; this is the shorthand for a mint reversed immediately.
-- BEGIN;
-- DELETE FROM public.companies c
--  USING norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'mint_identity'
--    AND j.row_id = '7897bd5c-6b2b-49fa-941d-b25fcd2585db'::uuid AND c.id = j.row_id
--    AND j.before IS NULL
--    AND c.name    = (j.after->>'name')
--    AND c.ticker  = (j.after->>'ticker')
--    AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'mint_identity'
--    AND row_id = '7897bd5c-6b2b-49fa-941d-b25fcd2585db'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 05  cik 912242   ->  MINT 'Macerich'  (MAC)   SHAPE N-A
--
--   SEC, quoted from https://data.sec.gov/submissions/CIK0000912242.json,
--   fetched with a real User-Agent and a 30s timeout (SEC 403s without one
--   and can hang silently):
--       "name": "MACERICH CO"
--       "tickers": ["MAC"]   "exchanges": ["NYSE"]
--       "sicDescription": "Real Estate Investment Trusts"
--       "formerNames": []
--   company_tickers.json: cik_str 912242 -> ticker "MAC".
--
--   NO `companies` ROW EXISTS UNDER THIS NAME and no `aliases` row bridges
--   to one. This CIK's facts, filings and insider rows are reachable by CIK
--   the moment this row exists.
--
--   THE RECEIPT. financial_facts.company_id under cik 912242 points at the
--   row named 'Acer' (32750385-e801-4c93-88df-e98916dd7508), the row that held this
--   CIK at ingest and was later stripped of both identifiers. THAT ROW IS
--   NOT TOUCHED BY THIS BLOCK and its mention history is left intact. It is
--   the evidence of how the CIK was detached; overwriting it destroys that.
--
--   'Macerich' is the ONLY surface form present in the corpus.
--   canonicalize('MACERICH CO') does NOT strip 'CO', so the SEC string
--   is not usable as the row name.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid   := '85ec04e7-275c-4a7e-b643-68e890280cbc'::uuid;
  v_cik     bigint := 912242;
  v_ticker  text   := 'MAC';
  v_name    text   := 'Macerich';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_n       int;
BEGIN
  -- ALREADY APPLIED -> NO-OP, not an error. The id is PINNED IN THIS FILE,
  -- not generated, so a re-run finds the row this block minted rather than
  -- minting a second one under a fresh uuid.
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF FOUND THEN
    IF r.name = v_name AND r.ticker = v_ticker AND r.sec_cik = v_cik THEN
      RAISE NOTICE 'BLOCK 05: already applied (% / % / %). No-op.', v_name, v_ticker, v_cik;
      RETURN;
    END IF;
    RAISE EXCEPTION 'BLOCK 05: id % exists but holds name=% ticker=% cik=%. Not this block''s row. REFUSING.',
      v_id, r.name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_name_key UNIQUE (name). CAN RAISE 23505.
  -- Checked case-insensitively rather than exactly, because a case variant
  -- would pass the index and still be a READ-PATH collision:
  -- matchCompaniesByName uses ilike("name", n).
  SELECT count(*) INTO v_n FROM public.companies WHERE name ILIKE v_name;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 05: % row(s) already carry the name % (case-insensitive). If such a row carries no sec_cik then this CIK is a 0029-STYLE STAMP, NOT A MINT, and this block must be rewritten. REFUSING.', v_n, v_name;
  END IF;

  -- ENTERING companies_sec_cik_unique. CAN RAISE 23505. Re-checked here,
  -- not trusted from analysis time: the daily pipeline stamps CIKs
  -- (backend/edgar/cik_mapping.py) and can mint a holder at any hour.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 05: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort the statement. It is
  -- still fatal to correctness: resolveCompanyCik step 2 matches ticker
  -- FIRST (src/lib/sec-filings.ts) and a second holder misroutes the page.
  SELECT count(*) INTO v_n FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 05: ticker % already on % row(s). REFUSING.', v_ticker, v_n;
  END IF;

  -- *** THE JOURNAL INSERT COMES BEFORE THE WRITE. ALWAYS. ***
  -- `before` IS NULL AND THAT IS DELIBERATE: it is not a missing value, it
  -- is the statement that THE ROW DID NOT EXIST, which is also the reversal
  -- instruction. BLOCK 99 keys on exactly that.
  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'mint_identity',
          NULL,
          jsonb_build_object('name', v_name, 'ticker', v_ticker, 'sec_cik', v_cik),
          format('0041 block 05: mint %s carrying %s / cik %s; no companies row existed under this name (receipt row Acer left untouched)', v_name, v_ticker, v_cik));

  INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count)
  VALUES (v_id, v_name, v_ticker, v_cik, 0);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'BLOCK 05: INSERT affected % rows, expected 1. REFUSING.', v_n;
  END IF;
END $$;

-- READ-BACK. EXPECT exactly one row: Macerich / MAC / 912242, with facts_visible and
-- filings_visible both greater than zero, which is the whole point of the
-- block. Durable only once this paste commits.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts      f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings          s WHERE s.cik = c.sec_cik) AS filings_visible,
       (SELECT count(*) FROM public.insider_transactions i WHERE i.cik = c.sec_cik) AS insider_visible
  FROM public.companies c
 WHERE c.id = '85ec04e7-275c-4a7e-b643-68e890280cbc'::uuid;

COMMIT;

-- ROLLBACK for block 05 only. See BLOCK 99A for the general per-row form,
-- which also refuses when a child row has appeared. Use 99A in preference
-- to this; this is the shorthand for a mint reversed immediately.
-- BEGIN;
-- DELETE FROM public.companies c
--  USING norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'mint_identity'
--    AND j.row_id = '85ec04e7-275c-4a7e-b643-68e890280cbc'::uuid AND c.id = j.row_id
--    AND j.before IS NULL
--    AND c.name    = (j.after->>'name')
--    AND c.ticker  = (j.after->>'ticker')
--    AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'mint_identity'
--    AND row_id = '85ec04e7-275c-4a7e-b643-68e890280cbc'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 06  cik 1060391  ->  MINT 'Republic Services'  (RSG)   SHAPE N-A
--
--   SEC, quoted from https://data.sec.gov/submissions/CIK0001060391.json,
--   fetched with a real User-Agent and a 30s timeout (SEC 403s without one
--   and can hang silently):
--       "name": "REPUBLIC SERVICES, INC."
--       "tickers": ["RSG"]   "exchanges": ["NYSE"]
--       "sicDescription": "Refuse Systems"
--       "formerNames": ["REPUBLIC SERVICES INC"]
--   company_tickers.json: cik_str 1060391 -> ticker "RSG".
--
--   NO `companies` ROW EXISTS UNDER THIS NAME and no `aliases` row bridges
--   to one. This CIK's facts, filings and insider rows are reachable by CIK
--   the moment this row exists.
--
--   THE RECEIPT. financial_facts.company_id under cik 1060391 points at the
--   row named 'LIC' (4c737a98-7098-44d4-8e81-702648c9b630), the row that held this
--   CIK at ingest and was later stripped of both identifiers. THAT ROW IS
--   NOT TOUCHED BY THIS BLOCK and its mention history is left intact. It is
--   the evidence of how the CIK was detached; overwriting it destroys that.
--
--   'Republic Services, Inc.' is the modal surface form and
--   canonicalize()s to 'Republic Services'. The only existing row
--   containing the token is 'Trade Republic', a different company; it
--   is not touched.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid   := 'e327182f-bdae-4d16-ac77-c1bd54fc75be'::uuid;
  v_cik     bigint := 1060391;
  v_ticker  text   := 'RSG';
  v_name    text   := 'Republic Services';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_n       int;
BEGIN
  -- ALREADY APPLIED -> NO-OP, not an error. The id is PINNED IN THIS FILE,
  -- not generated, so a re-run finds the row this block minted rather than
  -- minting a second one under a fresh uuid.
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF FOUND THEN
    IF r.name = v_name AND r.ticker = v_ticker AND r.sec_cik = v_cik THEN
      RAISE NOTICE 'BLOCK 06: already applied (% / % / %). No-op.', v_name, v_ticker, v_cik;
      RETURN;
    END IF;
    RAISE EXCEPTION 'BLOCK 06: id % exists but holds name=% ticker=% cik=%. Not this block''s row. REFUSING.',
      v_id, r.name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_name_key UNIQUE (name). CAN RAISE 23505.
  -- Checked case-insensitively rather than exactly, because a case variant
  -- would pass the index and still be a READ-PATH collision:
  -- matchCompaniesByName uses ilike("name", n).
  SELECT count(*) INTO v_n FROM public.companies WHERE name ILIKE v_name;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 06: % row(s) already carry the name % (case-insensitive). If such a row carries no sec_cik then this CIK is a 0029-STYLE STAMP, NOT A MINT, and this block must be rewritten. REFUSING.', v_n, v_name;
  END IF;

  -- ENTERING companies_sec_cik_unique. CAN RAISE 23505. Re-checked here,
  -- not trusted from analysis time: the daily pipeline stamps CIKs
  -- (backend/edgar/cik_mapping.py) and can mint a holder at any hour.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 06: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort the statement. It is
  -- still fatal to correctness: resolveCompanyCik step 2 matches ticker
  -- FIRST (src/lib/sec-filings.ts) and a second holder misroutes the page.
  SELECT count(*) INTO v_n FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 06: ticker % already on % row(s). REFUSING.', v_ticker, v_n;
  END IF;

  -- *** THE JOURNAL INSERT COMES BEFORE THE WRITE. ALWAYS. ***
  -- `before` IS NULL AND THAT IS DELIBERATE: it is not a missing value, it
  -- is the statement that THE ROW DID NOT EXIST, which is also the reversal
  -- instruction. BLOCK 99 keys on exactly that.
  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'mint_identity',
          NULL,
          jsonb_build_object('name', v_name, 'ticker', v_ticker, 'sec_cik', v_cik),
          format('0041 block 06: mint %s carrying %s / cik %s; no companies row existed under this name (receipt row LIC left untouched)', v_name, v_ticker, v_cik));

  INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count)
  VALUES (v_id, v_name, v_ticker, v_cik, 0);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'BLOCK 06: INSERT affected % rows, expected 1. REFUSING.', v_n;
  END IF;
END $$;

-- READ-BACK. EXPECT exactly one row: Republic Services / RSG / 1060391, with facts_visible and
-- filings_visible both greater than zero, which is the whole point of the
-- block. Durable only once this paste commits.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts      f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings          s WHERE s.cik = c.sec_cik) AS filings_visible,
       (SELECT count(*) FROM public.insider_transactions i WHERE i.cik = c.sec_cik) AS insider_visible
  FROM public.companies c
 WHERE c.id = 'e327182f-bdae-4d16-ac77-c1bd54fc75be'::uuid;

COMMIT;

-- ROLLBACK for block 06 only. See BLOCK 99A for the general per-row form,
-- which also refuses when a child row has appeared. Use 99A in preference
-- to this; this is the shorthand for a mint reversed immediately.
-- BEGIN;
-- DELETE FROM public.companies c
--  USING norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'mint_identity'
--    AND j.row_id = 'e327182f-bdae-4d16-ac77-c1bd54fc75be'::uuid AND c.id = j.row_id
--    AND j.before IS NULL
--    AND c.name    = (j.after->>'name')
--    AND c.ticker  = (j.after->>'ticker')
--    AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'mint_identity'
--    AND row_id = 'e327182f-bdae-4d16-ac77-c1bd54fc75be'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 07  cik 1297107  ->  MINT 'CoastalSouth Bancshares'  (COSO)   SHAPE N-A
--
--   SEC, quoted from https://data.sec.gov/submissions/CIK0001297107.json,
--   fetched with a real User-Agent and a 30s timeout (SEC 403s without one
--   and can hang silently):
--       "name": "CoastalSouth Bancshares, Inc."
--       "tickers": ["COSO"]   "exchanges": ["NYSE"]
--       "sicDescription": "State Commercial Banks"
--       "formerNames": ["Coastal South Bancshares Inc"]
--   company_tickers.json: cik_str 1297107 -> ticker "COSO".
--
--   NO `companies` ROW EXISTS UNDER THIS NAME and no `aliases` row bridges
--   to one. This CIK's facts, filings and insider rows are reachable by CIK
--   the moment this row exists.
--
--   THE RECEIPT. financial_facts.company_id under cik 1297107 points at the
--   row named 'Also' (a285fcbc-abca-4b2b-8030-1a252dac4837), the row that held this
--   CIK at ingest and was later stripped of both identifiers. THAT ROW IS
--   NOT TOUCHED BY THIS BLOCK and its mention history is left intact. It is
--   the evidence of how the CIK was detached; overwriting it destroys that.
--
--   'CoastalSouth Bancshares, Inc.' is the modal surface form and
--   canonicalize()s to 'CoastalSouth Bancshares'. Note
--   isJunkEntityName('Also') returns TRUE, so the receipt row would
--   not be minted by today's resolver at all.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid   := '6d11af3b-e9b0-4fea-aa2d-04114432c536'::uuid;
  v_cik     bigint := 1297107;
  v_ticker  text   := 'COSO';
  v_name    text   := 'CoastalSouth Bancshares';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_n       int;
BEGIN
  -- ALREADY APPLIED -> NO-OP, not an error. The id is PINNED IN THIS FILE,
  -- not generated, so a re-run finds the row this block minted rather than
  -- minting a second one under a fresh uuid.
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF FOUND THEN
    IF r.name = v_name AND r.ticker = v_ticker AND r.sec_cik = v_cik THEN
      RAISE NOTICE 'BLOCK 07: already applied (% / % / %). No-op.', v_name, v_ticker, v_cik;
      RETURN;
    END IF;
    RAISE EXCEPTION 'BLOCK 07: id % exists but holds name=% ticker=% cik=%. Not this block''s row. REFUSING.',
      v_id, r.name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_name_key UNIQUE (name). CAN RAISE 23505.
  -- Checked case-insensitively rather than exactly, because a case variant
  -- would pass the index and still be a READ-PATH collision:
  -- matchCompaniesByName uses ilike("name", n).
  SELECT count(*) INTO v_n FROM public.companies WHERE name ILIKE v_name;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 07: % row(s) already carry the name % (case-insensitive). If such a row carries no sec_cik then this CIK is a 0029-STYLE STAMP, NOT A MINT, and this block must be rewritten. REFUSING.', v_n, v_name;
  END IF;

  -- ENTERING companies_sec_cik_unique. CAN RAISE 23505. Re-checked here,
  -- not trusted from analysis time: the daily pipeline stamps CIKs
  -- (backend/edgar/cik_mapping.py) and can mint a holder at any hour.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 07: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort the statement. It is
  -- still fatal to correctness: resolveCompanyCik step 2 matches ticker
  -- FIRST (src/lib/sec-filings.ts) and a second holder misroutes the page.
  SELECT count(*) INTO v_n FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 07: ticker % already on % row(s). REFUSING.', v_ticker, v_n;
  END IF;

  -- *** THE JOURNAL INSERT COMES BEFORE THE WRITE. ALWAYS. ***
  -- `before` IS NULL AND THAT IS DELIBERATE: it is not a missing value, it
  -- is the statement that THE ROW DID NOT EXIST, which is also the reversal
  -- instruction. BLOCK 99 keys on exactly that.
  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'mint_identity',
          NULL,
          jsonb_build_object('name', v_name, 'ticker', v_ticker, 'sec_cik', v_cik),
          format('0041 block 07: mint %s carrying %s / cik %s; no companies row existed under this name (receipt row Also left untouched)', v_name, v_ticker, v_cik));

  INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count)
  VALUES (v_id, v_name, v_ticker, v_cik, 0);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'BLOCK 07: INSERT affected % rows, expected 1. REFUSING.', v_n;
  END IF;
END $$;

-- READ-BACK. EXPECT exactly one row: CoastalSouth Bancshares / COSO / 1297107, with facts_visible and
-- filings_visible both greater than zero, which is the whole point of the
-- block. Durable only once this paste commits.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts      f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings          s WHERE s.cik = c.sec_cik) AS filings_visible,
       (SELECT count(*) FROM public.insider_transactions i WHERE i.cik = c.sec_cik) AS insider_visible
  FROM public.companies c
 WHERE c.id = '6d11af3b-e9b0-4fea-aa2d-04114432c536'::uuid;

COMMIT;

-- ROLLBACK for block 07 only. See BLOCK 99A for the general per-row form,
-- which also refuses when a child row has appeared. Use 99A in preference
-- to this; this is the shorthand for a mint reversed immediately.
-- BEGIN;
-- DELETE FROM public.companies c
--  USING norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'mint_identity'
--    AND j.row_id = '6d11af3b-e9b0-4fea-aa2d-04114432c536'::uuid AND c.id = j.row_id
--    AND j.before IS NULL
--    AND c.name    = (j.after->>'name')
--    AND c.ticker  = (j.after->>'ticker')
--    AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'mint_identity'
--    AND row_id = '6d11af3b-e9b0-4fea-aa2d-04114432c536'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 08  cik 1437402  ->  MINT 'Ardelyx'  (ARDX)   SHAPE N-A
--
--   SEC, quoted from https://data.sec.gov/submissions/CIK0001437402.json,
--   fetched with a real User-Agent and a 30s timeout (SEC 403s without one
--   and can hang silently):
--       "name": "ARDELYX, INC."
--       "tickers": ["ARDX"]   "exchanges": ["Nasdaq"]
--       "sicDescription": "Pharmaceutical Preparations"
--       "formerNames": ["NTERYX INC"]
--   company_tickers.json: cik_str 1437402 -> ticker "ARDX".
--
--   NO `companies` ROW EXISTS UNDER THIS NAME and no `aliases` row bridges
--   to one. This CIK's facts, filings and insider rows are reachable by CIK
--   the moment this row exists.
--
--   THE RECEIPT. financial_facts.company_id under cik 1437402 points at the
--   row named 'Ely' (01a34460-268f-4547-a0bd-f3143f54b99d), the row that held this
--   CIK at ingest and was later stripped of both identifiers. THAT ROW IS
--   NOT TOUCHED BY THIS BLOCK and its mention history is left intact. It is
--   the evidence of how the CIK was detached; overwriting it destroys that.
--
--   'Ardelyx' is the modal surface form; every longer form
--   canonicalize()s to it.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid   := '3d73dcb7-eab5-4540-bb00-fae0c4335214'::uuid;
  v_cik     bigint := 1437402;
  v_ticker  text   := 'ARDX';
  v_name    text   := 'Ardelyx';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_n       int;
BEGIN
  -- ALREADY APPLIED -> NO-OP, not an error. The id is PINNED IN THIS FILE,
  -- not generated, so a re-run finds the row this block minted rather than
  -- minting a second one under a fresh uuid.
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF FOUND THEN
    IF r.name = v_name AND r.ticker = v_ticker AND r.sec_cik = v_cik THEN
      RAISE NOTICE 'BLOCK 08: already applied (% / % / %). No-op.', v_name, v_ticker, v_cik;
      RETURN;
    END IF;
    RAISE EXCEPTION 'BLOCK 08: id % exists but holds name=% ticker=% cik=%. Not this block''s row. REFUSING.',
      v_id, r.name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_name_key UNIQUE (name). CAN RAISE 23505.
  -- Checked case-insensitively rather than exactly, because a case variant
  -- would pass the index and still be a READ-PATH collision:
  -- matchCompaniesByName uses ilike("name", n).
  SELECT count(*) INTO v_n FROM public.companies WHERE name ILIKE v_name;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 08: % row(s) already carry the name % (case-insensitive). If such a row carries no sec_cik then this CIK is a 0029-STYLE STAMP, NOT A MINT, and this block must be rewritten. REFUSING.', v_n, v_name;
  END IF;

  -- ENTERING companies_sec_cik_unique. CAN RAISE 23505. Re-checked here,
  -- not trusted from analysis time: the daily pipeline stamps CIKs
  -- (backend/edgar/cik_mapping.py) and can mint a holder at any hour.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 08: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort the statement. It is
  -- still fatal to correctness: resolveCompanyCik step 2 matches ticker
  -- FIRST (src/lib/sec-filings.ts) and a second holder misroutes the page.
  SELECT count(*) INTO v_n FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 08: ticker % already on % row(s). REFUSING.', v_ticker, v_n;
  END IF;

  -- *** THE JOURNAL INSERT COMES BEFORE THE WRITE. ALWAYS. ***
  -- `before` IS NULL AND THAT IS DELIBERATE: it is not a missing value, it
  -- is the statement that THE ROW DID NOT EXIST, which is also the reversal
  -- instruction. BLOCK 99 keys on exactly that.
  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'mint_identity',
          NULL,
          jsonb_build_object('name', v_name, 'ticker', v_ticker, 'sec_cik', v_cik),
          format('0041 block 08: mint %s carrying %s / cik %s; no companies row existed under this name (receipt row Ely left untouched)', v_name, v_ticker, v_cik));

  INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count)
  VALUES (v_id, v_name, v_ticker, v_cik, 0);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'BLOCK 08: INSERT affected % rows, expected 1. REFUSING.', v_n;
  END IF;
END $$;

-- READ-BACK. EXPECT exactly one row: Ardelyx / ARDX / 1437402, with facts_visible and
-- filings_visible both greater than zero, which is the whole point of the
-- block. Durable only once this paste commits.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts      f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings          s WHERE s.cik = c.sec_cik) AS filings_visible,
       (SELECT count(*) FROM public.insider_transactions i WHERE i.cik = c.sec_cik) AS insider_visible
  FROM public.companies c
 WHERE c.id = '3d73dcb7-eab5-4540-bb00-fae0c4335214'::uuid;

COMMIT;

-- ROLLBACK for block 08 only. See BLOCK 99A for the general per-row form,
-- which also refuses when a child row has appeared. Use 99A in preference
-- to this; this is the shorthand for a mint reversed immediately.
-- BEGIN;
-- DELETE FROM public.companies c
--  USING norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'mint_identity'
--    AND j.row_id = '3d73dcb7-eab5-4540-bb00-fae0c4335214'::uuid AND c.id = j.row_id
--    AND j.before IS NULL
--    AND c.name    = (j.after->>'name')
--    AND c.ticker  = (j.after->>'ticker')
--    AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'mint_identity'
--    AND row_id = '3d73dcb7-eab5-4540-bb00-fae0c4335214'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 09  cik 1657573  ->  MINT 'Xometry'  (XMTR)   SHAPE N-A
--
--   SEC, quoted from https://data.sec.gov/submissions/CIK0001657573.json,
--   fetched with a real User-Agent and a 30s timeout (SEC 403s without one
--   and can hang silently):
--       "name": "Xometry, Inc."
--       "tickers": ["XMTR"]   "exchanges": ["Nasdaq"]
--       "sicDescription": "Services-Business Services, NEC"
--       "formerNames": []
--   company_tickers.json: cik_str 1657573 -> ticker "XMTR".
--
--   NO `companies` ROW EXISTS UNDER THIS NAME and no `aliases` row bridges
--   to one. This CIK's facts, filings and insider rows are reachable by CIK
--   the moment this row exists.
--
--   THE RECEIPT. financial_facts.company_id under cik 1657573 points at the
--   row named 'METR' (2feb8a57-380a-4b7f-b8cf-3f736ea14c39), the row that held this
--   CIK at ingest and was later stripped of both identifiers. THAT ROW IS
--   NOT TOUCHED BY THIS BLOCK and its mention history is left intact. It is
--   the evidence of how the CIK was detached; overwriting it destroys that.
--
--   'Xometry' is the modal surface form; 'Xometry, Inc.'
--   canonicalize()s to it.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid   := '9843f36d-df20-4bc3-a177-ebe64c6c1b77'::uuid;
  v_cik     bigint := 1657573;
  v_ticker  text   := 'XMTR';
  v_name    text   := 'Xometry';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_n       int;
BEGIN
  -- ALREADY APPLIED -> NO-OP, not an error. The id is PINNED IN THIS FILE,
  -- not generated, so a re-run finds the row this block minted rather than
  -- minting a second one under a fresh uuid.
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF FOUND THEN
    IF r.name = v_name AND r.ticker = v_ticker AND r.sec_cik = v_cik THEN
      RAISE NOTICE 'BLOCK 09: already applied (% / % / %). No-op.', v_name, v_ticker, v_cik;
      RETURN;
    END IF;
    RAISE EXCEPTION 'BLOCK 09: id % exists but holds name=% ticker=% cik=%. Not this block''s row. REFUSING.',
      v_id, r.name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_name_key UNIQUE (name). CAN RAISE 23505.
  -- Checked case-insensitively rather than exactly, because a case variant
  -- would pass the index and still be a READ-PATH collision:
  -- matchCompaniesByName uses ilike("name", n).
  SELECT count(*) INTO v_n FROM public.companies WHERE name ILIKE v_name;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 09: % row(s) already carry the name % (case-insensitive). If such a row carries no sec_cik then this CIK is a 0029-STYLE STAMP, NOT A MINT, and this block must be rewritten. REFUSING.', v_n, v_name;
  END IF;

  -- ENTERING companies_sec_cik_unique. CAN RAISE 23505. Re-checked here,
  -- not trusted from analysis time: the daily pipeline stamps CIKs
  -- (backend/edgar/cik_mapping.py) and can mint a holder at any hour.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 09: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort the statement. It is
  -- still fatal to correctness: resolveCompanyCik step 2 matches ticker
  -- FIRST (src/lib/sec-filings.ts) and a second holder misroutes the page.
  SELECT count(*) INTO v_n FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 09: ticker % already on % row(s). REFUSING.', v_ticker, v_n;
  END IF;

  -- *** THE JOURNAL INSERT COMES BEFORE THE WRITE. ALWAYS. ***
  -- `before` IS NULL AND THAT IS DELIBERATE: it is not a missing value, it
  -- is the statement that THE ROW DID NOT EXIST, which is also the reversal
  -- instruction. BLOCK 99 keys on exactly that.
  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'mint_identity',
          NULL,
          jsonb_build_object('name', v_name, 'ticker', v_ticker, 'sec_cik', v_cik),
          format('0041 block 09: mint %s carrying %s / cik %s; no companies row existed under this name (receipt row METR left untouched)', v_name, v_ticker, v_cik));

  INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count)
  VALUES (v_id, v_name, v_ticker, v_cik, 0);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'BLOCK 09: INSERT affected % rows, expected 1. REFUSING.', v_n;
  END IF;
END $$;

-- READ-BACK. EXPECT exactly one row: Xometry / XMTR / 1657573, with facts_visible and
-- filings_visible both greater than zero, which is the whole point of the
-- block. Durable only once this paste commits.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts      f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings          s WHERE s.cik = c.sec_cik) AS filings_visible,
       (SELECT count(*) FROM public.insider_transactions i WHERE i.cik = c.sec_cik) AS insider_visible
  FROM public.companies c
 WHERE c.id = '9843f36d-df20-4bc3-a177-ebe64c6c1b77'::uuid;

COMMIT;

-- ROLLBACK for block 09 only. See BLOCK 99A for the general per-row form,
-- which also refuses when a child row has appeared. Use 99A in preference
-- to this; this is the shorthand for a mint reversed immediately.
-- BEGIN;
-- DELETE FROM public.companies c
--  USING norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'mint_identity'
--    AND j.row_id = '9843f36d-df20-4bc3-a177-ebe64c6c1b77'::uuid AND c.id = j.row_id
--    AND j.before IS NULL
--    AND c.name    = (j.after->>'name')
--    AND c.ticker  = (j.after->>'ticker')
--    AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'mint_identity'
--    AND row_id = '9843f36d-df20-4bc3-a177-ebe64c6c1b77'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 10  cik 1937987  ->  MINT 'Falcon's Beyond Global'  (FBYD)   SHAPE N-A
--
--   SEC, quoted from https://data.sec.gov/submissions/CIK0001937987.json,
--   fetched with a real User-Agent and a 30s timeout (SEC 403s without one
--   and can hang silently):
--       "name": "Falcon's Beyond Global, Inc."
--       "tickers": ["FBYD"]   "exchanges": ["Nasdaq"]
--       "sicDescription": "Services-Miscellaneous Amusement & Recreation"
--       "formerNames": ["Falcons Beyond Global, Inc."]
--   company_tickers.json: cik_str 1937987 -> ticker "FBYD".
--
--   NO `companies` ROW EXISTS UNDER THIS NAME and no `aliases` row bridges
--   to one. This CIK's facts, filings and insider rows are reachable by CIK
--   the moment this row exists.
--
--   THE RECEIPT. financial_facts.company_id under cik 1937987 points at the
--   row named 'Beyond' (2fb24b14-195a-4cc2-a612-377066d2544a), the row that held this
--   CIK at ingest and was later stripped of both identifiers. THAT ROW IS
--   NOT TOUCHED BY THIS BLOCK and its mention history is left intact. It is
--   the evidence of how the CIK was detached; overwriting it destroys that.
--
--   The forms that canonicalize() to "Falcon's Beyond Global"
--   outnumber the bare "Falcon's Beyond" in the corpus. 'Bed Bath &
--   Beyond' (BBBY, cik 1130713) is a different company and is not
--   touched. The typographic-apostrophe form "Falcon\u2019s Beyond
--   Global" also occurs and will not ilike-match this row.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid   := '689dd809-894f-4972-ad46-55a648573c6e'::uuid;
  v_cik     bigint := 1937987;
  v_ticker  text   := 'FBYD';
  v_name    text   := 'Falcon''s Beyond Global';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_n       int;
BEGIN
  -- ALREADY APPLIED -> NO-OP, not an error. The id is PINNED IN THIS FILE,
  -- not generated, so a re-run finds the row this block minted rather than
  -- minting a second one under a fresh uuid.
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF FOUND THEN
    IF r.name = v_name AND r.ticker = v_ticker AND r.sec_cik = v_cik THEN
      RAISE NOTICE 'BLOCK 10: already applied (% / % / %). No-op.', v_name, v_ticker, v_cik;
      RETURN;
    END IF;
    RAISE EXCEPTION 'BLOCK 10: id % exists but holds name=% ticker=% cik=%. Not this block''s row. REFUSING.',
      v_id, r.name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_name_key UNIQUE (name). CAN RAISE 23505.
  -- Checked case-insensitively rather than exactly, because a case variant
  -- would pass the index and still be a READ-PATH collision:
  -- matchCompaniesByName uses ilike("name", n).
  SELECT count(*) INTO v_n FROM public.companies WHERE name ILIKE v_name;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 10: % row(s) already carry the name % (case-insensitive). If such a row carries no sec_cik then this CIK is a 0029-STYLE STAMP, NOT A MINT, and this block must be rewritten. REFUSING.', v_n, v_name;
  END IF;

  -- ENTERING companies_sec_cik_unique. CAN RAISE 23505. Re-checked here,
  -- not trusted from analysis time: the daily pipeline stamps CIKs
  -- (backend/edgar/cik_mapping.py) and can mint a holder at any hour.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 10: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort the statement. It is
  -- still fatal to correctness: resolveCompanyCik step 2 matches ticker
  -- FIRST (src/lib/sec-filings.ts) and a second holder misroutes the page.
  SELECT count(*) INTO v_n FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 10: ticker % already on % row(s). REFUSING.', v_ticker, v_n;
  END IF;

  -- *** THE JOURNAL INSERT COMES BEFORE THE WRITE. ALWAYS. ***
  -- `before` IS NULL AND THAT IS DELIBERATE: it is not a missing value, it
  -- is the statement that THE ROW DID NOT EXIST, which is also the reversal
  -- instruction. BLOCK 99 keys on exactly that.
  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'mint_identity',
          NULL,
          jsonb_build_object('name', v_name, 'ticker', v_ticker, 'sec_cik', v_cik),
          format('0041 block 10: mint %s carrying %s / cik %s; no companies row existed under this name (receipt row Beyond left untouched)', v_name, v_ticker, v_cik));

  INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count)
  VALUES (v_id, v_name, v_ticker, v_cik, 0);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'BLOCK 10: INSERT affected % rows, expected 1. REFUSING.', v_n;
  END IF;
END $$;

-- READ-BACK. EXPECT exactly one row: Falcon's Beyond Global / FBYD / 1937987, with facts_visible and
-- filings_visible both greater than zero, which is the whole point of the
-- block. Durable only once this paste commits.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts      f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings          s WHERE s.cik = c.sec_cik) AS filings_visible,
       (SELECT count(*) FROM public.insider_transactions i WHERE i.cik = c.sec_cik) AS insider_visible
  FROM public.companies c
 WHERE c.id = '689dd809-894f-4972-ad46-55a648573c6e'::uuid;

COMMIT;

-- ROLLBACK for block 10 only. See BLOCK 99A for the general per-row form,
-- which also refuses when a child row has appeared. Use 99A in preference
-- to this; this is the shorthand for a mint reversed immediately.
-- BEGIN;
-- DELETE FROM public.companies c
--  USING norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'mint_identity'
--    AND j.row_id = '689dd809-894f-4972-ad46-55a648573c6e'::uuid AND c.id = j.row_id
--    AND j.before IS NULL
--    AND c.name    = (j.after->>'name')
--    AND c.ticker  = (j.after->>'ticker')
--    AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'mint_identity'
--    AND row_id = '689dd809-894f-4972-ad46-55a648573c6e'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 11  cik 1957132  ->  MINT 'SharkNinja'  (SN)   SHAPE N-A
--
--   SEC, quoted from https://data.sec.gov/submissions/CIK0001957132.json,
--   fetched with a real User-Agent and a 30s timeout (SEC 403s without one
--   and can hang silently):
--       "name": "SharkNinja, Inc."
--       "tickers": ["SN"]   "exchanges": ["NYSE"]
--       "sicDescription": "Household Appliances"
--       "formerNames": ["SharkNinja Global SPV, Ltd."]
--   company_tickers.json: cik_str 1957132 -> ticker "SN".
--
--   NO `companies` ROW EXISTS UNDER THIS NAME and no `aliases` row bridges
--   to one. This CIK's facts, filings and insider rows are reachable by CIK
--   the moment this row exists.
--
--   THE RECEIPT. financial_facts.company_id under cik 1957132 points at the
--   row named 'Hark' (2283371f-1932-4ea6-8d2b-b9d0328b6911), the row that held this
--   CIK at ingest and was later stripped of both identifiers. THAT ROW IS
--   NOT TOUCHED BY THIS BLOCK and its mention history is left intact. It is
--   the evidence of how the CIK was detached; overwriting it destroys that.
--
--   'SharkNinja' is the modal surface form; 'SharkNinja, Inc.'
--   canonicalize()s to it. 'NinjaTrader' is a different company and is
--   not touched.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid   := '9d2125c4-75e0-47a0-b39a-61ff37da9def'::uuid;
  v_cik     bigint := 1957132;
  v_ticker  text   := 'SN';
  v_name    text   := 'SharkNinja';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_n       int;
BEGIN
  -- ALREADY APPLIED -> NO-OP, not an error. The id is PINNED IN THIS FILE,
  -- not generated, so a re-run finds the row this block minted rather than
  -- minting a second one under a fresh uuid.
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF FOUND THEN
    IF r.name = v_name AND r.ticker = v_ticker AND r.sec_cik = v_cik THEN
      RAISE NOTICE 'BLOCK 11: already applied (% / % / %). No-op.', v_name, v_ticker, v_cik;
      RETURN;
    END IF;
    RAISE EXCEPTION 'BLOCK 11: id % exists but holds name=% ticker=% cik=%. Not this block''s row. REFUSING.',
      v_id, r.name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_name_key UNIQUE (name). CAN RAISE 23505.
  -- Checked case-insensitively rather than exactly, because a case variant
  -- would pass the index and still be a READ-PATH collision:
  -- matchCompaniesByName uses ilike("name", n).
  SELECT count(*) INTO v_n FROM public.companies WHERE name ILIKE v_name;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 11: % row(s) already carry the name % (case-insensitive). If such a row carries no sec_cik then this CIK is a 0029-STYLE STAMP, NOT A MINT, and this block must be rewritten. REFUSING.', v_n, v_name;
  END IF;

  -- ENTERING companies_sec_cik_unique. CAN RAISE 23505. Re-checked here,
  -- not trusted from analysis time: the daily pipeline stamps CIKs
  -- (backend/edgar/cik_mapping.py) and can mint a holder at any hour.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 11: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort the statement. It is
  -- still fatal to correctness: resolveCompanyCik step 2 matches ticker
  -- FIRST (src/lib/sec-filings.ts) and a second holder misroutes the page.
  SELECT count(*) INTO v_n FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 11: ticker % already on % row(s). REFUSING.', v_ticker, v_n;
  END IF;

  -- *** THE JOURNAL INSERT COMES BEFORE THE WRITE. ALWAYS. ***
  -- `before` IS NULL AND THAT IS DELIBERATE: it is not a missing value, it
  -- is the statement that THE ROW DID NOT EXIST, which is also the reversal
  -- instruction. BLOCK 99 keys on exactly that.
  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'mint_identity',
          NULL,
          jsonb_build_object('name', v_name, 'ticker', v_ticker, 'sec_cik', v_cik),
          format('0041 block 11: mint %s carrying %s / cik %s; no companies row existed under this name (receipt row Hark left untouched)', v_name, v_ticker, v_cik));

  INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count)
  VALUES (v_id, v_name, v_ticker, v_cik, 0);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'BLOCK 11: INSERT affected % rows, expected 1. REFUSING.', v_n;
  END IF;
END $$;

-- READ-BACK. EXPECT exactly one row: SharkNinja / SN / 1957132, with facts_visible and
-- filings_visible both greater than zero, which is the whole point of the
-- block. Durable only once this paste commits.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts      f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings          s WHERE s.cik = c.sec_cik) AS filings_visible,
       (SELECT count(*) FROM public.insider_transactions i WHERE i.cik = c.sec_cik) AS insider_visible
  FROM public.companies c
 WHERE c.id = '9d2125c4-75e0-47a0-b39a-61ff37da9def'::uuid;

COMMIT;

-- ROLLBACK for block 11 only. See BLOCK 99A for the general per-row form,
-- which also refuses when a child row has appeared. Use 99A in preference
-- to this; this is the shorthand for a mint reversed immediately.
-- BEGIN;
-- DELETE FROM public.companies c
--  USING norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'mint_identity'
--    AND j.row_id = '9d2125c4-75e0-47a0-b39a-61ff37da9def'::uuid AND c.id = j.row_id
--    AND j.before IS NULL
--    AND c.name    = (j.after->>'name')
--    AND c.ticker  = (j.after->>'ticker')
--    AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'mint_identity'
--    AND row_id = '9d2125c4-75e0-47a0-b39a-61ff37da9def'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 12  cik 2025401  ->  MINT 'Fifth Era Acquisition Corp I'  (FERA)   SHAPE N-A
--
--   SEC, quoted from https://data.sec.gov/submissions/CIK0002025401.json,
--   fetched with a real User-Agent and a 30s timeout (SEC 403s without one
--   and can hang silently):
--       "name": "Fifth Era Acquisition Corp I"
--       "tickers": ["FERA"]   "exchanges": ["Nasdaq"]
--       "sicDescription": "Blank Checks"
--       "formerNames": []
--   company_tickers.json: cik_str 2025401 -> ticker "FERA".
--
--   NO `companies` ROW EXISTS UNDER THIS NAME and no `aliases` row bridges
--   to one. This CIK's facts, filings and insider rows are reachable by CIK
--   the moment this row exists.
--
--   THE RECEIPT. financial_facts.company_id under cik 2025401 points at the
--   row named 'Fera' (57d28c47-bcf6-475b-a40e-a298dc026e61), the row that held this
--   CIK at ingest and was later stripped of both identifiers. THAT ROW IS
--   NOT TOUCHED BY THIS BLOCK and its mention history is left intact. It is
--   the evidence of how the CIK was detached; overwriting it destroys that.
--
--   'Fifth Era Acquisition Corp I' is both the SEC string and the
--   modal corpus form, and canonicalize() leaves it unchanged. THIS IS
--   A BLANK-CHECK SPAC (SIC 6770) with a pending merger; the name will
--   change if the deal closes.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid   := 'ffa81146-a48a-4d44-9568-00db2da1cbcd'::uuid;
  v_cik     bigint := 2025401;
  v_ticker  text   := 'FERA';
  v_name    text   := 'Fifth Era Acquisition Corp I';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_n       int;
BEGIN
  -- ALREADY APPLIED -> NO-OP, not an error. The id is PINNED IN THIS FILE,
  -- not generated, so a re-run finds the row this block minted rather than
  -- minting a second one under a fresh uuid.
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF FOUND THEN
    IF r.name = v_name AND r.ticker = v_ticker AND r.sec_cik = v_cik THEN
      RAISE NOTICE 'BLOCK 12: already applied (% / % / %). No-op.', v_name, v_ticker, v_cik;
      RETURN;
    END IF;
    RAISE EXCEPTION 'BLOCK 12: id % exists but holds name=% ticker=% cik=%. Not this block''s row. REFUSING.',
      v_id, r.name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_name_key UNIQUE (name). CAN RAISE 23505.
  -- Checked case-insensitively rather than exactly, because a case variant
  -- would pass the index and still be a READ-PATH collision:
  -- matchCompaniesByName uses ilike("name", n).
  SELECT count(*) INTO v_n FROM public.companies WHERE name ILIKE v_name;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 12: % row(s) already carry the name % (case-insensitive). If such a row carries no sec_cik then this CIK is a 0029-STYLE STAMP, NOT A MINT, and this block must be rewritten. REFUSING.', v_n, v_name;
  END IF;

  -- ENTERING companies_sec_cik_unique. CAN RAISE 23505. Re-checked here,
  -- not trusted from analysis time: the daily pipeline stamps CIKs
  -- (backend/edgar/cik_mapping.py) and can mint a holder at any hour.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 12: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort the statement. It is
  -- still fatal to correctness: resolveCompanyCik step 2 matches ticker
  -- FIRST (src/lib/sec-filings.ts) and a second holder misroutes the page.
  SELECT count(*) INTO v_n FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 12: ticker % already on % row(s). REFUSING.', v_ticker, v_n;
  END IF;

  -- *** THE JOURNAL INSERT COMES BEFORE THE WRITE. ALWAYS. ***
  -- `before` IS NULL AND THAT IS DELIBERATE: it is not a missing value, it
  -- is the statement that THE ROW DID NOT EXIST, which is also the reversal
  -- instruction. BLOCK 99 keys on exactly that.
  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'mint_identity',
          NULL,
          jsonb_build_object('name', v_name, 'ticker', v_ticker, 'sec_cik', v_cik),
          format('0041 block 12: mint %s carrying %s / cik %s; no companies row existed under this name (receipt row Fera left untouched)', v_name, v_ticker, v_cik));

  INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count)
  VALUES (v_id, v_name, v_ticker, v_cik, 0);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'BLOCK 12: INSERT affected % rows, expected 1. REFUSING.', v_n;
  END IF;
END $$;

-- READ-BACK. EXPECT exactly one row: Fifth Era Acquisition Corp I / FERA / 2025401, with facts_visible and
-- filings_visible both greater than zero, which is the whole point of the
-- block. Durable only once this paste commits.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts      f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings          s WHERE s.cik = c.sec_cik) AS filings_visible,
       (SELECT count(*) FROM public.insider_transactions i WHERE i.cik = c.sec_cik) AS insider_visible
  FROM public.companies c
 WHERE c.id = 'ffa81146-a48a-4d44-9568-00db2da1cbcd'::uuid;

COMMIT;

-- ROLLBACK for block 12 only. See BLOCK 99A for the general per-row form,
-- which also refuses when a child row has appeared. Use 99A in preference
-- to this; this is the shorthand for a mint reversed immediately.
-- BEGIN;
-- DELETE FROM public.companies c
--  USING norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'mint_identity'
--    AND j.row_id = 'ffa81146-a48a-4d44-9568-00db2da1cbcd'::uuid AND c.id = j.row_id
--    AND j.before IS NULL
--    AND c.name    = (j.after->>'name')
--    AND c.ticker  = (j.after->>'ticker')
--    AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'mint_identity'
--    AND row_id = 'ffa81146-a48a-4d44-9568-00db2da1cbcd'::uuid;
-- COMMIT;


-- #####################################################################
-- ##  BATCH 2  --  SHAPE N-B. MINT BESIDE A REAL DIFFERENT COMPANY.
-- ##
-- ##  Same four checks pass as in BATCH 1, so the mint itself is no more
-- ##  dangerous. WHAT IS DIFFERENT IS WHAT HAPPENS NEXT: each of these
-- ##  eight lands next to an existing row whose name a later reader could
-- ##  mistake for the registrant, and on seven of the eight that
-- ##  neighbour is the very row that held the CIK at ingest. The standing
-- ##  risk is not this file, it is SOMEONE MERGING THE TWO AFTERWARDS.
-- ##
-- ##  Every block below therefore ASSERTS ITS NEIGHBOUR'S CURRENT STATE
-- ##  and refuses if the neighbour has acquired a ticker or a CIK since
-- ##  analysis, and names in its header exactly which row must not be
-- ##  merged into the new one.
-- ##
-- ##  EIGHT BLOCKS, 13 to 20. Safe to paste as one batch.
-- #####################################################################

-- ---------------------------------------------------------------------
-- BLOCK 13  cik 5981     ->  MINT 'American Vanguard'  (AVD)   SHAPE N-B
--
--   SEC, quoted from https://data.sec.gov/submissions/CIK0000005981.json,
--   fetched with a real User-Agent and a 30s timeout (SEC 403s without one
--   and can hang silently):
--       "name": "AMERICAN VANGUARD CORP"
--       "tickers": ["AVD"]   "exchanges": ["NYSE"]
--       "sicDescription": "Agricultural Chemicals"
--       "formerNames": []
--   company_tickers.json: cik_str 5981 -> ticker "AVD".
--
--   NO `companies` ROW EXISTS UNDER THIS NAME and no `aliases` row bridges
--   to one. This CIK's facts, filings and insider rows are reachable by CIK
--   the moment this row exists.
--
--   THE RECEIPT. financial_facts.company_id under cik 5981 points at the
--   row named 'Vanguard' (ed155fd1-cdba-47be-965f-99873e1a8ca2), the row that held this
--   CIK at ingest and was later stripped of both identifiers. THAT ROW IS
--   NOT TOUCHED BY THIS BLOCK and its mention history is left intact. It is
--   the evidence of how the CIK was detached; overwriting it destroys that.
--
--   'American Vanguard' is the modal surface form; 'American Vanguard
--   Corporation' and 'American Vanguard Corp' canonicalize() toward
--   it.
--
--   *** DO NOT MERGE. ***
--   The row named 'Vanguard' is THE VANGUARD GROUP, the asset manager,
--   and it is a DIFFERENT COMPANY. It is the row that held cik 5981 at
--   ingest. IT MUST NOT BE MERGED INTO THIS ONE.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid   := 'faf3b340-7628-4cef-8062-71f8e46077a0'::uuid;
  v_cik     bigint := 5981;
  v_ticker  text   := 'AVD';
  v_name    text   := 'American Vanguard';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_n       int;
  nb        public.companies%ROWTYPE;
BEGIN
  -- ALREADY APPLIED -> NO-OP, not an error. The id is PINNED IN THIS FILE,
  -- not generated, so a re-run finds the row this block minted rather than
  -- minting a second one under a fresh uuid.
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF FOUND THEN
    IF r.name = v_name AND r.ticker = v_ticker AND r.sec_cik = v_cik THEN
      RAISE NOTICE 'BLOCK 13: already applied (% / % / %). No-op.', v_name, v_ticker, v_cik;
      RETURN;
    END IF;
    RAISE EXCEPTION 'BLOCK 13: id % exists but holds name=% ticker=% cik=%. Not this block''s row. REFUSING.',
      v_id, r.name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_name_key UNIQUE (name). CAN RAISE 23505.
  -- Checked case-insensitively rather than exactly, because a case variant
  -- would pass the index and still be a READ-PATH collision:
  -- matchCompaniesByName uses ilike("name", n).
  SELECT count(*) INTO v_n FROM public.companies WHERE name ILIKE v_name;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 13: % row(s) already carry the name % (case-insensitive). If such a row carries no sec_cik then this CIK is a 0029-STYLE STAMP, NOT A MINT, and this block must be rewritten. REFUSING.', v_n, v_name;
  END IF;

  -- ENTERING companies_sec_cik_unique. CAN RAISE 23505. Re-checked here,
  -- not trusted from analysis time: the daily pipeline stamps CIKs
  -- (backend/edgar/cik_mapping.py) and can mint a holder at any hour.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 13: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort the statement. It is
  -- still fatal to correctness: resolveCompanyCik step 2 matches ticker
  -- FIRST (src/lib/sec-filings.ts) and a second holder misroutes the page.
  SELECT count(*) INTO v_n FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 13: ticker % already on % row(s). REFUSING.', v_ticker, v_n;
  END IF;

  -- NEIGHBOUR ASSERTION. 'Vanguard' must still be identifier-free.
  -- It is a DIFFERENT COMPANY and is not touched; if it has acquired a
  -- ticker or a CIK since analysis, the cluster has been edited by
  -- something else and a human must look before this row is minted.
  SELECT * INTO nb FROM public.companies WHERE id = 'ed155fd1-cdba-47be-965f-99873e1a8ca2'::uuid;
  IF FOUND AND (nb.ticker IS NOT NULL OR nb.sec_cik IS NOT NULL) THEN
    RAISE EXCEPTION 'BLOCK 13: neighbour Vanguard now carries ticker=% cik=%. REFUSING.', nb.ticker, nb.sec_cik;
  END IF;

  -- *** THE JOURNAL INSERT COMES BEFORE THE WRITE. ALWAYS. ***
  -- `before` IS NULL AND THAT IS DELIBERATE: it is not a missing value, it
  -- is the statement that THE ROW DID NOT EXIST, which is also the reversal
  -- instruction. BLOCK 99 keys on exactly that.
  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'mint_identity',
          NULL,
          jsonb_build_object('name', v_name, 'ticker', v_ticker, 'sec_cik', v_cik),
          format('0041 block 13: mint %s carrying %s / cik %s; no companies row existed under this name (receipt row Vanguard left untouched)', v_name, v_ticker, v_cik));

  INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count)
  VALUES (v_id, v_name, v_ticker, v_cik, 0);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'BLOCK 13: INSERT affected % rows, expected 1. REFUSING.', v_n;
  END IF;
END $$;

-- READ-BACK. EXPECT exactly one row: American Vanguard / AVD / 5981, with facts_visible and
-- filings_visible both greater than zero, which is the whole point of the
-- block. Durable only once this paste commits.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts      f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings          s WHERE s.cik = c.sec_cik) AS filings_visible,
       (SELECT count(*) FROM public.insider_transactions i WHERE i.cik = c.sec_cik) AS insider_visible
  FROM public.companies c
 WHERE c.id = 'faf3b340-7628-4cef-8062-71f8e46077a0'::uuid;

COMMIT;

-- ROLLBACK for block 13 only. See BLOCK 99A for the general per-row form,
-- which also refuses when a child row has appeared. Use 99A in preference
-- to this; this is the shorthand for a mint reversed immediately.
-- BEGIN;
-- DELETE FROM public.companies c
--  USING norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'mint_identity'
--    AND j.row_id = 'faf3b340-7628-4cef-8062-71f8e46077a0'::uuid AND c.id = j.row_id
--    AND j.before IS NULL
--    AND c.name    = (j.after->>'name')
--    AND c.ticker  = (j.after->>'ticker')
--    AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'mint_identity'
--    AND row_id = 'faf3b340-7628-4cef-8062-71f8e46077a0'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 14  cik 737875   ->  MINT 'First Keystone'  (FKYS)   SHAPE N-B
--
--   SEC, quoted from https://data.sec.gov/submissions/CIK0000737875.json,
--   fetched with a real User-Agent and a 30s timeout (SEC 403s without one
--   and can hang silently):
--       "name": "FIRST KEYSTONE CORP"
--       "tickers": ["FKYS"]   "exchanges": ["OTC"]
--       "sicDescription": "State Commercial Banks"
--       "formerNames": []
--   company_tickers.json: cik_str 737875 -> ticker "FKYS".
--
--   NO `companies` ROW EXISTS UNDER THIS NAME and no `aliases` row bridges
--   to one. This CIK's facts, filings and insider rows are reachable by CIK
--   the moment this row exists.
--
--   THE RECEIPT. financial_facts.company_id under cik 737875 points at the
--   row named 'Keystone' (34c342f8-1909-41d6-8861-634a051fedfe), the row that held this
--   CIK at ingest and was later stripped of both identifiers. THAT ROW IS
--   NOT TOUCHED BY THIS BLOCK and its mention history is left intact. It is
--   the evidence of how the CIK was detached; overwriting it destroys that.
--
--   'First Keystone' is the modal surface form; 'First Keystone
--   Corporation' canonicalize()s to it.
--
--   *** DO NOT MERGE. ***
--   The row named 'Keystone' is a bare token and is NOT proven to be
--   this registrant. It is left alone rather than renamed. NOTE the
--   exchange is OTC, not a national exchange.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid   := 'e8bd9992-cb2b-4360-8822-9a41e45f87ec'::uuid;
  v_cik     bigint := 737875;
  v_ticker  text   := 'FKYS';
  v_name    text   := 'First Keystone';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_n       int;
  nb        public.companies%ROWTYPE;
BEGIN
  -- ALREADY APPLIED -> NO-OP, not an error. The id is PINNED IN THIS FILE,
  -- not generated, so a re-run finds the row this block minted rather than
  -- minting a second one under a fresh uuid.
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF FOUND THEN
    IF r.name = v_name AND r.ticker = v_ticker AND r.sec_cik = v_cik THEN
      RAISE NOTICE 'BLOCK 14: already applied (% / % / %). No-op.', v_name, v_ticker, v_cik;
      RETURN;
    END IF;
    RAISE EXCEPTION 'BLOCK 14: id % exists but holds name=% ticker=% cik=%. Not this block''s row. REFUSING.',
      v_id, r.name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_name_key UNIQUE (name). CAN RAISE 23505.
  -- Checked case-insensitively rather than exactly, because a case variant
  -- would pass the index and still be a READ-PATH collision:
  -- matchCompaniesByName uses ilike("name", n).
  SELECT count(*) INTO v_n FROM public.companies WHERE name ILIKE v_name;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 14: % row(s) already carry the name % (case-insensitive). If such a row carries no sec_cik then this CIK is a 0029-STYLE STAMP, NOT A MINT, and this block must be rewritten. REFUSING.', v_n, v_name;
  END IF;

  -- ENTERING companies_sec_cik_unique. CAN RAISE 23505. Re-checked here,
  -- not trusted from analysis time: the daily pipeline stamps CIKs
  -- (backend/edgar/cik_mapping.py) and can mint a holder at any hour.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 14: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort the statement. It is
  -- still fatal to correctness: resolveCompanyCik step 2 matches ticker
  -- FIRST (src/lib/sec-filings.ts) and a second holder misroutes the page.
  SELECT count(*) INTO v_n FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 14: ticker % already on % row(s). REFUSING.', v_ticker, v_n;
  END IF;

  -- NEIGHBOUR ASSERTION. 'Keystone' must still be identifier-free.
  -- It is a DIFFERENT COMPANY and is not touched; if it has acquired a
  -- ticker or a CIK since analysis, the cluster has been edited by
  -- something else and a human must look before this row is minted.
  SELECT * INTO nb FROM public.companies WHERE id = '34c342f8-1909-41d6-8861-634a051fedfe'::uuid;
  IF FOUND AND (nb.ticker IS NOT NULL OR nb.sec_cik IS NOT NULL) THEN
    RAISE EXCEPTION 'BLOCK 14: neighbour Keystone now carries ticker=% cik=%. REFUSING.', nb.ticker, nb.sec_cik;
  END IF;

  -- *** THE JOURNAL INSERT COMES BEFORE THE WRITE. ALWAYS. ***
  -- `before` IS NULL AND THAT IS DELIBERATE: it is not a missing value, it
  -- is the statement that THE ROW DID NOT EXIST, which is also the reversal
  -- instruction. BLOCK 99 keys on exactly that.
  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'mint_identity',
          NULL,
          jsonb_build_object('name', v_name, 'ticker', v_ticker, 'sec_cik', v_cik),
          format('0041 block 14: mint %s carrying %s / cik %s; no companies row existed under this name (receipt row Keystone left untouched)', v_name, v_ticker, v_cik));

  INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count)
  VALUES (v_id, v_name, v_ticker, v_cik, 0);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'BLOCK 14: INSERT affected % rows, expected 1. REFUSING.', v_n;
  END IF;
END $$;

-- READ-BACK. EXPECT exactly one row: First Keystone / FKYS / 737875, with facts_visible and
-- filings_visible both greater than zero, which is the whole point of the
-- block. Durable only once this paste commits.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts      f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings          s WHERE s.cik = c.sec_cik) AS filings_visible,
       (SELECT count(*) FROM public.insider_transactions i WHERE i.cik = c.sec_cik) AS insider_visible
  FROM public.companies c
 WHERE c.id = 'e8bd9992-cb2b-4360-8822-9a41e45f87ec'::uuid;

COMMIT;

-- ROLLBACK for block 14 only. See BLOCK 99A for the general per-row form,
-- which also refuses when a child row has appeared. Use 99A in preference
-- to this; this is the shorthand for a mint reversed immediately.
-- BEGIN;
-- DELETE FROM public.companies c
--  USING norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'mint_identity'
--    AND j.row_id = 'e8bd9992-cb2b-4360-8822-9a41e45f87ec'::uuid AND c.id = j.row_id
--    AND j.before IS NULL
--    AND c.name    = (j.after->>'name')
--    AND c.ticker  = (j.after->>'ticker')
--    AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'mint_identity'
--    AND row_id = 'e8bd9992-cb2b-4360-8822-9a41e45f87ec'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 15  cik 1325702  ->  MINT 'Magnachip'  (MX)   SHAPE N-B
--
--   SEC, quoted from https://data.sec.gov/submissions/CIK0001325702.json,
--   fetched with a real User-Agent and a 30s timeout (SEC 403s without one
--   and can hang silently):
--       "name": "MAGNACHIP SEMICONDUCTOR Corp"
--       "tickers": ["MX"]   "exchanges": ["NYSE"]
--       "sicDescription": "Semiconductors & Related Devices"
--       "formerNames": ["MAGNACHIP SEMICONDUCTOR Corp", "MAGNACHIP SEMICONDUCTOR LLC"]
--   company_tickers.json: cik_str 1325702 -> ticker "MX".
--
--   NO `companies` ROW EXISTS UNDER THIS NAME and no `aliases` row bridges
--   to one. This CIK's facts, filings and insider rows are reachable by CIK
--   the moment this row exists.
--
--   THE RECEIPT. financial_facts.company_id under cik 1325702 points at the
--   row named 'Magna' (5c8bc39d-cc2d-43fc-92a0-df9ec847fb1d), the row that held this
--   CIK at ingest and was later stripped of both identifiers. THAT ROW IS
--   NOT TOUCHED BY THIS BLOCK and its mention history is left intact. It is
--   the evidence of how the CIK was detached; overwriting it destroys that.
--
--   'Magnachip' is the modal corpus form and outnumbers 'Magnachip
--   Semiconductor'. matchCompaniesByName uses ilike("name", n) with no
--   wildcards, so the row name must be the string the slug
--   reconstructs: /company/magnachip reaches 'Magnachip' and would NOT
--   reach 'Magnachip Semiconductor'. The longer SEC string is quoted
--   above and is not used as the row name for that reason.
--
--   *** DO NOT MERGE. ***
--   The row named 'Magna' is MAGNA INTERNATIONAL, the auto supplier, a
--   DIFFERENT COMPANY. It held cik 1325702 at ingest. IT MUST NOT BE
--   MERGED INTO THIS ONE.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid   := '79f9415e-4369-4125-9ab3-74a9a6ef8046'::uuid;
  v_cik     bigint := 1325702;
  v_ticker  text   := 'MX';
  v_name    text   := 'Magnachip';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_n       int;
  nb        public.companies%ROWTYPE;
BEGIN
  -- ALREADY APPLIED -> NO-OP, not an error. The id is PINNED IN THIS FILE,
  -- not generated, so a re-run finds the row this block minted rather than
  -- minting a second one under a fresh uuid.
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF FOUND THEN
    IF r.name = v_name AND r.ticker = v_ticker AND r.sec_cik = v_cik THEN
      RAISE NOTICE 'BLOCK 15: already applied (% / % / %). No-op.', v_name, v_ticker, v_cik;
      RETURN;
    END IF;
    RAISE EXCEPTION 'BLOCK 15: id % exists but holds name=% ticker=% cik=%. Not this block''s row. REFUSING.',
      v_id, r.name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_name_key UNIQUE (name). CAN RAISE 23505.
  -- Checked case-insensitively rather than exactly, because a case variant
  -- would pass the index and still be a READ-PATH collision:
  -- matchCompaniesByName uses ilike("name", n).
  SELECT count(*) INTO v_n FROM public.companies WHERE name ILIKE v_name;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 15: % row(s) already carry the name % (case-insensitive). If such a row carries no sec_cik then this CIK is a 0029-STYLE STAMP, NOT A MINT, and this block must be rewritten. REFUSING.', v_n, v_name;
  END IF;

  -- ENTERING companies_sec_cik_unique. CAN RAISE 23505. Re-checked here,
  -- not trusted from analysis time: the daily pipeline stamps CIKs
  -- (backend/edgar/cik_mapping.py) and can mint a holder at any hour.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 15: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort the statement. It is
  -- still fatal to correctness: resolveCompanyCik step 2 matches ticker
  -- FIRST (src/lib/sec-filings.ts) and a second holder misroutes the page.
  SELECT count(*) INTO v_n FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 15: ticker % already on % row(s). REFUSING.', v_ticker, v_n;
  END IF;

  -- NEIGHBOUR ASSERTION. 'Magna' must still be identifier-free.
  -- It is a DIFFERENT COMPANY and is not touched; if it has acquired a
  -- ticker or a CIK since analysis, the cluster has been edited by
  -- something else and a human must look before this row is minted.
  SELECT * INTO nb FROM public.companies WHERE id = '5c8bc39d-cc2d-43fc-92a0-df9ec847fb1d'::uuid;
  IF FOUND AND (nb.ticker IS NOT NULL OR nb.sec_cik IS NOT NULL) THEN
    RAISE EXCEPTION 'BLOCK 15: neighbour Magna now carries ticker=% cik=%. REFUSING.', nb.ticker, nb.sec_cik;
  END IF;

  -- *** THE JOURNAL INSERT COMES BEFORE THE WRITE. ALWAYS. ***
  -- `before` IS NULL AND THAT IS DELIBERATE: it is not a missing value, it
  -- is the statement that THE ROW DID NOT EXIST, which is also the reversal
  -- instruction. BLOCK 99 keys on exactly that.
  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'mint_identity',
          NULL,
          jsonb_build_object('name', v_name, 'ticker', v_ticker, 'sec_cik', v_cik),
          format('0041 block 15: mint %s carrying %s / cik %s; no companies row existed under this name (receipt row Magna left untouched)', v_name, v_ticker, v_cik));

  INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count)
  VALUES (v_id, v_name, v_ticker, v_cik, 0);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'BLOCK 15: INSERT affected % rows, expected 1. REFUSING.', v_n;
  END IF;
END $$;

-- READ-BACK. EXPECT exactly one row: Magnachip / MX / 1325702, with facts_visible and
-- filings_visible both greater than zero, which is the whole point of the
-- block. Durable only once this paste commits.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts      f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings          s WHERE s.cik = c.sec_cik) AS filings_visible,
       (SELECT count(*) FROM public.insider_transactions i WHERE i.cik = c.sec_cik) AS insider_visible
  FROM public.companies c
 WHERE c.id = '79f9415e-4369-4125-9ab3-74a9a6ef8046'::uuid;

COMMIT;

-- ROLLBACK for block 15 only. See BLOCK 99A for the general per-row form,
-- which also refuses when a child row has appeared. Use 99A in preference
-- to this; this is the shorthand for a mint reversed immediately.
-- BEGIN;
-- DELETE FROM public.companies c
--  USING norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'mint_identity'
--    AND j.row_id = '79f9415e-4369-4125-9ab3-74a9a6ef8046'::uuid AND c.id = j.row_id
--    AND j.before IS NULL
--    AND c.name    = (j.after->>'name')
--    AND c.ticker  = (j.after->>'ticker')
--    AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'mint_identity'
--    AND row_id = '79f9415e-4369-4125-9ab3-74a9a6ef8046'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 16  cik 1617553  ->  MINT 'ZipRecruiter'  (ZIP)   SHAPE N-B
--
--   SEC, quoted from https://data.sec.gov/submissions/CIK0001617553.json,
--   fetched with a real User-Agent and a 30s timeout (SEC 403s without one
--   and can hang silently):
--       "name": "ZIPRECRUITER, INC."
--       "tickers": ["ZIP"]   "exchanges": ["NYSE"]
--       "sicDescription": "Services-Computer Programming, Data Processing, Etc."
--       "formerNames": []
--   company_tickers.json: cik_str 1617553 -> ticker "ZIP".
--
--   NO `companies` ROW EXISTS UNDER THIS NAME and no `aliases` row bridges
--   to one. This CIK's facts, filings and insider rows are reachable by CIK
--   the moment this row exists.
--
--   THE RECEIPT. financial_facts.company_id under cik 1617553 points at the
--   row named 'Zip Co' (b5dd8d33-7025-4734-b8e8-3d662ec2178b), the row that held this
--   CIK at ingest and was later stripped of both identifiers. THAT ROW IS
--   NOT TOUCHED BY THIS BLOCK and its mention history is left intact. It is
--   the evidence of how the CIK was detached; overwriting it destroys that.
--
--   'ZipRecruiter' is the modal surface form; 'ZipRecruiter, Inc.'
--   canonicalize()s to it.
--
--   *** DO NOT MERGE. ***
--   THREE neighbouring rows share the token: 'Zip Co', 'Zip' and 'Zip
--   Co Ltd'. Zip Co is an AUSTRALIAN BUY-NOW-PAY-LATER LENDER and is a
--   DIFFERENT COMPANY from ZipRecruiter. 'Zip Co' held cik 1617553 at
--   ingest. NONE OF THE THREE MAY BE MERGED INTO THIS ONE.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid   := '005f408f-008c-4ff0-9f29-0dba41fd6ca1'::uuid;
  v_cik     bigint := 1617553;
  v_ticker  text   := 'ZIP';
  v_name    text   := 'ZipRecruiter';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_n       int;
  nb        public.companies%ROWTYPE;
BEGIN
  -- ALREADY APPLIED -> NO-OP, not an error. The id is PINNED IN THIS FILE,
  -- not generated, so a re-run finds the row this block minted rather than
  -- minting a second one under a fresh uuid.
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF FOUND THEN
    IF r.name = v_name AND r.ticker = v_ticker AND r.sec_cik = v_cik THEN
      RAISE NOTICE 'BLOCK 16: already applied (% / % / %). No-op.', v_name, v_ticker, v_cik;
      RETURN;
    END IF;
    RAISE EXCEPTION 'BLOCK 16: id % exists but holds name=% ticker=% cik=%. Not this block''s row. REFUSING.',
      v_id, r.name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_name_key UNIQUE (name). CAN RAISE 23505.
  -- Checked case-insensitively rather than exactly, because a case variant
  -- would pass the index and still be a READ-PATH collision:
  -- matchCompaniesByName uses ilike("name", n).
  SELECT count(*) INTO v_n FROM public.companies WHERE name ILIKE v_name;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 16: % row(s) already carry the name % (case-insensitive). If such a row carries no sec_cik then this CIK is a 0029-STYLE STAMP, NOT A MINT, and this block must be rewritten. REFUSING.', v_n, v_name;
  END IF;

  -- ENTERING companies_sec_cik_unique. CAN RAISE 23505. Re-checked here,
  -- not trusted from analysis time: the daily pipeline stamps CIKs
  -- (backend/edgar/cik_mapping.py) and can mint a holder at any hour.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 16: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort the statement. It is
  -- still fatal to correctness: resolveCompanyCik step 2 matches ticker
  -- FIRST (src/lib/sec-filings.ts) and a second holder misroutes the page.
  SELECT count(*) INTO v_n FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 16: ticker % already on % row(s). REFUSING.', v_ticker, v_n;
  END IF;

  -- NEIGHBOUR ASSERTION. 'Zip Co' must still be identifier-free.
  -- It is a DIFFERENT COMPANY and is not touched; if it has acquired a
  -- ticker or a CIK since analysis, the cluster has been edited by
  -- something else and a human must look before this row is minted.
  SELECT * INTO nb FROM public.companies WHERE id = 'b5dd8d33-7025-4734-b8e8-3d662ec2178b'::uuid;
  IF FOUND AND (nb.ticker IS NOT NULL OR nb.sec_cik IS NOT NULL) THEN
    RAISE EXCEPTION 'BLOCK 16: neighbour Zip Co now carries ticker=% cik=%. REFUSING.', nb.ticker, nb.sec_cik;
  END IF;

  -- *** THE JOURNAL INSERT COMES BEFORE THE WRITE. ALWAYS. ***
  -- `before` IS NULL AND THAT IS DELIBERATE: it is not a missing value, it
  -- is the statement that THE ROW DID NOT EXIST, which is also the reversal
  -- instruction. BLOCK 99 keys on exactly that.
  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'mint_identity',
          NULL,
          jsonb_build_object('name', v_name, 'ticker', v_ticker, 'sec_cik', v_cik),
          format('0041 block 16: mint %s carrying %s / cik %s; no companies row existed under this name (receipt row Zip Co left untouched)', v_name, v_ticker, v_cik));

  INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count)
  VALUES (v_id, v_name, v_ticker, v_cik, 0);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'BLOCK 16: INSERT affected % rows, expected 1. REFUSING.', v_n;
  END IF;
END $$;

-- READ-BACK. EXPECT exactly one row: ZipRecruiter / ZIP / 1617553, with facts_visible and
-- filings_visible both greater than zero, which is the whole point of the
-- block. Durable only once this paste commits.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts      f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings          s WHERE s.cik = c.sec_cik) AS filings_visible,
       (SELECT count(*) FROM public.insider_transactions i WHERE i.cik = c.sec_cik) AS insider_visible
  FROM public.companies c
 WHERE c.id = '005f408f-008c-4ff0-9f29-0dba41fd6ca1'::uuid;

COMMIT;

-- ROLLBACK for block 16 only. See BLOCK 99A for the general per-row form,
-- which also refuses when a child row has appeared. Use 99A in preference
-- to this; this is the shorthand for a mint reversed immediately.
-- BEGIN;
-- DELETE FROM public.companies c
--  USING norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'mint_identity'
--    AND j.row_id = '005f408f-008c-4ff0-9f29-0dba41fd6ca1'::uuid AND c.id = j.row_id
--    AND j.before IS NULL
--    AND c.name    = (j.after->>'name')
--    AND c.ticker  = (j.after->>'ticker')
--    AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'mint_identity'
--    AND row_id = '005f408f-008c-4ff0-9f29-0dba41fd6ca1'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 17  cik 1746466  ->  MINT 'Equillium'  (EQ)   SHAPE N-B
--
--   SEC, quoted from https://data.sec.gov/submissions/CIK0001746466.json,
--   fetched with a real User-Agent and a 30s timeout (SEC 403s without one
--   and can hang silently):
--       "name": "Equillium, Inc."
--       "tickers": ["EQ"]   "exchanges": ["Nasdaq"]
--       "sicDescription": "Pharmaceutical Preparations"
--       "formerNames": []
--   company_tickers.json: cik_str 1746466 -> ticker "EQ".
--
--   NO `companies` ROW EXISTS UNDER THIS NAME and no `aliases` row bridges
--   to one. This CIK's facts, filings and insider rows are reachable by CIK
--   the moment this row exists.
--
--   THE RECEIPT. financial_facts.company_id under cik 1746466 points at the
--   row named 'eQ Plc' (8397e46c-a385-4c07-8b3c-291d76a25dae), the row that held this
--   CIK at ingest and was later stripped of both identifiers. THAT ROW IS
--   NOT TOUCHED BY THIS BLOCK and its mention history is left intact. It is
--   the evidence of how the CIK was detached; overwriting it destroys that.
--
--   'Equillium' is the modal surface form; 'Equillium, Inc.'
--   canonicalize()s to it.
--
--   *** DO NOT MERGE. ***
--   The receipt row 'eQ Plc' is a FINNISH ASSET MANAGER and is a
--   DIFFERENT COMPANY. The two-letter ticker EQ also invites confusion
--   with the large existing EQT / Equinix / HealthEquity cluster; NONE
--   of those rows is this registrant and none is touched.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid   := 'c345df7d-4e7b-4214-a699-5a81ed364cfa'::uuid;
  v_cik     bigint := 1746466;
  v_ticker  text   := 'EQ';
  v_name    text   := 'Equillium';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_n       int;
  nb        public.companies%ROWTYPE;
BEGIN
  -- ALREADY APPLIED -> NO-OP, not an error. The id is PINNED IN THIS FILE,
  -- not generated, so a re-run finds the row this block minted rather than
  -- minting a second one under a fresh uuid.
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF FOUND THEN
    IF r.name = v_name AND r.ticker = v_ticker AND r.sec_cik = v_cik THEN
      RAISE NOTICE 'BLOCK 17: already applied (% / % / %). No-op.', v_name, v_ticker, v_cik;
      RETURN;
    END IF;
    RAISE EXCEPTION 'BLOCK 17: id % exists but holds name=% ticker=% cik=%. Not this block''s row. REFUSING.',
      v_id, r.name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_name_key UNIQUE (name). CAN RAISE 23505.
  -- Checked case-insensitively rather than exactly, because a case variant
  -- would pass the index and still be a READ-PATH collision:
  -- matchCompaniesByName uses ilike("name", n).
  SELECT count(*) INTO v_n FROM public.companies WHERE name ILIKE v_name;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 17: % row(s) already carry the name % (case-insensitive). If such a row carries no sec_cik then this CIK is a 0029-STYLE STAMP, NOT A MINT, and this block must be rewritten. REFUSING.', v_n, v_name;
  END IF;

  -- ENTERING companies_sec_cik_unique. CAN RAISE 23505. Re-checked here,
  -- not trusted from analysis time: the daily pipeline stamps CIKs
  -- (backend/edgar/cik_mapping.py) and can mint a holder at any hour.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 17: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort the statement. It is
  -- still fatal to correctness: resolveCompanyCik step 2 matches ticker
  -- FIRST (src/lib/sec-filings.ts) and a second holder misroutes the page.
  SELECT count(*) INTO v_n FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 17: ticker % already on % row(s). REFUSING.', v_ticker, v_n;
  END IF;

  -- NEIGHBOUR ASSERTION. 'eQ Plc' must still be identifier-free.
  -- It is a DIFFERENT COMPANY and is not touched; if it has acquired a
  -- ticker or a CIK since analysis, the cluster has been edited by
  -- something else and a human must look before this row is minted.
  SELECT * INTO nb FROM public.companies WHERE id = '8397e46c-a385-4c07-8b3c-291d76a25dae'::uuid;
  IF FOUND AND (nb.ticker IS NOT NULL OR nb.sec_cik IS NOT NULL) THEN
    RAISE EXCEPTION 'BLOCK 17: neighbour eQ Plc now carries ticker=% cik=%. REFUSING.', nb.ticker, nb.sec_cik;
  END IF;

  -- *** THE JOURNAL INSERT COMES BEFORE THE WRITE. ALWAYS. ***
  -- `before` IS NULL AND THAT IS DELIBERATE: it is not a missing value, it
  -- is the statement that THE ROW DID NOT EXIST, which is also the reversal
  -- instruction. BLOCK 99 keys on exactly that.
  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'mint_identity',
          NULL,
          jsonb_build_object('name', v_name, 'ticker', v_ticker, 'sec_cik', v_cik),
          format('0041 block 17: mint %s carrying %s / cik %s; no companies row existed under this name (receipt row eQ Plc left untouched)', v_name, v_ticker, v_cik));

  INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count)
  VALUES (v_id, v_name, v_ticker, v_cik, 0);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'BLOCK 17: INSERT affected % rows, expected 1. REFUSING.', v_n;
  END IF;
END $$;

-- READ-BACK. EXPECT exactly one row: Equillium / EQ / 1746466, with facts_visible and
-- filings_visible both greater than zero, which is the whole point of the
-- block. Durable only once this paste commits.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts      f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings          s WHERE s.cik = c.sec_cik) AS filings_visible,
       (SELECT count(*) FROM public.insider_transactions i WHERE i.cik = c.sec_cik) AS insider_visible
  FROM public.companies c
 WHERE c.id = 'c345df7d-4e7b-4214-a699-5a81ed364cfa'::uuid;

COMMIT;

-- ROLLBACK for block 17 only. See BLOCK 99A for the general per-row form,
-- which also refuses when a child row has appeared. Use 99A in preference
-- to this; this is the shorthand for a mint reversed immediately.
-- BEGIN;
-- DELETE FROM public.companies c
--  USING norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'mint_identity'
--    AND j.row_id = 'c345df7d-4e7b-4214-a699-5a81ed364cfa'::uuid AND c.id = j.row_id
--    AND j.before IS NULL
--    AND c.name    = (j.after->>'name')
--    AND c.ticker  = (j.after->>'ticker')
--    AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'mint_identity'
--    AND row_id = 'c345df7d-4e7b-4214-a699-5a81ed364cfa'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 18  cik 1824893  ->  MINT 'Surrozen'  (SRZN)   SHAPE N-B
--
--   SEC, quoted from https://data.sec.gov/submissions/CIK0001824893.json,
--   fetched with a real User-Agent and a 30s timeout (SEC 403s without one
--   and can hang silently):
--       "name": "Surrozen, Inc./DE"
--       "tickers": ["SRZN"]   "exchanges": ["Nasdaq"]
--       "sicDescription": "Biological Products, (No Diagnostic Substances)"
--       "formerNames": ["Consonance-HFW Acquisition Corp."]
--   company_tickers.json: cik_str 1824893 -> ticker "SRZN".
--
--   NO `companies` ROW EXISTS UNDER THIS NAME and no `aliases` row bridges
--   to one. This CIK's facts, filings and insider rows are reachable by CIK
--   the moment this row exists.
--
--   THE RECEIPT. financial_facts.company_id under cik 1824893 points at the
--   row named 'Roze' (5d189fa7-ff27-4bb3-b6ed-ef667cdbea57), the row that held this
--   CIK at ingest and was later stripped of both identifiers. THAT ROW IS
--   NOT TOUCHED BY THIS BLOCK and its mention history is left intact. It is
--   the evidence of how the CIK was detached; overwriting it destroys that.
--
--   'Surrozen' is the modal surface form. canonicalize('Surrozen,
--   Inc./DE') returns the string UNCHANGED, because the '/DE' blocks
--   the legal-suffix strip, so the SEC string is not usable as the row
--   name.
--
--   *** DO NOT MERGE. ***
--   THE SEC FORMER NAME IS 'Consonance-HFW Acquisition Corp.' AND A
--   ROW NAMED 'Consonance' EXISTS, carrying the DEAD SPAC TICKER CHFW
--   and no CIK. That row is this registrant's PREDECESSOR SHELL, not a
--   different company, so it is the one genuine merge candidate in
--   this file. IT IS STILL NOT MERGED HERE: a merge repoints aliases
--   and dependent rows and belongs to sql/proposals/0020. This block
--   only mints the successor.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid   := '0a9de60e-81df-4b05-ba61-64a66088b49c'::uuid;
  v_cik     bigint := 1824893;
  v_ticker  text   := 'SRZN';
  v_name    text   := 'Surrozen';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_n       int;
  nb        public.companies%ROWTYPE;
BEGIN
  -- ALREADY APPLIED -> NO-OP, not an error. The id is PINNED IN THIS FILE,
  -- not generated, so a re-run finds the row this block minted rather than
  -- minting a second one under a fresh uuid.
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF FOUND THEN
    IF r.name = v_name AND r.ticker = v_ticker AND r.sec_cik = v_cik THEN
      RAISE NOTICE 'BLOCK 18: already applied (% / % / %). No-op.', v_name, v_ticker, v_cik;
      RETURN;
    END IF;
    RAISE EXCEPTION 'BLOCK 18: id % exists but holds name=% ticker=% cik=%. Not this block''s row. REFUSING.',
      v_id, r.name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_name_key UNIQUE (name). CAN RAISE 23505.
  -- Checked case-insensitively rather than exactly, because a case variant
  -- would pass the index and still be a READ-PATH collision:
  -- matchCompaniesByName uses ilike("name", n).
  SELECT count(*) INTO v_n FROM public.companies WHERE name ILIKE v_name;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 18: % row(s) already carry the name % (case-insensitive). If such a row carries no sec_cik then this CIK is a 0029-STYLE STAMP, NOT A MINT, and this block must be rewritten. REFUSING.', v_n, v_name;
  END IF;

  -- ENTERING companies_sec_cik_unique. CAN RAISE 23505. Re-checked here,
  -- not trusted from analysis time: the daily pipeline stamps CIKs
  -- (backend/edgar/cik_mapping.py) and can mint a holder at any hour.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 18: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort the statement. It is
  -- still fatal to correctness: resolveCompanyCik step 2 matches ticker
  -- FIRST (src/lib/sec-filings.ts) and a second holder misroutes the page.
  SELECT count(*) INTO v_n FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 18: ticker % already on % row(s). REFUSING.', v_ticker, v_n;
  END IF;

  -- NEIGHBOUR ASSERTION. 'Roze' must still be identifier-free.
  -- It is a DIFFERENT COMPANY and is not touched; if it has acquired a
  -- ticker or a CIK since analysis, the cluster has been edited by
  -- something else and a human must look before this row is minted.
  SELECT * INTO nb FROM public.companies WHERE id = '5d189fa7-ff27-4bb3-b6ed-ef667cdbea57'::uuid;
  IF FOUND AND (nb.ticker IS NOT NULL OR nb.sec_cik IS NOT NULL) THEN
    RAISE EXCEPTION 'BLOCK 18: neighbour Roze now carries ticker=% cik=%. REFUSING.', nb.ticker, nb.sec_cik;
  END IF;

  -- NEIGHBOUR ASSERTION. 'Consonance' must still be identifier-free.
  -- It is a DIFFERENT COMPANY and is not touched; if it has acquired a
  -- ticker or a CIK since analysis, the cluster has been edited by
  -- something else and a human must look before this row is minted.
  SELECT * INTO nb FROM public.companies WHERE id = 'ee744038-d74f-4cba-a871-260f020ba456'::uuid;
  IF FOUND AND (nb.ticker IS NOT NULL OR nb.sec_cik IS NOT NULL) THEN
    RAISE EXCEPTION 'BLOCK 18: neighbour Consonance now carries ticker=% cik=%. REFUSING.', nb.ticker, nb.sec_cik;
  END IF;

  -- *** THE JOURNAL INSERT COMES BEFORE THE WRITE. ALWAYS. ***
  -- `before` IS NULL AND THAT IS DELIBERATE: it is not a missing value, it
  -- is the statement that THE ROW DID NOT EXIST, which is also the reversal
  -- instruction. BLOCK 99 keys on exactly that.
  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'mint_identity',
          NULL,
          jsonb_build_object('name', v_name, 'ticker', v_ticker, 'sec_cik', v_cik),
          format('0041 block 18: mint %s carrying %s / cik %s; no companies row existed under this name (receipt row Roze left untouched)', v_name, v_ticker, v_cik));

  INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count)
  VALUES (v_id, v_name, v_ticker, v_cik, 0);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'BLOCK 18: INSERT affected % rows, expected 1. REFUSING.', v_n;
  END IF;
END $$;

-- READ-BACK. EXPECT exactly one row: Surrozen / SRZN / 1824893, with facts_visible and
-- filings_visible both greater than zero, which is the whole point of the
-- block. Durable only once this paste commits.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts      f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings          s WHERE s.cik = c.sec_cik) AS filings_visible,
       (SELECT count(*) FROM public.insider_transactions i WHERE i.cik = c.sec_cik) AS insider_visible
  FROM public.companies c
 WHERE c.id = '0a9de60e-81df-4b05-ba61-64a66088b49c'::uuid;

COMMIT;

-- ROLLBACK for block 18 only. See BLOCK 99A for the general per-row form,
-- which also refuses when a child row has appeared. Use 99A in preference
-- to this; this is the shorthand for a mint reversed immediately.
-- BEGIN;
-- DELETE FROM public.companies c
--  USING norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'mint_identity'
--    AND j.row_id = '0a9de60e-81df-4b05-ba61-64a66088b49c'::uuid AND c.id = j.row_id
--    AND j.before IS NULL
--    AND c.name    = (j.after->>'name')
--    AND c.ticker  = (j.after->>'ticker')
--    AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'mint_identity'
--    AND row_id = '0a9de60e-81df-4b05-ba61-64a66088b49c'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 19  cik 1997350  ->  MINT 'Accelerant Holdings'  (ARX)   SHAPE N-B
--
--   SEC, quoted from https://data.sec.gov/submissions/CIK0001997350.json,
--   fetched with a real User-Agent and a 30s timeout (SEC 403s without one
--   and can hang silently):
--       "name": "Accelerant Holdings"
--       "tickers": ["ARX"]   "exchanges": ["NYSE"]
--       "sicDescription": "Insurance Agents, Brokers & Service"
--       "formerNames": []
--   company_tickers.json: cik_str 1997350 -> ticker "ARX".
--
--   NO `companies` ROW EXISTS UNDER THIS NAME and no `aliases` row bridges
--   to one. This CIK's facts, filings and insider rows are reachable by CIK
--   the moment this row exists.
--
--   THE RECEIPT. financial_facts.company_id under cik 1997350 points at the
--   row named 'Accel' (2eefcee3-a379-40eb-a7a5-dfe2bc680c5a), the row that held this
--   CIK at ingest and was later stripped of both identifiers. THAT ROW IS
--   NOT TOUCHED BY THIS BLOCK and its mention history is left intact. It is
--   the evidence of how the CIK was detached; overwriting it destroys that.
--
--   'Accelerant Holdings' is both the SEC string and the modal corpus
--   form. *** IT IS THE ONE NAME IN THIS FILE THAT canonicalize()
--   REWRITES: canonicalize('Accelerant Holdings') RETURNS
--   'Accelerant'. *** Called, not simulated, via npx tsx against
--   src/lib/company-intel.ts. The consequence, stated rather than
--   hidden: /company/accelerant-holdings resolves through the RAW form
--   and reaches this row; /company/accelerant resolves to the string
--   'Accelerant', which NO row carries, and so still reaches nothing.
--   Naming the row 'Accelerant' instead would cover both slugs and was
--   REJECTED, because inventing a shortened name to satisfy a resolver
--   is not the registrant's name. If the shorter name is wanted, that
--   is a human decision, not this file's.
--
--   *** DO NOT MERGE. ***
--   The neighbouring rows 'Accel' and 'Accel-KKR' are VENTURE AND
--   PRIVATE-EQUITY FIRMS and are DIFFERENT COMPANIES. 'Accel' held cik
--   1997350 at ingest. NEITHER MAY BE MERGED INTO THIS ONE.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid   := '52e4ea16-56ba-4ba3-8e1e-7f6b56db3ac7'::uuid;
  v_cik     bigint := 1997350;
  v_ticker  text   := 'ARX';
  v_name    text   := 'Accelerant Holdings';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_n       int;
  nb        public.companies%ROWTYPE;
BEGIN
  -- ALREADY APPLIED -> NO-OP, not an error. The id is PINNED IN THIS FILE,
  -- not generated, so a re-run finds the row this block minted rather than
  -- minting a second one under a fresh uuid.
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF FOUND THEN
    IF r.name = v_name AND r.ticker = v_ticker AND r.sec_cik = v_cik THEN
      RAISE NOTICE 'BLOCK 19: already applied (% / % / %). No-op.', v_name, v_ticker, v_cik;
      RETURN;
    END IF;
    RAISE EXCEPTION 'BLOCK 19: id % exists but holds name=% ticker=% cik=%. Not this block''s row. REFUSING.',
      v_id, r.name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_name_key UNIQUE (name). CAN RAISE 23505.
  -- Checked case-insensitively rather than exactly, because a case variant
  -- would pass the index and still be a READ-PATH collision:
  -- matchCompaniesByName uses ilike("name", n).
  SELECT count(*) INTO v_n FROM public.companies WHERE name ILIKE v_name;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 19: % row(s) already carry the name % (case-insensitive). If such a row carries no sec_cik then this CIK is a 0029-STYLE STAMP, NOT A MINT, and this block must be rewritten. REFUSING.', v_n, v_name;
  END IF;

  -- ENTERING companies_sec_cik_unique. CAN RAISE 23505. Re-checked here,
  -- not trusted from analysis time: the daily pipeline stamps CIKs
  -- (backend/edgar/cik_mapping.py) and can mint a holder at any hour.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 19: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort the statement. It is
  -- still fatal to correctness: resolveCompanyCik step 2 matches ticker
  -- FIRST (src/lib/sec-filings.ts) and a second holder misroutes the page.
  SELECT count(*) INTO v_n FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 19: ticker % already on % row(s). REFUSING.', v_ticker, v_n;
  END IF;

  -- NEIGHBOUR ASSERTION. 'Accel' must still be identifier-free.
  -- It is a DIFFERENT COMPANY and is not touched; if it has acquired a
  -- ticker or a CIK since analysis, the cluster has been edited by
  -- something else and a human must look before this row is minted.
  SELECT * INTO nb FROM public.companies WHERE id = '2eefcee3-a379-40eb-a7a5-dfe2bc680c5a'::uuid;
  IF FOUND AND (nb.ticker IS NOT NULL OR nb.sec_cik IS NOT NULL) THEN
    RAISE EXCEPTION 'BLOCK 19: neighbour Accel now carries ticker=% cik=%. REFUSING.', nb.ticker, nb.sec_cik;
  END IF;

  -- NEIGHBOUR ASSERTION. 'Accel-KKR' must still be identifier-free.
  -- It is a DIFFERENT COMPANY and is not touched; if it has acquired a
  -- ticker or a CIK since analysis, the cluster has been edited by
  -- something else and a human must look before this row is minted.
  SELECT * INTO nb FROM public.companies WHERE id = '0aa088fe-9a5d-4bf8-8fee-a6b3031423ae'::uuid;
  IF FOUND AND (nb.ticker IS NOT NULL OR nb.sec_cik IS NOT NULL) THEN
    RAISE EXCEPTION 'BLOCK 19: neighbour Accel-KKR now carries ticker=% cik=%. REFUSING.', nb.ticker, nb.sec_cik;
  END IF;

  -- *** THE JOURNAL INSERT COMES BEFORE THE WRITE. ALWAYS. ***
  -- `before` IS NULL AND THAT IS DELIBERATE: it is not a missing value, it
  -- is the statement that THE ROW DID NOT EXIST, which is also the reversal
  -- instruction. BLOCK 99 keys on exactly that.
  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'mint_identity',
          NULL,
          jsonb_build_object('name', v_name, 'ticker', v_ticker, 'sec_cik', v_cik),
          format('0041 block 19: mint %s carrying %s / cik %s; no companies row existed under this name (receipt row Accel left untouched)', v_name, v_ticker, v_cik));

  INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count)
  VALUES (v_id, v_name, v_ticker, v_cik, 0);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'BLOCK 19: INSERT affected % rows, expected 1. REFUSING.', v_n;
  END IF;
END $$;

-- READ-BACK. EXPECT exactly one row: Accelerant Holdings / ARX / 1997350, with facts_visible and
-- filings_visible both greater than zero, which is the whole point of the
-- block. Durable only once this paste commits.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts      f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings          s WHERE s.cik = c.sec_cik) AS filings_visible,
       (SELECT count(*) FROM public.insider_transactions i WHERE i.cik = c.sec_cik) AS insider_visible
  FROM public.companies c
 WHERE c.id = '52e4ea16-56ba-4ba3-8e1e-7f6b56db3ac7'::uuid;

COMMIT;

-- ROLLBACK for block 19 only. See BLOCK 99A for the general per-row form,
-- which also refuses when a child row has appeared. Use 99A in preference
-- to this; this is the shorthand for a mint reversed immediately.
-- BEGIN;
-- DELETE FROM public.companies c
--  USING norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'mint_identity'
--    AND j.row_id = '52e4ea16-56ba-4ba3-8e1e-7f6b56db3ac7'::uuid AND c.id = j.row_id
--    AND j.before IS NULL
--    AND c.name    = (j.after->>'name')
--    AND c.ticker  = (j.after->>'ticker')
--    AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'mint_identity'
--    AND row_id = '52e4ea16-56ba-4ba3-8e1e-7f6b56db3ac7'::uuid;
-- COMMIT;

-- ---------------------------------------------------------------------
-- BLOCK 20  cik 2048948  ->  MINT 'New Providence Acquisition Corp. III'  (NPAC)   SHAPE N-B
--
--   SEC, quoted from https://data.sec.gov/submissions/CIK0002048948.json,
--   fetched with a real User-Agent and a 30s timeout (SEC 403s without one
--   and can hang silently):
--       "name": "New Providence Acquisition Corp. III/Cayman"
--       "tickers": ["NPAC"]   "exchanges": ["Nasdaq"]
--       "sicDescription": "Blank Checks"
--       "formerNames": []
--   company_tickers.json: cik_str 2048948 -> ticker "NPAC".
--
--   NO `companies` ROW EXISTS UNDER THIS NAME and no `aliases` row bridges
--   to one. This CIK's facts, filings and insider rows are reachable by CIK
--   the moment this row exists.
--
--   THE RECEIPT. financial_facts.company_id under cik 2048948 points at the
--   row named 'Providence' (a9893af4-b0fb-4563-b9bf-9078dedcb131), the row that held this
--   CIK at ingest and was later stripped of both identifiers. THAT ROW IS
--   NOT TOUCHED BY THIS BLOCK and its mention history is left intact. It is
--   the evidence of how the CIK was detached; overwriting it destroys that.
--
--   'New Providence Acquisition Corp. III' is the modal corpus form
--   and canonicalize() leaves it unchanged. The SEC string carries a
--   '/Cayman' jurisdiction suffix that the corpus never uses; it is
--   quoted above and not used as the row name. THIS IS A BLANK-CHECK
--   SPAC (SIC 6770) with a pending merger; the name will change if it
--   closes.
--
--   *** DO NOT MERGE. ***
--   The neighbouring rows 'Providence' and 'Providence Equity
--   Partners' are NOT this registrant; Providence Equity Partners is a
--   private-equity firm. 'Providence' held cik 2048948 at ingest.
--   NEITHER MAY BE MERGED INTO THIS ONE.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid   := '5995f9dc-ad60-44e6-88ff-fd3918ee5fef'::uuid;
  v_cik     bigint := 2048948;
  v_ticker  text   := 'NPAC';
  v_name    text   := 'New Providence Acquisition Corp. III';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_n       int;
  nb        public.companies%ROWTYPE;
BEGIN
  -- ALREADY APPLIED -> NO-OP, not an error. The id is PINNED IN THIS FILE,
  -- not generated, so a re-run finds the row this block minted rather than
  -- minting a second one under a fresh uuid.
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF FOUND THEN
    IF r.name = v_name AND r.ticker = v_ticker AND r.sec_cik = v_cik THEN
      RAISE NOTICE 'BLOCK 20: already applied (% / % / %). No-op.', v_name, v_ticker, v_cik;
      RETURN;
    END IF;
    RAISE EXCEPTION 'BLOCK 20: id % exists but holds name=% ticker=% cik=%. Not this block''s row. REFUSING.',
      v_id, r.name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_name_key UNIQUE (name). CAN RAISE 23505.
  -- Checked case-insensitively rather than exactly, because a case variant
  -- would pass the index and still be a READ-PATH collision:
  -- matchCompaniesByName uses ilike("name", n).
  SELECT count(*) INTO v_n FROM public.companies WHERE name ILIKE v_name;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 20: % row(s) already carry the name % (case-insensitive). If such a row carries no sec_cik then this CIK is a 0029-STYLE STAMP, NOT A MINT, and this block must be rewritten. REFUSING.', v_n, v_name;
  END IF;

  -- ENTERING companies_sec_cik_unique. CAN RAISE 23505. Re-checked here,
  -- not trusted from analysis time: the daily pipeline stamps CIKs
  -- (backend/edgar/cik_mapping.py) and can mint a holder at any hour.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 20: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort the statement. It is
  -- still fatal to correctness: resolveCompanyCik step 2 matches ticker
  -- FIRST (src/lib/sec-filings.ts) and a second holder misroutes the page.
  SELECT count(*) INTO v_n FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 20: ticker % already on % row(s). REFUSING.', v_ticker, v_n;
  END IF;

  -- NEIGHBOUR ASSERTION. 'Providence' must still be identifier-free.
  -- It is a DIFFERENT COMPANY and is not touched; if it has acquired a
  -- ticker or a CIK since analysis, the cluster has been edited by
  -- something else and a human must look before this row is minted.
  SELECT * INTO nb FROM public.companies WHERE id = 'a9893af4-b0fb-4563-b9bf-9078dedcb131'::uuid;
  IF FOUND AND (nb.ticker IS NOT NULL OR nb.sec_cik IS NOT NULL) THEN
    RAISE EXCEPTION 'BLOCK 20: neighbour Providence now carries ticker=% cik=%. REFUSING.', nb.ticker, nb.sec_cik;
  END IF;

  -- NEIGHBOUR ASSERTION. 'Providence Equity Partners' must still be identifier-free.
  -- It is a DIFFERENT COMPANY and is not touched; if it has acquired a
  -- ticker or a CIK since analysis, the cluster has been edited by
  -- something else and a human must look before this row is minted.
  SELECT * INTO nb FROM public.companies WHERE id = '6ccfefb4-3226-4ebe-8901-3896b9d5a32c'::uuid;
  IF FOUND AND (nb.ticker IS NOT NULL OR nb.sec_cik IS NOT NULL) THEN
    RAISE EXCEPTION 'BLOCK 20: neighbour Providence Equity Partners now carries ticker=% cik=%. REFUSING.', nb.ticker, nb.sec_cik;
  END IF;

  -- *** THE JOURNAL INSERT COMES BEFORE THE WRITE. ALWAYS. ***
  -- `before` IS NULL AND THAT IS DELIBERATE: it is not a missing value, it
  -- is the statement that THE ROW DID NOT EXIST, which is also the reversal
  -- instruction. BLOCK 99 keys on exactly that.
  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'mint_identity',
          NULL,
          jsonb_build_object('name', v_name, 'ticker', v_ticker, 'sec_cik', v_cik),
          format('0041 block 20: mint %s carrying %s / cik %s; no companies row existed under this name (receipt row Providence left untouched)', v_name, v_ticker, v_cik));

  INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count)
  VALUES (v_id, v_name, v_ticker, v_cik, 0);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'BLOCK 20: INSERT affected % rows, expected 1. REFUSING.', v_n;
  END IF;
END $$;

-- READ-BACK. EXPECT exactly one row: New Providence Acquisition Corp. III / NPAC / 2048948, with facts_visible and
-- filings_visible both greater than zero, which is the whole point of the
-- block. Durable only once this paste commits.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts      f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings          s WHERE s.cik = c.sec_cik) AS filings_visible,
       (SELECT count(*) FROM public.insider_transactions i WHERE i.cik = c.sec_cik) AS insider_visible
  FROM public.companies c
 WHERE c.id = '5995f9dc-ad60-44e6-88ff-fd3918ee5fef'::uuid;

COMMIT;

-- ROLLBACK for block 20 only. See BLOCK 99A for the general per-row form,
-- which also refuses when a child row has appeared. Use 99A in preference
-- to this; this is the shorthand for a mint reversed immediately.
-- BEGIN;
-- DELETE FROM public.companies c
--  USING norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'mint_identity'
--    AND j.row_id = '5995f9dc-ad60-44e6-88ff-fd3918ee5fef'::uuid AND c.id = j.row_id
--    AND j.before IS NULL
--    AND c.name    = (j.after->>'name')
--    AND c.ticker  = (j.after->>'ticker')
--    AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'mint_identity'
--    AND row_id = '5995f9dc-ad60-44e6-88ff-fd3918ee5fef'::uuid;
-- COMMIT;


-- #####################################################################
-- ##  BATCH 3  --  SHAPE N-C. THE NAMED HAZARD. cik 46765.
-- ##
-- ##  *** PASTE BLOCK 21 ON ITS OWN. ***
-- ##
-- ##  THE DECISION: HANDLED, NOT QUARANTINED. The justification is in the
-- ##  block header. The block carries a FIVE-ROW ASSERTION over the HP
-- ##  cluster and refuses if any of it has moved.
-- #####################################################################

-- ---------------------------------------------------------------------
-- BLOCK 21  cik 46765    ->  MINT 'Helmerich & Payne'  (HP)   SHAPE N-C
--
--   SEC, quoted from https://data.sec.gov/submissions/CIK0000046765.json,
--   fetched with a real User-Agent and a 30s timeout (SEC 403s without one
--   and can hang silently):
--       "name": "Helmerich & Payne, Inc."
--       "tickers": ["HP"]   "exchanges": ["NYSE"]
--       "sicDescription": "Drilling Oil & Gas Wells"
--       "formerNames": ["HELMERICH & PAYNE INC"]
--   company_tickers.json: cik_str 46765 -> ticker "HP".
--
--   NO `companies` ROW EXISTS UNDER THIS NAME and no `aliases` row bridges
--   to one. This CIK's facts, filings and insider rows are reachable by CIK
--   the moment this row exists.
--
--   THE RECEIPT. financial_facts.company_id under cik 46765 points at the
--   row named 'HP Inc.' (60b1dfa6-435c-472c-a101-b039580ff76d), the row that held this
--   CIK at ingest and was later stripped of both identifiers. THAT ROW IS
--   NOT TOUCHED BY THIS BLOCK and its mention history is left intact. It is
--   the evidence of how the CIK was detached; overwriting it destroys that.
--
--   'Helmerich & Payne' is the modal corpus form once 'Helmerich &
--   Payne, Inc.' is canonicalize()d onto it. The corpus also carries
--   'Helmerich And Payne', which is a different string and will not
--   ilike-match this row.
--
--   =================================================================
--   THE 46765 DECISION: *** HANDLED, NOT QUARANTINED. *** WHY.
--   =================================================================
--
--   1. SEC IS UNAMBIGUOUS AND THERE IS NOTHING TO DISAMBIGUATE. cik
--   46765 is 'Helmerich & Payne, Inc.', SIC 1381 'Drilling Oil & Gas
--   Wells', NYSE, ticker HP. cik 47217 is HP Inc., the PC maker,
--   ticker HPQ. cik 1645590 is Hewlett Packard Enterprise, ticker HPE.
--   Three registrants, three CIKs, three tickers, all read from
--   company_tickers.json and the submissions API. The confusion is
--   entirely in the three-letter strings, not in the filings.
--
--   2. THE FIVE-ROW HP CLUSTER IS A RED HERRING FOR THIS OPERATION,
--   AND THAT IS EXACTLY WHAT MAKES IT DANGEROUS. Live, the cluster is
--   'HPE' (HPE / cik 1645590), 'HP Inc' (HPQ / cik 47217), 'HP Inc.'
--   (no identifiers), 'HPCL' (no identifiers) and 'HP, Inc.' (no
--   identifiers). NOT ONE OF THE FIVE IS NAMED FOR THE DRILLING
--   CONTRACTOR. So there is no receiver among them, no page whose
--   identity this block moves, and nothing here to overwrite.
--
--   3. THE HAZARD IS NOT WHAT THIS BLOCK DOES. IT IS WHAT AN AUTHOR
--   WHO TRUSTED THE RECEIPT WOULD HAVE DONE.
--   financial_facts.company_id under cik 46765 points at the row named
--   'HP Inc.', so the single most available wrong move in this whole
--   file is to read that as 'the company' and stamp 46765 onto it.
--   That would hand a drilling contractor's XBRL financials to a page
--   about the PC maker, whose own row already sits correctly beside it
--   at HPQ / cik 47217. This block touches none of the five and
--   asserts all five below.
--
--   4. WHAT COULD STILL GO WRONG IS HUMAN, AND THE MITIGATION IS
--   DOCUMENTARY. After this block the bare symbol HP sits on a row
--   named 'Helmerich & Payne' while three rows whose names begin 'HP'
--   carry no ticker at all. A later reader running a duplicate sweep,
--   or making a hand edit, could 'tidy' that by moving HP onto one of
--   them. NOTHING IN THE DATABASE WOULD REFUSE IT: THERE IS NO UNIQUE
--   INDEX ON ticker. The mitigation is this paragraph, plus the
--   five-row assertion below, which pins the cluster's exact current
--   state and refuses if any of it has moved.
--
--   5. THE AUTOMATED PATHS ARE SAFE, READ RATHER THAN ASSUMED.
--   backend/scripts/backfill_tickers.py selects rows with ticker IS
--   NULL and asks Finnhub about the row's NAME; asked about 'HP Inc.',
--   'HPCL' or 'HP, Inc.' it does not return HP.
--   backend/edgar/cik_mapping.py joins ticker to CIK and would map HP
--   to 46765, which is exactly what this row already holds, so it
--   agrees and changes nothing.
--
--   6. QUARANTINE WAS CONSIDERED AND REJECTED. Quarantine is the right
--   answer when the DATA is ambiguous, as it is for the row named
--   'BCG' in 0038. Here the data is not ambiguous at all; only the
--   neighbourhood is crowded. Quarantining would leave a large,
--   unambiguous, fully-filed fact set unreachable for no gain in
--   safety. The proportionate response is a louder block pasted on its
--   own, not no block.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid   := '1c18dcf2-bc9c-4864-8794-98032f52eb5b'::uuid;
  v_cik     bigint := 46765;
  v_ticker  text   := 'HP';
  v_name    text   := 'Helmerich & Payne';
  r         public.companies%ROWTYPE;
  v_holder  uuid;
  v_n       int;
  hp        public.companies%ROWTYPE;
  v_hp      int;
BEGIN
  -- ALREADY APPLIED -> NO-OP, not an error. The id is PINNED IN THIS FILE,
  -- not generated, so a re-run finds the row this block minted rather than
  -- minting a second one under a fresh uuid.
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF FOUND THEN
    IF r.name = v_name AND r.ticker = v_ticker AND r.sec_cik = v_cik THEN
      RAISE NOTICE 'BLOCK 21: already applied (% / % / %). No-op.', v_name, v_ticker, v_cik;
      RETURN;
    END IF;
    RAISE EXCEPTION 'BLOCK 21: id % exists but holds name=% ticker=% cik=%. Not this block''s row. REFUSING.',
      v_id, r.name, r.ticker, r.sec_cik;
  END IF;

  -- ENTERING companies_name_key UNIQUE (name). CAN RAISE 23505.
  -- Checked case-insensitively rather than exactly, because a case variant
  -- would pass the index and still be a READ-PATH collision:
  -- matchCompaniesByName uses ilike("name", n).
  SELECT count(*) INTO v_n FROM public.companies WHERE name ILIKE v_name;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 21: % row(s) already carry the name % (case-insensitive). If such a row carries no sec_cik then this CIK is a 0029-STYLE STAMP, NOT A MINT, and this block must be rewritten. REFUSING.', v_n, v_name;
  END IF;

  -- ENTERING companies_sec_cik_unique. CAN RAISE 23505. Re-checked here,
  -- not trusted from analysis time: the daily pipeline stamps CIKs
  -- (backend/edgar/cik_mapping.py) and can mint a holder at any hour.
  SELECT id INTO v_holder FROM public.companies WHERE sec_cik = v_cik;
  IF FOUND THEN
    RAISE EXCEPTION 'BLOCK 21: cik % already held by row %. Would raise 23505. REFUSING.', v_cik, v_holder;
  END IF;

  -- No unique index on ticker, so this cannot abort the statement. It is
  -- still fatal to correctness: resolveCompanyCik step 2 matches ticker
  -- FIRST (src/lib/sec-filings.ts) and a second holder misroutes the page.
  SELECT count(*) INTO v_n FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'BLOCK 21: ticker % already on % row(s). REFUSING.', v_ticker, v_n;
  END IF;

  -- ================= THE FIVE-ROW HP ASSERTION =================
  -- The two CIK-bearing HP rows must still hold exactly what they hold
  -- today. If either has moved, the cluster has been edited by something
  -- else and NOTHING here should be minted until a human has looked.
  -- IS DISTINCT FROM, not <>, so a NULLed column still trips the guard.
  SELECT * INTO hp FROM public.companies WHERE id = 'e3545c5d-13d3-4bb5-8fb2-1544aee7e756'::uuid;
  IF NOT FOUND
     OR hp.name    IS DISTINCT FROM 'HP Inc'
     OR hp.ticker  IS DISTINCT FROM 'HPQ'
     OR hp.sec_cik IS DISTINCT FROM 47217 THEN
    RAISE EXCEPTION 'BLOCK 21: the row expected to be HP Inc / HPQ / cik 47217 is now name=% ticker=% cik=%. The HP cluster has drifted. REFUSING.', hp.name, hp.ticker, hp.sec_cik;
  END IF;
  SELECT * INTO hp FROM public.companies WHERE id = '8543d2c6-5348-4eb5-abc4-b69e5b545dc2'::uuid;
  IF NOT FOUND
     OR hp.name    IS DISTINCT FROM 'HPE'
     OR hp.ticker  IS DISTINCT FROM 'HPE'
     OR hp.sec_cik IS DISTINCT FROM 1645590 THEN
    RAISE EXCEPTION 'BLOCK 21: the row expected to be HPE / HPE / cik 1645590 is now name=% ticker=% cik=%. The HP cluster has drifted. REFUSING.', hp.name, hp.ticker, hp.sec_cik;
  END IF;
  -- The three identifier-free HP rows must still be identifier-free.
  SELECT count(*) INTO v_hp FROM public.companies
   WHERE id IN ('60b1dfa6-435c-472c-a101-b039580ff76d'::uuid,   -- 'HP Inc.'
                '9b347b60-72ce-4da6-b180-0ba13f111ede'::uuid,   -- 'HPCL'
                '89e2631d-47a1-4e43-9a6c-84c1589004fb'::uuid)   -- 'HP, Inc.'
     AND (ticker IS NOT NULL OR sec_cik IS NOT NULL);
  IF v_hp > 0 THEN
    RAISE EXCEPTION 'BLOCK 21: % of the three identifier-free HP rows now carry an identifier. REFUSING.', v_hp;
  END IF;
  -- And nothing anywhere may already hold the bare symbol HP.
  SELECT count(*) INTO v_hp FROM public.companies WHERE upper(btrim(ticker)) = 'HP';
  IF v_hp > 0 THEN
    RAISE EXCEPTION 'BLOCK 21: % row(s) already hold ticker HP. REFUSING.', v_hp;
  END IF;

  -- *** THE JOURNAL INSERT COMES BEFORE THE WRITE. ALWAYS. ***
  -- `before` IS NULL AND THAT IS DELIBERATE: it is not a missing value, it
  -- is the statement that THE ROW DID NOT EXIST, which is also the reversal
  -- instruction. BLOCK 99 keys on exactly that.
  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'mint_identity',
          NULL,
          jsonb_build_object('name', v_name, 'ticker', v_ticker, 'sec_cik', v_cik),
          format('0041 block 21: mint %s carrying %s / cik %s; no companies row existed under this name (receipt row HP Inc. left untouched)', v_name, v_ticker, v_cik));

  INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count)
  VALUES (v_id, v_name, v_ticker, v_cik, 0);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'BLOCK 21: INSERT affected % rows, expected 1. REFUSING.', v_n;
  END IF;
END $$;

-- READ-BACK. EXPECT exactly one row: Helmerich & Payne / HP / 46765, with facts_visible and
-- filings_visible both greater than zero, which is the whole point of the
-- block. Durable only once this paste commits.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts      f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings          s WHERE s.cik = c.sec_cik) AS filings_visible,
       (SELECT count(*) FROM public.insider_transactions i WHERE i.cik = c.sec_cik) AS insider_visible
  FROM public.companies c
 WHERE c.id = '1c18dcf2-bc9c-4864-8794-98032f52eb5b'::uuid;

COMMIT;

-- ROLLBACK for block 21 only. See BLOCK 99A for the general per-row form,
-- which also refuses when a child row has appeared. Use 99A in preference
-- to this; this is the shorthand for a mint reversed immediately.
-- BEGIN;
-- DELETE FROM public.companies c
--  USING norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'mint_identity'
--    AND j.row_id = '1c18dcf2-bc9c-4864-8794-98032f52eb5b'::uuid AND c.id = j.row_id
--    AND j.before IS NULL
--    AND c.name    = (j.after->>'name')
--    AND c.ticker  = (j.after->>'ticker')
--    AND c.sec_cik = (j.after->>'sec_cik')::bigint;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'mint_identity'
--    AND row_id = '1c18dcf2-bc9c-4864-8794-98032f52eb5b'::uuid;
-- COMMIT;


-- =====================================================================
-- BLOCK 22  -- POST-CHECK. Read-only. *** PASTE IT ON ITS OWN, AFTER the
--               work paste has committed. *** Inside a work paste it reads
--               uncommitted rows and tells you nothing durable.
-- =====================================================================
BEGIN;

-- 22a. THE LOAD-BEARING INVARIANT. cik_without_ticker MUST STILL BE 0.
-- with_ticker, with_cik and total_rows each rise by exactly one per applied
-- block, because every block writes both identity columns on one new row.
-- If with_cik moved but total_rows did not, something UPDATED an existing row
-- and this file does not do that.
SELECT count(*) FILTER (WHERE ticker IS NOT NULL)                     AS with_ticker,
       count(*) FILTER (WHERE sec_cik IS NOT NULL)                    AS with_cik,
       count(*) FILTER (WHERE sec_cik IS NOT NULL AND ticker IS NULL) AS cik_without_ticker,
       count(*)                                                       AS total_rows
  FROM public.companies;

-- 22b. *** THE ONE THAT SAYS WHETHER IT WORKED. *** Every row this file
-- minted, and what it can now see. facts_visible AND filings_visible must both
-- be greater than zero on EVERY row. A row with zeros is a row whose CIK is
-- wrong, and it should be reversed with BLOCK 99A, not left.
SELECT c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.financial_facts      f WHERE f.cik = c.sec_cik) AS facts_visible,
       (SELECT count(*) FROM public.sec_filings          s WHERE s.cik = c.sec_cik) AS filings_visible,
       (SELECT count(*) FROM public.insider_transactions i WHERE i.cik = c.sec_cik) AS insider_visible,
       j.ran_at, j.note
  FROM public.companies c
  JOIN norm_v2.stamped_identity j
    ON j.row_id = c.id AND j.table_name = 'public.companies' AND j.op = 'mint_identity'
 ORDER BY j.id;

-- 22c. 0029'S AND 0038'S JOURNALS MUST BE UNTOUCHED. EXPECT the
-- stamp_identity and clear_ticker counts to be exactly what BLOCK 00c
-- reported. If either moved, something used the wrong op.
SELECT op, count(*) AS rows FROM norm_v2.stamped_identity GROUP BY op ORDER BY op;

-- 22d. Every journalled mint must have `before` IS NULL. A mint_identity row
-- with a non-null `before` would make BLOCK 99 skip it and the row would be
-- unreversible. EXPECT ZERO ROWS.
SELECT id, row_id, note FROM norm_v2.stamped_identity
 WHERE op = 'mint_identity' AND before IS NOT NULL;

-- 22e. NO DUPLICATE CIK HOLDER ANYWHERE. companies_sec_cik_unique enforces
-- this, so a non-empty result means the index is gone. EXPECT ZERO ROWS.
SELECT sec_cik, count(*) FROM public.companies
 WHERE sec_cik IS NOT NULL GROUP BY sec_cik HAVING count(*) > 1;

-- 22f. NO DUPLICATE TICKER HOLDER ANYWHERE. There is NO unique index behind
-- `ticker`, so this query is the only thing in the system that would ever
-- catch one.
--
-- IT DOES NOT RETURN ZERO ROWS TODAY AND THAT IS NOT THIS FILE'S DOING.
-- sql/proposals/0038 deliberately HOLDS a set of duplicate tickers rather than
-- clearing them, and its own BLOCK 22e names that set. Expect exactly what
-- 0038 leaves behind for the blocks of 0038 that were applied, AND NOTHING
-- ELSE. *** ANY GROUP HERE CARRYING ONE OF THIS FILE'S TWENTY TICKERS IS A
-- GENUINE FAILURE OF THIS FILE *** and the block that minted it should be
-- reversed with BLOCK 99A. Those twenty are:
--   AVD HP RNST FKYS CLH ORLY MAC RSG COSO MX
--   ARDX ZIP XMTR EQ SRZN FBYD SN ARX FERA NPAC
-- None of the twenty was held by any row at analysis time.
SELECT upper(btrim(ticker)) AS t, count(*) AS holders,
       string_agg(name || ' [cik ' || coalesce(sec_cik::text, 'null') || ']', ' | '
                  ORDER BY mention_count DESC NULLS LAST) AS rows
  FROM public.companies
 WHERE ticker IS NOT NULL
 GROUP BY 1 HAVING count(*) > 1
 ORDER BY 1;

-- 22g. THE TWENTY RECEIPT ROWS MUST BE EXACTLY AS THEY WERE: identifier-free,
-- mention counts intact. This file never writes them; this is the proof.
-- EXPECT twenty rows, every ticker and sec_cik NULL.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count
  FROM public.companies c
 WHERE c.id IN (
   'ed155fd1-cdba-47be-965f-99873e1a8ca2'::uuid,  -- Vanguard        (5981)
   '60b1dfa6-435c-472c-a101-b039580ff76d'::uuid,  -- HP Inc.         (46765)
   'ffaebc39-65f4-4ef5-85de-3c8257dd2cfa'::uuid,  -- NASA            (715072)
   '34c342f8-1909-41d6-8861-634a051fedfe'::uuid,  -- Keystone        (737875)
   'e3627810-14a1-4899-9b23-675d53d9e667'::uuid,  -- Arbor           (822818)
   'd57a75fc-319a-44da-81f2-788e495450c4'::uuid,  -- Motive          (898173)
   '32750385-e801-4c93-88df-e98916dd7508'::uuid,  -- Acer            (912242)
   '4c737a98-7098-44d4-8e81-702648c9b630'::uuid,  -- LIC             (1060391)
   'a285fcbc-abca-4b2b-8030-1a252dac4837'::uuid,  -- Also            (1297107)
   '5c8bc39d-cc2d-43fc-92a0-df9ec847fb1d'::uuid,  -- Magna           (1325702)
   '01a34460-268f-4547-a0bd-f3143f54b99d'::uuid,  -- Ely             (1437402)
   'b5dd8d33-7025-4734-b8e8-3d662ec2178b'::uuid,  -- Zip Co          (1617553)
   '2feb8a57-380a-4b7f-b8cf-3f736ea14c39'::uuid,  -- METR            (1657573)
   '8397e46c-a385-4c07-8b3c-291d76a25dae'::uuid,  -- eQ Plc          (1746466)
   '5d189fa7-ff27-4bb3-b6ed-ef667cdbea57'::uuid,  -- Roze            (1824893)
   '2fb24b14-195a-4cc2-a612-377066d2544a'::uuid,  -- Beyond          (1937987)
   '2283371f-1932-4ea6-8d2b-b9d0328b6911'::uuid,  -- Hark            (1957132)
   '2eefcee3-a379-40eb-a7a5-dfe2bc680c5a'::uuid,  -- Accel           (1997350)
   '57d28c47-bcf6-475b-a40e-a298dc026e61'::uuid,  -- Fera            (2025401)
   'a9893af4-b0fb-4563-b9bf-9078dedcb131'::uuid   -- Providence      (2048948)
 )
 ORDER BY c.name;

-- 22h. THE HP CLUSTER, AFTER. EXPECT six rows: the two CIK-bearing ones
-- unchanged (HP Inc / HPQ / 47217 and HPE / HPE / 1645590), the three
-- identifier-free ones still identifier-free, and ONE new row,
-- 'Helmerich & Payne' / HP / 46765, which is the only row in the cluster whose
-- name is the drilling contractor's.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count
  FROM public.companies c
 WHERE c.name ILIKE 'HP%' OR c.name ILIKE 'Helmerich%'
 ORDER BY c.mention_count DESC NULLS LAST;

COMMIT;


-- =====================================================================
-- BLOCK 99A  -- *** PER-ROW ROLLBACK. TAKES ONE row_id. ***
--
-- THIS IS THE BLOCK 0029 DID NOT HAVE. 0029's BLOCK 99 was an ALL-ROWS SWEEP
-- with no way to name a single row, so reversing ONE of its twenty required
-- hand-writing a scoped variant at the console. That is exactly the moment a
-- typo costs a row. Here the scope is ONE VARIABLE ON THE FIRST LINE.
--
-- EDIT `v_row_id` AND NOTHING ELSE. Everything below it is pinned to the
-- journal, so a row that something else has written since is REFUSED rather
-- than clobbered, and a row that has acquired a child row is REFUSED rather
-- than deleted out from under it.
--
-- WHY A MINT'S REVERSAL IS A DELETE AND WHY IT NEEDS A DEPENDENT CHECK.
-- 0029 and 0038 reverse by restoring columns onto a row that existed before
-- and still exists after; nothing can be pointing at a row that never went
-- away. THIS FILE CREATES A ROW, so its reversal REMOVES one, and between the
-- mint and the reversal the daily pipeline may have attached an `aliases` row,
-- an article link, a follow or a watchlist entry to it. Deleting under those
-- either cascades silently or raises a foreign-key error halfway through. The
-- loop below reads pg_constraint for every child table of `companies` and
-- counts live references BEFORE deleting anything, so the refusal is precise
-- and names the table. BLOCK 00h prints the same list read-only.
-- =====================================================================
-- BEGIN;
--
-- DO $$
-- DECLARE
--   v_row_id  uuid := '00000000-0000-0000-0000-000000000000'::uuid;  -- <<< EDIT THIS
--   j         norm_v2.stamped_identity%ROWTYPE;
--   c         public.companies%ROWTYPE;
--   fk        record;
--   v_refs    bigint;
--   v_total   bigint := 0;
-- BEGIN
--   SELECT * INTO j FROM norm_v2.stamped_identity
--    WHERE table_name = 'public.companies' AND op = 'mint_identity' AND row_id = v_row_id;
--   IF NOT FOUND THEN
--     RAISE EXCEPTION '99A: no mint_identity journal row for %. Nothing to reverse. REFUSING.', v_row_id;
--   END IF;
--   IF j.before IS NOT NULL THEN
--     RAISE EXCEPTION '99A: journal row % has a non-null before. That is not a mint. REFUSING.', j.id;
--   END IF;
--
--   SELECT * INTO c FROM public.companies WHERE id = v_row_id FOR UPDATE;
--   IF NOT FOUND THEN
--     RAISE NOTICE '99A: companies row % is already gone. Deleting the journal row only.', v_row_id;
--   ELSE
--     -- Pinned to the journalled after-state on all three columns.
--     IF c.name    IS DISTINCT FROM (j.after->>'name')
--     OR c.ticker  IS DISTINCT FROM (j.after->>'ticker')
--     OR c.sec_cik IS DISTINCT FROM (j.after->>'sec_cik')::bigint THEN
--       RAISE EXCEPTION '99A: row % now holds name=% ticker=% cik=%, not the minted state %. Something else wrote it. REFUSING.',
--         v_row_id, c.name, c.ticker, c.sec_cik, j.after;
--     END IF;
--
--     -- EVERY child table of companies, read from the catalogue rather than
--     -- listed by hand, so a table added after this file was written is still
--     -- counted. Any live reference REFUSES the delete.
--     FOR fk IN
--       SELECT con.conrelid::regclass AS child,
--              att.attname            AS col
--         FROM pg_constraint con
--         JOIN unnest(con.conkey)  WITH ORDINALITY AS k(attnum, ord) ON true
--         JOIN unnest(con.confkey) WITH ORDINALITY AS f(attnum, ord) ON f.ord = k.ord
--         JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
--         JOIN pg_attribute ref ON ref.attrelid = con.confrelid AND ref.attnum = f.attnum
--        WHERE con.contype = 'f'
--          AND con.confrelid = 'public.companies'::regclass
--          AND ref.attname = 'id'
--     LOOP
--       EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', fk.child, fk.col)
--         INTO v_refs USING v_row_id;
--       IF v_refs > 0 THEN
--         RAISE NOTICE '99A: % rows in %.% still reference this company.', v_refs, fk.child, fk.col;
--         v_total := v_total + v_refs;
--       END IF;
--     END LOOP;
--     IF v_total > 0 THEN
--       RAISE EXCEPTION '99A: % dependent row(s) reference %. Something has attached to this company since it was minted. Reversing would orphan or cascade them. REFUSING.', v_total, v_row_id;
--     END IF;
--
--     DELETE FROM public.companies WHERE id = v_row_id;
--   END IF;
--
--   DELETE FROM norm_v2.stamped_identity
--    WHERE table_name = 'public.companies' AND op = 'mint_identity' AND row_id = v_row_id;
--
--   RAISE NOTICE '99A: reversed mint of % (%).', j.after->>'name', v_row_id;
-- END $$;
--
-- COMMIT;


-- =====================================================================
-- BLOCK 99B  -- FULL ROLLBACK. Reverses every mint this file applied.
--
-- Scoped by op = 'mint_identity', so it CANNOT touch 0029's stamp_identity
-- rows or 0038's clear_ticker rows, and neither of their BLOCK 99s can touch
-- these. That separation is the whole point of the op decision in BLOCK 01.
--
-- *** PREFER 99A. *** Run 99A once per row_id, reading each notice. 99B has no
-- per-table dependent check; it relies on the read-only survey below and on
-- the database's own foreign keys to refuse. If any child row exists, the
-- DELETE raises and the whole paste rolls back, which is safe but tells you
-- less than 99A does.
-- =====================================================================
-- BEGIN;
--
-- -- READ THIS FIRST, BEFORE ANYTHING IS DELETED. `aliases` is the child the
-- -- pipeline attaches soonest: entity_resolver.py writes an alias row whose
-- -- canonical_id is the company the moment a surface form resolves to it. Any
-- -- row listed here must be handled with BLOCK 99A, which checks EVERY child
-- -- table from the catalogue rather than this one by hand. EXPECT ZERO ROWS.
-- SELECT j.row_id, c.name, a.surface_form, a.mention_count
--   FROM norm_v2.stamped_identity j
--   JOIN public.companies c ON c.id = j.row_id
--   JOIN public.aliases    a ON a.canonical_id = c.id
--  WHERE j.table_name = 'public.companies' AND j.op = 'mint_identity';
--
-- -- And any row something else has written since the mint. EXPECT ZERO ROWS.
-- SELECT j.row_id, c.name, c.ticker, c.sec_cik, j.after
--   FROM norm_v2.stamped_identity j JOIN public.companies c ON c.id = j.row_id
--  WHERE j.table_name = 'public.companies' AND j.op = 'mint_identity'
--    AND (c.name    IS DISTINCT FROM (j.after->>'name')
--      OR c.ticker  IS DISTINCT FROM (j.after->>'ticker')
--      OR c.sec_cik IS DISTINCT FROM (j.after->>'sec_cik')::bigint);
--
-- DELETE FROM public.companies c
--  USING norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies'
--    AND j.op = 'mint_identity'
--    AND j.before IS NULL
--    AND c.id = j.row_id
--    AND c.name    = (j.after->>'name')
--    AND c.ticker  = (j.after->>'ticker')
--    AND c.sec_cik = (j.after->>'sec_cik')::bigint;
--
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'mint_identity';
--
-- COMMIT;


-- =====================================================================
-- FOUR STORES: WHAT AGREES AND WHAT DOES NOT, AFTER THESE BLOCKS
--
-- Identity lives in four places. Each block writes ONE of them, on a row that
-- did not exist before.
--
-- 1. companies.sec_cik            WRITTEN, on a NEW row. Now names the
--                                 registrant SEC names.
-- 2. financial_facts.cik          UNCHANGED and now AGREES. It always held the
--                                 right CIK; nothing claimed it. The read path
--                                 joins on exactly this, so the page fills.
-- 3. sec_filings.cik              UNCHANGED and now AGREES, same reason.
--                                 sec_filings.company_id is NULL on EVERY row
--                                 under these twenty CIKs, measured, not
--                                 assumed. It DISAGREES silently, and it did
--                                 before too. It is not on the read path while
--                                 a CIK resolves (sec-filings.ts uses
--                                 company_id only as the cik-null fallback),
--                                 so it does not block the fix. It is still
--                                 the writer recording, every run, that it
--                                 cannot resolve these filings.
-- 4. insider_transactions.cik     UNCHANGED and now AGREES. Note the column is
--                                 `cik`, NOT `issuer_cik`. Its company_id is
--                                 NULL on every row under these CIKs, same
--                                 status as sec_filings.
--
-- THE ONE THAT OPENLY DISAGREES AFTER THESE BLOCKS is
-- financial_facts.company_id. On ALL TWENTY it points at the RECEIPT ROW, the
-- row that held the CIK at ingest: 'Vanguard' holds American Vanguard's facts,
-- 'HP Inc.' holds Helmerich & Payne's, 'Magna' holds Magnachip's. It is a
-- RECEIPT of who owned the CIK at ingest, which is how the detachment was
-- traced at all, so OVERWRITING IT DESTROYS THE EVIDENCE. It is deliberately
-- not touched. Repointing it is a separate decision and belongs with the 0020
-- merge, which already owns the question of what to do with dependent rows.
--
-- WHAT THIS FILE DOES NOT FIX, STATED PLAINLY:
--
--   THE ARTICLES DO NOT FOLLOW. Every one of the twenty registrants already
--   has coverage in the corpus under its own name, carried on
--   `articles.primary_company`, and `articles.companies` is an EMPTY ARRAY on
--   the rows sampled. Minting the company row is what makes that coverage
--   ATTACHABLE, but nothing in this file attaches it. The backfill that would
--   is a separate change and is NOT written here. Until then the new pages
--   show SEC financials and filings with no news beside them, and their
--   mention_count starts at 0 and only climbs as new articles arrive.
--
--   THE RECEIPT ROWS KEEP THE COVERAGE THEY WRONGLY HOLD. 'Vanguard' keeps its
--   mentions, 'HP Inc.' keeps its, 'Zip Co' keeps its. Several of those rows
--   are real, different companies and their mentions are genuinely theirs;
--   others are fragments. Sorting that out is entity resolution, not identity
--   re-homing.
--
--   NO ALIAS IS WRITTEN. Each of the twenty receipt rows owns exactly one
--   `aliases` row whose canonical_id is ITSELF, and the registrant names have
--   NO alias at all. An alias bridging, say, 'Helmerich & Payne, Inc.' to the
--   new row would widen the reach of resolveCompanyCik step 4. It is not
--   written here because an alias INSERT is a different operation with a
--   different journal and a different reversal.
--
--   THE TYPOGRAPHIC APOSTROPHE IS NOT HANDLED. The corpus carries the
--   O'Reilly and Falcon's names BOTH with the ASCII apostrophe U+0027 and with
--   the right single quotation mark U+2019. Those are different strings to
--   Postgres and ilike does not fold them, so one row can only carry one of
--   the two. The ASCII form is the one minted here, because it is the more
--   common of the two in the corpus.
-- =====================================================================


-- =====================================================================
-- WILL THE PIPELINE UNDO THIS? NO, AND IT IS THE PIPELINE THAT MAKES IT
-- STICK. READ BEFORE APPLYING. Every path below was read on origin/main.
--
-- backend/scripts/backfill_tickers.py selects on `.is_("ticker", "null")` and
-- a mention_count gate. EVERY ROW THIS FILE MINTS CARRIES A TICKER, so all
-- twenty are INVISIBLE to it. This is the opposite of 0038's exposure, whose
-- cleared rows land exactly in that predicate.
--
-- backend/edgar/cik_mapping.py::_update_companies_sec_cik writes sec_cik ONLY,
-- never ticker, JOINS ON TICKER, and does `if not ticker: continue`. That join
-- is why nothing re-homed these CIKs in the first place: the correct rows did
-- not exist, so there was no ticker to join to. After this file the twenty
-- rows carry the ticker the SEC file maps to the CIK they already hold, so the
-- job agrees with them and changes nothing. It also carries its own holder
-- check and will not mint a second holder of a CIK.
--
-- backend/entity_resolver.py IS THE PART THAT MAKES THIS DURABLE RATHER THAN A
-- ONE-OFF, AND THE MECHANISM IS WORTH STATING EXACTLY, BECAUSE IT IS NOT THE
-- OBVIOUS ONE. resolve_entity looks a surface form up ONLY in `aliases`, by
-- lookup_key (entity_resolver.py step 2). None of the twenty registrant names
-- has an alias, so every one of them is still a MISS. On a miss the resolver
-- calls _try_insert_canonical, which INSERTs `name = surface_form` RAW. After
-- this file that INSERT hits companies_name_key and RAISES 23505, and
-- backend/company_conflict.py recovers it: the hint map sends
-- companies_name_key to PROBE_EXACT_NAME, the probe finds THE ROW THIS FILE
-- MINTED, and the resolver recurses and writes the alias against it.
--
-- SO THE CONVERGENCE IS REAL BUT NARROW, AND THE NARROWNESS IS THE POINT.
-- companies_name_key is UNIQUE (name), exact and byte-for-byte. A surface form
-- IDENTICAL to the minted name converges. 'Renasant Corp' and
-- 'Renasant Corporation' DO NOT: they raise nothing, and they still mint a new
-- fragment row. Each block picks the modal corpus form precisely to make the
-- most common surface form the one that converges; the tail does not. Closing
-- the tail is an alias-writing job and is NOT in this file.
--
-- mention_count starts at 0 deliberately, matching the live mint payload in
-- entity_resolver.py, so the count that appears is earned rather than
-- backdated.
--
-- THE ONE STANDING RISK IS HUMAN, NOT AUTOMATED. NINE of these rows land next
-- to a row whose name a later reader could mistake for the registrant, and on
-- SEVEN of the nine that neighbour is a real, different, mention-carrying
-- company. The failure mode is somebody reading BLOCK 22f, or running a
-- duplicate sweep, and MERGING the pair. Every BATCH 2 and BATCH 3 block names
-- its neighbour in its own header and says DO NOT MERGE for that reason.
-- =====================================================================
