-- =====================================================================
-- 0020b_norm_v2_revised_phases.sql
--
--   *** PROPOSAL. NOT APPLIED. DO NOT RUN AS ONE SCRIPT. ***
--
-- SUPERSEDES phases 1, 4 and 6 of sql/proposals/0020_normalize_lookup_key_v2.sql.
-- Phases 2 (snapshot), 3 (quarantine), 5 (review), 7 (re-key) and 8 (rollback)
-- from 0020 are unchanged and still apply. Run 0020's phase 2 and 3 BEFORE
-- section 3 here: this file reads norm_v2.quarantine_company and
-- norm_v2.snapshot_companies and will fail without them.
--
-- Six changes, all requested after the 2026-08-15 review:
--
--   1. Survivor keeps the mention_count rule, but now INHERITS ticker/sec_cik
--      when the cluster has exactly one distinct non-null value. Without this,
--      62 clusters destroy an identifier: 'Corning' (209 mentions, no ticker)
--      beats 'Corning Incorporated' (29, GLW, cik 24741) and GLW is deleted,
--      which would drop GLW out of the watchlist ticker resolution entirely.
--   2. norm_v2.moved_row journal for company_mentions / sec_filings /
--      insider_transactions, so dependent repointing is reversible.
--      financial_facts stays one-way by design (1.44M rows).
--   3. Refined risk classifier. 0020's "single-token key" rule flagged
--      microsoft, intel, oracle, boeing and visa as needing review; the real
--      judgement set is ~96 clusters, not 419.
--   4. Six suffixes folded into lookup_key_v2 (se, spa, oyj, asa, pte, pty) so
--      the migration and backend/company_match.py share one definition.
--   5. resolution_log.candidate_canonical_ids (an array) is now repointed.
--      0020 rewrote only resolved_canonical_id, leaving dangling array members.
--   6. An identity-audit view for validating inherited ticker/cik against SEC
--      EDGAR before approving anything. See section 0d.
--   7. ADDED 2026-08-30. That EDGAR validation is now a HARD GATE at the top of
--      section 3, not a step somebody remembers. It found a second contaminated
--      row ('compass' inheriting Encompass Health's EHC / cik 785161) that the
--      classifier scored `auto`, meaning it would have merged with no human
--      involved. Postgres cannot fetch EDGAR, so the comparison lives in
--      tools/norm_v2_edgar_audit.py and section 3 refuses to run without a
--      fresh, clean, recorded result from it.
--
-- MEASURED AGAINST LIVE DATA 2026-08-15 (read-only, 5,364 companies):
--   clusters 780, rows absorbed 1,319   (0020 measured 677 / 1,102 at 4,865 rows)
--
-- RE-MEASURED 2026-08-30 (read-only, 5,599 companies):
--   clusters 825, rows absorbed 1,405
--   auto 562 / review 247 / block 16     (review: 94 no-identity, 151 sector, 2 identifier)
--   67 clusters would inherit an identity; of those EDGAR agrees with 60,
--   does not list 5, and contradicts 2 (axt, compass -- both now pre-blocked).
--
-- The counts move with every ingest run: +734 company rows in 15 days. Rebuild
-- and re-audit immediately before merging; do not trust any figure here blind.
-- =====================================================================


-- =====================================================================
-- SECTION 0 -- INSPECT. Read-only. Run this FIRST and read every answer.
-- Nothing below section 0 should run until 0a returns two rows.
-- =====================================================================

-- 0a. HARD GATE: the two indexes the merge depends on.
--     Phase 6 runs, per cluster:
--         UPDATE company_mentions SET company_id=... WHERE company_id = ANY(losers)
--         UPDATE financial_facts  SET company_id=... WHERE company_id = ANY(losers)
--     company_mentions is 88k rows and dominates write volume; financial_facts
--     is 1.44M rows. Unindexed, ~780 merges become ~780 sequential scans.
--
--     financial_facts_company_idx is created by
--     supabase/migrations/20260603120000_create_financial_facts.sql:95.
--     company_mentions predates the repo's migrations and its indexes CANNOT be
--     confirmed from source. This query is the only confirmation.
--
--   SELECT tablename, indexname, indexdef
--     FROM pg_indexes
--    WHERE (tablename = 'company_mentions' AND indexdef LIKE '%company_id%')
--       OR (tablename = 'financial_facts'  AND indexdef LIKE '%company_id%');
--
--     EXPECT: at least one row per table. If company_mentions is missing, STOP
--     and create it first, off-peak, then re-check:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS company_mentions_company_idx
--     ON public.company_mentions (company_id);

-- 0b. Prerequisites from 0020 exist.
--
--   SELECT to_regclass('norm_v2.snapshot_companies')  AS snapshot_companies,
--          to_regclass('norm_v2.snapshot_aliases')    AS snapshot_aliases,
--          to_regclass('norm_v2.quarantine_company')  AS quarantine_company,
--          to_regclass('norm_v2.quarantine_alias')    AS quarantine_alias;
--     All four must be non-null. If any is null, run 0020 phases 2 and 3 first.

-- 0c. Sizes, so the merge-day cost is a number and not a guess.
--
--   SELECT relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) AS total
--     FROM pg_stat_user_tables
--    WHERE relname IN ('companies','aliases','company_mentions','financial_facts',
--                      'sec_filings','insider_transactions','resolution_log')
--    ORDER BY pg_total_relation_size(relid) DESC;

-- 0d. IDENTITY AUDIT (changes 6 and 7).
--
--     REQUIRED, AND ENFORCED. Run the tool BEFORE section 3:
--
--         python tools/norm_v2_edgar_audit.py --emit-sql
--
--     It replays the clustering read-only, checks every inherited ticker/cik
--     against SEC company_tickers.json, exits non-zero on any un-pre-blocked
--     disagreement, and emits the SQL recording the result. Section 3's hard
--     gate refuses to build the plan without that record, fresh within 24h and
--     clean. The view below is the in-database companion, readable AFTER the
--     plan exists.
--     Every ticker/cik that section 4 would inherit onto a survivor. Validate
--     each against SEC EDGAR company_tickers.json before approving. This is the
--     check that catches a contaminated row: 'AXT Inc.' carries ticker BAX and
--     cik 10456, which is Baxter International, not AXT.
--
--   SELECT * FROM norm_v2.identity_audit ORDER BY cluster_mentions DESC;
--
--     Any row whose ticker/cik does not belong to the survivor's company must
--     be added to the section 3 pre-block list before merging.

-- 0e. After section 3, the review workload:
--
--   SELECT risk, count(*) AS clusters, sum(member_count - 1) AS rows_absorbed
--     FROM norm_v2.plan_cluster GROUP BY risk ORDER BY 1;


-- =====================================================================
-- SECTION 1 -- REPLACES 0020 PHASE 1's lookup_key_v2.
-- Change 4: fold in the six measured suffixes.
--
-- Pure function replacement. Changes no data. Safe to run repeatedly.
-- norm_v2.lookup_key_v1 from 0020 is UNCHANGED and still required.
-- =====================================================================

