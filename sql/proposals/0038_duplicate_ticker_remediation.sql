-- =====================================================================
-- 0038_duplicate_ticker_remediation.sql
--
--   *** PROPOSAL. NOT APPLIED. DO NOT RUN AS ONE SCRIPT. ***
--   *** Nothing in this file has been executed against any database. ***
--
-- Clears tickers that sit on the wrong `companies` row.
--
-- WHAT THIS FILE IS FOR, STATED NARROWLY. Eleven tickers are carried by more
-- than one companies row. There is NO UNIQUE INDEX behind `ticker`, so nothing
-- in the database refuses a second holder and nothing reports one. BLOCK 22d
-- is the only check that catches it.
--
-- WHAT THE DUPLICATE ACTUALLY DOES TODAY, MEASURED RATHER THAN ASSUMED.
-- The obvious hazard is that the duplicate decides which row a page resolves
-- to. ON THE COMPANY PAGE IT DOES NOT. Both resolvers rank a CIK-bearing row
-- ahead of a CIK-less one through the single shared rule in
-- src/lib/company-cik-preference.ts:
--     src/lib/data-access/aliasResolver.ts  rankCluster   -> compareCikFirst
--     src/lib/sec-filings.ts:300            pickPreferCik -> preferCik
-- so on every one of the eleven the page already lands on the CIK-bearing row,
-- and where no row has a CIK it lands on the higher-mention one. The resolver
-- chain was CALLED against prod for every slug in both URL spaces before a
-- line of this file was written; nothing here is reasoned from the code alone.
--
-- THAT IS NOT THE SAME AS SAYING THE PAGES ARE RIGHT. Three of them land on a
-- CIK-bearing row that belongs to a DIFFERENT COMPANY, which is why BLOCKS 02
-- to 06 exist and why the QUARANTINE section at the bottom exists. "The
-- resolver picks the CIK row" and "the CIK row is the right company" are two
-- claims and only the first one was measured here.
--
-- THE DUPLICATE DOES REAL DAMAGE SOMEWHERE ELSE, and it is worth naming
-- because it is the reason to do this at all:
--   src/app/api/radar/follows/route.ts:93-98
--     .eq("ticker", row.target).limit(1).maybeSingle()  -- NO ORDER BY
--     A ticker follow takes its display_name from whichever of the duplicate
--     rows Postgres hands back. For NCLH that is as likely to be the string
--     "NCLH" as "Norwegian Cruise Line".
--   src/app/radar/calls/page.tsx:226-233
--     .in("ticker", symbols) then sectorByTicker[row.ticker] = row.sector,
--     so the LAST row read wins and the sector shown can be the duplicate's.
-- Neither is fixed by SQL alone; both stop being reachable once a ticker has
-- exactly one holder.
--
-- ============ THE DIRECTION THAT MATTERS AND IS EASY TO GET WRONG ============
--
-- CLEARING A TICKER IS NOT FREE, BECAUSE THE TICKER IS THE ONLY CLUSTERING KEY
-- resolveAlias HAS. aliasResolver.ts:305-316:
--
--     let cluster = [anchor];
--     if (ticker) { ...refetch every row with this ticker... }
--     const ranked = rankCluster(cluster);
--
-- With `anchor.ticker` null the cluster is `[anchor]` and the anchor IS the
-- head. So clearing a ticker off a row that a slug can still reach BY NAME
-- strands that slug on the CIK-less row: the page loses its CIK, its filings,
-- its financials, its insider rows, and prints Private over a public company.
--
-- The alias table does not rescue it. Every one of these junk rows owns an
-- `aliases` row whose `canonical_id` IS ITSELF, so resolveCompanyCik step 4
-- resolves the surface form straight back to the CIK-less row.
--
-- THAT SPLITS THE ELEVEN INTO THREE KINDS, and only two of them belong in a
-- ticker-clearing file:
--
--   MIS-STAMP    the row is a DIFFERENT COMPANY from the ticker's issuer.
--                Clearing is unambiguously right and the page it moves is a
--                page that is wrong today. BLOCKS 02 to 06.
--   BAD SYMBOL   the ticker belongs to NEITHER row. Retire it from both.
--                BLOCK 07 and BLOCK 08.
--   SAME ENTITY  one company, two surface forms. Clearing removes the
--                duplicate but ORPHANS a mention-bearing row and shrinks the
--                cluster the surviving page reads. Head-safe cases are
--                BLOCKS 09 to 11; the rest are HELD, see the HOLD section.
--
-- A SAME-ENTITY duplicate is a MERGE, not a ticker clear. sql/proposals/0020
-- owns that question and can repoint the alias and the dependent rows. This
-- file deliberately does not.
--
-- CONSTRAINT DIRECTION ANALYSIS. `companies` carries four unique things
-- (enumerated in backend/company_conflict.py lines 9-12):
--   companies_name_key         UNIQUE (name)
--       `name` is never written here. Cannot fire.
--   companies_name_no_junk     CHECK (lower(trim(name)) NOT IN (...))
--       `name` is never written here. Cannot fire.
--   companies_sec_cik_unique   UNIQUE (sec_cik) WHERE sec_cik IS NOT NULL
--       `sec_cik` is never written here. Cannot fire.
--   companies_name_norm_unique UNIQUE (lower(btrim(name))) WHERE sec_cik IS NULL
--       Membership is keyed on `sec_cik IS NULL`. This file never writes
--       `sec_cik`, so no row enters or leaves this index. Cannot fire.
--   ticker                     NO UNIQUE INDEX AT ALL.
--
-- SO NO BLOCK IN THIS FILE CAN RAISE 23505. That is the one structural
-- difference from 0029, whose every block entered companies_sec_cik_unique.
-- The hazard here is not a constraint, it is CORRECTNESS: a clear that strands
-- a slug fails silently and renders a plausible wrong page.
--
-- THE ONE INVARIANT THIS FILE COULD BREAK, AND THE GUARD THAT STOPS IT.
-- `sec_cik IS NOT NULL AND ticker IS NULL` is 0 in prod and is load-bearing:
-- src/lib/sec-filings.ts:121-122 relies on "every CIK-bearing companies row
-- carries a ticker". Clearing a ticker off a CIK-bearing row would break it.
-- Every target row carries `sec_cik IS NULL` today, and EVERY BLOCK REFUSES if
-- its row has acquired a CIK since analysis. That guard is not decoration; the
-- daily pipeline stamps CIKs (backend/edgar/cik_mapping.py:194) and joins on
-- ticker to do it.
--
-- ================== HOW TO APPLY. READ THIS BEFORE PASTING. =================
--
-- THE SUPABASE SQL EDITOR WRAPS THE WHOLE PASTE IN ONE TRANSACTION AND IGNORES
-- INNER BEGIN/COMMIT. Proved on 0029: five separate blocks produced five
-- journal rows with identical now() to the microsecond. The consequences are
-- not cosmetic:
--
--   1. A BATCH IS ATOMIC. One block's RAISE EXCEPTION rolls back every other
--      block in the same paste, including their journal rows.
--   2. A READ-BACK INSIDE A PASTE IS NOT DURABLE. It shows uncommitted state.
--      It only becomes true when the paste as a whole commits.
--   3. BLOCK 01 MUST BE ITS OWN PASTE, COMMITTED FIRST. It creates the partial
--      unique index that makes every later block idempotent. If it shares a
--      paste with a block that refuses, the index rolls back too and the retry
--      runs with no idempotence guard.
--   4. BLOCK 22 MUST BE ITS OWN PASTE, RUN AFTER. Inside the work paste it
--      would read uncommitted rows.
--
-- RECOMMENDED PASTE SEQUENCE. Each line is one paste, in order:
--      BLOCK 00                    (read-only pre-flight)
--      BLOCK 01                    (journal index)
--      BLOCK 02 .. BLOCK 06        (BATCH 1, mis-stamps)
--      BLOCK 22                    (read-only, confirm)
--      BLOCK 07 + BLOCK 08         (BATCH 2, retire EP PR C; PASTE TOGETHER,
--                                   see the note on BLOCK 08)
--      BLOCK 22                    (read-only, confirm)
--      BLOCK 09 .. BLOCK 11        (BATCH 3, same-entity, head-safe)
--      BLOCK 22                    (read-only, confirm)
--
-- Pasting a single block at a time is also correct and is strictly safer. The
-- batches above are the largest groups whose members share one decision.
--
-- Re-running an applied block is a NO-OP that raises a notice. Running a block
-- against a row that has drifted RAISES and rolls back the paste it is in.
-- =====================================================================


-- =====================================================================
-- BLOCK 00  -- PRE-FLIGHT. Read-only. Changes nothing. Run it first.
-- =====================================================================
BEGIN;

