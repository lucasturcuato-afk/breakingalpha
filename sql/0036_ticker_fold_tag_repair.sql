-- =====================================================================
-- 0036_ticker_fold_tag_repair.sql
--
-- HAND-APPLY. Additive only: one new table. No existing column is altered,
-- dropped or backfilled by this file, and nothing here writes to articles.
--
-- Backs tools/repair_ticker_fold_tags.py, the repair of articles.companies[]
-- entries that were authored by the BARE-TICKER fold against a ticker that has
-- since been cleared off the company row.
--
-- WHY. backend/ingest.py `_resolve_primary_to_canonical` resolves
-- primary_company through six surfaces; surface 4 is `companies.ticker`. An
-- article whose primary_company is a bare symbol ('RVMD') is folded onto
-- whichever single company row holds that symbol, and
-- `_fold_primary_into_companies` APPENDS that row's canonical name to
-- articles.companies[]. Where a row held a WRONG ticker, every article carrying
-- that symbol got that row's name stamped into its tags. Clearing the wrong
-- ticker fixed the fold going forward and did nothing to the tags already
-- written.
--
-- The live effect, measured 2026-09-02. 'Revolut' has ticker NULL and sec_cik
-- NULL and carries 71 tagged articles, 55 of which have primary_company 'RVMD'.
-- Their titles read 'RVMD Maintained by Oppenheimer -- Price Target Raised to
-- $260' and 'Oral Investigational Medicine for Pancreatic Cancer Is Accepted
-- for FDA Review'. Revolut's company page renders Revolution Medicines' news.
--
-- NOT THE SAME DEFECT AS sql/0035. That file repairs names the norm_v2 merge
-- DELETED, driven by public.norm_v2_merge_map() (loser -> survivor). 'Revolut'
-- is not a merge loser: it is a live, present, correct companies row that a
-- fold pointed at the wrong articles. There is no (loser, survivor) pair that
-- expresses this, and norm_v2_merge_map() cannot produce one. The APPLY path is
-- shared; the map is not.
--
-- MEASURED 2026-09-02, on companies 4,276 / articles ~198k:
--   articles whose primary_company is a bare ticker         18,671
--   backfill-ledger rows (public.articles_companies_backfill) 30,707
--     of which primary_company is a bare ticker              8,743
--     distinct (ticker, resolved_name) pairs                   725
--       SPARED, row still holds that ticker                    606
--       SPARED, a name surface reaches it without the ticker    60
--       SPARED, name is not a companies row at all              54
--       CONTAMINATED                                            43
--   articles the repair rewrites                                465
--     ledger-attested                                           429
--     live ingest, no ledger row                                 36
-- =====================================================================


-- =====================================================================
-- SECTION 0 -- INSPECT. Read-only. Run first.
-- =====================================================================

-- 0a. Does the table already exist, and does it hold a prior run?
--
--   SELECT to_regclass('public.articles_ticker_fold_repair') AS tbl;
--   SELECT run_id, count(*) AS rows, min(applied_at) AS started,
--          max(applied_at) AS finished
--     FROM public.articles_ticker_fold_repair
--    GROUP BY run_id ORDER BY started DESC;

-- 0b. The apply path this reuses. articles.companies is the only column it
--     writes. Created by sql/0029 section 1b; the 2026-09-02 run of
--     tools/repair_articles_companies.py is the evidence it works.
--
--   SELECT proname, pg_get_function_identity_arguments(oid)
--     FROM pg_proc WHERE proname = 'apply_companies_backfill';
--     EXPECT one row. If missing, apply sql/0029 section 1b first.

-- 0c. The evidence source. The repair is driven off this ledger, so an empty
--     or missing one means the tool has nothing to attest a fold with and will
--     plan zero changes rather than guess.
--
--   SELECT count(*) AS ledger_rows,
--          count(*) FILTER (WHERE primary_company ~ '^[A-Z]{1,5}(\.[A-Z])?$')
--            AS bare_ticker_folds
--     FROM public.articles_companies_backfill;
--     EXPECT ~30,707 and ~8,743.

