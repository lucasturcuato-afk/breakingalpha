-- =====================================================================
-- 0039_companies_name_norm_unique_widen.sql
--
--   *** PROPOSAL. NOT APPLIED. NOT EXECUTED. DO NOT RUN AS ONE SCRIPT. ***
--
-- Makes the normalized company name unique across the WHOLE table, so a
-- second row for a company the index already holds is impossible rather
-- than merely undesirable.
--
-- ---------------------------------------------------------------------
-- WHY THIS FILE IS IN sql/ AND NOT IN supabase/migrations/
-- ---------------------------------------------------------------------
-- CREATE INDEX CONCURRENTLY hard-errors inside a transaction block, and the
-- Supabase migration runner wraps every migration in one. Four files under
-- sql/ use CONCURRENTLY (0023, 0024, 0025, 0038) and zero under
-- supabase/migrations/ do. That split is the reason, not a preference.
--
-- NUMBERING. Top-level sql/ runs to 0038, so this is 0039. Note that
-- sql/proposals/ ALSO holds an 0036 and an 0037 on the trunk, and a THIRD
-- 0036 (0036_companies_sec_cik_unique_index.sql, the direct prior art for
-- this file) exists only on the unmerged branch chore/sec-cik-unique-index.
-- The proposals number line has already collided once. Top-level sql/ has
-- not, which is the other reason this file lives here.
--
-- ---------------------------------------------------------------------
-- TWO THINGS GATE THIS FILE. BOTH MUST LAND BEFORE IT IS APPLIED.
-- ---------------------------------------------------------------------
-- 1. LOST-RACE (23505) HANDLING SHIPS FIRST.
--    Every write path that can now collide must treat a unique violation as
--    "another row already owns this key" and re-resolve, not crash. Applied
--    before that, an ingest run throws on a name it cannot resolve. This is
--    the same prerequisite 0036 named for companies_sec_cik_unique, and it
--    is being built separately on fix/companies-lost-race. Nothing in this
--    file depends on that branch's internals; it depends only on the
--    behaviour existing.
--
-- 2. THE REMAINING DUPLICATE BUCKETS MUST BE MERGED FIRST.
--    A unique index over existing violations DOES NOT WARN. It FAILS, and a
--    failed CONCURRENTLY build leaves behind an INVALID index that the
--    planner never uses and every single write still maintains. That is
--    strictly worse than no index: all of the cost, none of the benefit,
--    and nothing in the application surfaces it. Phase 1a is the guard that
--    makes applying it in that state impossible rather than inadvisable,
--    and phase 1c detects the invalid-index state if it ever happens.
--
-- ---------------------------------------------------------------------
-- THE DEFECT THIS DOES AND DOES NOT FIX. READ THIS BEFORE APPLYING.
-- ---------------------------------------------------------------------
-- The live index companies_name_norm_unique is PARTIAL and its expression
-- is lower(btrim(name)). Two separate weaknesses, and only one of them is
-- the partiality:
--
--   THE PREDICATE. Partial on sec_cik, so half the table is unconstrained.
--     Widening it is nearly free.
--
--   THE EXPRESSION. lower(btrim(name)) folds case and outer spaces and
--     NOTHING ELSE. It cannot see that "Coherent" and "Coherent Corp." are
--     one company, and it never could, whatever its predicate. Measured
--     read-only over the full table: ZERO rows anywhere violate a widened
--     lower(btrim(name)) index today. So widening the predicate ALONE
--     builds instantly and prevents almost nothing that the pre-existing
--     UNIQUE(name) did not already prevent.
--
-- Widening the predicate while keeping the expression is therefore close to
-- a no-op against the observed defect. THE EXPRESSION IS THE LOAD-BEARING
-- HALF. This file uses the v2 company key, which is the fold the
-- application already uses to decide "same company".
--
-- AND EVEN v2 IS NOT A COMPLETE FIX. Measured against the reported live
-- clusters: v2 collapses the Genius Group cluster and does NOT collapse the
-- Exxon cluster or the JPMorgan cluster. "Exxon", "Exxon Mobil Corp" and
-- "ExxonMobil" are three distinct keys under v1, under v2 and under
-- lower(btrim(name)) alike, because a fold that strips legal suffixes
-- cannot bridge a deleted space or an added first name. Those belong to the
-- alias and token-fold layer, not to a unique index. Do not expect this
-- index to close them.
--
-- ---------------------------------------------------------------------
-- THE FAILURE CLASS THIS FILE IS EXPOSED TO, AND THE GUARD FOR IT
-- ---------------------------------------------------------------------
-- The index expression and the application normalizer are TWO PATHS TO ONE
-- FACT. If the index folds names in SQL and ingest folds them in Python,
-- they drift, and the drift is silent until an INSERT fails on a name the
-- application had already decided was new. Naming both sides:
--
--   SIDE A, the index expression:  public.company_name_key(text), defined
--     below. Written by this file.
--   SIDE B, the application fold:  normalize_company_key in
--     backend/company_match.py. Written by the pipeline authors.
--
-- The drift is ALREADY REAL and already measured. company_match.py's own
-- docstring says its EXTRA_SUFFIXES list ("se", "spa", "oyj", "asa", "pte",
-- "pty") is "A DIVERGENCE FROM 0020", so norm_v2.lookup_key_v2 and the
-- Python fold do not agree today. Measured read-only over the full table, a
-- small set of names keys differently between them, and every one is a
-- European legal form ("Allianz SE", "Equinor ASA", "Citycon Oyj",
-- "IFM Investors Pty Ltd"). Today that difference happens to move no
-- duplicate bucket either way, but "moves no bucket today" is not a fix, it
-- is a coincidence with a shelf life.
--
-- SO THIS FILE DOES NOT REFERENCE norm_v2.lookup_key_v2. It defines its own
-- function carrying the FULL suffix list, BASE plus EXTRA, so that side A
-- equals side B exactly on the day it is written.
--
-- PREVENTION IS NOT POSSIBLE, ONLY DETECTION. Nothing in Postgres can make
-- a Python edit fail. What exists instead:
--   backend/tests/test_company_name_key_parity.py reads the suffix
--   alternation out of THIS FILE and asserts it equals
--   BASE_SUFFIXES + EXTRA_SUFFIXES in company_match.py, and replays this
--   file's fixture table through the real Python function. Edit either side
--   alone and the backend test gate goes red BEFORE the index can reject an
--   insert in production. That test is the drift alarm; it is not optional
--   scaffolding, it is the only thing standing between these two paths.
--
-- The second drift axis is smaller and named for completeness: Postgres
-- [[:punct:]] is unicode-aware and Python's string.punctuation is ASCII
-- only. Measured live, every name that carries a non-ASCII punctuation
-- character carries either U+2019 or U+2122, and the v1 half already folds
-- both of those BEFORE the punctuation step. Zero live exposure. It is
-- still a real difference and the parity test's fixture table is where a
-- future one would surface.
--
-- ---------------------------------------------------------------------
-- WHAT IT COULD BREAK
-- ---------------------------------------------------------------------
-- Two live insert paths write companies rows:
--   backend/entity_resolver.py             (pipeline mint)
--   src/lib/data-access/resolveOrCreateCompany.ts (request-time mint)
-- Both can now raise 23505 on a name that folds onto an existing row.
-- BOTH MUST HANDLE IT AS A LOST RACE. See gate 1 above. That code change is
-- a PREREQUISITE and is NOT INCLUDED HERE.
--
-- Cost of the function itself: the index is on an expression, so every
-- INSERT and every UPDATE of companies.name calls company_name_key once.
-- It is IMMUTABLE, STRICT and PARALLEL SAFE, pure regex over a short
-- string, and companies is a small, slowly-growing table next to the ones
-- the pipeline actually writes in bulk. The write cost is not the
-- consideration; the lost-race handling is.
-- =====================================================================