-- 00a. The four unique things, read live. A partial unique index carries no
-- pg_constraint row, so read pg_indexes too or two of the four report absent.
-- EXPECT: companies_name_key, companies_name_no_junk, companies_sec_cik_unique,
-- companies_name_norm_unique. EXPECT NO UNIQUE INDEX ON `ticker`; if one has
-- appeared since this file was written, stop and re-read this file, because
-- its "cannot raise 23505" argument no longer holds.
SELECT 'constraint' AS kind, conname AS name, pg_get_constraintdef(oid) AS def
  FROM pg_constraint WHERE conrelid = 'public.companies'::regclass
UNION ALL
SELECT 'index', indexname, indexdef
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'companies'
ORDER BY 1, 2;

-- 00b. THE JOURNAL MUST ALREADY EXIST WITH THE SHAPE THIS FILE WRITES.
-- norm_v2 is NOT exposed through PostgREST ("Only the following schemas are
-- exposed: public, graphql_public"), so this could not be verified from the
-- application side and is asserted here instead. RAISES if it is wrong.
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

-- 00c. What the journal already holds, by op. 0029's rows are op
-- 'stamp_identity'. This file writes op 'clear_ticker' and MUST NOT disturb
-- them; see the note in BLOCK 01.
SELECT op, count(*) AS rows, min(ran_at) AS first_at, max(ran_at) AS last_at
  FROM norm_v2.stamped_identity
 GROUP BY op ORDER BY op;

-- 00d. The load-bearing invariant, BEFORE. EXPECT cik_without_ticker = 0.
SELECT count(*) FILTER (WHERE ticker IS NOT NULL)                     AS with_ticker,
       count(*) FILTER (WHERE sec_cik IS NOT NULL)                    AS with_cik,
       count(*) FILTER (WHERE sec_cik IS NOT NULL AND ticker IS NULL) AS cik_without_ticker
  FROM public.companies;

-- 00e. Every duplicate ticker and every row holding one, which is the working
-- set this whole file is about. Read it and compare it against the file's
-- block headers before applying anything.
SELECT upper(btrim(c.ticker)) AS t, c.id, c.name, c.ticker, c.sec_cik, c.mention_count
  FROM public.companies c
  JOIN (SELECT upper(btrim(ticker)) AS t FROM public.companies
         WHERE ticker IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d
    ON d.t = upper(btrim(c.ticker))
 ORDER BY 1, c.mention_count DESC NULLS LAST;

-- 00f. NOTHING THIS FILE TOUCHES CAN CASCADE. No trigger on companies, and the
-- only foreign keys into companies point AT it. Clearing a ticker changes no
-- key any child row references. EXPECT zero triggers.
SELECT tgname, pg_get_triggerdef(oid)
  FROM pg_trigger
 WHERE tgrelid = 'public.companies'::regclass AND NOT tgisinternal;

COMMIT;


-- =====================================================================
-- BLOCK 01  -- THE JOURNAL GUARD. Idempotent. PASTE THIS ALONE AND COMMIT IT
--               BEFORE ANY WORK BLOCK.
--
-- ===================== THE `op` DECISION, IN FULL =====================
--
-- THE QUESTION. norm_v2.stamped_identity already carries a PARTIAL UNIQUE
-- INDEX, `stamped_identity_stamp_once ON (table_name, row_id, op) WHERE
-- op = 'stamp_identity'`. That index is not theoretical: a 0029 batch was
-- re-run, it refused five duplicate journal rows, and the journal stayed at 20
-- instead of 25. Without it the second journal row's `before` would have held
-- the ALREADY-STAMPED state and the rollback would have restored the wrong
-- thing. Most of this file CLEARS a ticker rather than STAMPING an identity.
-- Reusing op = 'stamp_identity' inherits that index for free but names the
-- operation falsely. Using a new op names it truthfully and LOSES THE INDEX,
-- which is the exact failure the index exists to prevent.
--
-- THE ANSWER: A NEW OP, `clear_ticker`, PLUS A SECOND PARTIAL UNIQUE INDEX.
-- Three reasons, and the second one is decisive on its own.
--
--   1. The op is the only field that says what happened. A journal whose op
--      lies is not a record, and the reversal procedures genuinely differ:
--      0029's restores TWO columns from `before`, this one restores ONE.
--
--   2. *** 0029's BLOCK 99 IS SCOPED BY `op = 'stamp_identity'` AND WOULD
--      SWEEP THESE ROWS INTO ITS REVERSAL. *** It runs
--        UPDATE public.companies SET ticker = (j.before->>'ticker'),
--               sec_cik = (j.before->>'sec_cik')::bigint
--          FROM norm_v2.stamped_identity j
--         WHERE j.op = 'stamp_identity' AND c.id = j.row_id AND ...
--      followed by DELETE ... WHERE op = 'stamp_identity'. Sharing the op
--      would make a full 0029 rollback silently re-apply every ticker this
--      file cleared and WRITE sec_cik on rows this file never touched. That is
--      a correctness fault, not a naming preference, and it settles the
--      question by itself.
--
--   3. A new op with no index is strictly worse than either alternative. So
--      the index comes with it. YES, A SECOND PARTIAL INDEX IS NEEDED, AND
--      HERE IT IS.
--
-- WHY PARTIAL AND NOT ONE UNCONDITIONAL UNIQUE ON (table_name, row_id, op).
-- An unconditional index would cover both ops and read more simply. It is
-- rejected because creating it means DROPPING a live index that has already
-- refused real rows, and a CREATE UNIQUE INDEX over existing data can fail on
-- rows nobody has enumerated. Adding one index next to another cannot fail
-- that way, and the two are independent: neither can refuse the other's rows.
--
-- WHAT THE INDEX BUYS, CONCRETELY. Re-run an applied block and the DO block
-- returns at its already-applied NOTICE before reaching the INSERT, so the
-- index is a backstop rather than the first line of defence. It catches the
-- case the NOTICE cannot: a hand-edited or partially-applied block that
-- reaches the INSERT twice. The second INSERT would carry `before.ticker =
-- null`, and BLOCK 99 would then restore NULL over the original ticker and
-- lose it permanently.
-- =====================================================================
BEGIN;

-- Creates nothing that exists. Fails loudly if the table is absent, which
-- BLOCK 00b has already checked.
CREATE UNIQUE INDEX IF NOT EXISTS stamped_identity_clear_once
    ON norm_v2.stamped_identity (table_name, row_id, op)
 WHERE op = 'clear_ticker';

COMMENT ON INDEX norm_v2.stamped_identity_clear_once IS
  'One journal row per (table, row) for op = ''clear_ticker''. Sibling of '
  'stamped_identity_stamp_once and deliberately separate from it: a '
  'clear_ticker reversal restores ONE column (ticker) from `before`, a '
  'stamp_identity reversal restores TWO (ticker and sec_cik). 0029 BLOCK 99 '
  'is scoped by op = ''stamp_identity'' and must never reach these rows.';

-- Read it back. EXPECT both indexes present.
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'norm_v2' AND tablename = 'stamped_identity'
 ORDER BY indexname;

COMMIT;


-- #####################################################################
-- ##  BATCH 1  --  MIS-STAMP. The row is a DIFFERENT COMPANY from the
-- ##               ticker's issuer. Clearing is unambiguously right.
-- ##               BLOCKS 02 to 06. Safe to paste as one batch.
-- #####################################################################

-- ---------------------------------------------------------------------
-- BLOCK 02  Kingswood  --  clear ticker BCG
--
--   SEC: BCG is cik 1953984, "Binah Capital Group, Inc." (Nasdaq: BCG and
--   BCGWW), confirmed against company_tickers.json AND the submissions API.
--   "Kingswood" is not in the SEC ticker file under any symbol.
--   The coverage filed under the Kingswood row is about Kingswood Capital
--   Management buying a poultry processor. That is not Binah Capital Group.
--
--   TODAY: /company/kingswood renders the heading "BCG" over Binah Capital
--   Group's CIK, because the shared ticker puts Kingswood in BCG's cluster and
--   rankCluster promotes the CIK-bearing row. Measured against prod.
--   AFTER: /company/kingswood renders "Kingswood" with no CIK, which is the
--   honest state for a row with no SEC identity.
--   DISPLAYED NAME CHANGES: yes, "BCG" -> "Kingswood", and that is the fix.
--
--   THIS IS THE #843 SHAPE. See the QUARANTINE section at the bottom: the row
--   named "BCG" is itself contested and is NOT touched by this block.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := 'b2edf8d5-d59b-49de-aa5b-2dda000fd126'::uuid;
  v_name    text := 'Kingswood';
  v_ticker  text := 'BCG';
  r         public.companies%ROWTYPE;
  v_others  int;
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
  IF r.ticker IS NULL THEN
    RAISE NOTICE 'BLOCK 02: already applied to % (ticker already NULL). No-op.', v_name;
    RETURN;
  END IF;

  -- Any other prior state is drift, and drift refuses.
  IF upper(btrim(r.ticker)) IS DISTINCT FROM upper(btrim(v_ticker)) THEN
    RAISE EXCEPTION 'BLOCK 02: % carries ticker % , expected %. REFUSING.', v_name, r.ticker, v_ticker;
  END IF;

  -- THE INVARIANT GUARD. `sec_cik NOT NULL AND ticker IS NULL` is 0 in prod
  -- and src/lib/sec-filings.ts:121-122 depends on it. If this row has acquired
  -- a CIK since analysis, clearing its ticker breaks that invariant.
  IF r.sec_cik IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 02: % now carries sec_cik %. Clearing the ticker would leave a CIK-bearing row with a NULL ticker. REFUSING.', v_name, r.sec_cik;
  END IF;

  -- COLLISION RE-CHECK, DONE HERE RATHER THAN TRUSTED FROM ANALYSIS TIME,
  -- because prod drifts hourly. The ticker must still have another holder;
  -- clearing the last holder would retire a live symbol, which is BLOCK 07/08's
  -- deliberate shape and is NOT this block's.
  SELECT count(*) INTO v_others FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_others = 0 THEN
    RAISE EXCEPTION 'BLOCK 02: % is the ONLY holder of %. Clearing it strands the symbol. REFUSING.', v_name, v_ticker;
  END IF;

  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'clear_ticker',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', NULL::text, 'sec_cik', r.sec_cik),
          format('0038 block 02: clear %s off %s (mis-stamp; %s belongs to cik 1953984 Binah Capital Group)', v_ticker, v_name, v_ticker));

  UPDATE public.companies
     SET ticker = NULL
   WHERE id = v_id AND name = v_name
     AND upper(btrim(ticker)) = upper(btrim(v_ticker))
     AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 02: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. EXPECT one row, ticker NULL, and other_holders = 1 (the row
-- named BCG). Durable only once this paste commits.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.companies o
         WHERE upper(btrim(o.ticker)) = 'BCG' AND o.id <> c.id) AS other_holders
  FROM public.companies c
 WHERE c.id = 'b2edf8d5-d59b-49de-aa5b-2dda000fd126'::uuid;

