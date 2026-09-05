-- =====================================================================
-- 0038b_alias_repoint_hold.sql   GROUP B, HOLD, one human look each
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
-- GROUP B. HOLD. NOT DECIDABLE BY THE GATE. ONE HUMAN LOOK EACH.
--
-- These reached the authority gate through a LOOSE candidate filter, shared
-- identity tokens rather than name-key equality, and that filter admits pairs
-- namesAgree was never built to separate. namesAgree is a VETO on a link a
-- ticker had already made; used as a matcher over arbitrary pairs it accepts
-- "OnKure Therapeutics" against "Akari Therapeutics" on one shared long token.
-- Restricting it to its set-relation verdicts removes that failure and leaves
-- another: a SHORTER orphan name is a proper subset of a LONGER, DIFFERENT
-- registrant. Both directions were then measured against the live resolver and
-- both produce real wrong answers alongside real right ones:
--
--   RIGHT   Deutsche Bank AG            -> Deutsche Bank Aktiengesellschaft
--   RIGHT   Apollo Global Management    -> Apollo  [APO]
--   WRONG   The Coca-Cola Company       -> Coca-Cola Europacific Partners
--   WRONG   Bank of Canada              -> Royal Bank of Canada
--   WRONG   U.S. BANCORP                -> Bancorp [TBBK]
--   WRONG   Semiconductor Manufacturing International -> Taiwan Semiconductor
--
-- The wrong ones were confirmed to CHANGE the rendered page, so applying this
-- group unreviewed would replace a false PRIVATE badge with a false ticker,
-- which is worse. Every block carries the same guards; none is decidable
-- without a human confirming the pair on its comment line.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- B01   lookup_key amazon com
--   from  Amazon com                (no ticker, no sec_cik)
--   to    Amazon   [AMZN / cik 1018724]
--   route SEC, candidate tier K4
--   authority AMAZON COM INC  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'f0cdc59a-1c98-47d7-af1d-27778889fb20' AND lookup_key = 'amazon com' AND canonical_id = 'd5de310a-752a-483e-a9a8-adbafeb1ccb2';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'd5de310a-752a-483e-a9a8-adbafeb1ccb2' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '71eb19c3-f009-4c32-80b1-ac01b391b225' AND ticker = 'AMZN' AND sec_cik = 1018724;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'amazon com' AND canonical_id = '71eb19c3-f009-4c32-80b1-ac01b391b225';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '71eb19c3-f009-4c32-80b1-ac01b391b225'
 WHERE id = 'f0cdc59a-1c98-47d7-af1d-27778889fb20' AND lookup_key = 'amazon com' AND canonical_id = 'd5de310a-752a-483e-a9a8-adbafeb1ccb2';

-- READ BACK. Expect one row: canonical_id 71eb19c3-f009-4c32-80b1-ac01b391b225, name Amazon,
--            ticker AMZN, sec_cik 1018724.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'f0cdc59a-1c98-47d7-af1d-27778889fb20';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'd5de310a-752a-483e-a9a8-adbafeb1ccb2'
 WHERE id = 'f0cdc59a-1c98-47d7-af1d-27778889fb20' AND lookup_key = 'amazon com' AND canonical_id = '71eb19c3-f009-4c32-80b1-ac01b391b225';


-- ---------------------------------------------------------------------
-- B02   lookup_key american express
--   from  American Express Company                (no ticker, no sec_cik)
--   to    American   [AXP / cik 4962]
--   route SEC, candidate tier K4
--   authority AMERICAN EXPRESS CO  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '7b74befb-2bdf-44cb-9e87-ac3bd9413bc0' AND lookup_key = 'american express' AND canonical_id = '51bd41bb-07d7-484b-9d60-5c22e20aeb5f';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '51bd41bb-07d7-484b-9d60-5c22e20aeb5f' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '761ceb65-1d3e-4f9a-9ee6-8ed0799dfa63' AND ticker = 'AXP' AND sec_cik = 4962;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'american express' AND canonical_id = '761ceb65-1d3e-4f9a-9ee6-8ed0799dfa63';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '761ceb65-1d3e-4f9a-9ee6-8ed0799dfa63'
 WHERE id = '7b74befb-2bdf-44cb-9e87-ac3bd9413bc0' AND lookup_key = 'american express' AND canonical_id = '51bd41bb-07d7-484b-9d60-5c22e20aeb5f';

-- READ BACK. Expect one row: canonical_id 761ceb65-1d3e-4f9a-9ee6-8ed0799dfa63, name American,
--            ticker AXP, sec_cik 4962.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '7b74befb-2bdf-44cb-9e87-ac3bd9413bc0';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '51bd41bb-07d7-484b-9d60-5c22e20aeb5f'
 WHERE id = '7b74befb-2bdf-44cb-9e87-ac3bd9413bc0' AND lookup_key = 'american express' AND canonical_id = '761ceb65-1d3e-4f9a-9ee6-8ed0799dfa63';


-- ---------------------------------------------------------------------
-- B03   lookup_key american express co
--   from  American Express Company                (no ticker, no sec_cik)
--   to    American   [AXP / cik 4962]
--   route SEC, candidate tier K4
--   authority AMERICAN EXPRESS CO  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'e3b176ce-24b6-4c66-ab26-8dd2baedb038' AND lookup_key = 'american express co' AND canonical_id = '51bd41bb-07d7-484b-9d60-5c22e20aeb5f';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '51bd41bb-07d7-484b-9d60-5c22e20aeb5f' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '761ceb65-1d3e-4f9a-9ee6-8ed0799dfa63' AND ticker = 'AXP' AND sec_cik = 4962;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'american express co' AND canonical_id = '761ceb65-1d3e-4f9a-9ee6-8ed0799dfa63';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '761ceb65-1d3e-4f9a-9ee6-8ed0799dfa63'
 WHERE id = 'e3b176ce-24b6-4c66-ab26-8dd2baedb038' AND lookup_key = 'american express co' AND canonical_id = '51bd41bb-07d7-484b-9d60-5c22e20aeb5f';

-- READ BACK. Expect one row: canonical_id 761ceb65-1d3e-4f9a-9ee6-8ed0799dfa63, name American,
--            ticker AXP, sec_cik 4962.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'e3b176ce-24b6-4c66-ab26-8dd2baedb038';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '51bd41bb-07d7-484b-9d60-5c22e20aeb5f'
 WHERE id = 'e3b176ce-24b6-4c66-ab26-8dd2baedb038' AND lookup_key = 'american express co' AND canonical_id = '761ceb65-1d3e-4f9a-9ee6-8ed0799dfa63';


-- ---------------------------------------------------------------------
-- B04   lookup_key american express co.
--   from  American Express Company                (no ticker, no sec_cik)
--   to    American   [AXP / cik 4962]
--   route SEC, candidate tier K4
--   authority AMERICAN EXPRESS CO  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'a0555bb0-10ce-4869-99ac-ab7cdd12f61c' AND lookup_key = 'american express co.' AND canonical_id = '51bd41bb-07d7-484b-9d60-5c22e20aeb5f';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '51bd41bb-07d7-484b-9d60-5c22e20aeb5f' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '761ceb65-1d3e-4f9a-9ee6-8ed0799dfa63' AND ticker = 'AXP' AND sec_cik = 4962;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'american express co.' AND canonical_id = '761ceb65-1d3e-4f9a-9ee6-8ed0799dfa63';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '761ceb65-1d3e-4f9a-9ee6-8ed0799dfa63'
 WHERE id = 'a0555bb0-10ce-4869-99ac-ab7cdd12f61c' AND lookup_key = 'american express co.' AND canonical_id = '51bd41bb-07d7-484b-9d60-5c22e20aeb5f';

-- READ BACK. Expect one row: canonical_id 761ceb65-1d3e-4f9a-9ee6-8ed0799dfa63, name American,
--            ticker AXP, sec_cik 4962.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'a0555bb0-10ce-4869-99ac-ab7cdd12f61c';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '51bd41bb-07d7-484b-9d60-5c22e20aeb5f'
 WHERE id = 'a0555bb0-10ce-4869-99ac-ab7cdd12f61c' AND lookup_key = 'american express co.' AND canonical_id = '761ceb65-1d3e-4f9a-9ee6-8ed0799dfa63';


-- ---------------------------------------------------------------------
-- B05   lookup_key american express company
--   from  American Express Company                (no ticker, no sec_cik)
--   to    American   [AXP / cik 4962]
--   route SEC, candidate tier K4
--   authority AMERICAN EXPRESS CO  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '43f2ceef-350b-45a4-a291-2a2cc42cbd0c' AND lookup_key = 'american express company' AND canonical_id = '51bd41bb-07d7-484b-9d60-5c22e20aeb5f';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '51bd41bb-07d7-484b-9d60-5c22e20aeb5f' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '761ceb65-1d3e-4f9a-9ee6-8ed0799dfa63' AND ticker = 'AXP' AND sec_cik = 4962;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'american express company' AND canonical_id = '761ceb65-1d3e-4f9a-9ee6-8ed0799dfa63';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '761ceb65-1d3e-4f9a-9ee6-8ed0799dfa63'
 WHERE id = '43f2ceef-350b-45a4-a291-2a2cc42cbd0c' AND lookup_key = 'american express company' AND canonical_id = '51bd41bb-07d7-484b-9d60-5c22e20aeb5f';

-- READ BACK. Expect one row: canonical_id 761ceb65-1d3e-4f9a-9ee6-8ed0799dfa63, name American,
--            ticker AXP, sec_cik 4962.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '43f2ceef-350b-45a4-a291-2a2cc42cbd0c';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '51bd41bb-07d7-484b-9d60-5c22e20aeb5f'
 WHERE id = '43f2ceef-350b-45a4-a291-2a2cc42cbd0c' AND lookup_key = 'american express company' AND canonical_id = '761ceb65-1d3e-4f9a-9ee6-8ed0799dfa63';


-- ---------------------------------------------------------------------
-- B06   lookup_key anheuser busch
--   from  Anheuser Busch                (no ticker, no sec_cik)
--   to    Anheuser-Busch Inbev   [BUD / cik 1668717]
--   route SEC, candidate tier K4
--   authority Anheuser-Busch InBev SA/NV  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '4a5367a7-e890-46d5-92e3-5da9de27fed8' AND lookup_key = 'anheuser busch' AND canonical_id = 'f008bb3d-5e67-4fc6-b76b-fe2723ced8b6';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'f008bb3d-5e67-4fc6-b76b-fe2723ced8b6' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '132412ad-6769-473a-baa4-567bb1568c67' AND ticker = 'BUD' AND sec_cik = 1668717;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'anheuser busch' AND canonical_id = '132412ad-6769-473a-baa4-567bb1568c67';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '132412ad-6769-473a-baa4-567bb1568c67'
 WHERE id = '4a5367a7-e890-46d5-92e3-5da9de27fed8' AND lookup_key = 'anheuser busch' AND canonical_id = 'f008bb3d-5e67-4fc6-b76b-fe2723ced8b6';

-- READ BACK. Expect one row: canonical_id 132412ad-6769-473a-baa4-567bb1568c67, name Anheuser-Busch Inbev,
--            ticker BUD, sec_cik 1668717.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '4a5367a7-e890-46d5-92e3-5da9de27fed8';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'f008bb3d-5e67-4fc6-b76b-fe2723ced8b6'
 WHERE id = '4a5367a7-e890-46d5-92e3-5da9de27fed8' AND lookup_key = 'anheuser busch' AND canonical_id = '132412ad-6769-473a-baa4-567bb1568c67';


-- ---------------------------------------------------------------------
-- B07   lookup_key anheuser-busch
--   from  Anheuser Busch                (no ticker, no sec_cik)
--   to    Anheuser-Busch Inbev   [BUD / cik 1668717]
--   route SEC, candidate tier K4
--   authority Anheuser-Busch InBev SA/NV  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '5c66df82-ed2f-4568-a8c3-0137e6d347e5' AND lookup_key = 'anheuser-busch' AND canonical_id = 'f008bb3d-5e67-4fc6-b76b-fe2723ced8b6';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'f008bb3d-5e67-4fc6-b76b-fe2723ced8b6' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '132412ad-6769-473a-baa4-567bb1568c67' AND ticker = 'BUD' AND sec_cik = 1668717;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'anheuser-busch' AND canonical_id = '132412ad-6769-473a-baa4-567bb1568c67';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '132412ad-6769-473a-baa4-567bb1568c67'
 WHERE id = '5c66df82-ed2f-4568-a8c3-0137e6d347e5' AND lookup_key = 'anheuser-busch' AND canonical_id = 'f008bb3d-5e67-4fc6-b76b-fe2723ced8b6';

-- READ BACK. Expect one row: canonical_id 132412ad-6769-473a-baa4-567bb1568c67, name Anheuser-Busch Inbev,
--            ticker BUD, sec_cik 1668717.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '5c66df82-ed2f-4568-a8c3-0137e6d347e5';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'f008bb3d-5e67-4fc6-b76b-fe2723ced8b6'
 WHERE id = '5c66df82-ed2f-4568-a8c3-0137e6d347e5' AND lookup_key = 'anheuser-busch' AND canonical_id = '132412ad-6769-473a-baa4-567bb1568c67';


-- ---------------------------------------------------------------------
-- B08   lookup_key antalpha platform
--   from  Antalpha Platform                (no ticker, no sec_cik)
--   to    Antalpha   [ANTA / cik 2044255]
--   route SEC, candidate tier K4
--   authority Antalpha Platform Holding Co  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '88388ff0-61c2-4295-8363-aa458035e6eb' AND lookup_key = 'antalpha platform' AND canonical_id = 'ef333d0f-1d75-4b90-b902-7205720726a9';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'ef333d0f-1d75-4b90-b902-7205720726a9' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'ebfea412-35de-4523-8d34-705cc719e8fa' AND ticker = 'ANTA' AND sec_cik = 2044255;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'antalpha platform' AND canonical_id = 'ebfea412-35de-4523-8d34-705cc719e8fa';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'ebfea412-35de-4523-8d34-705cc719e8fa'
 WHERE id = '88388ff0-61c2-4295-8363-aa458035e6eb' AND lookup_key = 'antalpha platform' AND canonical_id = 'ef333d0f-1d75-4b90-b902-7205720726a9';

-- READ BACK. Expect one row: canonical_id ebfea412-35de-4523-8d34-705cc719e8fa, name Antalpha,
--            ticker ANTA, sec_cik 2044255.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '88388ff0-61c2-4295-8363-aa458035e6eb';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'ef333d0f-1d75-4b90-b902-7205720726a9'
 WHERE id = '88388ff0-61c2-4295-8363-aa458035e6eb' AND lookup_key = 'antalpha platform' AND canonical_id = 'ebfea412-35de-4523-8d34-705cc719e8fa';


-- ---------------------------------------------------------------------
-- B09   lookup_key antalpha platform holding co
--   from  Antalpha Platform Holding Company                (no ticker, no sec_cik)
--   to    Antalpha   [ANTA / cik 2044255]
--   route SEC, candidate tier K4
--   authority Antalpha Platform Holding Co  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'e62319af-21f5-4266-9210-d02aaf64e1c4' AND lookup_key = 'antalpha platform holding co' AND canonical_id = '2317bddb-8646-4169-850d-7023053ee897';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '2317bddb-8646-4169-850d-7023053ee897' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'ebfea412-35de-4523-8d34-705cc719e8fa' AND ticker = 'ANTA' AND sec_cik = 2044255;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'antalpha platform holding co' AND canonical_id = 'ebfea412-35de-4523-8d34-705cc719e8fa';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'ebfea412-35de-4523-8d34-705cc719e8fa'
 WHERE id = 'e62319af-21f5-4266-9210-d02aaf64e1c4' AND lookup_key = 'antalpha platform holding co' AND canonical_id = '2317bddb-8646-4169-850d-7023053ee897';

-- READ BACK. Expect one row: canonical_id ebfea412-35de-4523-8d34-705cc719e8fa, name Antalpha,
--            ticker ANTA, sec_cik 2044255.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'e62319af-21f5-4266-9210-d02aaf64e1c4';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '2317bddb-8646-4169-850d-7023053ee897'
 WHERE id = 'e62319af-21f5-4266-9210-d02aaf64e1c4' AND lookup_key = 'antalpha platform holding co' AND canonical_id = 'ebfea412-35de-4523-8d34-705cc719e8fa';


-- ---------------------------------------------------------------------
-- B10   lookup_key antalpha platform holding company
--   from  Antalpha Platform Holding Company                (no ticker, no sec_cik)
--   to    Antalpha   [ANTA / cik 2044255]
--   route SEC, candidate tier K4
--   authority Antalpha Platform Holding Co  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '7cf6f111-b3ce-4702-b5a4-82f36b7d5fdb' AND lookup_key = 'antalpha platform holding company' AND canonical_id = '2317bddb-8646-4169-850d-7023053ee897';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '2317bddb-8646-4169-850d-7023053ee897' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'ebfea412-35de-4523-8d34-705cc719e8fa' AND ticker = 'ANTA' AND sec_cik = 2044255;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'antalpha platform holding company' AND canonical_id = 'ebfea412-35de-4523-8d34-705cc719e8fa';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'ebfea412-35de-4523-8d34-705cc719e8fa'
 WHERE id = '7cf6f111-b3ce-4702-b5a4-82f36b7d5fdb' AND lookup_key = 'antalpha platform holding company' AND canonical_id = '2317bddb-8646-4169-850d-7023053ee897';

-- READ BACK. Expect one row: canonical_id ebfea412-35de-4523-8d34-705cc719e8fa, name Antalpha,
--            ticker ANTA, sec_cik 2044255.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '7cf6f111-b3ce-4702-b5a4-82f36b7d5fdb';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '2317bddb-8646-4169-850d-7023053ee897'
 WHERE id = '7cf6f111-b3ce-4702-b5a4-82f36b7d5fdb' AND lookup_key = 'antalpha platform holding company' AND canonical_id = 'ebfea412-35de-4523-8d34-705cc719e8fa';


