-- =====================================================================
-- 0037_company_name_repair.sql
--
--   *** PROPOSAL. NOT APPLIED. NOT EXECUTED. DO NOT RUN AS ONE SCRIPT. ***
--
-- Prior art, read first, NOT duplicated or contradicted here:
--   sql/proposals/0020_normalize_lookup_key_v2.sql      (v2 key function)
--   sql/proposals/0033_entity_merge_pinned.sql          (merge, variant 1)
--   sql/proposals/0034_entity_merge_follows.sql         (merge, variant 2)
--   sql/proposals/0035_entity_merge_identity_first.sql  (merge, variant 3)
--   sql/proposals/0036_companies_sec_cik_unique_index.sql
--
-- ---------------------------------------------------------------------
-- WHAT THIS IS, AND WHAT IT IS NOT
-- ---------------------------------------------------------------------
-- This file repairs company NAMES. It never merges, deletes, tombstones or
-- repoints a company row, so it is NOT a fourth merge variant and it does not
-- claim entity_merge.variant_lock. It lives in its own schema, entity_repair,
-- and can be dropped whole.
--
-- The defect it addresses is different from the one 0033/0034/0035 address.
-- Those three merge DUPLICATE CLUSTERS: two rows, one company, both names
-- basically right. This one fixes a SINGLE row whose ticker and sec_cik are
-- CORRECT and whose NAME IS WRONG. Measured live, read-only, 2026-08-20:
--
--   indexed 'Ola'    [KO,  cik 21344]      is Coca-Cola           (coca-cOLA)
--   indexed 'LIC'    [RSG, cik 1060391]    is Republic Services   (repubLIC)
--   indexed 'Excel'  [HXL, cik 717605]     is Hexcel              (hEXCEL)
--   indexed 'Hark'   [SN,  cik 1957132]    is SharkNinja          (sHARKninja)
--   indexed 'Gett'   [RGTI, cik 1838359]   is Rigetti             (riGETTi)
--   indexed 'Ely'    [ARDX, cik 1437402]   is Ardelyx             (ardELYx)
--   indexed 'Motive' [ORLY, cik 898173]    is O'Reilly Automotive
--   indexed 'Vanta'  [NOVT, cik 1076930]   is Novanta             (noVANTA)
--
-- The name is an INTERIOR FRAGMENT of the real name. That is not a
-- normalization gap and no matching rule can close it: 'ola' is not a prefix, a
-- suffix or a token of 'coca cola'. Substring matching is far too loose to put
-- in a resolver, and was measured doing exactly what you would expect, pairing
-- "Howmet Aerospace" with the row named 'Meta' and "The Hartford" with 'Ford'.
-- So the fix is a reviewed name repair on the index, not a resolver change.
--
-- WHY IT MATTERS. Because the identity is correct, these rows are live targets:
-- financial_facts, sec_filings and insider_transactions are keyed on
-- companies.id and land on them correctly by CIK. It is only the human-readable
-- name, which is what articles match on, that is wrong. So the company page
-- shows the filings and none of the news.
--
-- MEASURED VALUE OF FOUR CONFIRMED RENAMES, over the 2026-07-14 to 2026-08-19
-- ingest window (68,435 articles):
--   'Ola'   -> Coca-Cola            77 + 25 = 102 gate-lost articles reachable
--   'LIC'   -> Republic Services    46 + 31 =  77
--   'Excel' -> Hexcel               38 + 23 =  61
--   'Hark'  -> SharkNinja           36 + 24 =  60
--                                   TOTAL   = 300 articles from FOUR renames.
--
-- And a worked example of why review is mandatory rather than optional:
-- "Coca-Cola Consolidated, Inc." is 42 more gate-lost articles in the same
-- window and is a DIFFERENT COMPANY (COKE, not KO). An automatic rule that
-- swept "anything containing coca cola" onto the repaired 'Ola' row would
-- corrupt 42 articles while fixing 102.
--
-- ---------------------------------------------------------------------
-- WHAT A RENAME TOUCHES, VERIFIED RATHER THAN ASSUMED
-- ---------------------------------------------------------------------
-- companies.name is the ONLY column written. Nothing FK-joined to companies.id
-- moves, because nothing about the identity changes:
--
--   aliases.canonical_id                 untouched
--   company_mentions.company_id          untouched
--   financial_facts.company_id           untouched
--   sec_filings.company_id               untouched
--   insider_transactions.company_id      untouched
--   resolution_log.resolved_canonical_id untouched
--
-- DELIBERATELY NOT TOUCHED, and this is the part to argue about:
--
--   articles.companies      text[]  name-keyed
--   articles.primary_company text   name-keyed
--
-- A rename does NOT rewrite those, so an article already tagged 'LIC' keeps
-- saying 'LIC'. That is a real, and small, inconsistency. Measured live over
-- all 180,223 article rows for the 19 confirmed fragment names:
--   186 articles.companies[] entries and 12 articles.primary_company values.
--
-- It is left alone on purpose. sql/proposals/0020 PHASE 6 was found
-- undeliverable by review precisely because it tried to repoint TEXT columns
-- with `WHERE company_id = ANY(<uuid[]>)`, which does not type-check against a
-- text column and would never have matched a row. This file does not repeat
-- that mistake by attempting the same thing in the other direction. If those
-- 198 values are worth rewriting, that is a separate, name-keyed, ledgered
-- backfill in the shape of tools/backfill_primary_fold.py, with its own
-- reversibility story. It is not a migration.
--
-- ---------------------------------------------------------------------
-- ORDERING AGAINST THE MERGE VARIANTS. THIS MATTERS.
-- ---------------------------------------------------------------------
-- Run this BEFORE any of 0033 / 0034 / 0035, or not at all until after they
-- have fully finished and been rolled back.
--
-- A rename changes the row's norm_v2.lookup_key_v2 value, which changes which
-- CLUSTER it belongs to. Renaming 'Excel' to 'Hexcel' moves that row out of any
-- cluster keyed 'excel' and into one keyed 'hexcel'. If a merge plan has already
-- been materialized and approved, a rename underneath it silently invalidates
-- the review: PHASE 5 of the merge variants re-asserts identity rules at merge
-- time, so it would refuse rather than corrupt, but the approval work is lost.
--
-- PHASE 0 below therefore REFUSES TO RUN if an entity_merge plan exists with any
-- approved cluster, or if any companies.merged_into tombstone exists.
--
-- ---------------------------------------------------------------------
-- WHY THERE IS NO AUTOMATIC NAME SOURCE
-- ---------------------------------------------------------------------
-- The correct name lives at the SEC under the row's cik, and this database does
-- not hold it: sec_filings carries cik, accession_number, form_type and the
-- document, not the registrant's conformed name. So PHASE 3 is a HUMAN-FILLED
-- table. There is no oracle to automate, and inventing one from article text is
-- how you get "Howmet Aerospace" renamed to "Meta".
--
-- The phases below are meant to be run ONE AT A TIME by a human, with review
-- between each. Phases 0 to 3 are non-destructive. PHASE 4 is the only mutating
-- phase and refuses any row not on the approved plan.
-- =====================================================================