COMMIT;

-- ROLLBACK for block 02 only. Pinned to the journalled before-state and to the
-- current NULL, so it refuses if anything else has written the row since.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker = (j.before->>'ticker')
--   FROM norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'clear_ticker'
--    AND j.row_id = 'b2edf8d5-d59b-49de-aa5b-2dda000fd126'::uuid AND c.id = j.row_id
--    AND c.ticker IS NULL;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'clear_ticker'
--    AND row_id = 'b2edf8d5-d59b-49de-aa5b-2dda000fd126'::uuid;
-- COMMIT;


-- ---------------------------------------------------------------------
-- BLOCK 03  Trump  --  clear ticker DJT
--
--   SEC: DJT is cik 1849635, "Trump Media & Technology Group Corp." The row
--   named "Trump Media" already holds that CIK and the larger share of the
--   mentions. The coverage filed under the row named "Trump" is about Donald
--   Trump the office-holder: tariffs, Venezuelan oil, a portfolio disclosure.
--   None of it is about the issuer.
--
--   TODAY: /company/trump renders "Trump Media" over cik 1849635, and the
--   politician's articles feed that company's cluster.
--   AFTER: /company/trump renders "Trump" with no CIK.
--   DISPLAYED NAME CHANGES: yes, on /company/trump only, and that is the fix.
--   /company/djt and /company/trump-media are unchanged; measured.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := '3f0afef0-09c0-4fb9-8d7d-239fbf573840'::uuid;
  v_name    text := 'Trump';
  v_ticker  text := 'DJT';
  r         public.companies%ROWTYPE;
  v_others  int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 03: row % is gone. REFUSING.', v_id;
  END IF;

  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 03: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  IF r.ticker IS NULL THEN
    RAISE NOTICE 'BLOCK 03: already applied to % (ticker already NULL). No-op.', v_name;
    RETURN;
  END IF;

  IF upper(btrim(r.ticker)) IS DISTINCT FROM upper(btrim(v_ticker)) THEN
    RAISE EXCEPTION 'BLOCK 03: % carries ticker % , expected %. REFUSING.', v_name, r.ticker, v_ticker;
  END IF;

  IF r.sec_cik IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 03: % now carries sec_cik %. Clearing the ticker would leave a CIK-bearing row with a NULL ticker. REFUSING.', v_name, r.sec_cik;
  END IF;

  SELECT count(*) INTO v_others FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_others = 0 THEN
    RAISE EXCEPTION 'BLOCK 03: % is the ONLY holder of %. Clearing it strands the symbol. REFUSING.', v_name, v_ticker;
  END IF;

  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'clear_ticker',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', NULL::text, 'sec_cik', r.sec_cik),
          format('0038 block 03: clear %s off %s (mis-stamp; the person, not the issuer at cik 1849635)', v_ticker, v_name));

  UPDATE public.companies
     SET ticker = NULL
   WHERE id = v_id AND name = v_name
     AND upper(btrim(ticker)) = upper(btrim(v_ticker))
     AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 03: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. EXPECT ticker NULL and other_holders = 1 ("Trump Media").
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.companies o
         WHERE upper(btrim(o.ticker)) = 'DJT' AND o.id <> c.id) AS other_holders
  FROM public.companies c
 WHERE c.id = '3f0afef0-09c0-4fb9-8d7d-239fbf573840'::uuid;

COMMIT;

-- ROLLBACK for block 03 only.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker = (j.before->>'ticker')
--   FROM norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'clear_ticker'
--    AND j.row_id = '3f0afef0-09c0-4fb9-8d7d-239fbf573840'::uuid AND c.id = j.row_id
--    AND c.ticker IS NULL;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'clear_ticker'
--    AND row_id = '3f0afef0-09c0-4fb9-8d7d-239fbf573840'::uuid;
-- COMMIT;


-- ---------------------------------------------------------------------
-- BLOCK 04  CHAMP  --  clear ticker CHX
--
--   The coverage filed under the row named "CHAMP" is about an athlete
--   branding firm named CHAMP formed by L Catterton and Patricof. It is not
--   ChampionX.
--   NEITHER row in this pair holds a CIK, so nothing is being routed to SEC
--   data either way. This block removes a duplicate and a wrong association.
--
--   SEC NOTE, AND IT IS NOT A REASON TO STAMP ANYTHING. CHX is NOT in SEC's
--   company_tickers.json. ChampionX Corp is cik 1723089 and its submissions
--   record shows tickers [] and exchanges [], i.e. no longer listed. Whether
--   the "ChampionX" row should be stamped with 1723089 is a separate decision
--   for a human and is NOT taken here.
--
--   TODAY: /company/champ renders "ChampionX" over ChampionX's coverage.
--   AFTER: /company/champ renders "CHAMP" over its own.
--   DISPLAYED NAME CHANGES: yes, on /company/champ only, and that is the fix.
--   /company/chx and /company/championx are unchanged; measured.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := 'ee97ad79-b471-4874-b432-b827b9b6043f'::uuid;
  v_name    text := 'CHAMP';
  v_ticker  text := 'CHX';
  r         public.companies%ROWTYPE;
  v_others  int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 04: row % is gone. REFUSING.', v_id;
  END IF;

  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 04: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  IF r.ticker IS NULL THEN
    RAISE NOTICE 'BLOCK 04: already applied to % (ticker already NULL). No-op.', v_name;
    RETURN;
  END IF;

  IF upper(btrim(r.ticker)) IS DISTINCT FROM upper(btrim(v_ticker)) THEN
    RAISE EXCEPTION 'BLOCK 04: % carries ticker % , expected %. REFUSING.', v_name, r.ticker, v_ticker;
  END IF;

  IF r.sec_cik IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 04: % now carries sec_cik %. Clearing the ticker would leave a CIK-bearing row with a NULL ticker. REFUSING.', v_name, r.sec_cik;
  END IF;

  SELECT count(*) INTO v_others FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_others = 0 THEN
    RAISE EXCEPTION 'BLOCK 04: % is the ONLY holder of %. Clearing it strands the symbol. REFUSING.', v_name, v_ticker;
  END IF;

  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'clear_ticker',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', NULL::text, 'sec_cik', r.sec_cik),
          format('0038 block 04: clear %s off %s (mis-stamp; an athlete branding firm, not ChampionX)', v_ticker, v_name));

  UPDATE public.companies
     SET ticker = NULL
   WHERE id = v_id AND name = v_name
     AND upper(btrim(ticker)) = upper(btrim(v_ticker))
     AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 04: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. EXPECT ticker NULL and other_holders = 1 ("ChampionX").
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.companies o
         WHERE upper(btrim(o.ticker)) = 'CHX' AND o.id <> c.id) AS other_holders
  FROM public.companies c
 WHERE c.id = 'ee97ad79-b471-4874-b432-b827b9b6043f'::uuid;

COMMIT;

-- ROLLBACK for block 04 only.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker = (j.before->>'ticker')
--   FROM norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'clear_ticker'
--    AND j.row_id = 'ee97ad79-b471-4874-b432-b827b9b6043f'::uuid AND c.id = j.row_id
--    AND c.ticker IS NULL;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'clear_ticker'
--    AND row_id = 'ee97ad79-b471-4874-b432-b827b9b6043f'::uuid;
-- COMMIT;