-- ---------------------------------------------------------------------
-- B11   lookup_key apollo global management
--   from  Apollo Global Management Inc.                (no ticker, no sec_cik)
--   to    Apollo   [APO / cik 1858681]
--   route SEC, candidate tier K4
--   authority Apollo Global Management, Inc.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '1378912f-718b-4591-84f0-82e2206b3042' AND lookup_key = 'apollo global management' AND canonical_id = '443a7ca5-0011-44bf-9ec8-30047badad74';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '443a7ca5-0011-44bf-9ec8-30047badad74' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '368fc42b-87d4-4e82-9a8a-cb8f4ec23fb4' AND ticker = 'APO' AND sec_cik = 1858681;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'apollo global management' AND canonical_id = '368fc42b-87d4-4e82-9a8a-cb8f4ec23fb4';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '368fc42b-87d4-4e82-9a8a-cb8f4ec23fb4'
 WHERE id = '1378912f-718b-4591-84f0-82e2206b3042' AND lookup_key = 'apollo global management' AND canonical_id = '443a7ca5-0011-44bf-9ec8-30047badad74';

-- READ BACK. Expect one row: canonical_id 368fc42b-87d4-4e82-9a8a-cb8f4ec23fb4, name Apollo,
--            ticker APO, sec_cik 1858681.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '1378912f-718b-4591-84f0-82e2206b3042';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '443a7ca5-0011-44bf-9ec8-30047badad74'
 WHERE id = '1378912f-718b-4591-84f0-82e2206b3042' AND lookup_key = 'apollo global management' AND canonical_id = '368fc42b-87d4-4e82-9a8a-cb8f4ec23fb4';


-- ---------------------------------------------------------------------
-- B12   lookup_key apollo global management inc
--   from  Apollo Global Management Inc.                (no ticker, no sec_cik)
--   to    Apollo   [APO / cik 1858681]
--   route SEC, candidate tier K4
--   authority Apollo Global Management, Inc.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'de44aa9a-3c9d-4642-ae82-2dd966cc6550' AND lookup_key = 'apollo global management inc' AND canonical_id = '443a7ca5-0011-44bf-9ec8-30047badad74';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '443a7ca5-0011-44bf-9ec8-30047badad74' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '368fc42b-87d4-4e82-9a8a-cb8f4ec23fb4' AND ticker = 'APO' AND sec_cik = 1858681;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'apollo global management inc' AND canonical_id = '368fc42b-87d4-4e82-9a8a-cb8f4ec23fb4';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '368fc42b-87d4-4e82-9a8a-cb8f4ec23fb4'
 WHERE id = 'de44aa9a-3c9d-4642-ae82-2dd966cc6550' AND lookup_key = 'apollo global management inc' AND canonical_id = '443a7ca5-0011-44bf-9ec8-30047badad74';

-- READ BACK. Expect one row: canonical_id 368fc42b-87d4-4e82-9a8a-cb8f4ec23fb4, name Apollo,
--            ticker APO, sec_cik 1858681.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'de44aa9a-3c9d-4642-ae82-2dd966cc6550';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '443a7ca5-0011-44bf-9ec8-30047badad74'
 WHERE id = 'de44aa9a-3c9d-4642-ae82-2dd966cc6550' AND lookup_key = 'apollo global management inc' AND canonical_id = '368fc42b-87d4-4e82-9a8a-cb8f4ec23fb4';


-- ---------------------------------------------------------------------
-- B13   lookup_key apollo global management inc.
--   from  Apollo Global Management Inc.                (no ticker, no sec_cik)
--   to    Apollo   [APO / cik 1858681]
--   route SEC, candidate tier K4
--   authority Apollo Global Management, Inc.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '8f980045-9887-40db-93ff-0bb8c6d71cf3' AND lookup_key = 'apollo global management inc.' AND canonical_id = '443a7ca5-0011-44bf-9ec8-30047badad74';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '443a7ca5-0011-44bf-9ec8-30047badad74' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '368fc42b-87d4-4e82-9a8a-cb8f4ec23fb4' AND ticker = 'APO' AND sec_cik = 1858681;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'apollo global management inc.' AND canonical_id = '368fc42b-87d4-4e82-9a8a-cb8f4ec23fb4';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '368fc42b-87d4-4e82-9a8a-cb8f4ec23fb4'
 WHERE id = '8f980045-9887-40db-93ff-0bb8c6d71cf3' AND lookup_key = 'apollo global management inc.' AND canonical_id = '443a7ca5-0011-44bf-9ec8-30047badad74';

-- READ BACK. Expect one row: canonical_id 368fc42b-87d4-4e82-9a8a-cb8f4ec23fb4, name Apollo,
--            ticker APO, sec_cik 1858681.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '8f980045-9887-40db-93ff-0bb8c6d71cf3';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '443a7ca5-0011-44bf-9ec8-30047badad74'
 WHERE id = '8f980045-9887-40db-93ff-0bb8c6d71cf3' AND lookup_key = 'apollo global management inc.' AND canonical_id = '368fc42b-87d4-4e82-9a8a-cb8f4ec23fb4';


-- ---------------------------------------------------------------------
-- B14   lookup_key apollo global management, inc.
--   from  Apollo Global Management Inc.                (no ticker, no sec_cik)
--   to    Apollo   [APO / cik 1858681]
--   route SEC, candidate tier K4
--   authority Apollo Global Management, Inc.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'f2504a62-b14b-42ea-9be1-fe04fd960013' AND lookup_key = 'apollo global management, inc.' AND canonical_id = '443a7ca5-0011-44bf-9ec8-30047badad74';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '443a7ca5-0011-44bf-9ec8-30047badad74' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '368fc42b-87d4-4e82-9a8a-cb8f4ec23fb4' AND ticker = 'APO' AND sec_cik = 1858681;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'apollo global management, inc.' AND canonical_id = '368fc42b-87d4-4e82-9a8a-cb8f4ec23fb4';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '368fc42b-87d4-4e82-9a8a-cb8f4ec23fb4'
 WHERE id = 'f2504a62-b14b-42ea-9be1-fe04fd960013' AND lookup_key = 'apollo global management, inc.' AND canonical_id = '443a7ca5-0011-44bf-9ec8-30047badad74';

-- READ BACK. Expect one row: canonical_id 368fc42b-87d4-4e82-9a8a-cb8f4ec23fb4, name Apollo,
--            ticker APO, sec_cik 1858681.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'f2504a62-b14b-42ea-9be1-fe04fd960013';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '443a7ca5-0011-44bf-9ec8-30047badad74'
 WHERE id = 'f2504a62-b14b-42ea-9be1-fe04fd960013' AND lookup_key = 'apollo global management, inc.' AND canonical_id = '368fc42b-87d4-4e82-9a8a-cb8f4ec23fb4';


-- ---------------------------------------------------------------------
-- B15   lookup_key u.s. bancorp
--   from  U.S. BANCORP                (no ticker, no sec_cik)
--   to    Bancorp   [TBBK / cik 1295401]
--   route SEC, candidate tier K4
--   authority Bancorp, Inc.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'e21b7c7d-8921-4702-a831-10ec92015183' AND lookup_key = 'u.s. bancorp' AND canonical_id = '5ca0d9d2-8e85-4321-8f4d-5e4d76ab5d25';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '5ca0d9d2-8e85-4321-8f4d-5e4d76ab5d25' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '3b4ed025-b2d1-45b2-ab77-20d6a3b7f50f' AND ticker = 'TBBK' AND sec_cik = 1295401;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'u.s. bancorp' AND canonical_id = '3b4ed025-b2d1-45b2-ab77-20d6a3b7f50f';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '3b4ed025-b2d1-45b2-ab77-20d6a3b7f50f'
 WHERE id = 'e21b7c7d-8921-4702-a831-10ec92015183' AND lookup_key = 'u.s. bancorp' AND canonical_id = '5ca0d9d2-8e85-4321-8f4d-5e4d76ab5d25';

-- READ BACK. Expect one row: canonical_id 3b4ed025-b2d1-45b2-ab77-20d6a3b7f50f, name Bancorp,
--            ticker TBBK, sec_cik 1295401.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'e21b7c7d-8921-4702-a831-10ec92015183';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '5ca0d9d2-8e85-4321-8f4d-5e4d76ab5d25'
 WHERE id = 'e21b7c7d-8921-4702-a831-10ec92015183' AND lookup_key = 'u.s. bancorp' AND canonical_id = '3b4ed025-b2d1-45b2-ab77-20d6a3b7f50f';


-- ---------------------------------------------------------------------
-- B16   lookup_key berkshire hathaway energy
--   from  Berkshire Hathaway Energy                (no ticker, no sec_cik)
--   to    Berkshire Hathaway   [BRK.B / cik 1067983]
--   route SEC, candidate tier K4
--   authority BERKSHIRE HATHAWAY INC  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'ba1eac6c-03e2-4abe-af5d-167d2573d935' AND lookup_key = 'berkshire hathaway energy' AND canonical_id = '35854835-a5db-422d-acbd-8f781f0f3228';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '35854835-a5db-422d-acbd-8f781f0f3228' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'de144271-920b-443f-a26b-3f9f30097c0a' AND ticker = 'BRK.B' AND sec_cik = 1067983;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'berkshire hathaway energy' AND canonical_id = 'de144271-920b-443f-a26b-3f9f30097c0a';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'de144271-920b-443f-a26b-3f9f30097c0a'
 WHERE id = 'ba1eac6c-03e2-4abe-af5d-167d2573d935' AND lookup_key = 'berkshire hathaway energy' AND canonical_id = '35854835-a5db-422d-acbd-8f781f0f3228';

-- READ BACK. Expect one row: canonical_id de144271-920b-443f-a26b-3f9f30097c0a, name Berkshire Hathaway,
--            ticker BRK.B, sec_cik 1067983.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'ba1eac6c-03e2-4abe-af5d-167d2573d935';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '35854835-a5db-422d-acbd-8f781f0f3228'
 WHERE id = 'ba1eac6c-03e2-4abe-af5d-167d2573d935' AND lookup_key = 'berkshire hathaway energy' AND canonical_id = 'de144271-920b-443f-a26b-3f9f30097c0a';


-- ---------------------------------------------------------------------
-- B17   lookup_key camden national bank
--   from  Camden National Bank                (no ticker, no sec_cik)
--   to    Camden National   [CAC / cik 750686]
--   route SEC, candidate tier K4
--   authority CAMDEN NATIONAL CORP  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '151d1832-fa9b-462e-8369-be912af95d4a' AND lookup_key = 'camden national bank' AND canonical_id = '60cd48e6-eb7a-4b99-a5fb-88ba493d380b';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '60cd48e6-eb7a-4b99-a5fb-88ba493d380b' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'be19b1c1-19a9-4e7f-afd6-1a4edd5b26df' AND ticker = 'CAC' AND sec_cik = 750686;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'camden national bank' AND canonical_id = 'be19b1c1-19a9-4e7f-afd6-1a4edd5b26df';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'be19b1c1-19a9-4e7f-afd6-1a4edd5b26df'
 WHERE id = '151d1832-fa9b-462e-8369-be912af95d4a' AND lookup_key = 'camden national bank' AND canonical_id = '60cd48e6-eb7a-4b99-a5fb-88ba493d380b';

-- READ BACK. Expect one row: canonical_id be19b1c1-19a9-4e7f-afd6-1a4edd5b26df, name Camden National,
--            ticker CAC, sec_cik 750686.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '151d1832-fa9b-462e-8369-be912af95d4a';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '60cd48e6-eb7a-4b99-a5fb-88ba493d380b'
 WHERE id = '151d1832-fa9b-462e-8369-be912af95d4a' AND lookup_key = 'camden national bank' AND canonical_id = 'be19b1c1-19a9-4e7f-afd6-1a4edd5b26df';