-- PARITY: this must stay byte-identical to normalize_company_key in
-- backend/company_match.py. The six EXTRA suffixes below were measured over
-- 170,178 article rows (tools/primary_fold_eval.py --suffix-audit):
--   se +113 rows, asa +4, spa +2, oyj +2, pte +1, pty +1.
-- Deliberately EXCLUDED after measuring: sas (+0), gmbh (+0), kgaa (+0 rows
-- but +5 new ambiguous collisions).
-- Also deliberately excluded: stripping a leading "The". It recovered ZERO
-- rows and created 65 new ambiguous collisions, because the index holds both
-- 'The Coca-Cola' and 'The Coca-Cola Company' and folding the article makes
-- duplicates collide with each other.

CREATE OR REPLACE FUNCTION norm_v2.lookup_key_v2(s text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  -- v_ prefixes: `out` is a parameter-mode keyword and is not worth risking as
  -- a variable name in a function that has never been executed.
  v_base   text;
  v_punct  text;
  v_out    text;
  v_prev   text;
  -- The trailing group (se|spa|oyj|asa|pte|pty) was folded in 2026-08-15; see
  -- the parity note above this function for the per-suffix measurements.
  -- NOTE: no comment may appear BETWEEN these literals. Postgres concatenates
  -- adjacent string constants only when separated by whitespace containing a
  -- newline; a `--` comment in the gap breaks the concatenation and the
  -- function fails to parse.
  suffix constant text :=
    '\s+(inc|incorporated|corp|corporation|co|company|llc|ltd|limited'
    '|plc|sa|ag|nv|ab|holdings|group'
    '|se|spa|oyj|asa|pte|pty)$';
BEGIN
  v_base  := norm_v2.lookup_key_v1(s);
  v_punct := regexp_replace(v_base, '[.''' || U&'\2019' || ']', '', 'g');
  -- NOT [[:punct:]]. That class is LOCALE-DEPENDENT: under this database's
  -- UTF-8 LC_CTYPE it resolves to Unicode P* only, which EXCLUDES the nine
  -- ASCII symbols $ + < = > ^ \ | ~ (categories Sc/Sm/Sk). Python's
  -- string.punctuation includes all of them, so the two diverged silently.
  --
  -- Measured 2026-08-30: 'Disney+' keyed to 'disney+' and '$MIR' to '$mir' in
  -- SQL while backend/company_match.py folded both, so section 3 built 823
  -- clusters against an audit that measured 825. The drift check caught it.
  --
  -- translate() rather than a bracket expression on purpose: a hand-written
  -- class has to escape ] \ ^ and - correctly and is the likeliest place to
  -- reintroduce exactly this bug. 32 characters in, 32 spaces out, no regex.
  v_punct := translate(
    v_punct,
    '!"#$%&''()*+,-./:;<=>?@[\]^_`{|}~',
    '                                '
  );
  v_punct := btrim(regexp_replace(v_punct, '\s+', ' ', 'g'));

  v_out := v_punct;
  FOR i IN 1..3 LOOP
    v_prev := v_out;
    v_out  := regexp_replace(v_out, suffix, '');
    EXIT WHEN v_out = v_prev;
  END LOOP;

  IF v_out = '' THEN
    RETURN v_punct;
  END IF;

  RETURN v_out;
END;
$$;

-- Fixtures. Every column must return t. The last two are the new suffixes.
--
--   SELECT
--     norm_v2.lookup_key_v2('Caterpillar Inc.')       = 'caterpillar'            AS a,
--     norm_v2.lookup_key_v2('Archer-Daniels-Midland') = 'archer daniels midland' AS b,
--     norm_v2.lookup_key_v2('Kioxia Holdings Corp.')  = 'kioxia'                 AS c,
--     norm_v2.lookup_key_v2('Est'||U&'\00E9'||'e Lauder') = 'est'||U&'\00E9'||'e lauder' AS d,
--     norm_v2.lookup_key_v2('Group')                  = 'group'                  AS e,
--     norm_v2.lookup_key_v2('Moody''s Analytics')     = 'moodys analytics'       AS f,
--     norm_v2.lookup_key_v2('BP p.l.c.')              = 'bp'                     AS g,
--     norm_v2.lookup_key_v2('SAP SE')                 = 'sap'                    AS h,
--     norm_v2.lookup_key_v2('Nokia Oyj')              = 'nokia'                  AS i,
--     -- leading "The" is deliberately NOT stripped:
--     norm_v2.lookup_key_v2('The Coca-Cola Company')  = 'the coca cola'          AS j,
--     -- ASCII SYMBOLS, not Unicode punctuation. These two are the regression
--     -- guard for the [[:punct:]] locale bug: '+' is Sm and '$' is Sc, so a
--     -- Unicode-only punct class leaves them in and the key stops matching
--     -- backend/company_match.py.
--     norm_v2.lookup_key_v2('Disney+')                = 'disney'                 AS k,
--     norm_v2.lookup_key_v2('$MIR')                   = 'mir'                    AS l;


-- =====================================================================
-- SECTION 2 -- moved_row journal (change 2).
-- Makes dependent repointing reversible for the three cheap tables.
-- =====================================================================

