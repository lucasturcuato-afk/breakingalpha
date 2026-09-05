-- =====================================================================
-- 0020_normalize_lookup_key_v2.sql
--
--   *** PROPOSAL. DO NOT RUN AS ONE SCRIPT. ***
--   *** RUN AT LEAST ONCE (2026-09-05 note): the destructive phase has been
--   *** executed. Evidence, read-only: articles_companies_repair, the ledger
--   *** of the post-merge name repair, is populated, and that repair only
--   *** exists because loser rows were deleted. norm_v2 itself is not
--   *** visible through PostgREST, so its ledger was not read directly.
--   *** Duplicates are re-accumulating under the v2 rule (dozens of clusters
--   *** measured over the full companies table on 2026-09-05, a third with a
--   *** member first seen in the prior two weeks), so this will run again.
--   *** The header read "NOT APPLIED" until this note.
--
-- Companion doc: docs/normalize-lookup-key-v2-design.md
--
-- Collapses duplicate company clusters created by normalize_lookup_key v1,
-- which folds unicode and lowercases but does not strip corporate suffixes
-- or punctuation. Measured on prod 2026-07-26: 677 duplicate clusters over
-- 1,779 of 4,865 company rows; 1,102 rows absorbed by a full merge.
--
-- The phases below are meant to be run ONE AT A TIME by a human, with
-- review between each. Phases 1-4 are non-destructive. Phase 6 is the only
-- destructive phase and it refuses to touch a cluster that has not been
-- explicitly approved in phase 5.
--
-- Ordering matters. Run the merge BEFORE cutting application code to v2.
-- Deploying v2 code against a v1-keyed table turns 2,172 alias lookups into
-- misses, and the miss path in backend/entity_resolver.py CREATES A COMPANY.
--
-- All work lives in schema `norm_v2` so the whole thing can be dropped.
-- =====================================================================


-- =====================================================================
-- PHASE 1  -- the v2 function. Pure addition, changes no behavior.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS norm_v2;

-- v1 half: byte-for-byte equivalent of backend/normalize.py.
-- Kept as its own function so a parity test can assert v1 output is
-- unchanged independently of the v2 rules.
CREATE OR REPLACE FUNCTION norm_v2.lookup_key_v1(s text)
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

-- v2: v1, then punctuation folding, then trailing corporate-suffix stripping.
CREATE OR REPLACE FUNCTION norm_v2.lookup_key_v2(s text)
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
  suffix constant text :=
    '\s+(inc|incorporated|corp|corporation|co|company|llc|ltd|limited'
    '|plc|sa|ag|nv|ab|holdings|group)$';
BEGIN
  base := norm_v2.lookup_key_v1(s);

  -- Step 2: delete dots and apostrophes outright, no space.
  --   'Inc.' -> 'inc', 'L.L.C.' -> 'llc', 'Moody''s' -> 'moodys'
  punct := regexp_replace(base, '[.''' || U&'\2019' || ']', '', 'g');

  -- Step 3: every other punctuation char becomes a space.
  --   'archer-daniels-midland' -> 'archer daniels midland', 'pg&e' -> 'pg e'
  punct := regexp_replace(punct, '[[:punct:]]', ' ', 'g');

  -- Step 4: collapse whitespace, trim.
  punct := btrim(regexp_replace(punct, '\s+', ' ', 'g'));

  -- Step 5: strip trailing suffix tokens, up to 3 passes.
  --   'kioxia holdings corp' -> 'kioxia holdings' -> 'kioxia'
  -- The leading \s+ means a single-token name that IS a suffix word
  -- ('Group') can never be emptied by this loop.
  out := punct;
  FOR i IN 1..3 LOOP
    prev := out;
    out := regexp_replace(out, suffix, '');
    EXIT WHEN out = prev;
  END LOOP;

  -- Step 6: empty guard. Never return '' when the input was non-empty.
  IF out = '' THEN
    RETURN punct;
  END IF;

  RETURN out;
END;
$$;