-- ---------------------------------------------------------------------
-- B18   lookup_key coca-cola europacific
--   from  Coca-Cola Europacific                (no ticker, no sec_cik)
--   to    Coca-Cola Europacific Partners   [CCEP / cik 1650107]
--   route SEC, candidate tier K4
--   authority COCA-COLA EUROPACIFIC PARTNERS plc  (SEC registrant name agrees (subset with 3 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '8bb49721-59a3-4667-80b8-8846637072d0' AND lookup_key = 'coca-cola europacific' AND canonical_id = '1d968cc5-7460-4dc9-8e9d-6ebf9dd79817';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '1d968cc5-7460-4dc9-8e9d-6ebf9dd79817' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '7ea2b906-4336-4474-9e00-9d9e9697521c' AND ticker = 'CCEP' AND sec_cik = 1650107;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'coca-cola europacific' AND canonical_id = '7ea2b906-4336-4474-9e00-9d9e9697521c';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '7ea2b906-4336-4474-9e00-9d9e9697521c'
 WHERE id = '8bb49721-59a3-4667-80b8-8846637072d0' AND lookup_key = 'coca-cola europacific' AND canonical_id = '1d968cc5-7460-4dc9-8e9d-6ebf9dd79817';

-- READ BACK. Expect one row: canonical_id 7ea2b906-4336-4474-9e00-9d9e9697521c, name Coca-Cola Europacific Partners,
--            ticker CCEP, sec_cik 1650107.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '8bb49721-59a3-4667-80b8-8846637072d0';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '1d968cc5-7460-4dc9-8e9d-6ebf9dd79817'
 WHERE id = '8bb49721-59a3-4667-80b8-8846637072d0' AND lookup_key = 'coca-cola europacific' AND canonical_id = '7ea2b906-4336-4474-9e00-9d9e9697521c';


-- ---------------------------------------------------------------------
-- B19   lookup_key the coca-cola
--   from  The Coca-Cola Company                (no ticker, no sec_cik)
--   to    Coca-Cola Europacific Partners   [CCEP / cik 1650107]
--   route SEC, candidate tier K4
--   authority COCA-COLA EUROPACIFIC PARTNERS plc  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '83ad3cce-6dc0-4729-b189-9919f6d49164' AND lookup_key = 'the coca-cola' AND canonical_id = 'f1637f00-e16b-4b3d-8848-2f0bc13e89ab';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'f1637f00-e16b-4b3d-8848-2f0bc13e89ab' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '7ea2b906-4336-4474-9e00-9d9e9697521c' AND ticker = 'CCEP' AND sec_cik = 1650107;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'the coca-cola' AND canonical_id = '7ea2b906-4336-4474-9e00-9d9e9697521c';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '7ea2b906-4336-4474-9e00-9d9e9697521c'
 WHERE id = '83ad3cce-6dc0-4729-b189-9919f6d49164' AND lookup_key = 'the coca-cola' AND canonical_id = 'f1637f00-e16b-4b3d-8848-2f0bc13e89ab';

-- READ BACK. Expect one row: canonical_id 7ea2b906-4336-4474-9e00-9d9e9697521c, name Coca-Cola Europacific Partners,
--            ticker CCEP, sec_cik 1650107.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '83ad3cce-6dc0-4729-b189-9919f6d49164';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'f1637f00-e16b-4b3d-8848-2f0bc13e89ab'
 WHERE id = '83ad3cce-6dc0-4729-b189-9919f6d49164' AND lookup_key = 'the coca-cola' AND canonical_id = '7ea2b906-4336-4474-9e00-9d9e9697521c';


-- ---------------------------------------------------------------------
-- B20   lookup_key the coca-cola company
--   from  The Coca-Cola Company                (no ticker, no sec_cik)
--   to    Coca-Cola Europacific Partners   [CCEP / cik 1650107]
--   route SEC, candidate tier K4
--   authority COCA-COLA EUROPACIFIC PARTNERS plc  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '77ac7258-1268-495f-96c1-a1b1c6335da1' AND lookup_key = 'the coca-cola company' AND canonical_id = 'f1637f00-e16b-4b3d-8848-2f0bc13e89ab';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'f1637f00-e16b-4b3d-8848-2f0bc13e89ab' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '7ea2b906-4336-4474-9e00-9d9e9697521c' AND ticker = 'CCEP' AND sec_cik = 1650107;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'the coca-cola company' AND canonical_id = '7ea2b906-4336-4474-9e00-9d9e9697521c';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '7ea2b906-4336-4474-9e00-9d9e9697521c'
 WHERE id = '77ac7258-1268-495f-96c1-a1b1c6335da1' AND lookup_key = 'the coca-cola company' AND canonical_id = 'f1637f00-e16b-4b3d-8848-2f0bc13e89ab';

-- READ BACK. Expect one row: canonical_id 7ea2b906-4336-4474-9e00-9d9e9697521c, name Coca-Cola Europacific Partners,
--            ticker CCEP, sec_cik 1650107.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '77ac7258-1268-495f-96c1-a1b1c6335da1';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'f1637f00-e16b-4b3d-8848-2f0bc13e89ab'
 WHERE id = '77ac7258-1268-495f-96c1-a1b1c6335da1' AND lookup_key = 'the coca-cola company' AND canonical_id = '7ea2b906-4336-4474-9e00-9d9e9697521c';


-- ---------------------------------------------------------------------
-- B21   lookup_key deutsche bank
--   from  Deutsche Bank AG                (no ticker, no sec_cik)
--   to    Deutsche Bank Aktiengesellschaft   [DB / cik 1159508]
--   route SEC, candidate tier K4
--   authority DEUTSCHE BANK AKTIENGESELLSCHAFT  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'b071224b-483e-459f-a006-09f5573e3a1a' AND lookup_key = 'deutsche bank' AND canonical_id = '02465b72-faab-4652-bc55-31d5264e173c';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '02465b72-faab-4652-bc55-31d5264e173c' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '0b091754-aa17-4ae6-b951-08fa106823e4' AND ticker = 'DB' AND sec_cik = 1159508;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'deutsche bank' AND canonical_id = '0b091754-aa17-4ae6-b951-08fa106823e4';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '0b091754-aa17-4ae6-b951-08fa106823e4'
 WHERE id = 'b071224b-483e-459f-a006-09f5573e3a1a' AND lookup_key = 'deutsche bank' AND canonical_id = '02465b72-faab-4652-bc55-31d5264e173c';

-- READ BACK. Expect one row: canonical_id 0b091754-aa17-4ae6-b951-08fa106823e4, name Deutsche Bank Aktiengesellschaft,
--            ticker DB, sec_cik 1159508.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'b071224b-483e-459f-a006-09f5573e3a1a';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '02465b72-faab-4652-bc55-31d5264e173c'
 WHERE id = 'b071224b-483e-459f-a006-09f5573e3a1a' AND lookup_key = 'deutsche bank' AND canonical_id = '0b091754-aa17-4ae6-b951-08fa106823e4';


-- ---------------------------------------------------------------------
-- B22   lookup_key deutsche bank ag
--   from  Deutsche Bank AG                (no ticker, no sec_cik)
--   to    Deutsche Bank Aktiengesellschaft   [DB / cik 1159508]
--   route SEC, candidate tier K4
--   authority DEUTSCHE BANK AKTIENGESELLSCHAFT  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'ddd49409-86d9-4675-95a3-4e10fa10a1cf' AND lookup_key = 'deutsche bank ag' AND canonical_id = '02465b72-faab-4652-bc55-31d5264e173c';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '02465b72-faab-4652-bc55-31d5264e173c' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '0b091754-aa17-4ae6-b951-08fa106823e4' AND ticker = 'DB' AND sec_cik = 1159508;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'deutsche bank ag' AND canonical_id = '0b091754-aa17-4ae6-b951-08fa106823e4';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '0b091754-aa17-4ae6-b951-08fa106823e4'
 WHERE id = 'ddd49409-86d9-4675-95a3-4e10fa10a1cf' AND lookup_key = 'deutsche bank ag' AND canonical_id = '02465b72-faab-4652-bc55-31d5264e173c';

-- READ BACK. Expect one row: canonical_id 0b091754-aa17-4ae6-b951-08fa106823e4, name Deutsche Bank Aktiengesellschaft,
--            ticker DB, sec_cik 1159508.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'ddd49409-86d9-4675-95a3-4e10fa10a1cf';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '02465b72-faab-4652-bc55-31d5264e173c'
 WHERE id = 'ddd49409-86d9-4675-95a3-4e10fa10a1cf' AND lookup_key = 'deutsche bank ag' AND canonical_id = '0b091754-aa17-4ae6-b951-08fa106823e4';


-- ---------------------------------------------------------------------
-- B23   lookup_key walt disney
--   from  Walt Disney                (no ticker, no sec_cik)
--   to    Disney   [DIS / cik 1744489]
--   route SEC, candidate tier K4
--   authority Walt Disney Co  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '0e29e9b7-d47e-4b8e-869c-f09e51acd776' AND lookup_key = 'walt disney' AND canonical_id = '92c372cf-ff48-42ad-82c0-2facf3c07bb7';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '92c372cf-ff48-42ad-82c0-2facf3c07bb7' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'e3cdfb0f-0683-463b-89ef-cb2bfaac245f' AND ticker = 'DIS' AND sec_cik = 1744489;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'walt disney' AND canonical_id = 'e3cdfb0f-0683-463b-89ef-cb2bfaac245f';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'e3cdfb0f-0683-463b-89ef-cb2bfaac245f'
 WHERE id = '0e29e9b7-d47e-4b8e-869c-f09e51acd776' AND lookup_key = 'walt disney' AND canonical_id = '92c372cf-ff48-42ad-82c0-2facf3c07bb7';

-- READ BACK. Expect one row: canonical_id e3cdfb0f-0683-463b-89ef-cb2bfaac245f, name Disney,
--            ticker DIS, sec_cik 1744489.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '0e29e9b7-d47e-4b8e-869c-f09e51acd776';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '92c372cf-ff48-42ad-82c0-2facf3c07bb7'
 WHERE id = '0e29e9b7-d47e-4b8e-869c-f09e51acd776' AND lookup_key = 'walt disney' AND canonical_id = 'e3cdfb0f-0683-463b-89ef-cb2bfaac245f';


-- ---------------------------------------------------------------------
-- B24   lookup_key walt disney co
--   from  Walt Disney                (no ticker, no sec_cik)
--   to    Disney   [DIS / cik 1744489]
--   route SEC, candidate tier K4
--   authority Walt Disney Co  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '808d0dd7-4dba-4151-9be4-638e658f11fc' AND lookup_key = 'walt disney co' AND canonical_id = '92c372cf-ff48-42ad-82c0-2facf3c07bb7';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '92c372cf-ff48-42ad-82c0-2facf3c07bb7' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'e3cdfb0f-0683-463b-89ef-cb2bfaac245f' AND ticker = 'DIS' AND sec_cik = 1744489;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'walt disney co' AND canonical_id = 'e3cdfb0f-0683-463b-89ef-cb2bfaac245f';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'e3cdfb0f-0683-463b-89ef-cb2bfaac245f'
 WHERE id = '808d0dd7-4dba-4151-9be4-638e658f11fc' AND lookup_key = 'walt disney co' AND canonical_id = '92c372cf-ff48-42ad-82c0-2facf3c07bb7';

-- READ BACK. Expect one row: canonical_id e3cdfb0f-0683-463b-89ef-cb2bfaac245f, name Disney,
--            ticker DIS, sec_cik 1744489.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '808d0dd7-4dba-4151-9be4-638e658f11fc';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '92c372cf-ff48-42ad-82c0-2facf3c07bb7'
 WHERE id = '808d0dd7-4dba-4151-9be4-638e658f11fc' AND lookup_key = 'walt disney co' AND canonical_id = 'e3cdfb0f-0683-463b-89ef-cb2bfaac245f';


-- ---------------------------------------------------------------------
-- B25   lookup_key dream finders
--   from  Dream Finders                (no ticker, no sec_cik)
--   to    Dream Finders Homes   [DFH / cik 1825088]
--   route SEC, candidate tier K4
--   authority Dream Finders Homes, Inc.  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '8d9d8942-faf9-4697-91a0-7817a7c6f8a4' AND lookup_key = 'dream finders' AND canonical_id = '57abc0f0-4c5d-46f2-917c-89a2a15669b5';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '57abc0f0-4c5d-46f2-917c-89a2a15669b5' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'c233cec3-a6b0-412b-aa08-a8cff22fcb7e' AND ticker = 'DFH' AND sec_cik = 1825088;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'dream finders' AND canonical_id = 'c233cec3-a6b0-412b-aa08-a8cff22fcb7e';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'c233cec3-a6b0-412b-aa08-a8cff22fcb7e'
 WHERE id = '8d9d8942-faf9-4697-91a0-7817a7c6f8a4' AND lookup_key = 'dream finders' AND canonical_id = '57abc0f0-4c5d-46f2-917c-89a2a15669b5';

-- READ BACK. Expect one row: canonical_id c233cec3-a6b0-412b-aa08-a8cff22fcb7e, name Dream Finders Homes,
--            ticker DFH, sec_cik 1825088.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '8d9d8942-faf9-4697-91a0-7817a7c6f8a4';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '57abc0f0-4c5d-46f2-917c-89a2a15669b5'
 WHERE id = '8d9d8942-faf9-4697-91a0-7817a7c6f8a4' AND lookup_key = 'dream finders' AND canonical_id = 'c233cec3-a6b0-412b-aa08-a8cff22fcb7e';


-- ---------------------------------------------------------------------
-- B26   lookup_key electronic arts (ea)
--   from  Electronic Arts (EA)                (no ticker, no sec_cik)
--   to    Electronic Arts Inc.   [EA / cik 712515]
--   route SEC, candidate tier K4
--   authority ELECTRONIC ARTS INC.  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '73136b50-404c-4681-b97a-955498ddcbf6' AND lookup_key = 'electronic arts (ea)' AND canonical_id = '8bbd4f6f-5d1d-4501-8c67-9046a2e10fa6';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '8bbd4f6f-5d1d-4501-8c67-9046a2e10fa6' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '0079c5be-e515-49d2-beb5-ec0025c6d72d' AND ticker = 'EA' AND sec_cik = 712515;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'electronic arts (ea)' AND canonical_id = '0079c5be-e515-49d2-beb5-ec0025c6d72d';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '0079c5be-e515-49d2-beb5-ec0025c6d72d'
 WHERE id = '73136b50-404c-4681-b97a-955498ddcbf6' AND lookup_key = 'electronic arts (ea)' AND canonical_id = '8bbd4f6f-5d1d-4501-8c67-9046a2e10fa6';

-- READ BACK. Expect one row: canonical_id 0079c5be-e515-49d2-beb5-ec0025c6d72d, name Electronic Arts Inc.,
--            ticker EA, sec_cik 712515.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '73136b50-404c-4681-b97a-955498ddcbf6';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '8bbd4f6f-5d1d-4501-8c67-9046a2e10fa6'
 WHERE id = '73136b50-404c-4681-b97a-955498ddcbf6' AND lookup_key = 'electronic arts (ea)' AND canonical_id = '0079c5be-e515-49d2-beb5-ec0025c6d72d';


-- ---------------------------------------------------------------------
-- B27   lookup_key eli lilly and co
--   from  Eli Lilly and Co                (no ticker, no sec_cik)
--   to    Eli Lilly   [LLY / cik 59478]
--   route SEC, candidate tier K4
--   authority ELI LILLY & Co  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'b999910a-68a1-435e-8371-cbf7f40c4558' AND lookup_key = 'eli lilly and co' AND canonical_id = '8da83d31-2b90-41df-bbf4-fc5a0d28bbb4';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '8da83d31-2b90-41df-bbf4-fc5a0d28bbb4' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '06a73671-4ef5-4885-aba3-ddbdbdbe68d8' AND ticker = 'LLY' AND sec_cik = 59478;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'eli lilly and co' AND canonical_id = '06a73671-4ef5-4885-aba3-ddbdbdbe68d8';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '06a73671-4ef5-4885-aba3-ddbdbdbe68d8'
 WHERE id = 'b999910a-68a1-435e-8371-cbf7f40c4558' AND lookup_key = 'eli lilly and co' AND canonical_id = '8da83d31-2b90-41df-bbf4-fc5a0d28bbb4';

-- READ BACK. Expect one row: canonical_id 06a73671-4ef5-4885-aba3-ddbdbdbe68d8, name Eli Lilly,
--            ticker LLY, sec_cik 59478.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'b999910a-68a1-435e-8371-cbf7f40c4558';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '8da83d31-2b90-41df-bbf4-fc5a0d28bbb4'
 WHERE id = 'b999910a-68a1-435e-8371-cbf7f40c4558' AND lookup_key = 'eli lilly and co' AND canonical_id = '06a73671-4ef5-4885-aba3-ddbdbdbe68d8';


-- ---------------------------------------------------------------------
-- B28   lookup_key eli lilly and co.
--   from  Eli Lilly and Co                (no ticker, no sec_cik)
--   to    Eli Lilly   [LLY / cik 59478]
--   route SEC, candidate tier K4
--   authority ELI LILLY & Co  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'fab0ae29-a54b-4644-a91d-a3f1c9528ffd' AND lookup_key = 'eli lilly and co.' AND canonical_id = '8da83d31-2b90-41df-bbf4-fc5a0d28bbb4';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '8da83d31-2b90-41df-bbf4-fc5a0d28bbb4' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '06a73671-4ef5-4885-aba3-ddbdbdbe68d8' AND ticker = 'LLY' AND sec_cik = 59478;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'eli lilly and co.' AND canonical_id = '06a73671-4ef5-4885-aba3-ddbdbdbe68d8';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '06a73671-4ef5-4885-aba3-ddbdbdbe68d8'
 WHERE id = 'fab0ae29-a54b-4644-a91d-a3f1c9528ffd' AND lookup_key = 'eli lilly and co.' AND canonical_id = '8da83d31-2b90-41df-bbf4-fc5a0d28bbb4';

-- READ BACK. Expect one row: canonical_id 06a73671-4ef5-4885-aba3-ddbdbdbe68d8, name Eli Lilly,
--            ticker LLY, sec_cik 59478.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'fab0ae29-a54b-4644-a91d-a3f1c9528ffd';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '8da83d31-2b90-41df-bbf4-fc5a0d28bbb4'
 WHERE id = 'fab0ae29-a54b-4644-a91d-a3f1c9528ffd' AND lookup_key = 'eli lilly and co.' AND canonical_id = '06a73671-4ef5-4885-aba3-ddbdbdbe68d8';


-- ---------------------------------------------------------------------
-- B29   lookup_key emergent biosolutions
--   from  Emergent BioSolutions                (no ticker, no sec_cik)
--   to    Emergent   [EBS / cik 1367644]
--   route SEC, candidate tier K4
--   authority Emergent BioSolutions Inc.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '95839124-5adb-4537-a473-c982c2f27327' AND lookup_key = 'emergent biosolutions' AND canonical_id = '3f78c04e-ed83-4819-9e13-08e2a1dc8514';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '3f78c04e-ed83-4819-9e13-08e2a1dc8514' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'c52da7f7-a6b7-46e1-9826-e59f4d176514' AND ticker = 'EBS' AND sec_cik = 1367644;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'emergent biosolutions' AND canonical_id = 'c52da7f7-a6b7-46e1-9826-e59f4d176514';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'c52da7f7-a6b7-46e1-9826-e59f4d176514'
 WHERE id = '95839124-5adb-4537-a473-c982c2f27327' AND lookup_key = 'emergent biosolutions' AND canonical_id = '3f78c04e-ed83-4819-9e13-08e2a1dc8514';

-- READ BACK. Expect one row: canonical_id c52da7f7-a6b7-46e1-9826-e59f4d176514, name Emergent,
--            ticker EBS, sec_cik 1367644.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '95839124-5adb-4537-a473-c982c2f27327';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '3f78c04e-ed83-4819-9e13-08e2a1dc8514'
 WHERE id = '95839124-5adb-4537-a473-c982c2f27327' AND lookup_key = 'emergent biosolutions' AND canonical_id = 'c52da7f7-a6b7-46e1-9826-e59f4d176514';


-- ---------------------------------------------------------------------
-- B30   lookup_key emergent biosolutions inc
--   from  Emergent BioSolutions                (no ticker, no sec_cik)
--   to    Emergent   [EBS / cik 1367644]
--   route SEC, candidate tier K4
--   authority Emergent BioSolutions Inc.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'c6524284-6b82-46cb-b617-5130c27f2e52' AND lookup_key = 'emergent biosolutions inc' AND canonical_id = '3f78c04e-ed83-4819-9e13-08e2a1dc8514';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '3f78c04e-ed83-4819-9e13-08e2a1dc8514' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'c52da7f7-a6b7-46e1-9826-e59f4d176514' AND ticker = 'EBS' AND sec_cik = 1367644;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'emergent biosolutions inc' AND canonical_id = 'c52da7f7-a6b7-46e1-9826-e59f4d176514';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'c52da7f7-a6b7-46e1-9826-e59f4d176514'
 WHERE id = 'c6524284-6b82-46cb-b617-5130c27f2e52' AND lookup_key = 'emergent biosolutions inc' AND canonical_id = '3f78c04e-ed83-4819-9e13-08e2a1dc8514';

-- READ BACK. Expect one row: canonical_id c52da7f7-a6b7-46e1-9826-e59f4d176514, name Emergent,
--            ticker EBS, sec_cik 1367644.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'c6524284-6b82-46cb-b617-5130c27f2e52';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '3f78c04e-ed83-4819-9e13-08e2a1dc8514'
 WHERE id = 'c6524284-6b82-46cb-b617-5130c27f2e52' AND lookup_key = 'emergent biosolutions inc' AND canonical_id = 'c52da7f7-a6b7-46e1-9826-e59f4d176514';


-- ---------------------------------------------------------------------
-- B31   lookup_key emergent biosolutions inc.
--   from  Emergent BioSolutions                (no ticker, no sec_cik)
--   to    Emergent   [EBS / cik 1367644]
--   route SEC, candidate tier K4
--   authority Emergent BioSolutions Inc.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '5d5e21b9-b71e-4ad5-a15a-632577dc5e52' AND lookup_key = 'emergent biosolutions inc.' AND canonical_id = '3f78c04e-ed83-4819-9e13-08e2a1dc8514';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '3f78c04e-ed83-4819-9e13-08e2a1dc8514' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'c52da7f7-a6b7-46e1-9826-e59f4d176514' AND ticker = 'EBS' AND sec_cik = 1367644;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'emergent biosolutions inc.' AND canonical_id = 'c52da7f7-a6b7-46e1-9826-e59f4d176514';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'c52da7f7-a6b7-46e1-9826-e59f4d176514'
 WHERE id = '5d5e21b9-b71e-4ad5-a15a-632577dc5e52' AND lookup_key = 'emergent biosolutions inc.' AND canonical_id = '3f78c04e-ed83-4819-9e13-08e2a1dc8514';

-- READ BACK. Expect one row: canonical_id c52da7f7-a6b7-46e1-9826-e59f4d176514, name Emergent,
--            ticker EBS, sec_cik 1367644.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '5d5e21b9-b71e-4ad5-a15a-632577dc5e52';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '3f78c04e-ed83-4819-9e13-08e2a1dc8514'
 WHERE id = '5d5e21b9-b71e-4ad5-a15a-632577dc5e52' AND lookup_key = 'emergent biosolutions inc.' AND canonical_id = 'c52da7f7-a6b7-46e1-9826-e59f4d176514';


-- ---------------------------------------------------------------------
-- B32   lookup_key estee lauder companies
--   from  Estee Lauder Companies                (no ticker, no sec_cik)
--   to    Estee Lauder   [EL / cik 1001250]
--   route SEC, candidate tier K4
--   authority ESTEE LAUDER COMPANIES INC  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '34ccc21a-a559-46c3-9e0c-c1b680187d66' AND lookup_key = 'estee lauder companies' AND canonical_id = '8ef15f8e-8535-4d26-bb88-40bdc9684ef0';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '8ef15f8e-8535-4d26-bb88-40bdc9684ef0' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'a9b1c800-304a-4486-a88e-46de7e1bd9b3' AND ticker = 'EL' AND sec_cik = 1001250;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'estee lauder companies' AND canonical_id = 'a9b1c800-304a-4486-a88e-46de7e1bd9b3';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'a9b1c800-304a-4486-a88e-46de7e1bd9b3'
 WHERE id = '34ccc21a-a559-46c3-9e0c-c1b680187d66' AND lookup_key = 'estee lauder companies' AND canonical_id = '8ef15f8e-8535-4d26-bb88-40bdc9684ef0';

-- READ BACK. Expect one row: canonical_id a9b1c800-304a-4486-a88e-46de7e1bd9b3, name Estee Lauder,
--            ticker EL, sec_cik 1001250.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '34ccc21a-a559-46c3-9e0c-c1b680187d66';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '8ef15f8e-8535-4d26-bb88-40bdc9684ef0'
 WHERE id = '34ccc21a-a559-46c3-9e0c-c1b680187d66' AND lookup_key = 'estee lauder companies' AND canonical_id = 'a9b1c800-304a-4486-a88e-46de7e1bd9b3';


-- ---------------------------------------------------------------------
-- B33   lookup_key estee lauder companies inc.
--   from  Estee Lauder Companies                (no ticker, no sec_cik)
--   to    Estee Lauder   [EL / cik 1001250]
--   route SEC, candidate tier K4
--   authority ESTEE LAUDER COMPANIES INC  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '1ef9ac35-b174-4919-a9dc-0586fa6caf8f' AND lookup_key = 'estee lauder companies inc.' AND canonical_id = '8ef15f8e-8535-4d26-bb88-40bdc9684ef0';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '8ef15f8e-8535-4d26-bb88-40bdc9684ef0' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'a9b1c800-304a-4486-a88e-46de7e1bd9b3' AND ticker = 'EL' AND sec_cik = 1001250;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'estee lauder companies inc.' AND canonical_id = 'a9b1c800-304a-4486-a88e-46de7e1bd9b3';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'a9b1c800-304a-4486-a88e-46de7e1bd9b3'
 WHERE id = '1ef9ac35-b174-4919-a9dc-0586fa6caf8f' AND lookup_key = 'estee lauder companies inc.' AND canonical_id = '8ef15f8e-8535-4d26-bb88-40bdc9684ef0';

-- READ BACK. Expect one row: canonical_id a9b1c800-304a-4486-a88e-46de7e1bd9b3, name Estee Lauder,
--            ticker EL, sec_cik 1001250.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '1ef9ac35-b174-4919-a9dc-0586fa6caf8f';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '8ef15f8e-8535-4d26-bb88-40bdc9684ef0'
 WHERE id = '1ef9ac35-b174-4919-a9dc-0586fa6caf8f' AND lookup_key = 'estee lauder companies inc.' AND canonical_id = 'a9b1c800-304a-4486-a88e-46de7e1bd9b3';


-- ---------------------------------------------------------------------
-- B34   lookup_key fidelity national information
--   from  Fidelity National Information                (no ticker, no sec_cik)
--   to    Fidelity National Information Services   [FIS / cik 1136893]
--   route SEC, candidate tier K4
--   authority Fidelity National Information Services, Inc.  (SEC registrant name agrees (subset with 3 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '791a5cc7-891a-496f-bbac-a5fd18d28f0f' AND lookup_key = 'fidelity national information' AND canonical_id = 'd90e35be-361c-401f-ad52-f9f2c6526472';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'd90e35be-361c-401f-ad52-f9f2c6526472' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '59d437d7-d36d-4514-a150-3092862ff7f3' AND ticker = 'FIS' AND sec_cik = 1136893;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'fidelity national information' AND canonical_id = '59d437d7-d36d-4514-a150-3092862ff7f3';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '59d437d7-d36d-4514-a150-3092862ff7f3'
 WHERE id = '791a5cc7-891a-496f-bbac-a5fd18d28f0f' AND lookup_key = 'fidelity national information' AND canonical_id = 'd90e35be-361c-401f-ad52-f9f2c6526472';

-- READ BACK. Expect one row: canonical_id 59d437d7-d36d-4514-a150-3092862ff7f3, name Fidelity National Information Services,
--            ticker FIS, sec_cik 1136893.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '791a5cc7-891a-496f-bbac-a5fd18d28f0f';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'd90e35be-361c-401f-ad52-f9f2c6526472'
 WHERE id = '791a5cc7-891a-496f-bbac-a5fd18d28f0f' AND lookup_key = 'fidelity national information' AND canonical_id = '59d437d7-d36d-4514-a150-3092862ff7f3';


-- ---------------------------------------------------------------------
-- B35   lookup_key first horizon bank
--   from  First Horizon Bank                (no ticker, no sec_cik)
--   to    First Horizon   [FHN / cik 36966]
--   route SEC, candidate tier K4
--   authority FIRST HORIZON CORP  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '324f9dbd-8a17-4be6-a8f4-29fa29f9e017' AND lookup_key = 'first horizon bank' AND canonical_id = '3c81d345-f23f-46f2-b760-af2e566755c3';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '3c81d345-f23f-46f2-b760-af2e566755c3' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'ba77a0b0-aaae-44c5-a167-ad838ff49e8a' AND ticker = 'FHN' AND sec_cik = 36966;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'first horizon bank' AND canonical_id = 'ba77a0b0-aaae-44c5-a167-ad838ff49e8a';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'ba77a0b0-aaae-44c5-a167-ad838ff49e8a'
 WHERE id = '324f9dbd-8a17-4be6-a8f4-29fa29f9e017' AND lookup_key = 'first horizon bank' AND canonical_id = '3c81d345-f23f-46f2-b760-af2e566755c3';

-- READ BACK. Expect one row: canonical_id ba77a0b0-aaae-44c5-a167-ad838ff49e8a, name First Horizon,
--            ticker FHN, sec_cik 36966.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '324f9dbd-8a17-4be6-a8f4-29fa29f9e017';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '3c81d345-f23f-46f2-b760-af2e566755c3'
 WHERE id = '324f9dbd-8a17-4be6-a8f4-29fa29f9e017' AND lookup_key = 'first horizon bank' AND canonical_id = 'ba77a0b0-aaae-44c5-a167-ad838ff49e8a';


-- ---------------------------------------------------------------------
-- B36   lookup_key ge healthcare technologies
--   from  GE HealthCare Technologies                (no ticker, no sec_cik)
--   to    GE HealthCare   [GEHC / cik 1932393]
--   route SEC, candidate tier K4
--   authority GE HealthCare Technologies Inc.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'eb4dd8e7-eda2-4655-9b4b-7e5850374ae2' AND lookup_key = 'ge healthcare technologies' AND canonical_id = 'a18fea77-6dc7-42e0-98a9-c155b3a8eec7';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'a18fea77-6dc7-42e0-98a9-c155b3a8eec7' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '07a1b8b8-0bc3-4f12-b33a-ab25a5b6da05' AND ticker = 'GEHC' AND sec_cik = 1932393;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'ge healthcare technologies' AND canonical_id = '07a1b8b8-0bc3-4f12-b33a-ab25a5b6da05';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '07a1b8b8-0bc3-4f12-b33a-ab25a5b6da05'
 WHERE id = 'eb4dd8e7-eda2-4655-9b4b-7e5850374ae2' AND lookup_key = 'ge healthcare technologies' AND canonical_id = 'a18fea77-6dc7-42e0-98a9-c155b3a8eec7';

-- READ BACK. Expect one row: canonical_id 07a1b8b8-0bc3-4f12-b33a-ab25a5b6da05, name GE HealthCare,
--            ticker GEHC, sec_cik 1932393.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'eb4dd8e7-eda2-4655-9b4b-7e5850374ae2';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'a18fea77-6dc7-42e0-98a9-c155b3a8eec7'
 WHERE id = 'eb4dd8e7-eda2-4655-9b4b-7e5850374ae2' AND lookup_key = 'ge healthcare technologies' AND canonical_id = '07a1b8b8-0bc3-4f12-b33a-ab25a5b6da05';


-- ---------------------------------------------------------------------
-- B37   lookup_key ge healthcare technologies inc
--   from  GE HealthCare Technologies                (no ticker, no sec_cik)
--   to    GE HealthCare   [GEHC / cik 1932393]
--   route SEC, candidate tier K4
--   authority GE HealthCare Technologies Inc.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'fede00f3-bf9d-4bdd-92ff-89b08a02fca4' AND lookup_key = 'ge healthcare technologies inc' AND canonical_id = 'a18fea77-6dc7-42e0-98a9-c155b3a8eec7';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'a18fea77-6dc7-42e0-98a9-c155b3a8eec7' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '07a1b8b8-0bc3-4f12-b33a-ab25a5b6da05' AND ticker = 'GEHC' AND sec_cik = 1932393;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'ge healthcare technologies inc' AND canonical_id = '07a1b8b8-0bc3-4f12-b33a-ab25a5b6da05';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '07a1b8b8-0bc3-4f12-b33a-ab25a5b6da05'
 WHERE id = 'fede00f3-bf9d-4bdd-92ff-89b08a02fca4' AND lookup_key = 'ge healthcare technologies inc' AND canonical_id = 'a18fea77-6dc7-42e0-98a9-c155b3a8eec7';

-- READ BACK. Expect one row: canonical_id 07a1b8b8-0bc3-4f12-b33a-ab25a5b6da05, name GE HealthCare,
--            ticker GEHC, sec_cik 1932393.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'fede00f3-bf9d-4bdd-92ff-89b08a02fca4';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'a18fea77-6dc7-42e0-98a9-c155b3a8eec7'
 WHERE id = 'fede00f3-bf9d-4bdd-92ff-89b08a02fca4' AND lookup_key = 'ge healthcare technologies inc' AND canonical_id = '07a1b8b8-0bc3-4f12-b33a-ab25a5b6da05';


-- ---------------------------------------------------------------------
-- B38   lookup_key ge healthcare technologies inc.
--   from  GE HealthCare Technologies                (no ticker, no sec_cik)
--   to    GE HealthCare   [GEHC / cik 1932393]
--   route SEC, candidate tier K4
--   authority GE HealthCare Technologies Inc.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '92e58ad9-9ef2-4fb2-9c90-0bdb38dbc838' AND lookup_key = 'ge healthcare technologies inc.' AND canonical_id = 'a18fea77-6dc7-42e0-98a9-c155b3a8eec7';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'a18fea77-6dc7-42e0-98a9-c155b3a8eec7' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '07a1b8b8-0bc3-4f12-b33a-ab25a5b6da05' AND ticker = 'GEHC' AND sec_cik = 1932393;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'ge healthcare technologies inc.' AND canonical_id = '07a1b8b8-0bc3-4f12-b33a-ab25a5b6da05';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '07a1b8b8-0bc3-4f12-b33a-ab25a5b6da05'
 WHERE id = '92e58ad9-9ef2-4fb2-9c90-0bdb38dbc838' AND lookup_key = 'ge healthcare technologies inc.' AND canonical_id = 'a18fea77-6dc7-42e0-98a9-c155b3a8eec7';

-- READ BACK. Expect one row: canonical_id 07a1b8b8-0bc3-4f12-b33a-ab25a5b6da05, name GE HealthCare,
--            ticker GEHC, sec_cik 1932393.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '92e58ad9-9ef2-4fb2-9c90-0bdb38dbc838';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'a18fea77-6dc7-42e0-98a9-c155b3a8eec7'
 WHERE id = '92e58ad9-9ef2-4fb2-9c90-0bdb38dbc838' AND lookup_key = 'ge healthcare technologies inc.' AND canonical_id = '07a1b8b8-0bc3-4f12-b33a-ab25a5b6da05';


-- ---------------------------------------------------------------------
-- B39   lookup_key general motors c
--   from  General Motors C                (no ticker, no sec_cik)
--   to    General Motors   [GM / cik 1467858]
--   route SEC, candidate tier K4
--   authority General Motors Co  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '06f204f6-44d7-4149-9faf-6e352a5f0bb0' AND lookup_key = 'general motors c' AND canonical_id = '06254e95-aa46-4d85-969f-4b7e49d34ded';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '06254e95-aa46-4d85-969f-4b7e49d34ded' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '8726f6c1-48d1-446e-9923-85e94a057c06' AND ticker = 'GM' AND sec_cik = 1467858;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'general motors c' AND canonical_id = '8726f6c1-48d1-446e-9923-85e94a057c06';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '8726f6c1-48d1-446e-9923-85e94a057c06'
 WHERE id = '06f204f6-44d7-4149-9faf-6e352a5f0bb0' AND lookup_key = 'general motors c' AND canonical_id = '06254e95-aa46-4d85-969f-4b7e49d34ded';

-- READ BACK. Expect one row: canonical_id 8726f6c1-48d1-446e-9923-85e94a057c06, name General Motors,
--            ticker GM, sec_cik 1467858.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '06f204f6-44d7-4149-9faf-6e352a5f0bb0';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '06254e95-aa46-4d85-969f-4b7e49d34ded'
 WHERE id = '06f204f6-44d7-4149-9faf-6e352a5f0bb0' AND lookup_key = 'general motors c' AND canonical_id = '8726f6c1-48d1-446e-9923-85e94a057c06';


-- ---------------------------------------------------------------------
-- B40   lookup_key goldman sachs alternatives
--   from  Goldman Sachs Alternatives                (no ticker, no sec_cik)
--   to    Goldman Sachs   [GS / cik 886982]
--   route SEC, candidate tier K4
--   authority GOLDMAN SACHS GROUP INC  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'ba622ff7-12ce-4e16-b7e3-10b64a003f93' AND lookup_key = 'goldman sachs alternatives' AND canonical_id = '5e6b7584-7e69-4bc3-ba1d-d6dc6f1407d7';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '5e6b7584-7e69-4bc3-ba1d-d6dc6f1407d7' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '86094111-a21a-4128-9733-3b5aa2f0e58c' AND ticker = 'GS' AND sec_cik = 886982;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'goldman sachs alternatives' AND canonical_id = '86094111-a21a-4128-9733-3b5aa2f0e58c';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '86094111-a21a-4128-9733-3b5aa2f0e58c'
 WHERE id = 'ba622ff7-12ce-4e16-b7e3-10b64a003f93' AND lookup_key = 'goldman sachs alternatives' AND canonical_id = '5e6b7584-7e69-4bc3-ba1d-d6dc6f1407d7';

-- READ BACK. Expect one row: canonical_id 86094111-a21a-4128-9733-3b5aa2f0e58c, name Goldman Sachs,
--            ticker GS, sec_cik 886982.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'ba622ff7-12ce-4e16-b7e3-10b64a003f93';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '5e6b7584-7e69-4bc3-ba1d-d6dc6f1407d7'
 WHERE id = 'ba622ff7-12ce-4e16-b7e3-10b64a003f93' AND lookup_key = 'goldman sachs alternatives' AND canonical_id = '86094111-a21a-4128-9733-3b5aa2f0e58c';


-- ---------------------------------------------------------------------
-- B41   lookup_key goldman sachs asset management
--   from  Goldman Sachs Asset Management                (no ticker, no sec_cik)
--   to    Goldman Sachs   [GS / cik 886982]
--   route SEC, candidate tier K4
--   authority GOLDMAN SACHS GROUP INC  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '5c658cba-e76e-4638-81b6-c4f94e4eb47a' AND lookup_key = 'goldman sachs asset management' AND canonical_id = '2c41d79c-899b-4f47-bf30-541ff4b65ad7';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '2c41d79c-899b-4f47-bf30-541ff4b65ad7' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '86094111-a21a-4128-9733-3b5aa2f0e58c' AND ticker = 'GS' AND sec_cik = 886982;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'goldman sachs asset management' AND canonical_id = '86094111-a21a-4128-9733-3b5aa2f0e58c';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '86094111-a21a-4128-9733-3b5aa2f0e58c'
 WHERE id = '5c658cba-e76e-4638-81b6-c4f94e4eb47a' AND lookup_key = 'goldman sachs asset management' AND canonical_id = '2c41d79c-899b-4f47-bf30-541ff4b65ad7';

-- READ BACK. Expect one row: canonical_id 86094111-a21a-4128-9733-3b5aa2f0e58c, name Goldman Sachs,
--            ticker GS, sec_cik 886982.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '5c658cba-e76e-4638-81b6-c4f94e4eb47a';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '2c41d79c-899b-4f47-bf30-541ff4b65ad7'
 WHERE id = '5c658cba-e76e-4638-81b6-c4f94e4eb47a' AND lookup_key = 'goldman sachs asset management' AND canonical_id = '86094111-a21a-4128-9733-3b5aa2f0e58c';


-- ---------------------------------------------------------------------
-- B42   lookup_key huntington ingalls industries
--   from  Huntington Ingalls Industries                (no ticker, no sec_cik)
--   to    Huntington Ingalls   [HII / cik 1501585]
--   route SEC, candidate tier K4
--   authority HUNTINGTON INGALLS INDUSTRIES, INC.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'dbafc0b8-3483-48e5-8e40-8406ae2b6a59' AND lookup_key = 'huntington ingalls industries' AND canonical_id = '023f6d95-b169-42e1-bf63-c79cd98ed62c';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '023f6d95-b169-42e1-bf63-c79cd98ed62c' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '6fdc7452-3f1a-4be9-a891-891141cc51a9' AND ticker = 'HII' AND sec_cik = 1501585;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'huntington ingalls industries' AND canonical_id = '6fdc7452-3f1a-4be9-a891-891141cc51a9';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '6fdc7452-3f1a-4be9-a891-891141cc51a9'
 WHERE id = 'dbafc0b8-3483-48e5-8e40-8406ae2b6a59' AND lookup_key = 'huntington ingalls industries' AND canonical_id = '023f6d95-b169-42e1-bf63-c79cd98ed62c';

-- READ BACK. Expect one row: canonical_id 6fdc7452-3f1a-4be9-a891-891141cc51a9, name Huntington Ingalls,
--            ticker HII, sec_cik 1501585.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'dbafc0b8-3483-48e5-8e40-8406ae2b6a59';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '023f6d95-b169-42e1-bf63-c79cd98ed62c'
 WHERE id = 'dbafc0b8-3483-48e5-8e40-8406ae2b6a59' AND lookup_key = 'huntington ingalls industries' AND canonical_id = '6fdc7452-3f1a-4be9-a891-891141cc51a9';


-- ---------------------------------------------------------------------
-- B43   lookup_key huntington ingalls industries inc.
--   from  Huntington Ingalls Industries                (no ticker, no sec_cik)
--   to    Huntington Ingalls   [HII / cik 1501585]
--   route SEC, candidate tier K4
--   authority HUNTINGTON INGALLS INDUSTRIES, INC.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '2a21a816-6ef2-40b6-9bea-ad6ac4885ac6' AND lookup_key = 'huntington ingalls industries inc.' AND canonical_id = '023f6d95-b169-42e1-bf63-c79cd98ed62c';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '023f6d95-b169-42e1-bf63-c79cd98ed62c' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '6fdc7452-3f1a-4be9-a891-891141cc51a9' AND ticker = 'HII' AND sec_cik = 1501585;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'huntington ingalls industries inc.' AND canonical_id = '6fdc7452-3f1a-4be9-a891-891141cc51a9';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '6fdc7452-3f1a-4be9-a891-891141cc51a9'
 WHERE id = '2a21a816-6ef2-40b6-9bea-ad6ac4885ac6' AND lookup_key = 'huntington ingalls industries inc.' AND canonical_id = '023f6d95-b169-42e1-bf63-c79cd98ed62c';

-- READ BACK. Expect one row: canonical_id 6fdc7452-3f1a-4be9-a891-891141cc51a9, name Huntington Ingalls,
--            ticker HII, sec_cik 1501585.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '2a21a816-6ef2-40b6-9bea-ad6ac4885ac6';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '023f6d95-b169-42e1-bf63-c79cd98ed62c'
 WHERE id = '2a21a816-6ef2-40b6-9bea-ad6ac4885ac6' AND lookup_key = 'huntington ingalls industries inc.' AND canonical_id = '6fdc7452-3f1a-4be9-a891-891141cc51a9';


-- ---------------------------------------------------------------------
-- B44   lookup_key huntington ingalls industries, inc.
--   from  Huntington Ingalls Industries                (no ticker, no sec_cik)
--   to    Huntington Ingalls   [HII / cik 1501585]
--   route SEC, candidate tier K4
--   authority HUNTINGTON INGALLS INDUSTRIES, INC.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'b74d0691-874d-4ce5-b559-0a63024584d0' AND lookup_key = 'huntington ingalls industries, inc.' AND canonical_id = '023f6d95-b169-42e1-bf63-c79cd98ed62c';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '023f6d95-b169-42e1-bf63-c79cd98ed62c' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '6fdc7452-3f1a-4be9-a891-891141cc51a9' AND ticker = 'HII' AND sec_cik = 1501585;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'huntington ingalls industries, inc.' AND canonical_id = '6fdc7452-3f1a-4be9-a891-891141cc51a9';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '6fdc7452-3f1a-4be9-a891-891141cc51a9'
 WHERE id = 'b74d0691-874d-4ce5-b559-0a63024584d0' AND lookup_key = 'huntington ingalls industries, inc.' AND canonical_id = '023f6d95-b169-42e1-bf63-c79cd98ed62c';

-- READ BACK. Expect one row: canonical_id 6fdc7452-3f1a-4be9-a891-891141cc51a9, name Huntington Ingalls,
--            ticker HII, sec_cik 1501585.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'b74d0691-874d-4ce5-b559-0a63024584d0';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '023f6d95-b169-42e1-bf63-c79cd98ed62c'
 WHERE id = 'b74d0691-874d-4ce5-b559-0a63024584d0' AND lookup_key = 'huntington ingalls industries, inc.' AND canonical_id = '6fdc7452-3f1a-4be9-a891-891141cc51a9';


-- ---------------------------------------------------------------------
-- B45   lookup_key huntington-ingalls industries
--   from  Huntington Ingalls Industries                (no ticker, no sec_cik)
--   to    Huntington Ingalls   [HII / cik 1501585]
--   route SEC, candidate tier K4
--   authority HUNTINGTON INGALLS INDUSTRIES, INC.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '1ca3afe3-c57f-4b2e-9525-b5eb10eea924' AND lookup_key = 'huntington-ingalls industries' AND canonical_id = '023f6d95-b169-42e1-bf63-c79cd98ed62c';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '023f6d95-b169-42e1-bf63-c79cd98ed62c' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '6fdc7452-3f1a-4be9-a891-891141cc51a9' AND ticker = 'HII' AND sec_cik = 1501585;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'huntington-ingalls industries' AND canonical_id = '6fdc7452-3f1a-4be9-a891-891141cc51a9';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '6fdc7452-3f1a-4be9-a891-891141cc51a9'
 WHERE id = '1ca3afe3-c57f-4b2e-9525-b5eb10eea924' AND lookup_key = 'huntington-ingalls industries' AND canonical_id = '023f6d95-b169-42e1-bf63-c79cd98ed62c';

-- READ BACK. Expect one row: canonical_id 6fdc7452-3f1a-4be9-a891-891141cc51a9, name Huntington Ingalls,
--            ticker HII, sec_cik 1501585.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '1ca3afe3-c57f-4b2e-9525-b5eb10eea924';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '023f6d95-b169-42e1-bf63-c79cd98ed62c'
 WHERE id = '1ca3afe3-c57f-4b2e-9525-b5eb10eea924' AND lookup_key = 'huntington-ingalls industries' AND canonical_id = '6fdc7452-3f1a-4be9-a891-891141cc51a9';


-- ---------------------------------------------------------------------
-- B46   lookup_key l3harris technologies
--   from  L3Harris Technologies                (no ticker, no sec_cik)
--   to    L3Harris   [LHX / cik 202058]
--   route SEC, candidate tier K4
--   authority L3HARRIS TECHNOLOGIES, INC. /DE/  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'b2c454a5-944a-4333-85f3-824f10ae5175' AND lookup_key = 'l3harris technologies' AND canonical_id = '38212db1-2770-415a-9c28-a55ab3293d85';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '38212db1-2770-415a-9c28-a55ab3293d85' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '5ad68bc0-b5f9-4b5d-a96c-cb94aa668f24' AND ticker = 'LHX' AND sec_cik = 202058;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'l3harris technologies' AND canonical_id = '5ad68bc0-b5f9-4b5d-a96c-cb94aa668f24';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '5ad68bc0-b5f9-4b5d-a96c-cb94aa668f24'
 WHERE id = 'b2c454a5-944a-4333-85f3-824f10ae5175' AND lookup_key = 'l3harris technologies' AND canonical_id = '38212db1-2770-415a-9c28-a55ab3293d85';

-- READ BACK. Expect one row: canonical_id 5ad68bc0-b5f9-4b5d-a96c-cb94aa668f24, name L3Harris,
--            ticker LHX, sec_cik 202058.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'b2c454a5-944a-4333-85f3-824f10ae5175';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '38212db1-2770-415a-9c28-a55ab3293d85'
 WHERE id = 'b2c454a5-944a-4333-85f3-824f10ae5175' AND lookup_key = 'l3harris technologies' AND canonical_id = '5ad68bc0-b5f9-4b5d-a96c-cb94aa668f24';


-- ---------------------------------------------------------------------
-- B47   lookup_key l3harris technologies inc
--   from  L3Harris Technologies                (no ticker, no sec_cik)
--   to    L3Harris   [LHX / cik 202058]
--   route SEC, candidate tier K4
--   authority L3HARRIS TECHNOLOGIES, INC. /DE/  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '1f883ef2-d677-49cb-b317-1e3f6d5130ff' AND lookup_key = 'l3harris technologies inc' AND canonical_id = '38212db1-2770-415a-9c28-a55ab3293d85';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '38212db1-2770-415a-9c28-a55ab3293d85' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '5ad68bc0-b5f9-4b5d-a96c-cb94aa668f24' AND ticker = 'LHX' AND sec_cik = 202058;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'l3harris technologies inc' AND canonical_id = '5ad68bc0-b5f9-4b5d-a96c-cb94aa668f24';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '5ad68bc0-b5f9-4b5d-a96c-cb94aa668f24'
 WHERE id = '1f883ef2-d677-49cb-b317-1e3f6d5130ff' AND lookup_key = 'l3harris technologies inc' AND canonical_id = '38212db1-2770-415a-9c28-a55ab3293d85';

-- READ BACK. Expect one row: canonical_id 5ad68bc0-b5f9-4b5d-a96c-cb94aa668f24, name L3Harris,
--            ticker LHX, sec_cik 202058.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '1f883ef2-d677-49cb-b317-1e3f6d5130ff';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '38212db1-2770-415a-9c28-a55ab3293d85'
 WHERE id = '1f883ef2-d677-49cb-b317-1e3f6d5130ff' AND lookup_key = 'l3harris technologies inc' AND canonical_id = '5ad68bc0-b5f9-4b5d-a96c-cb94aa668f24';


-- ---------------------------------------------------------------------
-- B48   lookup_key l3harris technologies, inc.
--   from  L3Harris Technologies                (no ticker, no sec_cik)
--   to    L3Harris   [LHX / cik 202058]
--   route SEC, candidate tier K4
--   authority L3HARRIS TECHNOLOGIES, INC. /DE/  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'd9f4dd4d-4a5d-4664-b082-7101a7df594c' AND lookup_key = 'l3harris technologies, inc.' AND canonical_id = '38212db1-2770-415a-9c28-a55ab3293d85';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '38212db1-2770-415a-9c28-a55ab3293d85' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '5ad68bc0-b5f9-4b5d-a96c-cb94aa668f24' AND ticker = 'LHX' AND sec_cik = 202058;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'l3harris technologies, inc.' AND canonical_id = '5ad68bc0-b5f9-4b5d-a96c-cb94aa668f24';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '5ad68bc0-b5f9-4b5d-a96c-cb94aa668f24'
 WHERE id = 'd9f4dd4d-4a5d-4664-b082-7101a7df594c' AND lookup_key = 'l3harris technologies, inc.' AND canonical_id = '38212db1-2770-415a-9c28-a55ab3293d85';

-- READ BACK. Expect one row: canonical_id 5ad68bc0-b5f9-4b5d-a96c-cb94aa668f24, name L3Harris,
--            ticker LHX, sec_cik 202058.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'd9f4dd4d-4a5d-4664-b082-7101a7df594c';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '38212db1-2770-415a-9c28-a55ab3293d85'
 WHERE id = 'd9f4dd4d-4a5d-4664-b082-7101a7df594c' AND lookup_key = 'l3harris technologies, inc.' AND canonical_id = '5ad68bc0-b5f9-4b5d-a96c-cb94aa668f24';


-- ---------------------------------------------------------------------
-- B49   lookup_key lionsgate studios
--   from  Lionsgate Studios                (no ticker, no sec_cik)
--   to    Lionsgate   [LION / cik 2052959]
--   route SEC, candidate tier K4
--   authority Lionsgate Studios Corp.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'bd84e685-f7d6-45ae-b568-9b5f9ba37aac' AND lookup_key = 'lionsgate studios' AND canonical_id = '83f8c040-069a-49d7-86e2-2115afcfe1cb';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '83f8c040-069a-49d7-86e2-2115afcfe1cb' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'e8d8f260-7e3d-446b-bd19-8ad4c4f7905a' AND ticker = 'LION' AND sec_cik = 2052959;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'lionsgate studios' AND canonical_id = 'e8d8f260-7e3d-446b-bd19-8ad4c4f7905a';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'e8d8f260-7e3d-446b-bd19-8ad4c4f7905a'
 WHERE id = 'bd84e685-f7d6-45ae-b568-9b5f9ba37aac' AND lookup_key = 'lionsgate studios' AND canonical_id = '83f8c040-069a-49d7-86e2-2115afcfe1cb';

-- READ BACK. Expect one row: canonical_id e8d8f260-7e3d-446b-bd19-8ad4c4f7905a, name Lionsgate,
--            ticker LION, sec_cik 2052959.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'bd84e685-f7d6-45ae-b568-9b5f9ba37aac';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '83f8c040-069a-49d7-86e2-2115afcfe1cb'
 WHERE id = 'bd84e685-f7d6-45ae-b568-9b5f9ba37aac' AND lookup_key = 'lionsgate studios' AND canonical_id = 'e8d8f260-7e3d-446b-bd19-8ad4c4f7905a';


-- ---------------------------------------------------------------------
-- B50   lookup_key micron technology inc
--   from  Micron Technology Inc                (no ticker, no sec_cik)
--   to    Micron   [MU / cik 723125]
--   route SEC, candidate tier K4
--   authority MICRON TECHNOLOGY INC  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'f04d5485-00a4-41d3-ab2e-c37fc8db8059' AND lookup_key = 'micron technology inc' AND canonical_id = 'e51bc0bd-bf9b-4a7c-9d18-375f8f813730';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'e51bc0bd-bf9b-4a7c-9d18-375f8f813730' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'b842bc8a-abf3-448f-82f3-97002988ac43' AND ticker = 'MU' AND sec_cik = 723125;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'micron technology inc' AND canonical_id = 'b842bc8a-abf3-448f-82f3-97002988ac43';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'b842bc8a-abf3-448f-82f3-97002988ac43'
 WHERE id = 'f04d5485-00a4-41d3-ab2e-c37fc8db8059' AND lookup_key = 'micron technology inc' AND canonical_id = 'e51bc0bd-bf9b-4a7c-9d18-375f8f813730';

-- READ BACK. Expect one row: canonical_id b842bc8a-abf3-448f-82f3-97002988ac43, name Micron,
--            ticker MU, sec_cik 723125.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'f04d5485-00a4-41d3-ab2e-c37fc8db8059';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'e51bc0bd-bf9b-4a7c-9d18-375f8f813730'
 WHERE id = 'f04d5485-00a4-41d3-ab2e-c37fc8db8059' AND lookup_key = 'micron technology inc' AND canonical_id = 'b842bc8a-abf3-448f-82f3-97002988ac43';


-- ---------------------------------------------------------------------
-- B51   lookup_key morgan stanley bank, n.a.
--   from  Morgan Stanley Bank, N.A.                (no ticker, no sec_cik)
--   to    Morgan Stanley   [MS / cik 895421]
--   route SEC, candidate tier K4
--   authority MORGAN STANLEY  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'b5aa18b1-7138-4339-b686-597dc4f03c55' AND lookup_key = 'morgan stanley bank, n.a.' AND canonical_id = 'e1aea595-b8c2-412f-9924-91172d73b522';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'e1aea595-b8c2-412f-9924-91172d73b522' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '9f25417e-6ea0-49ce-944e-2034da48cca7' AND ticker = 'MS' AND sec_cik = 895421;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'morgan stanley bank, n.a.' AND canonical_id = '9f25417e-6ea0-49ce-944e-2034da48cca7';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '9f25417e-6ea0-49ce-944e-2034da48cca7'
 WHERE id = 'b5aa18b1-7138-4339-b686-597dc4f03c55' AND lookup_key = 'morgan stanley bank, n.a.' AND canonical_id = 'e1aea595-b8c2-412f-9924-91172d73b522';

-- READ BACK. Expect one row: canonical_id 9f25417e-6ea0-49ce-944e-2034da48cca7, name Morgan Stanley,
--            ticker MS, sec_cik 895421.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'b5aa18b1-7138-4339-b686-597dc4f03c55';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'e1aea595-b8c2-412f-9924-91172d73b522'
 WHERE id = 'b5aa18b1-7138-4339-b686-597dc4f03c55' AND lookup_key = 'morgan stanley bank, n.a.' AND canonical_id = '9f25417e-6ea0-49ce-944e-2034da48cca7';


-- ---------------------------------------------------------------------
-- B52   lookup_key national storage
--   from  National Storage                (no ticker, no sec_cik)
--   to    National Storage Affiliates Trust   [NSA / cik 1618563]
--   route SEC, candidate tier K4
--   authority National Storage Affiliates Trust  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'de4b7418-29d9-4b9f-abeb-8de22660e3a7' AND lookup_key = 'national storage' AND canonical_id = '1f809a98-1bc7-49ec-bded-a75ee7e7f381';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '1f809a98-1bc7-49ec-bded-a75ee7e7f381' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'df0a26a2-43b8-458c-9492-ad1a1107bffc' AND ticker = 'NSA' AND sec_cik = 1618563;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'national storage' AND canonical_id = 'df0a26a2-43b8-458c-9492-ad1a1107bffc';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'df0a26a2-43b8-458c-9492-ad1a1107bffc'
 WHERE id = 'de4b7418-29d9-4b9f-abeb-8de22660e3a7' AND lookup_key = 'national storage' AND canonical_id = '1f809a98-1bc7-49ec-bded-a75ee7e7f381';

-- READ BACK. Expect one row: canonical_id df0a26a2-43b8-458c-9492-ad1a1107bffc, name National Storage Affiliates Trust,
--            ticker NSA, sec_cik 1618563.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'de4b7418-29d9-4b9f-abeb-8de22660e3a7';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '1f809a98-1bc7-49ec-bded-a75ee7e7f381'
 WHERE id = 'de4b7418-29d9-4b9f-abeb-8de22660e3a7' AND lookup_key = 'national storage' AND canonical_id = 'df0a26a2-43b8-458c-9492-ad1a1107bffc';


-- ---------------------------------------------------------------------
-- B53   lookup_key northern oil
--   from  Northern Oil                (no ticker, no sec_cik)
--   to    Northern Oil & Gas   [NOG / cik 1104485]
--   route SEC, candidate tier K4
--   authority NORTHERN OIL & GAS, INC.  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '1e7a2639-e4ce-49ad-a5fa-0895f3f614d4' AND lookup_key = 'northern oil' AND canonical_id = '5bb99ea6-9424-42be-9e6a-4ed86d1337f4';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '5bb99ea6-9424-42be-9e6a-4ed86d1337f4' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '22f8fc58-b53b-4aa2-8c01-e936e2f20c04' AND ticker = 'NOG' AND sec_cik = 1104485;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'northern oil' AND canonical_id = '22f8fc58-b53b-4aa2-8c01-e936e2f20c04';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '22f8fc58-b53b-4aa2-8c01-e936e2f20c04'
 WHERE id = '1e7a2639-e4ce-49ad-a5fa-0895f3f614d4' AND lookup_key = 'northern oil' AND canonical_id = '5bb99ea6-9424-42be-9e6a-4ed86d1337f4';

-- READ BACK. Expect one row: canonical_id 22f8fc58-b53b-4aa2-8c01-e936e2f20c04, name Northern Oil & Gas,
--            ticker NOG, sec_cik 1104485.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '1e7a2639-e4ce-49ad-a5fa-0895f3f614d4';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '5bb99ea6-9424-42be-9e6a-4ed86d1337f4'
 WHERE id = '1e7a2639-e4ce-49ad-a5fa-0895f3f614d4' AND lookup_key = 'northern oil' AND canonical_id = '22f8fc58-b53b-4aa2-8c01-e936e2f20c04';


-- ---------------------------------------------------------------------
-- B54   lookup_key pershing square
--   from  Pershing Square                (no ticker, no sec_cik)
--   to    Pershing Square USA   [PSUS / cik 2002660]
--   route SEC, candidate tier K4
--   authority Pershing Square USA, Ltd.  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'd953e9d6-214d-4528-ad9f-df11b50a6863' AND lookup_key = 'pershing square' AND canonical_id = '48c9d5e9-acfb-4da2-9df6-679efc2fd730';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '48c9d5e9-acfb-4da2-9df6-679efc2fd730' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '272b37bb-0485-4b04-b0a4-2cf40be7bf9a' AND ticker = 'PSUS' AND sec_cik = 2002660;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'pershing square' AND canonical_id = '272b37bb-0485-4b04-b0a4-2cf40be7bf9a';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '272b37bb-0485-4b04-b0a4-2cf40be7bf9a'
 WHERE id = 'd953e9d6-214d-4528-ad9f-df11b50a6863' AND lookup_key = 'pershing square' AND canonical_id = '48c9d5e9-acfb-4da2-9df6-679efc2fd730';

-- READ BACK. Expect one row: canonical_id 272b37bb-0485-4b04-b0a4-2cf40be7bf9a, name Pershing Square USA,
--            ticker PSUS, sec_cik 2002660.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'd953e9d6-214d-4528-ad9f-df11b50a6863';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '48c9d5e9-acfb-4da2-9df6-679efc2fd730'
 WHERE id = 'd953e9d6-214d-4528-ad9f-df11b50a6863' AND lookup_key = 'pershing square' AND canonical_id = '272b37bb-0485-4b04-b0a4-2cf40be7bf9a';


-- ---------------------------------------------------------------------
-- B55   lookup_key pershing square inc
--   from  Pershing Square                (no ticker, no sec_cik)
--   to    Pershing Square USA   [PSUS / cik 2002660]
--   route SEC, candidate tier K4
--   authority Pershing Square USA, Ltd.  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'dce38735-f0e7-4187-864f-c294d0759616' AND lookup_key = 'pershing square inc' AND canonical_id = '48c9d5e9-acfb-4da2-9df6-679efc2fd730';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '48c9d5e9-acfb-4da2-9df6-679efc2fd730' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '272b37bb-0485-4b04-b0a4-2cf40be7bf9a' AND ticker = 'PSUS' AND sec_cik = 2002660;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'pershing square inc' AND canonical_id = '272b37bb-0485-4b04-b0a4-2cf40be7bf9a';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '272b37bb-0485-4b04-b0a4-2cf40be7bf9a'
 WHERE id = 'dce38735-f0e7-4187-864f-c294d0759616' AND lookup_key = 'pershing square inc' AND canonical_id = '48c9d5e9-acfb-4da2-9df6-679efc2fd730';

-- READ BACK. Expect one row: canonical_id 272b37bb-0485-4b04-b0a4-2cf40be7bf9a, name Pershing Square USA,
--            ticker PSUS, sec_cik 2002660.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'dce38735-f0e7-4187-864f-c294d0759616';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '48c9d5e9-acfb-4da2-9df6-679efc2fd730'
 WHERE id = 'dce38735-f0e7-4187-864f-c294d0759616' AND lookup_key = 'pershing square inc' AND canonical_id = '272b37bb-0485-4b04-b0a4-2cf40be7bf9a';


-- ---------------------------------------------------------------------
-- B56   lookup_key philip morris usa
--   from  Philip Morris USA                (no ticker, no sec_cik)
--   to    Philip Morris International Inc.   [PM / cik 1413329]
--   route SEC, candidate tier K4
--   authority Philip Morris International Inc.  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '57827d19-2c5b-4709-9cc7-bc4b856f7e1f' AND lookup_key = 'philip morris usa' AND canonical_id = '697ad6e6-b0e0-4234-8e5e-a10de7d8f685';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '697ad6e6-b0e0-4234-8e5e-a10de7d8f685' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '958ef05e-5e59-46ff-a002-df50c09c5393' AND ticker = 'PM' AND sec_cik = 1413329;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'philip morris usa' AND canonical_id = '958ef05e-5e59-46ff-a002-df50c09c5393';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '958ef05e-5e59-46ff-a002-df50c09c5393'
 WHERE id = '57827d19-2c5b-4709-9cc7-bc4b856f7e1f' AND lookup_key = 'philip morris usa' AND canonical_id = '697ad6e6-b0e0-4234-8e5e-a10de7d8f685';

-- READ BACK. Expect one row: canonical_id 958ef05e-5e59-46ff-a002-df50c09c5393, name Philip Morris International Inc.,
--            ticker PM, sec_cik 1413329.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '57827d19-2c5b-4709-9cc7-bc4b856f7e1f';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '697ad6e6-b0e0-4234-8e5e-a10de7d8f685'
 WHERE id = '57827d19-2c5b-4709-9cc7-bc4b856f7e1f' AND lookup_key = 'philip morris usa' AND canonical_id = '958ef05e-5e59-46ff-a002-df50c09c5393';


-- ---------------------------------------------------------------------
-- B57   lookup_key quanta services
--   from  QUANTA SERVICES                (no ticker, no sec_cik)
--   to    Quanta   [PWR / cik 1050915]
--   route SEC, candidate tier K4
--   authority QUANTA SERVICES, INC.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '4de8bb33-d7e9-4f5a-be51-ed0ee6f71017' AND lookup_key = 'quanta services' AND canonical_id = 'ab61d08e-aa38-4a41-ad13-499cb4ec0f2d';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'ab61d08e-aa38-4a41-ad13-499cb4ec0f2d' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '11cf56d6-dfb3-48aa-a742-44db06fb7517' AND ticker = 'PWR' AND sec_cik = 1050915;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'quanta services' AND canonical_id = '11cf56d6-dfb3-48aa-a742-44db06fb7517';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '11cf56d6-dfb3-48aa-a742-44db06fb7517'
 WHERE id = '4de8bb33-d7e9-4f5a-be51-ed0ee6f71017' AND lookup_key = 'quanta services' AND canonical_id = 'ab61d08e-aa38-4a41-ad13-499cb4ec0f2d';

-- READ BACK. Expect one row: canonical_id 11cf56d6-dfb3-48aa-a742-44db06fb7517, name Quanta,
--            ticker PWR, sec_cik 1050915.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '4de8bb33-d7e9-4f5a-be51-ed0ee6f71017';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'ab61d08e-aa38-4a41-ad13-499cb4ec0f2d'
 WHERE id = '4de8bb33-d7e9-4f5a-be51-ed0ee6f71017' AND lookup_key = 'quanta services' AND canonical_id = '11cf56d6-dfb3-48aa-a742-44db06fb7517';


-- ---------------------------------------------------------------------
-- B58   lookup_key quanta services inc
--   from  QUANTA SERVICES                (no ticker, no sec_cik)
--   to    Quanta   [PWR / cik 1050915]
--   route SEC, candidate tier K4
--   authority QUANTA SERVICES, INC.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '82d8a676-04e9-4243-ae48-008366a23da6' AND lookup_key = 'quanta services inc' AND canonical_id = 'ab61d08e-aa38-4a41-ad13-499cb4ec0f2d';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'ab61d08e-aa38-4a41-ad13-499cb4ec0f2d' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '11cf56d6-dfb3-48aa-a742-44db06fb7517' AND ticker = 'PWR' AND sec_cik = 1050915;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'quanta services inc' AND canonical_id = '11cf56d6-dfb3-48aa-a742-44db06fb7517';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '11cf56d6-dfb3-48aa-a742-44db06fb7517'
 WHERE id = '82d8a676-04e9-4243-ae48-008366a23da6' AND lookup_key = 'quanta services inc' AND canonical_id = 'ab61d08e-aa38-4a41-ad13-499cb4ec0f2d';

-- READ BACK. Expect one row: canonical_id 11cf56d6-dfb3-48aa-a742-44db06fb7517, name Quanta,
--            ticker PWR, sec_cik 1050915.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '82d8a676-04e9-4243-ae48-008366a23da6';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'ab61d08e-aa38-4a41-ad13-499cb4ec0f2d'
 WHERE id = '82d8a676-04e9-4243-ae48-008366a23da6' AND lookup_key = 'quanta services inc' AND canonical_id = '11cf56d6-dfb3-48aa-a742-44db06fb7517';


-- ---------------------------------------------------------------------
-- B59   lookup_key quanta services, inc.
--   from  QUANTA SERVICES                (no ticker, no sec_cik)
--   to    Quanta   [PWR / cik 1050915]
--   route SEC, candidate tier K4
--   authority QUANTA SERVICES, INC.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '976efddd-04d3-45b5-b6ee-9bc7ce94e211' AND lookup_key = 'quanta services, inc.' AND canonical_id = 'ab61d08e-aa38-4a41-ad13-499cb4ec0f2d';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'ab61d08e-aa38-4a41-ad13-499cb4ec0f2d' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '11cf56d6-dfb3-48aa-a742-44db06fb7517' AND ticker = 'PWR' AND sec_cik = 1050915;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'quanta services, inc.' AND canonical_id = '11cf56d6-dfb3-48aa-a742-44db06fb7517';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '11cf56d6-dfb3-48aa-a742-44db06fb7517'
 WHERE id = '976efddd-04d3-45b5-b6ee-9bc7ce94e211' AND lookup_key = 'quanta services, inc.' AND canonical_id = 'ab61d08e-aa38-4a41-ad13-499cb4ec0f2d';

-- READ BACK. Expect one row: canonical_id 11cf56d6-dfb3-48aa-a742-44db06fb7517, name Quanta,
--            ticker PWR, sec_cik 1050915.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '976efddd-04d3-45b5-b6ee-9bc7ce94e211';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'ab61d08e-aa38-4a41-ad13-499cb4ec0f2d'
 WHERE id = '976efddd-04d3-45b5-b6ee-9bc7ce94e211' AND lookup_key = 'quanta services, inc.' AND canonical_id = '11cf56d6-dfb3-48aa-a742-44db06fb7517';


-- ---------------------------------------------------------------------
-- B60   lookup_key bank of canada
--   from  Bank of Canada                (no ticker, no sec_cik)
--   to    Royal Bank of Canada   [RY / cik 1000275]
--   route SEC, candidate tier K4
--   authority ROYAL BANK OF CANADA  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'f8e0c2d4-10a9-46e1-b346-ce75123a70d2' AND lookup_key = 'bank of canada' AND canonical_id = '1b7e68b3-5d76-43a8-bb7e-3ff648cf1edf';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '1b7e68b3-5d76-43a8-bb7e-3ff648cf1edf' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'c391dd6f-40bc-4484-af23-46a7fe85aed8' AND ticker = 'RY' AND sec_cik = 1000275;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'bank of canada' AND canonical_id = 'c391dd6f-40bc-4484-af23-46a7fe85aed8';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'c391dd6f-40bc-4484-af23-46a7fe85aed8'
 WHERE id = 'f8e0c2d4-10a9-46e1-b346-ce75123a70d2' AND lookup_key = 'bank of canada' AND canonical_id = '1b7e68b3-5d76-43a8-bb7e-3ff648cf1edf';

-- READ BACK. Expect one row: canonical_id c391dd6f-40bc-4484-af23-46a7fe85aed8, name Royal Bank of Canada,
--            ticker RY, sec_cik 1000275.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'f8e0c2d4-10a9-46e1-b346-ce75123a70d2';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '1b7e68b3-5d76-43a8-bb7e-3ff648cf1edf'
 WHERE id = 'f8e0c2d4-10a9-46e1-b346-ce75123a70d2' AND lookup_key = 'bank of canada' AND canonical_id = 'c391dd6f-40bc-4484-af23-46a7fe85aed8';


-- ---------------------------------------------------------------------
-- B61   lookup_key silicon motion technology
--   from  SILICON MOTION TECHNOLOGY                (no ticker, no sec_cik)
--   to    Silicon Motion   [SIMO / cik 1329394]
--   route SEC, candidate tier K4
--   authority Silicon Motion Technology CORP  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '9fea322d-9671-49ca-a8d0-551dec34c666' AND lookup_key = 'silicon motion technology' AND canonical_id = '76e02faa-6195-402f-90a8-ecc8124b1edb';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '76e02faa-6195-402f-90a8-ecc8124b1edb' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '292bfba1-fb98-45cb-a469-26a1f5124016' AND ticker = 'SIMO' AND sec_cik = 1329394;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'silicon motion technology' AND canonical_id = '292bfba1-fb98-45cb-a469-26a1f5124016';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '292bfba1-fb98-45cb-a469-26a1f5124016'
 WHERE id = '9fea322d-9671-49ca-a8d0-551dec34c666' AND lookup_key = 'silicon motion technology' AND canonical_id = '76e02faa-6195-402f-90a8-ecc8124b1edb';

-- READ BACK. Expect one row: canonical_id 292bfba1-fb98-45cb-a469-26a1f5124016, name Silicon Motion,
--            ticker SIMO, sec_cik 1329394.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '9fea322d-9671-49ca-a8d0-551dec34c666';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '76e02faa-6195-402f-90a8-ecc8124b1edb'
 WHERE id = '9fea322d-9671-49ca-a8d0-551dec34c666' AND lookup_key = 'silicon motion technology' AND canonical_id = '292bfba1-fb98-45cb-a469-26a1f5124016';


-- ---------------------------------------------------------------------
-- B62   lookup_key silicon motion technology corp
--   from  SILICON MOTION TECHNOLOGY                (no ticker, no sec_cik)
--   to    Silicon Motion   [SIMO / cik 1329394]
--   route SEC, candidate tier K4
--   authority Silicon Motion Technology CORP  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '1452ae95-08f0-468d-8383-acbec8fb737f' AND lookup_key = 'silicon motion technology corp' AND canonical_id = '76e02faa-6195-402f-90a8-ecc8124b1edb';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '76e02faa-6195-402f-90a8-ecc8124b1edb' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '292bfba1-fb98-45cb-a469-26a1f5124016' AND ticker = 'SIMO' AND sec_cik = 1329394;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'silicon motion technology corp' AND canonical_id = '292bfba1-fb98-45cb-a469-26a1f5124016';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '292bfba1-fb98-45cb-a469-26a1f5124016'
 WHERE id = '1452ae95-08f0-468d-8383-acbec8fb737f' AND lookup_key = 'silicon motion technology corp' AND canonical_id = '76e02faa-6195-402f-90a8-ecc8124b1edb';

-- READ BACK. Expect one row: canonical_id 292bfba1-fb98-45cb-a469-26a1f5124016, name Silicon Motion,
--            ticker SIMO, sec_cik 1329394.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '1452ae95-08f0-468d-8383-acbec8fb737f';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '76e02faa-6195-402f-90a8-ecc8124b1edb'
 WHERE id = '1452ae95-08f0-468d-8383-acbec8fb737f' AND lookup_key = 'silicon motion technology corp' AND canonical_id = '292bfba1-fb98-45cb-a469-26a1f5124016';


-- ---------------------------------------------------------------------
-- B63   lookup_key silicon motion technology corporation
--   from  SILICON MOTION TECHNOLOGY                (no ticker, no sec_cik)
--   to    Silicon Motion   [SIMO / cik 1329394]
--   route SEC, candidate tier K4
--   authority Silicon Motion Technology CORP  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'e79413c3-851f-4b4e-af13-3fe737bd012f' AND lookup_key = 'silicon motion technology corporation' AND canonical_id = '76e02faa-6195-402f-90a8-ecc8124b1edb';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '76e02faa-6195-402f-90a8-ecc8124b1edb' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '292bfba1-fb98-45cb-a469-26a1f5124016' AND ticker = 'SIMO' AND sec_cik = 1329394;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'silicon motion technology corporation' AND canonical_id = '292bfba1-fb98-45cb-a469-26a1f5124016';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '292bfba1-fb98-45cb-a469-26a1f5124016'
 WHERE id = 'e79413c3-851f-4b4e-af13-3fe737bd012f' AND lookup_key = 'silicon motion technology corporation' AND canonical_id = '76e02faa-6195-402f-90a8-ecc8124b1edb';

-- READ BACK. Expect one row: canonical_id 292bfba1-fb98-45cb-a469-26a1f5124016, name Silicon Motion,
--            ticker SIMO, sec_cik 1329394.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'e79413c3-851f-4b4e-af13-3fe737bd012f';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '76e02faa-6195-402f-90a8-ecc8124b1edb'
 WHERE id = 'e79413c3-851f-4b4e-af13-3fe737bd012f' AND lookup_key = 'silicon motion technology corporation' AND canonical_id = '292bfba1-fb98-45cb-a469-26a1f5124016';


-- ---------------------------------------------------------------------
-- B64   lookup_key spotify technology s.a.
--   from  Spotify Technology S.A.                (no ticker, no sec_cik)
--   to    Spotify   [SPOT / cik 1639920]
--   route SEC, candidate tier K4
--   authority Spotify Technology S.A.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '6aea9894-a32b-49df-bccc-0f8a3c22a3ee' AND lookup_key = 'spotify technology s.a.' AND canonical_id = 'e7d24182-04f4-4384-aec3-ef720e338962';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'e7d24182-04f4-4384-aec3-ef720e338962' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'e7cbde52-a85c-40f4-b92b-e4ffa8ecf9b9' AND ticker = 'SPOT' AND sec_cik = 1639920;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'spotify technology s.a.' AND canonical_id = 'e7cbde52-a85c-40f4-b92b-e4ffa8ecf9b9';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'e7cbde52-a85c-40f4-b92b-e4ffa8ecf9b9'
 WHERE id = '6aea9894-a32b-49df-bccc-0f8a3c22a3ee' AND lookup_key = 'spotify technology s.a.' AND canonical_id = 'e7d24182-04f4-4384-aec3-ef720e338962';

-- READ BACK. Expect one row: canonical_id e7cbde52-a85c-40f4-b92b-e4ffa8ecf9b9, name Spotify,
--            ticker SPOT, sec_cik 1639920.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '6aea9894-a32b-49df-bccc-0f8a3c22a3ee';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'e7d24182-04f4-4384-aec3-ef720e338962'
 WHERE id = '6aea9894-a32b-49df-bccc-0f8a3c22a3ee' AND lookup_key = 'spotify technology s.a.' AND canonical_id = 'e7cbde52-a85c-40f4-b92b-e4ffa8ecf9b9';


-- ---------------------------------------------------------------------
-- B65   lookup_key stifel financial
--   from  Stifel Financial Corporation                (no ticker, no sec_cik)
--   to    Stifel   [SF / cik 720672]
--   route SEC, candidate tier K4
--   authority STIFEL FINANCIAL CORP  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '81826ff0-1d9f-497a-a7d6-8fdf3ea2c321' AND lookup_key = 'stifel financial' AND canonical_id = 'b4fc7155-16cb-491d-8685-ccdb8c7c2b36';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'b4fc7155-16cb-491d-8685-ccdb8c7c2b36' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '47f1dddb-788c-4352-a3d8-a4a034a4c16b' AND ticker = 'SF' AND sec_cik = 720672;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'stifel financial' AND canonical_id = '47f1dddb-788c-4352-a3d8-a4a034a4c16b';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '47f1dddb-788c-4352-a3d8-a4a034a4c16b'
 WHERE id = '81826ff0-1d9f-497a-a7d6-8fdf3ea2c321' AND lookup_key = 'stifel financial' AND canonical_id = 'b4fc7155-16cb-491d-8685-ccdb8c7c2b36';

-- READ BACK. Expect one row: canonical_id 47f1dddb-788c-4352-a3d8-a4a034a4c16b, name Stifel,
--            ticker SF, sec_cik 720672.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '81826ff0-1d9f-497a-a7d6-8fdf3ea2c321';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'b4fc7155-16cb-491d-8685-ccdb8c7c2b36'
 WHERE id = '81826ff0-1d9f-497a-a7d6-8fdf3ea2c321' AND lookup_key = 'stifel financial' AND canonical_id = '47f1dddb-788c-4352-a3d8-a4a034a4c16b';


-- ---------------------------------------------------------------------
-- B66   lookup_key stifel financial corp
--   from  Stifel Financial Corporation                (no ticker, no sec_cik)
--   to    Stifel   [SF / cik 720672]
--   route SEC, candidate tier K4
--   authority STIFEL FINANCIAL CORP  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'bdf4da9e-1c09-4e13-8514-5f15871e28c5' AND lookup_key = 'stifel financial corp' AND canonical_id = 'b4fc7155-16cb-491d-8685-ccdb8c7c2b36';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'b4fc7155-16cb-491d-8685-ccdb8c7c2b36' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '47f1dddb-788c-4352-a3d8-a4a034a4c16b' AND ticker = 'SF' AND sec_cik = 720672;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'stifel financial corp' AND canonical_id = '47f1dddb-788c-4352-a3d8-a4a034a4c16b';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '47f1dddb-788c-4352-a3d8-a4a034a4c16b'
 WHERE id = 'bdf4da9e-1c09-4e13-8514-5f15871e28c5' AND lookup_key = 'stifel financial corp' AND canonical_id = 'b4fc7155-16cb-491d-8685-ccdb8c7c2b36';

-- READ BACK. Expect one row: canonical_id 47f1dddb-788c-4352-a3d8-a4a034a4c16b, name Stifel,
--            ticker SF, sec_cik 720672.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'bdf4da9e-1c09-4e13-8514-5f15871e28c5';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'b4fc7155-16cb-491d-8685-ccdb8c7c2b36'
 WHERE id = 'bdf4da9e-1c09-4e13-8514-5f15871e28c5' AND lookup_key = 'stifel financial corp' AND canonical_id = '47f1dddb-788c-4352-a3d8-a4a034a4c16b';


-- ---------------------------------------------------------------------
-- B67   lookup_key stifel financial corp.
--   from  Stifel Financial Corporation                (no ticker, no sec_cik)
--   to    Stifel   [SF / cik 720672]
--   route SEC, candidate tier K4
--   authority STIFEL FINANCIAL CORP  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '23f8e9ad-bc51-41cc-bd6f-feeb0ae51001' AND lookup_key = 'stifel financial corp.' AND canonical_id = 'b4fc7155-16cb-491d-8685-ccdb8c7c2b36';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'b4fc7155-16cb-491d-8685-ccdb8c7c2b36' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '47f1dddb-788c-4352-a3d8-a4a034a4c16b' AND ticker = 'SF' AND sec_cik = 720672;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'stifel financial corp.' AND canonical_id = '47f1dddb-788c-4352-a3d8-a4a034a4c16b';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '47f1dddb-788c-4352-a3d8-a4a034a4c16b'
 WHERE id = '23f8e9ad-bc51-41cc-bd6f-feeb0ae51001' AND lookup_key = 'stifel financial corp.' AND canonical_id = 'b4fc7155-16cb-491d-8685-ccdb8c7c2b36';

-- READ BACK. Expect one row: canonical_id 47f1dddb-788c-4352-a3d8-a4a034a4c16b, name Stifel,
--            ticker SF, sec_cik 720672.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '23f8e9ad-bc51-41cc-bd6f-feeb0ae51001';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'b4fc7155-16cb-491d-8685-ccdb8c7c2b36'
 WHERE id = '23f8e9ad-bc51-41cc-bd6f-feeb0ae51001' AND lookup_key = 'stifel financial corp.' AND canonical_id = '47f1dddb-788c-4352-a3d8-a4a034a4c16b';


-- ---------------------------------------------------------------------
-- B68   lookup_key stifel financial corporation
--   from  Stifel Financial Corporation                (no ticker, no sec_cik)
--   to    Stifel   [SF / cik 720672]
--   route SEC, candidate tier K4
--   authority STIFEL FINANCIAL CORP  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '320646bf-6ce5-4084-9468-ddfa9dfbd80b' AND lookup_key = 'stifel financial corporation' AND canonical_id = 'b4fc7155-16cb-491d-8685-ccdb8c7c2b36';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'b4fc7155-16cb-491d-8685-ccdb8c7c2b36' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '47f1dddb-788c-4352-a3d8-a4a034a4c16b' AND ticker = 'SF' AND sec_cik = 720672;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'stifel financial corporation' AND canonical_id = '47f1dddb-788c-4352-a3d8-a4a034a4c16b';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '47f1dddb-788c-4352-a3d8-a4a034a4c16b'
 WHERE id = '320646bf-6ce5-4084-9468-ddfa9dfbd80b' AND lookup_key = 'stifel financial corporation' AND canonical_id = 'b4fc7155-16cb-491d-8685-ccdb8c7c2b36';

-- READ BACK. Expect one row: canonical_id 47f1dddb-788c-4352-a3d8-a4a034a4c16b, name Stifel,
--            ticker SF, sec_cik 720672.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '320646bf-6ce5-4084-9468-ddfa9dfbd80b';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'b4fc7155-16cb-491d-8685-ccdb8c7c2b36'
 WHERE id = '320646bf-6ce5-4084-9468-ddfa9dfbd80b' AND lookup_key = 'stifel financial corporation' AND canonical_id = '47f1dddb-788c-4352-a3d8-a4a034a4c16b';


-- ---------------------------------------------------------------------
-- B69   lookup_key sumitomo mitsui
--   from  Sumitomo Mitsui                (no ticker, no sec_cik)
--   to    Sumitomo Mitsui Financial Group Inc   [SMFG / cik 1022837]
--   route SEC, candidate tier K4
--   authority SUMITOMO MITSUI FINANCIAL GROUP, INC.  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '5d16a5a6-6a5c-4131-af31-285e422d904d' AND lookup_key = 'sumitomo mitsui' AND canonical_id = 'ff233e8e-20f0-41a3-921f-5b03c85ef5b0';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'ff233e8e-20f0-41a3-921f-5b03c85ef5b0' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'a0d9382b-6a78-4f43-aae3-240010fb3baa' AND ticker = 'SMFG' AND sec_cik = 1022837;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'sumitomo mitsui' AND canonical_id = 'a0d9382b-6a78-4f43-aae3-240010fb3baa';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'a0d9382b-6a78-4f43-aae3-240010fb3baa'
 WHERE id = '5d16a5a6-6a5c-4131-af31-285e422d904d' AND lookup_key = 'sumitomo mitsui' AND canonical_id = 'ff233e8e-20f0-41a3-921f-5b03c85ef5b0';

-- READ BACK. Expect one row: canonical_id a0d9382b-6a78-4f43-aae3-240010fb3baa, name Sumitomo Mitsui Financial Group Inc,
--            ticker SMFG, sec_cik 1022837.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '5d16a5a6-6a5c-4131-af31-285e422d904d';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'ff233e8e-20f0-41a3-921f-5b03c85ef5b0'
 WHERE id = '5d16a5a6-6a5c-4131-af31-285e422d904d' AND lookup_key = 'sumitomo mitsui' AND canonical_id = 'a0d9382b-6a78-4f43-aae3-240010fb3baa';


-- ---------------------------------------------------------------------
-- B70   lookup_key sumitomo mitsui trust group
--   from  Sumitomo Mitsui Trust Group Inc.                (no ticker, no sec_cik)
--   to    Sumitomo Mitsui Financial Group Inc   [SMFG / cik 1022837]
--   route SEC, candidate tier K4
--   authority SUMITOMO MITSUI FINANCIAL GROUP, INC.  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '941dcd6e-4a62-4ba0-939c-76b54af46ba5' AND lookup_key = 'sumitomo mitsui trust group' AND canonical_id = '93937f3a-a108-4bea-8138-5be9c6bd44bf';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '93937f3a-a108-4bea-8138-5be9c6bd44bf' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'a0d9382b-6a78-4f43-aae3-240010fb3baa' AND ticker = 'SMFG' AND sec_cik = 1022837;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'sumitomo mitsui trust group' AND canonical_id = 'a0d9382b-6a78-4f43-aae3-240010fb3baa';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'a0d9382b-6a78-4f43-aae3-240010fb3baa'
 WHERE id = '941dcd6e-4a62-4ba0-939c-76b54af46ba5' AND lookup_key = 'sumitomo mitsui trust group' AND canonical_id = '93937f3a-a108-4bea-8138-5be9c6bd44bf';

-- READ BACK. Expect one row: canonical_id a0d9382b-6a78-4f43-aae3-240010fb3baa, name Sumitomo Mitsui Financial Group Inc,
--            ticker SMFG, sec_cik 1022837.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '941dcd6e-4a62-4ba0-939c-76b54af46ba5';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '93937f3a-a108-4bea-8138-5be9c6bd44bf'
 WHERE id = '941dcd6e-4a62-4ba0-939c-76b54af46ba5' AND lookup_key = 'sumitomo mitsui trust group' AND canonical_id = 'a0d9382b-6a78-4f43-aae3-240010fb3baa';


-- ---------------------------------------------------------------------
-- B71   lookup_key sumitomo mitsui trust group inc.
--   from  Sumitomo Mitsui Trust Group Inc.                (no ticker, no sec_cik)
--   to    Sumitomo Mitsui Financial Group Inc   [SMFG / cik 1022837]
--   route SEC, candidate tier K4
--   authority SUMITOMO MITSUI FINANCIAL GROUP, INC.  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'fc4e7ce4-13fe-4483-afad-8ec6f9a1dc09' AND lookup_key = 'sumitomo mitsui trust group inc.' AND canonical_id = '93937f3a-a108-4bea-8138-5be9c6bd44bf';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '93937f3a-a108-4bea-8138-5be9c6bd44bf' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'a0d9382b-6a78-4f43-aae3-240010fb3baa' AND ticker = 'SMFG' AND sec_cik = 1022837;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'sumitomo mitsui trust group inc.' AND canonical_id = 'a0d9382b-6a78-4f43-aae3-240010fb3baa';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'a0d9382b-6a78-4f43-aae3-240010fb3baa'
 WHERE id = 'fc4e7ce4-13fe-4483-afad-8ec6f9a1dc09' AND lookup_key = 'sumitomo mitsui trust group inc.' AND canonical_id = '93937f3a-a108-4bea-8138-5be9c6bd44bf';

-- READ BACK. Expect one row: canonical_id a0d9382b-6a78-4f43-aae3-240010fb3baa, name Sumitomo Mitsui Financial Group Inc,
--            ticker SMFG, sec_cik 1022837.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'fc4e7ce4-13fe-4483-afad-8ec6f9a1dc09';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '93937f3a-a108-4bea-8138-5be9c6bd44bf'
 WHERE id = 'fc4e7ce4-13fe-4483-afad-8ec6f9a1dc09' AND lookup_key = 'sumitomo mitsui trust group inc.' AND canonical_id = 'a0d9382b-6a78-4f43-aae3-240010fb3baa';


-- ---------------------------------------------------------------------
-- B72   lookup_key sumitomo mitsui trust group, inc.
--   from  Sumitomo Mitsui Trust Group Inc.                (no ticker, no sec_cik)
--   to    Sumitomo Mitsui Financial Group Inc   [SMFG / cik 1022837]
--   route SEC, candidate tier K4
--   authority SUMITOMO MITSUI FINANCIAL GROUP, INC.  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '101133f3-db28-439b-a40b-b6fa8fa133a0' AND lookup_key = 'sumitomo mitsui trust group, inc.' AND canonical_id = '93937f3a-a108-4bea-8138-5be9c6bd44bf';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '93937f3a-a108-4bea-8138-5be9c6bd44bf' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'a0d9382b-6a78-4f43-aae3-240010fb3baa' AND ticker = 'SMFG' AND sec_cik = 1022837;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'sumitomo mitsui trust group, inc.' AND canonical_id = 'a0d9382b-6a78-4f43-aae3-240010fb3baa';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'a0d9382b-6a78-4f43-aae3-240010fb3baa'
 WHERE id = '101133f3-db28-439b-a40b-b6fa8fa133a0' AND lookup_key = 'sumitomo mitsui trust group, inc.' AND canonical_id = '93937f3a-a108-4bea-8138-5be9c6bd44bf';

-- READ BACK. Expect one row: canonical_id a0d9382b-6a78-4f43-aae3-240010fb3baa, name Sumitomo Mitsui Financial Group Inc,
--            ticker SMFG, sec_cik 1022837.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '101133f3-db28-439b-a40b-b6fa8fa133a0';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '93937f3a-a108-4bea-8138-5be9c6bd44bf'
 WHERE id = '101133f3-db28-439b-a40b-b6fa8fa133a0' AND lookup_key = 'sumitomo mitsui trust group, inc.' AND canonical_id = 'a0d9382b-6a78-4f43-aae3-240010fb3baa';


-- ---------------------------------------------------------------------
-- B73   lookup_key semiconductor manufacturing international
--   from  Semiconductor Manufacturing International Corporation                (no ticker, no sec_cik)
--   to    Taiwan Semiconductor   [TSM / cik 1046179]
--   route SEC, candidate tier K4
--   authority TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '6f04d3f7-e7e2-4adf-8991-0d019063e82a' AND lookup_key = 'semiconductor manufacturing international' AND canonical_id = '0cb858c3-efc6-4980-8e09-6cdb32d21fff';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '0cb858c3-efc6-4980-8e09-6cdb32d21fff' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '77700ef7-e51a-4ab0-81dd-e276345cc0e2' AND ticker = 'TSM' AND sec_cik = 1046179;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'semiconductor manufacturing international' AND canonical_id = '77700ef7-e51a-4ab0-81dd-e276345cc0e2';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '77700ef7-e51a-4ab0-81dd-e276345cc0e2'
 WHERE id = '6f04d3f7-e7e2-4adf-8991-0d019063e82a' AND lookup_key = 'semiconductor manufacturing international' AND canonical_id = '0cb858c3-efc6-4980-8e09-6cdb32d21fff';

-- READ BACK. Expect one row: canonical_id 77700ef7-e51a-4ab0-81dd-e276345cc0e2, name Taiwan Semiconductor,
--            ticker TSM, sec_cik 1046179.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '6f04d3f7-e7e2-4adf-8991-0d019063e82a';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '0cb858c3-efc6-4980-8e09-6cdb32d21fff'
 WHERE id = '6f04d3f7-e7e2-4adf-8991-0d019063e82a' AND lookup_key = 'semiconductor manufacturing international' AND canonical_id = '77700ef7-e51a-4ab0-81dd-e276345cc0e2';


-- ---------------------------------------------------------------------
-- B74   lookup_key semiconductor manufacturing international corporation
--   from  Semiconductor Manufacturing International Corporation                (no ticker, no sec_cik)
--   to    Taiwan Semiconductor   [TSM / cik 1046179]
--   route SEC, candidate tier K4
--   authority TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD  (SEC registrant name agrees (subset with 2 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '53628282-9724-4b0b-b7bf-35426c545f54' AND lookup_key = 'semiconductor manufacturing international corporation' AND canonical_id = '0cb858c3-efc6-4980-8e09-6cdb32d21fff';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '0cb858c3-efc6-4980-8e09-6cdb32d21fff' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '77700ef7-e51a-4ab0-81dd-e276345cc0e2' AND ticker = 'TSM' AND sec_cik = 1046179;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'semiconductor manufacturing international corporation' AND canonical_id = '77700ef7-e51a-4ab0-81dd-e276345cc0e2';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '77700ef7-e51a-4ab0-81dd-e276345cc0e2'
 WHERE id = '53628282-9724-4b0b-b7bf-35426c545f54' AND lookup_key = 'semiconductor manufacturing international corporation' AND canonical_id = '0cb858c3-efc6-4980-8e09-6cdb32d21fff';

-- READ BACK. Expect one row: canonical_id 77700ef7-e51a-4ab0-81dd-e276345cc0e2, name Taiwan Semiconductor,
--            ticker TSM, sec_cik 1046179.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '53628282-9724-4b0b-b7bf-35426c545f54';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '0cb858c3-efc6-4980-8e09-6cdb32d21fff'
 WHERE id = '53628282-9724-4b0b-b7bf-35426c545f54' AND lookup_key = 'semiconductor manufacturing international corporation' AND canonical_id = '77700ef7-e51a-4ab0-81dd-e276345cc0e2';


-- ---------------------------------------------------------------------
-- B75   lookup_key taiwan semiconductor manufacturing co
--   from  Taiwan Semiconductor Manufacturing Company Ltd.                (no ticker, no sec_cik)
--   to    Taiwan Semiconductor   [TSM / cik 1046179]
--   route SEC, candidate tier K4
--   authority TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '29ed0dcc-0c4d-4998-922f-a65c6d0fe502' AND lookup_key = 'taiwan semiconductor manufacturing co' AND canonical_id = '3c873970-0b4e-4e39-b54f-bb222b81016e';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '3c873970-0b4e-4e39-b54f-bb222b81016e' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '77700ef7-e51a-4ab0-81dd-e276345cc0e2' AND ticker = 'TSM' AND sec_cik = 1046179;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'taiwan semiconductor manufacturing co' AND canonical_id = '77700ef7-e51a-4ab0-81dd-e276345cc0e2';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '77700ef7-e51a-4ab0-81dd-e276345cc0e2'
 WHERE id = '29ed0dcc-0c4d-4998-922f-a65c6d0fe502' AND lookup_key = 'taiwan semiconductor manufacturing co' AND canonical_id = '3c873970-0b4e-4e39-b54f-bb222b81016e';

-- READ BACK. Expect one row: canonical_id 77700ef7-e51a-4ab0-81dd-e276345cc0e2, name Taiwan Semiconductor,
--            ticker TSM, sec_cik 1046179.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '29ed0dcc-0c4d-4998-922f-a65c6d0fe502';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '3c873970-0b4e-4e39-b54f-bb222b81016e'
 WHERE id = '29ed0dcc-0c4d-4998-922f-a65c6d0fe502' AND lookup_key = 'taiwan semiconductor manufacturing co' AND canonical_id = '77700ef7-e51a-4ab0-81dd-e276345cc0e2';


-- ---------------------------------------------------------------------
-- B76   lookup_key taiwan semiconductor manufacturing co ltd
--   from  Taiwan Semiconductor Manufacturing Company Ltd.                (no ticker, no sec_cik)
--   to    Taiwan Semiconductor   [TSM / cik 1046179]
--   route SEC, candidate tier K4
--   authority TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '2555968d-9111-478e-ac6b-5022caa41920' AND lookup_key = 'taiwan semiconductor manufacturing co ltd' AND canonical_id = '3c873970-0b4e-4e39-b54f-bb222b81016e';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '3c873970-0b4e-4e39-b54f-bb222b81016e' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '77700ef7-e51a-4ab0-81dd-e276345cc0e2' AND ticker = 'TSM' AND sec_cik = 1046179;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'taiwan semiconductor manufacturing co ltd' AND canonical_id = '77700ef7-e51a-4ab0-81dd-e276345cc0e2';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '77700ef7-e51a-4ab0-81dd-e276345cc0e2'
 WHERE id = '2555968d-9111-478e-ac6b-5022caa41920' AND lookup_key = 'taiwan semiconductor manufacturing co ltd' AND canonical_id = '3c873970-0b4e-4e39-b54f-bb222b81016e';

-- READ BACK. Expect one row: canonical_id 77700ef7-e51a-4ab0-81dd-e276345cc0e2, name Taiwan Semiconductor,
--            ticker TSM, sec_cik 1046179.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '2555968d-9111-478e-ac6b-5022caa41920';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '3c873970-0b4e-4e39-b54f-bb222b81016e'
 WHERE id = '2555968d-9111-478e-ac6b-5022caa41920' AND lookup_key = 'taiwan semiconductor manufacturing co ltd' AND canonical_id = '77700ef7-e51a-4ab0-81dd-e276345cc0e2';


-- ---------------------------------------------------------------------
-- B77   lookup_key taiwan semiconductor manufacturing co. ltd.
--   from  Taiwan Semiconductor Manufacturing Company Ltd.                (no ticker, no sec_cik)
--   to    Taiwan Semiconductor   [TSM / cik 1046179]
--   route SEC, candidate tier K4
--   authority TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '7040f048-dce2-485b-97b1-ce798fdd86fb' AND lookup_key = 'taiwan semiconductor manufacturing co. ltd.' AND canonical_id = '3c873970-0b4e-4e39-b54f-bb222b81016e';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '3c873970-0b4e-4e39-b54f-bb222b81016e' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '77700ef7-e51a-4ab0-81dd-e276345cc0e2' AND ticker = 'TSM' AND sec_cik = 1046179;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'taiwan semiconductor manufacturing co. ltd.' AND canonical_id = '77700ef7-e51a-4ab0-81dd-e276345cc0e2';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '77700ef7-e51a-4ab0-81dd-e276345cc0e2'
 WHERE id = '7040f048-dce2-485b-97b1-ce798fdd86fb' AND lookup_key = 'taiwan semiconductor manufacturing co. ltd.' AND canonical_id = '3c873970-0b4e-4e39-b54f-bb222b81016e';

-- READ BACK. Expect one row: canonical_id 77700ef7-e51a-4ab0-81dd-e276345cc0e2, name Taiwan Semiconductor,
--            ticker TSM, sec_cik 1046179.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '7040f048-dce2-485b-97b1-ce798fdd86fb';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '3c873970-0b4e-4e39-b54f-bb222b81016e'
 WHERE id = '7040f048-dce2-485b-97b1-ce798fdd86fb' AND lookup_key = 'taiwan semiconductor manufacturing co. ltd.' AND canonical_id = '77700ef7-e51a-4ab0-81dd-e276345cc0e2';


-- ---------------------------------------------------------------------
-- B78   lookup_key taiwan semiconductor manufacturing company ltd.
--   from  Taiwan Semiconductor Manufacturing Company Ltd.                (no ticker, no sec_cik)
--   to    Taiwan Semiconductor   [TSM / cik 1046179]
--   route SEC, candidate tier K4
--   authority TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '0d216674-3295-4733-a5d3-d68fd0e0424a' AND lookup_key = 'taiwan semiconductor manufacturing company ltd.' AND canonical_id = '3c873970-0b4e-4e39-b54f-bb222b81016e';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '3c873970-0b4e-4e39-b54f-bb222b81016e' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '77700ef7-e51a-4ab0-81dd-e276345cc0e2' AND ticker = 'TSM' AND sec_cik = 1046179;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'taiwan semiconductor manufacturing company ltd.' AND canonical_id = '77700ef7-e51a-4ab0-81dd-e276345cc0e2';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '77700ef7-e51a-4ab0-81dd-e276345cc0e2'
 WHERE id = '0d216674-3295-4733-a5d3-d68fd0e0424a' AND lookup_key = 'taiwan semiconductor manufacturing company ltd.' AND canonical_id = '3c873970-0b4e-4e39-b54f-bb222b81016e';

-- READ BACK. Expect one row: canonical_id 77700ef7-e51a-4ab0-81dd-e276345cc0e2, name Taiwan Semiconductor,
--            ticker TSM, sec_cik 1046179.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '0d216674-3295-4733-a5d3-d68fd0e0424a';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '3c873970-0b4e-4e39-b54f-bb222b81016e'
 WHERE id = '0d216674-3295-4733-a5d3-d68fd0e0424a' AND lookup_key = 'taiwan semiconductor manufacturing company ltd.' AND canonical_id = '77700ef7-e51a-4ab0-81dd-e276345cc0e2';


-- ---------------------------------------------------------------------
-- B79   lookup_key hershey trust
--   from  Hershey Trust                (no ticker, no sec_cik)
--   to    The Hershey Company   [HSY / cik 47111]
--   route SEC, candidate tier K4
--   authority HERSHEY CO  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '0f7ee352-ae8f-46c5-8cca-4587a645313e' AND lookup_key = 'hershey trust' AND canonical_id = '179e8a50-0137-49f1-aa74-b87e89409cbb';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '179e8a50-0137-49f1-aa74-b87e89409cbb' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '4cb81852-add5-446d-968f-48ec56c37127' AND ticker = 'HSY' AND sec_cik = 47111;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'hershey trust' AND canonical_id = '4cb81852-add5-446d-968f-48ec56c37127';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '4cb81852-add5-446d-968f-48ec56c37127'
 WHERE id = '0f7ee352-ae8f-46c5-8cca-4587a645313e' AND lookup_key = 'hershey trust' AND canonical_id = '179e8a50-0137-49f1-aa74-b87e89409cbb';

-- READ BACK. Expect one row: canonical_id 4cb81852-add5-446d-968f-48ec56c37127, name The Hershey Company,
--            ticker HSY, sec_cik 47111.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '0f7ee352-ae8f-46c5-8cca-4587a645313e';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '179e8a50-0137-49f1-aa74-b87e89409cbb'
 WHERE id = '0f7ee352-ae8f-46c5-8cca-4587a645313e' AND lookup_key = 'hershey trust' AND canonical_id = '4cb81852-add5-446d-968f-48ec56c37127';


-- ---------------------------------------------------------------------
-- B80   lookup_key hershey trust co
--   from  Hershey Trust                (no ticker, no sec_cik)
--   to    The Hershey Company   [HSY / cik 47111]
--   route SEC, candidate tier K4
--   authority HERSHEY CO  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '16e96cbd-de72-489a-8ffb-302dd4775ad2' AND lookup_key = 'hershey trust co' AND canonical_id = '179e8a50-0137-49f1-aa74-b87e89409cbb';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '179e8a50-0137-49f1-aa74-b87e89409cbb' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '4cb81852-add5-446d-968f-48ec56c37127' AND ticker = 'HSY' AND sec_cik = 47111;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'hershey trust co' AND canonical_id = '4cb81852-add5-446d-968f-48ec56c37127';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '4cb81852-add5-446d-968f-48ec56c37127'
 WHERE id = '16e96cbd-de72-489a-8ffb-302dd4775ad2' AND lookup_key = 'hershey trust co' AND canonical_id = '179e8a50-0137-49f1-aa74-b87e89409cbb';

-- READ BACK. Expect one row: canonical_id 4cb81852-add5-446d-968f-48ec56c37127, name The Hershey Company,
--            ticker HSY, sec_cik 47111.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '16e96cbd-de72-489a-8ffb-302dd4775ad2';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '179e8a50-0137-49f1-aa74-b87e89409cbb'
 WHERE id = '16e96cbd-de72-489a-8ffb-302dd4775ad2' AND lookup_key = 'hershey trust co' AND canonical_id = '4cb81852-add5-446d-968f-48ec56c37127';


-- ---------------------------------------------------------------------
-- B81   lookup_key hershey trust co.
--   from  Hershey Trust                (no ticker, no sec_cik)
--   to    The Hershey Company   [HSY / cik 47111]
--   route SEC, candidate tier K4
--   authority HERSHEY CO  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '7468e6a4-3e94-4095-b3e3-3f1765e04e71' AND lookup_key = 'hershey trust co.' AND canonical_id = '179e8a50-0137-49f1-aa74-b87e89409cbb';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '179e8a50-0137-49f1-aa74-b87e89409cbb' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '4cb81852-add5-446d-968f-48ec56c37127' AND ticker = 'HSY' AND sec_cik = 47111;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'hershey trust co.' AND canonical_id = '4cb81852-add5-446d-968f-48ec56c37127';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '4cb81852-add5-446d-968f-48ec56c37127'
 WHERE id = '7468e6a4-3e94-4095-b3e3-3f1765e04e71' AND lookup_key = 'hershey trust co.' AND canonical_id = '179e8a50-0137-49f1-aa74-b87e89409cbb';

-- READ BACK. Expect one row: canonical_id 4cb81852-add5-446d-968f-48ec56c37127, name The Hershey Company,
--            ticker HSY, sec_cik 47111.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '7468e6a4-3e94-4095-b3e3-3f1765e04e71';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '179e8a50-0137-49f1-aa74-b87e89409cbb'
 WHERE id = '7468e6a4-3e94-4095-b3e3-3f1765e04e71' AND lookup_key = 'hershey trust co.' AND canonical_id = '4cb81852-add5-446d-968f-48ec56c37127';


-- ---------------------------------------------------------------------
-- B82   lookup_key hershey's
--   from  Hershey's                (no ticker, no sec_cik)
--   to    The Hershey Company   [HSY / cik 47111]
--   route SEC, candidate tier K4
--   authority HERSHEY CO  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'c89f5018-72bb-47e5-9dfa-8a520537e5bd' AND lookup_key = 'hershey''s' AND canonical_id = '2662a82e-cf47-4a5f-9678-940daac1978f';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '2662a82e-cf47-4a5f-9678-940daac1978f' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '4cb81852-add5-446d-968f-48ec56c37127' AND ticker = 'HSY' AND sec_cik = 47111;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'hershey''s' AND canonical_id = '4cb81852-add5-446d-968f-48ec56c37127';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '4cb81852-add5-446d-968f-48ec56c37127'
 WHERE id = 'c89f5018-72bb-47e5-9dfa-8a520537e5bd' AND lookup_key = 'hershey''s' AND canonical_id = '2662a82e-cf47-4a5f-9678-940daac1978f';

-- READ BACK. Expect one row: canonical_id 4cb81852-add5-446d-968f-48ec56c37127, name The Hershey Company,
--            ticker HSY, sec_cik 47111.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'c89f5018-72bb-47e5-9dfa-8a520537e5bd';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '2662a82e-cf47-4a5f-9678-940daac1978f'
 WHERE id = 'c89f5018-72bb-47e5-9dfa-8a520537e5bd' AND lookup_key = 'hershey''s' AND canonical_id = '4cb81852-add5-446d-968f-48ec56c37127';


-- ---------------------------------------------------------------------
-- B83   lookup_key wbd (warner bros discovery)
--   from  WBD (Warner Bros Discovery)                (no ticker, no sec_cik)
--   to    Warner Bros. Discovery   [WBD / cik 1437107]
--   route SEC, candidate tier K4
--   authority Warner Bros. Discovery, Inc.  (SEC registrant name agrees (subset with 3 shared tokens))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = '51815f6c-10dc-46ec-9354-00c66e94c664' AND lookup_key = 'wbd (warner bros discovery)' AND canonical_id = 'fc266eef-b104-4fed-a9a0-eef52d65fd31';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = 'fc266eef-b104-4fed-a9a0-eef52d65fd31' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = '726d3f0f-b6ee-4e8c-b0be-1a037abeb38e' AND ticker = 'WBD' AND sec_cik = 1437107;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'wbd (warner bros discovery)' AND canonical_id = '726d3f0f-b6ee-4e8c-b0be-1a037abeb38e';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = '726d3f0f-b6ee-4e8c-b0be-1a037abeb38e'
 WHERE id = '51815f6c-10dc-46ec-9354-00c66e94c664' AND lookup_key = 'wbd (warner bros discovery)' AND canonical_id = 'fc266eef-b104-4fed-a9a0-eef52d65fd31';

-- READ BACK. Expect one row: canonical_id 726d3f0f-b6ee-4e8c-b0be-1a037abeb38e, name Warner Bros. Discovery,
--            ticker WBD, sec_cik 1437107.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = '51815f6c-10dc-46ec-9354-00c66e94c664';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = 'fc266eef-b104-4fed-a9a0-eef52d65fd31'
 WHERE id = '51815f6c-10dc-46ec-9354-00c66e94c664' AND lookup_key = 'wbd (warner bros discovery)' AND canonical_id = '726d3f0f-b6ee-4e8c-b0be-1a037abeb38e';


-- ---------------------------------------------------------------------
-- B84   lookup_key u.k. energy company
--   from  U.K. energy company                (no ticker, no sec_cik)
--   to    X-energy   [XE / cik 2088896]
--   route SEC, candidate tier K4
--   authority X-Energy, Inc.  (SEC registrant name agrees (token sets equal))
-- ---------------------------------------------------------------------

-- G1 SOURCE. The alias row is where we left it. Expect 1. Anything else, stop.
SELECT count(*) AS g1_must_be_1 FROM aliases
 WHERE id = 'abd8a5f1-984a-4825-8771-cb9d8c65fd60' AND lookup_key = 'u.k. energy company' AND canonical_id = '1b2b8e6b-4c2a-44f9-a0fc-3ff9a63ce41a';

-- G2 SOURCE STILL ORPHANED. If Track 1 re-homed identity onto this row, this
--    returns 0 and the repoint is UNNECESSARY. Do not run the UPDATE. Expect 1.
SELECT count(*) AS g2_must_be_1 FROM companies
 WHERE id = '1b2b8e6b-4c2a-44f9-a0fc-3ff9a63ce41a' AND ticker IS NULL AND sec_cik IS NULL;

-- G3 TARGET STILL CARRIES THE IDENTITY THIS BLOCK WAS DERIVED FROM. If Track 1
--    moved it off, this returns 0 and the repoint is WRONG. Expect 1.
SELECT count(*) AS g3_must_be_1 FROM companies
 WHERE id = 'f9f0ddbb-aeef-480b-b6e8-63b5d4adc8e8' AND ticker = 'XE' AND sec_cik = 2088896;

-- G4 NO UNIQUE COLLISION. aliases_lookup_canonical_unique is
--    UNIQUE (lookup_key, canonical_id). A 1 here aborts the UPDATE. Expect 0.
SELECT count(*) AS g4_must_be_0 FROM aliases
 WHERE lookup_key = 'u.k. energy company' AND canonical_id = 'f9f0ddbb-aeef-480b-b6e8-63b5d4adc8e8';

-- APPLY. Pinned to id AND current value, so a re-run is a no-op and a drifted
--        row refuses. Expect UPDATE 1. UPDATE 0 means drift; re-read G1.
UPDATE aliases SET canonical_id = 'f9f0ddbb-aeef-480b-b6e8-63b5d4adc8e8'
 WHERE id = 'abd8a5f1-984a-4825-8771-cb9d8c65fd60' AND lookup_key = 'u.k. energy company' AND canonical_id = '1b2b8e6b-4c2a-44f9-a0fc-3ff9a63ce41a';

-- READ BACK. Expect one row: canonical_id f9f0ddbb-aeef-480b-b6e8-63b5d4adc8e8, name X-energy,
--            ticker XE, sec_cik 2088896.
SELECT a.id, a.lookup_key, a.canonical_id, c.name, c.ticker, c.sec_cik
  FROM aliases a JOIN companies c ON c.id = a.canonical_id
 WHERE a.id = 'abd8a5f1-984a-4825-8771-cb9d8c65fd60';

-- ROLLBACK. Same pinning in reverse.
UPDATE aliases SET canonical_id = '1b2b8e6b-4c2a-44f9-a0fc-3ff9a63ce41a'
 WHERE id = 'abd8a5f1-984a-4825-8771-cb9d8c65fd60' AND lookup_key = 'u.k. energy company' AND canonical_id = 'f9f0ddbb-aeef-480b-b6e8-63b5d4adc8e8';

