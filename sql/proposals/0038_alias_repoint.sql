-- =====================================================================
-- 0038_alias_repoint.sql   GROUP A, decidable alias repoints
--
--   *** PROPOSAL. NOT APPLIED. NOT EXECUTED. DO NOT RUN AS ONE SCRIPT. ***
--
-- Every statement below was WRITTEN and NONE was executed. Prod was read
-- through SELECT / GET only while this was derived.
--
-- Prior art, read first, not contradicted here:
--   sql/proposals/0020_normalize_lookup_key_v2.sql   (the v2 key function)
--   sql/proposals/0037_company_name_repair.sql       (repairs company NAMES;
--                                                     see ORDERING below)
--
-- ---------------------------------------------------------------------
-- WHAT THIS IS
-- ---------------------------------------------------------------------
-- An alias row bridges a surface form to a company row through
-- aliases.lookup_key -> aliases.canonical_id -> companies.id. It is step 4 of
-- resolveCompanyCik (src/lib/sec-filings.ts) and it is the ONLY step that can
-- reach a filer row the anchored name does not. When the bridge lands on a
-- companies row carrying neither a ticker nor a sec_cik, step 4 returns
-- nothing, the resolution falls through to step 5, cik comes back null, and
-- reconcileTickerPrivacy (src/lib/company-privacy.ts) has nothing to
-- contradict "private" with. The header prints PRIVATE and the Filings,
-- Insider and Financials tabs render their empty states, for a company that
-- files with the SEC.
--
-- This file repoints such alias rows onto the sibling that carries the
-- identity. It changes ONE COLUMN of ONE TABLE: aliases.canonical_id. It
-- inserts nothing, deletes nothing, touches no company row, and does not merge.
--
-- ---------------------------------------------------------------------
-- BLAST RADIUS, asserted against the live schema and not against the repo
-- ---------------------------------------------------------------------
-- aliases columns:  id, surface_form, lookup_key, canonical_id, mention_count,
--                   created_at, last_seen_at.
-- user_claims, morning_brief_calls and output_grades were each read live.
-- NONE of the three carries a column naming an alias, a company or a
-- canonical id; they key on target_symbol, output_id and brief_id. There is
-- no foreign key path from aliases to any of them, so no statement here can
-- reach them.
--
-- NOT PROVEN BY THAT READ, and therefore part of the preflight below: PostgREST
-- cannot show triggers or PARTIAL unique indexes. #858 established that
-- companies carries two partial unique indexes that hold NO pg_constraint row
-- and were reported absent by an audit that read pg_constraint alone. Run the
-- preflight against pg_index as well as pg_constraint before applying anything.
--
-- ---------------------------------------------------------------------
-- PREFLIGHT. Run ONCE, by hand, before any block.
-- ---------------------------------------------------------------------
-- P1. Every unique index on aliases, constraint-backed or not.
--     Expect aliases_lookup_canonical_unique UNIQUE (lookup_key, canonical_id)
--     and the id primary key. Anything else changes the G4 guard.
SELECT i.relname AS index_name, ix.indisunique, ix.indisprimary,
       pg_get_indexdef(ix.indexrelid) AS def
  FROM pg_index ix
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_class t ON t.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE n.nspname = 'public' AND t.relname = 'aliases' AND ix.indisunique;

-- P2. Constraints on aliases, for the FK and the named unique.
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid = 'public.aliases'::regclass;

-- P3. Triggers on aliases. Expect none. A trigger is the one way a
--     single-column UPDATE here could reach another table.
SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
 WHERE tgrelid = 'public.aliases'::regclass AND NOT tgisinternal;

-- P4. Anything anywhere referencing aliases(id). Expect none.
SELECT c.conrelid::regclass AS referencing_table, pg_get_constraintdef(c.oid)
  FROM pg_constraint c
 WHERE c.confrelid = 'public.aliases'::regclass;

-- ---------------------------------------------------------------------
-- ORDERING AGAINST THE COMPANY-NAME / IDENTITY REPAIR WORK
-- ---------------------------------------------------------------------
-- Every block below was derived from companies.ticker and companies.sec_cik as
-- they stood at one instant. Identity-repair work moves exactly those two
-- columns between rows. So the repair runs FIRST, this file is RE-DERIVED from
-- a fresh read, and only then is anything here applied.
--
-- Applying this file first is not merely stale, it can be actively wrong: if
-- the repair then moves an identity off a row this file just pointed an alias
-- at, the alias lands on a row with no identity and the original defect is
-- recreated one row over.
--
-- THE BLOCKS DEFEND THEMSELVES AGAINST THAT ORDER ANYWAY, which is why guards
-- G2 and G3 exist and are not decoration:
--   G2 returns 0 when the repair re-homed an identity ONTO the orphan this
--      alias already points at. The repoint is then UNNECESSARY. Skip it.
--   G3 returns 0 when the repair moved the identity OFF the target. The
--      repoint is then WRONG. Skip it and re-derive.
-- Run every guard and read every number. A block whose guards do not all
-- return their expected value is not a block to force.
--
-- ---------------------------------------------------------------------
-- GROUP A. DECIDABLE.
--
-- Admitted only when BOTH of the following hold.
--   1. The orphan and the target reduce to the SAME STRING under a normalizer
--      this repo already ships: nameMatchKey(canonicalize(name)) from
--      src/lib/data-access/aliasResolver.ts, optionally after stripping a
--      leading "the" and trailing corporate suffixes.
--   2. An authority confirms the identity, judged by the repo's own
--      namesAgree (src/lib/name-agreement.ts), the same gate every identifier
--      write already passes:
--        route SEC           cik_tickers.company_name for the target CIK
--                            agrees with BOTH the orphan name and the alias
--                            surface form.
--        route CANONICAL-MAP the curated map in company-intel.ts carries an
--                            EXPLICIT entry asserting the equivalence, and the
--                            target row's own (ticker, sec_cik) pair is present
--                            in cik_tickers. This route exists only for
--                            REBRANDS, which no name comparison can decide.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- A01   lookup_key alibaba group holding
--   from  Alibaba Group Holding Limited                (no ticker, no sec_cik)
--   to    Alibaba   [BABA / cik 1577552]
--   route SEC, candidate tier K3
--   authority Alibaba Group Holding Ltd  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'c6162d9f-ac0b-4c0c-a517-2e1ee89ee49d' AND lookup_key = 'alibaba group holding' AND canonical_id = 'c700d1e9-7e21-43f1-acb7-4244076dafa7';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'c700d1e9-7e21-43f1-acb7-4244076dafa7' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '8f41db45-612d-41f2-a04b-e0f17d8fca1a' AND ticker = 'BABA' AND sec_cik = 1577552;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'alibaba group holding' AND canonical_id = '8f41db45-612d-41f2-a04b-e0f17d8fca1a';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '8f41db45-612d-41f2-a04b-e0f17d8fca1a'
 WHERE id = 'c6162d9f-ac0b-4c0c-a517-2e1ee89ee49d' AND lookup_key = 'alibaba group holding' AND canonical_id = 'c700d1e9-7e21-43f1-acb7-4244076dafa7';

-- READ BACK. Expect one row: canonical_id 8f41db45-612d-41f2-a04b-e0f17d8fca1a, name Alibaba,
--            ticker BABA, sec_cik 1577552.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'c6162d9f-ac0b-4c0c-a517-2e1ee89ee49d';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'c700d1e9-7e21-43f1-acb7-4244076dafa7'
 WHERE id = 'c6162d9f-ac0b-4c0c-a517-2e1ee89ee49d' AND lookup_key = 'alibaba group holding' AND canonical_id = '8f41db45-612d-41f2-a04b-e0f17d8fca1a';


-- ---------------------------------------------------------------------
-- A02   lookup_key alibaba group holding limited
--   from  Alibaba Group Holding Limited                (no ticker, no sec_cik)
--   to    Alibaba   [BABA / cik 1577552]
--   route SEC, candidate tier K3
--   authority Alibaba Group Holding Ltd  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'de8e57f2-8459-49a4-8b59-9100a055ac4a' AND lookup_key = 'alibaba group holding limited' AND canonical_id = 'c700d1e9-7e21-43f1-acb7-4244076dafa7';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'c700d1e9-7e21-43f1-acb7-4244076dafa7' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '8f41db45-612d-41f2-a04b-e0f17d8fca1a' AND ticker = 'BABA' AND sec_cik = 1577552;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'alibaba group holding limited' AND canonical_id = '8f41db45-612d-41f2-a04b-e0f17d8fca1a';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '8f41db45-612d-41f2-a04b-e0f17d8fca1a'
 WHERE id = 'de8e57f2-8459-49a4-8b59-9100a055ac4a' AND lookup_key = 'alibaba group holding limited' AND canonical_id = 'c700d1e9-7e21-43f1-acb7-4244076dafa7';

-- READ BACK. Expect one row: canonical_id 8f41db45-612d-41f2-a04b-e0f17d8fca1a, name Alibaba,
--            ticker BABA, sec_cik 1577552.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'de8e57f2-8459-49a4-8b59-9100a055ac4a';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'c700d1e9-7e21-43f1-acb7-4244076dafa7'
 WHERE id = 'de8e57f2-8459-49a4-8b59-9100a055ac4a' AND lookup_key = 'alibaba group holding limited' AND canonical_id = '8f41db45-612d-41f2-a04b-e0f17d8fca1a';


-- ---------------------------------------------------------------------
-- A03   lookup_key alibaba group holding ltd
--   from  Alibaba Group Holding Limited                (no ticker, no sec_cik)
--   to    Alibaba   [BABA / cik 1577552]
--   route SEC, candidate tier K3
--   authority Alibaba Group Holding Ltd  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '2233641e-1f1a-42b2-a3d8-88b2a2c357db' AND lookup_key = 'alibaba group holding ltd' AND canonical_id = 'c700d1e9-7e21-43f1-acb7-4244076dafa7';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'c700d1e9-7e21-43f1-acb7-4244076dafa7' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '8f41db45-612d-41f2-a04b-e0f17d8fca1a' AND ticker = 'BABA' AND sec_cik = 1577552;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'alibaba group holding ltd' AND canonical_id = '8f41db45-612d-41f2-a04b-e0f17d8fca1a';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '8f41db45-612d-41f2-a04b-e0f17d8fca1a'
 WHERE id = '2233641e-1f1a-42b2-a3d8-88b2a2c357db' AND lookup_key = 'alibaba group holding ltd' AND canonical_id = 'c700d1e9-7e21-43f1-acb7-4244076dafa7';

-- READ BACK. Expect one row: canonical_id 8f41db45-612d-41f2-a04b-e0f17d8fca1a, name Alibaba,
--            ticker BABA, sec_cik 1577552.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '2233641e-1f1a-42b2-a3d8-88b2a2c357db';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'c700d1e9-7e21-43f1-acb7-4244076dafa7'
 WHERE id = '2233641e-1f1a-42b2-a3d8-88b2a2c357db' AND lookup_key = 'alibaba group holding ltd' AND canonical_id = '8f41db45-612d-41f2-a04b-e0f17d8fca1a';