-- 0d. NEVER run count(*) or Prefer: count=exact against public.articles. It
--     times out with SQLSTATE 57014. Every count in this file is either scoped
--     by an equality on primary_company or taken from a ledger.


-- =====================================================================
-- SECTION 1 -- the repair ledger.
--
-- Separate from public.articles_companies_repair on purpose, for the same
-- reason 0035 kept itself separate from 0029: the semantics differ and reusing
-- the table would force a lie into a column.
--
--   articles_companies_repair carries survivor_name NOT NULL, because every
--   merge repair HAS a survivor. This repair usually does not: 'RVMD' resolves
--   to no company at all today, so there is nothing to name as a survivor. The
--   driver here is a (ticker, name) pair, not a (loser, survivor) pair, and the
--   ticker is the column that makes a row explicable a year from now.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.articles_ticker_fold_repair (
  id               bigserial   PRIMARY KEY,
  -- One uuid per invocation. Lets you reverse exactly one run.
  run_id           uuid        NOT NULL,
  article_id       uuid        NOT NULL,

  -- The bare symbol that was in articles.primary_company and drove the fold.
  -- This is what makes the row self-explanatory: it names the surface-4 input
  -- without needing the companies row to still look the way it did.
  ticker           text        NOT NULL,
  -- The company name that was removed from articles.companies[].
  loser_name       text        NOT NULL,

  -- Full before/after of the array. `before` is what makes this reversible.
  -- `after` is stored so a reversal can verify it is undoing its own work
  -- rather than clobbering a later unrelated write.
  companies_before text[]      NOT NULL,
  companies_after  text[]      NOT NULL,

  applied_at       timestamptz NOT NULL DEFAULT now(),

  -- One row per (run, article, name). An article holding two contaminated
  -- names gets two rows in the same run, which is the honest record;
  -- re-running the same run_id is a no-op rather than a second append.
  CONSTRAINT articles_ticker_fold_repair_uniq UNIQUE (run_id, article_id, loser_name)
);

CREATE INDEX IF NOT EXISTS articles_ticker_fold_repair_run_idx
  ON public.articles_ticker_fold_repair (run_id, applied_at);
CREATE INDEX IF NOT EXISTS articles_ticker_fold_repair_article_idx
  ON public.articles_ticker_fold_repair (article_id);
CREATE INDEX IF NOT EXISTS articles_ticker_fold_repair_pair_idx
  ON public.articles_ticker_fold_repair (ticker, loser_name);

COMMENT ON TABLE public.articles_ticker_fold_repair IS
  'Per-row ledger for the bare-ticker fold tag repair '
  '(tools/repair_ticker_fold_tags.py). Records the exact before/after of every '
  'mutated row plus the ticker and the name that drove it. Reversal: see '
  'section 4. Written by the service role only; nothing in the pipeline reads '
  'it.';

ALTER TABLE public.articles_ticker_fold_repair ENABLE ROW LEVEL SECURITY;
-- No policies at all: an operator artifact. The service role bypasses RLS and
-- no anon or authenticated client has any business reading it.


-- =====================================================================
-- SECTION 2 -- PRE-APPLY GUARD. Run this BEFORE the tool, and read it.
--
-- Three questions, in order. Any answer that disagrees with the expectation
-- means the population has moved since 2026-09-02 and the plan must be
-- re-derived and re-reviewed before anything is written.
-- =====================================================================