CREATE TABLE IF NOT EXISTS norm_v2.moved_row (
  id              bigserial PRIMARY KEY,
  new_key         text        NOT NULL,
  table_name      text        NOT NULL,
  row_id          text        NOT NULL,   -- text, so this works for any pk type
  from_company_id uuid        NOT NULL,
  to_company_id   uuid        NOT NULL,
  moved_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS moved_row_new_key_idx  ON norm_v2.moved_row (new_key);
CREATE INDEX IF NOT EXISTS moved_row_table_id_idx ON norm_v2.moved_row (table_name, row_id);

COMMENT ON TABLE norm_v2.moved_row IS
  'Per-row provenance for phase 6 repointing. Covers company_mentions, '
  'sec_filings and insider_transactions (~93k rows). financial_facts is '
  'DELIBERATELY NOT journaled: 1.44M rows, and its repoint is accepted as '
  'one-way. Rollback of those three is: UPDATE t SET company_id = from_company_id '
  'FROM norm_v2.moved_row WHERE t.id::text = row_id AND table_name = ''t''.';


-- =====================================================================
-- SECTION 3 -- REPLACES 0020 PHASE 4. Build the plan.
-- Changes 3 (refined classifier) and the expanded pre-block list.
-- Non-destructive. This is the artifact a human reviews.
--
-- Requires: 0020 phase 2 (snapshot) and phase 3 (quarantine) already run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- HARD GATE -- EDGAR IDENTITY AUDIT. Change 7, added 2026-08-30.
--
-- This runs FIRST and refuses to build the plan without a fresh, clean audit.
-- It is a gate rather than a documented step because the failure it prevents is
-- invisible to every other check in this file.
--
-- Section 4 gives the survivor the ticker/sec_cik of its members when exactly
-- one distinct value exists. That is what stops the merge destroying an
-- identifier. It is also what LAUNDERS a wrong one onto the canonical row.
-- Two live rows do exactly that:
--
--     axt      'AXT Inc.'     carries BAX / cik 10456  = BAXTER INTERNATIONAL INC
--     compass  'Compass Inc.' carries EHC / cik 785161 = Encompass Health Corp
--
-- The classifier cannot see either. Both have ONE distinct ticker, ONE distinct
-- cik and ONE identified member, the ordinary healthy shape, so 'compass' scored
-- `auto` and would have merged unattended. It was found only because somebody
-- compared the inherited identifier against EDGAR by hand. Postgres cannot fetch
-- EDGAR, so the comparison lives in tools/norm_v2_edgar_audit.py and this gate
-- enforces that it ran, recently, and passed.
--
-- TO SATISFY IT:
--     python tools/norm_v2_edgar_audit.py --emit-sql
-- then paste the emitted block. The tool exits non-zero and emits nothing
-- useful while any un-pre-blocked cluster contradicts EDGAR.
--
-- The 24h window is not arbitrary: companies grew by 734 rows in the 15 days to
-- 2026-08-30, and a newly ingested contaminated row is precisely what this
-- catches, so a week-old audit is not evidence about today's table.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r       record;
  n_loose bigint;
  age     interval;
BEGIN
  IF to_regclass('norm_v2.edgar_audit') IS NULL
     OR to_regclass('norm_v2.edgar_audit_run') IS NULL THEN
    RAISE EXCEPTION
      'EDGAR identity audit has never run. Run: python tools/norm_v2_edgar_audit.py --emit-sql, '
      'paste the emitted SQL, then re-run this section.'
      USING HINT = 'The audit is what caught axt and compass. Do not skip it.';
  END IF;

  SELECT * INTO r FROM norm_v2.edgar_audit_run;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'norm_v2.edgar_audit_run is empty: the audit tables exist but no audit was recorded.';
  END IF;

  age := now() - r.audited_at;
  IF age > interval '24 hours' THEN
    RAISE EXCEPTION
      'EDGAR audit is STALE: recorded % ago (%), over the 24h limit. companies grows every '
      'ingest run and a new contaminated row is exactly what this catches. Re-run the tool.',
      age, r.audited_at;
  END IF;

  SELECT count(*) INTO n_loose
    FROM norm_v2.edgar_audit
   WHERE verdict = 'mismatch' AND NOT pre_blocked AND NOT acknowledged;
  IF n_loose > 0 THEN
    RAISE EXCEPTION
      'EDGAR audit FAILED: % cluster(s) would inherit an identifier EDGAR assigns to a '
      'different company, and are neither pre-blocked nor acknowledged. '
      'SELECT new_key, inherit_ticker, inherit_cik, edgar_title FROM norm_v2.edgar_audit '
      'WHERE verdict = ''mismatch'' AND NOT pre_blocked AND NOT acknowledged;', n_loose;
  END IF;

  RAISE NOTICE 'EDGAR audit OK: % clusters, % inheriting an identity, recorded % ago.',
    r.cluster_count, r.inherit_count, age;
END;
$$;


-- RE-RUN GUARD. The DROP below destroys plan_cluster, and with it every
-- approval a human has ticked and every merged_at stamp. Refuse if either
-- exists. 0020 phase 2 has the same guard on its snapshot; this is the
-- equivalent for the plan, and without it a careless re-run silently discards
-- the review that gates the destructive phase.
--
-- To rebuild deliberately after a review, archive first:
--   CREATE TABLE norm_v2.plan_cluster_archive_<date> AS
--     SELECT * FROM norm_v2.plan_cluster;
--   CREATE TABLE norm_v2.plan_member_archive_<date> AS
--     SELECT * FROM norm_v2.plan_member;
-- then clear the flags the guard checks:
--   UPDATE norm_v2.plan_cluster SET approved=false, merged_at=NULL;
DO $$
DECLARE
  n_approved bigint := 0;
  n_merged   bigint := 0;
BEGIN
  IF to_regclass('norm_v2.plan_cluster') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FILTER (WHERE approved), count(*) FILTER (WHERE merged_at IS NOT NULL) '
            'FROM norm_v2.plan_cluster'
      INTO n_approved, n_merged;
    IF n_merged > 0 THEN
      RAISE EXCEPTION
        'REFUSING to rebuild the plan: % cluster(s) are already MERGED. '
        'Rebuilding would lose the record of what was done. Archive first.',
        n_merged;
    END IF;
    IF n_approved > 0 THEN
      RAISE EXCEPTION
        'REFUSING to rebuild the plan: % cluster(s) carry a human approval. '
        'Archive norm_v2.plan_cluster before re-running section 3.', n_approved;
    END IF;
  END IF;
END;
$$;

DROP TABLE IF EXISTS norm_v2.plan_member;
DROP TABLE IF EXISTS norm_v2.plan_cluster;

CREATE TABLE norm_v2.plan_cluster (
  new_key            text PRIMARY KEY,
  member_count       int  NOT NULL,
  survivor_id        uuid NOT NULL,
  survivor_name      text NOT NULL,
  distinct_tickers   int  NOT NULL,
  distinct_ciks      int  NOT NULL,
  distinct_sectors   int  NOT NULL,
  identified_members int  NOT NULL,   -- members carrying a ticker or a cik
  -- ticker/cik the survivor will INHERIT if it has none of its own. NULL when
  -- the cluster carries no identity at all.
  inherit_ticker     text,
  inherit_cik        bigint,
  risk               text NOT NULL,   -- 'block' | 'review' | 'auto'
  risk_reason        text,
  approved           boolean NOT NULL DEFAULT false,
  approved_by        text,
  approved_at        timestamptz,
  merged_at          timestamptz,
  built_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE norm_v2.plan_member (
  new_key       text NOT NULL REFERENCES norm_v2.plan_cluster(new_key) ON DELETE CASCADE,
  company_id    uuid NOT NULL,
  name          text NOT NULL,
  old_key       text NOT NULL,
  ticker        text,
  sec_cik       bigint,
  sector        text,
  mention_count int,
  is_survivor   boolean NOT NULL,
  row_fingerprint text NOT NULL,
  PRIMARY KEY (new_key, company_id)
);

WITH keyed AS (
  SELECT
    c.id, c.name, c.ticker, c.sec_cik, c.sector, c.mention_count, c.first_seen,
    norm_v2.lookup_key_v1(c.name) AS old_key,
    norm_v2.lookup_key_v2(c.name) AS new_key
  FROM public.companies c
  WHERE NOT EXISTS (SELECT 1 FROM norm_v2.quarantine_company q WHERE q.id = c.id)
),
ranked AS (
  SELECT k.*,
         row_number() OVER (
           PARTITION BY k.new_key
           -- UNCHANGED from 0020: most mentioned, then oldest, then stable by id.
           -- Identity is handled by inheritance in section 4, not by reordering,
           -- so the survivor stays the row most dependents already point at.
           ORDER BY coalesce(k.mention_count, 0) DESC, k.first_seen ASC NULLS LAST, k.id ASC
         ) AS rn
  FROM keyed k
),
clusters AS (
  SELECT
    new_key,
    count(*) AS member_count,
    count(DISTINCT upper(btrim(ticker)))
      FILTER (WHERE nullif(btrim(ticker),'') IS NOT NULL)            AS distinct_tickers,
    count(DISTINCT sec_cik) FILTER (WHERE sec_cik IS NOT NULL)       AS distinct_ciks,
    count(DISTINCT sector)  FILTER (WHERE sector IS NOT NULL)        AS distinct_sectors,
    count(*) FILTER (WHERE nullif(btrim(ticker),'') IS NOT NULL
                        OR sec_cik IS NOT NULL)                      AS identified_members,
    -- upper() here MUST match the upper() in distinct_tickers above, or a
    -- cluster holding 'glw' and 'GLW' counts as 1 distinct but yields a
    -- 2-element array and tickers[1] picks arbitrarily.
    (array_agg(DISTINCT upper(btrim(ticker)))
       FILTER (WHERE nullif(btrim(ticker),'') IS NOT NULL))          AS tickers,
    (array_agg(DISTINCT sec_cik)
       FILTER (WHERE sec_cik IS NOT NULL))                           AS ciks
  FROM keyed
  GROUP BY new_key
  HAVING count(*) > 1
)
INSERT INTO norm_v2.plan_cluster (
  new_key, member_count, survivor_id, survivor_name,
  distinct_tickers, distinct_ciks, distinct_sectors, identified_members,
  inherit_ticker, inherit_cik, risk, risk_reason
)
SELECT
  cl.new_key,
  cl.member_count,
  s.id,
  s.name,
  cl.distinct_tickers,
  cl.distinct_ciks,
  cl.distinct_sectors,
  cl.identified_members,
  CASE WHEN cl.distinct_tickers = 1 THEN cl.tickers[1] END,
  CASE WHEN cl.distinct_ciks    = 1 THEN cl.ciks[1]    END,
  CASE
    -- HARD BLOCK, unchanged from 0020. Two CIKs or two tickers in one cluster
    -- means two real companies. This is what caught 'hp':
    --   HP Inc [HPQ, cik 47217] vs HP Inc. [HP, cik 46765 = Helmerich & Payne]
    WHEN cl.distinct_ciks > 1 OR cl.distinct_tickers > 1 THEN 'block'
    -- Members disagree on sector. Usually one mislabeled row rather than two
    -- companies ('Starbucks Corp.' tagged Technology), but it is cheap to eye.
    WHEN cl.distinct_sectors > 1                          THEN 'review'
    -- Two rows both claiming the SAME identity: a duplicate-identity smell,
    -- and how 'BYD' looks (two rows carrying ticker BYD, which is in fact
    -- Boyd Gaming's symbol).
    WHEN cl.identified_members > 1                        THEN 'review'
    -- CHANGED. Exactly one member carries identity and the rest are bare
    -- spelling variants with no disagreement. This is the ordinary shape
    -- (Microsoft / Microsoft Corp / Microsoft Corporation) and 0020 sent all
    -- of it to human review purely because the key had no space.
    WHEN cl.identified_members = 1                        THEN 'auto'
    -- No identity evidence anywhere AND a short or single-token key: nothing
    -- in the table can adjudicate. This is the genuine judgement set.
    WHEN cl.identified_members = 0
     AND (length(cl.new_key) <= 5 OR cl.new_key NOT LIKE '% %')
                                                          THEN 'review'
    ELSE 'auto'
  END,
  CASE
    WHEN cl.distinct_ciks > 1      THEN 'multiple distinct sec_cik in cluster'
    WHEN cl.distinct_tickers > 1   THEN 'multiple distinct ticker in cluster'
    WHEN cl.distinct_sectors > 1   THEN 'members disagree on sector'
    WHEN cl.identified_members > 1 THEN 'more than one member carries an identifier'
    WHEN cl.identified_members = 0
     AND (length(cl.new_key) <= 5 OR cl.new_key NOT LIKE '% %')
                                   THEN 'no identity evidence, short or single-token key'
    ELSE NULL
  END
FROM clusters cl
JOIN ranked s ON s.new_key = cl.new_key AND s.rn = 1;

INSERT INTO norm_v2.plan_member (
  new_key, company_id, name, old_key, ticker, sec_cik, sector,
  mention_count, is_survivor, row_fingerprint
)
SELECT
  r.new_key, r.id, r.name, r.old_key, r.ticker, r.sec_cik, r.sector,
  r.mention_count, (r.rn = 1),
  md5(coalesce(r.name,'') || '|' || coalesce(r.ticker,'') || '|' ||
      coalesce(r.sec_cik::text,'') || '|' || coalesce(r.mention_count::text,''))
FROM (
  SELECT k.*,
         row_number() OVER (
           PARTITION BY k.new_key
           ORDER BY coalesce(k.mention_count,0) DESC, k.first_seen ASC NULLS LAST, k.id ASC
         ) AS rn
  FROM (
    SELECT c.id, c.name, c.ticker, c.sec_cik, c.sector, c.mention_count, c.first_seen,
           norm_v2.lookup_key_v1(c.name) AS old_key,
           norm_v2.lookup_key_v2(c.name) AS new_key
    FROM public.companies c
    WHERE NOT EXISTS (SELECT 1 FROM norm_v2.quarantine_company q WHERE q.id = c.id)
  ) k
) r
JOIN norm_v2.plan_cluster pc ON pc.new_key = r.new_key;


-- ---------------------------------------------------------------------
-- DRIFT CHECK. The audit derives its clusters in Python; this section derives
-- them in SQL. Two implementations of one rule can disagree, and if they do the
-- audit was measuring a different set of clusters than the one about to be
-- merged, which would make it worthless without looking broken. Compare the
-- counts and fail if they diverge.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  audited int;
  built   int;
BEGIN
  SELECT cluster_count INTO audited FROM norm_v2.edgar_audit_run;
  SELECT count(*)      INTO built   FROM norm_v2.plan_cluster;
  IF audited <> built THEN
    RAISE EXCEPTION
      'DRIFT: the EDGAR audit measured % clusters, this section built %. The Python port '
      'of lookup_key_v2 and the SQL function disagree, so the audit does not describe this '
      'plan. Reconcile before merging anything.', audited, built;
  END IF;
  RAISE NOTICE 'audit/plan agree on % clusters.', built;
END;
$$;


-- ---------------------------------------------------------------------
-- PRE-BLOCK LIST. Clusters where members carry DISTINCT REAL-WORLD
-- IDENTITIES that the data cannot prove. Blocked means UNTOUCHED: phase 6
-- refuses these regardless of `approved`. Splitting them is a separate
-- operation, deliberately not built into this migration.
--
-- Verified against live data 2026-08-15. Only 'hp' is caught by the
-- automated rule; every other entry carries at most ONE distinct ticker and
-- would otherwise sail through, which is exactly why this list exists.
-- ---------------------------------------------------------------------
UPDATE norm_v2.plan_cluster
   SET risk = 'block',
       risk_reason = coalesce(risk_reason || '; ', '') ||
                     'manually blocked: distinct real-world identities, split separately'
 WHERE new_key IN (
   -- 0020 design doc 6.2-6.4
   'hp',        -- HP Inc [HPQ] vs Helmerich & Payne [HP]. Rule-blocked too.
   'bain',      -- Bain Capital Specialty Finance [BCSF] vs Bain & Company
   'hg',        -- Hg (UK software PE) vs HG Holdings, Inc.
   'eqt',       -- EQT AB (Swedish PE) vs EQT Corporation (US gas, cik 33213)
   'genius',    -- Genius Sports vs Genius Group [GNS]
   'go',        -- bare 'Go' vs Grocery Outlet [GO, cik 1771515]
   'zip',       -- Zip Co (AU BNPL) vs ZipRecruiter [cik 1617553]
   'cpb',       -- Campbell Soup [CPB, cik 16732] vs Central Pacific Bank
   'x',         -- X/Twitter vs US Steel's ticker. Not a cluster as of 2026-08-15.
   'tata',      -- 'Tata' could be Tata Motors or TCS, not the conglomerate
   'ubs',       -- UBS Group AG (parent) vs UBS AG (bank). Legally distinct.
   'ig',        -- IG Group vs IG Group Holdings Plc
   -- Rows carrying provably WRONG identity. Critical under the new inherit
   -- rule in section 4: without these, survivor 'AXT' would inherit ticker
   -- BAX / cik 10456, which is Baxter International.
   --
   -- NEITHER of the two is caught by the classifier. Both clusters have ONE
   -- distinct ticker, ONE distinct cik and ONE identified member, which is the
   -- ordinary healthy shape, so 'compass' scored `auto` and would have merged
   -- with no human involved. The ONLY thing that finds these is comparing the
   -- inherited identifier against EDGAR, which is why that audit is now a hard
   -- gate at the top of this section rather than a step to remember.
   'axt',
   'compass',   -- added 2026-08-30. 'Compass Inc.' carries EHC / cik 785161,
                -- which is Encompass Health Corp. Survivor 'Compass' has no
                -- identity of its own, so the inherit rule would write
                -- Encompass Health's identifiers onto Compass.
   'xai',       -- 'xAI' carries ticker XFLT, the XAI Octagon closed-end fund
   -- Added 2026-08-15: multiple members are separately listed entities.
   'softbank',  -- SoftBank Group Corp (9984) and SoftBank Corp (9434) both present
   'byd',       -- two rows carry ticker BYD, which is Boyd Gaming's symbol;
                -- BYD Co Ltd is 1211.HK. Sectors also disagree across members.
   'coherent',  -- 4 spellings, zero identity evidence on any of them
   -- Added 2026-08-30 at human review of the 247-cluster queue.
   'tencent',   -- survivor 'Tencent' carries TME / cik 1744676, which EDGAR
                -- says is Tencent Music Entertainment Group, not Tencent
                -- Holdings (0700.HK). Wrong identity ALREADY on the survivor,
                -- so nothing is inherited and the section 0d audit is blind to
                -- it; see the qualifier-gap check in tools/norm_v2_edgar_audit.py.
   'nu',        -- 'Nu Holdings' [NU, cik 1691493] vs a bare 'NU' tagged
                -- Media & Telecom with 33 mentions. Two different things.
   'viking',    -- 'Viking Holdings' (cruises, Consumer & Retail) vs 'Viking'
                -- tagged Healthcare & Biotech, 7 mentions each. The second is
                -- almost certainly Viking Therapeutics.
   'penske',    -- Penske Corporation is the private parent; 'penske automotive'
                -- is a separate cluster carrying PAG.
   'mitsubishi',-- conglomerate. Bare 'Mitsubishi' could be UFJ, Electric,
                -- Heavy or Motors; 'Mitsubishi Corp.' is 8058.T specifically.
   'mitsui',    -- same shape: 'Mitsui & Co.' is 8031.T, bare 'Mitsui' could be
                -- Fudosan, Chemicals or O.S.K. Lines.
   -- Auto-tier rows carrying an identifier that belongs to a different company.
   -- All three were surfaced by the qualifier-gap scan, not by the classifier:
   -- each has ONE ticker, ONE cik and ONE identified member, so each scored
   -- `auto` and would have merged unattended.
   'stran',     -- 'Stran' carries ASTH = Astrana Health. Stran & Company is SWAG.
   'science',   -- 'Science Corp.' carries GILD / cik 882095 = Gilead Sciences.
   'csl',       -- 'CSL' carries CSL / cik 790051 = Carlisle Companies. A bare CSL
                -- in financial news reads as CSL Limited (CSL.AX, Australian
                -- biotech); the identifier is suspect under either reading.
   'agi'        -- survivor 'AGI' carries AGI / cik 1178819, which EDGAR says is
                -- Alamos Gold. 'AGI Inc' is tagged Technology with 2 mentions
                -- and reads as artificial general intelligence, not a gold
                -- miner. Found by the qualifier-gap rule, not by the classifier.
   --
   -- 'stryker' and 'strategy' were proposed here and REJECTED on review:
   --   stryker  EDGAR confirms SYK / cik 310764 IS Stryker Corp, so the inherit
   --            writes the correct identity. Its survivor is mislabelled
   --            Financial Services; fix the sector, do not block the merge.
   --   strategy both members are 'Strategy Inc' / 'Strategy Inc.', same sector.
   --            One name, two spellings. Whether the row should carry MSTR is a
   --            ticker-assignment question, not a merge question.
 );

-- Demoting a block to a reviewable cluster is a DELIBERATE act. The 0020
-- design doc recommends merging 'ubs' and 'ig'; do it explicitly, one at a
-- time, never in bulk:
--
--   UPDATE norm_v2.plan_cluster
--      SET risk = 'review',
--          risk_reason = risk_reason || '; unblocked by <name> <date>, rationale'
--    WHERE new_key = 'ubs';


-- Identity audit view for section 0d (change 6).
CREATE OR REPLACE VIEW norm_v2.identity_audit AS
SELECT
  pc.new_key,
  pc.risk,
  pc.survivor_name,
  pc.inherit_ticker,
  pc.inherit_cik,
  (SELECT sum(coalesce(pm.mention_count,0))
     FROM norm_v2.plan_member pm WHERE pm.new_key = pc.new_key) AS cluster_mentions,
  (SELECT string_agg(pm.name || coalesce(' ['||pm.ticker||']','')
                     || coalesce(' cik='||pm.sec_cik::text,''), ' | '
                     ORDER BY pm.mention_count DESC NULLS LAST)
     FROM norm_v2.plan_member pm WHERE pm.new_key = pc.new_key) AS members
FROM norm_v2.plan_cluster pc
-- Only clusters where the survivor would GAIN an identifier it does not have.
WHERE (pc.inherit_ticker IS NOT NULL OR pc.inherit_cik IS NOT NULL)
  AND EXISTS (
    SELECT 1 FROM norm_v2.plan_member pm
     WHERE pm.new_key = pc.new_key AND pm.is_survivor
       AND nullif(btrim(pm.ticker),'') IS NULL AND pm.sec_cik IS NULL
  );

COMMENT ON VIEW norm_v2.identity_audit IS
  'Clusters where section 4 would write a ticker/cik onto a survivor that has '
  'none. Validate every row against SEC EDGAR company_tickers.json before '
  'approving; a wrong identifier here is laundered into the canonical row. '
  'Measured 62 such clusters on 2026-08-15.';

INSERT INTO norm_v2.run_ledger (phase, notes)
VALUES ('04b_plan_revised', jsonb_build_object(
  'clusters',      (SELECT count(*) FROM norm_v2.plan_cluster),
  'rows_absorbed', (SELECT coalesce(sum(member_count - 1),0) FROM norm_v2.plan_cluster),
  'block',         (SELECT count(*) FROM norm_v2.plan_cluster WHERE risk='block'),
  'review',        (SELECT count(*) FROM norm_v2.plan_cluster WHERE risk='review'),
  'auto',          (SELECT count(*) FROM norm_v2.plan_cluster WHERE risk='auto'),
  'inherit_rows',  (SELECT count(*) FROM norm_v2.identity_audit)
))
ON CONFLICT (phase) DO UPDATE
  SET ran_at = now(), ran_by = current_user, notes = EXCLUDED.notes;

-- Expected on 2026-08-15 data: ~780 clusters, ~1,319 rows absorbed,
-- ~62 rows in identity_audit. Re-read section 0e before continuing.


-- =====================================================================
-- SECTION 4 -- REPLACES 0020 PHASE 6. THE DESTRUCTIVE PHASE.
-- Changes 1 (identity inheritance), 2 (journal), 5 (candidate array).
--
-- One cluster per call, its own transaction. A failure stops at a cluster
-- boundary and everything already merged stays consistent.
-- =====================================================================

CREATE OR REPLACE FUNCTION norm_v2.merge_cluster(p_new_key text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  cl        norm_v2.plan_cluster%ROWTYPE;
  survivor  uuid;
  losers    uuid[];
  drifted   int;
  moved     jsonb := '{}'::jsonb;
  n         bigint;
  s_ticker  text;
  s_cik     bigint;
  got_t     text;
  got_c     bigint;
  v_mentions bigint;
  v_themes   text[];
BEGIN
  SELECT * INTO cl FROM norm_v2.plan_cluster WHERE new_key = p_new_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'norm_v2.merge_cluster: no plan row for %', p_new_key;
  END IF;

  IF cl.merged_at IS NOT NULL THEN
    RETURN jsonb_build_object('new_key', p_new_key, 'status', 'already_merged');
  END IF;
  IF cl.risk = 'block' THEN
    RETURN jsonb_build_object('new_key', p_new_key, 'status', 'skipped_blocked',
                              'reason', cl.risk_reason);
  END IF;
  IF NOT cl.approved THEN
    RETURN jsonb_build_object('new_key', p_new_key, 'status', 'skipped_unapproved');
  END IF;

  -- ASSERT: no member drifted since the plan was built.
  SELECT count(*) INTO drifted
  FROM norm_v2.plan_member pm
  LEFT JOIN public.companies c ON c.id = pm.company_id
  WHERE pm.new_key = p_new_key
    AND (c.id IS NULL
         OR md5(coalesce(c.name,'') || '|' || coalesce(c.ticker,'') || '|' ||
                coalesce(c.sec_cik::text,'') || '|' || coalesce(c.mention_count::text,''))
             <> pm.row_fingerprint);
  IF drifted > 0 THEN
    RAISE EXCEPTION
      'norm_v2.merge_cluster(%): % member row(s) changed since the plan was '
      'built. Re-run SECTION 3 and re-review this cluster.', p_new_key, drifted;
  END IF;

  SELECT pm.company_id INTO survivor
    FROM norm_v2.plan_member pm WHERE pm.new_key = p_new_key AND pm.is_survivor;
  SELECT array_agg(pm.company_id) INTO losers
    FROM norm_v2.plan_member pm WHERE pm.new_key = p_new_key AND NOT pm.is_survivor;

  IF survivor IS NULL OR losers IS NULL OR array_length(losers,1) = 0 THEN
    RAISE EXCEPTION 'norm_v2.merge_cluster(%): degenerate cluster', p_new_key;
  END IF;

  -- ---- repoint dependents ---------------------------------------------
  -- No foreign keys exist on companies.id. Nothing cascades. Repointing is
  -- entirely this function's job.
  --
  -- TYPE AUDIT (verified 2026-08-30 against the live schema, ALL 23 cross-table
  -- comparisons and assignments in this function):
  --   uuid, as assumed: company_mentions.company_id, financial_facts.company_id,
  --     sec_filings.company_id, insider_transactions.company_id,
  --     aliases.canonical_id, resolution_log.resolved_canonical_id, companies.id
  --   NOT uuid, and each one broke this function:
  --     user_memo_regeneration_quota.company_id  TEXT holding a company NAME
  --     resolution_log.candidate_canonical_ids   JSONB array of uuid strings
  --     user_events.entity_id                    TEXT, and never a company id
  --   Cast-safe: company_mentions.id / sec_filings.id / insider_transactions.id
  --     are uuid and go into moved_row.row_id (text) via ::text.
  --   companies.key_themes is text[], so unnest() in the fold below is valid.
  --
  -- CONSTRAINT AUDIT on the TARGET table, added 2026-09-01 after a fourth
  -- failure. The type audit above covered every DEPENDENT table and never
  -- looked at public.companies itself, which is where the merge WRITES.
  --   companies_sec_cik_unique  UNIQUE(sec_cik)  -> the identity inherit must
  --     not overlap a loser. 793 non-null cik values, 793 distinct.
  --   ticker  NOT unique: 17 values duplicated in live data. No collision.
  --   name    5,617 distinct of 5,617, so a unique constraint is possible, but
  --     this function never writes name, so it cannot collide either way.
  --
  -- The collision analysis below was verified against pg_index, which answers
  -- ONLY whether two rows can collide on a unique key. It cannot report a
  -- column's TYPE and it cannot report what the values MEAN, which is why the
  -- three defects above survived it: user_memo_regeneration_quota was in the
  -- list and still wrong, and user_events and the candidate array were never
  -- in the list at all.
  --
  -- Collision analysis (verified against pg_index):
  --   company_mentions      pkey(id)                       -> collision-free
  --   financial_facts       uq(accession_number, concept_tag, period_start,
  --                            period_end, unit), no company_id -> collision-free
  --   insider_transactions  uq(accession_number, insider_cik, transaction_date,
  --                            transaction_code)            -> collision-free
  --   sec_filings           uq(accession_number)            -> collision-free
  --   user_memo_quota       pkey CONTAINS company_id        -> CAN collide, deduped
  --   aliases               uq(lookup_key, canonical_id)    -> CAN collide, deduped

  -- CHANGE 2: journal the three cheap tables BEFORE repointing them.
  INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
  SELECT p_new_key, 'company_mentions', m.id::text, m.company_id, survivor
    FROM public.company_mentions m WHERE m.company_id = ANY(losers);

  INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
  SELECT p_new_key, 'sec_filings', f.id::text, f.company_id, survivor
    FROM public.sec_filings f WHERE f.company_id = ANY(losers);

  INSERT INTO norm_v2.moved_row (new_key, table_name, row_id, from_company_id, to_company_id)
  SELECT p_new_key, 'insider_transactions', t.id::text, t.company_id, survivor
    FROM public.insider_transactions t WHERE t.company_id = ANY(losers);

  UPDATE public.company_mentions SET company_id = survivor WHERE company_id = ANY(losers);
  GET DIAGNOSTICS n = ROW_COUNT;
  moved := moved || jsonb_build_object('company_mentions', n);

  -- NOT journaled: 1.44M rows, accepted as one-way. See norm_v2.moved_row.
  UPDATE public.financial_facts SET company_id = survivor WHERE company_id = ANY(losers);
  GET DIAGNOSTICS n = ROW_COUNT;
  moved := moved || jsonb_build_object('financial_facts', n);

  UPDATE public.insider_transactions SET company_id = survivor WHERE company_id = ANY(losers);
  GET DIAGNOSTICS n = ROW_COUNT;
  moved := moved || jsonb_build_object('insider_transactions', n);

  UPDATE public.sec_filings SET company_id = survivor WHERE company_id = ANY(losers);
  GET DIAGNOSTICS n = ROW_COUNT;
  moved := moved || jsonb_build_object('sec_filings', n);

  -- user_memo_regeneration_quota.company_id is TEXT, and it holds a company
  -- NAME, not an id. Verified 2026-08-30 against all 6 live rows: 'Anthropic',
  -- 'SpaceX', 'SpaceX', 'Tesla', 'Bank Of America', 'Snowflake'. Zero are
  -- uuid-shaped. The original `= ANY(losers)` raised 42883 operator does not
  -- exist: text = uuid, and a cast would not have helped: the two sides are
  -- different KEY SPACES, not different types of the same key.
  --
  -- So this repoints by name, the same way articles.companies[] has to.
  -- Dedup first: the pkey is (user_id, company_id, regenerated_at), so a user
  -- holding a row for both a loser name and the survivor name would collide.
  DELETE FROM public.user_memo_regeneration_quota q
   WHERE q.company_id IN (SELECT pm.name FROM norm_v2.plan_member pm
                           WHERE pm.new_key = p_new_key AND NOT pm.is_survivor)
     AND EXISTS (SELECT 1 FROM public.user_memo_regeneration_quota k
                  WHERE k.user_id = q.user_id
                    AND k.company_id = cl.survivor_name
                    AND k.regenerated_at = q.regenerated_at);
  UPDATE public.user_memo_regeneration_quota
     SET company_id = cl.survivor_name
   WHERE company_id IN (SELECT pm.name FROM norm_v2.plan_member pm
                         WHERE pm.new_key = p_new_key AND NOT pm.is_survivor);
  GET DIAGNOSTICS n = ROW_COUNT;
  moved := moved || jsonb_build_object('user_memo_regeneration_quota', n);

  UPDATE public.resolution_log SET resolved_canonical_id = survivor
   WHERE resolved_canonical_id = ANY(losers);
  GET DIAGNOSTICS n = ROW_COUNT;
  moved := moved || jsonb_build_object('resolution_log', n);

  -- CHANGE 5: repoint the candidate ARRAY too. 0020 rewrote only
  -- resolved_canonical_id, leaving array members pointing at deleted rows.
  -- Rewrites each element to the survivor and de-duplicates the result.
  --
  -- candidate_canonical_ids is JSONB, not uuid[]. Verified 2026-08-30: the
  -- column format is jsonb and it stores a JSON array of uuid STRINGS, e.g.
  -- ["79236278-...","a78433cd-..."]. 340 of a 1,000-row sample are non-empty,
  -- so this is live data, not a dormant column. The array operator && and
  -- unnest() do not apply to jsonb at all, so the original form raised rather
  -- than silently doing nothing.
  UPDATE public.resolution_log rl
     SET candidate_canonical_ids = sub.fixed
    FROM (
      SELECT l.id,
             (SELECT jsonb_agg(DISTINCT CASE WHEN e.v = ANY(losers::text[])
                                             THEN survivor::text ELSE e.v END)
                FROM jsonb_array_elements_text(l.candidate_canonical_ids) AS e(v)) AS fixed
        FROM public.resolution_log l
       WHERE jsonb_typeof(l.candidate_canonical_ids) = 'array'
         AND EXISTS (SELECT 1
                       FROM jsonb_array_elements_text(l.candidate_canonical_ids) x(v)
                      WHERE x.v = ANY(losers::text[]))
    ) sub
   WHERE rl.id = sub.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  moved := moved || jsonb_build_object('resolution_log_candidates', n);

  -- user_events.entity_id is TEXT, and it does not reference companies.
  -- Census over ALL 3,082 rows on 2026-08-30: entity_type is one of briefing
  -- (525), brief_section (255), brief_call (176), story (110), deal (31) or
  -- NULL (1,985). There is no 'company' entity_type, and ZERO entity_id values
  -- match a live companies.id. The original statement was therefore not merely
  -- mistyped, it was pointed at the wrong key space.
  --
  -- Kept, narrowed and cast rather than deleted: it matches nothing today, so
  -- it is a no-op, and it stays correct if a 'company' entity_type is ever
  -- added. Deleting it would silently drop the repoint if that happens.
  UPDATE public.user_events
     SET entity_id = survivor::text
   WHERE entity_type = 'company'
     AND entity_id = ANY(losers::text[]);

  -- aliases: fold duplicates on (lookup_key, canonical_id) before repointing.
  UPDATE public.aliases s
     SET mention_count = greatest(coalesce(s.mention_count,0), coalesce(l.mc,0)),
         last_seen_at  = greatest(s.last_seen_at, l.ls)
    FROM (
      SELECT lookup_key, max(coalesce(mention_count,0)) AS mc, max(last_seen_at) AS ls
        FROM public.aliases WHERE canonical_id = ANY(losers) GROUP BY lookup_key
    ) l
   WHERE s.canonical_id = survivor AND s.lookup_key = l.lookup_key;

  DELETE FROM public.aliases a
   WHERE a.canonical_id = ANY(losers)
     AND EXISTS (SELECT 1 FROM public.aliases k
                  WHERE k.canonical_id = survivor AND k.lookup_key = a.lookup_key);

  UPDATE public.aliases SET canonical_id = survivor WHERE canonical_id = ANY(losers);
  GET DIAGNOSTICS n = ROW_COUNT;
  moved := moved || jsonb_build_object('aliases', n);

  -- ---- fold the survivor's own fields ---------------------------------
  -- CHANGE 1. mention_count sums and key_themes unions, as before. NEW: the
  -- survivor INHERITS ticker/sec_cik when the cluster carries exactly one
  -- distinct non-null value and the survivor has none of its own.
  --
  -- COALESCE means an existing survivor value is NEVER overwritten, only a
  -- NULL is filled. Safe by construction: a cluster with two distinct tickers
  -- or CIKs is 'block' and never reaches here, so at most one identity exists.
  --
  -- This is what stops the merge destroying identifiers. Measured 2026-08-15:
  -- 62 clusters have a survivor with no ticker/cik and a loser that has one,
  -- e.g. 'Corning' (209 mentions, none) over 'Corning Incorporated' (29, GLW,
  -- cik 24741). Under 0020 as written, GLW was deleted.
  --
  -- The residual risk is a row carrying a WRONG identifier (design doc 6.5:
  -- AXT Inc. -> BAX/Baxter, xAI -> XFLT). Those clusters are pre-blocked in
  -- section 3, and norm_v2.identity_audit exists to catch any others BEFORE
  -- approval. Do not approve an identity_audit row you have not checked.
  got_t := cl.inherit_ticker;
  got_c := cl.inherit_cik;

  SELECT nullif(btrim(c.ticker),''), c.sec_cik INTO s_ticker, s_cik
    FROM public.companies c WHERE c.id = survivor;

  -- ORDERING. Two constraints pull in opposite directions and the original
  -- statement order satisfied only one of them.
  --
  --   The FOLD must read the losers. mention_count sums and key_themes unions
  --   across survivor + losers, so the aggregates are impossible once the
  --   losers are gone.
  --
  --   The IDENTITY WRITE must NOT overlap the losers. public.companies carries
  --   a UNIQUE constraint on sec_cik (companies_sec_cik_unique). Writing the
  --   inherited cik onto the survivor while the loser still holds it raises
  --   23505. Measured on 'corning': survivor takes cik 24741 from
  --   'Corning Incorporated', which still had it.
  --
  -- Resolved by splitting the read from the write rather than by moving one
  -- statement: aggregate into local variables, THEN delete, THEN write. The
  -- delete releases the cik before anything claims it, and the fold values were
  -- captured while the losers still existed.
  --
  -- ticker is deliberately NOT the same problem: 17 ticker values are
  -- duplicated in live data (SSNLF x4, BCSF x3, HOLX, BYD, ASTH, GEMI x2), so
  -- no unique constraint exists on it and the inherit cannot collide there.
  SELECT sum(coalesce(mention_count,0))
    INTO v_mentions
    FROM public.companies
   WHERE id = survivor OR id = ANY(losers);

  SELECT array_agg(DISTINCT t)
    INTO v_themes
    FROM public.companies c2, unnest(coalesce(c2.key_themes,'{}')) t
   WHERE c2.id = survivor OR c2.id = ANY(losers);

  DELETE FROM public.companies WHERE id = ANY(losers);

  UPDATE public.companies c
     SET mention_count = v_mentions,
         key_themes    = v_themes,
         ticker        = coalesce(c.ticker, got_t),
         sec_cik       = coalesce(c.sec_cik, got_c),
         last_updated  = now()
   WHERE c.id = survivor;

  UPDATE norm_v2.plan_cluster SET merged_at = now() WHERE new_key = p_new_key;

  RETURN jsonb_build_object(
    'new_key', p_new_key,
    'status', 'merged',
    'survivor', survivor,
    'losers', to_jsonb(losers),
    'inherited_ticker', CASE WHEN s_ticker IS NULL THEN got_t END,
    'inherited_cik',    CASE WHEN s_cik    IS NULL THEN got_c END,
    'rows_moved', moved
  );
END;
$$;

-- Driver. Batched so no single transaction holds a long lock on
-- financial_facts. Each call is its own transaction with autocommit on.
--
--   SELECT norm_v2.merge_cluster(new_key)
--     FROM norm_v2.plan_cluster
--    WHERE approved AND risk <> 'block' AND merged_at IS NULL
--    ORDER BY member_count DESC
--    LIMIT 25;
--
-- Repeat until it returns zero rows.


-- =====================================================================
-- SECTION 5 -- VERIFY. Read-only. Run after each merge batch.
-- Every column must return t.
-- =====================================================================
--
--   SELECT
--     NOT EXISTS (SELECT 1 FROM norm_v2.plan_cluster
--                  WHERE risk='block' AND merged_at IS NOT NULL)   AS blocks_held,
--     NOT EXISTS (SELECT 1 FROM public.aliases a
--                  WHERE NOT EXISTS (SELECT 1 FROM public.companies c
--                                     WHERE c.id = a.canonical_id))  AS no_orphan_aliases,
--     NOT EXISTS (SELECT 1 FROM public.company_mentions m
--                  WHERE m.company_id IS NOT NULL
--                    AND NOT EXISTS (SELECT 1 FROM public.companies c
--                                     WHERE c.id = m.company_id))    AS no_orphan_mentions,
--     NOT EXISTS (SELECT 1 FROM public.financial_facts f
--                  WHERE f.company_id IS NOT NULL
--                    AND NOT EXISTS (SELECT 1 FROM public.companies c
--                                     WHERE c.id = f.company_id))    AS no_orphan_facts,
--     -- candidate_canonical_ids is JSONB, not uuid[]: unnest() does not apply.
--     NOT EXISTS (SELECT 1 FROM public.resolution_log l,
--                      jsonb_array_elements_text(l.candidate_canonical_ids) e(v)
--                  WHERE jsonb_typeof(l.candidate_canonical_ids) = 'array'
--                    AND NOT EXISTS (SELECT 1 FROM public.companies c
--                                     WHERE c.id::text = e.v))       AS no_dangling_candidates,
--     (SELECT sum(mention_count) FROM public.companies)
--       = (SELECT sum(mention_count) FROM norm_v2.snapshot_companies) AS mentions_conserved;
--
-- CHANGE 1 held: no merged cluster lost an identifier.
--
--   SELECT count(*) AS identifiers_destroyed
--     FROM norm_v2.plan_cluster pc
--    WHERE pc.merged_at IS NOT NULL
--      AND (pc.inherit_ticker IS NOT NULL OR pc.inherit_cik IS NOT NULL)
--      AND NOT EXISTS (
--            SELECT 1 FROM public.companies c
--             WHERE c.id = pc.survivor_id
--               AND (nullif(btrim(c.ticker),'') IS NOT NULL OR c.sec_cik IS NOT NULL));
--     EXPECT 0.
--
-- Specifically: GLW must still resolve.
--
--   SELECT id, name, ticker, sec_cik FROM public.companies WHERE ticker = 'GLW';
--     EXPECT exactly one row.
--
-- CHANGE 2, rollback of a single cluster's dependents (NOT financial_facts):
--
--   UPDATE public.company_mentions m SET company_id = j.from_company_id
--     FROM norm_v2.moved_row j
--    WHERE j.table_name = 'company_mentions' AND j.new_key = '<key>'
--      AND m.id::text = j.row_id;
--   -- repeat for sec_filings and insider_transactions, then restore the
--   -- company rows per 0020 phase 8a/8b.
--
-- ROLLBACK ORDERING: RUN 8b BEFORE 8a. Same companies_sec_cik_unique that
-- broke the fold breaks the documented rollback order, and it breaks it at the
-- worst possible moment, when something has already gone wrong.
--
-- 8a re-inserts the deleted losers, each carrying its original sec_cik. But the
-- survivor is still holding the cik it inherited from that loser, because 8b
-- has not run yet. The INSERT raises 23505 and the rollback stops half done.
--
-- Reversing them is sufficient and needs no other change: 8b restores the
-- survivor's own snapshot values first, which sets the inherited cik back to
-- NULL and releases it, and only then does 8a re-insert the loser that owns it.
-- 8b only touches rows that currently exist, so running it before the losers
-- are back is correct rather than merely tolerable.