-- ---------------------------------------------------------------------
-- BLOCK 05  Bain  --  clear ticker BCSF
--
--   *** THE ANSWER TO "ARE Bain Capital AND Bain Capital Insurance THE SAME
--   ENTITY". NO. AND NEITHER IS THE ISSUER. ***
--
--   SEC: BCSF is cik 1655050, "Bain Capital Specialty Finance, Inc." (NYSE),
--   formerly "Sankaty Capital Corp". A publicly traded BDC. Confirmed against
--   company_tickers.json and the submissions API.
--
--   The BCSF ticker sits on THREE rows and they are FOUR different things:
--     "Bain"                    ambiguous. Its articles mix Bain & Company the
--                               consultancy ("dealmaking rebounds: Bain"),
--                               Bain Capital the PE firm, and one BCSF result.
--     "Bain Capital"            Bain Capital LP, the private PE firm. Gong cha,
--                               Eaton Fiber, Wealth Enhancement. Not the BDC.
--     "Bain Capital Insurance"  Bain Capital Insurance, a Bain Capital unit.
--                               Its coverage is about Aptia and pension
--                               services. IT IS NOT Bain Capital Specialty
--                               Finance, and it is the row carrying cik
--                               1655050. That is a #843-class mis-stamp in its
--                               own right and it is NOT resolved here.
--
--   SO NOTHING IS FOLDED. Two rows lose a ticker they were never entitled to.
--   The third keeps a CIK whose correctness is a separate open question; see
--   the QUARANTINE section.
--
--   TODAY: /company/bain renders "Bain Capital Insurance" over cik 1655050.
--   AFTER: /company/bain renders "Bain" with no CIK.
--   DISPLAYED NAME CHANGES: yes, on /company/bain only.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := 'd05ac3bf-2c8f-414b-9c4f-5c55f79c1945'::uuid;
  v_name    text := 'Bain';
  v_ticker  text := 'BCSF';
  r         public.companies%ROWTYPE;
  v_others  int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 05: row % is gone. REFUSING.', v_id;
  END IF;

  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 05: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  IF r.ticker IS NULL THEN
    RAISE NOTICE 'BLOCK 05: already applied to % (ticker already NULL). No-op.', v_name;
    RETURN;
  END IF;

  IF upper(btrim(r.ticker)) IS DISTINCT FROM upper(btrim(v_ticker)) THEN
    RAISE EXCEPTION 'BLOCK 05: % carries ticker % , expected %. REFUSING.', v_name, r.ticker, v_ticker;
  END IF;

  IF r.sec_cik IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 05: % now carries sec_cik %. Clearing the ticker would leave a CIK-bearing row with a NULL ticker. REFUSING.', v_name, r.sec_cik;
  END IF;

  SELECT count(*) INTO v_others FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_others = 0 THEN
    RAISE EXCEPTION 'BLOCK 05: % is the ONLY holder of %. Clearing it strands the symbol. REFUSING.', v_name, v_ticker;
  END IF;

  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'clear_ticker',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', NULL::text, 'sec_cik', r.sec_cik),
          format('0038 block 05: clear %s off %s (mis-stamp; Bain & Company / Bain Capital, not Bain Capital Specialty Finance cik 1655050)', v_ticker, v_name));

  UPDATE public.companies
     SET ticker = NULL
   WHERE id = v_id AND name = v_name
     AND upper(btrim(ticker)) = upper(btrim(v_ticker))
     AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 05: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. EXPECT ticker NULL. other_holders is 2 before BLOCK 06 and 1
-- after it, so read this against where you are in the batch.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.companies o
         WHERE upper(btrim(o.ticker)) = 'BCSF' AND o.id <> c.id) AS other_holders
  FROM public.companies c
 WHERE c.id = 'd05ac3bf-2c8f-414b-9c4f-5c55f79c1945'::uuid;

COMMIT;

-- ROLLBACK for block 05 only.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker = (j.before->>'ticker')
--   FROM norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'clear_ticker'
--    AND j.row_id = 'd05ac3bf-2c8f-414b-9c4f-5c55f79c1945'::uuid AND c.id = j.row_id
--    AND c.ticker IS NULL;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'clear_ticker'
--    AND row_id = 'd05ac3bf-2c8f-414b-9c4f-5c55f79c1945'::uuid;
-- COMMIT;


-- ---------------------------------------------------------------------
-- BLOCK 06  Bain Capital  --  clear ticker BCSF
--
--   Second half of the BCSF decision. See BLOCK 05's header for the full
--   reasoning; it is not repeated here. Bain Capital LP is a private PE firm
--   and is not the NYSE-listed BDC at cik 1655050.
--
--   TODAY: /company/bain-capital renders "Bain Capital Insurance" over cik
--   1655050, on the least-mentioned row of the three, while the much more
--   heavily mentioned "Bain Capital" row sits underneath it as a sibling.
--   AFTER: /company/bain-capital renders "Bain Capital" with no CIK.
--   DISPLAYED NAME CHANGES: yes, on /company/bain-capital only.
--   /company/bcsf and /company/bain-capital-insurance are unchanged; measured.
--
--   THIS BLOCK CAN BE PASTED WITHOUT BLOCK 05 AND VICE VERSA. Its guard only
--   requires that SOME other row still holds BCSF, which "Bain Capital
--   Insurance" always will.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := '14afa5db-ed1a-4b4e-a5dd-8c611bd0388e'::uuid;
  v_name    text := 'Bain Capital';
  v_ticker  text := 'BCSF';
  r         public.companies%ROWTYPE;
  v_others  int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 06: row % is gone. REFUSING.', v_id;
  END IF;

  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 06: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  IF r.ticker IS NULL THEN
    RAISE NOTICE 'BLOCK 06: already applied to % (ticker already NULL). No-op.', v_name;
    RETURN;
  END IF;

  IF upper(btrim(r.ticker)) IS DISTINCT FROM upper(btrim(v_ticker)) THEN
    RAISE EXCEPTION 'BLOCK 06: % carries ticker % , expected %. REFUSING.', v_name, r.ticker, v_ticker;
  END IF;

  IF r.sec_cik IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 06: % now carries sec_cik %. Clearing the ticker would leave a CIK-bearing row with a NULL ticker. REFUSING.', v_name, r.sec_cik;
  END IF;

  SELECT count(*) INTO v_others FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker)) AND id <> v_id;
  IF v_others = 0 THEN
    RAISE EXCEPTION 'BLOCK 06: % is the ONLY holder of %. Clearing it strands the symbol. REFUSING.', v_name, v_ticker;
  END IF;

  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'clear_ticker',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', NULL::text, 'sec_cik', r.sec_cik),
          format('0038 block 06: clear %s off %s (mis-stamp; the private PE firm, not Bain Capital Specialty Finance cik 1655050)', v_ticker, v_name));

  UPDATE public.companies
     SET ticker = NULL
   WHERE id = v_id AND name = v_name
     AND upper(btrim(ticker)) = upper(btrim(v_ticker))
     AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 06: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. EXPECT ticker NULL and, once BLOCK 05 has also run,
-- other_holders = 1 ("Bain Capital Insurance").
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.companies o
         WHERE upper(btrim(o.ticker)) = 'BCSF' AND o.id <> c.id) AS other_holders
  FROM public.companies c
 WHERE c.id = '14afa5db-ed1a-4b4e-a5dd-8c611bd0388e'::uuid;

COMMIT;

-- ROLLBACK for block 06 only.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker = (j.before->>'ticker')
--   FROM norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'clear_ticker'
--    AND j.row_id = '14afa5db-ed1a-4b4e-a5dd-8c611bd0388e'::uuid AND c.id = j.row_id
--    AND c.ticker IS NULL;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'clear_ticker'
--    AND row_id = '14afa5db-ed1a-4b4e-a5dd-8c611bd0388e'::uuid;
-- COMMIT;