-- 2a. THE OVER-REACH GUARD, as a query. These three pools were already correct
--     because they are NAME-driven rather than ticker-driven, and the repair
--     must not move them. Capture these numbers BEFORE and compare AFTER.
--
--   SELECT 'HP Inc.'    AS company, count(*) FROM public.articles WHERE companies @> ARRAY['HP Inc.']
--   UNION ALL SELECT 'HP Inc',      count(*) FROM public.articles WHERE companies @> ARRAY['HP Inc']
--   UNION ALL SELECT 'Vanguard',    count(*) FROM public.articles WHERE companies @> ARRAY['Vanguard']
--   UNION ALL SELECT 'ARK Invest',  count(*) FROM public.articles WHERE companies @> ARRAY['ARK Invest'];
--
--     BEFORE (2026-09-02)   AFTER (expected)
--       HP Inc.      104      104   unchanged, 0 removed
--       HP Inc       187      187   unchanged, 0 removed
--       Vanguard      70       67   3 removed, the AVD ticker folds only
--       ARK Invest    49       47   2 removed, the PNNT ticker folds only
--
--     'HP Inc' is the row that carries ticker HPQ and 124 of the ledger's
--     folds. It is the pool a careless repair destroys. If either HP number
--     moves by even one, STOP and reverse.

-- 2b. No contaminated pair may have REGAINED its ticker. If a row holds the
--     symbol again then the fold is live and correct once more, and removing
--     the tag would delete a true association rather than a false one. The
--     tool's classifier already refuses such a pair (KEEP_ROW_HOLDS_TICKER);
--     this is the same question asked independently of the tool.
--
--   SELECT c.name, c.ticker
--     FROM public.companies c
--    WHERE c.name IN ('Revolut','Ely','Hark','Motive','Ola','LIC','Accel',
--                     'Vanguard','ARK Invest','AXT Inc.','Also','Arbor','GHO',
--                     'Magna','Neuberger','ABC','Science Corp.','Avance','METR',
--                     'Factory','Archimed','NASA','Otro','Beyond','Roze','LTi',
--                     'Axcel','Senior','Craft','Providence','Hiro','Integrity',
--                     'NATO','GAC','Ardian','NPR','OMAH','Acer','TCL','APCO',
--                     'Keystone','TKE','AION')
--      AND c.ticker IS NOT NULL;
--     EXPECT 0 rows. Any row returned must be dropped from the plan.

-- 2c. The blast radius, independent of the tool. This counts articles the
--     repair will rewrite, using the same pair set, straight from SQL.
--
--   SELECT a.primary_company AS ticker, u.name AS loser, count(*) AS articles
--     FROM public.articles a
--     CROSS JOIN LATERAL unnest(a.companies) AS u(name)
--    WHERE a.primary_company ~ '^[A-Z]{1,5}(\.[A-Z])?$'
--      AND (a.primary_company, u.name) IN (
--            ('RVMD','Revolut'),('COSO','Also'),('CLH','Arbor'),('ARDX','Ely'),
--            ('WAB','GHO'),('MX','Magna'),('BAX','AXT Inc.'),('GETY','Neuberger'),
--            ('RSG','LIC'),('LH','ABC'),('XMTR','METR'),('GILD','Science Corp.'),
--            ('TBPH','Avance'),('ORLY','Motive'),('CAKE','Factory'),('SN','Hark'),
--            ('PLAB','Otro'),('ARCI','Archimed'),('SRZN','Roze'),('RNST','NASA'),
--            ('FBYD','Beyond'),('NSSC','APCO'),('ARX','Accel'),('KO','Ola'),
--            ('FCN','LTi'),('ACLS','Axcel'),('BKD','Senior'),('MCFT','Craft'),
--            ('NPAC','Providence'),('XRN','Hiro'),('AII','Integrity'),
--            ('STVN','NATO'),('GCT','GAC'),('GRDN','Ardian'),('NPO','NPR'),
--            ('BOC','OMAH'),('AVD','Vanguard'),('MAC','Acer'),('NTCL','TCL'),
--            ('FKYS','Keystone'),('PNNT','ARK Invest'),('SMTK','TKE'),
--            ('CDIX','AION'))
--    GROUP BY 1,2 ORDER BY 3 DESC;
--     EXPECT 43 rows summing to 465, led by RVMD/Revolut at 55.
--
--     The pair list above is a SNAPSHOT for verification only. The tool derives
--     its own list from public.articles_companies_backfill at run time and does
--     not read this file. If the two disagree, the tool is right and this
--     comment is stale; re-derive before writing.