-- ---------------------------------------------------------------------
-- A04   lookup_key google
--   from  Google                (no ticker, no sec_cik)
--   to    Alphabet   [GOOGL / cik 1652044]
--   route CANONICAL-MAP, candidate tier K1
--   authority Alphabet Inc.  (CANONICAL map explicitly asserts the equivalence and the target row's (ticker, cik) pair is SEC-verified)
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'd667be13-802c-48a3-8060-06f43ea418e3' AND lookup_key = 'google' AND canonical_id = '76d13453-419a-4b49-942c-8b0f6a199e9c';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '76d13453-419a-4b49-942c-8b0f6a199e9c' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'f1776f5c-0b4e-4b46-abac-dd4cb7088c8a' AND ticker = 'GOOGL' AND sec_cik = 1652044;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'google' AND canonical_id = 'f1776f5c-0b4e-4b46-abac-dd4cb7088c8a';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'f1776f5c-0b4e-4b46-abac-dd4cb7088c8a'
 WHERE id = 'd667be13-802c-48a3-8060-06f43ea418e3' AND lookup_key = 'google' AND canonical_id = '76d13453-419a-4b49-942c-8b0f6a199e9c';

-- READ BACK. Expect one row: canonical_id f1776f5c-0b4e-4b46-abac-dd4cb7088c8a, name Alphabet,
--            ticker GOOGL, sec_cik 1652044.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'd667be13-802c-48a3-8060-06f43ea418e3';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '76d13453-419a-4b49-942c-8b0f6a199e9c'
 WHERE id = 'd667be13-802c-48a3-8060-06f43ea418e3' AND lookup_key = 'google' AND canonical_id = 'f1776f5c-0b4e-4b46-abac-dd4cb7088c8a';


-- ---------------------------------------------------------------------
-- A05   lookup_key amazon.com inc
--   from  Amazon.com, Inc.                (no ticker, no sec_cik)
--   to    Amazon   [AMZN / cik 1018724]
--   route SEC, candidate tier K1
--   authority AMAZON COM INC  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '39730247-761f-4974-8ea1-12c97cab8f37' AND lookup_key = 'amazon.com inc' AND canonical_id = '2c9d3f8f-c1c1-4d48-a0e4-6ae71746a16e';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '2c9d3f8f-c1c1-4d48-a0e4-6ae71746a16e' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '71eb19c3-f009-4c32-80b1-ac01b391b225' AND ticker = 'AMZN' AND sec_cik = 1018724;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'amazon.com inc' AND canonical_id = '71eb19c3-f009-4c32-80b1-ac01b391b225';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '71eb19c3-f009-4c32-80b1-ac01b391b225'
 WHERE id = '39730247-761f-4974-8ea1-12c97cab8f37' AND lookup_key = 'amazon.com inc' AND canonical_id = '2c9d3f8f-c1c1-4d48-a0e4-6ae71746a16e';

-- READ BACK. Expect one row: canonical_id 71eb19c3-f009-4c32-80b1-ac01b391b225, name Amazon,
--            ticker AMZN, sec_cik 1018724.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '39730247-761f-4974-8ea1-12c97cab8f37';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '2c9d3f8f-c1c1-4d48-a0e4-6ae71746a16e'
 WHERE id = '39730247-761f-4974-8ea1-12c97cab8f37' AND lookup_key = 'amazon.com inc' AND canonical_id = '71eb19c3-f009-4c32-80b1-ac01b391b225';


-- ---------------------------------------------------------------------
-- A06   lookup_key amazon.com, inc.
--   from  Amazon.com, Inc.                (no ticker, no sec_cik)
--   to    Amazon   [AMZN / cik 1018724]
--   route SEC, candidate tier K1
--   authority AMAZON COM INC  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '9d77683b-067c-44cb-b850-056ceb3fdb3d' AND lookup_key = 'amazon.com, inc.' AND canonical_id = '2c9d3f8f-c1c1-4d48-a0e4-6ae71746a16e';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '2c9d3f8f-c1c1-4d48-a0e4-6ae71746a16e' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '71eb19c3-f009-4c32-80b1-ac01b391b225' AND ticker = 'AMZN' AND sec_cik = 1018724;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'amazon.com, inc.' AND canonical_id = '71eb19c3-f009-4c32-80b1-ac01b391b225';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '71eb19c3-f009-4c32-80b1-ac01b391b225'
 WHERE id = '9d77683b-067c-44cb-b850-056ceb3fdb3d' AND lookup_key = 'amazon.com, inc.' AND canonical_id = '2c9d3f8f-c1c1-4d48-a0e4-6ae71746a16e';

-- READ BACK. Expect one row: canonical_id 71eb19c3-f009-4c32-80b1-ac01b391b225, name Amazon,
--            ticker AMZN, sec_cik 1018724.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '9d77683b-067c-44cb-b850-056ceb3fdb3d';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '2c9d3f8f-c1c1-4d48-a0e4-6ae71746a16e'
 WHERE id = '9d77683b-067c-44cb-b850-056ceb3fdb3d' AND lookup_key = 'amazon.com, inc.' AND canonical_id = '71eb19c3-f009-4c32-80b1-ac01b391b225';


-- ---------------------------------------------------------------------
-- A07   lookup_key the arena group
--   from  The Arena Group Holdings, Inc.                (no ticker, no sec_cik)
--   to    Arena   [AREN / cik 894871]
--   route SEC, candidate tier K3
--   authority Arena Group Holdings, Inc.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '49f3474b-2da0-4b67-8634-3fae0da9b8a9' AND lookup_key = 'the arena group' AND canonical_id = '65ef36a4-1d0b-4bfe-a2e4-8afdfd62e997';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '65ef36a4-1d0b-4bfe-a2e4-8afdfd62e997' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'cc28edce-435a-447d-a7b8-5b165f9eeb1d' AND ticker = 'AREN' AND sec_cik = 894871;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'the arena group' AND canonical_id = 'cc28edce-435a-447d-a7b8-5b165f9eeb1d';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'cc28edce-435a-447d-a7b8-5b165f9eeb1d'
 WHERE id = '49f3474b-2da0-4b67-8634-3fae0da9b8a9' AND lookup_key = 'the arena group' AND canonical_id = '65ef36a4-1d0b-4bfe-a2e4-8afdfd62e997';

-- READ BACK. Expect one row: canonical_id cc28edce-435a-447d-a7b8-5b165f9eeb1d, name Arena,
--            ticker AREN, sec_cik 894871.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '49f3474b-2da0-4b67-8634-3fae0da9b8a9';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '65ef36a4-1d0b-4bfe-a2e4-8afdfd62e997'
 WHERE id = '49f3474b-2da0-4b67-8634-3fae0da9b8a9' AND lookup_key = 'the arena group' AND canonical_id = 'cc28edce-435a-447d-a7b8-5b165f9eeb1d';


-- ---------------------------------------------------------------------
-- A08   lookup_key the arena group holdings, inc.
--   from  The Arena Group Holdings, Inc.                (no ticker, no sec_cik)
--   to    Arena   [AREN / cik 894871]
--   route SEC, candidate tier K3
--   authority Arena Group Holdings, Inc.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '4e0e9e4a-2170-44c2-99b1-8c5a2d9f16e7' AND lookup_key = 'the arena group holdings, inc.' AND canonical_id = '65ef36a4-1d0b-4bfe-a2e4-8afdfd62e997';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '65ef36a4-1d0b-4bfe-a2e4-8afdfd62e997' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'cc28edce-435a-447d-a7b8-5b165f9eeb1d' AND ticker = 'AREN' AND sec_cik = 894871;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'the arena group holdings, inc.' AND canonical_id = 'cc28edce-435a-447d-a7b8-5b165f9eeb1d';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'cc28edce-435a-447d-a7b8-5b165f9eeb1d'
 WHERE id = '4e0e9e4a-2170-44c2-99b1-8c5a2d9f16e7' AND lookup_key = 'the arena group holdings, inc.' AND canonical_id = '65ef36a4-1d0b-4bfe-a2e4-8afdfd62e997';

-- READ BACK. Expect one row: canonical_id cc28edce-435a-447d-a7b8-5b165f9eeb1d, name Arena,
--            ticker AREN, sec_cik 894871.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '4e0e9e4a-2170-44c2-99b1-8c5a2d9f16e7';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '65ef36a4-1d0b-4bfe-a2e4-8afdfd62e997'
 WHERE id = '4e0e9e4a-2170-44c2-99b1-8c5a2d9f16e7' AND lookup_key = 'the arena group holdings, inc.' AND canonical_id = 'cc28edce-435a-447d-a7b8-5b165f9eeb1d';


-- ---------------------------------------------------------------------
-- A09   lookup_key asts
--   from  ASTS                (no ticker, no sec_cik)
--   to    AST SpaceMobile   [ASTS / cik 1780312]
--   route CANONICAL-MAP, candidate tier K1
--   authority AST SpaceMobile, Inc.  (CANONICAL map explicitly asserts the equivalence and the target row's (ticker, cik) pair is SEC-verified)
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '93ca43b9-d61f-4001-812a-7affaad8be84' AND lookup_key = 'asts' AND canonical_id = '3bf1113b-4911-47b3-a7c2-5e6196ddefb5';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '3bf1113b-4911-47b3-a7c2-5e6196ddefb5' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '0fb29d1b-ec99-4fcb-b9fb-a249784c6307' AND ticker = 'ASTS' AND sec_cik = 1780312;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'asts' AND canonical_id = '0fb29d1b-ec99-4fcb-b9fb-a249784c6307';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '0fb29d1b-ec99-4fcb-b9fb-a249784c6307'
 WHERE id = '93ca43b9-d61f-4001-812a-7affaad8be84' AND lookup_key = 'asts' AND canonical_id = '3bf1113b-4911-47b3-a7c2-5e6196ddefb5';

-- READ BACK. Expect one row: canonical_id 0fb29d1b-ec99-4fcb-b9fb-a249784c6307, name AST SpaceMobile,
--            ticker ASTS, sec_cik 1780312.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '93ca43b9-d61f-4001-812a-7affaad8be84';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '3bf1113b-4911-47b3-a7c2-5e6196ddefb5'
 WHERE id = '93ca43b9-d61f-4001-812a-7affaad8be84' AND lookup_key = 'asts' AND canonical_id = '0fb29d1b-ec99-4fcb-b9fb-a249784c6307';


-- ---------------------------------------------------------------------
-- A10   lookup_key astec industries inc.
--   from  Astec Industries Inc.                (no ticker, no sec_cik)
--   to    Astec Industries   [ASTE / cik 792987]
--   route SEC, candidate tier K1
--   authority ASTEC INDUSTRIES INC  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'c7ecc8f0-de63-481d-af19-f73506506efd' AND lookup_key = 'astec industries inc.' AND canonical_id = '187d22a5-417d-4a89-8550-b7417604981e';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '187d22a5-417d-4a89-8550-b7417604981e' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '61a72f12-3c9b-4a01-a2f2-e2e799828f30' AND ticker = 'ASTE' AND sec_cik = 792987;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'astec industries inc.' AND canonical_id = '61a72f12-3c9b-4a01-a2f2-e2e799828f30';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '61a72f12-3c9b-4a01-a2f2-e2e799828f30'
 WHERE id = 'c7ecc8f0-de63-481d-af19-f73506506efd' AND lookup_key = 'astec industries inc.' AND canonical_id = '187d22a5-417d-4a89-8550-b7417604981e';

-- READ BACK. Expect one row: canonical_id 61a72f12-3c9b-4a01-a2f2-e2e799828f30, name Astec Industries,
--            ticker ASTE, sec_cik 792987.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'c7ecc8f0-de63-481d-af19-f73506506efd';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '187d22a5-417d-4a89-8550-b7417604981e'
 WHERE id = 'c7ecc8f0-de63-481d-af19-f73506506efd' AND lookup_key = 'astec industries inc.' AND canonical_id = '61a72f12-3c9b-4a01-a2f2-e2e799828f30';


-- ---------------------------------------------------------------------
-- A11   lookup_key athena technology acquisition corp ii
--   from  Athena Technology Acquisition Corp II                (no ticker, no sec_cik)
--   to    Athena Technology Acquisition Corp. II   [ATEK / cik 1882198]
--   route SEC, candidate tier K3
--   authority Athena Technology Acquisition Corp. II  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '9870dae2-2b2a-4654-9e03-8be0a05e0707' AND lookup_key = 'athena technology acquisition corp ii' AND canonical_id = '1e637ec8-a918-48b9-9a0f-197c1b03c344';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '1e637ec8-a918-48b9-9a0f-197c1b03c344' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '27835946-2d3b-429b-a502-06289bdecccb' AND ticker = 'ATEK' AND sec_cik = 1882198;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'athena technology acquisition corp ii' AND canonical_id = '27835946-2d3b-429b-a502-06289bdecccb';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '27835946-2d3b-429b-a502-06289bdecccb'
 WHERE id = '9870dae2-2b2a-4654-9e03-8be0a05e0707' AND lookup_key = 'athena technology acquisition corp ii' AND canonical_id = '1e637ec8-a918-48b9-9a0f-197c1b03c344';

-- READ BACK. Expect one row: canonical_id 27835946-2d3b-429b-a502-06289bdecccb, name Athena Technology Acquisition Corp. II,
--            ticker ATEK, sec_cik 1882198.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '9870dae2-2b2a-4654-9e03-8be0a05e0707';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '1e637ec8-a918-48b9-9a0f-197c1b03c344'
 WHERE id = '9870dae2-2b2a-4654-9e03-8be0a05e0707' AND lookup_key = 'athena technology acquisition corp ii' AND canonical_id = '27835946-2d3b-429b-a502-06289bdecccb';


-- ---------------------------------------------------------------------
-- A12   lookup_key athena technology acquisition ii
--   from  Athena Technology Acquisition II                (no ticker, no sec_cik)
--   to    Athena Technology Acquisition Corp. II   [ATEK / cik 1882198]
--   route SEC, candidate tier K3
--   authority Athena Technology Acquisition Corp. II  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'd1c5c99c-4367-43bf-8186-50bdf1e5951e' AND lookup_key = 'athena technology acquisition ii' AND canonical_id = '7ede9d0d-f869-4c11-b3e2-0ad1823f49ce';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '7ede9d0d-f869-4c11-b3e2-0ad1823f49ce' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '27835946-2d3b-429b-a502-06289bdecccb' AND ticker = 'ATEK' AND sec_cik = 1882198;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'athena technology acquisition ii' AND canonical_id = '27835946-2d3b-429b-a502-06289bdecccb';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '27835946-2d3b-429b-a502-06289bdecccb'
 WHERE id = 'd1c5c99c-4367-43bf-8186-50bdf1e5951e' AND lookup_key = 'athena technology acquisition ii' AND canonical_id = '7ede9d0d-f869-4c11-b3e2-0ad1823f49ce';

-- READ BACK. Expect one row: canonical_id 27835946-2d3b-429b-a502-06289bdecccb, name Athena Technology Acquisition Corp. II,
--            ticker ATEK, sec_cik 1882198.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'd1c5c99c-4367-43bf-8186-50bdf1e5951e';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '7ede9d0d-f869-4c11-b3e2-0ad1823f49ce'
 WHERE id = 'd1c5c99c-4367-43bf-8186-50bdf1e5951e' AND lookup_key = 'athena technology acquisition ii' AND canonical_id = '27835946-2d3b-429b-a502-06289bdecccb';


-- ---------------------------------------------------------------------
-- A13   lookup_key c3 ai
--   from  C3 AI                (no ticker, no sec_cik)
--   to    C3.ai   [AI / cik 1577526]
--   route SEC, candidate tier K3
--   authority C3.ai, Inc.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '8dffb61d-67a5-4375-be53-55c1cf204a95' AND lookup_key = 'c3 ai' AND canonical_id = 'a56b2f1e-d474-4e56-853e-37ab15f4c74b';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'a56b2f1e-d474-4e56-853e-37ab15f4c74b' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '4253d3bc-c51e-4740-bc6a-09b2e5f8f2f3' AND ticker = 'AI' AND sec_cik = 1577526;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'c3 ai' AND canonical_id = '4253d3bc-c51e-4740-bc6a-09b2e5f8f2f3';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '4253d3bc-c51e-4740-bc6a-09b2e5f8f2f3'
 WHERE id = '8dffb61d-67a5-4375-be53-55c1cf204a95' AND lookup_key = 'c3 ai' AND canonical_id = 'a56b2f1e-d474-4e56-853e-37ab15f4c74b';

-- READ BACK. Expect one row: canonical_id 4253d3bc-c51e-4740-bc6a-09b2e5f8f2f3, name C3.ai,
--            ticker AI, sec_cik 1577526.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '8dffb61d-67a5-4375-be53-55c1cf204a95';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'a56b2f1e-d474-4e56-853e-37ab15f4c74b'
 WHERE id = '8dffb61d-67a5-4375-be53-55c1cf204a95' AND lookup_key = 'c3 ai' AND canonical_id = '4253d3bc-c51e-4740-bc6a-09b2e5f8f2f3';


-- ---------------------------------------------------------------------
-- A14   lookup_key the charles schwab
--   from  The Charles Schwab Corporation                (no ticker, no sec_cik)
--   to    Charles Schwab   [SCHW / cik 316709]
--   route SEC, candidate tier K3
--   authority SCHWAB CHARLES CORP  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'eac1897e-7438-4ea8-9cb4-9e34f4c9c990' AND lookup_key = 'the charles schwab' AND canonical_id = 'aaaa0028-9cd8-4100-a0e6-ab549e6b54da';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'aaaa0028-9cd8-4100-a0e6-ab549e6b54da' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '7d7164c9-2623-4666-bf7c-46405d21bfb5' AND ticker = 'SCHW' AND sec_cik = 316709;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'the charles schwab' AND canonical_id = '7d7164c9-2623-4666-bf7c-46405d21bfb5';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '7d7164c9-2623-4666-bf7c-46405d21bfb5'
 WHERE id = 'eac1897e-7438-4ea8-9cb4-9e34f4c9c990' AND lookup_key = 'the charles schwab' AND canonical_id = 'aaaa0028-9cd8-4100-a0e6-ab549e6b54da';

-- READ BACK. Expect one row: canonical_id 7d7164c9-2623-4666-bf7c-46405d21bfb5, name Charles Schwab,
--            ticker SCHW, sec_cik 316709.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'eac1897e-7438-4ea8-9cb4-9e34f4c9c990';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'aaaa0028-9cd8-4100-a0e6-ab549e6b54da'
 WHERE id = 'eac1897e-7438-4ea8-9cb4-9e34f4c9c990' AND lookup_key = 'the charles schwab' AND canonical_id = '7d7164c9-2623-4666-bf7c-46405d21bfb5';


-- ---------------------------------------------------------------------
-- A15   lookup_key the charles schwab corporation
--   from  The Charles Schwab Corporation                (no ticker, no sec_cik)
--   to    Charles Schwab   [SCHW / cik 316709]
--   route SEC, candidate tier K3
--   authority SCHWAB CHARLES CORP  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '6902b048-2871-4817-94d6-0b5f9e6b08f3' AND lookup_key = 'the charles schwab corporation' AND canonical_id = 'aaaa0028-9cd8-4100-a0e6-ab549e6b54da';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'aaaa0028-9cd8-4100-a0e6-ab549e6b54da' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '7d7164c9-2623-4666-bf7c-46405d21bfb5' AND ticker = 'SCHW' AND sec_cik = 316709;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'the charles schwab corporation' AND canonical_id = '7d7164c9-2623-4666-bf7c-46405d21bfb5';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '7d7164c9-2623-4666-bf7c-46405d21bfb5'
 WHERE id = '6902b048-2871-4817-94d6-0b5f9e6b08f3' AND lookup_key = 'the charles schwab corporation' AND canonical_id = 'aaaa0028-9cd8-4100-a0e6-ab549e6b54da';

-- READ BACK. Expect one row: canonical_id 7d7164c9-2623-4666-bf7c-46405d21bfb5, name Charles Schwab,
--            ticker SCHW, sec_cik 316709.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '6902b048-2871-4817-94d6-0b5f9e6b08f3';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'aaaa0028-9cd8-4100-a0e6-ab549e6b54da'
 WHERE id = '6902b048-2871-4817-94d6-0b5f9e6b08f3' AND lookup_key = 'the charles schwab corporation' AND canonical_id = '7d7164c9-2623-4666-bf7c-46405d21bfb5';


-- ---------------------------------------------------------------------
-- A16   lookup_key comcast corp
--   from  Comcast Corp                (no ticker, no sec_cik)
--   to    Comcast   [CCZ / cik 1166691]
--   route SEC, candidate tier K1
--   authority COMCAST CORP  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '16f15a57-8312-42f5-b617-6fbf30f98919' AND lookup_key = 'comcast corp' AND canonical_id = '94869a5e-64b2-4cea-a42f-e178e1584f0b';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '94869a5e-64b2-4cea-a42f-e178e1584f0b' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '0bb68d62-b42e-4c92-a369-267e6dcbebd2' AND ticker = 'CCZ' AND sec_cik = 1166691;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'comcast corp' AND canonical_id = '0bb68d62-b42e-4c92-a369-267e6dcbebd2';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '0bb68d62-b42e-4c92-a369-267e6dcbebd2'
 WHERE id = '16f15a57-8312-42f5-b617-6fbf30f98919' AND lookup_key = 'comcast corp' AND canonical_id = '94869a5e-64b2-4cea-a42f-e178e1584f0b';

-- READ BACK. Expect one row: canonical_id 0bb68d62-b42e-4c92-a369-267e6dcbebd2, name Comcast,
--            ticker CCZ, sec_cik 1166691.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '16f15a57-8312-42f5-b617-6fbf30f98919';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '94869a5e-64b2-4cea-a42f-e178e1584f0b'
 WHERE id = '16f15a57-8312-42f5-b617-6fbf30f98919' AND lookup_key = 'comcast corp' AND canonical_id = '0bb68d62-b42e-4c92-a369-267e6dcbebd2';


-- ---------------------------------------------------------------------
-- A17   lookup_key d r horton
--   from  D R Horton                (no ticker, no sec_cik)
--   to    D.R. Horton   [DHI / cik 882184]
--   route SEC, candidate tier K3
--   authority HORTON D R INC /DE/  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '8f7ffd3b-4831-4ff0-a269-ddbe606838b1' AND lookup_key = 'd r horton' AND canonical_id = '9ca6404d-f5c4-40ba-9554-09e314f1eb7f';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '9ca6404d-f5c4-40ba-9554-09e314f1eb7f' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '1280239a-dedb-4fcb-81ab-074bb55a4e7e' AND ticker = 'DHI' AND sec_cik = 882184;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'd r horton' AND canonical_id = '1280239a-dedb-4fcb-81ab-074bb55a4e7e';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '1280239a-dedb-4fcb-81ab-074bb55a4e7e'
 WHERE id = '8f7ffd3b-4831-4ff0-a269-ddbe606838b1' AND lookup_key = 'd r horton' AND canonical_id = '9ca6404d-f5c4-40ba-9554-09e314f1eb7f';

-- READ BACK. Expect one row: canonical_id 1280239a-dedb-4fcb-81ab-074bb55a4e7e, name D.R. Horton,
--            ticker DHI, sec_cik 882184.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '8f7ffd3b-4831-4ff0-a269-ddbe606838b1';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '9ca6404d-f5c4-40ba-9554-09e314f1eb7f'
 WHERE id = '8f7ffd3b-4831-4ff0-a269-ddbe606838b1' AND lookup_key = 'd r horton' AND canonical_id = '1280239a-dedb-4fcb-81ab-074bb55a4e7e';


-- ---------------------------------------------------------------------
-- A18   lookup_key docusign, inc.
--   from  Docusign, Inc.                (no ticker, no sec_cik)
--   to    Docusign   [DOCU / cik 1261333]
--   route SEC, candidate tier K1
--   authority DOCUSIGN, INC.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'a94bb143-c42d-4980-bc4f-435cf144bf0a' AND lookup_key = 'docusign, inc.' AND canonical_id = 'd0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'd0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '48be9690-c78b-4e6d-8003-71ee322cd333' AND ticker = 'DOCU' AND sec_cik = 1261333;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'docusign, inc.' AND canonical_id = '48be9690-c78b-4e6d-8003-71ee322cd333';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '48be9690-c78b-4e6d-8003-71ee322cd333'
 WHERE id = 'a94bb143-c42d-4980-bc4f-435cf144bf0a' AND lookup_key = 'docusign, inc.' AND canonical_id = 'd0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be';

-- READ BACK. Expect one row: canonical_id 48be9690-c78b-4e6d-8003-71ee322cd333, name Docusign,
--            ticker DOCU, sec_cik 1261333.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'a94bb143-c42d-4980-bc4f-435cf144bf0a';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'd0e4f1bf-ab01-4fc8-9be7-3bbdb262e3be'
 WHERE id = 'a94bb143-c42d-4980-bc4f-435cf144bf0a' AND lookup_key = 'docusign, inc.' AND canonical_id = '48be9690-c78b-4e6d-8003-71ee322cd333';


-- ---------------------------------------------------------------------
-- A19   lookup_key eightco holdings inc.
--   from  Eightco Holdings Inc.                (no ticker, no sec_cik)
--   to    Eightco   [ORBS / cik 1892492]
--   route SEC, candidate tier K1
--   authority Eightco Holdings Inc.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '45f67257-cb6f-4b11-9e20-8c3dbbbb46f5' AND lookup_key = 'eightco holdings inc.' AND canonical_id = '46f5b178-60d3-4b0c-8072-35a66d7f8cdb';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '46f5b178-60d3-4b0c-8072-35a66d7f8cdb' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '45282163-1c8a-4241-8af3-4f9c15cf8d9a' AND ticker = 'ORBS' AND sec_cik = 1892492;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'eightco holdings inc.' AND canonical_id = '45282163-1c8a-4241-8af3-4f9c15cf8d9a';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '45282163-1c8a-4241-8af3-4f9c15cf8d9a'
 WHERE id = '45f67257-cb6f-4b11-9e20-8c3dbbbb46f5' AND lookup_key = 'eightco holdings inc.' AND canonical_id = '46f5b178-60d3-4b0c-8072-35a66d7f8cdb';

-- READ BACK. Expect one row: canonical_id 45282163-1c8a-4241-8af3-4f9c15cf8d9a, name Eightco,
--            ticker ORBS, sec_cik 1892492.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '45f67257-cb6f-4b11-9e20-8c3dbbbb46f5';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '46f5b178-60d3-4b0c-8072-35a66d7f8cdb'
 WHERE id = '45f67257-cb6f-4b11-9e20-8c3dbbbb46f5' AND lookup_key = 'eightco holdings inc.' AND canonical_id = '45282163-1c8a-4241-8af3-4f9c15cf8d9a';


-- ---------------------------------------------------------------------
-- A20   lookup_key eqt holdings
--   from  EQT Holdings                (no ticker, no sec_cik)
--   to    EQT   [EQT / cik 33213]
--   route SEC, candidate tier K3
--   authority EQT Corp  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '5f043d78-418f-42e4-ac8c-7fb2f7b845c3' AND lookup_key = 'eqt holdings' AND canonical_id = '6198ce97-4c57-4578-b411-1a1a6ae9d30c';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '6198ce97-4c57-4578-b411-1a1a6ae9d30c' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '4e749a60-521a-4549-b371-6cbde0e80a46' AND ticker = 'EQT' AND sec_cik = 33213;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'eqt holdings' AND canonical_id = '4e749a60-521a-4549-b371-6cbde0e80a46';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '4e749a60-521a-4549-b371-6cbde0e80a46'
 WHERE id = '5f043d78-418f-42e4-ac8c-7fb2f7b845c3' AND lookup_key = 'eqt holdings' AND canonical_id = '6198ce97-4c57-4578-b411-1a1a6ae9d30c';

-- READ BACK. Expect one row: canonical_id 4e749a60-521a-4549-b371-6cbde0e80a46, name EQT,
--            ticker EQT, sec_cik 33213.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '5f043d78-418f-42e4-ac8c-7fb2f7b845c3';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '6198ce97-4c57-4578-b411-1a1a6ae9d30c'
 WHERE id = '5f043d78-418f-42e4-ac8c-7fb2f7b845c3' AND lookup_key = 'eqt holdings' AND canonical_id = '4e749a60-521a-4549-b371-6cbde0e80a46';


-- ---------------------------------------------------------------------
-- A21   lookup_key eqt holdings ltd.
--   from  EQT Holdings Ltd.                (no ticker, no sec_cik)
--   to    EQT   [EQT / cik 33213]
--   route SEC, candidate tier K3
--   authority EQT Corp  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '388d9cdb-2f78-4b47-8ec1-1ed8c798517e' AND lookup_key = 'eqt holdings ltd.' AND canonical_id = 'da1932f1-461e-4eeb-a534-68cb386b6fef';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'da1932f1-461e-4eeb-a534-68cb386b6fef' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '4e749a60-521a-4549-b371-6cbde0e80a46' AND ticker = 'EQT' AND sec_cik = 33213;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'eqt holdings ltd.' AND canonical_id = '4e749a60-521a-4549-b371-6cbde0e80a46';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '4e749a60-521a-4549-b371-6cbde0e80a46'
 WHERE id = '388d9cdb-2f78-4b47-8ec1-1ed8c798517e' AND lookup_key = 'eqt holdings ltd.' AND canonical_id = 'da1932f1-461e-4eeb-a534-68cb386b6fef';

-- READ BACK. Expect one row: canonical_id 4e749a60-521a-4549-b371-6cbde0e80a46, name EQT,
--            ticker EQT, sec_cik 33213.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '388d9cdb-2f78-4b47-8ec1-1ed8c798517e';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'da1932f1-461e-4eeb-a534-68cb386b6fef'
 WHERE id = '388d9cdb-2f78-4b47-8ec1-1ed8c798517e' AND lookup_key = 'eqt holdings ltd.' AND canonical_id = '4e749a60-521a-4549-b371-6cbde0e80a46';


-- ---------------------------------------------------------------------
-- A22   lookup_key genius
--   from  Genius                (no ticker, no sec_cik)
--   to    Genius Group   [GNS / cik 1847806]
--   route SEC, candidate tier K1
--   authority Genius Group Ltd  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '4f0d9f2d-4779-40b0-891f-569319cce2ca' AND lookup_key = 'genius' AND canonical_id = 'bab35444-834c-4664-877b-c2c59d857855';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'bab35444-834c-4664-877b-c2c59d857855' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'e5e6390a-ebd0-4e57-bf2f-4fdeb45031dc' AND ticker = 'GNS' AND sec_cik = 1847806;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'genius' AND canonical_id = 'e5e6390a-ebd0-4e57-bf2f-4fdeb45031dc';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'e5e6390a-ebd0-4e57-bf2f-4fdeb45031dc'
 WHERE id = '4f0d9f2d-4779-40b0-891f-569319cce2ca' AND lookup_key = 'genius' AND canonical_id = 'bab35444-834c-4664-877b-c2c59d857855';

-- READ BACK. Expect one row: canonical_id e5e6390a-ebd0-4e57-bf2f-4fdeb45031dc, name Genius Group,
--            ticker GNS, sec_cik 1847806.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '4f0d9f2d-4779-40b0-891f-569319cce2ca';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'bab35444-834c-4664-877b-c2c59d857855'
 WHERE id = '4f0d9f2d-4779-40b0-891f-569319cce2ca' AND lookup_key = 'genius' AND canonical_id = 'e5e6390a-ebd0-4e57-bf2f-4fdeb45031dc';


-- ---------------------------------------------------------------------
-- A23   lookup_key genius group limited
--   from  Genius Group Limited                (no ticker, no sec_cik)
--   to    Genius Group   [GNS / cik 1847806]
--   route SEC, candidate tier K1
--   authority Genius Group Ltd  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '94f76f7a-ac04-492d-8138-20aa37c4d09f' AND lookup_key = 'genius group limited' AND canonical_id = '18c3311f-5e29-4073-862a-3f7e2590f52e';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '18c3311f-5e29-4073-862a-3f7e2590f52e' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'e5e6390a-ebd0-4e57-bf2f-4fdeb45031dc' AND ticker = 'GNS' AND sec_cik = 1847806;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'genius group limited' AND canonical_id = 'e5e6390a-ebd0-4e57-bf2f-4fdeb45031dc';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'e5e6390a-ebd0-4e57-bf2f-4fdeb45031dc'
 WHERE id = '94f76f7a-ac04-492d-8138-20aa37c4d09f' AND lookup_key = 'genius group limited' AND canonical_id = '18c3311f-5e29-4073-862a-3f7e2590f52e';

-- READ BACK. Expect one row: canonical_id e5e6390a-ebd0-4e57-bf2f-4fdeb45031dc, name Genius Group,
--            ticker GNS, sec_cik 1847806.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '94f76f7a-ac04-492d-8138-20aa37c4d09f';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '18c3311f-5e29-4073-862a-3f7e2590f52e'
 WHERE id = '94f76f7a-ac04-492d-8138-20aa37c4d09f' AND lookup_key = 'genius group limited' AND canonical_id = 'e5e6390a-ebd0-4e57-bf2f-4fdeb45031dc';


-- ---------------------------------------------------------------------
-- A24   lookup_key genius group ltd
--   from  Genius Group Ltd                (no ticker, no sec_cik)
--   to    Genius Group   [GNS / cik 1847806]
--   route SEC, candidate tier K1
--   authority Genius Group Ltd  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '91010c0f-26b1-474a-90a6-02afbbe1271e' AND lookup_key = 'genius group ltd' AND canonical_id = '3bddf278-906b-4dff-8009-53d584aff3e1';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '3bddf278-906b-4dff-8009-53d584aff3e1' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'e5e6390a-ebd0-4e57-bf2f-4fdeb45031dc' AND ticker = 'GNS' AND sec_cik = 1847806;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'genius group ltd' AND canonical_id = 'e5e6390a-ebd0-4e57-bf2f-4fdeb45031dc';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'e5e6390a-ebd0-4e57-bf2f-4fdeb45031dc'
 WHERE id = '91010c0f-26b1-474a-90a6-02afbbe1271e' AND lookup_key = 'genius group ltd' AND canonical_id = '3bddf278-906b-4dff-8009-53d584aff3e1';

-- READ BACK. Expect one row: canonical_id e5e6390a-ebd0-4e57-bf2f-4fdeb45031dc, name Genius Group,
--            ticker GNS, sec_cik 1847806.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '91010c0f-26b1-474a-90a6-02afbbe1271e';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '3bddf278-906b-4dff-8009-53d584aff3e1'
 WHERE id = '91010c0f-26b1-474a-90a6-02afbbe1271e' AND lookup_key = 'genius group ltd' AND canonical_id = 'e5e6390a-ebd0-4e57-bf2f-4fdeb45031dc';


-- ---------------------------------------------------------------------
-- A25   lookup_key goldman sachs international
--   from  Goldman Sachs International                (no ticker, no sec_cik)
--   to    Goldman Sachs   [GS / cik 886982]
--   route SEC, candidate tier K1
--   authority GOLDMAN SACHS GROUP INC  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '2a3723fd-553d-47d3-827c-f69274ca1a42' AND lookup_key = 'goldman sachs international' AND canonical_id = '1cd7e75e-b876-4292-80ef-07a8a32718a7';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '1cd7e75e-b876-4292-80ef-07a8a32718a7' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '86094111-a21a-4128-9733-3b5aa2f0e58c' AND ticker = 'GS' AND sec_cik = 886982;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'goldman sachs international' AND canonical_id = '86094111-a21a-4128-9733-3b5aa2f0e58c';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '86094111-a21a-4128-9733-3b5aa2f0e58c'
 WHERE id = '2a3723fd-553d-47d3-827c-f69274ca1a42' AND lookup_key = 'goldman sachs international' AND canonical_id = '1cd7e75e-b876-4292-80ef-07a8a32718a7';

-- READ BACK. Expect one row: canonical_id 86094111-a21a-4128-9733-3b5aa2f0e58c, name Goldman Sachs,
--            ticker GS, sec_cik 886982.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '2a3723fd-553d-47d3-827c-f69274ca1a42';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '1cd7e75e-b876-4292-80ef-07a8a32718a7'
 WHERE id = '2a3723fd-553d-47d3-827c-f69274ca1a42' AND lookup_key = 'goldman sachs international' AND canonical_id = '86094111-a21a-4128-9733-3b5aa2f0e58c';


-- ---------------------------------------------------------------------
-- A26   lookup_key the goldman sachs group
--   from  The Goldman Sachs Group, Inc.                (no ticker, no sec_cik)
--   to    Goldman Sachs   [GS / cik 886982]
--   route SEC, candidate tier K3
--   authority GOLDMAN SACHS GROUP INC  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'f3fbf142-cedf-4d57-8649-1576f63aba1d' AND lookup_key = 'the goldman sachs group' AND canonical_id = '56e5d2f0-6cd6-49e4-90a3-7075fd8469fd';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '56e5d2f0-6cd6-49e4-90a3-7075fd8469fd' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '86094111-a21a-4128-9733-3b5aa2f0e58c' AND ticker = 'GS' AND sec_cik = 886982;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'the goldman sachs group' AND canonical_id = '86094111-a21a-4128-9733-3b5aa2f0e58c';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '86094111-a21a-4128-9733-3b5aa2f0e58c'
 WHERE id = 'f3fbf142-cedf-4d57-8649-1576f63aba1d' AND lookup_key = 'the goldman sachs group' AND canonical_id = '56e5d2f0-6cd6-49e4-90a3-7075fd8469fd';

-- READ BACK. Expect one row: canonical_id 86094111-a21a-4128-9733-3b5aa2f0e58c, name Goldman Sachs,
--            ticker GS, sec_cik 886982.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'f3fbf142-cedf-4d57-8649-1576f63aba1d';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '56e5d2f0-6cd6-49e4-90a3-7075fd8469fd'
 WHERE id = 'f3fbf142-cedf-4d57-8649-1576f63aba1d' AND lookup_key = 'the goldman sachs group' AND canonical_id = '86094111-a21a-4128-9733-3b5aa2f0e58c';


-- ---------------------------------------------------------------------
-- A27   lookup_key the goldman sachs group inc
--   from  The Goldman Sachs Group, Inc.                (no ticker, no sec_cik)
--   to    Goldman Sachs   [GS / cik 886982]
--   route SEC, candidate tier K3
--   authority GOLDMAN SACHS GROUP INC  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'c1641b10-7a57-4844-a5b7-21c2c52420e4' AND lookup_key = 'the goldman sachs group inc' AND canonical_id = '56e5d2f0-6cd6-49e4-90a3-7075fd8469fd';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '56e5d2f0-6cd6-49e4-90a3-7075fd8469fd' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '86094111-a21a-4128-9733-3b5aa2f0e58c' AND ticker = 'GS' AND sec_cik = 886982;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'the goldman sachs group inc' AND canonical_id = '86094111-a21a-4128-9733-3b5aa2f0e58c';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '86094111-a21a-4128-9733-3b5aa2f0e58c'
 WHERE id = 'c1641b10-7a57-4844-a5b7-21c2c52420e4' AND lookup_key = 'the goldman sachs group inc' AND canonical_id = '56e5d2f0-6cd6-49e4-90a3-7075fd8469fd';

-- READ BACK. Expect one row: canonical_id 86094111-a21a-4128-9733-3b5aa2f0e58c, name Goldman Sachs,
--            ticker GS, sec_cik 886982.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'c1641b10-7a57-4844-a5b7-21c2c52420e4';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '56e5d2f0-6cd6-49e4-90a3-7075fd8469fd'
 WHERE id = 'c1641b10-7a57-4844-a5b7-21c2c52420e4' AND lookup_key = 'the goldman sachs group inc' AND canonical_id = '86094111-a21a-4128-9733-3b5aa2f0e58c';


-- ---------------------------------------------------------------------
-- A28   lookup_key the goldman sachs group, inc.
--   from  The Goldman Sachs Group, Inc.                (no ticker, no sec_cik)
--   to    Goldman Sachs   [GS / cik 886982]
--   route SEC, candidate tier K3
--   authority GOLDMAN SACHS GROUP INC  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'bcd8198a-5ffb-482a-afd5-378291653237' AND lookup_key = 'the goldman sachs group, inc.' AND canonical_id = '56e5d2f0-6cd6-49e4-90a3-7075fd8469fd';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '56e5d2f0-6cd6-49e4-90a3-7075fd8469fd' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '86094111-a21a-4128-9733-3b5aa2f0e58c' AND ticker = 'GS' AND sec_cik = 886982;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'the goldman sachs group, inc.' AND canonical_id = '86094111-a21a-4128-9733-3b5aa2f0e58c';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '86094111-a21a-4128-9733-3b5aa2f0e58c'
 WHERE id = 'bcd8198a-5ffb-482a-afd5-378291653237' AND lookup_key = 'the goldman sachs group, inc.' AND canonical_id = '56e5d2f0-6cd6-49e4-90a3-7075fd8469fd';

-- READ BACK. Expect one row: canonical_id 86094111-a21a-4128-9733-3b5aa2f0e58c, name Goldman Sachs,
--            ticker GS, sec_cik 886982.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'bcd8198a-5ffb-482a-afd5-378291653237';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '56e5d2f0-6cd6-49e4-90a3-7075fd8469fd'
 WHERE id = 'bcd8198a-5ffb-482a-afd5-378291653237' AND lookup_key = 'the goldman sachs group, inc.' AND canonical_id = '86094111-a21a-4128-9733-3b5aa2f0e58c';


-- ---------------------------------------------------------------------
-- A29   lookup_key hp inc.
--   from  HP Inc.                (no ticker, no sec_cik)
--   to    HP Inc   [HPQ / cik 47217]
--   route SEC, candidate tier K1
--   authority HP INC  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '6eb3f539-f574-4ef1-b1e8-a914f66f02cd' AND lookup_key = 'hp inc.' AND canonical_id = '60b1dfa6-435c-472c-a101-b039580ff76d';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '60b1dfa6-435c-472c-a101-b039580ff76d' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'e3545c5d-13d3-4bb5-8fb2-1544aee7e756' AND ticker = 'HPQ' AND sec_cik = 47217;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'hp inc.' AND canonical_id = 'e3545c5d-13d3-4bb5-8fb2-1544aee7e756';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'e3545c5d-13d3-4bb5-8fb2-1544aee7e756'
 WHERE id = '6eb3f539-f574-4ef1-b1e8-a914f66f02cd' AND lookup_key = 'hp inc.' AND canonical_id = '60b1dfa6-435c-472c-a101-b039580ff76d';

-- READ BACK. Expect one row: canonical_id e3545c5d-13d3-4bb5-8fb2-1544aee7e756, name HP Inc,
--            ticker HPQ, sec_cik 47217.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '6eb3f539-f574-4ef1-b1e8-a914f66f02cd';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '60b1dfa6-435c-472c-a101-b039580ff76d'
 WHERE id = '6eb3f539-f574-4ef1-b1e8-a914f66f02cd' AND lookup_key = 'hp inc.' AND canonical_id = 'e3545c5d-13d3-4bb5-8fb2-1544aee7e756';


-- ---------------------------------------------------------------------
-- A30   lookup_key hp, inc.
--   from  HP, Inc.                (no ticker, no sec_cik)
--   to    HP Inc   [HPQ / cik 47217]
--   route SEC, candidate tier K3
--   authority HP INC  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '0fafdc41-be4d-4f9a-a1a0-4abe6e57b658' AND lookup_key = 'hp, inc.' AND canonical_id = '89e2631d-47a1-4e43-9a6c-84c1589004fb';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '89e2631d-47a1-4e43-9a6c-84c1589004fb' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'e3545c5d-13d3-4bb5-8fb2-1544aee7e756' AND ticker = 'HPQ' AND sec_cik = 47217;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'hp, inc.' AND canonical_id = 'e3545c5d-13d3-4bb5-8fb2-1544aee7e756';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'e3545c5d-13d3-4bb5-8fb2-1544aee7e756'
 WHERE id = '0fafdc41-be4d-4f9a-a1a0-4abe6e57b658' AND lookup_key = 'hp, inc.' AND canonical_id = '89e2631d-47a1-4e43-9a6c-84c1589004fb';

-- READ BACK. Expect one row: canonical_id e3545c5d-13d3-4bb5-8fb2-1544aee7e756, name HP Inc,
--            ticker HPQ, sec_cik 47217.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '0fafdc41-be4d-4f9a-a1a0-4abe6e57b658';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '89e2631d-47a1-4e43-9a6c-84c1589004fb'
 WHERE id = '0fafdc41-be4d-4f9a-a1a0-4abe6e57b658' AND lookup_key = 'hp, inc.' AND canonical_id = 'e3545c5d-13d3-4bb5-8fb2-1544aee7e756';


-- ---------------------------------------------------------------------
-- A31   lookup_key international business machines
--   from  International Business Machines                (no ticker, no sec_cik)
--   to    IBM   [IBM / cik 51143]
--   route SEC, candidate tier K1
--   authority INTERNATIONAL BUSINESS MACHINES CORP  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'c34cfb0e-b672-428a-9036-06b9aedd4fb8' AND lookup_key = 'international business machines' AND canonical_id = 'cf81de3f-e8a4-484c-9e54-5b2d17b8f6e9';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'cf81de3f-e8a4-484c-9e54-5b2d17b8f6e9' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '9b85228f-8174-478d-b7f6-1acd76bf0117' AND ticker = 'IBM' AND sec_cik = 51143;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'international business machines' AND canonical_id = '9b85228f-8174-478d-b7f6-1acd76bf0117';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '9b85228f-8174-478d-b7f6-1acd76bf0117'
 WHERE id = 'c34cfb0e-b672-428a-9036-06b9aedd4fb8' AND lookup_key = 'international business machines' AND canonical_id = 'cf81de3f-e8a4-484c-9e54-5b2d17b8f6e9';

-- READ BACK. Expect one row: canonical_id 9b85228f-8174-478d-b7f6-1acd76bf0117, name IBM,
--            ticker IBM, sec_cik 51143.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'c34cfb0e-b672-428a-9036-06b9aedd4fb8';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'cf81de3f-e8a4-484c-9e54-5b2d17b8f6e9'
 WHERE id = 'c34cfb0e-b672-428a-9036-06b9aedd4fb8' AND lookup_key = 'international business machines' AND canonical_id = '9b85228f-8174-478d-b7f6-1acd76bf0117';


-- ---------------------------------------------------------------------
-- A32   lookup_key international business machines corp
--   from  International Business Machines                (no ticker, no sec_cik)
--   to    IBM   [IBM / cik 51143]
--   route SEC, candidate tier K1
--   authority INTERNATIONAL BUSINESS MACHINES CORP  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '0792b4d3-c059-4d6d-85c9-26f4432a8ce3' AND lookup_key = 'international business machines corp' AND canonical_id = 'cf81de3f-e8a4-484c-9e54-5b2d17b8f6e9';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'cf81de3f-e8a4-484c-9e54-5b2d17b8f6e9' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '9b85228f-8174-478d-b7f6-1acd76bf0117' AND ticker = 'IBM' AND sec_cik = 51143;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'international business machines corp' AND canonical_id = '9b85228f-8174-478d-b7f6-1acd76bf0117';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '9b85228f-8174-478d-b7f6-1acd76bf0117'
 WHERE id = '0792b4d3-c059-4d6d-85c9-26f4432a8ce3' AND lookup_key = 'international business machines corp' AND canonical_id = 'cf81de3f-e8a4-484c-9e54-5b2d17b8f6e9';

-- READ BACK. Expect one row: canonical_id 9b85228f-8174-478d-b7f6-1acd76bf0117, name IBM,
--            ticker IBM, sec_cik 51143.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '0792b4d3-c059-4d6d-85c9-26f4432a8ce3';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'cf81de3f-e8a4-484c-9e54-5b2d17b8f6e9'
 WHERE id = '0792b4d3-c059-4d6d-85c9-26f4432a8ce3' AND lookup_key = 'international business machines corp' AND canonical_id = '9b85228f-8174-478d-b7f6-1acd76bf0117';


-- ---------------------------------------------------------------------
-- A33   lookup_key international business machines corp.
--   from  International Business Machines                (no ticker, no sec_cik)
--   to    IBM   [IBM / cik 51143]
--   route SEC, candidate tier K1
--   authority INTERNATIONAL BUSINESS MACHINES CORP  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '973d9b5f-0bfe-44f3-b510-33483b4205a1' AND lookup_key = 'international business machines corp.' AND canonical_id = 'cf81de3f-e8a4-484c-9e54-5b2d17b8f6e9';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'cf81de3f-e8a4-484c-9e54-5b2d17b8f6e9' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '9b85228f-8174-478d-b7f6-1acd76bf0117' AND ticker = 'IBM' AND sec_cik = 51143;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'international business machines corp.' AND canonical_id = '9b85228f-8174-478d-b7f6-1acd76bf0117';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '9b85228f-8174-478d-b7f6-1acd76bf0117'
 WHERE id = '973d9b5f-0bfe-44f3-b510-33483b4205a1' AND lookup_key = 'international business machines corp.' AND canonical_id = 'cf81de3f-e8a4-484c-9e54-5b2d17b8f6e9';

-- READ BACK. Expect one row: canonical_id 9b85228f-8174-478d-b7f6-1acd76bf0117, name IBM,
--            ticker IBM, sec_cik 51143.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '973d9b5f-0bfe-44f3-b510-33483b4205a1';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'cf81de3f-e8a4-484c-9e54-5b2d17b8f6e9'
 WHERE id = '973d9b5f-0bfe-44f3-b510-33483b4205a1' AND lookup_key = 'international business machines corp.' AND canonical_id = '9b85228f-8174-478d-b7f6-1acd76bf0117';


-- ---------------------------------------------------------------------
-- A34   lookup_key international business machines corporation
--   from  International Business Machines                (no ticker, no sec_cik)
--   to    IBM   [IBM / cik 51143]
--   route SEC, candidate tier K1
--   authority INTERNATIONAL BUSINESS MACHINES CORP  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'c1ae51b2-e60f-40be-ae90-a7f7e5c2ad2d' AND lookup_key = 'international business machines corporation' AND canonical_id = 'cf81de3f-e8a4-484c-9e54-5b2d17b8f6e9';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'cf81de3f-e8a4-484c-9e54-5b2d17b8f6e9' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '9b85228f-8174-478d-b7f6-1acd76bf0117' AND ticker = 'IBM' AND sec_cik = 51143;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'international business machines corporation' AND canonical_id = '9b85228f-8174-478d-b7f6-1acd76bf0117';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '9b85228f-8174-478d-b7f6-1acd76bf0117'
 WHERE id = 'c1ae51b2-e60f-40be-ae90-a7f7e5c2ad2d' AND lookup_key = 'international business machines corporation' AND canonical_id = 'cf81de3f-e8a4-484c-9e54-5b2d17b8f6e9';

-- READ BACK. Expect one row: canonical_id 9b85228f-8174-478d-b7f6-1acd76bf0117, name IBM,
--            ticker IBM, sec_cik 51143.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'c1ae51b2-e60f-40be-ae90-a7f7e5c2ad2d';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'cf81de3f-e8a4-484c-9e54-5b2d17b8f6e9'
 WHERE id = 'c1ae51b2-e60f-40be-ae90-a7f7e5c2ad2d' AND lookup_key = 'international business machines corporation' AND canonical_id = '9b85228f-8174-478d-b7f6-1acd76bf0117';


-- ---------------------------------------------------------------------
-- A35   lookup_key lockheed martin company
--   from  Lockheed Martin Company                (no ticker, no sec_cik)
--   to    Lockheed Martin   [LMT / cik 936468]
--   route SEC, candidate tier K3
--   authority LOCKHEED MARTIN CORP  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '7a601806-4eb1-4fba-b759-89bb9f8b8593' AND lookup_key = 'lockheed martin company' AND canonical_id = '349f8721-b574-4ebd-8134-f84db1e987cb';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '349f8721-b574-4ebd-8134-f84db1e987cb' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'a1830700-5279-4d0f-8050-3c51af388640' AND ticker = 'LMT' AND sec_cik = 936468;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'lockheed martin company' AND canonical_id = 'a1830700-5279-4d0f-8050-3c51af388640';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'a1830700-5279-4d0f-8050-3c51af388640'
 WHERE id = '7a601806-4eb1-4fba-b759-89bb9f8b8593' AND lookup_key = 'lockheed martin company' AND canonical_id = '349f8721-b574-4ebd-8134-f84db1e987cb';

-- READ BACK. Expect one row: canonical_id a1830700-5279-4d0f-8050-3c51af388640, name Lockheed Martin,
--            ticker LMT, sec_cik 936468.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '7a601806-4eb1-4fba-b759-89bb9f8b8593';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '349f8721-b574-4ebd-8134-f84db1e987cb'
 WHERE id = '7a601806-4eb1-4fba-b759-89bb9f8b8593' AND lookup_key = 'lockheed martin company' AND canonical_id = 'a1830700-5279-4d0f-8050-3c51af388640';


-- ---------------------------------------------------------------------
-- A36   lookup_key facebook
--   from  Facebook                (no ticker, no sec_cik)
--   to    Meta   [META / cik 1326801]
--   route CANONICAL-MAP, candidate tier K1
--   authority Meta Platforms, Inc.  (CANONICAL map explicitly asserts the equivalence and the target row's (ticker, cik) pair is SEC-verified)
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '30b24465-1ff1-4bcf-8b8a-4fcd1969b210' AND lookup_key = 'facebook' AND canonical_id = '4c603dfe-e823-4903-a0f2-441349203e6a';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '4c603dfe-e823-4903-a0f2-441349203e6a' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'e5167a14-2cdf-46c2-8291-b0a23d6b1abb' AND ticker = 'META' AND sec_cik = 1326801;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'facebook' AND canonical_id = 'e5167a14-2cdf-46c2-8291-b0a23d6b1abb';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'e5167a14-2cdf-46c2-8291-b0a23d6b1abb'
 WHERE id = '30b24465-1ff1-4bcf-8b8a-4fcd1969b210' AND lookup_key = 'facebook' AND canonical_id = '4c603dfe-e823-4903-a0f2-441349203e6a';

-- READ BACK. Expect one row: canonical_id e5167a14-2cdf-46c2-8291-b0a23d6b1abb, name Meta,
--            ticker META, sec_cik 1326801.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '30b24465-1ff1-4bcf-8b8a-4fcd1969b210';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '4c603dfe-e823-4903-a0f2-441349203e6a'
 WHERE id = '30b24465-1ff1-4bcf-8b8a-4fcd1969b210' AND lookup_key = 'facebook' AND canonical_id = 'e5167a14-2cdf-46c2-8291-b0a23d6b1abb';


-- ---------------------------------------------------------------------
-- A37   lookup_key meta platforms inc
--   from  Meta Platforms Inc                (no ticker, no sec_cik)
--   to    Meta   [META / cik 1326801]
--   route SEC, candidate tier K1
--   authority Meta Platforms, Inc.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'ecb0e8f6-9815-47ef-9eab-6c1b19afb967' AND lookup_key = 'meta platforms inc' AND canonical_id = 'e788abfa-fe29-4444-9737-517a0446694d';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'e788abfa-fe29-4444-9737-517a0446694d' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'e5167a14-2cdf-46c2-8291-b0a23d6b1abb' AND ticker = 'META' AND sec_cik = 1326801;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'meta platforms inc' AND canonical_id = 'e5167a14-2cdf-46c2-8291-b0a23d6b1abb';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'e5167a14-2cdf-46c2-8291-b0a23d6b1abb'
 WHERE id = 'ecb0e8f6-9815-47ef-9eab-6c1b19afb967' AND lookup_key = 'meta platforms inc' AND canonical_id = 'e788abfa-fe29-4444-9737-517a0446694d';

-- READ BACK. Expect one row: canonical_id e5167a14-2cdf-46c2-8291-b0a23d6b1abb, name Meta,
--            ticker META, sec_cik 1326801.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'ecb0e8f6-9815-47ef-9eab-6c1b19afb967';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'e788abfa-fe29-4444-9737-517a0446694d'
 WHERE id = 'ecb0e8f6-9815-47ef-9eab-6c1b19afb967' AND lookup_key = 'meta platforms inc' AND canonical_id = 'e5167a14-2cdf-46c2-8291-b0a23d6b1abb';


-- ---------------------------------------------------------------------
-- A38   lookup_key nu
--   from  NU                (no ticker, no sec_cik)
--   to    Nu Holdings   [NU / cik 1691493]
--   route SEC, candidate tier K3
--   authority Nu Holdings Ltd.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'fa89db9a-1533-491b-8ca6-6364e970e759' AND lookup_key = 'nu' AND canonical_id = 'a1bf15c0-bfe1-4b47-89ba-ac77c3c75896';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'a1bf15c0-bfe1-4b47-89ba-ac77c3c75896' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '94fa2632-b6f5-48ab-a27e-5adb8c0ceb90' AND ticker = 'NU' AND sec_cik = 1691493;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'nu' AND canonical_id = '94fa2632-b6f5-48ab-a27e-5adb8c0ceb90';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '94fa2632-b6f5-48ab-a27e-5adb8c0ceb90'
 WHERE id = 'fa89db9a-1533-491b-8ca6-6364e970e759' AND lookup_key = 'nu' AND canonical_id = 'a1bf15c0-bfe1-4b47-89ba-ac77c3c75896';

-- READ BACK. Expect one row: canonical_id 94fa2632-b6f5-48ab-a27e-5adb8c0ceb90, name Nu Holdings,
--            ticker NU, sec_cik 1691493.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'fa89db9a-1533-491b-8ca6-6364e970e759';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'a1bf15c0-bfe1-4b47-89ba-ac77c3c75896'
 WHERE id = 'fa89db9a-1533-491b-8ca6-6364e970e759' AND lookup_key = 'nu' AND canonical_id = '94fa2632-b6f5-48ab-a27e-5adb8c0ceb90';


-- ---------------------------------------------------------------------
-- A39   lookup_key nu holdings ltd.
--   from  Nu Holdings Ltd.                (no ticker, no sec_cik)
--   to    Nu Holdings   [NU / cik 1691493]
--   route SEC, candidate tier K3
--   authority Nu Holdings Ltd.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'ce8073f4-9a2e-48b7-b53d-beff23ce1e0c' AND lookup_key = 'nu holdings ltd.' AND canonical_id = '9439306a-e39d-4087-afc2-de55fd46217d';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '9439306a-e39d-4087-afc2-de55fd46217d' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '94fa2632-b6f5-48ab-a27e-5adb8c0ceb90' AND ticker = 'NU' AND sec_cik = 1691493;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'nu holdings ltd.' AND canonical_id = '94fa2632-b6f5-48ab-a27e-5adb8c0ceb90';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '94fa2632-b6f5-48ab-a27e-5adb8c0ceb90'
 WHERE id = 'ce8073f4-9a2e-48b7-b53d-beff23ce1e0c' AND lookup_key = 'nu holdings ltd.' AND canonical_id = '9439306a-e39d-4087-afc2-de55fd46217d';

-- READ BACK. Expect one row: canonical_id 94fa2632-b6f5-48ab-a27e-5adb8c0ceb90, name Nu Holdings,
--            ticker NU, sec_cik 1691493.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'ce8073f4-9a2e-48b7-b53d-beff23ce1e0c';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '9439306a-e39d-4087-afc2-de55fd46217d'
 WHERE id = 'ce8073f4-9a2e-48b7-b53d-beff23ce1e0c' AND lookup_key = 'nu holdings ltd.' AND canonical_id = '94fa2632-b6f5-48ab-a27e-5adb8c0ceb90';


-- ---------------------------------------------------------------------
-- A40   lookup_key oil-dri of america
--   from  Oil-Dri of America                (no ticker, no sec_cik)
--   to    Oil-Dri Corporation of America   [ODC / cik 74046]
--   route SEC, candidate tier K3
--   authority Oil-Dri Corp of America  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '864ce828-3230-4fb4-b3d4-b80f1df08514' AND lookup_key = 'oil-dri of america' AND canonical_id = '80c386d8-f707-4fdf-80ef-5530f533caf4';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '80c386d8-f707-4fdf-80ef-5530f533caf4' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '8353d930-5de0-478c-8083-34d425e8340e' AND ticker = 'ODC' AND sec_cik = 74046;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'oil-dri of america' AND canonical_id = '8353d930-5de0-478c-8083-34d425e8340e';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '8353d930-5de0-478c-8083-34d425e8340e'
 WHERE id = '864ce828-3230-4fb4-b3d4-b80f1df08514' AND lookup_key = 'oil-dri of america' AND canonical_id = '80c386d8-f707-4fdf-80ef-5530f533caf4';

-- READ BACK. Expect one row: canonical_id 8353d930-5de0-478c-8083-34d425e8340e, name Oil-Dri Corporation of America,
--            ticker ODC, sec_cik 74046.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '864ce828-3230-4fb4-b3d4-b80f1df08514';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '80c386d8-f707-4fdf-80ef-5530f533caf4'
 WHERE id = '864ce828-3230-4fb4-b3d4-b80f1df08514' AND lookup_key = 'oil-dri of america' AND canonical_id = '8353d930-5de0-478c-8083-34d425e8340e';


-- ---------------------------------------------------------------------
-- A41   lookup_key orcl
--   from  ORCL                (no ticker, no sec_cik)
--   to    Oracle   [ORCL / cik 1341439]
--   route SEC, candidate tier K1
--   authority ORACLE CORP  (SEC registrant name agrees (ratio 0.80))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'b277f29c-486d-493c-abfe-c31bb39ba4c5' AND lookup_key = 'orcl' AND canonical_id = 'b2bf6ef6-ca22-447f-8e89-43d6cf99e6b0';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'b2bf6ef6-ca22-447f-8e89-43d6cf99e6b0' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '3fa0a250-a648-4e09-8c69-8a01dc9d3ec4' AND ticker = 'ORCL' AND sec_cik = 1341439;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'orcl' AND canonical_id = '3fa0a250-a648-4e09-8c69-8a01dc9d3ec4';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '3fa0a250-a648-4e09-8c69-8a01dc9d3ec4'
 WHERE id = 'b277f29c-486d-493c-abfe-c31bb39ba4c5' AND lookup_key = 'orcl' AND canonical_id = 'b2bf6ef6-ca22-447f-8e89-43d6cf99e6b0';

-- READ BACK. Expect one row: canonical_id 3fa0a250-a648-4e09-8c69-8a01dc9d3ec4, name Oracle,
--            ticker ORCL, sec_cik 1341439.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'b277f29c-486d-493c-abfe-c31bb39ba4c5';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'b2bf6ef6-ca22-447f-8e89-43d6cf99e6b0'
 WHERE id = 'b277f29c-486d-493c-abfe-c31bb39ba4c5' AND lookup_key = 'orcl' AND canonical_id = '3fa0a250-a648-4e09-8c69-8a01dc9d3ec4';


-- ---------------------------------------------------------------------
-- A42   lookup_key palo alto networks inc.
--   from  Palo Alto Networks Inc.                (no ticker, no sec_cik)
--   to    Palo Alto Networks   [PANW / cik 1327567]
--   route SEC, candidate tier K1
--   authority Palo Alto Networks Inc  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'dda7f258-50a0-410f-b5ab-2b722a02c9cb' AND lookup_key = 'palo alto networks inc.' AND canonical_id = '0d22785b-842f-4027-9490-ab1c5ceccf39';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '0d22785b-842f-4027-9490-ab1c5ceccf39' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '62c7af87-727c-4102-8f01-ad4cc1939810' AND ticker = 'PANW' AND sec_cik = 1327567;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'palo alto networks inc.' AND canonical_id = '62c7af87-727c-4102-8f01-ad4cc1939810';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '62c7af87-727c-4102-8f01-ad4cc1939810'
 WHERE id = 'dda7f258-50a0-410f-b5ab-2b722a02c9cb' AND lookup_key = 'palo alto networks inc.' AND canonical_id = '0d22785b-842f-4027-9490-ab1c5ceccf39';

-- READ BACK. Expect one row: canonical_id 62c7af87-727c-4102-8f01-ad4cc1939810, name Palo Alto Networks,
--            ticker PANW, sec_cik 1327567.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'dda7f258-50a0-410f-b5ab-2b722a02c9cb';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '0d22785b-842f-4027-9490-ab1c5ceccf39'
 WHERE id = 'dda7f258-50a0-410f-b5ab-2b722a02c9cb' AND lookup_key = 'palo alto networks inc.' AND canonical_id = '62c7af87-727c-4102-8f01-ad4cc1939810';


-- ---------------------------------------------------------------------
-- A43   lookup_key pony.ai
--   from  Pony.ai                (no ticker, no sec_cik)
--   to    Pony AI   [PONY / cik 1969302]
--   route SEC, candidate tier K3
--   authority Pony AI Inc.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'bd0caa98-e0d5-42e7-b24f-da719a446983' AND lookup_key = 'pony.ai' AND canonical_id = '318e049a-23d4-402f-bdcd-7700cb7992af';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '318e049a-23d4-402f-bdcd-7700cb7992af' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '1e912c24-c0d2-46d6-a675-cf5a86890c2f' AND ticker = 'PONY' AND sec_cik = 1969302;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'pony.ai' AND canonical_id = '1e912c24-c0d2-46d6-a675-cf5a86890c2f';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '1e912c24-c0d2-46d6-a675-cf5a86890c2f'
 WHERE id = 'bd0caa98-e0d5-42e7-b24f-da719a446983' AND lookup_key = 'pony.ai' AND canonical_id = '318e049a-23d4-402f-bdcd-7700cb7992af';

-- READ BACK. Expect one row: canonical_id 1e912c24-c0d2-46d6-a675-cf5a86890c2f, name Pony AI,
--            ticker PONY, sec_cik 1969302.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'bd0caa98-e0d5-42e7-b24f-da719a446983';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '318e049a-23d4-402f-bdcd-7700cb7992af'
 WHERE id = 'bd0caa98-e0d5-42e7-b24f-da719a446983' AND lookup_key = 'pony.ai' AND canonical_id = '1e912c24-c0d2-46d6-a675-cf5a86890c2f';


-- ---------------------------------------------------------------------
-- A44   lookup_key rocket lab usa
--   from  Rocket Lab USA                (no ticker, no sec_cik)
--   to    Rocket Lab   [RKLB / cik 1819994]
--   route SEC, candidate tier K1
--   authority Rocket Lab Corp  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '05d34535-92e2-4ae1-ab27-cb798109d893' AND lookup_key = 'rocket lab usa' AND canonical_id = 'b299ef09-05a2-4abd-938a-1bde3daa920f';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'b299ef09-05a2-4abd-938a-1bde3daa920f' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '1961dd1f-2f41-4a14-b4a8-d532539e10d6' AND ticker = 'RKLB' AND sec_cik = 1819994;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'rocket lab usa' AND canonical_id = '1961dd1f-2f41-4a14-b4a8-d532539e10d6';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '1961dd1f-2f41-4a14-b4a8-d532539e10d6'
 WHERE id = '05d34535-92e2-4ae1-ab27-cb798109d893' AND lookup_key = 'rocket lab usa' AND canonical_id = 'b299ef09-05a2-4abd-938a-1bde3daa920f';

-- READ BACK. Expect one row: canonical_id 1961dd1f-2f41-4a14-b4a8-d532539e10d6, name Rocket Lab,
--            ticker RKLB, sec_cik 1819994.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '05d34535-92e2-4ae1-ab27-cb798109d893';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'b299ef09-05a2-4abd-938a-1bde3daa920f'
 WHERE id = '05d34535-92e2-4ae1-ab27-cb798109d893' AND lookup_key = 'rocket lab usa' AND canonical_id = '1961dd1f-2f41-4a14-b4a8-d532539e10d6';


-- ---------------------------------------------------------------------
-- A45   lookup_key rocket lab usa inc.
--   from  Rocket Lab USA                (no ticker, no sec_cik)
--   to    Rocket Lab   [RKLB / cik 1819994]
--   route SEC, candidate tier K1
--   authority Rocket Lab Corp  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '59a20a14-86c3-4bee-932e-54ec39fc371f' AND lookup_key = 'rocket lab usa inc.' AND canonical_id = 'b299ef09-05a2-4abd-938a-1bde3daa920f';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'b299ef09-05a2-4abd-938a-1bde3daa920f' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '1961dd1f-2f41-4a14-b4a8-d532539e10d6' AND ticker = 'RKLB' AND sec_cik = 1819994;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'rocket lab usa inc.' AND canonical_id = '1961dd1f-2f41-4a14-b4a8-d532539e10d6';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '1961dd1f-2f41-4a14-b4a8-d532539e10d6'
 WHERE id = '59a20a14-86c3-4bee-932e-54ec39fc371f' AND lookup_key = 'rocket lab usa inc.' AND canonical_id = 'b299ef09-05a2-4abd-938a-1bde3daa920f';

-- READ BACK. Expect one row: canonical_id 1961dd1f-2f41-4a14-b4a8-d532539e10d6, name Rocket Lab,
--            ticker RKLB, sec_cik 1819994.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '59a20a14-86c3-4bee-932e-54ec39fc371f';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'b299ef09-05a2-4abd-938a-1bde3daa920f'
 WHERE id = '59a20a14-86c3-4bee-932e-54ec39fc371f' AND lookup_key = 'rocket lab usa inc.' AND canonical_id = '1961dd1f-2f41-4a14-b4a8-d532539e10d6';


-- ---------------------------------------------------------------------
-- A46   lookup_key rocket lab usa, inc.
--   from  Rocket Lab USA                (no ticker, no sec_cik)
--   to    Rocket Lab   [RKLB / cik 1819994]
--   route SEC, candidate tier K1
--   authority Rocket Lab Corp  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'd26cd52e-3b63-4267-9eee-7dab50bd108a' AND lookup_key = 'rocket lab usa, inc.' AND canonical_id = 'b299ef09-05a2-4abd-938a-1bde3daa920f';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'b299ef09-05a2-4abd-938a-1bde3daa920f' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '1961dd1f-2f41-4a14-b4a8-d532539e10d6' AND ticker = 'RKLB' AND sec_cik = 1819994;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'rocket lab usa, inc.' AND canonical_id = '1961dd1f-2f41-4a14-b4a8-d532539e10d6';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '1961dd1f-2f41-4a14-b4a8-d532539e10d6'
 WHERE id = 'd26cd52e-3b63-4267-9eee-7dab50bd108a' AND lookup_key = 'rocket lab usa, inc.' AND canonical_id = 'b299ef09-05a2-4abd-938a-1bde3daa920f';

-- READ BACK. Expect one row: canonical_id 1961dd1f-2f41-4a14-b4a8-d532539e10d6, name Rocket Lab,
--            ticker RKLB, sec_cik 1819994.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'd26cd52e-3b63-4267-9eee-7dab50bd108a';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'b299ef09-05a2-4abd-938a-1bde3daa920f'
 WHERE id = 'd26cd52e-3b63-4267-9eee-7dab50bd108a' AND lookup_key = 'rocket lab usa, inc.' AND canonical_id = '1961dd1f-2f41-4a14-b4a8-d532539e10d6';


-- ---------------------------------------------------------------------
-- A47   lookup_key hershey
--   from  Hershey                (no ticker, no sec_cik)
--   to    The Hershey Company   [HSY / cik 47111]
--   route SEC, candidate tier K3
--   authority HERSHEY CO  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '88cc87b0-2b7e-428b-adad-aa132305fb27' AND lookup_key = 'hershey' AND canonical_id = '446f4929-c1b6-422a-a23a-29fcbea28d77';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '446f4929-c1b6-422a-a23a-29fcbea28d77' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '4cb81852-add5-446d-968f-48ec56c37127' AND ticker = 'HSY' AND sec_cik = 47111;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'hershey' AND canonical_id = '4cb81852-add5-446d-968f-48ec56c37127';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '4cb81852-add5-446d-968f-48ec56c37127'
 WHERE id = '88cc87b0-2b7e-428b-adad-aa132305fb27' AND lookup_key = 'hershey' AND canonical_id = '446f4929-c1b6-422a-a23a-29fcbea28d77';

-- READ BACK. Expect one row: canonical_id 4cb81852-add5-446d-968f-48ec56c37127, name The Hershey Company,
--            ticker HSY, sec_cik 47111.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '88cc87b0-2b7e-428b-adad-aa132305fb27';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '446f4929-c1b6-422a-a23a-29fcbea28d77'
 WHERE id = '88cc87b0-2b7e-428b-adad-aa132305fb27' AND lookup_key = 'hershey' AND canonical_id = '4cb81852-add5-446d-968f-48ec56c37127';


-- ---------------------------------------------------------------------
-- A48   lookup_key hershey co
--   from  Hershey                (no ticker, no sec_cik)
--   to    The Hershey Company   [HSY / cik 47111]
--   route SEC, candidate tier K3
--   authority HERSHEY CO  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '7aaff68a-dc55-487c-b267-e98713c9572a' AND lookup_key = 'hershey co' AND canonical_id = '446f4929-c1b6-422a-a23a-29fcbea28d77';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '446f4929-c1b6-422a-a23a-29fcbea28d77' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '4cb81852-add5-446d-968f-48ec56c37127' AND ticker = 'HSY' AND sec_cik = 47111;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'hershey co' AND canonical_id = '4cb81852-add5-446d-968f-48ec56c37127';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '4cb81852-add5-446d-968f-48ec56c37127'
 WHERE id = '7aaff68a-dc55-487c-b267-e98713c9572a' AND lookup_key = 'hershey co' AND canonical_id = '446f4929-c1b6-422a-a23a-29fcbea28d77';

-- READ BACK. Expect one row: canonical_id 4cb81852-add5-446d-968f-48ec56c37127, name The Hershey Company,
--            ticker HSY, sec_cik 47111.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '7aaff68a-dc55-487c-b267-e98713c9572a';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '446f4929-c1b6-422a-a23a-29fcbea28d77'
 WHERE id = '7aaff68a-dc55-487c-b267-e98713c9572a' AND lookup_key = 'hershey co' AND canonical_id = '4cb81852-add5-446d-968f-48ec56c37127';


-- ---------------------------------------------------------------------
-- A49   lookup_key hershey co.
--   from  Hershey                (no ticker, no sec_cik)
--   to    The Hershey Company   [HSY / cik 47111]
--   route SEC, candidate tier K3
--   authority HERSHEY CO  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '766d498a-da81-45fb-8f66-bf69b844c8bd' AND lookup_key = 'hershey co.' AND canonical_id = '446f4929-c1b6-422a-a23a-29fcbea28d77';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '446f4929-c1b6-422a-a23a-29fcbea28d77' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '4cb81852-add5-446d-968f-48ec56c37127' AND ticker = 'HSY' AND sec_cik = 47111;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'hershey co.' AND canonical_id = '4cb81852-add5-446d-968f-48ec56c37127';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '4cb81852-add5-446d-968f-48ec56c37127'
 WHERE id = '766d498a-da81-45fb-8f66-bf69b844c8bd' AND lookup_key = 'hershey co.' AND canonical_id = '446f4929-c1b6-422a-a23a-29fcbea28d77';

-- READ BACK. Expect one row: canonical_id 4cb81852-add5-446d-968f-48ec56c37127, name The Hershey Company,
--            ticker HSY, sec_cik 47111.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '766d498a-da81-45fb-8f66-bf69b844c8bd';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '446f4929-c1b6-422a-a23a-29fcbea28d77'
 WHERE id = '766d498a-da81-45fb-8f66-bf69b844c8bd' AND lookup_key = 'hershey co.' AND canonical_id = '4cb81852-add5-446d-968f-48ec56c37127';


-- ---------------------------------------------------------------------
-- A50   lookup_key hershey company
--   from  Hershey                (no ticker, no sec_cik)
--   to    The Hershey Company   [HSY / cik 47111]
--   route SEC, candidate tier K3
--   authority HERSHEY CO  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '5e803f55-627a-4694-9b03-865872aa7376' AND lookup_key = 'hershey company' AND canonical_id = '446f4929-c1b6-422a-a23a-29fcbea28d77';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '446f4929-c1b6-422a-a23a-29fcbea28d77' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '4cb81852-add5-446d-968f-48ec56c37127' AND ticker = 'HSY' AND sec_cik = 47111;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'hershey company' AND canonical_id = '4cb81852-add5-446d-968f-48ec56c37127';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '4cb81852-add5-446d-968f-48ec56c37127'
 WHERE id = '5e803f55-627a-4694-9b03-865872aa7376' AND lookup_key = 'hershey company' AND canonical_id = '446f4929-c1b6-422a-a23a-29fcbea28d77';

-- READ BACK. Expect one row: canonical_id 4cb81852-add5-446d-968f-48ec56c37127, name The Hershey Company,
--            ticker HSY, sec_cik 47111.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '5e803f55-627a-4694-9b03-865872aa7376';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '446f4929-c1b6-422a-a23a-29fcbea28d77'
 WHERE id = '5e803f55-627a-4694-9b03-865872aa7376' AND lookup_key = 'hershey company' AND canonical_id = '4cb81852-add5-446d-968f-48ec56c37127';


-- ---------------------------------------------------------------------
-- A51   lookup_key uber technologies inc
--   from  Uber Technologies, Inc.                (no ticker, no sec_cik)
--   to    Uber   [UBER / cik 1543151]
--   route SEC, candidate tier K1
--   authority Uber Technologies, Inc  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '5ba71b8d-f30c-4231-bd52-67d248e1e512' AND lookup_key = 'uber technologies inc' AND canonical_id = 'da6cf7a0-c8fa-44bd-b814-3e4190ab3c2f';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'da6cf7a0-c8fa-44bd-b814-3e4190ab3c2f' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'ac6823f6-8d63-45ce-bd2f-0d2189d957db' AND ticker = 'UBER' AND sec_cik = 1543151;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'uber technologies inc' AND canonical_id = 'ac6823f6-8d63-45ce-bd2f-0d2189d957db';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'ac6823f6-8d63-45ce-bd2f-0d2189d957db'
 WHERE id = '5ba71b8d-f30c-4231-bd52-67d248e1e512' AND lookup_key = 'uber technologies inc' AND canonical_id = 'da6cf7a0-c8fa-44bd-b814-3e4190ab3c2f';

-- READ BACK. Expect one row: canonical_id ac6823f6-8d63-45ce-bd2f-0d2189d957db, name Uber,
--            ticker UBER, sec_cik 1543151.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '5ba71b8d-f30c-4231-bd52-67d248e1e512';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'da6cf7a0-c8fa-44bd-b814-3e4190ab3c2f'
 WHERE id = '5ba71b8d-f30c-4231-bd52-67d248e1e512' AND lookup_key = 'uber technologies inc' AND canonical_id = 'ac6823f6-8d63-45ce-bd2f-0d2189d957db';


-- ---------------------------------------------------------------------
-- A52   lookup_key uber technologies, inc.
--   from  Uber Technologies, Inc.                (no ticker, no sec_cik)
--   to    Uber   [UBER / cik 1543151]
--   route SEC, candidate tier K1
--   authority Uber Technologies, Inc  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '91578502-c229-466d-b03b-a38540b9503d' AND lookup_key = 'uber technologies, inc.' AND canonical_id = 'da6cf7a0-c8fa-44bd-b814-3e4190ab3c2f';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'da6cf7a0-c8fa-44bd-b814-3e4190ab3c2f' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'ac6823f6-8d63-45ce-bd2f-0d2189d957db' AND ticker = 'UBER' AND sec_cik = 1543151;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'uber technologies, inc.' AND canonical_id = 'ac6823f6-8d63-45ce-bd2f-0d2189d957db';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'ac6823f6-8d63-45ce-bd2f-0d2189d957db'
 WHERE id = '91578502-c229-466d-b03b-a38540b9503d' AND lookup_key = 'uber technologies, inc.' AND canonical_id = 'da6cf7a0-c8fa-44bd-b814-3e4190ab3c2f';

-- READ BACK. Expect one row: canonical_id ac6823f6-8d63-45ce-bd2f-0d2189d957db, name Uber,
--            ticker UBER, sec_cik 1543151.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '91578502-c229-466d-b03b-a38540b9503d';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'da6cf7a0-c8fa-44bd-b814-3e4190ab3c2f'
 WHERE id = '91578502-c229-466d-b03b-a38540b9503d' AND lookup_key = 'uber technologies, inc.' AND canonical_id = 'ac6823f6-8d63-45ce-bd2f-0d2189d957db';


-- ---------------------------------------------------------------------
-- A53   lookup_key ubs ag
--   from  UBS AG                (no ticker, no sec_cik)
--   to    UBS   [UBS / cik 1610520]
--   route SEC, candidate tier K3
--   authority UBS Group AG  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '4ef5d705-b62b-4536-aaeb-099ce4c0c215' AND lookup_key = 'ubs ag' AND canonical_id = 'd20d1464-443d-42d8-b17c-50523482d437';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'd20d1464-443d-42d8-b17c-50523482d437' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '07ef5848-911b-4b88-aa90-c6ceda7ee799' AND ticker = 'UBS' AND sec_cik = 1610520;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'ubs ag' AND canonical_id = '07ef5848-911b-4b88-aa90-c6ceda7ee799';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '07ef5848-911b-4b88-aa90-c6ceda7ee799'
 WHERE id = '4ef5d705-b62b-4536-aaeb-099ce4c0c215' AND lookup_key = 'ubs ag' AND canonical_id = 'd20d1464-443d-42d8-b17c-50523482d437';

-- READ BACK. Expect one row: canonical_id 07ef5848-911b-4b88-aa90-c6ceda7ee799, name UBS,
--            ticker UBS, sec_cik 1610520.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '4ef5d705-b62b-4536-aaeb-099ce4c0c215';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'd20d1464-443d-42d8-b17c-50523482d437'
 WHERE id = '4ef5d705-b62b-4536-aaeb-099ce4c0c215' AND lookup_key = 'ubs ag' AND canonical_id = '07ef5848-911b-4b88-aa90-c6ceda7ee799';


-- ---------------------------------------------------------------------
-- A54   lookup_key ubs group ag
--   from  UBS Group AG                (no ticker, no sec_cik)
--   to    UBS   [UBS / cik 1610520]
--   route SEC, candidate tier K3
--   authority UBS Group AG  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'c740bcd5-669a-4f11-8a51-e1b69d6fc352' AND lookup_key = 'ubs group ag' AND canonical_id = '326fe973-359f-4ecb-a4c9-96ebbc3fcd67';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '326fe973-359f-4ecb-a4c9-96ebbc3fcd67' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '07ef5848-911b-4b88-aa90-c6ceda7ee799' AND ticker = 'UBS' AND sec_cik = 1610520;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'ubs group ag' AND canonical_id = '07ef5848-911b-4b88-aa90-c6ceda7ee799';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '07ef5848-911b-4b88-aa90-c6ceda7ee799'
 WHERE id = 'c740bcd5-669a-4f11-8a51-e1b69d6fc352' AND lookup_key = 'ubs group ag' AND canonical_id = '326fe973-359f-4ecb-a4c9-96ebbc3fcd67';

-- READ BACK. Expect one row: canonical_id 07ef5848-911b-4b88-aa90-c6ceda7ee799, name UBS,
--            ticker UBS, sec_cik 1610520.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'c740bcd5-669a-4f11-8a51-e1b69d6fc352';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '326fe973-359f-4ecb-a4c9-96ebbc3fcd67'
 WHERE id = 'c740bcd5-669a-4f11-8a51-e1b69d6fc352' AND lookup_key = 'ubs group ag' AND canonical_id = '07ef5848-911b-4b88-aa90-c6ceda7ee799';


-- ---------------------------------------------------------------------
-- A55   lookup_key the western union co
--   from  The Western Union Company                (no ticker, no sec_cik)
--   to    Western Union   [WU / cik 1365135]
--   route SEC, candidate tier K3
--   authority Western Union CO  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '132845cf-8755-49b9-b246-f6467b92351c' AND lookup_key = 'the western union co' AND canonical_id = '4f8bf7cb-3adc-4caf-bc1a-3d42fb8a7db9';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '4f8bf7cb-3adc-4caf-bc1a-3d42fb8a7db9' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '6f288874-fcad-421b-9ee7-1015e191524a' AND ticker = 'WU' AND sec_cik = 1365135;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'the western union co' AND canonical_id = '6f288874-fcad-421b-9ee7-1015e191524a';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '6f288874-fcad-421b-9ee7-1015e191524a'
 WHERE id = '132845cf-8755-49b9-b246-f6467b92351c' AND lookup_key = 'the western union co' AND canonical_id = '4f8bf7cb-3adc-4caf-bc1a-3d42fb8a7db9';

-- READ BACK. Expect one row: canonical_id 6f288874-fcad-421b-9ee7-1015e191524a, name Western Union,
--            ticker WU, sec_cik 1365135.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '132845cf-8755-49b9-b246-f6467b92351c';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '4f8bf7cb-3adc-4caf-bc1a-3d42fb8a7db9'
 WHERE id = '132845cf-8755-49b9-b246-f6467b92351c' AND lookup_key = 'the western union co' AND canonical_id = '6f288874-fcad-421b-9ee7-1015e191524a';


-- ---------------------------------------------------------------------
-- A56   lookup_key the western union company
--   from  The Western Union Company                (no ticker, no sec_cik)
--   to    Western Union   [WU / cik 1365135]
--   route SEC, candidate tier K3
--   authority Western Union CO  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'e770f1a6-b003-4f4c-bdc4-4a30e764893c' AND lookup_key = 'the western union company' AND canonical_id = '4f8bf7cb-3adc-4caf-bc1a-3d42fb8a7db9';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '4f8bf7cb-3adc-4caf-bc1a-3d42fb8a7db9' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '6f288874-fcad-421b-9ee7-1015e191524a' AND ticker = 'WU' AND sec_cik = 1365135;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'the western union company' AND canonical_id = '6f288874-fcad-421b-9ee7-1015e191524a';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '6f288874-fcad-421b-9ee7-1015e191524a'
 WHERE id = 'e770f1a6-b003-4f4c-bdc4-4a30e764893c' AND lookup_key = 'the western union company' AND canonical_id = '4f8bf7cb-3adc-4caf-bc1a-3d42fb8a7db9';

-- READ BACK. Expect one row: canonical_id 6f288874-fcad-421b-9ee7-1015e191524a, name Western Union,
--            ticker WU, sec_cik 1365135.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'e770f1a6-b003-4f4c-bdc4-4a30e764893c';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '4f8bf7cb-3adc-4caf-bc1a-3d42fb8a7db9'
 WHERE id = 'e770f1a6-b003-4f4c-bdc4-4a30e764893c' AND lookup_key = 'the western union company' AND canonical_id = '6f288874-fcad-421b-9ee7-1015e191524a';