-- =====================================================================
-- PHASE 0  -- preconditions. Non-destructive.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS entity_repair;

CREATE TABLE IF NOT EXISTS entity_repair.run_ledger (
  phase   text PRIMARY KEY,
  ran_at  timestamptz NOT NULL DEFAULT now(),
  ran_by  text        NOT NULL DEFAULT current_user,
  notes   jsonb
);

-- 0a. Refuse to run underneath an in-flight entity merge. See ORDERING above.
DO $$
DECLARE approved_n bigint := 0; tombstones bigint := 0;
BEGIN
  IF to_regclass('entity_merge.plan_cluster') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM entity_merge.plan_cluster WHERE approved'
      INTO approved_n;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'companies'
                AND column_name = 'merged_into') THEN
    EXECUTE 'SELECT count(*) FROM public.companies WHERE merged_into IS NOT NULL'
      INTO tombstones;
  END IF;
  IF approved_n > 0 OR tombstones > 0 THEN
    RAISE EXCEPTION
      'entity_repair refused: % approved merge cluster(s) and % tombstone(s) '
      'exist. A rename changes a row''s v2 key and therefore its cluster, which '
      'invalidates that review. Finish or roll back the entity_merge variant '
      'first (its PHASE 7), then re-run this.', approved_n, tombstones;
  END IF;