-- =====================================================================
-- SECTION 3 -- APPLY. The tool does the writing, not this file.
-- =====================================================================
--
--   # 1. Dry run. Writes nothing. Prints the classification, the plan, and the
--   #    swap targets it is deliberately NOT applying.
--   python tools/repair_ticker_fold_tags.py --json /tmp/ticker-fold-plan.json
--
--   # 2. Read the PLAN block. Confirm against section 2c:
--   #      articles to rewrite : 465
--   #      pairs firing        : 43 of 43
--   #      KEPT                : 682 pairs, of which 60 name-surface-reaches-it
--   #    If "pairs firing" is 0, stop: the classifier spared everything, which
--   #    means either the repair already ran or the population moved.
--
--   # 3. Apply. batch 200 keeps each statement well inside the 180s timeout
--   #    apply_companies_backfill sets for itself.
--   python tools/repair_ticker_fold_tags.py --apply --batch 200
--
--   # 4. Record the run_id it prints. Section 4 needs it and nothing else does.
--
--   # A run interrupted part way is resumable and re-running is safe: the
--   # ledger is keyed on (run_id, article_id, loser_name) and the apply is
--   # guarded on companies = before, so an already-applied row is skipped as
--   # drift rather than rewritten.
--   python tools/repair_ticker_fold_tags.py --apply --resume