-- #####################################################################
-- ##  BATCH 2  --  RETIRE A SYMBOL THAT BELONGS TO NEITHER ROW.
-- ##               BLOCKS 07 and 08. *** PASTE THEM TOGETHER. ***
-- #####################################################################
--
-- *** WHAT `EP PR C` SHOULD BE, WHICH IS THE QUESTION ASKED. IT SHOULD BE
-- NOTHING. IT IS WRONG ON BOTH ROWS AND IT IS NOT A DUPLICATE TO FOLD. ***
--
-- `EP PR C` is a PREFERRED-SHARE symbol in the "<root> PR <series>" convention.
-- Energy Capital Partners is a PRIVATE equity firm. A private firm has no
-- common ticker, let alone a preferred series.
--
-- SEC, read today:
--   `EP PR C` is not in company_tickers.json under any spelling tried
--   (EP PR C, EP-PC, EPPRC).
--   `EP` maps to cik 887396, EMPIRE PETROLEUM CORP. Not Energy Capital.
--   An EDGAR company search for "Energy Capital Partners" returns no
--   conformed name.
-- So there is no correct issuer to move this symbol to, and no CIK to stamp.
--
-- BOTH ROWS ARE THE SAME FIRM. "Energy Capital Partners" and "Energy Capital"
-- carry the same story: the KKR / Energy Capital Partners bid for DCC. That IS
-- a duplicate, and folding it is a 0020 merge,
-- not a ticker clear. This batch only removes the bad symbol.
--
-- *** WHY THESE TWO MUST BE PASTED TOGETHER. *** BLOCKS 02 to 06 refuse to
-- clear the LAST holder of a ticker. These two deliberately retire the symbol
-- entirely, so they carry a DIFFERENT guard: each asserts that the set of rows
-- holding `EP PR C` is a subset of these two ids, and each tolerates becoming
-- the last holder. Applying only one of them leaves a single row carrying a
-- symbol that belongs to a different issuer, which is a worse state than
-- either the before or the after.
--
-- TODAY: /company/energy-capital-partners renders "Energy Capital Partners"
--        with the ticker EP PR C shown as its symbol.
--        /company/ep-pr-c resolves to NOTHING. The slug reconstructs to
--        "Ep Pr C", which matches no name and no alias, so the ticker's own
--        URL is already dead. Measured.
-- AFTER:  /company/energy-capital-partners renders the same name with no
--         ticker, so the header reads Private, which is correct for a private
--         PE firm.
--         /company/energy-capital moves from "Energy Capital Partners" to
--         "Energy Capital". SAME FIRM, SHORTER NAME. This is the one displayed
--         name in this file that gets slightly WORSE, and it is on the less
--         mentioned of the pair. The fix for it is the 0020 merge, not a ticker.
-- DISPLAYED NAME CHANGES: /company/energy-capital only.

-- ---------------------------------------------------------------------
-- BLOCK 07  Energy Capital Partners  --  clear ticker 'EP PR C'
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := 'd026011a-7b0f-4ff6-9cbb-83174067a572'::uuid;
  v_sibling uuid := '7af8f515-4406-4bff-b454-8bb43ebbdd03'::uuid;
  v_name    text := 'Energy Capital Partners';
  v_ticker  text := 'EP PR C';
  r         public.companies%ROWTYPE;
  v_foreign int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 07: row % is gone. REFUSING.', v_id;
  END IF;

  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 07: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  IF r.ticker IS NULL THEN
    RAISE NOTICE 'BLOCK 07: already applied to % (ticker already NULL). No-op.', v_name;
    RETURN;
  END IF;

  IF upper(btrim(r.ticker)) IS DISTINCT FROM upper(btrim(v_ticker)) THEN
    RAISE EXCEPTION 'BLOCK 07: % carries ticker % , expected %. REFUSING.', v_name, r.ticker, v_ticker;
  END IF;

  IF r.sec_cik IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 07: % now carries sec_cik %. Clearing the ticker would leave a CIK-bearing row with a NULL ticker. REFUSING.', v_name, r.sec_cik;
  END IF;

  -- RETIREMENT GUARD, NOT the "keep a holder" guard the mis-stamp blocks use.
  -- This block is allowed to leave the symbol with fewer holders, INCLUDING
  -- zero. What it is NOT allowed to do is retire a symbol some THIRD row
  -- depends on, so it refuses if any row outside this pair holds it.
  SELECT count(*) INTO v_foreign FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker))
     AND id <> v_id AND id <> v_sibling;
  IF v_foreign > 0 THEN
    RAISE EXCEPTION 'BLOCK 07: % is held by % row(s) outside the known pair. This is no longer the shape analysed. REFUSING.', v_ticker, v_foreign;
  END IF;

  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'clear_ticker',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', NULL::text, 'sec_cik', r.sec_cik),
          format('0038 block 07: retire %s off %s (preferred-share symbol on a private PE firm; belongs to no row)', v_ticker, v_name));

  UPDATE public.companies
     SET ticker = NULL
   WHERE id = v_id AND name = v_name
     AND upper(btrim(ticker)) = upper(btrim(v_ticker))
     AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 07: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. EXPECT ticker NULL. remaining_holders is 1 until BLOCK 08 runs
-- in the same paste, then 0. Zero is the intended end state for this symbol.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.companies o
         WHERE upper(btrim(o.ticker)) = 'EP PR C') AS remaining_holders
  FROM public.companies c
 WHERE c.id = 'd026011a-7b0f-4ff6-9cbb-83174067a572'::uuid;

COMMIT;

-- ROLLBACK for block 07 only. Reverse BOTH 07 and 08 or neither.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker = (j.before->>'ticker')
--   FROM norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'clear_ticker'
--    AND j.row_id = 'd026011a-7b0f-4ff6-9cbb-83174067a572'::uuid AND c.id = j.row_id
--    AND c.ticker IS NULL;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'clear_ticker'
--    AND row_id = 'd026011a-7b0f-4ff6-9cbb-83174067a572'::uuid;
-- COMMIT;


-- ---------------------------------------------------------------------
-- BLOCK 08  Energy Capital  --  clear ticker 'EP PR C'
--   Second half of BATCH 2. See the BATCH 2 header. Same retirement guard.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := '7af8f515-4406-4bff-b454-8bb43ebbdd03'::uuid;
  v_sibling uuid := 'd026011a-7b0f-4ff6-9cbb-83174067a572'::uuid;
  v_name    text := 'Energy Capital';
  v_ticker  text := 'EP PR C';
  r         public.companies%ROWTYPE;
  v_foreign int;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 08: row % is gone. REFUSING.', v_id;
  END IF;

  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 08: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  IF r.ticker IS NULL THEN
    RAISE NOTICE 'BLOCK 08: already applied to % (ticker already NULL). No-op.', v_name;
    RETURN;
  END IF;

  IF upper(btrim(r.ticker)) IS DISTINCT FROM upper(btrim(v_ticker)) THEN
    RAISE EXCEPTION 'BLOCK 08: % carries ticker % , expected %. REFUSING.', v_name, r.ticker, v_ticker;
  END IF;

  IF r.sec_cik IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 08: % now carries sec_cik %. Clearing the ticker would leave a CIK-bearing row with a NULL ticker. REFUSING.', v_name, r.sec_cik;
  END IF;

  SELECT count(*) INTO v_foreign FROM public.companies
   WHERE upper(btrim(ticker)) = upper(btrim(v_ticker))
     AND id <> v_id AND id <> v_sibling;
  IF v_foreign > 0 THEN
    RAISE EXCEPTION 'BLOCK 08: % is held by % row(s) outside the known pair. This is no longer the shape analysed. REFUSING.', v_ticker, v_foreign;
  END IF;

  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'clear_ticker',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', NULL::text, 'sec_cik', r.sec_cik),
          format('0038 block 08: retire %s off %s (preferred-share symbol on a private PE firm; belongs to no row)', v_ticker, v_name));

  UPDATE public.companies
     SET ticker = NULL
   WHERE id = v_id AND name = v_name
     AND upper(btrim(ticker)) = upper(btrim(v_ticker))
     AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 08: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. EXPECT ticker NULL and remaining_holders = 0. Zero is intended.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count,
       (SELECT count(*) FROM public.companies o
         WHERE upper(btrim(o.ticker)) = 'EP PR C') AS remaining_holders
  FROM public.companies c
 WHERE c.id = '7af8f515-4406-4bff-b454-8bb43ebbdd03'::uuid;

COMMIT;

-- ROLLBACK for block 08 only. Reverse BOTH 07 and 08 or neither.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker = (j.before->>'ticker')
--   FROM norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'clear_ticker'
--    AND j.row_id = '7af8f515-4406-4bff-b454-8bb43ebbdd03'::uuid AND c.id = j.row_id
--    AND c.ticker IS NULL;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'clear_ticker'
--    AND row_id = '7af8f515-4406-4bff-b454-8bb43ebbdd03'::uuid;
-- COMMIT;