-- Sanity fixtures. Run and eyeball before going further.
-- Expected: every row returns t.
--
-- SELECT
--   norm_v2.lookup_key_v2('Caterpillar')            = 'caterpillar'            AS a,
--   norm_v2.lookup_key_v2('Caterpillar Inc')        = 'caterpillar'            AS b,
--   norm_v2.lookup_key_v2('Caterpillar Inc.')       = 'caterpillar'            AS c,
--   norm_v2.lookup_key_v2('Archer-Daniels-Midland') = 'archer daniels midland' AS d,
--   norm_v2.lookup_key_v2('Kioxia Holdings Corp.')  = 'kioxia'                 AS e,
--   norm_v2.lookup_key_v2('Est'||U&'\00E9'||'e Lauder') = 'est'||U&'\00E9'||'e lauder' AS f,
--   norm_v2.lookup_key_v2('Group')                  = 'group'                  AS g,
--   norm_v2.lookup_key_v2('Moody''s Analytics')     = 'moodys analytics'       AS h,
--   norm_v2.lookup_key_v2('BP p.l.c.')              = 'bp'                     AS i,
--   norm_v2.lookup_key_v2('  Tesla  ')              = 'tesla'                  AS j;


-- =====================================================================
-- PHASE 2  -- baseline snapshot + pre-state record. Non-destructive.
--
-- Idempotent: re-running replaces the snapshot only if no plan has been
-- approved yet. Once approvals exist, it refuses, so a re-run cannot
-- silently invalidate a review.
-- =====================================================================

CREATE TABLE IF NOT EXISTS norm_v2.run_ledger (
  phase        text PRIMARY KEY,
  ran_at       timestamptz NOT NULL DEFAULT now(),
  ran_by       text        NOT NULL DEFAULT current_user,
  notes        jsonb
);

DO $$
DECLARE
  approved_n bigint := 0;
BEGIN
  IF to_regclass('norm_v2.plan_cluster') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM norm_v2.plan_cluster WHERE approved'
      INTO approved_n;
  END IF;

  IF approved_n > 0 THEN
    RAISE EXCEPTION
      'norm_v2 phase 2 refused: % clusters already approved. '
      'Re-snapshotting would invalidate that review. '
      'Run PHASE 8 (rollback/reset) first if you really want to start over.',
      approved_n;
  END IF;
END;
$$;

DROP TABLE IF EXISTS norm_v2.snapshot_companies;
CREATE TABLE norm_v2.snapshot_companies AS
  SELECT * FROM public.companies;

DROP TABLE IF EXISTS norm_v2.snapshot_aliases;
CREATE TABLE norm_v2.snapshot_aliases AS
  SELECT * FROM public.aliases;

ALTER TABLE norm_v2.snapshot_companies ADD PRIMARY KEY (id);
ALTER TABLE norm_v2.snapshot_aliases   ADD PRIMARY KEY (id);

INSERT INTO norm_v2.run_ledger (phase, notes)
VALUES ('02_snapshot', jsonb_build_object(
  'companies', (SELECT count(*) FROM norm_v2.snapshot_companies),
  'aliases',   (SELECT count(*) FROM norm_v2.snapshot_aliases),
  -- recon values measured 2026-07-26; drift is expected (the pipeline runs
  -- daily) and is reported, not fatal, at this stage.
  'recon_companies', 4865,
  'recon_aliases',   5488
))
ON CONFLICT (phase) DO UPDATE
  SET ran_at = now(), ran_by = current_user, notes = EXCLUDED.notes;


-- =====================================================================
-- PHASE 3  -- quarantine. Rows that cannot be safely keyed at all.
-- Non-destructive: nothing is deleted, rows are copied out and excluded
-- from the plan.
-- =====================================================================