-- =====================================================================
-- SECTION 4 -- READ-BACK and REVERSAL. Read this before you run the repair,
-- not after.
-- =====================================================================
--
--   -- 4a. READ-BACK. The invariant the repair exists to establish: no article
--   --     whose primary_company is a bare ticker still carries a name that the
--   --     ticker fold wrongly stamped on it.
--   SELECT count(*) AS still_contaminated
--     FROM public.articles a
--     JOIN public.articles_ticker_fold_repair l ON l.article_id = a.id
--    WHERE l.run_id = '<run-uuid>'
--      AND a.companies @> ARRAY[l.loser_name]
--      AND a.primary_company = l.ticker;
--     EXPECT 0.
--
--   -- 4b. READ-BACK. The over-reach check from section 2a, run again. Compare
--   --     to the BEFORE numbers you captured. HP Inc. and HP Inc must be
--   --     IDENTICAL; Vanguard must be exactly 3 lower and ARK Invest exactly 2.
--   SELECT 'HP Inc.'    AS company, count(*) FROM public.articles WHERE companies @> ARRAY['HP Inc.']
--   UNION ALL SELECT 'HP Inc',      count(*) FROM public.articles WHERE companies @> ARRAY['HP Inc']
--   UNION ALL SELECT 'Vanguard',    count(*) FROM public.articles WHERE companies @> ARRAY['Vanguard']
--   UNION ALL SELECT 'ARK Invest',  count(*) FROM public.articles WHERE companies @> ARRAY['ARK Invest'];
--
--   -- 4c. READ-BACK. The page that motivated this. Revolut keeps its own 16
--   --     articles and loses the 55 that belong to Revolution Medicines.
--   SELECT count(*) AS revolut_articles
--     FROM public.articles WHERE companies @> ARRAY['Revolut'];
--     BEFORE 71, EXPECT 16.
--
--   -- 4d. How many rows of this run are still reversible?
--   WITH r AS (
--     SELECT l.id, l.companies_before, l.companies_after, a.companies AS now
--       FROM public.articles_ticker_fold_repair l
--       JOIN public.articles a ON a.id = l.article_id
--      WHERE l.run_id = '<run-uuid>'
--   )
--   SELECT count(*) FILTER (WHERE now IS NOT DISTINCT FROM companies_after) AS reversible,
--          count(*) FILTER (WHERE now IS DISTINCT FROM companies_after)     AS drifted
--     FROM r;
--
--   -- 4e. REVERSE. Guarded on companies = companies_after, so a row the
--   --     pipeline changed after the repair is SKIPPED rather than clobbered.
--   --     Descending ledger id: an article holding two names has two rows whose
--   --     before/after chain in sequence, and undoing them out of order leaves
--   --     the array in neither state, after which the guard skips both.
--   DO $$
--   DECLARE r record;
--   BEGIN
--     FOR r IN
--       SELECT id, article_id, companies_before, companies_after
--         FROM public.articles_ticker_fold_repair
--        WHERE run_id = '<run-uuid>'
--        ORDER BY id DESC
--     LOOP
--       UPDATE public.articles
--          SET companies = r.companies_before
--        WHERE id = r.article_id
--          AND companies IS NOT DISTINCT FROM r.companies_after;
--     END LOOP;
--   END;
--   $$;
--
--   -- 4f. Confirm nothing of that run is still applied:
--   SELECT count(*) FROM public.articles_ticker_fold_repair l
--     JOIN public.articles a ON a.id = l.article_id
--    WHERE l.run_id = '<run-uuid>'
--      AND a.companies IS NOT DISTINCT FROM l.companies_after;
--     EXPECT 0, or exactly the drifted count from 4d.
--
--   -- 4g. Then clear the ledger for that run so the tool can plan it again:
--   DELETE FROM public.articles_ticker_fold_repair WHERE run_id = '<run-uuid>';
--
--   -- 4h. SECOND LINE OF DEFENCE, if the ledger is ever lost. A full
--   --     before-state snapshot of articles.companies[] was captured
--   --     2026-09-02 at 22:34 local, BEFORE any of this ran:
--   --       scratchpad/articles_before.jsonl   199,960 rows
--   --                                          {id, companies, primary_company}
--   --       scratchpad/companies_before.jsonl    4,276 rows
--   --     It is the ONLY recoverable before-state for the whole table and it
--   --     is not in git. Copy it somewhere durable before applying anything.
--   --     The ledger in section 1 remains the primary reversal path: it is
--   --     guarded, scoped to one run, and cannot clobber a later pipeline
--   --     write. The snapshot is unguarded and restoring from it wholesale
--   --     would roll back every write since the capture, including #802's.


-- =====================================================================
-- SECTION 5 -- WHAT THIS DELIBERATELY DOES NOT DO.
-- =====================================================================
--
-- 5a. NO SWAPS. The repair REMOVES the stale name and never re-points the
--     article at the ticker's true owner. 42 of the 43 contaminated tickers
--     resolve to no company at all today, so there is nothing to swap to. One
--     does: BAX -> 'AXT Inc.' on 15 articles, where BAX resolves to
--     'BAXTER INTERNATIONAL'. Those 15 articles are Baxter's news sitting on
--     AXT Inc.'s page, and a swap would both clear AXT Inc. and give Baxter 15
--     true articles.
--
--     It is not applied here because removing a false tag asserts nothing while
--     adding a true one is still an assertion, and the two deserve separate
--     review. The tool PRINTS this pair on every dry run so it cannot be
--     forgotten. To act on it, after the main run:
--
--   -- Preview:
--   SELECT a.id, a.title, a.companies
--     FROM public.articles a
--    WHERE a.primary_company = 'BAX'
--      AND a.companies @> ARRAY['AXT Inc.'];
--     EXPECT 15 rows, every title beginning 'BAX'.
--
--     A swap is a separate hand-apply with its own ledger run and is NOT
--     drafted here. Removal alone already takes AXT Inc. from 27 tagged
--     articles to 12, all of which are genuinely about AXT Inc.
--
-- 5b. NOT THE EXTRACTOR ORPHANS. Names in companies[] that are not in
--     public.companies at all: 1,445 distinct names across 25,554 articles
--     ('NVIDIA', 'Visa', 'RTX', 'TSLA'). Those never came from the fold and
--     have no ticker behind them. sql/0035 section 4b owns that population.
--
-- 5c. NOT THE NAME-SURFACE MISFOLDS. The backfill ledger also records folds
--     driven by surfaces 3, 5 and 6 that look wrong, the clearest being
--     'Fidelity National Information Services Inc' -> 'Fidelity' (77 rows),
--     which puts FIS news on Fidelity Investments' page. Same shape of harm,
--     different cause, and the ticker guard in this tool cannot see them
--     because their primary_company is not a bare symbol. Filed, not fixed.
--
-- 5d. NOTHING FORWARD-LOOKING. The fold can no longer resolve these tickers,
--     because the tickers are gone from those rows. New articles do not
--     reproduce this. The defect is purely in the historical tags, which is
--     why this file writes no trigger, no constraint and no pipeline change.