-- ---------------------------------------------------------------------
-- PHASE 0. WHAT IS ACTUALLY THERE. Run this FIRST and read it.
--
-- Not optional. The repo disagrees with itself about the live predicate:
-- sql/proposals/0020b_norm_v2_revised_phases.sql records
--   companies_name_norm_unique UNIQUE (lower(btrim(name))) WHERE sec_cik IS NULL
-- and the recon that commissioned this file recorded the OPPOSITE predicate,
-- WHERE sec_cik IS NOT NULL. Both cannot be right and neither can be settled
-- read-only through PostgREST, which does not expose the catalog. It does not
-- change what this file creates (the new index is unpartitioned and covers
-- every row either way) but it decides which old index is safe to drop, so
-- SETTLE IT HERE BEFORE PHASE 2 rather than trusting either document.
--
-- The reason an earlier check missed this index entirely: a PARTIAL UNIQUE
-- INDEX carries no pg_constraint row. Query pg_indexes, never pg_constraint.
-- ---------------------------------------------------------------------

-- 0a. Every index on companies, partial ones included.
SELECT c2.relname                        AS index_name,
       i.indisunique,
       i.indisvalid,
       i.indisready,
       pg_get_indexdef(i.indexrelid)     AS definition
  FROM pg_index i
  JOIN pg_class c2 ON c2.oid = i.indexrelid
  JOIN pg_class c1 ON c1.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = c1.relnamespace
 WHERE n.nspname = 'public'
   AND c1.relname = 'companies'
 ORDER BY c2.relname;