-- #####################################################################
-- ##  BATCH 3  --  SAME ENTITY, HEAD-SAFE, AND LOSSY. BLOCKS 09 to 11.
-- ##
-- ##  READ THIS BEFORE APPLYING ANY OF THE THREE.
-- ##
-- ##  These three junk rows ARE the same company as the row that keeps the
-- ##  ticker. Nothing is mis-identified. Clearing removes the duplicate, and
-- ##  it was MEASURED that no slug in either URL space changes its head:
-- ##  /company/nclh, /company/norwegian-cruise-line, /company/cwan,
-- ##  /company/clearwater, /company/ssnlf, /company/samsung and
-- ##  /company/samsung-electronics all resolve to the same row before and
-- ##  after. The junk rows are only reachable through the ticker branch, and
-- ##  that branch lands on the survivor once the duplicate is gone.
-- ##
-- ##  *** WHAT IS LOST, AND IT IS NOT NOTHING. *** The junk row leaves the
-- ##  survivor's cluster, so getCompanyDetail's `ids` array loses it. Two
-- ##  visible consequences on the surviving page:
-- ##    - the alias ribbon loses that row's surface forms, including the bare
-- ##      ticker chip on /company/nclh and /company/cwan;
-- ##    - the company_mentions read narrows, so the 7-day tone and the
-- ##      attention baseline are computed over fewer rows and can move.
-- ##  The junk row itself becomes unreachable: it keeps its name, its mentions
-- ##  and its alias, and no slug lands on it.
-- ##
-- ##  A 0020 MERGE IS STRICTLY BETTER THAN ALL THREE OF THESE BLOCKS. It
-- ##  repoints the alias and the dependent rows onto the survivor instead of
-- ##  orphaning them. These blocks are offered because they are correct and
-- ##  cheap; if a merge is coming, skip them and let the merge do it.
-- ##
-- ##  LOCK ORDER, SINCE THESE THREE LOCK TWO ROWS AND BLOCKS 02 TO 08 LOCK ONE.
-- ##  Each takes FOR UPDATE on the row it clears and FOR SHARE on the keeper,
-- ##  in that order. The keeper lock is not optional: at READ COMMITTED a plain
-- ##  read could see a keeper that a concurrent write changes a millisecond
-- ##  later, and the whole "no page moves" claim rests on the keeper's state.
-- ##  The daily pipeline also writes companies rows (entity_resolver.py:306
-- ##  touches last_updated), so a deadlock is possible in principle. Postgres
-- ##  detects it and aborts one side, and an aborted paste here is a clean
-- ##  rollback with nothing half-done. Re-paste if that happens.
-- #####################################################################

-- ---------------------------------------------------------------------
-- BLOCK 09  NCLH  --  clear ticker NCLH off the row NAMED "NCLH"
--
--   SEC: NCLH is cik 1513761, "Norwegian Cruise Line Holdings Ltd." The row
--   named "Norwegian Cruise Line" already holds it, with the higher mention
--   count. The row named "NCLH" is a bare ticker string with no CIK.
--   Its articles are Norwegian Cruise Line articles. Same company.
--
--   TODAY / AFTER: /company/nclh and /company/norwegian-cruise-line both
--   render "Norwegian Cruise Line" over cik 1513761. Unchanged; measured.
--   DISPLAYED NAME CHANGES: no.
--   LOST: the "NCLH" chip on the alias ribbon, and that row's mentions from
--   the tone and attention windows.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := '8b2683d9-c0ac-45ae-9ab9-744e642df937'::uuid;
  v_name    text := 'NCLH';
  v_ticker  text := 'NCLH';
  v_keeper  uuid := 'b325a350-201a-4d2e-aa67-c4ba76c0bfb1'::uuid;
  r         public.companies%ROWTYPE;
  k         public.companies%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 09: row % is gone. REFUSING.', v_id;
  END IF;

  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 09: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  IF r.ticker IS NULL THEN
    RAISE NOTICE 'BLOCK 09: already applied to % (ticker already NULL). No-op.', v_name;
    RETURN;
  END IF;

  IF upper(btrim(r.ticker)) IS DISTINCT FROM upper(btrim(v_ticker)) THEN
    RAISE EXCEPTION 'BLOCK 09: % carries ticker % , expected %. REFUSING.', v_name, r.ticker, v_ticker;
  END IF;

  IF r.sec_cik IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 09: % now carries sec_cik %. Clearing the ticker would leave a CIK-bearing row with a NULL ticker. REFUSING.', v_name, r.sec_cik;
  END IF;

  -- KEEPER RE-CHECK. Stronger than the mis-stamp blocks' "some other holder
  -- exists", because here the whole point is that a NAMED row keeps the ticker
  -- AND the CIK. Re-checked at apply time, not trusted from analysis.
  SELECT * INTO k FROM public.companies WHERE id = v_keeper FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 09: keeper row % is gone. REFUSING.', v_keeper;
  END IF;
  IF upper(btrim(k.ticker)) IS DISTINCT FROM upper(btrim(v_ticker)) OR k.sec_cik IS NULL THEN
    RAISE EXCEPTION 'BLOCK 09: keeper % now holds ticker=% cik=%. It must hold % and a CIK. REFUSING.', k.name, k.ticker, k.sec_cik, v_ticker;
  END IF;

  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'clear_ticker',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', NULL::text, 'sec_cik', r.sec_cik),
          format('0038 block 09: clear %s off the bare-ticker duplicate %s; keeper %s holds cik %s', v_ticker, v_name, k.name, k.sec_cik));

  UPDATE public.companies
     SET ticker = NULL
   WHERE id = v_id AND name = v_name
     AND upper(btrim(ticker)) = upper(btrim(v_ticker))
     AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 09: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. EXPECT the cleared row with ticker NULL, and exactly one
-- remaining holder of NCLH, carrying cik 1513761.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count
  FROM public.companies c
 WHERE c.id = '8b2683d9-c0ac-45ae-9ab9-744e642df937'::uuid
    OR upper(btrim(c.ticker)) = 'NCLH'
 ORDER BY c.ticker NULLS FIRST;

COMMIT;

-- ROLLBACK for block 09 only.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker = (j.before->>'ticker')
--   FROM norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'clear_ticker'
--    AND j.row_id = '8b2683d9-c0ac-45ae-9ab9-744e642df937'::uuid AND c.id = j.row_id
--    AND c.ticker IS NULL;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'clear_ticker'
--    AND row_id = '8b2683d9-c0ac-45ae-9ab9-744e642df937'::uuid;
-- COMMIT;


-- ---------------------------------------------------------------------
-- BLOCK 10  CWAN  --  clear ticker CWAN off the row NAMED "CWAN"
--
--   SEC: cik 1866368 is "Clearwater Analytics Holdings, Inc.", ticker CWAN,
--   NYSE, per the submissions API. (It is absent from company_tickers.json;
--   the submissions record is authoritative and was read directly.) The row
--   named "Clearwater" already holds that CIK.
--
--   TODAY / AFTER: /company/cwan and /company/clearwater both render
--   "Clearwater" over cik 1866368. Unchanged; measured.
--   DISPLAYED NAME CHANGES: no.
--   LOST: the "CWAN" chip on the alias ribbon and that row's mentions.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := '1ac4dfe5-2af4-4897-868a-3fed68df274a'::uuid;
  v_name    text := 'CWAN';
  v_ticker  text := 'CWAN';
  v_keeper  uuid := '8a20f20e-9dbf-437a-baf5-ca684905aa3e'::uuid;
  r         public.companies%ROWTYPE;
  k         public.companies%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 10: row % is gone. REFUSING.', v_id;
  END IF;

  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 10: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  IF r.ticker IS NULL THEN
    RAISE NOTICE 'BLOCK 10: already applied to % (ticker already NULL). No-op.', v_name;
    RETURN;
  END IF;

  IF upper(btrim(r.ticker)) IS DISTINCT FROM upper(btrim(v_ticker)) THEN
    RAISE EXCEPTION 'BLOCK 10: % carries ticker % , expected %. REFUSING.', v_name, r.ticker, v_ticker;
  END IF;

  IF r.sec_cik IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 10: % now carries sec_cik %. Clearing the ticker would leave a CIK-bearing row with a NULL ticker. REFUSING.', v_name, r.sec_cik;
  END IF;

  SELECT * INTO k FROM public.companies WHERE id = v_keeper FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 10: keeper row % is gone. REFUSING.', v_keeper;
  END IF;
  IF upper(btrim(k.ticker)) IS DISTINCT FROM upper(btrim(v_ticker)) OR k.sec_cik IS NULL THEN
    RAISE EXCEPTION 'BLOCK 10: keeper % now holds ticker=% cik=%. It must hold % and a CIK. REFUSING.', k.name, k.ticker, k.sec_cik, v_ticker;
  END IF;

  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'clear_ticker',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', NULL::text, 'sec_cik', r.sec_cik),
          format('0038 block 10: clear %s off the bare-ticker duplicate %s; keeper %s holds cik %s', v_ticker, v_name, k.name, k.sec_cik));

  UPDATE public.companies
     SET ticker = NULL
   WHERE id = v_id AND name = v_name
     AND upper(btrim(ticker)) = upper(btrim(v_ticker))
     AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 10: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. EXPECT one remaining holder of CWAN, carrying cik 1866368.
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count
  FROM public.companies c
 WHERE c.id = '1ac4dfe5-2af4-4897-868a-3fed68df274a'::uuid
    OR upper(btrim(c.ticker)) = 'CWAN'
 ORDER BY c.ticker NULLS FIRST;

COMMIT;