-- =====================================================================
-- SECTION 6 -- THE TWO WIDER RULES THAT WERE REJECTED, AND WHAT THEY COST.
--
-- Both were measured on prod 2026-09-02 before this design was fixed. They are
-- recorded because "why is the repair only 465 rows" is the first question a
-- reviewer asks, and the answer is arithmetic rather than caution.
-- =====================================================================
--
-- 6a. REJECTED: "any foreign bare ticker". Take every (primary_company, name)
--     where the name is a companies row whose ticker differs and no name
--     surface reaches it, WITHOUT requiring a ledger row to attest the fold.
--
--       800 pairs / 1,893 tags, against this file's 43 pairs / 465 tags.
--
--     The extra 757 pairs / 1,428 tags are dominated by CORRECT co-mentions,
--     and not one of them is in a single-element array:
--       AMD  -> Nvidia            38 tags     TSMC -> Nvidia   22 tags
--       AMD  -> Microsoft         15 tags     AMD  -> Anthropic 14 tags
--       ASTS -> SpaceX            13 tags     BYD  -> Tesla    12 tags
--       RTX  -> Pratt & Whitney   12 tags     UPS  -> Amazon   10 tags
--     'Pratt & Whitney' is an RTX subsidiary. Applying this rule would delete
--     1,428 true associations to remove 465 false ones. It is strictly worse
--     than doing nothing.
--
-- 6b. REJECTED: "resolve the row that held the ticker, by name". Under this
--     rule the repair sweeps whichever companies row the symbol names today.
--     For 'HP' that reaches 'HP Inc' (ticker HPQ, cik 47217), whose 187 tagged
--     articles include 155 carrying primary_company 'HP'. All 155 are correct.
--     The cleared row was 'HP Inc.' WITH the period, a DIFFERENT row with the
--     same normalized key. Name-keying cannot tell the two apart.
--
--     This file never resolves "the row that held the ticker". It reads the
--     fold's own recorded OUTPUT from public.articles_companies_backfill and
--     matches on the exact (primary_company, name) pair. Verified: HP Inc. 104
--     -> 104 and HP Inc 187 -> 187, zero removed from either.
--
-- 6c. THE UNDER-REACH THIS ACCEPTS, stated so it is not discovered later.
--     Restricting 6a to single-element arrays (the cross-wire fingerprint)
--     gives 144 pairs / 593 tags. This file covers 43 pairs / 465 tags, 456 of
--     which are single-element. The difference is 101 pairs / 137 tags that
--     LOOK like cross-wires but have no ledger row attesting the fold, so
--     nothing distinguishes them from an extractor that simply found one
--     company. The largest are:
--       UGI  -> KKR        11 tags     CXMT -> Micron     6 tags
--       ATAI -> Eli Lilly   5 tags     IREN -> Dell       3 tags
--     KKR bid for UGI and Eli Lilly is an ATAI counterparty, so several of
--     these are probably correct. They are left alone. A tag is removed here
--     only when the backfill ledger proves the fold wrote it.