DROP TABLE IF EXISTS norm_v2.quarantine_company;
CREATE TABLE norm_v2.quarantine_company AS
SELECT
  c.id,
  c.name,
  c.ticker,
  c.sec_cik,
  c.mention_count,
  CASE
    WHEN c.name IS NULL                                THEN 'null_name'
    WHEN btrim(c.name) = ''                            THEN 'blank_name'
    WHEN norm_v2.lookup_key_v2(c.name) = ''            THEN 'keys_to_empty'
    WHEN length(norm_v2.lookup_key_v2(c.name)) = 1     THEN 'single_char_key'
    WHEN c.name ~ '[[:cntrl:]]'                        THEN 'control_chars'
  END AS reason
FROM public.companies c
WHERE c.name IS NULL
   OR btrim(c.name) = ''
   OR norm_v2.lookup_key_v2(c.name) = ''
   OR length(norm_v2.lookup_key_v2(c.name)) = 1
   OR c.name ~ '[[:cntrl:]]';

DROP TABLE IF EXISTS norm_v2.quarantine_alias;
CREATE TABLE norm_v2.quarantine_alias AS
SELECT
  a.id,
  a.surface_form,
  a.lookup_key,
  a.canonical_id,
  CASE
    WHEN a.lookup_key IS NULL                            THEN 'null_key'
    WHEN btrim(a.lookup_key) = ''                        THEN 'blank_key'
    WHEN norm_v2.lookup_key_v2(a.lookup_key) = ''        THEN 'keys_to_empty'
    WHEN a.canonical_id IS NULL                          THEN 'orphan_no_canonical'
    WHEN NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = a.canonical_id)
                                                         THEN 'orphan_dangling_canonical'
  END AS reason
FROM public.aliases a
WHERE a.lookup_key IS NULL
   OR btrim(a.lookup_key) = ''
   OR norm_v2.lookup_key_v2(a.lookup_key) = ''
   OR a.canonical_id IS NULL
   OR NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = a.canonical_id);

-- Review before continuing:
--   SELECT reason, count(*) FROM norm_v2.quarantine_company GROUP BY 1;
--   SELECT reason, count(*) FROM norm_v2.quarantine_alias   GROUP BY 1;
-- Expected on the 2026-07-26 data: zero rows in both (0 alias rows re-key
-- to empty). Any non-zero count is a genuine data defect to fix by hand.


-- =====================================================================
-- PHASE 4  -- build the plan. Non-destructive. This is the artifact a
-- human reviews cluster by cluster.
-- =====================================================================

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
  -- fingerprint of the row AS OF plan build. Phase 6 refuses to merge a
  -- cluster whose members changed after review.
  row_fingerprint text NOT NULL,
  PRIMARY KEY (new_key, company_id)
);