END;
$$;

-- 0b. The v2 key function, used by the screen in PHASE 2 for reporting only.
DO $$
BEGIN
  IF to_regprocedure('norm_v2.lookup_key_v2(text)') IS NULL THEN
    RAISE EXCEPTION
      'norm_v2.lookup_key_v2(text) not found. Apply PHASE 1 of '
      'sql/proposals/0020_normalize_lookup_key_v2.sql first. It is a pure '
      'function addition and changes no behavior.';
  END IF;
END;
$$;

INSERT INTO entity_repair.run_ledger (phase, notes)
VALUES ('00_preconditions', jsonb_build_object(
  'companies', (SELECT count(*) FROM public.companies)))
ON CONFLICT (phase) DO UPDATE
  SET ran_at = now(), ran_by = current_user, notes = EXCLUDED.notes;


-- =====================================================================
-- PHASE 1  -- baseline snapshot. Non-destructive. Rollback reads this.
-- =====================================================================

DO $$
DECLARE renamed_n bigint := 0;
BEGIN
  IF to_regclass('entity_repair.rename_journal') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM entity_repair.rename_journal' INTO renamed_n;
  END IF;
  IF renamed_n > 0 THEN
    RAISE EXCEPTION
      'entity_repair PHASE 1 refused: % rename(s) already applied. '
      'Re-snapshotting would destroy the rollback source. Run PHASE 5 first.',
      renamed_n;
  END IF;
END;
$$;

DROP TABLE IF EXISTS entity_repair.snapshot_companies;
CREATE TABLE entity_repair.snapshot_companies AS
  SELECT id, name, ticker, sec_cik, mention_count FROM public.companies;
ALTER TABLE entity_repair.snapshot_companies ADD PRIMARY KEY (id);

INSERT INTO entity_repair.run_ledger (phase, notes)
VALUES ('01_snapshot', jsonb_build_object(
  'companies', (SELECT count(*) FROM entity_repair.snapshot_companies),
  'measured_2026_08_20', 5463))
ON CONFLICT (phase) DO UPDATE
  SET ran_at = now(), ran_by = current_user, notes = EXCLUDED.notes;


-- =====================================================================
-- PHASE 2  -- the SCREEN. Non-destructive. Produces the review list.
--
-- A row is suspect when it has a ticker but the ticker's letters do NOT appear
-- IN ORDER inside the name. ADBE sits inside "Adobe", TSLA inside "Tesla", MRK
-- inside "Merck", KO inside "Coca-Cola". Nothing of RSG sits inside "LIC".
--
-- This is a SCREEN, not a verdict, and it has known false alarms that a human
-- must clear rather than the SQL:
--   'Apple'  [AAPL]  needs two a's and the name has one
--   '3M'     [MMM]   needs three m's
--   'Truist' [TFC]   shares no letters at all with its own ticker, and is right
--   'Nordic' [NAT]   is a correct truncation of Nordic American Tankers
-- Measured live 2026-08-20 at the bounds below: 108 suspect rows of 5,463.
-- Every one of them has mention_count <= 8, which is the tell: these rows were
-- minted once by a bad extraction and never hit again.
-- =====================================================================

DROP TABLE IF EXISTS entity_repair.suspect_row;
CREATE TABLE entity_repair.suspect_row AS
WITH candidate AS (
  SELECT
    c.id,
    c.name,
    c.ticker,
    c.sec_cik,
    c.mention_count,
    norm_v2.lookup_key_v2(c.name)                            AS v2_key,
    lower(regexp_replace(c.name,   '[^a-zA-Z0-9]', '', 'g')) AS name_key,
    lower(regexp_replace(c.ticker, '[^a-zA-Z0-9]', '', 'g')) AS ticker_key
  FROM public.companies c
  WHERE c.ticker IS NOT NULL
    AND btrim(c.ticker) <> ''
    AND length(btrim(c.name)) <= 8
    AND coalesce(c.mention_count, 0) <= 8
),
scored AS (
  SELECT
    cand.*,
    -- Walk the ticker's letters left to right, requiring each to appear after
    -- the previous one inside the name. A NULL cursor means "already failed".
    (SELECT bool_and(pos IS NOT NULL)
       FROM (
         SELECT (
           SELECT min(g)
             FROM generate_series(1, length(cand.name_key)) g
            WHERE substr(cand.name_key, g, 1) = substr(cand.ticker_key, t, 1)
              AND g > coalesce((
                    SELECT max(gg)
                      FROM generate_series(1, length(cand.name_key)) gg
                     WHERE substr(cand.name_key, gg, 1)
                           = substr(cand.ticker_key, t - 1, 1)
                       AND t > 1
                  ), 0)
         ) AS pos
         FROM generate_series(1, length(cand.ticker_key)) t
       ) walk
    ) AS ticker_agrees
  FROM candidate cand
)
SELECT id, name, ticker, sec_cik, mention_count, v2_key
FROM scored
WHERE ticker_agrees IS NOT TRUE;