-- ROLLBACK for block 10 only.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker = (j.before->>'ticker')
--   FROM norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'clear_ticker'
--    AND j.row_id = '1ac4dfe5-2af4-4897-868a-3fed68df274a'::uuid AND c.id = j.row_id
--    AND c.ticker IS NULL;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'clear_ticker'
--    AND row_id = '1ac4dfe5-2af4-4897-868a-3fed68df274a'::uuid;
-- COMMIT;


-- ---------------------------------------------------------------------
-- BLOCK 11  Samsung Electronics  --  clear ticker SSNLF
--
--   *** WHAT SEC HAS FOR SSNLF, WHICH IS THE QUESTION ASKED: NOTHING USABLE,
--   AND NO STAMP IS AVAILABLE. *** SSNLF is not in company_tickers.json. An
--   EDGAR company search returns exactly one conformed name, "SAMSUNG
--   ELECTRONICS CO LTD /FI", which is a foreign-filer record, not an operating
--   registrant with XBRL facts. Samsung Electronics is a Korean issuer that
--   files no 10-K; SSNLF is a grey-market symbol. NO CIK IS INVENTED HERE AND
--   NONE SHOULD BE.
--
--   NEITHER ROW HOLDS A CIK AND NEITHER WILL. This block only removes the
--   duplicate. The keeper guard used by BLOCKS 09 and 10 CANNOT be used here,
--   because there is no CIK to require, so the guard requires the keeper's
--   ticker and its higher mention count instead.
--
--   WHICH ROW IS THE COMPANY. Both are. "Samsung" is the head today, on
--   mention count, since compareCikFirst returns 0 when no row has a CIK.
--   Keeping the ticker on the head is the choice that moves no page.
--
--   TODAY / AFTER: /company/ssnlf, /company/samsung and
--   /company/samsung-electronics all render "Samsung". Unchanged; measured.
--   The third one survives because canonicalize() maps "Samsung Electronics"
--   to "Samsung", so the slug never needed the ticker to get there.
--   DISPLAYED NAME CHANGES: no.
--   LOST: six legal-form alias chips ("Samsung Electronics Co., Ltd." and
--   friends) leave the ribbon, and that row's mentions leave the tone window.
--   THIS IS THE MOST DEBATABLE BLOCK IN THE FILE. It removes a duplicate that
--   is causing no page defect, and it costs a visible ribbon. If the answer is
--   "leave it", skip this block; nothing else depends on it.
-- ---------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id      uuid := '1512a4d4-57f3-4258-8f33-91588a2e7a3c'::uuid;
  v_name    text := 'Samsung Electronics';
  v_ticker  text := 'SSNLF';
  v_keeper  uuid := '61dbc960-b786-4b83-a0f0-d4b5b32e1a28'::uuid;
  r         public.companies%ROWTYPE;
  k         public.companies%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.companies WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 11: row % is gone. REFUSING.', v_id;
  END IF;

  IF r.name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'BLOCK 11: name drifted, expected % got %. REFUSING.', v_name, r.name;
  END IF;

  IF r.ticker IS NULL THEN
    RAISE NOTICE 'BLOCK 11: already applied to % (ticker already NULL). No-op.', v_name;
    RETURN;
  END IF;

  IF upper(btrim(r.ticker)) IS DISTINCT FROM upper(btrim(v_ticker)) THEN
    RAISE EXCEPTION 'BLOCK 11: % carries ticker % , expected %. REFUSING.', v_name, r.ticker, v_ticker;
  END IF;

  IF r.sec_cik IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 11: % now carries sec_cik %. Clearing the ticker would leave a CIK-bearing row with a NULL ticker. REFUSING.', v_name, r.sec_cik;
  END IF;

  -- KEEPER RE-CHECK, CIK-FREE VARIANT. The keeper must still hold the ticker
  -- and must still outrank this row on mention_count, because mention_count is
  -- the ONLY thing deciding the head when no row in the cluster has a CIK
  -- (aliasResolver.ts rankCluster, after compareCikFirst returns 0). If that
  -- order has flipped, clearing this ticker would move the displayed name and
  -- this block's "no page moves" claim would be false.
  SELECT * INTO k FROM public.companies WHERE id = v_keeper FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 11: keeper row % is gone. REFUSING.', v_keeper;
  END IF;
  IF upper(btrim(k.ticker)) IS DISTINCT FROM upper(btrim(v_ticker)) THEN
    RAISE EXCEPTION 'BLOCK 11: keeper % holds ticker %, expected %. REFUSING.', k.name, k.ticker, v_ticker;
  END IF;
  IF k.sec_cik IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCK 11: keeper % has acquired cik %. Re-read this block: with a CIK in play the head is decided by CIK, not mentions. REFUSING.', k.name, k.sec_cik;
  END IF;
  IF coalesce(k.mention_count, -1) <= coalesce(r.mention_count, -1) THEN
    RAISE EXCEPTION 'BLOCK 11: keeper % no longer outranks % on mention_count (% vs %). Clearing would move the displayed name. REFUSING.', k.name, v_name, k.mention_count, r.mention_count;
  END IF;

  INSERT INTO norm_v2.stamped_identity (table_name, row_id, op, before, after, note)
  VALUES ('public.companies', v_id, 'clear_ticker',
          jsonb_build_object('ticker', r.ticker, 'sec_cik', r.sec_cik),
          jsonb_build_object('ticker', NULL::text, 'sec_cik', r.sec_cik),
          format('0038 block 11: clear %s off %s; keeper %s (no CIK exists for either; SSNLF is not an SEC-registered symbol)', v_ticker, v_name, k.name));

  UPDATE public.companies
     SET ticker = NULL
   WHERE id = v_id AND name = v_name
     AND upper(btrim(ticker)) = upper(btrim(v_ticker))
     AND sec_cik IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCK 11: UPDATE matched no row after guards passed. REFUSING.';
  END IF;
END $$;

-- READ-BACK. EXPECT one remaining holder of SSNLF, the row named "Samsung".
SELECT c.id, c.name, c.ticker, c.sec_cik, c.mention_count
  FROM public.companies c
 WHERE c.id = '1512a4d4-57f3-4258-8f33-91588a2e7a3c'::uuid
    OR upper(btrim(c.ticker)) = 'SSNLF'
 ORDER BY c.ticker NULLS FIRST;

COMMIT;

-- ROLLBACK for block 11 only.
-- BEGIN;
-- UPDATE public.companies c
--    SET ticker = (j.before->>'ticker')
--   FROM norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies' AND j.op = 'clear_ticker'
--    AND j.row_id = '1512a4d4-57f3-4258-8f33-91588a2e7a3c'::uuid AND c.id = j.row_id
--    AND c.ticker IS NULL;
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'clear_ticker'
--    AND row_id = '1512a4d4-57f3-4258-8f33-91588a2e7a3c'::uuid;
-- COMMIT;


-- =====================================================================
-- BLOCK 22  -- POST-CHECK. Read-only. *** PASTE IT ON ITS OWN, AFTER the
--               work paste has committed. *** Inside a work paste it reads
--               uncommitted rows and tells you nothing durable.
-- =====================================================================
BEGIN;

-- 22a. THE LOAD-BEARING INVARIANT. cik_without_ticker MUST STILL BE 0.
-- with_ticker falls by one per applied block; with_cik does not move at all,
-- because no block in this file writes sec_cik.
SELECT count(*) FILTER (WHERE ticker IS NOT NULL)                     AS with_ticker,
       count(*) FILTER (WHERE sec_cik IS NOT NULL)                    AS with_cik,
       count(*) FILTER (WHERE sec_cik IS NOT NULL AND ticker IS NULL) AS cik_without_ticker
  FROM public.companies;

-- 22b. Every row this file cleared, and what it looks like now. EXPECT ticker
-- NULL and sec_cik NULL on every one.
SELECT c.name, c.ticker, c.sec_cik, c.mention_count,
       j.before->>'ticker' AS cleared_ticker, j.ran_at, j.note
  FROM public.companies c
  JOIN norm_v2.stamped_identity j
    ON j.row_id = c.id AND j.table_name = 'public.companies' AND j.op = 'clear_ticker'
 ORDER BY j.id;

-- 22c. 0029'S JOURNAL MUST BE UNTOUCHED. EXPECT the stamp_identity count to be
-- exactly what BLOCK 00c reported. If it moved, something used the wrong op.
SELECT op, count(*) AS rows FROM norm_v2.stamped_identity GROUP BY op ORDER BY op;

-- 22d. *** THE CHECK. NO DUPLICATE TICKER HOLDER ANYWHERE. ***
-- There is no unique index behind ticker, so this query is the only thing in
-- the system that would ever catch one.
--
-- IT RETURNS ZERO ROWS ONLY WHEN THE WHOLE JOB IS DONE, AND THIS FILE DOES NOT
-- FINISH THE JOB. After BLOCKS 02 to 11 it returns THREE groups: TSM, PTON and
-- GEMI. Those are the HOLD set below, and they are held on purpose. Compare
-- against 22e before treating a non-empty result as a failure.
SELECT upper(btrim(ticker)) AS t, count(*) AS holders,
       string_agg(name || ' [cik ' || coalesce(sec_cik::text, 'null') || ']', ' | ' ORDER BY mention_count DESC NULLS LAST) AS rows
  FROM public.companies
 WHERE ticker IS NOT NULL
 GROUP BY 1 HAVING count(*) > 1
 ORDER BY 1;

