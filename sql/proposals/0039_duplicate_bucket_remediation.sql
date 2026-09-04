-- =====================================================================
-- 0039_duplicate_bucket_remediation.sql
--
--   *** HAND-APPLY. NOT APPLIED. DO NOT RUN AS ONE SCRIPT. ***
--
-- The finite, one-time remainder after the norm_v2 merge (sql/proposals/0020
-- and 0020b). One block per bucket, each with a GUARD, the statements, a
-- READ-BACK and a ROLLBACK, so they can be applied independently and stopped
-- at any point. Every WHERE is pinned to the row id AND the row's current
-- values, so a re-run is a no-op and a drifted row refuses.
--
-- Nothing in this file has been executed. Every figure in it was measured
-- read-only.
--
--
-- WHAT THE BUCKET SET ACTUALLY IS
-- -------------------------------
-- Measured against the live table with a keyset walk asserted against
-- count=exact, keys computed by IMPORTING backend/normalize.py and
-- backend/company_match.py rather than re-implementing them:
--
--   under v1  (normalize.normalize_lookup_key)        0 duplicate buckets
--   under v2  (company_match.normalize_company_key)  40 duplicate buckets
--
-- v1 has none because three unique indexes already enforce it: companies_name_key
-- UNIQUE(name), companies_name_norm_unique UNIQUE(lower(btrim(name))) WHERE
-- sec_cik IS NULL, and companies_sec_cik_unique. All three were re-verified to
-- hold. So "the buckets" only exist under v2, and the choice of canonical
-- normalizer is not a reporting detail here, it is the difference between 40
-- and nothing.
--
-- THE 28 IS NOT A COUNT OF WHAT REMAINS. It is the length of the pre-block list
-- in 0020b, parsed out of that file rather than retyped. All 28 pre-blocked keys
-- are still live duplicate buckets. Twelve MORE have accreted from ingest since
-- the merge, and those twelve are the ones this file folds. 28 + 12 = 40.
--
--
-- THE CARRIER TEST HAD TO BE WIDENED, AND IT CHANGED SIX ANSWERS
-- --------------------------------------------------------------
-- "Which rows carry identifiers" was read from companies.ticker and
-- companies.sec_cik. Those are not the only place this database records a
-- company's identity. financial_facts.cik, sec_filings.cik and
-- insider_transactions.cik each carry one too, written by backend/ingest_sec.py,
-- a different path from the one that writes companies.ticker.
--
-- Reading only the companies columns gives ZERO buckets whose carriers disagree.
-- Reading every path gives one, and it is the case the brief named:
--
--   hp    companies.sec_cik on the survivor = 47217  (HP Inc / HPQ)
--         financial_facts.cik on the loser  = 46765  (HELMERICH & PAYNE)
--
-- The 46765 stamp is not in companies.ticker or companies.sec_cik. Both are NULL
-- on that row. Somebody cleared the columns and left the facts. Five more
-- buckets are the same shape, and all five are already pre-blocked for exactly
-- the identifier the widened test still finds:
--
--   axt      financial_facts.cik 10456    = BAXTER INTERNATIONAL
--   csl      financial_facts.cik 790051   = CARLISLE COMPANIES
--   go       financial_facts.cik 1771515  = GROCERY OUTLET
--   science  financial_facts.cik 882095   = GILEAD SCIENCES
--   zip      financial_facts.cik 1617553  = ZIPRECRUITER
--
-- Any future gate that decides "does this cluster carry one identity" by reading
-- the companies columns alone will call all six of these clean.
--
--
-- WHAT THIS FILE DOES NOT DO
-- --------------------------
-- It does not clear the bucket set. Twenty-four buckets are genuine refusals and
-- carry no statements here, only a written reason. A UNIQUE index over
-- lookup_key_v2(name) across the whole table CANNOT be built after this file is
-- applied, and no amount of folding will make it buildable, because the
-- remaining buckets are distinct real-world companies that happen to normalize
-- together. That index has to be partial, or the entities have to be split
-- first. See SECTION 6.
--
-- It also does not touch articles. articles.companies[] and
-- articles.primary_company hold NAMES, and every fold below strands the loser's
-- name in those columns. That is a known, ledgered workstream:
-- sql/0035_articles_companies_repair_ledger.sql and
-- tools/repair_articles_companies.py. SECTION 5 hands off to it.
--
--
-- WHAT IS NEVER TOUCHED
-- ---------------------
-- user_claims, morning_brief_calls and output_grades. Not by any statement in
-- this file. How that was verified rather than asserted: the full column list of
-- all three was read from the live PostgREST schema, and none of them contains a
-- company id, a company name, or a foreign key to companies. They key on
-- target_symbol (a ticker string) and output_id. Claim linkage is preserved the
-- same way Lucas's merge preserved it, by not having a column to break.
--
-- The one way a fold could reach them INDIRECTLY is by changing a ticker, since
-- target_symbol is a ticker. No block in this file writes ticker or sec_cik at
-- all. In every bucket folded here the survivor either already carries the only
-- identifier in the bucket or no member carries one, so there is nothing to
-- inherit. Each block's READ-BACK asserts ticker and sec_cik came out unchanged.
-- =====================================================================


-- =====================================================================
-- SECTION 0 -- INSPECT. Read-only. Run this FIRST and read every answer.
-- =====================================================================

-- 0a. The foreign keys that actually exist on companies(id), and their delete
--     rules. 0020b line 771 says "No foreign keys exist on companies.id.
--     Nothing cascades." THAT IS NO LONGER TRUE and it matters: aliases
--     cascades. Six FKs are declared in the live PostgREST schema
--     (aliases.canonical_id, company_mentions.company_id,
--     financial_facts.company_id, insider_transactions.company_id,
--     resolution_log.resolved_canonical_id, sec_filings.company_id).
--     Two of the six delete rules are NOT in any file in this repo. Read them
--     here before applying anything.
--
--   SELECT c.conname, t.relname AS referencing_table,
--          a.attname AS referencing_column, c.confdeltype
--     FROM pg_constraint c
--     JOIN pg_class t ON t.oid = c.conrelid
--     JOIN unnest(c.conkey) k(attnum) ON true
--     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
--    WHERE c.contype = 'f'
--      AND c.confrelid = 'public.companies'::regclass
--    ORDER BY 2, 3;
--
--   confdeltype: a = NO ACTION, r = RESTRICT, c = CASCADE, n = SET NULL,
--                d = SET DEFAULT.
--   Known from repo DDL: aliases = CASCADE, financial_facts = SET NULL,
--   resolution_log = SET NULL, company_mentions = NO ACTION.
--   Unknown from repo DDL: sec_filings, insider_transactions.
--
--   Every block below repoints ALL of them before the DELETE, so the delete
--   rules never come into play. Read them anyway: if a NEW dependent table has
--   been added since this file was written, this query is where it shows up,
--   and a block that does not repoint it would silently cascade or null it.

-- 0b. The unique indexes on companies. Two of the four are PARTIAL UNIQUE
--     INDEXES and carry NO pg_constraint row, so pg_constraint alone does not
--     see them.
--
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE schemaname = 'public' AND tablename = 'companies'
--    ORDER BY indexname;

-- 0c. Is the journal there, and did the merge write to it?
--
--   SELECT to_regclass('norm_v2.moved_row') AS journal;
--   SELECT table_name, count(*) FROM norm_v2.moved_row GROUP BY 1 ORDER BY 1;
--
--   If the journal does not exist, run SECTION 1 first. If it exists and holds
--   rows from the merge, that is expected and this file appends to it.

-- 0d. Is the merge drained? A cluster merged after these folds re-creates the
--     same class of stale name that SECTION 5 hands off.
--
--   SELECT count(*) FILTER (WHERE merged_at IS NOT NULL)                    AS merged,
--          count(*) FILTER (WHERE approved AND risk <> 'block'
--                             AND merged_at IS NULL)                        AS still_to_merge
--     FROM norm_v2.plan_cluster;
--     still_to_merge SHOULD be 0.

-- 0e. Re-measure the bucket set before trusting any block. The counts move with
--     every ingest run.
--
--   SELECT norm_v2.lookup_key_v2(name) AS k, count(*) AS members,
--          string_agg(name, ' | ' ORDER BY mention_count DESC NULLS LAST) AS members_list
--     FROM public.companies
--    GROUP BY 1 HAVING count(*) > 1
--    ORDER BY 2 DESC, 1;
--
--   If this returns a bucket that is not in SECTION 2, 3 or 4 of this file, a
--   new one has appeared. Do not guess at it; measure it the same way.


-- =====================================================================
-- SECTION 1 -- the two tables the blocks write to. Additive. DDL.
-- Safe to run repeatedly. Run once before SECTION 2.
-- =====================================================================

-- norm_v2.moved_row already exists if 0020b SECTION 2 was applied. This is a
-- verbatim copy of that DDL so a block cannot fail on a missing journal.
CREATE SCHEMA IF NOT EXISTS norm_v2;