-- 0b. Constraints, for contrast. companies_name_norm_unique will NOT appear
--     here if it is a partial index. That absence is the trap, not a result.
SELECT conname, contype, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conrelid = 'public.companies'::regclass
 ORDER BY conname;


-- ---------------------------------------------------------------------
-- PHASE 1. THE FUNCTION, THEN THE GUARD.
--
-- Phase 1 is non-destructive. CREATE OR REPLACE FUNCTION is safe to run on
-- its own and changes no behaviour until something calls it.
-- ---------------------------------------------------------------------

-- 1a. The v1 half. Byte-for-byte equivalent of backend/normalize.py.
--     Identical to norm_v2.lookup_key_v1; restated in public so this file
--     has no dependency on a schema that is meant to be droppable.
CREATE OR REPLACE FUNCTION public.company_name_key_v1(s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT lower(btrim(
    translate(
      normalize(
        replace(replace(replace(s, U&'\2122', ''), U&'\00AE', ''), U&'\00A9', ''),
        NFKC
      ),
      U&'\2019\2018\201C\201D',
      '''''""'
    )
  ));
$$;

COMMENT ON FUNCTION public.company_name_key_v1(text) IS
  'v1 fold: strip TM/R/C, NFKC, fold curly quotes, btrim, lower. Mirror of '
  'backend/normalize.py normalize_lookup_key. Order matters: TM is stripped '
  'BEFORE NFKC because NFKC decomposes it to the letters TM and would '
  'concatenate it onto the preceding token.';


-- 1b. The v2 key. This is the index expression.
--
--     SUFFIX LIST IS LOAD-BEARING AND IS READ BY A TEST. It is BASE plus
--     EXTRA from backend/company_match.py, in that order.
--     backend/tests/test_company_name_key_parity.py parses the alternation
--     out of the line below by name. If you edit this list, edit
--     company_match.py in the same commit or the backend gate goes red.
--
--     This is where this file DELIBERATELY DIVERGES from
--     sql/proposals/0020_normalize_lookup_key_v2.sql, whose list is BASE
--     only. 0020's list is Anglo-centric and does not fold Societas
--     Europaea and friends. Matching the application matters more than
--     matching an unapplied proposal, and the six extra tokens were each
--     measured earning their place by tools/primary_fold_eval.py.
CREATE OR REPLACE FUNCTION public.company_name_key(s text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  base   text;
  punct  text;
  out    text;
  prev   text;
  -- PARITY-SUFFIXES-BEGIN
  suffix constant text :=
    '\s+(inc|incorporated|corp|corporation|co|company|llc|ltd|limited'
    '|plc|sa|ag|nv|ab|holdings|group'
    '|se|spa|oyj|asa|pte|pty)$';
  -- PARITY-SUFFIXES-END
BEGIN
  base := public.company_name_key_v1(s);

  -- Delete dots and apostrophes outright, no space:
  --   'Inc.' -> 'inc', 'L.L.C.' -> 'llc', 'Moody''s' -> 'moodys'
  -- U+2019 is already folded to ASCII by v1; kept in the class so this
  -- matches the Python character class exactly.
  punct := regexp_replace(base, '[.''' || U&'\2019' || ']', '', 'g');

  -- Every other punctuation char becomes a space:
  --   'archer-daniels-midland' -> 'archer daniels midland', 'pg&e' -> 'pg e'
  punct := regexp_replace(punct, '[[:punct:]]', ' ', 'g');

  -- Collapse whitespace, trim.
  punct := btrim(regexp_replace(punct, '\s+', ' ', 'g'));

  -- Strip trailing suffix tokens, up to 3 passes.
  --   'kioxia holdings corp' -> 'kioxia holdings' -> 'kioxia'
  -- The leading \s+ means a single-token name that IS a suffix word
  -- ('Group') can never be emptied by this loop.
  out := punct;
  FOR i IN 1..3 LOOP
    prev := out;
    out := regexp_replace(out, suffix, '');
    EXIT WHEN out = prev;
  END LOOP;

  -- Empty guard. Never return '' when the input was non-empty.
  IF out = '' THEN
    RETURN punct;
  END IF;

  RETURN out;
END;
$$;

COMMENT ON FUNCTION public.company_name_key(text) IS
  'v2 company fold, and the expression behind companies_name_key_unique_idx. '
  'MUST stay identical to normalize_company_key in backend/company_match.py: '
  'the index and the application are two paths to one fact and they drift '
  'silently. backend/tests/test_company_name_key_parity.py is the alarm.';


-- 1c. FIXTURES. Run and eyeball before going further. Every column must
--     return t. This exact table is replayed against the real Python
--     function by backend/tests/test_company_name_key_parity.py, so a
--     divergence shows up here AND in the backend gate.
--     PARITY-FIXTURES-BEGIN
SELECT
  public.company_name_key('Caterpillar')            = 'caterpillar'            AS f01,
  public.company_name_key('Caterpillar Inc')        = 'caterpillar'            AS f02,
  public.company_name_key('Caterpillar Inc.')       = 'caterpillar'            AS f03,
  public.company_name_key('Archer-Daniels-Midland') = 'archer daniels midland' AS f04,
  public.company_name_key('Kioxia Holdings Corp.')  = 'kioxia'                 AS f05,
  public.company_name_key('Group')                  = 'group'                  AS f06,
  public.company_name_key('Moody''s Analytics')     = 'moodys analytics'       AS f07,
  public.company_name_key('BP p.l.c.')              = 'bp'                     AS f08,
  public.company_name_key('  Tesla  ')              = 'tesla'                  AS f09,
  public.company_name_key('Allianz SE')             = 'allianz'                AS f10,
  public.company_name_key('Equinor ASA')            = 'equinor'                AS f11,
  public.company_name_key('Citycon Oyj')            = 'citycon'                AS f12,
  public.company_name_key('IFM Investors Pty Ltd')  = 'ifm investors'          AS f13,
  public.company_name_key('Genius Group Ltd')       = 'genius'                 AS f14,
  public.company_name_key('ExxonMobil')             = 'exxonmobil'             AS f15,
  public.company_name_key('Exxon Mobil Corp')       = 'exxon mobil'            AS f16;
--     PARITY-FIXTURES-END


-- 1d. *** THE GUARD. MUST RETURN ZERO ROWS. ***
--
--     This is the violation query itself, over the exact expression the
--     index will use, so applying phase 2 while violations exist is
--     IMPOSSIBLE rather than merely inadvisable: whatever this returns is
--     precisely what the CREATE would choke on.
--
--     If it returns rows, STOP. Merge those clusters first. Do not force
--     it, do not add a predicate to dodge them, and do not "try it and see"
--     -- see phase 1e for what a failed build leaves behind.
SELECT public.company_name_key(name) AS name_key,
       count(*)                      AS n,
       array_agg(name ORDER BY mention_count DESC NULLS LAST) AS members,
       array_agg(ticker) FILTER (WHERE ticker IS NOT NULL)    AS tickers,
       array_agg(sec_cik) FILTER (WHERE sec_cik IS NOT NULL)  AS ciks
  FROM public.companies
 GROUP BY 1
HAVING count(*) > 1
 ORDER BY n DESC, 1;

-- 1e. Any INVALID index left by a failed prior attempt. Must return zero
--     rows before phase 2. A CONCURRENTLY build that fails does NOT roll
--     back: it leaves an index that indisvalid = false, which the planner
--     refuses to use and which every write still maintains. Phase 4 clears
--     it.
SELECT c.relname, i.indisvalid, i.indisready
  FROM pg_class c
  JOIN pg_index i ON i.indexrelid = c.oid
 WHERE c.relname = 'companies_name_key_unique_idx';

-- 1f. Coverage, for the record. total_rows must equal distinct_name_key
--     when 1d is empty; that is the same fact stated positively.
SELECT count(*)                                   AS total_rows,
       count(DISTINCT public.company_name_key(name)) AS distinct_name_key,
       count(*) FILTER (WHERE sec_cik IS NOT NULL) AS cik_rows,
       count(*) FILTER (WHERE ticker IS NOT NULL)  AS ticker_rows
  FROM public.companies;


-- ---------------------------------------------------------------------
-- PHASE 2. THE INDEX.
--
-- Run as a SINGLE STANDALONE STATEMENT. Not inside a transaction block,
-- not wrapped, not as part of a multi-statement script, not through the
-- Supabase migration runner. CONCURRENTLY hard-errors inside a
-- transaction.
--
-- Only after: gate 1 (lost-race handling) has shipped, gate 2 (duplicate
-- merge) is complete, phase 1d returned ZERO ROWS and phase 1e returned
-- ZERO ROWS.
--
-- NO PREDICATE. That is the entire point of the file: unique regardless of
-- sec_cik, so a second row for an already-indexed company is impossible
-- rather than merely undesirable.
-- ---------------------------------------------------------------------

-- CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS companies_name_key_unique_idx
--     ON public.companies (public.company_name_key(name));

-- Deliberately commented out. Uncomment at apply time, after a human has
-- read phase 0 and phase 1's output.


-- ---------------------------------------------------------------------
-- PHASE 3. READ-BACK. Run every query. Do not skip 3a.
-- ---------------------------------------------------------------------

-- 3a. *** indisvalid MUST BE true. *** This is the specific trap this file
--     exists to avoid. A failed CONCURRENTLY build leaves the index row in
--     the catalog with indisvalid = false. Nothing errors, nothing warns,
--     the planner silently never uses it, and every INSERT and UPDATE keeps
--     paying to maintain it. If this returns false, go to phase 4, drop it,
--     find out why, and only then retry phase 2.
SELECT c.relname,
       i.indisvalid,
       i.indisready,
       i.indisunique,
       pg_get_indexdef(i.indexrelid) AS definition
  FROM pg_class c
  JOIN pg_index i ON i.indexrelid = c.oid
 WHERE c.relname = 'companies_name_key_unique_idx';

-- 3b. Row count unchanged. An index cannot change it; this is a tripwire
--     against having run something other than phase 2 by mistake.
SELECT count(*) AS total_rows FROM public.companies;

-- 3c. The guard again, now expected empty and now ENFORCED rather than
--     merely observed. Same query as 1d.
SELECT public.company_name_key(name) AS name_key, count(*) AS n
  FROM public.companies
 GROUP BY 1
HAVING count(*) > 1;

-- 3d. OPTIONAL, and a JUDGEMENT CALL, NOT AN AUTOMATIC STEP. The old
--     partial index is now strictly implied by the new one IF its
--     expression is lower(btrim(name)) AND the new key is a refinement of
--     it. Confirm BOTH against phase 0a output before dropping anything,
--     and note that dropping it also removes whatever the planner was
--     using it for. Leave it in place unless there is a reason.
--
-- DROP INDEX CONCURRENTLY IF EXISTS companies_name_norm_unique;


-- ---------------------------------------------------------------------
-- PHASE 4. ROLLBACK.
--
-- Also the cleanup for an INVALID index left by a failed phase 2. Run 4a
-- before retrying phase 2, or the retry hits IF NOT EXISTS and silently
-- keeps the broken one.
-- ---------------------------------------------------------------------

-- 4a. Drop the index. Standalone statement, outside a transaction.
-- DROP INDEX CONCURRENTLY IF EXISTS companies_name_key_unique_idx;

-- 4b. Drop the functions. Only after 4a: the index depends on
--     company_name_key, and company_name_key depends on
--     company_name_key_v1, so the order is index, then v2, then v1.
-- DROP FUNCTION IF EXISTS public.company_name_key(text);
-- DROP FUNCTION IF EXISTS public.company_name_key_v1(text);

-- 4c. Confirm the rollback. Both must return zero rows.
SELECT c.relname FROM pg_class c
  JOIN pg_index i ON i.indexrelid = c.oid
 WHERE c.relname = 'companies_name_key_unique_idx';

SELECT p.proname FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('company_name_key', 'company_name_key_v1');