WITH keyed AS (
  SELECT
    c.id,
    c.name,
    c.ticker,
    c.sec_cik,
    c.sector,
    c.mention_count,
    c.first_seen,
    norm_v2.lookup_key_v1(c.name) AS old_key,
    norm_v2.lookup_key_v2(c.name) AS new_key
  FROM public.companies c
  WHERE NOT EXISTS (
    SELECT 1 FROM norm_v2.quarantine_company q WHERE q.id = c.id
  )
),
clusters AS (
  SELECT
    new_key,
    count(*) AS member_count,
    count(DISTINCT upper(btrim(ticker)))
      FILTER (WHERE ticker IS NOT NULL AND btrim(ticker) <> '') AS distinct_tickers,
    count(DISTINCT sec_cik) FILTER (WHERE sec_cik IS NOT NULL)  AS distinct_ciks,
    count(DISTINCT sector)  FILTER (WHERE sector IS NOT NULL)   AS distinct_sectors
  FROM keyed
  GROUP BY new_key
  HAVING count(*) > 1
),
ranked AS (
  SELECT
    k.*,
    row_number() OVER (
      PARTITION BY k.new_key
      -- survivor = most mentioned, then oldest, then stable by id
      ORDER BY coalesce(k.mention_count, 0) DESC, k.first_seen ASC NULLS LAST, k.id ASC
    ) AS rn
  FROM keyed k
  JOIN clusters cl USING (new_key)
)
INSERT INTO norm_v2.plan_cluster (
  new_key, member_count, survivor_id, survivor_name,
  distinct_tickers, distinct_ciks, distinct_sectors, risk, risk_reason
)
SELECT
  cl.new_key,
  cl.member_count,
  s.id,
  s.name,
  cl.distinct_tickers,
  cl.distinct_ciks,
  cl.distinct_sectors,
  CASE
    -- Hard identity conflict. Two CIKs or two tickers in one cluster means
    -- two real companies. This is what caught 'hp':
    --   HP Inc [HPQ, cik 47217] vs HP Inc. [HP, cik 46765 = Helmerich & Payne]
    WHEN cl.distinct_ciks > 1 OR cl.distinct_tickers > 1 THEN 'block'
    -- Short / acronym keys: highest collision probability.
    WHEN length(cl.new_key) <= 5 OR cl.new_key NOT LIKE '% %'          THEN 'review'
    -- Members disagree on sector: proxy for "not the same business".
    WHEN cl.distinct_sectors > 1                                        THEN 'review'
    ELSE 'auto'
  END,
  CASE
    WHEN cl.distinct_ciks > 1     THEN 'multiple distinct sec_cik in cluster'
    WHEN cl.distinct_tickers > 1  THEN 'multiple distinct ticker in cluster'
    WHEN length(cl.new_key) <= 5 OR cl.new_key NOT LIKE '% %'
                                  THEN 'short or single-token key, acronym collision risk'
    WHEN cl.distinct_sectors > 1  THEN 'members disagree on sector'
    ELSE NULL
  END
FROM clusters cl
JOIN ranked s ON s.new_key = cl.new_key AND s.rn = 1;

INSERT INTO norm_v2.plan_member (
  new_key, company_id, name, old_key, ticker, sec_cik, sector,
  mention_count, is_survivor, row_fingerprint
)
SELECT
  r.new_key,
  r.id,
  r.name,
  r.old_key,
  r.ticker,
  r.sec_cik,
  r.sector,
  r.mention_count,
  (r.rn = 1),
  md5(coalesce(r.name,'') || '|' || coalesce(r.ticker,'') || '|' ||
      coalesce(r.sec_cik::text,'') || '|' || coalesce(r.mention_count::text,''))