-- 22e. The HELD tickers, named. EXPECT 22d to return exactly these three and
-- nothing else once BLOCKS 02 to 11 have been applied. Anything in 22d that is
-- NOT in this list is a duplicate this file did not know about, and it means a
-- new one has appeared since analysis. That is the result worth acting on.
SELECT unnest(ARRAY['TSM','PTON','GEMI']) AS held_ticker;

COMMIT;


-- =====================================================================
-- BLOCK 99  -- FULL ROLLBACK. Reverses every clear this file applied.
--
-- Scoped by op = 'clear_ticker', so it CANNOT touch 0029's stamp_identity
-- rows, and 0029's own BLOCK 99 cannot touch these. That separation is the
-- whole point of the op decision in BLOCK 01.
--
-- Pinned to `c.ticker IS NULL`, the after-state every one of these rows was
-- left in, so a row something else has written since is SKIPPED rather than
-- clobbered. Read the verification query BEFORE the delete.
-- =====================================================================
-- BEGIN;
--
-- UPDATE public.companies c
--    SET ticker = (j.before->>'ticker')
--   FROM norm_v2.stamped_identity j
--  WHERE j.table_name = 'public.companies'
--    AND j.op = 'clear_ticker'
--    AND c.id = j.row_id
--    AND c.ticker IS NULL;
--
-- -- Read this BEFORE the delete. Any row listed here was NOT reversed because
-- -- something else wrote it after the clear. EXPECT zero rows.
-- SELECT j.row_id, c.name, c.ticker, j.before
--   FROM norm_v2.stamped_identity j JOIN public.companies c ON c.id = j.row_id
--  WHERE j.table_name = 'public.companies' AND j.op = 'clear_ticker'
--    AND c.ticker IS DISTINCT FROM (j.before->>'ticker');
--
-- DELETE FROM norm_v2.stamped_identity
--  WHERE table_name = 'public.companies' AND op = 'clear_ticker';
--
-- COMMIT;


-- =====================================================================
-- HOLD  --  THREE TICKERS THIS FILE DELIBERATELY DOES NOT CLEAR.
--
--           *** DO NOT UNCOMMENT ANYTHING HERE. THERE IS NOTHING TO
--           UNCOMMENT. NO SQL IS WRITTEN FOR THESE, ON PURPOSE. ***
--
-- All three are SAME-ENTITY duplicates where the CIK-less row is the one a
-- slug actually reaches by NAME. Clearing its ticker takes it out of the
-- cluster, and the slug then lands on it alone: no CIK, no filings, no
-- financials, no insider rows, and a Private badge over a listed company.
-- The alias table does not save it, because each of these rows owns an
-- `aliases` row whose canonical_id is ITSELF.
--
-- Measured against prod, one slug at a time, calling the real resolvers:
--
--   TSM   the CIK-less row is "TSMC", and it carries substantially more
--         mentions than the filer row it would leave behind. No slug moves,
--         because canonicalize() maps "tsmc" to "Taiwan Semiconductor", but
--         the surviving page's cluster loses the larger half of its mention
--         history and its most-used alias chip. This is the largest single
--         data loss available in this whole file, for no page defect fixed.
--
--   PTON  /company/peloton is reached by NAME and lands on the CIK-less
--         "Peloton" row the moment its ticker is gone. It goes from Peloton
--         Interactive's full SEC financials to an empty state. This is a
--         STRAIGHT REGRESSION on the higher-traffic of the two slugs.
--
--   GEMI  same shape as PTON. /company/gemini falls onto the CIK-less
--         "Gemini" row and loses cik 2055592. Worth noting separately: that
--         row's articles are NOT all one company. Most are Gemini the crypto
--         exchange, and some are Google's Gemini model. Whatever is done here
--         is a disambiguation problem, not a ticker problem.
--
-- THE RIGHT INSTRUMENT FOR ALL THREE IS THE 0020 MERGE, which can repoint
-- `aliases.canonical_id` and the dependent rows onto the filer instead of
-- stranding them. A ticker clear cannot do that and should not pretend to.
-- =====================================================================


-- =====================================================================
-- QUARANTINE  --  THE ROW NAMED "BCG". REPORTED, NOT TOUCHED.
--                 Belongs to issue #843, not to this file.
--
-- BLOCK 02 clears BCG off "Kingswood". IT DOES NOT RESOLVE THE ROW NAMED
-- "BCG", AND THAT ROW IS ALSO WRONG.
--
-- WHAT IT HOLDS. name "BCG", ticker BCG, sec_cik 1953984. SEC says cik 1953984
-- is "Binah Capital Group, Inc.", a Nasdaq-listed financial services firm
-- trading as BCG and BCGWW. Confirmed in company_tickers.json and in the
-- submissions API.
--
-- WHY THAT IS A PROBLEM. The mentions filed under "BCG" are not one company
-- and are mostly not Binah. Read in full, they are:
--   - earnings and stock-move items that are plausibly Binah;
--   - a TechCrunch piece on M&A research tooling, where BCG is Boston
--     Consulting Group, a private consultancy that will never have a CIK;
--   - an oncology piece where BCG is Bacillus Calmette-Guerin, the bladder
--     cancer immunotherapy, which is not a company at all.
--
-- So a three-letter string is acting as an entity, and it currently resolves
-- to a real issuer's XBRL facts. That is EXACTLY the shape of issue #843,
-- "The Compass Inc. row carries Encompass Health's ticker and CIK": the
-- resolver is behaving correctly and the data underneath it is wrong.
--
-- #843's own fix section anticipated this file. Its step 3 says the sweep
-- "found brand-form rows carrying tickers that belong to unrelated issuers,
-- including a private company sharing a name prefix with a closed-end fund".
-- That is the BCSF cluster in BLOCKS 05 and 06, found again independently
-- here: Bain Capital, a private PE firm, sharing a name prefix with Bain
-- Capital Specialty Finance, a listed BDC.
--
-- THREE ROWS ARE NOW KNOWN TO CARRY ANOTHER ISSUER'S IDENTITY. All three are
-- the same defect and none is fixed by a ticker clear alone:
--   "Compass Inc."           EHC   / cik 785161    Encompass Health   (#843)
--   "BCG"                    BCG   / cik 1953984   Binah Capital Group
--   "Bain Capital Insurance" BCSF  / cik 1655050   Bain Capital Specialty Finance
--
-- NOT DECIDED HERE, ON PURPOSE. Each needs a human to choose between renaming
-- the row to the registrant, clearing both identity columns, or splitting the
-- row. Clearing `sec_cik` is ALSO the one edit in this whole area that moves a
-- row INTO companies_name_norm_unique and can raise 23505, so it needs its own
-- analysis. No block in this file writes sec_cik, and that is deliberate.
--
-- ONE THING THAT SHOULD BE CHECKED WHATEVER IS DECIDED. Every junk row in this
-- file owns an `aliases` row pointing at ITSELF, so the surface form will
-- re-resolve to the same row after the ticker is gone. That is #843's step 2.
-- =====================================================================


-- =====================================================================
-- WILL THE PIPELINE UNDO THIS? PARTLY. READ BEFORE APPLYING.
--
-- backend/scripts/backfill_tickers.py selects on
--     .is_("ticker", "null")  AND  mention_count >= <gate>
-- and writes back whatever Finnhub's search returns for the row's name. THAT
-- SELECTION PREDICATE IS EXACTLY THE STATE THIS FILE CREATES. A re-run would
-- offer "Peloton", "Gemini", "Bain Capital", "Samsung Electronics" and the
-- rest straight back to Finnhub, which will return the same symbols. The
-- script is not wired into any workflow in .github/workflows and is run by
-- hand, so this is a "do not re-run it blind" caveat rather than a countdown.
--
-- backend/entity_resolver.py:426-441 writes a ticker AT MINT ONLY, on a
-- freshly inserted row, behind a mention_count gate and the
-- DISABLE_TICKER_POPULATION env switch. It cannot re-stamp an existing row.
--
-- backend/edgar/cik_mapping.py:163-199 writes sec_cik ONLY, never ticker, and
-- it skips any row with no ticker (`if not ticker: continue`). After this file
-- the cleared rows are invisible to it, which is the intended outcome. It also
-- carries its own holder check, so it will not mint a second holder of a CIK.
--
-- THE DURABLE FIX IS AN OVERRIDE, NOT A ONE-OFF UPDATE. CLAUDE.md names
-- HARD_TICKER_OVERRIDES as the source of truth for ambiguous names. A negative
-- entry, or a `ticker_locked` column, is what would stop the backfill from
-- re-proposing these. Designing that is a separate change and is NOT in this
-- file.
-- =====================================================================