-- NOTE ON THE SQL ABOVE. The subsequence walk is written greedily and is
-- deliberately a touch LOOSE (it can accept an ordering a strict left-to-right
-- cursor would reject). Loose is the safe direction here: a loose test flags
-- FEWER rows as suspect, so the failure mode is a missing review candidate, not
-- a bogus rename. The authoritative implementation, including its fixtures, is
-- tools/wikidata_gate_recovery.py::_ticker_agrees_with_name. Run that first and
-- diff the two lists before trusting this table.

-- Review before continuing:
--   SELECT * FROM entity_repair.suspect_row ORDER BY mention_count, name;

INSERT INTO entity_repair.run_ledger (phase, notes)
VALUES ('02_screen', jsonb_build_object(
  'suspect_rows', (SELECT count(*) FROM entity_repair.suspect_row),
  'measured_2026_08_20', 108))
ON CONFLICT (phase) DO UPDATE
  SET ran_at = now(), ran_by = current_user, notes = EXCLUDED.notes;


-- =====================================================================
-- PHASE 3  -- the PLAN. Human-filled. SHIPPED EMPTY, on purpose.
--
-- There is no name oracle in this database (see WHY THERE IS NO AUTOMATIC NAME
-- SOURCE above), so a person reads entity_repair.suspect_row, checks the cik
-- against SEC EDGAR, and inserts one row per confirmed rename with the evidence
-- they used. Nothing else may be renamed.
-- =====================================================================

CREATE TABLE IF NOT EXISTS entity_repair.rename_plan (
  company_id  uuid PRIMARY KEY,
  old_name    text NOT NULL,
  new_name    text NOT NULL,
  evidence    text NOT NULL,
  approved    boolean NOT NULL DEFAULT false,
  approved_by text,
  approved_at timestamptz,
  CONSTRAINT rename_plan_changes_something CHECK (btrim(new_name) <> btrim(old_name)),
  CONSTRAINT rename_plan_new_name_nonempty  CHECK (btrim(new_name) <> ''),
  CONSTRAINT rename_plan_evidence_nonempty  CHECK (btrim(evidence) <> '')
);

-- The four confirmed examples, commented out. They are the WORKED FORM, not an
-- instruction: fill in the uuids from entity_repair.suspect_row yourself and
-- re-verify each cik at EDGAR before uncommenting anything.
--
-- INSERT INTO entity_repair.rename_plan (company_id, old_name, new_name, evidence)
-- VALUES
--   ('<uuid of Ola>',   'Ola',   'Coca-Cola',
--    'cik 21344 = THE COCA-COLA COMPANY, ticker KO. Name is the interior fragment coca-cOLA.'),
--   ('<uuid of LIC>',   'LIC',   'Republic Services',
--    'cik 1060391 = REPUBLIC SERVICES INC, ticker RSG. Fragment repubLIC.'),
--   ('<uuid of Excel>', 'Excel', 'Hexcel',
--    'cik 717605 = HEXCEL CORP, ticker HXL. Fragment hEXCEL.'),
--   ('<uuid of Hark>',  'Hark',  'SharkNinja',
--    'cik 1957132 = SHARKNINJA INC, ticker SN. Fragment sHARKninja.');