CREATE TABLE IF NOT EXISTS norm_v2.moved_row (
  id              bigserial PRIMARY KEY,
  new_key         text        NOT NULL,
  table_name      text        NOT NULL,
  row_id          text        NOT NULL,
  from_company_id uuid        NOT NULL,
  to_company_id   uuid        NOT NULL,
  moved_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS moved_row_new_key_idx  ON norm_v2.moved_row (new_key);
CREATE INDEX IF NOT EXISTS moved_row_table_id_idx ON norm_v2.moved_row (table_name, row_id);

-- WHY THE BLOCKS WRITE TO moved_row.
--
-- norm_v2.merge_cluster journals company_mentions, sec_filings and
-- insider_transactions there and deliberately does not journal financial_facts.
-- Matching that exactly is worth more than any improvement on it: it means ONE
-- reversal procedure covers both the merge and these hand folds, and the
-- rollback statement documented in the table's own COMMENT keeps working
-- unchanged. Rows written here use new_key = 'handfold:<v2 key>' so a hand fold
-- is distinguishable from a merged cluster without being a separate mechanism.
--
-- The alternative, journaling financial_facts too, was rejected for the same
-- reason 0020b rejected it: it is the large table, the merge already accepted
-- its repoint as one-way, and making these blocks reversible in a way the merge
-- is not would produce two different rollback stories for the same operation.

-- A hand fold is not in norm_v2.plan_cluster, so norm_v2_merge_map() cannot see
-- it and the step-12 articles repair would skip these names. This table is the
-- missing half. It is deliberately NOT plan_cluster: inserting a row there with
-- merged_at set would permanently block a SECTION 3 rebuild of the plan.
CREATE TABLE IF NOT EXISTS norm_v2.hand_fold (
  new_key       text        NOT NULL,
  loser_id      uuid        NOT NULL,
  loser_name    text        NOT NULL,
  survivor_id   uuid        NOT NULL,
  survivor_name text        NOT NULL,
  folded_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (loser_id)
);

COMMENT ON TABLE norm_v2.hand_fold IS
  'Loser -> survivor NAME map for folds applied by hand outside norm_v2.plan_cluster. '
  'Read by the SECTION 5 replacement of norm_v2_merge_map() so that '
  'tools/repair_articles_companies.py repairs articles.companies[] for these '
  'names too. Without it a hand fold is half a merge.';


-- =====================================================================
-- SECTION 2 -- DECIDABLE. Twelve buckets, none of them pre-blocked.
--
-- All twelve appeared AFTER the norm_v2 merge. Every one is either
-- one-carrier-others-bare or no-carrier-at-all, under the WIDENED carrier test
-- that reads financial_facts, sec_filings and insider_transactions as well as
-- the companies columns. Every identifier present was checked against SEC
-- company_tickers.json, the same source tools/norm_v2_edgar_audit.py uses.
--
-- Apply in any order. Stop at any point.
-- =====================================================================

-- ---------------------------------------------------------------------
-- BLOCK A1 -- v2 key 'lockheed martin'   (2 rows -> 1)
--
--   Carrier LMT / cik 936468, EDGAR agrees (LOCKHEED MARTIN CORP).
--   Loser is a spelling with no identifier.
--
--   SURVIVES : 'Lockheed Martin'  ticker=LMT  sec_cik=936468
--   FOLDS IN : 'Lockheed Martin Company'  ticker=None  sec_cik=None
--              articles.companies[] holding this name: 1; articles.primary_company: 0
--
--   DISPLAYED NAME AFTER THE FOLD: 'Lockheed Martin'
--   mention_count on the survivor goes to the cluster sum (866).
--   ticker and sec_cik are NOT written by this block. The survivor either
--   already carries the only identifier in the bucket, or no member has one.
-- ---------------------------------------------------------------------

-- GUARD. Read this first and look at it. Then run the assertion.
SELECT id, name, ticker, sec_cik, mention_count, sector
  FROM public.companies
 WHERE id IN ('349f8721-b574-4ebd-8134-f84db1e987cb'::uuid, 'a1830700-5279-4d0f-8050-3c51af388640'::uuid)
 ORDER BY mention_count DESC NULLS LAST, id;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.companies c
   WHERE (c.id = '349f8721-b574-4ebd-8134-f84db1e987cb'::uuid
              AND c.name = 'Lockheed Martin Company'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 1)
      OR (c.id = 'a1830700-5279-4d0f-8050-3c51af388640'::uuid
              AND c.name = 'Lockheed Martin'
              AND c.ticker IS NOT DISTINCT FROM 'LMT'
              AND c.sec_cik IS NOT DISTINCT FROM 936468
              AND c.mention_count IS NOT DISTINCT FROM 865);
  IF n <> 2 THEN
    RAISE EXCEPTION 'BLOCK A1 GUARD FAILED: expected 2 pinned rows, found %. A row drifted, or this block already ran. DO NOT PROCEED.', n;
  END IF;
  IF to_regprocedure('norm_v2.lookup_key_v2(text)') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.companies WHERE norm_v2.lookup_key_v2(name) = $1'
      INTO n USING 'lockheed martin';
    IF n <> 2 THEN
      RAISE EXCEPTION 'BLOCK A1 GUARD FAILED: the bucket now holds % rows, not 2. A new member was ingested. Re-measure before folding.', n;
    END IF;
  ELSE
    RAISE NOTICE 'norm_v2.lookup_key_v2 is not installed; cluster-size guard skipped for lockheed martin.';
  END IF;
END $$;

BEGIN;

-- 1. Journal the three reversible dependents BEFORE repointing them.
--    Same table, same shape and same three tables as norm_v2.merge_cluster.
INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:lockheed martin', 'company_mentions', t.id::text, t.company_id, 'a1830700-5279-4d0f-8050-3c51af388640'::uuid
  FROM public.company_mentions t
 WHERE t.company_id IN ('349f8721-b574-4ebd-8134-f84db1e987cb'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:lockheed martin', 'sec_filings', t.id::text, t.company_id, 'a1830700-5279-4d0f-8050-3c51af388640'::uuid
  FROM public.sec_filings t
 WHERE t.company_id IN ('349f8721-b574-4ebd-8134-f84db1e987cb'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:lockheed martin', 'insider_transactions', t.id::text, t.company_id, 'a1830700-5279-4d0f-8050-3c51af388640'::uuid
  FROM public.insider_transactions t
 WHERE t.company_id IN ('349f8721-b574-4ebd-8134-f84db1e987cb'::uuid);

-- 2. Repoint every dependent that keys on companies.id.
--    financial_facts is NOT journaled, exactly as norm_v2.merge_cluster
--    leaves it. Its repoint is one-way. See the ROLLBACK note below.
UPDATE public.company_mentions SET company_id = 'a1830700-5279-4d0f-8050-3c51af388640'::uuid
 WHERE company_id IN ('349f8721-b574-4ebd-8134-f84db1e987cb'::uuid);
UPDATE public.financial_facts SET company_id = 'a1830700-5279-4d0f-8050-3c51af388640'::uuid
 WHERE company_id IN ('349f8721-b574-4ebd-8134-f84db1e987cb'::uuid);
UPDATE public.insider_transactions SET company_id = 'a1830700-5279-4d0f-8050-3c51af388640'::uuid
 WHERE company_id IN ('349f8721-b574-4ebd-8134-f84db1e987cb'::uuid);
UPDATE public.sec_filings SET company_id = 'a1830700-5279-4d0f-8050-3c51af388640'::uuid
 WHERE company_id IN ('349f8721-b574-4ebd-8134-f84db1e987cb'::uuid);

UPDATE public.resolution_log SET resolved_canonical_id = 'a1830700-5279-4d0f-8050-3c51af388640'::uuid
 WHERE resolved_canonical_id IN ('349f8721-b574-4ebd-8134-f84db1e987cb'::uuid);

-- candidate_canonical_ids is JSONB holding uuid STRINGS, not uuid[].
UPDATE public.resolution_log rl SET candidate_canonical_ids = sub.fixed
  FROM (SELECT l.id,
               (SELECT jsonb_agg(DISTINCT CASE WHEN e.v IN ('349f8721-b574-4ebd-8134-f84db1e987cb')
                                          THEN 'a1830700-5279-4d0f-8050-3c51af388640' ELSE e.v END)
                  FROM jsonb_array_elements_text(l.candidate_canonical_ids) AS e(v)) AS fixed
          FROM public.resolution_log l
         WHERE jsonb_typeof(l.candidate_canonical_ids) = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(l.candidate_canonical_ids) x(v)
                        WHERE x.v IN ('349f8721-b574-4ebd-8134-f84db1e987cb'))
       ) sub
 WHERE rl.id = sub.id;

-- 3. aliases FK is ON DELETE CASCADE. Repointing before the DELETE is not
--    tidiness, it is the only thing that stops the alias rows being destroyed.
UPDATE public.aliases s
   SET mention_count = greatest(coalesce(s.mention_count,0), coalesce(l.mc,0)),
       last_seen_at  = greatest(s.last_seen_at, l.ls)
  FROM (SELECT lookup_key, max(coalesce(mention_count,0)) AS mc, max(last_seen_at) AS ls
          FROM public.aliases
         WHERE canonical_id IN ('349f8721-b574-4ebd-8134-f84db1e987cb'::uuid)
         GROUP BY lookup_key) l
 WHERE s.canonical_id = 'a1830700-5279-4d0f-8050-3c51af388640'::uuid AND s.lookup_key = l.lookup_key;

DELETE FROM public.aliases a
 WHERE a.canonical_id IN ('349f8721-b574-4ebd-8134-f84db1e987cb'::uuid)
   AND EXISTS (SELECT 1 FROM public.aliases k
                WHERE k.canonical_id = 'a1830700-5279-4d0f-8050-3c51af388640'::uuid AND k.lookup_key = a.lookup_key);

UPDATE public.aliases SET canonical_id = 'a1830700-5279-4d0f-8050-3c51af388640'::uuid
 WHERE canonical_id IN ('349f8721-b574-4ebd-8134-f84db1e987cb'::uuid);

-- 4. Name-keyed dependents. Measured 0 rows for every loser in this set,
--    kept so the block stays correct if one appears between now and apply.
DELETE FROM public.user_memo_regeneration_quota q
 WHERE q.company_id IN ('Lockheed Martin Company')
   AND EXISTS (SELECT 1 FROM public.user_memo_regeneration_quota k
                WHERE k.user_id = q.user_id AND k.company_id = 'Lockheed Martin'
                  AND k.regenerated_at = q.regenerated_at);
UPDATE public.user_memo_regeneration_quota SET company_id = 'Lockheed Martin'
 WHERE company_id IN ('Lockheed Martin Company');

-- 5. Record the fold so the step-12 articles repair can see it.
INSERT INTO norm_v2.hand_fold (new_key, loser_id, loser_name, survivor_id, survivor_name)
VALUES
  ('lockheed martin', '349f8721-b574-4ebd-8134-f84db1e987cb'::uuid, 'Lockheed Martin Company', 'a1830700-5279-4d0f-8050-3c51af388640'::uuid, 'Lockheed Martin')
ON CONFLICT DO NOTHING;

-- 6. Fold the survivor's own fields. Aggregates are read BEFORE the DELETE
--    because they read the losers; the DELETE then runs; and no identifier
--    is written at all, so the partial unique index on sec_cik is untouched.
CREATE TEMP TABLE IF NOT EXISTS _fold_agg (k text PRIMARY KEY, mentions bigint, themes text[]);
DELETE FROM _fold_agg WHERE k = 'lockheed martin';
INSERT INTO _fold_agg (k, mentions, themes)
SELECT 'lockheed martin',
       (SELECT sum(coalesce(mention_count,0)) FROM public.companies
         WHERE id IN ('349f8721-b574-4ebd-8134-f84db1e987cb'::uuid, 'a1830700-5279-4d0f-8050-3c51af388640'::uuid)),
       (SELECT array_agg(DISTINCT t) FROM public.companies c2,
               unnest(coalesce(c2.key_themes,'{}')) t
         WHERE c2.id IN ('349f8721-b574-4ebd-8134-f84db1e987cb'::uuid, 'a1830700-5279-4d0f-8050-3c51af388640'::uuid));

DELETE FROM public.companies
 WHERE id IN ('349f8721-b574-4ebd-8134-f84db1e987cb'::uuid);

UPDATE public.companies c
   SET mention_count = (SELECT mentions FROM _fold_agg WHERE k = 'lockheed martin'),
       key_themes    = (SELECT themes   FROM _fold_agg WHERE k = 'lockheed martin'),
       last_updated  = now()
 WHERE c.id = 'a1830700-5279-4d0f-8050-3c51af388640'::uuid;

-- READ-BACK. Look at this BEFORE you COMMIT. Every column must read true.
SELECT
  (SELECT count(*) FROM public.companies WHERE id IN ('349f8721-b574-4ebd-8134-f84db1e987cb'::uuid)) = 0        AS losers_gone,
  (SELECT count(*) FROM public.companies WHERE id = 'a1830700-5279-4d0f-8050-3c51af388640'::uuid) = 1 AS survivor_present,
  (SELECT mention_count FROM public.companies WHERE id = 'a1830700-5279-4d0f-8050-3c51af388640'::uuid) = 866 AS mentions_summed,
  (SELECT ticker IS NOT DISTINCT FROM 'LMT' FROM public.companies WHERE id = 'a1830700-5279-4d0f-8050-3c51af388640'::uuid) AS ticker_unchanged,
  (SELECT sec_cik IS NOT DISTINCT FROM 936468 FROM public.companies WHERE id = 'a1830700-5279-4d0f-8050-3c51af388640'::uuid) AS cik_unchanged,
  (SELECT count(*) FROM public.company_mentions WHERE company_id IN ('349f8721-b574-4ebd-8134-f84db1e987cb'::uuid)) = 0 AS mentions_repointed,
  (SELECT count(*) FROM public.aliases WHERE canonical_id IN ('349f8721-b574-4ebd-8134-f84db1e987cb'::uuid)) = 0 AS aliases_repointed,
  (SELECT count(*) FROM public.financial_facts WHERE company_id IN ('349f8721-b574-4ebd-8134-f84db1e987cb'::uuid)) = 0 AS facts_repointed;

-- COMMIT;    -- only after every column above read true
-- ROLLBACK;  -- otherwise

-- ROLLBACK AFTER COMMIT. Run in this order, as one transaction.
--   a. Recreate the loser rows. companies_name_key is UNIQUE(name) and
--      companies_name_no_junk is a CHECK, so the names must go back exactly.
--      INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count, sector)
--      VALUES ('349f8721-b574-4ebd-8134-f84db1e987cb'::uuid, 'Lockheed Martin Company', NULL, NULL, 1, NULL);
--   b. Restore the survivor's own fields.
--      UPDATE public.companies SET mention_count = 865, last_updated = now()
--       WHERE id = 'a1830700-5279-4d0f-8050-3c51af388640'::uuid;
--      key_themes was a UNION and is not restorable from this file. It is
--      additive and non-identifying; the pipeline rewrites it.
--   c. Repoint the three journaled tables back off norm_v2.moved_row.
--      UPDATE public.company_mentions t SET company_id = j.from_company_id
--        FROM norm_v2.moved_row j
--       WHERE j.new_key = 'handfold:lockheed martin' AND j.table_name = 'company_mentions'
--         AND t.id::text = j.row_id;
--      (repeat for sec_filings and insider_transactions)
--   d. financial_facts is NOT journaled and CANNOT be repointed back by this
--      file. That matches norm_v2.merge_cluster, which accepts the same
--      one-way cost. If that is unacceptable for a given block, journal
--      financial_facts too before running it.
--   e. aliases and resolution_log follow the same shape as (c) but have no
--      journal. Re-run backend alias resolution rather than hand-restoring.
--   f. DELETE FROM norm_v2.hand_fold WHERE new_key = 'lockheed martin';


-- ---------------------------------------------------------------------
-- BLOCK A2 -- v2 key 'palo alto networks'   (2 rows -> 1)
--
--   Carrier PANW / cik 1327567, EDGAR agrees.
--   Loser is the same name plus 'Inc.'.
--
--   SURVIVES : 'Palo Alto Networks'  ticker=PANW  sec_cik=1327567
--   FOLDS IN : 'Palo Alto Networks Inc.'  ticker=None  sec_cik=None
--              articles.companies[] holding this name: 1; articles.primary_company: 1
--
--   DISPLAYED NAME AFTER THE FOLD: 'Palo Alto Networks'
--   mention_count on the survivor goes to the cluster sum (384).
--   ticker and sec_cik are NOT written by this block. The survivor either
--   already carries the only identifier in the bucket, or no member has one.
-- ---------------------------------------------------------------------

-- GUARD. Read this first and look at it. Then run the assertion.
SELECT id, name, ticker, sec_cik, mention_count, sector
  FROM public.companies
 WHERE id IN ('0d22785b-842f-4027-9490-ab1c5ceccf39'::uuid, '62c7af87-727c-4102-8f01-ad4cc1939810'::uuid)
 ORDER BY mention_count DESC NULLS LAST, id;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.companies c
   WHERE (c.id = '0d22785b-842f-4027-9490-ab1c5ceccf39'::uuid
              AND c.name = 'Palo Alto Networks Inc.'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 1)
      OR (c.id = '62c7af87-727c-4102-8f01-ad4cc1939810'::uuid
              AND c.name = 'Palo Alto Networks'
              AND c.ticker IS NOT DISTINCT FROM 'PANW'
              AND c.sec_cik IS NOT DISTINCT FROM 1327567
              AND c.mention_count IS NOT DISTINCT FROM 383);
  IF n <> 2 THEN
    RAISE EXCEPTION 'BLOCK A2 GUARD FAILED: expected 2 pinned rows, found %. A row drifted, or this block already ran. DO NOT PROCEED.', n;
  END IF;
  IF to_regprocedure('norm_v2.lookup_key_v2(text)') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.companies WHERE norm_v2.lookup_key_v2(name) = $1'
      INTO n USING 'palo alto networks';
    IF n <> 2 THEN
      RAISE EXCEPTION 'BLOCK A2 GUARD FAILED: the bucket now holds % rows, not 2. A new member was ingested. Re-measure before folding.', n;
    END IF;
  ELSE
    RAISE NOTICE 'norm_v2.lookup_key_v2 is not installed; cluster-size guard skipped for palo alto networks.';
  END IF;
END $$;

BEGIN;

-- 1. Journal the three reversible dependents BEFORE repointing them.
--    Same table, same shape and same three tables as norm_v2.merge_cluster.
INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:palo alto networks', 'company_mentions', t.id::text, t.company_id, '62c7af87-727c-4102-8f01-ad4cc1939810'::uuid
  FROM public.company_mentions t
 WHERE t.company_id IN ('0d22785b-842f-4027-9490-ab1c5ceccf39'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:palo alto networks', 'sec_filings', t.id::text, t.company_id, '62c7af87-727c-4102-8f01-ad4cc1939810'::uuid
  FROM public.sec_filings t
 WHERE t.company_id IN ('0d22785b-842f-4027-9490-ab1c5ceccf39'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:palo alto networks', 'insider_transactions', t.id::text, t.company_id, '62c7af87-727c-4102-8f01-ad4cc1939810'::uuid
  FROM public.insider_transactions t
 WHERE t.company_id IN ('0d22785b-842f-4027-9490-ab1c5ceccf39'::uuid);

-- 2. Repoint every dependent that keys on companies.id.
--    financial_facts is NOT journaled, exactly as norm_v2.merge_cluster
--    leaves it. Its repoint is one-way. See the ROLLBACK note below.
UPDATE public.company_mentions SET company_id = '62c7af87-727c-4102-8f01-ad4cc1939810'::uuid
 WHERE company_id IN ('0d22785b-842f-4027-9490-ab1c5ceccf39'::uuid);
UPDATE public.financial_facts SET company_id = '62c7af87-727c-4102-8f01-ad4cc1939810'::uuid
 WHERE company_id IN ('0d22785b-842f-4027-9490-ab1c5ceccf39'::uuid);
UPDATE public.insider_transactions SET company_id = '62c7af87-727c-4102-8f01-ad4cc1939810'::uuid
 WHERE company_id IN ('0d22785b-842f-4027-9490-ab1c5ceccf39'::uuid);
UPDATE public.sec_filings SET company_id = '62c7af87-727c-4102-8f01-ad4cc1939810'::uuid
 WHERE company_id IN ('0d22785b-842f-4027-9490-ab1c5ceccf39'::uuid);

UPDATE public.resolution_log SET resolved_canonical_id = '62c7af87-727c-4102-8f01-ad4cc1939810'::uuid
 WHERE resolved_canonical_id IN ('0d22785b-842f-4027-9490-ab1c5ceccf39'::uuid);

-- candidate_canonical_ids is JSONB holding uuid STRINGS, not uuid[].
UPDATE public.resolution_log rl SET candidate_canonical_ids = sub.fixed
  FROM (SELECT l.id,
               (SELECT jsonb_agg(DISTINCT CASE WHEN e.v IN ('0d22785b-842f-4027-9490-ab1c5ceccf39')
                                          THEN '62c7af87-727c-4102-8f01-ad4cc1939810' ELSE e.v END)
                  FROM jsonb_array_elements_text(l.candidate_canonical_ids) AS e(v)) AS fixed
          FROM public.resolution_log l
         WHERE jsonb_typeof(l.candidate_canonical_ids) = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(l.candidate_canonical_ids) x(v)
                        WHERE x.v IN ('0d22785b-842f-4027-9490-ab1c5ceccf39'))
       ) sub
 WHERE rl.id = sub.id;

-- 3. aliases FK is ON DELETE CASCADE. Repointing before the DELETE is not
--    tidiness, it is the only thing that stops the alias rows being destroyed.
UPDATE public.aliases s
   SET mention_count = greatest(coalesce(s.mention_count,0), coalesce(l.mc,0)),
       last_seen_at  = greatest(s.last_seen_at, l.ls)
  FROM (SELECT lookup_key, max(coalesce(mention_count,0)) AS mc, max(last_seen_at) AS ls
          FROM public.aliases
         WHERE canonical_id IN ('0d22785b-842f-4027-9490-ab1c5ceccf39'::uuid)
         GROUP BY lookup_key) l
 WHERE s.canonical_id = '62c7af87-727c-4102-8f01-ad4cc1939810'::uuid AND s.lookup_key = l.lookup_key;

DELETE FROM public.aliases a
 WHERE a.canonical_id IN ('0d22785b-842f-4027-9490-ab1c5ceccf39'::uuid)
   AND EXISTS (SELECT 1 FROM public.aliases k
                WHERE k.canonical_id = '62c7af87-727c-4102-8f01-ad4cc1939810'::uuid AND k.lookup_key = a.lookup_key);

UPDATE public.aliases SET canonical_id = '62c7af87-727c-4102-8f01-ad4cc1939810'::uuid
 WHERE canonical_id IN ('0d22785b-842f-4027-9490-ab1c5ceccf39'::uuid);

-- 4. Name-keyed dependents. Measured 0 rows for every loser in this set,
--    kept so the block stays correct if one appears between now and apply.
DELETE FROM public.user_memo_regeneration_quota q
 WHERE q.company_id IN ('Palo Alto Networks Inc.')
   AND EXISTS (SELECT 1 FROM public.user_memo_regeneration_quota k
                WHERE k.user_id = q.user_id AND k.company_id = 'Palo Alto Networks'
                  AND k.regenerated_at = q.regenerated_at);
UPDATE public.user_memo_regeneration_quota SET company_id = 'Palo Alto Networks'
 WHERE company_id IN ('Palo Alto Networks Inc.');

-- 5. Record the fold so the step-12 articles repair can see it.
INSERT INTO norm_v2.hand_fold (new_key, loser_id, loser_name, survivor_id, survivor_name)
VALUES
  ('palo alto networks', '0d22785b-842f-4027-9490-ab1c5ceccf39'::uuid, 'Palo Alto Networks Inc.', '62c7af87-727c-4102-8f01-ad4cc1939810'::uuid, 'Palo Alto Networks')
ON CONFLICT DO NOTHING;

-- 6. Fold the survivor's own fields. Aggregates are read BEFORE the DELETE
--    because they read the losers; the DELETE then runs; and no identifier
--    is written at all, so the partial unique index on sec_cik is untouched.
CREATE TEMP TABLE IF NOT EXISTS _fold_agg (k text PRIMARY KEY, mentions bigint, themes text[]);
DELETE FROM _fold_agg WHERE k = 'palo alto networks';
INSERT INTO _fold_agg (k, mentions, themes)
SELECT 'palo alto networks',
       (SELECT sum(coalesce(mention_count,0)) FROM public.companies
         WHERE id IN ('0d22785b-842f-4027-9490-ab1c5ceccf39'::uuid, '62c7af87-727c-4102-8f01-ad4cc1939810'::uuid)),
       (SELECT array_agg(DISTINCT t) FROM public.companies c2,
               unnest(coalesce(c2.key_themes,'{}')) t
         WHERE c2.id IN ('0d22785b-842f-4027-9490-ab1c5ceccf39'::uuid, '62c7af87-727c-4102-8f01-ad4cc1939810'::uuid));

DELETE FROM public.companies
 WHERE id IN ('0d22785b-842f-4027-9490-ab1c5ceccf39'::uuid);

UPDATE public.companies c
   SET mention_count = (SELECT mentions FROM _fold_agg WHERE k = 'palo alto networks'),
       key_themes    = (SELECT themes   FROM _fold_agg WHERE k = 'palo alto networks'),
       last_updated  = now()
 WHERE c.id = '62c7af87-727c-4102-8f01-ad4cc1939810'::uuid;

-- READ-BACK. Look at this BEFORE you COMMIT. Every column must read true.
SELECT
  (SELECT count(*) FROM public.companies WHERE id IN ('0d22785b-842f-4027-9490-ab1c5ceccf39'::uuid)) = 0        AS losers_gone,
  (SELECT count(*) FROM public.companies WHERE id = '62c7af87-727c-4102-8f01-ad4cc1939810'::uuid) = 1 AS survivor_present,
  (SELECT mention_count FROM public.companies WHERE id = '62c7af87-727c-4102-8f01-ad4cc1939810'::uuid) = 384 AS mentions_summed,
  (SELECT ticker IS NOT DISTINCT FROM 'PANW' FROM public.companies WHERE id = '62c7af87-727c-4102-8f01-ad4cc1939810'::uuid) AS ticker_unchanged,
  (SELECT sec_cik IS NOT DISTINCT FROM 1327567 FROM public.companies WHERE id = '62c7af87-727c-4102-8f01-ad4cc1939810'::uuid) AS cik_unchanged,
  (SELECT count(*) FROM public.company_mentions WHERE company_id IN ('0d22785b-842f-4027-9490-ab1c5ceccf39'::uuid)) = 0 AS mentions_repointed,
  (SELECT count(*) FROM public.aliases WHERE canonical_id IN ('0d22785b-842f-4027-9490-ab1c5ceccf39'::uuid)) = 0 AS aliases_repointed,
  (SELECT count(*) FROM public.financial_facts WHERE company_id IN ('0d22785b-842f-4027-9490-ab1c5ceccf39'::uuid)) = 0 AS facts_repointed;

-- COMMIT;    -- only after every column above read true
-- ROLLBACK;  -- otherwise

-- ROLLBACK AFTER COMMIT. Run in this order, as one transaction.
--   a. Recreate the loser rows. companies_name_key is UNIQUE(name) and
--      companies_name_no_junk is a CHECK, so the names must go back exactly.
--      INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count, sector)
--      VALUES ('0d22785b-842f-4027-9490-ab1c5ceccf39'::uuid, 'Palo Alto Networks Inc.', NULL, NULL, 1, 'Technology');
--   b. Restore the survivor's own fields.
--      UPDATE public.companies SET mention_count = 383, last_updated = now()
--       WHERE id = '62c7af87-727c-4102-8f01-ad4cc1939810'::uuid;
--      key_themes was a UNION and is not restorable from this file. It is
--      additive and non-identifying; the pipeline rewrites it.
--   c. Repoint the three journaled tables back off norm_v2.moved_row.
--      UPDATE public.company_mentions t SET company_id = j.from_company_id
--        FROM norm_v2.moved_row j
--       WHERE j.new_key = 'handfold:palo alto networks' AND j.table_name = 'company_mentions'
--         AND t.id::text = j.row_id;
--      (repeat for sec_filings and insider_transactions)
--   d. financial_facts is NOT journaled and CANNOT be repointed back by this
--      file. That matches norm_v2.merge_cluster, which accepts the same
--      one-way cost. If that is unacceptable for a given block, journal
--      financial_facts too before running it.
--   e. aliases and resolution_log follow the same shape as (c) but have no
--      journal. Re-run backend alias resolution rather than hand-restoring.
--   f. DELETE FROM norm_v2.hand_fold WHERE new_key = 'palo alto networks';


-- ---------------------------------------------------------------------
-- BLOCK A3 -- v2 key 'docusign'   (2 rows -> 1)
--
--   Carrier DOCU / cik 1261333, EDGAR agrees.
--   Loser is the same name plus ', Inc.'.
--
--   SURVIVES : 'Docusign'  ticker=DOCU  sec_cik=1261333
--   FOLDS IN : 'Docusign, Inc.'  ticker=None  sec_cik=None
--              articles.companies[] holding this name: 1; articles.primary_company: 1
--
--   DISPLAYED NAME AFTER THE FOLD: 'Docusign'
--   mention_count on the survivor goes to the cluster sum (102).
--   ticker and sec_cik are NOT written by this block. The survivor either
--   already carries the only identifier in the bucket, or no member has one.
-- ---------------------------------------------------------------------

-- GUARD. Read this first and look at it. Then run the assertion.
SELECT id, name, ticker, sec_cik, mention_count, sector
  FROM public.companies
 WHERE id IN ('48be9690-c78b-4e6d-8003-71ee322cd333'::uuid, 'd0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be'::uuid)
 ORDER BY mention_count DESC NULLS LAST, id;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.companies c
   WHERE (c.id = '48be9690-c78b-4e6d-8003-71ee322cd333'::uuid
              AND c.name = 'Docusign'
              AND c.ticker IS NOT DISTINCT FROM 'DOCU'
              AND c.sec_cik IS NOT DISTINCT FROM 1261333
              AND c.mention_count IS NOT DISTINCT FROM 101)
      OR (c.id = 'd0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be'::uuid
              AND c.name = 'Docusign, Inc.'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 1);
  IF n <> 2 THEN
    RAISE EXCEPTION 'BLOCK A3 GUARD FAILED: expected 2 pinned rows, found %. A row drifted, or this block already ran. DO NOT PROCEED.', n;
  END IF;
  IF to_regprocedure('norm_v2.lookup_key_v2(text)') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.companies WHERE norm_v2.lookup_key_v2(name) = $1'
      INTO n USING 'docusign';
    IF n <> 2 THEN
      RAISE EXCEPTION 'BLOCK A3 GUARD FAILED: the bucket now holds % rows, not 2. A new member was ingested. Re-measure before folding.', n;
    END IF;
  ELSE
    RAISE NOTICE 'norm_v2.lookup_key_v2 is not installed; cluster-size guard skipped for docusign.';
  END IF;
END $$;

BEGIN;

-- 1. Journal the three reversible dependents BEFORE repointing them.
--    Same table, same shape and same three tables as norm_v2.merge_cluster.
INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:docusign', 'company_mentions', t.id::text, t.company_id, '48be9690-c78b-4e6d-8003-71ee322cd333'::uuid
  FROM public.company_mentions t
 WHERE t.company_id IN ('d0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:docusign', 'sec_filings', t.id::text, t.company_id, '48be9690-c78b-4e6d-8003-71ee322cd333'::uuid
  FROM public.sec_filings t
 WHERE t.company_id IN ('d0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:docusign', 'insider_transactions', t.id::text, t.company_id, '48be9690-c78b-4e6d-8003-71ee322cd333'::uuid
  FROM public.insider_transactions t
 WHERE t.company_id IN ('d0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be'::uuid);

-- 2. Repoint every dependent that keys on companies.id.
--    financial_facts is NOT journaled, exactly as norm_v2.merge_cluster
--    leaves it. Its repoint is one-way. See the ROLLBACK note below.
UPDATE public.company_mentions SET company_id = '48be9690-c78b-4e6d-8003-71ee322cd333'::uuid
 WHERE company_id IN ('d0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be'::uuid);
UPDATE public.financial_facts SET company_id = '48be9690-c78b-4e6d-8003-71ee322cd333'::uuid
 WHERE company_id IN ('d0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be'::uuid);
UPDATE public.insider_transactions SET company_id = '48be9690-c78b-4e6d-8003-71ee322cd333'::uuid
 WHERE company_id IN ('d0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be'::uuid);
UPDATE public.sec_filings SET company_id = '48be9690-c78b-4e6d-8003-71ee322cd333'::uuid
 WHERE company_id IN ('d0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be'::uuid);

UPDATE public.resolution_log SET resolved_canonical_id = '48be9690-c78b-4e6d-8003-71ee322cd333'::uuid
 WHERE resolved_canonical_id IN ('d0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be'::uuid);

-- candidate_canonical_ids is JSONB holding uuid STRINGS, not uuid[].
UPDATE public.resolution_log rl SET candidate_canonical_ids = sub.fixed
  FROM (SELECT l.id,
               (SELECT jsonb_agg(DISTINCT CASE WHEN e.v IN ('d0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be')
                                          THEN '48be9690-c78b-4e6d-8003-71ee322cd333' ELSE e.v END)
                  FROM jsonb_array_elements_text(l.candidate_canonical_ids) AS e(v)) AS fixed
          FROM public.resolution_log l
         WHERE jsonb_typeof(l.candidate_canonical_ids) = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(l.candidate_canonical_ids) x(v)
                        WHERE x.v IN ('d0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be'))
       ) sub
 WHERE rl.id = sub.id;

-- 3. aliases FK is ON DELETE CASCADE. Repointing before the DELETE is not
--    tidiness, it is the only thing that stops the alias rows being destroyed.
UPDATE public.aliases s
   SET mention_count = greatest(coalesce(s.mention_count,0), coalesce(l.mc,0)),
       last_seen_at  = greatest(s.last_seen_at, l.ls)
  FROM (SELECT lookup_key, max(coalesce(mention_count,0)) AS mc, max(last_seen_at) AS ls
          FROM public.aliases
         WHERE canonical_id IN ('d0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be'::uuid)
         GROUP BY lookup_key) l
 WHERE s.canonical_id = '48be9690-c78b-4e6d-8003-71ee322cd333'::uuid AND s.lookup_key = l.lookup_key;

DELETE FROM public.aliases a
 WHERE a.canonical_id IN ('d0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be'::uuid)
   AND EXISTS (SELECT 1 FROM public.aliases k
                WHERE k.canonical_id = '48be9690-c78b-4e6d-8003-71ee322cd333'::uuid AND k.lookup_key = a.lookup_key);

UPDATE public.aliases SET canonical_id = '48be9690-c78b-4e6d-8003-71ee322cd333'::uuid
 WHERE canonical_id IN ('d0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be'::uuid);

-- 4. Name-keyed dependents. Measured 0 rows for every loser in this set,
--    kept so the block stays correct if one appears between now and apply.
DELETE FROM public.user_memo_regeneration_quota q
 WHERE q.company_id IN ('Docusign, Inc.')
   AND EXISTS (SELECT 1 FROM public.user_memo_regeneration_quota k
                WHERE k.user_id = q.user_id AND k.company_id = 'Docusign'
                  AND k.regenerated_at = q.regenerated_at);
UPDATE public.user_memo_regeneration_quota SET company_id = 'Docusign'
 WHERE company_id IN ('Docusign, Inc.');

-- 5. Record the fold so the step-12 articles repair can see it.
INSERT INTO norm_v2.hand_fold (new_key, loser_id, loser_name, survivor_id, survivor_name)
VALUES
  ('docusign', 'd0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be'::uuid, 'Docusign, Inc.', '48be9690-c78b-4e6d-8003-71ee322cd333'::uuid, 'Docusign')
ON CONFLICT DO NOTHING;

-- 6. Fold the survivor's own fields. Aggregates are read BEFORE the DELETE
--    because they read the losers; the DELETE then runs; and no identifier
--    is written at all, so the partial unique index on sec_cik is untouched.
CREATE TEMP TABLE IF NOT EXISTS _fold_agg (k text PRIMARY KEY, mentions bigint, themes text[]);
DELETE FROM _fold_agg WHERE k = 'docusign';
INSERT INTO _fold_agg (k, mentions, themes)
SELECT 'docusign',
       (SELECT sum(coalesce(mention_count,0)) FROM public.companies
         WHERE id IN ('48be9690-c78b-4e6d-8003-71ee322cd333'::uuid, 'd0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be'::uuid)),
       (SELECT array_agg(DISTINCT t) FROM public.companies c2,
               unnest(coalesce(c2.key_themes,'{}')) t
         WHERE c2.id IN ('48be9690-c78b-4e6d-8003-71ee322cd333'::uuid, 'd0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be'::uuid));

DELETE FROM public.companies
 WHERE id IN ('d0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be'::uuid);

UPDATE public.companies c
   SET mention_count = (SELECT mentions FROM _fold_agg WHERE k = 'docusign'),
       key_themes    = (SELECT themes   FROM _fold_agg WHERE k = 'docusign'),
       last_updated  = now()
 WHERE c.id = '48be9690-c78b-4e6d-8003-71ee322cd333'::uuid;

-- READ-BACK. Look at this BEFORE you COMMIT. Every column must read true.
SELECT
  (SELECT count(*) FROM public.companies WHERE id IN ('d0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be'::uuid)) = 0        AS losers_gone,
  (SELECT count(*) FROM public.companies WHERE id = '48be9690-c78b-4e6d-8003-71ee322cd333'::uuid) = 1 AS survivor_present,
  (SELECT mention_count FROM public.companies WHERE id = '48be9690-c78b-4e6d-8003-71ee322cd333'::uuid) = 102 AS mentions_summed,
  (SELECT ticker IS NOT DISTINCT FROM 'DOCU' FROM public.companies WHERE id = '48be9690-c78b-4e6d-8003-71ee322cd333'::uuid) AS ticker_unchanged,
  (SELECT sec_cik IS NOT DISTINCT FROM 1261333 FROM public.companies WHERE id = '48be9690-c78b-4e6d-8003-71ee322cd333'::uuid) AS cik_unchanged,
  (SELECT count(*) FROM public.company_mentions WHERE company_id IN ('d0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be'::uuid)) = 0 AS mentions_repointed,
  (SELECT count(*) FROM public.aliases WHERE canonical_id IN ('d0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be'::uuid)) = 0 AS aliases_repointed,
  (SELECT count(*) FROM public.financial_facts WHERE company_id IN ('d0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be'::uuid)) = 0 AS facts_repointed;

-- COMMIT;    -- only after every column above read true
-- ROLLBACK;  -- otherwise

-- ROLLBACK AFTER COMMIT. Run in this order, as one transaction.
--   a. Recreate the loser rows. companies_name_key is UNIQUE(name) and
--      companies_name_no_junk is a CHECK, so the names must go back exactly.
--      INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count, sector)
--      VALUES ('d0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be'::uuid, 'Docusign, Inc.', NULL, NULL, 1, 'Technology');
--   b. Restore the survivor's own fields.
--      UPDATE public.companies SET mention_count = 101, last_updated = now()
--       WHERE id = '48be9690-c78b-4e6d-8003-71ee322cd333'::uuid;
--      key_themes was a UNION and is not restorable from this file. It is
--      additive and non-identifying; the pipeline rewrites it.
--   c. Repoint the three journaled tables back off norm_v2.moved_row.
--      UPDATE public.company_mentions t SET company_id = j.from_company_id
--        FROM norm_v2.moved_row j
--       WHERE j.new_key = 'handfold:docusign' AND j.table_name = 'company_mentions'
--         AND t.id::text = j.row_id;
--      (repeat for sec_filings and insider_transactions)
--   d. financial_facts is NOT journaled and CANNOT be repointed back by this
--      file. That matches norm_v2.merge_cluster, which accepts the same
--      one-way cost. If that is unacceptable for a given block, journal
--      financial_facts too before running it.
--   e. aliases and resolution_log follow the same shape as (c) but have no
--      journal. Re-run backend alias resolution rather than hand-restoring.
--   f. DELETE FROM norm_v2.hand_fold WHERE new_key = 'docusign';


-- ---------------------------------------------------------------------
-- BLOCK A4 -- v2 key 'eightco'   (2 rows -> 1)
--
--   Carrier ORBS / cik 1892492, EDGAR agrees (Eightco Holdings Inc.).
--   Loser is the full legal name.
--
--   SURVIVES : 'Eightco'  ticker=ORBS  sec_cik=1892492
--   FOLDS IN : 'Eightco Holdings Inc.'  ticker=None  sec_cik=None
--              articles.companies[] holding this name: 1; articles.primary_company: 10
--
--   DISPLAYED NAME AFTER THE FOLD: 'Eightco'
--   mention_count on the survivor goes to the cluster sum (65).
--   ticker and sec_cik are NOT written by this block. The survivor either
--   already carries the only identifier in the bucket, or no member has one.
-- ---------------------------------------------------------------------

-- GUARD. Read this first and look at it. Then run the assertion.
SELECT id, name, ticker, sec_cik, mention_count, sector
  FROM public.companies
 WHERE id IN ('45282163-1c8a-4241-8af3-4f9c15cf8d9a'::uuid, '46f5b178-60d3-4b0c-8072-35a66d7f8cdb'::uuid)
 ORDER BY mention_count DESC NULLS LAST, id;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.companies c
   WHERE (c.id = '45282163-1c8a-4241-8af3-4f9c15cf8d9a'::uuid
              AND c.name = 'Eightco'
              AND c.ticker IS NOT DISTINCT FROM 'ORBS'
              AND c.sec_cik IS NOT DISTINCT FROM 1892492
              AND c.mention_count IS NOT DISTINCT FROM 64)
      OR (c.id = '46f5b178-60d3-4b0c-8072-35a66d7f8cdb'::uuid
              AND c.name = 'Eightco Holdings Inc.'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 1);
  IF n <> 2 THEN
    RAISE EXCEPTION 'BLOCK A4 GUARD FAILED: expected 2 pinned rows, found %. A row drifted, or this block already ran. DO NOT PROCEED.', n;
  END IF;
  IF to_regprocedure('norm_v2.lookup_key_v2(text)') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.companies WHERE norm_v2.lookup_key_v2(name) = $1'
      INTO n USING 'eightco';
    IF n <> 2 THEN
      RAISE EXCEPTION 'BLOCK A4 GUARD FAILED: the bucket now holds % rows, not 2. A new member was ingested. Re-measure before folding.', n;
    END IF;
  ELSE
    RAISE NOTICE 'norm_v2.lookup_key_v2 is not installed; cluster-size guard skipped for eightco.';
  END IF;
END $$;

BEGIN;

-- 1. Journal the three reversible dependents BEFORE repointing them.
--    Same table, same shape and same three tables as norm_v2.merge_cluster.
INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:eightco', 'company_mentions', t.id::text, t.company_id, '45282163-1c8a-4241-8af3-4f9c15cf8d9a'::uuid
  FROM public.company_mentions t
 WHERE t.company_id IN ('46f5b178-60d3-4b0c-8072-35a66d7f8cdb'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:eightco', 'sec_filings', t.id::text, t.company_id, '45282163-1c8a-4241-8af3-4f9c15cf8d9a'::uuid
  FROM public.sec_filings t
 WHERE t.company_id IN ('46f5b178-60d3-4b0c-8072-35a66d7f8cdb'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:eightco', 'insider_transactions', t.id::text, t.company_id, '45282163-1c8a-4241-8af3-4f9c15cf8d9a'::uuid
  FROM public.insider_transactions t
 WHERE t.company_id IN ('46f5b178-60d3-4b0c-8072-35a66d7f8cdb'::uuid);

-- 2. Repoint every dependent that keys on companies.id.
--    financial_facts is NOT journaled, exactly as norm_v2.merge_cluster
--    leaves it. Its repoint is one-way. See the ROLLBACK note below.
UPDATE public.company_mentions SET company_id = '45282163-1c8a-4241-8af3-4f9c15cf8d9a'::uuid
 WHERE company_id IN ('46f5b178-60d3-4b0c-8072-35a66d7f8cdb'::uuid);
UPDATE public.financial_facts SET company_id = '45282163-1c8a-4241-8af3-4f9c15cf8d9a'::uuid
 WHERE company_id IN ('46f5b178-60d3-4b0c-8072-35a66d7f8cdb'::uuid);
UPDATE public.insider_transactions SET company_id = '45282163-1c8a-4241-8af3-4f9c15cf8d9a'::uuid
 WHERE company_id IN ('46f5b178-60d3-4b0c-8072-35a66d7f8cdb'::uuid);
UPDATE public.sec_filings SET company_id = '45282163-1c8a-4241-8af3-4f9c15cf8d9a'::uuid
 WHERE company_id IN ('46f5b178-60d3-4b0c-8072-35a66d7f8cdb'::uuid);

UPDATE public.resolution_log SET resolved_canonical_id = '45282163-1c8a-4241-8af3-4f9c15cf8d9a'::uuid
 WHERE resolved_canonical_id IN ('46f5b178-60d3-4b0c-8072-35a66d7f8cdb'::uuid);

-- candidate_canonical_ids is JSONB holding uuid STRINGS, not uuid[].
UPDATE public.resolution_log rl SET candidate_canonical_ids = sub.fixed
  FROM (SELECT l.id,
               (SELECT jsonb_agg(DISTINCT CASE WHEN e.v IN ('46f5b178-60d3-4b0c-8072-35a66d7f8cdb')
                                          THEN '45282163-1c8a-4241-8af3-4f9c15cf8d9a' ELSE e.v END)
                  FROM jsonb_array_elements_text(l.candidate_canonical_ids) AS e(v)) AS fixed
          FROM public.resolution_log l
         WHERE jsonb_typeof(l.candidate_canonical_ids) = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(l.candidate_canonical_ids) x(v)
                        WHERE x.v IN ('46f5b178-60d3-4b0c-8072-35a66d7f8cdb'))
       ) sub
 WHERE rl.id = sub.id;

-- 3. aliases FK is ON DELETE CASCADE. Repointing before the DELETE is not
--    tidiness, it is the only thing that stops the alias rows being destroyed.
UPDATE public.aliases s
   SET mention_count = greatest(coalesce(s.mention_count,0), coalesce(l.mc,0)),
       last_seen_at  = greatest(s.last_seen_at, l.ls)
  FROM (SELECT lookup_key, max(coalesce(mention_count,0)) AS mc, max(last_seen_at) AS ls
          FROM public.aliases
         WHERE canonical_id IN ('46f5b178-60d3-4b0c-8072-35a66d7f8cdb'::uuid)
         GROUP BY lookup_key) l
 WHERE s.canonical_id = '45282163-1c8a-4241-8af3-4f9c15cf8d9a'::uuid AND s.lookup_key = l.lookup_key;

DELETE FROM public.aliases a
 WHERE a.canonical_id IN ('46f5b178-60d3-4b0c-8072-35a66d7f8cdb'::uuid)
   AND EXISTS (SELECT 1 FROM public.aliases k
                WHERE k.canonical_id = '45282163-1c8a-4241-8af3-4f9c15cf8d9a'::uuid AND k.lookup_key = a.lookup_key);

UPDATE public.aliases SET canonical_id = '45282163-1c8a-4241-8af3-4f9c15cf8d9a'::uuid
 WHERE canonical_id IN ('46f5b178-60d3-4b0c-8072-35a66d7f8cdb'::uuid);

-- 4. Name-keyed dependents. Measured 0 rows for every loser in this set,
--    kept so the block stays correct if one appears between now and apply.
DELETE FROM public.user_memo_regeneration_quota q
 WHERE q.company_id IN ('Eightco Holdings Inc.')
   AND EXISTS (SELECT 1 FROM public.user_memo_regeneration_quota k
                WHERE k.user_id = q.user_id AND k.company_id = 'Eightco'
                  AND k.regenerated_at = q.regenerated_at);
UPDATE public.user_memo_regeneration_quota SET company_id = 'Eightco'
 WHERE company_id IN ('Eightco Holdings Inc.');

-- 5. Record the fold so the step-12 articles repair can see it.
INSERT INTO norm_v2.hand_fold (new_key, loser_id, loser_name, survivor_id, survivor_name)
VALUES
  ('eightco', '46f5b178-60d3-4b0c-8072-35a66d7f8cdb'::uuid, 'Eightco Holdings Inc.', '45282163-1c8a-4241-8af3-4f9c15cf8d9a'::uuid, 'Eightco')
ON CONFLICT DO NOTHING;

-- 6. Fold the survivor's own fields. Aggregates are read BEFORE the DELETE
--    because they read the losers; the DELETE then runs; and no identifier
--    is written at all, so the partial unique index on sec_cik is untouched.
CREATE TEMP TABLE IF NOT EXISTS _fold_agg (k text PRIMARY KEY, mentions bigint, themes text[]);
DELETE FROM _fold_agg WHERE k = 'eightco';
INSERT INTO _fold_agg (k, mentions, themes)
SELECT 'eightco',
       (SELECT sum(coalesce(mention_count,0)) FROM public.companies
         WHERE id IN ('45282163-1c8a-4241-8af3-4f9c15cf8d9a'::uuid, '46f5b178-60d3-4b0c-8072-35a66d7f8cdb'::uuid)),
       (SELECT array_agg(DISTINCT t) FROM public.companies c2,
               unnest(coalesce(c2.key_themes,'{}')) t
         WHERE c2.id IN ('45282163-1c8a-4241-8af3-4f9c15cf8d9a'::uuid, '46f5b178-60d3-4b0c-8072-35a66d7f8cdb'::uuid));

DELETE FROM public.companies
 WHERE id IN ('46f5b178-60d3-4b0c-8072-35a66d7f8cdb'::uuid);

UPDATE public.companies c
   SET mention_count = (SELECT mentions FROM _fold_agg WHERE k = 'eightco'),
       key_themes    = (SELECT themes   FROM _fold_agg WHERE k = 'eightco'),
       last_updated  = now()
 WHERE c.id = '45282163-1c8a-4241-8af3-4f9c15cf8d9a'::uuid;

-- READ-BACK. Look at this BEFORE you COMMIT. Every column must read true.
SELECT
  (SELECT count(*) FROM public.companies WHERE id IN ('46f5b178-60d3-4b0c-8072-35a66d7f8cdb'::uuid)) = 0        AS losers_gone,
  (SELECT count(*) FROM public.companies WHERE id = '45282163-1c8a-4241-8af3-4f9c15cf8d9a'::uuid) = 1 AS survivor_present,
  (SELECT mention_count FROM public.companies WHERE id = '45282163-1c8a-4241-8af3-4f9c15cf8d9a'::uuid) = 65 AS mentions_summed,
  (SELECT ticker IS NOT DISTINCT FROM 'ORBS' FROM public.companies WHERE id = '45282163-1c8a-4241-8af3-4f9c15cf8d9a'::uuid) AS ticker_unchanged,
  (SELECT sec_cik IS NOT DISTINCT FROM 1892492 FROM public.companies WHERE id = '45282163-1c8a-4241-8af3-4f9c15cf8d9a'::uuid) AS cik_unchanged,
  (SELECT count(*) FROM public.company_mentions WHERE company_id IN ('46f5b178-60d3-4b0c-8072-35a66d7f8cdb'::uuid)) = 0 AS mentions_repointed,
  (SELECT count(*) FROM public.aliases WHERE canonical_id IN ('46f5b178-60d3-4b0c-8072-35a66d7f8cdb'::uuid)) = 0 AS aliases_repointed,
  (SELECT count(*) FROM public.financial_facts WHERE company_id IN ('46f5b178-60d3-4b0c-8072-35a66d7f8cdb'::uuid)) = 0 AS facts_repointed;

-- COMMIT;    -- only after every column above read true
-- ROLLBACK;  -- otherwise

-- ROLLBACK AFTER COMMIT. Run in this order, as one transaction.
--   a. Recreate the loser rows. companies_name_key is UNIQUE(name) and
--      companies_name_no_junk is a CHECK, so the names must go back exactly.
--      INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count, sector)
--      VALUES ('46f5b178-60d3-4b0c-8072-35a66d7f8cdb'::uuid, 'Eightco Holdings Inc.', NULL, NULL, 1, 'Technology');
--   b. Restore the survivor's own fields.
--      UPDATE public.companies SET mention_count = 64, last_updated = now()
--       WHERE id = '45282163-1c8a-4241-8af3-4f9c15cf8d9a'::uuid;
--      key_themes was a UNION and is not restorable from this file. It is
--      additive and non-identifying; the pipeline rewrites it.
--   c. Repoint the three journaled tables back off norm_v2.moved_row.
--      UPDATE public.company_mentions t SET company_id = j.from_company_id
--        FROM norm_v2.moved_row j
--       WHERE j.new_key = 'handfold:eightco' AND j.table_name = 'company_mentions'
--         AND t.id::text = j.row_id;
--      (repeat for sec_filings and insider_transactions)
--   d. financial_facts is NOT journaled and CANNOT be repointed back by this
--      file. That matches norm_v2.merge_cluster, which accepts the same
--      one-way cost. If that is unacceptable for a given block, journal
--      financial_facts too before running it.
--   e. aliases and resolution_log follow the same shape as (c) but have no
--      journal. Re-run backend alias resolution rather than hand-restoring.
--   f. DELETE FROM norm_v2.hand_fold WHERE new_key = 'eightco';


-- ---------------------------------------------------------------------
-- BLOCK A5 -- v2 key 'astec industries'   (2 rows -> 1)
--
--   Carrier ASTE / cik 792987, EDGAR agrees.
--   Loser is the same name plus 'Inc.'.
--
--   SURVIVES : 'Astec Industries'  ticker=ASTE  sec_cik=792987
--   FOLDS IN : 'Astec Industries Inc.'  ticker=None  sec_cik=None
--              articles.companies[] holding this name: 1; articles.primary_company: 1
--
--   DISPLAYED NAME AFTER THE FOLD: 'Astec Industries'
--   mention_count on the survivor goes to the cluster sum (64).
--   ticker and sec_cik are NOT written by this block. The survivor either
--   already carries the only identifier in the bucket, or no member has one.
-- ---------------------------------------------------------------------

-- GUARD. Read this first and look at it. Then run the assertion.
SELECT id, name, ticker, sec_cik, mention_count, sector
  FROM public.companies
 WHERE id IN ('187d22a5-417d-4a89-8550-b7417604981e'::uuid, '61a72f12-3c9b-4a01-a2f2-e2e799828f30'::uuid)
 ORDER BY mention_count DESC NULLS LAST, id;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.companies c
   WHERE (c.id = '187d22a5-417d-4a89-8550-b7417604981e'::uuid
              AND c.name = 'Astec Industries Inc.'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 1)
      OR (c.id = '61a72f12-3c9b-4a01-a2f2-e2e799828f30'::uuid
              AND c.name = 'Astec Industries'
              AND c.ticker IS NOT DISTINCT FROM 'ASTE'
              AND c.sec_cik IS NOT DISTINCT FROM 792987
              AND c.mention_count IS NOT DISTINCT FROM 63);
  IF n <> 2 THEN
    RAISE EXCEPTION 'BLOCK A5 GUARD FAILED: expected 2 pinned rows, found %. A row drifted, or this block already ran. DO NOT PROCEED.', n;
  END IF;
  IF to_regprocedure('norm_v2.lookup_key_v2(text)') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.companies WHERE norm_v2.lookup_key_v2(name) = $1'
      INTO n USING 'astec industries';
    IF n <> 2 THEN
      RAISE EXCEPTION 'BLOCK A5 GUARD FAILED: the bucket now holds % rows, not 2. A new member was ingested. Re-measure before folding.', n;
    END IF;
  ELSE
    RAISE NOTICE 'norm_v2.lookup_key_v2 is not installed; cluster-size guard skipped for astec industries.';
  END IF;
END $$;

BEGIN;

-- 1. Journal the three reversible dependents BEFORE repointing them.
--    Same table, same shape and same three tables as norm_v2.merge_cluster.
INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:astec industries', 'company_mentions', t.id::text, t.company_id, '61a72f12-3c9b-4a01-a2f2-e2e799828f30'::uuid
  FROM public.company_mentions t
 WHERE t.company_id IN ('187d22a5-417d-4a89-8550-b7417604981e'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:astec industries', 'sec_filings', t.id::text, t.company_id, '61a72f12-3c9b-4a01-a2f2-e2e799828f30'::uuid
  FROM public.sec_filings t
 WHERE t.company_id IN ('187d22a5-417d-4a89-8550-b7417604981e'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:astec industries', 'insider_transactions', t.id::text, t.company_id, '61a72f12-3c9b-4a01-a2f2-e2e799828f30'::uuid
  FROM public.insider_transactions t
 WHERE t.company_id IN ('187d22a5-417d-4a89-8550-b7417604981e'::uuid);

-- 2. Repoint every dependent that keys on companies.id.
--    financial_facts is NOT journaled, exactly as norm_v2.merge_cluster
--    leaves it. Its repoint is one-way. See the ROLLBACK note below.
UPDATE public.company_mentions SET company_id = '61a72f12-3c9b-4a01-a2f2-e2e799828f30'::uuid
 WHERE company_id IN ('187d22a5-417d-4a89-8550-b7417604981e'::uuid);
UPDATE public.financial_facts SET company_id = '61a72f12-3c9b-4a01-a2f2-e2e799828f30'::uuid
 WHERE company_id IN ('187d22a5-417d-4a89-8550-b7417604981e'::uuid);
UPDATE public.insider_transactions SET company_id = '61a72f12-3c9b-4a01-a2f2-e2e799828f30'::uuid
 WHERE company_id IN ('187d22a5-417d-4a89-8550-b7417604981e'::uuid);
UPDATE public.sec_filings SET company_id = '61a72f12-3c9b-4a01-a2f2-e2e799828f30'::uuid
 WHERE company_id IN ('187d22a5-417d-4a89-8550-b7417604981e'::uuid);

UPDATE public.resolution_log SET resolved_canonical_id = '61a72f12-3c9b-4a01-a2f2-e2e799828f30'::uuid
 WHERE resolved_canonical_id IN ('187d22a5-417d-4a89-8550-b7417604981e'::uuid);

-- candidate_canonical_ids is JSONB holding uuid STRINGS, not uuid[].
UPDATE public.resolution_log rl SET candidate_canonical_ids = sub.fixed
  FROM (SELECT l.id,
               (SELECT jsonb_agg(DISTINCT CASE WHEN e.v IN ('187d22a5-417d-4a89-8550-b7417604981e')
                                          THEN '61a72f12-3c9b-4a01-a2f2-e2e799828f30' ELSE e.v END)
                  FROM jsonb_array_elements_text(l.candidate_canonical_ids) AS e(v)) AS fixed
          FROM public.resolution_log l
         WHERE jsonb_typeof(l.candidate_canonical_ids) = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(l.candidate_canonical_ids) x(v)
                        WHERE x.v IN ('187d22a5-417d-4a89-8550-b7417604981e'))
       ) sub
 WHERE rl.id = sub.id;

-- 3. aliases FK is ON DELETE CASCADE. Repointing before the DELETE is not
--    tidiness, it is the only thing that stops the alias rows being destroyed.
UPDATE public.aliases s
   SET mention_count = greatest(coalesce(s.mention_count,0), coalesce(l.mc,0)),
       last_seen_at  = greatest(s.last_seen_at, l.ls)
  FROM (SELECT lookup_key, max(coalesce(mention_count,0)) AS mc, max(last_seen_at) AS ls
          FROM public.aliases
         WHERE canonical_id IN ('187d22a5-417d-4a89-8550-b7417604981e'::uuid)
         GROUP BY lookup_key) l
 WHERE s.canonical_id = '61a72f12-3c9b-4a01-a2f2-e2e799828f30'::uuid AND s.lookup_key = l.lookup_key;

DELETE FROM public.aliases a
 WHERE a.canonical_id IN ('187d22a5-417d-4a89-8550-b7417604981e'::uuid)
   AND EXISTS (SELECT 1 FROM public.aliases k
                WHERE k.canonical_id = '61a72f12-3c9b-4a01-a2f2-e2e799828f30'::uuid AND k.lookup_key = a.lookup_key);

UPDATE public.aliases SET canonical_id = '61a72f12-3c9b-4a01-a2f2-e2e799828f30'::uuid
 WHERE canonical_id IN ('187d22a5-417d-4a89-8550-b7417604981e'::uuid);

-- 4. Name-keyed dependents. Measured 0 rows for every loser in this set,
--    kept so the block stays correct if one appears between now and apply.
DELETE FROM public.user_memo_regeneration_quota q
 WHERE q.company_id IN ('Astec Industries Inc.')
   AND EXISTS (SELECT 1 FROM public.user_memo_regeneration_quota k
                WHERE k.user_id = q.user_id AND k.company_id = 'Astec Industries'
                  AND k.regenerated_at = q.regenerated_at);
UPDATE public.user_memo_regeneration_quota SET company_id = 'Astec Industries'
 WHERE company_id IN ('Astec Industries Inc.');

-- 5. Record the fold so the step-12 articles repair can see it.
INSERT INTO norm_v2.hand_fold (new_key, loser_id, loser_name, survivor_id, survivor_name)
VALUES
  ('astec industries', '187d22a5-417d-4a89-8550-b7417604981e'::uuid, 'Astec Industries Inc.', '61a72f12-3c9b-4a01-a2f2-e2e799828f30'::uuid, 'Astec Industries')
ON CONFLICT DO NOTHING;

-- 6. Fold the survivor's own fields. Aggregates are read BEFORE the DELETE
--    because they read the losers; the DELETE then runs; and no identifier
--    is written at all, so the partial unique index on sec_cik is untouched.
CREATE TEMP TABLE IF NOT EXISTS _fold_agg (k text PRIMARY KEY, mentions bigint, themes text[]);
DELETE FROM _fold_agg WHERE k = 'astec industries';
INSERT INTO _fold_agg (k, mentions, themes)
SELECT 'astec industries',
       (SELECT sum(coalesce(mention_count,0)) FROM public.companies
         WHERE id IN ('187d22a5-417d-4a89-8550-b7417604981e'::uuid, '61a72f12-3c9b-4a01-a2f2-e2e799828f30'::uuid)),
       (SELECT array_agg(DISTINCT t) FROM public.companies c2,
               unnest(coalesce(c2.key_themes,'{}')) t
         WHERE c2.id IN ('187d22a5-417d-4a89-8550-b7417604981e'::uuid, '61a72f12-3c9b-4a01-a2f2-e2e799828f30'::uuid));

DELETE FROM public.companies
 WHERE id IN ('187d22a5-417d-4a89-8550-b7417604981e'::uuid);

UPDATE public.companies c
   SET mention_count = (SELECT mentions FROM _fold_agg WHERE k = 'astec industries'),
       key_themes    = (SELECT themes   FROM _fold_agg WHERE k = 'astec industries'),
       last_updated  = now()
 WHERE c.id = '61a72f12-3c9b-4a01-a2f2-e2e799828f30'::uuid;

-- READ-BACK. Look at this BEFORE you COMMIT. Every column must read true.
SELECT
  (SELECT count(*) FROM public.companies WHERE id IN ('187d22a5-417d-4a89-8550-b7417604981e'::uuid)) = 0        AS losers_gone,
  (SELECT count(*) FROM public.companies WHERE id = '61a72f12-3c9b-4a01-a2f2-e2e799828f30'::uuid) = 1 AS survivor_present,
  (SELECT mention_count FROM public.companies WHERE id = '61a72f12-3c9b-4a01-a2f2-e2e799828f30'::uuid) = 64 AS mentions_summed,
  (SELECT ticker IS NOT DISTINCT FROM 'ASTE' FROM public.companies WHERE id = '61a72f12-3c9b-4a01-a2f2-e2e799828f30'::uuid) AS ticker_unchanged,
  (SELECT sec_cik IS NOT DISTINCT FROM 792987 FROM public.companies WHERE id = '61a72f12-3c9b-4a01-a2f2-e2e799828f30'::uuid) AS cik_unchanged,
  (SELECT count(*) FROM public.company_mentions WHERE company_id IN ('187d22a5-417d-4a89-8550-b7417604981e'::uuid)) = 0 AS mentions_repointed,
  (SELECT count(*) FROM public.aliases WHERE canonical_id IN ('187d22a5-417d-4a89-8550-b7417604981e'::uuid)) = 0 AS aliases_repointed,
  (SELECT count(*) FROM public.financial_facts WHERE company_id IN ('187d22a5-417d-4a89-8550-b7417604981e'::uuid)) = 0 AS facts_repointed;

-- COMMIT;    -- only after every column above read true
-- ROLLBACK;  -- otherwise

-- ROLLBACK AFTER COMMIT. Run in this order, as one transaction.
--   a. Recreate the loser rows. companies_name_key is UNIQUE(name) and
--      companies_name_no_junk is a CHECK, so the names must go back exactly.
--      INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count, sector)
--      VALUES ('187d22a5-417d-4a89-8550-b7417604981e'::uuid, 'Astec Industries Inc.', NULL, NULL, 1, NULL);
--   b. Restore the survivor's own fields.
--      UPDATE public.companies SET mention_count = 63, last_updated = now()
--       WHERE id = '61a72f12-3c9b-4a01-a2f2-e2e799828f30'::uuid;
--      key_themes was a UNION and is not restorable from this file. It is
--      additive and non-identifying; the pipeline rewrites it.
--   c. Repoint the three journaled tables back off norm_v2.moved_row.
--      UPDATE public.company_mentions t SET company_id = j.from_company_id
--        FROM norm_v2.moved_row j
--       WHERE j.new_key = 'handfold:astec industries' AND j.table_name = 'company_mentions'
--         AND t.id::text = j.row_id;
--      (repeat for sec_filings and insider_transactions)
--   d. financial_facts is NOT journaled and CANNOT be repointed back by this
--      file. That matches norm_v2.merge_cluster, which accepts the same
--      one-way cost. If that is unacceptable for a given block, journal
--      financial_facts too before running it.
--   e. aliases and resolution_log follow the same shape as (c) but have no
--      journal. Re-run backend alias resolution rather than hand-restoring.
--   f. DELETE FROM norm_v2.hand_fold WHERE new_key = 'astec industries';


-- ---------------------------------------------------------------------
-- BLOCK A6 -- v2 key 'comcast'   (2 rows -> 1)
--
--   Carrier CCZ / cik 1166691.
--   EDGAR itself maps cik 1166691 to ticker CCZ, so the repo's own authority agrees; the symbol looks odd only because Comcast has several listed classes and company_tickers.json carries one per cik.
--
--   SURVIVES : 'Comcast'  ticker=CCZ  sec_cik=1166691
--   FOLDS IN : 'Comcast Corp'  ticker=None  sec_cik=None
--              articles.companies[] holding this name: 1; articles.primary_company: 4
--
--   DISPLAYED NAME AFTER THE FOLD: 'Comcast'
--   mention_count on the survivor goes to the cluster sum (57).
--   ticker and sec_cik are NOT written by this block. The survivor either
--   already carries the only identifier in the bucket, or no member has one.
-- ---------------------------------------------------------------------

-- GUARD. Read this first and look at it. Then run the assertion.
SELECT id, name, ticker, sec_cik, mention_count, sector
  FROM public.companies
 WHERE id IN ('0bb68d62-b42e-4c92-a369-267e6dcbebd2'::uuid, '94869a5e-64b2-4cea-a42f-e178e1584f0b'::uuid)
 ORDER BY mention_count DESC NULLS LAST, id;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.companies c
   WHERE (c.id = '0bb68d62-b42e-4c92-a369-267e6dcbebd2'::uuid
              AND c.name = 'Comcast'
              AND c.ticker IS NOT DISTINCT FROM 'CCZ'
              AND c.sec_cik IS NOT DISTINCT FROM 1166691
              AND c.mention_count IS NOT DISTINCT FROM 56)
      OR (c.id = '94869a5e-64b2-4cea-a42f-e178e1584f0b'::uuid
              AND c.name = 'Comcast Corp'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 1);
  IF n <> 2 THEN
    RAISE EXCEPTION 'BLOCK A6 GUARD FAILED: expected 2 pinned rows, found %. A row drifted, or this block already ran. DO NOT PROCEED.', n;
  END IF;
  IF to_regprocedure('norm_v2.lookup_key_v2(text)') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.companies WHERE norm_v2.lookup_key_v2(name) = $1'
      INTO n USING 'comcast';
    IF n <> 2 THEN
      RAISE EXCEPTION 'BLOCK A6 GUARD FAILED: the bucket now holds % rows, not 2. A new member was ingested. Re-measure before folding.', n;
    END IF;
  ELSE
    RAISE NOTICE 'norm_v2.lookup_key_v2 is not installed; cluster-size guard skipped for comcast.';
  END IF;
END $$;

BEGIN;

-- 1. Journal the three reversible dependents BEFORE repointing them.
--    Same table, same shape and same three tables as norm_v2.merge_cluster.
INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:comcast', 'company_mentions', t.id::text, t.company_id, '0bb68d62-b42e-4c92-a369-267e6dcbebd2'::uuid
  FROM public.company_mentions t
 WHERE t.company_id IN ('94869a5e-64b2-4cea-a42f-e178e1584f0b'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:comcast', 'sec_filings', t.id::text, t.company_id, '0bb68d62-b42e-4c92-a369-267e6dcbebd2'::uuid
  FROM public.sec_filings t
 WHERE t.company_id IN ('94869a5e-64b2-4cea-a42f-e178e1584f0b'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:comcast', 'insider_transactions', t.id::text, t.company_id, '0bb68d62-b42e-4c92-a369-267e6dcbebd2'::uuid
  FROM public.insider_transactions t
 WHERE t.company_id IN ('94869a5e-64b2-4cea-a42f-e178e1584f0b'::uuid);

-- 2. Repoint every dependent that keys on companies.id.
--    financial_facts is NOT journaled, exactly as norm_v2.merge_cluster
--    leaves it. Its repoint is one-way. See the ROLLBACK note below.
UPDATE public.company_mentions SET company_id = '0bb68d62-b42e-4c92-a369-267e6dcbebd2'::uuid
 WHERE company_id IN ('94869a5e-64b2-4cea-a42f-e178e1584f0b'::uuid);
UPDATE public.financial_facts SET company_id = '0bb68d62-b42e-4c92-a369-267e6dcbebd2'::uuid
 WHERE company_id IN ('94869a5e-64b2-4cea-a42f-e178e1584f0b'::uuid);
UPDATE public.insider_transactions SET company_id = '0bb68d62-b42e-4c92-a369-267e6dcbebd2'::uuid
 WHERE company_id IN ('94869a5e-64b2-4cea-a42f-e178e1584f0b'::uuid);
UPDATE public.sec_filings SET company_id = '0bb68d62-b42e-4c92-a369-267e6dcbebd2'::uuid
 WHERE company_id IN ('94869a5e-64b2-4cea-a42f-e178e1584f0b'::uuid);

UPDATE public.resolution_log SET resolved_canonical_id = '0bb68d62-b42e-4c92-a369-267e6dcbebd2'::uuid
 WHERE resolved_canonical_id IN ('94869a5e-64b2-4cea-a42f-e178e1584f0b'::uuid);

-- candidate_canonical_ids is JSONB holding uuid STRINGS, not uuid[].
UPDATE public.resolution_log rl SET candidate_canonical_ids = sub.fixed
  FROM (SELECT l.id,
               (SELECT jsonb_agg(DISTINCT CASE WHEN e.v IN ('94869a5e-64b2-4cea-a42f-e178e1584f0b')
                                          THEN '0bb68d62-b42e-4c92-a369-267e6dcbebd2' ELSE e.v END)
                  FROM jsonb_array_elements_text(l.candidate_canonical_ids) AS e(v)) AS fixed
          FROM public.resolution_log l
         WHERE jsonb_typeof(l.candidate_canonical_ids) = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(l.candidate_canonical_ids) x(v)
                        WHERE x.v IN ('94869a5e-64b2-4cea-a42f-e178e1584f0b'))
       ) sub
 WHERE rl.id = sub.id;

-- 3. aliases FK is ON DELETE CASCADE. Repointing before the DELETE is not
--    tidiness, it is the only thing that stops the alias rows being destroyed.
UPDATE public.aliases s
   SET mention_count = greatest(coalesce(s.mention_count,0), coalesce(l.mc,0)),
       last_seen_at  = greatest(s.last_seen_at, l.ls)
  FROM (SELECT lookup_key, max(coalesce(mention_count,0)) AS mc, max(last_seen_at) AS ls
          FROM public.aliases
         WHERE canonical_id IN ('94869a5e-64b2-4cea-a42f-e178e1584f0b'::uuid)
         GROUP BY lookup_key) l
 WHERE s.canonical_id = '0bb68d62-b42e-4c92-a369-267e6dcbebd2'::uuid AND s.lookup_key = l.lookup_key;

DELETE FROM public.aliases a
 WHERE a.canonical_id IN ('94869a5e-64b2-4cea-a42f-e178e1584f0b'::uuid)
   AND EXISTS (SELECT 1 FROM public.aliases k
                WHERE k.canonical_id = '0bb68d62-b42e-4c92-a369-267e6dcbebd2'::uuid AND k.lookup_key = a.lookup_key);

UPDATE public.aliases SET canonical_id = '0bb68d62-b42e-4c92-a369-267e6dcbebd2'::uuid
 WHERE canonical_id IN ('94869a5e-64b2-4cea-a42f-e178e1584f0b'::uuid);

-- 4. Name-keyed dependents. Measured 0 rows for every loser in this set,
--    kept so the block stays correct if one appears between now and apply.
DELETE FROM public.user_memo_regeneration_quota q
 WHERE q.company_id IN ('Comcast Corp')
   AND EXISTS (SELECT 1 FROM public.user_memo_regeneration_quota k
                WHERE k.user_id = q.user_id AND k.company_id = 'Comcast'
                  AND k.regenerated_at = q.regenerated_at);
UPDATE public.user_memo_regeneration_quota SET company_id = 'Comcast'
 WHERE company_id IN ('Comcast Corp');

-- 5. Record the fold so the step-12 articles repair can see it.
INSERT INTO norm_v2.hand_fold (new_key, loser_id, loser_name, survivor_id, survivor_name)
VALUES
  ('comcast', '94869a5e-64b2-4cea-a42f-e178e1584f0b'::uuid, 'Comcast Corp', '0bb68d62-b42e-4c92-a369-267e6dcbebd2'::uuid, 'Comcast')
ON CONFLICT DO NOTHING;

-- 6. Fold the survivor's own fields. Aggregates are read BEFORE the DELETE
--    because they read the losers; the DELETE then runs; and no identifier
--    is written at all, so the partial unique index on sec_cik is untouched.
CREATE TEMP TABLE IF NOT EXISTS _fold_agg (k text PRIMARY KEY, mentions bigint, themes text[]);
DELETE FROM _fold_agg WHERE k = 'comcast';
INSERT INTO _fold_agg (k, mentions, themes)
SELECT 'comcast',
       (SELECT sum(coalesce(mention_count,0)) FROM public.companies
         WHERE id IN ('0bb68d62-b42e-4c92-a369-267e6dcbebd2'::uuid, '94869a5e-64b2-4cea-a42f-e178e1584f0b'::uuid)),
       (SELECT array_agg(DISTINCT t) FROM public.companies c2,
               unnest(coalesce(c2.key_themes,'{}')) t
         WHERE c2.id IN ('0bb68d62-b42e-4c92-a369-267e6dcbebd2'::uuid, '94869a5e-64b2-4cea-a42f-e178e1584f0b'::uuid));

DELETE FROM public.companies
 WHERE id IN ('94869a5e-64b2-4cea-a42f-e178e1584f0b'::uuid);

UPDATE public.companies c
   SET mention_count = (SELECT mentions FROM _fold_agg WHERE k = 'comcast'),
       key_themes    = (SELECT themes   FROM _fold_agg WHERE k = 'comcast'),
       last_updated  = now()
 WHERE c.id = '0bb68d62-b42e-4c92-a369-267e6dcbebd2'::uuid;

-- READ-BACK. Look at this BEFORE you COMMIT. Every column must read true.
SELECT
  (SELECT count(*) FROM public.companies WHERE id IN ('94869a5e-64b2-4cea-a42f-e178e1584f0b'::uuid)) = 0        AS losers_gone,
  (SELECT count(*) FROM public.companies WHERE id = '0bb68d62-b42e-4c92-a369-267e6dcbebd2'::uuid) = 1 AS survivor_present,
  (SELECT mention_count FROM public.companies WHERE id = '0bb68d62-b42e-4c92-a369-267e6dcbebd2'::uuid) = 57 AS mentions_summed,
  (SELECT ticker IS NOT DISTINCT FROM 'CCZ' FROM public.companies WHERE id = '0bb68d62-b42e-4c92-a369-267e6dcbebd2'::uuid) AS ticker_unchanged,
  (SELECT sec_cik IS NOT DISTINCT FROM 1166691 FROM public.companies WHERE id = '0bb68d62-b42e-4c92-a369-267e6dcbebd2'::uuid) AS cik_unchanged,
  (SELECT count(*) FROM public.company_mentions WHERE company_id IN ('94869a5e-64b2-4cea-a42f-e178e1584f0b'::uuid)) = 0 AS mentions_repointed,
  (SELECT count(*) FROM public.aliases WHERE canonical_id IN ('94869a5e-64b2-4cea-a42f-e178e1584f0b'::uuid)) = 0 AS aliases_repointed,
  (SELECT count(*) FROM public.financial_facts WHERE company_id IN ('94869a5e-64b2-4cea-a42f-e178e1584f0b'::uuid)) = 0 AS facts_repointed;

-- COMMIT;    -- only after every column above read true
-- ROLLBACK;  -- otherwise

-- ROLLBACK AFTER COMMIT. Run in this order, as one transaction.
--   a. Recreate the loser rows. companies_name_key is UNIQUE(name) and
--      companies_name_no_junk is a CHECK, so the names must go back exactly.
--      INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count, sector)
--      VALUES ('94869a5e-64b2-4cea-a42f-e178e1584f0b'::uuid, 'Comcast Corp', NULL, NULL, 1, NULL);
--   b. Restore the survivor's own fields.
--      UPDATE public.companies SET mention_count = 56, last_updated = now()
--       WHERE id = '0bb68d62-b42e-4c92-a369-267e6dcbebd2'::uuid;
--      key_themes was a UNION and is not restorable from this file. It is
--      additive and non-identifying; the pipeline rewrites it.
--   c. Repoint the three journaled tables back off norm_v2.moved_row.
--      UPDATE public.company_mentions t SET company_id = j.from_company_id
--        FROM norm_v2.moved_row j
--       WHERE j.new_key = 'handfold:comcast' AND j.table_name = 'company_mentions'
--         AND t.id::text = j.row_id;
--      (repeat for sec_filings and insider_transactions)
--   d. financial_facts is NOT journaled and CANNOT be repointed back by this
--      file. That matches norm_v2.merge_cluster, which accepts the same
--      one-way cost. If that is unacceptable for a given block, journal
--      financial_facts too before running it.
--   e. aliases and resolution_log follow the same shape as (c) but have no
--      journal. Re-run backend alias resolution rather than hand-restoring.
--   f. DELETE FROM norm_v2.hand_fold WHERE new_key = 'comcast';


-- ---------------------------------------------------------------------
-- BLOCK A7 -- v2 key 'athena technology acquisition corp ii'   (2 rows -> 1)
--
--   Carrier ATEK / cik 1882198.
--   EDGAR title matches exactly; EDGAR lists the warrant class ATEKW against that cik.
--   Same issuer, different share class.
--   Noted, not blocking.
--
--   SURVIVES : 'Athena Technology Acquisition Corp. II'  ticker=ATEK  sec_cik=1882198
--   FOLDS IN : 'Athena Technology Acquisition Corp II'  ticker=None  sec_cik=None
--              articles.companies[] holding this name: 1; articles.primary_company: 1
--
--   DISPLAYED NAME AFTER THE FOLD: 'Athena Technology Acquisition Corp. II'
--   mention_count on the survivor goes to the cluster sum (10).
--   ticker and sec_cik are NOT written by this block. The survivor either
--   already carries the only identifier in the bucket, or no member has one.
-- ---------------------------------------------------------------------

-- GUARD. Read this first and look at it. Then run the assertion.
SELECT id, name, ticker, sec_cik, mention_count, sector
  FROM public.companies
 WHERE id IN ('1e637ec8-a918-48b9-9a0f-197c1b03c344'::uuid, '27835946-2d3b-429b-a502-06289bdecccb'::uuid)
 ORDER BY mention_count DESC NULLS LAST, id;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.companies c
   WHERE (c.id = '1e637ec8-a918-48b9-9a0f-197c1b03c344'::uuid
              AND c.name = 'Athena Technology Acquisition Corp II'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 1)
      OR (c.id = '27835946-2d3b-429b-a502-06289bdecccb'::uuid
              AND c.name = 'Athena Technology Acquisition Corp. II'
              AND c.ticker IS NOT DISTINCT FROM 'ATEK'
              AND c.sec_cik IS NOT DISTINCT FROM 1882198
              AND c.mention_count IS NOT DISTINCT FROM 9);
  IF n <> 2 THEN
    RAISE EXCEPTION 'BLOCK A7 GUARD FAILED: expected 2 pinned rows, found %. A row drifted, or this block already ran. DO NOT PROCEED.', n;
  END IF;
  IF to_regprocedure('norm_v2.lookup_key_v2(text)') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.companies WHERE norm_v2.lookup_key_v2(name) = $1'
      INTO n USING 'athena technology acquisition corp ii';
    IF n <> 2 THEN
      RAISE EXCEPTION 'BLOCK A7 GUARD FAILED: the bucket now holds % rows, not 2. A new member was ingested. Re-measure before folding.', n;
    END IF;
  ELSE
    RAISE NOTICE 'norm_v2.lookup_key_v2 is not installed; cluster-size guard skipped for athena technology acquisition corp ii.';
  END IF;
END $$;

BEGIN;

-- 1. Journal the three reversible dependents BEFORE repointing them.
--    Same table, same shape and same three tables as norm_v2.merge_cluster.
INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:athena technology acquisition corp ii', 'company_mentions', t.id::text, t.company_id, '27835946-2d3b-429b-a502-06289bdecccb'::uuid
  FROM public.company_mentions t
 WHERE t.company_id IN ('1e637ec8-a918-48b9-9a0f-197c1b03c344'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:athena technology acquisition corp ii', 'sec_filings', t.id::text, t.company_id, '27835946-2d3b-429b-a502-06289bdecccb'::uuid
  FROM public.sec_filings t
 WHERE t.company_id IN ('1e637ec8-a918-48b9-9a0f-197c1b03c344'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:athena technology acquisition corp ii', 'insider_transactions', t.id::text, t.company_id, '27835946-2d3b-429b-a502-06289bdecccb'::uuid
  FROM public.insider_transactions t
 WHERE t.company_id IN ('1e637ec8-a918-48b9-9a0f-197c1b03c344'::uuid);

-- 2. Repoint every dependent that keys on companies.id.
--    financial_facts is NOT journaled, exactly as norm_v2.merge_cluster
--    leaves it. Its repoint is one-way. See the ROLLBACK note below.
UPDATE public.company_mentions SET company_id = '27835946-2d3b-429b-a502-06289bdecccb'::uuid
 WHERE company_id IN ('1e637ec8-a918-48b9-9a0f-197c1b03c344'::uuid);
UPDATE public.financial_facts SET company_id = '27835946-2d3b-429b-a502-06289bdecccb'::uuid
 WHERE company_id IN ('1e637ec8-a918-48b9-9a0f-197c1b03c344'::uuid);
UPDATE public.insider_transactions SET company_id = '27835946-2d3b-429b-a502-06289bdecccb'::uuid
 WHERE company_id IN ('1e637ec8-a918-48b9-9a0f-197c1b03c344'::uuid);
UPDATE public.sec_filings SET company_id = '27835946-2d3b-429b-a502-06289bdecccb'::uuid
 WHERE company_id IN ('1e637ec8-a918-48b9-9a0f-197c1b03c344'::uuid);

UPDATE public.resolution_log SET resolved_canonical_id = '27835946-2d3b-429b-a502-06289bdecccb'::uuid
 WHERE resolved_canonical_id IN ('1e637ec8-a918-48b9-9a0f-197c1b03c344'::uuid);

-- candidate_canonical_ids is JSONB holding uuid STRINGS, not uuid[].
UPDATE public.resolution_log rl SET candidate_canonical_ids = sub.fixed
  FROM (SELECT l.id,
               (SELECT jsonb_agg(DISTINCT CASE WHEN e.v IN ('1e637ec8-a918-48b9-9a0f-197c1b03c344')
                                          THEN '27835946-2d3b-429b-a502-06289bdecccb' ELSE e.v END)
                  FROM jsonb_array_elements_text(l.candidate_canonical_ids) AS e(v)) AS fixed
          FROM public.resolution_log l
         WHERE jsonb_typeof(l.candidate_canonical_ids) = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(l.candidate_canonical_ids) x(v)
                        WHERE x.v IN ('1e637ec8-a918-48b9-9a0f-197c1b03c344'))
       ) sub
 WHERE rl.id = sub.id;

-- 3. aliases FK is ON DELETE CASCADE. Repointing before the DELETE is not
--    tidiness, it is the only thing that stops the alias rows being destroyed.
UPDATE public.aliases s
   SET mention_count = greatest(coalesce(s.mention_count,0), coalesce(l.mc,0)),
       last_seen_at  = greatest(s.last_seen_at, l.ls)
  FROM (SELECT lookup_key, max(coalesce(mention_count,0)) AS mc, max(last_seen_at) AS ls
          FROM public.aliases
         WHERE canonical_id IN ('1e637ec8-a918-48b9-9a0f-197c1b03c344'::uuid)
         GROUP BY lookup_key) l
 WHERE s.canonical_id = '27835946-2d3b-429b-a502-06289bdecccb'::uuid AND s.lookup_key = l.lookup_key;

DELETE FROM public.aliases a
 WHERE a.canonical_id IN ('1e637ec8-a918-48b9-9a0f-197c1b03c344'::uuid)
   AND EXISTS (SELECT 1 FROM public.aliases k
                WHERE k.canonical_id = '27835946-2d3b-429b-a502-06289bdecccb'::uuid AND k.lookup_key = a.lookup_key);

UPDATE public.aliases SET canonical_id = '27835946-2d3b-429b-a502-06289bdecccb'::uuid
 WHERE canonical_id IN ('1e637ec8-a918-48b9-9a0f-197c1b03c344'::uuid);

-- 4. Name-keyed dependents. Measured 0 rows for every loser in this set,
--    kept so the block stays correct if one appears between now and apply.
DELETE FROM public.user_memo_regeneration_quota q
 WHERE q.company_id IN ('Athena Technology Acquisition Corp II')
   AND EXISTS (SELECT 1 FROM public.user_memo_regeneration_quota k
                WHERE k.user_id = q.user_id AND k.company_id = 'Athena Technology Acquisition Corp. II'
                  AND k.regenerated_at = q.regenerated_at);
UPDATE public.user_memo_regeneration_quota SET company_id = 'Athena Technology Acquisition Corp. II'
 WHERE company_id IN ('Athena Technology Acquisition Corp II');

-- 5. Record the fold so the step-12 articles repair can see it.
INSERT INTO norm_v2.hand_fold (new_key, loser_id, loser_name, survivor_id, survivor_name)
VALUES
  ('athena technology acquisition corp ii', '1e637ec8-a918-48b9-9a0f-197c1b03c344'::uuid, 'Athena Technology Acquisition Corp II', '27835946-2d3b-429b-a502-06289bdecccb'::uuid, 'Athena Technology Acquisition Corp. II')
ON CONFLICT DO NOTHING;

-- 6. Fold the survivor's own fields. Aggregates are read BEFORE the DELETE
--    because they read the losers; the DELETE then runs; and no identifier
--    is written at all, so the partial unique index on sec_cik is untouched.
CREATE TEMP TABLE IF NOT EXISTS _fold_agg (k text PRIMARY KEY, mentions bigint, themes text[]);
DELETE FROM _fold_agg WHERE k = 'athena technology acquisition corp ii';
INSERT INTO _fold_agg (k, mentions, themes)
SELECT 'athena technology acquisition corp ii',
       (SELECT sum(coalesce(mention_count,0)) FROM public.companies
         WHERE id IN ('1e637ec8-a918-48b9-9a0f-197c1b03c344'::uuid, '27835946-2d3b-429b-a502-06289bdecccb'::uuid)),
       (SELECT array_agg(DISTINCT t) FROM public.companies c2,
               unnest(coalesce(c2.key_themes,'{}')) t
         WHERE c2.id IN ('1e637ec8-a918-48b9-9a0f-197c1b03c344'::uuid, '27835946-2d3b-429b-a502-06289bdecccb'::uuid));

DELETE FROM public.companies
 WHERE id IN ('1e637ec8-a918-48b9-9a0f-197c1b03c344'::uuid);

UPDATE public.companies c
   SET mention_count = (SELECT mentions FROM _fold_agg WHERE k = 'athena technology acquisition corp ii'),
       key_themes    = (SELECT themes   FROM _fold_agg WHERE k = 'athena technology acquisition corp ii'),
       last_updated  = now()
 WHERE c.id = '27835946-2d3b-429b-a502-06289bdecccb'::uuid;

-- READ-BACK. Look at this BEFORE you COMMIT. Every column must read true.
SELECT
  (SELECT count(*) FROM public.companies WHERE id IN ('1e637ec8-a918-48b9-9a0f-197c1b03c344'::uuid)) = 0        AS losers_gone,
  (SELECT count(*) FROM public.companies WHERE id = '27835946-2d3b-429b-a502-06289bdecccb'::uuid) = 1 AS survivor_present,
  (SELECT mention_count FROM public.companies WHERE id = '27835946-2d3b-429b-a502-06289bdecccb'::uuid) = 10 AS mentions_summed,
  (SELECT ticker IS NOT DISTINCT FROM 'ATEK' FROM public.companies WHERE id = '27835946-2d3b-429b-a502-06289bdecccb'::uuid) AS ticker_unchanged,
  (SELECT sec_cik IS NOT DISTINCT FROM 1882198 FROM public.companies WHERE id = '27835946-2d3b-429b-a502-06289bdecccb'::uuid) AS cik_unchanged,
  (SELECT count(*) FROM public.company_mentions WHERE company_id IN ('1e637ec8-a918-48b9-9a0f-197c1b03c344'::uuid)) = 0 AS mentions_repointed,
  (SELECT count(*) FROM public.aliases WHERE canonical_id IN ('1e637ec8-a918-48b9-9a0f-197c1b03c344'::uuid)) = 0 AS aliases_repointed,
  (SELECT count(*) FROM public.financial_facts WHERE company_id IN ('1e637ec8-a918-48b9-9a0f-197c1b03c344'::uuid)) = 0 AS facts_repointed;

-- COMMIT;    -- only after every column above read true
-- ROLLBACK;  -- otherwise

-- ROLLBACK AFTER COMMIT. Run in this order, as one transaction.
--   a. Recreate the loser rows. companies_name_key is UNIQUE(name) and
--      companies_name_no_junk is a CHECK, so the names must go back exactly.
--      INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count, sector)
--      VALUES ('1e637ec8-a918-48b9-9a0f-197c1b03c344'::uuid, 'Athena Technology Acquisition Corp II', NULL, NULL, 1, 'Financial Services');
--   b. Restore the survivor's own fields.
--      UPDATE public.companies SET mention_count = 9, last_updated = now()
--       WHERE id = '27835946-2d3b-429b-a502-06289bdecccb'::uuid;
--      key_themes was a UNION and is not restorable from this file. It is
--      additive and non-identifying; the pipeline rewrites it.
--   c. Repoint the three journaled tables back off norm_v2.moved_row.
--      UPDATE public.company_mentions t SET company_id = j.from_company_id
--        FROM norm_v2.moved_row j
--       WHERE j.new_key = 'handfold:athena technology acquisition corp ii' AND j.table_name = 'company_mentions'
--         AND t.id::text = j.row_id;
--      (repeat for sec_filings and insider_transactions)
--   d. financial_facts is NOT journaled and CANNOT be repointed back by this
--      file. That matches norm_v2.merge_cluster, which accepts the same
--      one-way cost. If that is unacceptable for a given block, journal
--      financial_facts too before running it.
--   e. aliases and resolution_log follow the same shape as (c) but have no
--      journal. Re-run backend alias resolution rather than hand-restoring.
--   f. DELETE FROM norm_v2.hand_fold WHERE new_key = 'athena technology acquisition corp ii';


-- ---------------------------------------------------------------------
-- BLOCK A8 -- v2 key 'brown forman'   (2 rows -> 1)
--
--   No identifier on either row, under any path.
--   Both names are Brown-Forman, same sector.
--
--   SURVIVES : 'Brown-Forman'  ticker=None  sec_cik=None
--   FOLDS IN : 'Brown-Forman Corporation'  ticker=None  sec_cik=None
--              articles.companies[] holding this name: 1; articles.primary_company: 1
--
--   DISPLAYED NAME AFTER THE FOLD: 'Brown-Forman'
--   mention_count on the survivor goes to the cluster sum (7).
--   ticker and sec_cik are NOT written by this block. The survivor either
--   already carries the only identifier in the bucket, or no member has one.
-- ---------------------------------------------------------------------

-- GUARD. Read this first and look at it. Then run the assertion.
SELECT id, name, ticker, sec_cik, mention_count, sector
  FROM public.companies
 WHERE id IN ('4aaac895-acf3-4cbc-8b2e-74c31547cf7e'::uuid, 'b7799ff1-bc50-4620-ba21-85cd3c90204b'::uuid)
 ORDER BY mention_count DESC NULLS LAST, id;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.companies c
   WHERE (c.id = '4aaac895-acf3-4cbc-8b2e-74c31547cf7e'::uuid
              AND c.name = 'Brown-Forman Corporation'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 1)
      OR (c.id = 'b7799ff1-bc50-4620-ba21-85cd3c90204b'::uuid
              AND c.name = 'Brown-Forman'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 6);
  IF n <> 2 THEN
    RAISE EXCEPTION 'BLOCK A8 GUARD FAILED: expected 2 pinned rows, found %. A row drifted, or this block already ran. DO NOT PROCEED.', n;
  END IF;
  IF to_regprocedure('norm_v2.lookup_key_v2(text)') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.companies WHERE norm_v2.lookup_key_v2(name) = $1'
      INTO n USING 'brown forman';
    IF n <> 2 THEN
      RAISE EXCEPTION 'BLOCK A8 GUARD FAILED: the bucket now holds % rows, not 2. A new member was ingested. Re-measure before folding.', n;
    END IF;
  ELSE
    RAISE NOTICE 'norm_v2.lookup_key_v2 is not installed; cluster-size guard skipped for brown forman.';
  END IF;
END $$;

BEGIN;

-- 1. Journal the three reversible dependents BEFORE repointing them.
--    Same table, same shape and same three tables as norm_v2.merge_cluster.
INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:brown forman', 'company_mentions', t.id::text, t.company_id, 'b7799ff1-bc50-4620-ba21-85cd3c90204b'::uuid
  FROM public.company_mentions t
 WHERE t.company_id IN ('4aaac895-acf3-4cbc-8b2e-74c31547cf7e'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:brown forman', 'sec_filings', t.id::text, t.company_id, 'b7799ff1-bc50-4620-ba21-85cd3c90204b'::uuid
  FROM public.sec_filings t
 WHERE t.company_id IN ('4aaac895-acf3-4cbc-8b2e-74c31547cf7e'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:brown forman', 'insider_transactions', t.id::text, t.company_id, 'b7799ff1-bc50-4620-ba21-85cd3c90204b'::uuid
  FROM public.insider_transactions t
 WHERE t.company_id IN ('4aaac895-acf3-4cbc-8b2e-74c31547cf7e'::uuid);

-- 2. Repoint every dependent that keys on companies.id.
--    financial_facts is NOT journaled, exactly as norm_v2.merge_cluster
--    leaves it. Its repoint is one-way. See the ROLLBACK note below.
UPDATE public.company_mentions SET company_id = 'b7799ff1-bc50-4620-ba21-85cd3c90204b'::uuid
 WHERE company_id IN ('4aaac895-acf3-4cbc-8b2e-74c31547cf7e'::uuid);
UPDATE public.financial_facts SET company_id = 'b7799ff1-bc50-4620-ba21-85cd3c90204b'::uuid
 WHERE company_id IN ('4aaac895-acf3-4cbc-8b2e-74c31547cf7e'::uuid);
UPDATE public.insider_transactions SET company_id = 'b7799ff1-bc50-4620-ba21-85cd3c90204b'::uuid
 WHERE company_id IN ('4aaac895-acf3-4cbc-8b2e-74c31547cf7e'::uuid);
UPDATE public.sec_filings SET company_id = 'b7799ff1-bc50-4620-ba21-85cd3c90204b'::uuid
 WHERE company_id IN ('4aaac895-acf3-4cbc-8b2e-74c31547cf7e'::uuid);

UPDATE public.resolution_log SET resolved_canonical_id = 'b7799ff1-bc50-4620-ba21-85cd3c90204b'::uuid
 WHERE resolved_canonical_id IN ('4aaac895-acf3-4cbc-8b2e-74c31547cf7e'::uuid);

-- candidate_canonical_ids is JSONB holding uuid STRINGS, not uuid[].
UPDATE public.resolution_log rl SET candidate_canonical_ids = sub.fixed
  FROM (SELECT l.id,
               (SELECT jsonb_agg(DISTINCT CASE WHEN e.v IN ('4aaac895-acf3-4cbc-8b2e-74c31547cf7e')
                                          THEN 'b7799ff1-bc50-4620-ba21-85cd3c90204b' ELSE e.v END)
                  FROM jsonb_array_elements_text(l.candidate_canonical_ids) AS e(v)) AS fixed
          FROM public.resolution_log l
         WHERE jsonb_typeof(l.candidate_canonical_ids) = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(l.candidate_canonical_ids) x(v)
                        WHERE x.v IN ('4aaac895-acf3-4cbc-8b2e-74c31547cf7e'))
       ) sub
 WHERE rl.id = sub.id;

-- 3. aliases FK is ON DELETE CASCADE. Repointing before the DELETE is not
--    tidiness, it is the only thing that stops the alias rows being destroyed.
UPDATE public.aliases s
   SET mention_count = greatest(coalesce(s.mention_count,0), coalesce(l.mc,0)),
       last_seen_at  = greatest(s.last_seen_at, l.ls)
  FROM (SELECT lookup_key, max(coalesce(mention_count,0)) AS mc, max(last_seen_at) AS ls
          FROM public.aliases
         WHERE canonical_id IN ('4aaac895-acf3-4cbc-8b2e-74c31547cf7e'::uuid)
         GROUP BY lookup_key) l
 WHERE s.canonical_id = 'b7799ff1-bc50-4620-ba21-85cd3c90204b'::uuid AND s.lookup_key = l.lookup_key;

DELETE FROM public.aliases a
 WHERE a.canonical_id IN ('4aaac895-acf3-4cbc-8b2e-74c31547cf7e'::uuid)
   AND EXISTS (SELECT 1 FROM public.aliases k
                WHERE k.canonical_id = 'b7799ff1-bc50-4620-ba21-85cd3c90204b'::uuid AND k.lookup_key = a.lookup_key);

UPDATE public.aliases SET canonical_id = 'b7799ff1-bc50-4620-ba21-85cd3c90204b'::uuid
 WHERE canonical_id IN ('4aaac895-acf3-4cbc-8b2e-74c31547cf7e'::uuid);

-- 4. Name-keyed dependents. Measured 0 rows for every loser in this set,
--    kept so the block stays correct if one appears between now and apply.
DELETE FROM public.user_memo_regeneration_quota q
 WHERE q.company_id IN ('Brown-Forman Corporation')
   AND EXISTS (SELECT 1 FROM public.user_memo_regeneration_quota k
                WHERE k.user_id = q.user_id AND k.company_id = 'Brown-Forman'
                  AND k.regenerated_at = q.regenerated_at);
UPDATE public.user_memo_regeneration_quota SET company_id = 'Brown-Forman'
 WHERE company_id IN ('Brown-Forman Corporation');

-- 5. Record the fold so the step-12 articles repair can see it.
INSERT INTO norm_v2.hand_fold (new_key, loser_id, loser_name, survivor_id, survivor_name)
VALUES
  ('brown forman', '4aaac895-acf3-4cbc-8b2e-74c31547cf7e'::uuid, 'Brown-Forman Corporation', 'b7799ff1-bc50-4620-ba21-85cd3c90204b'::uuid, 'Brown-Forman')
ON CONFLICT DO NOTHING;

-- 6. Fold the survivor's own fields. Aggregates are read BEFORE the DELETE
--    because they read the losers; the DELETE then runs; and no identifier
--    is written at all, so the partial unique index on sec_cik is untouched.
CREATE TEMP TABLE IF NOT EXISTS _fold_agg (k text PRIMARY KEY, mentions bigint, themes text[]);
DELETE FROM _fold_agg WHERE k = 'brown forman';
INSERT INTO _fold_agg (k, mentions, themes)
SELECT 'brown forman',
       (SELECT sum(coalesce(mention_count,0)) FROM public.companies
         WHERE id IN ('4aaac895-acf3-4cbc-8b2e-74c31547cf7e'::uuid, 'b7799ff1-bc50-4620-ba21-85cd3c90204b'::uuid)),
       (SELECT array_agg(DISTINCT t) FROM public.companies c2,
               unnest(coalesce(c2.key_themes,'{}')) t
         WHERE c2.id IN ('4aaac895-acf3-4cbc-8b2e-74c31547cf7e'::uuid, 'b7799ff1-bc50-4620-ba21-85cd3c90204b'::uuid));

DELETE FROM public.companies
 WHERE id IN ('4aaac895-acf3-4cbc-8b2e-74c31547cf7e'::uuid);

UPDATE public.companies c
   SET mention_count = (SELECT mentions FROM _fold_agg WHERE k = 'brown forman'),
       key_themes    = (SELECT themes   FROM _fold_agg WHERE k = 'brown forman'),
       last_updated  = now()
 WHERE c.id = 'b7799ff1-bc50-4620-ba21-85cd3c90204b'::uuid;

-- READ-BACK. Look at this BEFORE you COMMIT. Every column must read true.
SELECT
  (SELECT count(*) FROM public.companies WHERE id IN ('4aaac895-acf3-4cbc-8b2e-74c31547cf7e'::uuid)) = 0        AS losers_gone,
  (SELECT count(*) FROM public.companies WHERE id = 'b7799ff1-bc50-4620-ba21-85cd3c90204b'::uuid) = 1 AS survivor_present,
  (SELECT mention_count FROM public.companies WHERE id = 'b7799ff1-bc50-4620-ba21-85cd3c90204b'::uuid) = 7 AS mentions_summed,
  (SELECT ticker IS NOT DISTINCT FROM NULL FROM public.companies WHERE id = 'b7799ff1-bc50-4620-ba21-85cd3c90204b'::uuid) AS ticker_unchanged,
  (SELECT sec_cik IS NOT DISTINCT FROM NULL FROM public.companies WHERE id = 'b7799ff1-bc50-4620-ba21-85cd3c90204b'::uuid) AS cik_unchanged,
  (SELECT count(*) FROM public.company_mentions WHERE company_id IN ('4aaac895-acf3-4cbc-8b2e-74c31547cf7e'::uuid)) = 0 AS mentions_repointed,
  (SELECT count(*) FROM public.aliases WHERE canonical_id IN ('4aaac895-acf3-4cbc-8b2e-74c31547cf7e'::uuid)) = 0 AS aliases_repointed,
  (SELECT count(*) FROM public.financial_facts WHERE company_id IN ('4aaac895-acf3-4cbc-8b2e-74c31547cf7e'::uuid)) = 0 AS facts_repointed;

-- COMMIT;    -- only after every column above read true
-- ROLLBACK;  -- otherwise

-- ROLLBACK AFTER COMMIT. Run in this order, as one transaction.
--   a. Recreate the loser rows. companies_name_key is UNIQUE(name) and
--      companies_name_no_junk is a CHECK, so the names must go back exactly.
--      INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count, sector)
--      VALUES ('4aaac895-acf3-4cbc-8b2e-74c31547cf7e'::uuid, 'Brown-Forman Corporation', NULL, NULL, 1, 'Consumer & Retail');
--   b. Restore the survivor's own fields.
--      UPDATE public.companies SET mention_count = 6, last_updated = now()
--       WHERE id = 'b7799ff1-bc50-4620-ba21-85cd3c90204b'::uuid;
--      key_themes was a UNION and is not restorable from this file. It is
--      additive and non-identifying; the pipeline rewrites it.
--   c. Repoint the three journaled tables back off norm_v2.moved_row.
--      UPDATE public.company_mentions t SET company_id = j.from_company_id
--        FROM norm_v2.moved_row j
--       WHERE j.new_key = 'handfold:brown forman' AND j.table_name = 'company_mentions'
--         AND t.id::text = j.row_id;
--      (repeat for sec_filings and insider_transactions)
--   d. financial_facts is NOT journaled and CANNOT be repointed back by this
--      file. That matches norm_v2.merge_cluster, which accepts the same
--      one-way cost. If that is unacceptable for a given block, journal
--      financial_facts too before running it.
--   e. aliases and resolution_log follow the same shape as (c) but have no
--      journal. Re-run backend alias resolution rather than hand-restoring.
--   f. DELETE FROM norm_v2.hand_fold WHERE new_key = 'brown forman';


-- ---------------------------------------------------------------------
-- BLOCK A9 -- v2 key 'first quantum minerals'   (2 rows -> 1)
--
--   No identifier on either row, under any path.
--   Both names are First Quantum Minerals, same sector.
--
--   SURVIVES : 'First Quantum Minerals'  ticker=None  sec_cik=None
--   FOLDS IN : 'First Quantum Minerals Ltd.'  ticker=None  sec_cik=None
--              articles.companies[] holding this name: 1; articles.primary_company: 0
--
--   DISPLAYED NAME AFTER THE FOLD: 'First Quantum Minerals'
--   mention_count on the survivor goes to the cluster sum (4).
--   ticker and sec_cik are NOT written by this block. The survivor either
--   already carries the only identifier in the bucket, or no member has one.
-- ---------------------------------------------------------------------

-- GUARD. Read this first and look at it. Then run the assertion.
SELECT id, name, ticker, sec_cik, mention_count, sector
  FROM public.companies
 WHERE id IN ('4c3e7fa9-2d74-4d40-8644-e8d3bfb9ffdf'::uuid, 'ef132feb-04e5-45fe-806e-6526b7bcb60b'::uuid)
 ORDER BY mention_count DESC NULLS LAST, id;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.companies c
   WHERE (c.id = '4c3e7fa9-2d74-4d40-8644-e8d3bfb9ffdf'::uuid
              AND c.name = 'First Quantum Minerals Ltd.'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 1)
      OR (c.id = 'ef132feb-04e5-45fe-806e-6526b7bcb60b'::uuid
              AND c.name = 'First Quantum Minerals'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 3);
  IF n <> 2 THEN
    RAISE EXCEPTION 'BLOCK A9 GUARD FAILED: expected 2 pinned rows, found %. A row drifted, or this block already ran. DO NOT PROCEED.', n;
  END IF;
  IF to_regprocedure('norm_v2.lookup_key_v2(text)') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.companies WHERE norm_v2.lookup_key_v2(name) = $1'
      INTO n USING 'first quantum minerals';
    IF n <> 2 THEN
      RAISE EXCEPTION 'BLOCK A9 GUARD FAILED: the bucket now holds % rows, not 2. A new member was ingested. Re-measure before folding.', n;
    END IF;
  ELSE
    RAISE NOTICE 'norm_v2.lookup_key_v2 is not installed; cluster-size guard skipped for first quantum minerals.';
  END IF;
END $$;

BEGIN;

-- 1. Journal the three reversible dependents BEFORE repointing them.
--    Same table, same shape and same three tables as norm_v2.merge_cluster.
INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:first quantum minerals', 'company_mentions', t.id::text, t.company_id, 'ef132feb-04e5-45fe-806e-6526b7bcb60b'::uuid
  FROM public.company_mentions t
 WHERE t.company_id IN ('4c3e7fa9-2d74-4d40-8644-e8d3bfb9ffdf'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:first quantum minerals', 'sec_filings', t.id::text, t.company_id, 'ef132feb-04e5-45fe-806e-6526b7bcb60b'::uuid
  FROM public.sec_filings t
 WHERE t.company_id IN ('4c3e7fa9-2d74-4d40-8644-e8d3bfb9ffdf'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:first quantum minerals', 'insider_transactions', t.id::text, t.company_id, 'ef132feb-04e5-45fe-806e-6526b7bcb60b'::uuid
  FROM public.insider_transactions t
 WHERE t.company_id IN ('4c3e7fa9-2d74-4d40-8644-e8d3bfb9ffdf'::uuid);

-- 2. Repoint every dependent that keys on companies.id.
--    financial_facts is NOT journaled, exactly as norm_v2.merge_cluster
--    leaves it. Its repoint is one-way. See the ROLLBACK note below.
UPDATE public.company_mentions SET company_id = 'ef132feb-04e5-45fe-806e-6526b7bcb60b'::uuid
 WHERE company_id IN ('4c3e7fa9-2d74-4d40-8644-e8d3bfb9ffdf'::uuid);
UPDATE public.financial_facts SET company_id = 'ef132feb-04e5-45fe-806e-6526b7bcb60b'::uuid
 WHERE company_id IN ('4c3e7fa9-2d74-4d40-8644-e8d3bfb9ffdf'::uuid);
UPDATE public.insider_transactions SET company_id = 'ef132feb-04e5-45fe-806e-6526b7bcb60b'::uuid
 WHERE company_id IN ('4c3e7fa9-2d74-4d40-8644-e8d3bfb9ffdf'::uuid);
UPDATE public.sec_filings SET company_id = 'ef132feb-04e5-45fe-806e-6526b7bcb60b'::uuid
 WHERE company_id IN ('4c3e7fa9-2d74-4d40-8644-e8d3bfb9ffdf'::uuid);

UPDATE public.resolution_log SET resolved_canonical_id = 'ef132feb-04e5-45fe-806e-6526b7bcb60b'::uuid
 WHERE resolved_canonical_id IN ('4c3e7fa9-2d74-4d40-8644-e8d3bfb9ffdf'::uuid);

-- candidate_canonical_ids is JSONB holding uuid STRINGS, not uuid[].
UPDATE public.resolution_log rl SET candidate_canonical_ids = sub.fixed
  FROM (SELECT l.id,
               (SELECT jsonb_agg(DISTINCT CASE WHEN e.v IN ('4c3e7fa9-2d74-4d40-8644-e8d3bfb9ffdf')
                                          THEN 'ef132feb-04e5-45fe-806e-6526b7bcb60b' ELSE e.v END)
                  FROM jsonb_array_elements_text(l.candidate_canonical_ids) AS e(v)) AS fixed
          FROM public.resolution_log l
         WHERE jsonb_typeof(l.candidate_canonical_ids) = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(l.candidate_canonical_ids) x(v)
                        WHERE x.v IN ('4c3e7fa9-2d74-4d40-8644-e8d3bfb9ffdf'))
       ) sub
 WHERE rl.id = sub.id;

-- 3. aliases FK is ON DELETE CASCADE. Repointing before the DELETE is not
--    tidiness, it is the only thing that stops the alias rows being destroyed.
UPDATE public.aliases s
   SET mention_count = greatest(coalesce(s.mention_count,0), coalesce(l.mc,0)),
       last_seen_at  = greatest(s.last_seen_at, l.ls)
  FROM (SELECT lookup_key, max(coalesce(mention_count,0)) AS mc, max(last_seen_at) AS ls
          FROM public.aliases
         WHERE canonical_id IN ('4c3e7fa9-2d74-4d40-8644-e8d3bfb9ffdf'::uuid)
         GROUP BY lookup_key) l
 WHERE s.canonical_id = 'ef132feb-04e5-45fe-806e-6526b7bcb60b'::uuid AND s.lookup_key = l.lookup_key;

DELETE FROM public.aliases a
 WHERE a.canonical_id IN ('4c3e7fa9-2d74-4d40-8644-e8d3bfb9ffdf'::uuid)
   AND EXISTS (SELECT 1 FROM public.aliases k
                WHERE k.canonical_id = 'ef132feb-04e5-45fe-806e-6526b7bcb60b'::uuid AND k.lookup_key = a.lookup_key);

UPDATE public.aliases SET canonical_id = 'ef132feb-04e5-45fe-806e-6526b7bcb60b'::uuid
 WHERE canonical_id IN ('4c3e7fa9-2d74-4d40-8644-e8d3bfb9ffdf'::uuid);

-- 4. Name-keyed dependents. Measured 0 rows for every loser in this set,
--    kept so the block stays correct if one appears between now and apply.
DELETE FROM public.user_memo_regeneration_quota q
 WHERE q.company_id IN ('First Quantum Minerals Ltd.')
   AND EXISTS (SELECT 1 FROM public.user_memo_regeneration_quota k
                WHERE k.user_id = q.user_id AND k.company_id = 'First Quantum Minerals'
                  AND k.regenerated_at = q.regenerated_at);
UPDATE public.user_memo_regeneration_quota SET company_id = 'First Quantum Minerals'
 WHERE company_id IN ('First Quantum Minerals Ltd.');

-- 5. Record the fold so the step-12 articles repair can see it.
INSERT INTO norm_v2.hand_fold (new_key, loser_id, loser_name, survivor_id, survivor_name)
VALUES
  ('first quantum minerals', '4c3e7fa9-2d74-4d40-8644-e8d3bfb9ffdf'::uuid, 'First Quantum Minerals Ltd.', 'ef132feb-04e5-45fe-806e-6526b7bcb60b'::uuid, 'First Quantum Minerals')
ON CONFLICT DO NOTHING;

-- 6. Fold the survivor's own fields. Aggregates are read BEFORE the DELETE
--    because they read the losers; the DELETE then runs; and no identifier
--    is written at all, so the partial unique index on sec_cik is untouched.
CREATE TEMP TABLE IF NOT EXISTS _fold_agg (k text PRIMARY KEY, mentions bigint, themes text[]);
DELETE FROM _fold_agg WHERE k = 'first quantum minerals';
INSERT INTO _fold_agg (k, mentions, themes)
SELECT 'first quantum minerals',
       (SELECT sum(coalesce(mention_count,0)) FROM public.companies
         WHERE id IN ('4c3e7fa9-2d74-4d40-8644-e8d3bfb9ffdf'::uuid, 'ef132feb-04e5-45fe-806e-6526b7bcb60b'::uuid)),
       (SELECT array_agg(DISTINCT t) FROM public.companies c2,
               unnest(coalesce(c2.key_themes,'{}')) t
         WHERE c2.id IN ('4c3e7fa9-2d74-4d40-8644-e8d3bfb9ffdf'::uuid, 'ef132feb-04e5-45fe-806e-6526b7bcb60b'::uuid));

DELETE FROM public.companies
 WHERE id IN ('4c3e7fa9-2d74-4d40-8644-e8d3bfb9ffdf'::uuid);

UPDATE public.companies c
   SET mention_count = (SELECT mentions FROM _fold_agg WHERE k = 'first quantum minerals'),
       key_themes    = (SELECT themes   FROM _fold_agg WHERE k = 'first quantum minerals'),
       last_updated  = now()
 WHERE c.id = 'ef132feb-04e5-45fe-806e-6526b7bcb60b'::uuid;

-- READ-BACK. Look at this BEFORE you COMMIT. Every column must read true.
SELECT
  (SELECT count(*) FROM public.companies WHERE id IN ('4c3e7fa9-2d74-4d40-8644-e8d3bfb9ffdf'::uuid)) = 0        AS losers_gone,
  (SELECT count(*) FROM public.companies WHERE id = 'ef132feb-04e5-45fe-806e-6526b7bcb60b'::uuid) = 1 AS survivor_present,
  (SELECT mention_count FROM public.companies WHERE id = 'ef132feb-04e5-45fe-806e-6526b7bcb60b'::uuid) = 4 AS mentions_summed,
  (SELECT ticker IS NOT DISTINCT FROM NULL FROM public.companies WHERE id = 'ef132feb-04e5-45fe-806e-6526b7bcb60b'::uuid) AS ticker_unchanged,
  (SELECT sec_cik IS NOT DISTINCT FROM NULL FROM public.companies WHERE id = 'ef132feb-04e5-45fe-806e-6526b7bcb60b'::uuid) AS cik_unchanged,
  (SELECT count(*) FROM public.company_mentions WHERE company_id IN ('4c3e7fa9-2d74-4d40-8644-e8d3bfb9ffdf'::uuid)) = 0 AS mentions_repointed,
  (SELECT count(*) FROM public.aliases WHERE canonical_id IN ('4c3e7fa9-2d74-4d40-8644-e8d3bfb9ffdf'::uuid)) = 0 AS aliases_repointed,
  (SELECT count(*) FROM public.financial_facts WHERE company_id IN ('4c3e7fa9-2d74-4d40-8644-e8d3bfb9ffdf'::uuid)) = 0 AS facts_repointed;

-- COMMIT;    -- only after every column above read true
-- ROLLBACK;  -- otherwise

-- ROLLBACK AFTER COMMIT. Run in this order, as one transaction.
--   a. Recreate the loser rows. companies_name_key is UNIQUE(name) and
--      companies_name_no_junk is a CHECK, so the names must go back exactly.
--      INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count, sector)
--      VALUES ('4c3e7fa9-2d74-4d40-8644-e8d3bfb9ffdf'::uuid, 'First Quantum Minerals Ltd.', NULL, NULL, 1, NULL);
--   b. Restore the survivor's own fields.
--      UPDATE public.companies SET mention_count = 3, last_updated = now()
--       WHERE id = 'ef132feb-04e5-45fe-806e-6526b7bcb60b'::uuid;
--      key_themes was a UNION and is not restorable from this file. It is
--      additive and non-identifying; the pipeline rewrites it.
--   c. Repoint the three journaled tables back off norm_v2.moved_row.
--      UPDATE public.company_mentions t SET company_id = j.from_company_id
--        FROM norm_v2.moved_row j
--       WHERE j.new_key = 'handfold:first quantum minerals' AND j.table_name = 'company_mentions'
--         AND t.id::text = j.row_id;
--      (repeat for sec_filings and insider_transactions)
--   d. financial_facts is NOT journaled and CANNOT be repointed back by this
--      file. That matches norm_v2.merge_cluster, which accepts the same
--      one-way cost. If that is unacceptable for a given block, journal
--      financial_facts too before running it.
--   e. aliases and resolution_log follow the same shape as (c) but have no
--      journal. Re-run backend alias resolution rather than hand-restoring.
--   f. DELETE FROM norm_v2.hand_fold WHERE new_key = 'first quantum minerals';


-- ---------------------------------------------------------------------
-- BLOCK A10 -- v2 key 'intercontinental hotels'   (2 rows -> 1)
--
--   No identifier on either row.
--   NAME CHOICE IS A REAL DECISION: the two rows tie on mention_count.
--
--   SURVIVES : 'InterContinental Hotels Group'  ticker=None  sec_cik=None
--   FOLDS IN : 'InterContinental Hotels'  ticker=None  sec_cik=None
--              articles.companies[] holding this name: 1; articles.primary_company: 1
--
--   DISPLAYED NAME AFTER THE FOLD: 'InterContinental Hotels Group'
--   mention_count on the survivor goes to the cluster sum (2).
--   ticker and sec_cik are NOT written by this block. The survivor either
--   already carries the only identifier in the bucket, or no member has one.
-- ---------------------------------------------------------------------

-- GUARD. Read this first and look at it. Then run the assertion.
SELECT id, name, ticker, sec_cik, mention_count, sector
  FROM public.companies
 WHERE id IN ('001e9b46-fd45-4101-91c4-74d229790439'::uuid, '3066e421-cb8c-4554-9e0c-f1953cf9608f'::uuid)
 ORDER BY mention_count DESC NULLS LAST, id;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.companies c
   WHERE (c.id = '001e9b46-fd45-4101-91c4-74d229790439'::uuid
              AND c.name = 'InterContinental Hotels Group'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 1)
      OR (c.id = '3066e421-cb8c-4554-9e0c-f1953cf9608f'::uuid
              AND c.name = 'InterContinental Hotels'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 1);
  IF n <> 2 THEN
    RAISE EXCEPTION 'BLOCK A10 GUARD FAILED: expected 2 pinned rows, found %. A row drifted, or this block already ran. DO NOT PROCEED.', n;
  END IF;
  IF to_regprocedure('norm_v2.lookup_key_v2(text)') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.companies WHERE norm_v2.lookup_key_v2(name) = $1'
      INTO n USING 'intercontinental hotels';
    IF n <> 2 THEN
      RAISE EXCEPTION 'BLOCK A10 GUARD FAILED: the bucket now holds % rows, not 2. A new member was ingested. Re-measure before folding.', n;
    END IF;
  ELSE
    RAISE NOTICE 'norm_v2.lookup_key_v2 is not installed; cluster-size guard skipped for intercontinental hotels.';
  END IF;
END $$;

BEGIN;

-- 1. Journal the three reversible dependents BEFORE repointing them.
--    Same table, same shape and same three tables as norm_v2.merge_cluster.
INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:intercontinental hotels', 'company_mentions', t.id::text, t.company_id, '001e9b46-fd45-4101-91c4-74d229790439'::uuid
  FROM public.company_mentions t
 WHERE t.company_id IN ('3066e421-cb8c-4554-9e0c-f1953cf9608f'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:intercontinental hotels', 'sec_filings', t.id::text, t.company_id, '001e9b46-fd45-4101-91c4-74d229790439'::uuid
  FROM public.sec_filings t
 WHERE t.company_id IN ('3066e421-cb8c-4554-9e0c-f1953cf9608f'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:intercontinental hotels', 'insider_transactions', t.id::text, t.company_id, '001e9b46-fd45-4101-91c4-74d229790439'::uuid
  FROM public.insider_transactions t
 WHERE t.company_id IN ('3066e421-cb8c-4554-9e0c-f1953cf9608f'::uuid);

-- 2. Repoint every dependent that keys on companies.id.
--    financial_facts is NOT journaled, exactly as norm_v2.merge_cluster
--    leaves it. Its repoint is one-way. See the ROLLBACK note below.
UPDATE public.company_mentions SET company_id = '001e9b46-fd45-4101-91c4-74d229790439'::uuid
 WHERE company_id IN ('3066e421-cb8c-4554-9e0c-f1953cf9608f'::uuid);
UPDATE public.financial_facts SET company_id = '001e9b46-fd45-4101-91c4-74d229790439'::uuid
 WHERE company_id IN ('3066e421-cb8c-4554-9e0c-f1953cf9608f'::uuid);
UPDATE public.insider_transactions SET company_id = '001e9b46-fd45-4101-91c4-74d229790439'::uuid
 WHERE company_id IN ('3066e421-cb8c-4554-9e0c-f1953cf9608f'::uuid);
UPDATE public.sec_filings SET company_id = '001e9b46-fd45-4101-91c4-74d229790439'::uuid
 WHERE company_id IN ('3066e421-cb8c-4554-9e0c-f1953cf9608f'::uuid);

UPDATE public.resolution_log SET resolved_canonical_id = '001e9b46-fd45-4101-91c4-74d229790439'::uuid
 WHERE resolved_canonical_id IN ('3066e421-cb8c-4554-9e0c-f1953cf9608f'::uuid);

-- candidate_canonical_ids is JSONB holding uuid STRINGS, not uuid[].
UPDATE public.resolution_log rl SET candidate_canonical_ids = sub.fixed
  FROM (SELECT l.id,
               (SELECT jsonb_agg(DISTINCT CASE WHEN e.v IN ('3066e421-cb8c-4554-9e0c-f1953cf9608f')
                                          THEN '001e9b46-fd45-4101-91c4-74d229790439' ELSE e.v END)
                  FROM jsonb_array_elements_text(l.candidate_canonical_ids) AS e(v)) AS fixed
          FROM public.resolution_log l
         WHERE jsonb_typeof(l.candidate_canonical_ids) = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(l.candidate_canonical_ids) x(v)
                        WHERE x.v IN ('3066e421-cb8c-4554-9e0c-f1953cf9608f'))
       ) sub
 WHERE rl.id = sub.id;

-- 3. aliases FK is ON DELETE CASCADE. Repointing before the DELETE is not
--    tidiness, it is the only thing that stops the alias rows being destroyed.
UPDATE public.aliases s
   SET mention_count = greatest(coalesce(s.mention_count,0), coalesce(l.mc,0)),
       last_seen_at  = greatest(s.last_seen_at, l.ls)
  FROM (SELECT lookup_key, max(coalesce(mention_count,0)) AS mc, max(last_seen_at) AS ls
          FROM public.aliases
         WHERE canonical_id IN ('3066e421-cb8c-4554-9e0c-f1953cf9608f'::uuid)
         GROUP BY lookup_key) l
 WHERE s.canonical_id = '001e9b46-fd45-4101-91c4-74d229790439'::uuid AND s.lookup_key = l.lookup_key;

DELETE FROM public.aliases a
 WHERE a.canonical_id IN ('3066e421-cb8c-4554-9e0c-f1953cf9608f'::uuid)
   AND EXISTS (SELECT 1 FROM public.aliases k
                WHERE k.canonical_id = '001e9b46-fd45-4101-91c4-74d229790439'::uuid AND k.lookup_key = a.lookup_key);

UPDATE public.aliases SET canonical_id = '001e9b46-fd45-4101-91c4-74d229790439'::uuid
 WHERE canonical_id IN ('3066e421-cb8c-4554-9e0c-f1953cf9608f'::uuid);

-- 4. Name-keyed dependents. Measured 0 rows for every loser in this set,
--    kept so the block stays correct if one appears between now and apply.
DELETE FROM public.user_memo_regeneration_quota q
 WHERE q.company_id IN ('InterContinental Hotels')
   AND EXISTS (SELECT 1 FROM public.user_memo_regeneration_quota k
                WHERE k.user_id = q.user_id AND k.company_id = 'InterContinental Hotels Group'
                  AND k.regenerated_at = q.regenerated_at);
UPDATE public.user_memo_regeneration_quota SET company_id = 'InterContinental Hotels Group'
 WHERE company_id IN ('InterContinental Hotels');

-- 5. Record the fold so the step-12 articles repair can see it.
INSERT INTO norm_v2.hand_fold (new_key, loser_id, loser_name, survivor_id, survivor_name)
VALUES
  ('intercontinental hotels', '3066e421-cb8c-4554-9e0c-f1953cf9608f'::uuid, 'InterContinental Hotels', '001e9b46-fd45-4101-91c4-74d229790439'::uuid, 'InterContinental Hotels Group')
ON CONFLICT DO NOTHING;

-- 6. Fold the survivor's own fields. Aggregates are read BEFORE the DELETE
--    because they read the losers; the DELETE then runs; and no identifier
--    is written at all, so the partial unique index on sec_cik is untouched.
CREATE TEMP TABLE IF NOT EXISTS _fold_agg (k text PRIMARY KEY, mentions bigint, themes text[]);
DELETE FROM _fold_agg WHERE k = 'intercontinental hotels';
INSERT INTO _fold_agg (k, mentions, themes)
SELECT 'intercontinental hotels',
       (SELECT sum(coalesce(mention_count,0)) FROM public.companies
         WHERE id IN ('001e9b46-fd45-4101-91c4-74d229790439'::uuid, '3066e421-cb8c-4554-9e0c-f1953cf9608f'::uuid)),
       (SELECT array_agg(DISTINCT t) FROM public.companies c2,
               unnest(coalesce(c2.key_themes,'{}')) t
         WHERE c2.id IN ('001e9b46-fd45-4101-91c4-74d229790439'::uuid, '3066e421-cb8c-4554-9e0c-f1953cf9608f'::uuid));

DELETE FROM public.companies
 WHERE id IN ('3066e421-cb8c-4554-9e0c-f1953cf9608f'::uuid);

UPDATE public.companies c
   SET mention_count = (SELECT mentions FROM _fold_agg WHERE k = 'intercontinental hotels'),
       key_themes    = (SELECT themes   FROM _fold_agg WHERE k = 'intercontinental hotels'),
       last_updated  = now()
 WHERE c.id = '001e9b46-fd45-4101-91c4-74d229790439'::uuid;

-- READ-BACK. Look at this BEFORE you COMMIT. Every column must read true.
SELECT
  (SELECT count(*) FROM public.companies WHERE id IN ('3066e421-cb8c-4554-9e0c-f1953cf9608f'::uuid)) = 0        AS losers_gone,
  (SELECT count(*) FROM public.companies WHERE id = '001e9b46-fd45-4101-91c4-74d229790439'::uuid) = 1 AS survivor_present,
  (SELECT mention_count FROM public.companies WHERE id = '001e9b46-fd45-4101-91c4-74d229790439'::uuid) = 2 AS mentions_summed,
  (SELECT ticker IS NOT DISTINCT FROM NULL FROM public.companies WHERE id = '001e9b46-fd45-4101-91c4-74d229790439'::uuid) AS ticker_unchanged,
  (SELECT sec_cik IS NOT DISTINCT FROM NULL FROM public.companies WHERE id = '001e9b46-fd45-4101-91c4-74d229790439'::uuid) AS cik_unchanged,
  (SELECT count(*) FROM public.company_mentions WHERE company_id IN ('3066e421-cb8c-4554-9e0c-f1953cf9608f'::uuid)) = 0 AS mentions_repointed,
  (SELECT count(*) FROM public.aliases WHERE canonical_id IN ('3066e421-cb8c-4554-9e0c-f1953cf9608f'::uuid)) = 0 AS aliases_repointed,
  (SELECT count(*) FROM public.financial_facts WHERE company_id IN ('3066e421-cb8c-4554-9e0c-f1953cf9608f'::uuid)) = 0 AS facts_repointed;

-- COMMIT;    -- only after every column above read true
-- ROLLBACK;  -- otherwise

-- ROLLBACK AFTER COMMIT. Run in this order, as one transaction.
--   a. Recreate the loser rows. companies_name_key is UNIQUE(name) and
--      companies_name_no_junk is a CHECK, so the names must go back exactly.
--      INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count, sector)
--      VALUES ('3066e421-cb8c-4554-9e0c-f1953cf9608f'::uuid, 'InterContinental Hotels', NULL, NULL, 1, 'Consumer & Retail');
--   b. Restore the survivor's own fields.
--      UPDATE public.companies SET mention_count = 1, last_updated = now()
--       WHERE id = '001e9b46-fd45-4101-91c4-74d229790439'::uuid;
--      key_themes was a UNION and is not restorable from this file. It is
--      additive and non-identifying; the pipeline rewrites it.
--   c. Repoint the three journaled tables back off norm_v2.moved_row.
--      UPDATE public.company_mentions t SET company_id = j.from_company_id
--        FROM norm_v2.moved_row j
--       WHERE j.new_key = 'handfold:intercontinental hotels' AND j.table_name = 'company_mentions'
--         AND t.id::text = j.row_id;
--      (repeat for sec_filings and insider_transactions)
--   d. financial_facts is NOT journaled and CANNOT be repointed back by this
--      file. That matches norm_v2.merge_cluster, which accepts the same
--      one-way cost. If that is unacceptable for a given block, journal
--      financial_facts too before running it.
--   e. aliases and resolution_log follow the same shape as (c) but have no
--      journal. Re-run backend alias resolution rather than hand-restoring.
--   f. DELETE FROM norm_v2.hand_fold WHERE new_key = 'intercontinental hotels';


-- ---------------------------------------------------------------------
-- BLOCK A11 -- v2 key 'lincoln national'   (2 rows -> 1)
--
--   No identifier on either row.
--   NAME CHOICE IS A REAL DECISION: the two rows tie on mention_count.
--
--   SURVIVES : 'Lincoln National Corporation'  ticker=None  sec_cik=None
--   FOLDS IN : 'Lincoln National'  ticker=None  sec_cik=None
--              articles.companies[] holding this name: 1; articles.primary_company: 0
--
--   DISPLAYED NAME AFTER THE FOLD: 'Lincoln National Corporation'
--   mention_count on the survivor goes to the cluster sum (2).
--   ticker and sec_cik are NOT written by this block. The survivor either
--   already carries the only identifier in the bucket, or no member has one.
-- ---------------------------------------------------------------------

-- GUARD. Read this first and look at it. Then run the assertion.
SELECT id, name, ticker, sec_cik, mention_count, sector
  FROM public.companies
 WHERE id IN ('c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid, 'cd0a2eb3-863e-41a7-add8-3f2b9a588c25'::uuid)
 ORDER BY mention_count DESC NULLS LAST, id;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.companies c
   WHERE (c.id = 'c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid
              AND c.name = 'Lincoln National Corporation'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 1)
      OR (c.id = 'cd0a2eb3-863e-41a7-add8-3f2b9a588c25'::uuid
              AND c.name = 'Lincoln National'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 1);
  IF n <> 2 THEN
    RAISE EXCEPTION 'BLOCK A11 GUARD FAILED: expected 2 pinned rows, found %. A row drifted, or this block already ran. DO NOT PROCEED.', n;
  END IF;
  IF to_regprocedure('norm_v2.lookup_key_v2(text)') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.companies WHERE norm_v2.lookup_key_v2(name) = $1'
      INTO n USING 'lincoln national';
    IF n <> 2 THEN
      RAISE EXCEPTION 'BLOCK A11 GUARD FAILED: the bucket now holds % rows, not 2. A new member was ingested. Re-measure before folding.', n;
    END IF;
  ELSE
    RAISE NOTICE 'norm_v2.lookup_key_v2 is not installed; cluster-size guard skipped for lincoln national.';
  END IF;
END $$;

BEGIN;

-- 1. Journal the three reversible dependents BEFORE repointing them.
--    Same table, same shape and same three tables as norm_v2.merge_cluster.
INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:lincoln national', 'company_mentions', t.id::text, t.company_id, 'c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid
  FROM public.company_mentions t
 WHERE t.company_id IN ('cd0a2eb3-863e-41a7-add8-3f2b9a588c25'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:lincoln national', 'sec_filings', t.id::text, t.company_id, 'c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid
  FROM public.sec_filings t
 WHERE t.company_id IN ('cd0a2eb3-863e-41a7-add8-3f2b9a588c25'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:lincoln national', 'insider_transactions', t.id::text, t.company_id, 'c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid
  FROM public.insider_transactions t
 WHERE t.company_id IN ('cd0a2eb3-863e-41a7-add8-3f2b9a588c25'::uuid);

-- 2. Repoint every dependent that keys on companies.id.
--    financial_facts is NOT journaled, exactly as norm_v2.merge_cluster
--    leaves it. Its repoint is one-way. See the ROLLBACK note below.
UPDATE public.company_mentions SET company_id = 'c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid
 WHERE company_id IN ('cd0a2eb3-863e-41a7-add8-3f2b9a588c25'::uuid);
UPDATE public.financial_facts SET company_id = 'c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid
 WHERE company_id IN ('cd0a2eb3-863e-41a7-add8-3f2b9a588c25'::uuid);
UPDATE public.insider_transactions SET company_id = 'c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid
 WHERE company_id IN ('cd0a2eb3-863e-41a7-add8-3f2b9a588c25'::uuid);
UPDATE public.sec_filings SET company_id = 'c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid
 WHERE company_id IN ('cd0a2eb3-863e-41a7-add8-3f2b9a588c25'::uuid);

UPDATE public.resolution_log SET resolved_canonical_id = 'c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid
 WHERE resolved_canonical_id IN ('cd0a2eb3-863e-41a7-add8-3f2b9a588c25'::uuid);

-- candidate_canonical_ids is JSONB holding uuid STRINGS, not uuid[].
UPDATE public.resolution_log rl SET candidate_canonical_ids = sub.fixed
  FROM (SELECT l.id,
               (SELECT jsonb_agg(DISTINCT CASE WHEN e.v IN ('cd0a2eb3-863e-41a7-add8-3f2b9a588c25')
                                          THEN 'c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92' ELSE e.v END)
                  FROM jsonb_array_elements_text(l.candidate_canonical_ids) AS e(v)) AS fixed
          FROM public.resolution_log l
         WHERE jsonb_typeof(l.candidate_canonical_ids) = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(l.candidate_canonical_ids) x(v)
                        WHERE x.v IN ('cd0a2eb3-863e-41a7-add8-3f2b9a588c25'))
       ) sub
 WHERE rl.id = sub.id;

-- 3. aliases FK is ON DELETE CASCADE. Repointing before the DELETE is not
--    tidiness, it is the only thing that stops the alias rows being destroyed.
UPDATE public.aliases s
   SET mention_count = greatest(coalesce(s.mention_count,0), coalesce(l.mc,0)),
       last_seen_at  = greatest(s.last_seen_at, l.ls)
  FROM (SELECT lookup_key, max(coalesce(mention_count,0)) AS mc, max(last_seen_at) AS ls
          FROM public.aliases
         WHERE canonical_id IN ('cd0a2eb3-863e-41a7-add8-3f2b9a588c25'::uuid)
         GROUP BY lookup_key) l
 WHERE s.canonical_id = 'c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid AND s.lookup_key = l.lookup_key;

DELETE FROM public.aliases a
 WHERE a.canonical_id IN ('cd0a2eb3-863e-41a7-add8-3f2b9a588c25'::uuid)
   AND EXISTS (SELECT 1 FROM public.aliases k
                WHERE k.canonical_id = 'c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid AND k.lookup_key = a.lookup_key);

UPDATE public.aliases SET canonical_id = 'c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid
 WHERE canonical_id IN ('cd0a2eb3-863e-41a7-add8-3f2b9a588c25'::uuid);

-- 4. Name-keyed dependents. Measured 0 rows for every loser in this set,
--    kept so the block stays correct if one appears between now and apply.
DELETE FROM public.user_memo_regeneration_quota q
 WHERE q.company_id IN ('Lincoln National')
   AND EXISTS (SELECT 1 FROM public.user_memo_regeneration_quota k
                WHERE k.user_id = q.user_id AND k.company_id = 'Lincoln National Corporation'
                  AND k.regenerated_at = q.regenerated_at);
UPDATE public.user_memo_regeneration_quota SET company_id = 'Lincoln National Corporation'
 WHERE company_id IN ('Lincoln National');

-- 5. Record the fold so the step-12 articles repair can see it.
INSERT INTO norm_v2.hand_fold (new_key, loser_id, loser_name, survivor_id, survivor_name)
VALUES
  ('lincoln national', 'cd0a2eb3-863e-41a7-add8-3f2b9a588c25'::uuid, 'Lincoln National', 'c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid, 'Lincoln National Corporation')
ON CONFLICT DO NOTHING;

-- 6. Fold the survivor's own fields. Aggregates are read BEFORE the DELETE
--    because they read the losers; the DELETE then runs; and no identifier
--    is written at all, so the partial unique index on sec_cik is untouched.
CREATE TEMP TABLE IF NOT EXISTS _fold_agg (k text PRIMARY KEY, mentions bigint, themes text[]);
DELETE FROM _fold_agg WHERE k = 'lincoln national';
INSERT INTO _fold_agg (k, mentions, themes)
SELECT 'lincoln national',
       (SELECT sum(coalesce(mention_count,0)) FROM public.companies
         WHERE id IN ('c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid, 'cd0a2eb3-863e-41a7-add8-3f2b9a588c25'::uuid)),
       (SELECT array_agg(DISTINCT t) FROM public.companies c2,
               unnest(coalesce(c2.key_themes,'{}')) t
         WHERE c2.id IN ('c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid, 'cd0a2eb3-863e-41a7-add8-3f2b9a588c25'::uuid));

DELETE FROM public.companies
 WHERE id IN ('cd0a2eb3-863e-41a7-add8-3f2b9a588c25'::uuid);

UPDATE public.companies c
   SET mention_count = (SELECT mentions FROM _fold_agg WHERE k = 'lincoln national'),
       key_themes    = (SELECT themes   FROM _fold_agg WHERE k = 'lincoln national'),
       last_updated  = now()
 WHERE c.id = 'c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid;

-- READ-BACK. Look at this BEFORE you COMMIT. Every column must read true.
SELECT
  (SELECT count(*) FROM public.companies WHERE id IN ('cd0a2eb3-863e-41a7-add8-3f2b9a588c25'::uuid)) = 0        AS losers_gone,
  (SELECT count(*) FROM public.companies WHERE id = 'c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid) = 1 AS survivor_present,
  (SELECT mention_count FROM public.companies WHERE id = 'c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid) = 2 AS mentions_summed,
  (SELECT ticker IS NOT DISTINCT FROM NULL FROM public.companies WHERE id = 'c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid) AS ticker_unchanged,
  (SELECT sec_cik IS NOT DISTINCT FROM NULL FROM public.companies WHERE id = 'c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid) AS cik_unchanged,
  (SELECT count(*) FROM public.company_mentions WHERE company_id IN ('cd0a2eb3-863e-41a7-add8-3f2b9a588c25'::uuid)) = 0 AS mentions_repointed,
  (SELECT count(*) FROM public.aliases WHERE canonical_id IN ('cd0a2eb3-863e-41a7-add8-3f2b9a588c25'::uuid)) = 0 AS aliases_repointed,
  (SELECT count(*) FROM public.financial_facts WHERE company_id IN ('cd0a2eb3-863e-41a7-add8-3f2b9a588c25'::uuid)) = 0 AS facts_repointed;

-- COMMIT;    -- only after every column above read true
-- ROLLBACK;  -- otherwise

-- ROLLBACK AFTER COMMIT. Run in this order, as one transaction.
--   a. Recreate the loser rows. companies_name_key is UNIQUE(name) and
--      companies_name_no_junk is a CHECK, so the names must go back exactly.
--      INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count, sector)
--      VALUES ('cd0a2eb3-863e-41a7-add8-3f2b9a588c25'::uuid, 'Lincoln National', NULL, NULL, 1, NULL);
--   b. Restore the survivor's own fields.
--      UPDATE public.companies SET mention_count = 1, last_updated = now()
--       WHERE id = 'c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid;
--      key_themes was a UNION and is not restorable from this file. It is
--      additive and non-identifying; the pipeline rewrites it.
--   c. Repoint the three journaled tables back off norm_v2.moved_row.
--      UPDATE public.company_mentions t SET company_id = j.from_company_id
--        FROM norm_v2.moved_row j
--       WHERE j.new_key = 'handfold:lincoln national' AND j.table_name = 'company_mentions'
--         AND t.id::text = j.row_id;
--      (repeat for sec_filings and insider_transactions)
--   d. financial_facts is NOT journaled and CANNOT be repointed back by this
--      file. That matches norm_v2.merge_cluster, which accepts the same
--      one-way cost. If that is unacceptable for a given block, journal
--      financial_facts too before running it.
--   e. aliases and resolution_log follow the same shape as (c) but have no
--      journal. Re-run backend alias resolution rather than hand-restoring.
--   f. DELETE FROM norm_v2.hand_fold WHERE new_key = 'lincoln national';


-- ---------------------------------------------------------------------
-- BLOCK A12 -- v2 key 'oshkosh'   (2 rows -> 1)
--
--   No identifier on either row.
--   NAME CHOICE IS A REAL DECISION: the two rows tie on mention_count, and they disagree on sector.
--
--   SURVIVES : 'Oshkosh Corp'  ticker=None  sec_cik=None
--   FOLDS IN : 'Oshkosh'  ticker=None  sec_cik=None
--              articles.companies[] holding this name: 1; articles.primary_company: 2
--
--   DISPLAYED NAME AFTER THE FOLD: 'Oshkosh Corp'
--   mention_count on the survivor goes to the cluster sum (2).
--   ticker and sec_cik are NOT written by this block. The survivor either
--   already carries the only identifier in the bucket, or no member has one.
-- ---------------------------------------------------------------------

-- GUARD. Read this first and look at it. Then run the assertion.
SELECT id, name, ticker, sec_cik, mention_count, sector
  FROM public.companies
 WHERE id IN ('6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid, 'c1fb599a-6507-46de-8b99-38a6ded42792'::uuid)
 ORDER BY mention_count DESC NULLS LAST, id;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.companies c
   WHERE (c.id = '6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid
              AND c.name = 'Oshkosh Corp'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 1)
      OR (c.id = 'c1fb599a-6507-46de-8b99-38a6ded42792'::uuid
              AND c.name = 'Oshkosh'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 1);
  IF n <> 2 THEN
    RAISE EXCEPTION 'BLOCK A12 GUARD FAILED: expected 2 pinned rows, found %. A row drifted, or this block already ran. DO NOT PROCEED.', n;
  END IF;
  IF to_regprocedure('norm_v2.lookup_key_v2(text)') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.companies WHERE norm_v2.lookup_key_v2(name) = $1'
      INTO n USING 'oshkosh';
    IF n <> 2 THEN
      RAISE EXCEPTION 'BLOCK A12 GUARD FAILED: the bucket now holds % rows, not 2. A new member was ingested. Re-measure before folding.', n;
    END IF;
  ELSE
    RAISE NOTICE 'norm_v2.lookup_key_v2 is not installed; cluster-size guard skipped for oshkosh.';
  END IF;
END $$;

BEGIN;

-- 1. Journal the three reversible dependents BEFORE repointing them.
--    Same table, same shape and same three tables as norm_v2.merge_cluster.
INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:oshkosh', 'company_mentions', t.id::text, t.company_id, '6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid
  FROM public.company_mentions t
 WHERE t.company_id IN ('c1fb599a-6507-46de-8b99-38a6ded42792'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:oshkosh', 'sec_filings', t.id::text, t.company_id, '6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid
  FROM public.sec_filings t
 WHERE t.company_id IN ('c1fb599a-6507-46de-8b99-38a6ded42792'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:oshkosh', 'insider_transactions', t.id::text, t.company_id, '6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid
  FROM public.insider_transactions t
 WHERE t.company_id IN ('c1fb599a-6507-46de-8b99-38a6ded42792'::uuid);

-- 2. Repoint every dependent that keys on companies.id.
--    financial_facts is NOT journaled, exactly as norm_v2.merge_cluster
--    leaves it. Its repoint is one-way. See the ROLLBACK note below.
UPDATE public.company_mentions SET company_id = '6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid
 WHERE company_id IN ('c1fb599a-6507-46de-8b99-38a6ded42792'::uuid);
UPDATE public.financial_facts SET company_id = '6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid
 WHERE company_id IN ('c1fb599a-6507-46de-8b99-38a6ded42792'::uuid);
UPDATE public.insider_transactions SET company_id = '6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid
 WHERE company_id IN ('c1fb599a-6507-46de-8b99-38a6ded42792'::uuid);
UPDATE public.sec_filings SET company_id = '6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid
 WHERE company_id IN ('c1fb599a-6507-46de-8b99-38a6ded42792'::uuid);

UPDATE public.resolution_log SET resolved_canonical_id = '6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid
 WHERE resolved_canonical_id IN ('c1fb599a-6507-46de-8b99-38a6ded42792'::uuid);

-- candidate_canonical_ids is JSONB holding uuid STRINGS, not uuid[].
UPDATE public.resolution_log rl SET candidate_canonical_ids = sub.fixed
  FROM (SELECT l.id,
               (SELECT jsonb_agg(DISTINCT CASE WHEN e.v IN ('c1fb599a-6507-46de-8b99-38a6ded42792')
                                          THEN '6e4e038f-57e4-4921-b605-3e6e6bf09dca' ELSE e.v END)
                  FROM jsonb_array_elements_text(l.candidate_canonical_ids) AS e(v)) AS fixed
          FROM public.resolution_log l
         WHERE jsonb_typeof(l.candidate_canonical_ids) = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(l.candidate_canonical_ids) x(v)
                        WHERE x.v IN ('c1fb599a-6507-46de-8b99-38a6ded42792'))
       ) sub
 WHERE rl.id = sub.id;

-- 3. aliases FK is ON DELETE CASCADE. Repointing before the DELETE is not
--    tidiness, it is the only thing that stops the alias rows being destroyed.
UPDATE public.aliases s
   SET mention_count = greatest(coalesce(s.mention_count,0), coalesce(l.mc,0)),
       last_seen_at  = greatest(s.last_seen_at, l.ls)
  FROM (SELECT lookup_key, max(coalesce(mention_count,0)) AS mc, max(last_seen_at) AS ls
          FROM public.aliases
         WHERE canonical_id IN ('c1fb599a-6507-46de-8b99-38a6ded42792'::uuid)
         GROUP BY lookup_key) l
 WHERE s.canonical_id = '6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid AND s.lookup_key = l.lookup_key;

DELETE FROM public.aliases a
 WHERE a.canonical_id IN ('c1fb599a-6507-46de-8b99-38a6ded42792'::uuid)
   AND EXISTS (SELECT 1 FROM public.aliases k
                WHERE k.canonical_id = '6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid AND k.lookup_key = a.lookup_key);

UPDATE public.aliases SET canonical_id = '6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid
 WHERE canonical_id IN ('c1fb599a-6507-46de-8b99-38a6ded42792'::uuid);

-- 4. Name-keyed dependents. Measured 0 rows for every loser in this set,
--    kept so the block stays correct if one appears between now and apply.
DELETE FROM public.user_memo_regeneration_quota q
 WHERE q.company_id IN ('Oshkosh')
   AND EXISTS (SELECT 1 FROM public.user_memo_regeneration_quota k
                WHERE k.user_id = q.user_id AND k.company_id = 'Oshkosh Corp'
                  AND k.regenerated_at = q.regenerated_at);
UPDATE public.user_memo_regeneration_quota SET company_id = 'Oshkosh Corp'
 WHERE company_id IN ('Oshkosh');

-- 5. Record the fold so the step-12 articles repair can see it.
INSERT INTO norm_v2.hand_fold (new_key, loser_id, loser_name, survivor_id, survivor_name)
VALUES
  ('oshkosh', 'c1fb599a-6507-46de-8b99-38a6ded42792'::uuid, 'Oshkosh', '6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid, 'Oshkosh Corp')
ON CONFLICT DO NOTHING;

-- 6. Fold the survivor's own fields. Aggregates are read BEFORE the DELETE
--    because they read the losers; the DELETE then runs; and no identifier
--    is written at all, so the partial unique index on sec_cik is untouched.
CREATE TEMP TABLE IF NOT EXISTS _fold_agg (k text PRIMARY KEY, mentions bigint, themes text[]);
DELETE FROM _fold_agg WHERE k = 'oshkosh';
INSERT INTO _fold_agg (k, mentions, themes)
SELECT 'oshkosh',
       (SELECT sum(coalesce(mention_count,0)) FROM public.companies
         WHERE id IN ('6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid, 'c1fb599a-6507-46de-8b99-38a6ded42792'::uuid)),
       (SELECT array_agg(DISTINCT t) FROM public.companies c2,
               unnest(coalesce(c2.key_themes,'{}')) t
         WHERE c2.id IN ('6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid, 'c1fb599a-6507-46de-8b99-38a6ded42792'::uuid));

DELETE FROM public.companies
 WHERE id IN ('c1fb599a-6507-46de-8b99-38a6ded42792'::uuid);

UPDATE public.companies c
   SET mention_count = (SELECT mentions FROM _fold_agg WHERE k = 'oshkosh'),
       key_themes    = (SELECT themes   FROM _fold_agg WHERE k = 'oshkosh'),
       last_updated  = now()
 WHERE c.id = '6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid;

-- READ-BACK. Look at this BEFORE you COMMIT. Every column must read true.
SELECT
  (SELECT count(*) FROM public.companies WHERE id IN ('c1fb599a-6507-46de-8b99-38a6ded42792'::uuid)) = 0        AS losers_gone,
  (SELECT count(*) FROM public.companies WHERE id = '6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid) = 1 AS survivor_present,
  (SELECT mention_count FROM public.companies WHERE id = '6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid) = 2 AS mentions_summed,
  (SELECT ticker IS NOT DISTINCT FROM NULL FROM public.companies WHERE id = '6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid) AS ticker_unchanged,
  (SELECT sec_cik IS NOT DISTINCT FROM NULL FROM public.companies WHERE id = '6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid) AS cik_unchanged,
  (SELECT count(*) FROM public.company_mentions WHERE company_id IN ('c1fb599a-6507-46de-8b99-38a6ded42792'::uuid)) = 0 AS mentions_repointed,
  (SELECT count(*) FROM public.aliases WHERE canonical_id IN ('c1fb599a-6507-46de-8b99-38a6ded42792'::uuid)) = 0 AS aliases_repointed,
  (SELECT count(*) FROM public.financial_facts WHERE company_id IN ('c1fb599a-6507-46de-8b99-38a6ded42792'::uuid)) = 0 AS facts_repointed;

-- COMMIT;    -- only after every column above read true
-- ROLLBACK;  -- otherwise

-- ROLLBACK AFTER COMMIT. Run in this order, as one transaction.
--   a. Recreate the loser rows. companies_name_key is UNIQUE(name) and
--      companies_name_no_junk is a CHECK, so the names must go back exactly.
--      INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count, sector)
--      VALUES ('c1fb599a-6507-46de-8b99-38a6ded42792'::uuid, 'Oshkosh', NULL, NULL, 1, 'Industrials & Manufacturing');
--   b. Restore the survivor's own fields.
--      UPDATE public.companies SET mention_count = 1, last_updated = now()
--       WHERE id = '6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid;
--      key_themes was a UNION and is not restorable from this file. It is
--      additive and non-identifying; the pipeline rewrites it.
--   c. Repoint the three journaled tables back off norm_v2.moved_row.
--      UPDATE public.company_mentions t SET company_id = j.from_company_id
--        FROM norm_v2.moved_row j
--       WHERE j.new_key = 'handfold:oshkosh' AND j.table_name = 'company_mentions'
--         AND t.id::text = j.row_id;
--      (repeat for sec_filings and insider_transactions)
--   d. financial_facts is NOT journaled and CANNOT be repointed back by this
--      file. That matches norm_v2.merge_cluster, which accepts the same
--      one-way cost. If that is unacceptable for a given block, journal
--      financial_facts too before running it.
--   e. aliases and resolution_log follow the same shape as (c) but have no
--      journal. Re-run backend alias resolution rather than hand-restoring.
--   f. DELETE FROM norm_v2.hand_fold WHERE new_key = 'oshkosh';


-- =====================================================================
-- SECTION 3 -- DECIDABLE, BUT PRE-BLOCKED. Four buckets.
--
-- Each of these is on the 0020b pre-block list, and in each case the recorded
-- reason no longer describes the data. Three were blocked because a member
-- carried a ticker belonging to another company; that ticker is gone from the
-- row, and the WIDENED carrier test finds no identifier on any member from any
-- path, so there is nothing left to launder. The fourth was blocked on a
-- parent/subsidiary distinction that is not one.
--
-- BLOCKED MEANS BLOCKED. Do not run a block in this section until the key has
-- been demoted deliberately, one at a time, the way 0020b says to do it:
--
--   UPDATE norm_v2.plan_cluster
--      SET risk = 'review',
--          risk_reason = risk_reason || '; unblocked by <name> <date>, rationale'
--    WHERE new_key = '<key>';
--
-- The demote is a judgement about two real-world companies. It is not mine to
-- make and the SQL below does not make it. Each block states what changed since
-- the pre-block was written and stops there.
-- =====================================================================

-- ---------------------------------------------------------------------
-- BLOCK B1 -- v2 key 'coherent'   (4 rows -> 1)
--
--   Pre-blocked as '4 spellings, zero identity evidence on any of them'.
--   That is a reason to look, not a finding that the rows are different companies.
--   All four are Coherent Corp, all four sit in Technology, and the app's own read-path key already collapses all four at query time.
--   No identifier exists on any of them under any path, so nothing can be laundered.
--
--   SURVIVES : 'Coherent'  ticker=None  sec_cik=None
--   FOLDS IN : 'Coherent Corp.'  ticker=None  sec_cik=None
--              articles.companies[] holding this name: 43; articles.primary_company: 39
--   FOLDS IN : 'Coherent Corporation'  ticker=None  sec_cik=None
--              articles.companies[] holding this name: 1; articles.primary_company: 1
--   FOLDS IN : 'COHERENT CORP'  ticker=None  sec_cik=None
--              articles.companies[] holding this name: 1; articles.primary_company: 1
--
--   DISPLAYED NAME AFTER THE FOLD: 'Coherent'
--   mention_count on the survivor goes to the cluster sum (238).
--   ticker and sec_cik are NOT written by this block. The survivor either
--   already carries the only identifier in the bucket, or no member has one.
-- ---------------------------------------------------------------------

-- GUARD. Read this first and look at it. Then run the assertion.
SELECT id, name, ticker, sec_cik, mention_count, sector
  FROM public.companies
 WHERE id IN ('15622f53-b0a6-4fb0-b8d5-94e9fdd01b8f'::uuid, '459c1dfc-4d77-4308-920d-6debfcb39fd0'::uuid, '4a1cbccf-e278-4ef9-81e7-85d2206f6d38'::uuid, 'cba2aa6a-2745-4580-aa0b-fd676943d503'::uuid)
 ORDER BY mention_count DESC NULLS LAST, id;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.companies c
   WHERE (c.id = '15622f53-b0a6-4fb0-b8d5-94e9fdd01b8f'::uuid
              AND c.name = 'Coherent Corp.'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 34)
      OR (c.id = '459c1dfc-4d77-4308-920d-6debfcb39fd0'::uuid
              AND c.name = 'Coherent Corporation'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 1)
      OR (c.id = '4a1cbccf-e278-4ef9-81e7-85d2206f6d38'::uuid
              AND c.name = 'Coherent'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 191)
      OR (c.id = 'cba2aa6a-2745-4580-aa0b-fd676943d503'::uuid
              AND c.name = 'COHERENT CORP'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 12);
  IF n <> 4 THEN
    RAISE EXCEPTION 'BLOCK B1 GUARD FAILED: expected 4 pinned rows, found %. A row drifted, or this block already ran. DO NOT PROCEED.', n;
  END IF;
  IF to_regprocedure('norm_v2.lookup_key_v2(text)') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.companies WHERE norm_v2.lookup_key_v2(name) = $1'
      INTO n USING 'coherent';
    IF n <> 4 THEN
      RAISE EXCEPTION 'BLOCK B1 GUARD FAILED: the bucket now holds % rows, not 4. A new member was ingested. Re-measure before folding.', n;
    END IF;
  ELSE
    RAISE NOTICE 'norm_v2.lookup_key_v2 is not installed; cluster-size guard skipped for coherent.';
  END IF;
END $$;

BEGIN;

-- 1. Journal the three reversible dependents BEFORE repointing them.
--    Same table, same shape and same three tables as norm_v2.merge_cluster.
INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:coherent', 'company_mentions', t.id::text, t.company_id, '4a1cbccf-e278-4ef9-81e7-85d2206f6d38'::uuid
  FROM public.company_mentions t
 WHERE t.company_id IN ('15622f53-b0a6-4fb0-b8d5-94e9fdd01b8f'::uuid, '459c1dfc-4d77-4308-920d-6debfcb39fd0'::uuid, 'cba2aa6a-2745-4580-aa0b-fd676943d503'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:coherent', 'sec_filings', t.id::text, t.company_id, '4a1cbccf-e278-4ef9-81e7-85d2206f6d38'::uuid
  FROM public.sec_filings t
 WHERE t.company_id IN ('15622f53-b0a6-4fb0-b8d5-94e9fdd01b8f'::uuid, '459c1dfc-4d77-4308-920d-6debfcb39fd0'::uuid, 'cba2aa6a-2745-4580-aa0b-fd676943d503'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:coherent', 'insider_transactions', t.id::text, t.company_id, '4a1cbccf-e278-4ef9-81e7-85d2206f6d38'::uuid
  FROM public.insider_transactions t
 WHERE t.company_id IN ('15622f53-b0a6-4fb0-b8d5-94e9fdd01b8f'::uuid, '459c1dfc-4d77-4308-920d-6debfcb39fd0'::uuid, 'cba2aa6a-2745-4580-aa0b-fd676943d503'::uuid);

-- 2. Repoint every dependent that keys on companies.id.
--    financial_facts is NOT journaled, exactly as norm_v2.merge_cluster
--    leaves it. Its repoint is one-way. See the ROLLBACK note below.
UPDATE public.company_mentions SET company_id = '4a1cbccf-e278-4ef9-81e7-85d2206f6d38'::uuid
 WHERE company_id IN ('15622f53-b0a6-4fb0-b8d5-94e9fdd01b8f'::uuid, '459c1dfc-4d77-4308-920d-6debfcb39fd0'::uuid, 'cba2aa6a-2745-4580-aa0b-fd676943d503'::uuid);
UPDATE public.financial_facts SET company_id = '4a1cbccf-e278-4ef9-81e7-85d2206f6d38'::uuid
 WHERE company_id IN ('15622f53-b0a6-4fb0-b8d5-94e9fdd01b8f'::uuid, '459c1dfc-4d77-4308-920d-6debfcb39fd0'::uuid, 'cba2aa6a-2745-4580-aa0b-fd676943d503'::uuid);
UPDATE public.insider_transactions SET company_id = '4a1cbccf-e278-4ef9-81e7-85d2206f6d38'::uuid
 WHERE company_id IN ('15622f53-b0a6-4fb0-b8d5-94e9fdd01b8f'::uuid, '459c1dfc-4d77-4308-920d-6debfcb39fd0'::uuid, 'cba2aa6a-2745-4580-aa0b-fd676943d503'::uuid);
UPDATE public.sec_filings SET company_id = '4a1cbccf-e278-4ef9-81e7-85d2206f6d38'::uuid
 WHERE company_id IN ('15622f53-b0a6-4fb0-b8d5-94e9fdd01b8f'::uuid, '459c1dfc-4d77-4308-920d-6debfcb39fd0'::uuid, 'cba2aa6a-2745-4580-aa0b-fd676943d503'::uuid);

UPDATE public.resolution_log SET resolved_canonical_id = '4a1cbccf-e278-4ef9-81e7-85d2206f6d38'::uuid
 WHERE resolved_canonical_id IN ('15622f53-b0a6-4fb0-b8d5-94e9fdd01b8f'::uuid, '459c1dfc-4d77-4308-920d-6debfcb39fd0'::uuid, 'cba2aa6a-2745-4580-aa0b-fd676943d503'::uuid);

-- candidate_canonical_ids is JSONB holding uuid STRINGS, not uuid[].
UPDATE public.resolution_log rl SET candidate_canonical_ids = sub.fixed
  FROM (SELECT l.id,
               (SELECT jsonb_agg(DISTINCT CASE WHEN e.v IN ('15622f53-b0a6-4fb0-b8d5-94e9fdd01b8f', '459c1dfc-4d77-4308-920d-6debfcb39fd0', 'cba2aa6a-2745-4580-aa0b-fd676943d503')
                                          THEN '4a1cbccf-e278-4ef9-81e7-85d2206f6d38' ELSE e.v END)
                  FROM jsonb_array_elements_text(l.candidate_canonical_ids) AS e(v)) AS fixed
          FROM public.resolution_log l
         WHERE jsonb_typeof(l.candidate_canonical_ids) = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(l.candidate_canonical_ids) x(v)
                        WHERE x.v IN ('15622f53-b0a6-4fb0-b8d5-94e9fdd01b8f', '459c1dfc-4d77-4308-920d-6debfcb39fd0', 'cba2aa6a-2745-4580-aa0b-fd676943d503'))
       ) sub
 WHERE rl.id = sub.id;

-- 3. aliases FK is ON DELETE CASCADE. Repointing before the DELETE is not
--    tidiness, it is the only thing that stops the alias rows being destroyed.
UPDATE public.aliases s
   SET mention_count = greatest(coalesce(s.mention_count,0), coalesce(l.mc,0)),
       last_seen_at  = greatest(s.last_seen_at, l.ls)
  FROM (SELECT lookup_key, max(coalesce(mention_count,0)) AS mc, max(last_seen_at) AS ls
          FROM public.aliases
         WHERE canonical_id IN ('15622f53-b0a6-4fb0-b8d5-94e9fdd01b8f'::uuid, '459c1dfc-4d77-4308-920d-6debfcb39fd0'::uuid, 'cba2aa6a-2745-4580-aa0b-fd676943d503'::uuid)
         GROUP BY lookup_key) l
 WHERE s.canonical_id = '4a1cbccf-e278-4ef9-81e7-85d2206f6d38'::uuid AND s.lookup_key = l.lookup_key;

DELETE FROM public.aliases a
 WHERE a.canonical_id IN ('15622f53-b0a6-4fb0-b8d5-94e9fdd01b8f'::uuid, '459c1dfc-4d77-4308-920d-6debfcb39fd0'::uuid, 'cba2aa6a-2745-4580-aa0b-fd676943d503'::uuid)
   AND EXISTS (SELECT 1 FROM public.aliases k
                WHERE k.canonical_id = '4a1cbccf-e278-4ef9-81e7-85d2206f6d38'::uuid AND k.lookup_key = a.lookup_key);

UPDATE public.aliases SET canonical_id = '4a1cbccf-e278-4ef9-81e7-85d2206f6d38'::uuid
 WHERE canonical_id IN ('15622f53-b0a6-4fb0-b8d5-94e9fdd01b8f'::uuid, '459c1dfc-4d77-4308-920d-6debfcb39fd0'::uuid, 'cba2aa6a-2745-4580-aa0b-fd676943d503'::uuid);

-- 4. Name-keyed dependents. Measured 0 rows for every loser in this set,
--    kept so the block stays correct if one appears between now and apply.
DELETE FROM public.user_memo_regeneration_quota q
 WHERE q.company_id IN ('Coherent Corp.', 'Coherent Corporation', 'COHERENT CORP')
   AND EXISTS (SELECT 1 FROM public.user_memo_regeneration_quota k
                WHERE k.user_id = q.user_id AND k.company_id = 'Coherent'
                  AND k.regenerated_at = q.regenerated_at);
UPDATE public.user_memo_regeneration_quota SET company_id = 'Coherent'
 WHERE company_id IN ('Coherent Corp.', 'Coherent Corporation', 'COHERENT CORP');

-- 5. Record the fold so the step-12 articles repair can see it.
INSERT INTO norm_v2.hand_fold (new_key, loser_id, loser_name, survivor_id, survivor_name)
VALUES
  ('coherent', '15622f53-b0a6-4fb0-b8d5-94e9fdd01b8f'::uuid, 'Coherent Corp.', '4a1cbccf-e278-4ef9-81e7-85d2206f6d38'::uuid, 'Coherent'),
  ('coherent', '459c1dfc-4d77-4308-920d-6debfcb39fd0'::uuid, 'Coherent Corporation', '4a1cbccf-e278-4ef9-81e7-85d2206f6d38'::uuid, 'Coherent'),
  ('coherent', 'cba2aa6a-2745-4580-aa0b-fd676943d503'::uuid, 'COHERENT CORP', '4a1cbccf-e278-4ef9-81e7-85d2206f6d38'::uuid, 'Coherent')
ON CONFLICT DO NOTHING;

-- 6. Fold the survivor's own fields. Aggregates are read BEFORE the DELETE
--    because they read the losers; the DELETE then runs; and no identifier
--    is written at all, so the partial unique index on sec_cik is untouched.
CREATE TEMP TABLE IF NOT EXISTS _fold_agg (k text PRIMARY KEY, mentions bigint, themes text[]);
DELETE FROM _fold_agg WHERE k = 'coherent';
INSERT INTO _fold_agg (k, mentions, themes)
SELECT 'coherent',
       (SELECT sum(coalesce(mention_count,0)) FROM public.companies
         WHERE id IN ('15622f53-b0a6-4fb0-b8d5-94e9fdd01b8f'::uuid, '459c1dfc-4d77-4308-920d-6debfcb39fd0'::uuid, '4a1cbccf-e278-4ef9-81e7-85d2206f6d38'::uuid, 'cba2aa6a-2745-4580-aa0b-fd676943d503'::uuid)),
       (SELECT array_agg(DISTINCT t) FROM public.companies c2,
               unnest(coalesce(c2.key_themes,'{}')) t
         WHERE c2.id IN ('15622f53-b0a6-4fb0-b8d5-94e9fdd01b8f'::uuid, '459c1dfc-4d77-4308-920d-6debfcb39fd0'::uuid, '4a1cbccf-e278-4ef9-81e7-85d2206f6d38'::uuid, 'cba2aa6a-2745-4580-aa0b-fd676943d503'::uuid));

DELETE FROM public.companies
 WHERE id IN ('15622f53-b0a6-4fb0-b8d5-94e9fdd01b8f'::uuid, '459c1dfc-4d77-4308-920d-6debfcb39fd0'::uuid, 'cba2aa6a-2745-4580-aa0b-fd676943d503'::uuid);

UPDATE public.companies c
   SET mention_count = (SELECT mentions FROM _fold_agg WHERE k = 'coherent'),
       key_themes    = (SELECT themes   FROM _fold_agg WHERE k = 'coherent'),
       last_updated  = now()
 WHERE c.id = '4a1cbccf-e278-4ef9-81e7-85d2206f6d38'::uuid;

-- READ-BACK. Look at this BEFORE you COMMIT. Every column must read true.
SELECT
  (SELECT count(*) FROM public.companies WHERE id IN ('15622f53-b0a6-4fb0-b8d5-94e9fdd01b8f'::uuid, '459c1dfc-4d77-4308-920d-6debfcb39fd0'::uuid, 'cba2aa6a-2745-4580-aa0b-fd676943d503'::uuid)) = 0        AS losers_gone,
  (SELECT count(*) FROM public.companies WHERE id = '4a1cbccf-e278-4ef9-81e7-85d2206f6d38'::uuid) = 1 AS survivor_present,
  (SELECT mention_count FROM public.companies WHERE id = '4a1cbccf-e278-4ef9-81e7-85d2206f6d38'::uuid) = 238 AS mentions_summed,
  (SELECT ticker IS NOT DISTINCT FROM NULL FROM public.companies WHERE id = '4a1cbccf-e278-4ef9-81e7-85d2206f6d38'::uuid) AS ticker_unchanged,
  (SELECT sec_cik IS NOT DISTINCT FROM NULL FROM public.companies WHERE id = '4a1cbccf-e278-4ef9-81e7-85d2206f6d38'::uuid) AS cik_unchanged,
  (SELECT count(*) FROM public.company_mentions WHERE company_id IN ('15622f53-b0a6-4fb0-b8d5-94e9fdd01b8f'::uuid, '459c1dfc-4d77-4308-920d-6debfcb39fd0'::uuid, 'cba2aa6a-2745-4580-aa0b-fd676943d503'::uuid)) = 0 AS mentions_repointed,
  (SELECT count(*) FROM public.aliases WHERE canonical_id IN ('15622f53-b0a6-4fb0-b8d5-94e9fdd01b8f'::uuid, '459c1dfc-4d77-4308-920d-6debfcb39fd0'::uuid, 'cba2aa6a-2745-4580-aa0b-fd676943d503'::uuid)) = 0 AS aliases_repointed,
  (SELECT count(*) FROM public.financial_facts WHERE company_id IN ('15622f53-b0a6-4fb0-b8d5-94e9fdd01b8f'::uuid, '459c1dfc-4d77-4308-920d-6debfcb39fd0'::uuid, 'cba2aa6a-2745-4580-aa0b-fd676943d503'::uuid)) = 0 AS facts_repointed;

-- COMMIT;    -- only after every column above read true
-- ROLLBACK;  -- otherwise

-- ROLLBACK AFTER COMMIT. Run in this order, as one transaction.
--   a. Recreate the loser rows. companies_name_key is UNIQUE(name) and
--      companies_name_no_junk is a CHECK, so the names must go back exactly.
--      INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count, sector)
--      VALUES ('15622f53-b0a6-4fb0-b8d5-94e9fdd01b8f'::uuid, 'Coherent Corp.', NULL, NULL, 34, 'Technology');
--      INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count, sector)
--      VALUES ('459c1dfc-4d77-4308-920d-6debfcb39fd0'::uuid, 'Coherent Corporation', NULL, NULL, 1, 'Technology');
--      INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count, sector)
--      VALUES ('cba2aa6a-2745-4580-aa0b-fd676943d503'::uuid, 'COHERENT CORP', NULL, NULL, 12, 'Technology');
--   b. Restore the survivor's own fields.
--      UPDATE public.companies SET mention_count = 191, last_updated = now()
--       WHERE id = '4a1cbccf-e278-4ef9-81e7-85d2206f6d38'::uuid;
--      key_themes was a UNION and is not restorable from this file. It is
--      additive and non-identifying; the pipeline rewrites it.
--   c. Repoint the three journaled tables back off norm_v2.moved_row.
--      UPDATE public.company_mentions t SET company_id = j.from_company_id
--        FROM norm_v2.moved_row j
--       WHERE j.new_key = 'handfold:coherent' AND j.table_name = 'company_mentions'
--         AND t.id::text = j.row_id;
--      (repeat for sec_filings and insider_transactions)
--   d. financial_facts is NOT journaled and CANNOT be repointed back by this
--      file. That matches norm_v2.merge_cluster, which accepts the same
--      one-way cost. If that is unacceptable for a given block, journal
--      financial_facts too before running it.
--   e. aliases and resolution_log follow the same shape as (c) but have no
--      journal. Re-run backend alias resolution rather than hand-restoring.
--   f. DELETE FROM norm_v2.hand_fold WHERE new_key = 'coherent';


-- ---------------------------------------------------------------------
-- BLOCK B2 -- v2 key 'stran'   (2 rows -> 1)
--
--   Pre-blocked because 'Stran' carried ASTH (Astrana Health).
--   That ticker is GONE from the row: measured today, neither member carries a ticker or a cik, and no financial_facts, sec_filings or insider_transactions row reaches either one.
--   Both names are Stran & Company, same sector.
--
--   SURVIVES : 'Stran'  ticker=None  sec_cik=None
--   FOLDS IN : 'Stran & Company, Inc.'  ticker=None  sec_cik=None
--              articles.companies[] holding this name: 4; articles.primary_company: 4
--
--   DISPLAYED NAME AFTER THE FOLD: 'Stran'
--   mention_count on the survivor goes to the cluster sum (5).
--   ticker and sec_cik are NOT written by this block. The survivor either
--   already carries the only identifier in the bucket, or no member has one.
-- ---------------------------------------------------------------------

-- GUARD. Read this first and look at it. Then run the assertion.
SELECT id, name, ticker, sec_cik, mention_count, sector
  FROM public.companies
 WHERE id IN ('eadedebb-8f16-4ed5-975f-3c3005d8c975'::uuid, 'fe758d38-836a-40d4-a2c1-92447f5c26a0'::uuid)
 ORDER BY mention_count DESC NULLS LAST, id;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.companies c
   WHERE (c.id = 'eadedebb-8f16-4ed5-975f-3c3005d8c975'::uuid
              AND c.name = 'Stran'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 3)
      OR (c.id = 'fe758d38-836a-40d4-a2c1-92447f5c26a0'::uuid
              AND c.name = 'Stran & Company, Inc.'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 2);
  IF n <> 2 THEN
    RAISE EXCEPTION 'BLOCK B2 GUARD FAILED: expected 2 pinned rows, found %. A row drifted, or this block already ran. DO NOT PROCEED.', n;
  END IF;
  IF to_regprocedure('norm_v2.lookup_key_v2(text)') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.companies WHERE norm_v2.lookup_key_v2(name) = $1'
      INTO n USING 'stran';
    IF n <> 2 THEN
      RAISE EXCEPTION 'BLOCK B2 GUARD FAILED: the bucket now holds % rows, not 2. A new member was ingested. Re-measure before folding.', n;
    END IF;
  ELSE
    RAISE NOTICE 'norm_v2.lookup_key_v2 is not installed; cluster-size guard skipped for stran.';
  END IF;
END $$;

BEGIN;

-- 1. Journal the three reversible dependents BEFORE repointing them.
--    Same table, same shape and same three tables as norm_v2.merge_cluster.
INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:stran', 'company_mentions', t.id::text, t.company_id, 'eadedebb-8f16-4ed5-975f-3c3005d8c975'::uuid
  FROM public.company_mentions t
 WHERE t.company_id IN ('fe758d38-836a-40d4-a2c1-92447f5c26a0'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:stran', 'sec_filings', t.id::text, t.company_id, 'eadedebb-8f16-4ed5-975f-3c3005d8c975'::uuid
  FROM public.sec_filings t
 WHERE t.company_id IN ('fe758d38-836a-40d4-a2c1-92447f5c26a0'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:stran', 'insider_transactions', t.id::text, t.company_id, 'eadedebb-8f16-4ed5-975f-3c3005d8c975'::uuid
  FROM public.insider_transactions t
 WHERE t.company_id IN ('fe758d38-836a-40d4-a2c1-92447f5c26a0'::uuid);

-- 2. Repoint every dependent that keys on companies.id.
--    financial_facts is NOT journaled, exactly as norm_v2.merge_cluster
--    leaves it. Its repoint is one-way. See the ROLLBACK note below.
UPDATE public.company_mentions SET company_id = 'eadedebb-8f16-4ed5-975f-3c3005d8c975'::uuid
 WHERE company_id IN ('fe758d38-836a-40d4-a2c1-92447f5c26a0'::uuid);
UPDATE public.financial_facts SET company_id = 'eadedebb-8f16-4ed5-975f-3c3005d8c975'::uuid
 WHERE company_id IN ('fe758d38-836a-40d4-a2c1-92447f5c26a0'::uuid);
UPDATE public.insider_transactions SET company_id = 'eadedebb-8f16-4ed5-975f-3c3005d8c975'::uuid
 WHERE company_id IN ('fe758d38-836a-40d4-a2c1-92447f5c26a0'::uuid);
UPDATE public.sec_filings SET company_id = 'eadedebb-8f16-4ed5-975f-3c3005d8c975'::uuid
 WHERE company_id IN ('fe758d38-836a-40d4-a2c1-92447f5c26a0'::uuid);

UPDATE public.resolution_log SET resolved_canonical_id = 'eadedebb-8f16-4ed5-975f-3c3005d8c975'::uuid
 WHERE resolved_canonical_id IN ('fe758d38-836a-40d4-a2c1-92447f5c26a0'::uuid);

-- candidate_canonical_ids is JSONB holding uuid STRINGS, not uuid[].
UPDATE public.resolution_log rl SET candidate_canonical_ids = sub.fixed
  FROM (SELECT l.id,
               (SELECT jsonb_agg(DISTINCT CASE WHEN e.v IN ('fe758d38-836a-40d4-a2c1-92447f5c26a0')
                                          THEN 'eadedebb-8f16-4ed5-975f-3c3005d8c975' ELSE e.v END)
                  FROM jsonb_array_elements_text(l.candidate_canonical_ids) AS e(v)) AS fixed
          FROM public.resolution_log l
         WHERE jsonb_typeof(l.candidate_canonical_ids) = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(l.candidate_canonical_ids) x(v)
                        WHERE x.v IN ('fe758d38-836a-40d4-a2c1-92447f5c26a0'))
       ) sub
 WHERE rl.id = sub.id;

-- 3. aliases FK is ON DELETE CASCADE. Repointing before the DELETE is not
--    tidiness, it is the only thing that stops the alias rows being destroyed.
UPDATE public.aliases s
   SET mention_count = greatest(coalesce(s.mention_count,0), coalesce(l.mc,0)),
       last_seen_at  = greatest(s.last_seen_at, l.ls)
  FROM (SELECT lookup_key, max(coalesce(mention_count,0)) AS mc, max(last_seen_at) AS ls
          FROM public.aliases
         WHERE canonical_id IN ('fe758d38-836a-40d4-a2c1-92447f5c26a0'::uuid)
         GROUP BY lookup_key) l
 WHERE s.canonical_id = 'eadedebb-8f16-4ed5-975f-3c3005d8c975'::uuid AND s.lookup_key = l.lookup_key;

DELETE FROM public.aliases a
 WHERE a.canonical_id IN ('fe758d38-836a-40d4-a2c1-92447f5c26a0'::uuid)
   AND EXISTS (SELECT 1 FROM public.aliases k
                WHERE k.canonical_id = 'eadedebb-8f16-4ed5-975f-3c3005d8c975'::uuid AND k.lookup_key = a.lookup_key);

UPDATE public.aliases SET canonical_id = 'eadedebb-8f16-4ed5-975f-3c3005d8c975'::uuid
 WHERE canonical_id IN ('fe758d38-836a-40d4-a2c1-92447f5c26a0'::uuid);

-- 4. Name-keyed dependents. Measured 0 rows for every loser in this set,
--    kept so the block stays correct if one appears between now and apply.
DELETE FROM public.user_memo_regeneration_quota q
 WHERE q.company_id IN ('Stran & Company, Inc.')
   AND EXISTS (SELECT 1 FROM public.user_memo_regeneration_quota k
                WHERE k.user_id = q.user_id AND k.company_id = 'Stran'
                  AND k.regenerated_at = q.regenerated_at);
UPDATE public.user_memo_regeneration_quota SET company_id = 'Stran'
 WHERE company_id IN ('Stran & Company, Inc.');

-- 5. Record the fold so the step-12 articles repair can see it.
INSERT INTO norm_v2.hand_fold (new_key, loser_id, loser_name, survivor_id, survivor_name)
VALUES
  ('stran', 'fe758d38-836a-40d4-a2c1-92447f5c26a0'::uuid, 'Stran & Company, Inc.', 'eadedebb-8f16-4ed5-975f-3c3005d8c975'::uuid, 'Stran')
ON CONFLICT DO NOTHING;

-- 6. Fold the survivor's own fields. Aggregates are read BEFORE the DELETE
--    because they read the losers; the DELETE then runs; and no identifier
--    is written at all, so the partial unique index on sec_cik is untouched.
CREATE TEMP TABLE IF NOT EXISTS _fold_agg (k text PRIMARY KEY, mentions bigint, themes text[]);
DELETE FROM _fold_agg WHERE k = 'stran';
INSERT INTO _fold_agg (k, mentions, themes)
SELECT 'stran',
       (SELECT sum(coalesce(mention_count,0)) FROM public.companies
         WHERE id IN ('eadedebb-8f16-4ed5-975f-3c3005d8c975'::uuid, 'fe758d38-836a-40d4-a2c1-92447f5c26a0'::uuid)),
       (SELECT array_agg(DISTINCT t) FROM public.companies c2,
               unnest(coalesce(c2.key_themes,'{}')) t
         WHERE c2.id IN ('eadedebb-8f16-4ed5-975f-3c3005d8c975'::uuid, 'fe758d38-836a-40d4-a2c1-92447f5c26a0'::uuid));

DELETE FROM public.companies
 WHERE id IN ('fe758d38-836a-40d4-a2c1-92447f5c26a0'::uuid);

UPDATE public.companies c
   SET mention_count = (SELECT mentions FROM _fold_agg WHERE k = 'stran'),
       key_themes    = (SELECT themes   FROM _fold_agg WHERE k = 'stran'),
       last_updated  = now()
 WHERE c.id = 'eadedebb-8f16-4ed5-975f-3c3005d8c975'::uuid;

-- READ-BACK. Look at this BEFORE you COMMIT. Every column must read true.
SELECT
  (SELECT count(*) FROM public.companies WHERE id IN ('fe758d38-836a-40d4-a2c1-92447f5c26a0'::uuid)) = 0        AS losers_gone,
  (SELECT count(*) FROM public.companies WHERE id = 'eadedebb-8f16-4ed5-975f-3c3005d8c975'::uuid) = 1 AS survivor_present,
  (SELECT mention_count FROM public.companies WHERE id = 'eadedebb-8f16-4ed5-975f-3c3005d8c975'::uuid) = 5 AS mentions_summed,
  (SELECT ticker IS NOT DISTINCT FROM NULL FROM public.companies WHERE id = 'eadedebb-8f16-4ed5-975f-3c3005d8c975'::uuid) AS ticker_unchanged,
  (SELECT sec_cik IS NOT DISTINCT FROM NULL FROM public.companies WHERE id = 'eadedebb-8f16-4ed5-975f-3c3005d8c975'::uuid) AS cik_unchanged,
  (SELECT count(*) FROM public.company_mentions WHERE company_id IN ('fe758d38-836a-40d4-a2c1-92447f5c26a0'::uuid)) = 0 AS mentions_repointed,
  (SELECT count(*) FROM public.aliases WHERE canonical_id IN ('fe758d38-836a-40d4-a2c1-92447f5c26a0'::uuid)) = 0 AS aliases_repointed,
  (SELECT count(*) FROM public.financial_facts WHERE company_id IN ('fe758d38-836a-40d4-a2c1-92447f5c26a0'::uuid)) = 0 AS facts_repointed;

-- COMMIT;    -- only after every column above read true
-- ROLLBACK;  -- otherwise

-- ROLLBACK AFTER COMMIT. Run in this order, as one transaction.
--   a. Recreate the loser rows. companies_name_key is UNIQUE(name) and
--      companies_name_no_junk is a CHECK, so the names must go back exactly.
--      INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count, sector)
--      VALUES ('fe758d38-836a-40d4-a2c1-92447f5c26a0'::uuid, 'Stran & Company, Inc.', NULL, NULL, 2, 'Consumer & Retail');
--   b. Restore the survivor's own fields.
--      UPDATE public.companies SET mention_count = 3, last_updated = now()
--       WHERE id = 'eadedebb-8f16-4ed5-975f-3c3005d8c975'::uuid;
--      key_themes was a UNION and is not restorable from this file. It is
--      additive and non-identifying; the pipeline rewrites it.
--   c. Repoint the three journaled tables back off norm_v2.moved_row.
--      UPDATE public.company_mentions t SET company_id = j.from_company_id
--        FROM norm_v2.moved_row j
--       WHERE j.new_key = 'handfold:stran' AND j.table_name = 'company_mentions'
--         AND t.id::text = j.row_id;
--      (repeat for sec_filings and insider_transactions)
--   d. financial_facts is NOT journaled and CANNOT be repointed back by this
--      file. That matches norm_v2.merge_cluster, which accepts the same
--      one-way cost. If that is unacceptable for a given block, journal
--      financial_facts too before running it.
--   e. aliases and resolution_log follow the same shape as (c) but have no
--      journal. Re-run backend alias resolution rather than hand-restoring.
--   f. DELETE FROM norm_v2.hand_fold WHERE new_key = 'stran';


-- ---------------------------------------------------------------------
-- BLOCK B3 -- v2 key 'byd'   (5 rows -> 1)
--
--   Pre-blocked because two rows carried ticker BYD (Boyd Gaming's symbol).
--   That ticker is GONE: measured today, none of the five members carries a ticker or a cik, and no SEC-side row reaches any of them.
--   All five names are BYD Co Ltd spellings.
--   The members DISAGREE ON SECTOR, which is a data-quality defect to fix on the survivor, not evidence of two companies.
--
--   SURVIVES : 'BYD'  ticker=None  sec_cik=None
--   FOLDS IN : 'BYD Co.'  ticker=None  sec_cik=None
--              articles.companies[] holding this name: 5; articles.primary_company: 3
--   FOLDS IN : 'BYD Company Limited'  ticker=None  sec_cik=None
--              articles.companies[] holding this name: 4; articles.primary_company: 4
--   FOLDS IN : 'BYD COMPANY'  ticker=None  sec_cik=None
--              articles.companies[] holding this name: 5; articles.primary_company: 4
--   FOLDS IN : 'BYD Co Ltd'  ticker=None  sec_cik=None
--              articles.companies[] holding this name: 1; articles.primary_company: 1
--
--   DISPLAYED NAME AFTER THE FOLD: 'BYD'
--   mention_count on the survivor goes to the cluster sum (277).
--   ticker and sec_cik are NOT written by this block. The survivor either
--   already carries the only identifier in the bucket, or no member has one.
-- ---------------------------------------------------------------------

-- GUARD. Read this first and look at it. Then run the assertion.
SELECT id, name, ticker, sec_cik, mention_count, sector
  FROM public.companies
 WHERE id IN ('008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid, '0d7e98d8-6d03-4504-a77a-72a0fcba8f83'::uuid, '33061072-1f18-40df-abf2-02e1181f608d'::uuid, '940ce4a1-888e-4427-b49d-469f56c24bc6'::uuid, 'f1c94176-f6c2-441b-8db6-65541efeb645'::uuid)
 ORDER BY mention_count DESC NULLS LAST, id;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.companies c
   WHERE (c.id = '008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid
              AND c.name = 'BYD'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 260)
      OR (c.id = '0d7e98d8-6d03-4504-a77a-72a0fcba8f83'::uuid
              AND c.name = 'BYD Co.'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 5)
      OR (c.id = '33061072-1f18-40df-abf2-02e1181f608d'::uuid
              AND c.name = 'BYD Company Limited'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 4)
      OR (c.id = '940ce4a1-888e-4427-b49d-469f56c24bc6'::uuid
              AND c.name = 'BYD COMPANY'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 7)
      OR (c.id = 'f1c94176-f6c2-441b-8db6-65541efeb645'::uuid
              AND c.name = 'BYD Co Ltd'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 1);
  IF n <> 5 THEN
    RAISE EXCEPTION 'BLOCK B3 GUARD FAILED: expected 5 pinned rows, found %. A row drifted, or this block already ran. DO NOT PROCEED.', n;
  END IF;
  IF to_regprocedure('norm_v2.lookup_key_v2(text)') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.companies WHERE norm_v2.lookup_key_v2(name) = $1'
      INTO n USING 'byd';
    IF n <> 5 THEN
      RAISE EXCEPTION 'BLOCK B3 GUARD FAILED: the bucket now holds % rows, not 5. A new member was ingested. Re-measure before folding.', n;
    END IF;
  ELSE
    RAISE NOTICE 'norm_v2.lookup_key_v2 is not installed; cluster-size guard skipped for byd.';
  END IF;
END $$;

BEGIN;

-- 1. Journal the three reversible dependents BEFORE repointing them.
--    Same table, same shape and same three tables as norm_v2.merge_cluster.
INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:byd', 'company_mentions', t.id::text, t.company_id, '008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid
  FROM public.company_mentions t
 WHERE t.company_id IN ('0d7e98d8-6d03-4504-a77a-72a0fcba8f83'::uuid, '33061072-1f18-40df-abf2-02e1181f608d'::uuid, '940ce4a1-888e-4427-b49d-469f56c24bc6'::uuid, 'f1c94176-f6c2-441b-8db6-65541efeb645'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:byd', 'sec_filings', t.id::text, t.company_id, '008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid
  FROM public.sec_filings t
 WHERE t.company_id IN ('0d7e98d8-6d03-4504-a77a-72a0fcba8f83'::uuid, '33061072-1f18-40df-abf2-02e1181f608d'::uuid, '940ce4a1-888e-4427-b49d-469f56c24bc6'::uuid, 'f1c94176-f6c2-441b-8db6-65541efeb645'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:byd', 'insider_transactions', t.id::text, t.company_id, '008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid
  FROM public.insider_transactions t
 WHERE t.company_id IN ('0d7e98d8-6d03-4504-a77a-72a0fcba8f83'::uuid, '33061072-1f18-40df-abf2-02e1181f608d'::uuid, '940ce4a1-888e-4427-b49d-469f56c24bc6'::uuid, 'f1c94176-f6c2-441b-8db6-65541efeb645'::uuid);

-- 2. Repoint every dependent that keys on companies.id.
--    financial_facts is NOT journaled, exactly as norm_v2.merge_cluster
--    leaves it. Its repoint is one-way. See the ROLLBACK note below.
UPDATE public.company_mentions SET company_id = '008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid
 WHERE company_id IN ('0d7e98d8-6d03-4504-a77a-72a0fcba8f83'::uuid, '33061072-1f18-40df-abf2-02e1181f608d'::uuid, '940ce4a1-888e-4427-b49d-469f56c24bc6'::uuid, 'f1c94176-f6c2-441b-8db6-65541efeb645'::uuid);
UPDATE public.financial_facts SET company_id = '008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid
 WHERE company_id IN ('0d7e98d8-6d03-4504-a77a-72a0fcba8f83'::uuid, '33061072-1f18-40df-abf2-02e1181f608d'::uuid, '940ce4a1-888e-4427-b49d-469f56c24bc6'::uuid, 'f1c94176-f6c2-441b-8db6-65541efeb645'::uuid);
UPDATE public.insider_transactions SET company_id = '008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid
 WHERE company_id IN ('0d7e98d8-6d03-4504-a77a-72a0fcba8f83'::uuid, '33061072-1f18-40df-abf2-02e1181f608d'::uuid, '940ce4a1-888e-4427-b49d-469f56c24bc6'::uuid, 'f1c94176-f6c2-441b-8db6-65541efeb645'::uuid);
UPDATE public.sec_filings SET company_id = '008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid
 WHERE company_id IN ('0d7e98d8-6d03-4504-a77a-72a0fcba8f83'::uuid, '33061072-1f18-40df-abf2-02e1181f608d'::uuid, '940ce4a1-888e-4427-b49d-469f56c24bc6'::uuid, 'f1c94176-f6c2-441b-8db6-65541efeb645'::uuid);

UPDATE public.resolution_log SET resolved_canonical_id = '008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid
 WHERE resolved_canonical_id IN ('0d7e98d8-6d03-4504-a77a-72a0fcba8f83'::uuid, '33061072-1f18-40df-abf2-02e1181f608d'::uuid, '940ce4a1-888e-4427-b49d-469f56c24bc6'::uuid, 'f1c94176-f6c2-441b-8db6-65541efeb645'::uuid);

-- candidate_canonical_ids is JSONB holding uuid STRINGS, not uuid[].
UPDATE public.resolution_log rl SET candidate_canonical_ids = sub.fixed
  FROM (SELECT l.id,
               (SELECT jsonb_agg(DISTINCT CASE WHEN e.v IN ('0d7e98d8-6d03-4504-a77a-72a0fcba8f83', '33061072-1f18-40df-abf2-02e1181f608d', '940ce4a1-888e-4427-b49d-469f56c24bc6', 'f1c94176-f6c2-441b-8db6-65541efeb645')
                                          THEN '008e0e69-5a85-40f2-88f4-e4a35a9ff8fb' ELSE e.v END)
                  FROM jsonb_array_elements_text(l.candidate_canonical_ids) AS e(v)) AS fixed
          FROM public.resolution_log l
         WHERE jsonb_typeof(l.candidate_canonical_ids) = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(l.candidate_canonical_ids) x(v)
                        WHERE x.v IN ('0d7e98d8-6d03-4504-a77a-72a0fcba8f83', '33061072-1f18-40df-abf2-02e1181f608d', '940ce4a1-888e-4427-b49d-469f56c24bc6', 'f1c94176-f6c2-441b-8db6-65541efeb645'))
       ) sub
 WHERE rl.id = sub.id;

-- 3. aliases FK is ON DELETE CASCADE. Repointing before the DELETE is not
--    tidiness, it is the only thing that stops the alias rows being destroyed.
UPDATE public.aliases s
   SET mention_count = greatest(coalesce(s.mention_count,0), coalesce(l.mc,0)),
       last_seen_at  = greatest(s.last_seen_at, l.ls)
  FROM (SELECT lookup_key, max(coalesce(mention_count,0)) AS mc, max(last_seen_at) AS ls
          FROM public.aliases
         WHERE canonical_id IN ('0d7e98d8-6d03-4504-a77a-72a0fcba8f83'::uuid, '33061072-1f18-40df-abf2-02e1181f608d'::uuid, '940ce4a1-888e-4427-b49d-469f56c24bc6'::uuid, 'f1c94176-f6c2-441b-8db6-65541efeb645'::uuid)
         GROUP BY lookup_key) l
 WHERE s.canonical_id = '008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid AND s.lookup_key = l.lookup_key;

DELETE FROM public.aliases a
 WHERE a.canonical_id IN ('0d7e98d8-6d03-4504-a77a-72a0fcba8f83'::uuid, '33061072-1f18-40df-abf2-02e1181f608d'::uuid, '940ce4a1-888e-4427-b49d-469f56c24bc6'::uuid, 'f1c94176-f6c2-441b-8db6-65541efeb645'::uuid)
   AND EXISTS (SELECT 1 FROM public.aliases k
                WHERE k.canonical_id = '008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid AND k.lookup_key = a.lookup_key);

UPDATE public.aliases SET canonical_id = '008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid
 WHERE canonical_id IN ('0d7e98d8-6d03-4504-a77a-72a0fcba8f83'::uuid, '33061072-1f18-40df-abf2-02e1181f608d'::uuid, '940ce4a1-888e-4427-b49d-469f56c24bc6'::uuid, 'f1c94176-f6c2-441b-8db6-65541efeb645'::uuid);

-- 4. Name-keyed dependents. Measured 0 rows for every loser in this set,
--    kept so the block stays correct if one appears between now and apply.
DELETE FROM public.user_memo_regeneration_quota q
 WHERE q.company_id IN ('BYD Co.', 'BYD Company Limited', 'BYD COMPANY', 'BYD Co Ltd')
   AND EXISTS (SELECT 1 FROM public.user_memo_regeneration_quota k
                WHERE k.user_id = q.user_id AND k.company_id = 'BYD'
                  AND k.regenerated_at = q.regenerated_at);
UPDATE public.user_memo_regeneration_quota SET company_id = 'BYD'
 WHERE company_id IN ('BYD Co.', 'BYD Company Limited', 'BYD COMPANY', 'BYD Co Ltd');

-- 5. Record the fold so the step-12 articles repair can see it.
INSERT INTO norm_v2.hand_fold (new_key, loser_id, loser_name, survivor_id, survivor_name)
VALUES
  ('byd', '0d7e98d8-6d03-4504-a77a-72a0fcba8f83'::uuid, 'BYD Co.', '008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid, 'BYD'),
  ('byd', '33061072-1f18-40df-abf2-02e1181f608d'::uuid, 'BYD Company Limited', '008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid, 'BYD'),
  ('byd', '940ce4a1-888e-4427-b49d-469f56c24bc6'::uuid, 'BYD COMPANY', '008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid, 'BYD'),
  ('byd', 'f1c94176-f6c2-441b-8db6-65541efeb645'::uuid, 'BYD Co Ltd', '008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid, 'BYD')
ON CONFLICT DO NOTHING;

-- 6. Fold the survivor's own fields. Aggregates are read BEFORE the DELETE
--    because they read the losers; the DELETE then runs; and no identifier
--    is written at all, so the partial unique index on sec_cik is untouched.
CREATE TEMP TABLE IF NOT EXISTS _fold_agg (k text PRIMARY KEY, mentions bigint, themes text[]);
DELETE FROM _fold_agg WHERE k = 'byd';
INSERT INTO _fold_agg (k, mentions, themes)
SELECT 'byd',
       (SELECT sum(coalesce(mention_count,0)) FROM public.companies
         WHERE id IN ('008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid, '0d7e98d8-6d03-4504-a77a-72a0fcba8f83'::uuid, '33061072-1f18-40df-abf2-02e1181f608d'::uuid, '940ce4a1-888e-4427-b49d-469f56c24bc6'::uuid, 'f1c94176-f6c2-441b-8db6-65541efeb645'::uuid)),
       (SELECT array_agg(DISTINCT t) FROM public.companies c2,
               unnest(coalesce(c2.key_themes,'{}')) t
         WHERE c2.id IN ('008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid, '0d7e98d8-6d03-4504-a77a-72a0fcba8f83'::uuid, '33061072-1f18-40df-abf2-02e1181f608d'::uuid, '940ce4a1-888e-4427-b49d-469f56c24bc6'::uuid, 'f1c94176-f6c2-441b-8db6-65541efeb645'::uuid));

DELETE FROM public.companies
 WHERE id IN ('0d7e98d8-6d03-4504-a77a-72a0fcba8f83'::uuid, '33061072-1f18-40df-abf2-02e1181f608d'::uuid, '940ce4a1-888e-4427-b49d-469f56c24bc6'::uuid, 'f1c94176-f6c2-441b-8db6-65541efeb645'::uuid);

UPDATE public.companies c
   SET mention_count = (SELECT mentions FROM _fold_agg WHERE k = 'byd'),
       key_themes    = (SELECT themes   FROM _fold_agg WHERE k = 'byd'),
       last_updated  = now()
 WHERE c.id = '008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid;

-- READ-BACK. Look at this BEFORE you COMMIT. Every column must read true.
SELECT
  (SELECT count(*) FROM public.companies WHERE id IN ('0d7e98d8-6d03-4504-a77a-72a0fcba8f83'::uuid, '33061072-1f18-40df-abf2-02e1181f608d'::uuid, '940ce4a1-888e-4427-b49d-469f56c24bc6'::uuid, 'f1c94176-f6c2-441b-8db6-65541efeb645'::uuid)) = 0        AS losers_gone,
  (SELECT count(*) FROM public.companies WHERE id = '008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid) = 1 AS survivor_present,
  (SELECT mention_count FROM public.companies WHERE id = '008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid) = 277 AS mentions_summed,
  (SELECT ticker IS NOT DISTINCT FROM NULL FROM public.companies WHERE id = '008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid) AS ticker_unchanged,
  (SELECT sec_cik IS NOT DISTINCT FROM NULL FROM public.companies WHERE id = '008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid) AS cik_unchanged,
  (SELECT count(*) FROM public.company_mentions WHERE company_id IN ('0d7e98d8-6d03-4504-a77a-72a0fcba8f83'::uuid, '33061072-1f18-40df-abf2-02e1181f608d'::uuid, '940ce4a1-888e-4427-b49d-469f56c24bc6'::uuid, 'f1c94176-f6c2-441b-8db6-65541efeb645'::uuid)) = 0 AS mentions_repointed,
  (SELECT count(*) FROM public.aliases WHERE canonical_id IN ('0d7e98d8-6d03-4504-a77a-72a0fcba8f83'::uuid, '33061072-1f18-40df-abf2-02e1181f608d'::uuid, '940ce4a1-888e-4427-b49d-469f56c24bc6'::uuid, 'f1c94176-f6c2-441b-8db6-65541efeb645'::uuid)) = 0 AS aliases_repointed,
  (SELECT count(*) FROM public.financial_facts WHERE company_id IN ('0d7e98d8-6d03-4504-a77a-72a0fcba8f83'::uuid, '33061072-1f18-40df-abf2-02e1181f608d'::uuid, '940ce4a1-888e-4427-b49d-469f56c24bc6'::uuid, 'f1c94176-f6c2-441b-8db6-65541efeb645'::uuid)) = 0 AS facts_repointed;

-- COMMIT;    -- only after every column above read true
-- ROLLBACK;  -- otherwise

-- ROLLBACK AFTER COMMIT. Run in this order, as one transaction.
--   a. Recreate the loser rows. companies_name_key is UNIQUE(name) and
--      companies_name_no_junk is a CHECK, so the names must go back exactly.
--      INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count, sector)
--      VALUES ('0d7e98d8-6d03-4504-a77a-72a0fcba8f83'::uuid, 'BYD Co.', NULL, NULL, 5, 'Consumer & Retail');
--      INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count, sector)
--      VALUES ('33061072-1f18-40df-abf2-02e1181f608d'::uuid, 'BYD Company Limited', NULL, NULL, 4, 'Industrials & Manufacturing');
--      INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count, sector)
--      VALUES ('940ce4a1-888e-4427-b49d-469f56c24bc6'::uuid, 'BYD COMPANY', NULL, NULL, 7, 'Industrials & Manufacturing');
--      INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count, sector)
--      VALUES ('f1c94176-f6c2-441b-8db6-65541efeb645'::uuid, 'BYD Co Ltd', NULL, NULL, 1, 'Industrials & Manufacturing');
--   b. Restore the survivor's own fields.
--      UPDATE public.companies SET mention_count = 260, last_updated = now()
--       WHERE id = '008e0e69-5a85-40f2-88f4-e4a35a9ff8fb'::uuid;
--      key_themes was a UNION and is not restorable from this file. It is
--      additive and non-identifying; the pipeline rewrites it.
--   c. Repoint the three journaled tables back off norm_v2.moved_row.
--      UPDATE public.company_mentions t SET company_id = j.from_company_id
--        FROM norm_v2.moved_row j
--       WHERE j.new_key = 'handfold:byd' AND j.table_name = 'company_mentions'
--         AND t.id::text = j.row_id;
--      (repeat for sec_filings and insider_transactions)
--   d. financial_facts is NOT journaled and CANNOT be repointed back by this
--      file. That matches norm_v2.merge_cluster, which accepts the same
--      one-way cost. If that is unacceptable for a given block, journal
--      financial_facts too before running it.
--   e. aliases and resolution_log follow the same shape as (c) but have no
--      journal. Re-run backend alias resolution rather than hand-restoring.
--   f. DELETE FROM norm_v2.hand_fold WHERE new_key = 'byd';


-- ---------------------------------------------------------------------
-- BLOCK B4 -- v2 key 'ig'   (2 rows -> 1)
--
--   Pre-blocked as 'IG Group vs IG Group Holdings Plc'.
--   Those are the operating group and its listed parent, not two businesses.
--   No identifier on either row under any path.
--   The 0020 design doc already recommends merging this key.
--
--   SURVIVES : 'IG Group'  ticker=None  sec_cik=None
--   FOLDS IN : 'IG Group Holdings Plc'  ticker=None  sec_cik=None
--              articles.companies[] holding this name: 1; articles.primary_company: 0
--
--   DISPLAYED NAME AFTER THE FOLD: 'IG Group'
--   mention_count on the survivor goes to the cluster sum (3).
--   ticker and sec_cik are NOT written by this block. The survivor either
--   already carries the only identifier in the bucket, or no member has one.
-- ---------------------------------------------------------------------

-- GUARD. Read this first and look at it. Then run the assertion.
SELECT id, name, ticker, sec_cik, mention_count, sector
  FROM public.companies
 WHERE id IN ('2e5c4fdd-573a-4db5-a961-38b49b5f82a7'::uuid, '586ad62c-6c7b-4e5f-9ce3-72d2102b6dec'::uuid)
 ORDER BY mention_count DESC NULLS LAST, id;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.companies c
   WHERE (c.id = '2e5c4fdd-573a-4db5-a961-38b49b5f82a7'::uuid
              AND c.name = 'IG Group'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 2)
      OR (c.id = '586ad62c-6c7b-4e5f-9ce3-72d2102b6dec'::uuid
              AND c.name = 'IG Group Holdings Plc'
              AND c.ticker IS NOT DISTINCT FROM NULL
              AND c.sec_cik IS NOT DISTINCT FROM NULL
              AND c.mention_count IS NOT DISTINCT FROM 1);
  IF n <> 2 THEN
    RAISE EXCEPTION 'BLOCK B4 GUARD FAILED: expected 2 pinned rows, found %. A row drifted, or this block already ran. DO NOT PROCEED.', n;
  END IF;
  IF to_regprocedure('norm_v2.lookup_key_v2(text)') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.companies WHERE norm_v2.lookup_key_v2(name) = $1'
      INTO n USING 'ig';
    IF n <> 2 THEN
      RAISE EXCEPTION 'BLOCK B4 GUARD FAILED: the bucket now holds % rows, not 2. A new member was ingested. Re-measure before folding.', n;
    END IF;
  ELSE
    RAISE NOTICE 'norm_v2.lookup_key_v2 is not installed; cluster-size guard skipped for ig.';
  END IF;
END $$;

BEGIN;

-- 1. Journal the three reversible dependents BEFORE repointing them.
--    Same table, same shape and same three tables as norm_v2.merge_cluster.
INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:ig', 'company_mentions', t.id::text, t.company_id, '2e5c4fdd-573a-4db5-a961-38b49b5f82a7'::uuid
  FROM public.company_mentions t
 WHERE t.company_id IN ('586ad62c-6c7b-4e5f-9ce3-72d2102b6dec'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:ig', 'sec_filings', t.id::text, t.company_id, '2e5c4fdd-573a-4db5-a961-38b49b5f82a7'::uuid
  FROM public.sec_filings t
 WHERE t.company_id IN ('586ad62c-6c7b-4e5f-9ce3-72d2102b6dec'::uuid);

INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
SELECT 'handfold:ig', 'insider_transactions', t.id::text, t.company_id, '2e5c4fdd-573a-4db5-a961-38b49b5f82a7'::uuid
  FROM public.insider_transactions t
 WHERE t.company_id IN ('586ad62c-6c7b-4e5f-9ce3-72d2102b6dec'::uuid);

-- 2. Repoint every dependent that keys on companies.id.
--    financial_facts is NOT journaled, exactly as norm_v2.merge_cluster
--    leaves it. Its repoint is one-way. See the ROLLBACK note below.
UPDATE public.company_mentions SET company_id = '2e5c4fdd-573a-4db5-a961-38b49b5f82a7'::uuid
 WHERE company_id IN ('586ad62c-6c7b-4e5f-9ce3-72d2102b6dec'::uuid);
UPDATE public.financial_facts SET company_id = '2e5c4fdd-573a-4db5-a961-38b49b5f82a7'::uuid
 WHERE company_id IN ('586ad62c-6c7b-4e5f-9ce3-72d2102b6dec'::uuid);
UPDATE public.insider_transactions SET company_id = '2e5c4fdd-573a-4db5-a961-38b49b5f82a7'::uuid
 WHERE company_id IN ('586ad62c-6c7b-4e5f-9ce3-72d2102b6dec'::uuid);
UPDATE public.sec_filings SET company_id = '2e5c4fdd-573a-4db5-a961-38b49b5f82a7'::uuid
 WHERE company_id IN ('586ad62c-6c7b-4e5f-9ce3-72d2102b6dec'::uuid);

UPDATE public.resolution_log SET resolved_canonical_id = '2e5c4fdd-573a-4db5-a961-38b49b5f82a7'::uuid
 WHERE resolved_canonical_id IN ('586ad62c-6c7b-4e5f-9ce3-72d2102b6dec'::uuid);

-- candidate_canonical_ids is JSONB holding uuid STRINGS, not uuid[].
UPDATE public.resolution_log rl SET candidate_canonical_ids = sub.fixed
  FROM (SELECT l.id,
               (SELECT jsonb_agg(DISTINCT CASE WHEN e.v IN ('586ad62c-6c7b-4e5f-9ce3-72d2102b6dec')
                                          THEN '2e5c4fdd-573a-4db5-a961-38b49b5f82a7' ELSE e.v END)
                  FROM jsonb_array_elements_text(l.candidate_canonical_ids) AS e(v)) AS fixed
          FROM public.resolution_log l
         WHERE jsonb_typeof(l.candidate_canonical_ids) = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(l.candidate_canonical_ids) x(v)
                        WHERE x.v IN ('586ad62c-6c7b-4e5f-9ce3-72d2102b6dec'))
       ) sub
 WHERE rl.id = sub.id;

-- 3. aliases FK is ON DELETE CASCADE. Repointing before the DELETE is not
--    tidiness, it is the only thing that stops the alias rows being destroyed.
UPDATE public.aliases s
   SET mention_count = greatest(coalesce(s.mention_count,0), coalesce(l.mc,0)),
       last_seen_at  = greatest(s.last_seen_at, l.ls)
  FROM (SELECT lookup_key, max(coalesce(mention_count,0)) AS mc, max(last_seen_at) AS ls
          FROM public.aliases
         WHERE canonical_id IN ('586ad62c-6c7b-4e5f-9ce3-72d2102b6dec'::uuid)
         GROUP BY lookup_key) l
 WHERE s.canonical_id = '2e5c4fdd-573a-4db5-a961-38b49b5f82a7'::uuid AND s.lookup_key = l.lookup_key;

DELETE FROM public.aliases a
 WHERE a.canonical_id IN ('586ad62c-6c7b-4e5f-9ce3-72d2102b6dec'::uuid)
   AND EXISTS (SELECT 1 FROM public.aliases k
                WHERE k.canonical_id = '2e5c4fdd-573a-4db5-a961-38b49b5f82a7'::uuid AND k.lookup_key = a.lookup_key);

UPDATE public.aliases SET canonical_id = '2e5c4fdd-573a-4db5-a961-38b49b5f82a7'::uuid
 WHERE canonical_id IN ('586ad62c-6c7b-4e5f-9ce3-72d2102b6dec'::uuid);

-- 4. Name-keyed dependents. Measured 0 rows for every loser in this set,
--    kept so the block stays correct if one appears between now and apply.
DELETE FROM public.user_memo_regeneration_quota q
 WHERE q.company_id IN ('IG Group Holdings Plc')
   AND EXISTS (SELECT 1 FROM public.user_memo_regeneration_quota k
                WHERE k.user_id = q.user_id AND k.company_id = 'IG Group'
                  AND k.regenerated_at = q.regenerated_at);
UPDATE public.user_memo_regeneration_quota SET company_id = 'IG Group'
 WHERE company_id IN ('IG Group Holdings Plc');

-- 5. Record the fold so the step-12 articles repair can see it.
INSERT INTO norm_v2.hand_fold (new_key, loser_id, loser_name, survivor_id, survivor_name)
VALUES
  ('ig', '586ad62c-6c7b-4e5f-9ce3-72d2102b6dec'::uuid, 'IG Group Holdings Plc', '2e5c4fdd-573a-4db5-a961-38b49b5f82a7'::uuid, 'IG Group')
ON CONFLICT DO NOTHING;

-- 6. Fold the survivor's own fields. Aggregates are read BEFORE the DELETE
--    because they read the losers; the DELETE then runs; and no identifier
--    is written at all, so the partial unique index on sec_cik is untouched.
CREATE TEMP TABLE IF NOT EXISTS _fold_agg (k text PRIMARY KEY, mentions bigint, themes text[]);
DELETE FROM _fold_agg WHERE k = 'ig';
INSERT INTO _fold_agg (k, mentions, themes)
SELECT 'ig',
       (SELECT sum(coalesce(mention_count,0)) FROM public.companies
         WHERE id IN ('2e5c4fdd-573a-4db5-a961-38b49b5f82a7'::uuid, '586ad62c-6c7b-4e5f-9ce3-72d2102b6dec'::uuid)),
       (SELECT array_agg(DISTINCT t) FROM public.companies c2,
               unnest(coalesce(c2.key_themes,'{}')) t
         WHERE c2.id IN ('2e5c4fdd-573a-4db5-a961-38b49b5f82a7'::uuid, '586ad62c-6c7b-4e5f-9ce3-72d2102b6dec'::uuid));

DELETE FROM public.companies
 WHERE id IN ('586ad62c-6c7b-4e5f-9ce3-72d2102b6dec'::uuid);

UPDATE public.companies c
   SET mention_count = (SELECT mentions FROM _fold_agg WHERE k = 'ig'),
       key_themes    = (SELECT themes   FROM _fold_agg WHERE k = 'ig'),
       last_updated  = now()
 WHERE c.id = '2e5c4fdd-573a-4db5-a961-38b49b5f82a7'::uuid;

-- READ-BACK. Look at this BEFORE you COMMIT. Every column must read true.
SELECT
  (SELECT count(*) FROM public.companies WHERE id IN ('586ad62c-6c7b-4e5f-9ce3-72d2102b6dec'::uuid)) = 0        AS losers_gone,
  (SELECT count(*) FROM public.companies WHERE id = '2e5c4fdd-573a-4db5-a961-38b49b5f82a7'::uuid) = 1 AS survivor_present,
  (SELECT mention_count FROM public.companies WHERE id = '2e5c4fdd-573a-4db5-a961-38b49b5f82a7'::uuid) = 3 AS mentions_summed,
  (SELECT ticker IS NOT DISTINCT FROM NULL FROM public.companies WHERE id = '2e5c4fdd-573a-4db5-a961-38b49b5f82a7'::uuid) AS ticker_unchanged,
  (SELECT sec_cik IS NOT DISTINCT FROM NULL FROM public.companies WHERE id = '2e5c4fdd-573a-4db5-a961-38b49b5f82a7'::uuid) AS cik_unchanged,
  (SELECT count(*) FROM public.company_mentions WHERE company_id IN ('586ad62c-6c7b-4e5f-9ce3-72d2102b6dec'::uuid)) = 0 AS mentions_repointed,
  (SELECT count(*) FROM public.aliases WHERE canonical_id IN ('586ad62c-6c7b-4e5f-9ce3-72d2102b6dec'::uuid)) = 0 AS aliases_repointed,
  (SELECT count(*) FROM public.financial_facts WHERE company_id IN ('586ad62c-6c7b-4e5f-9ce3-72d2102b6dec'::uuid)) = 0 AS facts_repointed;

-- COMMIT;    -- only after every column above read true
-- ROLLBACK;  -- otherwise

-- ROLLBACK AFTER COMMIT. Run in this order, as one transaction.
--   a. Recreate the loser rows. companies_name_key is UNIQUE(name) and
--      companies_name_no_junk is a CHECK, so the names must go back exactly.
--      INSERT INTO public.companies (id, name, ticker, sec_cik, mention_count, sector)
--      VALUES ('586ad62c-6c7b-4e5f-9ce3-72d2102b6dec'::uuid, 'IG Group Holdings Plc', NULL, NULL, 1, NULL);
--   b. Restore the survivor's own fields.
--      UPDATE public.companies SET mention_count = 2, last_updated = now()
--       WHERE id = '2e5c4fdd-573a-4db5-a961-38b49b5f82a7'::uuid;
--      key_themes was a UNION and is not restorable from this file. It is
--      additive and non-identifying; the pipeline rewrites it.
--   c. Repoint the three journaled tables back off norm_v2.moved_row.
--      UPDATE public.company_mentions t SET company_id = j.from_company_id
--        FROM norm_v2.moved_row j
--       WHERE j.new_key = 'handfold:ig' AND j.table_name = 'company_mentions'
--         AND t.id::text = j.row_id;
--      (repeat for sec_filings and insider_transactions)
--   d. financial_facts is NOT journaled and CANNOT be repointed back by this
--      file. That matches norm_v2.merge_cluster, which accepts the same
--      one-way cost. If that is unacceptable for a given block, journal
--      financial_facts too before running it.
--   e. aliases and resolution_log follow the same shape as (c) but have no
--      journal. Re-run backend alias resolution rather than hand-restoring.
--   f. DELETE FROM norm_v2.hand_fold WHERE new_key = 'ig';


-- =====================================================================
-- SECTION 4 -- QUARANTINE. Twenty-four buckets. NO STATEMENTS.
--
-- These do not fold. Four reasons, and the distinction between them matters
-- because they have different fixes:
--
--   DISAGREE        two or more real identities reachable inside one bucket.
--                   Splitting is the fix. One bucket.
--
--   MIS-STAMPED     exactly one identity reachable, and it belongs to a
--                   DIFFERENT company than the names in the bucket. This shape
--                   passes every "do the carriers agree" test ever written,
--                   because there is only one carrier. Folding does not create
--                   the defect, but it cements it onto the row every downstream
--                   consumer then treats as authoritative. Strip the wrong
--                   identifier first; then most of these become ordinary folds.
--                   Nine buckets.
--
--   DISTINCT        separate real-world companies whose names normalize
--                   together. No fix on this axis at all. Thirteen buckets.
--
--   PARTIAL         a fold is available but does not clear the key. One bucket.
--
--   KEY-QUARANTINE  excluded from the plan by 0020 phase 3's own rules, not by
--                   any judgement about identity. One bucket.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 'agi'   [MIS-STAMPED]   2 rows
--   MIS-STAMPED.
--   Survivor 'AGI' carries AGI / cik 1178819 = ALAMOS GOLD, and is tagged Consumer & Retail; the loser 'AGI Inc' is tagged Technology and reads as artificial general intelligence.
--   Sectors disagree.
--   members:
--     'AGI'  ticker=AGI  sec_cik=1178819  mention_count=11  sector='Consumer & Retail'
--     'AGI Inc'  ticker=None  sec_cik=None  mention_count=2  sector='Technology'

-- ---------------------------------------------------------------------
-- 'axt'   [MIS-STAMPED]   3 rows
--   MIS-STAMPED.
--   companies.ticker and companies.sec_cik are NULL on all three members, so the companies-columns test calls this clean.
--   financial_facts.cik on 'AXT Inc.' is 10456 = BAXTER INTERNATIONAL.
--   The pre-block reason still holds; only its evidence moved.
--   members:
--     'AXT'  ticker=None  sec_cik=None  mention_count=65  sector='Technology'
--     'AXT Inc.'  ticker=None  sec_cik=None  mention_count=8  sector='Technology'
--     'AXT, Inc.'  ticker=None  sec_cik=None  mention_count=8  sector='Technology'

-- ---------------------------------------------------------------------
-- 'bain'   [DISTINCT]   2 rows
--   DISTINCT ENTITIES.
--   'Bain' carries BCSF = Bain Capital Specialty Finance, a listed BDC.
--   'Bain & Co' is Bain & Company, a private consultancy.
--   Different businesses that share a founder's name.
--   members:
--     'Bain'  ticker=BCSF  sec_cik=None  mention_count=9  sector='Financial Services'
--     'Bain & Co'  ticker=None  sec_cik=None  mention_count=1  sector='Financial Services'

-- ---------------------------------------------------------------------
-- 'compass'   [MIS-STAMPED]   2 rows
--   MIS-STAMPED, and tracked as issue #843.
--   'Compass Inc.' carries EHC / cik 785161 = ENCOMPASS HEALTH, confirmed on the companies row AND in financial_facts and sec_filings.
--   This is the ONLY bucket in the whole set where folding into the carrier would change the displayed name, and it would change it to the wrong company's row.
--   Do not fold.
--   members:
--     'Compass'  ticker=None  sec_cik=None  mention_count=3  sector='Real Estate'
--     'Compass Inc.'  ticker=EHC  sec_cik=785161  mention_count=1  sector=None

-- ---------------------------------------------------------------------
-- 'cpb'   [DISTINCT]   2 rows
--   DISTINCT ENTITIES.
--   'CPB' carries CPB / cik 16732 = Campbell Soup.
--   'CPB Inc.' is the former name of Central Pacific Financial.
--   Same three letters, two companies.
--   members:
--     'CPB'  ticker=CPB  sec_cik=16732  mention_count=26  sector='Consumer & Retail'
--     'CPB Inc.'  ticker=None  sec_cik=None  mention_count=3  sector='Consumer & Retail'

-- ---------------------------------------------------------------------
-- 'csl'   [MIS-STAMPED]   3 rows
--   MIS-STAMPED.
--   All three members have NULL ticker and NULL cik.
--   financial_facts.cik on 'CSL' is 790051 = CARLISLE COMPANIES, while the names read as CSL Limited (CSL.AX).
--   The pre-block reason still holds.
--   members:
--     'CSL'  ticker=None  sec_cik=None  mention_count=110  sector='Healthcare & Biotech'
--     'CSL Limited'  ticker=None  sec_cik=None  mention_count=10  sector='Healthcare & Biotech'
--     'CSL Ltd'  ticker=None  sec_cik=None  mention_count=1  sector='Healthcare & Biotech'

-- ---------------------------------------------------------------------
-- 'eqt'   [DISTINCT]   3 rows
--   DISTINCT ENTITIES.
--   'EQT' carries EQT / cik 33213 = EQT Corporation, US natural gas.
--   'EQT Holdings' and 'EQT Holdings Ltd.' read as EQT AB, the Swedish private-equity firm.
--   Sectors disagree (Financial Services vs Energy).
--   members:
--     'EQT'  ticker=EQT  sec_cik=33213  mention_count=349  sector='Financial Services'
--     'EQT Holdings'  ticker=None  sec_cik=None  mention_count=5  sector='Energy & Oil/Gas'
--     'EQT Holdings Ltd.'  ticker=None  sec_cik=None  mention_count=1  sector='Energy & Oil/Gas'

-- ---------------------------------------------------------------------
-- 'genius'   [PARTIAL]   4 rows
--   PARTIAL AT BEST.
--   Three members are Genius Group spellings and the survivor carries GNS / cik 1847806.
--   The fourth is a bare 'Genius' with no sector, which the pre-block reads as Genius Sports.
--   Folding the three Genius Group spellings is safe but leaves a two-row bucket, so it does NOT clear the key.
--   Sectors disagree across members.
--   members:
--     'Genius Group'  ticker=GNS  sec_cik=1847806  mention_count=50  sector='Technology'
--     'Genius Group Limited'  ticker=None  sec_cik=None  mention_count=1  sector='Financial Services'
--     'Genius Group Ltd'  ticker=None  sec_cik=None  mention_count=1  sector='Technology'
--     'Genius'  ticker=None  sec_cik=None  mention_count=1  sector=None

-- ---------------------------------------------------------------------
-- 'go'   [MIS-STAMPED]   2 rows
--   MIS-STAMPED.
--   Both members have NULL ticker and NULL cik.
--   financial_facts.cik on 'Go Inc.' is 1771515 = GROCERY OUTLET.
--   The pre-block reason still holds.
--   members:
--     'Go Inc.'  ticker=None  sec_cik=None  mention_count=5  sector='Technology'
--     'Go'  ticker=None  sec_cik=None  mention_count=2  sector='Technology'

-- ---------------------------------------------------------------------
-- 'hg'   [DISTINCT]   3 rows
--   DISTINCT ENTITIES.
--   'Hg' is the UK software private-equity firm; 'HG Holdings, Inc.' is a separate US listed company; '$HG' is a cashtag artifact rather than a company at all.
--   Sectors disagree.
--   members:
--     'Hg'  ticker=None  sec_cik=None  mention_count=8  sector='Technology'
--     '$HG'  ticker=None  sec_cik=None  mention_count=1  sector='Technology'
--     'HG Holdings, Inc.'  ticker=None  sec_cik=None  mention_count=1  sector='Financial Services'

-- ---------------------------------------------------------------------
-- 'hp'   [DISAGREE]   3 rows
--   CARRIERS DISAGREE.
--   Two CIKs are reachable inside one bucket: 47217 (HP Inc / HPQ) on the survivor, and 46765 (HELMERICH & PAYNE) on the loser 'HP Inc.'.
--   The 46765 stamp is NOT in companies.ticker or companies.sec_cik, which are both NULL on that row.
--   It is in financial_facts.cik, on every one of that row's financial_facts rows.
--   Folding would attach Helmerich & Payne's entire fundamentals history to Hewlett-Packard.
--   members:
--     'HP Inc'  ticker=HPQ  sec_cik=47217  mention_count=129  sector='Technology'
--     'HP Inc.'  ticker=None  sec_cik=None  mention_count=102  sector='Technology'
--     'HP, Inc.'  ticker=None  sec_cik=None  mention_count=2  sector='Technology'

-- ---------------------------------------------------------------------
-- 'mitsubishi'   [DISTINCT]   2 rows
--   NOT ADJUDICABLE.
--   Bare 'Mitsubishi' could be UFJ, Electric, Heavy or Motors; 'Mitsubishi Corp.' is 8058.T specifically.
--   No identifier and no sector on either row.
--   members:
--     'Mitsubishi'  ticker=None  sec_cik=None  mention_count=3  sector=None
--     'Mitsubishi Corp.'  ticker=None  sec_cik=None  mention_count=1  sector=None

-- ---------------------------------------------------------------------
-- 'mitsui'   [DISTINCT]   3 rows
--   NOT ADJUDICABLE.
--   'Mitsui & Co.' is 8031.T; bare 'Mitsui' could be Fudosan, Chemicals or O.S.K.
--   Lines.
--   No identifier and no sector on any of the three.
--   members:
--     'Mitsui'  ticker=None  sec_cik=None  mention_count=4  sector=None
--     'Mitsui & Co.'  ticker=None  sec_cik=None  mention_count=2  sector=None
--     'Mitsui & Co., Ltd.'  ticker=None  sec_cik=None  mention_count=1  sector=None

-- ---------------------------------------------------------------------
-- 'nu'   [DISTINCT]   3 rows
--   DISTINCT ENTITIES.
--   'Nu Holdings' carries NU / cik 1691493 = Nubank, Financial Services.
--   Bare 'NU' is tagged Media & Telecom.
--   Sectors disagree.
--   members:
--     'Nu Holdings'  ticker=NU  sec_cik=1691493  mention_count=99  sector='Financial Services'
--     'NU'  ticker=None  sec_cik=None  mention_count=36  sector='Media & Telecom'
--     'Nu Holdings Ltd.'  ticker=None  sec_cik=None  mention_count=18  sector='Financial Services'

-- ---------------------------------------------------------------------
-- 'penske'   [DISTINCT]   2 rows
--   NOT ADJUDICABLE.
--   Penske Corporation is the private parent; a separate cluster carries Penske Automotive's PAG.
--   Bare 'Penske' cannot be assigned from the table.
--   members:
--     'Penske'  ticker=None  sec_cik=None  mention_count=3  sector='Financial Services'
--     'Penske Corporation'  ticker=None  sec_cik=None  mention_count=1  sector=None

-- ---------------------------------------------------------------------
-- 'science'   [MIS-STAMPED]   2 rows
--   MIS-STAMPED.
--   Both members have NULL ticker and NULL cik.
--   financial_facts.cik on 'Science Corp.' is 882095 = GILEAD SCIENCES.
--   The pre-block reason still holds.
--   members:
--     'Science Corp'  ticker=None  sec_cik=None  mention_count=1  sector='Healthcare & Biotech'
--     'Science Corp.'  ticker=None  sec_cik=None  mention_count=1  sector='Healthcare & Biotech'

-- ---------------------------------------------------------------------
-- 'softbank'   [DISTINCT]   6 rows
--   DISTINCT ENTITIES.
--   SoftBank Group Corp (9984) and SoftBank Corp (9434) are both separately listed and both present in this bucket.
--   members:
--     'SoftBank'  ticker=None  sec_cik=None  mention_count=180  sector='Technology'
--     'SoftBank Group'  ticker=None  sec_cik=None  mention_count=43  sector='Technology'
--     'SoftBank Group Corp.'  ticker=None  sec_cik=None  mention_count=27  sector='Technology'
--     'SoftBank Group Corp'  ticker=None  sec_cik=None  mention_count=4  sector='Technology'
--     'SoftBank Corp.'  ticker=None  sec_cik=None  mention_count=3  sector=None
--     'SoftBank Corp'  ticker=None  sec_cik=None  mention_count=1  sector=None

-- ---------------------------------------------------------------------
-- 'tata'   [DISTINCT]   2 rows
--   NOT ADJUDICABLE.
--   Bare 'Tata' could be Tata Motors, TCS or the conglomerate.
--   No identifier anywhere.
--   Sectors disagree.
--   members:
--     'Tata'  ticker=None  sec_cik=None  mention_count=6  sector='Financial Services'
--     'Tata Group'  ticker=None  sec_cik=None  mention_count=2  sector='Industrials & Manufacturing'

-- ---------------------------------------------------------------------
-- 'tencent'   [MIS-STAMPED]   4 rows
--   MIS-STAMPED.
--   Survivor 'Tencent' carries TME / cik 1744676 = TENCENT MUSIC ENTERTAINMENT, not Tencent Holdings (0700.HK).
--   Wrong identity sits on the survivor already, so a fold inherits nothing and changes nothing about the defect.
--   Sectors disagree across members.
--   members:
--     'Tencent'  ticker=TME  sec_cik=1744676  mention_count=21  sector='Financial Services'
--     'Tencent Holdings Ltd.'  ticker=None  sec_cik=None  mention_count=13  sector='Technology'
--     'Tencent Holdings'  ticker=None  sec_cik=None  mention_count=2  sector='Media & Telecom'
--     'Tencent Holdings Ltd'  ticker=None  sec_cik=None  mention_count=1  sector=None

-- ---------------------------------------------------------------------
-- 'ubs'   [DISTINCT]   3 rows
--   DISTINCT ENTITIES.
--   UBS Group AG is the listed parent; UBS AG is the bank subsidiary.
--   Both are real filers.
--   The 0020 design doc recommends merging this key; that is a deliberate demote for a human, not a decidable fold.
--   members:
--     'UBS'  ticker=UBS  sec_cik=1610520  mention_count=223  sector='Financial Services'
--     'UBS Group AG'  ticker=None  sec_cik=None  mention_count=22  sector='Financial Services'
--     'UBS AG'  ticker=None  sec_cik=None  mention_count=15  sector='Financial Services'

-- ---------------------------------------------------------------------
-- 'viking'   [DISTINCT]   3 rows
--   DISTINCT ENTITIES.
--   'Viking Holdings' is Consumer & Retail (Viking cruises); 'Viking' is Healthcare & Biotech and reads as Viking Therapeutics.
--   Sectors disagree.
--   members:
--     'Viking'  ticker=None  sec_cik=None  mention_count=7  sector='Healthcare & Biotech'
--     'Viking Holdings'  ticker=None  sec_cik=None  mention_count=7  sector='Consumer & Retail'
--     'Viking Holdings Ltd.'  ticker=None  sec_cik=None  mention_count=1  sector='Consumer & Retail'

-- ---------------------------------------------------------------------
-- 'x'   [KEY-QUARANTINE]   2 rows
--   QUARANTINED BY THE KEY RULE, not by identity.
--   Both members key to 'x', which is one character, so 0020 phase 3 excludes them from the plan entirely.
--   Whether this bucket blocks a Track 3 index depends on that index's predicate, not on this decision.
--   members:
--     'X'  ticker=None  sec_cik=None  mention_count=31  sector='Technology'
--     'X Corp.'  ticker=None  sec_cik=None  mention_count=1  sector=None

-- ---------------------------------------------------------------------
-- 'xai'   [MIS-STAMPED]   2 rows
--   MIS-STAMPED.
--   'xAI' carries ticker XFLT, the XAI Octagon closed-end fund.
--   Both members are Elon Musk's xAI.
--   The fold itself is harmless, but it would cement a wrong ticker onto the surviving row.
--   Strip the ticker first, then this becomes a decidable fold.
--   members:
--     'xAI'  ticker=XFLT  sec_cik=None  mention_count=9  sector='Technology'
--     'xAI Corp.'  ticker=None  sec_cik=None  mention_count=1  sector=None

-- ---------------------------------------------------------------------
-- 'zip'   [MIS-STAMPED]   3 rows
--   MIS-STAMPED.
--   All three members have NULL ticker and NULL cik.
--   financial_facts.cik on 'Zip Co' is 1617553 = ZIPRECRUITER, while the names read as Zip Co (AU BNPL).
--   The pre-block reason still holds.
--   members:
--     'Zip Co'  ticker=None  sec_cik=None  mention_count=22  sector='Financial Services'
--     'Zip'  ticker=None  sec_cik=None  mention_count=18  sector='Financial Services'
--     'Zip Co Ltd'  ticker=None  sec_cik=None  mention_count=1  sector='Financial Services'

-- =====================================================================
-- SECTION 5 -- THE OTHER HALF: articles.companies[] and primary_company.
--
-- Every fold in SECTION 2 and 3 deletes a companies row whose NAME is still
-- sitting in articles.companies[] and articles.primary_company. Nothing in this
-- file touches articles, and nothing should: that repair already exists,
-- has a ledger, and is reversible.
--
--   sql/0035_articles_companies_repair_ledger.sql
--   tools/repair_articles_companies.py
--
-- The repair reads norm_v2_merge_map(), which is built from norm_v2.plan_member
-- joined to norm_v2.plan_cluster. A hand fold has no plan row, so the repair
-- CANNOT SEE IT and would leave these names stale while reporting success.
-- That is the whole reason norm_v2.hand_fold exists.
--
-- Apply this replacement AFTER the folds and BEFORE running the repair tool.
-- It is additive: the merge half of the UNION is 0035's function verbatim.
-- =====================================================================

-- CREATE OR REPLACE FUNCTION public.norm_v2_merge_map()
-- RETURNS TABLE (loser_name text, survivor_name text)
-- LANGUAGE sql
-- STABLE
-- AS $$
--   SELECT pm.name, pc.survivor_name
--     FROM norm_v2.plan_member pm
--     JOIN norm_v2.plan_cluster pc ON pc.new_key = pm.new_key
--    WHERE NOT pm.is_survivor
--      AND pc.merged_at IS NOT NULL
--      AND pm.name <> pc.survivor_name
--   UNION
--   SELECT hf.loser_name, hf.survivor_name
--     FROM norm_v2.hand_fold hf
--    WHERE hf.loser_name <> hf.survivor_name;
-- $$;

-- Verify the hand folds are now visible to the repair:
--   SELECT count(*) FROM norm_v2_merge_map() m
--     JOIN norm_v2.hand_fold h ON h.loser_name = m.loser_name;
--   -- must equal (SELECT count(*) FROM norm_v2.hand_fold)

-- Then run the repair as 0035 documents it. Do not skip its own guards.


-- =====================================================================
-- SECTION 6 -- WHAT THIS UNBLOCKS, AND WHAT IT DOES NOT.
--
-- READ THIS BEFORE BUILDING ANY UNIQUE INDEX.
-- =====================================================================
--
-- A unique index over existing violations does not warn. It fails, and a
-- CONCURRENTLY-built one leaves an INVALID index behind that the planner never
-- uses and every write still maintains. So the question is exactly: after this
-- file, how many rows still violate?
--
-- MEASURED, before anything in this file is applied:
--
--   UNIQUE (name)                                 holds today
--   UNIQUE (lower(btrim(name)))       over ALL rows   would build today
--   UNIQUE (lower(btrim(name)))       WHERE cik NULL  holds today
--   UNIQUE (sec_cik)                  WHERE NOT NULL  holds today
--   UNIQUE (norm_v2.lookup_key_v2(name)) over ALL rows
--        FAILS. 40 buckets, 63 surplus rows.
--
-- After SECTION 2 (12 buckets), 28 buckets remain.
-- After SECTION 2 and 3 (16 buckets), 24 remain.
--
-- A full UNIQUE index on lookup_key_v2(name) IS NOT REACHABLE by folding,
-- now or later. Twenty-four of the remaining buckets are pairs of genuinely
-- different companies, or one company carrying another's identifier. Folding
-- them would be wrong, and refusing to fold them means the violations stay.
--
-- Three honest options, in order of how much they cost:
--
--   1. Make the index PARTIAL and exclude the known set, the same way
--      companies_name_norm_unique is already partial. The exclusion list is
--      then a thing somebody has to maintain, and every new duplicate silently
--      lands outside the guarantee.
--
--   2. Do not build a unique index. Build a NON-unique index plus a scheduled
--      assertion that reports new buckets. This keeps the planner benefit and
--      the detection, and gives up only the enforcement, which is the part
--      that cannot be made true anyway.
--
--   3. Split the entities first. That is real work on 24 clusters and it is the
--      only option that ends with a true uniqueness guarantee.
--
-- Whichever is chosen, the index expression MUST be the same function these
-- buckets were measured with. There are three keys live in this codebase and
-- they are not interchangeable:
--
--   backend/normalize.py normalize_lookup_key        writes aliases.lookup_key
--   backend/company_match.py normalize_company_key   read-only fold key, mirrors
--                                                    norm_v2.lookup_key_v2
--   src/lib/data-access/aliasResolver.ts nameMatchKey
--                                                    the key the COMPANY PAGE
--                                                    actually resolves on
--
-- The third one is the one nobody counts. It has 40 duplicate buckets of its
-- own, overlapping but NOT equal to the v2 40: it already collapses
-- 'Coherent'/'COHERENT CORP' and 'SoftBank Group'/'SoftBank' at query time,
-- and it does NOT collapse 'AGI'/'AGI Inc'. An index built on v2 therefore
-- guarantees nothing about what a user can actually reach, and clearing v2
-- buckets does not clear that set.


-- =====================================================================
-- SECTION 7 -- GLOBAL READ-BACK. Read-only. Run after any batch.
-- Every column must return t.
-- =====================================================================
--
--   SELECT
--     (SELECT count(*) FROM public.companies c
--        WHERE NOT EXISTS (SELECT 1 FROM public.aliases a WHERE a.canonical_id = c.id)
--          AND FALSE) = 0                                        AS placeholder_true,
--     (SELECT count(*) FROM public.aliases a
--       WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = a.canonical_id))
--       = 0                                                      AS no_orphan_aliases,
--     (SELECT count(*) FROM public.company_mentions m
--       WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = m.company_id))
--       = 0                                                      AS no_orphan_mentions,
--     (SELECT count(*) FROM public.sec_filings f
--       WHERE f.company_id IS NOT NULL
--         AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = f.company_id))
--       = 0                                                      AS no_orphan_filings,
--     (SELECT count(*) FROM public.insider_transactions t
--       WHERE t.company_id IS NOT NULL
--         AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = t.company_id))
--       = 0                                                      AS no_orphan_insider,
--     (SELECT count(DISTINCT sec_cik) FROM public.companies WHERE sec_cik IS NOT NULL)
--       = (SELECT count(*) FROM public.companies WHERE sec_cik IS NOT NULL)
--                                                                AS cik_still_unique,
--     (SELECT count(DISTINCT name) FROM public.companies)
--       = (SELECT count(*) FROM public.companies)                AS name_still_unique;
--
-- And the three tables that must be untouched. Each of these has no column
-- referencing companies at all, so these are a check that the file did not
-- grow one, not a check that a statement behaved:
--
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name IN ('user_claims','morning_brief_calls','output_grades')
--      AND (column_name LIKE '%company%' OR column_name LIKE '%canonical%');
--   -- must be 0
--
--   SELECT count(*) FROM pg_constraint c
--    WHERE c.contype = 'f' AND c.confrelid = 'public.companies'::regclass
--      AND c.conrelid IN ('public.user_claims'::regclass,
--                         'public.morning_brief_calls'::regclass,
--                         'public.output_grades'::regclass);
--   -- must be 0