FROM (
  SELECT
    k.*,
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

-- Pre-seed the known-bad clusters from the design doc as hard blocks, so a
-- bulk approve cannot sweep them in. Cheap belt-and-braces on top of the
-- rule-based classifier above.
UPDATE norm_v2.plan_cluster
   SET risk = 'block',
       risk_reason = coalesce(risk_reason || '; ', '') || 'manually blocked, see design doc 6.2-6.4'
 WHERE new_key IN ('hp','bain','hg','eqt','genius','go','zip','cpb','x','tata');

INSERT INTO norm_v2.run_ledger (phase, notes)
VALUES ('04_plan', jsonb_build_object(
  'clusters',      (SELECT count(*) FROM norm_v2.plan_cluster),
  'rows_absorbed', (SELECT coalesce(sum(member_count - 1),0) FROM norm_v2.plan_cluster),
  'block',         (SELECT count(*) FROM norm_v2.plan_cluster WHERE risk='block'),
  'review',        (SELECT count(*) FROM norm_v2.plan_cluster WHERE risk='review'),
  'auto',          (SELECT count(*) FROM norm_v2.plan_cluster WHERE risk='auto')
))
ON CONFLICT (phase) DO UPDATE
  SET ran_at = now(), ran_by = current_user, notes = EXCLUDED.notes;

-- Expected on the 2026-07-26 data: 677 clusters, 1,102 rows absorbed.


-- =====================================================================
-- PHASE 5  -- human review. Nothing here runs automatically.
-- =====================================================================

-- Read the whole plan, worst first:
--
--   SELECT pc.new_key, pc.risk, pc.risk_reason, pc.member_count,
--          pc.survivor_name,
--          string_agg(pm.name || coalesce(' ['||pm.ticker||']','')
--                     || coalesce(' cik='||pm.sec_cik::text,'')
--                     || CASE WHEN pm.is_survivor THEN ' <== SURVIVOR' ELSE '' END,
--                     E'\n    ' ORDER BY pm.is_survivor DESC, pm.name) AS members
--     FROM norm_v2.plan_cluster pc
--     JOIN norm_v2.plan_member  pm USING (new_key)
--    GROUP BY 1,2,3,4,5
--    ORDER BY (pc.risk='block') DESC, (pc.risk='review') DESC, pc.member_count DESC;
--
-- Approve the safe bulk:
--
--   UPDATE norm_v2.plan_cluster
--      SET approved = true, approved_by = current_user, approved_at = now()
--    WHERE risk = 'auto';
--
-- Approve individual reviewed clusters:
--
--   UPDATE norm_v2.plan_cluster
--      SET approved = true, approved_by = current_user, approved_at = now()
--    WHERE new_key IN ('ubs','ig');
--
-- 'block' clusters cannot be approved -- phase 6 skips them regardless of
-- the flag. To force one through, change its risk to 'review' first, on
-- purpose, in a separate statement, with a note in the PR.


-- =====================================================================
-- PHASE 6  -- THE DESTRUCTIVE PHASE.
--
-- Merges approved, non-blocked clusters only. One cluster per call, so a
-- failure stops at a cluster boundary and everything already merged stays
-- consistent. Guarded on the row fingerprints captured in phase 4: if any
-- member changed since review, the cluster is refused.
--
-- Idempotent: a cluster with merged_at set is skipped.
-- =====================================================================

CREATE OR REPLACE FUNCTION norm_v2.merge_cluster(p_new_key text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  cl          norm_v2.plan_cluster%ROWTYPE;
  survivor    uuid;
  losers      uuid[];
  drifted     int;
  moved       jsonb := '{}'::jsonb;
  n           bigint;
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
      'built. Re-run PHASE 4 and re-review this cluster.', p_new_key, drifted;
  END IF;

  SELECT pm.company_id INTO survivor
    FROM norm_v2.plan_member pm
   WHERE pm.new_key = p_new_key AND pm.is_survivor;

  SELECT array_agg(pm.company_id) INTO losers
    FROM norm_v2.plan_member pm
   WHERE pm.new_key = p_new_key AND NOT pm.is_survivor;

  IF survivor IS NULL OR losers IS NULL OR array_length(losers,1) = 0 THEN
    RAISE EXCEPTION 'norm_v2.merge_cluster(%): degenerate cluster', p_new_key;
  END IF;

  -- ---- repoint dependents -------------------------------------------
  -- Constraint notes (verified against pg_index on 2026-07-26):
  --   company_mentions  : only pkey(id)            -> repoint is collision-free
  --   financial_facts   : uq(accession_number, concept_tag, period_start,
  --                          period_end, unit) -- no company_id -> collision-free
  --   insider_trans.    : uq(accession_number, insider_cik, transaction_date,
  --                          transaction_code) -- no company_id -> collision-free
  --   sec_filings       : uq(accession_number)     -> collision-free
  --   user_memo_quota   : pkey(user_id, company_id, regenerated_at) -- CONTAINS
  --                       company_id -> CAN collide, deduped below
  --   aliases           : uq(lookup_key, canonical_id) -- CONTAINS canonical_id
  --                       -> CAN collide, deduped below
  -- There are NO foreign keys on any of these. Nothing cascades. Repointing
  -- is entirely this function's responsibility.

  UPDATE public.company_mentions SET company_id = survivor
   WHERE company_id = ANY(losers);
  GET DIAGNOSTICS n = ROW_COUNT;
  moved := moved || jsonb_build_object('company_mentions', n);

  UPDATE public.financial_facts SET company_id = survivor
   WHERE company_id = ANY(losers);
  GET DIAGNOSTICS n = ROW_COUNT;
  moved := moved || jsonb_build_object('financial_facts', n);

  UPDATE public.insider_transactions SET company_id = survivor
   WHERE company_id = ANY(losers);
  GET DIAGNOSTICS n = ROW_COUNT;
  moved := moved || jsonb_build_object('insider_transactions', n);

  UPDATE public.sec_filings SET company_id = survivor
   WHERE company_id = ANY(losers);
  GET DIAGNOSTICS n = ROW_COUNT;
  moved := moved || jsonb_build_object('sec_filings', n);

  -- quota: drop loser rows that would collide on (user_id, company_id,
  -- regenerated_at), then repoint the rest.
  DELETE FROM public.user_memo_regeneration_quota q
   WHERE q.company_id = ANY(losers)
     AND EXISTS (
       SELECT 1 FROM public.user_memo_regeneration_quota k
        WHERE k.user_id = q.user_id
          AND k.company_id = survivor
          AND k.regenerated_at = q.regenerated_at
     );
  UPDATE public.user_memo_regeneration_quota SET company_id = survivor
   WHERE company_id = ANY(losers);
  GET DIAGNOSTICS n = ROW_COUNT;
  moved := moved || jsonb_build_object('user_memo_regeneration_quota', n);

  UPDATE public.resolution_log SET resolved_canonical_id = survivor
   WHERE resolved_canonical_id = ANY(losers);
  GET DIAGNOSTICS n = ROW_COUNT;
  moved := moved || jsonb_build_object('resolution_log', n);

  UPDATE public.user_events SET entity_id = survivor
   WHERE entity_id = ANY(losers);

  -- aliases: fold duplicates on (lookup_key, canonical_id) before repointing.
  -- Keep the highest mention_count of each colliding pair on the survivor.
  UPDATE public.aliases s
     SET mention_count = greatest(coalesce(s.mention_count,0), coalesce(l.mc,0)),
         last_seen_at  = greatest(s.last_seen_at, l.ls)
    FROM (
      SELECT lookup_key,
             max(coalesce(mention_count,0)) AS mc,
             max(last_seen_at)              AS ls
        FROM public.aliases
       WHERE canonical_id = ANY(losers)
       GROUP BY lookup_key
    ) l
   WHERE s.canonical_id = survivor AND s.lookup_key = l.lookup_key;

  DELETE FROM public.aliases a
   WHERE a.canonical_id = ANY(losers)
     AND EXISTS (
       SELECT 1 FROM public.aliases k
        WHERE k.canonical_id = survivor AND k.lookup_key = a.lookup_key
     );

  UPDATE public.aliases SET canonical_id = survivor
   WHERE canonical_id = ANY(losers);
  GET DIAGNOSTICS n = ROW_COUNT;
  moved := moved || jsonb_build_object('aliases', n);

  -- ---- fold the survivor's own fields --------------------------------
  -- mention_count sums. key_themes unions.
  -- ticker / sec_cik are DELIBERATELY NOT inherited from a loser: design
  -- doc 6.5 documents rows carrying provably wrong identity
  -- (AXT Inc. -> ticker BAX / cik 10456 = Baxter; xAI -> ticker XFLT).
  -- Promoting those onto a survivor would launder a bad ID into the
  -- canonical row.
  UPDATE public.companies c
     SET mention_count = sub.total_mentions,
         key_themes    = sub.themes,
         last_updated  = now()
    FROM (
      SELECT sum(coalesce(mention_count,0))                       AS total_mentions,
             (SELECT array_agg(DISTINCT t)
                FROM public.companies c2, unnest(coalesce(c2.key_themes,'{}')) t
               WHERE c2.id = survivor OR c2.id = ANY(losers))     AS themes
        FROM public.companies
       WHERE id = survivor OR id = ANY(losers)
    ) sub
   WHERE c.id = survivor;

  -- ---- drop the losers ------------------------------------------------
  DELETE FROM public.companies WHERE id = ANY(losers);

  UPDATE norm_v2.plan_cluster SET merged_at = now() WHERE new_key = p_new_key;

  RETURN jsonb_build_object(
    'new_key', p_new_key,
    'status', 'merged',
    'survivor', survivor,
    'losers', to_jsonb(losers),
    'rows_moved', moved
  );
END;
$$;

-- Driver. Run in batches so no single transaction holds a long lock on
-- financial_facts (1.44M rows). Each call is its own transaction when run
-- from psql with autocommit on.
--
--   SELECT norm_v2.merge_cluster(new_key)
--     FROM norm_v2.plan_cluster
--    WHERE approved AND risk <> 'block' AND merged_at IS NULL
--    ORDER BY member_count DESC
--    LIMIT 25;
--
-- Repeat until it returns zero rows.


-- =====================================================================
-- PHASE 7  -- re-key the surviving aliases to v2, and verify.
-- Run only after PHASE 6 has drained.
-- =====================================================================

-- Fold intra-canonical duplicates first. Without this, the UPDATE below
-- aborts: 518 alias rows collide on UNIQUE(lookup_key, canonical_id)
-- once keys are recomputed (measured 2026-07-26).
WITH folded AS (
  SELECT
    canonical_id,
    norm_v2.lookup_key_v2(lookup_key) AS nk,
    (array_agg(id ORDER BY coalesce(mention_count,0) DESC, id))[1] AS keep_id,
    sum(coalesce(mention_count,0)) AS total_mentions,
    max(last_seen_at)              AS ls
  FROM public.aliases
  WHERE NOT EXISTS (SELECT 1 FROM norm_v2.quarantine_alias q WHERE q.id = aliases.id)
  GROUP BY 1, 2
  HAVING count(*) > 1
)
UPDATE public.aliases a
   SET mention_count = f.total_mentions,
       last_seen_at  = f.ls
  FROM folded f
 WHERE a.id = f.keep_id;

DELETE FROM public.aliases a
USING (
  SELECT
    canonical_id,
    norm_v2.lookup_key_v2(lookup_key) AS nk,
    (array_agg(id ORDER BY coalesce(mention_count,0) DESC, id))[1] AS keep_id
  FROM public.aliases
  GROUP BY 1, 2
  HAVING count(*) > 1
) f
WHERE a.canonical_id = f.canonical_id
  AND norm_v2.lookup_key_v2(a.lookup_key) = f.nk
  AND a.id <> f.keep_id;

UPDATE public.aliases
   SET lookup_key = norm_v2.lookup_key_v2(lookup_key)
 WHERE lookup_key <> norm_v2.lookup_key_v2(lookup_key)
   AND NOT EXISTS (SELECT 1 FROM norm_v2.quarantine_alias q WHERE q.id = aliases.id);

-- Verification. Every row must return t.
--
--   SELECT
--     -- no key is still v1-shaped
--     NOT EXISTS (SELECT 1 FROM public.aliases
--                  WHERE lookup_key <> norm_v2.lookup_key_v2(lookup_key)) AS keys_are_v2,
--     -- no orphaned dependents
--     NOT EXISTS (SELECT 1 FROM public.aliases a
--                  WHERE NOT EXISTS (SELECT 1 FROM public.companies c
--                                     WHERE c.id = a.canonical_id))       AS no_orphan_aliases,
--     NOT EXISTS (SELECT 1 FROM public.company_mentions m
--                  WHERE m.company_id IS NOT NULL
--                    AND NOT EXISTS (SELECT 1 FROM public.companies c
--                                     WHERE c.id = m.company_id))         AS no_orphan_mentions,
--     NOT EXISTS (SELECT 1 FROM public.financial_facts f
--                  WHERE f.company_id IS NOT NULL
--                    AND NOT EXISTS (SELECT 1 FROM public.companies c
--                                     WHERE c.id = f.company_id))         AS no_orphan_facts,
--     -- no blocked cluster got merged
--     NOT EXISTS (SELECT 1 FROM norm_v2.plan_cluster
--                  WHERE risk='block' AND merged_at IS NOT NULL)          AS blocks_held,
--     -- mention_count conserved
--     (SELECT sum(mention_count) FROM public.companies)
--       = (SELECT sum(mention_count) FROM norm_v2.snapshot_companies)     AS mentions_conserved;

INSERT INTO norm_v2.run_ledger (phase, notes)
VALUES ('07_rekey', jsonb_build_object(
  'companies_after', (SELECT count(*) FROM public.companies),
  'aliases_after',   (SELECT count(*) FROM public.aliases)
))
ON CONFLICT (phase) DO UPDATE
  SET ran_at = now(), ran_by = current_user, notes = EXCLUDED.notes;


-- =====================================================================
-- PHASE 8  -- ROLLBACK.
--
-- Restores companies and aliases from the phase 2 snapshot and repoints
-- every dependent back to the pre-merge canonical.
--
-- LIMIT: this restores identity and structure. It does NOT undo memos or
-- briefs regenerated against the merged entity in the interim. That is why
-- the merge is gated on human approval rather than a rule alone.
-- =====================================================================

-- 8a. Restore deleted company rows.
INSERT INTO public.companies
SELECT s.* FROM norm_v2.snapshot_companies s
WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = s.id);

-- 8b. Restore mutated survivor fields.
UPDATE public.companies c
   SET name          = s.name,
       ticker        = s.ticker,
       sector        = s.sector,
       description   = s.description,
       first_seen    = s.first_seen,
       last_updated  = s.last_updated,
       mention_count = s.mention_count,
       sentiment_trend = s.sentiment_trend,
       key_themes    = s.key_themes,
       notes         = s.notes,
       sec_cik       = s.sec_cik
  FROM norm_v2.snapshot_companies s
 WHERE c.id = s.id AND c IS DISTINCT FROM s;

-- 8c. Restore aliases wholesale. Safe because the snapshot is the complete
-- pre-migration table and every alias id is stable.
DELETE FROM public.aliases a
 WHERE NOT EXISTS (SELECT 1 FROM norm_v2.snapshot_aliases s WHERE s.id = a.id);

INSERT INTO public.aliases
SELECT s.* FROM norm_v2.snapshot_aliases s
WHERE NOT EXISTS (SELECT 1 FROM public.aliases a WHERE a.id = s.id);

UPDATE public.aliases a
   SET surface_form  = s.surface_form,
       lookup_key    = s.lookup_key,
       canonical_id  = s.canonical_id,
       mention_count = s.mention_count,
       last_seen_at  = s.last_seen_at
  FROM norm_v2.snapshot_aliases s
 WHERE a.id = s.id AND a IS DISTINCT FROM s;

-- 8d. Repoint dependents back. Uses the plan tables to map survivor -> the
-- original owner of each row. Rows created AFTER the merge have no plan
-- entry and correctly stay on the survivor.
--
-- This requires a per-row provenance map that phase 6 does not currently
-- record. To make rollback exact, phase 6 must be extended to write
-- norm_v2.moved_row(table_name, row_id, from_company_id, to_company_id)
-- before each UPDATE. Until that exists, dependent rows repointed by a
-- merge CANNOT be restored to their original company, only the company
-- rows themselves can. TREAT PHASE 6 AS ONE-WAY FOR DEPENDENTS.
--
-- Decision for review: add the moved_row journal (adds ~1.5M rows for a
-- full financial_facts sweep), or accept dependent-repoint as one-way and
-- rely on the merge gate. Recommendation: add the journal for
-- company_mentions / sec_filings / insider_transactions (93k rows total,
-- cheap) and accept one-way for financial_facts.

-- 8e. Reset the plan so phase 4 can rebuild.
--   UPDATE norm_v2.plan_cluster
--      SET approved=false, approved_by=NULL, approved_at=NULL, merged_at=NULL;

-- 8f. Full teardown, leaves public untouched:
--   DROP SCHEMA norm_v2 CASCADE;
