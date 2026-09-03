-- CIK LINKAGE BACKFILL, name-keyed. HAND APPLY ONLY. Generated, never executed by the generator.
--
-- WHAT THIS FIXES
-- companies.sec_cik has exactly two write paths and BOTH key on companies.ticker:
--   edgar/cik_mapping.py:_update_companies_sec_cik   `if not ticker: continue`
--   entity_resolver.py:populate_sec_cik_for_mint      lookup_cik_for_ticker(ticker)
-- 3,376 of 4,276 company rows carry a NULL ticker, so no code path can ever reach
-- them. The missing join is companies.name -> an SEC-authored registrant name.
-- This file is that join, resolved offline and frozen to row ids.
--
-- PROD READ that produced these rows: 2026-09-03T02:30:27Z (SELECT-only, keyset paginated).
--   companies 4,276 | ticker NOT NULL 900 | sec_cik NOT NULL 774 | description NOT NULL 0
-- Generated against origin/main 069eb86458cf72edb11a375a6de017892971ebe4.
--
-- AUTHORITY. SEC-authored names only, nothing downstream of our own writes:
--   submissions_index .name          EDGAR conformed name
--   cik_tickers.company_name         SEC company_tickers.json title
-- Former EDGAR names were matched too and are DELIBERATELY EXCLUDED; see BLOCK B.
--
-- MATCHER. backend/edgar/name_agreement.names_agree, unmodified, ALLOW_HEAD_PREFIX on
-- (MAX_HEAD_PREFIX_EXTRA = 1). That function is a VETO designed to run AFTER a ticker
-- join has already established identity. Used as the KEY it is not sufficient: over the
-- full 983,019-CIK EDGAR universe it accepts 2,993 of 3,502 rows and leaves 1,600 of them
-- holding six or more candidate CIKs. Four extra NECESSARY conditions were added. None
-- modifies name_agreement.py, whose TS mirror src/lib/name-agreement.ts and the on-demand
-- mint path src/lib/data-access/resolveOrCreateCompany.ts:108 must stay in parity.
--
--   U  LISTED UNIVERSE ONLY. The CIK must carry both tickers and exchanges in SEC's own
--      submissions record, or be present in cik_tickers. 7.7k CIKs, not 983k.
--   A  TOKEN-SET EQUALITY ONLY. Every other shape names_agree offers was hand-scored on
--      the real candidates and ships wrong pages when the name is the key:
--        acronym      'Tata Consultancy Services'->CTS CORP, 'EnBW'->Western New England
--                     Bancorp, 'BCG'->Binah Capital Group.  0 of 14 sampled were right.
--        head prefix  'Siemens'->Siemens Energy, 'Station F'->Station Casinos,
--                     'Accel'->Accel Entertainment.  ~6 of 16 sampled were wrong.
--        subset       'Coca-Cola FEMSA'->COCA COLA CO, 'Semiconductor Manufacturing
--                     International'->TAIWAN SEMICONDUCTOR.  ~half were wrong.
--        ratio        'Persistent'->XY Labs, 'Northern Air'->NORTHERN TRUST.
--   E  LEADING-INITIALS PARITY. _tokens() drops every single-character token, so
--      'J.P. Morgan' reduces to {morgan} and token-set-equals 'MORGAN GROUP HOLDING CO'
--      (group and holding are weak tokens). Measured false accept; guard forced by it.
--   F  STRICT MULTISET PARITY, with only a trailing SEC /XX/ qualifier stripped rather
--      than everything after the first slash. Set semantics collapse repeats:
--      'C.H. Robinson' -> {robinson} equals 'ROBINSON & ROBINSON, INC.'. The blanket
--      slash strip deletes real identity: 'Quad/Graphics, Inc.' -> {quad}, which then
--      equals the private equity firm 'Quad-C'. Both are measured false accepts.
--
-- UNIQUENESS. A row is stamped only when it has EXACTLY ONE admissible CIK and that CIK
-- is claimed by EXACTLY ONE row. THERE IS NO TIE-BREAK: ambiguity is refused, never
-- resolved by ranking. 10 rows were refused on ambiguity and are listed at the foot.
--
-- MEASURED ERROR RATES, hand-adjudicated, both directions:
--   false acceptance  1 wrong + 1 suspect in 115 adjudicated proposals = 0.87% / 1.74%
--                     (the wrong one, 'Corvex' -> Corvex, Inc./MOVE, is EXCLUDED below)
--   false rejection   7 recoverable listed companies in 70 adjudicated rejects = 10.0%
--                     e.g. Ameriprise, HUTCHMED, Arcelor Mittal, F.N.B. Corporation.
--                     That is the deliberate price of condition A. See the report.
--
-- CONSTRAINT HAZARD, both are PARTIAL unique indexes and carry no pg_constraint row:
--   companies_sec_cik_unique    UNIQUE (sec_cik) WHERE sec_cik IS NOT NULL
--       Every UPDATE below ENTERS this index. A collision aborts the block. Section 0
--       is the pre-apply guard for it and MUST return zero rows.
--   companies_name_norm_unique  UNIQUE (lower(btrim(name))) WHERE sec_cik IS NULL
--       Every UPDATE below LEAVES this index. Leaving an index can never raise, and no
--       UPDATE here sets a cik back to NULL, so this index is not a hazard for this file.
--
-- IDEMPOTENCE. Every WHERE is pinned to the row id AND the current value of both columns
-- it depends on. A re-run stamps nothing. A row whose name or sec_cik drifted since
-- 2026-09-03T02:30Z matches nothing and is skipped rather than overwritten. Each block
-- read-back RAISES on any shortfall, which rolls that block back whole.
--
-- ROWS: 411 in 9 blocks of at most 50.

\set ON_ERROR_STOP on

-- ============================================================================
-- SECTION 0. PRE-APPLY GUARD. Run this FIRST. All three queries MUST return
-- ZERO rows. If any returns a row, STOP and regenerate; do not hand-edit.
-- ============================================================================

-- 0a. Any proposed CIK already held by ANY company row. This is the
--     companies_sec_cik_unique collision the brief calls out. MUST be empty.
WITH proposed(id, cik, name) AS (VALUES
    ('2a58a470-bc99-486e-a7ea-63c8d219200d'::uuid, 1070494, 'Acadia Pharmaceuticals'),
    ('b4cef861-b368-47de-9d6d-ecd7f0ede8d9'::uuid, 949858, 'Achieve Life Sciences'),
    ('5438b02d-6846-43a2-b35c-6fcd8ab94502'::uuid, 880984, 'ACORN ENERGY'),
    ('8e6c164e-7a79-4a02-8ba6-b557a68bc9f1'::uuid, 1670541, 'Adient'),
    ('cf722bdd-d1ae-41db-b9ea-db48c3e0f179'::uuid, 1378789, 'AerCap'),
    ('65411a83-7119-4131-839d-2bdabe8f3765'::uuid, 2081206, 'AGI Inc'),
    ('0aa3eefa-43a0-449a-90bb-dee79f29bca0'::uuid, 1378580, 'Airbus'),
    ('c20b5937-8f63-4e38-8449-3e77fa7f15f2'::uuid, 903419, 'Alerus Financial'),
    ('e0bcfde4-adca-45dc-8da2-95b03ccf9a15'::uuid, 1362468, 'Allegiant Travel'),
    ('a6879886-641f-4613-b2a5-1090dab79fbc'::uuid, 899051, 'Allstate Corp'),
    ('eacc432f-08bf-42e4-8ed7-306d874791e7'::uuid, 40729, 'Ally Financial Inc.'),
    ('e9a408fe-a9e3-4433-bc52-37301421128f'::uuid, 1178670, 'Alnylam Pharmaceuticals'),
    ('9d904e24-05fb-4f5d-b377-d8bbf2d6be7f'::uuid, 1161611, 'Aluminum Corporation of China'),
    ('8c7179a8-46f2-4b4b-af3a-75170f4b3000'::uuid, 1411579, 'AMC Entertainment Holdings Inc.'),
    ('03c6c452-2fdb-4cd2-8499-a82e08424d14'::uuid, 1053507, 'American Tower'),
    ('ced30870-5ae6-45d9-bd7c-97d6d201dd08'::uuid, 820027, 'Ameriprise Financial'),
    ('11be8abb-4b04-460d-a269-6ceae9675e26'::uuid, 707605, 'AmeriServ Financial'),
    ('26e931c5-7070-4e9f-b794-37c87fcd1132'::uuid, 6176, 'Ampco Pittsburgh'),
    ('4f9096a5-0ac4-4d94-8d62-c93cd7c76230'::uuid, 1370053, 'AnaptysBio'),
    ('604bcbc4-7b4e-4bd4-9d3d-b6b82a1ae799'::uuid, 1973832, 'Anglogold Ashanti PLC'),
    ('7f679826-d4a2-4c1f-98f4-bccac200d7f8'::uuid, 1023024, 'ANI Pharmaceuticals'),
    ('5b364ffc-53ae-4bf0-9d62-ee036014f007'::uuid, 922864, 'Apartment Investment and Management Company'),
    ('67fe6bfe-dd92-4f9a-a682-6147dcbf76c5'::uuid, 1433195, 'AppFolio'),
    ('8bb2eb81-0107-4fc6-a262-6ef9e8cbf9e6'::uuid, 894405, 'ArcBest'),
    ('5857f776-6e7f-4ccc-b3db-fe1cf495a10f'::uuid, 947484, 'Arch Capital'),
    ('41877900-bc2a-4956-b00e-6682dfd13010'::uuid, 1768224, 'Arcturus Therapeutics'),
    ('c0d02715-0160-4f5b-aed2-9e99c948533d'::uuid, 1697862, 'Argenx'),
    ('9be6d7d7-cde5-4e35-82e0-ec8c01c9f59a'::uuid, 1820721, 'Array Technologies'),
    ('8305b8db-0109-4764-82e2-b1735f147d52'::uuid, 879407, 'Arrowhead Pharmaceuticals'),
    ('62a9d930-9870-4eab-a252-0af0598e3922'::uuid, 1145986, 'Aspen Aerogels'),
    ('1c13f3a3-0fb5-4d31-bf36-0e3345b26f1e'::uuid, 1487198, 'Aspen Group'),
    ('7afc3f04-45ac-4c72-9c20-5c012f142585'::uuid, 7789, 'Associated Banc Corp'),
    ('7eddba76-5180-45fa-b250-acdb1e9724e0'::uuid, 901832, 'AstraZeneca'),
    ('7b6a76f1-4d2a-452a-922f-caf34aced299'::uuid, 2081043, 'AtaiBeckley'),
    ('be3cf448-1d4f-4ff8-9c6b-9572be264e92'::uuid, 1420520, 'Atomera'),
    ('a0a53d11-3c7d-4460-a56f-c951d0a241ce'::uuid, 1683541, 'Aurora Cannabis'),
    ('b6568c8f-7204-4730-98d2-ca1865271c05'::uuid, 350698, 'AutoNation'),
    ('1a0f8c2a-c3ad-4021-8909-d0a6e9582b7d'::uuid, 1214816, 'AXIS Capital'),
    ('b99a0836-986d-4d3d-8084-1d18883a3824'::uuid, 1069183, 'Axon Enterprise'),
    ('3433936b-26f9-46e9-818f-c5f6559894d5'::uuid, 933974, 'Azenta'),
    ('85e6fd49-e02d-4396-9bbc-0cd987afb2f8'::uuid, 1278027, 'B&G Foods'),
    ('d4365507-3258-480b-9be0-cdbf8275d2e9'::uuid, 1429937, 'B2Gold Corp'),
    ('6edec227-596d-4c1b-b7f3-ec7e3d7051f1'::uuid, 1453015, 'Ballard Power Systems'),
    ('7bbb4ea0-4af7-47ef-a9e1-11ab5329a7ca'::uuid, 1747079, 'Bally''s'),
    ('a935203d-63a8-494e-9c18-17eb6d50ad56'::uuid, 2127862, 'Baltic Classifieds'),
    ('2a271e31-7c35-4dae-bce1-5d735b363f22'::uuid, 842180, 'Banco Bilbao Vizcaya Argentaria'),
    ('4ebbeefa-b82f-4f25-8308-54dcc6b6fc27'::uuid, 891478, 'Banco Santander S.A.'),
    ('e4d3e5f2-0e92-4972-89ef-38806d09994a'::uuid, 1504008, 'BankUnited'),
    ('45f3f08f-5196-4ed9-9316-70a1c9c0966d'::uuid, 1978954, 'BBB Foods'),
    ('408c99f3-9688-44fb-96f5-8588eef53c65'::uuid, 915840, 'Beazer Homes USA'),
    ('0f715b45-0554-490b-b6a6-fa852e096171'::uuid, 842023, 'Bio-Techne'),
    ('d018f0b8-b794-4f24-b7f0-7914a5d90f21'::uuid, 834365, 'BioLife Solutions, Inc.'),
    ('57196813-55d6-4867-a565-d7feb0482d85'::uuid, 1498403, 'BioLineRx'),
    ('8b2e0952-33d3-43c2-887b-3ba7d01f0cc6'::uuid, 1776985, 'BioNTech'),
    ('1e061841-8579-425d-94be-c477bf31186f'::uuid, 1720893, 'BioXcel Therapeutics'),
    ('4386731c-9908-4a00-a553-c3e7a16f6098'::uuid, 1838406, 'BKV'),
    ('7604e8be-0afd-4ecf-a771-e9f2d616f62f'::uuid, 1130464, 'Black Hills Corporation'),
    ('c3d8e115-4157-4163-b6dd-ff3e56a4e85e'::uuid, 1070235, 'Blackberry'),
    ('69807bb4-f226-4aed-ad28-b59ca4a81a01'::uuid, 1546417, 'Bloomin'' Brands'),
    ('6d94b7cc-f799-4e34-9b01-44c009d03742'::uuid, 1589526, 'Blue Bird'),
    ('6d173063-6932-4498-a0b8-9e8a54db4f34'::uuid, 908255, 'BorgWarner'),
    ('13db8ca4-862b-410f-9f2a-89659d8d10ff'::uuid, 949870, 'Boston Beer'),
    ('bc4a41fc-c072-4129-bb80-a2e1d040ecc0'::uuid, 1906364, 'BOXABL'),
    ('d6b99d4f-acec-4407-b63e-1989445ddf1d'::uuid, 1505065, 'Brainsway'),
    ('0d8b61d1-cd84-4fb0-a4e6-2f407af62aeb'::uuid, 1071438, 'Braskem S.A.'),
    ('87704492-ceea-41b8-bd08-a17e6b00a4c5'::uuid, 14272, 'Bristol Myers Squibb'),
    ('61a1d805-f9fc-44e3-bd01-c71bf2545732'::uuid, 1303523, 'British American Tobacco p.l.c.'),
    ('db126811-2463-41ca-ac3d-8805c1387cd8'::uuid, 1383312, 'Broadridge Financial Solutions'),
    ('e620a5b4-c091-4e23-850a-792e6910af2f'::uuid, 1545772, 'Brookfield Property Partners'),
    ('7055f3c9-93b8-45b2-b0ce-0aa15650178b'::uuid, 1109354, 'Bruker'),
    ('82a76ce5-df3d-4664-b652-9bf750fec8a8'::uuid, 1714174, 'Burford Capital'),
    ('0dae6c3d-4610-4821-9fcc-cf058e5a270e'::uuid, 1447956, 'BYD Electronic (International)'),
    ('749c8929-b72e-45c6-9cfa-238b7b521b90'::uuid, 1043277, 'C.H. Robinson Worldwide'),
    ('466f0460-a200-4da1-960f-838b30bea464'::uuid, 1632127, 'Cable One'),
    ('1351ce5e-91b1-41c8-b76e-be8686bdd107'::uuid, 813672, 'Cadence Design Systems'),
    ('485dfec5-87ee-4da4-9dfb-3a44433bc66e'::uuid, 1035201, 'California Water Service Group'),
    ('a04e9040-2814-4717-bc7e-d6d13437f9d1'::uuid, 2034268, 'Cantor Equity Partners III, Inc.'),
    ('21a8ab80-ff0b-4cdd-9c4d-d64fd88f1f27'::uuid, 927628, 'Capital One Financial Corporation'),
    ('16949daa-fdd5-447f-a4dc-e2d5ec705d06'::uuid, 1530721, 'Capri Holdings'),
    ('0a1e8fd1-d63f-4f39-984a-874ec53c4a67'::uuid, 2019410, 'Caris Life Sciences'),
    ('c843342d-ed2f-4d72-98ef-9a1b7e35d0e7'::uuid, 1447362, 'Castle Biosciences'),
    ('dc7027d5-5b4d-4e27-80d4-8fe3c6bbb5b1'::uuid, 1138118, 'CBRE Group'),
    ('47e507c3-45f2-47ca-a54d-bd4640fbafef'::uuid, 949157, 'Century Aluminum'),
    ('a0e35816-7939-4d7e-98f6-67240695af86'::uuid, 1324404, 'CF Industries'),
    ('e3ec17dc-b62f-43ca-9570-2b9afe9ae108'::uuid, 313927, 'Church & Dwight Co., Inc.'),
    ('8259c117-812c-401d-9bf4-3f890736b52a'::uuid, 759944, 'Citizens Financial Group Inc.'),
    ('cfe37bed-12ea-461f-abb8-9c76a485fa34'::uuid, 1441236, 'Clearwater Paper'),
    ('4dc5f266-d9ed-4c73-b17e-f5cb7e14fbb6'::uuid, 1780785, 'CN Energy'),
    ('b6972604-6cc8-4fb2-85c9-c8626686eb65'::uuid, 1070412, 'CNX Resources'),
    ('90335c06-e540-4386-a6e1-e221fc702af4'::uuid, 1284812, 'Cohen & Steers'),
    ('f91be27f-1533-4712-a3c9-4ecf2919f670'::uuid, 887343, 'Columbia Banking System'),
    ('606f91a7-ff8e-42f7-8177-0127820e2742'::uuid, 1050797, 'Columbia Sportswear Company'),
    ('e65ef23e-3fc9-4c22-aae4-09b33b8a037d'::uuid, 1012037, 'Compagnie de Saint Gobain'),
    ('6edc94ff-93bf-4d41-81aa-84b1eac1445b'::uuid, 1563190, 'Compass'),
    ('48f47aa5-df9a-4dc3-abb4-7bb318050545'::uuid, 1119774, 'Compugen'),
    ('c43c607f-7100-44ff-a4e4-587b68abedab'::uuid, 816956, 'CONMED'),
    ('5188f910-7190-4dc2-a477-1d6f5a49d12c'::uuid, 2070829, 'Contemporary Amperex Technology Co. Ltd.'),
    ('30c2fc6a-b24e-4f17-b183-adbdefa20ebd'::uuid, 2064307, 'ContextLogic'),
    ('25264ff1-f9cd-4a1b-ae1c-256f220839df'::uuid, 1088856, 'Corcept Therapeutics'),
    ('28118241-4373-4e29-90bb-bce83ca02c27'::uuid, 1026655, 'Core Molding Technologies'),
    ('d1efc560-47fc-4975-a647-e7335b985808'::uuid, 1070985, 'CoreCivic'),
    ('51dbf790-fbff-4983-a5a8-2a782908a96f'::uuid, 1743759, 'Corsair Gaming'),
    ('04fbd49d-c88b-4f5f-bf5c-c85bc61d49da'::uuid, 1755672, 'Corteva'),
    ('dd023a0e-6519-4be0-8e38-2dea1719beb2'::uuid, 1832928, 'Cresco Labs'),
    ('bb10d95d-b556-4f4e-8497-cf9055680698'::uuid, 1576427, 'Criteo'),
    ('f667818a-cf94-436b-9186-401d10e760f8'::uuid, 1334036, 'Crocs'),
    ('7be9b55d-672f-4f04-b9dd-20bbf658443d'::uuid, 1298675, 'CubeSmart'),
    ('ed9be63c-145b-4053-b17b-ca190ed3bc6a'::uuid, 26172, 'Cummins'),
    ('71a7fe83-49bf-4d0b-8ed8-45a70df462db'::uuid, 64803, 'CVS Health Corp'),
    ('841c9245-87ba-4e3b-aa97-6647dc20e809'::uuid, 1437712, 'DCC'),
    ('45eb2fc8-7d89-4cfa-a9eb-d07096e0c094'::uuid, 1694426, 'Delek US'),
    ('21bcc70f-d820-4078-96d3-61d6de6fa278'::uuid, 1050140, 'Descartes Systems Group'),
    ('1b03011e-cbdf-4a96-9ba0-c9e014242a7c'::uuid, 813298, 'Destination XL Group'),
    ('e043e420-71e9-4fc6-b7e7-5895871b2461'::uuid, 1049724, 'Deutsche Lufthansa'),
    ('dd43b9e8-4b7c-4ae4-a614-381498d2bb3a'::uuid, 909108, 'Diamond Hill Investment Group'),
    ('c545478f-97f0-4caa-8b8e-fe54f485e7c6'::uuid, 317788, 'Digital Turbine'),
    ('caddae6f-a848-4ba9-afe4-05f92a6cd160'::uuid, 1857475, 'DOLE plc'),
    ('caa17d5f-c70c-419a-9911-57fddef60ef0'::uuid, 29905, 'Dover Corporation'),
    ('4eb72ca4-b744-42b2-893c-dfc870875e89'::uuid, 2094201, 'DPC Dash'),
    ('4621237c-d855-43ab-aec7-ee20857201dd'::uuid, 1804745, 'Driven Brands Holdings Inc.'),
    ('9a0d2558-4eca-491e-bf21-51e2fe8b1c68'::uuid, 1136808, 'E.ON'),
    ('858682c6-deef-4af1-b24a-4c31b173b4f1'::uuid, 31235, 'Eastman Kodak'),
    ('c7a6c9b2-7ef5-4180-b3e9-6c7ebcdeb295'::uuid, 1590714, 'Element Solutions'),
    ('caac6b49-210c-4cb5-9061-845deb2dbe07'::uuid, 1969796, 'Embracer Group'),
    ('8eda13dc-89ae-4f52-a0b3-ee21064422c9'::uuid, 1127248, 'Emera Incorporated'),
    ('d8ee941c-e236-4133-a5fe-ff0e76f3cdbc'::uuid, 32604, 'Emerson Electric Company'),
    ('40e49de8-2a57-4c76-bff1-ef16e3588f94'::uuid, 1084961, 'Encore Capital Group'),
    ('60fa4a41-06c7-4752-a245-92be85c767d5'::uuid, 1140625, 'Equinor ASA'),
    ('4cd9bc95-6364-45af-9b84-24a54c443974'::uuid, 1333986, 'Equitable Holdings Inc.'),
    ('015e1dd9-ae0a-4b85-94f6-a660aaacd9c9'::uuid, 1434868, 'Esperion Therapeutics'),
    ('f5315772-f5a1-470e-b24f-785fa7eb16bb'::uuid, 1412558, 'Evotec'),
    ('a18f0c30-365d-46f5-824a-0c8cb0b29fbd'::uuid, 939767, 'Exelixis'),
    ('ca369570-dc51-4e1d-b667-d6d8bfa395dc'::uuid, 1109357, 'Exelon'),
    ('ab4bcf16-d848-43a8-9020-5d012a812f89'::uuid, 2115436, 'ExxonMobil'),
    ('fe990a20-893f-4dcf-a8c7-1a6a21be947d'::uuid, 814547, 'Fair Isaac Corporation'),
    ('199fcbf8-8e70-4f22-b6bf-fa3f77a49700'::uuid, 915191, 'Fairfax Financial'),
    ('d987372c-3f3b-4a12-a2d6-cd8f4670dbba'::uuid, 277509, 'Federal Signal'),
    ('4eb3bd64-92e8-4472-8c22-88d25ca50ab5'::uuid, 1648416, 'Ferrari'),
    ('c1061f2e-f29a-4e8f-aba9-4b5e67eda0ec'::uuid, 1468522, 'Ferrovial'),
    ('196af0c4-0323-455c-8f57-679fd6d94afa'::uuid, 1098151, 'Fidelity D & D Bancorp'),
    ('177f5877-34f7-4382-acdf-58b16c887c2a'::uuid, 1331875, 'Fidelity National Financial Inc.'),
    ('b8f22e06-b870-4ab5-b3b6-22ded57daf9b'::uuid, 2073638, 'Finning International'),
    ('209f2f09-cb25-4e1d-8590-5056fd301b5d'::uuid, 1746109, 'First Bank & Trust'),
    ('aefb7b8b-8bba-4d85-bd4a-48cc095f38fb'::uuid, 860413, 'First Interstate Bancsystem'),
    ('718ec183-7678-4518-8d01-3cbd92c15b31'::uuid, 1666175, 'Fortis'),
    ('0f3b28b6-c3a5-4d29-954e-1f04d0606231'::uuid, 1828377, 'Fortitude Gold'),
    ('441b3816-6813-472c-bbac-8238aefd8d2c'::uuid, 1559444, 'Forvia'),
    ('dc5198b0-c198-44a2-95e9-8e9e1a704d4c'::uuid, 1456346, 'Franco Nevada'),
    ('e3e97199-9214-4f8f-8288-195d66ee36a4'::uuid, 1320854, 'FreightCar America'),
    ('86418122-85a6-4f9a-a6d1-6e7dab5684fd'::uuid, 887936, 'FTI Consulting'),
    ('6f9742e0-2758-4c30-8eb9-4c69bbc8d9c8'::uuid, 700564, 'Fulton Financial'),
    ('ed12e388-1d66-4745-b66e-f99e8786a824'::uuid, 1704711, 'Funko'),
    ('67cda1e8-ae72-400f-86c9-5ebc0a776912'::uuid, 1996810, 'GE Vernova'),
    ('85d2b0c6-7c32-48ae-8ff4-e0ac6da4be88'::uuid, 1474968, 'Geely Automobile Holdings Ltd.'),
    ('b9bb6061-2ddb-469b-a157-0a1720198442'::uuid, 849399, 'Gen Digital'),
    ('e3bf8db7-24fa-41b4-80c1-4da9dc0406c2'::uuid, 2074850, 'General Fusion'),
    ('a3f9789c-ca15-4d19-9953-cbed40cc55b6'::uuid, 2100782, 'Generate Biomedicines'),
    ('f240ef76-f7c6-46a0-96ef-edb5b51f4cbc'::uuid, 1022321, 'Genesis Energy'),
    ('40a542eb-c2a4-4152-8d45-eaedb15b73f7'::uuid, 1434265, 'Genmab'),
    ('59614a6e-dc78-4b4a-9ae4-c7d171b4d61e'::uuid, 355811, 'Gentex Corporation'),
    ('5602b4fc-92d3-48f2-900d-f9e84f36f7e0'::uuid, 903129, 'Gentherm'),
    ('2282debc-6c62-46b6-ad65-afea4e1696ef'::uuid, 1898496, 'Getty Images'),
    ('57855961-8b70-4379-a953-45a9e63a195d'::uuid, 2071913, 'Gibson Energy'),
    ('6b648f58-a4ab-4e2c-8174-1c801ff683c7'::uuid, 1857816, 'GigaCloud Technology'),
    ('5a0715d4-e258-4c18-8f0c-48577bcf67a0'::uuid, 897322, 'Gilat Satellite Networks Ltd.'),
    ('95d22579-53d8-476f-83c4-5db780830a0d'::uuid, 882095, 'Gilead Sciences'),
    ('d78c0ee4-31d9-4a09-80f7-d1d05012e9af'::uuid, 1830214, 'Ginkgo Bioworks'),
    ('e63a769b-fba8-4afc-9cca-833e7f15a16e'::uuid, 1653482, 'GitLab'),
    ('0111093a-fca9-462b-82a4-e3b3ffd68782'::uuid, 1609711, 'GoDaddy Inc.'),
    ('c96ccd9f-7230-4558-9bb6-c7d46b9d801d'::uuid, 1273441, 'Gran Tierra Energy'),
    ('b6764f15-f0a4-4738-9c17-3d5b16a4186f'::uuid, 1434588, 'Grand Canyon Education'),
    ('ac87b972-93e9-4419-b485-4d66034ff77f'::uuid, 1771515, 'Grocery Outlet Holding Corp.'),
    ('96bfc6d4-5679-44da-9539-3010d42b679e'::uuid, 912892, 'Grupo Televisa'),
    ('d8487ec2-464b-4796-89f2-8cc345949e66'::uuid, 1802255, 'Guardian Pharmacy Services'),
    ('aa9a72ba-b514-4df1-8d91-4a5b7e8aca0c'::uuid, 1483994, 'H World Group'),
    ('f0c712ec-1f90-4197-ace8-bc028a12222e'::uuid, 2073669, 'Hansoh Pharmaceutical'),
    ('91d049f5-e7bd-4942-8bbd-65f886c140a0'::uuid, 1802665, 'Harmony Biosciences'),
    ('a55bc6e4-53a9-4a06-a425-b2a03e51a43a'::uuid, 860730, 'HCA Healthcare'),
    ('9cb581e8-7d57-4946-8e4b-67114c3d96f7'::uuid, 1144967, 'HDFC Bank'),
    ('313699f7-165c-4a2e-ade1-bc1a2c0969d1'::uuid, 719413, 'Hecla Mining'),
    ('8e0b0ff9-6c33-45ad-b714-017cf3782efd'::uuid, 46619, 'HEICO'),
    ('8a873e47-d22a-4b9e-ae2f-f66290997969'::uuid, 1364479, 'Herc Holdings'),
    ('bf3bba1a-a5b0-4d72-98fc-488a5bd315e4'::uuid, 1446962, 'Hochschild Mining'),
    ('7361687b-ee93-4cef-b71d-7bf76fc634ca'::uuid, 49196, 'Huntington Bancshares'),
    ('ecbb4091-1b58-4c03-ab01-d6864ab9198f'::uuid, 1718405, 'Hycroft Mining'),
    ('6cb4bf0c-0588-4fd9-939e-457f8cd83d91'::uuid, 2078856, 'Hyperliquid Strategies'),
    ('62d86dbf-975e-4b64-a427-7c1a852ea145'::uuid, 1538379, 'Ibotta'),
    ('0e7873d4-a0ab-47e9-814a-79657e8144e8'::uuid, 1103838, 'ICICI Bank'),
    ('31596b3f-e083-482b-bd37-06448722449d'::uuid, 2062803, 'IDP Education'),
    ('2d3070b2-2a26-4e52-ba3c-8e928a5856cc'::uuid, 1790340, 'Immuneering'),
    ('d2e7b7a3-6f08-4bf5-904b-dff22a8dca83'::uuid, 1067491, 'Infosys'),
    ('b5b4dca8-d39e-455d-b75d-9ba7b796641f'::uuid, 1774163, 'Innovent Biologics'),
    ('9040e46a-8d0a-4479-aa4f-4011a1aec014'::uuid, 1114483, 'Integer Holdings'),
    ('4f115e27-d51c-4760-a22d-18ebd9938102'::uuid, 917520, 'Integra LifeSciences'),
    ('ab6b87f7-b5c0-4dc3-8c6c-72a6ff14d07f'::uuid, 1652130, 'Intellia Therapeutics'),
    ('45b9d2d7-5867-4af1-9788-d0ea2bf21313'::uuid, 1405495, 'InterDigital, Inc.'),
    ('dc99d8ab-018e-4142-bb8e-246dfc467cdd'::uuid, 1425205, 'Iovance Biotherapeutics'),
    ('e70746fe-9049-4ed3-90c8-f857e3d94304'::uuid, 1020569, 'Iron Mountain Incorporated'),
    ('24377324-181e-4bc2-b9fa-2fb213150ced'::uuid, 1009829, 'JAKKS Pacific'),
    ('1d9382ae-04b4-4763-a005-7a55e1dd749b'::uuid, 1600520, 'Japan exchange'),
    ('99770153-b800-4d12-8b16-160403329878'::uuid, 1549802, 'JD.Com'),
    ('bb7d9505-f72f-4f82-b399-6477f0742301'::uuid, 1674335, 'JELD-WEN'),
    ('d7972265-365c-4cbd-98a7-159f3613a8fb'::uuid, 2127043, 'Jersey Mike’s Subs'),
    ('83e9977d-70b4-4dcc-ab02-1476801c5cb7'::uuid, 1357615, 'KBR'),
    ('1f2f4e3c-ceee-43fb-b015-59285eee3f46'::uuid, 91576, 'KEYCORP'),
    ('b32d07b3-729d-4832-a2b3-198320acfaa7'::uuid, 1601046, 'Keysight Technologies'),
    ('04af6598-f431-449b-ba17-e86d7300cf4c'::uuid, 55785, 'Kimberly-Clark'),
    ('757edfb0-de82-42e2-9682-92550f0c48e4'::uuid, 2053383, 'Kioxia'),
    ('c972472d-144e-4b1d-9e52-6c5928d16c44'::uuid, 2033019, 'Kokusai Electric'),
    ('6c0beff6-5373-4682-a5b2-9cb52571ac30'::uuid, 1857154, 'Krispy Kreme'),
    ('af6d9f1b-679a-4b7f-8d8c-2157491c5a8d'::uuid, 56873, 'Kroger'),
    ('3b5555ee-758f-41fa-b011-fb7a0cb5c0a7'::uuid, 1679273, 'Lamb Weston'),
    ('f1f3315f-d8c4-436a-9014-47c02d21bf3e'::uuid, 1521036, 'Lantheus Holdings'),
    ('d31c7904-3540-4061-9100-9e8aca84cd53'::uuid, 2068440, 'Laopu Gold'),
    ('5dd572ad-1e41-43cc-90f2-1e359fc94ff2'::uuid, 1069202, 'Lennox International'),
    ('eb2bbe14-b155-4ea2-a64a-0a74405385d2'::uuid, 1580670, 'LGI Homes'),
    ('8101c4e1-9458-49be-b04d-5bd013b5b320'::uuid, 849146, 'LifeVantage'),
    ('e83c3235-20e4-4c46-bd92-caf5beacd801'::uuid, 886163, 'Ligand Pharmaceuticals'),
    ('c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid, 59558, 'Lincoln National Corporation'),
    ('74ab5dad-8ca9-47fe-b450-1ad4d9406bd7'::uuid, 2140948, 'Lion Finance Group'),
    ('71519329-a4cb-4d19-93af-cb0dc70b7cea'::uuid, 1023128, 'Lithia Motors'),
    ('4e68c911-71cd-41cf-97bd-8076c0c94ba1'::uuid, 1462120, 'Live Oak Bancshares'),
    ('3778ec3b-adf7-4547-b0a8-9898ee18692d'::uuid, 733269, 'LiveRamp'),
    ('378c0d7d-d496-4360-9d95-fd8377663298'::uuid, 1160106, 'Lloyds Banking Group'),
    ('3496b52d-df1c-4e22-a8c0-e8ba63830664'::uuid, 1831631, 'Loandepot'),
    ('5a9d7aeb-c466-49c3-9382-a67a340f169d'::uuid, 60086, 'Loews'),
    ('398fe069-92de-4f0a-92e8-474fff3093ec'::uuid, 1767582, 'Luckin Coffee'),
    ('03476ec7-4dcb-442c-8822-fe7e60f28879'::uuid, 1489393, 'LyondellBasell Industries'),
    ('5c8bc39d-cc2d-43fc-92a0-df9ec847fb1d'::uuid, 749098, 'Magna'),
    ('680b460c-a1ef-4c8d-be26-25b8222ee205'::uuid, 1495153, 'MakeMyTrip'),
    ('4f50c656-d8af-419d-8f5b-3e81039c924c'::uuid, 1086888, 'Manulife Financial'),
    ('7850e41f-9fa0-411b-b314-65b4b602f411'::uuid, 2131961, 'Manycore Tech Inc.'),
    ('b35f13f1-ab26-47a1-bf52-af977eb2974d'::uuid, 1048286, 'Marriott International'),
    ('953df921-711a-4ef3-845d-4dc7b210ac66'::uuid, 799167, 'Marten Transport'),
    ('84332844-fda6-410e-9a6b-fa52790cdf0a'::uuid, 1668397, 'Medpace'),
    ('039714ac-bd75-46f5-8521-73fa1fdd8049'::uuid, 1042729, 'Mercantile Bank'),
    ('e30e2af2-49a1-4f55-9ed2-a0d23623d097'::uuid, 833079, 'Meritage Homes'),
    ('9ccef504-78fb-45e1-9e89-c56b41ef2121'::uuid, 2090231, 'METLEN Energy & Metals PLC'),
    ('637aa6b8-6da5-4f58-b90d-d7efeb908c36'::uuid, 1760689, 'Microvast'),
    ('010372bd-8c4d-4cc4-a87b-4f6593a9d26b'::uuid, 2039784, 'Midea Group'),
    ('7c924ae7-3041-4f16-bc78-ca06a858c1e3'::uuid, 924822, 'Miller Industries'),
    ('85a1766d-1cb6-4f75-87a1-e6875f1c195e'::uuid, 1436126, 'Mistras Group'),
    ('a7a46c35-dbc2-489d-ab1e-e3e3a80c0040'::uuid, 67347, 'Modine Manufacturing'),
    ('fc0bd7c2-a123-4c8e-b6c0-8747f48a0641'::uuid, 865752, 'Monster Beverage'),
    ('65c9ddaf-6a1c-44cb-874a-aefe909c568f'::uuid, 2123346, 'Montage Technology Co.'),
    ('76ba3fec-13ae-4210-82e1-5d723d5e93da'::uuid, 1350593, 'Mueller Water Products'),
    ('6eda5d47-02ea-41c9-87d0-86e22265a8af'::uuid, 899923, 'Myriad Genetics'),
    ('2bd4e6b1-745b-46de-accd-e34ab50ed359'::uuid, 1795251, 'Nano X Imaging'),
    ('8b2aa808-1675-4ac0-a7e8-2812321d068a'::uuid, 69633, 'NAPCO SECURITY TECHNOLOGIES'),
    ('a9ddef20-a9cd-4899-b248-525fa090d252'::uuid, 1004315, 'National Grid plc'),
    ('0eee5e37-b308-4995-a0a2-b272c0746fec'::uuid, 844150, 'NatWest'),
    ('684e1591-3a30-480f-b562-3828aaa3a006'::uuid, 1901279, 'Nayax'),
    ('df303dcb-e0b0-4571-b3fd-b19cad95bbe0'::uuid, 1110646, 'NetEase'),
    ('eb477c21-df9e-4742-aca8-c7b94bd5c282'::uuid, 814453, 'Newell Brands'),
    ('89b5dca1-03b1-4388-b836-2b0379623884'::uuid, 753308, 'NextEra Energy'),
    ('10b50cd0-eed9-44d1-9890-4be0e3e38ffd'::uuid, 1124796, 'NLight'),
    ('f3e9294d-ecda-42a0-bed8-18271a406a8d'::uuid, 2072389, 'Northland Power Inc.'),
    ('f5ebe02e-89b6-49ef-94bd-b6b2a1a3f6ed'::uuid, 1173420, 'NovaGold Resources'),
    ('4d816cf4-8a9f-4f0a-9be5-f4ad9eaa8fe9'::uuid, 1114448, 'Novartis AG'),
    ('61d3a428-3196-46d7-b565-a9445c298640'::uuid, 1859795, 'Novonix'),
    ('781671cf-2372-4ec9-8b98-03a3c88aee5f'::uuid, 1814215, 'Nuburu'),
    ('b424f501-704d-4140-acf2-9b550c65a6cd'::uuid, 73309, 'Nucor'),
    ('0db06c25-57be-4f15-ac7a-389bab9d2966'::uuid, 1479681, 'Nutex Health'),
    ('db94ccba-0a9e-43af-8e51-186d63ba7b66'::uuid, 1861560, 'Nuvalent'),
    ('b7ac4c3e-0db9-4e38-a276-1616cef99d16'::uuid, 2088339, 'OBIC Business Consultants'),
    ('4288868b-c8be-422d-ac64-40863392367a'::uuid, 1334388, 'Obsidian Energy'),
    ('84cc2250-94c1-4900-9dcb-aefae92f6bcb'::uuid, 73756, 'Oceaneering'),
    ('c1cdce71-55ef-4213-b8c3-3a1d63b7f88c'::uuid, 1882782, 'Odyssey Therapeutics'),
    ('40ff0f77-f7a6-4d01-baaf-8eccc8333098'::uuid, 878927, 'Old Dominion Freight Line'),
    ('caacad17-b33a-4404-8cba-ce4b3ea407d8'::uuid, 1750284, 'Olema Pharmaceuticals'),
    ('56c432db-7c9d-4737-8d7d-02913836b002'::uuid, 1637715, 'OnKure Therapeutics'),
    ('f9989656-521b-4cc5-8d08-5a0f6c563619'::uuid, 704532, 'Onto Innovation'),
    ('6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid, 775158, 'Oshkosh Corp'),
    ('b0403540-c2eb-4f58-a2bb-d1a1522af688'::uuid, 1636651, 'Ovid Therapeutics'),
    ('e4525662-ad9d-4fd7-a736-2a21c869455e'::uuid, 821483, 'Par Pacific Holdings'),
    ('91476708-694e-4c52-942b-f8eccd9bc1e2'::uuid, 2119292, 'Pasqal'),
    ('8372a5b6-06dd-45d8-867c-7c2cc3e53026'::uuid, 1383414, 'PennantPark Investment'),
    ('3e10ef20-760d-49db-b634-7e0005a3bd06'::uuid, 1455633, 'Pennon Group'),
    ('14c4f47d-94c7-4706-801a-fdec8642c06c'::uuid, 77360, 'Pentair'),
    ('04f89953-cb99-46af-833f-45561abf22db'::uuid, 891532, 'Perma Fix Environmental Services'),
    ('48c9d5e9-acfb-4da2-9df6-679efc2fd730'::uuid, 2026053, 'Pershing Square'),
    ('f3f6ad52-1da2-4e21-9065-c6f0d88e2dad'::uuid, 1069899, 'Phibro Animal Health'),
    ('132d1ea7-3b79-416c-929c-cf538e2c093a'::uuid, 810136, 'Photronics'),
    ('79454f6c-0eee-4a7d-a4a2-5266d4bd1d03'::uuid, 1437441, 'Piraeus Bank SA'),
    ('3760bdcc-8c7f-4615-bf53-cd47b6f81ef4'::uuid, 1784535, 'Porch Group'),
    ('30883a17-ef7c-4340-ac31-b440be1fe4e4'::uuid, 1894562, 'Prime Medicine'),
    ('dd5ac907-f852-4f49-8478-778d002a5be1'::uuid, 876167, 'Progress Software'),
    ('7976a80b-a459-4212-a3e3-6937847f667f'::uuid, 1551306, 'Progyny'),
    ('0b8b7794-969f-4238-ab30-0e64497f5079'::uuid, 1068851, 'Prosperity Bancshares'),
    ('8f4f6311-2732-4c34-9e7b-fc799d3d5f5b'::uuid, 1137774, 'Prudential Financial'),
    ('21a2b00d-98a0-45cd-bc54-f9ccf1043e49'::uuid, 1782999, 'PureTech Health'),
    ('b10e39d7-d0bc-464e-8395-bfca4096174a'::uuid, 78239, 'PVH'),
    ('c8eca83d-b0b5-4df1-94d7-895ddcd350bc'::uuid, 906465, 'QCR Holdings'),
    ('2c796439-da12-406d-8ecf-0aa5b8d47982'::uuid, 1015820, 'Qiagen'),
    ('d423c9f0-0207-43d0-ae52-3503dba94ca9'::uuid, 2058873, 'Qnity Electronics'),
    ('fd519c2a-6c5c-4cab-a18a-e3f235a3ca86'::uuid, 1503274, 'Quanterix'),
    ('f95dbf47-8fc8-4036-aac6-60cf536d06c9'::uuid, 1022079, 'Quest Diagnostics'),
    ('b679988a-d9dd-43cd-a643-9c908c94b70b'::uuid, 1117297, 'QuinStreet'),
    ('345d131f-f564-482f-975b-c1d794211185'::uuid, 1739410, 'Rallybio'),
    ('3c0aebcd-0e60-4318-ad68-153db20fc35b'::uuid, 1037038, 'Ralph Lauren Corporation'),
    ('2cc8f498-c5fa-4331-9cea-e725b0a36c07'::uuid, 315852, 'Range Resources'),
    ('aa5de138-64e8-411f-8a00-710dfc83e16e'::uuid, 935419, 'RCI Hospitality'),
    ('297e8905-5f6d-452e-935c-131fdc458143'::uuid, 700841, 'RCM Technologies'),
    ('e6e7dd83-a925-4e00-aec9-bec1efcd3e9b'::uuid, 82811, 'Regal Rexnord'),
    ('a61582b6-31c6-4d73-beea-64777536135a'::uuid, 1281761, 'Regions Financial'),
    ('e259fc86-df8e-40fd-88d6-0e727f618641'::uuid, 1812364, 'Relay Therapeutics, Inc.'),
    ('d46d4777-125a-4086-91c1-801931500b63'::uuid, 1618756, 'Restaurant Brands International'),
    ('d99e526f-da24-4a6c-bfd6-d2abe302a1d9'::uuid, 1628171, 'Revolution Medicines'),
    ('91fac195-6964-4678-a604-0fe928c8317f'::uuid, 1786431, 'Reynolds Consumer Products'),
    ('21c052bc-e0a5-440a-bf1b-2878fa703737'::uuid, 355948, 'Richardson Electronics'),
    ('578eb178-f386-4a42-84c6-ee5a5025de67'::uuid, 2141099, 'Rigaku'),
    ('3c928d59-e582-4092-a47f-77a802db17ef'::uuid, 1516536, 'Rightmove'),
    ('1309723d-2375-4157-9c60-00a3686eb3d0'::uuid, 1281895, 'Rocket Pharmaceuticals Inc'),
    ('3606bab5-31fd-49fa-9724-13327dedf325'::uuid, 1969729, 'Rockwool'),
    ('605896b7-a928-4e62-bd02-c6727a651c1a'::uuid, 1770114, 'Saab AB'),
    ('716042ea-dd3a-4a7f-bad3-27c2cd6b201d'::uuid, 1584273, 'Sanrio Co.'),
    ('11fa29e1-245c-4466-9358-734fd14b1a61'::uuid, 2072563, 'Saputo'),
    ('0d058698-c50f-4677-a235-2d0dc49b7e06'::uuid, 1874315, 'Satellogic'),
    ('7be1499a-1c1b-46e9-b5e4-d99d141ed968'::uuid, 1655190, 'Schindler Holding'),
    ('4bff9990-bfbc-4dc7-802e-0d94eb7b5fae'::uuid, 866729, 'Scholastic'),
    ('c8450765-3a17-4ddf-91ac-fab5b440ffe6'::uuid, 825542, 'Scotts Miracle Gro'),
    ('83d32041-2613-48bf-bb59-76059e182cbf'::uuid, 88121, 'Seaboard Corporation'),
    ('1db94c42-0cfe-44df-ac10-f21cbf05e8bf'::uuid, 1329213, 'Senior'),
    ('d9e0999c-c46c-4c38-8107-e751f0f3ee0c'::uuid, 1583708, 'SentinelOne'),
    ('30549cbb-f336-48ae-b076-1b9b175e07d4'::uuid, 2099326, 'SERES Group'),
    ('6b4394fa-73e5-4d03-95d5-8e6579f50eaa'::uuid, 1359519, 'Seven & i'),
    ('4947cb79-5a75-455a-9b9b-851eb95f3214'::uuid, 1662991, 'Sezzle'),
    ('2d1b70cb-63c2-4a4e-aaf4-d26f4a6e36a3'::uuid, 354963, 'Shenandoah Telecommunications'),
    ('241855bc-8a02-4925-a302-15bf56ef72ca'::uuid, 1830056, 'Siemens Energy AG'),
    ('e59aafc5-33c7-4471-8def-b002a3648ba0'::uuid, 2073972, 'Sienna Senior Living'),
    ('a7b00468-88cb-47f8-8462-e51c50a80ce1'::uuid, 1063761, 'Simon Property Group'),
    ('739114ed-f904-4ed2-b090-da090c80a122'::uuid, 2120882, 'SK Hynix'),
    ('a5e48aa4-2fea-4660-88a8-74151b9129de'::uuid, 827187, 'Sleep Number'),
    ('9f10477f-88cc-40d5-8c45-f6e5383f24ca'::uuid, 1032033, 'SLM'),
    ('d06bb656-6bc5-4337-8ba0-17a7746419f6'::uuid, 91440, 'Snap-On'),
    ('61f35ec9-5e80-415f-bcc2-5eb524280647'::uuid, 92122, 'Southern Company'),
    ('719162d5-fb07-4b65-a49e-74ecd517a294'::uuid, 1132105, 'Sportsman''s Warehouse'),
    ('f5000e8a-c09b-434d-a27c-cc9aadf362c2'::uuid, 718937, 'STAAR Surgical'),
    ('405a81b8-8c47-4b7a-9a76-24758d41c564'::uuid, 310354, 'Standex International'),
    ('fd1351a0-d811-48a5-9f3c-fd01b1dde8ab'::uuid, 93556, 'Stanley Black & Decker'),
    ('d6fc81e5-4385-4bb4-9a76-e4bde69615f6'::uuid, 1605484, 'Stellantis'),
    ('26332896-381c-453b-9531-309eb9e06a16'::uuid, 1757898, 'STERIS plc'),
    ('da85cb35-4c61-4bcc-9ec2-ca264fbacb66'::uuid, 2027330, 'SUGI Holdings'),
    ('6bf829c4-a700-49e9-be97-5d3998f97c3c'::uuid, 1097362, 'Sun Life Financial Inc.'),
    ('385df117-4ad2-4f59-a0f9-d75f6b7a1e06'::uuid, 2083785, 'Sunbelt Rentals Holdings'),
    ('ea202e9d-1efa-4fd3-ac0f-49a06e0c2d0e'::uuid, 1514705, 'SunCoke Energy'),
    ('8fa256fd-b9e0-4239-a157-e73039a5d837'::uuid, 1838987, 'SunPower Inc.'),
    ('9f7aa6be-e52a-4eaf-9fd0-d922104ceb0f'::uuid, 1356576, 'Supernus Pharmaceuticals'),
    ('c70f7f3d-00bf-464b-9698-5932cac284c2'::uuid, 1837240, 'Symbotic'),
    ('5197d4d6-3372-438b-9d13-df19f87acc57'::uuid, 96021, 'Sysco Corporation'),
    ('d736cdce-bc42-4db0-972e-ff2a6ad7005e'::uuid, 1116132, 'Tapestry'),
    ('f8c84465-b957-465b-bd58-80880a338238'::uuid, 1232384, 'TC Energy'),
    ('fe8dc90b-c0ef-4ec2-be1a-1d3705814308'::uuid, 2073804, 'TCL Electronics Holdings Ltd.'),
    ('167db014-da2a-410c-a62b-ef3368104f8e'::uuid, 2018064, 'TechTarget'),
    ('2c74abbe-e907-43a9-82be-6751ea0c9d60'::uuid, 932470, 'Telecom Argentina S.A.'),
    ('1578dfe7-8480-40ef-9339-13729b95a04c'::uuid, 96943, 'Teleflex'),
    ('ef109d38-7e8b-4612-a17b-e066e38592b7'::uuid, 1190723, 'Tenaris S.A.'),
    ('6ac8b247-41ad-46cc-96c2-441531cba199'::uuid, 70318, 'Tenet Healthcare'),
    ('b2929002-0c21-45f1-bc9d-5805832f0f30'::uuid, 97216, 'Terex'),
    ('ab5f7bd9-9e67-4125-a202-42995be17467'::uuid, 1342874, 'Ternium'),
    ('de956e7f-ad0e-4306-bc27-7493ceae213e'::uuid, 1390777, 'The Bank of New York Mellon Corporation'),
    ('4aadbf7c-dea5-45c6-a27e-e2aa58c818d3'::uuid, 21076, 'The Clorox Company'),
    ('f1637f00-e16b-4b3d-8848-2f0bc13e89ab'::uuid, 21344, 'The Coca-Cola Company'),
    ('de512bb5-1b76-4ed2-9b28-be753a137c85'::uuid, 2073913, 'The North West Company Inc.'),
    ('ccc765d7-7682-4375-8e8a-03b76e5bc864'::uuid, 1862461, 'The Real Brokerage'),
    ('e2fc418e-e6bd-42e0-a5d9-9e863fa98740'::uuid, 1583107, 'Theravance Biopharma'),
    ('db6cc338-dac6-47b3-b92c-c450237da720'::uuid, 1075124, 'Thomson Reuters'),
    ('7e07a5e3-2dfc-48cc-9be0-591a68fc562d'::uuid, 109198, 'TJX Companies'),
    ('4360821d-ee3d-4011-a0fc-c3a9bd43795f'::uuid, 1296484, 'TOP Ships'),
    ('9423568b-b714-4712-b00b-d3df657b3c86'::uuid, 2072098, 'Toromont Industries'),
    ('3d0f92ad-438b-4e93-bc4e-70435c683ae0'::uuid, 947263, 'Toronto-Dominion Bank'),
    ('caea5b7a-6514-4503-a4ba-20ce91b117f4'::uuid, 2071881, 'Tourmaline Oil'),
    ('1343ae1f-6dd7-4560-a550-eff5ff39e85e'::uuid, 2018139, 'Toyota Tsusho'),
    ('aca318ba-d3ca-4dd8-be52-f31e57025cfb'::uuid, 1133311, 'Travelzoo'),
    ('ac6365c2-9955-4504-bf49-a733efadfa83'::uuid, 1013880, 'TTEC'),
    ('489ba2a2-8ee9-48f9-8701-a1a2c0f93226'::uuid, 100493, 'Tyson Foods Inc.'),
    ('9246ed54-0562-43ca-9ce2-7050f70cc3e0'::uuid, 4457, 'U-Haul'),
    ('aa0ee2df-d4c9-489c-bc58-6c2bbe22f7f0'::uuid, 1901440, 'UL Solutions'),
    ('2cbacff6-1fbc-475d-8d1d-24c946ef998a'::uuid, 1590560, 'UniQure'),
    ('8269b20e-3b7c-4c70-9db8-ffc7f98eccc5'::uuid, 102037, 'Universal'),
    ('5cf12072-1453-4b74-b255-8194abcc811a'::uuid, 1890126, 'Universal Music Group'),
    ('c8da1917-c5d9-4456-a0fc-b32aaff685ed'::uuid, 1647639, 'Upstart'),
    ('710be30a-b3d9-4fd9-b41c-d1f8e1ef8bb5'::uuid, 912615, 'URBAN OUTFITTERS'),
    ('0d909849-3e6e-47bd-afee-a148720e1882'::uuid, 1681622, 'Varex Imaging'),
    ('54e98259-ba14-4663-88de-24802a36e1a6'::uuid, 103145, 'Veeco Instruments'),
    ('b12bcf3d-bfb9-4155-b6f4-95ea20992567'::uuid, 1827635, 'Veradermics'),
    ('506e6c0d-694a-42ae-a05a-fcf08bbbdf9b'::uuid, 1526119, 'Verastem'),
    ('888c2878-2d15-46e3-8cd6-7931a97f8832'::uuid, 1014473, 'VeriSign'),
    ('ad2aeea8-f10f-4762-97d4-f600825c0882'::uuid, 1792044, 'Viatris'),
    ('c3795820-d180-47b7-9642-4c1f118f392e'::uuid, 2131322, 'Victory Giant Technology Huizhou Co.'),
    ('56d52735-3393-4b3a-ba6d-81f575cec5ab'::uuid, 1692819, 'Vistra'),
    ('c2d2e34e-5b18-4b1b-b7f5-4a2b0d41f901'::uuid, 1396009, 'Vulcan Materials'),
    ('b44a9095-121c-46de-b24e-1b9225b5f394'::uuid, 1319161, 'Warner Music Group'),
    ('4e279f36-4b1b-4385-a24e-36af8c9e2a76'::uuid, 1691303, 'Warrior Met Coal'),
    ('840c83e1-ebc5-423e-8614-c42a526301cf'::uuid, 105016, 'Watsco'),
    ('a1ad9acb-927e-42a7-8566-0c31c44eefbd'::uuid, 1603923, 'Weatherford International'),
    ('d39d3d5e-3846-4432-9f4a-841794887f77'::uuid, 30697, 'Wendy’s'),
    ('27390e0d-135f-45b3-8486-93d176923a46'::uuid, 105770, 'West Pharmaceutical Services'),
    ('a0f3ef56-c6d6-460c-8f0e-5b9279fc1c73'::uuid, 106532, 'Weyco Group'),
    ('aaf76c33-66e1-4cf6-903d-d8f87ca06026'::uuid, 107263, 'Williams Companies'),
    ('b4b095d3-8aae-4c81-a842-d1ddff0e0c47'::uuid, 719955, 'Williams-Sonoma'),
    ('eb1bb873-cdfe-4441-9f1a-dbac0c47eacc'::uuid, 908315, 'Winmark'),
    ('7dc0d636-c086-48c6-8487-0bbd1ac09ecc'::uuid, 1015328, 'Wintrust Financial'),
    ('58c02a3c-f0b0-46cd-bbbd-72e420bab7db'::uuid, 1501697, 'X4 Pharmaceuticals'),
    ('88acefca-3a00-41e7-a20d-5e7cc8e1e8c3'::uuid, 2097163, 'Xanadu Quantum Technologies Limited'),
    ('5a7c04b3-9907-4577-920f-a28ba256b579'::uuid, 1582313, 'Xenon Pharmaceuticals'),
    ('df7b5cd4-1ec0-4f1a-8185-c78bdb91df4a'::uuid, 1810997, 'XPENG'),
    ('6a4add19-053c-462f-8dba-b78f4ba1d559'::uuid, 1670592, 'Yeti Holdings'),
    ('560fd862-93e2-4ada-a5ed-b7f6ef056f19'::uuid, 2068427, 'Zealand Pharma'),
    ('73363984-b55e-4db4-95f7-a8308e30878b'::uuid, 1136869, 'Zimmer Biomet Holdings, Inc.'),
    ('bc33a0d3-6683-45d3-8b15-2529dc156ad5'::uuid, 1937653, 'Zymeworks')
)
SELECT p.name AS proposed_name, p.cik, c.id AS existing_holder_id, c.name AS existing_holder_name
FROM proposed p JOIN companies c ON c.sec_cik = p.cik;

-- 0b. Any proposed row that has DRIFTED since the 2026-09-03T02:30Z read:
--     the row is gone, its name changed, or it already carries a sec_cik.
WITH proposed(id, cik, name) AS (VALUES
    ('2a58a470-bc99-486e-a7ea-63c8d219200d'::uuid, 1070494, 'Acadia Pharmaceuticals'),
    ('b4cef861-b368-47de-9d6d-ecd7f0ede8d9'::uuid, 949858, 'Achieve Life Sciences'),
    ('5438b02d-6846-43a2-b35c-6fcd8ab94502'::uuid, 880984, 'ACORN ENERGY'),
    ('8e6c164e-7a79-4a02-8ba6-b557a68bc9f1'::uuid, 1670541, 'Adient'),
    ('cf722bdd-d1ae-41db-b9ea-db48c3e0f179'::uuid, 1378789, 'AerCap'),
    ('65411a83-7119-4131-839d-2bdabe8f3765'::uuid, 2081206, 'AGI Inc'),
    ('0aa3eefa-43a0-449a-90bb-dee79f29bca0'::uuid, 1378580, 'Airbus'),
    ('c20b5937-8f63-4e38-8449-3e77fa7f15f2'::uuid, 903419, 'Alerus Financial'),
    ('e0bcfde4-adca-45dc-8da2-95b03ccf9a15'::uuid, 1362468, 'Allegiant Travel'),
    ('a6879886-641f-4613-b2a5-1090dab79fbc'::uuid, 899051, 'Allstate Corp'),
    ('eacc432f-08bf-42e4-8ed7-306d874791e7'::uuid, 40729, 'Ally Financial Inc.'),
    ('e9a408fe-a9e3-4433-bc52-37301421128f'::uuid, 1178670, 'Alnylam Pharmaceuticals'),
    ('9d904e24-05fb-4f5d-b377-d8bbf2d6be7f'::uuid, 1161611, 'Aluminum Corporation of China'),
    ('8c7179a8-46f2-4b4b-af3a-75170f4b3000'::uuid, 1411579, 'AMC Entertainment Holdings Inc.'),
    ('03c6c452-2fdb-4cd2-8499-a82e08424d14'::uuid, 1053507, 'American Tower'),
    ('ced30870-5ae6-45d9-bd7c-97d6d201dd08'::uuid, 820027, 'Ameriprise Financial'),
    ('11be8abb-4b04-460d-a269-6ceae9675e26'::uuid, 707605, 'AmeriServ Financial'),
    ('26e931c5-7070-4e9f-b794-37c87fcd1132'::uuid, 6176, 'Ampco Pittsburgh'),
    ('4f9096a5-0ac4-4d94-8d62-c93cd7c76230'::uuid, 1370053, 'AnaptysBio'),
    ('604bcbc4-7b4e-4bd4-9d3d-b6b82a1ae799'::uuid, 1973832, 'Anglogold Ashanti PLC'),
    ('7f679826-d4a2-4c1f-98f4-bccac200d7f8'::uuid, 1023024, 'ANI Pharmaceuticals'),
    ('5b364ffc-53ae-4bf0-9d62-ee036014f007'::uuid, 922864, 'Apartment Investment and Management Company'),
    ('67fe6bfe-dd92-4f9a-a682-6147dcbf76c5'::uuid, 1433195, 'AppFolio'),
    ('8bb2eb81-0107-4fc6-a262-6ef9e8cbf9e6'::uuid, 894405, 'ArcBest'),
    ('5857f776-6e7f-4ccc-b3db-fe1cf495a10f'::uuid, 947484, 'Arch Capital'),
    ('41877900-bc2a-4956-b00e-6682dfd13010'::uuid, 1768224, 'Arcturus Therapeutics'),
    ('c0d02715-0160-4f5b-aed2-9e99c948533d'::uuid, 1697862, 'Argenx'),
    ('9be6d7d7-cde5-4e35-82e0-ec8c01c9f59a'::uuid, 1820721, 'Array Technologies'),
    ('8305b8db-0109-4764-82e2-b1735f147d52'::uuid, 879407, 'Arrowhead Pharmaceuticals'),
    ('62a9d930-9870-4eab-a252-0af0598e3922'::uuid, 1145986, 'Aspen Aerogels'),
    ('1c13f3a3-0fb5-4d31-bf36-0e3345b26f1e'::uuid, 1487198, 'Aspen Group'),
    ('7afc3f04-45ac-4c72-9c20-5c012f142585'::uuid, 7789, 'Associated Banc Corp'),
    ('7eddba76-5180-45fa-b250-acdb1e9724e0'::uuid, 901832, 'AstraZeneca'),
    ('7b6a76f1-4d2a-452a-922f-caf34aced299'::uuid, 2081043, 'AtaiBeckley'),
    ('be3cf448-1d4f-4ff8-9c6b-9572be264e92'::uuid, 1420520, 'Atomera'),
    ('a0a53d11-3c7d-4460-a56f-c951d0a241ce'::uuid, 1683541, 'Aurora Cannabis'),
    ('b6568c8f-7204-4730-98d2-ca1865271c05'::uuid, 350698, 'AutoNation'),
    ('1a0f8c2a-c3ad-4021-8909-d0a6e9582b7d'::uuid, 1214816, 'AXIS Capital'),
    ('b99a0836-986d-4d3d-8084-1d18883a3824'::uuid, 1069183, 'Axon Enterprise'),
    ('3433936b-26f9-46e9-818f-c5f6559894d5'::uuid, 933974, 'Azenta'),
    ('85e6fd49-e02d-4396-9bbc-0cd987afb2f8'::uuid, 1278027, 'B&G Foods'),
    ('d4365507-3258-480b-9be0-cdbf8275d2e9'::uuid, 1429937, 'B2Gold Corp'),
    ('6edec227-596d-4c1b-b7f3-ec7e3d7051f1'::uuid, 1453015, 'Ballard Power Systems'),
    ('7bbb4ea0-4af7-47ef-a9e1-11ab5329a7ca'::uuid, 1747079, 'Bally''s'),
    ('a935203d-63a8-494e-9c18-17eb6d50ad56'::uuid, 2127862, 'Baltic Classifieds'),
    ('2a271e31-7c35-4dae-bce1-5d735b363f22'::uuid, 842180, 'Banco Bilbao Vizcaya Argentaria'),
    ('4ebbeefa-b82f-4f25-8308-54dcc6b6fc27'::uuid, 891478, 'Banco Santander S.A.'),
    ('e4d3e5f2-0e92-4972-89ef-38806d09994a'::uuid, 1504008, 'BankUnited'),
    ('45f3f08f-5196-4ed9-9316-70a1c9c0966d'::uuid, 1978954, 'BBB Foods'),
    ('408c99f3-9688-44fb-96f5-8588eef53c65'::uuid, 915840, 'Beazer Homes USA'),
    ('0f715b45-0554-490b-b6a6-fa852e096171'::uuid, 842023, 'Bio-Techne'),
    ('d018f0b8-b794-4f24-b7f0-7914a5d90f21'::uuid, 834365, 'BioLife Solutions, Inc.'),
    ('57196813-55d6-4867-a565-d7feb0482d85'::uuid, 1498403, 'BioLineRx'),
    ('8b2e0952-33d3-43c2-887b-3ba7d01f0cc6'::uuid, 1776985, 'BioNTech'),
    ('1e061841-8579-425d-94be-c477bf31186f'::uuid, 1720893, 'BioXcel Therapeutics'),
    ('4386731c-9908-4a00-a553-c3e7a16f6098'::uuid, 1838406, 'BKV'),
    ('7604e8be-0afd-4ecf-a771-e9f2d616f62f'::uuid, 1130464, 'Black Hills Corporation'),
    ('c3d8e115-4157-4163-b6dd-ff3e56a4e85e'::uuid, 1070235, 'Blackberry'),
    ('69807bb4-f226-4aed-ad28-b59ca4a81a01'::uuid, 1546417, 'Bloomin'' Brands'),
    ('6d94b7cc-f799-4e34-9b01-44c009d03742'::uuid, 1589526, 'Blue Bird'),
    ('6d173063-6932-4498-a0b8-9e8a54db4f34'::uuid, 908255, 'BorgWarner'),
    ('13db8ca4-862b-410f-9f2a-89659d8d10ff'::uuid, 949870, 'Boston Beer'),
    ('bc4a41fc-c072-4129-bb80-a2e1d040ecc0'::uuid, 1906364, 'BOXABL'),
    ('d6b99d4f-acec-4407-b63e-1989445ddf1d'::uuid, 1505065, 'Brainsway'),
    ('0d8b61d1-cd84-4fb0-a4e6-2f407af62aeb'::uuid, 1071438, 'Braskem S.A.'),
    ('87704492-ceea-41b8-bd08-a17e6b00a4c5'::uuid, 14272, 'Bristol Myers Squibb'),
    ('61a1d805-f9fc-44e3-bd01-c71bf2545732'::uuid, 1303523, 'British American Tobacco p.l.c.'),
    ('db126811-2463-41ca-ac3d-8805c1387cd8'::uuid, 1383312, 'Broadridge Financial Solutions'),
    ('e620a5b4-c091-4e23-850a-792e6910af2f'::uuid, 1545772, 'Brookfield Property Partners'),
    ('7055f3c9-93b8-45b2-b0ce-0aa15650178b'::uuid, 1109354, 'Bruker'),
    ('82a76ce5-df3d-4664-b652-9bf750fec8a8'::uuid, 1714174, 'Burford Capital'),
    ('0dae6c3d-4610-4821-9fcc-cf058e5a270e'::uuid, 1447956, 'BYD Electronic (International)'),
    ('749c8929-b72e-45c6-9cfa-238b7b521b90'::uuid, 1043277, 'C.H. Robinson Worldwide'),
    ('466f0460-a200-4da1-960f-838b30bea464'::uuid, 1632127, 'Cable One'),
    ('1351ce5e-91b1-41c8-b76e-be8686bdd107'::uuid, 813672, 'Cadence Design Systems'),
    ('485dfec5-87ee-4da4-9dfb-3a44433bc66e'::uuid, 1035201, 'California Water Service Group'),
    ('a04e9040-2814-4717-bc7e-d6d13437f9d1'::uuid, 2034268, 'Cantor Equity Partners III, Inc.'),
    ('21a8ab80-ff0b-4cdd-9c4d-d64fd88f1f27'::uuid, 927628, 'Capital One Financial Corporation'),
    ('16949daa-fdd5-447f-a4dc-e2d5ec705d06'::uuid, 1530721, 'Capri Holdings'),
    ('0a1e8fd1-d63f-4f39-984a-874ec53c4a67'::uuid, 2019410, 'Caris Life Sciences'),
    ('c843342d-ed2f-4d72-98ef-9a1b7e35d0e7'::uuid, 1447362, 'Castle Biosciences'),
    ('dc7027d5-5b4d-4e27-80d4-8fe3c6bbb5b1'::uuid, 1138118, 'CBRE Group'),
    ('47e507c3-45f2-47ca-a54d-bd4640fbafef'::uuid, 949157, 'Century Aluminum'),
    ('a0e35816-7939-4d7e-98f6-67240695af86'::uuid, 1324404, 'CF Industries'),
    ('e3ec17dc-b62f-43ca-9570-2b9afe9ae108'::uuid, 313927, 'Church & Dwight Co., Inc.'),
    ('8259c117-812c-401d-9bf4-3f890736b52a'::uuid, 759944, 'Citizens Financial Group Inc.'),
    ('cfe37bed-12ea-461f-abb8-9c76a485fa34'::uuid, 1441236, 'Clearwater Paper'),
    ('4dc5f266-d9ed-4c73-b17e-f5cb7e14fbb6'::uuid, 1780785, 'CN Energy'),
    ('b6972604-6cc8-4fb2-85c9-c8626686eb65'::uuid, 1070412, 'CNX Resources'),
    ('90335c06-e540-4386-a6e1-e221fc702af4'::uuid, 1284812, 'Cohen & Steers'),
    ('f91be27f-1533-4712-a3c9-4ecf2919f670'::uuid, 887343, 'Columbia Banking System'),
    ('606f91a7-ff8e-42f7-8177-0127820e2742'::uuid, 1050797, 'Columbia Sportswear Company'),
    ('e65ef23e-3fc9-4c22-aae4-09b33b8a037d'::uuid, 1012037, 'Compagnie de Saint Gobain'),
    ('6edc94ff-93bf-4d41-81aa-84b1eac1445b'::uuid, 1563190, 'Compass'),
    ('48f47aa5-df9a-4dc3-abb4-7bb318050545'::uuid, 1119774, 'Compugen'),
    ('c43c607f-7100-44ff-a4e4-587b68abedab'::uuid, 816956, 'CONMED'),
    ('5188f910-7190-4dc2-a477-1d6f5a49d12c'::uuid, 2070829, 'Contemporary Amperex Technology Co. Ltd.'),
    ('30c2fc6a-b24e-4f17-b183-adbdefa20ebd'::uuid, 2064307, 'ContextLogic'),
    ('25264ff1-f9cd-4a1b-ae1c-256f220839df'::uuid, 1088856, 'Corcept Therapeutics'),
    ('28118241-4373-4e29-90bb-bce83ca02c27'::uuid, 1026655, 'Core Molding Technologies'),
    ('d1efc560-47fc-4975-a647-e7335b985808'::uuid, 1070985, 'CoreCivic'),
    ('51dbf790-fbff-4983-a5a8-2a782908a96f'::uuid, 1743759, 'Corsair Gaming'),
    ('04fbd49d-c88b-4f5f-bf5c-c85bc61d49da'::uuid, 1755672, 'Corteva'),
    ('dd023a0e-6519-4be0-8e38-2dea1719beb2'::uuid, 1832928, 'Cresco Labs'),
    ('bb10d95d-b556-4f4e-8497-cf9055680698'::uuid, 1576427, 'Criteo'),
    ('f667818a-cf94-436b-9186-401d10e760f8'::uuid, 1334036, 'Crocs'),
    ('7be9b55d-672f-4f04-b9dd-20bbf658443d'::uuid, 1298675, 'CubeSmart'),
    ('ed9be63c-145b-4053-b17b-ca190ed3bc6a'::uuid, 26172, 'Cummins'),
    ('71a7fe83-49bf-4d0b-8ed8-45a70df462db'::uuid, 64803, 'CVS Health Corp'),
    ('841c9245-87ba-4e3b-aa97-6647dc20e809'::uuid, 1437712, 'DCC'),
    ('45eb2fc8-7d89-4cfa-a9eb-d07096e0c094'::uuid, 1694426, 'Delek US'),
    ('21bcc70f-d820-4078-96d3-61d6de6fa278'::uuid, 1050140, 'Descartes Systems Group'),
    ('1b03011e-cbdf-4a96-9ba0-c9e014242a7c'::uuid, 813298, 'Destination XL Group'),
    ('e043e420-71e9-4fc6-b7e7-5895871b2461'::uuid, 1049724, 'Deutsche Lufthansa'),
    ('dd43b9e8-4b7c-4ae4-a614-381498d2bb3a'::uuid, 909108, 'Diamond Hill Investment Group'),
    ('c545478f-97f0-4caa-8b8e-fe54f485e7c6'::uuid, 317788, 'Digital Turbine'),
    ('caddae6f-a848-4ba9-afe4-05f92a6cd160'::uuid, 1857475, 'DOLE plc'),
    ('caa17d5f-c70c-419a-9911-57fddef60ef0'::uuid, 29905, 'Dover Corporation'),
    ('4eb72ca4-b744-42b2-893c-dfc870875e89'::uuid, 2094201, 'DPC Dash'),
    ('4621237c-d855-43ab-aec7-ee20857201dd'::uuid, 1804745, 'Driven Brands Holdings Inc.'),
    ('9a0d2558-4eca-491e-bf21-51e2fe8b1c68'::uuid, 1136808, 'E.ON'),
    ('858682c6-deef-4af1-b24a-4c31b173b4f1'::uuid, 31235, 'Eastman Kodak'),
    ('c7a6c9b2-7ef5-4180-b3e9-6c7ebcdeb295'::uuid, 1590714, 'Element Solutions'),
    ('caac6b49-210c-4cb5-9061-845deb2dbe07'::uuid, 1969796, 'Embracer Group'),
    ('8eda13dc-89ae-4f52-a0b3-ee21064422c9'::uuid, 1127248, 'Emera Incorporated'),
    ('d8ee941c-e236-4133-a5fe-ff0e76f3cdbc'::uuid, 32604, 'Emerson Electric Company'),
    ('40e49de8-2a57-4c76-bff1-ef16e3588f94'::uuid, 1084961, 'Encore Capital Group'),
    ('60fa4a41-06c7-4752-a245-92be85c767d5'::uuid, 1140625, 'Equinor ASA'),
    ('4cd9bc95-6364-45af-9b84-24a54c443974'::uuid, 1333986, 'Equitable Holdings Inc.'),
    ('015e1dd9-ae0a-4b85-94f6-a660aaacd9c9'::uuid, 1434868, 'Esperion Therapeutics'),
    ('f5315772-f5a1-470e-b24f-785fa7eb16bb'::uuid, 1412558, 'Evotec'),
    ('a18f0c30-365d-46f5-824a-0c8cb0b29fbd'::uuid, 939767, 'Exelixis'),
    ('ca369570-dc51-4e1d-b667-d6d8bfa395dc'::uuid, 1109357, 'Exelon'),
    ('ab4bcf16-d848-43a8-9020-5d012a812f89'::uuid, 2115436, 'ExxonMobil'),
    ('fe990a20-893f-4dcf-a8c7-1a6a21be947d'::uuid, 814547, 'Fair Isaac Corporation'),
    ('199fcbf8-8e70-4f22-b6bf-fa3f77a49700'::uuid, 915191, 'Fairfax Financial'),
    ('d987372c-3f3b-4a12-a2d6-cd8f4670dbba'::uuid, 277509, 'Federal Signal'),
    ('4eb3bd64-92e8-4472-8c22-88d25ca50ab5'::uuid, 1648416, 'Ferrari'),
    ('c1061f2e-f29a-4e8f-aba9-4b5e67eda0ec'::uuid, 1468522, 'Ferrovial'),
    ('196af0c4-0323-455c-8f57-679fd6d94afa'::uuid, 1098151, 'Fidelity D & D Bancorp'),
    ('177f5877-34f7-4382-acdf-58b16c887c2a'::uuid, 1331875, 'Fidelity National Financial Inc.'),
    ('b8f22e06-b870-4ab5-b3b6-22ded57daf9b'::uuid, 2073638, 'Finning International'),
    ('209f2f09-cb25-4e1d-8590-5056fd301b5d'::uuid, 1746109, 'First Bank & Trust'),
    ('aefb7b8b-8bba-4d85-bd4a-48cc095f38fb'::uuid, 860413, 'First Interstate Bancsystem'),
    ('718ec183-7678-4518-8d01-3cbd92c15b31'::uuid, 1666175, 'Fortis'),
    ('0f3b28b6-c3a5-4d29-954e-1f04d0606231'::uuid, 1828377, 'Fortitude Gold'),
    ('441b3816-6813-472c-bbac-8238aefd8d2c'::uuid, 1559444, 'Forvia'),
    ('dc5198b0-c198-44a2-95e9-8e9e1a704d4c'::uuid, 1456346, 'Franco Nevada'),
    ('e3e97199-9214-4f8f-8288-195d66ee36a4'::uuid, 1320854, 'FreightCar America'),
    ('86418122-85a6-4f9a-a6d1-6e7dab5684fd'::uuid, 887936, 'FTI Consulting'),
    ('6f9742e0-2758-4c30-8eb9-4c69bbc8d9c8'::uuid, 700564, 'Fulton Financial'),
    ('ed12e388-1d66-4745-b66e-f99e8786a824'::uuid, 1704711, 'Funko'),
    ('67cda1e8-ae72-400f-86c9-5ebc0a776912'::uuid, 1996810, 'GE Vernova'),
    ('85d2b0c6-7c32-48ae-8ff4-e0ac6da4be88'::uuid, 1474968, 'Geely Automobile Holdings Ltd.'),
    ('b9bb6061-2ddb-469b-a157-0a1720198442'::uuid, 849399, 'Gen Digital'),
    ('e3bf8db7-24fa-41b4-80c1-4da9dc0406c2'::uuid, 2074850, 'General Fusion'),
    ('a3f9789c-ca15-4d19-9953-cbed40cc55b6'::uuid, 2100782, 'Generate Biomedicines'),
    ('f240ef76-f7c6-46a0-96ef-edb5b51f4cbc'::uuid, 1022321, 'Genesis Energy'),
    ('40a542eb-c2a4-4152-8d45-eaedb15b73f7'::uuid, 1434265, 'Genmab'),
    ('59614a6e-dc78-4b4a-9ae4-c7d171b4d61e'::uuid, 355811, 'Gentex Corporation'),
    ('5602b4fc-92d3-48f2-900d-f9e84f36f7e0'::uuid, 903129, 'Gentherm'),
    ('2282debc-6c62-46b6-ad65-afea4e1696ef'::uuid, 1898496, 'Getty Images'),
    ('57855961-8b70-4379-a953-45a9e63a195d'::uuid, 2071913, 'Gibson Energy'),
    ('6b648f58-a4ab-4e2c-8174-1c801ff683c7'::uuid, 1857816, 'GigaCloud Technology'),
    ('5a0715d4-e258-4c18-8f0c-48577bcf67a0'::uuid, 897322, 'Gilat Satellite Networks Ltd.'),
    ('95d22579-53d8-476f-83c4-5db780830a0d'::uuid, 882095, 'Gilead Sciences'),
    ('d78c0ee4-31d9-4a09-80f7-d1d05012e9af'::uuid, 1830214, 'Ginkgo Bioworks'),
    ('e63a769b-fba8-4afc-9cca-833e7f15a16e'::uuid, 1653482, 'GitLab'),
    ('0111093a-fca9-462b-82a4-e3b3ffd68782'::uuid, 1609711, 'GoDaddy Inc.'),
    ('c96ccd9f-7230-4558-9bb6-c7d46b9d801d'::uuid, 1273441, 'Gran Tierra Energy'),
    ('b6764f15-f0a4-4738-9c17-3d5b16a4186f'::uuid, 1434588, 'Grand Canyon Education'),
    ('ac87b972-93e9-4419-b485-4d66034ff77f'::uuid, 1771515, 'Grocery Outlet Holding Corp.'),
    ('96bfc6d4-5679-44da-9539-3010d42b679e'::uuid, 912892, 'Grupo Televisa'),
    ('d8487ec2-464b-4796-89f2-8cc345949e66'::uuid, 1802255, 'Guardian Pharmacy Services'),
    ('aa9a72ba-b514-4df1-8d91-4a5b7e8aca0c'::uuid, 1483994, 'H World Group'),
    ('f0c712ec-1f90-4197-ace8-bc028a12222e'::uuid, 2073669, 'Hansoh Pharmaceutical'),
    ('91d049f5-e7bd-4942-8bbd-65f886c140a0'::uuid, 1802665, 'Harmony Biosciences'),
    ('a55bc6e4-53a9-4a06-a425-b2a03e51a43a'::uuid, 860730, 'HCA Healthcare'),
    ('9cb581e8-7d57-4946-8e4b-67114c3d96f7'::uuid, 1144967, 'HDFC Bank'),
    ('313699f7-165c-4a2e-ade1-bc1a2c0969d1'::uuid, 719413, 'Hecla Mining'),
    ('8e0b0ff9-6c33-45ad-b714-017cf3782efd'::uuid, 46619, 'HEICO'),
    ('8a873e47-d22a-4b9e-ae2f-f66290997969'::uuid, 1364479, 'Herc Holdings'),
    ('bf3bba1a-a5b0-4d72-98fc-488a5bd315e4'::uuid, 1446962, 'Hochschild Mining'),
    ('7361687b-ee93-4cef-b71d-7bf76fc634ca'::uuid, 49196, 'Huntington Bancshares'),
    ('ecbb4091-1b58-4c03-ab01-d6864ab9198f'::uuid, 1718405, 'Hycroft Mining'),
    ('6cb4bf0c-0588-4fd9-939e-457f8cd83d91'::uuid, 2078856, 'Hyperliquid Strategies'),
    ('62d86dbf-975e-4b64-a427-7c1a852ea145'::uuid, 1538379, 'Ibotta'),
    ('0e7873d4-a0ab-47e9-814a-79657e8144e8'::uuid, 1103838, 'ICICI Bank'),
    ('31596b3f-e083-482b-bd37-06448722449d'::uuid, 2062803, 'IDP Education'),
    ('2d3070b2-2a26-4e52-ba3c-8e928a5856cc'::uuid, 1790340, 'Immuneering'),
    ('d2e7b7a3-6f08-4bf5-904b-dff22a8dca83'::uuid, 1067491, 'Infosys'),
    ('b5b4dca8-d39e-455d-b75d-9ba7b796641f'::uuid, 1774163, 'Innovent Biologics'),
    ('9040e46a-8d0a-4479-aa4f-4011a1aec014'::uuid, 1114483, 'Integer Holdings'),
    ('4f115e27-d51c-4760-a22d-18ebd9938102'::uuid, 917520, 'Integra LifeSciences'),
    ('ab6b87f7-b5c0-4dc3-8c6c-72a6ff14d07f'::uuid, 1652130, 'Intellia Therapeutics'),
    ('45b9d2d7-5867-4af1-9788-d0ea2bf21313'::uuid, 1405495, 'InterDigital, Inc.'),
    ('dc99d8ab-018e-4142-bb8e-246dfc467cdd'::uuid, 1425205, 'Iovance Biotherapeutics'),
    ('e70746fe-9049-4ed3-90c8-f857e3d94304'::uuid, 1020569, 'Iron Mountain Incorporated'),
    ('24377324-181e-4bc2-b9fa-2fb213150ced'::uuid, 1009829, 'JAKKS Pacific'),
    ('1d9382ae-04b4-4763-a005-7a55e1dd749b'::uuid, 1600520, 'Japan exchange'),
    ('99770153-b800-4d12-8b16-160403329878'::uuid, 1549802, 'JD.Com'),
    ('bb7d9505-f72f-4f82-b399-6477f0742301'::uuid, 1674335, 'JELD-WEN'),
    ('d7972265-365c-4cbd-98a7-159f3613a8fb'::uuid, 2127043, 'Jersey Mike’s Subs'),
    ('83e9977d-70b4-4dcc-ab02-1476801c5cb7'::uuid, 1357615, 'KBR'),
    ('1f2f4e3c-ceee-43fb-b015-59285eee3f46'::uuid, 91576, 'KEYCORP'),
    ('b32d07b3-729d-4832-a2b3-198320acfaa7'::uuid, 1601046, 'Keysight Technologies'),
    ('04af6598-f431-449b-ba17-e86d7300cf4c'::uuid, 55785, 'Kimberly-Clark'),
    ('757edfb0-de82-42e2-9682-92550f0c48e4'::uuid, 2053383, 'Kioxia'),
    ('c972472d-144e-4b1d-9e52-6c5928d16c44'::uuid, 2033019, 'Kokusai Electric'),
    ('6c0beff6-5373-4682-a5b2-9cb52571ac30'::uuid, 1857154, 'Krispy Kreme'),
    ('af6d9f1b-679a-4b7f-8d8c-2157491c5a8d'::uuid, 56873, 'Kroger'),
    ('3b5555ee-758f-41fa-b011-fb7a0cb5c0a7'::uuid, 1679273, 'Lamb Weston'),
    ('f1f3315f-d8c4-436a-9014-47c02d21bf3e'::uuid, 1521036, 'Lantheus Holdings'),
    ('d31c7904-3540-4061-9100-9e8aca84cd53'::uuid, 2068440, 'Laopu Gold'),
    ('5dd572ad-1e41-43cc-90f2-1e359fc94ff2'::uuid, 1069202, 'Lennox International'),
    ('eb2bbe14-b155-4ea2-a64a-0a74405385d2'::uuid, 1580670, 'LGI Homes'),
    ('8101c4e1-9458-49be-b04d-5bd013b5b320'::uuid, 849146, 'LifeVantage'),
    ('e83c3235-20e4-4c46-bd92-caf5beacd801'::uuid, 886163, 'Ligand Pharmaceuticals'),
    ('c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid, 59558, 'Lincoln National Corporation'),
    ('74ab5dad-8ca9-47fe-b450-1ad4d9406bd7'::uuid, 2140948, 'Lion Finance Group'),
    ('71519329-a4cb-4d19-93af-cb0dc70b7cea'::uuid, 1023128, 'Lithia Motors'),
    ('4e68c911-71cd-41cf-97bd-8076c0c94ba1'::uuid, 1462120, 'Live Oak Bancshares'),
    ('3778ec3b-adf7-4547-b0a8-9898ee18692d'::uuid, 733269, 'LiveRamp'),
    ('378c0d7d-d496-4360-9d95-fd8377663298'::uuid, 1160106, 'Lloyds Banking Group'),
    ('3496b52d-df1c-4e22-a8c0-e8ba63830664'::uuid, 1831631, 'Loandepot'),
    ('5a9d7aeb-c466-49c3-9382-a67a340f169d'::uuid, 60086, 'Loews'),
    ('398fe069-92de-4f0a-92e8-474fff3093ec'::uuid, 1767582, 'Luckin Coffee'),
    ('03476ec7-4dcb-442c-8822-fe7e60f28879'::uuid, 1489393, 'LyondellBasell Industries'),
    ('5c8bc39d-cc2d-43fc-92a0-df9ec847fb1d'::uuid, 749098, 'Magna'),
    ('680b460c-a1ef-4c8d-be26-25b8222ee205'::uuid, 1495153, 'MakeMyTrip'),
    ('4f50c656-d8af-419d-8f5b-3e81039c924c'::uuid, 1086888, 'Manulife Financial'),
    ('7850e41f-9fa0-411b-b314-65b4b602f411'::uuid, 2131961, 'Manycore Tech Inc.'),
    ('b35f13f1-ab26-47a1-bf52-af977eb2974d'::uuid, 1048286, 'Marriott International'),
    ('953df921-711a-4ef3-845d-4dc7b210ac66'::uuid, 799167, 'Marten Transport'),
    ('84332844-fda6-410e-9a6b-fa52790cdf0a'::uuid, 1668397, 'Medpace'),
    ('039714ac-bd75-46f5-8521-73fa1fdd8049'::uuid, 1042729, 'Mercantile Bank'),
    ('e30e2af2-49a1-4f55-9ed2-a0d23623d097'::uuid, 833079, 'Meritage Homes'),
    ('9ccef504-78fb-45e1-9e89-c56b41ef2121'::uuid, 2090231, 'METLEN Energy & Metals PLC'),
    ('637aa6b8-6da5-4f58-b90d-d7efeb908c36'::uuid, 1760689, 'Microvast'),
    ('010372bd-8c4d-4cc4-a87b-4f6593a9d26b'::uuid, 2039784, 'Midea Group'),
    ('7c924ae7-3041-4f16-bc78-ca06a858c1e3'::uuid, 924822, 'Miller Industries'),
    ('85a1766d-1cb6-4f75-87a1-e6875f1c195e'::uuid, 1436126, 'Mistras Group'),
    ('a7a46c35-dbc2-489d-ab1e-e3e3a80c0040'::uuid, 67347, 'Modine Manufacturing'),
    ('fc0bd7c2-a123-4c8e-b6c0-8747f48a0641'::uuid, 865752, 'Monster Beverage'),
    ('65c9ddaf-6a1c-44cb-874a-aefe909c568f'::uuid, 2123346, 'Montage Technology Co.'),
    ('76ba3fec-13ae-4210-82e1-5d723d5e93da'::uuid, 1350593, 'Mueller Water Products'),
    ('6eda5d47-02ea-41c9-87d0-86e22265a8af'::uuid, 899923, 'Myriad Genetics'),
    ('2bd4e6b1-745b-46de-accd-e34ab50ed359'::uuid, 1795251, 'Nano X Imaging'),
    ('8b2aa808-1675-4ac0-a7e8-2812321d068a'::uuid, 69633, 'NAPCO SECURITY TECHNOLOGIES'),
    ('a9ddef20-a9cd-4899-b248-525fa090d252'::uuid, 1004315, 'National Grid plc'),
    ('0eee5e37-b308-4995-a0a2-b272c0746fec'::uuid, 844150, 'NatWest'),
    ('684e1591-3a30-480f-b562-3828aaa3a006'::uuid, 1901279, 'Nayax'),
    ('df303dcb-e0b0-4571-b3fd-b19cad95bbe0'::uuid, 1110646, 'NetEase'),
    ('eb477c21-df9e-4742-aca8-c7b94bd5c282'::uuid, 814453, 'Newell Brands'),
    ('89b5dca1-03b1-4388-b836-2b0379623884'::uuid, 753308, 'NextEra Energy'),
    ('10b50cd0-eed9-44d1-9890-4be0e3e38ffd'::uuid, 1124796, 'NLight'),
    ('f3e9294d-ecda-42a0-bed8-18271a406a8d'::uuid, 2072389, 'Northland Power Inc.'),
    ('f5ebe02e-89b6-49ef-94bd-b6b2a1a3f6ed'::uuid, 1173420, 'NovaGold Resources'),
    ('4d816cf4-8a9f-4f0a-9be5-f4ad9eaa8fe9'::uuid, 1114448, 'Novartis AG'),
    ('61d3a428-3196-46d7-b565-a9445c298640'::uuid, 1859795, 'Novonix'),
    ('781671cf-2372-4ec9-8b98-03a3c88aee5f'::uuid, 1814215, 'Nuburu'),
    ('b424f501-704d-4140-acf2-9b550c65a6cd'::uuid, 73309, 'Nucor'),
    ('0db06c25-57be-4f15-ac7a-389bab9d2966'::uuid, 1479681, 'Nutex Health'),
    ('db94ccba-0a9e-43af-8e51-186d63ba7b66'::uuid, 1861560, 'Nuvalent'),
    ('b7ac4c3e-0db9-4e38-a276-1616cef99d16'::uuid, 2088339, 'OBIC Business Consultants'),
    ('4288868b-c8be-422d-ac64-40863392367a'::uuid, 1334388, 'Obsidian Energy'),
    ('84cc2250-94c1-4900-9dcb-aefae92f6bcb'::uuid, 73756, 'Oceaneering'),
    ('c1cdce71-55ef-4213-b8c3-3a1d63b7f88c'::uuid, 1882782, 'Odyssey Therapeutics'),
    ('40ff0f77-f7a6-4d01-baaf-8eccc8333098'::uuid, 878927, 'Old Dominion Freight Line'),
    ('caacad17-b33a-4404-8cba-ce4b3ea407d8'::uuid, 1750284, 'Olema Pharmaceuticals'),
    ('56c432db-7c9d-4737-8d7d-02913836b002'::uuid, 1637715, 'OnKure Therapeutics'),
    ('f9989656-521b-4cc5-8d08-5a0f6c563619'::uuid, 704532, 'Onto Innovation'),
    ('6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid, 775158, 'Oshkosh Corp'),
    ('b0403540-c2eb-4f58-a2bb-d1a1522af688'::uuid, 1636651, 'Ovid Therapeutics'),
    ('e4525662-ad9d-4fd7-a736-2a21c869455e'::uuid, 821483, 'Par Pacific Holdings'),
    ('91476708-694e-4c52-942b-f8eccd9bc1e2'::uuid, 2119292, 'Pasqal'),
    ('8372a5b6-06dd-45d8-867c-7c2cc3e53026'::uuid, 1383414, 'PennantPark Investment'),
    ('3e10ef20-760d-49db-b634-7e0005a3bd06'::uuid, 1455633, 'Pennon Group'),
    ('14c4f47d-94c7-4706-801a-fdec8642c06c'::uuid, 77360, 'Pentair'),
    ('04f89953-cb99-46af-833f-45561abf22db'::uuid, 891532, 'Perma Fix Environmental Services'),
    ('48c9d5e9-acfb-4da2-9df6-679efc2fd730'::uuid, 2026053, 'Pershing Square'),
    ('f3f6ad52-1da2-4e21-9065-c6f0d88e2dad'::uuid, 1069899, 'Phibro Animal Health'),
    ('132d1ea7-3b79-416c-929c-cf538e2c093a'::uuid, 810136, 'Photronics'),
    ('79454f6c-0eee-4a7d-a4a2-5266d4bd1d03'::uuid, 1437441, 'Piraeus Bank SA'),
    ('3760bdcc-8c7f-4615-bf53-cd47b6f81ef4'::uuid, 1784535, 'Porch Group'),
    ('30883a17-ef7c-4340-ac31-b440be1fe4e4'::uuid, 1894562, 'Prime Medicine'),
    ('dd5ac907-f852-4f49-8478-778d002a5be1'::uuid, 876167, 'Progress Software'),
    ('7976a80b-a459-4212-a3e3-6937847f667f'::uuid, 1551306, 'Progyny'),
    ('0b8b7794-969f-4238-ab30-0e64497f5079'::uuid, 1068851, 'Prosperity Bancshares'),
    ('8f4f6311-2732-4c34-9e7b-fc799d3d5f5b'::uuid, 1137774, 'Prudential Financial'),
    ('21a2b00d-98a0-45cd-bc54-f9ccf1043e49'::uuid, 1782999, 'PureTech Health'),
    ('b10e39d7-d0bc-464e-8395-bfca4096174a'::uuid, 78239, 'PVH'),
    ('c8eca83d-b0b5-4df1-94d7-895ddcd350bc'::uuid, 906465, 'QCR Holdings'),
    ('2c796439-da12-406d-8ecf-0aa5b8d47982'::uuid, 1015820, 'Qiagen'),
    ('d423c9f0-0207-43d0-ae52-3503dba94ca9'::uuid, 2058873, 'Qnity Electronics'),
    ('fd519c2a-6c5c-4cab-a18a-e3f235a3ca86'::uuid, 1503274, 'Quanterix'),
    ('f95dbf47-8fc8-4036-aac6-60cf536d06c9'::uuid, 1022079, 'Quest Diagnostics'),
    ('b679988a-d9dd-43cd-a643-9c908c94b70b'::uuid, 1117297, 'QuinStreet'),
    ('345d131f-f564-482f-975b-c1d794211185'::uuid, 1739410, 'Rallybio'),
    ('3c0aebcd-0e60-4318-ad68-153db20fc35b'::uuid, 1037038, 'Ralph Lauren Corporation'),
    ('2cc8f498-c5fa-4331-9cea-e725b0a36c07'::uuid, 315852, 'Range Resources'),
    ('aa5de138-64e8-411f-8a00-710dfc83e16e'::uuid, 935419, 'RCI Hospitality'),
    ('297e8905-5f6d-452e-935c-131fdc458143'::uuid, 700841, 'RCM Technologies'),
    ('e6e7dd83-a925-4e00-aec9-bec1efcd3e9b'::uuid, 82811, 'Regal Rexnord'),
    ('a61582b6-31c6-4d73-beea-64777536135a'::uuid, 1281761, 'Regions Financial'),
    ('e259fc86-df8e-40fd-88d6-0e727f618641'::uuid, 1812364, 'Relay Therapeutics, Inc.'),
    ('d46d4777-125a-4086-91c1-801931500b63'::uuid, 1618756, 'Restaurant Brands International'),
    ('d99e526f-da24-4a6c-bfd6-d2abe302a1d9'::uuid, 1628171, 'Revolution Medicines'),
    ('91fac195-6964-4678-a604-0fe928c8317f'::uuid, 1786431, 'Reynolds Consumer Products'),
    ('21c052bc-e0a5-440a-bf1b-2878fa703737'::uuid, 355948, 'Richardson Electronics'),
    ('578eb178-f386-4a42-84c6-ee5a5025de67'::uuid, 2141099, 'Rigaku'),
    ('3c928d59-e582-4092-a47f-77a802db17ef'::uuid, 1516536, 'Rightmove'),
    ('1309723d-2375-4157-9c60-00a3686eb3d0'::uuid, 1281895, 'Rocket Pharmaceuticals Inc'),
    ('3606bab5-31fd-49fa-9724-13327dedf325'::uuid, 1969729, 'Rockwool'),
    ('605896b7-a928-4e62-bd02-c6727a651c1a'::uuid, 1770114, 'Saab AB'),
    ('716042ea-dd3a-4a7f-bad3-27c2cd6b201d'::uuid, 1584273, 'Sanrio Co.'),
    ('11fa29e1-245c-4466-9358-734fd14b1a61'::uuid, 2072563, 'Saputo'),
    ('0d058698-c50f-4677-a235-2d0dc49b7e06'::uuid, 1874315, 'Satellogic'),
    ('7be1499a-1c1b-46e9-b5e4-d99d141ed968'::uuid, 1655190, 'Schindler Holding'),
    ('4bff9990-bfbc-4dc7-802e-0d94eb7b5fae'::uuid, 866729, 'Scholastic'),
    ('c8450765-3a17-4ddf-91ac-fab5b440ffe6'::uuid, 825542, 'Scotts Miracle Gro'),
    ('83d32041-2613-48bf-bb59-76059e182cbf'::uuid, 88121, 'Seaboard Corporation'),
    ('1db94c42-0cfe-44df-ac10-f21cbf05e8bf'::uuid, 1329213, 'Senior'),
    ('d9e0999c-c46c-4c38-8107-e751f0f3ee0c'::uuid, 1583708, 'SentinelOne'),
    ('30549cbb-f336-48ae-b076-1b9b175e07d4'::uuid, 2099326, 'SERES Group'),
    ('6b4394fa-73e5-4d03-95d5-8e6579f50eaa'::uuid, 1359519, 'Seven & i'),
    ('4947cb79-5a75-455a-9b9b-851eb95f3214'::uuid, 1662991, 'Sezzle'),
    ('2d1b70cb-63c2-4a4e-aaf4-d26f4a6e36a3'::uuid, 354963, 'Shenandoah Telecommunications'),
    ('241855bc-8a02-4925-a302-15bf56ef72ca'::uuid, 1830056, 'Siemens Energy AG'),
    ('e59aafc5-33c7-4471-8def-b002a3648ba0'::uuid, 2073972, 'Sienna Senior Living'),
    ('a7b00468-88cb-47f8-8462-e51c50a80ce1'::uuid, 1063761, 'Simon Property Group'),
    ('739114ed-f904-4ed2-b090-da090c80a122'::uuid, 2120882, 'SK Hynix'),
    ('a5e48aa4-2fea-4660-88a8-74151b9129de'::uuid, 827187, 'Sleep Number'),
    ('9f10477f-88cc-40d5-8c45-f6e5383f24ca'::uuid, 1032033, 'SLM'),
    ('d06bb656-6bc5-4337-8ba0-17a7746419f6'::uuid, 91440, 'Snap-On'),
    ('61f35ec9-5e80-415f-bcc2-5eb524280647'::uuid, 92122, 'Southern Company'),
    ('719162d5-fb07-4b65-a49e-74ecd517a294'::uuid, 1132105, 'Sportsman''s Warehouse'),
    ('f5000e8a-c09b-434d-a27c-cc9aadf362c2'::uuid, 718937, 'STAAR Surgical'),
    ('405a81b8-8c47-4b7a-9a76-24758d41c564'::uuid, 310354, 'Standex International'),
    ('fd1351a0-d811-48a5-9f3c-fd01b1dde8ab'::uuid, 93556, 'Stanley Black & Decker'),
    ('d6fc81e5-4385-4bb4-9a76-e4bde69615f6'::uuid, 1605484, 'Stellantis'),
    ('26332896-381c-453b-9531-309eb9e06a16'::uuid, 1757898, 'STERIS plc'),
    ('da85cb35-4c61-4bcc-9ec2-ca264fbacb66'::uuid, 2027330, 'SUGI Holdings'),
    ('6bf829c4-a700-49e9-be97-5d3998f97c3c'::uuid, 1097362, 'Sun Life Financial Inc.'),
    ('385df117-4ad2-4f59-a0f9-d75f6b7a1e06'::uuid, 2083785, 'Sunbelt Rentals Holdings'),
    ('ea202e9d-1efa-4fd3-ac0f-49a06e0c2d0e'::uuid, 1514705, 'SunCoke Energy'),
    ('8fa256fd-b9e0-4239-a157-e73039a5d837'::uuid, 1838987, 'SunPower Inc.'),
    ('9f7aa6be-e52a-4eaf-9fd0-d922104ceb0f'::uuid, 1356576, 'Supernus Pharmaceuticals'),
    ('c70f7f3d-00bf-464b-9698-5932cac284c2'::uuid, 1837240, 'Symbotic'),
    ('5197d4d6-3372-438b-9d13-df19f87acc57'::uuid, 96021, 'Sysco Corporation'),
    ('d736cdce-bc42-4db0-972e-ff2a6ad7005e'::uuid, 1116132, 'Tapestry'),
    ('f8c84465-b957-465b-bd58-80880a338238'::uuid, 1232384, 'TC Energy'),
    ('fe8dc90b-c0ef-4ec2-be1a-1d3705814308'::uuid, 2073804, 'TCL Electronics Holdings Ltd.'),
    ('167db014-da2a-410c-a62b-ef3368104f8e'::uuid, 2018064, 'TechTarget'),
    ('2c74abbe-e907-43a9-82be-6751ea0c9d60'::uuid, 932470, 'Telecom Argentina S.A.'),
    ('1578dfe7-8480-40ef-9339-13729b95a04c'::uuid, 96943, 'Teleflex'),
    ('ef109d38-7e8b-4612-a17b-e066e38592b7'::uuid, 1190723, 'Tenaris S.A.'),
    ('6ac8b247-41ad-46cc-96c2-441531cba199'::uuid, 70318, 'Tenet Healthcare'),
    ('b2929002-0c21-45f1-bc9d-5805832f0f30'::uuid, 97216, 'Terex'),
    ('ab5f7bd9-9e67-4125-a202-42995be17467'::uuid, 1342874, 'Ternium'),
    ('de956e7f-ad0e-4306-bc27-7493ceae213e'::uuid, 1390777, 'The Bank of New York Mellon Corporation'),
    ('4aadbf7c-dea5-45c6-a27e-e2aa58c818d3'::uuid, 21076, 'The Clorox Company'),
    ('f1637f00-e16b-4b3d-8848-2f0bc13e89ab'::uuid, 21344, 'The Coca-Cola Company'),
    ('de512bb5-1b76-4ed2-9b28-be753a137c85'::uuid, 2073913, 'The North West Company Inc.'),
    ('ccc765d7-7682-4375-8e8a-03b76e5bc864'::uuid, 1862461, 'The Real Brokerage'),
    ('e2fc418e-e6bd-42e0-a5d9-9e863fa98740'::uuid, 1583107, 'Theravance Biopharma'),
    ('db6cc338-dac6-47b3-b92c-c450237da720'::uuid, 1075124, 'Thomson Reuters'),
    ('7e07a5e3-2dfc-48cc-9be0-591a68fc562d'::uuid, 109198, 'TJX Companies'),
    ('4360821d-ee3d-4011-a0fc-c3a9bd43795f'::uuid, 1296484, 'TOP Ships'),
    ('9423568b-b714-4712-b00b-d3df657b3c86'::uuid, 2072098, 'Toromont Industries'),
    ('3d0f92ad-438b-4e93-bc4e-70435c683ae0'::uuid, 947263, 'Toronto-Dominion Bank'),
    ('caea5b7a-6514-4503-a4ba-20ce91b117f4'::uuid, 2071881, 'Tourmaline Oil'),
    ('1343ae1f-6dd7-4560-a550-eff5ff39e85e'::uuid, 2018139, 'Toyota Tsusho'),
    ('aca318ba-d3ca-4dd8-be52-f31e57025cfb'::uuid, 1133311, 'Travelzoo'),
    ('ac6365c2-9955-4504-bf49-a733efadfa83'::uuid, 1013880, 'TTEC'),
    ('489ba2a2-8ee9-48f9-8701-a1a2c0f93226'::uuid, 100493, 'Tyson Foods Inc.'),
    ('9246ed54-0562-43ca-9ce2-7050f70cc3e0'::uuid, 4457, 'U-Haul'),
    ('aa0ee2df-d4c9-489c-bc58-6c2bbe22f7f0'::uuid, 1901440, 'UL Solutions'),
    ('2cbacff6-1fbc-475d-8d1d-24c946ef998a'::uuid, 1590560, 'UniQure'),
    ('8269b20e-3b7c-4c70-9db8-ffc7f98eccc5'::uuid, 102037, 'Universal'),
    ('5cf12072-1453-4b74-b255-8194abcc811a'::uuid, 1890126, 'Universal Music Group'),
    ('c8da1917-c5d9-4456-a0fc-b32aaff685ed'::uuid, 1647639, 'Upstart'),
    ('710be30a-b3d9-4fd9-b41c-d1f8e1ef8bb5'::uuid, 912615, 'URBAN OUTFITTERS'),
    ('0d909849-3e6e-47bd-afee-a148720e1882'::uuid, 1681622, 'Varex Imaging'),
    ('54e98259-ba14-4663-88de-24802a36e1a6'::uuid, 103145, 'Veeco Instruments'),
    ('b12bcf3d-bfb9-4155-b6f4-95ea20992567'::uuid, 1827635, 'Veradermics'),
    ('506e6c0d-694a-42ae-a05a-fcf08bbbdf9b'::uuid, 1526119, 'Verastem'),
    ('888c2878-2d15-46e3-8cd6-7931a97f8832'::uuid, 1014473, 'VeriSign'),
    ('ad2aeea8-f10f-4762-97d4-f600825c0882'::uuid, 1792044, 'Viatris'),
    ('c3795820-d180-47b7-9642-4c1f118f392e'::uuid, 2131322, 'Victory Giant Technology Huizhou Co.'),
    ('56d52735-3393-4b3a-ba6d-81f575cec5ab'::uuid, 1692819, 'Vistra'),
    ('c2d2e34e-5b18-4b1b-b7f5-4a2b0d41f901'::uuid, 1396009, 'Vulcan Materials'),
    ('b44a9095-121c-46de-b24e-1b9225b5f394'::uuid, 1319161, 'Warner Music Group'),
    ('4e279f36-4b1b-4385-a24e-36af8c9e2a76'::uuid, 1691303, 'Warrior Met Coal'),
    ('840c83e1-ebc5-423e-8614-c42a526301cf'::uuid, 105016, 'Watsco'),
    ('a1ad9acb-927e-42a7-8566-0c31c44eefbd'::uuid, 1603923, 'Weatherford International'),
    ('d39d3d5e-3846-4432-9f4a-841794887f77'::uuid, 30697, 'Wendy’s'),
    ('27390e0d-135f-45b3-8486-93d176923a46'::uuid, 105770, 'West Pharmaceutical Services'),
    ('a0f3ef56-c6d6-460c-8f0e-5b9279fc1c73'::uuid, 106532, 'Weyco Group'),
    ('aaf76c33-66e1-4cf6-903d-d8f87ca06026'::uuid, 107263, 'Williams Companies'),
    ('b4b095d3-8aae-4c81-a842-d1ddff0e0c47'::uuid, 719955, 'Williams-Sonoma'),
    ('eb1bb873-cdfe-4441-9f1a-dbac0c47eacc'::uuid, 908315, 'Winmark'),
    ('7dc0d636-c086-48c6-8487-0bbd1ac09ecc'::uuid, 1015328, 'Wintrust Financial'),
    ('58c02a3c-f0b0-46cd-bbbd-72e420bab7db'::uuid, 1501697, 'X4 Pharmaceuticals'),
    ('88acefca-3a00-41e7-a20d-5e7cc8e1e8c3'::uuid, 2097163, 'Xanadu Quantum Technologies Limited'),
    ('5a7c04b3-9907-4577-920f-a28ba256b579'::uuid, 1582313, 'Xenon Pharmaceuticals'),
    ('df7b5cd4-1ec0-4f1a-8185-c78bdb91df4a'::uuid, 1810997, 'XPENG'),
    ('6a4add19-053c-462f-8dba-b78f4ba1d559'::uuid, 1670592, 'Yeti Holdings'),
    ('560fd862-93e2-4ada-a5ed-b7f6ef056f19'::uuid, 2068427, 'Zealand Pharma'),
    ('73363984-b55e-4db4-95f7-a8308e30878b'::uuid, 1136869, 'Zimmer Biomet Holdings, Inc.'),
    ('bc33a0d3-6683-45d3-8b15-2529dc156ad5'::uuid, 1937653, 'Zymeworks')
)
SELECT p.id, p.name AS expected_name, c.name AS actual_name, c.sec_cik AS actual_sec_cik,
       CASE WHEN c.id IS NULL THEN 'row missing'
            WHEN c.name IS DISTINCT FROM p.name THEN 'name drifted'
            ELSE 'sec_cik already set' END AS reason
FROM proposed p LEFT JOIN companies c ON c.id = p.id
WHERE c.id IS NULL OR c.name IS DISTINCT FROM p.name OR c.sec_cik IS NOT NULL;

-- 0c. Two proposed rows claiming one CIK, or one row claiming two CIKs.
--     Static in this file, asserted anyway so a hand edit cannot break it.
WITH proposed(id, cik, name) AS (VALUES
    ('2a58a470-bc99-486e-a7ea-63c8d219200d'::uuid, 1070494, 'Acadia Pharmaceuticals'),
    ('b4cef861-b368-47de-9d6d-ecd7f0ede8d9'::uuid, 949858, 'Achieve Life Sciences'),
    ('5438b02d-6846-43a2-b35c-6fcd8ab94502'::uuid, 880984, 'ACORN ENERGY'),
    ('8e6c164e-7a79-4a02-8ba6-b557a68bc9f1'::uuid, 1670541, 'Adient'),
    ('cf722bdd-d1ae-41db-b9ea-db48c3e0f179'::uuid, 1378789, 'AerCap'),
    ('65411a83-7119-4131-839d-2bdabe8f3765'::uuid, 2081206, 'AGI Inc'),
    ('0aa3eefa-43a0-449a-90bb-dee79f29bca0'::uuid, 1378580, 'Airbus'),
    ('c20b5937-8f63-4e38-8449-3e77fa7f15f2'::uuid, 903419, 'Alerus Financial'),
    ('e0bcfde4-adca-45dc-8da2-95b03ccf9a15'::uuid, 1362468, 'Allegiant Travel'),
    ('a6879886-641f-4613-b2a5-1090dab79fbc'::uuid, 899051, 'Allstate Corp'),
    ('eacc432f-08bf-42e4-8ed7-306d874791e7'::uuid, 40729, 'Ally Financial Inc.'),
    ('e9a408fe-a9e3-4433-bc52-37301421128f'::uuid, 1178670, 'Alnylam Pharmaceuticals'),
    ('9d904e24-05fb-4f5d-b377-d8bbf2d6be7f'::uuid, 1161611, 'Aluminum Corporation of China'),
    ('8c7179a8-46f2-4b4b-af3a-75170f4b3000'::uuid, 1411579, 'AMC Entertainment Holdings Inc.'),
    ('03c6c452-2fdb-4cd2-8499-a82e08424d14'::uuid, 1053507, 'American Tower'),
    ('ced30870-5ae6-45d9-bd7c-97d6d201dd08'::uuid, 820027, 'Ameriprise Financial'),
    ('11be8abb-4b04-460d-a269-6ceae9675e26'::uuid, 707605, 'AmeriServ Financial'),
    ('26e931c5-7070-4e9f-b794-37c87fcd1132'::uuid, 6176, 'Ampco Pittsburgh'),
    ('4f9096a5-0ac4-4d94-8d62-c93cd7c76230'::uuid, 1370053, 'AnaptysBio'),
    ('604bcbc4-7b4e-4bd4-9d3d-b6b82a1ae799'::uuid, 1973832, 'Anglogold Ashanti PLC'),
    ('7f679826-d4a2-4c1f-98f4-bccac200d7f8'::uuid, 1023024, 'ANI Pharmaceuticals'),
    ('5b364ffc-53ae-4bf0-9d62-ee036014f007'::uuid, 922864, 'Apartment Investment and Management Company'),
    ('67fe6bfe-dd92-4f9a-a682-6147dcbf76c5'::uuid, 1433195, 'AppFolio'),
    ('8bb2eb81-0107-4fc6-a262-6ef9e8cbf9e6'::uuid, 894405, 'ArcBest'),
    ('5857f776-6e7f-4ccc-b3db-fe1cf495a10f'::uuid, 947484, 'Arch Capital'),
    ('41877900-bc2a-4956-b00e-6682dfd13010'::uuid, 1768224, 'Arcturus Therapeutics'),
    ('c0d02715-0160-4f5b-aed2-9e99c948533d'::uuid, 1697862, 'Argenx'),
    ('9be6d7d7-cde5-4e35-82e0-ec8c01c9f59a'::uuid, 1820721, 'Array Technologies'),
    ('8305b8db-0109-4764-82e2-b1735f147d52'::uuid, 879407, 'Arrowhead Pharmaceuticals'),
    ('62a9d930-9870-4eab-a252-0af0598e3922'::uuid, 1145986, 'Aspen Aerogels'),
    ('1c13f3a3-0fb5-4d31-bf36-0e3345b26f1e'::uuid, 1487198, 'Aspen Group'),
    ('7afc3f04-45ac-4c72-9c20-5c012f142585'::uuid, 7789, 'Associated Banc Corp'),
    ('7eddba76-5180-45fa-b250-acdb1e9724e0'::uuid, 901832, 'AstraZeneca'),
    ('7b6a76f1-4d2a-452a-922f-caf34aced299'::uuid, 2081043, 'AtaiBeckley'),
    ('be3cf448-1d4f-4ff8-9c6b-9572be264e92'::uuid, 1420520, 'Atomera'),
    ('a0a53d11-3c7d-4460-a56f-c951d0a241ce'::uuid, 1683541, 'Aurora Cannabis'),
    ('b6568c8f-7204-4730-98d2-ca1865271c05'::uuid, 350698, 'AutoNation'),
    ('1a0f8c2a-c3ad-4021-8909-d0a6e9582b7d'::uuid, 1214816, 'AXIS Capital'),
    ('b99a0836-986d-4d3d-8084-1d18883a3824'::uuid, 1069183, 'Axon Enterprise'),
    ('3433936b-26f9-46e9-818f-c5f6559894d5'::uuid, 933974, 'Azenta'),
    ('85e6fd49-e02d-4396-9bbc-0cd987afb2f8'::uuid, 1278027, 'B&G Foods'),
    ('d4365507-3258-480b-9be0-cdbf8275d2e9'::uuid, 1429937, 'B2Gold Corp'),
    ('6edec227-596d-4c1b-b7f3-ec7e3d7051f1'::uuid, 1453015, 'Ballard Power Systems'),
    ('7bbb4ea0-4af7-47ef-a9e1-11ab5329a7ca'::uuid, 1747079, 'Bally''s'),
    ('a935203d-63a8-494e-9c18-17eb6d50ad56'::uuid, 2127862, 'Baltic Classifieds'),
    ('2a271e31-7c35-4dae-bce1-5d735b363f22'::uuid, 842180, 'Banco Bilbao Vizcaya Argentaria'),
    ('4ebbeefa-b82f-4f25-8308-54dcc6b6fc27'::uuid, 891478, 'Banco Santander S.A.'),
    ('e4d3e5f2-0e92-4972-89ef-38806d09994a'::uuid, 1504008, 'BankUnited'),
    ('45f3f08f-5196-4ed9-9316-70a1c9c0966d'::uuid, 1978954, 'BBB Foods'),
    ('408c99f3-9688-44fb-96f5-8588eef53c65'::uuid, 915840, 'Beazer Homes USA'),
    ('0f715b45-0554-490b-b6a6-fa852e096171'::uuid, 842023, 'Bio-Techne'),
    ('d018f0b8-b794-4f24-b7f0-7914a5d90f21'::uuid, 834365, 'BioLife Solutions, Inc.'),
    ('57196813-55d6-4867-a565-d7feb0482d85'::uuid, 1498403, 'BioLineRx'),
    ('8b2e0952-33d3-43c2-887b-3ba7d01f0cc6'::uuid, 1776985, 'BioNTech'),
    ('1e061841-8579-425d-94be-c477bf31186f'::uuid, 1720893, 'BioXcel Therapeutics'),
    ('4386731c-9908-4a00-a553-c3e7a16f6098'::uuid, 1838406, 'BKV'),
    ('7604e8be-0afd-4ecf-a771-e9f2d616f62f'::uuid, 1130464, 'Black Hills Corporation'),
    ('c3d8e115-4157-4163-b6dd-ff3e56a4e85e'::uuid, 1070235, 'Blackberry'),
    ('69807bb4-f226-4aed-ad28-b59ca4a81a01'::uuid, 1546417, 'Bloomin'' Brands'),
    ('6d94b7cc-f799-4e34-9b01-44c009d03742'::uuid, 1589526, 'Blue Bird'),
    ('6d173063-6932-4498-a0b8-9e8a54db4f34'::uuid, 908255, 'BorgWarner'),
    ('13db8ca4-862b-410f-9f2a-89659d8d10ff'::uuid, 949870, 'Boston Beer'),
    ('bc4a41fc-c072-4129-bb80-a2e1d040ecc0'::uuid, 1906364, 'BOXABL'),
    ('d6b99d4f-acec-4407-b63e-1989445ddf1d'::uuid, 1505065, 'Brainsway'),
    ('0d8b61d1-cd84-4fb0-a4e6-2f407af62aeb'::uuid, 1071438, 'Braskem S.A.'),
    ('87704492-ceea-41b8-bd08-a17e6b00a4c5'::uuid, 14272, 'Bristol Myers Squibb'),
    ('61a1d805-f9fc-44e3-bd01-c71bf2545732'::uuid, 1303523, 'British American Tobacco p.l.c.'),
    ('db126811-2463-41ca-ac3d-8805c1387cd8'::uuid, 1383312, 'Broadridge Financial Solutions'),
    ('e620a5b4-c091-4e23-850a-792e6910af2f'::uuid, 1545772, 'Brookfield Property Partners'),
    ('7055f3c9-93b8-45b2-b0ce-0aa15650178b'::uuid, 1109354, 'Bruker'),
    ('82a76ce5-df3d-4664-b652-9bf750fec8a8'::uuid, 1714174, 'Burford Capital'),
    ('0dae6c3d-4610-4821-9fcc-cf058e5a270e'::uuid, 1447956, 'BYD Electronic (International)'),
    ('749c8929-b72e-45c6-9cfa-238b7b521b90'::uuid, 1043277, 'C.H. Robinson Worldwide'),
    ('466f0460-a200-4da1-960f-838b30bea464'::uuid, 1632127, 'Cable One'),
    ('1351ce5e-91b1-41c8-b76e-be8686bdd107'::uuid, 813672, 'Cadence Design Systems'),
    ('485dfec5-87ee-4da4-9dfb-3a44433bc66e'::uuid, 1035201, 'California Water Service Group'),
    ('a04e9040-2814-4717-bc7e-d6d13437f9d1'::uuid, 2034268, 'Cantor Equity Partners III, Inc.'),
    ('21a8ab80-ff0b-4cdd-9c4d-d64fd88f1f27'::uuid, 927628, 'Capital One Financial Corporation'),
    ('16949daa-fdd5-447f-a4dc-e2d5ec705d06'::uuid, 1530721, 'Capri Holdings'),
    ('0a1e8fd1-d63f-4f39-984a-874ec53c4a67'::uuid, 2019410, 'Caris Life Sciences'),
    ('c843342d-ed2f-4d72-98ef-9a1b7e35d0e7'::uuid, 1447362, 'Castle Biosciences'),
    ('dc7027d5-5b4d-4e27-80d4-8fe3c6bbb5b1'::uuid, 1138118, 'CBRE Group'),
    ('47e507c3-45f2-47ca-a54d-bd4640fbafef'::uuid, 949157, 'Century Aluminum'),
    ('a0e35816-7939-4d7e-98f6-67240695af86'::uuid, 1324404, 'CF Industries'),
    ('e3ec17dc-b62f-43ca-9570-2b9afe9ae108'::uuid, 313927, 'Church & Dwight Co., Inc.'),
    ('8259c117-812c-401d-9bf4-3f890736b52a'::uuid, 759944, 'Citizens Financial Group Inc.'),
    ('cfe37bed-12ea-461f-abb8-9c76a485fa34'::uuid, 1441236, 'Clearwater Paper'),
    ('4dc5f266-d9ed-4c73-b17e-f5cb7e14fbb6'::uuid, 1780785, 'CN Energy'),
    ('b6972604-6cc8-4fb2-85c9-c8626686eb65'::uuid, 1070412, 'CNX Resources'),
    ('90335c06-e540-4386-a6e1-e221fc702af4'::uuid, 1284812, 'Cohen & Steers'),
    ('f91be27f-1533-4712-a3c9-4ecf2919f670'::uuid, 887343, 'Columbia Banking System'),
    ('606f91a7-ff8e-42f7-8177-0127820e2742'::uuid, 1050797, 'Columbia Sportswear Company'),
    ('e65ef23e-3fc9-4c22-aae4-09b33b8a037d'::uuid, 1012037, 'Compagnie de Saint Gobain'),
    ('6edc94ff-93bf-4d41-81aa-84b1eac1445b'::uuid, 1563190, 'Compass'),
    ('48f47aa5-df9a-4dc3-abb4-7bb318050545'::uuid, 1119774, 'Compugen'),
    ('c43c607f-7100-44ff-a4e4-587b68abedab'::uuid, 816956, 'CONMED'),
    ('5188f910-7190-4dc2-a477-1d6f5a49d12c'::uuid, 2070829, 'Contemporary Amperex Technology Co. Ltd.'),
    ('30c2fc6a-b24e-4f17-b183-adbdefa20ebd'::uuid, 2064307, 'ContextLogic'),
    ('25264ff1-f9cd-4a1b-ae1c-256f220839df'::uuid, 1088856, 'Corcept Therapeutics'),
    ('28118241-4373-4e29-90bb-bce83ca02c27'::uuid, 1026655, 'Core Molding Technologies'),
    ('d1efc560-47fc-4975-a647-e7335b985808'::uuid, 1070985, 'CoreCivic'),
    ('51dbf790-fbff-4983-a5a8-2a782908a96f'::uuid, 1743759, 'Corsair Gaming'),
    ('04fbd49d-c88b-4f5f-bf5c-c85bc61d49da'::uuid, 1755672, 'Corteva'),
    ('dd023a0e-6519-4be0-8e38-2dea1719beb2'::uuid, 1832928, 'Cresco Labs'),
    ('bb10d95d-b556-4f4e-8497-cf9055680698'::uuid, 1576427, 'Criteo'),
    ('f667818a-cf94-436b-9186-401d10e760f8'::uuid, 1334036, 'Crocs'),
    ('7be9b55d-672f-4f04-b9dd-20bbf658443d'::uuid, 1298675, 'CubeSmart'),
    ('ed9be63c-145b-4053-b17b-ca190ed3bc6a'::uuid, 26172, 'Cummins'),
    ('71a7fe83-49bf-4d0b-8ed8-45a70df462db'::uuid, 64803, 'CVS Health Corp'),
    ('841c9245-87ba-4e3b-aa97-6647dc20e809'::uuid, 1437712, 'DCC'),
    ('45eb2fc8-7d89-4cfa-a9eb-d07096e0c094'::uuid, 1694426, 'Delek US'),
    ('21bcc70f-d820-4078-96d3-61d6de6fa278'::uuid, 1050140, 'Descartes Systems Group'),
    ('1b03011e-cbdf-4a96-9ba0-c9e014242a7c'::uuid, 813298, 'Destination XL Group'),
    ('e043e420-71e9-4fc6-b7e7-5895871b2461'::uuid, 1049724, 'Deutsche Lufthansa'),
    ('dd43b9e8-4b7c-4ae4-a614-381498d2bb3a'::uuid, 909108, 'Diamond Hill Investment Group'),
    ('c545478f-97f0-4caa-8b8e-fe54f485e7c6'::uuid, 317788, 'Digital Turbine'),
    ('caddae6f-a848-4ba9-afe4-05f92a6cd160'::uuid, 1857475, 'DOLE plc'),
    ('caa17d5f-c70c-419a-9911-57fddef60ef0'::uuid, 29905, 'Dover Corporation'),
    ('4eb72ca4-b744-42b2-893c-dfc870875e89'::uuid, 2094201, 'DPC Dash'),
    ('4621237c-d855-43ab-aec7-ee20857201dd'::uuid, 1804745, 'Driven Brands Holdings Inc.'),
    ('9a0d2558-4eca-491e-bf21-51e2fe8b1c68'::uuid, 1136808, 'E.ON'),
    ('858682c6-deef-4af1-b24a-4c31b173b4f1'::uuid, 31235, 'Eastman Kodak'),
    ('c7a6c9b2-7ef5-4180-b3e9-6c7ebcdeb295'::uuid, 1590714, 'Element Solutions'),
    ('caac6b49-210c-4cb5-9061-845deb2dbe07'::uuid, 1969796, 'Embracer Group'),
    ('8eda13dc-89ae-4f52-a0b3-ee21064422c9'::uuid, 1127248, 'Emera Incorporated'),
    ('d8ee941c-e236-4133-a5fe-ff0e76f3cdbc'::uuid, 32604, 'Emerson Electric Company'),
    ('40e49de8-2a57-4c76-bff1-ef16e3588f94'::uuid, 1084961, 'Encore Capital Group'),
    ('60fa4a41-06c7-4752-a245-92be85c767d5'::uuid, 1140625, 'Equinor ASA'),
    ('4cd9bc95-6364-45af-9b84-24a54c443974'::uuid, 1333986, 'Equitable Holdings Inc.'),
    ('015e1dd9-ae0a-4b85-94f6-a660aaacd9c9'::uuid, 1434868, 'Esperion Therapeutics'),
    ('f5315772-f5a1-470e-b24f-785fa7eb16bb'::uuid, 1412558, 'Evotec'),
    ('a18f0c30-365d-46f5-824a-0c8cb0b29fbd'::uuid, 939767, 'Exelixis'),
    ('ca369570-dc51-4e1d-b667-d6d8bfa395dc'::uuid, 1109357, 'Exelon'),
    ('ab4bcf16-d848-43a8-9020-5d012a812f89'::uuid, 2115436, 'ExxonMobil'),
    ('fe990a20-893f-4dcf-a8c7-1a6a21be947d'::uuid, 814547, 'Fair Isaac Corporation'),
    ('199fcbf8-8e70-4f22-b6bf-fa3f77a49700'::uuid, 915191, 'Fairfax Financial'),
    ('d987372c-3f3b-4a12-a2d6-cd8f4670dbba'::uuid, 277509, 'Federal Signal'),
    ('4eb3bd64-92e8-4472-8c22-88d25ca50ab5'::uuid, 1648416, 'Ferrari'),
    ('c1061f2e-f29a-4e8f-aba9-4b5e67eda0ec'::uuid, 1468522, 'Ferrovial'),
    ('196af0c4-0323-455c-8f57-679fd6d94afa'::uuid, 1098151, 'Fidelity D & D Bancorp'),
    ('177f5877-34f7-4382-acdf-58b16c887c2a'::uuid, 1331875, 'Fidelity National Financial Inc.'),
    ('b8f22e06-b870-4ab5-b3b6-22ded57daf9b'::uuid, 2073638, 'Finning International'),
    ('209f2f09-cb25-4e1d-8590-5056fd301b5d'::uuid, 1746109, 'First Bank & Trust'),
    ('aefb7b8b-8bba-4d85-bd4a-48cc095f38fb'::uuid, 860413, 'First Interstate Bancsystem'),
    ('718ec183-7678-4518-8d01-3cbd92c15b31'::uuid, 1666175, 'Fortis'),
    ('0f3b28b6-c3a5-4d29-954e-1f04d0606231'::uuid, 1828377, 'Fortitude Gold'),
    ('441b3816-6813-472c-bbac-8238aefd8d2c'::uuid, 1559444, 'Forvia'),
    ('dc5198b0-c198-44a2-95e9-8e9e1a704d4c'::uuid, 1456346, 'Franco Nevada'),
    ('e3e97199-9214-4f8f-8288-195d66ee36a4'::uuid, 1320854, 'FreightCar America'),
    ('86418122-85a6-4f9a-a6d1-6e7dab5684fd'::uuid, 887936, 'FTI Consulting'),
    ('6f9742e0-2758-4c30-8eb9-4c69bbc8d9c8'::uuid, 700564, 'Fulton Financial'),
    ('ed12e388-1d66-4745-b66e-f99e8786a824'::uuid, 1704711, 'Funko'),
    ('67cda1e8-ae72-400f-86c9-5ebc0a776912'::uuid, 1996810, 'GE Vernova'),
    ('85d2b0c6-7c32-48ae-8ff4-e0ac6da4be88'::uuid, 1474968, 'Geely Automobile Holdings Ltd.'),
    ('b9bb6061-2ddb-469b-a157-0a1720198442'::uuid, 849399, 'Gen Digital'),
    ('e3bf8db7-24fa-41b4-80c1-4da9dc0406c2'::uuid, 2074850, 'General Fusion'),
    ('a3f9789c-ca15-4d19-9953-cbed40cc55b6'::uuid, 2100782, 'Generate Biomedicines'),
    ('f240ef76-f7c6-46a0-96ef-edb5b51f4cbc'::uuid, 1022321, 'Genesis Energy'),
    ('40a542eb-c2a4-4152-8d45-eaedb15b73f7'::uuid, 1434265, 'Genmab'),
    ('59614a6e-dc78-4b4a-9ae4-c7d171b4d61e'::uuid, 355811, 'Gentex Corporation'),
    ('5602b4fc-92d3-48f2-900d-f9e84f36f7e0'::uuid, 903129, 'Gentherm'),
    ('2282debc-6c62-46b6-ad65-afea4e1696ef'::uuid, 1898496, 'Getty Images'),
    ('57855961-8b70-4379-a953-45a9e63a195d'::uuid, 2071913, 'Gibson Energy'),
    ('6b648f58-a4ab-4e2c-8174-1c801ff683c7'::uuid, 1857816, 'GigaCloud Technology'),
    ('5a0715d4-e258-4c18-8f0c-48577bcf67a0'::uuid, 897322, 'Gilat Satellite Networks Ltd.'),
    ('95d22579-53d8-476f-83c4-5db780830a0d'::uuid, 882095, 'Gilead Sciences'),
    ('d78c0ee4-31d9-4a09-80f7-d1d05012e9af'::uuid, 1830214, 'Ginkgo Bioworks'),
    ('e63a769b-fba8-4afc-9cca-833e7f15a16e'::uuid, 1653482, 'GitLab'),
    ('0111093a-fca9-462b-82a4-e3b3ffd68782'::uuid, 1609711, 'GoDaddy Inc.'),
    ('c96ccd9f-7230-4558-9bb6-c7d46b9d801d'::uuid, 1273441, 'Gran Tierra Energy'),
    ('b6764f15-f0a4-4738-9c17-3d5b16a4186f'::uuid, 1434588, 'Grand Canyon Education'),
    ('ac87b972-93e9-4419-b485-4d66034ff77f'::uuid, 1771515, 'Grocery Outlet Holding Corp.'),
    ('96bfc6d4-5679-44da-9539-3010d42b679e'::uuid, 912892, 'Grupo Televisa'),
    ('d8487ec2-464b-4796-89f2-8cc345949e66'::uuid, 1802255, 'Guardian Pharmacy Services'),
    ('aa9a72ba-b514-4df1-8d91-4a5b7e8aca0c'::uuid, 1483994, 'H World Group'),
    ('f0c712ec-1f90-4197-ace8-bc028a12222e'::uuid, 2073669, 'Hansoh Pharmaceutical'),
    ('91d049f5-e7bd-4942-8bbd-65f886c140a0'::uuid, 1802665, 'Harmony Biosciences'),
    ('a55bc6e4-53a9-4a06-a425-b2a03e51a43a'::uuid, 860730, 'HCA Healthcare'),
    ('9cb581e8-7d57-4946-8e4b-67114c3d96f7'::uuid, 1144967, 'HDFC Bank'),
    ('313699f7-165c-4a2e-ade1-bc1a2c0969d1'::uuid, 719413, 'Hecla Mining'),
    ('8e0b0ff9-6c33-45ad-b714-017cf3782efd'::uuid, 46619, 'HEICO'),
    ('8a873e47-d22a-4b9e-ae2f-f66290997969'::uuid, 1364479, 'Herc Holdings'),
    ('bf3bba1a-a5b0-4d72-98fc-488a5bd315e4'::uuid, 1446962, 'Hochschild Mining'),
    ('7361687b-ee93-4cef-b71d-7bf76fc634ca'::uuid, 49196, 'Huntington Bancshares'),
    ('ecbb4091-1b58-4c03-ab01-d6864ab9198f'::uuid, 1718405, 'Hycroft Mining'),
    ('6cb4bf0c-0588-4fd9-939e-457f8cd83d91'::uuid, 2078856, 'Hyperliquid Strategies'),
    ('62d86dbf-975e-4b64-a427-7c1a852ea145'::uuid, 1538379, 'Ibotta'),
    ('0e7873d4-a0ab-47e9-814a-79657e8144e8'::uuid, 1103838, 'ICICI Bank'),
    ('31596b3f-e083-482b-bd37-06448722449d'::uuid, 2062803, 'IDP Education'),
    ('2d3070b2-2a26-4e52-ba3c-8e928a5856cc'::uuid, 1790340, 'Immuneering'),
    ('d2e7b7a3-6f08-4bf5-904b-dff22a8dca83'::uuid, 1067491, 'Infosys'),
    ('b5b4dca8-d39e-455d-b75d-9ba7b796641f'::uuid, 1774163, 'Innovent Biologics'),
    ('9040e46a-8d0a-4479-aa4f-4011a1aec014'::uuid, 1114483, 'Integer Holdings'),
    ('4f115e27-d51c-4760-a22d-18ebd9938102'::uuid, 917520, 'Integra LifeSciences'),
    ('ab6b87f7-b5c0-4dc3-8c6c-72a6ff14d07f'::uuid, 1652130, 'Intellia Therapeutics'),
    ('45b9d2d7-5867-4af1-9788-d0ea2bf21313'::uuid, 1405495, 'InterDigital, Inc.'),
    ('dc99d8ab-018e-4142-bb8e-246dfc467cdd'::uuid, 1425205, 'Iovance Biotherapeutics'),
    ('e70746fe-9049-4ed3-90c8-f857e3d94304'::uuid, 1020569, 'Iron Mountain Incorporated'),
    ('24377324-181e-4bc2-b9fa-2fb213150ced'::uuid, 1009829, 'JAKKS Pacific'),
    ('1d9382ae-04b4-4763-a005-7a55e1dd749b'::uuid, 1600520, 'Japan exchange'),
    ('99770153-b800-4d12-8b16-160403329878'::uuid, 1549802, 'JD.Com'),
    ('bb7d9505-f72f-4f82-b399-6477f0742301'::uuid, 1674335, 'JELD-WEN'),
    ('d7972265-365c-4cbd-98a7-159f3613a8fb'::uuid, 2127043, 'Jersey Mike’s Subs'),
    ('83e9977d-70b4-4dcc-ab02-1476801c5cb7'::uuid, 1357615, 'KBR'),
    ('1f2f4e3c-ceee-43fb-b015-59285eee3f46'::uuid, 91576, 'KEYCORP'),
    ('b32d07b3-729d-4832-a2b3-198320acfaa7'::uuid, 1601046, 'Keysight Technologies'),
    ('04af6598-f431-449b-ba17-e86d7300cf4c'::uuid, 55785, 'Kimberly-Clark'),
    ('757edfb0-de82-42e2-9682-92550f0c48e4'::uuid, 2053383, 'Kioxia'),
    ('c972472d-144e-4b1d-9e52-6c5928d16c44'::uuid, 2033019, 'Kokusai Electric'),
    ('6c0beff6-5373-4682-a5b2-9cb52571ac30'::uuid, 1857154, 'Krispy Kreme'),
    ('af6d9f1b-679a-4b7f-8d8c-2157491c5a8d'::uuid, 56873, 'Kroger'),
    ('3b5555ee-758f-41fa-b011-fb7a0cb5c0a7'::uuid, 1679273, 'Lamb Weston'),
    ('f1f3315f-d8c4-436a-9014-47c02d21bf3e'::uuid, 1521036, 'Lantheus Holdings'),
    ('d31c7904-3540-4061-9100-9e8aca84cd53'::uuid, 2068440, 'Laopu Gold'),
    ('5dd572ad-1e41-43cc-90f2-1e359fc94ff2'::uuid, 1069202, 'Lennox International'),
    ('eb2bbe14-b155-4ea2-a64a-0a74405385d2'::uuid, 1580670, 'LGI Homes'),
    ('8101c4e1-9458-49be-b04d-5bd013b5b320'::uuid, 849146, 'LifeVantage'),
    ('e83c3235-20e4-4c46-bd92-caf5beacd801'::uuid, 886163, 'Ligand Pharmaceuticals'),
    ('c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid, 59558, 'Lincoln National Corporation'),
    ('74ab5dad-8ca9-47fe-b450-1ad4d9406bd7'::uuid, 2140948, 'Lion Finance Group'),
    ('71519329-a4cb-4d19-93af-cb0dc70b7cea'::uuid, 1023128, 'Lithia Motors'),
    ('4e68c911-71cd-41cf-97bd-8076c0c94ba1'::uuid, 1462120, 'Live Oak Bancshares'),
    ('3778ec3b-adf7-4547-b0a8-9898ee18692d'::uuid, 733269, 'LiveRamp'),
    ('378c0d7d-d496-4360-9d95-fd8377663298'::uuid, 1160106, 'Lloyds Banking Group'),
    ('3496b52d-df1c-4e22-a8c0-e8ba63830664'::uuid, 1831631, 'Loandepot'),
    ('5a9d7aeb-c466-49c3-9382-a67a340f169d'::uuid, 60086, 'Loews'),
    ('398fe069-92de-4f0a-92e8-474fff3093ec'::uuid, 1767582, 'Luckin Coffee'),
    ('03476ec7-4dcb-442c-8822-fe7e60f28879'::uuid, 1489393, 'LyondellBasell Industries'),
    ('5c8bc39d-cc2d-43fc-92a0-df9ec847fb1d'::uuid, 749098, 'Magna'),
    ('680b460c-a1ef-4c8d-be26-25b8222ee205'::uuid, 1495153, 'MakeMyTrip'),
    ('4f50c656-d8af-419d-8f5b-3e81039c924c'::uuid, 1086888, 'Manulife Financial'),
    ('7850e41f-9fa0-411b-b314-65b4b602f411'::uuid, 2131961, 'Manycore Tech Inc.'),
    ('b35f13f1-ab26-47a1-bf52-af977eb2974d'::uuid, 1048286, 'Marriott International'),
    ('953df921-711a-4ef3-845d-4dc7b210ac66'::uuid, 799167, 'Marten Transport'),
    ('84332844-fda6-410e-9a6b-fa52790cdf0a'::uuid, 1668397, 'Medpace'),
    ('039714ac-bd75-46f5-8521-73fa1fdd8049'::uuid, 1042729, 'Mercantile Bank'),
    ('e30e2af2-49a1-4f55-9ed2-a0d23623d097'::uuid, 833079, 'Meritage Homes'),
    ('9ccef504-78fb-45e1-9e89-c56b41ef2121'::uuid, 2090231, 'METLEN Energy & Metals PLC'),
    ('637aa6b8-6da5-4f58-b90d-d7efeb908c36'::uuid, 1760689, 'Microvast'),
    ('010372bd-8c4d-4cc4-a87b-4f6593a9d26b'::uuid, 2039784, 'Midea Group'),
    ('7c924ae7-3041-4f16-bc78-ca06a858c1e3'::uuid, 924822, 'Miller Industries'),
    ('85a1766d-1cb6-4f75-87a1-e6875f1c195e'::uuid, 1436126, 'Mistras Group'),
    ('a7a46c35-dbc2-489d-ab1e-e3e3a80c0040'::uuid, 67347, 'Modine Manufacturing'),
    ('fc0bd7c2-a123-4c8e-b6c0-8747f48a0641'::uuid, 865752, 'Monster Beverage'),
    ('65c9ddaf-6a1c-44cb-874a-aefe909c568f'::uuid, 2123346, 'Montage Technology Co.'),
    ('76ba3fec-13ae-4210-82e1-5d723d5e93da'::uuid, 1350593, 'Mueller Water Products'),
    ('6eda5d47-02ea-41c9-87d0-86e22265a8af'::uuid, 899923, 'Myriad Genetics'),
    ('2bd4e6b1-745b-46de-accd-e34ab50ed359'::uuid, 1795251, 'Nano X Imaging'),
    ('8b2aa808-1675-4ac0-a7e8-2812321d068a'::uuid, 69633, 'NAPCO SECURITY TECHNOLOGIES'),
    ('a9ddef20-a9cd-4899-b248-525fa090d252'::uuid, 1004315, 'National Grid plc'),
    ('0eee5e37-b308-4995-a0a2-b272c0746fec'::uuid, 844150, 'NatWest'),
    ('684e1591-3a30-480f-b562-3828aaa3a006'::uuid, 1901279, 'Nayax'),
    ('df303dcb-e0b0-4571-b3fd-b19cad95bbe0'::uuid, 1110646, 'NetEase'),
    ('eb477c21-df9e-4742-aca8-c7b94bd5c282'::uuid, 814453, 'Newell Brands'),
    ('89b5dca1-03b1-4388-b836-2b0379623884'::uuid, 753308, 'NextEra Energy'),
    ('10b50cd0-eed9-44d1-9890-4be0e3e38ffd'::uuid, 1124796, 'NLight'),
    ('f3e9294d-ecda-42a0-bed8-18271a406a8d'::uuid, 2072389, 'Northland Power Inc.'),
    ('f5ebe02e-89b6-49ef-94bd-b6b2a1a3f6ed'::uuid, 1173420, 'NovaGold Resources'),
    ('4d816cf4-8a9f-4f0a-9be5-f4ad9eaa8fe9'::uuid, 1114448, 'Novartis AG'),
    ('61d3a428-3196-46d7-b565-a9445c298640'::uuid, 1859795, 'Novonix'),
    ('781671cf-2372-4ec9-8b98-03a3c88aee5f'::uuid, 1814215, 'Nuburu'),
    ('b424f501-704d-4140-acf2-9b550c65a6cd'::uuid, 73309, 'Nucor'),
    ('0db06c25-57be-4f15-ac7a-389bab9d2966'::uuid, 1479681, 'Nutex Health'),
    ('db94ccba-0a9e-43af-8e51-186d63ba7b66'::uuid, 1861560, 'Nuvalent'),
    ('b7ac4c3e-0db9-4e38-a276-1616cef99d16'::uuid, 2088339, 'OBIC Business Consultants'),
    ('4288868b-c8be-422d-ac64-40863392367a'::uuid, 1334388, 'Obsidian Energy'),
    ('84cc2250-94c1-4900-9dcb-aefae92f6bcb'::uuid, 73756, 'Oceaneering'),
    ('c1cdce71-55ef-4213-b8c3-3a1d63b7f88c'::uuid, 1882782, 'Odyssey Therapeutics'),
    ('40ff0f77-f7a6-4d01-baaf-8eccc8333098'::uuid, 878927, 'Old Dominion Freight Line'),
    ('caacad17-b33a-4404-8cba-ce4b3ea407d8'::uuid, 1750284, 'Olema Pharmaceuticals'),
    ('56c432db-7c9d-4737-8d7d-02913836b002'::uuid, 1637715, 'OnKure Therapeutics'),
    ('f9989656-521b-4cc5-8d08-5a0f6c563619'::uuid, 704532, 'Onto Innovation'),
    ('6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid, 775158, 'Oshkosh Corp'),
    ('b0403540-c2eb-4f58-a2bb-d1a1522af688'::uuid, 1636651, 'Ovid Therapeutics'),
    ('e4525662-ad9d-4fd7-a736-2a21c869455e'::uuid, 821483, 'Par Pacific Holdings'),
    ('91476708-694e-4c52-942b-f8eccd9bc1e2'::uuid, 2119292, 'Pasqal'),
    ('8372a5b6-06dd-45d8-867c-7c2cc3e53026'::uuid, 1383414, 'PennantPark Investment'),
    ('3e10ef20-760d-49db-b634-7e0005a3bd06'::uuid, 1455633, 'Pennon Group'),
    ('14c4f47d-94c7-4706-801a-fdec8642c06c'::uuid, 77360, 'Pentair'),
    ('04f89953-cb99-46af-833f-45561abf22db'::uuid, 891532, 'Perma Fix Environmental Services'),
    ('48c9d5e9-acfb-4da2-9df6-679efc2fd730'::uuid, 2026053, 'Pershing Square'),
    ('f3f6ad52-1da2-4e21-9065-c6f0d88e2dad'::uuid, 1069899, 'Phibro Animal Health'),
    ('132d1ea7-3b79-416c-929c-cf538e2c093a'::uuid, 810136, 'Photronics'),
    ('79454f6c-0eee-4a7d-a4a2-5266d4bd1d03'::uuid, 1437441, 'Piraeus Bank SA'),
    ('3760bdcc-8c7f-4615-bf53-cd47b6f81ef4'::uuid, 1784535, 'Porch Group'),
    ('30883a17-ef7c-4340-ac31-b440be1fe4e4'::uuid, 1894562, 'Prime Medicine'),
    ('dd5ac907-f852-4f49-8478-778d002a5be1'::uuid, 876167, 'Progress Software'),
    ('7976a80b-a459-4212-a3e3-6937847f667f'::uuid, 1551306, 'Progyny'),
    ('0b8b7794-969f-4238-ab30-0e64497f5079'::uuid, 1068851, 'Prosperity Bancshares'),
    ('8f4f6311-2732-4c34-9e7b-fc799d3d5f5b'::uuid, 1137774, 'Prudential Financial'),
    ('21a2b00d-98a0-45cd-bc54-f9ccf1043e49'::uuid, 1782999, 'PureTech Health'),
    ('b10e39d7-d0bc-464e-8395-bfca4096174a'::uuid, 78239, 'PVH'),
    ('c8eca83d-b0b5-4df1-94d7-895ddcd350bc'::uuid, 906465, 'QCR Holdings'),
    ('2c796439-da12-406d-8ecf-0aa5b8d47982'::uuid, 1015820, 'Qiagen'),
    ('d423c9f0-0207-43d0-ae52-3503dba94ca9'::uuid, 2058873, 'Qnity Electronics'),
    ('fd519c2a-6c5c-4cab-a18a-e3f235a3ca86'::uuid, 1503274, 'Quanterix'),
    ('f95dbf47-8fc8-4036-aac6-60cf536d06c9'::uuid, 1022079, 'Quest Diagnostics'),
    ('b679988a-d9dd-43cd-a643-9c908c94b70b'::uuid, 1117297, 'QuinStreet'),
    ('345d131f-f564-482f-975b-c1d794211185'::uuid, 1739410, 'Rallybio'),
    ('3c0aebcd-0e60-4318-ad68-153db20fc35b'::uuid, 1037038, 'Ralph Lauren Corporation'),
    ('2cc8f498-c5fa-4331-9cea-e725b0a36c07'::uuid, 315852, 'Range Resources'),
    ('aa5de138-64e8-411f-8a00-710dfc83e16e'::uuid, 935419, 'RCI Hospitality'),
    ('297e8905-5f6d-452e-935c-131fdc458143'::uuid, 700841, 'RCM Technologies'),
    ('e6e7dd83-a925-4e00-aec9-bec1efcd3e9b'::uuid, 82811, 'Regal Rexnord'),
    ('a61582b6-31c6-4d73-beea-64777536135a'::uuid, 1281761, 'Regions Financial'),
    ('e259fc86-df8e-40fd-88d6-0e727f618641'::uuid, 1812364, 'Relay Therapeutics, Inc.'),
    ('d46d4777-125a-4086-91c1-801931500b63'::uuid, 1618756, 'Restaurant Brands International'),
    ('d99e526f-da24-4a6c-bfd6-d2abe302a1d9'::uuid, 1628171, 'Revolution Medicines'),
    ('91fac195-6964-4678-a604-0fe928c8317f'::uuid, 1786431, 'Reynolds Consumer Products'),
    ('21c052bc-e0a5-440a-bf1b-2878fa703737'::uuid, 355948, 'Richardson Electronics'),
    ('578eb178-f386-4a42-84c6-ee5a5025de67'::uuid, 2141099, 'Rigaku'),
    ('3c928d59-e582-4092-a47f-77a802db17ef'::uuid, 1516536, 'Rightmove'),
    ('1309723d-2375-4157-9c60-00a3686eb3d0'::uuid, 1281895, 'Rocket Pharmaceuticals Inc'),
    ('3606bab5-31fd-49fa-9724-13327dedf325'::uuid, 1969729, 'Rockwool'),
    ('605896b7-a928-4e62-bd02-c6727a651c1a'::uuid, 1770114, 'Saab AB'),
    ('716042ea-dd3a-4a7f-bad3-27c2cd6b201d'::uuid, 1584273, 'Sanrio Co.'),
    ('11fa29e1-245c-4466-9358-734fd14b1a61'::uuid, 2072563, 'Saputo'),
    ('0d058698-c50f-4677-a235-2d0dc49b7e06'::uuid, 1874315, 'Satellogic'),
    ('7be1499a-1c1b-46e9-b5e4-d99d141ed968'::uuid, 1655190, 'Schindler Holding'),
    ('4bff9990-bfbc-4dc7-802e-0d94eb7b5fae'::uuid, 866729, 'Scholastic'),
    ('c8450765-3a17-4ddf-91ac-fab5b440ffe6'::uuid, 825542, 'Scotts Miracle Gro'),
    ('83d32041-2613-48bf-bb59-76059e182cbf'::uuid, 88121, 'Seaboard Corporation'),
    ('1db94c42-0cfe-44df-ac10-f21cbf05e8bf'::uuid, 1329213, 'Senior'),
    ('d9e0999c-c46c-4c38-8107-e751f0f3ee0c'::uuid, 1583708, 'SentinelOne'),
    ('30549cbb-f336-48ae-b076-1b9b175e07d4'::uuid, 2099326, 'SERES Group'),
    ('6b4394fa-73e5-4d03-95d5-8e6579f50eaa'::uuid, 1359519, 'Seven & i'),
    ('4947cb79-5a75-455a-9b9b-851eb95f3214'::uuid, 1662991, 'Sezzle'),
    ('2d1b70cb-63c2-4a4e-aaf4-d26f4a6e36a3'::uuid, 354963, 'Shenandoah Telecommunications'),
    ('241855bc-8a02-4925-a302-15bf56ef72ca'::uuid, 1830056, 'Siemens Energy AG'),
    ('e59aafc5-33c7-4471-8def-b002a3648ba0'::uuid, 2073972, 'Sienna Senior Living'),
    ('a7b00468-88cb-47f8-8462-e51c50a80ce1'::uuid, 1063761, 'Simon Property Group'),
    ('739114ed-f904-4ed2-b090-da090c80a122'::uuid, 2120882, 'SK Hynix'),
    ('a5e48aa4-2fea-4660-88a8-74151b9129de'::uuid, 827187, 'Sleep Number'),
    ('9f10477f-88cc-40d5-8c45-f6e5383f24ca'::uuid, 1032033, 'SLM'),
    ('d06bb656-6bc5-4337-8ba0-17a7746419f6'::uuid, 91440, 'Snap-On'),
    ('61f35ec9-5e80-415f-bcc2-5eb524280647'::uuid, 92122, 'Southern Company'),
    ('719162d5-fb07-4b65-a49e-74ecd517a294'::uuid, 1132105, 'Sportsman''s Warehouse'),
    ('f5000e8a-c09b-434d-a27c-cc9aadf362c2'::uuid, 718937, 'STAAR Surgical'),
    ('405a81b8-8c47-4b7a-9a76-24758d41c564'::uuid, 310354, 'Standex International'),
    ('fd1351a0-d811-48a5-9f3c-fd01b1dde8ab'::uuid, 93556, 'Stanley Black & Decker'),
    ('d6fc81e5-4385-4bb4-9a76-e4bde69615f6'::uuid, 1605484, 'Stellantis'),
    ('26332896-381c-453b-9531-309eb9e06a16'::uuid, 1757898, 'STERIS plc'),
    ('da85cb35-4c61-4bcc-9ec2-ca264fbacb66'::uuid, 2027330, 'SUGI Holdings'),
    ('6bf829c4-a700-49e9-be97-5d3998f97c3c'::uuid, 1097362, 'Sun Life Financial Inc.'),
    ('385df117-4ad2-4f59-a0f9-d75f6b7a1e06'::uuid, 2083785, 'Sunbelt Rentals Holdings'),
    ('ea202e9d-1efa-4fd3-ac0f-49a06e0c2d0e'::uuid, 1514705, 'SunCoke Energy'),
    ('8fa256fd-b9e0-4239-a157-e73039a5d837'::uuid, 1838987, 'SunPower Inc.'),
    ('9f7aa6be-e52a-4eaf-9fd0-d922104ceb0f'::uuid, 1356576, 'Supernus Pharmaceuticals'),
    ('c70f7f3d-00bf-464b-9698-5932cac284c2'::uuid, 1837240, 'Symbotic'),
    ('5197d4d6-3372-438b-9d13-df19f87acc57'::uuid, 96021, 'Sysco Corporation'),
    ('d736cdce-bc42-4db0-972e-ff2a6ad7005e'::uuid, 1116132, 'Tapestry'),
    ('f8c84465-b957-465b-bd58-80880a338238'::uuid, 1232384, 'TC Energy'),
    ('fe8dc90b-c0ef-4ec2-be1a-1d3705814308'::uuid, 2073804, 'TCL Electronics Holdings Ltd.'),
    ('167db014-da2a-410c-a62b-ef3368104f8e'::uuid, 2018064, 'TechTarget'),
    ('2c74abbe-e907-43a9-82be-6751ea0c9d60'::uuid, 932470, 'Telecom Argentina S.A.'),
    ('1578dfe7-8480-40ef-9339-13729b95a04c'::uuid, 96943, 'Teleflex'),
    ('ef109d38-7e8b-4612-a17b-e066e38592b7'::uuid, 1190723, 'Tenaris S.A.'),
    ('6ac8b247-41ad-46cc-96c2-441531cba199'::uuid, 70318, 'Tenet Healthcare'),
    ('b2929002-0c21-45f1-bc9d-5805832f0f30'::uuid, 97216, 'Terex'),
    ('ab5f7bd9-9e67-4125-a202-42995be17467'::uuid, 1342874, 'Ternium'),
    ('de956e7f-ad0e-4306-bc27-7493ceae213e'::uuid, 1390777, 'The Bank of New York Mellon Corporation'),
    ('4aadbf7c-dea5-45c6-a27e-e2aa58c818d3'::uuid, 21076, 'The Clorox Company'),
    ('f1637f00-e16b-4b3d-8848-2f0bc13e89ab'::uuid, 21344, 'The Coca-Cola Company'),
    ('de512bb5-1b76-4ed2-9b28-be753a137c85'::uuid, 2073913, 'The North West Company Inc.'),
    ('ccc765d7-7682-4375-8e8a-03b76e5bc864'::uuid, 1862461, 'The Real Brokerage'),
    ('e2fc418e-e6bd-42e0-a5d9-9e863fa98740'::uuid, 1583107, 'Theravance Biopharma'),
    ('db6cc338-dac6-47b3-b92c-c450237da720'::uuid, 1075124, 'Thomson Reuters'),
    ('7e07a5e3-2dfc-48cc-9be0-591a68fc562d'::uuid, 109198, 'TJX Companies'),
    ('4360821d-ee3d-4011-a0fc-c3a9bd43795f'::uuid, 1296484, 'TOP Ships'),
    ('9423568b-b714-4712-b00b-d3df657b3c86'::uuid, 2072098, 'Toromont Industries'),
    ('3d0f92ad-438b-4e93-bc4e-70435c683ae0'::uuid, 947263, 'Toronto-Dominion Bank'),
    ('caea5b7a-6514-4503-a4ba-20ce91b117f4'::uuid, 2071881, 'Tourmaline Oil'),
    ('1343ae1f-6dd7-4560-a550-eff5ff39e85e'::uuid, 2018139, 'Toyota Tsusho'),
    ('aca318ba-d3ca-4dd8-be52-f31e57025cfb'::uuid, 1133311, 'Travelzoo'),
    ('ac6365c2-9955-4504-bf49-a733efadfa83'::uuid, 1013880, 'TTEC'),
    ('489ba2a2-8ee9-48f9-8701-a1a2c0f93226'::uuid, 100493, 'Tyson Foods Inc.'),
    ('9246ed54-0562-43ca-9ce2-7050f70cc3e0'::uuid, 4457, 'U-Haul'),
    ('aa0ee2df-d4c9-489c-bc58-6c2bbe22f7f0'::uuid, 1901440, 'UL Solutions'),
    ('2cbacff6-1fbc-475d-8d1d-24c946ef998a'::uuid, 1590560, 'UniQure'),
    ('8269b20e-3b7c-4c70-9db8-ffc7f98eccc5'::uuid, 102037, 'Universal'),
    ('5cf12072-1453-4b74-b255-8194abcc811a'::uuid, 1890126, 'Universal Music Group'),
    ('c8da1917-c5d9-4456-a0fc-b32aaff685ed'::uuid, 1647639, 'Upstart'),
    ('710be30a-b3d9-4fd9-b41c-d1f8e1ef8bb5'::uuid, 912615, 'URBAN OUTFITTERS'),
    ('0d909849-3e6e-47bd-afee-a148720e1882'::uuid, 1681622, 'Varex Imaging'),
    ('54e98259-ba14-4663-88de-24802a36e1a6'::uuid, 103145, 'Veeco Instruments'),
    ('b12bcf3d-bfb9-4155-b6f4-95ea20992567'::uuid, 1827635, 'Veradermics'),
    ('506e6c0d-694a-42ae-a05a-fcf08bbbdf9b'::uuid, 1526119, 'Verastem'),
    ('888c2878-2d15-46e3-8cd6-7931a97f8832'::uuid, 1014473, 'VeriSign'),
    ('ad2aeea8-f10f-4762-97d4-f600825c0882'::uuid, 1792044, 'Viatris'),
    ('c3795820-d180-47b7-9642-4c1f118f392e'::uuid, 2131322, 'Victory Giant Technology Huizhou Co.'),
    ('56d52735-3393-4b3a-ba6d-81f575cec5ab'::uuid, 1692819, 'Vistra'),
    ('c2d2e34e-5b18-4b1b-b7f5-4a2b0d41f901'::uuid, 1396009, 'Vulcan Materials'),
    ('b44a9095-121c-46de-b24e-1b9225b5f394'::uuid, 1319161, 'Warner Music Group'),
    ('4e279f36-4b1b-4385-a24e-36af8c9e2a76'::uuid, 1691303, 'Warrior Met Coal'),
    ('840c83e1-ebc5-423e-8614-c42a526301cf'::uuid, 105016, 'Watsco'),
    ('a1ad9acb-927e-42a7-8566-0c31c44eefbd'::uuid, 1603923, 'Weatherford International'),
    ('d39d3d5e-3846-4432-9f4a-841794887f77'::uuid, 30697, 'Wendy’s'),
    ('27390e0d-135f-45b3-8486-93d176923a46'::uuid, 105770, 'West Pharmaceutical Services'),
    ('a0f3ef56-c6d6-460c-8f0e-5b9279fc1c73'::uuid, 106532, 'Weyco Group'),
    ('aaf76c33-66e1-4cf6-903d-d8f87ca06026'::uuid, 107263, 'Williams Companies'),
    ('b4b095d3-8aae-4c81-a842-d1ddff0e0c47'::uuid, 719955, 'Williams-Sonoma'),
    ('eb1bb873-cdfe-4441-9f1a-dbac0c47eacc'::uuid, 908315, 'Winmark'),
    ('7dc0d636-c086-48c6-8487-0bbd1ac09ecc'::uuid, 1015328, 'Wintrust Financial'),
    ('58c02a3c-f0b0-46cd-bbbd-72e420bab7db'::uuid, 1501697, 'X4 Pharmaceuticals'),
    ('88acefca-3a00-41e7-a20d-5e7cc8e1e8c3'::uuid, 2097163, 'Xanadu Quantum Technologies Limited'),
    ('5a7c04b3-9907-4577-920f-a28ba256b579'::uuid, 1582313, 'Xenon Pharmaceuticals'),
    ('df7b5cd4-1ec0-4f1a-8185-c78bdb91df4a'::uuid, 1810997, 'XPENG'),
    ('6a4add19-053c-462f-8dba-b78f4ba1d559'::uuid, 1670592, 'Yeti Holdings'),
    ('560fd862-93e2-4ada-a5ed-b7f6ef056f19'::uuid, 2068427, 'Zealand Pharma'),
    ('73363984-b55e-4db4-95f7-a8308e30878b'::uuid, 1136869, 'Zimmer Biomet Holdings, Inc.'),
    ('bc33a0d3-6683-45d3-8b15-2529dc156ad5'::uuid, 1937653, 'Zymeworks')
)
SELECT cik, count(*) AS claimants FROM proposed GROUP BY cik HAVING count(*) > 1
UNION ALL
SELECT NULL::bigint, count(*) FROM (SELECT id FROM proposed GROUP BY id HAVING count(*) > 1) d;

-- ============================================================================
-- BLOCK 1 of 9. 50 rows.
-- ============================================================================
BEGIN;

-- Acadia Pharmaceuticals  ->  cik 1070494  SEC 'ACADIA PHARMACEUTICALS INC'  [sec_conformed]  tickers=['ACAD']
UPDATE companies SET sec_cik = 1070494
 WHERE id = '2a58a470-bc99-486e-a7ea-63c8d219200d'::uuid AND sec_cik IS NULL AND name = 'Acadia Pharmaceuticals';
-- Achieve Life Sciences  ->  cik 949858  SEC 'ACHIEVE LIFE SCIENCES, INC.'  [sec_conformed]  tickers=['ACHV']
UPDATE companies SET sec_cik = 949858
 WHERE id = 'b4cef861-b368-47de-9d6d-ecd7f0ede8d9'::uuid AND sec_cik IS NULL AND name = 'Achieve Life Sciences';
-- ACORN ENERGY  ->  cik 880984  SEC 'ACORN ENERGY, INC.'  [sec_conformed]  tickers=['ACFN']
UPDATE companies SET sec_cik = 880984
 WHERE id = '5438b02d-6846-43a2-b35c-6fcd8ab94502'::uuid AND sec_cik IS NULL AND name = 'ACORN ENERGY';
-- Adient  ->  cik 1670541  SEC 'Adient plc'  [sec_conformed]  tickers=['ADNT']
UPDATE companies SET sec_cik = 1670541
 WHERE id = '8e6c164e-7a79-4a02-8ba6-b557a68bc9f1'::uuid AND sec_cik IS NULL AND name = 'Adient';
-- AerCap  ->  cik 1378789  SEC 'AerCap Holdings N.V.'  [sec_conformed]  tickers=['AER']
UPDATE companies SET sec_cik = 1378789
 WHERE id = 'cf722bdd-d1ae-41db-b9ea-db48c3e0f179'::uuid AND sec_cik IS NULL AND name = 'AerCap';
-- AGI Inc  ->  cik 2081206  SEC 'AGI Inc'  [sec_conformed]  tickers=['AGBK']
UPDATE companies SET sec_cik = 2081206
 WHERE id = '65411a83-7119-4131-839d-2bdabe8f3765'::uuid AND sec_cik IS NULL AND name = 'AGI Inc';
-- Airbus  ->  cik 1378580  SEC 'Airbus SE/ADR'  [sec_conformed]  tickers=['EADSF']
UPDATE companies SET sec_cik = 1378580
 WHERE id = '0aa3eefa-43a0-449a-90bb-dee79f29bca0'::uuid AND sec_cik IS NULL AND name = 'Airbus';
-- Alerus Financial  ->  cik 903419  SEC 'ALERUS FINANCIAL CORP'  [sec_conformed]  tickers=['ALRS']
UPDATE companies SET sec_cik = 903419
 WHERE id = 'c20b5937-8f63-4e38-8449-3e77fa7f15f2'::uuid AND sec_cik IS NULL AND name = 'Alerus Financial';
-- Allegiant Travel  ->  cik 1362468  SEC 'Allegiant Travel CO'  [sec_conformed]  tickers=['ALGT']
UPDATE companies SET sec_cik = 1362468
 WHERE id = 'e0bcfde4-adca-45dc-8da2-95b03ccf9a15'::uuid AND sec_cik IS NULL AND name = 'Allegiant Travel';
-- Allstate Corp  ->  cik 899051  SEC 'ALLSTATE CORP'  [sec_conformed]  tickers=['ALL', 'ALL-PH', 'ALL-PB']
UPDATE companies SET sec_cik = 899051
 WHERE id = 'a6879886-641f-4613-b2a5-1090dab79fbc'::uuid AND sec_cik IS NULL AND name = 'Allstate Corp';
-- Ally Financial Inc.  ->  cik 40729  SEC 'Ally Financial Inc.'  [sec_conformed]  tickers=['ALLY']
UPDATE companies SET sec_cik = 40729
 WHERE id = 'eacc432f-08bf-42e4-8ed7-306d874791e7'::uuid AND sec_cik IS NULL AND name = 'Ally Financial Inc.';
-- Alnylam Pharmaceuticals  ->  cik 1178670  SEC 'ALNYLAM PHARMACEUTICALS, INC.'  [sec_conformed]  tickers=['ALNY']
UPDATE companies SET sec_cik = 1178670
 WHERE id = 'e9a408fe-a9e3-4433-bc52-37301421128f'::uuid AND sec_cik IS NULL AND name = 'Alnylam Pharmaceuticals';
-- Aluminum Corporation of China  ->  cik 1161611  SEC 'ALUMINUM CORP OF CHINA LTD'  [sec_conformed]  tickers=['ALMMF']
UPDATE companies SET sec_cik = 1161611
 WHERE id = '9d904e24-05fb-4f5d-b377-d8bbf2d6be7f'::uuid AND sec_cik IS NULL AND name = 'Aluminum Corporation of China';
-- AMC Entertainment Holdings Inc.  ->  cik 1411579  SEC 'AMC ENTERTAINMENT HOLDINGS, INC.'  [sec_conformed]  tickers=['AMC']
UPDATE companies SET sec_cik = 1411579
 WHERE id = '8c7179a8-46f2-4b4b-af3a-75170f4b3000'::uuid AND sec_cik IS NULL AND name = 'AMC Entertainment Holdings Inc.';
-- American Tower  ->  cik 1053507  SEC 'AMERICAN TOWER CORP /MA/'  [sec_conformed]  tickers=['AMT']
UPDATE companies SET sec_cik = 1053507
 WHERE id = '03c6c452-2fdb-4cd2-8499-a82e08424d14'::uuid AND sec_cik IS NULL AND name = 'American Tower';
-- Ameriprise Financial  ->  cik 820027  SEC 'AMERIPRISE FINANCIAL INC'  [sec_conformed]  tickers=['AMP']
UPDATE companies SET sec_cik = 820027
 WHERE id = 'ced30870-5ae6-45d9-bd7c-97d6d201dd08'::uuid AND sec_cik IS NULL AND name = 'Ameriprise Financial';
-- AmeriServ Financial  ->  cik 707605  SEC 'AMERISERV FINANCIAL INC /PA/'  [sec_conformed]  tickers=['ASRV']
UPDATE companies SET sec_cik = 707605
 WHERE id = '11be8abb-4b04-460d-a269-6ceae9675e26'::uuid AND sec_cik IS NULL AND name = 'AmeriServ Financial';
-- Ampco Pittsburgh  ->  cik 6176  SEC 'AMPCO PITTSBURGH CORP'  [sec_conformed]  tickers=['AP']
UPDATE companies SET sec_cik = 6176
 WHERE id = '26e931c5-7070-4e9f-b794-37c87fcd1132'::uuid AND sec_cik IS NULL AND name = 'Ampco Pittsburgh';
-- AnaptysBio  ->  cik 1370053  SEC 'ANAPTYSBIO, INC'  [sec_conformed]  tickers=['ANAB']
UPDATE companies SET sec_cik = 1370053
 WHERE id = '4f9096a5-0ac4-4d94-8d62-c93cd7c76230'::uuid AND sec_cik IS NULL AND name = 'AnaptysBio';
-- Anglogold Ashanti PLC  ->  cik 1973832  SEC 'AngloGold Ashanti PLC'  [sec_conformed]  tickers=['AU']
UPDATE companies SET sec_cik = 1973832
 WHERE id = '604bcbc4-7b4e-4bd4-9d3d-b6b82a1ae799'::uuid AND sec_cik IS NULL AND name = 'Anglogold Ashanti PLC';
-- ANI Pharmaceuticals  ->  cik 1023024  SEC 'ANI PHARMACEUTICALS INC'  [sec_conformed]  tickers=['ANIP']
UPDATE companies SET sec_cik = 1023024
 WHERE id = '7f679826-d4a2-4c1f-98f4-bccac200d7f8'::uuid AND sec_cik IS NULL AND name = 'ANI Pharmaceuticals';
-- Apartment Investment and Management Company  ->  cik 922864  SEC 'APARTMENT INVESTMENT & MANAGEMENT CO'  [sec_conformed]  tickers=['AIV']
UPDATE companies SET sec_cik = 922864
 WHERE id = '5b364ffc-53ae-4bf0-9d62-ee036014f007'::uuid AND sec_cik IS NULL AND name = 'Apartment Investment and Management Company';
-- AppFolio  ->  cik 1433195  SEC 'APPFOLIO INC'  [sec_conformed]  tickers=['APPF']
UPDATE companies SET sec_cik = 1433195
 WHERE id = '67fe6bfe-dd92-4f9a-a682-6147dcbf76c5'::uuid AND sec_cik IS NULL AND name = 'AppFolio';
-- ArcBest  ->  cik 894405  SEC 'ARCBEST CORP /TX/'  [sec_conformed]  tickers=['ARCB']
UPDATE companies SET sec_cik = 894405
 WHERE id = '8bb2eb81-0107-4fc6-a262-6ef9e8cbf9e6'::uuid AND sec_cik IS NULL AND name = 'ArcBest';
-- Arch Capital  ->  cik 947484  SEC 'ARCH CAPITAL GROUP LTD.'  [sec_conformed]  tickers=['ACGL', 'ACGLN', 'ACGLO']
UPDATE companies SET sec_cik = 947484
 WHERE id = '5857f776-6e7f-4ccc-b3db-fe1cf495a10f'::uuid AND sec_cik IS NULL AND name = 'Arch Capital';
-- Arcturus Therapeutics  ->  cik 1768224  SEC 'Arcturus Therapeutics Holdings Inc.'  [sec_conformed]  tickers=['ARCT']
UPDATE companies SET sec_cik = 1768224
 WHERE id = '41877900-bc2a-4956-b00e-6682dfd13010'::uuid AND sec_cik IS NULL AND name = 'Arcturus Therapeutics';
-- Argenx  ->  cik 1697862  SEC 'ARGENX SE'  [sec_conformed]  tickers=['ARGX']
UPDATE companies SET sec_cik = 1697862
 WHERE id = 'c0d02715-0160-4f5b-aed2-9e99c948533d'::uuid AND sec_cik IS NULL AND name = 'Argenx';
-- Array Technologies  ->  cik 1820721  SEC 'Array Technologies, Inc.'  [sec_conformed]  tickers=['ARRY']
UPDATE companies SET sec_cik = 1820721
 WHERE id = '9be6d7d7-cde5-4e35-82e0-ec8c01c9f59a'::uuid AND sec_cik IS NULL AND name = 'Array Technologies';
-- Arrowhead Pharmaceuticals  ->  cik 879407  SEC 'ARROWHEAD PHARMACEUTICALS, INC.'  [sec_conformed]  tickers=['ARWR']
UPDATE companies SET sec_cik = 879407
 WHERE id = '8305b8db-0109-4764-82e2-b1735f147d52'::uuid AND sec_cik IS NULL AND name = 'Arrowhead Pharmaceuticals';
-- Aspen Aerogels  ->  cik 1145986  SEC 'ASPEN AEROGELS INC'  [sec_conformed]  tickers=['ASPN']
UPDATE companies SET sec_cik = 1145986
 WHERE id = '62a9d930-9870-4eab-a252-0af0598e3922'::uuid AND sec_cik IS NULL AND name = 'Aspen Aerogels';
-- Aspen Group  ->  cik 1487198  SEC 'ASPEN GROUP, INC.'  [sec_conformed]  tickers=['ASPU']
UPDATE companies SET sec_cik = 1487198
 WHERE id = '1c13f3a3-0fb5-4d31-bf36-0e3345b26f1e'::uuid AND sec_cik IS NULL AND name = 'Aspen Group';
-- Associated Banc Corp  ->  cik 7789  SEC 'ASSOCIATED BANC-CORP'  [sec_conformed]  tickers=['ASB', 'ASBA', 'ASB-PE']
UPDATE companies SET sec_cik = 7789
 WHERE id = '7afc3f04-45ac-4c72-9c20-5c012f142585'::uuid AND sec_cik IS NULL AND name = 'Associated Banc Corp';
-- AstraZeneca  ->  cik 901832  SEC 'ASTRAZENECA PLC'  [sec_conformed]  tickers=['AZN']
UPDATE companies SET sec_cik = 901832
 WHERE id = '7eddba76-5180-45fa-b250-acdb1e9724e0'::uuid AND sec_cik IS NULL AND name = 'AstraZeneca';
-- AtaiBeckley  ->  cik 2081043  SEC 'AtaiBeckley Inc.'  [sec_conformed]  tickers=['ATAI']
UPDATE companies SET sec_cik = 2081043
 WHERE id = '7b6a76f1-4d2a-452a-922f-caf34aced299'::uuid AND sec_cik IS NULL AND name = 'AtaiBeckley';
-- Atomera  ->  cik 1420520  SEC 'Atomera Inc'  [sec_conformed]  tickers=['ATOM']
UPDATE companies SET sec_cik = 1420520
 WHERE id = 'be3cf448-1d4f-4ff8-9c6b-9572be264e92'::uuid AND sec_cik IS NULL AND name = 'Atomera';
-- Aurora Cannabis  ->  cik 1683541  SEC 'AURORA CANNABIS INC'  [sec_conformed]  tickers=['ACB']
UPDATE companies SET sec_cik = 1683541
 WHERE id = 'a0a53d11-3c7d-4460-a56f-c951d0a241ce'::uuid AND sec_cik IS NULL AND name = 'Aurora Cannabis';
-- AutoNation  ->  cik 350698  SEC 'AUTONATION, INC.'  [sec_conformed]  tickers=['AN']
UPDATE companies SET sec_cik = 350698
 WHERE id = 'b6568c8f-7204-4730-98d2-ca1865271c05'::uuid AND sec_cik IS NULL AND name = 'AutoNation';
-- AXIS Capital  ->  cik 1214816  SEC 'AXIS CAPITAL HOLDINGS LTD'  [sec_conformed]  tickers=['AXS', 'AXS-PE']
UPDATE companies SET sec_cik = 1214816
 WHERE id = '1a0f8c2a-c3ad-4021-8909-d0a6e9582b7d'::uuid AND sec_cik IS NULL AND name = 'AXIS Capital';
-- Axon Enterprise  ->  cik 1069183  SEC 'AXON ENTERPRISE, INC.'  [sec_conformed]  tickers=['AXON']
UPDATE companies SET sec_cik = 1069183
 WHERE id = 'b99a0836-986d-4d3d-8084-1d18883a3824'::uuid AND sec_cik IS NULL AND name = 'Axon Enterprise';
-- Azenta  ->  cik 933974  SEC 'Azenta, Inc.'  [sec_conformed]  tickers=['AZTA']
UPDATE companies SET sec_cik = 933974
 WHERE id = '3433936b-26f9-46e9-818f-c5f6559894d5'::uuid AND sec_cik IS NULL AND name = 'Azenta';
-- B&G Foods  ->  cik 1278027  SEC 'B&G Foods, Inc.'  [sec_conformed]  tickers=['BGS']
UPDATE companies SET sec_cik = 1278027
 WHERE id = '85e6fd49-e02d-4396-9bbc-0cd987afb2f8'::uuid AND sec_cik IS NULL AND name = 'B&G Foods';
-- B2Gold Corp  ->  cik 1429937  SEC 'B2GOLD CORP'  [sec_conformed]  tickers=['BTG']
UPDATE companies SET sec_cik = 1429937
 WHERE id = 'd4365507-3258-480b-9be0-cdbf8275d2e9'::uuid AND sec_cik IS NULL AND name = 'B2Gold Corp';
-- Ballard Power Systems  ->  cik 1453015  SEC 'Ballard Power Systems Inc.'  [sec_conformed]  tickers=['BLDP']
UPDATE companies SET sec_cik = 1453015
 WHERE id = '6edec227-596d-4c1b-b7f3-ec7e3d7051f1'::uuid AND sec_cik IS NULL AND name = 'Ballard Power Systems';
-- Bally's  ->  cik 1747079  SEC "Bally's Corp"  [sec_conformed]  tickers=['BALY']
UPDATE companies SET sec_cik = 1747079
 WHERE id = '7bbb4ea0-4af7-47ef-a9e1-11ab5329a7ca'::uuid AND sec_cik IS NULL AND name = 'Bally''s';
-- Baltic Classifieds  ->  cik 2127862  SEC 'BALTIC CLASSIFIEDS GROUP PLC/ADR'  [sec_conformed]  tickers=['BCLGY']
UPDATE companies SET sec_cik = 2127862
 WHERE id = 'a935203d-63a8-494e-9c18-17eb6d50ad56'::uuid AND sec_cik IS NULL AND name = 'Baltic Classifieds';
-- Banco Bilbao Vizcaya Argentaria  ->  cik 842180  SEC 'BANCO BILBAO VIZCAYA ARGENTARIA, S.A.'  [sec_conformed]  tickers=['BBVA', 'BBVXF']
UPDATE companies SET sec_cik = 842180
 WHERE id = '2a271e31-7c35-4dae-bce1-5d735b363f22'::uuid AND sec_cik IS NULL AND name = 'Banco Bilbao Vizcaya Argentaria';
-- Banco Santander S.A.  ->  cik 891478  SEC 'Banco Santander, S.A.'  [sec_conformed]  tickers=['SAN', 'BCDRF']
UPDATE companies SET sec_cik = 891478
 WHERE id = '4ebbeefa-b82f-4f25-8308-54dcc6b6fc27'::uuid AND sec_cik IS NULL AND name = 'Banco Santander S.A.';
-- BankUnited  ->  cik 1504008  SEC 'BankUnited, Inc.'  [sec_conformed]  tickers=['BKU']
UPDATE companies SET sec_cik = 1504008
 WHERE id = 'e4d3e5f2-0e92-4972-89ef-38806d09994a'::uuid AND sec_cik IS NULL AND name = 'BankUnited';
-- BBB Foods  ->  cik 1978954  SEC 'BBB FOODS INC'  [sec_conformed]  tickers=['TBBB']
UPDATE companies SET sec_cik = 1978954
 WHERE id = '45f3f08f-5196-4ed9-9316-70a1c9c0966d'::uuid AND sec_cik IS NULL AND name = 'BBB Foods';
-- Beazer Homes USA  ->  cik 915840  SEC 'BEAZER HOMES USA INC'  [sec_conformed]  tickers=['BZH']
UPDATE companies SET sec_cik = 915840
 WHERE id = '408c99f3-9688-44fb-96f5-8588eef53c65'::uuid AND sec_cik IS NULL AND name = 'Beazer Homes USA';

-- READ-BACK for block 1. Raises, and therefore rolls the whole block back,
-- if fewer than 50 of these rows now carry their intended CIK.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM companies c
  JOIN (VALUES
    ('2a58a470-bc99-486e-a7ea-63c8d219200d'::uuid, 1070494),
    ('b4cef861-b368-47de-9d6d-ecd7f0ede8d9'::uuid, 949858),
    ('5438b02d-6846-43a2-b35c-6fcd8ab94502'::uuid, 880984),
    ('8e6c164e-7a79-4a02-8ba6-b557a68bc9f1'::uuid, 1670541),
    ('cf722bdd-d1ae-41db-b9ea-db48c3e0f179'::uuid, 1378789),
    ('65411a83-7119-4131-839d-2bdabe8f3765'::uuid, 2081206),
    ('0aa3eefa-43a0-449a-90bb-dee79f29bca0'::uuid, 1378580),
    ('c20b5937-8f63-4e38-8449-3e77fa7f15f2'::uuid, 903419),
    ('e0bcfde4-adca-45dc-8da2-95b03ccf9a15'::uuid, 1362468),
    ('a6879886-641f-4613-b2a5-1090dab79fbc'::uuid, 899051),
    ('eacc432f-08bf-42e4-8ed7-306d874791e7'::uuid, 40729),
    ('e9a408fe-a9e3-4433-bc52-37301421128f'::uuid, 1178670),
    ('9d904e24-05fb-4f5d-b377-d8bbf2d6be7f'::uuid, 1161611),
    ('8c7179a8-46f2-4b4b-af3a-75170f4b3000'::uuid, 1411579),
    ('03c6c452-2fdb-4cd2-8499-a82e08424d14'::uuid, 1053507),
    ('ced30870-5ae6-45d9-bd7c-97d6d201dd08'::uuid, 820027),
    ('11be8abb-4b04-460d-a269-6ceae9675e26'::uuid, 707605),
    ('26e931c5-7070-4e9f-b794-37c87fcd1132'::uuid, 6176),
    ('4f9096a5-0ac4-4d94-8d62-c93cd7c76230'::uuid, 1370053),
    ('604bcbc4-7b4e-4bd4-9d3d-b6b82a1ae799'::uuid, 1973832),
    ('7f679826-d4a2-4c1f-98f4-bccac200d7f8'::uuid, 1023024),
    ('5b364ffc-53ae-4bf0-9d62-ee036014f007'::uuid, 922864),
    ('67fe6bfe-dd92-4f9a-a682-6147dcbf76c5'::uuid, 1433195),
    ('8bb2eb81-0107-4fc6-a262-6ef9e8cbf9e6'::uuid, 894405),
    ('5857f776-6e7f-4ccc-b3db-fe1cf495a10f'::uuid, 947484),
    ('41877900-bc2a-4956-b00e-6682dfd13010'::uuid, 1768224),
    ('c0d02715-0160-4f5b-aed2-9e99c948533d'::uuid, 1697862),
    ('9be6d7d7-cde5-4e35-82e0-ec8c01c9f59a'::uuid, 1820721),
    ('8305b8db-0109-4764-82e2-b1735f147d52'::uuid, 879407),
    ('62a9d930-9870-4eab-a252-0af0598e3922'::uuid, 1145986),
    ('1c13f3a3-0fb5-4d31-bf36-0e3345b26f1e'::uuid, 1487198),
    ('7afc3f04-45ac-4c72-9c20-5c012f142585'::uuid, 7789),
    ('7eddba76-5180-45fa-b250-acdb1e9724e0'::uuid, 901832),
    ('7b6a76f1-4d2a-452a-922f-caf34aced299'::uuid, 2081043),
    ('be3cf448-1d4f-4ff8-9c6b-9572be264e92'::uuid, 1420520),
    ('a0a53d11-3c7d-4460-a56f-c951d0a241ce'::uuid, 1683541),
    ('b6568c8f-7204-4730-98d2-ca1865271c05'::uuid, 350698),
    ('1a0f8c2a-c3ad-4021-8909-d0a6e9582b7d'::uuid, 1214816),
    ('b99a0836-986d-4d3d-8084-1d18883a3824'::uuid, 1069183),
    ('3433936b-26f9-46e9-818f-c5f6559894d5'::uuid, 933974),
    ('85e6fd49-e02d-4396-9bbc-0cd987afb2f8'::uuid, 1278027),
    ('d4365507-3258-480b-9be0-cdbf8275d2e9'::uuid, 1429937),
    ('6edec227-596d-4c1b-b7f3-ec7e3d7051f1'::uuid, 1453015),
    ('7bbb4ea0-4af7-47ef-a9e1-11ab5329a7ca'::uuid, 1747079),
    ('a935203d-63a8-494e-9c18-17eb6d50ad56'::uuid, 2127862),
    ('2a271e31-7c35-4dae-bce1-5d735b363f22'::uuid, 842180),
    ('4ebbeefa-b82f-4f25-8308-54dcc6b6fc27'::uuid, 891478),
    ('e4d3e5f2-0e92-4972-89ef-38806d09994a'::uuid, 1504008),
    ('45f3f08f-5196-4ed9-9316-70a1c9c0966d'::uuid, 1978954),
    ('408c99f3-9688-44fb-96f5-8588eef53c65'::uuid, 915840)
  ) AS w(id, cik) ON w.id = c.id AND c.sec_cik = w.cik;
  IF n <> 50 THEN
    RAISE EXCEPTION 'block 1 read-back failed: expected 50 stamped rows, got %', n;
  END IF;
END $$;

COMMIT;   -- to abandon block 1 instead, replace this line with: ROLLBACK;

-- ============================================================================
-- BLOCK 2 of 9. 50 rows.
-- ============================================================================
BEGIN;

-- Bio-Techne  ->  cik 842023  SEC 'BIO-TECHNE Corp'  [sec_conformed]  tickers=['TECH']
UPDATE companies SET sec_cik = 842023
 WHERE id = '0f715b45-0554-490b-b6a6-fa852e096171'::uuid AND sec_cik IS NULL AND name = 'Bio-Techne';
-- BioLife Solutions, Inc.  ->  cik 834365  SEC 'BIOLIFE SOLUTIONS INC'  [sec_conformed]  tickers=['BLFS']
UPDATE companies SET sec_cik = 834365
 WHERE id = 'd018f0b8-b794-4f24-b7f0-7914a5d90f21'::uuid AND sec_cik IS NULL AND name = 'BioLife Solutions, Inc.';
-- BioLineRx  ->  cik 1498403  SEC 'BioLineRx Ltd.'  [sec_conformed]  tickers=['BLRX']
UPDATE companies SET sec_cik = 1498403
 WHERE id = '57196813-55d6-4867-a565-d7feb0482d85'::uuid AND sec_cik IS NULL AND name = 'BioLineRx';
-- BioNTech  ->  cik 1776985  SEC 'BioNTech SE'  [sec_conformed]  tickers=['BNTX']
UPDATE companies SET sec_cik = 1776985
 WHERE id = '8b2e0952-33d3-43c2-887b-3ba7d01f0cc6'::uuid AND sec_cik IS NULL AND name = 'BioNTech';
-- BioXcel Therapeutics  ->  cik 1720893  SEC 'BioXcel Therapeutics, Inc.'  [sec_conformed]  tickers=['BTAI']
UPDATE companies SET sec_cik = 1720893
 WHERE id = '1e061841-8579-425d-94be-c477bf31186f'::uuid AND sec_cik IS NULL AND name = 'BioXcel Therapeutics';
-- BKV  ->  cik 1838406  SEC 'BKV Corp'  [sec_conformed]  tickers=['BKV']
UPDATE companies SET sec_cik = 1838406
 WHERE id = '4386731c-9908-4a00-a553-c3e7a16f6098'::uuid AND sec_cik IS NULL AND name = 'BKV';
-- Black Hills Corporation  ->  cik 1130464  SEC 'BLACK HILLS CORP /SD/'  [sec_conformed]  tickers=['BKH']
UPDATE companies SET sec_cik = 1130464
 WHERE id = '7604e8be-0afd-4ecf-a771-e9f2d616f62f'::uuid AND sec_cik IS NULL AND name = 'Black Hills Corporation';
-- Blackberry  ->  cik 1070235  SEC 'BLACKBERRY Ltd'  [sec_conformed]  tickers=['BB']
UPDATE companies SET sec_cik = 1070235
 WHERE id = 'c3d8e115-4157-4163-b6dd-ff3e56a4e85e'::uuid AND sec_cik IS NULL AND name = 'Blackberry';
-- Bloomin' Brands  ->  cik 1546417  SEC "Bloomin' Brands, Inc."  [sec_conformed]  tickers=['BLMN']
UPDATE companies SET sec_cik = 1546417
 WHERE id = '69807bb4-f226-4aed-ad28-b59ca4a81a01'::uuid AND sec_cik IS NULL AND name = 'Bloomin'' Brands';
-- Blue Bird  ->  cik 1589526  SEC 'Blue Bird Corp'  [sec_conformed]  tickers=['BLBD']
UPDATE companies SET sec_cik = 1589526
 WHERE id = '6d94b7cc-f799-4e34-9b01-44c009d03742'::uuid AND sec_cik IS NULL AND name = 'Blue Bird';
-- BorgWarner  ->  cik 908255  SEC 'BORGWARNER INC'  [sec_conformed]  tickers=['BWA']
UPDATE companies SET sec_cik = 908255
 WHERE id = '6d173063-6932-4498-a0b8-9e8a54db4f34'::uuid AND sec_cik IS NULL AND name = 'BorgWarner';
-- Boston Beer  ->  cik 949870  SEC 'BOSTON BEER CO INC'  [sec_conformed]  tickers=['SAM']
UPDATE companies SET sec_cik = 949870
 WHERE id = '13db8ca4-862b-410f-9f2a-89659d8d10ff'::uuid AND sec_cik IS NULL AND name = 'Boston Beer';
-- BOXABL  ->  cik 1906364  SEC 'BOXABL Inc.'  [sec_conformed]  tickers=['BXBL', 'FGMC', 'FGMCU']
UPDATE companies SET sec_cik = 1906364
 WHERE id = 'bc4a41fc-c072-4129-bb80-a2e1d040ecc0'::uuid AND sec_cik IS NULL AND name = 'BOXABL';
-- Brainsway  ->  cik 1505065  SEC 'Brainsway Ltd.'  [sec_conformed]  tickers=['BWAY', 'BRSYF']
UPDATE companies SET sec_cik = 1505065
 WHERE id = 'd6b99d4f-acec-4407-b63e-1989445ddf1d'::uuid AND sec_cik IS NULL AND name = 'Brainsway';
-- Braskem S.A.  ->  cik 1071438  SEC 'BRASKEM SA'  [sec_conformed]  tickers=['BAK']
UPDATE companies SET sec_cik = 1071438
 WHERE id = '0d8b61d1-cd84-4fb0-a4e6-2f407af62aeb'::uuid AND sec_cik IS NULL AND name = 'Braskem S.A.';
-- Bristol Myers Squibb  ->  cik 14272  SEC 'BRISTOL MYERS SQUIBB CO'  [sec_conformed]  tickers=['BMY', 'CELG-RI']
UPDATE companies SET sec_cik = 14272
 WHERE id = '87704492-ceea-41b8-bd08-a17e6b00a4c5'::uuid AND sec_cik IS NULL AND name = 'Bristol Myers Squibb';
-- British American Tobacco p.l.c.  ->  cik 1303523  SEC 'British American Tobacco p.l.c.'  [sec_conformed]  tickers=['BTI', 'BTAFF']
UPDATE companies SET sec_cik = 1303523
 WHERE id = '61a1d805-f9fc-44e3-bd01-c71bf2545732'::uuid AND sec_cik IS NULL AND name = 'British American Tobacco p.l.c.';
-- Broadridge Financial Solutions  ->  cik 1383312  SEC 'BROADRIDGE FINANCIAL SOLUTIONS, INC.'  [sec_conformed]  tickers=['BR']
UPDATE companies SET sec_cik = 1383312
 WHERE id = 'db126811-2463-41ca-ac3d-8805c1387cd8'::uuid AND sec_cik IS NULL AND name = 'Broadridge Financial Solutions';
-- Brookfield Property Partners  ->  cik 1545772  SEC 'Brookfield Property Partners L.P.'  [sec_conformed]  tickers=['BPYPP', 'BPYPM', 'BPYPN']
UPDATE companies SET sec_cik = 1545772
 WHERE id = 'e620a5b4-c091-4e23-850a-792e6910af2f'::uuid AND sec_cik IS NULL AND name = 'Brookfield Property Partners';
-- Bruker  ->  cik 1109354  SEC 'BRUKER CORP'  [sec_conformed]  tickers=['BRKR', 'BRKRP']
UPDATE companies SET sec_cik = 1109354
 WHERE id = '7055f3c9-93b8-45b2-b0ce-0aa15650178b'::uuid AND sec_cik IS NULL AND name = 'Bruker';
-- Burford Capital  ->  cik 1714174  SEC 'Burford Capital Ltd'  [sec_conformed]  tickers=['BUR']
UPDATE companies SET sec_cik = 1714174
 WHERE id = '82a76ce5-df3d-4664-b652-9bf750fec8a8'::uuid AND sec_cik IS NULL AND name = 'Burford Capital';
-- BYD Electronic (International)  ->  cik 1447956  SEC 'BYD Electronic (International) Co Ltd'  [sec_conformed]  tickers=['BYDIF']
UPDATE companies SET sec_cik = 1447956
 WHERE id = '0dae6c3d-4610-4821-9fcc-cf058e5a270e'::uuid AND sec_cik IS NULL AND name = 'BYD Electronic (International)';
-- C.H. Robinson Worldwide  ->  cik 1043277  SEC 'C. H. ROBINSON WORLDWIDE, INC.'  [sec_conformed]  tickers=['CHRW']
UPDATE companies SET sec_cik = 1043277
 WHERE id = '749c8929-b72e-45c6-9cfa-238b7b521b90'::uuid AND sec_cik IS NULL AND name = 'C.H. Robinson Worldwide';
-- Cable One  ->  cik 1632127  SEC 'Cable One, Inc.'  [sec_conformed]  tickers=['CABO']
UPDATE companies SET sec_cik = 1632127
 WHERE id = '466f0460-a200-4da1-960f-838b30bea464'::uuid AND sec_cik IS NULL AND name = 'Cable One';
-- Cadence Design Systems  ->  cik 813672  SEC 'CADENCE DESIGN SYSTEMS INC'  [sec_conformed]  tickers=['CDNS']
UPDATE companies SET sec_cik = 813672
 WHERE id = '1351ce5e-91b1-41c8-b76e-be8686bdd107'::uuid AND sec_cik IS NULL AND name = 'Cadence Design Systems';
-- California Water Service Group  ->  cik 1035201  SEC 'CALIFORNIA WATER SERVICE GROUP'  [sec_conformed]  tickers=['CWT']
UPDATE companies SET sec_cik = 1035201
 WHERE id = '485dfec5-87ee-4da4-9dfb-3a44433bc66e'::uuid AND sec_cik IS NULL AND name = 'California Water Service Group';
-- Cantor Equity Partners III, Inc.  ->  cik 2034268  SEC 'Cantor Equity Partners III, Inc.'  [sec_conformed]  tickers=['CAEP']
UPDATE companies SET sec_cik = 2034268
 WHERE id = 'a04e9040-2814-4717-bc7e-d6d13437f9d1'::uuid AND sec_cik IS NULL AND name = 'Cantor Equity Partners III, Inc.';
-- Capital One Financial Corporation  ->  cik 927628  SEC 'CAPITAL ONE FINANCIAL CORP'  [sec_conformed]  tickers=['COF', 'COF-PI', 'COF-PJ']
UPDATE companies SET sec_cik = 927628
 WHERE id = '21a8ab80-ff0b-4cdd-9c4d-d64fd88f1f27'::uuid AND sec_cik IS NULL AND name = 'Capital One Financial Corporation';
-- Capri Holdings  ->  cik 1530721  SEC 'Capri Holdings Ltd'  [sec_conformed]  tickers=['CPRI']
UPDATE companies SET sec_cik = 1530721
 WHERE id = '16949daa-fdd5-447f-a4dc-e2d5ec705d06'::uuid AND sec_cik IS NULL AND name = 'Capri Holdings';
-- Caris Life Sciences  ->  cik 2019410  SEC 'Caris Life Sciences, Inc.'  [sec_conformed]  tickers=['CAI']
UPDATE companies SET sec_cik = 2019410
 WHERE id = '0a1e8fd1-d63f-4f39-984a-874ec53c4a67'::uuid AND sec_cik IS NULL AND name = 'Caris Life Sciences';
-- Castle Biosciences  ->  cik 1447362  SEC 'CASTLE BIOSCIENCES INC'  [sec_conformed]  tickers=['CSTL']
UPDATE companies SET sec_cik = 1447362
 WHERE id = 'c843342d-ed2f-4d72-98ef-9a1b7e35d0e7'::uuid AND sec_cik IS NULL AND name = 'Castle Biosciences';
-- CBRE Group  ->  cik 1138118  SEC 'CBRE GROUP, INC.'  [sec_conformed]  tickers=['CBRE']
UPDATE companies SET sec_cik = 1138118
 WHERE id = 'dc7027d5-5b4d-4e27-80d4-8fe3c6bbb5b1'::uuid AND sec_cik IS NULL AND name = 'CBRE Group';
-- Century Aluminum  ->  cik 949157  SEC 'CENTURY ALUMINUM CO'  [sec_conformed]  tickers=['CENX']
UPDATE companies SET sec_cik = 949157
 WHERE id = '47e507c3-45f2-47ca-a54d-bd4640fbafef'::uuid AND sec_cik IS NULL AND name = 'Century Aluminum';
-- CF Industries  ->  cik 1324404  SEC 'CF Industries Holdings, Inc.'  [sec_conformed]  tickers=['CF']
UPDATE companies SET sec_cik = 1324404
 WHERE id = 'a0e35816-7939-4d7e-98f6-67240695af86'::uuid AND sec_cik IS NULL AND name = 'CF Industries';
-- Church & Dwight Co., Inc.  ->  cik 313927  SEC 'CHURCH & DWIGHT CO INC /DE/'  [sec_conformed]  tickers=['CHD']
UPDATE companies SET sec_cik = 313927
 WHERE id = 'e3ec17dc-b62f-43ca-9570-2b9afe9ae108'::uuid AND sec_cik IS NULL AND name = 'Church & Dwight Co., Inc.';
-- Citizens Financial Group Inc.  ->  cik 759944  SEC 'CITIZENS FINANCIAL GROUP INC/RI'  [sec_conformed]  tickers=['CFG', 'CFG-PE', 'CFG-PH']
UPDATE companies SET sec_cik = 759944
 WHERE id = '8259c117-812c-401d-9bf4-3f890736b52a'::uuid AND sec_cik IS NULL AND name = 'Citizens Financial Group Inc.';
-- Clearwater Paper  ->  cik 1441236  SEC 'Clearwater Paper Corp'  [sec_conformed]  tickers=['CLW']
UPDATE companies SET sec_cik = 1441236
 WHERE id = 'cfe37bed-12ea-461f-abb8-9c76a485fa34'::uuid AND sec_cik IS NULL AND name = 'Clearwater Paper';
-- CN Energy  ->  cik 1780785  SEC 'CN ENERGY GROUP. INC.'  [sec_conformed]  tickers=['CNEY']
UPDATE companies SET sec_cik = 1780785
 WHERE id = '4dc5f266-d9ed-4c73-b17e-f5cb7e14fbb6'::uuid AND sec_cik IS NULL AND name = 'CN Energy';
-- CNX Resources  ->  cik 1070412  SEC 'CNX Resources Corp'  [sec_conformed]  tickers=['CNX']
UPDATE companies SET sec_cik = 1070412
 WHERE id = 'b6972604-6cc8-4fb2-85c9-c8626686eb65'::uuid AND sec_cik IS NULL AND name = 'CNX Resources';
-- Cohen & Steers  ->  cik 1284812  SEC 'COHEN & STEERS, INC.'  [sec_conformed]  tickers=['CNS']
UPDATE companies SET sec_cik = 1284812
 WHERE id = '90335c06-e540-4386-a6e1-e221fc702af4'::uuid AND sec_cik IS NULL AND name = 'Cohen & Steers';
-- Columbia Banking System  ->  cik 887343  SEC 'COLUMBIA BANKING SYSTEM, INC.'  [sec_conformed]  tickers=['COLB']
UPDATE companies SET sec_cik = 887343
 WHERE id = 'f91be27f-1533-4712-a3c9-4ecf2919f670'::uuid AND sec_cik IS NULL AND name = 'Columbia Banking System';
-- Columbia Sportswear Company  ->  cik 1050797  SEC 'COLUMBIA SPORTSWEAR CO'  [sec_conformed]  tickers=['COLM']
UPDATE companies SET sec_cik = 1050797
 WHERE id = '606f91a7-ff8e-42f7-8177-0127820e2742'::uuid AND sec_cik IS NULL AND name = 'Columbia Sportswear Company';
-- Compagnie de Saint Gobain  ->  cik 1012037  SEC 'COMPAGNIE DE SAINT GOBAIN'  [sec_conformed]  tickers=['CODGF']
UPDATE companies SET sec_cik = 1012037
 WHERE id = 'e65ef23e-3fc9-4c22-aae4-09b33b8a037d'::uuid AND sec_cik IS NULL AND name = 'Compagnie de Saint Gobain';
-- Compass  ->  cik 1563190  SEC 'Compass, Inc.'  [sec_conformed]  tickers=['COMP']
UPDATE companies SET sec_cik = 1563190
 WHERE id = '6edc94ff-93bf-4d41-81aa-84b1eac1445b'::uuid AND sec_cik IS NULL AND name = 'Compass';
-- Compugen  ->  cik 1119774  SEC 'COMPUGEN LTD'  [sec_conformed]  tickers=['CGEN']
UPDATE companies SET sec_cik = 1119774
 WHERE id = '48f47aa5-df9a-4dc3-abb4-7bb318050545'::uuid AND sec_cik IS NULL AND name = 'Compugen';
-- CONMED  ->  cik 816956  SEC 'CONMED Corp'  [sec_conformed]  tickers=['CNMD']
UPDATE companies SET sec_cik = 816956
 WHERE id = 'c43c607f-7100-44ff-a4e4-587b68abedab'::uuid AND sec_cik IS NULL AND name = 'CONMED';
-- Contemporary Amperex Technology Co. Ltd.  ->  cik 2070829  SEC 'Contemporary Amperex Technology Co., Limited/ADR'  [sec_conformed]  tickers=['CYATY']
UPDATE companies SET sec_cik = 2070829
 WHERE id = '5188f910-7190-4dc2-a477-1d6f5a49d12c'::uuid AND sec_cik IS NULL AND name = 'Contemporary Amperex Technology Co. Ltd.';
-- ContextLogic  ->  cik 2064307  SEC 'ContextLogic Holdings Inc.'  [sec_conformed]  tickers=['LOGC']
UPDATE companies SET sec_cik = 2064307
 WHERE id = '30c2fc6a-b24e-4f17-b183-adbdefa20ebd'::uuid AND sec_cik IS NULL AND name = 'ContextLogic';
-- Corcept Therapeutics  ->  cik 1088856  SEC 'CORCEPT THERAPEUTICS INC'  [sec_conformed]  tickers=['CORT']
UPDATE companies SET sec_cik = 1088856
 WHERE id = '25264ff1-f9cd-4a1b-ae1c-256f220839df'::uuid AND sec_cik IS NULL AND name = 'Corcept Therapeutics';
-- Core Molding Technologies  ->  cik 1026655  SEC 'CORE MOLDING TECHNOLOGIES INC'  [sec_conformed]  tickers=['CMT']
UPDATE companies SET sec_cik = 1026655
 WHERE id = '28118241-4373-4e29-90bb-bce83ca02c27'::uuid AND sec_cik IS NULL AND name = 'Core Molding Technologies';

-- READ-BACK for block 2. Raises, and therefore rolls the whole block back,
-- if fewer than 50 of these rows now carry their intended CIK.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM companies c
  JOIN (VALUES
    ('0f715b45-0554-490b-b6a6-fa852e096171'::uuid, 842023),
    ('d018f0b8-b794-4f24-b7f0-7914a5d90f21'::uuid, 834365),
    ('57196813-55d6-4867-a565-d7feb0482d85'::uuid, 1498403),
    ('8b2e0952-33d3-43c2-887b-3ba7d01f0cc6'::uuid, 1776985),
    ('1e061841-8579-425d-94be-c477bf31186f'::uuid, 1720893),
    ('4386731c-9908-4a00-a553-c3e7a16f6098'::uuid, 1838406),
    ('7604e8be-0afd-4ecf-a771-e9f2d616f62f'::uuid, 1130464),
    ('c3d8e115-4157-4163-b6dd-ff3e56a4e85e'::uuid, 1070235),
    ('69807bb4-f226-4aed-ad28-b59ca4a81a01'::uuid, 1546417),
    ('6d94b7cc-f799-4e34-9b01-44c009d03742'::uuid, 1589526),
    ('6d173063-6932-4498-a0b8-9e8a54db4f34'::uuid, 908255),
    ('13db8ca4-862b-410f-9f2a-89659d8d10ff'::uuid, 949870),
    ('bc4a41fc-c072-4129-bb80-a2e1d040ecc0'::uuid, 1906364),
    ('d6b99d4f-acec-4407-b63e-1989445ddf1d'::uuid, 1505065),
    ('0d8b61d1-cd84-4fb0-a4e6-2f407af62aeb'::uuid, 1071438),
    ('87704492-ceea-41b8-bd08-a17e6b00a4c5'::uuid, 14272),
    ('61a1d805-f9fc-44e3-bd01-c71bf2545732'::uuid, 1303523),
    ('db126811-2463-41ca-ac3d-8805c1387cd8'::uuid, 1383312),
    ('e620a5b4-c091-4e23-850a-792e6910af2f'::uuid, 1545772),
    ('7055f3c9-93b8-45b2-b0ce-0aa15650178b'::uuid, 1109354),
    ('82a76ce5-df3d-4664-b652-9bf750fec8a8'::uuid, 1714174),
    ('0dae6c3d-4610-4821-9fcc-cf058e5a270e'::uuid, 1447956),
    ('749c8929-b72e-45c6-9cfa-238b7b521b90'::uuid, 1043277),
    ('466f0460-a200-4da1-960f-838b30bea464'::uuid, 1632127),
    ('1351ce5e-91b1-41c8-b76e-be8686bdd107'::uuid, 813672),
    ('485dfec5-87ee-4da4-9dfb-3a44433bc66e'::uuid, 1035201),
    ('a04e9040-2814-4717-bc7e-d6d13437f9d1'::uuid, 2034268),
    ('21a8ab80-ff0b-4cdd-9c4d-d64fd88f1f27'::uuid, 927628),
    ('16949daa-fdd5-447f-a4dc-e2d5ec705d06'::uuid, 1530721),
    ('0a1e8fd1-d63f-4f39-984a-874ec53c4a67'::uuid, 2019410),
    ('c843342d-ed2f-4d72-98ef-9a1b7e35d0e7'::uuid, 1447362),
    ('dc7027d5-5b4d-4e27-80d4-8fe3c6bbb5b1'::uuid, 1138118),
    ('47e507c3-45f2-47ca-a54d-bd4640fbafef'::uuid, 949157),
    ('a0e35816-7939-4d7e-98f6-67240695af86'::uuid, 1324404),
    ('e3ec17dc-b62f-43ca-9570-2b9afe9ae108'::uuid, 313927),
    ('8259c117-812c-401d-9bf4-3f890736b52a'::uuid, 759944),
    ('cfe37bed-12ea-461f-abb8-9c76a485fa34'::uuid, 1441236),
    ('4dc5f266-d9ed-4c73-b17e-f5cb7e14fbb6'::uuid, 1780785),
    ('b6972604-6cc8-4fb2-85c9-c8626686eb65'::uuid, 1070412),
    ('90335c06-e540-4386-a6e1-e221fc702af4'::uuid, 1284812),
    ('f91be27f-1533-4712-a3c9-4ecf2919f670'::uuid, 887343),
    ('606f91a7-ff8e-42f7-8177-0127820e2742'::uuid, 1050797),
    ('e65ef23e-3fc9-4c22-aae4-09b33b8a037d'::uuid, 1012037),
    ('6edc94ff-93bf-4d41-81aa-84b1eac1445b'::uuid, 1563190),
    ('48f47aa5-df9a-4dc3-abb4-7bb318050545'::uuid, 1119774),
    ('c43c607f-7100-44ff-a4e4-587b68abedab'::uuid, 816956),
    ('5188f910-7190-4dc2-a477-1d6f5a49d12c'::uuid, 2070829),
    ('30c2fc6a-b24e-4f17-b183-adbdefa20ebd'::uuid, 2064307),
    ('25264ff1-f9cd-4a1b-ae1c-256f220839df'::uuid, 1088856),
    ('28118241-4373-4e29-90bb-bce83ca02c27'::uuid, 1026655)
  ) AS w(id, cik) ON w.id = c.id AND c.sec_cik = w.cik;
  IF n <> 50 THEN
    RAISE EXCEPTION 'block 2 read-back failed: expected 50 stamped rows, got %', n;
  END IF;
END $$;

COMMIT;   -- to abandon block 2 instead, replace this line with: ROLLBACK;

-- ============================================================================
-- BLOCK 3 of 9. 50 rows.
-- ============================================================================
BEGIN;

-- CoreCivic  ->  cik 1070985  SEC 'CoreCivic, Inc.'  [sec_conformed]  tickers=['CXW']
UPDATE companies SET sec_cik = 1070985
 WHERE id = 'd1efc560-47fc-4975-a647-e7335b985808'::uuid AND sec_cik IS NULL AND name = 'CoreCivic';
-- Corsair Gaming  ->  cik 1743759  SEC 'Corsair Gaming, Inc.'  [sec_conformed]  tickers=['CRSR']
UPDATE companies SET sec_cik = 1743759
 WHERE id = '51dbf790-fbff-4983-a5a8-2a782908a96f'::uuid AND sec_cik IS NULL AND name = 'Corsair Gaming';
-- Corteva  ->  cik 1755672  SEC 'Corteva, Inc.'  [sec_conformed]  tickers=['CTVA']
UPDATE companies SET sec_cik = 1755672
 WHERE id = '04fbd49d-c88b-4f5f-bf5c-c85bc61d49da'::uuid AND sec_cik IS NULL AND name = 'Corteva';
-- Cresco Labs  ->  cik 1832928  SEC 'Cresco Labs Inc.'  [sec_conformed]  tickers=['CRLBF']
UPDATE companies SET sec_cik = 1832928
 WHERE id = 'dd023a0e-6519-4be0-8e38-2dea1719beb2'::uuid AND sec_cik IS NULL AND name = 'Cresco Labs';
-- Criteo  ->  cik 1576427  SEC 'Criteo S.A.'  [sec_conformed]  tickers=['CRTO']
UPDATE companies SET sec_cik = 1576427
 WHERE id = 'bb10d95d-b556-4f4e-8497-cf9055680698'::uuid AND sec_cik IS NULL AND name = 'Criteo';
-- Crocs  ->  cik 1334036  SEC 'Crocs, Inc.'  [sec_conformed]  tickers=['CROX']
UPDATE companies SET sec_cik = 1334036
 WHERE id = 'f667818a-cf94-436b-9186-401d10e760f8'::uuid AND sec_cik IS NULL AND name = 'Crocs';
-- CubeSmart  ->  cik 1298675  SEC 'CubeSmart'  [sec_conformed]  tickers=['CUBE']
UPDATE companies SET sec_cik = 1298675
 WHERE id = '7be9b55d-672f-4f04-b9dd-20bbf658443d'::uuid AND sec_cik IS NULL AND name = 'CubeSmart';
-- Cummins  ->  cik 26172  SEC 'CUMMINS INC'  [sec_conformed]  tickers=['CMI']
UPDATE companies SET sec_cik = 26172
 WHERE id = 'ed9be63c-145b-4053-b17b-ca190ed3bc6a'::uuid AND sec_cik IS NULL AND name = 'Cummins';
-- CVS Health Corp  ->  cik 64803  SEC 'CVS HEALTH Corp'  [sec_conformed]  tickers=['CVS']
UPDATE companies SET sec_cik = 64803
 WHERE id = '71a7fe83-49bf-4d0b-8ed8-45a70df462db'::uuid AND sec_cik IS NULL AND name = 'CVS Health Corp';
-- DCC  ->  cik 1437712  SEC 'DCC plc'  [sec_conformed]  tickers=['DCCPY', 'DCCPF']
UPDATE companies SET sec_cik = 1437712
 WHERE id = '841c9245-87ba-4e3b-aa97-6647dc20e809'::uuid AND sec_cik IS NULL AND name = 'DCC';
-- Delek US  ->  cik 1694426  SEC 'Delek US Holdings, Inc.'  [sec_conformed]  tickers=['DK']
UPDATE companies SET sec_cik = 1694426
 WHERE id = '45eb2fc8-7d89-4cfa-a9eb-d07096e0c094'::uuid AND sec_cik IS NULL AND name = 'Delek US';
-- Descartes Systems Group  ->  cik 1050140  SEC 'DESCARTES SYSTEMS GROUP INC'  [sec_conformed]  tickers=['DSGX']
UPDATE companies SET sec_cik = 1050140
 WHERE id = '21bcc70f-d820-4078-96d3-61d6de6fa278'::uuid AND sec_cik IS NULL AND name = 'Descartes Systems Group';
-- Destination XL Group  ->  cik 813298  SEC 'DESTINATION XL GROUP, INC.'  [sec_conformed]  tickers=['DXLG']
UPDATE companies SET sec_cik = 813298
 WHERE id = '1b03011e-cbdf-4a96-9ba0-c9e014242a7c'::uuid AND sec_cik IS NULL AND name = 'Destination XL Group';
-- Deutsche Lufthansa  ->  cik 1049724  SEC 'DEUTSCHE LUFTHANSA A G                                  /FI'  [sec_conformed]  tickers=['DLAKY', 'DLAKF']
UPDATE companies SET sec_cik = 1049724
 WHERE id = 'e043e420-71e9-4fc6-b7e7-5895871b2461'::uuid AND sec_cik IS NULL AND name = 'Deutsche Lufthansa';
-- Diamond Hill Investment Group  ->  cik 909108  SEC 'DIAMOND HILL INVESTMENT GROUP INC'  [sec_conformed]  tickers=['DHIL']
UPDATE companies SET sec_cik = 909108
 WHERE id = 'dd43b9e8-4b7c-4ae4-a614-381498d2bb3a'::uuid AND sec_cik IS NULL AND name = 'Diamond Hill Investment Group';
-- Digital Turbine  ->  cik 317788  SEC 'Digital Turbine, Inc.'  [sec_conformed]  tickers=['APPS']
UPDATE companies SET sec_cik = 317788
 WHERE id = 'c545478f-97f0-4caa-8b8e-fe54f485e7c6'::uuid AND sec_cik IS NULL AND name = 'Digital Turbine';
-- DOLE plc  ->  cik 1857475  SEC 'Dole plc'  [sec_conformed]  tickers=['DOLE']
UPDATE companies SET sec_cik = 1857475
 WHERE id = 'caddae6f-a848-4ba9-afe4-05f92a6cd160'::uuid AND sec_cik IS NULL AND name = 'DOLE plc';
-- Dover Corporation  ->  cik 29905  SEC 'DOVER Corp'  [sec_conformed]  tickers=['DOV']
UPDATE companies SET sec_cik = 29905
 WHERE id = 'caa17d5f-c70c-419a-9911-57fddef60ef0'::uuid AND sec_cik IS NULL AND name = 'Dover Corporation';
-- DPC Dash  ->  cik 2094201  SEC 'DPC DASH LTD/ADR'  [sec_conformed]  tickers=['DPDSY', 'DPCDF']
UPDATE companies SET sec_cik = 2094201
 WHERE id = '4eb72ca4-b744-42b2-893c-dfc870875e89'::uuid AND sec_cik IS NULL AND name = 'DPC Dash';
-- Driven Brands Holdings Inc.  ->  cik 1804745  SEC 'Driven Brands Holdings Inc.'  [sec_conformed]  tickers=['DRVN']
UPDATE companies SET sec_cik = 1804745
 WHERE id = '4621237c-d855-43ab-aec7-ee20857201dd'::uuid AND sec_cik IS NULL AND name = 'Driven Brands Holdings Inc.';
-- E.ON  ->  cik 1136808  SEC 'E.ON SE'  [sec_conformed]  tickers=['EONGY', 'ENAKF']
UPDATE companies SET sec_cik = 1136808
 WHERE id = '9a0d2558-4eca-491e-bf21-51e2fe8b1c68'::uuid AND sec_cik IS NULL AND name = 'E.ON';
-- Eastman Kodak  ->  cik 31235  SEC 'EASTMAN KODAK CO'  [sec_conformed]  tickers=['KODK']
UPDATE companies SET sec_cik = 31235
 WHERE id = '858682c6-deef-4af1-b24a-4c31b173b4f1'::uuid AND sec_cik IS NULL AND name = 'Eastman Kodak';
-- Element Solutions  ->  cik 1590714  SEC 'Element Solutions Inc'  [sec_conformed]  tickers=['ESI']
UPDATE companies SET sec_cik = 1590714
 WHERE id = 'c7a6c9b2-7ef5-4180-b3e9-6c7ebcdeb295'::uuid AND sec_cik IS NULL AND name = 'Element Solutions';
-- Embracer Group  ->  cik 1969796  SEC 'Embracer Group AB/ADR'  [sec_conformed]  tickers=['EBCRY', 'THQQF']
UPDATE companies SET sec_cik = 1969796
 WHERE id = 'caac6b49-210c-4cb5-9061-845deb2dbe07'::uuid AND sec_cik IS NULL AND name = 'Embracer Group';
-- Emera Incorporated  ->  cik 1127248  SEC 'EMERA INC'  [sec_conformed]  tickers=['EMA', 'ERRAF', 'EMICF']
UPDATE companies SET sec_cik = 1127248
 WHERE id = '8eda13dc-89ae-4f52-a0b3-ee21064422c9'::uuid AND sec_cik IS NULL AND name = 'Emera Incorporated';
-- Emerson Electric Company  ->  cik 32604  SEC 'EMERSON ELECTRIC CO'  [sec_conformed]  tickers=['EMR']
UPDATE companies SET sec_cik = 32604
 WHERE id = 'd8ee941c-e236-4133-a5fe-ff0e76f3cdbc'::uuid AND sec_cik IS NULL AND name = 'Emerson Electric Company';
-- Encore Capital Group  ->  cik 1084961  SEC 'ENCORE CAPITAL GROUP INC'  [sec_conformed]  tickers=['ECPG']
UPDATE companies SET sec_cik = 1084961
 WHERE id = '40e49de8-2a57-4c76-bff1-ef16e3588f94'::uuid AND sec_cik IS NULL AND name = 'Encore Capital Group';
-- Equinor ASA  ->  cik 1140625  SEC 'EQUINOR ASA'  [sec_conformed]  tickers=['EQNR', 'STOHF']
UPDATE companies SET sec_cik = 1140625
 WHERE id = '60fa4a41-06c7-4752-a245-92be85c767d5'::uuid AND sec_cik IS NULL AND name = 'Equinor ASA';
-- Equitable Holdings Inc.  ->  cik 1333986  SEC 'Equitable Holdings, Inc.'  [sec_conformed]  tickers=['EQH', 'EQH-PA', 'EQH-PC']
UPDATE companies SET sec_cik = 1333986
 WHERE id = '4cd9bc95-6364-45af-9b84-24a54c443974'::uuid AND sec_cik IS NULL AND name = 'Equitable Holdings Inc.';
-- Esperion Therapeutics  ->  cik 1434868  SEC 'Esperion Therapeutics, Inc.'  [sec_conformed]  tickers=['ESPR']
UPDATE companies SET sec_cik = 1434868
 WHERE id = '015e1dd9-ae0a-4b85-94f6-a660aaacd9c9'::uuid AND sec_cik IS NULL AND name = 'Esperion Therapeutics';
-- Evotec  ->  cik 1412558  SEC 'Evotec SE'  [sec_conformed]  tickers=['EVO', 'EVOTF']
UPDATE companies SET sec_cik = 1412558
 WHERE id = 'f5315772-f5a1-470e-b24f-785fa7eb16bb'::uuid AND sec_cik IS NULL AND name = 'Evotec';
-- Exelixis  ->  cik 939767  SEC 'EXELIXIS, INC.'  [sec_conformed]  tickers=['EXEL']
UPDATE companies SET sec_cik = 939767
 WHERE id = 'a18f0c30-365d-46f5-824a-0c8cb0b29fbd'::uuid AND sec_cik IS NULL AND name = 'Exelixis';
-- Exelon  ->  cik 1109357  SEC 'EXELON CORP'  [sec_conformed]  tickers=['EXC']
UPDATE companies SET sec_cik = 1109357
 WHERE id = 'ca369570-dc51-4e1d-b667-d6d8bfa395dc'::uuid AND sec_cik IS NULL AND name = 'Exelon';
-- ExxonMobil  ->  cik 2115436  SEC 'ExxonMobil Holdings Corp'  [sec_conformed]  tickers=['XOM']
UPDATE companies SET sec_cik = 2115436
 WHERE id = 'ab4bcf16-d848-43a8-9020-5d012a812f89'::uuid AND sec_cik IS NULL AND name = 'ExxonMobil';
-- Fair Isaac Corporation  ->  cik 814547  SEC 'FAIR ISAAC CORP'  [sec_conformed]  tickers=['FICO']
UPDATE companies SET sec_cik = 814547
 WHERE id = 'fe990a20-893f-4dcf-a8c7-1a6a21be947d'::uuid AND sec_cik IS NULL AND name = 'Fair Isaac Corporation';
-- Fairfax Financial  ->  cik 915191  SEC 'FAIRFAX FINANCIAL HOLDINGS LTD/ CAN'  [sec_conformed]  tickers=['FRFHF', 'FRFFF']
UPDATE companies SET sec_cik = 915191
 WHERE id = '199fcbf8-8e70-4f22-b6bf-fa3f77a49700'::uuid AND sec_cik IS NULL AND name = 'Fairfax Financial';
-- Federal Signal  ->  cik 277509  SEC 'FEDERAL SIGNAL CORP /DE/'  [sec_conformed]  tickers=['FSS']
UPDATE companies SET sec_cik = 277509
 WHERE id = 'd987372c-3f3b-4a12-a2d6-cd8f4670dbba'::uuid AND sec_cik IS NULL AND name = 'Federal Signal';
-- Ferrari  ->  cik 1648416  SEC 'Ferrari N.V.'  [sec_conformed]  tickers=['RACE']
UPDATE companies SET sec_cik = 1648416
 WHERE id = '4eb3bd64-92e8-4472-8c22-88d25ca50ab5'::uuid AND sec_cik IS NULL AND name = 'Ferrari';
-- Ferrovial  ->  cik 1468522  SEC 'Ferrovial N.V.'  [sec_conformed]  tickers=['FER']
UPDATE companies SET sec_cik = 1468522
 WHERE id = 'c1061f2e-f29a-4e8f-aba9-4b5e67eda0ec'::uuid AND sec_cik IS NULL AND name = 'Ferrovial';
-- Fidelity D & D Bancorp  ->  cik 1098151  SEC 'FIDELITY D & D BANCORP INC'  [sec_conformed]  tickers=['FDBC']
UPDATE companies SET sec_cik = 1098151
 WHERE id = '196af0c4-0323-455c-8f57-679fd6d94afa'::uuid AND sec_cik IS NULL AND name = 'Fidelity D & D Bancorp';
-- Fidelity National Financial Inc.  ->  cik 1331875  SEC 'Fidelity National Financial, Inc.'  [sec_conformed]  tickers=['FNF']
UPDATE companies SET sec_cik = 1331875
 WHERE id = '177f5877-34f7-4382-acdf-58b16c887c2a'::uuid AND sec_cik IS NULL AND name = 'Fidelity National Financial Inc.';
-- Finning International  ->  cik 2073638  SEC 'Finning International Inc./ADR'  [sec_conformed]  tickers=['FNIGY', 'FINGF']
UPDATE companies SET sec_cik = 2073638
 WHERE id = 'b8f22e06-b870-4ab5-b3b6-22ded57daf9b'::uuid AND sec_cik IS NULL AND name = 'Finning International';
-- First Bank & Trust  ->  cik 1746109  SEC 'Bank First Corp'  [sec_conformed]  tickers=['BFC']
UPDATE companies SET sec_cik = 1746109
 WHERE id = '209f2f09-cb25-4e1d-8590-5056fd301b5d'::uuid AND sec_cik IS NULL AND name = 'First Bank & Trust';
-- First Interstate Bancsystem  ->  cik 860413  SEC 'FIRST INTERSTATE BANCSYSTEM INC'  [sec_conformed]  tickers=['FIBK']
UPDATE companies SET sec_cik = 860413
 WHERE id = 'aefb7b8b-8bba-4d85-bd4a-48cc095f38fb'::uuid AND sec_cik IS NULL AND name = 'First Interstate Bancsystem';
-- Fortis  ->  cik 1666175  SEC 'Fortis Inc.'  [sec_conformed]  tickers=['FTS', 'FINCF', 'FORFF']
UPDATE companies SET sec_cik = 1666175
 WHERE id = '718ec183-7678-4518-8d01-3cbd92c15b31'::uuid AND sec_cik IS NULL AND name = 'Fortis';
-- Fortitude Gold  ->  cik 1828377  SEC 'Fortitude Gold Corp'  [sec_conformed]  tickers=['FTCO']
UPDATE companies SET sec_cik = 1828377
 WHERE id = '0f3b28b6-c3a5-4d29-954e-1f04d0606231'::uuid AND sec_cik IS NULL AND name = 'Fortitude Gold';
-- Forvia  ->  cik 1559444  SEC 'FORVIA SE/ADR'  [sec_conformed]  tickers=['FURCF']
UPDATE companies SET sec_cik = 1559444
 WHERE id = '441b3816-6813-472c-bbac-8238aefd8d2c'::uuid AND sec_cik IS NULL AND name = 'Forvia';
-- Franco Nevada  ->  cik 1456346  SEC 'FRANCO NEVADA Corp'  [sec_conformed]  tickers=['FNV']
UPDATE companies SET sec_cik = 1456346
 WHERE id = 'dc5198b0-c198-44a2-95e9-8e9e1a704d4c'::uuid AND sec_cik IS NULL AND name = 'Franco Nevada';
-- FreightCar America  ->  cik 1320854  SEC 'FreightCar America, Inc.'  [sec_conformed]  tickers=['RAIL']
UPDATE companies SET sec_cik = 1320854
 WHERE id = 'e3e97199-9214-4f8f-8288-195d66ee36a4'::uuid AND sec_cik IS NULL AND name = 'FreightCar America';
-- FTI Consulting  ->  cik 887936  SEC 'FTI CONSULTING, INC'  [sec_conformed]  tickers=['FCN']
UPDATE companies SET sec_cik = 887936
 WHERE id = '86418122-85a6-4f9a-a6d1-6e7dab5684fd'::uuid AND sec_cik IS NULL AND name = 'FTI Consulting';

-- READ-BACK for block 3. Raises, and therefore rolls the whole block back,
-- if fewer than 50 of these rows now carry their intended CIK.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM companies c
  JOIN (VALUES
    ('d1efc560-47fc-4975-a647-e7335b985808'::uuid, 1070985),
    ('51dbf790-fbff-4983-a5a8-2a782908a96f'::uuid, 1743759),
    ('04fbd49d-c88b-4f5f-bf5c-c85bc61d49da'::uuid, 1755672),
    ('dd023a0e-6519-4be0-8e38-2dea1719beb2'::uuid, 1832928),
    ('bb10d95d-b556-4f4e-8497-cf9055680698'::uuid, 1576427),
    ('f667818a-cf94-436b-9186-401d10e760f8'::uuid, 1334036),
    ('7be9b55d-672f-4f04-b9dd-20bbf658443d'::uuid, 1298675),
    ('ed9be63c-145b-4053-b17b-ca190ed3bc6a'::uuid, 26172),
    ('71a7fe83-49bf-4d0b-8ed8-45a70df462db'::uuid, 64803),
    ('841c9245-87ba-4e3b-aa97-6647dc20e809'::uuid, 1437712),
    ('45eb2fc8-7d89-4cfa-a9eb-d07096e0c094'::uuid, 1694426),
    ('21bcc70f-d820-4078-96d3-61d6de6fa278'::uuid, 1050140),
    ('1b03011e-cbdf-4a96-9ba0-c9e014242a7c'::uuid, 813298),
    ('e043e420-71e9-4fc6-b7e7-5895871b2461'::uuid, 1049724),
    ('dd43b9e8-4b7c-4ae4-a614-381498d2bb3a'::uuid, 909108),
    ('c545478f-97f0-4caa-8b8e-fe54f485e7c6'::uuid, 317788),
    ('caddae6f-a848-4ba9-afe4-05f92a6cd160'::uuid, 1857475),
    ('caa17d5f-c70c-419a-9911-57fddef60ef0'::uuid, 29905),
    ('4eb72ca4-b744-42b2-893c-dfc870875e89'::uuid, 2094201),
    ('4621237c-d855-43ab-aec7-ee20857201dd'::uuid, 1804745),
    ('9a0d2558-4eca-491e-bf21-51e2fe8b1c68'::uuid, 1136808),
    ('858682c6-deef-4af1-b24a-4c31b173b4f1'::uuid, 31235),
    ('c7a6c9b2-7ef5-4180-b3e9-6c7ebcdeb295'::uuid, 1590714),
    ('caac6b49-210c-4cb5-9061-845deb2dbe07'::uuid, 1969796),
    ('8eda13dc-89ae-4f52-a0b3-ee21064422c9'::uuid, 1127248),
    ('d8ee941c-e236-4133-a5fe-ff0e76f3cdbc'::uuid, 32604),
    ('40e49de8-2a57-4c76-bff1-ef16e3588f94'::uuid, 1084961),
    ('60fa4a41-06c7-4752-a245-92be85c767d5'::uuid, 1140625),
    ('4cd9bc95-6364-45af-9b84-24a54c443974'::uuid, 1333986),
    ('015e1dd9-ae0a-4b85-94f6-a660aaacd9c9'::uuid, 1434868),
    ('f5315772-f5a1-470e-b24f-785fa7eb16bb'::uuid, 1412558),
    ('a18f0c30-365d-46f5-824a-0c8cb0b29fbd'::uuid, 939767),
    ('ca369570-dc51-4e1d-b667-d6d8bfa395dc'::uuid, 1109357),
    ('ab4bcf16-d848-43a8-9020-5d012a812f89'::uuid, 2115436),
    ('fe990a20-893f-4dcf-a8c7-1a6a21be947d'::uuid, 814547),
    ('199fcbf8-8e70-4f22-b6bf-fa3f77a49700'::uuid, 915191),
    ('d987372c-3f3b-4a12-a2d6-cd8f4670dbba'::uuid, 277509),
    ('4eb3bd64-92e8-4472-8c22-88d25ca50ab5'::uuid, 1648416),
    ('c1061f2e-f29a-4e8f-aba9-4b5e67eda0ec'::uuid, 1468522),
    ('196af0c4-0323-455c-8f57-679fd6d94afa'::uuid, 1098151),
    ('177f5877-34f7-4382-acdf-58b16c887c2a'::uuid, 1331875),
    ('b8f22e06-b870-4ab5-b3b6-22ded57daf9b'::uuid, 2073638),
    ('209f2f09-cb25-4e1d-8590-5056fd301b5d'::uuid, 1746109),
    ('aefb7b8b-8bba-4d85-bd4a-48cc095f38fb'::uuid, 860413),
    ('718ec183-7678-4518-8d01-3cbd92c15b31'::uuid, 1666175),
    ('0f3b28b6-c3a5-4d29-954e-1f04d0606231'::uuid, 1828377),
    ('441b3816-6813-472c-bbac-8238aefd8d2c'::uuid, 1559444),
    ('dc5198b0-c198-44a2-95e9-8e9e1a704d4c'::uuid, 1456346),
    ('e3e97199-9214-4f8f-8288-195d66ee36a4'::uuid, 1320854),
    ('86418122-85a6-4f9a-a6d1-6e7dab5684fd'::uuid, 887936)
  ) AS w(id, cik) ON w.id = c.id AND c.sec_cik = w.cik;
  IF n <> 50 THEN
    RAISE EXCEPTION 'block 3 read-back failed: expected 50 stamped rows, got %', n;
  END IF;
END $$;

COMMIT;   -- to abandon block 3 instead, replace this line with: ROLLBACK;

-- ============================================================================
-- BLOCK 4 of 9. 50 rows.
-- ============================================================================
BEGIN;

-- Fulton Financial  ->  cik 700564  SEC 'FULTON FINANCIAL CORP'  [sec_conformed]  tickers=['FULT', 'FULTP']
UPDATE companies SET sec_cik = 700564
 WHERE id = '6f9742e0-2758-4c30-8eb9-4c69bbc8d9c8'::uuid AND sec_cik IS NULL AND name = 'Fulton Financial';
-- Funko  ->  cik 1704711  SEC 'Funko, Inc.'  [sec_conformed]  tickers=['FNKO']
UPDATE companies SET sec_cik = 1704711
 WHERE id = 'ed12e388-1d66-4745-b66e-f99e8786a824'::uuid AND sec_cik IS NULL AND name = 'Funko';
-- GE Vernova  ->  cik 1996810  SEC 'GE Vernova Inc.'  [sec_conformed]  tickers=['GEV']
UPDATE companies SET sec_cik = 1996810
 WHERE id = '67cda1e8-ae72-400f-86c9-5ebc0a776912'::uuid AND sec_cik IS NULL AND name = 'GE Vernova';
-- Geely Automobile Holdings Ltd.  ->  cik 1474968  SEC 'Geely Automobile Holdings Limited/ADR'  [sec_conformed]  tickers=['GELHY', 'GELYF']
UPDATE companies SET sec_cik = 1474968
 WHERE id = '85d2b0c6-7c32-48ae-8ff4-e0ac6da4be88'::uuid AND sec_cik IS NULL AND name = 'Geely Automobile Holdings Ltd.';
-- Gen Digital  ->  cik 849399  SEC 'Gen Digital Inc.'  [sec_conformed]  tickers=['GEN', 'GENVR']
UPDATE companies SET sec_cik = 849399
 WHERE id = 'b9bb6061-2ddb-469b-a157-0a1720198442'::uuid AND sec_cik IS NULL AND name = 'Gen Digital';
-- General Fusion  ->  cik 2074850  SEC 'General Fusion Group Ltd.'  [sec_conformed]  tickers=['GFUZ', 'GFUZW', 'SVAC']
UPDATE companies SET sec_cik = 2074850
 WHERE id = 'e3bf8db7-24fa-41b4-80c1-4da9dc0406c2'::uuid AND sec_cik IS NULL AND name = 'General Fusion';
-- Generate Biomedicines  ->  cik 2100782  SEC 'Generate Biomedicines, Inc.'  [sec_conformed]  tickers=['GENB']
UPDATE companies SET sec_cik = 2100782
 WHERE id = 'a3f9789c-ca15-4d19-9953-cbed40cc55b6'::uuid AND sec_cik IS NULL AND name = 'Generate Biomedicines';
-- Genesis Energy  ->  cik 1022321  SEC 'GENESIS ENERGY LP'  [sec_conformed]  tickers=['GEL']
UPDATE companies SET sec_cik = 1022321
 WHERE id = 'f240ef76-f7c6-46a0-96ef-edb5b51f4cbc'::uuid AND sec_cik IS NULL AND name = 'Genesis Energy';
-- Genmab  ->  cik 1434265  SEC 'GENMAB A/S'  [sec_conformed]  tickers=['GMAB', 'GNMSF']
UPDATE companies SET sec_cik = 1434265
 WHERE id = '40a542eb-c2a4-4152-8d45-eaedb15b73f7'::uuid AND sec_cik IS NULL AND name = 'Genmab';
-- Gentex Corporation  ->  cik 355811  SEC 'GENTEX CORP'  [sec_conformed]  tickers=['GNTX']
UPDATE companies SET sec_cik = 355811
 WHERE id = '59614a6e-dc78-4b4a-9ae4-c7d171b4d61e'::uuid AND sec_cik IS NULL AND name = 'Gentex Corporation';
-- Gentherm  ->  cik 903129  SEC 'Gentherm Inc'  [sec_conformed]  tickers=['THRM']
UPDATE companies SET sec_cik = 903129
 WHERE id = '5602b4fc-92d3-48f2-900d-f9e84f36f7e0'::uuid AND sec_cik IS NULL AND name = 'Gentherm';
-- Getty Images  ->  cik 1898496  SEC 'Getty Images Holdings, Inc.'  [sec_conformed]  tickers=['GETY']
UPDATE companies SET sec_cik = 1898496
 WHERE id = '2282debc-6c62-46b6-ad65-afea4e1696ef'::uuid AND sec_cik IS NULL AND name = 'Getty Images';
-- Gibson Energy  ->  cik 2071913  SEC 'Gibson Energy Inc/ADR'  [sec_conformed]  tickers=['GBNXY', 'GBNXF']
UPDATE companies SET sec_cik = 2071913
 WHERE id = '57855961-8b70-4379-a953-45a9e63a195d'::uuid AND sec_cik IS NULL AND name = 'Gibson Energy';
-- GigaCloud Technology  ->  cik 1857816  SEC 'GigaCloud Technology Inc'  [sec_conformed]  tickers=['GCT']
UPDATE companies SET sec_cik = 1857816
 WHERE id = '6b648f58-a4ab-4e2c-8174-1c801ff683c7'::uuid AND sec_cik IS NULL AND name = 'GigaCloud Technology';
-- Gilat Satellite Networks Ltd.  ->  cik 897322  SEC 'GILAT SATELLITE NETWORKS LTD'  [sec_conformed]  tickers=['GILT']
UPDATE companies SET sec_cik = 897322
 WHERE id = '5a0715d4-e258-4c18-8f0c-48577bcf67a0'::uuid AND sec_cik IS NULL AND name = 'Gilat Satellite Networks Ltd.';
-- Gilead Sciences  ->  cik 882095  SEC 'GILEAD SCIENCES, INC.'  [sec_conformed]  tickers=['GILD']
UPDATE companies SET sec_cik = 882095
 WHERE id = '95d22579-53d8-476f-83c4-5db780830a0d'::uuid AND sec_cik IS NULL AND name = 'Gilead Sciences';
-- Ginkgo Bioworks  ->  cik 1830214  SEC 'Ginkgo Bioworks Holdings, Inc.'  [sec_conformed]  tickers=['DNA', 'DNABW']
UPDATE companies SET sec_cik = 1830214
 WHERE id = 'd78c0ee4-31d9-4a09-80f7-d1d05012e9af'::uuid AND sec_cik IS NULL AND name = 'Ginkgo Bioworks';
-- GitLab  ->  cik 1653482  SEC 'Gitlab Inc.'  [sec_conformed]  tickers=['GTLB']
UPDATE companies SET sec_cik = 1653482
 WHERE id = 'e63a769b-fba8-4afc-9cca-833e7f15a16e'::uuid AND sec_cik IS NULL AND name = 'GitLab';
-- GoDaddy Inc.  ->  cik 1609711  SEC 'GoDaddy Inc.'  [sec_conformed]  tickers=['GDDY']
UPDATE companies SET sec_cik = 1609711
 WHERE id = '0111093a-fca9-462b-82a4-e3b3ffd68782'::uuid AND sec_cik IS NULL AND name = 'GoDaddy Inc.';
-- Gran Tierra Energy  ->  cik 1273441  SEC 'GRAN TIERRA ENERGY INC.'  [sec_conformed]  tickers=['GTE']
UPDATE companies SET sec_cik = 1273441
 WHERE id = 'c96ccd9f-7230-4558-9bb6-c7d46b9d801d'::uuid AND sec_cik IS NULL AND name = 'Gran Tierra Energy';
-- Grand Canyon Education  ->  cik 1434588  SEC 'Grand Canyon Education, Inc.'  [sec_conformed]  tickers=['LOPE']
UPDATE companies SET sec_cik = 1434588
 WHERE id = 'b6764f15-f0a4-4738-9c17-3d5b16a4186f'::uuid AND sec_cik IS NULL AND name = 'Grand Canyon Education';
-- Grocery Outlet Holding Corp.  ->  cik 1771515  SEC 'Grocery Outlet Holding Corp.'  [sec_conformed]  tickers=['GO']
UPDATE companies SET sec_cik = 1771515
 WHERE id = 'ac87b972-93e9-4419-b485-4d66034ff77f'::uuid AND sec_cik IS NULL AND name = 'Grocery Outlet Holding Corp.';
-- Grupo Televisa  ->  cik 912892  SEC 'GRUPO TELEVISA, S.A.B.'  [sec_conformed]  tickers=['TV', 'GRPFF']
UPDATE companies SET sec_cik = 912892
 WHERE id = '96bfc6d4-5679-44da-9539-3010d42b679e'::uuid AND sec_cik IS NULL AND name = 'Grupo Televisa';
-- Guardian Pharmacy Services  ->  cik 1802255  SEC 'Guardian Pharmacy Services, Inc.'  [sec_conformed]  tickers=['GRDN']
UPDATE companies SET sec_cik = 1802255
 WHERE id = 'd8487ec2-464b-4796-89f2-8cc345949e66'::uuid AND sec_cik IS NULL AND name = 'Guardian Pharmacy Services';
-- H World Group  ->  cik 1483994  SEC 'H World Group Ltd'  [sec_conformed]  tickers=['HTHT', 'HWLDF']
UPDATE companies SET sec_cik = 1483994
 WHERE id = 'aa9a72ba-b514-4df1-8d91-4a5b7e8aca0c'::uuid AND sec_cik IS NULL AND name = 'H World Group';
-- Hansoh Pharmaceutical  ->  cik 2073669  SEC 'Hansoh Pharmaceutical Group Co Limited/ADR'  [sec_conformed]  tickers=['HNPHY', 'HNSPF']
UPDATE companies SET sec_cik = 2073669
 WHERE id = 'f0c712ec-1f90-4197-ace8-bc028a12222e'::uuid AND sec_cik IS NULL AND name = 'Hansoh Pharmaceutical';
-- Harmony Biosciences  ->  cik 1802665  SEC 'Harmony Biosciences Holdings, Inc.'  [sec_conformed]  tickers=['HRMY']
UPDATE companies SET sec_cik = 1802665
 WHERE id = '91d049f5-e7bd-4942-8bbd-65f886c140a0'::uuid AND sec_cik IS NULL AND name = 'Harmony Biosciences';
-- HCA Healthcare  ->  cik 860730  SEC 'HCA Healthcare, Inc.'  [sec_conformed]  tickers=['HCA']
UPDATE companies SET sec_cik = 860730
 WHERE id = 'a55bc6e4-53a9-4a06-a425-b2a03e51a43a'::uuid AND sec_cik IS NULL AND name = 'HCA Healthcare';
-- HDFC Bank  ->  cik 1144967  SEC 'HDFC BANK LTD'  [sec_conformed]  tickers=['HDB']
UPDATE companies SET sec_cik = 1144967
 WHERE id = '9cb581e8-7d57-4946-8e4b-67114c3d96f7'::uuid AND sec_cik IS NULL AND name = 'HDFC Bank';
-- Hecla Mining  ->  cik 719413  SEC 'HECLA MINING CO/DE/'  [sec_conformed]  tickers=['HL', 'HL-PB']
UPDATE companies SET sec_cik = 719413
 WHERE id = '313699f7-165c-4a2e-ade1-bc1a2c0969d1'::uuid AND sec_cik IS NULL AND name = 'Hecla Mining';
-- HEICO  ->  cik 46619  SEC 'HEICO CORP'  [sec_conformed]  tickers=['HEI', 'HEI-A']
UPDATE companies SET sec_cik = 46619
 WHERE id = '8e0b0ff9-6c33-45ad-b714-017cf3782efd'::uuid AND sec_cik IS NULL AND name = 'HEICO';
-- Herc Holdings  ->  cik 1364479  SEC 'HERC HOLDINGS INC'  [sec_conformed]  tickers=['HRI']
UPDATE companies SET sec_cik = 1364479
 WHERE id = '8a873e47-d22a-4b9e-ae2f-f66290997969'::uuid AND sec_cik IS NULL AND name = 'Herc Holdings';
-- Hochschild Mining  ->  cik 1446962  SEC 'Hochschild Mining PLC'  [sec_conformed]  tickers=['HCHDF']
UPDATE companies SET sec_cik = 1446962
 WHERE id = 'bf3bba1a-a5b0-4d72-98fc-488a5bd315e4'::uuid AND sec_cik IS NULL AND name = 'Hochschild Mining';
-- Huntington Bancshares  ->  cik 49196  SEC 'HUNTINGTON BANCSHARES INC /MD/'  [sec_conformed]  tickers=['HBAN', 'HBANL', 'HBANM']
UPDATE companies SET sec_cik = 49196
 WHERE id = '7361687b-ee93-4cef-b71d-7bf76fc634ca'::uuid AND sec_cik IS NULL AND name = 'Huntington Bancshares';
-- Hycroft Mining  ->  cik 1718405  SEC 'HYCROFT MINING HOLDING CORP'  [sec_conformed]  tickers=['HYMC', 'HYMCW']
UPDATE companies SET sec_cik = 1718405
 WHERE id = 'ecbb4091-1b58-4c03-ab01-d6864ab9198f'::uuid AND sec_cik IS NULL AND name = 'Hycroft Mining';
-- Hyperliquid Strategies  ->  cik 2078856  SEC 'Hyperliquid Strategies Inc'  [sec_conformed]  tickers=['PURR']
UPDATE companies SET sec_cik = 2078856
 WHERE id = '6cb4bf0c-0588-4fd9-939e-457f8cd83d91'::uuid AND sec_cik IS NULL AND name = 'Hyperliquid Strategies';
-- Ibotta  ->  cik 1538379  SEC 'Ibotta, Inc.'  [sec_conformed]  tickers=['IBTA']
UPDATE companies SET sec_cik = 1538379
 WHERE id = '62d86dbf-975e-4b64-a427-7c1a852ea145'::uuid AND sec_cik IS NULL AND name = 'Ibotta';
-- ICICI Bank  ->  cik 1103838  SEC 'ICICI BANK LTD'  [sec_conformed]  tickers=['IBN']
UPDATE companies SET sec_cik = 1103838
 WHERE id = '0e7873d4-a0ab-47e9-814a-79657e8144e8'::uuid AND sec_cik IS NULL AND name = 'ICICI Bank';
-- IDP Education  ->  cik 2062803  SEC 'IDP Education Ltd./ADR'  [sec_conformed]  tickers=['IDPEY', 'IDPUF']
UPDATE companies SET sec_cik = 2062803
 WHERE id = '31596b3f-e083-482b-bd37-06448722449d'::uuid AND sec_cik IS NULL AND name = 'IDP Education';
-- Immuneering  ->  cik 1790340  SEC 'Immuneering Corp'  [sec_conformed]  tickers=['IMRX']
UPDATE companies SET sec_cik = 1790340
 WHERE id = '2d3070b2-2a26-4e52-ba3c-8e928a5856cc'::uuid AND sec_cik IS NULL AND name = 'Immuneering';
-- Infosys  ->  cik 1067491  SEC 'Infosys Ltd'  [sec_conformed]  tickers=['INFY']
UPDATE companies SET sec_cik = 1067491
 WHERE id = 'd2e7b7a3-6f08-4bf5-904b-dff22a8dca83'::uuid AND sec_cik IS NULL AND name = 'Infosys';
-- Innovent Biologics  ->  cik 1774163  SEC 'Innovent Biologics Inc/ADR'  [sec_conformed]  tickers=['IVBXF']
UPDATE companies SET sec_cik = 1774163
 WHERE id = 'b5b4dca8-d39e-455d-b75d-9ba7b796641f'::uuid AND sec_cik IS NULL AND name = 'Innovent Biologics';
-- Integer Holdings  ->  cik 1114483  SEC 'Integer Holdings Corp'  [sec_conformed]  tickers=['ITGR']
UPDATE companies SET sec_cik = 1114483
 WHERE id = '9040e46a-8d0a-4479-aa4f-4011a1aec014'::uuid AND sec_cik IS NULL AND name = 'Integer Holdings';
-- Integra LifeSciences  ->  cik 917520  SEC 'INTEGRA LIFESCIENCES HOLDINGS CORP'  [sec_conformed]  tickers=['IART']
UPDATE companies SET sec_cik = 917520
 WHERE id = '4f115e27-d51c-4760-a22d-18ebd9938102'::uuid AND sec_cik IS NULL AND name = 'Integra LifeSciences';
-- Intellia Therapeutics  ->  cik 1652130  SEC 'Intellia Therapeutics, Inc.'  [sec_conformed]  tickers=['NTLA']
UPDATE companies SET sec_cik = 1652130
 WHERE id = 'ab6b87f7-b5c0-4dc3-8c6c-72a6ff14d07f'::uuid AND sec_cik IS NULL AND name = 'Intellia Therapeutics';
-- InterDigital, Inc.  ->  cik 1405495  SEC 'InterDigital, Inc.'  [sec_conformed]  tickers=['IDCC']
UPDATE companies SET sec_cik = 1405495
 WHERE id = '45b9d2d7-5867-4af1-9788-d0ea2bf21313'::uuid AND sec_cik IS NULL AND name = 'InterDigital, Inc.';
-- Iovance Biotherapeutics  ->  cik 1425205  SEC 'IOVANCE BIOTHERAPEUTICS, INC.'  [sec_conformed]  tickers=['IOVA']
UPDATE companies SET sec_cik = 1425205
 WHERE id = 'dc99d8ab-018e-4142-bb8e-246dfc467cdd'::uuid AND sec_cik IS NULL AND name = 'Iovance Biotherapeutics';
-- Iron Mountain Incorporated  ->  cik 1020569  SEC 'IRON MOUNTAIN INC'  [sec_conformed]  tickers=['IRM']
UPDATE companies SET sec_cik = 1020569
 WHERE id = 'e70746fe-9049-4ed3-90c8-f857e3d94304'::uuid AND sec_cik IS NULL AND name = 'Iron Mountain Incorporated';
-- JAKKS Pacific  ->  cik 1009829  SEC 'JAKKS PACIFIC INC'  [sec_conformed]  tickers=['JAKK']
UPDATE companies SET sec_cik = 1009829
 WHERE id = '24377324-181e-4bc2-b9fa-2fb213150ced'::uuid AND sec_cik IS NULL AND name = 'JAKKS Pacific';
-- Japan exchange  ->  cik 1600520  SEC 'Japan Exchange Group, Inc./ADR'  [sec_conformed]  tickers=['OSCUF']
UPDATE companies SET sec_cik = 1600520
 WHERE id = '1d9382ae-04b4-4763-a005-7a55e1dd749b'::uuid AND sec_cik IS NULL AND name = 'Japan exchange';

-- READ-BACK for block 4. Raises, and therefore rolls the whole block back,
-- if fewer than 50 of these rows now carry their intended CIK.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM companies c
  JOIN (VALUES
    ('6f9742e0-2758-4c30-8eb9-4c69bbc8d9c8'::uuid, 700564),
    ('ed12e388-1d66-4745-b66e-f99e8786a824'::uuid, 1704711),
    ('67cda1e8-ae72-400f-86c9-5ebc0a776912'::uuid, 1996810),
    ('85d2b0c6-7c32-48ae-8ff4-e0ac6da4be88'::uuid, 1474968),
    ('b9bb6061-2ddb-469b-a157-0a1720198442'::uuid, 849399),
    ('e3bf8db7-24fa-41b4-80c1-4da9dc0406c2'::uuid, 2074850),
    ('a3f9789c-ca15-4d19-9953-cbed40cc55b6'::uuid, 2100782),
    ('f240ef76-f7c6-46a0-96ef-edb5b51f4cbc'::uuid, 1022321),
    ('40a542eb-c2a4-4152-8d45-eaedb15b73f7'::uuid, 1434265),
    ('59614a6e-dc78-4b4a-9ae4-c7d171b4d61e'::uuid, 355811),
    ('5602b4fc-92d3-48f2-900d-f9e84f36f7e0'::uuid, 903129),
    ('2282debc-6c62-46b6-ad65-afea4e1696ef'::uuid, 1898496),
    ('57855961-8b70-4379-a953-45a9e63a195d'::uuid, 2071913),
    ('6b648f58-a4ab-4e2c-8174-1c801ff683c7'::uuid, 1857816),
    ('5a0715d4-e258-4c18-8f0c-48577bcf67a0'::uuid, 897322),
    ('95d22579-53d8-476f-83c4-5db780830a0d'::uuid, 882095),
    ('d78c0ee4-31d9-4a09-80f7-d1d05012e9af'::uuid, 1830214),
    ('e63a769b-fba8-4afc-9cca-833e7f15a16e'::uuid, 1653482),
    ('0111093a-fca9-462b-82a4-e3b3ffd68782'::uuid, 1609711),
    ('c96ccd9f-7230-4558-9bb6-c7d46b9d801d'::uuid, 1273441),
    ('b6764f15-f0a4-4738-9c17-3d5b16a4186f'::uuid, 1434588),
    ('ac87b972-93e9-4419-b485-4d66034ff77f'::uuid, 1771515),
    ('96bfc6d4-5679-44da-9539-3010d42b679e'::uuid, 912892),
    ('d8487ec2-464b-4796-89f2-8cc345949e66'::uuid, 1802255),
    ('aa9a72ba-b514-4df1-8d91-4a5b7e8aca0c'::uuid, 1483994),
    ('f0c712ec-1f90-4197-ace8-bc028a12222e'::uuid, 2073669),
    ('91d049f5-e7bd-4942-8bbd-65f886c140a0'::uuid, 1802665),
    ('a55bc6e4-53a9-4a06-a425-b2a03e51a43a'::uuid, 860730),
    ('9cb581e8-7d57-4946-8e4b-67114c3d96f7'::uuid, 1144967),
    ('313699f7-165c-4a2e-ade1-bc1a2c0969d1'::uuid, 719413),
    ('8e0b0ff9-6c33-45ad-b714-017cf3782efd'::uuid, 46619),
    ('8a873e47-d22a-4b9e-ae2f-f66290997969'::uuid, 1364479),
    ('bf3bba1a-a5b0-4d72-98fc-488a5bd315e4'::uuid, 1446962),
    ('7361687b-ee93-4cef-b71d-7bf76fc634ca'::uuid, 49196),
    ('ecbb4091-1b58-4c03-ab01-d6864ab9198f'::uuid, 1718405),
    ('6cb4bf0c-0588-4fd9-939e-457f8cd83d91'::uuid, 2078856),
    ('62d86dbf-975e-4b64-a427-7c1a852ea145'::uuid, 1538379),
    ('0e7873d4-a0ab-47e9-814a-79657e8144e8'::uuid, 1103838),
    ('31596b3f-e083-482b-bd37-06448722449d'::uuid, 2062803),
    ('2d3070b2-2a26-4e52-ba3c-8e928a5856cc'::uuid, 1790340),
    ('d2e7b7a3-6f08-4bf5-904b-dff22a8dca83'::uuid, 1067491),
    ('b5b4dca8-d39e-455d-b75d-9ba7b796641f'::uuid, 1774163),
    ('9040e46a-8d0a-4479-aa4f-4011a1aec014'::uuid, 1114483),
    ('4f115e27-d51c-4760-a22d-18ebd9938102'::uuid, 917520),
    ('ab6b87f7-b5c0-4dc3-8c6c-72a6ff14d07f'::uuid, 1652130),
    ('45b9d2d7-5867-4af1-9788-d0ea2bf21313'::uuid, 1405495),
    ('dc99d8ab-018e-4142-bb8e-246dfc467cdd'::uuid, 1425205),
    ('e70746fe-9049-4ed3-90c8-f857e3d94304'::uuid, 1020569),
    ('24377324-181e-4bc2-b9fa-2fb213150ced'::uuid, 1009829),
    ('1d9382ae-04b4-4763-a005-7a55e1dd749b'::uuid, 1600520)
  ) AS w(id, cik) ON w.id = c.id AND c.sec_cik = w.cik;
  IF n <> 50 THEN
    RAISE EXCEPTION 'block 4 read-back failed: expected 50 stamped rows, got %', n;
  END IF;
END $$;

COMMIT;   -- to abandon block 4 instead, replace this line with: ROLLBACK;

-- ============================================================================
-- BLOCK 5 of 9. 50 rows.
-- ============================================================================
BEGIN;

-- JD.Com  ->  cik 1549802  SEC 'JD.com, Inc.'  [sec_conformed]  tickers=['JD', 'JDCMF']
UPDATE companies SET sec_cik = 1549802
 WHERE id = '99770153-b800-4d12-8b16-160403329878'::uuid AND sec_cik IS NULL AND name = 'JD.Com';
-- JELD-WEN  ->  cik 1674335  SEC 'JELD-WEN Holding, Inc.'  [sec_conformed]  tickers=['JELD']
UPDATE companies SET sec_cik = 1674335
 WHERE id = 'bb7d9505-f72f-4f82-b399-6477f0742301'::uuid AND sec_cik IS NULL AND name = 'JELD-WEN';
-- Jersey Mike’s Subs  ->  cik 2127043  SEC "Jersey Mike's Subs Inc."  [sec_conformed]  tickers=['JMKE']
UPDATE companies SET sec_cik = 2127043
 WHERE id = 'd7972265-365c-4cbd-98a7-159f3613a8fb'::uuid AND sec_cik IS NULL AND name = 'Jersey Mike’s Subs';
-- KBR  ->  cik 1357615  SEC 'KBR, INC.'  [sec_conformed]  tickers=['KBR']
UPDATE companies SET sec_cik = 1357615
 WHERE id = '83e9977d-70b4-4dcc-ab02-1476801c5cb7'::uuid AND sec_cik IS NULL AND name = 'KBR';
-- KEYCORP  ->  cik 91576  SEC 'KEYCORP /NEW/'  [sec_conformed]  tickers=['KEY', 'KEY-PK', 'KEY-PI']
UPDATE companies SET sec_cik = 91576
 WHERE id = '1f2f4e3c-ceee-43fb-b015-59285eee3f46'::uuid AND sec_cik IS NULL AND name = 'KEYCORP';
-- Keysight Technologies  ->  cik 1601046  SEC 'Keysight Technologies, Inc.'  [sec_conformed]  tickers=['KEYS']
UPDATE companies SET sec_cik = 1601046
 WHERE id = 'b32d07b3-729d-4832-a2b3-198320acfaa7'::uuid AND sec_cik IS NULL AND name = 'Keysight Technologies';
-- Kimberly-Clark  ->  cik 55785  SEC 'KIMBERLY CLARK CORP'  [sec_conformed]  tickers=['KMB']
UPDATE companies SET sec_cik = 55785
 WHERE id = '04af6598-f431-449b-ba17-e86d7300cf4c'::uuid AND sec_cik IS NULL AND name = 'Kimberly-Clark';
-- Kioxia  ->  cik 2053383  SEC 'Kioxia Holdings Corporation/ADR'  [sec_conformed]  tickers=['KXIAY', 'KXHCF']
UPDATE companies SET sec_cik = 2053383
 WHERE id = '757edfb0-de82-42e2-9682-92550f0c48e4'::uuid AND sec_cik IS NULL AND name = 'Kioxia';
-- Kokusai Electric  ->  cik 2033019  SEC 'Kokusai Electric Corporation/ADR'  [sec_conformed]  tickers=['KKSIY', 'KOKSF']
UPDATE companies SET sec_cik = 2033019
 WHERE id = 'c972472d-144e-4b1d-9e52-6c5928d16c44'::uuid AND sec_cik IS NULL AND name = 'Kokusai Electric';
-- Krispy Kreme  ->  cik 1857154  SEC 'Krispy Kreme, Inc.'  [sec_conformed]  tickers=['DNUT']
UPDATE companies SET sec_cik = 1857154
 WHERE id = '6c0beff6-5373-4682-a5b2-9cb52571ac30'::uuid AND sec_cik IS NULL AND name = 'Krispy Kreme';
-- Kroger  ->  cik 56873  SEC 'KROGER CO'  [sec_conformed]  tickers=['KR']
UPDATE companies SET sec_cik = 56873
 WHERE id = 'af6d9f1b-679a-4b7f-8d8c-2157491c5a8d'::uuid AND sec_cik IS NULL AND name = 'Kroger';
-- Lamb Weston  ->  cik 1679273  SEC 'Lamb Weston Holdings, Inc.'  [sec_conformed]  tickers=['LW']
UPDATE companies SET sec_cik = 1679273
 WHERE id = '3b5555ee-758f-41fa-b011-fb7a0cb5c0a7'::uuid AND sec_cik IS NULL AND name = 'Lamb Weston';
-- Lantheus Holdings  ->  cik 1521036  SEC 'Lantheus Holdings, Inc.'  [sec_conformed]  tickers=['LNTH']
UPDATE companies SET sec_cik = 1521036
 WHERE id = 'f1f3315f-d8c4-436a-9014-47c02d21bf3e'::uuid AND sec_cik IS NULL AND name = 'Lantheus Holdings';
-- Laopu Gold  ->  cik 2068440  SEC 'Laopu Gold Co. Ltd./ADR'  [sec_conformed]  tickers=['LPGCY', 'LPUGF']
UPDATE companies SET sec_cik = 2068440
 WHERE id = 'd31c7904-3540-4061-9100-9e8aca84cd53'::uuid AND sec_cik IS NULL AND name = 'Laopu Gold';
-- Lennox International  ->  cik 1069202  SEC 'LENNOX INTERNATIONAL INC'  [sec_conformed]  tickers=['LII']
UPDATE companies SET sec_cik = 1069202
 WHERE id = '5dd572ad-1e41-43cc-90f2-1e359fc94ff2'::uuid AND sec_cik IS NULL AND name = 'Lennox International';
-- LGI Homes  ->  cik 1580670  SEC 'LGI Homes, Inc.'  [sec_conformed]  tickers=['LGIH']
UPDATE companies SET sec_cik = 1580670
 WHERE id = 'eb2bbe14-b155-4ea2-a64a-0a74405385d2'::uuid AND sec_cik IS NULL AND name = 'LGI Homes';
-- LifeVantage  ->  cik 849146  SEC 'Lifevantage Corp'  [sec_conformed]  tickers=['LFVN']
UPDATE companies SET sec_cik = 849146
 WHERE id = '8101c4e1-9458-49be-b04d-5bd013b5b320'::uuid AND sec_cik IS NULL AND name = 'LifeVantage';
-- Ligand Pharmaceuticals  ->  cik 886163  SEC 'LIGAND PHARMACEUTICALS INC'  [sec_conformed]  tickers=['LGND', 'LGNDZ', 'LGNXZ']
UPDATE companies SET sec_cik = 886163
 WHERE id = 'e83c3235-20e4-4c46-bd92-caf5beacd801'::uuid AND sec_cik IS NULL AND name = 'Ligand Pharmaceuticals';
-- Lincoln National Corporation  ->  cik 59558  SEC 'LINCOLN NATIONAL CORP'  [sec_conformed]  tickers=['LNC', 'LNC-PD']
UPDATE companies SET sec_cik = 59558
 WHERE id = 'c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid AND sec_cik IS NULL AND name = 'Lincoln National Corporation';
-- Lion Finance Group  ->  cik 2140948  SEC 'Lion Finance Group PLC/ADR'  [sec_conformed]  tickers=['LNFGY']
UPDATE companies SET sec_cik = 2140948
 WHERE id = '74ab5dad-8ca9-47fe-b450-1ad4d9406bd7'::uuid AND sec_cik IS NULL AND name = 'Lion Finance Group';
-- Lithia Motors  ->  cik 1023128  SEC 'LITHIA MOTORS INC'  [sec_conformed]  tickers=['LAD']
UPDATE companies SET sec_cik = 1023128
 WHERE id = '71519329-a4cb-4d19-93af-cb0dc70b7cea'::uuid AND sec_cik IS NULL AND name = 'Lithia Motors';
-- Live Oak Bancshares  ->  cik 1462120  SEC 'Live Oak Bancshares, Inc.'  [sec_conformed]  tickers=['LOB', 'LOB-PA']
UPDATE companies SET sec_cik = 1462120
 WHERE id = '4e68c911-71cd-41cf-97bd-8076c0c94ba1'::uuid AND sec_cik IS NULL AND name = 'Live Oak Bancshares';
-- LiveRamp  ->  cik 733269  SEC 'LiveRamp Holdings, Inc.'  [sec_conformed]  tickers=['RAMP']
UPDATE companies SET sec_cik = 733269
 WHERE id = '3778ec3b-adf7-4547-b0a8-9898ee18692d'::uuid AND sec_cik IS NULL AND name = 'LiveRamp';
-- Lloyds Banking Group  ->  cik 1160106  SEC 'Lloyds Banking Group plc'  [sec_conformed]  tickers=['LYG', 'LLDTF', 'LLOBF']
UPDATE companies SET sec_cik = 1160106
 WHERE id = '378c0d7d-d496-4360-9d95-fd8377663298'::uuid AND sec_cik IS NULL AND name = 'Lloyds Banking Group';
-- Loandepot  ->  cik 1831631  SEC 'loanDepot, Inc.'  [sec_conformed]  tickers=['LDI']
UPDATE companies SET sec_cik = 1831631
 WHERE id = '3496b52d-df1c-4e22-a8c0-e8ba63830664'::uuid AND sec_cik IS NULL AND name = 'Loandepot';
-- Loews  ->  cik 60086  SEC 'LOEWS CORP'  [sec_conformed]  tickers=['L']
UPDATE companies SET sec_cik = 60086
 WHERE id = '5a9d7aeb-c466-49c3-9382-a67a340f169d'::uuid AND sec_cik IS NULL AND name = 'Loews';
-- Luckin Coffee  ->  cik 1767582  SEC 'Luckin Coffee Inc.'  [sec_conformed]  tickers=['LKNCY']
UPDATE companies SET sec_cik = 1767582
 WHERE id = '398fe069-92de-4f0a-92e8-474fff3093ec'::uuid AND sec_cik IS NULL AND name = 'Luckin Coffee';
-- LyondellBasell Industries  ->  cik 1489393  SEC 'LyondellBasell Industries N.V.'  [sec_conformed]  tickers=['LYB']
UPDATE companies SET sec_cik = 1489393
 WHERE id = '03476ec7-4dcb-442c-8822-fe7e60f28879'::uuid AND sec_cik IS NULL AND name = 'LyondellBasell Industries';
-- Magna  ->  cik 749098  SEC 'MAGNA INTERNATIONAL INC'  [sec_conformed]  tickers=['MGA']
UPDATE companies SET sec_cik = 749098
 WHERE id = '5c8bc39d-cc2d-43fc-92a0-df9ec847fb1d'::uuid AND sec_cik IS NULL AND name = 'Magna';
-- MakeMyTrip  ->  cik 1495153  SEC 'MakeMyTrip Ltd'  [sec_conformed]  tickers=['MMYT']
UPDATE companies SET sec_cik = 1495153
 WHERE id = '680b460c-a1ef-4c8d-be26-25b8222ee205'::uuid AND sec_cik IS NULL AND name = 'MakeMyTrip';
-- Manulife Financial  ->  cik 1086888  SEC 'MANULIFE FINANCIAL CORP'  [sec_conformed]  tickers=['MFC', 'MNLCF', 'MNQFF']
UPDATE companies SET sec_cik = 1086888
 WHERE id = '4f50c656-d8af-419d-8f5b-3e81039c924c'::uuid AND sec_cik IS NULL AND name = 'Manulife Financial';
-- Manycore Tech Inc.  ->  cik 2131961  SEC 'Manycore Tech Inc./ADR'  [sec_conformed]  tickers=['MNYCY']
UPDATE companies SET sec_cik = 2131961
 WHERE id = '7850e41f-9fa0-411b-b314-65b4b602f411'::uuid AND sec_cik IS NULL AND name = 'Manycore Tech Inc.';
-- Marriott International  ->  cik 1048286  SEC 'MARRIOTT INTERNATIONAL INC /MD/'  [sec_conformed]  tickers=['MAR']
UPDATE companies SET sec_cik = 1048286
 WHERE id = 'b35f13f1-ab26-47a1-bf52-af977eb2974d'::uuid AND sec_cik IS NULL AND name = 'Marriott International';
-- Marten Transport  ->  cik 799167  SEC 'MARTEN TRANSPORT LTD'  [sec_conformed]  tickers=['MRTN']
UPDATE companies SET sec_cik = 799167
 WHERE id = '953df921-711a-4ef3-845d-4dc7b210ac66'::uuid AND sec_cik IS NULL AND name = 'Marten Transport';
-- Medpace  ->  cik 1668397  SEC 'Medpace Holdings, Inc.'  [sec_conformed]  tickers=['MEDP']
UPDATE companies SET sec_cik = 1668397
 WHERE id = '84332844-fda6-410e-9a6b-fa52790cdf0a'::uuid AND sec_cik IS NULL AND name = 'Medpace';
-- Mercantile Bank  ->  cik 1042729  SEC 'MERCANTILE BANK CORP'  [sec_conformed]  tickers=['MBWM']
UPDATE companies SET sec_cik = 1042729
 WHERE id = '039714ac-bd75-46f5-8521-73fa1fdd8049'::uuid AND sec_cik IS NULL AND name = 'Mercantile Bank';
-- Meritage Homes  ->  cik 833079  SEC 'Meritage Homes CORP'  [sec_conformed]  tickers=['MTH']
UPDATE companies SET sec_cik = 833079
 WHERE id = 'e30e2af2-49a1-4f55-9ed2-a0d23623d097'::uuid AND sec_cik IS NULL AND name = 'Meritage Homes';
-- METLEN Energy & Metals PLC  ->  cik 2090231  SEC 'Metlen Energy & Metals PLC/ADR'  [sec_conformed]  tickers=['MTMTY', 'MTLPF']
UPDATE companies SET sec_cik = 2090231
 WHERE id = '9ccef504-78fb-45e1-9e89-c56b41ef2121'::uuid AND sec_cik IS NULL AND name = 'METLEN Energy & Metals PLC';
-- Microvast  ->  cik 1760689  SEC 'Microvast Holdings, Inc.'  [sec_conformed]  tickers=['MVST', 'MVSTW']
UPDATE companies SET sec_cik = 1760689
 WHERE id = '637aa6b8-6da5-4f58-b90d-d7efeb908c36'::uuid AND sec_cik IS NULL AND name = 'Microvast';
-- Midea Group  ->  cik 2039784  SEC 'Midea Group Co., Ltd./ADR'  [sec_conformed]  tickers=['MGCLY', 'MGCOF']
UPDATE companies SET sec_cik = 2039784
 WHERE id = '010372bd-8c4d-4cc4-a87b-4f6593a9d26b'::uuid AND sec_cik IS NULL AND name = 'Midea Group';
-- Miller Industries  ->  cik 924822  SEC 'MILLER INDUSTRIES INC /TN/'  [sec_conformed]  tickers=['MLR']
UPDATE companies SET sec_cik = 924822
 WHERE id = '7c924ae7-3041-4f16-bc78-ca06a858c1e3'::uuid AND sec_cik IS NULL AND name = 'Miller Industries';
-- Mistras Group  ->  cik 1436126  SEC 'Mistras Group, Inc.'  [sec_conformed]  tickers=['MG']
UPDATE companies SET sec_cik = 1436126
 WHERE id = '85a1766d-1cb6-4f75-87a1-e6875f1c195e'::uuid AND sec_cik IS NULL AND name = 'Mistras Group';
-- Modine Manufacturing  ->  cik 67347  SEC 'MODINE MANUFACTURING CO'  [sec_conformed]  tickers=['MOD']
UPDATE companies SET sec_cik = 67347
 WHERE id = 'a7a46c35-dbc2-489d-ab1e-e3e3a80c0040'::uuid AND sec_cik IS NULL AND name = 'Modine Manufacturing';
-- Monster Beverage  ->  cik 865752  SEC 'Monster Beverage Corp'  [sec_conformed]  tickers=['MNST']
UPDATE companies SET sec_cik = 865752
 WHERE id = 'fc0bd7c2-a123-4c8e-b6c0-8747f48a0641'::uuid AND sec_cik IS NULL AND name = 'Monster Beverage';
-- Montage Technology Co.  ->  cik 2123346  SEC 'Montage Technology Co., Ltd./ADR'  [sec_conformed]  tickers=['MNTGY', 'MNTCF']
UPDATE companies SET sec_cik = 2123346
 WHERE id = '65c9ddaf-6a1c-44cb-874a-aefe909c568f'::uuid AND sec_cik IS NULL AND name = 'Montage Technology Co.';
-- Mueller Water Products  ->  cik 1350593  SEC 'Mueller Water Products, Inc.'  [sec_conformed]  tickers=['MWA']
UPDATE companies SET sec_cik = 1350593
 WHERE id = '76ba3fec-13ae-4210-82e1-5d723d5e93da'::uuid AND sec_cik IS NULL AND name = 'Mueller Water Products';
-- Myriad Genetics  ->  cik 899923  SEC 'MYRIAD GENETICS INC'  [sec_conformed]  tickers=['MYGN']
UPDATE companies SET sec_cik = 899923
 WHERE id = '6eda5d47-02ea-41c9-87d0-86e22265a8af'::uuid AND sec_cik IS NULL AND name = 'Myriad Genetics';
-- Nano X Imaging  ->  cik 1795251  SEC 'Nano-X Imaging Ltd.'  [sec_conformed]  tickers=['NNOX']
UPDATE companies SET sec_cik = 1795251
 WHERE id = '2bd4e6b1-745b-46de-accd-e34ab50ed359'::uuid AND sec_cik IS NULL AND name = 'Nano X Imaging';
-- NAPCO SECURITY TECHNOLOGIES  ->  cik 69633  SEC 'NAPCO SECURITY TECHNOLOGIES, INC'  [sec_conformed]  tickers=['NSSC']
UPDATE companies SET sec_cik = 69633
 WHERE id = '8b2aa808-1675-4ac0-a7e8-2812321d068a'::uuid AND sec_cik IS NULL AND name = 'NAPCO SECURITY TECHNOLOGIES';
-- National Grid plc  ->  cik 1004315  SEC 'NATIONAL GRID PLC'  [sec_conformed]  tickers=['NGG', 'NGGTF', 'NEWEN']
UPDATE companies SET sec_cik = 1004315
 WHERE id = 'a9ddef20-a9cd-4899-b248-525fa090d252'::uuid AND sec_cik IS NULL AND name = 'National Grid plc';

-- READ-BACK for block 5. Raises, and therefore rolls the whole block back,
-- if fewer than 50 of these rows now carry their intended CIK.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM companies c
  JOIN (VALUES
    ('99770153-b800-4d12-8b16-160403329878'::uuid, 1549802),
    ('bb7d9505-f72f-4f82-b399-6477f0742301'::uuid, 1674335),
    ('d7972265-365c-4cbd-98a7-159f3613a8fb'::uuid, 2127043),
    ('83e9977d-70b4-4dcc-ab02-1476801c5cb7'::uuid, 1357615),
    ('1f2f4e3c-ceee-43fb-b015-59285eee3f46'::uuid, 91576),
    ('b32d07b3-729d-4832-a2b3-198320acfaa7'::uuid, 1601046),
    ('04af6598-f431-449b-ba17-e86d7300cf4c'::uuid, 55785),
    ('757edfb0-de82-42e2-9682-92550f0c48e4'::uuid, 2053383),
    ('c972472d-144e-4b1d-9e52-6c5928d16c44'::uuid, 2033019),
    ('6c0beff6-5373-4682-a5b2-9cb52571ac30'::uuid, 1857154),
    ('af6d9f1b-679a-4b7f-8d8c-2157491c5a8d'::uuid, 56873),
    ('3b5555ee-758f-41fa-b011-fb7a0cb5c0a7'::uuid, 1679273),
    ('f1f3315f-d8c4-436a-9014-47c02d21bf3e'::uuid, 1521036),
    ('d31c7904-3540-4061-9100-9e8aca84cd53'::uuid, 2068440),
    ('5dd572ad-1e41-43cc-90f2-1e359fc94ff2'::uuid, 1069202),
    ('eb2bbe14-b155-4ea2-a64a-0a74405385d2'::uuid, 1580670),
    ('8101c4e1-9458-49be-b04d-5bd013b5b320'::uuid, 849146),
    ('e83c3235-20e4-4c46-bd92-caf5beacd801'::uuid, 886163),
    ('c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid, 59558),
    ('74ab5dad-8ca9-47fe-b450-1ad4d9406bd7'::uuid, 2140948),
    ('71519329-a4cb-4d19-93af-cb0dc70b7cea'::uuid, 1023128),
    ('4e68c911-71cd-41cf-97bd-8076c0c94ba1'::uuid, 1462120),
    ('3778ec3b-adf7-4547-b0a8-9898ee18692d'::uuid, 733269),
    ('378c0d7d-d496-4360-9d95-fd8377663298'::uuid, 1160106),
    ('3496b52d-df1c-4e22-a8c0-e8ba63830664'::uuid, 1831631),
    ('5a9d7aeb-c466-49c3-9382-a67a340f169d'::uuid, 60086),
    ('398fe069-92de-4f0a-92e8-474fff3093ec'::uuid, 1767582),
    ('03476ec7-4dcb-442c-8822-fe7e60f28879'::uuid, 1489393),
    ('5c8bc39d-cc2d-43fc-92a0-df9ec847fb1d'::uuid, 749098),
    ('680b460c-a1ef-4c8d-be26-25b8222ee205'::uuid, 1495153),
    ('4f50c656-d8af-419d-8f5b-3e81039c924c'::uuid, 1086888),
    ('7850e41f-9fa0-411b-b314-65b4b602f411'::uuid, 2131961),
    ('b35f13f1-ab26-47a1-bf52-af977eb2974d'::uuid, 1048286),
    ('953df921-711a-4ef3-845d-4dc7b210ac66'::uuid, 799167),
    ('84332844-fda6-410e-9a6b-fa52790cdf0a'::uuid, 1668397),
    ('039714ac-bd75-46f5-8521-73fa1fdd8049'::uuid, 1042729),
    ('e30e2af2-49a1-4f55-9ed2-a0d23623d097'::uuid, 833079),
    ('9ccef504-78fb-45e1-9e89-c56b41ef2121'::uuid, 2090231),
    ('637aa6b8-6da5-4f58-b90d-d7efeb908c36'::uuid, 1760689),
    ('010372bd-8c4d-4cc4-a87b-4f6593a9d26b'::uuid, 2039784),
    ('7c924ae7-3041-4f16-bc78-ca06a858c1e3'::uuid, 924822),
    ('85a1766d-1cb6-4f75-87a1-e6875f1c195e'::uuid, 1436126),
    ('a7a46c35-dbc2-489d-ab1e-e3e3a80c0040'::uuid, 67347),
    ('fc0bd7c2-a123-4c8e-b6c0-8747f48a0641'::uuid, 865752),
    ('65c9ddaf-6a1c-44cb-874a-aefe909c568f'::uuid, 2123346),
    ('76ba3fec-13ae-4210-82e1-5d723d5e93da'::uuid, 1350593),
    ('6eda5d47-02ea-41c9-87d0-86e22265a8af'::uuid, 899923),
    ('2bd4e6b1-745b-46de-accd-e34ab50ed359'::uuid, 1795251),
    ('8b2aa808-1675-4ac0-a7e8-2812321d068a'::uuid, 69633),
    ('a9ddef20-a9cd-4899-b248-525fa090d252'::uuid, 1004315)
  ) AS w(id, cik) ON w.id = c.id AND c.sec_cik = w.cik;
  IF n <> 50 THEN
    RAISE EXCEPTION 'block 5 read-back failed: expected 50 stamped rows, got %', n;
  END IF;
END $$;

COMMIT;   -- to abandon block 5 instead, replace this line with: ROLLBACK;

-- ============================================================================
-- BLOCK 6 of 9. 50 rows.
-- ============================================================================
BEGIN;

-- NatWest  ->  cik 844150  SEC 'NatWest Group plc'  [sec_conformed]  tickers=['NWG', 'RBSPF']
UPDATE companies SET sec_cik = 844150
 WHERE id = '0eee5e37-b308-4995-a0a2-b272c0746fec'::uuid AND sec_cik IS NULL AND name = 'NatWest';
-- Nayax  ->  cik 1901279  SEC 'Nayax Ltd.'  [sec_conformed]  tickers=['NYAX']
UPDATE companies SET sec_cik = 1901279
 WHERE id = '684e1591-3a30-480f-b562-3828aaa3a006'::uuid AND sec_cik IS NULL AND name = 'Nayax';
-- NetEase  ->  cik 1110646  SEC 'NetEase, Inc.'  [sec_conformed]  tickers=['NTES', 'NETTF']
UPDATE companies SET sec_cik = 1110646
 WHERE id = 'df303dcb-e0b0-4571-b3fd-b19cad95bbe0'::uuid AND sec_cik IS NULL AND name = 'NetEase';
-- Newell Brands  ->  cik 814453  SEC 'NEWELL BRANDS INC.'  [sec_conformed]  tickers=['NWL']
UPDATE companies SET sec_cik = 814453
 WHERE id = 'eb477c21-df9e-4742-aca8-c7b94bd5c282'::uuid AND sec_cik IS NULL AND name = 'Newell Brands';
-- NextEra Energy  ->  cik 753308  SEC 'NEXTERA ENERGY INC'  [sec_conformed]  tickers=['NEE', 'NEE-PN', 'NEE-PS']
UPDATE companies SET sec_cik = 753308
 WHERE id = '89b5dca1-03b1-4388-b836-2b0379623884'::uuid AND sec_cik IS NULL AND name = 'NextEra Energy';
-- NLight  ->  cik 1124796  SEC 'NLIGHT, INC.'  [sec_conformed]  tickers=['LASR']
UPDATE companies SET sec_cik = 1124796
 WHERE id = '10b50cd0-eed9-44d1-9890-4be0e3e38ffd'::uuid AND sec_cik IS NULL AND name = 'NLight';
-- Northland Power Inc.  ->  cik 2072389  SEC 'Northland Power Inc./ADR'  [sec_conformed]  tickers=['NPIXY', 'NPIFF', 'NPICF']
UPDATE companies SET sec_cik = 2072389
 WHERE id = 'f3e9294d-ecda-42a0-bed8-18271a406a8d'::uuid AND sec_cik IS NULL AND name = 'Northland Power Inc.';
-- NovaGold Resources  ->  cik 1173420  SEC 'NOVAGOLD RESOURCES INC'  [sec_conformed]  tickers=['NG']
UPDATE companies SET sec_cik = 1173420
 WHERE id = 'f5ebe02e-89b6-49ef-94bd-b6b2a1a3f6ed'::uuid AND sec_cik IS NULL AND name = 'NovaGold Resources';
-- Novartis AG  ->  cik 1114448  SEC 'NOVARTIS AG'  [sec_conformed]  tickers=['NVS', 'NVSEF']
UPDATE companies SET sec_cik = 1114448
 WHERE id = '4d816cf4-8a9f-4f0a-9be5-f4ad9eaa8fe9'::uuid AND sec_cik IS NULL AND name = 'Novartis AG';
-- Novonix  ->  cik 1859795  SEC 'NOVONIX Ltd'  [sec_conformed]  tickers=['NVX', 'NVNXF']
UPDATE companies SET sec_cik = 1859795
 WHERE id = '61d3a428-3196-46d7-b565-a9445c298640'::uuid AND sec_cik IS NULL AND name = 'Novonix';
-- Nuburu  ->  cik 1814215  SEC 'Nuburu, Inc.'  [sec_conformed]  tickers=['BURU', 'BURUW']
UPDATE companies SET sec_cik = 1814215
 WHERE id = '781671cf-2372-4ec9-8b98-03a3c88aee5f'::uuid AND sec_cik IS NULL AND name = 'Nuburu';
-- Nucor  ->  cik 73309  SEC 'NUCOR CORP'  [sec_conformed]  tickers=['NUE']
UPDATE companies SET sec_cik = 73309
 WHERE id = 'b424f501-704d-4140-acf2-9b550c65a6cd'::uuid AND sec_cik IS NULL AND name = 'Nucor';
-- Nutex Health  ->  cik 1479681  SEC 'Nutex Health Inc.'  [sec_conformed]  tickers=['NUTX']
UPDATE companies SET sec_cik = 1479681
 WHERE id = '0db06c25-57be-4f15-ac7a-389bab9d2966'::uuid AND sec_cik IS NULL AND name = 'Nutex Health';
-- Nuvalent  ->  cik 1861560  SEC 'Nuvalent, Inc.'  [sec_conformed]  tickers=['NUVL']
UPDATE companies SET sec_cik = 1861560
 WHERE id = 'db94ccba-0a9e-43af-8e51-186d63ba7b66'::uuid AND sec_cik IS NULL AND name = 'Nuvalent';
-- OBIC Business Consultants  ->  cik 2088339  SEC 'OBIC Business Consultants Co., Ltd./ADR'  [sec_conformed]  tickers=['OBBCY', 'OBIBF']
UPDATE companies SET sec_cik = 2088339
 WHERE id = 'b7ac4c3e-0db9-4e38-a276-1616cef99d16'::uuid AND sec_cik IS NULL AND name = 'OBIC Business Consultants';
-- Obsidian Energy  ->  cik 1334388  SEC 'OBSIDIAN ENERGY LTD.'  [sec_conformed]  tickers=['OBE']
UPDATE companies SET sec_cik = 1334388
 WHERE id = '4288868b-c8be-422d-ac64-40863392367a'::uuid AND sec_cik IS NULL AND name = 'Obsidian Energy';
-- Oceaneering  ->  cik 73756  SEC 'OCEANEERING INTERNATIONAL INC'  [sec_conformed]  tickers=['OII']
UPDATE companies SET sec_cik = 73756
 WHERE id = '84cc2250-94c1-4900-9dcb-aefae92f6bcb'::uuid AND sec_cik IS NULL AND name = 'Oceaneering';
-- Odyssey Therapeutics  ->  cik 1882782  SEC 'Odyssey Therapeutics, Inc.'  [sec_conformed]  tickers=['ODTX']
UPDATE companies SET sec_cik = 1882782
 WHERE id = 'c1cdce71-55ef-4213-b8c3-3a1d63b7f88c'::uuid AND sec_cik IS NULL AND name = 'Odyssey Therapeutics';
-- Old Dominion Freight Line  ->  cik 878927  SEC 'OLD DOMINION FREIGHT LINE, INC.'  [sec_conformed]  tickers=['ODFL']
UPDATE companies SET sec_cik = 878927
 WHERE id = '40ff0f77-f7a6-4d01-baaf-8eccc8333098'::uuid AND sec_cik IS NULL AND name = 'Old Dominion Freight Line';
-- Olema Pharmaceuticals  ->  cik 1750284  SEC 'Olema Pharmaceuticals, Inc.'  [sec_conformed]  tickers=['OLMA']
UPDATE companies SET sec_cik = 1750284
 WHERE id = 'caacad17-b33a-4404-8cba-ce4b3ea407d8'::uuid AND sec_cik IS NULL AND name = 'Olema Pharmaceuticals';
-- OnKure Therapeutics  ->  cik 1637715  SEC 'OnKure Therapeutics, Inc.'  [sec_conformed]  tickers=['OKUR']
UPDATE companies SET sec_cik = 1637715
 WHERE id = '56c432db-7c9d-4737-8d7d-02913836b002'::uuid AND sec_cik IS NULL AND name = 'OnKure Therapeutics';
-- Onto Innovation  ->  cik 704532  SEC 'ONTO INNOVATION INC.'  [sec_conformed]  tickers=['ONTO']
UPDATE companies SET sec_cik = 704532
 WHERE id = 'f9989656-521b-4cc5-8d08-5a0f6c563619'::uuid AND sec_cik IS NULL AND name = 'Onto Innovation';
-- Oshkosh Corp  ->  cik 775158  SEC 'OSHKOSH CORP'  [sec_conformed]  tickers=['OSK']
UPDATE companies SET sec_cik = 775158
 WHERE id = '6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid AND sec_cik IS NULL AND name = 'Oshkosh Corp';
-- Ovid Therapeutics  ->  cik 1636651  SEC 'Ovid Therapeutics Inc.'  [sec_conformed]  tickers=['OVID']
UPDATE companies SET sec_cik = 1636651
 WHERE id = 'b0403540-c2eb-4f58-a2bb-d1a1522af688'::uuid AND sec_cik IS NULL AND name = 'Ovid Therapeutics';
-- Par Pacific Holdings  ->  cik 821483  SEC 'PAR PACIFIC HOLDINGS, INC.'  [sec_conformed]  tickers=['PARR']
UPDATE companies SET sec_cik = 821483
 WHERE id = 'e4525662-ad9d-4fd7-a736-2a21c869455e'::uuid AND sec_cik IS NULL AND name = 'Par Pacific Holdings';
-- Pasqal  ->  cik 2119292  SEC 'Pasqal Holding SA'  [sec_conformed]  tickers=['PSQL', 'PSQLW']
UPDATE companies SET sec_cik = 2119292
 WHERE id = '91476708-694e-4c52-942b-f8eccd9bc1e2'::uuid AND sec_cik IS NULL AND name = 'Pasqal';
-- PennantPark Investment  ->  cik 1383414  SEC 'PENNANTPARK INVESTMENT CORP'  [sec_conformed]  tickers=['PNNT']
UPDATE companies SET sec_cik = 1383414
 WHERE id = '8372a5b6-06dd-45d8-867c-7c2cc3e53026'::uuid AND sec_cik IS NULL AND name = 'PennantPark Investment';
-- Pennon Group  ->  cik 1455633  SEC 'Pennon Group Plc / ADR'  [sec_conformed]  tickers=['PEGRF']
UPDATE companies SET sec_cik = 1455633
 WHERE id = '3e10ef20-760d-49db-b634-7e0005a3bd06'::uuid AND sec_cik IS NULL AND name = 'Pennon Group';
-- Pentair  ->  cik 77360  SEC 'PENTAIR plc'  [sec_conformed]  tickers=['PNR']
UPDATE companies SET sec_cik = 77360
 WHERE id = '14c4f47d-94c7-4706-801a-fdec8642c06c'::uuid AND sec_cik IS NULL AND name = 'Pentair';
-- Perma Fix Environmental Services  ->  cik 891532  SEC 'PERMA FIX ENVIRONMENTAL SERVICES INC'  [sec_conformed]  tickers=['PESI']
UPDATE companies SET sec_cik = 891532
 WHERE id = '04f89953-cb99-46af-833f-45561abf22db'::uuid AND sec_cik IS NULL AND name = 'Perma Fix Environmental Services';
-- Pershing Square  ->  cik 2026053  SEC 'PERSHING SQUARE INC.'  [sec_conformed]  tickers=['PS']
UPDATE companies SET sec_cik = 2026053
 WHERE id = '48c9d5e9-acfb-4da2-9df6-679efc2fd730'::uuid AND sec_cik IS NULL AND name = 'Pershing Square';
-- Phibro Animal Health  ->  cik 1069899  SEC 'PHIBRO ANIMAL HEALTH CORP'  [sec_conformed]  tickers=['PAHC']
UPDATE companies SET sec_cik = 1069899
 WHERE id = 'f3f6ad52-1da2-4e21-9065-c6f0d88e2dad'::uuid AND sec_cik IS NULL AND name = 'Phibro Animal Health';
-- Photronics  ->  cik 810136  SEC 'PHOTRONICS INC'  [sec_conformed]  tickers=['PLAB']
UPDATE companies SET sec_cik = 810136
 WHERE id = '132d1ea7-3b79-416c-929c-cf538e2c093a'::uuid AND sec_cik IS NULL AND name = 'Photronics';
-- Piraeus Bank SA  ->  cik 1437441  SEC 'Piraeus Bank S.A.'  [sec_conformed]  tickers=['PIRBF']
UPDATE companies SET sec_cik = 1437441
 WHERE id = '79454f6c-0eee-4a7d-a4a2-5266d4bd1d03'::uuid AND sec_cik IS NULL AND name = 'Piraeus Bank SA';
-- Porch Group  ->  cik 1784535  SEC 'Porch Group, Inc.'  [sec_conformed]  tickers=['PRCH']
UPDATE companies SET sec_cik = 1784535
 WHERE id = '3760bdcc-8c7f-4615-bf53-cd47b6f81ef4'::uuid AND sec_cik IS NULL AND name = 'Porch Group';
-- Prime Medicine  ->  cik 1894562  SEC 'Prime Medicine, Inc.'  [sec_conformed]  tickers=['PRME']
UPDATE companies SET sec_cik = 1894562
 WHERE id = '30883a17-ef7c-4340-ac31-b440be1fe4e4'::uuid AND sec_cik IS NULL AND name = 'Prime Medicine';
-- Progress Software  ->  cik 876167  SEC 'PROGRESS SOFTWARE CORP /MA'  [sec_conformed]  tickers=['PRGS']
UPDATE companies SET sec_cik = 876167
 WHERE id = 'dd5ac907-f852-4f49-8478-778d002a5be1'::uuid AND sec_cik IS NULL AND name = 'Progress Software';
-- Progyny  ->  cik 1551306  SEC 'Progyny, Inc.'  [sec_conformed]  tickers=['PGNY']
UPDATE companies SET sec_cik = 1551306
 WHERE id = '7976a80b-a459-4212-a3e3-6937847f667f'::uuid AND sec_cik IS NULL AND name = 'Progyny';
-- Prosperity Bancshares  ->  cik 1068851  SEC 'PROSPERITY BANCSHARES INC'  [sec_conformed]  tickers=['PB']
UPDATE companies SET sec_cik = 1068851
 WHERE id = '0b8b7794-969f-4238-ab30-0e64497f5079'::uuid AND sec_cik IS NULL AND name = 'Prosperity Bancshares';
-- Prudential Financial  ->  cik 1137774  SEC 'PRUDENTIAL FINANCIAL INC'  [sec_conformed]  tickers=['PRU', 'PFH', 'PRH']
UPDATE companies SET sec_cik = 1137774
 WHERE id = '8f4f6311-2732-4c34-9e7b-fc799d3d5f5b'::uuid AND sec_cik IS NULL AND name = 'Prudential Financial';
-- PureTech Health  ->  cik 1782999  SEC 'PureTech Health plc'  [sec_conformed]  tickers=['PRTC', 'PTCHF', 'PRTCY']
UPDATE companies SET sec_cik = 1782999
 WHERE id = '21a2b00d-98a0-45cd-bc54-f9ccf1043e49'::uuid AND sec_cik IS NULL AND name = 'PureTech Health';
-- PVH  ->  cik 78239  SEC 'PVH CORP. /DE/'  [sec_conformed]  tickers=['PVH']
UPDATE companies SET sec_cik = 78239
 WHERE id = 'b10e39d7-d0bc-464e-8395-bfca4096174a'::uuid AND sec_cik IS NULL AND name = 'PVH';
-- QCR Holdings  ->  cik 906465  SEC 'QCR HOLDINGS INC'  [sec_conformed]  tickers=['QCRH']
UPDATE companies SET sec_cik = 906465
 WHERE id = 'c8eca83d-b0b5-4df1-94d7-895ddcd350bc'::uuid AND sec_cik IS NULL AND name = 'QCR Holdings';
-- Qiagen  ->  cik 1015820  SEC 'QIAGEN N.V.'  [sec_conformed]  tickers=['QGEN']
UPDATE companies SET sec_cik = 1015820
 WHERE id = '2c796439-da12-406d-8ecf-0aa5b8d47982'::uuid AND sec_cik IS NULL AND name = 'Qiagen';
-- Qnity Electronics  ->  cik 2058873  SEC 'Qnity Electronics, Inc.'  [sec_conformed]  tickers=['Q']
UPDATE companies SET sec_cik = 2058873
 WHERE id = 'd423c9f0-0207-43d0-ae52-3503dba94ca9'::uuid AND sec_cik IS NULL AND name = 'Qnity Electronics';
-- Quanterix  ->  cik 1503274  SEC 'Quanterix Corp'  [sec_conformed]  tickers=['QTRX']
UPDATE companies SET sec_cik = 1503274
 WHERE id = 'fd519c2a-6c5c-4cab-a18a-e3f235a3ca86'::uuid AND sec_cik IS NULL AND name = 'Quanterix';
-- Quest Diagnostics  ->  cik 1022079  SEC 'QUEST DIAGNOSTICS INC'  [sec_conformed]  tickers=['DGX']
UPDATE companies SET sec_cik = 1022079
 WHERE id = 'f95dbf47-8fc8-4036-aac6-60cf536d06c9'::uuid AND sec_cik IS NULL AND name = 'Quest Diagnostics';
-- QuinStreet  ->  cik 1117297  SEC 'QUINSTREET, INC'  [sec_conformed]  tickers=['QNST']
UPDATE companies SET sec_cik = 1117297
 WHERE id = 'b679988a-d9dd-43cd-a643-9c908c94b70b'::uuid AND sec_cik IS NULL AND name = 'QuinStreet';
-- Rallybio  ->  cik 1739410  SEC 'Rallybio Corp'  [sec_conformed]  tickers=['RLYB']
UPDATE companies SET sec_cik = 1739410
 WHERE id = '345d131f-f564-482f-975b-c1d794211185'::uuid AND sec_cik IS NULL AND name = 'Rallybio';
-- Ralph Lauren Corporation  ->  cik 1037038  SEC 'RALPH LAUREN CORP'  [sec_conformed]  tickers=['RL']
UPDATE companies SET sec_cik = 1037038
 WHERE id = '3c0aebcd-0e60-4318-ad68-153db20fc35b'::uuid AND sec_cik IS NULL AND name = 'Ralph Lauren Corporation';

-- READ-BACK for block 6. Raises, and therefore rolls the whole block back,
-- if fewer than 50 of these rows now carry their intended CIK.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM companies c
  JOIN (VALUES
    ('0eee5e37-b308-4995-a0a2-b272c0746fec'::uuid, 844150),
    ('684e1591-3a30-480f-b562-3828aaa3a006'::uuid, 1901279),
    ('df303dcb-e0b0-4571-b3fd-b19cad95bbe0'::uuid, 1110646),
    ('eb477c21-df9e-4742-aca8-c7b94bd5c282'::uuid, 814453),
    ('89b5dca1-03b1-4388-b836-2b0379623884'::uuid, 753308),
    ('10b50cd0-eed9-44d1-9890-4be0e3e38ffd'::uuid, 1124796),
    ('f3e9294d-ecda-42a0-bed8-18271a406a8d'::uuid, 2072389),
    ('f5ebe02e-89b6-49ef-94bd-b6b2a1a3f6ed'::uuid, 1173420),
    ('4d816cf4-8a9f-4f0a-9be5-f4ad9eaa8fe9'::uuid, 1114448),
    ('61d3a428-3196-46d7-b565-a9445c298640'::uuid, 1859795),
    ('781671cf-2372-4ec9-8b98-03a3c88aee5f'::uuid, 1814215),
    ('b424f501-704d-4140-acf2-9b550c65a6cd'::uuid, 73309),
    ('0db06c25-57be-4f15-ac7a-389bab9d2966'::uuid, 1479681),
    ('db94ccba-0a9e-43af-8e51-186d63ba7b66'::uuid, 1861560),
    ('b7ac4c3e-0db9-4e38-a276-1616cef99d16'::uuid, 2088339),
    ('4288868b-c8be-422d-ac64-40863392367a'::uuid, 1334388),
    ('84cc2250-94c1-4900-9dcb-aefae92f6bcb'::uuid, 73756),
    ('c1cdce71-55ef-4213-b8c3-3a1d63b7f88c'::uuid, 1882782),
    ('40ff0f77-f7a6-4d01-baaf-8eccc8333098'::uuid, 878927),
    ('caacad17-b33a-4404-8cba-ce4b3ea407d8'::uuid, 1750284),
    ('56c432db-7c9d-4737-8d7d-02913836b002'::uuid, 1637715),
    ('f9989656-521b-4cc5-8d08-5a0f6c563619'::uuid, 704532),
    ('6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid, 775158),
    ('b0403540-c2eb-4f58-a2bb-d1a1522af688'::uuid, 1636651),
    ('e4525662-ad9d-4fd7-a736-2a21c869455e'::uuid, 821483),
    ('91476708-694e-4c52-942b-f8eccd9bc1e2'::uuid, 2119292),
    ('8372a5b6-06dd-45d8-867c-7c2cc3e53026'::uuid, 1383414),
    ('3e10ef20-760d-49db-b634-7e0005a3bd06'::uuid, 1455633),
    ('14c4f47d-94c7-4706-801a-fdec8642c06c'::uuid, 77360),
    ('04f89953-cb99-46af-833f-45561abf22db'::uuid, 891532),
    ('48c9d5e9-acfb-4da2-9df6-679efc2fd730'::uuid, 2026053),
    ('f3f6ad52-1da2-4e21-9065-c6f0d88e2dad'::uuid, 1069899),
    ('132d1ea7-3b79-416c-929c-cf538e2c093a'::uuid, 810136),
    ('79454f6c-0eee-4a7d-a4a2-5266d4bd1d03'::uuid, 1437441),
    ('3760bdcc-8c7f-4615-bf53-cd47b6f81ef4'::uuid, 1784535),
    ('30883a17-ef7c-4340-ac31-b440be1fe4e4'::uuid, 1894562),
    ('dd5ac907-f852-4f49-8478-778d002a5be1'::uuid, 876167),
    ('7976a80b-a459-4212-a3e3-6937847f667f'::uuid, 1551306),
    ('0b8b7794-969f-4238-ab30-0e64497f5079'::uuid, 1068851),
    ('8f4f6311-2732-4c34-9e7b-fc799d3d5f5b'::uuid, 1137774),
    ('21a2b00d-98a0-45cd-bc54-f9ccf1043e49'::uuid, 1782999),
    ('b10e39d7-d0bc-464e-8395-bfca4096174a'::uuid, 78239),
    ('c8eca83d-b0b5-4df1-94d7-895ddcd350bc'::uuid, 906465),
    ('2c796439-da12-406d-8ecf-0aa5b8d47982'::uuid, 1015820),
    ('d423c9f0-0207-43d0-ae52-3503dba94ca9'::uuid, 2058873),
    ('fd519c2a-6c5c-4cab-a18a-e3f235a3ca86'::uuid, 1503274),
    ('f95dbf47-8fc8-4036-aac6-60cf536d06c9'::uuid, 1022079),
    ('b679988a-d9dd-43cd-a643-9c908c94b70b'::uuid, 1117297),
    ('345d131f-f564-482f-975b-c1d794211185'::uuid, 1739410),
    ('3c0aebcd-0e60-4318-ad68-153db20fc35b'::uuid, 1037038)
  ) AS w(id, cik) ON w.id = c.id AND c.sec_cik = w.cik;
  IF n <> 50 THEN
    RAISE EXCEPTION 'block 6 read-back failed: expected 50 stamped rows, got %', n;
  END IF;
END $$;

COMMIT;   -- to abandon block 6 instead, replace this line with: ROLLBACK;

-- ============================================================================
-- BLOCK 7 of 9. 50 rows.
-- ============================================================================
BEGIN;

-- Range Resources  ->  cik 315852  SEC 'RANGE RESOURCES CORP'  [sec_conformed]  tickers=['RRC']
UPDATE companies SET sec_cik = 315852
 WHERE id = '2cc8f498-c5fa-4331-9cea-e725b0a36c07'::uuid AND sec_cik IS NULL AND name = 'Range Resources';
-- RCI Hospitality  ->  cik 935419  SEC 'RCI HOSPITALITY HOLDINGS, INC.'  [sec_conformed]  tickers=['RICK']
UPDATE companies SET sec_cik = 935419
 WHERE id = 'aa5de138-64e8-411f-8a00-710dfc83e16e'::uuid AND sec_cik IS NULL AND name = 'RCI Hospitality';
-- RCM Technologies  ->  cik 700841  SEC 'RCM TECHNOLOGIES, INC.'  [sec_conformed]  tickers=['RCMT']
UPDATE companies SET sec_cik = 700841
 WHERE id = '297e8905-5f6d-452e-935c-131fdc458143'::uuid AND sec_cik IS NULL AND name = 'RCM Technologies';
-- Regal Rexnord  ->  cik 82811  SEC 'REGAL REXNORD CORP'  [sec_conformed]  tickers=['RRX']
UPDATE companies SET sec_cik = 82811
 WHERE id = 'e6e7dd83-a925-4e00-aec9-bec1efcd3e9b'::uuid AND sec_cik IS NULL AND name = 'Regal Rexnord';
-- Regions Financial  ->  cik 1281761  SEC 'REGIONS FINANCIAL CORP'  [sec_conformed]  tickers=['RF', 'RF-PC', 'RF-PE']
UPDATE companies SET sec_cik = 1281761
 WHERE id = 'a61582b6-31c6-4d73-beea-64777536135a'::uuid AND sec_cik IS NULL AND name = 'Regions Financial';
-- Relay Therapeutics, Inc.  ->  cik 1812364  SEC 'Relay Therapeutics, Inc.'  [sec_conformed]  tickers=['RLAY']
UPDATE companies SET sec_cik = 1812364
 WHERE id = 'e259fc86-df8e-40fd-88d6-0e727f618641'::uuid AND sec_cik IS NULL AND name = 'Relay Therapeutics, Inc.';
-- Restaurant Brands International  ->  cik 1618756  SEC 'Restaurant Brands International Inc.'  [sec_conformed]  tickers=['QSR']
UPDATE companies SET sec_cik = 1618756
 WHERE id = 'd46d4777-125a-4086-91c1-801931500b63'::uuid AND sec_cik IS NULL AND name = 'Restaurant Brands International';
-- Revolution Medicines  ->  cik 1628171  SEC 'Revolution Medicines, Inc.'  [sec_conformed]  tickers=['RVMD', 'RVMDW']
UPDATE companies SET sec_cik = 1628171
 WHERE id = 'd99e526f-da24-4a6c-bfd6-d2abe302a1d9'::uuid AND sec_cik IS NULL AND name = 'Revolution Medicines';
-- Reynolds Consumer Products  ->  cik 1786431  SEC 'Reynolds Consumer Products Inc.'  [sec_conformed]  tickers=['REYN']
UPDATE companies SET sec_cik = 1786431
 WHERE id = '91fac195-6964-4678-a604-0fe928c8317f'::uuid AND sec_cik IS NULL AND name = 'Reynolds Consumer Products';
-- Richardson Electronics  ->  cik 355948  SEC 'RICHARDSON ELECTRONICS, LTD.'  [sec_conformed]  tickers=['RELL']
UPDATE companies SET sec_cik = 355948
 WHERE id = '21c052bc-e0a5-440a-bf1b-2878fa703737'::uuid AND sec_cik IS NULL AND name = 'Richardson Electronics';
-- Rigaku  ->  cik 2141099  SEC 'Rigaku Holdings Corporation/ADR'  [sec_conformed]  tickers=['RGKUY', 'RGAKF']
UPDATE companies SET sec_cik = 2141099
 WHERE id = '578eb178-f386-4a42-84c6-ee5a5025de67'::uuid AND sec_cik IS NULL AND name = 'Rigaku';
-- Rightmove  ->  cik 1516536  SEC 'Rightmove PLC/ADR'  [sec_conformed]  tickers=['RMVEY', 'RTMVF']
UPDATE companies SET sec_cik = 1516536
 WHERE id = '3c928d59-e582-4092-a47f-77a802db17ef'::uuid AND sec_cik IS NULL AND name = 'Rightmove';
-- Rocket Pharmaceuticals Inc  ->  cik 1281895  SEC 'ROCKET PHARMACEUTICALS, INC.'  [sec_conformed]  tickers=['RCKT', 'RCKTW']
UPDATE companies SET sec_cik = 1281895
 WHERE id = '1309723d-2375-4157-9c60-00a3686eb3d0'::uuid AND sec_cik IS NULL AND name = 'Rocket Pharmaceuticals Inc';
-- Rockwool  ->  cik 1969729  SEC 'Rockwool A/S/ADR'  [sec_conformed]  tickers=['RCWLY', 'RKWBF', 'RKWAF']
UPDATE companies SET sec_cik = 1969729
 WHERE id = '3606bab5-31fd-49fa-9724-13327dedf325'::uuid AND sec_cik IS NULL AND name = 'Rockwool';
-- Saab AB  ->  cik 1770114  SEC 'Saab AB/ADR'  [sec_conformed]  tickers=['SAABF']
UPDATE companies SET sec_cik = 1770114
 WHERE id = '605896b7-a928-4e62-bd02-c6727a651c1a'::uuid AND sec_cik IS NULL AND name = 'Saab AB';
-- Sanrio Co.  ->  cik 1584273  SEC 'Sanrio Company, Ltd./ADR'  [sec_conformed]  tickers=['SNROY', 'SNROF']
UPDATE companies SET sec_cik = 1584273
 WHERE id = '716042ea-dd3a-4a7f-bad3-27c2cd6b201d'::uuid AND sec_cik IS NULL AND name = 'Sanrio Co.';
-- Saputo  ->  cik 2072563  SEC 'Saputo Inc./ADR'  [sec_conformed]  tickers=['SAPUY', 'SAPIF']
UPDATE companies SET sec_cik = 2072563
 WHERE id = '11fa29e1-245c-4466-9358-734fd14b1a61'::uuid AND sec_cik IS NULL AND name = 'Saputo';
-- Satellogic  ->  cik 1874315  SEC 'Satellogic Inc.'  [sec_conformed]  tickers=['SATL', 'SATLW']
UPDATE companies SET sec_cik = 1874315
 WHERE id = '0d058698-c50f-4677-a235-2d0dc49b7e06'::uuid AND sec_cik IS NULL AND name = 'Satellogic';
-- Schindler Holding  ->  cik 1655190  SEC 'Schindler Holding AG/ADR'  [sec_conformed]  tickers=['SHLAF', 'SHLRF']
UPDATE companies SET sec_cik = 1655190
 WHERE id = '7be1499a-1c1b-46e9-b5e4-d99d141ed968'::uuid AND sec_cik IS NULL AND name = 'Schindler Holding';
-- Scholastic  ->  cik 866729  SEC 'SCHOLASTIC CORP'  [sec_conformed]  tickers=['SCHL']
UPDATE companies SET sec_cik = 866729
 WHERE id = '4bff9990-bfbc-4dc7-802e-0d94eb7b5fae'::uuid AND sec_cik IS NULL AND name = 'Scholastic';
-- Scotts Miracle Gro  ->  cik 825542  SEC 'SCOTTS MIRACLE-GRO CO'  [sec_conformed]  tickers=['SMG']
UPDATE companies SET sec_cik = 825542
 WHERE id = 'c8450765-3a17-4ddf-91ac-fab5b440ffe6'::uuid AND sec_cik IS NULL AND name = 'Scotts Miracle Gro';
-- Seaboard Corporation  ->  cik 88121  SEC 'SEABOARD CORP /DE/'  [sec_conformed]  tickers=['SEB']
UPDATE companies SET sec_cik = 88121
 WHERE id = '83d32041-2613-48bf-bb59-76059e182cbf'::uuid AND sec_cik IS NULL AND name = 'Seaboard Corporation';
-- Senior  ->  cik 1329213  SEC 'SENIOR PLC'  [sec_conformed]  tickers=['SNIRF']
UPDATE companies SET sec_cik = 1329213
 WHERE id = '1db94c42-0cfe-44df-ac10-f21cbf05e8bf'::uuid AND sec_cik IS NULL AND name = 'Senior';
-- SentinelOne  ->  cik 1583708  SEC 'SentinelOne, Inc.'  [sec_conformed]  tickers=['S']
UPDATE companies SET sec_cik = 1583708
 WHERE id = 'd9e0999c-c46c-4c38-8107-e751f0f3ee0c'::uuid AND sec_cik IS NULL AND name = 'SentinelOne';
-- SERES Group  ->  cik 2099326  SEC 'Seres Group Co., Ltd./ADR'  [sec_conformed]  tickers=['SGPIY']
UPDATE companies SET sec_cik = 2099326
 WHERE id = '30549cbb-f336-48ae-b076-1b9b175e07d4'::uuid AND sec_cik IS NULL AND name = 'SERES Group';
-- Seven & i  ->  cik 1359519  SEC 'SEVEN & I HOLDINGS CO LTD'  [sec_conformed]  tickers=['SVNDF']
UPDATE companies SET sec_cik = 1359519
 WHERE id = '6b4394fa-73e5-4d03-95d5-8e6579f50eaa'::uuid AND sec_cik IS NULL AND name = 'Seven & i';
-- Sezzle  ->  cik 1662991  SEC 'Sezzle Inc.'  [sec_conformed]  tickers=['SEZL']
UPDATE companies SET sec_cik = 1662991
 WHERE id = '4947cb79-5a75-455a-9b9b-851eb95f3214'::uuid AND sec_cik IS NULL AND name = 'Sezzle';
-- Shenandoah Telecommunications  ->  cik 354963  SEC 'SHENANDOAH TELECOMMUNICATIONS CO/VA/'  [sec_conformed]  tickers=['SHEN']
UPDATE companies SET sec_cik = 354963
 WHERE id = '2d1b70cb-63c2-4a4e-aaf4-d26f4a6e36a3'::uuid AND sec_cik IS NULL AND name = 'Shenandoah Telecommunications';
-- Siemens Energy AG  ->  cik 1830056  SEC 'Siemens Energy AG/ADR'  [sec_conformed]  tickers=['SMERY', 'SMEGF']
UPDATE companies SET sec_cik = 1830056
 WHERE id = '241855bc-8a02-4925-a302-15bf56ef72ca'::uuid AND sec_cik IS NULL AND name = 'Siemens Energy AG';
-- Sienna Senior Living  ->  cik 2073972  SEC 'Sienna Senior Living Inc./ADR'  [sec_conformed]  tickers=['SSRLY', 'LWSCF']
UPDATE companies SET sec_cik = 2073972
 WHERE id = 'e59aafc5-33c7-4471-8def-b002a3648ba0'::uuid AND sec_cik IS NULL AND name = 'Sienna Senior Living';
-- Simon Property Group  ->  cik 1063761  SEC 'SIMON PROPERTY GROUP INC.'  [sec_conformed]  tickers=['SPG', 'SPG-PJ']
UPDATE companies SET sec_cik = 1063761
 WHERE id = 'a7b00468-88cb-47f8-8462-e51c50a80ce1'::uuid AND sec_cik IS NULL AND name = 'Simon Property Group';
-- SK Hynix  ->  cik 2120882  SEC 'SK hynix Inc.'  [sec_conformed]  tickers=['SKHY', 'HXSCL', 'SKHYV']
UPDATE companies SET sec_cik = 2120882
 WHERE id = '739114ed-f904-4ed2-b090-da090c80a122'::uuid AND sec_cik IS NULL AND name = 'SK Hynix';
-- Sleep Number  ->  cik 827187  SEC 'Sleep Number Corp'  [sec_conformed]  tickers=['SNBRQ', 'SNBR']
UPDATE companies SET sec_cik = 827187
 WHERE id = 'a5e48aa4-2fea-4660-88a8-74151b9129de'::uuid AND sec_cik IS NULL AND name = 'Sleep Number';
-- SLM  ->  cik 1032033  SEC 'SLM Corp'  [sec_conformed]  tickers=['SLM', 'SLMBP']
UPDATE companies SET sec_cik = 1032033
 WHERE id = '9f10477f-88cc-40d5-8c45-f6e5383f24ca'::uuid AND sec_cik IS NULL AND name = 'SLM';
-- Snap-On  ->  cik 91440  SEC 'Snap-on Inc'  [sec_conformed]  tickers=['SNA']
UPDATE companies SET sec_cik = 91440
 WHERE id = 'd06bb656-6bc5-4337-8ba0-17a7746419f6'::uuid AND sec_cik IS NULL AND name = 'Snap-On';
-- Southern Company  ->  cik 92122  SEC 'SOUTHERN CO'  [sec_conformed]  tickers=['SO', 'SOJC', 'SOJD']
UPDATE companies SET sec_cik = 92122
 WHERE id = '61f35ec9-5e80-415f-bcc2-5eb524280647'::uuid AND sec_cik IS NULL AND name = 'Southern Company';
-- Sportsman's Warehouse  ->  cik 1132105  SEC "SPORTSMAN'S WAREHOUSE HOLDINGS, INC."  [sec_conformed]  tickers=['SPWH']
UPDATE companies SET sec_cik = 1132105
 WHERE id = '719162d5-fb07-4b65-a49e-74ecd517a294'::uuid AND sec_cik IS NULL AND name = 'Sportsman''s Warehouse';
-- STAAR Surgical  ->  cik 718937  SEC 'STAAR SURGICAL CO'  [sec_conformed]  tickers=['STAA']
UPDATE companies SET sec_cik = 718937
 WHERE id = 'f5000e8a-c09b-434d-a27c-cc9aadf362c2'::uuid AND sec_cik IS NULL AND name = 'STAAR Surgical';
-- Standex International  ->  cik 310354  SEC 'STANDEX INTERNATIONAL CORP/DE/'  [sec_conformed]  tickers=['SXI']
UPDATE companies SET sec_cik = 310354
 WHERE id = '405a81b8-8c47-4b7a-9a76-24758d41c564'::uuid AND sec_cik IS NULL AND name = 'Standex International';
-- Stanley Black & Decker  ->  cik 93556  SEC 'STANLEY BLACK & DECKER, INC.'  [sec_conformed]  tickers=['SWK']
UPDATE companies SET sec_cik = 93556
 WHERE id = 'fd1351a0-d811-48a5-9f3c-fd01b1dde8ab'::uuid AND sec_cik IS NULL AND name = 'Stanley Black & Decker';
-- Stellantis  ->  cik 1605484  SEC 'Stellantis N.V.'  [sec_conformed]  tickers=['STLA']
UPDATE companies SET sec_cik = 1605484
 WHERE id = 'd6fc81e5-4385-4bb4-9a76-e4bde69615f6'::uuid AND sec_cik IS NULL AND name = 'Stellantis';
-- STERIS plc  ->  cik 1757898  SEC 'STERIS plc'  [sec_conformed]  tickers=['STE']
UPDATE companies SET sec_cik = 1757898
 WHERE id = '26332896-381c-453b-9531-309eb9e06a16'::uuid AND sec_cik IS NULL AND name = 'STERIS plc';
-- SUGI Holdings  ->  cik 2027330  SEC 'Sugi Holdings Co., Ltd./ADR'  [sec_conformed]  tickers=['SGIHY', 'SGIPF']
UPDATE companies SET sec_cik = 2027330
 WHERE id = 'da85cb35-4c61-4bcc-9ec2-ca264fbacb66'::uuid AND sec_cik IS NULL AND name = 'SUGI Holdings';
-- Sun Life Financial Inc.  ->  cik 1097362  SEC 'SUN LIFE FINANCIAL INC'  [sec_conformed]  tickers=['SLF', 'SLFIF', 'SLFQF']
UPDATE companies SET sec_cik = 1097362
 WHERE id = '6bf829c4-a700-49e9-be97-5d3998f97c3c'::uuid AND sec_cik IS NULL AND name = 'Sun Life Financial Inc.';
-- Sunbelt Rentals Holdings  ->  cik 2083785  SEC 'Sunbelt Rentals Holdings, Inc.'  [sec_conformed]  tickers=['SUNB']
UPDATE companies SET sec_cik = 2083785
 WHERE id = '385df117-4ad2-4f59-a0f9-d75f6b7a1e06'::uuid AND sec_cik IS NULL AND name = 'Sunbelt Rentals Holdings';
-- SunCoke Energy  ->  cik 1514705  SEC 'SunCoke Energy, Inc.'  [sec_conformed]  tickers=['SXC']
UPDATE companies SET sec_cik = 1514705
 WHERE id = 'ea202e9d-1efa-4fd3-ac0f-49a06e0c2d0e'::uuid AND sec_cik IS NULL AND name = 'SunCoke Energy';
-- SunPower Inc.  ->  cik 1838987  SEC 'SunPower Inc.'  [sec_conformed]  tickers=['SPWR', 'SPWRW']
UPDATE companies SET sec_cik = 1838987
 WHERE id = '8fa256fd-b9e0-4239-a157-e73039a5d837'::uuid AND sec_cik IS NULL AND name = 'SunPower Inc.';
-- Supernus Pharmaceuticals  ->  cik 1356576  SEC 'SUPERNUS PHARMACEUTICALS, INC.'  [sec_conformed]  tickers=['SUPN']
UPDATE companies SET sec_cik = 1356576
 WHERE id = '9f7aa6be-e52a-4eaf-9fd0-d922104ceb0f'::uuid AND sec_cik IS NULL AND name = 'Supernus Pharmaceuticals';
-- Symbotic  ->  cik 1837240  SEC 'Symbotic Inc.'  [sec_conformed]  tickers=['SYM']
UPDATE companies SET sec_cik = 1837240
 WHERE id = 'c70f7f3d-00bf-464b-9698-5932cac284c2'::uuid AND sec_cik IS NULL AND name = 'Symbotic';
-- Sysco Corporation  ->  cik 96021  SEC 'SYSCO CORP'  [sec_conformed]  tickers=['SYY']
UPDATE companies SET sec_cik = 96021
 WHERE id = '5197d4d6-3372-438b-9d13-df19f87acc57'::uuid AND sec_cik IS NULL AND name = 'Sysco Corporation';

-- READ-BACK for block 7. Raises, and therefore rolls the whole block back,
-- if fewer than 50 of these rows now carry their intended CIK.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM companies c
  JOIN (VALUES
    ('2cc8f498-c5fa-4331-9cea-e725b0a36c07'::uuid, 315852),
    ('aa5de138-64e8-411f-8a00-710dfc83e16e'::uuid, 935419),
    ('297e8905-5f6d-452e-935c-131fdc458143'::uuid, 700841),
    ('e6e7dd83-a925-4e00-aec9-bec1efcd3e9b'::uuid, 82811),
    ('a61582b6-31c6-4d73-beea-64777536135a'::uuid, 1281761),
    ('e259fc86-df8e-40fd-88d6-0e727f618641'::uuid, 1812364),
    ('d46d4777-125a-4086-91c1-801931500b63'::uuid, 1618756),
    ('d99e526f-da24-4a6c-bfd6-d2abe302a1d9'::uuid, 1628171),
    ('91fac195-6964-4678-a604-0fe928c8317f'::uuid, 1786431),
    ('21c052bc-e0a5-440a-bf1b-2878fa703737'::uuid, 355948),
    ('578eb178-f386-4a42-84c6-ee5a5025de67'::uuid, 2141099),
    ('3c928d59-e582-4092-a47f-77a802db17ef'::uuid, 1516536),
    ('1309723d-2375-4157-9c60-00a3686eb3d0'::uuid, 1281895),
    ('3606bab5-31fd-49fa-9724-13327dedf325'::uuid, 1969729),
    ('605896b7-a928-4e62-bd02-c6727a651c1a'::uuid, 1770114),
    ('716042ea-dd3a-4a7f-bad3-27c2cd6b201d'::uuid, 1584273),
    ('11fa29e1-245c-4466-9358-734fd14b1a61'::uuid, 2072563),
    ('0d058698-c50f-4677-a235-2d0dc49b7e06'::uuid, 1874315),
    ('7be1499a-1c1b-46e9-b5e4-d99d141ed968'::uuid, 1655190),
    ('4bff9990-bfbc-4dc7-802e-0d94eb7b5fae'::uuid, 866729),
    ('c8450765-3a17-4ddf-91ac-fab5b440ffe6'::uuid, 825542),
    ('83d32041-2613-48bf-bb59-76059e182cbf'::uuid, 88121),
    ('1db94c42-0cfe-44df-ac10-f21cbf05e8bf'::uuid, 1329213),
    ('d9e0999c-c46c-4c38-8107-e751f0f3ee0c'::uuid, 1583708),
    ('30549cbb-f336-48ae-b076-1b9b175e07d4'::uuid, 2099326),
    ('6b4394fa-73e5-4d03-95d5-8e6579f50eaa'::uuid, 1359519),
    ('4947cb79-5a75-455a-9b9b-851eb95f3214'::uuid, 1662991),
    ('2d1b70cb-63c2-4a4e-aaf4-d26f4a6e36a3'::uuid, 354963),
    ('241855bc-8a02-4925-a302-15bf56ef72ca'::uuid, 1830056),
    ('e59aafc5-33c7-4471-8def-b002a3648ba0'::uuid, 2073972),
    ('a7b00468-88cb-47f8-8462-e51c50a80ce1'::uuid, 1063761),
    ('739114ed-f904-4ed2-b090-da090c80a122'::uuid, 2120882),
    ('a5e48aa4-2fea-4660-88a8-74151b9129de'::uuid, 827187),
    ('9f10477f-88cc-40d5-8c45-f6e5383f24ca'::uuid, 1032033),
    ('d06bb656-6bc5-4337-8ba0-17a7746419f6'::uuid, 91440),
    ('61f35ec9-5e80-415f-bcc2-5eb524280647'::uuid, 92122),
    ('719162d5-fb07-4b65-a49e-74ecd517a294'::uuid, 1132105),
    ('f5000e8a-c09b-434d-a27c-cc9aadf362c2'::uuid, 718937),
    ('405a81b8-8c47-4b7a-9a76-24758d41c564'::uuid, 310354),
    ('fd1351a0-d811-48a5-9f3c-fd01b1dde8ab'::uuid, 93556),
    ('d6fc81e5-4385-4bb4-9a76-e4bde69615f6'::uuid, 1605484),
    ('26332896-381c-453b-9531-309eb9e06a16'::uuid, 1757898),
    ('da85cb35-4c61-4bcc-9ec2-ca264fbacb66'::uuid, 2027330),
    ('6bf829c4-a700-49e9-be97-5d3998f97c3c'::uuid, 1097362),
    ('385df117-4ad2-4f59-a0f9-d75f6b7a1e06'::uuid, 2083785),
    ('ea202e9d-1efa-4fd3-ac0f-49a06e0c2d0e'::uuid, 1514705),
    ('8fa256fd-b9e0-4239-a157-e73039a5d837'::uuid, 1838987),
    ('9f7aa6be-e52a-4eaf-9fd0-d922104ceb0f'::uuid, 1356576),
    ('c70f7f3d-00bf-464b-9698-5932cac284c2'::uuid, 1837240),
    ('5197d4d6-3372-438b-9d13-df19f87acc57'::uuid, 96021)
  ) AS w(id, cik) ON w.id = c.id AND c.sec_cik = w.cik;
  IF n <> 50 THEN
    RAISE EXCEPTION 'block 7 read-back failed: expected 50 stamped rows, got %', n;
  END IF;
END $$;

COMMIT;   -- to abandon block 7 instead, replace this line with: ROLLBACK;

-- ============================================================================
-- BLOCK 8 of 9. 50 rows.
-- ============================================================================
BEGIN;

-- Tapestry  ->  cik 1116132  SEC 'TAPESTRY, INC.'  [sec_conformed]  tickers=['TPR']
UPDATE companies SET sec_cik = 1116132
 WHERE id = 'd736cdce-bc42-4db0-972e-ff2a6ad7005e'::uuid AND sec_cik IS NULL AND name = 'Tapestry';
-- TC Energy  ->  cik 1232384  SEC 'TC ENERGY CORP'  [sec_conformed]  tickers=['TRP', 'TNCAF', 'TCANF']
UPDATE companies SET sec_cik = 1232384
 WHERE id = 'f8c84465-b957-465b-bd58-80880a338238'::uuid AND sec_cik IS NULL AND name = 'TC Energy';
-- TCL Electronics Holdings Ltd.  ->  cik 2073804  SEC 'TCL Electronics Holdings Limited/ADR'  [sec_conformed]  tickers=['TCLXY', 'TCLHF']
UPDATE companies SET sec_cik = 2073804
 WHERE id = 'fe8dc90b-c0ef-4ec2-be1a-1d3705814308'::uuid AND sec_cik IS NULL AND name = 'TCL Electronics Holdings Ltd.';
-- TechTarget  ->  cik 2018064  SEC 'TechTarget, Inc.'  [sec_conformed]  tickers=['TTGT']
UPDATE companies SET sec_cik = 2018064
 WHERE id = '167db014-da2a-410c-a62b-ef3368104f8e'::uuid AND sec_cik IS NULL AND name = 'TechTarget';
-- Telecom Argentina S.A.  ->  cik 932470  SEC 'TELECOM ARGENTINA SA'  [sec_conformed]  tickers=['TEO', 'TCMFF']
UPDATE companies SET sec_cik = 932470
 WHERE id = '2c74abbe-e907-43a9-82be-6751ea0c9d60'::uuid AND sec_cik IS NULL AND name = 'Telecom Argentina S.A.';
-- Teleflex  ->  cik 96943  SEC 'TELEFLEX INC'  [sec_conformed]  tickers=['TFX']
UPDATE companies SET sec_cik = 96943
 WHERE id = '1578dfe7-8480-40ef-9339-13729b95a04c'::uuid AND sec_cik IS NULL AND name = 'Teleflex';
-- Tenaris S.A.  ->  cik 1190723  SEC 'TENARIS SA'  [sec_conformed]  tickers=['TS', 'TNRSF']
UPDATE companies SET sec_cik = 1190723
 WHERE id = 'ef109d38-7e8b-4612-a17b-e066e38592b7'::uuid AND sec_cik IS NULL AND name = 'Tenaris S.A.';
-- Tenet Healthcare  ->  cik 70318  SEC 'TENET HEALTHCARE CORP'  [sec_conformed]  tickers=['THC']
UPDATE companies SET sec_cik = 70318
 WHERE id = '6ac8b247-41ad-46cc-96c2-441531cba199'::uuid AND sec_cik IS NULL AND name = 'Tenet Healthcare';
-- Terex  ->  cik 97216  SEC 'TEREX CORP'  [sec_conformed]  tickers=['TEX']
UPDATE companies SET sec_cik = 97216
 WHERE id = 'b2929002-0c21-45f1-bc9d-5805832f0f30'::uuid AND sec_cik IS NULL AND name = 'Terex';
-- Ternium  ->  cik 1342874  SEC 'Ternium S.A.'  [sec_conformed]  tickers=['TX']
UPDATE companies SET sec_cik = 1342874
 WHERE id = 'ab5f7bd9-9e67-4125-a202-42995be17467'::uuid AND sec_cik IS NULL AND name = 'Ternium';
-- The Bank of New York Mellon Corporation  ->  cik 1390777  SEC 'Bank of New York Mellon Corp'  [sec_conformed]  tickers=['BNY', 'BNY-PK', 'BK-PK']
UPDATE companies SET sec_cik = 1390777
 WHERE id = 'de956e7f-ad0e-4306-bc27-7493ceae213e'::uuid AND sec_cik IS NULL AND name = 'The Bank of New York Mellon Corporation';
-- The Clorox Company  ->  cik 21076  SEC 'CLOROX CO /DE/'  [sec_conformed]  tickers=['CLX']
UPDATE companies SET sec_cik = 21076
 WHERE id = '4aadbf7c-dea5-45c6-a27e-e2aa58c818d3'::uuid AND sec_cik IS NULL AND name = 'The Clorox Company';
-- The Coca-Cola Company  ->  cik 21344  SEC 'COCA COLA CO'  [sec_conformed]  tickers=['KO']
UPDATE companies SET sec_cik = 21344
 WHERE id = 'f1637f00-e16b-4b3d-8848-2f0bc13e89ab'::uuid AND sec_cik IS NULL AND name = 'The Coca-Cola Company';
-- The North West Company Inc.  ->  cik 2073913  SEC 'North West Co Inc./ADR'  [sec_conformed]  tickers=['NWCYY', 'NNWWF']
UPDATE companies SET sec_cik = 2073913
 WHERE id = 'de512bb5-1b76-4ed2-9b28-be753a137c85'::uuid AND sec_cik IS NULL AND name = 'The North West Company Inc.';
-- The Real Brokerage  ->  cik 1862461  SEC 'Real Brokerage Inc'  [sec_conformed]  tickers=['REAX']
UPDATE companies SET sec_cik = 1862461
 WHERE id = 'ccc765d7-7682-4375-8e8a-03b76e5bc864'::uuid AND sec_cik IS NULL AND name = 'The Real Brokerage';
-- Theravance Biopharma  ->  cik 1583107  SEC 'Theravance Biopharma, Inc.'  [sec_conformed]  tickers=['TBPH']
UPDATE companies SET sec_cik = 1583107
 WHERE id = 'e2fc418e-e6bd-42e0-a5d9-9e863fa98740'::uuid AND sec_cik IS NULL AND name = 'Theravance Biopharma';
-- Thomson Reuters  ->  cik 1075124  SEC 'THOMSON REUTERS CORP /CAN/'  [sec_conformed]  tickers=['TRI', 'TMSOF']
UPDATE companies SET sec_cik = 1075124
 WHERE id = 'db6cc338-dac6-47b3-b92c-c450237da720'::uuid AND sec_cik IS NULL AND name = 'Thomson Reuters';
-- TJX Companies  ->  cik 109198  SEC 'TJX COMPANIES INC /DE/'  [sec_conformed]  tickers=['TJX']
UPDATE companies SET sec_cik = 109198
 WHERE id = '7e07a5e3-2dfc-48cc-9be0-591a68fc562d'::uuid AND sec_cik IS NULL AND name = 'TJX Companies';
-- TOP Ships  ->  cik 1296484  SEC 'TOP SHIPS INC.'  [sec_conformed]  tickers=['TOPS']
UPDATE companies SET sec_cik = 1296484
 WHERE id = '4360821d-ee3d-4011-a0fc-c3a9bd43795f'::uuid AND sec_cik IS NULL AND name = 'TOP Ships';
-- Toromont Industries  ->  cik 2072098  SEC 'Toromont Industries Ltd./ADR'  [sec_conformed]  tickers=['TMTNY', 'TMTNF']
UPDATE companies SET sec_cik = 2072098
 WHERE id = '9423568b-b714-4712-b00b-d3df657b3c86'::uuid AND sec_cik IS NULL AND name = 'Toromont Industries';
-- Toronto-Dominion Bank  ->  cik 947263  SEC 'TORONTO DOMINION BANK'  [sec_conformed]  tickers=['TD', 'TDBCP']
UPDATE companies SET sec_cik = 947263
 WHERE id = '3d0f92ad-438b-4e93-bc4e-70435c683ae0'::uuid AND sec_cik IS NULL AND name = 'Toronto-Dominion Bank';
-- Tourmaline Oil  ->  cik 2071881  SEC 'Tourmaline Oil Corp/ADR'  [sec_conformed]  tickers=['TRMOY', 'TRMLF']
UPDATE companies SET sec_cik = 2071881
 WHERE id = 'caea5b7a-6514-4503-a4ba-20ce91b117f4'::uuid AND sec_cik IS NULL AND name = 'Tourmaline Oil';
-- Toyota Tsusho  ->  cik 2018139  SEC 'Toyota Tsusho Corporation/ADR'  [sec_conformed]  tickers=['TYHOY', 'TYHOF']
UPDATE companies SET sec_cik = 2018139
 WHERE id = '1343ae1f-6dd7-4560-a550-eff5ff39e85e'::uuid AND sec_cik IS NULL AND name = 'Toyota Tsusho';
-- Travelzoo  ->  cik 1133311  SEC 'TRAVELZOO'  [sec_conformed]  tickers=['TZOO']
UPDATE companies SET sec_cik = 1133311
 WHERE id = 'aca318ba-d3ca-4dd8-be52-f31e57025cfb'::uuid AND sec_cik IS NULL AND name = 'Travelzoo';
-- TTEC  ->  cik 1013880  SEC 'TTEC Holdings, Inc.'  [sec_conformed]  tickers=['TTEC']
UPDATE companies SET sec_cik = 1013880
 WHERE id = 'ac6365c2-9955-4504-bf49-a733efadfa83'::uuid AND sec_cik IS NULL AND name = 'TTEC';
-- Tyson Foods Inc.  ->  cik 100493  SEC 'TYSON FOODS, INC.'  [sec_conformed]  tickers=['TSN']
UPDATE companies SET sec_cik = 100493
 WHERE id = '489ba2a2-8ee9-48f9-8701-a1a2c0f93226'::uuid AND sec_cik IS NULL AND name = 'Tyson Foods Inc.';
-- U-Haul  ->  cik 4457  SEC 'U-Haul Holding Co /NV/'  [sec_conformed]  tickers=['UHAL', 'UHAL-B']
UPDATE companies SET sec_cik = 4457
 WHERE id = '9246ed54-0562-43ca-9ce2-7050f70cc3e0'::uuid AND sec_cik IS NULL AND name = 'U-Haul';
-- UL Solutions  ->  cik 1901440  SEC 'UL Solutions Inc.'  [sec_conformed]  tickers=['ULS']
UPDATE companies SET sec_cik = 1901440
 WHERE id = 'aa0ee2df-d4c9-489c-bc58-6c2bbe22f7f0'::uuid AND sec_cik IS NULL AND name = 'UL Solutions';
-- UniQure  ->  cik 1590560  SEC 'uniQure N.V.'  [sec_conformed]  tickers=['QURE']
UPDATE companies SET sec_cik = 1590560
 WHERE id = '2cbacff6-1fbc-475d-8d1d-24c946ef998a'::uuid AND sec_cik IS NULL AND name = 'UniQure';
-- Universal  ->  cik 102037  SEC 'UNIVERSAL CORP /VA/'  [sec_conformed]  tickers=['UVV']
UPDATE companies SET sec_cik = 102037
 WHERE id = '8269b20e-3b7c-4c70-9db8-ffc7f98eccc5'::uuid AND sec_cik IS NULL AND name = 'Universal';
-- Universal Music Group  ->  cik 1890126  SEC 'Universal Music Group N.V./ADR'  [sec_conformed]  tickers=['UNVGY', 'UMGNF']
UPDATE companies SET sec_cik = 1890126
 WHERE id = '5cf12072-1453-4b74-b255-8194abcc811a'::uuid AND sec_cik IS NULL AND name = 'Universal Music Group';
-- Upstart  ->  cik 1647639  SEC 'Upstart Holdings, Inc.'  [sec_conformed]  tickers=['UPST']
UPDATE companies SET sec_cik = 1647639
 WHERE id = 'c8da1917-c5d9-4456-a0fc-b32aaff685ed'::uuid AND sec_cik IS NULL AND name = 'Upstart';
-- URBAN OUTFITTERS  ->  cik 912615  SEC 'URBAN OUTFITTERS INC'  [sec_conformed]  tickers=['URBN']
UPDATE companies SET sec_cik = 912615
 WHERE id = '710be30a-b3d9-4fd9-b41c-d1f8e1ef8bb5'::uuid AND sec_cik IS NULL AND name = 'URBAN OUTFITTERS';
-- Varex Imaging  ->  cik 1681622  SEC 'Varex Imaging Corp'  [sec_conformed]  tickers=['VREX']
UPDATE companies SET sec_cik = 1681622
 WHERE id = '0d909849-3e6e-47bd-afee-a148720e1882'::uuid AND sec_cik IS NULL AND name = 'Varex Imaging';
-- Veeco Instruments  ->  cik 103145  SEC 'VEECO INSTRUMENTS INC'  [sec_conformed]  tickers=['VECO']
UPDATE companies SET sec_cik = 103145
 WHERE id = '54e98259-ba14-4663-88de-24802a36e1a6'::uuid AND sec_cik IS NULL AND name = 'Veeco Instruments';
-- Veradermics  ->  cik 1827635  SEC 'Veradermics, Inc'  [sec_conformed]  tickers=['MANE']
UPDATE companies SET sec_cik = 1827635
 WHERE id = 'b12bcf3d-bfb9-4155-b6f4-95ea20992567'::uuid AND sec_cik IS NULL AND name = 'Veradermics';
-- Verastem  ->  cik 1526119  SEC 'Verastem, Inc.'  [sec_conformed]  tickers=['VSTM']
UPDATE companies SET sec_cik = 1526119
 WHERE id = '506e6c0d-694a-42ae-a05a-fcf08bbbdf9b'::uuid AND sec_cik IS NULL AND name = 'Verastem';
-- VeriSign  ->  cik 1014473  SEC 'VERISIGN INC/CA'  [sec_conformed]  tickers=['VRSN']
UPDATE companies SET sec_cik = 1014473
 WHERE id = '888c2878-2d15-46e3-8cd6-7931a97f8832'::uuid AND sec_cik IS NULL AND name = 'VeriSign';
-- Viatris  ->  cik 1792044  SEC 'Viatris Inc'  [sec_conformed]  tickers=['VTRS']
UPDATE companies SET sec_cik = 1792044
 WHERE id = 'ad2aeea8-f10f-4762-97d4-f600825c0882'::uuid AND sec_cik IS NULL AND name = 'Viatris';
-- Victory Giant Technology Huizhou Co.  ->  cik 2131322  SEC 'Victory Giant Technology (HuiZhou) Co., Ltd./ADR'  [sec_conformed]  tickers=['VGTHY']
UPDATE companies SET sec_cik = 2131322
 WHERE id = 'c3795820-d180-47b7-9642-4c1f118f392e'::uuid AND sec_cik IS NULL AND name = 'Victory Giant Technology Huizhou Co.';
-- Vistra  ->  cik 1692819  SEC 'Vistra Corp.'  [sec_conformed]  tickers=['VST']
UPDATE companies SET sec_cik = 1692819
 WHERE id = '56d52735-3393-4b3a-ba6d-81f575cec5ab'::uuid AND sec_cik IS NULL AND name = 'Vistra';
-- Vulcan Materials  ->  cik 1396009  SEC 'Vulcan Materials CO'  [sec_conformed]  tickers=['VMC']
UPDATE companies SET sec_cik = 1396009
 WHERE id = 'c2d2e34e-5b18-4b1b-b7f5-4a2b0d41f901'::uuid AND sec_cik IS NULL AND name = 'Vulcan Materials';
-- Warner Music Group  ->  cik 1319161  SEC 'Warner Music Group Corp.'  [sec_conformed]  tickers=['WMG']
UPDATE companies SET sec_cik = 1319161
 WHERE id = 'b44a9095-121c-46de-b24e-1b9225b5f394'::uuid AND sec_cik IS NULL AND name = 'Warner Music Group';
-- Warrior Met Coal  ->  cik 1691303  SEC 'WARRIOR MET COAL, INC.'  [sec_conformed]  tickers=['HCC']
UPDATE companies SET sec_cik = 1691303
 WHERE id = '4e279f36-4b1b-4385-a24e-36af8c9e2a76'::uuid AND sec_cik IS NULL AND name = 'Warrior Met Coal';
-- Watsco  ->  cik 105016  SEC 'WATSCO INC'  [sec_conformed]  tickers=['WSO', 'WSO-B']
UPDATE companies SET sec_cik = 105016
 WHERE id = '840c83e1-ebc5-423e-8614-c42a526301cf'::uuid AND sec_cik IS NULL AND name = 'Watsco';
-- Weatherford International  ->  cik 1603923  SEC 'Weatherford International plc'  [sec_conformed]  tickers=['WFRD']
UPDATE companies SET sec_cik = 1603923
 WHERE id = 'a1ad9acb-927e-42a7-8566-0c31c44eefbd'::uuid AND sec_cik IS NULL AND name = 'Weatherford International';
-- Wendy’s  ->  cik 30697  SEC "Wendy's Co"  [sec_conformed]  tickers=['WEN']
UPDATE companies SET sec_cik = 30697
 WHERE id = 'd39d3d5e-3846-4432-9f4a-841794887f77'::uuid AND sec_cik IS NULL AND name = 'Wendy’s';
-- West Pharmaceutical Services  ->  cik 105770  SEC 'WEST PHARMACEUTICAL SERVICES INC'  [sec_conformed]  tickers=['WST']
UPDATE companies SET sec_cik = 105770
 WHERE id = '27390e0d-135f-45b3-8486-93d176923a46'::uuid AND sec_cik IS NULL AND name = 'West Pharmaceutical Services';
-- Weyco Group  ->  cik 106532  SEC 'WEYCO GROUP INC'  [sec_conformed]  tickers=['WEYS']
UPDATE companies SET sec_cik = 106532
 WHERE id = 'a0f3ef56-c6d6-460c-8f0e-5b9279fc1c73'::uuid AND sec_cik IS NULL AND name = 'Weyco Group';
-- Williams Companies  ->  cik 107263  SEC 'WILLIAMS COMPANIES, INC.'  [sec_conformed]  tickers=['WMB']
UPDATE companies SET sec_cik = 107263
 WHERE id = 'aaf76c33-66e1-4cf6-903d-d8f87ca06026'::uuid AND sec_cik IS NULL AND name = 'Williams Companies';

-- READ-BACK for block 8. Raises, and therefore rolls the whole block back,
-- if fewer than 50 of these rows now carry their intended CIK.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM companies c
  JOIN (VALUES
    ('d736cdce-bc42-4db0-972e-ff2a6ad7005e'::uuid, 1116132),
    ('f8c84465-b957-465b-bd58-80880a338238'::uuid, 1232384),
    ('fe8dc90b-c0ef-4ec2-be1a-1d3705814308'::uuid, 2073804),
    ('167db014-da2a-410c-a62b-ef3368104f8e'::uuid, 2018064),
    ('2c74abbe-e907-43a9-82be-6751ea0c9d60'::uuid, 932470),
    ('1578dfe7-8480-40ef-9339-13729b95a04c'::uuid, 96943),
    ('ef109d38-7e8b-4612-a17b-e066e38592b7'::uuid, 1190723),
    ('6ac8b247-41ad-46cc-96c2-441531cba199'::uuid, 70318),
    ('b2929002-0c21-45f1-bc9d-5805832f0f30'::uuid, 97216),
    ('ab5f7bd9-9e67-4125-a202-42995be17467'::uuid, 1342874),
    ('de956e7f-ad0e-4306-bc27-7493ceae213e'::uuid, 1390777),
    ('4aadbf7c-dea5-45c6-a27e-e2aa58c818d3'::uuid, 21076),
    ('f1637f00-e16b-4b3d-8848-2f0bc13e89ab'::uuid, 21344),
    ('de512bb5-1b76-4ed2-9b28-be753a137c85'::uuid, 2073913),
    ('ccc765d7-7682-4375-8e8a-03b76e5bc864'::uuid, 1862461),
    ('e2fc418e-e6bd-42e0-a5d9-9e863fa98740'::uuid, 1583107),
    ('db6cc338-dac6-47b3-b92c-c450237da720'::uuid, 1075124),
    ('7e07a5e3-2dfc-48cc-9be0-591a68fc562d'::uuid, 109198),
    ('4360821d-ee3d-4011-a0fc-c3a9bd43795f'::uuid, 1296484),
    ('9423568b-b714-4712-b00b-d3df657b3c86'::uuid, 2072098),
    ('3d0f92ad-438b-4e93-bc4e-70435c683ae0'::uuid, 947263),
    ('caea5b7a-6514-4503-a4ba-20ce91b117f4'::uuid, 2071881),
    ('1343ae1f-6dd7-4560-a550-eff5ff39e85e'::uuid, 2018139),
    ('aca318ba-d3ca-4dd8-be52-f31e57025cfb'::uuid, 1133311),
    ('ac6365c2-9955-4504-bf49-a733efadfa83'::uuid, 1013880),
    ('489ba2a2-8ee9-48f9-8701-a1a2c0f93226'::uuid, 100493),
    ('9246ed54-0562-43ca-9ce2-7050f70cc3e0'::uuid, 4457),
    ('aa0ee2df-d4c9-489c-bc58-6c2bbe22f7f0'::uuid, 1901440),
    ('2cbacff6-1fbc-475d-8d1d-24c946ef998a'::uuid, 1590560),
    ('8269b20e-3b7c-4c70-9db8-ffc7f98eccc5'::uuid, 102037),
    ('5cf12072-1453-4b74-b255-8194abcc811a'::uuid, 1890126),
    ('c8da1917-c5d9-4456-a0fc-b32aaff685ed'::uuid, 1647639),
    ('710be30a-b3d9-4fd9-b41c-d1f8e1ef8bb5'::uuid, 912615),
    ('0d909849-3e6e-47bd-afee-a148720e1882'::uuid, 1681622),
    ('54e98259-ba14-4663-88de-24802a36e1a6'::uuid, 103145),
    ('b12bcf3d-bfb9-4155-b6f4-95ea20992567'::uuid, 1827635),
    ('506e6c0d-694a-42ae-a05a-fcf08bbbdf9b'::uuid, 1526119),
    ('888c2878-2d15-46e3-8cd6-7931a97f8832'::uuid, 1014473),
    ('ad2aeea8-f10f-4762-97d4-f600825c0882'::uuid, 1792044),
    ('c3795820-d180-47b7-9642-4c1f118f392e'::uuid, 2131322),
    ('56d52735-3393-4b3a-ba6d-81f575cec5ab'::uuid, 1692819),
    ('c2d2e34e-5b18-4b1b-b7f5-4a2b0d41f901'::uuid, 1396009),
    ('b44a9095-121c-46de-b24e-1b9225b5f394'::uuid, 1319161),
    ('4e279f36-4b1b-4385-a24e-36af8c9e2a76'::uuid, 1691303),
    ('840c83e1-ebc5-423e-8614-c42a526301cf'::uuid, 105016),
    ('a1ad9acb-927e-42a7-8566-0c31c44eefbd'::uuid, 1603923),
    ('d39d3d5e-3846-4432-9f4a-841794887f77'::uuid, 30697),
    ('27390e0d-135f-45b3-8486-93d176923a46'::uuid, 105770),
    ('a0f3ef56-c6d6-460c-8f0e-5b9279fc1c73'::uuid, 106532),
    ('aaf76c33-66e1-4cf6-903d-d8f87ca06026'::uuid, 107263)
  ) AS w(id, cik) ON w.id = c.id AND c.sec_cik = w.cik;
  IF n <> 50 THEN
    RAISE EXCEPTION 'block 8 read-back failed: expected 50 stamped rows, got %', n;
  END IF;
END $$;

COMMIT;   -- to abandon block 8 instead, replace this line with: ROLLBACK;

-- ============================================================================
-- BLOCK 9 of 9. 11 rows.
-- ============================================================================
BEGIN;

-- Williams-Sonoma  ->  cik 719955  SEC 'WILLIAMS SONOMA INC'  [sec_conformed]  tickers=['WSM']
UPDATE companies SET sec_cik = 719955
 WHERE id = 'b4b095d3-8aae-4c81-a842-d1ddff0e0c47'::uuid AND sec_cik IS NULL AND name = 'Williams-Sonoma';
-- Winmark  ->  cik 908315  SEC 'WINMARK CORP'  [sec_conformed]  tickers=['WINA']
UPDATE companies SET sec_cik = 908315
 WHERE id = 'eb1bb873-cdfe-4441-9f1a-dbac0c47eacc'::uuid AND sec_cik IS NULL AND name = 'Winmark';
-- Wintrust Financial  ->  cik 1015328  SEC 'WINTRUST FINANCIAL CORP'  [sec_conformed]  tickers=['WTFC', 'WTFCN']
UPDATE companies SET sec_cik = 1015328
 WHERE id = '7dc0d636-c086-48c6-8487-0bbd1ac09ecc'::uuid AND sec_cik IS NULL AND name = 'Wintrust Financial';
-- X4 Pharmaceuticals  ->  cik 1501697  SEC 'X4 Pharmaceuticals, Inc'  [sec_conformed]  tickers=['XFOR']
UPDATE companies SET sec_cik = 1501697
 WHERE id = '58c02a3c-f0b0-46cd-bbbd-72e420bab7db'::uuid AND sec_cik IS NULL AND name = 'X4 Pharmaceuticals';
-- Xanadu Quantum Technologies Limited  ->  cik 2097163  SEC 'Xanadu Quantum Technologies Ltd'  [sec_conformed]  tickers=['XNDU']
UPDATE companies SET sec_cik = 2097163
 WHERE id = '88acefca-3a00-41e7-a20d-5e7cc8e1e8c3'::uuid AND sec_cik IS NULL AND name = 'Xanadu Quantum Technologies Limited';
-- Xenon Pharmaceuticals  ->  cik 1582313  SEC 'Xenon Pharmaceuticals Inc.'  [sec_conformed]  tickers=['XENE']
UPDATE companies SET sec_cik = 1582313
 WHERE id = '5a7c04b3-9907-4577-920f-a28ba256b579'::uuid AND sec_cik IS NULL AND name = 'Xenon Pharmaceuticals';
-- XPENG  ->  cik 1810997  SEC 'XPENG INC.'  [sec_conformed]  tickers=['XPEV', 'XPNGF']
UPDATE companies SET sec_cik = 1810997
 WHERE id = 'df7b5cd4-1ec0-4f1a-8185-c78bdb91df4a'::uuid AND sec_cik IS NULL AND name = 'XPENG';
-- Yeti Holdings  ->  cik 1670592  SEC 'YETI Holdings, Inc.'  [sec_conformed]  tickers=['YETI']
UPDATE companies SET sec_cik = 1670592
 WHERE id = '6a4add19-053c-462f-8dba-b78f4ba1d559'::uuid AND sec_cik IS NULL AND name = 'Yeti Holdings';
-- Zealand Pharma  ->  cik 2068427  SEC 'Zealand Pharma A/S/ADR'  [sec_conformed]  tickers=['ZLDPF']
UPDATE companies SET sec_cik = 2068427
 WHERE id = '560fd862-93e2-4ada-a5ed-b7f6ef056f19'::uuid AND sec_cik IS NULL AND name = 'Zealand Pharma';
-- Zimmer Biomet Holdings, Inc.  ->  cik 1136869  SEC 'ZIMMER BIOMET HOLDINGS, INC.'  [sec_conformed]  tickers=['ZBH']
UPDATE companies SET sec_cik = 1136869
 WHERE id = '73363984-b55e-4db4-95f7-a8308e30878b'::uuid AND sec_cik IS NULL AND name = 'Zimmer Biomet Holdings, Inc.';
-- Zymeworks  ->  cik 1937653  SEC 'Zymeworks Inc.'  [sec_conformed]  tickers=['ZYME']
UPDATE companies SET sec_cik = 1937653
 WHERE id = 'bc33a0d3-6683-45d3-8b15-2529dc156ad5'::uuid AND sec_cik IS NULL AND name = 'Zymeworks';

-- READ-BACK for block 9. Raises, and therefore rolls the whole block back,
-- if fewer than 11 of these rows now carry their intended CIK.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM companies c
  JOIN (VALUES
    ('b4b095d3-8aae-4c81-a842-d1ddff0e0c47'::uuid, 719955),
    ('eb1bb873-cdfe-4441-9f1a-dbac0c47eacc'::uuid, 908315),
    ('7dc0d636-c086-48c6-8487-0bbd1ac09ecc'::uuid, 1015328),
    ('58c02a3c-f0b0-46cd-bbbd-72e420bab7db'::uuid, 1501697),
    ('88acefca-3a00-41e7-a20d-5e7cc8e1e8c3'::uuid, 2097163),
    ('5a7c04b3-9907-4577-920f-a28ba256b579'::uuid, 1582313),
    ('df7b5cd4-1ec0-4f1a-8185-c78bdb91df4a'::uuid, 1810997),
    ('6a4add19-053c-462f-8dba-b78f4ba1d559'::uuid, 1670592),
    ('560fd862-93e2-4ada-a5ed-b7f6ef056f19'::uuid, 2068427),
    ('73363984-b55e-4db4-95f7-a8308e30878b'::uuid, 1136869),
    ('bc33a0d3-6683-45d3-8b15-2529dc156ad5'::uuid, 1937653)
  ) AS w(id, cik) ON w.id = c.id AND c.sec_cik = w.cik;
  IF n <> 11 THEN
    RAISE EXCEPTION 'block 9 read-back failed: expected 11 stamped rows, got %', n;
  END IF;
END $$;

COMMIT;   -- to abandon block 9 instead, replace this line with: ROLLBACK;

-- ============================================================================
-- SECTION 2. FULL VERIFICATION. Run after all blocks.
-- ============================================================================
WITH proposed(id, cik, name) AS (VALUES
    ('2a58a470-bc99-486e-a7ea-63c8d219200d'::uuid, 1070494, 'Acadia Pharmaceuticals'),
    ('b4cef861-b368-47de-9d6d-ecd7f0ede8d9'::uuid, 949858, 'Achieve Life Sciences'),
    ('5438b02d-6846-43a2-b35c-6fcd8ab94502'::uuid, 880984, 'ACORN ENERGY'),
    ('8e6c164e-7a79-4a02-8ba6-b557a68bc9f1'::uuid, 1670541, 'Adient'),
    ('cf722bdd-d1ae-41db-b9ea-db48c3e0f179'::uuid, 1378789, 'AerCap'),
    ('65411a83-7119-4131-839d-2bdabe8f3765'::uuid, 2081206, 'AGI Inc'),
    ('0aa3eefa-43a0-449a-90bb-dee79f29bca0'::uuid, 1378580, 'Airbus'),
    ('c20b5937-8f63-4e38-8449-3e77fa7f15f2'::uuid, 903419, 'Alerus Financial'),
    ('e0bcfde4-adca-45dc-8da2-95b03ccf9a15'::uuid, 1362468, 'Allegiant Travel'),
    ('a6879886-641f-4613-b2a5-1090dab79fbc'::uuid, 899051, 'Allstate Corp'),
    ('eacc432f-08bf-42e4-8ed7-306d874791e7'::uuid, 40729, 'Ally Financial Inc.'),
    ('e9a408fe-a9e3-4433-bc52-37301421128f'::uuid, 1178670, 'Alnylam Pharmaceuticals'),
    ('9d904e24-05fb-4f5d-b377-d8bbf2d6be7f'::uuid, 1161611, 'Aluminum Corporation of China'),
    ('8c7179a8-46f2-4b4b-af3a-75170f4b3000'::uuid, 1411579, 'AMC Entertainment Holdings Inc.'),
    ('03c6c452-2fdb-4cd2-8499-a82e08424d14'::uuid, 1053507, 'American Tower'),
    ('ced30870-5ae6-45d9-bd7c-97d6d201dd08'::uuid, 820027, 'Ameriprise Financial'),
    ('11be8abb-4b04-460d-a269-6ceae9675e26'::uuid, 707605, 'AmeriServ Financial'),
    ('26e931c5-7070-4e9f-b794-37c87fcd1132'::uuid, 6176, 'Ampco Pittsburgh'),
    ('4f9096a5-0ac4-4d94-8d62-c93cd7c76230'::uuid, 1370053, 'AnaptysBio'),
    ('604bcbc4-7b4e-4bd4-9d3d-b6b82a1ae799'::uuid, 1973832, 'Anglogold Ashanti PLC'),
    ('7f679826-d4a2-4c1f-98f4-bccac200d7f8'::uuid, 1023024, 'ANI Pharmaceuticals'),
    ('5b364ffc-53ae-4bf0-9d62-ee036014f007'::uuid, 922864, 'Apartment Investment and Management Company'),
    ('67fe6bfe-dd92-4f9a-a682-6147dcbf76c5'::uuid, 1433195, 'AppFolio'),
    ('8bb2eb81-0107-4fc6-a262-6ef9e8cbf9e6'::uuid, 894405, 'ArcBest'),
    ('5857f776-6e7f-4ccc-b3db-fe1cf495a10f'::uuid, 947484, 'Arch Capital'),
    ('41877900-bc2a-4956-b00e-6682dfd13010'::uuid, 1768224, 'Arcturus Therapeutics'),
    ('c0d02715-0160-4f5b-aed2-9e99c948533d'::uuid, 1697862, 'Argenx'),
    ('9be6d7d7-cde5-4e35-82e0-ec8c01c9f59a'::uuid, 1820721, 'Array Technologies'),
    ('8305b8db-0109-4764-82e2-b1735f147d52'::uuid, 879407, 'Arrowhead Pharmaceuticals'),
    ('62a9d930-9870-4eab-a252-0af0598e3922'::uuid, 1145986, 'Aspen Aerogels'),
    ('1c13f3a3-0fb5-4d31-bf36-0e3345b26f1e'::uuid, 1487198, 'Aspen Group'),
    ('7afc3f04-45ac-4c72-9c20-5c012f142585'::uuid, 7789, 'Associated Banc Corp'),
    ('7eddba76-5180-45fa-b250-acdb1e9724e0'::uuid, 901832, 'AstraZeneca'),
    ('7b6a76f1-4d2a-452a-922f-caf34aced299'::uuid, 2081043, 'AtaiBeckley'),
    ('be3cf448-1d4f-4ff8-9c6b-9572be264e92'::uuid, 1420520, 'Atomera'),
    ('a0a53d11-3c7d-4460-a56f-c951d0a241ce'::uuid, 1683541, 'Aurora Cannabis'),
    ('b6568c8f-7204-4730-98d2-ca1865271c05'::uuid, 350698, 'AutoNation'),
    ('1a0f8c2a-c3ad-4021-8909-d0a6e9582b7d'::uuid, 1214816, 'AXIS Capital'),
    ('b99a0836-986d-4d3d-8084-1d18883a3824'::uuid, 1069183, 'Axon Enterprise'),
    ('3433936b-26f9-46e9-818f-c5f6559894d5'::uuid, 933974, 'Azenta'),
    ('85e6fd49-e02d-4396-9bbc-0cd987afb2f8'::uuid, 1278027, 'B&G Foods'),
    ('d4365507-3258-480b-9be0-cdbf8275d2e9'::uuid, 1429937, 'B2Gold Corp'),
    ('6edec227-596d-4c1b-b7f3-ec7e3d7051f1'::uuid, 1453015, 'Ballard Power Systems'),
    ('7bbb4ea0-4af7-47ef-a9e1-11ab5329a7ca'::uuid, 1747079, 'Bally''s'),
    ('a935203d-63a8-494e-9c18-17eb6d50ad56'::uuid, 2127862, 'Baltic Classifieds'),
    ('2a271e31-7c35-4dae-bce1-5d735b363f22'::uuid, 842180, 'Banco Bilbao Vizcaya Argentaria'),
    ('4ebbeefa-b82f-4f25-8308-54dcc6b6fc27'::uuid, 891478, 'Banco Santander S.A.'),
    ('e4d3e5f2-0e92-4972-89ef-38806d09994a'::uuid, 1504008, 'BankUnited'),
    ('45f3f08f-5196-4ed9-9316-70a1c9c0966d'::uuid, 1978954, 'BBB Foods'),
    ('408c99f3-9688-44fb-96f5-8588eef53c65'::uuid, 915840, 'Beazer Homes USA'),
    ('0f715b45-0554-490b-b6a6-fa852e096171'::uuid, 842023, 'Bio-Techne'),
    ('d018f0b8-b794-4f24-b7f0-7914a5d90f21'::uuid, 834365, 'BioLife Solutions, Inc.'),
    ('57196813-55d6-4867-a565-d7feb0482d85'::uuid, 1498403, 'BioLineRx'),
    ('8b2e0952-33d3-43c2-887b-3ba7d01f0cc6'::uuid, 1776985, 'BioNTech'),
    ('1e061841-8579-425d-94be-c477bf31186f'::uuid, 1720893, 'BioXcel Therapeutics'),
    ('4386731c-9908-4a00-a553-c3e7a16f6098'::uuid, 1838406, 'BKV'),
    ('7604e8be-0afd-4ecf-a771-e9f2d616f62f'::uuid, 1130464, 'Black Hills Corporation'),
    ('c3d8e115-4157-4163-b6dd-ff3e56a4e85e'::uuid, 1070235, 'Blackberry'),
    ('69807bb4-f226-4aed-ad28-b59ca4a81a01'::uuid, 1546417, 'Bloomin'' Brands'),
    ('6d94b7cc-f799-4e34-9b01-44c009d03742'::uuid, 1589526, 'Blue Bird'),
    ('6d173063-6932-4498-a0b8-9e8a54db4f34'::uuid, 908255, 'BorgWarner'),
    ('13db8ca4-862b-410f-9f2a-89659d8d10ff'::uuid, 949870, 'Boston Beer'),
    ('bc4a41fc-c072-4129-bb80-a2e1d040ecc0'::uuid, 1906364, 'BOXABL'),
    ('d6b99d4f-acec-4407-b63e-1989445ddf1d'::uuid, 1505065, 'Brainsway'),
    ('0d8b61d1-cd84-4fb0-a4e6-2f407af62aeb'::uuid, 1071438, 'Braskem S.A.'),
    ('87704492-ceea-41b8-bd08-a17e6b00a4c5'::uuid, 14272, 'Bristol Myers Squibb'),
    ('61a1d805-f9fc-44e3-bd01-c71bf2545732'::uuid, 1303523, 'British American Tobacco p.l.c.'),
    ('db126811-2463-41ca-ac3d-8805c1387cd8'::uuid, 1383312, 'Broadridge Financial Solutions'),
    ('e620a5b4-c091-4e23-850a-792e6910af2f'::uuid, 1545772, 'Brookfield Property Partners'),
    ('7055f3c9-93b8-45b2-b0ce-0aa15650178b'::uuid, 1109354, 'Bruker'),
    ('82a76ce5-df3d-4664-b652-9bf750fec8a8'::uuid, 1714174, 'Burford Capital'),
    ('0dae6c3d-4610-4821-9fcc-cf058e5a270e'::uuid, 1447956, 'BYD Electronic (International)'),
    ('749c8929-b72e-45c6-9cfa-238b7b521b90'::uuid, 1043277, 'C.H. Robinson Worldwide'),
    ('466f0460-a200-4da1-960f-838b30bea464'::uuid, 1632127, 'Cable One'),
    ('1351ce5e-91b1-41c8-b76e-be8686bdd107'::uuid, 813672, 'Cadence Design Systems'),
    ('485dfec5-87ee-4da4-9dfb-3a44433bc66e'::uuid, 1035201, 'California Water Service Group'),
    ('a04e9040-2814-4717-bc7e-d6d13437f9d1'::uuid, 2034268, 'Cantor Equity Partners III, Inc.'),
    ('21a8ab80-ff0b-4cdd-9c4d-d64fd88f1f27'::uuid, 927628, 'Capital One Financial Corporation'),
    ('16949daa-fdd5-447f-a4dc-e2d5ec705d06'::uuid, 1530721, 'Capri Holdings'),
    ('0a1e8fd1-d63f-4f39-984a-874ec53c4a67'::uuid, 2019410, 'Caris Life Sciences'),
    ('c843342d-ed2f-4d72-98ef-9a1b7e35d0e7'::uuid, 1447362, 'Castle Biosciences'),
    ('dc7027d5-5b4d-4e27-80d4-8fe3c6bbb5b1'::uuid, 1138118, 'CBRE Group'),
    ('47e507c3-45f2-47ca-a54d-bd4640fbafef'::uuid, 949157, 'Century Aluminum'),
    ('a0e35816-7939-4d7e-98f6-67240695af86'::uuid, 1324404, 'CF Industries'),
    ('e3ec17dc-b62f-43ca-9570-2b9afe9ae108'::uuid, 313927, 'Church & Dwight Co., Inc.'),
    ('8259c117-812c-401d-9bf4-3f890736b52a'::uuid, 759944, 'Citizens Financial Group Inc.'),
    ('cfe37bed-12ea-461f-abb8-9c76a485fa34'::uuid, 1441236, 'Clearwater Paper'),
    ('4dc5f266-d9ed-4c73-b17e-f5cb7e14fbb6'::uuid, 1780785, 'CN Energy'),
    ('b6972604-6cc8-4fb2-85c9-c8626686eb65'::uuid, 1070412, 'CNX Resources'),
    ('90335c06-e540-4386-a6e1-e221fc702af4'::uuid, 1284812, 'Cohen & Steers'),
    ('f91be27f-1533-4712-a3c9-4ecf2919f670'::uuid, 887343, 'Columbia Banking System'),
    ('606f91a7-ff8e-42f7-8177-0127820e2742'::uuid, 1050797, 'Columbia Sportswear Company'),
    ('e65ef23e-3fc9-4c22-aae4-09b33b8a037d'::uuid, 1012037, 'Compagnie de Saint Gobain'),
    ('6edc94ff-93bf-4d41-81aa-84b1eac1445b'::uuid, 1563190, 'Compass'),
    ('48f47aa5-df9a-4dc3-abb4-7bb318050545'::uuid, 1119774, 'Compugen'),
    ('c43c607f-7100-44ff-a4e4-587b68abedab'::uuid, 816956, 'CONMED'),
    ('5188f910-7190-4dc2-a477-1d6f5a49d12c'::uuid, 2070829, 'Contemporary Amperex Technology Co. Ltd.'),
    ('30c2fc6a-b24e-4f17-b183-adbdefa20ebd'::uuid, 2064307, 'ContextLogic'),
    ('25264ff1-f9cd-4a1b-ae1c-256f220839df'::uuid, 1088856, 'Corcept Therapeutics'),
    ('28118241-4373-4e29-90bb-bce83ca02c27'::uuid, 1026655, 'Core Molding Technologies'),
    ('d1efc560-47fc-4975-a647-e7335b985808'::uuid, 1070985, 'CoreCivic'),
    ('51dbf790-fbff-4983-a5a8-2a782908a96f'::uuid, 1743759, 'Corsair Gaming'),
    ('04fbd49d-c88b-4f5f-bf5c-c85bc61d49da'::uuid, 1755672, 'Corteva'),
    ('dd023a0e-6519-4be0-8e38-2dea1719beb2'::uuid, 1832928, 'Cresco Labs'),
    ('bb10d95d-b556-4f4e-8497-cf9055680698'::uuid, 1576427, 'Criteo'),
    ('f667818a-cf94-436b-9186-401d10e760f8'::uuid, 1334036, 'Crocs'),
    ('7be9b55d-672f-4f04-b9dd-20bbf658443d'::uuid, 1298675, 'CubeSmart'),
    ('ed9be63c-145b-4053-b17b-ca190ed3bc6a'::uuid, 26172, 'Cummins'),
    ('71a7fe83-49bf-4d0b-8ed8-45a70df462db'::uuid, 64803, 'CVS Health Corp'),
    ('841c9245-87ba-4e3b-aa97-6647dc20e809'::uuid, 1437712, 'DCC'),
    ('45eb2fc8-7d89-4cfa-a9eb-d07096e0c094'::uuid, 1694426, 'Delek US'),
    ('21bcc70f-d820-4078-96d3-61d6de6fa278'::uuid, 1050140, 'Descartes Systems Group'),
    ('1b03011e-cbdf-4a96-9ba0-c9e014242a7c'::uuid, 813298, 'Destination XL Group'),
    ('e043e420-71e9-4fc6-b7e7-5895871b2461'::uuid, 1049724, 'Deutsche Lufthansa'),
    ('dd43b9e8-4b7c-4ae4-a614-381498d2bb3a'::uuid, 909108, 'Diamond Hill Investment Group'),
    ('c545478f-97f0-4caa-8b8e-fe54f485e7c6'::uuid, 317788, 'Digital Turbine'),
    ('caddae6f-a848-4ba9-afe4-05f92a6cd160'::uuid, 1857475, 'DOLE plc'),
    ('caa17d5f-c70c-419a-9911-57fddef60ef0'::uuid, 29905, 'Dover Corporation'),
    ('4eb72ca4-b744-42b2-893c-dfc870875e89'::uuid, 2094201, 'DPC Dash'),
    ('4621237c-d855-43ab-aec7-ee20857201dd'::uuid, 1804745, 'Driven Brands Holdings Inc.'),
    ('9a0d2558-4eca-491e-bf21-51e2fe8b1c68'::uuid, 1136808, 'E.ON'),
    ('858682c6-deef-4af1-b24a-4c31b173b4f1'::uuid, 31235, 'Eastman Kodak'),
    ('c7a6c9b2-7ef5-4180-b3e9-6c7ebcdeb295'::uuid, 1590714, 'Element Solutions'),
    ('caac6b49-210c-4cb5-9061-845deb2dbe07'::uuid, 1969796, 'Embracer Group'),
    ('8eda13dc-89ae-4f52-a0b3-ee21064422c9'::uuid, 1127248, 'Emera Incorporated'),
    ('d8ee941c-e236-4133-a5fe-ff0e76f3cdbc'::uuid, 32604, 'Emerson Electric Company'),
    ('40e49de8-2a57-4c76-bff1-ef16e3588f94'::uuid, 1084961, 'Encore Capital Group'),
    ('60fa4a41-06c7-4752-a245-92be85c767d5'::uuid, 1140625, 'Equinor ASA'),
    ('4cd9bc95-6364-45af-9b84-24a54c443974'::uuid, 1333986, 'Equitable Holdings Inc.'),
    ('015e1dd9-ae0a-4b85-94f6-a660aaacd9c9'::uuid, 1434868, 'Esperion Therapeutics'),
    ('f5315772-f5a1-470e-b24f-785fa7eb16bb'::uuid, 1412558, 'Evotec'),
    ('a18f0c30-365d-46f5-824a-0c8cb0b29fbd'::uuid, 939767, 'Exelixis'),
    ('ca369570-dc51-4e1d-b667-d6d8bfa395dc'::uuid, 1109357, 'Exelon'),
    ('ab4bcf16-d848-43a8-9020-5d012a812f89'::uuid, 2115436, 'ExxonMobil'),
    ('fe990a20-893f-4dcf-a8c7-1a6a21be947d'::uuid, 814547, 'Fair Isaac Corporation'),
    ('199fcbf8-8e70-4f22-b6bf-fa3f77a49700'::uuid, 915191, 'Fairfax Financial'),
    ('d987372c-3f3b-4a12-a2d6-cd8f4670dbba'::uuid, 277509, 'Federal Signal'),
    ('4eb3bd64-92e8-4472-8c22-88d25ca50ab5'::uuid, 1648416, 'Ferrari'),
    ('c1061f2e-f29a-4e8f-aba9-4b5e67eda0ec'::uuid, 1468522, 'Ferrovial'),
    ('196af0c4-0323-455c-8f57-679fd6d94afa'::uuid, 1098151, 'Fidelity D & D Bancorp'),
    ('177f5877-34f7-4382-acdf-58b16c887c2a'::uuid, 1331875, 'Fidelity National Financial Inc.'),
    ('b8f22e06-b870-4ab5-b3b6-22ded57daf9b'::uuid, 2073638, 'Finning International'),
    ('209f2f09-cb25-4e1d-8590-5056fd301b5d'::uuid, 1746109, 'First Bank & Trust'),
    ('aefb7b8b-8bba-4d85-bd4a-48cc095f38fb'::uuid, 860413, 'First Interstate Bancsystem'),
    ('718ec183-7678-4518-8d01-3cbd92c15b31'::uuid, 1666175, 'Fortis'),
    ('0f3b28b6-c3a5-4d29-954e-1f04d0606231'::uuid, 1828377, 'Fortitude Gold'),
    ('441b3816-6813-472c-bbac-8238aefd8d2c'::uuid, 1559444, 'Forvia'),
    ('dc5198b0-c198-44a2-95e9-8e9e1a704d4c'::uuid, 1456346, 'Franco Nevada'),
    ('e3e97199-9214-4f8f-8288-195d66ee36a4'::uuid, 1320854, 'FreightCar America'),
    ('86418122-85a6-4f9a-a6d1-6e7dab5684fd'::uuid, 887936, 'FTI Consulting'),
    ('6f9742e0-2758-4c30-8eb9-4c69bbc8d9c8'::uuid, 700564, 'Fulton Financial'),
    ('ed12e388-1d66-4745-b66e-f99e8786a824'::uuid, 1704711, 'Funko'),
    ('67cda1e8-ae72-400f-86c9-5ebc0a776912'::uuid, 1996810, 'GE Vernova'),
    ('85d2b0c6-7c32-48ae-8ff4-e0ac6da4be88'::uuid, 1474968, 'Geely Automobile Holdings Ltd.'),
    ('b9bb6061-2ddb-469b-a157-0a1720198442'::uuid, 849399, 'Gen Digital'),
    ('e3bf8db7-24fa-41b4-80c1-4da9dc0406c2'::uuid, 2074850, 'General Fusion'),
    ('a3f9789c-ca15-4d19-9953-cbed40cc55b6'::uuid, 2100782, 'Generate Biomedicines'),
    ('f240ef76-f7c6-46a0-96ef-edb5b51f4cbc'::uuid, 1022321, 'Genesis Energy'),
    ('40a542eb-c2a4-4152-8d45-eaedb15b73f7'::uuid, 1434265, 'Genmab'),
    ('59614a6e-dc78-4b4a-9ae4-c7d171b4d61e'::uuid, 355811, 'Gentex Corporation'),
    ('5602b4fc-92d3-48f2-900d-f9e84f36f7e0'::uuid, 903129, 'Gentherm'),
    ('2282debc-6c62-46b6-ad65-afea4e1696ef'::uuid, 1898496, 'Getty Images'),
    ('57855961-8b70-4379-a953-45a9e63a195d'::uuid, 2071913, 'Gibson Energy'),
    ('6b648f58-a4ab-4e2c-8174-1c801ff683c7'::uuid, 1857816, 'GigaCloud Technology'),
    ('5a0715d4-e258-4c18-8f0c-48577bcf67a0'::uuid, 897322, 'Gilat Satellite Networks Ltd.'),
    ('95d22579-53d8-476f-83c4-5db780830a0d'::uuid, 882095, 'Gilead Sciences'),
    ('d78c0ee4-31d9-4a09-80f7-d1d05012e9af'::uuid, 1830214, 'Ginkgo Bioworks'),
    ('e63a769b-fba8-4afc-9cca-833e7f15a16e'::uuid, 1653482, 'GitLab'),
    ('0111093a-fca9-462b-82a4-e3b3ffd68782'::uuid, 1609711, 'GoDaddy Inc.'),
    ('c96ccd9f-7230-4558-9bb6-c7d46b9d801d'::uuid, 1273441, 'Gran Tierra Energy'),
    ('b6764f15-f0a4-4738-9c17-3d5b16a4186f'::uuid, 1434588, 'Grand Canyon Education'),
    ('ac87b972-93e9-4419-b485-4d66034ff77f'::uuid, 1771515, 'Grocery Outlet Holding Corp.'),
    ('96bfc6d4-5679-44da-9539-3010d42b679e'::uuid, 912892, 'Grupo Televisa'),
    ('d8487ec2-464b-4796-89f2-8cc345949e66'::uuid, 1802255, 'Guardian Pharmacy Services'),
    ('aa9a72ba-b514-4df1-8d91-4a5b7e8aca0c'::uuid, 1483994, 'H World Group'),
    ('f0c712ec-1f90-4197-ace8-bc028a12222e'::uuid, 2073669, 'Hansoh Pharmaceutical'),
    ('91d049f5-e7bd-4942-8bbd-65f886c140a0'::uuid, 1802665, 'Harmony Biosciences'),
    ('a55bc6e4-53a9-4a06-a425-b2a03e51a43a'::uuid, 860730, 'HCA Healthcare'),
    ('9cb581e8-7d57-4946-8e4b-67114c3d96f7'::uuid, 1144967, 'HDFC Bank'),
    ('313699f7-165c-4a2e-ade1-bc1a2c0969d1'::uuid, 719413, 'Hecla Mining'),
    ('8e0b0ff9-6c33-45ad-b714-017cf3782efd'::uuid, 46619, 'HEICO'),
    ('8a873e47-d22a-4b9e-ae2f-f66290997969'::uuid, 1364479, 'Herc Holdings'),
    ('bf3bba1a-a5b0-4d72-98fc-488a5bd315e4'::uuid, 1446962, 'Hochschild Mining'),
    ('7361687b-ee93-4cef-b71d-7bf76fc634ca'::uuid, 49196, 'Huntington Bancshares'),
    ('ecbb4091-1b58-4c03-ab01-d6864ab9198f'::uuid, 1718405, 'Hycroft Mining'),
    ('6cb4bf0c-0588-4fd9-939e-457f8cd83d91'::uuid, 2078856, 'Hyperliquid Strategies'),
    ('62d86dbf-975e-4b64-a427-7c1a852ea145'::uuid, 1538379, 'Ibotta'),
    ('0e7873d4-a0ab-47e9-814a-79657e8144e8'::uuid, 1103838, 'ICICI Bank'),
    ('31596b3f-e083-482b-bd37-06448722449d'::uuid, 2062803, 'IDP Education'),
    ('2d3070b2-2a26-4e52-ba3c-8e928a5856cc'::uuid, 1790340, 'Immuneering'),
    ('d2e7b7a3-6f08-4bf5-904b-dff22a8dca83'::uuid, 1067491, 'Infosys'),
    ('b5b4dca8-d39e-455d-b75d-9ba7b796641f'::uuid, 1774163, 'Innovent Biologics'),
    ('9040e46a-8d0a-4479-aa4f-4011a1aec014'::uuid, 1114483, 'Integer Holdings'),
    ('4f115e27-d51c-4760-a22d-18ebd9938102'::uuid, 917520, 'Integra LifeSciences'),
    ('ab6b87f7-b5c0-4dc3-8c6c-72a6ff14d07f'::uuid, 1652130, 'Intellia Therapeutics'),
    ('45b9d2d7-5867-4af1-9788-d0ea2bf21313'::uuid, 1405495, 'InterDigital, Inc.'),
    ('dc99d8ab-018e-4142-bb8e-246dfc467cdd'::uuid, 1425205, 'Iovance Biotherapeutics'),
    ('e70746fe-9049-4ed3-90c8-f857e3d94304'::uuid, 1020569, 'Iron Mountain Incorporated'),
    ('24377324-181e-4bc2-b9fa-2fb213150ced'::uuid, 1009829, 'JAKKS Pacific'),
    ('1d9382ae-04b4-4763-a005-7a55e1dd749b'::uuid, 1600520, 'Japan exchange'),
    ('99770153-b800-4d12-8b16-160403329878'::uuid, 1549802, 'JD.Com'),
    ('bb7d9505-f72f-4f82-b399-6477f0742301'::uuid, 1674335, 'JELD-WEN'),
    ('d7972265-365c-4cbd-98a7-159f3613a8fb'::uuid, 2127043, 'Jersey Mike’s Subs'),
    ('83e9977d-70b4-4dcc-ab02-1476801c5cb7'::uuid, 1357615, 'KBR'),
    ('1f2f4e3c-ceee-43fb-b015-59285eee3f46'::uuid, 91576, 'KEYCORP'),
    ('b32d07b3-729d-4832-a2b3-198320acfaa7'::uuid, 1601046, 'Keysight Technologies'),
    ('04af6598-f431-449b-ba17-e86d7300cf4c'::uuid, 55785, 'Kimberly-Clark'),
    ('757edfb0-de82-42e2-9682-92550f0c48e4'::uuid, 2053383, 'Kioxia'),
    ('c972472d-144e-4b1d-9e52-6c5928d16c44'::uuid, 2033019, 'Kokusai Electric'),
    ('6c0beff6-5373-4682-a5b2-9cb52571ac30'::uuid, 1857154, 'Krispy Kreme'),
    ('af6d9f1b-679a-4b7f-8d8c-2157491c5a8d'::uuid, 56873, 'Kroger'),
    ('3b5555ee-758f-41fa-b011-fb7a0cb5c0a7'::uuid, 1679273, 'Lamb Weston'),
    ('f1f3315f-d8c4-436a-9014-47c02d21bf3e'::uuid, 1521036, 'Lantheus Holdings'),
    ('d31c7904-3540-4061-9100-9e8aca84cd53'::uuid, 2068440, 'Laopu Gold'),
    ('5dd572ad-1e41-43cc-90f2-1e359fc94ff2'::uuid, 1069202, 'Lennox International'),
    ('eb2bbe14-b155-4ea2-a64a-0a74405385d2'::uuid, 1580670, 'LGI Homes'),
    ('8101c4e1-9458-49be-b04d-5bd013b5b320'::uuid, 849146, 'LifeVantage'),
    ('e83c3235-20e4-4c46-bd92-caf5beacd801'::uuid, 886163, 'Ligand Pharmaceuticals'),
    ('c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid, 59558, 'Lincoln National Corporation'),
    ('74ab5dad-8ca9-47fe-b450-1ad4d9406bd7'::uuid, 2140948, 'Lion Finance Group'),
    ('71519329-a4cb-4d19-93af-cb0dc70b7cea'::uuid, 1023128, 'Lithia Motors'),
    ('4e68c911-71cd-41cf-97bd-8076c0c94ba1'::uuid, 1462120, 'Live Oak Bancshares'),
    ('3778ec3b-adf7-4547-b0a8-9898ee18692d'::uuid, 733269, 'LiveRamp'),
    ('378c0d7d-d496-4360-9d95-fd8377663298'::uuid, 1160106, 'Lloyds Banking Group'),
    ('3496b52d-df1c-4e22-a8c0-e8ba63830664'::uuid, 1831631, 'Loandepot'),
    ('5a9d7aeb-c466-49c3-9382-a67a340f169d'::uuid, 60086, 'Loews'),
    ('398fe069-92de-4f0a-92e8-474fff3093ec'::uuid, 1767582, 'Luckin Coffee'),
    ('03476ec7-4dcb-442c-8822-fe7e60f28879'::uuid, 1489393, 'LyondellBasell Industries'),
    ('5c8bc39d-cc2d-43fc-92a0-df9ec847fb1d'::uuid, 749098, 'Magna'),
    ('680b460c-a1ef-4c8d-be26-25b8222ee205'::uuid, 1495153, 'MakeMyTrip'),
    ('4f50c656-d8af-419d-8f5b-3e81039c924c'::uuid, 1086888, 'Manulife Financial'),
    ('7850e41f-9fa0-411b-b314-65b4b602f411'::uuid, 2131961, 'Manycore Tech Inc.'),
    ('b35f13f1-ab26-47a1-bf52-af977eb2974d'::uuid, 1048286, 'Marriott International'),
    ('953df921-711a-4ef3-845d-4dc7b210ac66'::uuid, 799167, 'Marten Transport'),
    ('84332844-fda6-410e-9a6b-fa52790cdf0a'::uuid, 1668397, 'Medpace'),
    ('039714ac-bd75-46f5-8521-73fa1fdd8049'::uuid, 1042729, 'Mercantile Bank'),
    ('e30e2af2-49a1-4f55-9ed2-a0d23623d097'::uuid, 833079, 'Meritage Homes'),
    ('9ccef504-78fb-45e1-9e89-c56b41ef2121'::uuid, 2090231, 'METLEN Energy & Metals PLC'),
    ('637aa6b8-6da5-4f58-b90d-d7efeb908c36'::uuid, 1760689, 'Microvast'),
    ('010372bd-8c4d-4cc4-a87b-4f6593a9d26b'::uuid, 2039784, 'Midea Group'),
    ('7c924ae7-3041-4f16-bc78-ca06a858c1e3'::uuid, 924822, 'Miller Industries'),
    ('85a1766d-1cb6-4f75-87a1-e6875f1c195e'::uuid, 1436126, 'Mistras Group'),
    ('a7a46c35-dbc2-489d-ab1e-e3e3a80c0040'::uuid, 67347, 'Modine Manufacturing'),
    ('fc0bd7c2-a123-4c8e-b6c0-8747f48a0641'::uuid, 865752, 'Monster Beverage'),
    ('65c9ddaf-6a1c-44cb-874a-aefe909c568f'::uuid, 2123346, 'Montage Technology Co.'),
    ('76ba3fec-13ae-4210-82e1-5d723d5e93da'::uuid, 1350593, 'Mueller Water Products'),
    ('6eda5d47-02ea-41c9-87d0-86e22265a8af'::uuid, 899923, 'Myriad Genetics'),
    ('2bd4e6b1-745b-46de-accd-e34ab50ed359'::uuid, 1795251, 'Nano X Imaging'),
    ('8b2aa808-1675-4ac0-a7e8-2812321d068a'::uuid, 69633, 'NAPCO SECURITY TECHNOLOGIES'),
    ('a9ddef20-a9cd-4899-b248-525fa090d252'::uuid, 1004315, 'National Grid plc'),
    ('0eee5e37-b308-4995-a0a2-b272c0746fec'::uuid, 844150, 'NatWest'),
    ('684e1591-3a30-480f-b562-3828aaa3a006'::uuid, 1901279, 'Nayax'),
    ('df303dcb-e0b0-4571-b3fd-b19cad95bbe0'::uuid, 1110646, 'NetEase'),
    ('eb477c21-df9e-4742-aca8-c7b94bd5c282'::uuid, 814453, 'Newell Brands'),
    ('89b5dca1-03b1-4388-b836-2b0379623884'::uuid, 753308, 'NextEra Energy'),
    ('10b50cd0-eed9-44d1-9890-4be0e3e38ffd'::uuid, 1124796, 'NLight'),
    ('f3e9294d-ecda-42a0-bed8-18271a406a8d'::uuid, 2072389, 'Northland Power Inc.'),
    ('f5ebe02e-89b6-49ef-94bd-b6b2a1a3f6ed'::uuid, 1173420, 'NovaGold Resources'),
    ('4d816cf4-8a9f-4f0a-9be5-f4ad9eaa8fe9'::uuid, 1114448, 'Novartis AG'),
    ('61d3a428-3196-46d7-b565-a9445c298640'::uuid, 1859795, 'Novonix'),
    ('781671cf-2372-4ec9-8b98-03a3c88aee5f'::uuid, 1814215, 'Nuburu'),
    ('b424f501-704d-4140-acf2-9b550c65a6cd'::uuid, 73309, 'Nucor'),
    ('0db06c25-57be-4f15-ac7a-389bab9d2966'::uuid, 1479681, 'Nutex Health'),
    ('db94ccba-0a9e-43af-8e51-186d63ba7b66'::uuid, 1861560, 'Nuvalent'),
    ('b7ac4c3e-0db9-4e38-a276-1616cef99d16'::uuid, 2088339, 'OBIC Business Consultants'),
    ('4288868b-c8be-422d-ac64-40863392367a'::uuid, 1334388, 'Obsidian Energy'),
    ('84cc2250-94c1-4900-9dcb-aefae92f6bcb'::uuid, 73756, 'Oceaneering'),
    ('c1cdce71-55ef-4213-b8c3-3a1d63b7f88c'::uuid, 1882782, 'Odyssey Therapeutics'),
    ('40ff0f77-f7a6-4d01-baaf-8eccc8333098'::uuid, 878927, 'Old Dominion Freight Line'),
    ('caacad17-b33a-4404-8cba-ce4b3ea407d8'::uuid, 1750284, 'Olema Pharmaceuticals'),
    ('56c432db-7c9d-4737-8d7d-02913836b002'::uuid, 1637715, 'OnKure Therapeutics'),
    ('f9989656-521b-4cc5-8d08-5a0f6c563619'::uuid, 704532, 'Onto Innovation'),
    ('6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid, 775158, 'Oshkosh Corp'),
    ('b0403540-c2eb-4f58-a2bb-d1a1522af688'::uuid, 1636651, 'Ovid Therapeutics'),
    ('e4525662-ad9d-4fd7-a736-2a21c869455e'::uuid, 821483, 'Par Pacific Holdings'),
    ('91476708-694e-4c52-942b-f8eccd9bc1e2'::uuid, 2119292, 'Pasqal'),
    ('8372a5b6-06dd-45d8-867c-7c2cc3e53026'::uuid, 1383414, 'PennantPark Investment'),
    ('3e10ef20-760d-49db-b634-7e0005a3bd06'::uuid, 1455633, 'Pennon Group'),
    ('14c4f47d-94c7-4706-801a-fdec8642c06c'::uuid, 77360, 'Pentair'),
    ('04f89953-cb99-46af-833f-45561abf22db'::uuid, 891532, 'Perma Fix Environmental Services'),
    ('48c9d5e9-acfb-4da2-9df6-679efc2fd730'::uuid, 2026053, 'Pershing Square'),
    ('f3f6ad52-1da2-4e21-9065-c6f0d88e2dad'::uuid, 1069899, 'Phibro Animal Health'),
    ('132d1ea7-3b79-416c-929c-cf538e2c093a'::uuid, 810136, 'Photronics'),
    ('79454f6c-0eee-4a7d-a4a2-5266d4bd1d03'::uuid, 1437441, 'Piraeus Bank SA'),
    ('3760bdcc-8c7f-4615-bf53-cd47b6f81ef4'::uuid, 1784535, 'Porch Group'),
    ('30883a17-ef7c-4340-ac31-b440be1fe4e4'::uuid, 1894562, 'Prime Medicine'),
    ('dd5ac907-f852-4f49-8478-778d002a5be1'::uuid, 876167, 'Progress Software'),
    ('7976a80b-a459-4212-a3e3-6937847f667f'::uuid, 1551306, 'Progyny'),
    ('0b8b7794-969f-4238-ab30-0e64497f5079'::uuid, 1068851, 'Prosperity Bancshares'),
    ('8f4f6311-2732-4c34-9e7b-fc799d3d5f5b'::uuid, 1137774, 'Prudential Financial'),
    ('21a2b00d-98a0-45cd-bc54-f9ccf1043e49'::uuid, 1782999, 'PureTech Health'),
    ('b10e39d7-d0bc-464e-8395-bfca4096174a'::uuid, 78239, 'PVH'),
    ('c8eca83d-b0b5-4df1-94d7-895ddcd350bc'::uuid, 906465, 'QCR Holdings'),
    ('2c796439-da12-406d-8ecf-0aa5b8d47982'::uuid, 1015820, 'Qiagen'),
    ('d423c9f0-0207-43d0-ae52-3503dba94ca9'::uuid, 2058873, 'Qnity Electronics'),
    ('fd519c2a-6c5c-4cab-a18a-e3f235a3ca86'::uuid, 1503274, 'Quanterix'),
    ('f95dbf47-8fc8-4036-aac6-60cf536d06c9'::uuid, 1022079, 'Quest Diagnostics'),
    ('b679988a-d9dd-43cd-a643-9c908c94b70b'::uuid, 1117297, 'QuinStreet'),
    ('345d131f-f564-482f-975b-c1d794211185'::uuid, 1739410, 'Rallybio'),
    ('3c0aebcd-0e60-4318-ad68-153db20fc35b'::uuid, 1037038, 'Ralph Lauren Corporation'),
    ('2cc8f498-c5fa-4331-9cea-e725b0a36c07'::uuid, 315852, 'Range Resources'),
    ('aa5de138-64e8-411f-8a00-710dfc83e16e'::uuid, 935419, 'RCI Hospitality'),
    ('297e8905-5f6d-452e-935c-131fdc458143'::uuid, 700841, 'RCM Technologies'),
    ('e6e7dd83-a925-4e00-aec9-bec1efcd3e9b'::uuid, 82811, 'Regal Rexnord'),
    ('a61582b6-31c6-4d73-beea-64777536135a'::uuid, 1281761, 'Regions Financial'),
    ('e259fc86-df8e-40fd-88d6-0e727f618641'::uuid, 1812364, 'Relay Therapeutics, Inc.'),
    ('d46d4777-125a-4086-91c1-801931500b63'::uuid, 1618756, 'Restaurant Brands International'),
    ('d99e526f-da24-4a6c-bfd6-d2abe302a1d9'::uuid, 1628171, 'Revolution Medicines'),
    ('91fac195-6964-4678-a604-0fe928c8317f'::uuid, 1786431, 'Reynolds Consumer Products'),
    ('21c052bc-e0a5-440a-bf1b-2878fa703737'::uuid, 355948, 'Richardson Electronics'),
    ('578eb178-f386-4a42-84c6-ee5a5025de67'::uuid, 2141099, 'Rigaku'),
    ('3c928d59-e582-4092-a47f-77a802db17ef'::uuid, 1516536, 'Rightmove'),
    ('1309723d-2375-4157-9c60-00a3686eb3d0'::uuid, 1281895, 'Rocket Pharmaceuticals Inc'),
    ('3606bab5-31fd-49fa-9724-13327dedf325'::uuid, 1969729, 'Rockwool'),
    ('605896b7-a928-4e62-bd02-c6727a651c1a'::uuid, 1770114, 'Saab AB'),
    ('716042ea-dd3a-4a7f-bad3-27c2cd6b201d'::uuid, 1584273, 'Sanrio Co.'),
    ('11fa29e1-245c-4466-9358-734fd14b1a61'::uuid, 2072563, 'Saputo'),
    ('0d058698-c50f-4677-a235-2d0dc49b7e06'::uuid, 1874315, 'Satellogic'),
    ('7be1499a-1c1b-46e9-b5e4-d99d141ed968'::uuid, 1655190, 'Schindler Holding'),
    ('4bff9990-bfbc-4dc7-802e-0d94eb7b5fae'::uuid, 866729, 'Scholastic'),
    ('c8450765-3a17-4ddf-91ac-fab5b440ffe6'::uuid, 825542, 'Scotts Miracle Gro'),
    ('83d32041-2613-48bf-bb59-76059e182cbf'::uuid, 88121, 'Seaboard Corporation'),
    ('1db94c42-0cfe-44df-ac10-f21cbf05e8bf'::uuid, 1329213, 'Senior'),
    ('d9e0999c-c46c-4c38-8107-e751f0f3ee0c'::uuid, 1583708, 'SentinelOne'),
    ('30549cbb-f336-48ae-b076-1b9b175e07d4'::uuid, 2099326, 'SERES Group'),
    ('6b4394fa-73e5-4d03-95d5-8e6579f50eaa'::uuid, 1359519, 'Seven & i'),
    ('4947cb79-5a75-455a-9b9b-851eb95f3214'::uuid, 1662991, 'Sezzle'),
    ('2d1b70cb-63c2-4a4e-aaf4-d26f4a6e36a3'::uuid, 354963, 'Shenandoah Telecommunications'),
    ('241855bc-8a02-4925-a302-15bf56ef72ca'::uuid, 1830056, 'Siemens Energy AG'),
    ('e59aafc5-33c7-4471-8def-b002a3648ba0'::uuid, 2073972, 'Sienna Senior Living'),
    ('a7b00468-88cb-47f8-8462-e51c50a80ce1'::uuid, 1063761, 'Simon Property Group'),
    ('739114ed-f904-4ed2-b090-da090c80a122'::uuid, 2120882, 'SK Hynix'),
    ('a5e48aa4-2fea-4660-88a8-74151b9129de'::uuid, 827187, 'Sleep Number'),
    ('9f10477f-88cc-40d5-8c45-f6e5383f24ca'::uuid, 1032033, 'SLM'),
    ('d06bb656-6bc5-4337-8ba0-17a7746419f6'::uuid, 91440, 'Snap-On'),
    ('61f35ec9-5e80-415f-bcc2-5eb524280647'::uuid, 92122, 'Southern Company'),
    ('719162d5-fb07-4b65-a49e-74ecd517a294'::uuid, 1132105, 'Sportsman''s Warehouse'),
    ('f5000e8a-c09b-434d-a27c-cc9aadf362c2'::uuid, 718937, 'STAAR Surgical'),
    ('405a81b8-8c47-4b7a-9a76-24758d41c564'::uuid, 310354, 'Standex International'),
    ('fd1351a0-d811-48a5-9f3c-fd01b1dde8ab'::uuid, 93556, 'Stanley Black & Decker'),
    ('d6fc81e5-4385-4bb4-9a76-e4bde69615f6'::uuid, 1605484, 'Stellantis'),
    ('26332896-381c-453b-9531-309eb9e06a16'::uuid, 1757898, 'STERIS plc'),
    ('da85cb35-4c61-4bcc-9ec2-ca264fbacb66'::uuid, 2027330, 'SUGI Holdings'),
    ('6bf829c4-a700-49e9-be97-5d3998f97c3c'::uuid, 1097362, 'Sun Life Financial Inc.'),
    ('385df117-4ad2-4f59-a0f9-d75f6b7a1e06'::uuid, 2083785, 'Sunbelt Rentals Holdings'),
    ('ea202e9d-1efa-4fd3-ac0f-49a06e0c2d0e'::uuid, 1514705, 'SunCoke Energy'),
    ('8fa256fd-b9e0-4239-a157-e73039a5d837'::uuid, 1838987, 'SunPower Inc.'),
    ('9f7aa6be-e52a-4eaf-9fd0-d922104ceb0f'::uuid, 1356576, 'Supernus Pharmaceuticals'),
    ('c70f7f3d-00bf-464b-9698-5932cac284c2'::uuid, 1837240, 'Symbotic'),
    ('5197d4d6-3372-438b-9d13-df19f87acc57'::uuid, 96021, 'Sysco Corporation'),
    ('d736cdce-bc42-4db0-972e-ff2a6ad7005e'::uuid, 1116132, 'Tapestry'),
    ('f8c84465-b957-465b-bd58-80880a338238'::uuid, 1232384, 'TC Energy'),
    ('fe8dc90b-c0ef-4ec2-be1a-1d3705814308'::uuid, 2073804, 'TCL Electronics Holdings Ltd.'),
    ('167db014-da2a-410c-a62b-ef3368104f8e'::uuid, 2018064, 'TechTarget'),
    ('2c74abbe-e907-43a9-82be-6751ea0c9d60'::uuid, 932470, 'Telecom Argentina S.A.'),
    ('1578dfe7-8480-40ef-9339-13729b95a04c'::uuid, 96943, 'Teleflex'),
    ('ef109d38-7e8b-4612-a17b-e066e38592b7'::uuid, 1190723, 'Tenaris S.A.'),
    ('6ac8b247-41ad-46cc-96c2-441531cba199'::uuid, 70318, 'Tenet Healthcare'),
    ('b2929002-0c21-45f1-bc9d-5805832f0f30'::uuid, 97216, 'Terex'),
    ('ab5f7bd9-9e67-4125-a202-42995be17467'::uuid, 1342874, 'Ternium'),
    ('de956e7f-ad0e-4306-bc27-7493ceae213e'::uuid, 1390777, 'The Bank of New York Mellon Corporation'),
    ('4aadbf7c-dea5-45c6-a27e-e2aa58c818d3'::uuid, 21076, 'The Clorox Company'),
    ('f1637f00-e16b-4b3d-8848-2f0bc13e89ab'::uuid, 21344, 'The Coca-Cola Company'),
    ('de512bb5-1b76-4ed2-9b28-be753a137c85'::uuid, 2073913, 'The North West Company Inc.'),
    ('ccc765d7-7682-4375-8e8a-03b76e5bc864'::uuid, 1862461, 'The Real Brokerage'),
    ('e2fc418e-e6bd-42e0-a5d9-9e863fa98740'::uuid, 1583107, 'Theravance Biopharma'),
    ('db6cc338-dac6-47b3-b92c-c450237da720'::uuid, 1075124, 'Thomson Reuters'),
    ('7e07a5e3-2dfc-48cc-9be0-591a68fc562d'::uuid, 109198, 'TJX Companies'),
    ('4360821d-ee3d-4011-a0fc-c3a9bd43795f'::uuid, 1296484, 'TOP Ships'),
    ('9423568b-b714-4712-b00b-d3df657b3c86'::uuid, 2072098, 'Toromont Industries'),
    ('3d0f92ad-438b-4e93-bc4e-70435c683ae0'::uuid, 947263, 'Toronto-Dominion Bank'),
    ('caea5b7a-6514-4503-a4ba-20ce91b117f4'::uuid, 2071881, 'Tourmaline Oil'),
    ('1343ae1f-6dd7-4560-a550-eff5ff39e85e'::uuid, 2018139, 'Toyota Tsusho'),
    ('aca318ba-d3ca-4dd8-be52-f31e57025cfb'::uuid, 1133311, 'Travelzoo'),
    ('ac6365c2-9955-4504-bf49-a733efadfa83'::uuid, 1013880, 'TTEC'),
    ('489ba2a2-8ee9-48f9-8701-a1a2c0f93226'::uuid, 100493, 'Tyson Foods Inc.'),
    ('9246ed54-0562-43ca-9ce2-7050f70cc3e0'::uuid, 4457, 'U-Haul'),
    ('aa0ee2df-d4c9-489c-bc58-6c2bbe22f7f0'::uuid, 1901440, 'UL Solutions'),
    ('2cbacff6-1fbc-475d-8d1d-24c946ef998a'::uuid, 1590560, 'UniQure'),
    ('8269b20e-3b7c-4c70-9db8-ffc7f98eccc5'::uuid, 102037, 'Universal'),
    ('5cf12072-1453-4b74-b255-8194abcc811a'::uuid, 1890126, 'Universal Music Group'),
    ('c8da1917-c5d9-4456-a0fc-b32aaff685ed'::uuid, 1647639, 'Upstart'),
    ('710be30a-b3d9-4fd9-b41c-d1f8e1ef8bb5'::uuid, 912615, 'URBAN OUTFITTERS'),
    ('0d909849-3e6e-47bd-afee-a148720e1882'::uuid, 1681622, 'Varex Imaging'),
    ('54e98259-ba14-4663-88de-24802a36e1a6'::uuid, 103145, 'Veeco Instruments'),
    ('b12bcf3d-bfb9-4155-b6f4-95ea20992567'::uuid, 1827635, 'Veradermics'),
    ('506e6c0d-694a-42ae-a05a-fcf08bbbdf9b'::uuid, 1526119, 'Verastem'),
    ('888c2878-2d15-46e3-8cd6-7931a97f8832'::uuid, 1014473, 'VeriSign'),
    ('ad2aeea8-f10f-4762-97d4-f600825c0882'::uuid, 1792044, 'Viatris'),
    ('c3795820-d180-47b7-9642-4c1f118f392e'::uuid, 2131322, 'Victory Giant Technology Huizhou Co.'),
    ('56d52735-3393-4b3a-ba6d-81f575cec5ab'::uuid, 1692819, 'Vistra'),
    ('c2d2e34e-5b18-4b1b-b7f5-4a2b0d41f901'::uuid, 1396009, 'Vulcan Materials'),
    ('b44a9095-121c-46de-b24e-1b9225b5f394'::uuid, 1319161, 'Warner Music Group'),
    ('4e279f36-4b1b-4385-a24e-36af8c9e2a76'::uuid, 1691303, 'Warrior Met Coal'),
    ('840c83e1-ebc5-423e-8614-c42a526301cf'::uuid, 105016, 'Watsco'),
    ('a1ad9acb-927e-42a7-8566-0c31c44eefbd'::uuid, 1603923, 'Weatherford International'),
    ('d39d3d5e-3846-4432-9f4a-841794887f77'::uuid, 30697, 'Wendy’s'),
    ('27390e0d-135f-45b3-8486-93d176923a46'::uuid, 105770, 'West Pharmaceutical Services'),
    ('a0f3ef56-c6d6-460c-8f0e-5b9279fc1c73'::uuid, 106532, 'Weyco Group'),
    ('aaf76c33-66e1-4cf6-903d-d8f87ca06026'::uuid, 107263, 'Williams Companies'),
    ('b4b095d3-8aae-4c81-a842-d1ddff0e0c47'::uuid, 719955, 'Williams-Sonoma'),
    ('eb1bb873-cdfe-4441-9f1a-dbac0c47eacc'::uuid, 908315, 'Winmark'),
    ('7dc0d636-c086-48c6-8487-0bbd1ac09ecc'::uuid, 1015328, 'Wintrust Financial'),
    ('58c02a3c-f0b0-46cd-bbbd-72e420bab7db'::uuid, 1501697, 'X4 Pharmaceuticals'),
    ('88acefca-3a00-41e7-a20d-5e7cc8e1e8c3'::uuid, 2097163, 'Xanadu Quantum Technologies Limited'),
    ('5a7c04b3-9907-4577-920f-a28ba256b579'::uuid, 1582313, 'Xenon Pharmaceuticals'),
    ('df7b5cd4-1ec0-4f1a-8185-c78bdb91df4a'::uuid, 1810997, 'XPENG'),
    ('6a4add19-053c-462f-8dba-b78f4ba1d559'::uuid, 1670592, 'Yeti Holdings'),
    ('560fd862-93e2-4ada-a5ed-b7f6ef056f19'::uuid, 2068427, 'Zealand Pharma'),
    ('73363984-b55e-4db4-95f7-a8308e30878b'::uuid, 1136869, 'Zimmer Biomet Holdings, Inc.'),
    ('bc33a0d3-6683-45d3-8b15-2529dc156ad5'::uuid, 1937653, 'Zymeworks')
)
SELECT count(*) FILTER (WHERE c.sec_cik = p.cik)  AS stamped_as_intended,
       count(*) FILTER (WHERE c.sec_cik IS NULL)  AS still_null,
       count(*) FILTER (WHERE c.sec_cik IS NOT NULL AND c.sec_cik <> p.cik) AS stamped_other,
       411 AS expected_total
FROM proposed p JOIN companies c ON c.id = p.id;

-- ============================================================================
-- SECTION 3. ROLLBACK. Reverses this file and nothing else: each WHERE is
-- pinned to the row id AND to the exact cik this file set, so a value written
-- by any other process is left alone.
-- ============================================================================
-- BEGIN;
-- WITH proposed(id, cik) AS (VALUES
--     ('2a58a470-bc99-486e-a7ea-63c8d219200d'::uuid, 1070494),
--     ('b4cef861-b368-47de-9d6d-ecd7f0ede8d9'::uuid, 949858),
--     ('5438b02d-6846-43a2-b35c-6fcd8ab94502'::uuid, 880984),
--     ('8e6c164e-7a79-4a02-8ba6-b557a68bc9f1'::uuid, 1670541),
--     ('cf722bdd-d1ae-41db-b9ea-db48c3e0f179'::uuid, 1378789),
--     ('65411a83-7119-4131-839d-2bdabe8f3765'::uuid, 2081206),
--     ('0aa3eefa-43a0-449a-90bb-dee79f29bca0'::uuid, 1378580),
--     ('c20b5937-8f63-4e38-8449-3e77fa7f15f2'::uuid, 903419),
--     ('e0bcfde4-adca-45dc-8da2-95b03ccf9a15'::uuid, 1362468),
--     ('a6879886-641f-4613-b2a5-1090dab79fbc'::uuid, 899051),
--     ('eacc432f-08bf-42e4-8ed7-306d874791e7'::uuid, 40729),
--     ('e9a408fe-a9e3-4433-bc52-37301421128f'::uuid, 1178670),
--     ('9d904e24-05fb-4f5d-b377-d8bbf2d6be7f'::uuid, 1161611),
--     ('8c7179a8-46f2-4b4b-af3a-75170f4b3000'::uuid, 1411579),
--     ('03c6c452-2fdb-4cd2-8499-a82e08424d14'::uuid, 1053507),
--     ('ced30870-5ae6-45d9-bd7c-97d6d201dd08'::uuid, 820027),
--     ('11be8abb-4b04-460d-a269-6ceae9675e26'::uuid, 707605),
--     ('26e931c5-7070-4e9f-b794-37c87fcd1132'::uuid, 6176),
--     ('4f9096a5-0ac4-4d94-8d62-c93cd7c76230'::uuid, 1370053),
--     ('604bcbc4-7b4e-4bd4-9d3d-b6b82a1ae799'::uuid, 1973832),
--     ('7f679826-d4a2-4c1f-98f4-bccac200d7f8'::uuid, 1023024),
--     ('5b364ffc-53ae-4bf0-9d62-ee036014f007'::uuid, 922864),
--     ('67fe6bfe-dd92-4f9a-a682-6147dcbf76c5'::uuid, 1433195),
--     ('8bb2eb81-0107-4fc6-a262-6ef9e8cbf9e6'::uuid, 894405),
--     ('5857f776-6e7f-4ccc-b3db-fe1cf495a10f'::uuid, 947484),
--     ('41877900-bc2a-4956-b00e-6682dfd13010'::uuid, 1768224),
--     ('c0d02715-0160-4f5b-aed2-9e99c948533d'::uuid, 1697862),
--     ('9be6d7d7-cde5-4e35-82e0-ec8c01c9f59a'::uuid, 1820721),
--     ('8305b8db-0109-4764-82e2-b1735f147d52'::uuid, 879407),
--     ('62a9d930-9870-4eab-a252-0af0598e3922'::uuid, 1145986),
--     ('1c13f3a3-0fb5-4d31-bf36-0e3345b26f1e'::uuid, 1487198),
--     ('7afc3f04-45ac-4c72-9c20-5c012f142585'::uuid, 7789),
--     ('7eddba76-5180-45fa-b250-acdb1e9724e0'::uuid, 901832),
--     ('7b6a76f1-4d2a-452a-922f-caf34aced299'::uuid, 2081043),
--     ('be3cf448-1d4f-4ff8-9c6b-9572be264e92'::uuid, 1420520),
--     ('a0a53d11-3c7d-4460-a56f-c951d0a241ce'::uuid, 1683541),
--     ('b6568c8f-7204-4730-98d2-ca1865271c05'::uuid, 350698),
--     ('1a0f8c2a-c3ad-4021-8909-d0a6e9582b7d'::uuid, 1214816),
--     ('b99a0836-986d-4d3d-8084-1d18883a3824'::uuid, 1069183),
--     ('3433936b-26f9-46e9-818f-c5f6559894d5'::uuid, 933974),
--     ('85e6fd49-e02d-4396-9bbc-0cd987afb2f8'::uuid, 1278027),
--     ('d4365507-3258-480b-9be0-cdbf8275d2e9'::uuid, 1429937),
--     ('6edec227-596d-4c1b-b7f3-ec7e3d7051f1'::uuid, 1453015),
--     ('7bbb4ea0-4af7-47ef-a9e1-11ab5329a7ca'::uuid, 1747079),
--     ('a935203d-63a8-494e-9c18-17eb6d50ad56'::uuid, 2127862),
--     ('2a271e31-7c35-4dae-bce1-5d735b363f22'::uuid, 842180),
--     ('4ebbeefa-b82f-4f25-8308-54dcc6b6fc27'::uuid, 891478),
--     ('e4d3e5f2-0e92-4972-89ef-38806d09994a'::uuid, 1504008),
--     ('45f3f08f-5196-4ed9-9316-70a1c9c0966d'::uuid, 1978954),
--     ('408c99f3-9688-44fb-96f5-8588eef53c65'::uuid, 915840),
--     ('0f715b45-0554-490b-b6a6-fa852e096171'::uuid, 842023),
--     ('d018f0b8-b794-4f24-b7f0-7914a5d90f21'::uuid, 834365),
--     ('57196813-55d6-4867-a565-d7feb0482d85'::uuid, 1498403),
--     ('8b2e0952-33d3-43c2-887b-3ba7d01f0cc6'::uuid, 1776985),
--     ('1e061841-8579-425d-94be-c477bf31186f'::uuid, 1720893),
--     ('4386731c-9908-4a00-a553-c3e7a16f6098'::uuid, 1838406),
--     ('7604e8be-0afd-4ecf-a771-e9f2d616f62f'::uuid, 1130464),
--     ('c3d8e115-4157-4163-b6dd-ff3e56a4e85e'::uuid, 1070235),
--     ('69807bb4-f226-4aed-ad28-b59ca4a81a01'::uuid, 1546417),
--     ('6d94b7cc-f799-4e34-9b01-44c009d03742'::uuid, 1589526),
--     ('6d173063-6932-4498-a0b8-9e8a54db4f34'::uuid, 908255),
--     ('13db8ca4-862b-410f-9f2a-89659d8d10ff'::uuid, 949870),
--     ('bc4a41fc-c072-4129-bb80-a2e1d040ecc0'::uuid, 1906364),
--     ('d6b99d4f-acec-4407-b63e-1989445ddf1d'::uuid, 1505065),
--     ('0d8b61d1-cd84-4fb0-a4e6-2f407af62aeb'::uuid, 1071438),
--     ('87704492-ceea-41b8-bd08-a17e6b00a4c5'::uuid, 14272),
--     ('61a1d805-f9fc-44e3-bd01-c71bf2545732'::uuid, 1303523),
--     ('db126811-2463-41ca-ac3d-8805c1387cd8'::uuid, 1383312),
--     ('e620a5b4-c091-4e23-850a-792e6910af2f'::uuid, 1545772),
--     ('7055f3c9-93b8-45b2-b0ce-0aa15650178b'::uuid, 1109354),
--     ('82a76ce5-df3d-4664-b652-9bf750fec8a8'::uuid, 1714174),
--     ('0dae6c3d-4610-4821-9fcc-cf058e5a270e'::uuid, 1447956),
--     ('749c8929-b72e-45c6-9cfa-238b7b521b90'::uuid, 1043277),
--     ('466f0460-a200-4da1-960f-838b30bea464'::uuid, 1632127),
--     ('1351ce5e-91b1-41c8-b76e-be8686bdd107'::uuid, 813672),
--     ('485dfec5-87ee-4da4-9dfb-3a44433bc66e'::uuid, 1035201),
--     ('a04e9040-2814-4717-bc7e-d6d13437f9d1'::uuid, 2034268),
--     ('21a8ab80-ff0b-4cdd-9c4d-d64fd88f1f27'::uuid, 927628),
--     ('16949daa-fdd5-447f-a4dc-e2d5ec705d06'::uuid, 1530721),
--     ('0a1e8fd1-d63f-4f39-984a-874ec53c4a67'::uuid, 2019410),
--     ('c843342d-ed2f-4d72-98ef-9a1b7e35d0e7'::uuid, 1447362),
--     ('dc7027d5-5b4d-4e27-80d4-8fe3c6bbb5b1'::uuid, 1138118),
--     ('47e507c3-45f2-47ca-a54d-bd4640fbafef'::uuid, 949157),
--     ('a0e35816-7939-4d7e-98f6-67240695af86'::uuid, 1324404),
--     ('e3ec17dc-b62f-43ca-9570-2b9afe9ae108'::uuid, 313927),
--     ('8259c117-812c-401d-9bf4-3f890736b52a'::uuid, 759944),
--     ('cfe37bed-12ea-461f-abb8-9c76a485fa34'::uuid, 1441236),
--     ('4dc5f266-d9ed-4c73-b17e-f5cb7e14fbb6'::uuid, 1780785),
--     ('b6972604-6cc8-4fb2-85c9-c8626686eb65'::uuid, 1070412),
--     ('90335c06-e540-4386-a6e1-e221fc702af4'::uuid, 1284812),
--     ('f91be27f-1533-4712-a3c9-4ecf2919f670'::uuid, 887343),
--     ('606f91a7-ff8e-42f7-8177-0127820e2742'::uuid, 1050797),
--     ('e65ef23e-3fc9-4c22-aae4-09b33b8a037d'::uuid, 1012037),
--     ('6edc94ff-93bf-4d41-81aa-84b1eac1445b'::uuid, 1563190),
--     ('48f47aa5-df9a-4dc3-abb4-7bb318050545'::uuid, 1119774),
--     ('c43c607f-7100-44ff-a4e4-587b68abedab'::uuid, 816956),
--     ('5188f910-7190-4dc2-a477-1d6f5a49d12c'::uuid, 2070829),
--     ('30c2fc6a-b24e-4f17-b183-adbdefa20ebd'::uuid, 2064307),
--     ('25264ff1-f9cd-4a1b-ae1c-256f220839df'::uuid, 1088856),
--     ('28118241-4373-4e29-90bb-bce83ca02c27'::uuid, 1026655),
--     ('d1efc560-47fc-4975-a647-e7335b985808'::uuid, 1070985),
--     ('51dbf790-fbff-4983-a5a8-2a782908a96f'::uuid, 1743759),
--     ('04fbd49d-c88b-4f5f-bf5c-c85bc61d49da'::uuid, 1755672),
--     ('dd023a0e-6519-4be0-8e38-2dea1719beb2'::uuid, 1832928),
--     ('bb10d95d-b556-4f4e-8497-cf9055680698'::uuid, 1576427),
--     ('f667818a-cf94-436b-9186-401d10e760f8'::uuid, 1334036),
--     ('7be9b55d-672f-4f04-b9dd-20bbf658443d'::uuid, 1298675),
--     ('ed9be63c-145b-4053-b17b-ca190ed3bc6a'::uuid, 26172),
--     ('71a7fe83-49bf-4d0b-8ed8-45a70df462db'::uuid, 64803),
--     ('841c9245-87ba-4e3b-aa97-6647dc20e809'::uuid, 1437712),
--     ('45eb2fc8-7d89-4cfa-a9eb-d07096e0c094'::uuid, 1694426),
--     ('21bcc70f-d820-4078-96d3-61d6de6fa278'::uuid, 1050140),
--     ('1b03011e-cbdf-4a96-9ba0-c9e014242a7c'::uuid, 813298),
--     ('e043e420-71e9-4fc6-b7e7-5895871b2461'::uuid, 1049724),
--     ('dd43b9e8-4b7c-4ae4-a614-381498d2bb3a'::uuid, 909108),
--     ('c545478f-97f0-4caa-8b8e-fe54f485e7c6'::uuid, 317788),
--     ('caddae6f-a848-4ba9-afe4-05f92a6cd160'::uuid, 1857475),
--     ('caa17d5f-c70c-419a-9911-57fddef60ef0'::uuid, 29905),
--     ('4eb72ca4-b744-42b2-893c-dfc870875e89'::uuid, 2094201),
--     ('4621237c-d855-43ab-aec7-ee20857201dd'::uuid, 1804745),
--     ('9a0d2558-4eca-491e-bf21-51e2fe8b1c68'::uuid, 1136808),
--     ('858682c6-deef-4af1-b24a-4c31b173b4f1'::uuid, 31235),
--     ('c7a6c9b2-7ef5-4180-b3e9-6c7ebcdeb295'::uuid, 1590714),
--     ('caac6b49-210c-4cb5-9061-845deb2dbe07'::uuid, 1969796),
--     ('8eda13dc-89ae-4f52-a0b3-ee21064422c9'::uuid, 1127248),
--     ('d8ee941c-e236-4133-a5fe-ff0e76f3cdbc'::uuid, 32604),
--     ('40e49de8-2a57-4c76-bff1-ef16e3588f94'::uuid, 1084961),
--     ('60fa4a41-06c7-4752-a245-92be85c767d5'::uuid, 1140625),
--     ('4cd9bc95-6364-45af-9b84-24a54c443974'::uuid, 1333986),
--     ('015e1dd9-ae0a-4b85-94f6-a660aaacd9c9'::uuid, 1434868),
--     ('f5315772-f5a1-470e-b24f-785fa7eb16bb'::uuid, 1412558),
--     ('a18f0c30-365d-46f5-824a-0c8cb0b29fbd'::uuid, 939767),
--     ('ca369570-dc51-4e1d-b667-d6d8bfa395dc'::uuid, 1109357),
--     ('ab4bcf16-d848-43a8-9020-5d012a812f89'::uuid, 2115436),
--     ('fe990a20-893f-4dcf-a8c7-1a6a21be947d'::uuid, 814547),
--     ('199fcbf8-8e70-4f22-b6bf-fa3f77a49700'::uuid, 915191),
--     ('d987372c-3f3b-4a12-a2d6-cd8f4670dbba'::uuid, 277509),
--     ('4eb3bd64-92e8-4472-8c22-88d25ca50ab5'::uuid, 1648416),
--     ('c1061f2e-f29a-4e8f-aba9-4b5e67eda0ec'::uuid, 1468522),
--     ('196af0c4-0323-455c-8f57-679fd6d94afa'::uuid, 1098151),
--     ('177f5877-34f7-4382-acdf-58b16c887c2a'::uuid, 1331875),
--     ('b8f22e06-b870-4ab5-b3b6-22ded57daf9b'::uuid, 2073638),
--     ('209f2f09-cb25-4e1d-8590-5056fd301b5d'::uuid, 1746109),
--     ('aefb7b8b-8bba-4d85-bd4a-48cc095f38fb'::uuid, 860413),
--     ('718ec183-7678-4518-8d01-3cbd92c15b31'::uuid, 1666175),
--     ('0f3b28b6-c3a5-4d29-954e-1f04d0606231'::uuid, 1828377),
--     ('441b3816-6813-472c-bbac-8238aefd8d2c'::uuid, 1559444),
--     ('dc5198b0-c198-44a2-95e9-8e9e1a704d4c'::uuid, 1456346),
--     ('e3e97199-9214-4f8f-8288-195d66ee36a4'::uuid, 1320854),
--     ('86418122-85a6-4f9a-a6d1-6e7dab5684fd'::uuid, 887936),
--     ('6f9742e0-2758-4c30-8eb9-4c69bbc8d9c8'::uuid, 700564),
--     ('ed12e388-1d66-4745-b66e-f99e8786a824'::uuid, 1704711),
--     ('67cda1e8-ae72-400f-86c9-5ebc0a776912'::uuid, 1996810),
--     ('85d2b0c6-7c32-48ae-8ff4-e0ac6da4be88'::uuid, 1474968),
--     ('b9bb6061-2ddb-469b-a157-0a1720198442'::uuid, 849399),
--     ('e3bf8db7-24fa-41b4-80c1-4da9dc0406c2'::uuid, 2074850),
--     ('a3f9789c-ca15-4d19-9953-cbed40cc55b6'::uuid, 2100782),
--     ('f240ef76-f7c6-46a0-96ef-edb5b51f4cbc'::uuid, 1022321),
--     ('40a542eb-c2a4-4152-8d45-eaedb15b73f7'::uuid, 1434265),
--     ('59614a6e-dc78-4b4a-9ae4-c7d171b4d61e'::uuid, 355811),
--     ('5602b4fc-92d3-48f2-900d-f9e84f36f7e0'::uuid, 903129),
--     ('2282debc-6c62-46b6-ad65-afea4e1696ef'::uuid, 1898496),
--     ('57855961-8b70-4379-a953-45a9e63a195d'::uuid, 2071913),
--     ('6b648f58-a4ab-4e2c-8174-1c801ff683c7'::uuid, 1857816),
--     ('5a0715d4-e258-4c18-8f0c-48577bcf67a0'::uuid, 897322),
--     ('95d22579-53d8-476f-83c4-5db780830a0d'::uuid, 882095),
--     ('d78c0ee4-31d9-4a09-80f7-d1d05012e9af'::uuid, 1830214),
--     ('e63a769b-fba8-4afc-9cca-833e7f15a16e'::uuid, 1653482),
--     ('0111093a-fca9-462b-82a4-e3b3ffd68782'::uuid, 1609711),
--     ('c96ccd9f-7230-4558-9bb6-c7d46b9d801d'::uuid, 1273441),
--     ('b6764f15-f0a4-4738-9c17-3d5b16a4186f'::uuid, 1434588),
--     ('ac87b972-93e9-4419-b485-4d66034ff77f'::uuid, 1771515),
--     ('96bfc6d4-5679-44da-9539-3010d42b679e'::uuid, 912892),
--     ('d8487ec2-464b-4796-89f2-8cc345949e66'::uuid, 1802255),
--     ('aa9a72ba-b514-4df1-8d91-4a5b7e8aca0c'::uuid, 1483994),
--     ('f0c712ec-1f90-4197-ace8-bc028a12222e'::uuid, 2073669),
--     ('91d049f5-e7bd-4942-8bbd-65f886c140a0'::uuid, 1802665),
--     ('a55bc6e4-53a9-4a06-a425-b2a03e51a43a'::uuid, 860730),
--     ('9cb581e8-7d57-4946-8e4b-67114c3d96f7'::uuid, 1144967),
--     ('313699f7-165c-4a2e-ade1-bc1a2c0969d1'::uuid, 719413),
--     ('8e0b0ff9-6c33-45ad-b714-017cf3782efd'::uuid, 46619),
--     ('8a873e47-d22a-4b9e-ae2f-f66290997969'::uuid, 1364479),
--     ('bf3bba1a-a5b0-4d72-98fc-488a5bd315e4'::uuid, 1446962),
--     ('7361687b-ee93-4cef-b71d-7bf76fc634ca'::uuid, 49196),
--     ('ecbb4091-1b58-4c03-ab01-d6864ab9198f'::uuid, 1718405),
--     ('6cb4bf0c-0588-4fd9-939e-457f8cd83d91'::uuid, 2078856),
--     ('62d86dbf-975e-4b64-a427-7c1a852ea145'::uuid, 1538379),
--     ('0e7873d4-a0ab-47e9-814a-79657e8144e8'::uuid, 1103838),
--     ('31596b3f-e083-482b-bd37-06448722449d'::uuid, 2062803),
--     ('2d3070b2-2a26-4e52-ba3c-8e928a5856cc'::uuid, 1790340),
--     ('d2e7b7a3-6f08-4bf5-904b-dff22a8dca83'::uuid, 1067491),
--     ('b5b4dca8-d39e-455d-b75d-9ba7b796641f'::uuid, 1774163),
--     ('9040e46a-8d0a-4479-aa4f-4011a1aec014'::uuid, 1114483),
--     ('4f115e27-d51c-4760-a22d-18ebd9938102'::uuid, 917520),
--     ('ab6b87f7-b5c0-4dc3-8c6c-72a6ff14d07f'::uuid, 1652130),
--     ('45b9d2d7-5867-4af1-9788-d0ea2bf21313'::uuid, 1405495),
--     ('dc99d8ab-018e-4142-bb8e-246dfc467cdd'::uuid, 1425205),
--     ('e70746fe-9049-4ed3-90c8-f857e3d94304'::uuid, 1020569),
--     ('24377324-181e-4bc2-b9fa-2fb213150ced'::uuid, 1009829),
--     ('1d9382ae-04b4-4763-a005-7a55e1dd749b'::uuid, 1600520),
--     ('99770153-b800-4d12-8b16-160403329878'::uuid, 1549802),
--     ('bb7d9505-f72f-4f82-b399-6477f0742301'::uuid, 1674335),
--     ('d7972265-365c-4cbd-98a7-159f3613a8fb'::uuid, 2127043),
--     ('83e9977d-70b4-4dcc-ab02-1476801c5cb7'::uuid, 1357615),
--     ('1f2f4e3c-ceee-43fb-b015-59285eee3f46'::uuid, 91576),
--     ('b32d07b3-729d-4832-a2b3-198320acfaa7'::uuid, 1601046),
--     ('04af6598-f431-449b-ba17-e86d7300cf4c'::uuid, 55785),
--     ('757edfb0-de82-42e2-9682-92550f0c48e4'::uuid, 2053383),
--     ('c972472d-144e-4b1d-9e52-6c5928d16c44'::uuid, 2033019),
--     ('6c0beff6-5373-4682-a5b2-9cb52571ac30'::uuid, 1857154),
--     ('af6d9f1b-679a-4b7f-8d8c-2157491c5a8d'::uuid, 56873),
--     ('3b5555ee-758f-41fa-b011-fb7a0cb5c0a7'::uuid, 1679273),
--     ('f1f3315f-d8c4-436a-9014-47c02d21bf3e'::uuid, 1521036),
--     ('d31c7904-3540-4061-9100-9e8aca84cd53'::uuid, 2068440),
--     ('5dd572ad-1e41-43cc-90f2-1e359fc94ff2'::uuid, 1069202),
--     ('eb2bbe14-b155-4ea2-a64a-0a74405385d2'::uuid, 1580670),
--     ('8101c4e1-9458-49be-b04d-5bd013b5b320'::uuid, 849146),
--     ('e83c3235-20e4-4c46-bd92-caf5beacd801'::uuid, 886163),
--     ('c3a2619a-1bc3-4fbb-acb4-26bf8e8e8d92'::uuid, 59558),
--     ('74ab5dad-8ca9-47fe-b450-1ad4d9406bd7'::uuid, 2140948),
--     ('71519329-a4cb-4d19-93af-cb0dc70b7cea'::uuid, 1023128),
--     ('4e68c911-71cd-41cf-97bd-8076c0c94ba1'::uuid, 1462120),
--     ('3778ec3b-adf7-4547-b0a8-9898ee18692d'::uuid, 733269),
--     ('378c0d7d-d496-4360-9d95-fd8377663298'::uuid, 1160106),
--     ('3496b52d-df1c-4e22-a8c0-e8ba63830664'::uuid, 1831631),
--     ('5a9d7aeb-c466-49c3-9382-a67a340f169d'::uuid, 60086),
--     ('398fe069-92de-4f0a-92e8-474fff3093ec'::uuid, 1767582),
--     ('03476ec7-4dcb-442c-8822-fe7e60f28879'::uuid, 1489393),
--     ('5c8bc39d-cc2d-43fc-92a0-df9ec847fb1d'::uuid, 749098),
--     ('680b460c-a1ef-4c8d-be26-25b8222ee205'::uuid, 1495153),
--     ('4f50c656-d8af-419d-8f5b-3e81039c924c'::uuid, 1086888),
--     ('7850e41f-9fa0-411b-b314-65b4b602f411'::uuid, 2131961),
--     ('b35f13f1-ab26-47a1-bf52-af977eb2974d'::uuid, 1048286),
--     ('953df921-711a-4ef3-845d-4dc7b210ac66'::uuid, 799167),
--     ('84332844-fda6-410e-9a6b-fa52790cdf0a'::uuid, 1668397),
--     ('039714ac-bd75-46f5-8521-73fa1fdd8049'::uuid, 1042729),
--     ('e30e2af2-49a1-4f55-9ed2-a0d23623d097'::uuid, 833079),
--     ('9ccef504-78fb-45e1-9e89-c56b41ef2121'::uuid, 2090231),
--     ('637aa6b8-6da5-4f58-b90d-d7efeb908c36'::uuid, 1760689),
--     ('010372bd-8c4d-4cc4-a87b-4f6593a9d26b'::uuid, 2039784),
--     ('7c924ae7-3041-4f16-bc78-ca06a858c1e3'::uuid, 924822),
--     ('85a1766d-1cb6-4f75-87a1-e6875f1c195e'::uuid, 1436126),
--     ('a7a46c35-dbc2-489d-ab1e-e3e3a80c0040'::uuid, 67347),
--     ('fc0bd7c2-a123-4c8e-b6c0-8747f48a0641'::uuid, 865752),
--     ('65c9ddaf-6a1c-44cb-874a-aefe909c568f'::uuid, 2123346),
--     ('76ba3fec-13ae-4210-82e1-5d723d5e93da'::uuid, 1350593),
--     ('6eda5d47-02ea-41c9-87d0-86e22265a8af'::uuid, 899923),
--     ('2bd4e6b1-745b-46de-accd-e34ab50ed359'::uuid, 1795251),
--     ('8b2aa808-1675-4ac0-a7e8-2812321d068a'::uuid, 69633),
--     ('a9ddef20-a9cd-4899-b248-525fa090d252'::uuid, 1004315),
--     ('0eee5e37-b308-4995-a0a2-b272c0746fec'::uuid, 844150),
--     ('684e1591-3a30-480f-b562-3828aaa3a006'::uuid, 1901279),
--     ('df303dcb-e0b0-4571-b3fd-b19cad95bbe0'::uuid, 1110646),
--     ('eb477c21-df9e-4742-aca8-c7b94bd5c282'::uuid, 814453),
--     ('89b5dca1-03b1-4388-b836-2b0379623884'::uuid, 753308),
--     ('10b50cd0-eed9-44d1-9890-4be0e3e38ffd'::uuid, 1124796),
--     ('f3e9294d-ecda-42a0-bed8-18271a406a8d'::uuid, 2072389),
--     ('f5ebe02e-89b6-49ef-94bd-b6b2a1a3f6ed'::uuid, 1173420),
--     ('4d816cf4-8a9f-4f0a-9be5-f4ad9eaa8fe9'::uuid, 1114448),
--     ('61d3a428-3196-46d7-b565-a9445c298640'::uuid, 1859795),
--     ('781671cf-2372-4ec9-8b98-03a3c88aee5f'::uuid, 1814215),
--     ('b424f501-704d-4140-acf2-9b550c65a6cd'::uuid, 73309),
--     ('0db06c25-57be-4f15-ac7a-389bab9d2966'::uuid, 1479681),
--     ('db94ccba-0a9e-43af-8e51-186d63ba7b66'::uuid, 1861560),
--     ('b7ac4c3e-0db9-4e38-a276-1616cef99d16'::uuid, 2088339),
--     ('4288868b-c8be-422d-ac64-40863392367a'::uuid, 1334388),
--     ('84cc2250-94c1-4900-9dcb-aefae92f6bcb'::uuid, 73756),
--     ('c1cdce71-55ef-4213-b8c3-3a1d63b7f88c'::uuid, 1882782),
--     ('40ff0f77-f7a6-4d01-baaf-8eccc8333098'::uuid, 878927),
--     ('caacad17-b33a-4404-8cba-ce4b3ea407d8'::uuid, 1750284),
--     ('56c432db-7c9d-4737-8d7d-02913836b002'::uuid, 1637715),
--     ('f9989656-521b-4cc5-8d08-5a0f6c563619'::uuid, 704532),
--     ('6e4e038f-57e4-4921-b605-3e6e6bf09dca'::uuid, 775158),
--     ('b0403540-c2eb-4f58-a2bb-d1a1522af688'::uuid, 1636651),
--     ('e4525662-ad9d-4fd7-a736-2a21c869455e'::uuid, 821483),
--     ('91476708-694e-4c52-942b-f8eccd9bc1e2'::uuid, 2119292),
--     ('8372a5b6-06dd-45d8-867c-7c2cc3e53026'::uuid, 1383414),
--     ('3e10ef20-760d-49db-b634-7e0005a3bd06'::uuid, 1455633),
--     ('14c4f47d-94c7-4706-801a-fdec8642c06c'::uuid, 77360),
--     ('04f89953-cb99-46af-833f-45561abf22db'::uuid, 891532),
--     ('48c9d5e9-acfb-4da2-9df6-679efc2fd730'::uuid, 2026053),
--     ('f3f6ad52-1da2-4e21-9065-c6f0d88e2dad'::uuid, 1069899),
--     ('132d1ea7-3b79-416c-929c-cf538e2c093a'::uuid, 810136),
--     ('79454f6c-0eee-4a7d-a4a2-5266d4bd1d03'::uuid, 1437441),
--     ('3760bdcc-8c7f-4615-bf53-cd47b6f81ef4'::uuid, 1784535),
--     ('30883a17-ef7c-4340-ac31-b440be1fe4e4'::uuid, 1894562),
--     ('dd5ac907-f852-4f49-8478-778d002a5be1'::uuid, 876167),
--     ('7976a80b-a459-4212-a3e3-6937847f667f'::uuid, 1551306),
--     ('0b8b7794-969f-4238-ab30-0e64497f5079'::uuid, 1068851),
--     ('8f4f6311-2732-4c34-9e7b-fc799d3d5f5b'::uuid, 1137774),
--     ('21a2b00d-98a0-45cd-bc54-f9ccf1043e49'::uuid, 1782999),
--     ('b10e39d7-d0bc-464e-8395-bfca4096174a'::uuid, 78239),
--     ('c8eca83d-b0b5-4df1-94d7-895ddcd350bc'::uuid, 906465),
--     ('2c796439-da12-406d-8ecf-0aa5b8d47982'::uuid, 1015820),
--     ('d423c9f0-0207-43d0-ae52-3503dba94ca9'::uuid, 2058873),
--     ('fd519c2a-6c5c-4cab-a18a-e3f235a3ca86'::uuid, 1503274),
--     ('f95dbf47-8fc8-4036-aac6-60cf536d06c9'::uuid, 1022079),
--     ('b679988a-d9dd-43cd-a643-9c908c94b70b'::uuid, 1117297),
--     ('345d131f-f564-482f-975b-c1d794211185'::uuid, 1739410),
--     ('3c0aebcd-0e60-4318-ad68-153db20fc35b'::uuid, 1037038),
--     ('2cc8f498-c5fa-4331-9cea-e725b0a36c07'::uuid, 315852),
--     ('aa5de138-64e8-411f-8a00-710dfc83e16e'::uuid, 935419),
--     ('297e8905-5f6d-452e-935c-131fdc458143'::uuid, 700841),
--     ('e6e7dd83-a925-4e00-aec9-bec1efcd3e9b'::uuid, 82811),
--     ('a61582b6-31c6-4d73-beea-64777536135a'::uuid, 1281761),
--     ('e259fc86-df8e-40fd-88d6-0e727f618641'::uuid, 1812364),
--     ('d46d4777-125a-4086-91c1-801931500b63'::uuid, 1618756),
--     ('d99e526f-da24-4a6c-bfd6-d2abe302a1d9'::uuid, 1628171),
--     ('91fac195-6964-4678-a604-0fe928c8317f'::uuid, 1786431),
--     ('21c052bc-e0a5-440a-bf1b-2878fa703737'::uuid, 355948),
--     ('578eb178-f386-4a42-84c6-ee5a5025de67'::uuid, 2141099),
--     ('3c928d59-e582-4092-a47f-77a802db17ef'::uuid, 1516536),
--     ('1309723d-2375-4157-9c60-00a3686eb3d0'::uuid, 1281895),
--     ('3606bab5-31fd-49fa-9724-13327dedf325'::uuid, 1969729),
--     ('605896b7-a928-4e62-bd02-c6727a651c1a'::uuid, 1770114),
--     ('716042ea-dd3a-4a7f-bad3-27c2cd6b201d'::uuid, 1584273),
--     ('11fa29e1-245c-4466-9358-734fd14b1a61'::uuid, 2072563),
--     ('0d058698-c50f-4677-a235-2d0dc49b7e06'::uuid, 1874315),
--     ('7be1499a-1c1b-46e9-b5e4-d99d141ed968'::uuid, 1655190),
--     ('4bff9990-bfbc-4dc7-802e-0d94eb7b5fae'::uuid, 866729),
--     ('c8450765-3a17-4ddf-91ac-fab5b440ffe6'::uuid, 825542),
--     ('83d32041-2613-48bf-bb59-76059e182cbf'::uuid, 88121),
--     ('1db94c42-0cfe-44df-ac10-f21cbf05e8bf'::uuid, 1329213),
--     ('d9e0999c-c46c-4c38-8107-e751f0f3ee0c'::uuid, 1583708),
--     ('30549cbb-f336-48ae-b076-1b9b175e07d4'::uuid, 2099326),
--     ('6b4394fa-73e5-4d03-95d5-8e6579f50eaa'::uuid, 1359519),
--     ('4947cb79-5a75-455a-9b9b-851eb95f3214'::uuid, 1662991),
--     ('2d1b70cb-63c2-4a4e-aaf4-d26f4a6e36a3'::uuid, 354963),
--     ('241855bc-8a02-4925-a302-15bf56ef72ca'::uuid, 1830056),
--     ('e59aafc5-33c7-4471-8def-b002a3648ba0'::uuid, 2073972),
--     ('a7b00468-88cb-47f8-8462-e51c50a80ce1'::uuid, 1063761),
--     ('739114ed-f904-4ed2-b090-da090c80a122'::uuid, 2120882),
--     ('a5e48aa4-2fea-4660-88a8-74151b9129de'::uuid, 827187),
--     ('9f10477f-88cc-40d5-8c45-f6e5383f24ca'::uuid, 1032033),
--     ('d06bb656-6bc5-4337-8ba0-17a7746419f6'::uuid, 91440),
--     ('61f35ec9-5e80-415f-bcc2-5eb524280647'::uuid, 92122),
--     ('719162d5-fb07-4b65-a49e-74ecd517a294'::uuid, 1132105),
--     ('f5000e8a-c09b-434d-a27c-cc9aadf362c2'::uuid, 718937),
--     ('405a81b8-8c47-4b7a-9a76-24758d41c564'::uuid, 310354),
--     ('fd1351a0-d811-48a5-9f3c-fd01b1dde8ab'::uuid, 93556),
--     ('d6fc81e5-4385-4bb4-9a76-e4bde69615f6'::uuid, 1605484),
--     ('26332896-381c-453b-9531-309eb9e06a16'::uuid, 1757898),
--     ('da85cb35-4c61-4bcc-9ec2-ca264fbacb66'::uuid, 2027330),
--     ('6bf829c4-a700-49e9-be97-5d3998f97c3c'::uuid, 1097362),
--     ('385df117-4ad2-4f59-a0f9-d75f6b7a1e06'::uuid, 2083785),
--     ('ea202e9d-1efa-4fd3-ac0f-49a06e0c2d0e'::uuid, 1514705),
--     ('8fa256fd-b9e0-4239-a157-e73039a5d837'::uuid, 1838987),
--     ('9f7aa6be-e52a-4eaf-9fd0-d922104ceb0f'::uuid, 1356576),
--     ('c70f7f3d-00bf-464b-9698-5932cac284c2'::uuid, 1837240),
--     ('5197d4d6-3372-438b-9d13-df19f87acc57'::uuid, 96021),
--     ('d736cdce-bc42-4db0-972e-ff2a6ad7005e'::uuid, 1116132),
--     ('f8c84465-b957-465b-bd58-80880a338238'::uuid, 1232384),
--     ('fe8dc90b-c0ef-4ec2-be1a-1d3705814308'::uuid, 2073804),
--     ('167db014-da2a-410c-a62b-ef3368104f8e'::uuid, 2018064),
--     ('2c74abbe-e907-43a9-82be-6751ea0c9d60'::uuid, 932470),
--     ('1578dfe7-8480-40ef-9339-13729b95a04c'::uuid, 96943),
--     ('ef109d38-7e8b-4612-a17b-e066e38592b7'::uuid, 1190723),
--     ('6ac8b247-41ad-46cc-96c2-441531cba199'::uuid, 70318),
--     ('b2929002-0c21-45f1-bc9d-5805832f0f30'::uuid, 97216),
--     ('ab5f7bd9-9e67-4125-a202-42995be17467'::uuid, 1342874),
--     ('de956e7f-ad0e-4306-bc27-7493ceae213e'::uuid, 1390777),
--     ('4aadbf7c-dea5-45c6-a27e-e2aa58c818d3'::uuid, 21076),
--     ('f1637f00-e16b-4b3d-8848-2f0bc13e89ab'::uuid, 21344),
--     ('de512bb5-1b76-4ed2-9b28-be753a137c85'::uuid, 2073913),
--     ('ccc765d7-7682-4375-8e8a-03b76e5bc864'::uuid, 1862461),
--     ('e2fc418e-e6bd-42e0-a5d9-9e863fa98740'::uuid, 1583107),
--     ('db6cc338-dac6-47b3-b92c-c450237da720'::uuid, 1075124),
--     ('7e07a5e3-2dfc-48cc-9be0-591a68fc562d'::uuid, 109198),
--     ('4360821d-ee3d-4011-a0fc-c3a9bd43795f'::uuid, 1296484),
--     ('9423568b-b714-4712-b00b-d3df657b3c86'::uuid, 2072098),
--     ('3d0f92ad-438b-4e93-bc4e-70435c683ae0'::uuid, 947263),
--     ('caea5b7a-6514-4503-a4ba-20ce91b117f4'::uuid, 2071881),
--     ('1343ae1f-6dd7-4560-a550-eff5ff39e85e'::uuid, 2018139),
--     ('aca318ba-d3ca-4dd8-be52-f31e57025cfb'::uuid, 1133311),
--     ('ac6365c2-9955-4504-bf49-a733efadfa83'::uuid, 1013880),
--     ('489ba2a2-8ee9-48f9-8701-a1a2c0f93226'::uuid, 100493),
--     ('9246ed54-0562-43ca-9ce2-7050f70cc3e0'::uuid, 4457),
--     ('aa0ee2df-d4c9-489c-bc58-6c2bbe22f7f0'::uuid, 1901440),
--     ('2cbacff6-1fbc-475d-8d1d-24c946ef998a'::uuid, 1590560),
--     ('8269b20e-3b7c-4c70-9db8-ffc7f98eccc5'::uuid, 102037),
--     ('5cf12072-1453-4b74-b255-8194abcc811a'::uuid, 1890126),
--     ('c8da1917-c5d9-4456-a0fc-b32aaff685ed'::uuid, 1647639),
--     ('710be30a-b3d9-4fd9-b41c-d1f8e1ef8bb5'::uuid, 912615),
--     ('0d909849-3e6e-47bd-afee-a148720e1882'::uuid, 1681622),
--     ('54e98259-ba14-4663-88de-24802a36e1a6'::uuid, 103145),
--     ('b12bcf3d-bfb9-4155-b6f4-95ea20992567'::uuid, 1827635),
--     ('506e6c0d-694a-42ae-a05a-fcf08bbbdf9b'::uuid, 1526119),
--     ('888c2878-2d15-46e3-8cd6-7931a97f8832'::uuid, 1014473),
--     ('ad2aeea8-f10f-4762-97d4-f600825c0882'::uuid, 1792044),
--     ('c3795820-d180-47b7-9642-4c1f118f392e'::uuid, 2131322),
--     ('56d52735-3393-4b3a-ba6d-81f575cec5ab'::uuid, 1692819),
--     ('c2d2e34e-5b18-4b1b-b7f5-4a2b0d41f901'::uuid, 1396009),
--     ('b44a9095-121c-46de-b24e-1b9225b5f394'::uuid, 1319161),
--     ('4e279f36-4b1b-4385-a24e-36af8c9e2a76'::uuid, 1691303),
--     ('840c83e1-ebc5-423e-8614-c42a526301cf'::uuid, 105016),
--     ('a1ad9acb-927e-42a7-8566-0c31c44eefbd'::uuid, 1603923),
--     ('d39d3d5e-3846-4432-9f4a-841794887f77'::uuid, 30697),
--     ('27390e0d-135f-45b3-8486-93d176923a46'::uuid, 105770),
--     ('a0f3ef56-c6d6-460c-8f0e-5b9279fc1c73'::uuid, 106532),
--     ('aaf76c33-66e1-4cf6-903d-d8f87ca06026'::uuid, 107263),
--     ('b4b095d3-8aae-4c81-a842-d1ddff0e0c47'::uuid, 719955),
--     ('eb1bb873-cdfe-4441-9f1a-dbac0c47eacc'::uuid, 908315),
--     ('7dc0d636-c086-48c6-8487-0bbd1ac09ecc'::uuid, 1015328),
--     ('58c02a3c-f0b0-46cd-bbbd-72e420bab7db'::uuid, 1501697),
--     ('88acefca-3a00-41e7-a20d-5e7cc8e1e8c3'::uuid, 2097163),
--     ('5a7c04b3-9907-4577-920f-a28ba256b579'::uuid, 1582313),
--     ('df7b5cd4-1ec0-4f1a-8185-c78bdb91df4a'::uuid, 1810997),
--     ('6a4add19-053c-462f-8dba-b78f4ba1d559'::uuid, 1670592),
--     ('560fd862-93e2-4ada-a5ed-b7f6ef056f19'::uuid, 2068427),
--     ('73363984-b55e-4db4-95f7-a8308e30878b'::uuid, 1136869),
--     ('bc33a0d3-6683-45d3-8b15-2529dc156ad5'::uuid, 1937653)
-- )
-- UPDATE companies c SET sec_cik = NULL
--   FROM proposed p WHERE c.id = p.id AND c.sec_cik = p.cik;
-- COMMIT;

-- ============================================================================
-- BLOCK B. FORMER-EDGAR-NAME-ONLY MATCHES. NOT APPLIED. DO NOT UNCOMMENT AS A SET.
-- All 26 were adjudicated one by one. 6 are wrong pages: an abandoned EDGAR name
-- now belongs to an unrelated registrant, or to a subsidiary rather than the parent.
-- 19 are correct and 1 is arguable. 23% wrong is far above this file's bar, so the
-- whole block is withheld for a human to pick from.
-- ============================================================================
--   ATAI Life Sciences               former 'ATAI Life Sciences N.V.' -> cik 1840904, now 'Atai Beckley N.V.' ['ATAI']
--   BeiGene                          former 'BeiGene, Ltd.' -> cik 1651308, now 'BeOne Medicines Ltd.' ['ONC', 'BEIGF']
--   Bendon                           former 'BENDON GROUP HOLDINGS LTD' -> cik 1707919, now 'Cenntro Inc.' ['CENN']
--   BigCommerce                      former 'BigCommerce Holdings, Inc.' -> cik 1626450, now 'Commerce.com, Inc.' ['CMRC']
--   Boston Properties                former 'BOSTON PROPERTIES INC' -> cik 1037540, now 'BXP, Inc.' ['BXP']
--   Carter's                         former 'CARTER HOLDINGS INC' -> cik 1060822, now 'CARTERS INC' ['CRI']
--   CPB Inc.                         former 'CPB INC' -> cik 701347, now 'CENTRAL PACIFIC FINANCIAL CORP' ['CPF']
--   Cullinan Oncology                former 'Cullinan Oncology, Inc.' -> cik 1789972, now 'Cullinan Therapeutics, Inc.' ['CGEM']
--   ENPRO INDUSTRIES                 former 'ENPRO INDUSTRIES, INC' -> cik 1164863, now 'Enpro Inc.' ['NPO']
--   eXp Realty                       former 'EXP Realty International Corp' -> cik 1495932, now 'AGNT, Inc.' ['AGNT', 'EXPI']
--   EyePoint Pharmaceuticals         former 'EyePoint Pharmaceuticals, Inc.' -> cik 1314102, now 'EyePoint, Inc.' ['EYPT']
--   Foxconn                          former 'FOXCONN HOLDINGS LTD' -> cik 1164009, now 'FIH Mobile Ltd' ['FXCNY', 'FXCNF']
--   Iliad                            former 'Iliad Holdings, INC' -> cik 1389050, now 'Archrock, Inc.' ['AROC']
--   Inditex                          former 'Inditex Group' -> cik 1438656, now 'Industria de Diseno Textil Inditex SA / ADR' ['IDEXF']
--   MKS Instruments                  former 'MKS INSTRUMENTS INC' -> cik 1049502, now 'MKS INC' ['MKSI']
--   Montrose Environmental           former 'Montrose Environmental Group, Inc.' -> cik 1643615, now 'Onterris, Inc.' ['ONT']
--   NextEra Energy Partners          former 'NextEra Energy Partners, LP' -> cik 1603145, now 'XPLR Infrastructure, LP' ['XIFR']
--   Porsche                          former 'Porsche AG / ADR' -> cik 1450346, now 'Porsche Automobil Holding SE / ADR' ['POAHF']
--   Relief Therapeutics              former 'Relief Therapeutics Holding SA' -> cik 1854078, now 'MindMaze Therapeutics Holding SA' ['MMTZF', 'RLFTY']
--   Roper Industries                 former 'ROPER INDUSTRIES INC' -> cik 882835, now 'ROPER TECHNOLOGIES INC' ['ROP']
--   The Washington Post              former 'WASHINGTON POST CO' -> cik 104889, now 'Graham Holdings Co' ['GHC']
--   Theravance                       former 'THERAVANCE INC' -> cik 1080014, now 'Innoviva, Inc.' ['INVA']
--   Thrive Capital                   former 'Thrive Capital Group Co., LTD' -> cik 2058349, now 'ETOILES CAPITAL GROUP CO., LTD' ['EFTY']
--   Tilray                           former 'Tilray, Inc.' -> cik 1731348, now 'Tilray Brands, Inc.' ['TLRY']
--   Washington Federal               former 'WASHINGTON FEDERAL INC' -> cik 936528, now 'WAFD INC' ['WAFD', 'WAFDP']
--   Zions Bancorporation             former 'ZIONS BANCORPORATION /UT/' -> cik 109380, now 'ZIONS BANCORPORATION, NATIONAL ASSOCIATION /UT/' ['ZION', 'ZIONP']
-- ADJUDICATED WRONG, do not apply: The Washington Post (Graham Holdings), Theravance
-- (Innoviva), Bendon (Cenntro), Foxconn (FIH Mobile, a subsidiary), Iliad (Archrock),
-- Thrive Capital (Etoiles Capital). ARGUABLE: Porsche (Porsche Automobil Holding SE).

-- ============================================================================
-- REFUSED ON AMBIGUITY. Two or more listed CIKs are equally admissible. There is no
-- tie-break; guessing here is how a page renders another company's filings.
-- ============================================================================
--   Community Bancorp                -> 350852 'COMMUNITY TRUST BANCORP INC /KY/'; 718413 'COMMUNITY BANCORP /VT'
--   Crown Holdings                   -> 1219601 'CROWN HOLDINGS, INC.'; 799850 'CROWN GROUP INC /TX/'
--   First BanCorp                    -> 765207 'First Bancorp, Inc /ME/'; 1057706 'FIRST BANCORP /PR/'; 811589 'FIRST BANCORP /NC/'
--   FirstService                     -> 1637810 'FirstService Corp'; 913353 'FIRSTSERVICE CORP'
--   Independent Bank                 -> 39311 'INDEPENDENT BANK CORP /MI/'; 776901 'INDEPENDENT BANK CORP'
--   Liberty Media Corporation        -> 1355096 'LIBERTY MEDIA CORP'; 1560385 'Liberty Media Corp'
--   Madison Square Garden Entertainment -> 1952073 'Madison Square Garden Entertainment Corp.'; 1795250 'Madison Square Garden Entertainment Corp.'
--   Travelers Companies              -> 831001 'TRAVELERS GROUP INC'; 86312 'TRAVELERS COMPANIES, INC.'
--   UBS AG                           -> 1610520 'UBS Group AG'; 1114446 'UBS AG'
--   UBS Group AG                     -> 1610520 'UBS Group AG'; 1114446 'UBS AG'