-- Approval is a SEPARATE statement from insertion, on purpose: filling the plan
-- and approving it are two different acts of review.
--   UPDATE entity_repair.rename_plan
--      SET approved = true, approved_by = current_user, approved_at = now()
--    WHERE company_id IN (...);

-- Review before continuing:
--   SELECT * FROM entity_repair.rename_plan ORDER BY approved, old_name;


-- =====================================================================
-- PHASE 4  -- APPLY. The only mutating phase. Guarded and journalled.
--
-- Writes companies.name and nothing else. Refuses:
--   - any row not on the plan
--   - any row not approved
--   - any plan row whose old_name no longer matches the live row (the row
--     changed under the review)
--   - any rename that would collide with an existing companies.name, since
--     there is a UNIQUE(name) constraint and a collision is a MERGE, which is
--     0033 / 0034 / 0035's job and not this file's
-- =====================================================================

CREATE TABLE IF NOT EXISTS entity_repair.rename_journal (
  company_id uuid PRIMARY KEY,
  old_name   text NOT NULL,
  new_name   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text        NOT NULL DEFAULT current_user
);

-- 4a. Refuse on collision, loudly, before writing anything.
DO $$
DECLARE collisions text;
BEGIN
  SELECT string_agg(format('%s -> %s', p.old_name, p.new_name), '; ')
    INTO collisions
    FROM entity_repair.rename_plan p
    JOIN public.companies c ON c.name = p.new_name
   WHERE p.approved AND c.id <> p.company_id;
  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION
      'entity_repair PHASE 4 refused: the target name already belongs to '
      'another company row (%). That is a MERGE, not a rename. Use '
      'sql/proposals/0033 or 0034, and drop these rows from the plan.',
      collisions;
  END IF;
END;
$$;

-- 4b. Refuse when the live row drifted away from what was reviewed.
DO $$
DECLARE drifted bigint;
BEGIN
  SELECT count(*) INTO drifted
    FROM entity_repair.rename_plan p
    JOIN public.companies c ON c.id = p.company_id
   WHERE p.approved AND c.name IS DISTINCT FROM p.old_name;
  IF drifted > 0 THEN
    RAISE EXCEPTION
      'entity_repair PHASE 4 refused: % approved plan row(s) no longer match '
      'the live companies.name they were reviewed against. Re-run PHASE 2 and '
      're-review.', drifted;
  END IF;
END;
$$;

-- 4c. Journal first, then write. If the UPDATE fails, the journal has a row
-- that says nothing changed, which PHASE 5 handles by comparing before writing.
INSERT INTO entity_repair.rename_journal (company_id, old_name, new_name)
SELECT p.company_id, p.old_name, p.new_name
  FROM entity_repair.rename_plan p
 WHERE p.approved
ON CONFLICT (company_id) DO NOTHING;

UPDATE public.companies c
   SET name = p.new_name
  FROM entity_repair.rename_plan p
 WHERE c.id = p.company_id
   AND p.approved
   AND c.name = p.old_name;

INSERT INTO entity_repair.run_ledger (phase, notes)
VALUES ('04_apply', jsonb_build_object(
  'renamed', (SELECT count(*) FROM entity_repair.rename_journal)))
ON CONFLICT (phase) DO UPDATE
  SET ran_at = now(), ran_by = current_user, notes = EXCLUDED.notes;

-- Verify after running:
--   SELECT j.old_name, j.new_name, c.name AS live_name, c.ticker, c.sec_cik
--     FROM entity_repair.rename_journal j
--     JOIN public.companies c ON c.id = j.company_id
--    ORDER BY j.applied_at;


-- =====================================================================
-- PHASE 5  -- ROLLBACK. Exact, because nothing was destroyed.
-- =====================================================================

UPDATE public.companies c
   SET name = j.old_name
  FROM entity_repair.rename_journal j
 WHERE c.id = j.company_id
   AND c.name = j.new_name;

DELETE FROM entity_repair.rename_journal;

INSERT INTO entity_repair.run_ledger (phase, notes)
VALUES ('05_rollback', jsonb_build_object('rolled_back_at', now()))
ON CONFLICT (phase) DO UPDATE
  SET ran_at = now(), ran_by = current_user, notes = EXCLUDED.notes;

-- To remove every trace:
--   DROP SCHEMA entity_repair CASCADE;
